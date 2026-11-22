import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync} from '../api-worker/node_modules/fflate/esm/browser.js';
import worker from '../api-worker/index.mjs';
import {currentUser, legacyHash, login, password, reset, signToken, updateUserScope, users, verifyToken} from '../api-worker/auth.mjs';
import {trimToSeller, readObjectives, objectives, dataResponse, canViewTiendaNube} from '../api-worker/data.mjs';
import {xlsxResponse} from '../api-worker/xlsx.mjs';
import {buildData_} from '../api-worker/odoo-build.mjs';

const origin = 'https://zaphira-ventas-calcuta.agustin-5e6.workers.dev';
const secret = 'synthetic-test-secret';

test('order classification comes only from the linked CRM opportunity', () => {
  const orders = [
    {id: 1, date_order: '2026-10-10 12:00:00', amount_total: 100, opportunity_id: [11, 'A']},
    {id: 2, date_order: '2026-10-10 12:00:00', amount_total: 200, opportunity_id: [12, 'B']},
    {id: 3, date_order: '2026-10-10 12:00:00', amount_total: 300},
    {id: 4, date_order: '2026-10-10 12:00:00', amount_total: 400, opportunity_id: [13, 'C']}
  ];
  const crm = [
    {id: 11, x_studio_pedido_nuevo_reposicin: 'Pedido nuevo'},
    {id: 12, x_studio_pedido_nuevo_reposicin: 'Reposición Parcial'},
    {id: 13, x_studio_pedido_nuevo_reposicin: false}
  ];
  const raw = buildData_(orders, {}, {}, [], {}, crm, [], {}, [],
    {usd: {venta: 0}, usdMon: {}, orderClassSource: 'crm'});
  assert.deepEqual(raw.O.map(order => order[8]), [1, 0, null, null]);
  assert.equal(raw.meta.orderClassSource, 'crm');
});

test('Odoo industries are stored in Spanish for the dashboard and Excel', () => {
  const names = ['Other Services', 'Wholesale/Retail', 'Public Administration',
    'Health/Social', 'Manufacturing', 'Extraterritorial', 'Finance/Insurance',
    'Energy supply', 'Entertainment', 'Food/Hospitality'];
  const expected = ['Otros servicios', 'Comercio mayorista y minorista', 'Administración pública',
    'Salud y servicios sociales', 'Industria manufacturera', 'Organismos extraterritoriales',
    'Finanzas y seguros', 'Suministro de energía', 'Entretenimiento', 'Gastronomía y hotelería'];
  const orders = names.map((_, i) => ({id: i + 1, date_order: '2026-10-10 12:00:00',
    amount_total: 100, partner_id: [i + 1, `Client ${i + 1}`]}));
  const partners = Object.fromEntries(names.map((name, i) => [i + 1,
    {industry_id: [i + 1, name]}]));
  const raw = buildData_(orders, {}, partners, [], {}, [], [], {}, [],
    {usd: {venta: 0}, usdMon: {}});
  assert.deepEqual(raw.dict.IND, expected);
});

test('CRM rubro fills missing customer industry without guessing across conflicting leads', () => {
  const date_order = '2026-10-10 12:00:00';
  const orders = [
    {id: 1, date_order, amount_total: 100, partner_id: [1, 'A'], opportunity_id: [11, 'Lead']},
    {id: 2, date_order, amount_total: 200, partner_id: [1, 'A']},
    {id: 3, date_order, amount_total: 300, partner_id: [2, 'B']},
    {id: 4, date_order, amount_total: 400, partner_id: [3, 'C'], opportunity_id: [14, 'Lead']}
  ];
  const partners = {1: {industry_id: false}, 2: {industry_id: false},
    3: {industry_id: [5, 'Manufacturing']}};
  const crm = [
    {id: 11, partner_id: [1, 'A'], rubro: 'Sanidad (hospital, obra social)'},
    {id: 12, partner_id: [2, 'B'], rubro: 'Servicios'},
    {id: 13, partner_id: [2, 'B'], rubro: 'Comercio'},
    {id: 14, partner_id: [3, 'C'], rubro: 'Sanidad'}
  ];
  const raw = buildData_(orders, {}, partners, [], {}, crm, [], {}, [],
    {usd: {venta: 0}, usdMon: {}, crmIndustryField: 'rubro'});
  assert.deepEqual(raw.O.map(order => raw.dict.IND[order[5]]),
    ['Salud y servicios sociales', 'Salud y servicios sociales',
      '(sin industria)', 'Industria manufacturera']);
  assert.equal(raw.meta.industryCrmCount, 2);
  assert.equal(raw.meta.industryCov, 2 / 3);
});

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

