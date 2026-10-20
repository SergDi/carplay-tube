import test from 'node:test';
import assert from 'node:assert/strict';
import { tileToCard, shelves } from '../worker/src/tv.js';
import { homeView, subscriptionsView, mergeShelves } from '../js/feeds.js';

const video = (id, extra = {}) => ({
  tileRenderer: {
    contentType: 'TILE_CONTENT_TYPE_VIDEO',
    onSelectCommand: { watchEndpoint: { videoId: id } },
    header: {
      tileHeaderRenderer: {
        thumbnailOverlays: [
          ...(extra.progress ? [{ thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: extra.progress } }] : []),
          { thumbnailOverlayTimeStatusRenderer: { text: { simpleText: '10:00' }, style: extra.style ?? 'DEFAULT' } },
        ],
      },
    },
    metadata: {
      tileMetadataRenderer: {
        title: { simpleText: `Video ${id}` },
        lines: [
          { lineRenderer: { items: [{ lineItemRenderer: { text: { runs: [{ text: 'Channel' }] } } }] } },
          { lineRenderer: { items: [
            { lineItemRenderer: { text: { simpleText: '1 тыс. просмотров' } } },
            { lineItemRenderer: { text: { simpleText: '•' } } },
            { lineItemRenderer: { text: { simpleText: '2 часа назад' } } },
          ] } },
        ],
      },
    },
  },
});

const short = (id) => ({
  tileRenderer: {
    contentType: 'TILE_CONTENT_TYPE_SHORTS',
    onSelectCommand: { reelWatchEndpoint: { videoId: id } },
    header: { tileHeaderRenderer: {
      thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/x/oar2.jpg' }] },
      thumbnailOverlays: [{ tileMetadataRenderer: { title: { simpleText: `Short ${id}` } } }],
    } },
  },
});

const shelf = (title, tiles) => ({
  shelfRenderer: {
    headerRenderer: title ? { shelfHeaderRenderer: { title: { simpleText: title } } } : undefined,
    content: { horizontalListRenderer: { items: tiles } },
  },
});

const page = { contents: [
  shelf('Рекомендованные', [video('aaaaaaaaaaa'), video('bbbbbbbbbbb', { progress: 40 })]),
  shelf('Shorts', [short('sssssssssss')]),
  shelf('', [video('lllllllllll', { style: 'LIVE' }), video('aaaaaaaaaaa')]),
] };

test('video tile becomes a card with channel, meta and duration', () => {
  const card = tileToCard(video('aaaaaaaaaaa').tileRenderer);
  assert.equal(card.title, 'Video aaaaaaaaaaa');
  assert.equal(card.channel, 'Channel');
  assert.equal(card.meta, '1 тыс. просмотров · 2 часа назад');
  assert.equal(card.duration, '10:00');
  assert.equal(card.short, false);
});

test('Shorts tile takes its title from the thumbnail overlay', () => {
  const card = tileToCard(short('sssssssssss').tileRenderer);
  assert.equal(card.title, 'Short sssssssssss');
  assert.equal(card.short, true);
  assert.equal(card.thumb, 'https://i.ytimg.com/vi/x/oar2.jpg');
});

test('home: «Все», «Музыка», topics with short names, service shelves last', () => {
  const list = [
    { title: 'Рекомендованные', cards: [{ id: 'a' }] },
    { title: 'Кулинарные шоу и другие', cards: [{ id: 'b' }, { id: 'a' }] },
    { title: 'Shorts', cards: [{ id: 's' }] },
    { title: 'Видеоигры', cards: [{ id: 'g' }] },
  ];
  const all = homeView(list, '');
  assert.deepEqual(all.chips.map((c) => c.title), ['Все', 'Музыка', 'Кулинарные шоу', 'Видеоигры', 'Рекомендованные', 'Shorts']);
  assert.equal(all.items.length, 4);
  assert.deepEqual(homeView(list, 'Кулинарные шоу и другие').items.map((c) => c.id), ['b', 'a']);
  assert.equal(homeView(list, 'music').chips[1].selected, true);
});

test('subscriptions filters', () => {
  const ids = (chip) => subscriptionsView(shelves(page), chip).items.map((c) => c.id);
  assert.deepEqual(ids('Shorts'), ['sssssssssss']);
  assert.deepEqual(ids('Трансляции'), ['lllllllllll']);
  assert.deepEqual(ids('Продолжить просмотр'), ['bbbbbbbbbbb']);
  assert.deepEqual(ids('Видео'), ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
});


test('shelves with the same title from later pages merge without repeats', () => {
  const merged = mergeShelves([
    { title: 'Shorts', cards: [{ id: 'a' }, { id: 'b' }] },
    { title: '', cards: [{ id: 'c' }] },
    { title: 'Shorts', cards: [{ id: 'b' }, { id: 'd' }] },
  ]);
  assert.deepEqual(merged.map((s) => [s.title, s.cards.map((c) => c.id)]), [['Shorts', ['a', 'b', 'd']], ['', ['c']]]);
});

test('merging into loaded shelves keeps the newest continuation token', () => {
  const loaded = [{ title: 'Shorts', cards: [{ id: 'a' }], next: 't1' }];
  const merged = mergeShelves([{ title: 'Shorts', cards: [{ id: 'b' }], next: 't2' }, { title: 'New', cards: [{ id: 'c' }], next: null }], loaded);
  assert.deepEqual(merged.map((s) => [s.title, s.cards.length, s.next]), [['Shorts', 2, 't2'], ['New', 1, null]]);
  assert.equal(loaded[0].cards.length, 1);
});
