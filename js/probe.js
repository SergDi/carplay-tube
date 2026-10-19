// Knob diagnostics: records everything the page receives from the car and
// everything APTV does to the page from outside (its knob focus runs as
// injected script), so one session in the car shows how to drive the site.

const MAX = 40;
const log = [];
let view = null;
let started = performance.now();

const time = () => ((performance.now() - started) / 1000).toFixed(1).padStart(5, ' ');

const label = (el) => {
  if (!el || el === document.body) return 'страница';
  if (el === document.documentElement) return 'html';
  const text = (el.getAttribute?.('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ');
  const tag = `${el.tagName?.toLowerCase() ?? '?'}${el.id ? `#${el.id}` : ''}${el.classList?.length ? `.${[...el.classList].join('.')}` : ''}`;
  return text ? `${tag} «${text.length > 22 ? `${text.slice(0, 22)}…` : text}»` : tag;
};

const mods = (e) => ['shift', 'alt', 'ctrl', 'meta'].filter((m) => e[`${m}Key`]).map((m) => `${m[0].toUpperCase()}${m.slice(1)}+`).join('');

// Measuring repeats on every knob step; keep one line per burst.
let lastLine = '';

let onChange = () => {};

function add(line) {
  if (line === lastLine) return;
  lastLine = line;
  log.unshift(`${time()}  ${line}`);
  log.length = Math.min(log.length, MAX);
  if (view?.isConnected) view.textContent = log.join('\n');
  onChange();
}

// Calls fn a few seconds after the journal stops changing.
export function onProbeSettled(fn, delay = 4000) {
  let timer = 0;
  onChange = () => {
    clearTimeout(timer);
    timer = setTimeout(fn, delay);
  };
}

export const probeLog = () => [...log];

// ---------- input events ----------

let lastInput = 0;
const input = () => (lastInput = performance.now());

window.addEventListener('keydown', (e) => {
  input();
  add(`клавиша ${mods(e)}${e.key} · code ${e.code || '—'} · ${e.keyCode}${e.repeat ? ' · повтор' : ''}${e.isTrusted ? '' : ' · из скрипта'}`);
}, true);

window.addEventListener('wheel', (e) => {
  add(`колесо dx ${Math.round(e.deltaX)} dy ${Math.round(e.deltaY)} · режим ${e.deltaMode}`);
}, { capture: true, passive: true });

for (const type of ['pointerdown', 'pointerup', 'mousedown', 'touchstart']) {
  window.addEventListener(type, (e) => {
    input();
    const p = e.touches?.[0] ?? e;
    add(`${type}${e.pointerType ? ` ${e.pointerType}` : ''} · ${Math.round(p.clientX)},${Math.round(p.clientY)} → ${label(e.target)}${e.isTrusted ? '' : ' · из скрипта'}`);
  }, { capture: true, passive: true });
}

window.addEventListener('click', (e) => {
  add(`click → ${label(e.target)} · ${e.isTrusted ? 'настоящий' : 'из скрипта'}${e.detail ? '' : ' · без касания'}`);
}, true);

document.addEventListener('focusin', (e) => {
  if (performance.now() - lastInput > 300) add(`фокус → ${label(e.target)}`);
}, true);

window.addEventListener('scroll', () => add(`прокрутка окна → ${Math.round(scrollX)},${Math.round(scrollY)}`), { passive: true });
document.addEventListener('visibilitychange', () => add(`страница ${document.visibilityState === 'visible' ? 'видна' : 'скрыта'}`));
window.addEventListener('pagehide', () => add('pagehide'));
window.addEventListener('blur', () => add('окно потеряло фокус'));
window.addEventListener('focus', () => add('окно получило фокус'));
window.addEventListener('popstate', () => add('назад в истории (popstate)'));
window.addEventListener('gamepadconnected', (e) => add(`геймпад: ${e.gamepad.id}`));

// ---------- calls made from outside our scripts ----------

// Our scripts and YouTube's player API run from URLs; script that APTV injects
// has none in its stack.
const ours = () => /https?:\/\//.test(new Error().stack?.split('\n').slice(2).join('\n') ?? '');

function spy(proto, name, describe) {
  const original = proto[name];
  if (typeof original !== 'function') return;
  proto[name] = function (...args) {
    if (!ours()) add(`снаружи: ${describe(this, args)}`);
    return original.apply(this, args);
  };
}

spy(HTMLElement.prototype, 'click', (el) => `click() → ${label(el)}`);
spy(HTMLElement.prototype, 'focus', (el) => `focus() → ${label(el)}`);
spy(HTMLElement.prototype, 'blur', (el) => `blur() → ${label(el)}`);
spy(Element.prototype, 'scrollIntoView', (el) => `scrollIntoView() → ${label(el)}`);
spy(Element.prototype, 'getBoundingClientRect', (el) => `замер → ${label(el)}`);
spy(EventTarget.prototype, 'dispatchEvent', (el, [ev]) => `dispatchEvent ${ev?.type} → ${label(el)}`);
spy(Document.prototype, 'querySelectorAll', (d, [sel]) => `querySelectorAll("${String(sel).slice(0, 60)}")`);
spy(Document.prototype, 'elementFromPoint', (d, [x, y]) => `elementFromPoint(${Math.round(x)},${Math.round(y)})`);

// ---------- what APTV changes in the page ----------

const OURS = new Set(['content', 'chips', 'player', 'toast', 'search-bar', 'rail', 'key-probe', 'p-time', 'p-bar', 'p-status', 'p-play']);
const insideOurs = (node) => {
  for (let n = node; n; n = n.parentElement) if (OURS.has(n.id)) return true;
  return false;
};

// Attributes our own code changes; anything else changing is APTV (or YouTube).
const OUR_ATTRS = new Set(['class', 'aria-current', 'aria-pressed', 'aria-label', 'title', 'value', 'data-named', 'data-tab', 'data-state', 'hidden', 'inert']);
const fromYouTube = (n) => /youtube|ytimg/.test(n.src ?? '') || /^www-widgetapi/.test(n.id ?? '');

new MutationObserver((records) => {
  for (const r of records) {
    if (r.type === 'childList') {
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1 || insideOurs(r.target) || fromYouTube(n)) continue;
        add(`добавлен ${label(n)} в ${label(r.target)}${n.tagName === 'STYLE' ? `: ${n.textContent.slice(0, 80)}` : ''}`);
      }
    } else if (r.type === 'attributes' && !OUR_ATTRS.has(r.attributeName)) {
      const t = r.target;
      // Inside our screens only controls matter (their look is what the knob shows).
      if (insideOurs(t) && !t.matches?.('button, .card, input')) continue;
      add(`атрибут ${r.attributeName} у ${label(t)} = ${String(t.getAttribute(r.attributeName)).slice(0, 60)}`);
    }
  }
}).observe(document.documentElement, { subtree: true, childList: true, attributes: true });

// Globals that appear after load are someone else's.
const known = new Set(Object.getOwnPropertyNames(window));
setInterval(() => {
  for (const name of Object.getOwnPropertyNames(window)) {
    if (known.has(name)) continue;
    known.add(name);
    if (!/^(YT|onYouTube|onYT|ytcfg|yt|__yt|webkit|ttPolicy|scriptUrl)/i.test(name)) add(`новая глобальная переменная: ${name}`);
  }
}, 2000);

// ---------- view ----------

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
  lastLine = '';
  started = performance.now();
  if (view) view.textContent = 'Журнал очищен.';
}
