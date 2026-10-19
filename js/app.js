import { iosDesktopMode } from './aptv.js?v=ad34351-mvfwzwnm';
import { api } from './api.js?v=ad34351-mvfwzwnm';
import { store } from './store.js?v=ad34351-mvfwzwnm';
import { DIRECTIONS, moveFocus } from './nav.js?v=ad34351-mvfwzwnm';
import * as player from './player.js?v=ad34351-mvfwzwnm';
import { probeView, clearProbe, probeLog, onProbeSettled } from './probe.js?v=ad34351-mvfwzwnm';
import { dedupe, mergeShelves, homeView, subscriptionsView } from './feeds.js?v=ad34351-mvfwzwnm';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
};

const TABS = ['home', 'subs', 'search', 'settings'];

let tab = TABS.includes(store.get().tab) ? store.get().tab : 'home';
const chipByTab = { home: '', subs: '', search: '' };
let query = '';
let returnFocus = null;
let signIn = null; // pending device-code sign-in: {user_code, verification_url, timer}

const signedIn = () => Boolean(store.get().auth);


// Re-rendering replaces the focused button; controls with a data-key get focus back.
function keepFocus(render) {
  const key = document.activeElement?.dataset?.key;
  render();
  if (key) document.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus();
}

// ---------- rail ----------

function renderRail() {
  for (const btn of $('rail').querySelectorAll('button')) {
    btn.setAttribute('aria-current', btn.dataset.tab === tab ? 'page' : 'false');
  }
}

$('rail').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  tab = btn.dataset.tab;
  store.set({ tab });
  show();
});

// ---------- feed screens ----------

function cardNode(card) {
  const btn = el(
    'button',
    { className: `card${card.short ? ' short' : ''}`, type: 'button' },
    el(
      'span',
      { className: 'thumb' },
      el('img', { src: card.thumb, alt: '', loading: 'lazy', decoding: 'async' }),
      card.live ? el('span', { className: 'badge live', textContent: 'В эфире' }) : null,
      card.upcoming ? el('span', { className: 'badge', textContent: 'Скоро' }) : null,
      card.short && !card.duration ? el('span', { className: 'badge', textContent: 'Shorts' }) : null,
      card.duration ? el('span', { className: 'badge', textContent: card.duration }) : null,
      card.progress ? el('span', { className: 'watched', style: `width:${card.progress}%` }) : null,
    ),
    el('span', { className: 'title', textContent: card.title }),
    el('span', { className: 'meta', textContent: [card.channel, card.meta].filter(Boolean).join(' · ') }),
  );
  btn.setAttribute('aria-label', `▶ ${card.title}${card.channel ? ` · ${card.channel}` : ''}${card.duration ? ` · ${card.duration}` : ''}`);
  btn.onclick = () => openVideo(card, btn);
  return btn;
}

function renderChips(chips) {
  const bar = $('chips');
  bar.replaceChildren(
    ...chips.map((c) => {
      const b = el('button', { type: 'button', className: 'chip', textContent: c.title });
      b.dataset.key = `chip:${c.title}`;
      b.setAttribute('aria-pressed', String(c.selected));
      b.onclick = () => pickChip(c.value ?? '');
      return b;
    }),
  );
  bar.hidden = chips.length === 0;
}

function message(title, text, ...actions) {
  return el(
    'div',
    { className: 'empty' },
    el('p', { className: 'empty-title', textContent: title }),
    text ? el('p', { textContent: text }) : null,
    actions.length ? el('div', { className: 'actions' }, ...actions) : null,
  );
}

const action = (label, fn, key) => {
  const b = el('button', { type: 'button', className: 'btn', textContent: label });
  if (key) b.dataset.key = key;
  b.onclick = fn;
  return b;
};

const goTo = (next) => () => {
  tab = next;
  store.set({ tab });
  show();
  $('rail').querySelector(`[data-tab="${next}"]`).focus();
};

function skeleton() {
  return el('div', { className: 'grid' }, ...Array.from({ length: 6 }, () => el('div', { className: 'card skeleton' })));
}

// One live feed per screen: what is loaded, what is drawn, how to get more.
//  home / subs — YouTube TV shelves, filters applied here, more via /api/more;
//  search — flat list with server-side filters, more via /api/search-more;
//  local — channel RSS without an account, no more.
let feed = null;

