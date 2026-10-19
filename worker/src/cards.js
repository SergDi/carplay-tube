// Turns youtubei.js nodes and YouTube RSS into the flat card the site renders.

const text = (t) => (t == null ? '' : typeof t === 'string' ? t : t.toString?.() ?? t.text ?? '');

export function thumb(id) {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

function lockupParts(metadata) {
  const rows = metadata?.metadata?.metadata_rows ?? [];
  return rows.map((row) => (row.metadata_parts ?? []).map((p) => text(p.text)).filter(Boolean));
}

// "Воспроизвести короткое видео "Title", 1 тыс. просмотров" → Title
function shortTitle(label = '') {
  return label.match(/["«](.+)["»]/)?.[1] ?? label;
}

export function toCard(v) {
  if (!v) return null;
  switch (v.type) {
    case 'Video':
    case 'GridVideo':
    case 'CompactVideo': {
      const id = v.video_id ?? v.id;
      if (!id) return null;
      return {
        id,
        title: text(v.title),
        channel: v.author?.name ?? '',
        channelId: v.author?.id ?? '',
        avatar: v.author?.best_thumbnail?.url ?? '',
        meta: [text(v.short_view_count) || text(v.view_count), text(v.published)].filter(Boolean).join(' · '),
        duration: v.duration?.text || text(v.length_text),
        live: Boolean(v.is_live),
        short: false,
        thumb: thumb(id),
      };
    }
    case 'LockupView': {
      if (v.content_type !== 'VIDEO' || !v.content_id) return null;
      const [first = [], second = []] = lockupParts(v.metadata);
      const avatar = v.metadata?.image?.avatar?.image?.[0]?.url ?? '';
      const duration = v.duration?.text ?? '';
      return {
        id: v.content_id,
        title: text(v.metadata?.title),
        channel: first[0] ?? '',
        channelId: '',
        avatar: avatar.startsWith('//') ? `https:${avatar}` : avatar,
        meta: second.join(' · '),
        duration,
        live: !duration && /смотрят|watching|в эфире|live/i.test(second.join(' ')),
        short: false,
        thumb: thumb(v.content_id),
      };
    }
    case 'ShortsLockupView': {
      const id = v.on_tap_endpoint?.payload?.videoId ?? String(v.entity_id ?? '').replace(/^shorts-shelf-item-/, '');
      if (!/^[\w-]{11}$/.test(id)) return null;
      return {
        id,
        title: text(v.overlay_metadata?.primary_text) || shortTitle(v.accessibility_text),
        channel: '',
        channelId: '',
        avatar: '',
        meta: text(v.overlay_metadata?.secondary_text),
        duration: '',
        live: false,
        short: true,
        thumb: thumb(id),
      };
    }
    case 'ReelItem': {
      if (!v.id) return null;
      return {
        id: v.id,
        title: text(v.title),
        channel: '',
        channelId: '',
        avatar: '',
        meta: text(v.views),
        duration: '',
        live: false,
        short: true,
        thumb: thumb(v.id),
      };
    }
    default:
      return null;
  }
}

export function toCards(nodes) {
  const seen = new Set();
  const out = [];
  for (const node of nodes ?? []) {
    const card = toCard(node);
    if (card && !seen.has(card.id)) {
      seen.add(card.id);
      out.push(card);
    }
  }
  return out;
}

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].trim()) : '';
};

// Channel uploads feed: https://www.youtube.com/feeds/videos.xml?channel_id=UC…
export function parseChannelRss(xml) {
  const channel = tag(xml.split('<entry>')[0], 'title');
  const channelId = tag(xml.split('<entry>')[0], 'yt:channelId');
  return xml
    .split('<entry>')
    .slice(1)
    .map((entry) => {
      const id = tag(entry, 'yt:videoId');
      const link = entry.match(/<link rel="alternate" href="([^"]+)"/)?.[1] ?? '';
      const views = entry.match(/<media:statistics views="(\d+)"/)?.[1];
      return {
        id,
        title: tag(entry, 'title'),
        channel,
        channelId,
        avatar: '',
        meta: views ? `${Number(views).toLocaleString('ru-RU')} просмотров` : '',
        published: tag(entry, 'published'),
        duration: '',
        live: false,
        short: link.includes('/shorts/'),
        thumb: thumb(id),
      };
    })
    .filter((c) => /^[\w-]{11}$/.test(c.id));
}

const DAY = 24 * 60 * 60 * 1000;

// Filters a site-side subscription list can honour without an account.
export const LOCAL_SUB_FILTERS = ['Все', 'Сегодня', 'Видео', 'Shorts'];

export function filterLocalSubs(cards, filter, now = Date.now()) {
  const sorted = [...cards].sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
  switch (filter) {
    case 'Сегодня':
      return sorted.filter((c) => now - Date.parse(c.published) < DAY);
    case 'Видео':
      return sorted.filter((c) => !c.short);
    case 'Shorts':
      return sorted.filter((c) => c.short);
    default:
      return sorted;
  }
}
