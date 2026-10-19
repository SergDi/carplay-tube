// Worker that talks to YouTube (worker/). Local dev: npm run dev in worker/.
export const API_BASE = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? 'http://127.0.0.1:8787'
  : 'https://carplay-tube.carplay-tube-worker.workers.dev';
