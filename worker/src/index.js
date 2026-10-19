import { Innertube, ClientType, Mixins, YTNodes } from 'youtubei.js/cf-worker';
import { toCards, parseChannelRss, filterLocalSubs, LOCAL_SUB_FILTERS } from './cards.js';
import { homeView, subscriptionsView, subscribedChannels, shelves, sectionNext, shelfPage, mergeShelves } from './tv.js';

// Stateless bridge between the CarPlay site and YouTube.
// Signed-in viewers sign in the way a TV does (code on google.com/device); their
// tokens live on their device and arrive per request in X-YT-Auth. Nothing is stored.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-YT-Auth',
  'Access-Control-Expose-Headers': 'X-YT-Auth-Update',
  'Access-Control-Max-Age': '86400',
};

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra },
  });

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const BASE = { retrieve_player: false, lang: 'ru', location: 'UA' };

const web = () => Innertube.create(BASE);

const encodeTokens = (t) => btoa(JSON.stringify(t));

function decodeTokens(header) {
  if (!header) return null;
  try {
    const t = JSON.parse(atob(header));
    return t.access_token && t.refresh_token && t.client ? t : null;
  } catch {
    return null;
  }
}

// Signed-in TV session. `refreshed` is set when the access token had to be renewed,
// so the site can keep the new one.
async function tv(ctx) {
  if (!ctx.tokens) throw new HttpError(401, 'Нужен вход в YouTube');
  const yt = await Innertube.create({ ...BASE, client_type: ClientType.TV });
  const before = ctx.tokens.access_token;
  try {
    await yt.session.signIn({ ...ctx.tokens });
  } catch {
    throw new HttpError(401, 'Вход устарел — войди заново в настройках');
  }
  const now = yt.session.oauth.oauth2_tokens;
  if (now && now.access_token !== before) ctx.refreshed = { ...now, client: ctx.tokens.client };
  return yt;
}

async function tvBrowse(ctx, browseId) {
  const yt = await tv(ctx);
  const res = await yt.actions.execute('/browse', { browseId, client: 'TV' });
  return res.data;
}

const PAGES = 3; // pages of shelves; the TV app loads them as you scroll down
const MAX_SHELF_EXTENSIONS = 12;

// The TV surface hands out ~4 shelves of 5 tiles at a time. Collect a few pages
// and one more stretch of every shelf so a screen has enough to walk through.
async function tvShelves(ctx, browseId) {
  const yt = await tv(ctx);
  const browse = async (params) => (await yt.actions.execute('/browse', { ...params, client: 'TV' })).data;
  let page = await browse({ browseId });
  const first = page;
  const list = shelves(page);
  for (let i = 1; i < PAGES; i++) {
    const token = sectionNext(page);
    if (!token) break;
    page = await browse({ continuation: token });
    list.push(...shelves(page));
  }
  await Promise.all(
    list.filter((s) => s.next).slice(0, MAX_SHELF_EXTENSIONS).map(async (s) => {
      try {
        s.cards.push(...shelfPage(await browse({ continuation: s.next })).cards);
      } catch {
        // A shelf that fails to extend keeps its first tiles.
      }
    }),
  );
  return { first, list };
}

// ---------- sign-in (device flow) ----------

const TOKEN_URL = 'https://www.youtube.com/o/oauth2/token';

async function authStart() {
  const yt = await web();
  const oauth = yt.session.oauth;
  oauth.client_id = await oauth.getClientID();
  const code = await oauth.getDeviceAndUserCode();
  return {
    user_code: code.user_code,
    verification_url: code.verification_url,
    device_code: code.device_code,
    interval: code.interval,
    expires_in: code.expires_in,
    client: oauth.client_id,
  };
}

async function authPoll(request) {
  const { device_code, client } = await request.json().catch(() => ({}));
  if (!device_code || !client?.client_id) throw new HttpError(400, 'Нет кода входа');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: client.client_id,
      client_secret: client.client_secret,
      code: device_code,
      grant_type: 'http://oauth.net/grant_type/device/1.0',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.error === 'authorization_pending' || data.error === 'slow_down') return { pending: true };
  if (data.error === 'access_denied') throw new HttpError(403, 'Вход отклонён');
  if (data.error === 'expired_token') throw new HttpError(410, 'Код устарел — начни вход заново');
  if (data.error || !data.access_token) throw new HttpError(502, 'Google не выдал вход');
  return {
    tokens: {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type,
      scope: data.scope,
      expiry_date: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      client,
    },
  };
}

// ---------- feeds ----------

async function homeFeed(ctx, url) {
  const list = mergeShelves((await tvShelves(ctx, 'FEwhat_to_watch')).list);
  return { ...homeView(list, url.searchParams.get('chip')), shelves: list.filter((s) => s.title) };
}

async function subscriptionsFeed(ctx, url) {
  const { list } = await tvShelves(ctx, 'FEsubscriptions');
  // The TV page splits fresh uploads into small untitled shelves; show them as one row.
  const rows = [];
  let fresh = null;
  for (const s of list) {
    if (s.title) rows.push(s);
    else if (fresh) fresh.cards.push(...s.cards);
    else rows.push((fresh = { title: 'Новые видео', cards: [...s.cards] }));
  }
  const merged = mergeShelves(rows);
  return { ...subscriptionsView(merged, url.searchParams.get('chip')), shelves: merged };
}

async function myChannels(ctx) {
  return { channels: subscribedChannels(await tvBrowse(ctx, 'FEsubscriptions')) };
}

