import {login, currentUser, password, users, reset, addUser, setActive, signToken} from './auth.mjs';
import {redeemPortalTicket} from './portal-sso.mjs';
import {readDataset, dataResponse, objectives, saveObjectives, trimToSeller, canViewTiendaNube} from './data.mjs';
import {tiendanubeResponse} from './tiendanube.mjs';
import {xlsxResponse} from './xlsx.mjs';
import {syncSales} from './odoo-sync.mjs';

const ORIGINS = new Set([
  'https://agustin-calcuta.github.io',
  'https://zaphira-ventas-calcuta.agustin-5e6.workers.dev',
  'https://zaphiraventas.pages.dev'
]);
const MAX_BODY = 32_768;
const SESSION_ERROR = {ok: false, code: 'sesion', error: 'Tu sesión venció. Volvé a entrar.'};
const PERMISSION_ERROR = {ok: false, error: 'No tenés permiso para hacer esto.'};

function portalCookie(token, age) {
  return `zaphira_ventas_portal=${encodeURIComponent(token)}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
}

function portalToken(request) {
  const match = (request.headers.get('cookie') || '').match(/(?:^|;\s*)zaphira_ventas_portal=([^;]+)/);
  try { return match ? decodeURIComponent(match[1]) : ''; } catch { return ''; }
}

function response(value, origin, status = 200) {
  return Response.json(value, {status, headers: {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin', 'Cache-Control': 'private, no-store'
  }});
}

async function dispatch(input, env) {
  if (input.op === 'login') return login(env.DB, input, env.TOKEN_SECRET);
  const user = await currentUser(env.DB, input.token, env.TOKEN_SECRET);
  if (!user) return SESSION_ERROR;
  switch (input.op) {
    case 'password': return password(env.DB, user, input, env.TOKEN_SECRET);
    case 'data': return dataResponse(env.DB, user);
    case 'objetivos': return objectives(env.DB, user, input.mes);
    case 'xlsx': {
      const raw = await readDataset(env.DB);
      const permitted = user.rol === 'direccion' ? raw : trimToSeller(raw, user.vendedora);
      return permitted ? xlsxResponse(permitted, input) : {ok: false, error: 'No encontramos tus ventas para exportar.'};
    }
    case 'tiendanube':
      if (!canViewTiendaNube(user)) return {ok: false, code: 'permiso', error: 'No tenés permiso para consultar Tiendanube.'};
      return tiendanubeResponse(env.DB, env.TN_ACCESS_TOKEN, input);
    case 'usuarios': return user.rol === 'direccion' ? users(env.DB) : PERMISSION_ERROR;
    case 'reset': return user.rol === 'direccion' ? reset(env.DB, input.usuario) : PERMISSION_ERROR;
    case 'alta': return user.rol === 'direccion' ? addUser(env.DB, input) : PERMISSION_ERROR;
    case 'baja': return user.rol === 'direccion' ? setActive(env.DB, user, input) : PERMISSION_ERROR;
    case 'guardarObjetivos': return user.rol === 'direccion' ? saveObjectives(env.DB, input) : PERMISSION_ERROR;
    default: return {ok: false, error: 'Operación desconocida.'};
  }
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/portal-sso' && request.method === 'GET') {
      const username = await redeemPortalTicket(env.DB, new URL(request.url).searchParams.get('ticket') || '', env.PORTAL_SSO_SECRET);
      if (!username) return new Response('El enlace de ingreso venció o ya se usó.', {status:401, headers:{'Cache-Control':'no-store'}});
      const user = await env.DB.prepare('SELECT * FROM users WHERE usuario=? AND activo=1').bind(username).first();
      if (!user) return new Response('El usuario no tiene acceso a Ventas.', {status:403, headers:{'Cache-Control':'no-store'}});
      const token = await signToken(user, env.TOKEN_SECRET, true);
      return new Response(null, {status:303, headers:{
        Location:'https://zaphiraventas.pages.dev/',
        'Set-Cookie':portalCookie(token, 12*60*60),
        'Cache-Control':'private, no-store',
        'Referrer-Policy':'no-referrer'
      }});
    }
    if (path === '/api/portal-login' && request.method === 'POST') {
      if (request.headers.get('Origin') !== 'https://zaphira.pages.dev') {
        return new Response('Forbidden', {status: 403});
      }
      if (Number(request.headers.get('Content-Length') || 0) > 4096) {
        return new Response('Solicitud demasiado grande.', {status: 413});
      }
      try {
        const form = await request.formData();
        const result = await login(env.DB, {u: String(form.get('username') || ''), p: String(form.get('password') || '')}, env.TOKEN_SECRET);
        const headers = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'};
        if (result.ok) {
          headers.Location = 'https://zaphiraventas.pages.dev/';
          headers['Set-Cookie'] = portalCookie(result.token, 12 * 60 * 60);
        } else {
          headers.Location = 'https://zaphira.pages.dev/?portal=sales&login_error=1';
        }
        return new Response(null, {status: 303, headers});
      } catch {
        return new Response('No se pudo iniciar sesión.', {status: 400});
      }
    }
    if (path === '/api/portal-session' && request.method === 'GET') {
      const token = portalToken(request);
      const user = token && await currentUser(env.DB, token, env.TOKEN_SECRET);
      if (!user) return Response.json({ok: false}, {status: 401, headers: {'Cache-Control': 'private, no-store'}});
      return Response.json({ok: true, session: {
        token, usuario: user.usuario, nombre: user.nombre, rol: user.rol,
        ven: user.vendedora || '', cambiar: !!user.cambiar
      }}, {headers: {'Cache-Control': 'private, no-store'}});
    }
    if (path === '/api/portal-logout' && request.method === 'POST') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== new URL(request.url).origin && origin !== 'https://zaphiraventas.pages.dev') return new Response('Forbidden', {status: 403});
      return Response.json({ok: true}, {headers: {'Cache-Control': 'no-store', 'Set-Cookie': portalCookie('', 0)}});
    }
    if (path === '/internal/sync') {
      if (request.method !== 'POST' || !env.SYNC_SECRET ||
        request.headers.get('Authorization') !== `Bearer ${env.SYNC_SECRET}`) {
        return new Response('Forbidden', {status: 403});
      }
      try { return Response.json({ok: true, ...(await syncSales(env))}, {headers: {'Cache-Control': 'no-store'}}); }
      catch (error) {
        console.error('sales_sync_failed', String(error));
        return Response.json({ok: false, error: 'No se pudo actualizar Odoo.'}, {status: 503});
      }
    }
    if (path !== '/api') return new Response('Not found', {status: 404});
    const origin = request.headers.get('Origin');
    if (!ORIGINS.has(origin)) return new Response('Forbidden', {status: 403});
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: {
      'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin', 'Cache-Control': 'no-store'
    }});
    if (request.method !== 'POST') return response({ok: false, error: 'Método no permitido.'}, origin, 405);
    if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY)
      return response({ok: false, error: 'Solicitud demasiado grande.'}, origin, 413);
    let input;
    try {
      const body = await request.text();
      if (body.length > MAX_BODY) return response({ok: false, error: 'Solicitud demasiado grande.'}, origin, 413);
      input = JSON.parse(body);
      if (!input || typeof input !== 'object' || typeof input.op !== 'string') throw new Error('invalid');
    } catch { return response({ok: false, error: 'Solicitud inválida.'}, origin, 400); }
    try { return response(await dispatch(input, env), origin); }
    catch (error) {
      console.error('sales_api_failed', input.op, String(error));
      return response({ok: false, error: 'No pudimos completar la operación. Probá de nuevo.'}, origin, 503);
    }
  },
  async scheduled(_event, env) {
    try { await syncSales(env); }
    catch (error) { console.error('sales_scheduled_sync_failed', String(error)); throw error; }
  }
};