const shelfFeed = () => feed.kind === 'home' || feed.kind === 'subs';
const asRows = () => shelfFeed() && store.get().view === 'tv';

function currentView() {
  if (feed.kind === 'home') return homeView(feed.shelves, chipByTab.home);
  if (feed.kind === 'subs') return subscriptionsView(feed.shelves, chipByTab.subs);
  return { chips: feed.chips, items: feed.items, shelf: null };
}

function emptyMessage() {
  if (feed.kind === 'search') return message('Ничего не нашлось', `По запросу «${query}» видео нет.`);
  if (feed.kind === 'home') return message('Лента пуста', 'YouTube ничего не вернул.');
  return message('Здесь пусто', 'По этому фильтру видео нет.');
}

function rowNode(shelf) {
  const track = el('div', { className: 'row-track' }, ...shelf.cards.map(cardNode));
  track.dataset.shelf = shelf.title;
  feed.tracks.set(shelf.title, { track, drawn: new Set(shelf.cards.map((c) => c.id)) });
  track.addEventListener('scroll', () => {
    if (track.scrollLeft + track.clientWidth > track.scrollWidth - 400) loadMore({ shelf: shelf.title });
  }, { passive: true });
  return el('section', { className: 'row' }, el('h3', { textContent: shelf.title }), track);
}

function draw() {
  feed.drawn = new Set();
  feed.tracks = new Map();
  if (asRows()) {
    renderChips([]);
    $('content').replaceChildren(el('div', { className: 'rows' }, ...feed.shelves.map(rowNode)));
    return;
  }
  const view = currentView();
  renderChips(view.chips);
  view.items.forEach((c) => feed.drawn.add(c.id));
  $('content').replaceChildren(
    view.items.length ? el('div', { className: 'grid' }, ...view.items.map(cardNode)) : emptyMessage(),
  );
}

// Adds what a «more» answer brought without touching what is on screen,
// so the knob keeps its place. Returns how many cards appeared.
function drawMore() {
  if (asRows()) {
    const rowsEl = $('content').querySelector('.rows');
    let added = 0;
    for (const s of feed.shelves) {
      const t = feed.tracks.get(s.title);
      if (!t) {
        rowsEl.append(rowNode(s));
        added += s.cards.length;
        continue;
      }
      for (const c of s.cards) {
        if (t.drawn.has(c.id)) continue;
        t.drawn.add(c.id);
        t.track.append(cardNode(c));
        added++;
      }
    }
    return added;
  }
  const view = currentView();
  if (feed.kind === 'home') keepFocus(() => renderChips(view.chips));
  const fresh = view.items.filter((c) => !feed.drawn.has(c.id));
  if (!fresh.length) return 0;
  let grid = $('content').querySelector('.grid');
  if (!grid) {
    grid = el('div', { className: 'grid' });
    $('content').replaceChildren(grid);
  }
  for (const c of fresh) {
    feed.drawn.add(c.id);
    grid.append(cardNode(c));
  }
  return fresh.length;
}

function loadingTail(on) {
  $('content').querySelector('.more-tail')?.remove();
  if (on) $('content').append(el('p', { className: 'more-tail', textContent: 'Загружаю ещё…' }));
}

// hint.shelf: the viewer reached the end of that shelf (a TV row or a picked home filter).
async function loadMore(hint = {}, depth = 0) {
  const f = feed;
  if (!f || f.loading || depth > 2) return;
  let request;
  if (f.kind === 'search') {
    if (!f.next) return;
    request = api.searchMore(f.next).then((r) => {
      f.items = dedupe([...f.items, ...(r.items ?? [])]);
      f.next = r.next ?? null;
    });
  } else if (shelfFeed()) {
    const shelf = hint.shelf != null ? f.shelves.find((s) => s.title === hint.shelf) : null;
    if (shelf?.next) {
      request = api.more(shelf.next, f.kind).then((r) => {
        shelf.cards = dedupe([...shelf.cards, ...(r.cards ?? [])]);
        shelf.next = r.next ?? null;
      });
    } else if (f.next) {
      // A shelf without its own continuation grows from the next page (fresh uploads do).
      request = api.more(f.next, f.kind).then((r) => {
        f.shelves = mergeShelves(r.shelves ?? [], f.shelves);
        f.next = r.next ?? null;
      });
    } else return;
  } else return;

  f.loading = true;
  loadingTail(!asRows() || hint.shelf == null);
  try {
    await request;
  } catch (err) {
    toast(err.message);
  } finally {
    f.loading = false;
  }
  if (f !== feed) return;
  loadingTail(false);
  // A filter may find nothing new on a page; look one page further.
  if (drawMore() === 0) loadMore(hint, depth + 1);
}

