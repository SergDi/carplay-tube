import { Innertube, ClientType, Mixins, YTNodes } from 'youtubei.js/cf-worker';
import { toCards, parseChannelRss, filterLocalSubs, LOCAL_SUB_FILTERS } from './cards.js';
import { subscribedChannels, shelves, sectionNext, shelfPage } from './tv.js';
import { mergeShelves } from '../../js/feeds.js';

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

// Untitled shelves: on Subscriptions they hold fresh uploads, on Home a mixed bag.
const UNTITLED = { home: 'Ещё для вас', subs: 'Новые видео' };
const named = (kind) => (s) => ({ ...s, title: s.title || UNTITLED[kind] });

const tvBrowser = (yt) => async (params) => (await yt.actions.execute('/browse', { ...params, client: 'TV' })).data;

// The TV surface hands out ~4 shelves of 5 tiles at a time. The first answer
// collects a few pages and one more stretch of every shelf; the site asks
// /api/more with the returned tokens as the viewer scrolls further.
async function tvFeed(ctx, browseId, kind) {
  const browse = tvBrowser(await tv(ctx));
  let page = await browse({ browseId });
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
        const more = shelfPage(await browse({ continuation: s.next }));
        s.cards.push(...more.cards);
        s.next = more.next;
      } catch {
        // A shelf that fails to extend keeps its first tiles.
      }
    }),
  );
  return { shelves: mergeShelves(list.map(named(kind))), next: sectionNext(page) };
}

async function moreFeed(ctx) {
  const { token, kind } = await ctx.request.json().catch(() => ({}));
  if (!token) throw new HttpError(400, 'Нет продолжения');
  const data = await tvBrowser(await tv(ctx))({ continuation: token });
  if (data.continuationContents?.horizontalListContinuation) return shelfPage(data);
  return { shelves: mergeShelves(shelves(data).map(named(kind === 'home' ? 'home' : 'subs'))), next: sectionNext(data) };
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

const continuationOf = (feed) =>
  feed.memo.getType(YTNodes.ContinuationItem).map((c) => c.endpoint?.payload?.token).find(Boolean) ?? null;

async function search(url) {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) throw new HttpError(400, 'Пустой запрос');
  const yt = await web();
  const { chips, feed } = await applyChip(yt, await yt.search(q), url.searchParams.get('chip'));
  return { chips, items: toCards(feed.videos), next: continuationOf(feed) };
}

async function searchMore(request) {
  const { token } = await request.json().catch(() => ({}));
  if (!token) throw new HttpError(400, 'Нет продолжения');
  const yt = await web();
  const feed = new Mixins.Feed(yt.actions, await yt.actions.execute('/search', { continuation: token, parse: true }), true);
  return { items: toCards(feed.videos), next: continuationOf(feed) };
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

// A knob diagnostics log from the car, read back with
// `npx wrangler kv key list --binding REPORTS --remote`.
async function report(ctx, env) {
  const body = await ctx.request.text();
  if (body.length > 64_000) throw new HttpError(413, 'Слишком большой журнал');
  // A page sends its journal again as it grows: one key per page load.
  const session = /"session":"([a-z0-9]{1,16})"/.exec(body)?.[1] ?? crypto.randomUUID().slice(0, 8);
  const key = `report:${new Date().toISOString().slice(0, 10)}:${session}`;
  await env.REPORTS.put(key, body, { expirationTtl: 14 * 24 * 3600 });
  return { saved: key };
}

const ROUTES = {
  'POST /api/report': (ctx, env) => report(ctx, env),
  'POST /api/auth/start': () => authStart(),
  'POST /api/auth/poll': (ctx) => authPoll(ctx.request),
  'GET /api/home': (ctx) => tvFeed(ctx, 'FEwhat_to_watch', 'home'),
  'GET /api/subscriptions': (ctx) => tvFeed(ctx, 'FEsubscriptions', 'subs'),
  'POST /api/more': (ctx) => moreFeed(ctx),
  'POST /api/search-more': (ctx) => searchMore(ctx.request),
  'GET /api/my-channels': (ctx) => myChannels(ctx),
  'GET /api/search': (ctx) => search(ctx.url),
  'GET /api/channel': (ctx) => channel(ctx.url),
  'GET /api/channel-search': (ctx) => channelSearch(ctx.url),
  'POST /api/local-subscriptions': (ctx) => localSubscriptions(ctx.request),
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const route = ROUTES[`${request.method} ${url.pathname}`];
    if (!route) return json({ error: 'Не найдено' }, 404);
    const ctx = { request, url, tokens: decodeTokens(request.headers.get('X-YT-Auth')), refreshed: null };
    try {
      const body = await route(ctx, env);
      const headers = { 'Cache-Control': ctx.tokens || url.pathname.startsWith('/api/auth') ? 'private, no-store' : 'public, max-age=300' };
      if (ctx.refreshed) headers['X-YT-Auth-Update'] = encodeTokens(ctx.refreshed);
      return json(body, 200, headers);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 502;
      return json({ error: e instanceof HttpError ? e.message : 'YouTube не ответил', detail: String(e?.message ?? e) }, status);
    }
  },
};
