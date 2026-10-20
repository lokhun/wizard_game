import * as THREE from 'three';

// Bridges procedural model modules (enemy models, wizard models) to the game,
// with simple placeholders if a type is missing so the game never breaks.

let enemyMod = null;
let wizardMod = null;
export function setModelModules({ enemy, wizard }) {
  if (enemy) enemyMod = enemy;
  if (wizard) wizardMod = wizard;
}
// edge light on enemies for the current realm (see models/core.js RIM)
export function setEnemyRim(color, k) { enemyMod?.setEnemyRim?.(color, k); }

const phGeo = new THREE.CapsuleGeometry(0.4, 1.0, 4, 8);
phGeo.translate(0, 0.9, 0);
function placeholder(color = 0x884444, h = 1.8) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, emissive: 0x000000 });
  const root = new THREE.Group();
  const body = new THREE.Mesh(phGeo, mat);
  body.scale.setScalar(h / 1.8);
  root.add(body);
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.2) });
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), eyeMat);
    e.position.set(s * 0.13, h * 0.85, 0.33);
    root.add(e);
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.3, h * 0.7, 0.5);
  root.add(muzzle);
  let flash = 0;
  return {
    root, height: h, radius: 0.45, flying: false, muzzle, eyeColor: 0xff3020,
    update(dt, s) {
      flash = Math.max(0, flash - dt * 6);
      mat.emissive.setRGB(flash, flash, flash);
      body.rotation.x = s.anim === 'windup' ? -0.3 * s.progress : s.anim === 'attack' ? 0.4 : 0;
      if (s.anim === 'death') { body.rotation.x = -Math.PI / 2 * s.progress; body.position.y = -0.5 * s.progress; }
      if (s.anim === 'spawn') body.scale.setScalar((h / 1.8) * Math.max(0.05, s.progress));
      else body.scale.setScalar(h / 1.8);
    },
    flash(a) { flash = Math.max(flash, a); },
    setTint(hex, k) { mat.color.set(hex ? new THREE.Color(color).lerp(new THREE.Color(hex), k) : color); },
    dispose() { mat.dispose(); },
  };
}

export function getEnemyModel(type, game) {
  if (enemyMod) {
    try {
      const m = enemyMod.createEnemyModel(type, { factory: game.texFactory });
      if (m) return m;
    } catch (e) {
      console.warn('enemy model failed', type, e);
    }
  }
  return placeholder(0x6a4a40, 1.8);
}

export function getViewModel(classId, game) {
  if (wizardMod) {
    try { return wizardMod.createViewModel(classId, { factory: game.texFactory }); } catch (e) { console.warn('viewmodel failed', e); }
  }
  // placeholder: a simple staff
  const root = new THREE.Group();
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0x4a3020 }));
  staff.position.set(0.28, -0.35, -0.55);
  staff.rotation.x = -0.4;
  root.add(staff);
  const tip = new THREE.Object3D();
  tip.position.set(0.28, -0.05, -0.75);
  root.add(tip);
  const off = new THREE.Object3D();
  off.position.set(-0.3, -0.3, -0.5);
  root.add(off);
  const light = new THREE.PointLight(0xffffff, 1, 2);
  root.add(light);
  return { root, muzzle: tip, offhand: off, light, update() {}, setPower() {}, dispose() {} };
}

export function getAvatar(classId, game) {
  if (wizardMod) {
    try { return wizardMod.createAvatar(classId, { factory: game.texFactory }); } catch (e) { console.warn('avatar failed', e); }
  }
  const p = placeholder(0x4060a0, 1.85);
  return p;
}

// Build model templates ahead of time (during floor load) to avoid spawn hitches.
export function preloadEnemies(types, game) {
  if (!enemyMod?.preloadEnemyModels) return;
  try { enemyMod.preloadEnemyModels(types, { factory: game.texFactory }); } catch (e) { console.warn('preload failed', e); }
}