test('portal session preserves the seller scope and leaves the local password flag intact', async () => {
  const user = {usuario: 'test', rol: 'vendedora', vendedora: 'Ana', activo: 1, cambiar: 1};
  const db = {prepare: () => ({bind: () => ({first: async () => user})})};
  const direct = await signToken(user, secret);
  const fromPortal = await signToken(user, secret, true);
  assert.equal((await currentUser(db, direct, secret)).cambiar, 1);
  assert.deepEqual(await currentUser(db, fromPortal, secret), {...user, cambiar: 0});
  assert.equal(user.cambiar, 1);
});

test('mica-only accounts accept the portal session and manage their password only in mica', async () => {
  const user = {usuario:'caro', nombre:'Carolina', rol:'direccion', vendedora:'', activo:1, cambiar:1, portal_only:1};
  const db = {prepare: () => ({bind: () => ({first:async () => user}),all:async () => ({results:[user]})})};
  assert.equal(await currentUser(db,await signToken(user,secret),secret),null);
  const session = await currentUser(db,await signToken(user,secret,true),secret);
  assert.equal(session.cambiar,0);
  assert.equal(session.portal_only,1);
  assert.equal((await login(db,{u:'caro',p:'example'},secret)).ok,false);
  assert.equal((await password(db,session,{},secret)).ok,false);
  assert.equal((await reset(db,'caro')).ok,false);
  const account = (await users(db)).usuarios[0];
  assert.equal(account.portalOnly,true);
  assert.equal(account.debeCambiar,false);
});

test('changing a sales scope updates only the role and seller identity', async () => {
  const calls = [];
  const db = {prepare: sql => ({bind: (...parameters) => ({run: async () => {
    calls.push([sql,parameters]);
    return {meta:{changes:1}};
  }})})};
  const actor = {usuario:'calcuta'};
  assert.equal((await updateUserScope(db,actor,{usuario:'calcuta',rol:'vendedora',vendedora:'Ana'})).ok,false);
  assert.equal((await updateUserScope(db,actor,{usuario:'ana',rol:'vendedora'})).ok,false);
  assert.equal((await updateUserScope(db,actor,{usuario:'ana',rol:'admin'})).ok,false);
  assert.equal((await updateUserScope(db,actor,{usuario:'ana',rol:'vendedora',vendedora:'<Ana>'})).ok,false);
  assert.deepEqual(await updateUserScope(db,actor,{usuario:'ana',rol:'vendedora',vendedora:' Ana '}),{ok:true});
  assert.deepEqual(calls,[['UPDATE users SET rol = ?, vendedora = ? WHERE usuario = ?',['vendedora','Ana','ana']]]);
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

test('a new seller can open an empty dashboard before any sales are synced for them', async () => {
  const raw = {dict:{VEN:['Ana'],MON:['2026-11']},O:[[0,0]],L:[[0,0]],P:[[0,0]],C:[[0,0]]};
  const db = {prepare: sql => ({
    all:async () => ({results:sql.includes('dataset') ? [{payload:JSON.stringify(raw)}] : []}),
    bind:() => ({all:async () => ({results:[]})})
  })};
  const user = {usuario:'nueva',rol:'vendedora',vendedora:'Nueva vendedora'};
  const result = await dataResponse(db,user);
  assert.equal(result.ok,true);
  assert.equal(result.perfilTiendanube,false);
  assert.deepEqual(result.raw,{O:[],L:[],P:[],C:[],dict:{VEN:['Nueva vendedora']}});
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
