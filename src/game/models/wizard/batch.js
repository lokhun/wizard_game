import * as THREE from 'three';
import { RIM } from '../core.js';

// ---------------------------------------------------------------------------
// Draw-call batching for the third-person avatars.
//
// The avatar is authored as an ordinary scene graph (skeleton of groups, the
// class focus, hat and hands as plain meshes) plus a list of authored body
// parts with explicit skin weights. bakeAvatar() turns all of it into one
// SkinnedMesh per material signature. Every source mesh keeps living in the
// hierarchy as a transform-only "bone" (its own matrixWorld drives its
// vertices), so focus / hat / fx animation code that moves meshes keeps
// working untouched. Only meshes whose geometry, material or visibility
// change at runtime (found by probing the update loop) stay separate.
//
// Shared kit materials that differ only by colour are merged: the colour is
// baked into vertex colours, so all cloth / leather / metal on an avatar is
// one draw call each.
// ---------------------------------------------------------------------------

const EMPTY = new THREE.BufferGeometry();
EMPTY.userData.shared = true;
const _n = new THREE.Matrix3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
const _c = new THREE.Color();

// ---- probing -----------------------------------------------------------------
// Runs `run(sample)` (which steps the avatar through its animations, calling
// sample() after every step) and returns the set of meshes that must not be
// batched, plus the set of objects that existed before the run.
export function probeDynamic(root, run) {
  const nodes = [];
  root.traverse((o) => nodes.push(o));
  const known = new Set(nodes);
  const st = nodes.map((o) => ({
    vis: o.visible, geo: o.geometry, mat: o.material,
    ver: o.geometry?.attributes?.position?.version ?? -1,
    p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone(),
  }));
  // animated per-instance materials: record their colour trajectories, so
  // materials that always look identical can share one draw call
  const mats = new Set();
  for (const o of nodes) if ((o.isMesh || o.isSprite) && o.material && !Array.isArray(o.material) && !o.material.userData.shared) mats.add(o.material);
  const traj = new Map([...mats].map((m) => [m, []]));
  const visDyn = new Set(), dyn = new Set();
  run(() => {
    for (let i = 0; i < nodes.length; i++) {
      const o = nodes[i], s = st[i];
      if (o.visible !== s.vis) visDyn.add(o);
      if (o.isMesh || o.isSprite) {
        if (o.geometry !== s.geo || o.material !== s.mat || (o.geometry?.attributes?.position?.version ?? -1) !== s.ver) dyn.add(o);
      }
    }
    for (const [m, a] of traj) {
      a.push(m.color ? `${m.color.r.toFixed(3)},${m.color.g.toFixed(3)},${m.color.b.toFixed(3)}` : '', m.opacity.toFixed(3), m.emissiveIntensity !== undefined ? m.emissiveIntensity.toFixed(3) : '');
    }
  });
  // restore the bind pose / visibility
  for (let i = 0; i < nodes.length; i++) {
    const o = nodes[i], s = st[i];
    o.position.copy(s.p); o.quaternion.copy(s.q); o.scale.copy(s.s); o.visible = s.vis;
  }
  const matSig = new Map();
  for (const [m, a] of traj) {
    matSig.set(m, [m.type, m.blending, m.transparent ? 1 : 0, m.depthWrite ? 1 : 0, m.depthTest ? 1 : 0, m.side, m.fog ? 1 : 0, m.toneMapped ? 1 : 0, m.vertexColors ? 1 : 0,
      m.map?.uuid ?? '-', m.alphaMap?.uuid ?? '-', m.emissiveMap?.uuid ?? '-', m.normalMap?.uuid ?? '-', m.emissive ? m.emissive.getHexString() : '', m.roughness ?? '', m.metalness ?? '',
      m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ? m.uuid : '', a.join(';')].join('|'));
  }
  return { exclude: dyn, known, visDyn, matSig };
}

