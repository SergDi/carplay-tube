import { Innertube, Mixins, YTNodes } from 'youtubei.js/cf-worker';
import { toCards, parseChannelRss, filterLocalSubs, LOCAL_SUB_FILTERS } from './cards.js';

// Stateless bridge between the CarPlay site and YouTube's InnerTube API.
// A viewer's sign-in arrives per request in X-YT-Cookie and is never stored or logged.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-YT-Cookie',
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

async function client(cookie) {
  return Innertube.create({
    retrieve_player: false,
    lang: 'ru',
    location: 'UA',
    ...(cookie ? { cookie } : {}),
  });
}

function chipsOf(feed) {
  const memo = feed.memo;
  const nodes = [...(memo?.getType(YTNodes.ChipCloudChip) ?? []), ...(memo?.getType(YTNodes.ChipView) ?? [])];
  return nodes.filter((n) => n.text && n.endpoint);
}

// Filters are addressed by index into the list the base feed returned, so the
// site never has to hold YouTube's opaque continuation tokens.
async function applyChip(yt, feed, index) {
  const chips = chipsOf(feed);
  const active = index != null && chips[index] ? index : null;
  const titles = [
    { title: 'Все', value: '', selected: active == null },
    ...chips.filter((c) => c.text !== 'Все').map((c, i) => ({ title: c.text, value: String(i), selected: i === active })),
  ];
  if (active == null) return { chips: titles, feed };
  const response = await chips[active].endpoint.call(yt.actions, { parse: true });
  return { chips: titles, feed: new Mixins.Feed(yt.actions, response, true) };
}

const chipIndex = (url) => {
  const raw = url.searchParams.get('chip');
  return raw == null || raw === '' ? null : Number(raw);
};

async function homeFeed(url, cookie) {
  if (!cookie) return { loggedIn: false, chips: [], items: [] };
  const yt = await client(cookie);
  const home = await yt.getHomeFeed();
  const index = chipIndex(url);
  const titles = home.filters.map((title, i) => ({ title, value: i ? String(i) : '', selected: i === (index ?? 0) }));
  const feed = index ? await home.applyFilter(home.filters[index]) : home;
  return { loggedIn: true, chips: titles, items: toCards(feed.videos) };
}

async function subscriptionsFeed(url, cookie) {
  if (!cookie) throw new HttpError(401, 'Нужен вход в YouTube');
  const yt = await client(cookie);
  const { chips, feed } = await applyChip(yt, await yt.getSubscriptionsFeed(), chipIndex(url));
  return { loggedIn: true, chips, items: toCards(feed.videos) };
}

async function search(url, cookie) {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) throw new HttpError(400, 'Пустой запрос');
  const yt = await client(cookie);
  const { chips, feed } = await applyChip(yt, await yt.search(q), chipIndex(url));
  return { chips, items: toCards(feed.videos) };
}

const CHANNEL_TABS = {
  'Видео': (ch) => ch.getVideos(),
  'Shorts': (ch) => ch.getShorts(),
  'Трансляции': (ch) => ch.getLiveStreams(),
};

async function channel(url, cookie) {
  const id = url.searchParams.get('id') ?? '';
  if (!/^UC[\w-]{22}$/.test(id)) throw new HttpError(400, 'Неверный канал');
  const tab = CHANNEL_TABS[url.searchParams.get('tab')] ? url.searchParams.get('tab') : 'Видео';
  const yt = await client(cookie);
  const ch = await yt.getChannel(id);
  const available = Object.keys(CHANNEL_TABS).filter((t) => ch.tabs.includes(t));
  const feed = await CHANNEL_TABS[tab](ch);
  return {
    title: ch.metadata.title,
    avatar: ch.metadata.avatar?.[0]?.url ?? '',
    chips: available.map((title) => ({ title, value: title, selected: title === tab })),
    items: toCards(feed.videos),
  };
}

function channelInfo(node) {
  if (node.type === 'Channel' || node.type === 'GridChannel') {
    return {
      id: node.id ?? node.author?.id,
      name: node.author?.name ?? String(node.title ?? ''),
      avatar: node.author?.best_thumbnail?.url ?? '',
      meta: String(node.subscriber_count ?? node.video_count ?? ''),
    };
  }
  if (node.type === 'LockupView' && node.content_type === 'CHANNEL') {
    return {
      id: node.content_id,
      name: String(node.metadata?.title ?? ''),
      avatar: node.content_image?.image?.[0]?.url ?? '',
      meta: '',
    };
  }
  return null;
}

const absolute = (u) => (u.startsWith('//') ? `https:${u}` : u);

function channelList(nodes) {
  return nodes
    .map(channelInfo)
    .filter((c) => c && /^UC[\w-]{22}$/.test(c.id))
    .map((c) => ({ ...c, avatar: absolute(c.avatar) }));
}

async function channelSearch(url) {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) throw new HttpError(400, 'Пустой запрос');
  const yt = await client();
  const res = await yt.search(q, { type: 'channel' });
  return { channels: channelList([...res.channels, ...res.memo.getType(YTNodes.LockupView)]) };
}

async function myChannels(cookie) {
  if (!cookie) throw new HttpError(401, 'Нужен вход в YouTube');
  const yt = await client(cookie);
  const feed = await yt.getChannelsFeed();
  return { channels: channelList(feed.channels) };
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
  'GET /api/home': (_req, url, cookie) => homeFeed(url, cookie),
  'GET /api/subscriptions': (_req, url, cookie) => subscriptionsFeed(url, cookie),
  'GET /api/search': (_req, url, cookie) => search(url, cookie),
  'GET /api/channel': (_req, url, cookie) => channel(url, cookie),
  'GET /api/channel-search': (_req, url) => channelSearch(url),
  'GET /api/my-channels': (_req, _url, cookie) => myChannels(cookie),
  'POST /api/local-subscriptions': (req) => localSubscriptions(req),
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const route = ROUTES[`${request.method} ${url.pathname}`];
    if (!route) return json({ error: 'Не найдено' }, 404);
    const cookie = request.headers.get('X-YT-Cookie')?.trim() || '';
    try {
      const body = await route(request, url, cookie);
      // Personal answers must never sit in a shared cache.
      return json(body, 200, { 'Cache-Control': cookie ? 'private, no-store' : 'public, max-age=300' });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 502;
      return json({ error: e instanceof HttpError ? e.message : 'YouTube не ответил', detail: String(e?.message ?? e) }, status);
    }
  },
};
