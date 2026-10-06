import {login, currentUser, password, users, reset, addUser, setActive} from './auth.mjs';
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
