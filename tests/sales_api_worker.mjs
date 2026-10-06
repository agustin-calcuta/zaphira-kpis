import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync} from '../api-worker/node_modules/fflate/esm/browser.js';
import worker from '../api-worker/index.mjs';
import {legacyHash, signToken, verifyToken} from '../api-worker/auth.mjs';
import {trimToSeller, readObjectives, objectives, dataResponse, canViewTiendaNube} from '../api-worker/data.mjs';
import {xlsxResponse} from '../api-worker/xlsx.mjs';

const origin = 'https://zaphira-ventas-calcuta.agustin-5e6.workers.dev';
const secret = 'synthetic-test-secret';

test('the migrated hash verifies the unchanged legacy password', async () => {
  const salt = 'synthetic-salt';
  const expected = '20f6db032cdad191a45537d809d75b52fad1224776fee997a23896a173f30f6d';
  assert.equal(await legacyHash('test-password', salt), expected);
});

test('sessions keep the Apps Script token format and reject tampering', async () => {
  const token = await signToken({usuario: 'test', rol: 'vendedora', vendedora: 'Ana'}, secret);
  assert.deepEqual(await verifyToken(token, secret), {usuario: 'test', rol: 'vendedora', vendedora: 'Ana'});
  assert.equal(await verifyToken(token + 'x', secret), null);
});

test('seller data never contains another seller or her name in the dictionary', () => {
  const raw = {dict: {VEN: ['Ana', 'Berta']}, O: [[0, 0], [0, 1]], L: [[0, 1]],
    P: [[0, 0], [0, 1]], C: [[0, 1]]};
  const result = trimToSeller(raw, 'Ana');
  assert.deepEqual(result.dict.VEN, ['Ana']);
  assert.deepEqual(result.O, [[0, 0]]);
  assert.deepEqual(result.L, []);
  assert.deepEqual(result.P, [[0, 0]]);
  assert.deepEqual(result.C, []);
  assert.deepEqual(raw.dict.VEN, ['Ana', 'Berta']);
});

test('Tienda Nube and Yeni have independent goals and seller responses stay private', async () => {
  const rows = [
    {alcance: 'empresa', objetivo: 100000},
    {alcance: '__tiendanube__', objetivo: 60000},
    {alcance: 'Yeni', objetivo: 12000}
  ];
  const db = {prepare: () => ({bind: () => ({all: async () => ({results: rows})})})};
  const admin = await readObjectives(db, '2026-10');
  assert.deepEqual(admin, {empresa: 100000, tiendanube: 60000, vendedoras: {Yeni: 12000}});
  const seller = await objectives(db, {usuario: 'yeni', rol: 'vendedora', vendedora: 'Yeni'}, '2026-10');
  assert.equal(seller.mio, 12000);
  assert.equal(seller.tiendanube, 60000);
  assert.deepEqual(seller.objetivos, {empresa: 0, tiendanube: 0, vendedoras: {}});
});

test('Yeni sees Tienda Nube with her existing account while other sellers remain isolated', async () => {
  const raw = {dict: {VEN: ['Ana', 'Web (Tiendanube)'], CAN: ['Venta directa', 'Web (Tiendanube)']},
    O: [[0, 0], [0, 1]], L: [[0, 0], [0, 1]], P: [], C: []};
  const rows = [{alcance: '__tiendanube__', objetivo: 60000}, {alcance: 'Yeni', objetivo: 12000}];
  const user = {usuario: 'yeni', rol: 'vendedora', vendedora: 'Yeni', activo: 1};
  const db = {prepare: sql => {
    const all = async () => ({results: sql.includes('objetivos') ? rows : [{payload: JSON.stringify(raw)}]});
    return {all, bind: () => ({all})};
  }};
  const result = await dataResponse(db, user);
  assert.equal(result.ok, true);
  assert.equal(result.perfilTiendanube, true);
  assert.deepEqual(result.objetivo, {mes: result.objetivo.mes, mio: 12000, tiendanube: 60000});
  assert.deepEqual(result.raw.dict.VEN, ['Yeni']);
  assert.deepEqual(result.raw.O, []);
  assert.deepEqual(result.raw.L, []);
  assert.deepEqual(raw.O, [[0, 0], [0, 1]]);
  assert.equal(canViewTiendaNube({usuario: 'ana', rol: 'vendedora', vendedora: 'Yeni'}), false);
  const emptyDb = {prepare: sql => {
    const all = async () => ({results: sql.includes('objetivos') ? rows : []});
    return {all, bind: () => ({all})};
  }};
  const withoutOdoo = await dataResponse(emptyDb, user);
  assert.equal(withoutOdoo.ok, true);
  assert.deepEqual(withoutOdoo.raw.dict.VEN, ['Yeni']);
  assert.deepEqual(withoutOdoo.raw.O, []);

  async function callTiendaNube(asUser) {
    const token = await signToken(asUser, secret);
    const fakeDb = {prepare: () => ({bind: () => ({first: async () => asUser})})};
    const response = await worker.fetch(new Request(origin + '/api', {
      method: 'POST', headers: {Origin: origin},
      body: JSON.stringify({op: 'tiendanube', token, from: '2026-10-01', to: '2026-10-06'})
    }), {DB: fakeDb, TOKEN_SECRET: secret});
    return response.json();
  }
  assert.deepEqual(await callTiendaNube(user), {ok: true, configured: false, storeId: '1301166'});
  const other = await callTiendaNube({usuario: 'ana', rol: 'vendedora', vendedora: 'Ana', activo: 1});
  assert.equal(other.code, 'permiso');
});

test('XLSX export is a real workbook with filtered rows', () => {
  const raw = {pull: 'test', rate: 1000, dict: {
    VEN: ['Ana', 'Berta'], MON: ['2026-10'], CAN: ['Venta directa'], TIPO: ['Tradicional'],
    PROV: ['Córdoba'], IND: ['Salud']
  }, meta: {day0: '2026-10-01'}, O: [
    [0, 0, 0, 0, 0, 0, 10000, 0], [0, 1, 0, 0, 0, 0, 20000, 1]
  ]};
  const result = xlsxResponse(raw, {ven: 0, cur: 'ARS'});
  assert.equal(result.ok, true);
  const zip = unzipSync(Uint8Array.from(atob(result.b64), c => c.charCodeAt(0)));
  const orders = new TextDecoder().decode(zip['xl/worksheets/sheet2.xml']);
  assert.match(orders, /Ana/);
  assert.doesNotMatch(orders, /Berta/);
  assert.match(orders, /10000/);
});

test('API only accepts the dashboard origins', async () => {
  const bad = await worker.fetch(new Request(origin + '/api', {
    method: 'POST', headers: {Origin: 'https://evil.example'}, body: '{}'
  }), {});
  assert.equal(bad.status, 403);
  const preflight = await worker.fetch(new Request(origin + '/api', {
    method: 'OPTIONS', headers: {Origin: origin}
  }), {});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
  const pagesOrigin = 'https://zaphiraventas.pages.dev';
  const pagesPreflight = await worker.fetch(new Request(origin + '/api', {
    method: 'OPTIONS', headers: {Origin: pagesOrigin}
  }), {});
  assert.equal(pagesPreflight.status, 204);
  assert.equal(pagesPreflight.headers.get('Access-Control-Allow-Origin'), pagesOrigin);
});
