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
const DEFAULT_KEYS = Object.fromEntries(Object.entries(KEYS).map(([a, ks]) => [a, [...ks]]));

// The actions a player may rebind (pause stays on Escape / P, the spells on the mouse buttons).
export const REBINDABLE = [
  ['forward', 'Move forward'], ['back', 'Move back'], ['left', 'Strafe left'], ['right', 'Strafe right'],
  ['jump', 'Jump'], ['dash', 'Dash'], ['ability1', 'Ability 1'], ['ability2', 'Ability 2'], ['ultimate', 'Ultimate'],
  ['interact', 'Interact / revive'], ['ping', 'Ping'], ['map', 'Map'], ['scores', 'Party scores'],
];
// overrides: { action: code } replaces the action's main key; its alternates (the
// arrow keys, right Shift...) stay unless another action now has them as its main key.
export function applyBindings(over) {
  for (const [a, ks] of Object.entries(DEFAULT_KEYS)) KEYS[a] = [...ks];
  for (const [a, code] of Object.entries(over ?? {})) {
    if (KEYS[a] && a !== 'pause' && typeof code === 'string' && /^[A-Za-z0-9]{1,24}$/.test(code) && code !== 'Escape') KEYS[a][0] = code;
  }
  const main = new Map(Object.entries(KEYS).map(([a, ks]) => [ks[0], a]));
  for (const [a, ks] of Object.entries(KEYS)) KEYS[a] = ks.filter((k, i) => i === 0 || !main.has(k) || main.get(k) === a);
}
const NAMED = { Space: 'Space', Tab: 'Tab', Enter: 'Enter', Backspace: 'Bksp', CapsLock: 'Caps', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Mouse1: 'MMB', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5' };
export function keyLabel(code) {
  if (!code) return '—';
  if (NAMED[code]) return NAMED[code];
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(.+)$/.exec(code))) return 'Num ' + m[1];
  if ((m = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code))) return (m[2] === 'Right' ? 'R ' : '') + (m[1] === 'Control' ? 'Ctrl' : m[1]);
  return code.replace(/^F(\d+)$/, 'F$1');
}
export const keyOf = (action) => keyLabel(KEYS[action]?.[0]);

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
      // the middle and side buttons act like keys, so they can be bound (Mouse1, Mouse3, Mouse4)
      if (e.button === 1 || e.button > 2) { this.down.add('Mouse' + e.button); this.pressed.add('Mouse' + e.button); e.preventDefault(); }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
      if (e.button === 1 || e.button > 2) this.down.delete('Mouse' + e.button);
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