function gridHint() {
  if (feed?.kind !== 'home' || asRows()) return {};
  const picked = currentView().shelf;
  return picked ? { shelf: picked.title } : {};
}

// The knob reached one of the last cards: fetch more before it hits the end.
function maybeMore(target) {
  if (!feed || !target?.classList?.contains('card') || !$('content').contains(target)) return;
  const track = target.closest('.row-track');
  if (track) {
    const cards = [...track.children];
    if (cards.indexOf(target) >= cards.length - 3) loadMore({ shelf: track.dataset.shelf });
    const rowsAll = [...$('content').querySelectorAll('.row')];
    if (rowsAll.indexOf(track.closest('.row')) >= rowsAll.length - 2) loadMore();
    return;
  }
  const cards = [...(target.closest('.grid')?.children ?? [])];
  if (cards.indexOf(target) >= cards.length - 6) loadMore(gridHint());
}

$('main').addEventListener('scroll', () => {
  const m = $('main');
  if (feed && m.scrollTop + m.clientHeight > m.scrollHeight - 400) loadMore(gridHint());
}, { passive: true });

async function startFeed(kind, loader, { focusResults = false } = {}) {
  const f = (feed = { kind, shelves: [], next: null, items: [], chips: [], loading: false, drawn: new Set(), tracks: new Map() });
  const chipFocused = Boolean(document.activeElement?.closest('#chips'));
  $('content').replaceChildren(skeleton());
  try {
    const data = await loader();
    if (f !== feed) return;
    f.shelves = data.shelves ?? [];
    f.next = data.next ?? null;
    f.items = data.items ?? [];
    f.chips = data.chips ?? [];
    draw();
    if (chipFocused) $('chips').querySelector('[aria-pressed="true"]')?.focus();
    else if (focusResults) $('content').querySelector('.card')?.focus();
  } catch (err) {
    if (f !== feed) return;
    if (err.status === 401 && signedIn()) store.set({ auth: null });
    renderChips([]);
    $('content').replaceChildren(
      message('Не получилось загрузить', err.message, action('Повторить', () => startFeed(kind, loader, { focusResults }))),
    );
  }
}

function pickChip(value) {
  chipByTab[tab] = value;
  if (feed && shelfFeed()) {
    draw();
    $('chips').querySelector('[aria-pressed="true"]')?.focus();
    $('main').scrollTop = 0;
  } else if (tab === 'search') runSearch(false);
  else showSubs();
}

function showHome() {
  if (!signedIn()) {
    renderChips([]);
    $('content').replaceChildren(
      message(
        'Главная появится после входа',
        'Рекомендации YouTube показывает только по аккаунту. Поиск и каналы из настроек работают и без входа.',
        action('Войти', goTo('settings')),
        action('Поиск', goTo('search')),
      ),
    );
    return;
  }
  startFeed('home', () => api.home());
}

function showSubs() {
  const { channels } = store.get();
  if (signedIn()) {
    startFeed('subs', () => api.subscriptions());
    return;
  }
  if (channels.length === 0) {
    renderChips([]);
    $('content').replaceChildren(
      message(
        'Пока нет подписок',
        'Войди в YouTube или добавь каналы в настройках — их новые видео будут здесь.',
        action('Открыть настройки', goTo('settings')),
      ),
    );
    return;
  }
  startFeed('local', () => api.localSubscriptions(channels.map((c) => c.id), chipByTab.subs || 'Все'));
}

// ---------- search ----------

