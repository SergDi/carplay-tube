// Spatial navigation for the CarPlay knob: arrows move focus to the nearest
// control in that direction; Tab/Shift+Tab keep the browser's own order.

export const DIRECTIONS = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

// Overlap of two rects on the axis across the movement (e.g. columns when moving down).
function crossOverlap(a, b, horizontal) {
  const [a1, a2, b1, b2] = horizontal
    ? [a.top, a.top + a.height, b.top, b.top + b.height]
    : [a.left, a.left + a.width, b.left, b.left + b.width];
  return Math.min(a2, b2) - Math.max(a1, b1);
}

// rects: [{left, top, width, height}]; returns the index of the best target or -1.
// Targets lined up with the current control (sharing its row or column) win over
// closer ones off to the side, so Down from a card goes to the card below, not the rail.
export function pickNext(from, rects, dir) {
  const a = center(from);
  const horizontal = dir === 'left' || dir === 'right';
  let best = -1;
  let bestScore = Infinity;
  rects.forEach((r, i) => {
    const b = center(r);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const along = horizontal ? (dir === 'right' ? dx : -dx) : dir === 'down' ? dy : -dy;
    const edge = horizontal ? from.width / 2 : from.height / 2;
    if (along <= edge * 0.5) return;
    const across = Math.abs(horizontal ? dy : dx);
    const inBeam = crossOverlap(from, r, horizontal) > 0;
    const score = (inBeam ? 0 : 1e6) + along + across * (inBeam ? 0.5 : 2.5);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

export function focusables(root) {
  return [...root.querySelectorAll('button, input, textarea, summary, [tabindex="0"]')].filter(
    (el) => !el.disabled && !el.closest('[hidden], [inert]') && el.getClientRects().length,
  );
}

export function moveFocus(root, dir) {
  const items = focusables(root);
  const current = document.activeElement;
  if (!items.includes(current)) {
    items[0]?.focus();
    return true;
  }
  const others = items.filter((el) => el !== current);
  const index = pickNext(
    current.getBoundingClientRect(),
    others.map((el) => el.getBoundingClientRect()),
    dir,
  );
  if (index < 0) return false;
  others[index].focus();
  return true;
}
