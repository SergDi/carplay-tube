// APTV on CarPlay: its browser loads pages in desktop mode (Mac Safari user
// agent, a 1280px-wide layout shrunk onto an 800px car screen) and drives the
// knob from injected script — it writes an inline red outline on the element it
// selects and calls click() on it. No key or focus event reaches the page.

import { focusables, pickNext } from './nav.js?v=c686003-mvfyngzc';
import { probeNote } from './probe.js?v=c686003-mvfyngzc';

const root = document.documentElement;

const SEEN = 'carplay_tube_aptv';
const seenBefore = () => {
  try {
    return localStorage.getItem(SEEN) === '1';
  } catch {
    return false;
  }
};

// iOS pretending to be a Mac (desktop mode) still reports touch points; a real
// Mac does not. Once APTV's knob ring has been seen in this browser, that is
// remembered too, in case the touch points are hidden.
export let iosDesktopMode = /Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints > 0 || seenBefore());

// Lay the page out as if the screen were ~820px wide, the size of a car display.
// Measured once: in WebKit the zoom itself changes innerWidth, so reacting to
// resize would undo it (and the car screen does not rotate).
// Only the interface is zoomed (--ui-zoom in styles.css): zooming the page
// would zoom the YouTube iframe too, and WebKit then shows a corner of the video.
function fitWidth() {
  if (root.style.getPropertyValue('--ui-zoom')) return;
  if (innerWidth > 900) root.style.setProperty('--ui-zoom', String(innerWidth / 820));
}

function enterAptvMode() {
  iosDesktopMode = true;
  root.classList.add('aptv');
  fitWidth();
  startSensors();
  try {
    localStorage.setItem(SEEN, '1');
  } catch {
    // Storage blocked: detection by touch points still works on the next load.
  }
}


// APTV's knob highlight: `outline: 3px solid rgb(255, 64, 98) !important`.
const APTV_RING = /rgb\(255,\s*64,\s*98\)/;

// APTV's own nudge picks the nearest candidate by straight-line distance, which
// jumps between rows on a grid of big cards. So in APTV the site drives the
// cursor itself: every real control is hidden from APTV's scan (aria-hidden,
// see knob-test.html) and only five transparent sensors are left. The centre
// one covers the selected control, so APTV's red ring outlines it; one sensor
// sits beyond each edge. A nudge rings the sensor on that side: the site moves
// its focus that way (nav.js) and lays the sensors out around the new control.
// A press clicks the centre: the site presses the selected control. Where
// nothing lies in a direction its sensor is hidden, so the nudge leaves the
// page (to the CarPlay dock, APTV's toolbar). See sensor-test.html.
const GAP = 34;
const sensors = [];
const role = new Map();
let center = null;
let laying = 0;
let viewportBox = null;

const player = () => document.getElementById('player');
const playerOpen = () => !player().hidden;
const controlsHidden = () => playerOpen() && !player().classList.contains('show');
const scope = () => (playerOpen() ? player() : document.getElementById('app'));

function selected() {
  // Controls hidden: the video itself is selected; any nudge brings them back.
  if (controlsHidden()) {
    const shield = document.getElementById('p-shield');
    if (document.activeElement !== shield) shield.focus({ preventScroll: true });
    return shield;
  }
  const items = focusables(scope());
  if (items.includes(document.activeElement)) return document.activeElement;
  const first = scope().querySelector('[aria-current="page"]') ?? items[0];
  first?.focus({ preventScroll: true });
  return first ?? null;
}

// Regions of the screen: a move stays inside the current one when it can, so
// «up» from a card scrolled under the top bar finds the card above it, not the bar.
const ZONES = ['#content', '#search-bar', '#top', '#player'];
const zoneOf = (el) => ZONES.find((z) => el.closest(z)) ?? null;

function neighbour(el, dir) {
  const others = focusables(scope()).filter((x) => x !== el);
  const pick = (list) => {
    const i = pickNext(el.getBoundingClientRect(), list.map((x) => x.getBoundingClientRect()), dir);
    return i < 0 ? null : list[i];
  };
  const zone = zoneOf(el);
  return (zone && pick(others.filter((x) => zoneOf(x) === zone))) || pick(others);
}

const label = (el) => (el?.getAttribute('aria-label') || el?.textContent || '—').trim().replace(/\s+/g, ' ').slice(0, 28);
const NAMES = { up: 'вверх', down: 'вниз', left: 'влево', right: 'вправо' };

// Our controls stay clickable by touch but drop out of APTV's knob scan.
function hideControls() {
  for (const el of document.querySelectorAll('button, input, textarea, a[href], summary, [tabindex], [role="button"]')) {
    if (!el.closest('.knob-sensor') && el.getAttribute('aria-hidden') !== 'true') el.setAttribute('aria-hidden', 'true');
  }
}

