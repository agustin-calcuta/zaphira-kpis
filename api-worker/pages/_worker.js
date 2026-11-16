const API_ORIGIN = 'https://zaphira-ventas-calcuta.agustin-5e6.workers.dev';
const PORTAL_ROUTES = new Set([
  '/api/portal-login',
  '/api/portal-session',
  '/api/portal-logout'
]);

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (PORTAL_ROUTES.has(path)) {
      return fetch(new Request(new URL(path, API_ORIGIN), request));
    }
    return env.ASSETS.fetch(request);
  }
};
