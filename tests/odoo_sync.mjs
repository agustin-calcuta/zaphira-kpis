import {test} from 'node:test';
import assert from 'node:assert/strict';
import {syncSales} from '../api-worker/odoo-sync.mjs';

test('sync reads the CRM classification and excludes cancelled orders and lines', async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [];
  const requests = [];
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          return {run: async () => {
            if (sql.startsWith('INSERT INTO dataset')) chunks[values[0]] = values[1];
          }};
        },
        first: async () => null,
        run: async () => {}
      };
    },
    async batch(statements) {
      for (const statement of statements) if (statement.run) await statement.run();
    }
  };
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('dolarapi.com')) return Response.json({venta: 1000});
    if (String(url).includes('argentinadatos.com')) return Response.json([]);
    const body = JSON.parse(options.body);
    if (body.params.service === 'common') return Response.json({result: 1});
    const [, , , model, method, args, kwargs] = body.params.args;
    requests.push({model, method, args, kwargs});
    let result = [];
    if (method === 'fields_get' && model === 'sale.order') result = {opportunity_id: {type: 'many2one'}};
    if (method === 'fields_get' && model === 'crm.lead') result = {
      x_studio_pedido_nuevo_reposicin: {type: 'selection'}};
    if (method === 'search_read' && model === 'sale.order') result = [{
      id: 101, state: 'sale', date_order: '2026-10-10 12:00:00', amount_total: 1000,
      user_id: [7, 'Ana'], type_id: [1, 'Tradicional'], opportunity_id: [11, 'Lead']
    }];
    if (method === 'search_read' && model === 'crm.lead') result = [{
      id: 11, user_id: [7, 'Ana'], create_date: '2026-10-01 12:00:00', active: true,
      x_studio_pedido_nuevo_reposicin: 'Pedido nuevo'
    }];
    return Response.json({result});
  };
  try {
    const summary = await syncSales({ODOO_URL: 'https://odoo.example', ODOO_DB: 'test',
      ODOO_USER: 'test', ODOO_PASSWORD: 'test', DATA_FROM: '2026-03-01', DB: db});
    assert.equal(summary.orders, 1);
    const raw = JSON.parse(chunks.join(''));
    assert.equal(raw.meta.orderClassSource, 'crm');
    assert.equal(raw.O[0][8], 1);
    const orders = requests.find(request => request.model === 'sale.order' && request.method === 'search_read');
    const lines = requests.find(request => request.model === 'sale.order.line' && request.method === 'search_read');
    assert.deepEqual(orders.args[0][0], ['state', 'in', ['sale', 'done']]);
    assert.deepEqual(lines.args[0][0], ['order_id.state', 'in', ['sale', 'done']]);
    const crm = requests.find(request => request.model === 'crm.lead' && request.method === 'search_read');
    assert.ok(crm.kwargs.fields.includes('x_studio_pedido_nuevo_reposicin'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
