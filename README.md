# CarPlay Tube

YouTube for the APTV browser on CarPlay: cards you walk with the knob, Enter opens a full-screen video, «Назад» returns to the same card.

- `index.html`, `styles.css`, `js/` — the site, served by GitHub Pages as is (no build).
- `worker/` — Cloudflare Worker that asks YouTube for the feeds (youtubei.js). Stateless: a viewer's sign-in cookie arrives per request in `X-YT-Cookie` and is never stored.

## What works without signing in

- Search with YouTube's own filters.
- «Подписки» from channels added in Settings (channel RSS), filters Все / Сегодня / Видео / Shorts.

With a cookie from youtube.com (Settings → «Вход в YouTube») the Home feed with its chips and the real Subscriptions feed with its filters come from the account.

## Controls

| Key | Action |
|---|---|
| Arrows | move focus to the nearest control in that direction |
| Tab / Shift+Tab | next / previous control |
| Enter | open, press |
| Escape / Backspace | back from the player |

In the player the first key only shows the controls; they hide after 4 s of playback. The YouTube iframe never takes focus. If the browser refuses to start sound by itself, the video starts muted and «Включить звук» is focused.

Real browser fullscreen is requested when a video opens; browsers inside apps on iPhone usually refuse it, and the player already fills the page.

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

Put the printed `*.workers.dev` URL into `js/config.js`, commit, push to `main`; GitHub Pages serves the repository root.

## Open in APTV

APTV → Quick → Browser → open the Pages URL → add it to bookmarks. APTV has no link that opens a page directly.

Video on CarPlay depends on iOS: Apple removed it in iOS 27.2 beta (APTV issues #179, #188).
