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

const TABS = {
  home: 'Главная',
  subs: 'Подписки',
  search: 'Поиск',
  settings: 'Настройки',
};

let tab = TABS[store.get().tab] ? store.get().tab : 'home';
const chipByTab = { home: '', subs: '', search: '' };
let query = '';
let request = 0; // guards against a slow answer landing on a newer screen
let returnFocus = null;

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
    { className: 'card', type: 'button' },
    el(
      'span',
      { className: 'thumb' },
      el('img', { src: card.thumb, alt: '', loading: 'lazy', decoding: 'async' }),
      card.live ? el('span', { className: 'badge live', textContent: 'В эфире' }) : null,
      card.short ? el('span', { className: 'badge', textContent: 'Shorts' }) : null,
      card.duration ? el('span', { className: 'badge', textContent: card.duration }) : null,
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
      b.setAttribute('aria-pressed', String(c.selected));
      b.onclick = () => onPick(c.value ?? '');
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

const action = (label, fn) => {
  const b = el('button', { type: 'button', className: 'btn', textContent: label });
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
  return el('div', { className: 'grid' }, ...Array.from({ length: 8 }, () => el('div', { className: 'card skeleton' })));
}

async function loadFeed(loader, { onChip, empty }) {
  const id = ++request;
  const keepChips = $('chips').querySelector('[aria-pressed="true"]') === document.activeElement;
  $('content').replaceChildren(skeleton());
  try {
    const data = await loader();
    if (id !== request) return;
    renderChips(data.chips ?? [], onChip);
    if (keepChips) $('chips').querySelector('[aria-pressed="true"]')?.focus();
    const items = data.items ?? [];
    $('content').replaceChildren(
      items.length ? el('div', { className: 'grid' }, ...items.map(cardNode)) : empty(),
    );
  } catch (err) {
    if (id !== request) return;
    $('content').replaceChildren(
      message('Не получилось загрузить', err.message, action('Повторить', () => loadFeed(loader, { onChip, empty }))),
    );
  }
}

function showHome() {
  const { cookie } = store.get();
  if (!cookie) {
    renderChips([], null);
    $('content').replaceChildren(
      message(
        'Главная появится после входа',
        'Рекомендации YouTube показывает только по аккаунту. Подписки и поиск работают и без входа.',
        action('Войти', goTo('settings')),
        action('Поиск', goTo('search')),
      ),
    );
    return;
  }
  loadFeed(() => api.home(chipByTab.home), {
    onChip: (v) => {
      chipByTab.home = v;
      showHome();
    },
    empty: () => message('Лента пуста', 'YouTube ничего не вернул. Возможно, вход устарел — обнови его в настройках.'),
  });
}

function showSubs() {
  const { cookie, channels } = store.get();
  if (!cookie && channels.length === 0) {
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
  const loader = cookie
    ? () => api.subscriptions(chipByTab.subs)
    : () => api.localSubscriptions(channels.map((c) => c.id), chipByTab.subs || 'Все');
  loadFeed(loader, {
    onChip: (v) => {
      chipByTab.subs = v;
      showSubs();
    },
    empty: () => message('Здесь пусто', 'По этому фильтру новых видео нет.'),
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
  $('search-bar').hidden = false;
  if (query) runSearch(false);
  else {
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

// ---------- settings ----------

function showSettings() {
  renderChips([], null);
  const { cookie, channels } = store.get();

  const cookieBox = el('textarea', {
    id: 'cookie',
    rows: 3,
    placeholder: 'Вставь сюда строку cookie с youtube.com',
    value: cookie,
    spellcheck: false,
  });
  const saveCookie = action(cookie ? 'Обновить вход' : 'Сохранить вход', () => {
    const value = cookieBox.value.trim().replace(/^cookie:\s*/i, '');
    if (!store.set({ cookie: value })) toast('Браузер не дал сохранить — проверь, не включён ли частный режим.');
    else toast(value ? 'Вход сохранён на этом устройстве' : 'Вход удалён');
    show();
  });
  const signOut = cookie ? action('Выйти', () => {
    store.set({ cookie: '' });
    toast('Вход удалён');
    show();
  }) : null;
  const importBtn = cookie ? action('Забрать каналы из аккаунта', async () => {
    try {
      const { channels: mine } = await api.myChannels();
      const known = new Set(store.get().channels.map((c) => c.id));
      store.set({ channels: [...store.get().channels, ...mine.filter((c) => !known.has(c.id))] });
      toast(`Каналов: ${store.get().channels.length}`);
      show();
    } catch (err) {
      toast(err.message);
    }
  }) : null;

  const channelInput = el('input', { type: 'search', placeholder: 'Название канала или @имя', autocomplete: 'off' });
  const found = el('div', { className: 'channel-list' });
  const channelForm = el('form', { className: 'search' }, channelInput, el('button', { className: 'btn', type: 'submit', textContent: 'Найти канал' }));
  channelForm.onsubmit = async (e) => {
    e.preventDefault();
    const q = channelInput.value.trim();
    if (!q) return;
    found.replaceChildren(el('p', { textContent: 'Ищу…' }));
    try {
      const { channels: list } = await api.channelSearch(q);
      found.replaceChildren(...list.slice(0, 6).map((c) => channelRow(c, 'Добавить', () => {
        if (!store.get().channels.some((x) => x.id === c.id)) store.set({ channels: [...store.get().channels, c] });
        toast(`Добавлен: ${c.name}`);
        show();
      })));
      if (!list.length) found.replaceChildren(el('p', { textContent: 'Каналы не нашлись.' }));
    } catch (err) {
      found.replaceChildren(el('p', { textContent: err.message }));
    }
  };

  const mine = channels.map((c) => channelRow(c, 'Убрать', () => {
    store.set({ channels: store.get().channels.filter((x) => x.id !== c.id) });
    show();
  }));

  const keyProbe = el('p', { id: 'key-probe', className: 'probe', textContent: 'Покрути или нажми шайбу — здесь появится, что получил сайт.' });

  $('content').replaceChildren(
    el(
      'div',
      { className: 'settings' },
      el(
        'section',
        {},
        el('h2', { textContent: 'Вход в YouTube' }),
        el('p', { textContent: cookie ? 'Вход сохранён на этом устройстве. Главная и подписки берутся из твоего аккаунта.' : 'Нужен для главной и настоящих подписок. Делается один раз на телефоне.' }),
        el(
          'details',
          {},
          el('summary', { textContent: 'Где взять cookie' }),
          el(
            'ol',
            {},
            el('li', { textContent: 'На компьютере открой youtube.com, где ты уже вошёл.' }),
            el('li', { textContent: 'Открой инструменты разработчика (⌥⌘I), вкладка Network, обнови страницу.' }),
            el('li', { textContent: 'Кликни любой запрос к youtube.com, в Request Headers скопируй значение cookie целиком.' }),
            el('li', { textContent: 'Вставь его сюда на iPhone (Mac и iPhone делят буфер обмена) и нажми «Сохранить вход».' }),
          ),
          el('p', { className: 'note', textContent: 'Cookie хранится только в этом браузере и отправляется лишь нашему серверу-посреднику, чтобы тот спросил YouTube от твоего имени. Сервер его не сохраняет. Кто получит cookie — получит доступ к аккаунту, никому его не пересылай.' }),
        ),
        cookieBox,
        el('div', { className: 'actions' }, saveCookie, signOut, importBtn),
      ),
      el(
        'section',
        {},
        el('h2', { textContent: `Каналы без входа (${channels.length})` }),
        el('p', { textContent: 'Новые видео этих каналов показываются в «Подписках», пока ты не вошёл.' }),
        channelForm,
        found,
        el('div', { className: 'channel-list' }, ...mine),
      ),
      el('section', {}, el('h2', { textContent: 'Проверка шайбы' }), keyProbe),
    ),
  );
}

function channelRow(c, label, fn) {
  return el(
    'div',
    { className: 'channel' },
    c.avatar ? el('img', { src: c.avatar, alt: '', loading: 'lazy' }) : el('span', { className: 'avatar-stub' }),
    el('span', { className: 'channel-name', textContent: c.name }),
    action(label, fn),
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

function openVideo(card, origin) {
  returnFocus = origin;
  history.pushState({ player: card.id }, '');
  player.open(card, () => (returnFocus?.isConnected ? returnFocus : $('rail').querySelector('[aria-current="page"]')).focus());
}

function back() {
  if (player.isOpen()) history.back();
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
        moveFocus(document.body, DIRECTIONS[e.key]);
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

// Keep the focused control on screen when the knob walks the grid.
document.addEventListener('focusin', (e) => {
  e.target.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
});

history.replaceState({}, '');
show();
$('rail').querySelector('[aria-current="page"]').focus();
