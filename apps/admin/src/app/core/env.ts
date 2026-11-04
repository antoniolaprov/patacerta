/**
 * Service URLs. Override at deploy time by defining `window.__PATACERTA__`
 * in index.html, so one build works in any environment.
 */
const runtime = (globalThis as { __PATACERTA__?: { apiUrl?: string; aiUrl?: string } }).__PATACERTA__;

export const env = {
  apiUrl: runtime?.apiUrl ?? 'http://localhost:3000/api',
  aiUrl: runtime?.aiUrl ?? 'http://localhost:4000',
};
