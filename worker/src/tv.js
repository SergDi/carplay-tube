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

const nextToken = (continuations) => continuations?.[0]?.nextContinuationData?.continuation ?? null;

// next: token for more tiles of the same shelf (horizontal continuation).
// History is one grid and playlists (Смотреть позже, Понравившиеся) one list:
// both come back as a single untitled shelf.
export function shelves(data) {
  const list = walk(data, 'shelfRenderer').map((shelf) => ({
    title: text(walk(shelf.headerRenderer ?? {}, 'title')[0]),
    cards: walk(shelf, 'tileRenderer').map(tileToCard).filter(Boolean),
    next: nextToken(shelf.content?.horizontalListRenderer?.continuations),
  })).filter((s) => s.cards.length);
  if (list.length) return list;
  const flat = walk(data, 'gridRenderer')[0] ?? walk(data, 'playlistVideoListRenderer')[0];
  if (!flat) return [];
  const cards = walk(flat, 'tileRenderer').map(tileToCard).filter(Boolean);
  return cards.length ? [{ title: '', cards, next: nextToken(flat.continuations) }] : [];
}

// Token for the next page of shelves, on the first page or on a continuation page.
export function sectionNext(data) {
  const list = walk(data, 'sectionListRenderer')[0] ?? data.continuationContents?.sectionListContinuation;
  return nextToken(list?.continuations);
}

// A horizontal continuation page: more tiles for one shelf.
export function shelfPage(data) {
  const c = data.continuationContents ?? {};
  const list = c.horizontalListContinuation ?? c.gridContinuation ?? c.playlistVideoListContinuation ?? {};
  return { cards: walk(list.items ?? [], 'tileRenderer').map(tileToCard).filter(Boolean), next: nextToken(list.continuations) };
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
