import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _nm = new THREE.Matrix3();

// Small immediate-mode geometry builder used to assemble level meshes. Vertices go
// straight into growable typed arrays, so a floor's big batches are built without
// boxing millions of numbers into JS arrays and converting them again at the end.
export class GeoBuilder {
  constructor() {
    this.n = 0; this.ni = 0; this.cap = 0; this.icap = 0;
    this._grow(64); this._growI(96);
  }
  _grow(k) {
    const cap = Math.max(this.cap * 2, this.n + k, 64);
    const cp = (a, w) => { const b = new Float32Array(cap * w); if (a) b.set(a.subarray(0, this.n * w)); return b; };
    this.P = cp(this.P, 3); this.N = cp(this.N, 3); this.U = cp(this.U, 2); this.C = cp(this.C, 3);
    this.cap = cap;
  }
  _growI(k) {
    const cap = Math.max(this.icap * 2, this.ni + k, 96);
    const b = new Uint32Array(cap);
    if (this.I) b.set(this.I.subarray(0, this.ni));
    this.I = b; this.icap = cap;
  }
  get count() { return this.n; }
  vert(x, y, z, nx, ny, nz, u, v, c = 1) {
    if (this.n >= this.cap) this._grow(1);
    const i = this.n, i3 = i * 3;
    this.P[i3] = x; this.P[i3 + 1] = y; this.P[i3 + 2] = z;
    this.N[i3] = nx; this.N[i3 + 1] = ny; this.N[i3 + 2] = nz;
    this.U[i * 2] = u; this.U[i * 2 + 1] = v;
    if (Array.isArray(c)) { this.C[i3] = c[0]; this.C[i3 + 1] = c[1]; this.C[i3 + 2] = c[2]; } else { this.C[i3] = c; this.C[i3 + 1] = c; this.C[i3 + 2] = c; }
    return this.n++;
  }
  tri(a, b, c) {
    if (this.ni + 3 > this.icap) this._growI(3);
    const I = this.I, k = this.ni;
    I[k] = a; I[k + 1] = b; I[k + 2] = c;
    this.ni += 3;
  }
  quadIdx(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  // quad from 4 corners (counter-clockwise when seen from the front)
  quad(p0, p1, p2, p3, n, uvs, cols = [1, 1, 1, 1]) {
    const a = this.vert(p0[0], p0[1], p0[2], n[0], n[1], n[2], uvs[0][0], uvs[0][1], cols[0]);
    const b = this.vert(p1[0], p1[1], p1[2], n[0], n[1], n[2], uvs[1][0], uvs[1][1], cols[1]);
    const c = this.vert(p2[0], p2[1], p2[2], n[0], n[1], n[2], uvs[2][0], uvs[2][1], cols[2]);
    const d = this.vert(p3[0], p3[1], p3[2], n[0], n[1], n[2], uvs[3][0], uvs[3][1], cols[3]);
    this.quadIdx(a, b, c, d);
  }
  // append an existing BufferGeometry transformed by matrix (indexed geometry keeps its
  // index, so shared vertices are not duplicated; the transform is inlined for speed)
  addGeometry(geo, matrix, color = 1) {
    const p = geo.getAttribute('position'), n = geo.getAttribute('normal'), uv = geo.getAttribute('uv'), ca = geo.getAttribute('color');
    const e = matrix.elements, m = _nm.getNormalMatrix(matrix).elements;
    const arr = Array.isArray(color);
    const cr = arr ? color[0] : color, cg = arr ? color[1] : color, cb = arr ? color[2] : color;
    const cnt = p.count, ix = geo.index, icnt = ix ? ix.count : cnt;
    if (this.n + cnt > this.cap) this._grow(cnt);
    if (this.ni + icnt > this.icap) this._growI(icnt);
    const P = this.P, N = this.N, U = this.U, C = this.C, I = this.I;
    // plain (non-interleaved) attributes are read straight from their arrays
    const plain = (a, w) => !a || (!a.isInterleavedBufferAttribute && a.itemSize === w);
    const fast = plain(p, 3) && plain(n, 3) && plain(uv, 2) && plain(ca, 3);
    const pa = p.array, na = n.array, ua = uv ? uv.array : null, cc = ca ? ca.array : null;
    const base = this.n;
    for (let i = 0; i < cnt; i++) {
      const x = fast ? pa[i * 3] : p.getX(i), y = fast ? pa[i * 3 + 1] : p.getY(i), z = fast ? pa[i * 3 + 2] : p.getZ(i);
      const o = (base + i) * 3, o2 = (base + i) * 2;
      P[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      P[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      P[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const a = fast ? na[i * 3] : n.getX(i), b = fast ? na[i * 3 + 1] : n.getY(i), c = fast ? na[i * 3 + 2] : n.getZ(i);
      const nx = m[0] * a + m[3] * b + m[6] * c, ny = m[1] * a + m[4] * b + m[7] * c, nz = m[2] * a + m[5] * b + m[8] * c;
      const l = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      N[o] = nx * l; N[o + 1] = ny * l; N[o + 2] = nz * l;
      if (uv) { U[o2] = fast ? ua[i * 2] : uv.getX(i); U[o2 + 1] = fast ? ua[i * 2 + 1] : uv.getY(i); } else { U[o2] = 0; U[o2 + 1] = 0; }
      if (ca) {
        C[o] = (fast ? cc[i * 3] : ca.getX(i)) * cr; C[o + 1] = (fast ? cc[i * 3 + 1] : ca.getY(i)) * cg; C[o + 2] = (fast ? cc[i * 3 + 2] : ca.getZ(i)) * cb;
      } else { C[o] = cr; C[o + 1] = cg; C[o + 2] = cb; }
    }
    const k0 = this.ni;
    if (ix) { const ia = ix.array; for (let i = 0; i < icnt; i++) I[k0 + i] = base + ia[i]; }
    else for (let i = 0; i < icnt; i++) I[k0 + i] = base + i;
    this.n += cnt; this.ni += icnt;
  }
  build() {
    const g = new THREE.BufferGeometry();
    const n = this.n;
    g.setAttribute('position', new THREE.BufferAttribute(this.P.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.slice(0, n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.U.slice(0, n * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.slice(0, n * 3), 3));
    const idx = this.I.subarray(0, this.ni);
    g.setIndex(new THREE.BufferAttribute(n > 65535 ? idx.slice() : Uint16Array.from(idx), 1));
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
