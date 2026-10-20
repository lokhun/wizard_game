import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Small immediate-mode geometry builder used to assemble level meshes.
export class GeoBuilder {
  constructor() {
    this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = [];
  }
  get count() { return this.pos.length / 3; }
  vert(x, y, z, nx, ny, nz, u, v, c = 1) {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.uv.push(u, v);
    if (Array.isArray(c)) this.col.push(c[0], c[1], c[2]); else this.col.push(c, c, c);
    return this.count - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quadIdx(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  // quad from 4 corners (counter-clockwise when seen from the front)
  quad(p0, p1, p2, p3, n, uvs, cols = [1, 1, 1, 1]) {
    const a = this.vert(...p0, ...n, ...uvs[0], cols[0]);
    const b = this.vert(...p1, ...n, ...uvs[1], cols[1]);
    const c = this.vert(...p2, ...n, ...uvs[2], cols[2]);
    const d = this.vert(...p3, ...n, ...uvs[3], cols[3]);
    this.quadIdx(a, b, c, d);
  }
  // append an existing BufferGeometry transformed by matrix
  addGeometry(geo, matrix, color = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv');
    const v = new THREE.Vector3(), nn = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const base = this.count;
    const ca = g.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      nn.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      const c = ca ? [ca.getX(i) * (Array.isArray(color) ? color[0] : color), ca.getY(i) * (Array.isArray(color) ? color[1] : color), ca.getZ(i) * (Array.isArray(color) ? color[2] : color)] : color;
      this.vert(v.x, v.y, v.z, nn.x, nn.y, nn.z, uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0, c);
    }
    for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Box geometry with world-scaled UVs (so textures keep a constant texel density)
export function worldBox(w, h, d, uvScale = 0.5) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  const n = g.getAttribute('normal');
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    let su, sv;
    if (nx > 0.5) { su = d; sv = h; } else if (ny > 0.5) { su = w; sv = d; } else { su = w; sv = h; }
    uv.setXY(i, uv.getX(i) * su * uvScale, uv.getY(i) * sv * uvScale);
  }
  return g;
}

export function colorize(geo, c) {
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  const col = new THREE.Color(c);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// Merge geometries after normalising attributes (drops anything but pos/normal/uv/color)
export function merge(geos) {
  const clean = geos.map((g) => {
    let gg = g.index ? g.toNonIndexed() : g.clone();
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', gg.getAttribute('position'));
    out.setAttribute('normal', gg.getAttribute('normal') ?? (gg.computeVertexNormals(), gg.getAttribute('normal')));
    out.setAttribute('uv', gg.getAttribute('uv') ?? new THREE.Float32BufferAttribute(new Float32Array(gg.getAttribute('position').count * 2), 2));
    if (gg.getAttribute('color')) out.setAttribute('color', gg.getAttribute('color'));
    else {
      const n = gg.getAttribute('position').count;
      out.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    }
    return out;
  });
  return mergeGeometries(clean, false);
}

// Transform helper returning a cloned geometry
export function tf(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  return geo.clone().applyMatrix4(m);
}
