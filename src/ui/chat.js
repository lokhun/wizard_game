// ---------------------------------------------------------------------------
// Party chat. Enter opens a line to type in (in a party: the lobby and runs),
// Enter sends it, Enter on an empty line or Escape closes it. Lines fade a few
// seconds after they arrive; opening the chat shows the recent history again.
// Text is only ever set as textContent (a teammate can't inject markup) and
// each sender is held to a few lines a second.
// ---------------------------------------------------------------------------

const MAX_LEN = 160;
const MAX_LINES = 40;
const FADE_AFTER = 9; // seconds a line stays up while the chat is closed

export class Chat {
  constructor(root, input) {
    this.input = input;
    this.onSend = null; // (text) => void
    this.active = false; // only in a party
    this.lines = [];
    this.rate = new Map(); // sender -> recent send times
    const el = (this.el = document.createElement('div'));
    el.className = 'chat hidden';
    el.innerHTML = `<div class="chat-log"></div><input class="chat-in hidden" maxlength="${MAX_LEN}" placeholder="Say something to the party… (Enter to send)" spellcheck="false" autocomplete="off">`;
    root.appendChild(el);
    this.log = el.querySelector('.chat-log');
    this.box = el.querySelector('.chat-in');
    this.box.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing never reaches the game's keys
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = this.box.value.trim().slice(0, MAX_LEN);
        this.box.value = '';
        if (text) this.onSend?.(text);
        this.close();
      } else if (e.key === 'Escape') this.close();
    });
    this.box.addEventListener('keyup', (e) => e.stopPropagation());
    this.box.addEventListener('blur', () => this.close());
    setInterval(() => this._fade(), 500);
  }

  get open() { return !this.box.classList.contains('hidden'); }

  setActive(on) {
    this.active = !!on;
    this.el.classList.toggle('hidden', !this.active);
    if (!this.active) { this.close(); this.lines = []; this.log.textContent = ''; }
  }

  show() {
    if (!this.active || this.open) return;
    this.input.down.clear(); // let go of any held movement key
    this.box.classList.remove('hidden');
    this.el.classList.add('typing');
    this.box.focus({ preventScroll: true });
    for (const l of this.lines) l.el.classList.remove('gone');
  }

  close() {
    if (!this.open) return;
    this.box.classList.add('hidden');
    this.el.classList.remove('typing');
    this.box.blur();
    this._fade();
  }

  // a line from `name` (mine: my own); false if the sender is talking too fast
  add(name, text, { mine = false, from = name, color } = {}) {
    text = String(text ?? '').trim().slice(0, MAX_LEN);
    if (!text) return false;
    const now = performance.now() / 1000;
    const recent = (this.rate.get(from) ?? []).filter((t) => now - t < 4);
    if (recent.length >= 5) return false;
    recent.push(now); this.rate.set(from, recent);
    const row = document.createElement('div');
    row.className = 'chat-line' + (mine ? ' mine' : '');
    const who = document.createElement('b');
    who.textContent = String(name ?? 'Wizard').slice(0, 16) + ':';
    if (color) who.style.color = color;
    const what = document.createElement('span');
    what.textContent = ' ' + text;
    row.append(who, what);
    this.log.appendChild(row);
    this.lines.push({ el: row, t: now });
    while (this.lines.length > MAX_LINES) this.lines.shift().el.remove();
    this.log.scrollTop = this.log.scrollHeight;
    return true;
  }

  _fade() {
    const now = performance.now() / 1000;
    for (const l of this.lines) l.el.classList.toggle('gone', !this.open && now - l.t > FADE_AFTER);
  }
}