function showSearch() {
  const input = el('input', {
    id: 'q',
    type: 'search',
    value: query,
    placeholder: 'Что найти на YouTube',
    enterKeyHint: 'search',
    autocomplete: 'off',
  });
  const form = el('form', { className: 'search' }, input, el('button', { className: 'btn', type: 'submit', textContent: 'Найти' }));
  form.onsubmit = (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    query = q;
    chipByTab.search = '';
    store.set({ recent: [q, ...store.get().recent.filter((r) => r !== q)].slice(0, 8) });
    input.blur();
    runSearch(true);
  };
  $('search-bar').replaceChildren(form);
  if (query) {
    runSearch(false);
    return;
  }
  renderChips([]);
  const recent = store.get().recent;
  $('content').replaceChildren(
    recent.length
      ? el(
          'div',
          { className: 'recent' },
          el('p', { className: 'section-title', textContent: 'Недавние запросы' }),
          el('div', { className: 'actions' }, ...recent.map((r) => action(r, () => {
            query = r;
            input.value = r;
            runSearch(true);
          }))),
        )
      : message('Поиск по YouTube', 'Набери запрос на клавиатуре экрана.'),
  );
}

function runSearch(focusResults) {
  startFeed('search', () => api.search(query, chipByTab.search), { focusResults });
}

// ---------- sign-in ----------

function stopSignIn() {
  if (signIn) clearTimeout(signIn.timer);
  signIn = null;
}

async function startSignIn() {
  stopSignIn();
  try {
    const code = await api.authStart();
    signIn = { ...code, timer: 0 };
    keepFocus(showSettings);
    $('signin-cancel')?.focus();
    const poll = async () => {
      if (!signIn || signIn.device_code !== code.device_code) return;
      try {
        const res = await api.authPoll(code.device_code, code.client);
        if (res.tokens) {
          stopSignIn();
          store.set({ auth: res.tokens });
          toast('Вход выполнен');
          chipByTab.home = '';
          chipByTab.subs = '';
          if (tab === 'settings') keepFocus(showSettings);
          document.querySelector('[data-key="signout"]')?.focus();
          return;
        }
        signIn.timer = setTimeout(poll, Math.max(code.interval, 3) * 1000);
      } catch (err) {
        stopSignIn();
        toast(err.message);
        if (tab === 'settings') keepFocus(showSettings);
      }
    };
    signIn.timer = setTimeout(poll, Math.max(code.interval, 3) * 1000);
  } catch (err) {
    toast(err.message);
  }
}

function signInSection() {
  if (signIn) {
    return el(
      'section',
      {},
      el('h2', { textContent: 'Вход в YouTube' }),
      el('p', { textContent: 'На телефоне открой адрес ниже, введи код и подтверди вход. Эта страница сама поймёт, что ты вошёл.' }),
      el(
        'div',
        { className: 'device-code' },
        el('span', { className: 'device-url', textContent: signIn.verification_url.replace(/^https?:\/\/(www\.)?/, '') }),
        el('span', { className: 'code', textContent: signIn.user_code }),
      ),
      el('div', { className: 'actions' }, Object.assign(action('Отмена', () => {
        stopSignIn();
        keepFocus(showSettings);
      }, 'signin'), { id: 'signin-cancel' })),
    );
  }
  if (signedIn()) {
    return el(
      'section',
      {},
      el('h2', { textContent: 'Вход в YouTube' }),
      el('p', { textContent: 'Ты вошёл. Главная и подписки берутся из твоего аккаунта.' }),
      el('div', { className: 'actions' }, action('Выйти', () => {
        store.set({ auth: null });
        toast('Вход удалён с этого устройства');
        keepFocus(showSettings);
        document.querySelector('[data-key="signin"]')?.focus();
      }, 'signout')),
      el('p', { className: 'note', textContent: 'Доступ хранится только в этом браузере. Отозвать его совсем можно в настройках аккаунта Google → «Сторонние приложения».' }),
    );
  }
  return el(
    'section',
    {},
    el('h2', { textContent: 'Вход в YouTube' }),
    el('p', { textContent: 'Как на телевизоре: сайт покажет код, ты введёшь его на телефоне. Нужен для главной и настоящих подписок.' }),
    el('div', { className: 'actions' }, action('Войти', startSignIn, 'signin')),
  );
}

// ---------- settings ----------

function viewSection() {
  const { view } = store.get();
  const option = (value, label) => {
    const b = action(label, () => {
      store.set({ view: value });
      keepFocus(showSettings);
    }, `view:${value}`);
    b.classList.add('chip');
    b.setAttribute('aria-pressed', String(view === value));
    return b;
  };
  return el(
    'section',
    {},
    el('h2', { textContent: 'Вид главной и подписок' }),
    el('p', { textContent: view === 'tv' ? 'Полки рядами, как в YouTube на телевизоре.' : 'Фильтры сверху и сетка карточек, как в телефоне.' }),
    el('div', { className: 'actions' }, option('phone', 'Телефон'), option('tv', 'TV')),
  );
}

