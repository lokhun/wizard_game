import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// One shadow draw per enemy instead of one per material.
//
// An enemy is 4-8 skinned meshes (one per material) on one skeleton, and on
// the moonlit floors every one of them was drawn again into the shadow map:
// a crowd of 40 cost ~200 shadow draws a frame. The depth pass ignores the
// materials, so all of a model's opaque parts go into a single skinned proxy
// on the same skeleton (geometry merged once per template and shared) and the
// parts stop casting. The proxy is hidden from the camera and shown only while
// three.js renders the shadow maps (Renderer.shadowOnly), so the shadow is the
// same depth image, from the same vertices.
//
// Parts that need their own depth state (alpha-tested, displaced) or that hide
// on their own (boss fx meshes) keep casting as before.

const merged = new WeakMap(); // first part geometry -> Map(key -> merged geometry)
const proxyMats = new Map(); // side -> material (only its side reaches the depth pass)

const sameMatrix = (a, b) => a.equals(b);

export function castMergedShadow(root, renderer) {
  const groups = new Map();
  const loose = [];
  root.traverse((o) => {
    if (!o.isMesh || o.material?.transparent) return;
    const m = o.material;
    const own = !o.isSkinnedMesh || Array.isArray(m) || o.userData.fx || m.alphaTest > 0 || m.alphaMap || (m.displacementMap && m.displacementScale !== 0)
      || m.alphaToCoverage || m.shadowSide !== null || m.visible === false || o.geometry.morphAttributes?.position;
    if (own) { loose.push(o); return; }
    o.updateMatrix();
    let g = null;
    for (const c of groups.values()) {
      if (c.side === m.side && c.parent === o.parent && c.skeleton === o.skeleton && sameMatrix(c.bind, o.bindMatrix) && sameMatrix(c.local, o.matrix)) { g = c; break; }
    }
    if (!g) { g = { side: m.side, parent: o.parent, skeleton: o.skeleton, bind: o.bindMatrix, local: o.matrix, meshes: [] }; groups.set(groups.size, g); }
    g.meshes.push(o);
  });
  for (const o of loose) o.castShadow = true;
  const proxies = [];
  for (const g of groups.values()) {
    if (g.meshes.length < 2) { g.meshes[0].castShadow = true; continue; }
    const geos = g.meshes.map((o) => o.geometry);
    let cache = merged.get(geos[0]);
    if (!cache) merged.set(geos[0], (cache = new Map()));
    const key = geos.map((x) => x.uuid).join(',');
    let geo = cache.get(key);
    if (!geo) {
      geo = mergeGeometries(geos.map((x) => {
        const b = new THREE.BufferGeometry();
        for (const k of ['position', 'skinIndex', 'skinWeight']) b.setAttribute(k, x.getAttribute(k));
        b.setIndex(x.index ?? [...Array(x.getAttribute('position').count).keys()]);
        return b;
      }), false);
      geo.userData.shared = true;
      cache.set(key, geo);
    }
    if (!proxyMats.has(g.side)) proxyMats.set(g.side, new THREE.MeshBasicMaterial({ side: g.side }));
    const p = new THREE.SkinnedMesh(geo, proxyMats.get(g.side));
    p.name = 'shadowProxy';
    p.matrixAutoUpdate = false;
    p.matrix.copy(g.local);
    p.bind(g.skeleton, g.bind);
    const src = g.meshes[0];
    p.frustumCulled = src.frustumCulled;
    if (src.boundingSphere) p.boundingSphere = src.boundingSphere;
    p.castShadow = true;
    p.visible = false;
    g.parent.add(p);
    for (const o of g.meshes) o.castShadow = false;
    renderer.shadowOnly.add(p);
    proxies.push(p);
  }
  return () => { for (const p of proxies) { renderer.shadowOnly.delete(p); p.removeFromParent(); } };
}
