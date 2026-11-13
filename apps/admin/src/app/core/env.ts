/**
 * Service URLs. Override at deploy time by defining `window.__PATACERTA__`
 * in index.html, so one build works in any environment.
 */
const runtime = (globalThis as { __PATACERTA__?: { apiUrl?: string; aiUrl?: string } }).__PATACERTA__;

/**
 * In GitHub Codespaces each port has its own address
 * (https://<codespace>-4200.app.github.dev); the services live on the sibling ports.
 */
function codespacesUrl(port: number) {
  const m = /^(.+)-\d+\.(app\.github\.dev)$/.exec(globalThis.location?.hostname ?? '');
  return m ? `https://${m[1]}-${port}.${m[2]}` : null;
}

export const env = {
  apiUrl: runtime?.apiUrl ?? (codespacesUrl(3000) ? `${codespacesUrl(3000)}/api` : 'http://localhost:3000/api'),
  aiUrl: runtime?.aiUrl ?? codespacesUrl(4000) ?? 'http://localhost:4000',
};
