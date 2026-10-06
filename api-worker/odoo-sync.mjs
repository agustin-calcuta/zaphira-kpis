import {buildData_} from './odoo-build.mjs';
import {writeDataset} from './data.mjs';

const CONFIRMED = ['sale', 'done'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchJson(url, options = {}, attempts = 2) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url, {...options, signal: AbortSignal.timeout(30_000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) { last = error; if (i + 1 < attempts) await sleep(500); }
  }
  throw last;
}

function odooClient(env) {
  if (!env.ODOO_USER || !env.ODOO_PASSWORD) throw new Error('Faltan credenciales de Odoo.');
  let uid;
  const rpc = async (service, method, args) => {
    const result = await fetchJson(`${env.ODOO_URL}/jsonrpc`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', method: 'call', params: {service, method, args}, id: 1})
    });
    if (result.error) throw new Error(`Odoo RPC ${service}.${method}: ${JSON.stringify(result.error).slice(0, 300)}`);
    return result.result;
  };
  const execute = async (model, method, args = [], kwargs = {}) => {
    if (!uid) {
      uid = await rpc('common', 'authenticate', [env.ODOO_DB, env.ODOO_USER, env.ODOO_PASSWORD, {}]);
      if (!uid) throw new Error('Odoo: autenticación fallida.');
    }
    return rpc('object', 'execute_kw', [env.ODOO_DB, uid, env.ODOO_PASSWORD, model, method, args, kwargs]);
  };
  const searchRead = (model, domain, fields, extra = {}) =>
    execute(model, 'search_read', [domain], {fields, ...extra});
  const paged = async (model, domain, fields, pageSize = 2000, extra = {}) => {
    const out = [];
    for (let offset = 0; ; offset += pageSize) {
      const batch = await searchRead(model, domain, fields, {...extra, limit: pageSize, offset});
      out.push(...batch);
      if (batch.length < pageSize) return out;
    }
  };
  const readIds = async (model, ids, fields) => {
    const out = [];
    for (let i = 0; i < ids.length; i += 500) {
      out.push(...await execute(model, 'read', [ids.slice(i, i + 500)], {fields}));
    }
    return out;
  };
  return {execute, searchRead, paged, readIds};
}

