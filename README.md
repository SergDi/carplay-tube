# CarPlay Tube

YouTube for the APTV browser on CarPlay: cards you walk with the knob, Enter opens a full-screen video, «Назад» returns to the same card.

- `index.html`, `styles.css`, `js/` — the site, served by GitHub Pages as is (no build).
- `worker/` — Cloudflare Worker that asks YouTube for the feeds (youtubei.js). Stateless: a viewer's sign-in tokens arrive per request in `X-YT-Auth` and are never stored; a renewed access token comes back in `X-YT-Auth-Update`.

## What works without signing in

- Search with YouTube's own filters.
- «Подписки» from channels added in Settings (channel RSS), filters Все / Сегодня / Видео / Shorts.

## Signing in

Settings → «Войти» signs in the way a YouTube TV app does: the site shows a code, the viewer enters it at google.com/device on the phone. The tokens stay in that browser's storage. Signed in, Home and Subscriptions come from the YouTube TV surface (`FEwhat_to_watch`, `FEsubscriptions`), which works with these tokens; the web surface does not.

- Home: every shelf (Рекомендованные, Недавно опубликованные, Shorts…) is a filter.
- Subscriptions: Все / Видео / Shorts / Трансляции / Продолжить просмотр.
- Settings → «Вид»: «Телефон» shows filters and a grid, «TV» shows the shelves as rows.

The first answer carries three pages of shelves; near the end of the grid, a row or the search results the site asks `/api/more` (`/api/search-more`) with YouTube's continuation token and appends what comes back. Filters on Home and Subscriptions are applied on the device (`js/feeds.js`, shared with the worker).

## Controls

| Key | Action |
|---|---|
| Arrows | move focus to the nearest control in that direction |
| Tab / Shift+Tab | next / previous control |
| Enter | open, press |
| Escape / Backspace | back from the player |

In the player the first key only shows the controls; they hide after 4 s of playback. The YouTube iframe never takes focus. If the browser refuses to start the video by itself, «Пуск» is focused; one press starts it with sound.

The player fills the page and never requests browser fullscreen: in APTV that opens a separate window under the CarPlay dock which the knob cannot reach.

## Develop

```sh
cd worker && npm install && npm run dev   # API on http://127.0.0.1:8787
npm run serve                             # site on http://127.0.0.1:8080
npm test
```

On localhost the site talks to the local worker (`js/config.js`).

## Deploy

```sh
cd worker && npx wrangler login && npm run deploy
```

Put the printed `*.workers.dev` URL into `js/config.js`, run `npm run stamp` (adds `?v=` to every script, style and import and writes `version.json`; a page that finds a newer `version.json` reloads itself, so the APTV browser never keeps an old copy), commit, push to `main`; GitHub Pages serves the repository root.

## Open in APTV

APTV → Quick → Browser → open the Pages URL → add it to bookmarks. APTV has no link that opens a page directly.

Video on CarPlay depends on iOS: Apple removed it in iOS 27.2 beta (APTV issues #179, #188).
