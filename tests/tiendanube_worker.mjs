import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tnAggregate_} from '../api-worker/tiendanube.mjs';

const range = {from: '2026-10-01', to: '2026-10-31'};
const now = new Date('2026-10-21T18:00:00Z');
const paid = (id, products) => ({
  id, created_at: '2026-10-20T18:00:00Z', status: 'open', payment_status: 'paid',
  currency: 'ARS', total: '100', products
});

test('custom combo SKU separates shopping items, combos and physical garments', () => {
  const out = tnAggregate_([
    paid(1, [
      {product_id: 10, name: '2 camisas + pantalón', sku: '877799652|877799654|877799125|', quantity: 2},
      {product_id: 11, name: 'Camisa', sku: 'EH5004PBLANCO#38', quantity: 1}
    ])
  ], [], range, now);
  assert.equal(out.summary.paidUnits, 3);
  assert.equal(out.summary.comboUnits, 2);
  assert.equal(out.summary.garmentUnits, 7);
  assert.deepEqual([out.daily[0].paidUnits, out.daily[0].comboUnits, out.daily[0].garmentUnits], [3, 2, 7]);
  assert.equal(out.summary.paidTotalArs, 100);
  assert.equal(out.products.find(p => p.name === '2 camisas + pantalón').units, 2);
});

test('native Tiendanube kit components count as one purchased item', () => {
  const out = tnAggregate_([paid(2, [
    {product_id: 21, name: 'Camisa', quantity: 2, order_kit_id: 45, catalog_kit_id: 80, kit: {name: 'Kit tres prendas'}},
    {product_id: 22, name: 'Pantalón', quantity: 1, order_kit_id: 45, catalog_kit_id: 80, kit: {name: 'Kit tres prendas'}}
  ])], [], range, now);
  assert.equal(out.summary.paidUnits, 1);
  assert.equal(out.summary.comboUnits, 1);
  assert.equal(out.summary.garmentUnits, 3);
  assert.deepEqual(out.products, [{name: 'Kit tres prendas', units: 1}]);
});
