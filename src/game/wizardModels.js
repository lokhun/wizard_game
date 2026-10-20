// Wizard character models: first-person viewmodels and third-person avatars
// for all 13 classes, built procedurally from three.js primitives.
//
//   createViewModel(classId, { factory }) -> { root, muzzle, offhand, light, update(dt, s), setPower(k), dispose() }
//   createAvatar(classId, { factory })    -> { root, muzzle, height, update(dt, s), flash(a), setTint(hex, k), dispose() }
//
// See models/wizard/viewmodel.js and models/wizard/avatar.js for details.
export { createViewModel } from './models/wizard/viewmodel.js';
export { createAvatar } from './models/wizard/avatar.js';
