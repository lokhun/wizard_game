// Keyboard + mouse input with pointer lock.
export const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  dash: ['ShiftLeft', 'ShiftRight'],
  ability1: ['KeyQ'],
  ability2: ['KeyE'],
  ultimate: ['KeyR'],
  interact: ['KeyF'],
  ping: ['KeyG'],
  map: ['Tab', 'KeyM'],
  pause: ['Escape', 'KeyP'],
  scores: ['KeyC'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set(); // edge-triggered this frame
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, rightPressed: false };
    this.locked = false;
    this.sensitivity = 0.0022;
    this.invertY = false;
    this.enabled = true;
    this.onLockChange = null;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Tab') e.preventDefault();
      this.down.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => { this.down.clear(); this.mouse.left = this.mouse.right = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // clamp absurd spikes some browsers produce on lock
      const mx = Math.max(-300, Math.min(300, e.movementX));
      const my = Math.max(-300, Math.min(300, e.movementY));
      this.mouse.dx += mx;
      this.mouse.dy += my;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.mouse.left = this.mouse.right = false; }
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch { /* ignore */ } });
    } catch { /* ignore */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  is(action) { return KEYS[action].some((k) => this.down.has(k)); }
  was(action) { return KEYS[action].some((k) => this.pressed.has(k)); }

  // call at end of frame
  endFrame() {
    this.pressed.clear();
    this.mouse.dx = 0; this.mouse.dy = 0;
    this.mouse.leftPressed = false; this.mouse.rightPressed = false;
  }
}
