import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChannelRss, filterLocalSubs, toCard } from '../worker/src/cards.js';

const rss = `<feed><title>Chan</title><yt:channelId>UCBJycsmduvYEL83R_U4JriQ</yt:channelId>
<entry><yt:videoId>aaaaaaaaaaa</yt:videoId><title>Long &amp; good</title>
<link rel="alternate" href="https://www.youtube.com/watch?v=aaaaaaaaaaa"/>
<published>2026-10-19T10:00:00+00:00</published><media:statistics views="1200"/></entry>
<entry><yt:videoId>bbbbbbbbbbb</yt:videoId><title>Short one</title>
<link rel="alternate" href="https://www.youtube.com/shorts/bbbbbbbbbbb"/>
<published>2026-10-10T10:00:00+00:00</published></entry></feed>`;

test('RSS entries become cards with Shorts flagged', () => {
  const cards = parseChannelRss(rss);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].title, 'Long & good');
  assert.equal(cards[0].channel, 'Chan');
  assert.equal(cards[0].short, false);
  assert.equal(cards[1].short, true);
  assert.equal(cards[0].thumb, 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg');
});

test('local filters: today, videos, shorts', () => {
  const cards = parseChannelRss(rss);
  const now = Date.parse('2026-10-19T20:00:00Z');
  assert.deepEqual(filterLocalSubs(cards, 'Сегодня', now).map((c) => c.id), ['aaaaaaaaaaa']);
  assert.deepEqual(filterLocalSubs(cards, 'Видео', now).map((c) => c.id), ['aaaaaaaaaaa']);
  assert.deepEqual(filterLocalSubs(cards, 'Shorts', now).map((c) => c.id), ['bbbbbbbbbbb']);
  assert.equal(filterLocalSubs(cards, 'Все', now).length, 2);
});

test('Shorts title is cut out of the accessibility label', () => {
  const card = toCard({
    type: 'ShortsLockupView',
    entity_id: 'shorts-shelf-item-ccccccccccc',
    accessibility_text: 'Воспроизвести короткое видео "Тест BAW", 1,4 тыс. просмотров',
    overlay_metadata: {},
  });
  assert.equal(card.id, 'ccccccccccc');
  assert.equal(card.title, 'Тест BAW');
  assert.equal(card.short, true);
});

test('non-video lockups are skipped', () => {
  assert.equal(toCard({ type: 'LockupView', content_type: 'PLAYLIST', content_id: 'PLx' }), null);
});
