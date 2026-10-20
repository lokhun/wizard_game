// Developer test scene: builds a floor and positions the camera for screenshots.
import * as THREE from 'three';
import { Renderer } from './render/renderer.js';
import { TextureFactory } from './render/textures.js';
import { LightPool } from './render/lights.js';
import { Particles } from './render/particles.js';
import { generateLevel } from './world/levelgen.js';
import { buildLevel } from './world/builder.js';

export async function devScene() {
  const params = new URLSearchParams(location.search);
  const floor = +(params.get('floor') ?? 0);
  const seed = +(params.get('seed') ?? 1234);
  const R = new Renderer(document.getElementById('game'), params.get('q') ?? 'high');
  const tex = new TextureFactory(R.renderer);
  const lights = new LightPool(R.scene);
  const particles = new Particles(R.scene);
  const level = generateLevel(seed, floor);
  const built = buildLevel(level, tex, lights);
  R.scene.add(built.group);
  const b = level.biome;
  R.scene.fog = new THREE.FogExp2(b.fog.color, b.fog.density);
  R.scene.background = new THREE.Color(b.fog.color);
  particles.setFog(b.fog.density, b.fog.color);
  R.scene.add(new THREE.HemisphereLight(b.ambient.sky, b.ambient.ground, b.ambient.intensity * 3));
  if (b.moon) {
    const m = new THREE.DirectionalLight(b.moon.color, b.moon.intensity);
    m.position.set(30, 60, -80);
    R.scene.add(m);
  }
  R.setGrade(b.grade);
  const room = level.rooms[+(params.get('room') ?? 1)];
  const cam = R.camera;
  const yaw = +(params.get('yaw') ?? 0);
  cam.position.set(room.cx + (+(params.get('dx') ?? 0)), 1.7 + level.floorAt(room.cx, room.cz), room.cz + (room.h * 2) / 2 - 2 + (+(params.get('dz') ?? 0)));
  cam.rotation.set(+(params.get('pitch') ?? 0.05), yaw, 0, 'YXZ');
  window.__level = level;
  let t = 0;
  const flameTick = () => {
    for (const f of built.flames) {
      const dx = f.x - cam.position.x, dz = f.z - cam.position.z;
      if (dx * dx + dz * dz > 900) continue;
      for (let k = 0; k < 2; k++) {
        particles.glow({ x: f.x + (Math.random() - 0.5) * 0.1 * f.size, y: f.y, z: f.z + (Math.random() - 0.5) * 0.1 * f.size,
          vx: (Math.random() - 0.5) * 0.2, vy: 0.9 * f.size + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.2,
          r: 4, g: 1.6, b: 0.4, r2: 1.5, g2: 0.2, b2: 0.05, life: 0.5 + Math.random() * 0.3, size: 0.28 * f.size, size2: 0.05, sprite: 3, rot: 0, drag: 1 });
      }
    }
  };
  for (let i = 0; i < 60; i++) { t += 1 / 60; flameTick(); particles.update(t); lights.update(1 / 60, t, cam.position); built.update(1 / 60, t); }
  const loop = () => {
    t += 1 / 60;
    flameTick();
    particles.update(t);
    lights.update(1 / 60, t, cam.position);
    built.update(1 / 60, t);
    R.render(t);
    window.__frames = (window.__frames || 0) + 1;
    requestAnimationFrame(loop);
  };
  loop();
  console.log('rooms', level.rooms.length, 'torches', level.torches.length, 'calls', R.renderer.info.render.calls, 'tris', R.renderer.info.render.triangles);
}
