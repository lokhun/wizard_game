import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Clustered forward lighting.
//
// three.js lights a material with a fixed array of point lights: the count is
// baked into every lit program (changing it recompiles them all), the loop is
// unrolled (16 lights on High: 16 inlined copies of the PBR BRDF in every lit
// shader), every lit pixel walks every light, and every program switch
// re-sends every light's uniforms (torches flicker, so each frame, for each of
// the ~70 programs drawn: ~600 uniform calls a frame).
//
// Instead the main scene has no three.js point lights at all. Its lights are
// plain records (ClusterLight) packed each frame into a small texture, and the
// view frustum is cut into a grid of cells (16 x 9 screen tiles x 24
// depth slices, exponential in depth). Each cell holds a 128-bit mask of the
// lights whose sphere of reach touches it, in an RGBA32UI texture. A lit pixel
// finds its cell from gl_FragCoord and its depth and walks only the set bits,
// so a light costs only the pixels it can reach and the light count never
// touches a program. Same falloff, same BRDF, same image. (Both live in one
// RGBA32UI texture, uploaded once a frame: 60 KB.)
//
// The texture and two vec4s are shared by every lit built-in material:
// they sit in ShaderLib's uniforms, and three clones those per material - so
// these are a texture and a vector whose clone() is themselves.
//
// The first-person hands render with their own camera and keep their own few
// three.js point lights (the cluster grid is the main camera's): the view
// pass switches the cluster loop off (uClusterInfo.x).
// ---------------------------------------------------------------------------

export const MAX_LIGHTS = 128; // 4 mask words of 32 bits per cell
const GX = 16, GY = 9, GZ = 24;
const Z_NEAR = 1, Z_FAR = 120; // slice 0 is everything nearer than Z_NEAR; the last, everything past Z_FAR
const LOG_SPAN = Math.log(Z_FAR / Z_NEAR);
const SLICE_K = GZ / LOG_SPAN, SLICE_B = -GZ * Math.log(Z_NEAR) / LOG_SPAN;
// the near depth of each slice
const SLICE_Z = new Float64Array(GZ + 1);
for (let k = 0; k <= GZ; k++) SLICE_Z[k] = k === 0 ? 0 : Z_NEAR * Math.exp((k / GZ) * LOG_SPAN);
SLICE_Z[GZ] = Infinity;
const sliceOf = (d) => (d <= 0 ? 0 : Math.min(GZ - 1, Math.max(0, Math.floor(Math.log(d) * SLICE_K + SLICE_B))));

class SharedDataTexture extends THREE.DataTexture { clone() { return this; } }
class SharedVector4 extends THREE.Vector4 { clone() { return this; } }

// One RGBA32UI texture, 256 texels wide (so every lookup is shifts and masks,
// no integer division), so a lit program binds one extra texture, not two:
// the cells' masks first (cell c = tile x + tile y * GX + slice * GX * GY at
// texel c), then from row MASK_ROWS the lights, two texels each as float bits:
// (view-space position, range), (colour x intensity, decay).
const W = 256, CELLS = GX * GY * GZ, MASK_ROWS = Math.ceil(CELLS / W), LIGHT_ROWS = Math.ceil((MAX_LIGHTS * 2) / W);
const texData = new Uint32Array(W * (MASK_ROWS + LIGHT_ROWS) * 4);
const MASK_LEN = CELLS * 4;
const maskData = texData.subarray(0, MASK_LEN);
const lightData = new Float32Array(texData.buffer, W * MASK_ROWS * 16, MAX_LIGHTS * 2 * 4);
const tex = new SharedDataTexture(texData, W, MASK_ROWS + LIGHT_ROWS, THREE.RGBAIntegerFormat, THREE.UnsignedIntType);
tex.internalFormat = 'RGBA32UI';
tex.name = 'Clusters';
tex.magFilter = tex.minFilter = THREE.NearestFilter;
tex.generateMipmaps = false;
tex.needsUpdate = true;
// x, y: cells per pixel across and up; z, w: slice = log(depth) * z + w
const grid = new SharedVector4(GX / 1280, GY / 720, SLICE_K, SLICE_B);
// x: 1 while the main scene draws (0 for the hands' pass); y: mask words in use
const info = new SharedVector4(0, 0, 0, 0);

