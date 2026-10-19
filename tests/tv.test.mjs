import test from 'node:test';
import assert from 'node:assert/strict';
import { tileToCard, homeView, subscriptionsView, subscribedChannels, shelves, mergeShelves } from '../worker/src/tv.js';

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

test('home: titled shelves become filters, «Все» dedupes', () => {
  const all = homeView(shelves(page), '');
  assert.deepEqual(all.chips.map((c) => c.title), ['Все', 'Рекомендованные', 'Shorts']);
  assert.equal(all.items.length, 3);
  assert.deepEqual(homeView(shelves(page), '1').items.map((c) => c.id), ['sssssssssss']);
});

test('subscriptions filters', () => {
  const ids = (chip) => subscriptionsView(shelves(page), chip).items.map((c) => c.id);
  assert.deepEqual(ids('Shorts'), ['sssssssssss']);
  assert.deepEqual(ids('Трансляции'), ['lllllllllll']);
  assert.deepEqual(ids('Продолжить просмотр'), ['bbbbbbbbbbb']);
  assert.deepEqual(ids('Видео'), ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
});

test('channel id is read from the tab params', () => {
  const tabs = { tabs: [
    { tabRenderer: { title: 'Все', endpoint: { browseEndpoint: { browseId: 'FEsubscriptions' } } } },
    { tabRenderer: {
      title: 'Історія',
      endpoint: { browseEndpoint: { params: 'igMaChhVQ1h4M3lWeDlwYVdKLUJMWlZxUThDUlE%3D' } },
      thumbnail: { thumbnails: [{ url: '//yt3.googleusercontent.com/a=s48' }] },
    } },
  ] };
  assert.deepEqual(subscribedChannels(tabs), [
    { id: 'UCXx3yVx9paWJ-BLZVqQ8CRQ', name: 'Історія', avatar: 'https://yt3.googleusercontent.com/a=s48' },
  ]);
});

test('shelves with the same title from later pages merge without repeats', () => {
  const merged = mergeShelves([
    { title: 'Shorts', cards: [{ id: 'a' }, { id: 'b' }] },
    { title: '', cards: [{ id: 'c' }] },
    { title: 'Shorts', cards: [{ id: 'b' }, { id: 'd' }] },
  ]);
  assert.deepEqual(merged.map((s) => [s.title, s.cards.map((c) => c.id)]), [['Shorts', ['a', 'b', 'd']], ['', ['c']]]);
});
