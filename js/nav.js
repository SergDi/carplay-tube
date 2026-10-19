// Spatial navigation for the CarPlay knob: arrows move focus to the nearest
// control in that direction; Tab/Shift+Tab keep the browser's own order.

export const DIRECTIONS = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

// rects: [{left, top, width, height}]; returns the index of the best target or -1.
export function pickNext(from, rects, dir) {
  const a = center(from);
  let best = -1;
  let bestScore = Infinity;
  rects.forEach((r, i) => {
    const b = center(r);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const horizontal = dir === 'left' || dir === 'right';
    const along = horizontal ? (dir === 'right' ? dx : -dx) : dir === 'down' ? dy : -dy;
    // Must lie ahead, past the current control's own edge.
    const edge = horizontal ? from.width / 2 : from.height / 2;
    if (along <= edge * 0.5) return;
    const across = Math.abs(horizontal ? dy : dx);
    const score = along + across * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

export function focusables(root) {
  return [...root.querySelectorAll('button, input, textarea, [tabindex="0"]')].filter(
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
