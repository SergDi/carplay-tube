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

// Mirror APTV's selection into real focus: our focus look replaces its red ring,
// and everything that listens to focus (scrolling, loading more, the player's
// controls) follows the knob.
new MutationObserver((records) => {
  for (const r of records) {
    const el = r.target;
    if (!(el instanceof HTMLElement) || !APTV_RING.test(el.getAttribute('style') ?? '')) continue;
    if (!root.classList.contains('aptv')) enterAptvMode();
    el.style.removeProperty('outline');
    el.style.removeProperty('outline-offset');
    if (document.activeElement !== el) el.focus();
  }
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'] });