const UNIFORMS = {
  uClusters: { value: tex },
  uClusterGrid: { value: grid },
  uClusterInfo: { value: info },
};
// (Not toon: its direct light samples a gradient map, and D3D's FXC can't compile a sample with
// derivatives inside a loop of unknown length, so the loop is left out of it: see LOOP.)
for (const id of ['standard', 'physical', 'lambert', 'phong']) Object.assign(THREE.ShaderLib[id].uniforms, UNIFORMS);

const PARS = /* glsl */ `
uniform highp usampler2D uClusters;
uniform vec4 uClusterGrid;
uniform vec4 uClusterInfo;
`;

// Both loops have bounds the compiler can't count (a uniform, a mask): D3D's
// FXC unrolls every loop it can count, and 128 inlined BRDFs would take
// seconds to compile.
const LOOP = /* glsl */ `
#if defined( RE_Direct ) && ! defined( TOON )
	if ( uClusterInfo.x > 0.5 ) {

		ivec2 cTile = min( ivec2( gl_FragCoord.xy * uClusterGrid.xy ), ivec2( ${GX - 1}, ${GY - 1} ) );
		int cSlice = int( clamp( log( max( vViewPosition.z, 1e-4 ) ) * uClusterGrid.z + uClusterGrid.w, 0.0, ${GZ - 1}.0 ) );
		int cCell = cTile.x + cTile.y * ${GX} + cSlice * ${GX * GY};
		uvec4 cMask = texelFetch( uClusters, ivec2( cCell & ${W - 1}, cCell >> ${Math.log2(W)} ), 0 );
		int cWords = int( uClusterInfo.y );

		for ( int cw = 0; cw < cWords; cw ++ ) {

			uint cBits = cw == 0 ? cMask.x : cw == 1 ? cMask.y : cw == 2 ? cMask.z : cMask.w;

			while ( cBits != 0u ) {

				uint cLow = cBits & ( ~ cBits + 1u );
				cBits ^= cLow;
				// (the index of the lowest set bit: a power of two's float exponent)
				int cIdx = ( ( cw << 5 ) + int( ( floatBitsToUint( float( cLow ) ) >> 23u ) - 127u ) ) << 1;

				vec4 cPos = uintBitsToFloat( texelFetch( uClusters, ivec2( cIdx & ${W - 1}, ${MASK_ROWS} + ( cIdx >> ${Math.log2(W)} ) ), 0 ) );
				vec3 cVec = cPos.xyz - geometryPosition;
				float cD2 = dot( cVec, cVec );
				if ( cD2 >= cPos.w * cPos.w ) continue;

				cIdx ++;
				vec4 cCol = uintBitsToFloat( texelFetch( uClusters, ivec2( cIdx & ${W - 1}, ${MASK_ROWS} + ( cIdx >> ${Math.log2(W)} ) ), 0 ) );
				float cD = sqrt( cD2 );
				directLight.direction = cVec / max( cD, 1e-4 );
				directLight.color = cCol.rgb * getDistanceAttenuation( cD, cPos.w, cCol.w );
				directLight.visible = true;
				RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

			}

		}

	}
#endif
`;

function patch(name, from, to) {
  const src = THREE.ShaderChunk[name];
  if (!src.includes(from)) throw new Error(`clustered lighting: ${name} has changed (three.js upgrade?)`);
  THREE.ShaderChunk[name] = src.replace(from, to);
}
patch('lights_pars_begin', '#if NUM_POINT_LIGHTS > 0', PARS + '\n#if NUM_POINT_LIGHTS > 0');
patch('lights_fragment_begin', '#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )', LOOP + '\n#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )');
// the multi-scattering term for direct light is only set up when a light count says there is direct
// light; the cluster can light any material
patch('lights_fragment_begin', '#if ( NUM_SUN_LIGHTS > 0 || NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 || NUM_SPOT_LIGHTS > 0 )', '#if 1');

// The cluster lights only what the main camera draws: a pass with another camera
// (the first-person hands) switches it off around its render.
export function clusterOn(on) { info.x = on ? 1 : 0; }

// A point light for the cluster: the fields of a THREE.PointLight that light
// anything (position, color, intensity, distance, decay), and nothing else.
// distance must be > 0: it is the reach the cells are cut by.
export class ClusterLight {
  constructor(color = 0xffffff, intensity = 1, distance = 10, decay = 2) {
    this.isClusterLight = true;
    this.position = new THREE.Vector3();
    this.color = new THREE.Color(color);
    this.intensity = intensity;
    this.distance = distance;
    this.decay = decay;
    this.visible = true;
  }
}