let channelResults = []; // last channel search, kept across settings re-renders

function toggleChannel(c) {
  const { channels } = store.get();
  const has = channels.some((x) => x.id === c.id);
  store.set({ channels: has ? channels.filter((x) => x.id !== c.id) : [...channels, c] });
  toast(has ? `Убран: ${c.name}` : `Добавлен: ${c.name}`);
}

function resultRows() {
  const mine = new Set(store.get().channels.map((c) => c.id));
  return channelResults.map((c) => channelRow(c, mine.has(c.id) ? 'Убрать' : 'Добавить', () => {
    toggleChannel(c);
    keepFocus(showSettings);
  }, `add:${c.id}`));
}

function channelsSection() {
  const { channels } = store.get();
  const channelInput = el('input', { type: 'search', placeholder: 'Название канала или @имя', autocomplete: 'off' });
  channelInput.dataset.key = 'channel-q';
  const found = el('div', { className: 'channel-list' }, ...resultRows());
  const channelForm = el('form', { className: 'search' }, channelInput, el('button', { className: 'btn', type: 'submit', textContent: 'Найти канал' }));
  channelForm.onsubmit = async (e) => {
    e.preventDefault();
    const q = channelInput.value.trim();
    if (!q) return;
    found.replaceChildren(el('p', { textContent: 'Ищу…' }));
    try {
      const { channels: list } = await api.channelSearch(q);
      channelResults = list.slice(0, 6);
      found.replaceChildren(...resultRows());
      if (!list.length) found.replaceChildren(el('p', { textContent: 'Каналы не нашлись.' }));
      found.querySelector('button')?.focus();
    } catch (err) {
      found.replaceChildren(el('p', { textContent: err.message }));
    }
  };
  const importBtn = signedIn() ? action('Забрать все каналы из аккаунта', async () => {
    try {
      const { channels: mine } = await api.myChannels();
      const known = new Set(store.get().channels.map((c) => c.id));
      store.set({ channels: [...store.get().channels, ...mine.filter((c) => !known.has(c.id))] });
      toast(`Каналов: ${store.get().channels.length}`);
      keepFocus(showSettings);
    } catch (err) {
      toast(err.message);
    }
  }, 'import') : null;
  return el(
    'section',
    {},
    el('h2', { textContent: `Каналы без входа (${channels.length})` }),
    el('p', { textContent: 'Их новые видео показываются в «Подписках», когда ты не вошёл.' }),
    channelForm,
    found,
    importBtn ? el('div', { className: 'actions' }, importBtn) : null,
    el('div', { className: 'channel-list' }, ...channels.map((c, i) => channelRow(c, 'Убрать', () => {
      store.set({ channels: store.get().channels.filter((x) => x.id !== c.id) });
      const next = channels[i + 1] ?? channels[i - 1];
      keepFocus(showSettings);
      document.querySelector(next ? `[data-key="remove:${next.id}"]` : '[data-key="channel-q"]')?.focus();
    }, `remove:${c.id}`))),
  );
}

const SESSION = Math.random().toString(36).slice(2, 10); // one journal per page load

function sendReport() {
  return api.report({
    session: SESSION,
    log: probeLog(),
    screen: `${innerWidth}×${innerHeight}@${devicePixelRatio}`,
    device: `screen ${screen.width}×${screen.height} · touch ${navigator.maxTouchPoints} · zoom ${document.documentElement.style.zoom || 1} · visual ${Math.round(visualViewport?.width ?? 0)}×${Math.round(visualViewport?.height ?? 0)}@${visualViewport?.scale ?? '?'} · hover ${matchMedia('(hover: hover)').matches} · coarse ${matchMedia('(pointer: coarse)').matches}`,
    ua: navigator.userAgent,
    at: new Date().toISOString(),
  });
}

// In APTV the journal goes to the worker by itself once the knob rests, so a
// session in the car needs no buttons pressed.
onProbeSettled(() => {
  if (document.documentElement.classList.contains('aptv')) sendReport().catch(() => {});
});

