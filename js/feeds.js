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

// Home filters, like YouTube's chips: «Все», «Музыка» (its own TV page), then
// the topic shelves with short names, then the service shelves. A filter's value
// is its shelf title, so it survives shelves being added by «more».
export const MUSIC = 'music';
const SERVICE = /^(Рекомендован|Недавно опубликован|Продолжить просмотр|Shorts|Новое для вас|На основе|Ещё для вас|Новые видео|Смотреть позже)/i;
const tidy = (title) => title.replace(/\s+(и другие|and more)$/i, '');

export function homeChips(shelves, chip) {
  const topics = shelves.filter((s) => !SERVICE.test(s.title));
  const service = shelves.filter((s) => SERVICE.test(s.title));
  return [
    { title: 'Все', value: '', selected: !chip },
    { title: 'Музыка', value: MUSIC, selected: chip === MUSIC },
    ...[...topics, ...service].map((s) => ({ title: tidy(s.title), value: s.title, selected: chip === s.title })),
  ];
}

export function homeView(shelves, chip) {
  const picked = shelves.find((s) => s.title === chip) ?? null;
  return {
    chips: homeChips(shelves, chip),
    items: picked ? picked.cards : dedupe(shelves.flatMap((s) => s.cards)),
    shelf: picked,
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
