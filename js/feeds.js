// Shelf bookkeeping shared by the site and the worker (worker/src imports it).
// A shelf is {title, cards, next}; next is YouTube's token for more of that shelf.

export function dedupe(cards) {
  const seen = new Set();
  return cards.filter((c) => !seen.has(c.id) && seen.add(c.id));
}

// Shelves with the same title from later pages continue the earlier one.
export function mergeShelves(list, into = []) {
  const out = into.map((s) => ({ ...s, cards: [...s.cards] }));
  const byTitle = new Map(out.filter((s) => s.title).map((s) => [s.title, s]));
  for (const s of list) {
    const known = s.title && byTitle.get(s.title);
    if (known) {
      known.cards = dedupe([...known.cards, ...s.cards]);
      known.next = s.next ?? known.next ?? null;
    } else {
      const copy = { title: s.title, cards: dedupe(s.cards), next: s.next ?? null };
      out.push(copy);
      if (s.title) byTitle.set(s.title, copy);
    }
  }
  return out;
}

// Home: every shelf is a filter; «Все» mixes them in page order.
export function homeView(shelves, chip) {
  const index = chip === '' || chip == null ? -1 : Number(chip);
  const picked = shelves[index];
  return {
    chips: [
      { title: 'Все', value: '', selected: !picked },
      ...shelves.map((s, i) => ({ title: s.title, value: String(i), selected: picked === s })),
    ],
    items: picked ? picked.cards : dedupe(shelves.flatMap((s) => s.cards)),
    shelf: picked ?? null,
  };
}

export const SUB_FILTERS = ['Все', 'Видео', 'Shorts', 'Трансляции', 'Продолжить просмотр'];

const SUB_RULES = {
  'Видео': (c) => !c.short && !c.live && !c.upcoming,
  'Shorts': (c) => c.short,
  'Трансляции': (c) => c.live || c.upcoming,
  'Продолжить просмотр': (c) => c.progress > 0 && c.progress < 95,
};

export function subscriptionsView(shelves, chip) {
  const filter = SUB_FILTERS.includes(chip) ? chip : 'Все';
  const all = dedupe(shelves.flatMap((s) => s.cards));
  return {
    chips: SUB_FILTERS.map((title) => ({ title, value: title === 'Все' ? '' : title, selected: title === filter })),
    items: SUB_RULES[filter] ? all.filter(SUB_RULES[filter]) : all,
    shelf: null,
  };
}