function showSettings() {
  renderChips([]);
  const probe = el(
    'section',
    {},
    el('h2', { textContent: 'Проверка шайбы' }),
    el('p', { textContent: 'Последние 40 событий, новые сверху: что получил сайт и что APTV сделал со страницей. После проверки нажми «Отправить журнал».' }),
    probeView(),
    el('p', { className: 'note', textContent: `Экран ${innerWidth}×${innerHeight}, касаний ${navigator.maxTouchPoints}${iosDesktopMode ? ', режим APTV' : ''}, браузер: ${navigator.userAgent}` }),
    el('div', { className: 'actions' },
      action('Отправить журнал', async () => {
        try {
          await sendReport();
          toast('Журнал отправлен');
        } catch (err) {
          toast(err.message);
        }
      }, 'probe-send'),
      action('Очистить журнал', clearProbe, 'probe-clear'),
      action('Тест шайбы', () => location.assign('knob-test.html'), 'knob-test'),
      action('Тест датчиков', () => location.assign('sensor-test.html'), 'sensor-test'),
    ),
  );
  $('content').replaceChildren(
    el(
      'div',
      { className: 'settings' },
      signInSection(),
      viewSection(),
      probe,
      channelsSection(),
    ),
  );
}

function channelRow(c, label, fn, key) {
  return el(
    'div',
    { className: 'channel' },
    c.avatar ? el('img', { src: c.avatar, alt: '', loading: 'lazy' }) : el('span', { className: 'avatar-stub' }),
    el('span', { className: 'channel-name', textContent: c.name }),
    action(label, fn, key),
  );
}

// ---------- screens ----------

function show() {
  feed = null;
  renderRail();
  $('search-bar').hidden = tab !== 'search';
  $('main').dataset.tab = tab;
  ({ home: showHome, subs: showSubs, search: showSearch, settings: showSettings })[tab]();
  $('main').scrollTop = 0;
}

// ---------- player ----------

// The player is a history entry, so the car's BACK (APTV's browser going back)
// closes the player instead of leaving the page with the video still playing.
function openVideo(card, origin) {
  returnFocus = origin;
  history.pushState({ player: card.id }, '');
  player.open(card, () => (returnFocus?.isConnected ? returnFocus : $('rail').querySelector('[aria-current="page"]')).focus());
}

function back() {
  if (history.state?.player) history.back();
  else player.close();
}

window.addEventListener('popstate', () => player.close());
player.bindControls(back);

// ---------- knob / keyboard ----------

let toastTimer = 0;
function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 3000);
}

const BACK_KEYS = new Set(['Escape', 'GoBack', 'BrowserBack', 'Backspace']);

document.addEventListener(
  'keydown',
  (e) => {
    const typing = e.target.matches?.('input, textarea');

    if (player.isOpen()) {
      if (BACK_KEYS.has(e.key)) {
        e.preventDefault();
        back();
        return;
      }
      // First touch of the knob only wakes the controls up.
      if (!player.overlayVisible()) {
        e.preventDefault();
        player.showOverlay();
        return;
      }
      player.poke();
      if (DIRECTIONS[e.key]) {
        e.preventDefault();
        moveFocus($('player'), DIRECTIONS[e.key]);
      }
      return;
    }

    if (typing) {
      if (e.key === 'Escape') e.target.blur();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        moveFocus($('app'), DIRECTIONS[e.key]);
      }
      return;
    }

    if (DIRECTIONS[e.key]) {
      e.preventDefault();
      moveFocus($('app'), DIRECTIONS[e.key]);
    }
  },
  true,
);

// Keep the focused control on screen when the knob walks the grid. Instant, not
// smooth: the next knob step measures positions right away.
document.addEventListener('focusin', (e) => {
  e.target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  maybeMore(e.target);
});

show();
$('rail').querySelector('[aria-current="page"]').focus();

// Browsers inside apps (APTV) may keep an old copy of this page. The page
// knows its own version from the ?v= stamp; if the published one differs,
// reload under a new address that no cache has seen.
// Checked on load and every minute (APTV can hide its reload button), but
// never while a video plays.
const VERSION = new URL(import.meta.url).searchParams.get('v');
function checkVersion() {
  fetch(`version.json?${Date.now()}`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((latest) => {
      const tried = new URLSearchParams(location.search).get('v') === latest?.v; // never loop
      if (latest?.v && latest.v !== VERSION && !tried && !player.isOpen()) location.replace(`${location.pathname}?v=${latest.v}`);
    })
    .catch(() => {});
}
if (VERSION) {
  checkVersion();
  setInterval(checkVersion, 60_000);
}
