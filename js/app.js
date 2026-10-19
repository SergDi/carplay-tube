import { api } from './api.js';
import { store } from './store.js';
import { DIRECTIONS, moveFocus } from './nav.js';
import * as player from './player.js';

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
let request = 0; // guards against a slow answer landing on a newer screen
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
  btn.onclick = () => openVideo(card, btn);
  return btn;
}

function renderChips(chips, onPick) {
  const bar = $('chips');
  bar.replaceChildren(
    ...chips.map((c) => {
      const b = el('button', { type: 'button', className: 'chip', textContent: c.title });
      b.dataset.key = `chip:${c.title}`;
      b.setAttribute('aria-pressed', String(c.selected));
      b.onclick = () => onPick(c.value ?? '');
      return b;
    }),
  );
  bar.hidden = chips.length === 0;
}

function rows(shelves) {
  return el(
    'div',
    { className: 'rows' },
    ...shelves.map((s) =>
      el(
        'section',
        { className: 'row' },
        el('h3', { textContent: s.title }),
        el('div', { className: 'row-track' }, ...s.cards.map(cardNode)),
      ),
    ),
  );
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

async function loadFeed(loader, { onChip, empty, rowsAllowed = false }) {
  const id = ++request;
  const focusKey = document.activeElement?.closest('#chips') ? 'chip' : null;
  $('content').replaceChildren(skeleton());
  try {
    const data = await loader();
    if (id !== request) return;
    const asRows = rowsAllowed && store.get().view === 'tv' && data.shelves?.length;
    renderChips(asRows ? [] : data.chips ?? [], onChip);
    if (focusKey) $('chips').querySelector('[aria-pressed="true"]')?.focus();
    const items = data.items ?? [];
    $('content').replaceChildren(
      asRows ? rows(data.shelves) : items.length ? el('div', { className: 'grid' }, ...items.map(cardNode)) : empty(),
    );
  } catch (err) {
    if (id !== request) return;
    if (err.status === 401 && signedIn()) store.set({ auth: null });
    $('content').replaceChildren(
      message(
        'Не получилось загрузить',
        err.message,
        action('Повторить', () => loadFeed(loader, { onChip, empty, rowsAllowed })),
      ),
    );
  }
}

function showHome() {
  if (!signedIn()) {
    renderChips([], null);
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
  loadFeed(() => api.home(chipByTab.home), {
    rowsAllowed: true,
    onChip: (v) => {
      chipByTab.home = v;
      showHome();
    },
    empty: () => message('Лента пуста', 'YouTube ничего не вернул.'),
  });
}

function showSubs() {
  const { channels } = store.get();
  if (!signedIn() && channels.length === 0) {
    renderChips([], null);
    $('content').replaceChildren(
      message(
        'Пока нет подписок',
        'Войди в YouTube или добавь каналы в настройках — их новые видео будут здесь.',
        action('Открыть настройки', goTo('settings')),
      ),
    );
    return;
  }
  const loader = signedIn()
    ? () => api.subscriptions(chipByTab.subs)
    : () => api.localSubscriptions(channels.map((c) => c.id), chipByTab.subs || 'Все');
  loadFeed(loader, {
    rowsAllowed: signedIn(),
    onChip: (v) => {
      chipByTab.subs = v;
      showSubs();
    },
    empty: () => message('Здесь пусто', 'По этому фильтру видео нет.'),
  });
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
  renderChips([], null);
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
  loadFeed(() => api.search(query, chipByTab.search), {
    onChip: (v) => {
      chipByTab.search = v;
      runSearch(false);
    },
    empty: () => message('Ничего не нашлось', `По запросу «${query}» видео нет.`),
  }).then(() => {
    if (focusResults) $('content').querySelector('.card')?.focus();
  });
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

function showSettings() {
  renderChips([], null);
  const keyProbe = el('p', { id: 'key-probe', className: 'probe', tabIndex: 0, textContent: 'Покрути или нажми шайбу — здесь появится, что получил сайт.' });
  keyProbe.dataset.key = 'probe';
  $('content').replaceChildren(
    el(
      'div',
      { className: 'settings' },
      signInSection(),
      viewSection(),
      el('section', {}, el('h2', { textContent: 'Проверка шайбы' }), keyProbe),
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
  request++;
  renderRail();
  $('search-bar').hidden = tab !== 'search';
  $('main').dataset.tab = tab;
  ({ home: showHome, subs: showSubs, search: showSearch, settings: showSettings })[tab]();
  $('main').scrollTop = 0;
}

// ---------- player ----------

// No history entries: the YouTube iframe adds its own, and in WebKit a
// history.back() would land on those instead of closing the player.
function openVideo(card, origin) {
  returnFocus = origin;
  player.open(card, () => (returnFocus?.isConnected ? returnFocus : $('rail').querySelector('[aria-current="page"]')).focus());
}

function back() {
  player.close();
}

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
    const probe = $('key-probe');
    if (probe) probe.textContent = `Получено: ${e.shiftKey ? 'Shift+' : ''}${e.key} · code: ${e.code || '—'}`;

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
});

show();
$('rail').querySelector('[aria-current="page"]').focus();
