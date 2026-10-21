// ---------------------------------------------------------------------------
// Compile-time fixes for three's built-in shaders, applied as their source is
// handed to WebGL.
//
// On Windows ANGLE compiles through D3D's FXC, which unrolls every loop whose
// trip count it can work out. three's PMREM shaders (environment maps: the
// GGX prefilter with 256 samples, the 20-tap blur) then took seconds each to
// compile at startup. Adding min(<uniform that is never negative>, 0.) - i.e.
// 0 - to the bound keeps the result identical but hides the count from FXC,
// which emits a real loop instead.
// ---------------------------------------------------------------------------

const FIXES = [
  ['for(uint i = 0u; i < uint(GGX_SAMPLES); i++) {', 'for(uint i = 0u; i < uint(GGX_SAMPLES) + uint(min(roughness, 0.0)); i++) {'],
  ['for ( int i = 0; i < SAMPLES; i ++ ) {', 'for ( int i = 0; i < SAMPLES + int(min(sigma, 0.0)); i ++ ) {'],
];

export function installShaderFixes(gl) {
  const source = gl.shaderSource.bind(gl);
  gl.shaderSource = (shader, code) => {
    for (const [from, to] of FIXES) if (code.includes(from)) code = code.replace(from, to);
    source(shader, code);
  };
}
