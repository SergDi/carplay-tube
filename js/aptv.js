// APTV on CarPlay: its browser loads pages in desktop mode (Mac Safari user
// agent, a 1280px-wide layout shrunk onto an 800px car screen) and drives the
// knob from injected script — it writes an inline red outline on the element it
// selects and calls click() on it. No key or focus event reaches the page.

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
function fitWidth() {
  root.style.zoom = iosDesktopMode && innerWidth > 900 ? String(innerWidth / 820) : '';
}

function enterAptvMode() {
  iosDesktopMode = true;
  root.classList.add('aptv');
  fitWidth();
  addEventListener('resize', fitWidth);
  try {
    localStorage.setItem(SEEN, '1');
  } catch {
    // Storage blocked: detection by touch points still works on the next load.
  }
}

if (iosDesktopMode) enterAptvMode();

// APTV's knob highlight: `outline: 3px solid rgb(255, 64, 98) !important`.
const APTV_RING = /rgb\(255,\s*64,\s*98\)/;

// APTV's nudge picks the nearest candidate in that direction by straight-line
// distance, so from the first row of big cards «right» lands on the filters
// above instead of the next card. It skips aria-hidden elements (knob-test.html),
// so while the ring is on a card the top bar is hidden from it — except, on the
// first row, the controls right above that card, which keeps «up» working.
const topBar = () => [...document.querySelectorAll('#top button')];
const overlapX = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0;

function shapeTopBar(ringed) {
  const bar = topBar();
  const card = ringed.closest('#content') ? ringed : null;
  if (!card) {
    bar.forEach((b) => b.removeAttribute('aria-hidden'));
    return;
  }
  const r = card.getBoundingClientRect();
  const cards = [...document.querySelectorAll('#content button')];
  const firstRow = !cards.some((c) => c !== card && c.getBoundingClientRect().bottom <= r.top + 1);
  let above = firstRow ? bar.filter((b) => overlapX(b.getBoundingClientRect(), r)) : [];
  if (firstRow && !above.length) {
    // Nothing straight above: keep the closest one so «up» still leads somewhere.
    const cx = r.left + r.width / 2;
    above = [bar.reduce((best, b) => {
      const d = Math.abs(b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2 - cx);
      return !best || d < best.d ? { b, d } : best;
    }, null)?.b].filter(Boolean);
  }
  bar.forEach((b) => (above.includes(b) ? b.removeAttribute('aria-hidden') : b.setAttribute('aria-hidden', 'true')));
}

// Mirror APTV's selection into real focus, so everything that listens to focus
// (scrolling, loading more, the player's controls) follows the knob. The ring
// itself stays: APTV presses only the element that carries it.
new MutationObserver((records) => {
  for (const r of records) {
    const el = r.target;
    if (!(el instanceof HTMLElement) || !APTV_RING.test(el.getAttribute('style') ?? '')) continue;
    if (!root.classList.contains('aptv')) enterAptvMode();
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    shapeTopBar(el);
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
