/* global YT */
// Full-screen player. The YouTube iframe never takes focus: the knob drives our
// own overlay, which appears on any key and hides again after a pause.

const $ = (id) => document.getElementById(id);
const HIDE_AFTER = 6000;

let yt = null;
let ready = false;
let pending = null; // card waiting for the API
let hideTimer = 0;
let tickTimer = 0;
let autoplayCheck = 0;
let onClose = () => {};

const api = new Promise((resolve, reject) => {
  window.onYouTubeIframeAPIReady = resolve;
  const s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  s.onerror = reject;
  document.head.append(s);
});

function status(msg) {
  $('p-status').textContent = msg;
  $('p-status').hidden = !msg;
}

const fmt = (sec) => {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

function tick() {
  if (!ready) return;
  const t = yt.getCurrentTime();
  const d = yt.getDuration();
  $('p-time').textContent = d ? `${fmt(t)} / ${fmt(d)}` : fmt(t);
  $('p-bar').style.width = d ? `${(t / d) * 100}%` : '0';
  const playing = yt.getPlayerState() === YT.PlayerState.PLAYING;
  $('p-play').querySelector('span').textContent = playing ? 'Пауза' : 'Пуск';
  $('p-play').dataset.state = playing ? 'playing' : 'paused';
}

export function isOpen() {
  return !$('player').hidden;
}

export function overlayVisible() {
  return $('player').classList.contains('show');
}

export function showOverlay(focus) {
  const root = $('player');
  const wasHidden = !root.classList.contains('show');
  root.classList.add('show');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideOverlay, HIDE_AFTER);
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 500);
  tick();
  if (wasHidden || focus) (focus ?? $('p-play')).focus();
}

export function hideOverlay() {
  // Never hide while the video is paused or stuck: the driver needs the buttons.
  if (ready && yt.getPlayerState() !== YT.PlayerState.PLAYING) return;
  $('player').classList.remove('show');
  clearInterval(tickTimer);
  document.activeElement?.blur();
}

// Called on every key while the player is open.
export function poke() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideOverlay, HIDE_AFTER);
}

function create(card) {
  yt = new YT.Player('yt', {
    videoId: card.id,
    playerVars: {
      autoplay: 1,
      playsinline: 1,
      controls: 0,
      disablekb: 1,
      fs: 0,
      rel: 0,
      iv_load_policy: 3,
      origin: location.origin,
    },
    events: {
      onReady() {
        ready = true;
        const frame = yt.getIframe();
        frame.tabIndex = -1;
        frame.setAttribute('aria-hidden', 'true');
        start(pending);
      },
      onStateChange(e) {
        if (e.data === YT.PlayerState.PLAYING) {
          status('');
          clearTimeout(autoplayCheck);
        }
        if (e.data === YT.PlayerState.ENDED) showOverlay($('p-back'));
        tick();
      },
      onAutoplayBlocked() {
        autoplayRefused();
      },
      onError(e) {
        const why = e.data === 101 || e.data === 150
          ? 'Автор запретил показ этого видео вне YouTube.'
          : `YouTube не воспроизвёл видео (код ${e.data}).`;
        status(why);
        showOverlay($('p-back'));
      },
    },
  });
}

// Browsers in apps may refuse to start a video on their own: then the knob
// lands on «Пуск» and one press starts it, with sound.
function autoplayRefused() {
  if (!ready || yt.getPlayerState() === YT.PlayerState.PLAYING) return;
  status('Нажми «Пуск»');
  showOverlay($('p-play'));
}

function start(card) {
  if (!card) return;
  yt.unMute();
  yt.loadVideoById(card.id);
  clearTimeout(autoplayCheck);
  autoplayCheck = setTimeout(autoplayRefused, 5000);
}

function tryFullscreen() {
  const el = document.documentElement;
  try {
    const req = el.requestFullscreen ?? el.webkitRequestFullscreen;
    req?.call(el)?.catch?.(() => {});
  } catch {
    // Not offered by this browser: the page itself already fills the screen.
  }
}

// In fullscreen the browser keeps Escape for itself and only leaves fullscreen;
// treat that exit as «Назад» so one press still closes the player.
let fullscreen = false;
for (const type of ['fullscreenchange', 'webkitfullscreenchange']) {
  document.addEventListener(type, () => {
    const now = Boolean(document.fullscreenElement ?? document.webkitFullscreenElement);
    if (fullscreen && !now && isOpen()) $('p-back').click();
    fullscreen = now;
  });
}

function leaveFullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.webkitFullscreenElement) document.webkitExitFullscreen();
  } catch {
    // Nothing to leave.
  }
}

// fullscreen: ask the browser for real fullscreen. Not in APTV: there it opens a
// separate window that slides under the CarPlay dock and the knob cannot reach.
export function open(card, closeHandler, { fullscreen = true } = {}) {
  onClose = closeHandler;
  $('p-title').textContent = card.title;
  $('p-channel').textContent = card.channel;
  $('player').hidden = false;
  $('app').inert = true;
  status('Загрузка…');
  if (fullscreen) tryFullscreen();
  showOverlay($('p-play'));
  pending = card;
  api.then(
    () => (yt ? ready && start(card) : create(card)),
    () => {
      status('Не удалось загрузить плеер YouTube. Проверь интернет.');
      showOverlay($('p-back'));
    },
  );
}

export function close() {
  if (!isOpen()) return;
  pending = null;
  clearTimeout(autoplayCheck);
  clearTimeout(hideTimer);
  clearInterval(tickTimer);
  if (ready) yt.stopVideo();
  leaveFullscreen();
  $('player').hidden = true;
  $('player').classList.remove('show');
  $('app').inert = false;
  onClose();
}

// APTV presses whatever its knob focus is on, even a control that is hidden:
// the first press only brings the controls back.
const guard = (fn) => () => {
  if (!overlayVisible()) {
    showOverlay();
    return;
  }
  poke();
  fn();
};

// Leaving the page (car BACK closing APTV's browser, phone locked) stops the sound.
function pauseInBackground() {
  if (ready && isOpen() && document.visibilityState === 'hidden') yt.pauseVideo();
}
document.addEventListener('visibilitychange', pauseInBackground);
window.addEventListener('pagehide', () => ready && isOpen() && yt.pauseVideo());

export function bindControls(back) {
  $('p-back').onclick = guard(back);
  $('p-shield').onclick = () => (overlayVisible() ? hideOverlay() : showOverlay());
  const play = () => {
    if (!ready) return;
    if (yt.getPlayerState() === YT.PlayerState.PLAYING) yt.pauseVideo();
    else {
      yt.unMute();
      yt.playVideo();
      status('');
    }
    tick();
  };
  $('p-play').onclick = guard(play);
  $('p-rew').onclick = guard(() => ready && yt.seekTo(Math.max(0, yt.getCurrentTime() - 10), true));
  $('p-fwd').onclick = guard(() => ready && yt.seekTo(yt.getCurrentTime() + 30, true));
  // APTV can move focus itself with the knob: a hidden control that gets focus
  // brings the controls back, so the driver sees what is selected.
  $('player').addEventListener('focusin', (e) => {
    if (e.target.id === 'p-shield') return;
    if (!overlayVisible()) showOverlay(e.target);
    else poke();
  });
}
