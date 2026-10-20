import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const angleLerp = (a, b, t) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
export const angleDamp = (a, b, lambda, dt) => angleLerp(a, b, 1 - Math.exp(-lambda * dt));
export const dist2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const tmpV = new THREE.Vector3();
export const tmpV2 = new THREE.Vector3();
export const tmpV3 = new THREE.Vector3();
export const UP = new THREE.Vector3(0, 1, 0);

// Distance from point p to segment ab (3D), returns squared distance
export function segPointDist2(ax, ay, az, bx, by, bz, px, py, pz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
  t = clamp(t, 0, 1);
  const dx = ax + abx * t - px, dy = ay + aby * t - py, dz = az + abz * t - pz;
  return dx * dx + dy * dy + dz * dz;
}

// Ray vs vertical capsule-ish cylinder (enemy hitbox). Returns t or -1.
export function rayCylinder(ox, oy, oz, dx, dy, dz, cx, cz, r, y0, y1, maxT) {
  const fx = ox - cx, fz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-8) {
    if (fx * fx + fz * fz <= r * r) {
      return -1; // vertical ray: ignore
    }
    return -1;
  }
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - r * r;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  disc = Math.sqrt(disc);
  let t = (-b - disc) / (2 * a);
  if (t < 0) t = (-b + disc) / (2 * a);
  if (t < 0 || t > maxT) return -1;
  const y = oy + dy * t;
  if (y < y0 || y > y1) return -1;
  return t;
}

export function hexToRGB(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}
