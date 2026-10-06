import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync} from '../api-worker/node_modules/fflate/esm/browser.js';
import worker from '../api-worker/index.mjs';
import {legacyHash, signToken, verifyToken} from '../api-worker/auth.mjs';
import {trimToSeller} from '../api-worker/data.mjs';
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

test('API only accepts the two dashboard origins', async () => {
  const bad = await worker.fetch(new Request(origin + '/api', {
    method: 'POST', headers: {Origin: 'https://evil.example'}, body: '{}'
  }), {});
  assert.equal(bad.status, 403);
  const preflight = await worker.fetch(new Request(origin + '/api', {
    method: 'OPTIONS', headers: {Origin: origin}
  }), {});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
});
