// Knob diagnostics: records everything the page receives from the car, so one
// look at Settings → «Проверка шайбы» shows how APTV passes the controller on.

const MAX = 12;
const log = [];
let view = null;
let started = performance.now();

const time = () => ((performance.now() - started) / 1000).toFixed(1).padStart(5, ' ');

const label = (el) => {
  if (!el || el === document.body) return 'страница';
  const text = (el.getAttribute?.('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ');
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
};

const mods = (e) => ['shift', 'alt', 'ctrl', 'meta'].filter((m) => e[`${m}Key`]).map((m) => `${m[0].toUpperCase()}${m.slice(1)}+`).join('');

function add(line) {
  log.unshift(`${time()}  ${line}`);
  log.length = Math.min(log.length, MAX);
  if (view?.isConnected) view.textContent = log.join('\n');
}

// Key events reach this before the app handles them (capture on window).
let lastKey = 0;
window.addEventListener('keydown', (e) => {
  lastKey = performance.now();
  add(`клавиша ${mods(e)}${e.key} · code ${e.code || '—'} · ${e.keyCode}${e.repeat ? ' · повтор' : ''}`);
}, true);

window.addEventListener('wheel', (e) => {
  add(`колесо dx ${Math.round(e.deltaX)} dy ${Math.round(e.deltaY)} · режим ${e.deltaMode}`);
}, { capture: true, passive: true });

for (const type of ['pointerdown', 'pointerup']) {
  window.addEventListener(type, (e) => add(`${type === 'pointerdown' ? 'касание' : 'отпускание'} ${e.pointerType || '?'} · ${Math.round(e.clientX)},${Math.round(e.clientY)}`), true);
}

window.addEventListener('touchmove', (e) => {
  const t = e.touches[0];
  if (t) add(`движение пальца · ${Math.round(t.clientX)},${Math.round(t.clientY)}`);
}, { capture: true, passive: true });

// Focus that moved without a key from us is APTV's own focus engine at work.
document.addEventListener('focusin', (e) => {
  if (performance.now() - lastKey > 300) add(`фокус без клавиши → ${label(e.target)}`);
}, true);

document.addEventListener('visibilitychange', () => add(`страница ${document.visibilityState === 'visible' ? 'видна' : 'скрыта'}`));
window.addEventListener('gamepadconnected', (e) => add(`геймпад: ${e.gamepad.id}`));

export function probeView() {
  view = document.createElement('pre');
  view.id = 'key-probe';
  view.className = 'probe';
  view.tabIndex = 0;
  view.dataset.key = 'probe';
  view.textContent = log.length ? log.join('\n') : 'Покрути, наклони и нажми шайбу, нажми BACK, проведи по тачпаду — здесь появится всё, что получил сайт.';
  return view;
}

export function clearProbe() {
  log.length = 0;
  started = performance.now();
  if (view) view.textContent = 'Журнал очищен.';
}