export class ClusteredLights {
  constructor() {
    this.sources = [];
    this.count = 0; // lights packed last frame
    this.cells = 0; // cell bits set last frame (the work the pixels will do)
  }

  add(light) { if (!this.sources.includes(light)) this.sources.push(light); return light; }
  remove(light) { const i = this.sources.indexOf(light); if (i >= 0) this.sources.splice(i, 1); }

  // Pack this frame's lights in the camera's view space and cut them into the
  // cells: call once a frame, after the camera has moved, before the scene draws.
  update(camera, width, height) {
    camera.updateMatrixWorld();
    const V = camera.matrixWorldInverse.elements, P = camera.projectionMatrix.elements;
    const P00 = P[0], P11 = P[5];
    maskData.fill(0);
    let n = 0, cells = 0;
    const src = this.sources;
    for (let s = 0; s < src.length && n < MAX_LIGHTS; s++) {
      const L = src[s];
      const r = L.distance;
      if (!(L.intensity > 0) || !(r > 0) || L.visible === false) continue;
      const p = L.position;
      const x = V[0] * p.x + V[4] * p.y + V[8] * p.z + V[12];
      const y = V[1] * p.x + V[5] * p.y + V[9] * p.z + V[13];
      const z = V[2] * p.x + V[6] * p.y + V[10] * p.z + V[14];
      const d = -z; // depth in front of the eye
      if (d + r <= 0 || d - r > Z_FAR * 4) continue;
      const set = this._assign(n, x, y, d, r, P00, P11);
      if (!set) continue; // nothing in view: the slot is taken by the next
      cells += set;
      const o = n * 8, c = L.color, I = L.intensity;
      lightData[o] = x; lightData[o + 1] = y; lightData[o + 2] = z; lightData[o + 3] = r;
      lightData[o + 4] = c.r * I; lightData[o + 5] = c.g * I; lightData[o + 6] = c.b * I; lightData[o + 7] = L.decay;
      n++;
    }
    this.count = n;
    this.cells = cells;
    grid.x = GX / width; grid.y = GY / height;
    info.x = 1; info.y = Math.ceil(n / 32);
    tex.needsUpdate = true;
  }

  // Set light i's bit in every cell its sphere (view-space centre x, y, depth
  // d, radius r) reaches. Per depth slice, the sphere's widest cross-section in
  // that slab is projected at the slab's near and far depths (x / depth is
  // monotonic in depth, so those bound it). Returns the cells set.
  _assign(i, x, y, d, r, P00, P11) {
    const word = i >> 5, bit = 1 << (i & 31);
    const k0 = sliceOf(d - r), k1 = sliceOf(d + r);
    let set = 0;
    for (let k = k0; k <= k1; k++) {
      const z0 = SLICE_Z[k], z1 = SLICE_Z[k + 1];
      const dz = d < z0 ? z0 - d : d > z1 ? d - z1 : 0;
      if (dz >= r) continue;
      const rr = Math.sqrt(r * r - dz * dz);
      const a = Math.max(z0, d - r, 1e-3), b = Math.min(z1, d + r);
      if (b < a) continue;
      const x0 = x - rr, x1 = x + rr, y0 = y - rr, y1 = y + rr;
      const nx0 = P00 * Math.min(x0 / a, x0 / b), nx1 = P00 * Math.max(x1 / a, x1 / b);
      const ny0 = P11 * Math.min(y0 / a, y0 / b), ny1 = P11 * Math.max(y1 / a, y1 / b);
      if (nx1 < -1 || nx0 > 1 || ny1 < -1 || ny0 > 1) continue;
      const tx0 = Math.max(0, Math.floor((nx0 * 0.5 + 0.5) * GX)), tx1 = Math.min(GX - 1, Math.floor((nx1 * 0.5 + 0.5) * GX));
      const ty0 = Math.max(0, Math.floor((ny0 * 0.5 + 0.5) * GY)), ty1 = Math.min(GY - 1, Math.floor((ny1 * 0.5 + 0.5) * GY));
      for (let ty = ty0; ty <= ty1; ty++) {
        let c = ((k * GY + ty) * GX + tx0) * 4 + word;
        for (let tx = tx0; tx <= tx1; tx++, c += 4) maskData[c] |= bit;
        set += tx1 - tx0 + 1;
      }
    }
    return set;
  }
}