function dayNum(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

async function fetchUsd(db) {
  let usd;
  try {
    const d = await fetchJson('https://dolarapi.com/v1/dolares/oficial');
    if (d?.venta) usd = {compra: +d.compra, venta: +d.venta,
      fuente: 'Banco Nación (dolarapi)', fecha: d.fechaActualizacion || ''};
  } catch { /* Bluelytics fallback below. */ }
  if (!usd) {
    try {
      const d = await fetchJson('https://api.bluelytics.com.ar/v2/latest');
      if (d?.oficial) usd = {compra: +d.oficial.value_buy, venta: +d.oficial.value_sell,
        fuente: 'Oficial (bluelytics)', fecha: ''};
    } catch { /* Preserve the last rate if both sources fail. */ }
  }
  const cache = await db.prepare('SELECT payload,updated_at FROM usd_cache WHERE id = 1').first();
  const previous = cache ? JSON.parse(cache.payload) : {};
  if (!usd) usd = previous.usd || {compra: 0, venta: 0, fuente: 'sin cotización', fecha: ''};
  let usdMon = previous.usdMon || {}, usdDay = previous.usdDay || {};
  let historyAt = cache?.updated_at || 0;
  if (!cache || Date.now() - cache.updated_at > 20 * 3600_000) {
    try {
      const arr = await fetchJson('https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial');
      if (Array.isArray(arr) && arr.length) {
        const byMon = {};
        for (const d of arr) {
          if (!d?.fecha || d.venta == null) continue;
          const mon = String(d.fecha).slice(0, 7);
          if (!byMon[mon]) byMon[mon] = {sum: 0, n: 0};
          byMon[mon].sum += Number(d.venta); byMon[mon].n++;
        }
        usdMon = {...usdMon};
        for (const [mon, value] of Object.entries(byMon)) usdMon[mon] = Math.round(value.sum / value.n);
        const base = Math.floor((Date.now() - 500 * 86400000) / 86400000);
        const v = [];
        for (const d of arr) {
          if (!d?.fecha || d.venta == null) continue;
          const i = dayNum(d.fecha) - base;
          if (i >= 0 && i < 505) v[i] = Math.round(Number(d.venta));
        }
        for (let i = 0; i < v.length; i++) if (v[i] == null) v[i] = 0;
        usdDay = {from: new Date(base * 86400000).toISOString().slice(0, 10), v};
        historyAt = Date.now();
      }
    } catch { /* Last complete series remains available. */ }
  }
  await db.prepare('INSERT INTO usd_cache (id,payload,updated_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at')
    .bind(JSON.stringify({usd, usdMon, usdDay}), historyAt).run();
  return {usd, usdMon, usdDay};
}

export async function syncSales(env) {
  const odoo = odooClient(env);
  const orderFields = ['name', 'date_order', 'commitment_date', 'partner_id', 'user_id', 'type_id',
    'amount_total', 'amount_untaxed', 'invoice_status', 'delivery_status'];
  try {
    const definitions = await odoo.execute('sale.order', 'fields_get', [], {attributes: ['type']});
    if (definitions?.opportunity_id) orderFields.push('opportunity_id');
  } catch { /* Some Odoo versions omit the optional relation. */ }
  let orders = await odoo.searchRead('sale.order',
    [['state', 'in', CONFIRMED], ['date_order', '>=', env.DATA_FROM]], orderFields);
  const excluded = String(env.EXCLUDE_VEND || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (excluded.length) orders = orders.filter(o => !excluded.includes(String(o.user_id?.[1] || '').toLowerCase()));

  const ordDate = Object.fromEntries(orders.map(o => [o.id, o.date_order]));
  const partnerIds = [...new Set(orders.map(o => o.partner_id?.[0]).filter(Boolean))];
  const pinfo = Object.fromEntries((await odoo.readIds('res.partner', partnerIds,
    ['state_id', 'city', 'industry_id', 'create_date'])).map(p => [p.id, p]));
  const lines = await odoo.paged('sale.order.line',
    [['order_id.state', 'in', CONFIRMED], ['order_id.date_order', '>=', env.DATA_FROM], ['product_id', '!=', false]],
    ['order_id', 'product_id', 'product_uom_qty', 'qty_delivered', 'price_subtotal', 'price_total']);
  const productIds = [...new Set(lines.map(l => l.product_id?.[0]).filter(Boolean))];
  const catOf = Object.fromEntries((await odoo.readIds('product.product', productIds, ['categ_id']))
    .map(p => [p.id, p.categ_id?.[1] || '(sin)']));

  const stageInfo = {}, stageOrder = [];
  try {
    const stages = await odoo.searchRead('crm.stage', [], ['name', 'is_won', 'sequence'],
      {context: {lang: 'es_AR'}});
    for (const s of stages) {
      stageInfo[s.id] = {won: !!s.is_won, sequence: Number(s.sequence) || 0, name: s.name || ''};
      stageOrder.push({name: s.name || '', sequence: Number(s.sequence) || 0, id: s.id});
    }
    stageOrder.sort((a, b) => a.sequence - b.sequence || a.id - b.id);
  } catch { /* CRM graph can still render with stage names alone. */ }

  let crm = [];
  try {
    const definitions = await odoo.execute('crm.lead', 'fields_get', [], {attributes: ['type']});
    const fields = ['user_id', 'stage_id', 'create_date', 'active'];
    for (const field of ['date_closed', 'date_conversion', 'type', 'lost_reason_id']) {
      if (definitions?.[field]) fields.push(field);
    }
    crm = await odoo.paged('crm.lead', [], fields, 2000,
      {context: {active_test: false, lang: 'es_AR'}});
  } catch { /* Keep sales data available if the optional CRM model fails. */ }
  let pick = [];
  try {
    pick = await odoo.searchRead('stock.picking', [['picking_type_code', '=', 'outgoing']],
      ['state', 'sale_id', 'date_done']);
  } catch { /* Shipping graph can render empty. */ }

  const usd = await fetchUsd(env.DB);
  const raw = buildData_(orders, ordDate, pinfo, lines, catOf, crm, pick, stageInfo, stageOrder, usd);
  await writeDataset(env.DB, raw);
  return {pull: raw.pull, orders: raw.O.length, lines: raw.L.length, crm: raw.C.length};
}
