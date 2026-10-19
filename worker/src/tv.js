// Parses raw YouTube TV (TVHTML5) browse responses: shelves of tiles.
// youtubei.js has no parser for the TV surface, so this reads the JSON directly.

import { thumb } from './cards.js';

function walk(node, key, out = []) {
  if (Array.isArray(node)) node.forEach((n) => walk(n, key, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === key) out.push(v);
      walk(v, key, out);
    }
  }
  return out;
}

const text = (t) =>
  !t ? '' : typeof t === 'string' ? t : t.simpleText ?? (t.runs ?? []).map((r) => r.text ?? '').join('');

const absolute = (u = '') => (u.startsWith('//') ? `https:${u}` : u);

export function tileToCard(tile) {
  const cmd = tile.onSelectCommand ?? {};
  const id = cmd.watchEndpoint?.videoId ?? cmd.reelWatchEndpoint?.videoId ?? '';
  if (!/^[\w-]{11}$/.test(id)) return null;
  const header = tile.header?.tileHeaderRenderer ?? {};
  const overlays = header.thumbnailOverlays ?? [];
  const status = overlays.find((o) => o.thumbnailOverlayTimeStatusRenderer)?.thumbnailOverlayTimeStatusRenderer;
  const resume = overlays.find((o) => o.thumbnailOverlayResumePlaybackRenderer)?.thumbnailOverlayResumePlaybackRenderer;
  const short = tile.contentType === 'TILE_CONTENT_TYPE_SHORTS' || Boolean(cmd.reelWatchEndpoint);
  // Shorts carry their title as an overlay on the thumbnail instead of metadata.
  const meta = tile.metadata?.tileMetadataRenderer ?? overlays.find((o) => o.tileMetadataRenderer)?.tileMetadataRenderer ?? {};
  const lines = (meta.lines ?? []).map((l) =>
    (l.lineRenderer?.items ?? []).map((i) => text(i.lineItemRenderer?.text)).filter((s) => s && s !== '•'),
  );
  return {
    id,
    title: text(meta.title),
    channel: lines[0]?.join(' ') ?? '',
    channelId: '',
    avatar: '',
    meta: (lines[1] ?? []).join(' · '),
    duration: status?.style === 'DEFAULT' ? text(status.text) : '',
    live: status?.style === 'LIVE',
    upcoming: status?.style === 'UPCOMING',
    progress: resume?.percentDurationWatched ?? 0,
    short,
    thumb: short ? absolute(header.thumbnail?.thumbnails?.[0]?.url) || thumb(id) : thumb(id),
  };
}

export function shelves(data) {
  return walk(data, 'shelfRenderer').map((shelf) => ({
    title: text(walk(shelf.headerRenderer ?? {}, 'title')[0]),
    cards: walk(shelf, 'tileRenderer').map(tileToCard).filter(Boolean),
  })).filter((s) => s.cards.length);
}

function dedupe(cards) {
  const seen = new Set();
  return cards.filter((c) => !seen.has(c.id) && seen.add(c.id));
}

// Home: every titled shelf becomes a filter; «Все» mixes them in page order.
export function homeView(data, chip) {
  const list = shelves(data).filter((s) => s.title);
  const index = chip === '' || chip == null ? -1 : Number(chip);
  const picked = list[index];
  return {
    chips: [
      { title: 'Все', value: '', selected: !picked },
      ...list.map((s, i) => ({ title: s.title, value: String(i), selected: picked === s })),
    ],
    items: picked ? picked.cards : dedupe(list.flatMap((s) => s.cards)),
  };
}

export const SUB_FILTERS = ['Все', 'Видео', 'Shorts', 'Трансляции', 'Продолжить просмотр'];

const SUB_RULES = {
  'Видео': (c) => !c.short && !c.live && !c.upcoming,
  'Shorts': (c) => c.short,
  'Трансляции': (c) => c.live || c.upcoming,
  'Продолжить просмотр': (c) => c.progress > 0 && c.progress < 95,
};

export function subscriptionsView(data, chip) {
  const filter = SUB_FILTERS.includes(chip) ? chip : 'Все';
  const all = dedupe(shelves(data).flatMap((s) => s.cards));
  return {
    chips: SUB_FILTERS.map((title) => ({ title, value: title === 'Все' ? '' : title, selected: title === filter })),
    items: SUB_RULES[filter] ? all.filter(SUB_RULES[filter]) : all,
  };
}

// The TV subscriptions page lists every channel as a side tab; the channel id
// sits inside the tab's base64 protobuf params.
export function subscribedChannels(data) {
  return walk(data, 'tabRenderer')
    .map((tab) => {
      const params = tab.endpoint?.browseEndpoint?.params ?? '';
      let id = '';
      try {
        const raw = atob(decodeURIComponent(params).replace(/-/g, '+').replace(/_/g, '/'));
        id = raw.match(/UC[\w-]{22}/)?.[0] ?? '';
      } catch {
        // Not a channel tab.
      }
      const thumbs = tab.thumbnail?.thumbnails ?? [];
      return { id, name: text(tab.title), avatar: absolute(thumbs[thumbs.length - 1]?.url) };
    })
    .filter((c) => c.id);
}
