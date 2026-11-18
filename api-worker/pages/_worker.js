const API_ORIGIN = 'https://zaphira-ventas-calcuta.agustin-5e6.workers.dev';
const PORTAL_ROUTES = new Set([
  '/api/portal-login',
  '/api/portal-session',
  '/api/portal-logout',
  '/api/portal-sso'
]);

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (PORTAL_ROUTES.has(path)) {
      const target = new URL(request.url);
      target.protocol = 'https:';
      target.host = new URL(API_ORIGIN).host;
      return fetch(new Request(target, request));
    }
    return env.ASSETS.fetch(request);
  }
};