// ---- material handling -----------------------------------------------------
const MERGEABLE = (m) => m && !Array.isArray(m) && (m.isMeshStandardMaterial || m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) && !m.isShaderMaterial;
const tid = (t) => (t ? t.uuid : '-');
// signature of a shared surface material, ignoring its base colour
let _matSig = null;
function sigOf(m) {
  if (!m.userData.shared || !m.isMeshStandardMaterial) return 'u:' + (_matSig?.get(m) ?? m.uuid);
  return ['s', m.type, tid(m.map), tid(m.normalMap), tid(m.roughnessMap), tid(m.emissiveMap), m.side, m.transparent ? 1 : 0, m.opacity,
    Math.round(m.roughness * 10), Math.round(m.metalness * 10), m.normalScale ? Math.round(m.normalScale.x) : 0,
    m.emissive ? m.emissive.getHexString() : '', m.emissiveIntensity, m.customProgramCacheKey ? m.customProgramCacheKey() : ''].join('|');
}

// fresnel rim matching the enemy materials (uses their global rim uniform)
const RIM_FRAG = `
  {
    float ndvR = clamp(abs(dot(normalize(vNormal), normalize(vViewPosition))), 0.0, 1.0);
    totalEmissiveRadiance += uRim * pow(1.0 - ndvR, 4.0) * (0.3 + 1.4 * diffuseColor.rgb);
  }
`;
function withRim(mat, src) {
  const prev = src.onBeforeCompile, prevKey = src.customProgramCacheKey ? src.customProgramCacheKey() : '';
  const hasPrev = src.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (hasPrev) prev.call(mat, sh, r);
    Object.assign(sh.uniforms, RIM);
    sh.fragmentShader = 'uniform vec3 uRim;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + RIM_FRAG);
  };
  mat.customProgramCacheKey = () => prevKey + ':avrim';
  return mat;
}
// clone of a shared material that keeps its shader hook (skin scatter)
export function cloneShared(src, { white = false, rim = true } = {}) {
  const m = src.clone();
  if (white) { m.color.setRGB(1, 1, 1); m.vertexColors = true; }
  if (rim && m.isMeshStandardMaterial) withRim(m, src);
  else if (src.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) { m.onBeforeCompile = src.onBeforeCompile; m.customProgramCacheKey = src.customProgramCacheKey; }
  m.userData = { base: m.color.clone(), baseEmissive: m.emissive ? m.emissive.clone() : null, baseEI: m.emissiveIntensity ?? 1, avatar: true };
  return m;
}

