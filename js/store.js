// Per-device settings. Lives only in this browser's storage; the page must
// work when storage is blocked, so every access is guarded.

const KEY = 'carplay_tube_v1';

const defaults = () => ({
  cookie: '',
  channels: [], // [{id, name, avatar}]
  recent: [], // recent search queries
  tab: 'home',
});

let state = defaults();
try {
  state = { ...state, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
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
