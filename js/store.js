// Per-device settings. Lives only in this browser's storage; the page must
// work when storage is blocked, so every access is guarded.

const KEY = 'carplay_tube_v1';

const defaults = () => ({
  auth: null, // YouTube TV sign-in tokens, see worker /api/auth/*
  view: 'phone', // 'phone': filters + grid, 'tv': shelves as rows
  dock: 'auto', // left inset for the CarPlay dock: 'auto' | 'on' | 'off'
  channels: [], // [{id, name, avatar}] followed without signing in
  recent: [], // recent search queries
  tab: 'home',
});

let state = defaults();
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  delete saved.cookie; // first version signed in with a pasted cookie
  state = { ...state, ...saved };
} catch {
  // Private mode or blocked storage: start empty.
}

export const store = {
  get: () => state,
  set(patch) {
    state = { ...state, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  },
};