const place = (s, x, y, w, h) => {
  // The sensor's wrapper carries the position: APTV rewrites the button's own style.
  s.parentElement.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
};

function layout() {
  cancelAnimationFrame(laying);
  laying = requestAnimationFrame(() => {
    hideControls();
    const el = selected();
    if (!el) return;
    const r = el.getBoundingClientRect();
    place(center, r.left - 5, r.top - 5, r.width + 10, r.height + 10);
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // Off-screen sensors are not candidates for APTV: keep them on screen, and for
    // a control as big as the screen (the video) put them inside its edges.
    // The screen in the same units as the rects (zoom makes innerWidth unreliable).
    const { width: W, height: H } = viewportBox.getBoundingClientRect();
    const clampX = (x) => Math.min(Math.max(x, 4), W - 28);
    const clampY = (y) => Math.min(Math.max(y, 4), H - 28);
    const spots = {
      up: [clampX(cx - 12), clampY(r.top - GAP - 12)],
      down: [clampX(cx - 12), clampY(r.bottom + GAP - 12)],
      left: [clampX(r.left - GAP - 12), clampY(cy - 12)],
      right: [clampX(r.right + GAP - 12), clampY(cy - 12)],
    };
    role.clear();
    const free = sensors.filter((s) => s !== center);
    Object.entries(spots).forEach(([dir, [x, y]], i) => {
      const s = free[i];
      role.set(s, dir);
      place(s, x, y, 24, 24);
      // Hidden controls of the player: any nudge just shows them.
      const open = controlsHidden() || Boolean(neighbour(el, dir));
      if (open) s.removeAttribute('aria-hidden');
      else s.setAttribute('aria-hidden', 'true');
    });
  });
}

function nudged(sensor) {
  if (sensor === center) return;
  const dir = role.get(sensor);
  center = sensor;
  if (controlsHidden()) {
    probeNote(`шайба: ${NAMES[dir]} → показать кнопки плеера`);
    document.getElementById('p-shield').click();
  } else {
    const from = selected();
    const to = neighbour(from, dir);
    probeNote(`шайба: ${NAMES[dir]} · ${label(from)} → ${to ? label(to) : 'край'}`);
    to?.focus();
  }
  layout();
}

function startSensors() {
  if (sensors.length) return;
  root.classList.add('knob-sensors');
  for (let i = 0; i < 5; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'knob-sensor';
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', 'Выбрать');
    // APTV presses the ringed sensor, which after layout is always the centre.
    b.addEventListener('click', () => {
      if (b !== center) return;
      probeNote(`шайба: нажатие → ${label(selected())}`);
      selected()?.click();
    });
    wrap.append(b);
    document.body.append(wrap);
    sensors.push(b);
  }
  center = sensors[0];
  viewportBox = document.createElement('div');
  viewportBox.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none';
  document.body.append(viewportBox);
  addEventListener('scroll', layout, { capture: true, passive: true });
  addEventListener('resize', layout);
  document.addEventListener('focusin', layout);
  new MutationObserver(layout).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  layout();
}

// APTV marks the sensor its nudge landed on with its ring.
new MutationObserver((records) => {
  for (const r of records) {
    const el = r.target;
    if (!(el instanceof HTMLElement) || !APTV_RING.test(el.getAttribute('style') ?? '')) continue;
    if (!root.classList.contains('aptv')) enterAptvMode();
    if (sensors.includes(el)) nudged(el);
  }
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'] });

// APTV's «Действия на странице» lists the page's buttons as a CarPlay list the
// knob can turn through, but names them by attribute only (else «BUTTON»).
// Give every button a name: its aria-label, or its visible text.
function nameButtons() {
  for (const b of document.querySelectorAll('button')) {
    // A label we derived from the text follows the text (Пуск ↔ Пауза).
    const own = b.hasAttribute('aria-label') && !b.dataset.named;
    const name = ((own ? b.getAttribute('aria-label') : b.textContent) || '').trim().replace(/\s+/g, ' ');
    if (!name || b.title === name) continue;
    b.title = name;
    b.value = name;
    if (!own) {
      b.setAttribute('aria-label', name);
      b.dataset.named = '1';
    }
  }
}

let naming = 0;
new MutationObserver(() => {
  cancelAnimationFrame(naming);
  naming = requestAnimationFrame(nameButtons);
}).observe(document.body, { subtree: true, childList: true, characterData: true });
nameButtons();

if (iosDesktopMode) enterAptvMode();
