import { API_BASE } from './config.js';
import { store } from './store.js';

async function call(path, { method = 'GET', body, params } = {}) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) if (v != null && v !== '') url.searchParams.set(k, v);
  const headers = {};
  const { cookie } = store.get();
  if (cookie) headers['X-YT-Cookie'] = cookie;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}

export const api = {
  home: (chip) => call('/api/home', { params: { chip } }),
  subscriptions: (chip) => call('/api/subscriptions', { params: { chip } }),
  localSubscriptions: (channels, filter) =>
    call('/api/local-subscriptions', { method: 'POST', body: { channels, filter } }),
  search: (q, chip) => call('/api/search', { params: { q, chip } }),
  channelSearch: (q) => call('/api/channel-search', { params: { q } }),
  myChannels: () => call('/api/my-channels'),
};