// ---- part collection -------------------------------------------------------
// part: { geo, mat, M (Matrix4 into root space) | null, bone (Object3D) | null,
//         skin: fn(rootPos) -> [[bone, w], ...] | null, ro }
const _labels = {};
function pushPart(groups, part) {
  const { geo, mat } = part;
  const n = (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
  _labels[part.label ?? '?'] = (_labels[part.label ?? '?'] ?? 0) + n;
  const key = sigOf(mat) + '#' + (part.ro ?? 0);
  let g = groups.get(key);
  if (!g) { g = { key, src: mat, ro: part.ro ?? 0, items: [] }; groups.set(key, g); }
  g.items.push(part);
}

function bakeGroup(g, boneIndex, addBone) {
  // count
  let nv = 0, ni = 0;
  for (const it of g.items) {
    const p = it.geo.getAttribute('position');
    nv += p.count;
    ni += it.geo.index ? it.geo.index.count : p.count;
  }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3);
  const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const shared = sigOf(g.src).startsWith('s|');
  let vo = 0, io = 0;
  for (const it of g.items) {
    const geo = it.geo;
    const P = geo.getAttribute('position');
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const N = geo.getAttribute('normal'), U = geo.getAttribute('uv'), C = geo.getAttribute('color');
    const M = it.M;
    if (M) _n.getNormalMatrix(M);
    const flip = M ? M.determinant() < 0 : false;
    // base colour of the source material folds into the vertex colours
    if (shared) _c.copy(it.mat.color); else _c.setRGB(1, 1, 1);
    const rigid = it.skin ? -1 : boneIndex.get(it.bone);
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i);
      if (M) _v.applyMatrix4(M);
      pos[(vo + i) * 3] = _v.x; pos[(vo + i) * 3 + 1] = _v.y; pos[(vo + i) * 3 + 2] = _v.z;
      _w.fromBufferAttribute(N, i);
      if (M) _w.applyMatrix3(_n).normalize();
      nrm[(vo + i) * 3] = _w.x; nrm[(vo + i) * 3 + 1] = _w.y; nrm[(vo + i) * 3 + 2] = _w.z;
      if (U) { uv[(vo + i) * 2] = U.getX(i); uv[(vo + i) * 2 + 1] = U.getY(i); }
      const cr = C ? C.getX(i) : 1, cg = C ? C.getY(i) : 1, cb = C ? C.getZ(i) : 1;
      col[(vo + i) * 3] = cr * _c.r; col[(vo + i) * 3 + 1] = cg * _c.g; col[(vo + i) * 3 + 2] = cb * _c.b;
      const o4 = (vo + i) * 4;
      if (rigid >= 0) { si[o4] = rigid; sw[o4] = 1; } else {
        const ws = it.skin(_v);
        let tot = 0;
        const n = Math.min(4, ws.length);
        for (let k = 0; k < n; k++) tot += ws[k][1];
        for (let k = 0; k < n; k++) {
          if (!boneIndex.has(ws[k][0])) addBone(ws[k][0]);
          const bi = boneIndex.get(ws[k][0]);
          si[o4 + k] = bi; sw[o4 + k] = ws[k][1] / (tot || 1);
        }
      }
    }
    if (geo.index) {
      const I = geo.index.array;
      for (let i = 0; i < I.length; i += 3) {
        idx[io + i] = I[i] + vo;
        idx[io + i + 1] = I[flip ? i + 2 : i + 1] + vo;
        idx[io + i + 2] = I[flip ? i + 1 : i + 2] + vo;
      }
      io += I.length;
    } else {
      for (let i = 0; i < P.count; i += 3) {
        idx[io + i] = vo + i; idx[io + i + 1] = vo + (flip ? i + 2 : i + 1); idx[io + i + 2] = vo + (flip ? i + 1 : i + 2);
      }
      io += P.count;
    }
    vo += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return { geo: out, shared, tris: ni / 3 };
}