function chipsOf(feed) {
  const memo = feed.memo;
  const nodes = [...(memo?.getType(YTNodes.ChipCloudChip) ?? []), ...(memo?.getType(YTNodes.ChipView) ?? [])];
  return nodes.filter((n) => n.text && n.endpoint);
}

// Search filters are addressed by index into the list the base search returned,
// so the site never holds YouTube's opaque continuation tokens.
async function applyChip(yt, feed, raw) {
  const index = raw == null || raw === '' ? null : Number(raw);
  const chips = chipsOf(feed).filter((c) => c.text !== 'Все');
  const active = index != null && chips[index] ? index : null;
  const titles = [
    { title: 'Все', value: '', selected: active == null },
    ...chips.map((c, i) => ({ title: c.text, value: String(i), selected: i === active })),
  ];
  if (active == null) return { chips: titles, feed };
  const response = await chips[active].endpoint.call(yt.actions, { parse: true });
  return { chips: titles, feed: new Mixins.Feed(yt.actions, response, true) };
}

async function search(url) {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) throw new HttpError(400, 'Пустой запрос');
  const yt = await web();
  const { chips, feed } = await applyChip(yt, await yt.search(q), url.searchParams.get('chip'));
  return { chips, items: toCards(feed.videos) };
}

const CHANNEL_TABS = {
  'Видео': (ch) => ch.getVideos(),
  'Shorts': (ch) => ch.getShorts(),
  'Трансляции': (ch) => ch.getLiveStreams(),
};

async function channel(url) {
  const id = url.searchParams.get('id') ?? '';
  if (!/^UC[\w-]{22}$/.test(id)) throw new HttpError(400, 'Неверный канал');
  const tab = CHANNEL_TABS[url.searchParams.get('tab')] ? url.searchParams.get('tab') : 'Видео';
  const ch = await (await web()).getChannel(id);
  const available = Object.keys(CHANNEL_TABS).filter((t) => ch.tabs.includes(t));
  const feed = await CHANNEL_TABS[tab](ch);
  return {
    title: ch.metadata.title,
    avatar: ch.metadata.avatar?.[0]?.url ?? '',
    chips: available.map((title) => ({ title, value: title, selected: title === tab })),
    items: toCards(feed.videos),
  };
}

const absolute = (u) => (u.startsWith('//') ? `https:${u}` : u);

function channelInfo(node) {
  if (node.type === 'Channel' || node.type === 'GridChannel') {
    return {
      id: node.id ?? node.author?.id,
      name: node.author?.name ?? String(node.title ?? ''),
      avatar: absolute(node.author?.best_thumbnail?.url ?? ''),
      meta: String(node.subscriber_count ?? node.video_count ?? ''),
    };
  }
  if (node.type === 'LockupView' && node.content_type === 'CHANNEL') {
    return {
      id: node.content_id,
      name: String(node.metadata?.title ?? ''),
      avatar: absolute(node.content_image?.image?.[0]?.url ?? ''),
      meta: '',
    };
  }
  return null;
}

async function channelSearch(url) {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) throw new HttpError(400, 'Пустой запрос');
  const res = await (await web()).search(q, { type: 'channel' });
  const channels = [...res.channels, ...res.memo.getType(YTNodes.LockupView)]
    .map(channelInfo)
    .filter((c) => c && /^UC[\w-]{22}$/.test(c.id));
  return { channels };
}

const MAX_LOCAL_CHANNELS = 40;

async function localSubscriptions(request) {
  const body = await request.json().catch(() => ({}));
  const ids = [...new Set((body.channels ?? []).filter((id) => /^UC[\w-]{22}$/.test(id)))].slice(0, MAX_LOCAL_CHANNELS);
  const filter = LOCAL_SUB_FILTERS.includes(body.filter) ? body.filter : 'Все';
  const feeds = await Promise.all(
    ids.map(async (id) => {
      const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, {
        cf: { cacheTtl: 600, cacheEverything: true },
      });
      return res.ok ? parseChannelRss(await res.text()) : [];
    }),
  );
  return {
    chips: LOCAL_SUB_FILTERS.map((title) => ({ title, value: title, selected: title === filter })),
    items: filterLocalSubs(feeds.flat(), filter).slice(0, 60),
  };
}

const ROUTES = {
  'POST /api/auth/start': () => authStart(),
  'POST /api/auth/poll': (ctx) => authPoll(ctx.request),
  'GET /api/home': (ctx) => homeFeed(ctx, ctx.url),
  'GET /api/subscriptions': (ctx) => subscriptionsFeed(ctx, ctx.url),
  'GET /api/my-channels': (ctx) => myChannels(ctx),
  'GET /api/search': (ctx) => search(ctx.url),
  'GET /api/channel': (ctx) => channel(ctx.url),
  'GET /api/channel-search': (ctx) => channelSearch(ctx.url),
  'POST /api/local-subscriptions': (ctx) => localSubscriptions(ctx.request),
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const route = ROUTES[`${request.method} ${url.pathname}`];
    if (!route) return json({ error: 'Не найдено' }, 404);
    const ctx = { request, url, tokens: decodeTokens(request.headers.get('X-YT-Auth')), refreshed: null };
    try {
      const body = await route(ctx);
      const headers = { 'Cache-Control': ctx.tokens || url.pathname.startsWith('/api/auth') ? 'private, no-store' : 'public, max-age=300' };
      if (ctx.refreshed) headers['X-YT-Auth-Update'] = encodeTokens(ctx.refreshed);
      return json(body, 200, headers);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 502;
      return json({ error: e instanceof HttpError ? e.message : 'YouTube не ответил', detail: String(e?.message ?? e) }, status);
    }
  },
};
