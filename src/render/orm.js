import * as THREE from 'three';

// ---------------------------------------------------------------------------
// One ORM read per pixel.
//
// Every generated surface packs occlusion, roughness and metalness into one
// texture (R, G, B) and hands it to MeshStandardMaterial as aoMap,
// roughnessMap and metalnessMap. three.js samples each map on its own, through
// its own uv varying, so the compiler can't tell the three reads are one:
// three anisotropic samples of the same texel at every lit pixel. A standard
// material whose three maps are the same texture now gets ORM_SHARED, and the
// metalness and occlusion chunks reuse the roughness read. Same texel, same
// image; measured, the opaque pass ~16% lighter (SwiftShader, a frozen fight).
//
// The define is derived, not set by hand: MeshStandardMaterial.copy() resets
// `defines`, and the wizards are built from clones. `defines` is an accessor
// on the prototype that adds or drops ORM_SHARED from the material's maps
// whenever three reads it (when it builds a program: a map change already
// needs material.needsUpdate). Imported by the renderer before any material
// exists (an instance made earlier would keep a plain `defines`).
// ---------------------------------------------------------------------------

function patch(name, from, to) {
  const src = THREE.ShaderChunk[name];
  if (!src.includes(from)) throw new Error(`ORM patch: ${name} has changed (three.js upgrade?)`);
  THREE.ShaderChunk[name] = src.replace(from, to);
}
patch('metalnessmap_fragment', 'vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );', `#ifdef ORM_SHARED
	vec4 texelMetalness = texelRoughness;
	#else
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	#endif`);
patch('aomap_fragment', 'float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;', `#ifdef ORM_SHARED
	float ambientOcclusion = ( texelRoughness.r - 1.0 ) * aoMapIntensity + 1.0;
	#else
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	#endif`);

const ormShared = (m) => !!m.roughnessMap && m.roughnessMap === m.metalnessMap && m.roughnessMap === m.aoMap;

Object.defineProperty(THREE.MeshStandardMaterial.prototype, 'defines', {
  configurable: true,
  get() {
    const d = this._defines;
    if (!d) return d;
    // (in place: code adds its own defines to the object it reads back)
    if (ormShared(this)) { if (!('ORM_SHARED' in d)) d.ORM_SHARED = ''; } else if ('ORM_SHARED' in d) delete d.ORM_SHARED;
    return d;
  },
  set(v) { this._defines = v; },
});