// Bake the avatar. authored: list of { geo (root space), mat, bone | skin }.
// Returns { meshes, materials, tris, setTint(hex,k), dispose() }.
export function bakeAvatar(root, authored, { exclude = new Set(), known = null, visDyn = new Set(), matSig = null } = {}) {
  _matSig = matSig;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();
  const bones = [], boneIndex = new Map();
  const addBone = (b) => { if (!boneIndex.has(b)) { boneIndex.set(b, bones.length); bones.push(b); } };
  const sources = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh) return;
    if (exclude.has(o) || (known && !known.has(o)) || !MERGEABLE(o.material)) return;
    if (!o.geometry?.getAttribute('position')) return;
    sources.push(o);
  });
  for (const k in _labels) delete _labels[k];
  const labelOf = (o) => { let l = 'mesh'; for (let p = o; p && p !== root; p = p.parent) if (p.name && !/^(thigh|knee|ankle|shoulder|elbow|wrist|hips|spine|chest|neck|head|body)$/.test(p.name)) l = p.name; return l; };
  // meshes under nodes whose visibility toggles get a bone that collapses to
  // zero scale while any of those nodes is hidden
  const visGroups = new Map();
  for (const o of sources) {
    const M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const reskin = o.userData.reskin;
    if (reskin) {
      for (const b of reskin.bones) addBone(b);
    }
    let bone = o;
    const vs = [];
    for (let p = o; p && p !== root; p = p.parent) if (visDyn.has(p)) vs.push(p);
    if (vs.length) {
      const vb = new THREE.Object3D();
      vb.name = 'visBone';
      o.add(vb);
      vb.updateMatrixWorld(true);
      const key = vs.map((v) => v.id).join(',');
      if (!visGroups.has(key)) visGroups.set(key, { nodes: vs, bones: [] });
      visGroups.get(key).bones.push(vb);
      bone = vb;
    }
    addBone(bone);
    pushPart(groups, { geo: o.geometry, mat: o.material, M, bone, skin: reskin ? reskin.fn : null, ro: o.renderOrder, label: labelOf(o) });
  }
  const visList = [...visGroups.values()];
  for (const p of authored) {
    if (p.bone) addBone(p.bone);
    if (p.bones) p.bones.forEach(addBone);
    pushPart(groups, { geo: p.geo, mat: p.mat, M: null, bone: p.bone ?? null, skin: p.skin ?? null, ro: p.ro ?? 0, label: p.label });
  }
  const meshes = [], materials = [];
  let tris = 0;
  const baked = [];
  for (const g of groups.values()) baked.push([g, bakeGroup(g, boneIndex, addBone)]);
  // skeleton: bind = current pose
  const boneInverses = bones.map((b) => new THREE.Matrix4().multiplyMatrices(inv, b.matrixWorld).invert());
  const skeleton = new THREE.Skeleton(bones, boneInverses);
  for (const [g, b] of baked) {
    const { geo, shared, tris: t } = b;
    tris += t;
    const mat = shared ? cloneShared(g.src, { white: true }) : g.src;
    if (shared) materials.push(mat);
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.name = 'mesh:' + (g.src.name || g.src.type);
    mesh.renderOrder = g.ro;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.6);
    mesh.userData.baseColors = shared ? Float32Array.from(geo.getAttribute('color').array) : null;
    root.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(skeleton, mesh.matrixWorld);
    meshes.push(mesh);
  }
  // retire the sources: keep them as transform nodes, stop rendering them
  const keepGeo = new Set();
  root.traverse((o) => { if ((o.isMesh || o.isSprite) && !sources.includes(o) && o.geometry) keepGeo.add(o.geometry); });
  const disposed = new Set();
  for (const o of sources) {
    const g = o.geometry;
    if (!keepGeo.has(g) && !g.userData?.shared && !disposed.has(g)) { disposed.add(g); g.dispose(); }
    o.geometry = EMPTY;
    o.isMesh = false;
  }
  for (const p of authored) if (!disposed.has(p.geo)) { disposed.add(p.geo); p.geo.dispose(); }
  const tint = new THREE.Color();
  _matSig = null;
  return {
    // call after the avatar's update: hide baked parts of hidden subtrees
    syncVisibility() {
      for (let i = 0; i < visList.length; i++) {
        const g = visList[i];
        let vis = true;
        for (let j = 0; j < g.nodes.length; j++) if (!g.nodes[j].visible) { vis = false; break; }
        const sc = vis ? 1 : 0;
        for (let j = 0; j < g.bones.length; j++) g.bones[j].scale.setScalar(sc);
      }
    },
    meshes, materials, skeleton, tris, bones: bones.length, labels: Object.fromEntries(Object.entries(_labels).map(([k, v]) => [k, Math.round(v)])),
    setTint(hex, k) {
      if (hex !== null && hex !== undefined) tint.set(hex);
      for (const m of meshes) {
        const base = m.userData.baseColors;
        if (!base) continue;
        const a = m.geometry.getAttribute('color');
        const arr = a.array;
        if (hex === null || hex === undefined || k <= 0) arr.set(base);
        else for (let i = 0; i < arr.length; i += 3) {
          arr[i] = base[i] + (tint.r - base[i]) * k;
          arr[i + 1] = base[i + 1] + (tint.g - base[i + 1]) * k;
          arr[i + 2] = base[i + 2] + (tint.b - base[i + 2]) * k;
        }
        a.needsUpdate = true;
      }
    },
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      for (const m of materials) m.dispose();
      skeleton.dispose();
    },
  };
}
