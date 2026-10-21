import { API_BASE } from './config.js?v=834cbf9-mvhuolbt';
import { store } from './store.js?v=834cbf9-mvhuolbt';

async function call(path, { method = 'GET', body, params } = {}) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) if (v != null && v !== '') url.searchParams.set(k, v);
  const headers = {};
  const { auth } = store.get();
  if (auth) headers['X-YT-Auth'] = btoa(JSON.stringify(auth));
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  // The worker renews an expired access token and hands the new one back.
  const update = res.headers.get('X-YT-Auth-Update');
  if (update) {
    try {
      store.set({ auth: JSON.parse(atob(update)) });
    } catch {
      // Keep the old tokens; the next call will renew again.
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Ошибка ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  authStart: () => call('/api/auth/start', { method: 'POST' }),
  authPoll: (device_code, client) => call('/api/auth/poll', { method: 'POST', body: { device_code, client } }),
  home: () => call('/api/home'),
  subscriptions: () => call('/api/subscriptions'),
  topic: (id) => call('/api/topic', { params: { id } }),
  more: (token, kind) => call('/api/more', { method: 'POST', body: { token, kind } }),
  searchMore: (token) => call('/api/search-more', { method: 'POST', body: { token } }),
  localSubscriptions: (channels, filter) =>
    call('/api/local-subscriptions', { method: 'POST', body: { channels, filter } }),
  search: (q, chip) => call('/api/search', { params: { q, chip } }),
  channelSearch: (q) => call('/api/channel-search', { params: { q } }),
};
