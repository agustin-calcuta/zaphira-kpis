// Aggregation functions preserved from the published Tiendanube Apps Script implementation.
const TN_STORE_ID_ = '1301166';
function tnError_(message) { throw new Error(message); }
function tnDay_(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) tnError_('Tiendanube devolvió una fecha inválida.');
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires', year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(date).map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function tnAmount_(value) {
  if (value == null || value === '' || !/^\d+(\.\d+)?$/.test(String(value))) return null;
  var n = Number(value);
  return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
function tnCouponCodes_(order) {
  if (!Array.isArray(order.coupon)) return [];
  return order.coupon.map(function(c) {
    var code = typeof c === 'string' ? c : c && typeof c.code === 'string' ? c.code : '';
    return code.trim().slice(0, 100);
  }).filter(function(code) { return !!code; });
}
// El pedido trae coupon_id, pero el código puede requerir consultar el catálogo de cupones.
// Si la app no tiene ese permiso, el resto del informe sigue disponible y el detalle lo indica.
function tnCommerce_(orders, now, couponCodes) {
  var providers = Object.create(null), shipping = Object.create(null), daily = Object.create(null);
  var out = {discountOrders: 0, discountKnown: 0, couponOrders: 0, couponKnown: 0,
    awaitingDispatch: 0, awaitingDispatch7Days: 0, shippingKnown: 0, discountCases: []};
  var shippingStates = ['unpacked', 'unshipped', 'partially_packed', 'partially_fulfilled', 'shipped', 'delivered'];
  orders.forEach(function(o) {
    var day = tnDay_(o.created_at);
    if (!daily[day]) daily[day] = {date: day, paid: 0, paidTotalArs: 0, missingAmounts: 0};
    daily[day].paid++;
    var discount = tnAmount_(o.discount);
    if (discount != null) { out.discountKnown++; if (discount > 0) out.discountOrders++; }
    if (discount == null || o.currency !== 'ARS') daily[day].missingAmounts++;
    else daily[day].paidTotalArs += discount;
    // coupon_id=null significa que no hubo cupón; un campo ausente no se interpreta como cero.
    if (o.coupon_id === null || (/^\d+$/.test(String(o.coupon_id)) && Number(o.coupon_id) > 0)) {
      out.couponKnown++; if (o.coupon_id !== null) out.couponOrders++;
    }
    var couponId = /^[1-9]\d*$/.test(String(o.coupon_id)) ? String(o.coupon_id) : null;
    var codes = tnCouponCodes_(o);
    if (!codes.length && couponId && couponCodes && couponCodes[couponId]) codes = [couponCodes[couponId]];
    if (discount > 0 || couponId || codes.length) out.discountCases.push({
      orderId: String(o.id), orderNumber: o.number == null ? null : String(o.number).slice(0, 30),
      date: day, couponId: couponId, couponCodes: codes,
      discountArs: o.currency === 'ARS' ? discount : null,
      couponDiscountArs: o.currency === 'ARS' ? tnAmount_(o.discount_coupon) : null
    });
    var provider = o.gateway === 'internal' ? 'Marcado manualmente' : String(o.gateway_name || o.gateway || 'Sin identificar').slice(0, 100);
    providers[provider] = (providers[provider] || 0) + 1;
    var state = o.has_shippable_products === false ? 'not_required'
      : shippingStates.indexOf(o.shipping_status) >= 0 ? o.shipping_status : 'unknown';
    shipping[state] = (shipping[state] || 0) + 1;
    if (state !== 'unknown') out.shippingKnown++;
    if (['unpacked', 'unshipped', 'partially_packed', 'partially_fulfilled'].indexOf(state) >= 0) {
      out.awaitingDispatch++;
      if (now.getTime() - Date.parse(o.created_at) >= 7 * 86400000) out.awaitingDispatch7Days++;
    }
  });
  out.discountDaily = Object.keys(daily).sort().map(function(k) { return daily[k]; });
  out.providers = Object.keys(providers).map(function(k) { return {name: k, orders: providers[k]}; }).sort(function(a,b) { return b.orders-a.orders; });
  out.shipping = Object.keys(shipping).map(function(k) { return {name: k, orders: shipping[k]}; }).sort(function(a,b) { return b.orders-a.orders; });
  out.discountCases.sort(function(a,b) { return b.date.localeCompare(a.date) || Number(b.orderId)-Number(a.orderId); });
  return out;
}
function tnAggregate_(orders, checkouts, range, now, couponCodes) {
  var summary = {orders: 0, paid: 0, pending: 0, cancelled: 0, refunded: 0, partial: 0, other: 0,
    paidTotalArs: 0, paidUnits: 0, missingAmounts: 0, nonArs: 0};
  var daily = {}, products = {}, origins = {}, paidOrders = [];
  orders.forEach(function(o) {
    var day = tnDay_(o.created_at);
    if (day < range.from || day > range.to) return;
    var origin = String(o.storefront || 'sin identificar');
    origins[origin] = (origins[origin] || 0) + 1;
    summary.orders++;
    var kind = o.status === 'cancelled' ? 'cancelled' : o.payment_status === 'paid' ? 'paid'
      : ['pending', 'authorized'].indexOf(o.payment_status) >= 0 ? 'pending'
      : ['partially_paid', 'partially_refunded'].indexOf(o.payment_status) >= 0 ? 'partial'
      : ['refunded', 'voided'].indexOf(o.payment_status) >= 0 ? 'refunded' : 'other';
    summary[kind]++;
    if (!daily[day]) daily[day] = {date: day, orders: 0, paid: 0, paidTotalArs: 0, paidUnits: 0, missingAmounts: 0};
    daily[day].orders++;
    if (kind !== 'paid') return;
    paidOrders.push(o);
    daily[day].paid++;
    var amount = tnAmount_(o.total);
    if (o.currency !== 'ARS' || amount == null) {
      summary.missingAmounts++; daily[day].missingAmounts++;
      if (o.currency !== 'ARS') summary.nonArs++;
    } else { summary.paidTotalArs += amount; daily[day].paidTotalArs += amount; }
    if (!Array.isArray(o.products)) tnError_('Faltan las líneas de un pedido pagado.');
    o.products.forEach(function(p) {
      var qty = Number(p.quantity);
      if (!isFinite(qty) || qty < 0 || !Number.isInteger(qty)) tnError_('Tiendanube devolvió una cantidad inválida.');
      summary.paidUnits += qty; daily[day].paidUnits += qty;
      var key = String(p.product_id || p.name || 'sin-producto');
      if (!products[key]) products[key] = {name: String(p.name_without_variants || p.name || 'Producto').slice(0, 200), units: 0};
      products[key].units += qty;
    });
  });
  var availableFrom = tnDay_(new Date(now.getTime() - 29 * 86400000));
  var abandoned = {count: 0, availableFrom: availableFrom, from: range.from < availableFrom ? availableFrom : range.from,
    to: range.to, partialCoverage: range.from < availableFrom, noCoverage: range.to < availableFrom, observedAt: now.toISOString()};
  checkouts.forEach(function(c) {
    var day = tnDay_(c.created_at);
    if (day >= abandoned.from && day <= range.to && !c.completed_at) abandoned.count++;
  });
  if (abandoned.noCoverage) abandoned.count = null;
  return {ok: true, configured: true, storeId: TN_STORE_ID_, updatedAt: now.toISOString(), source: 'Tiendanube',
    range: range, summary: summary, daily: Object.keys(daily).sort().map(function(k) { return daily[k]; }),
    origins: Object.keys(origins).map(function(k) { return {name: k, orders: origins[k]}; }),
    products: Object.keys(products).map(function(k) { return products[k]; }).sort(function(a,b) { return b.units-a.units; }).slice(0,10),
    abandoned: abandoned, commerce: tnCommerce_(paidOrders, now, couponCodes), analytics: {available: false, reason: 'Google Analytics 4 todavía no está conectado.'}};
}

const API_BASE = `https://api.tiendanube.com/2025-03/${TN_STORE_ID_}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function validRange(input) {
  const valid = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') &&
    !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
  if (!valid(input.from) || !valid(input.to) || input.from > input.to)
    tnError_('Elegí un rango de fechas válido.');
  if ((Date.parse(input.to) - Date.parse(input.from)) / 86400000 > 365)
    tnError_('Consultá hasta 366 días por vez.');
  if (input.to > tnDay_(new Date())) tnError_('La fecha final no puede ser posterior a hoy.');
  return {from: input.from, to: input.to};
}

async function fetchPage(url, token, deadline) {
  if (!url.startsWith(API_BASE + '/')) tnError_('La API devolvió un enlace de paginación inválido.');
  for (let attempt = 0; attempt < 3; attempt++) {
    if (Date.now() > deadline) tnError_('La consulta demoró demasiado. Probá con un período más corto.');
    let response;
    try {
      response = await fetch(url, {headers: {
        Authorization: `Bearer ${token}`, 'User-Agent': 'Zaphira Dashboard (https://calcutaconsulting.com)',
        Accept: 'application/json'
      }, redirect: 'manual'});
    } catch { tnError_('No se pudo conectar con Tiendanube. Volvé a intentar.'); }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await sleep(1500 * (attempt + 1)); continue;
    }
    if (response.status !== 200) {
      const messages = {401: 'La clave de Tiendanube dejó de ser válida.', 402: 'Tiendanube suspendió el acceso por un pago pendiente.',
        403: 'Falta permiso de lectura de pedidos en Tiendanube.', 404: 'Tiendanube no encontró el recurso; no se interpreta como cero registros.',
        422: 'Tiendanube rechazó los parámetros de la consulta.', 429: 'Tiendanube alcanzó su límite de consultas. Reintentá en unos minutos.'};
      tnError_(messages[response.status] || `Tiendanube no pudo completar la consulta (HTTP ${response.status}).`);
    }
    let body;
    try { body = await response.json(); } catch { tnError_('Tiendanube devolvió una respuesta inválida.'); }
    return {body, headers: response.headers};
  }
}

async function list(resource, params, token, deadline) {
  const root = `${API_BASE}/${resource}?`;
  const query = new URLSearchParams({...params, page: '1', per_page: '200'});
  let url = root + query.toString(), page = 0, expected = null, received = 0;
  const rows = [], seen = new Set(), urls = new Set();
  while (url) {
    if (!url.startsWith(root) || urls.has(url) || ++page > 50)
      tnError_('No se pudo completar la paginación de Tiendanube. Acortá el período.');
    urls.add(url);
    const response = await fetchPage(url, token, deadline), batch = response.body;
    if (!Array.isArray(batch)) tnError_('Tiendanube devolvió una lista inválida.');
    if (page === 1 && response.headers.get('x-total-count') != null) {
      expected = Number(response.headers.get('x-total-count'));
      if (!Number.isFinite(expected) || expected < 0 || expected > 10000)
        tnError_('El período tiene demasiados registros o un conteo inválido. Acortá el período.');
    }
    received += batch.length;
    for (const row of batch) {
      if (!row || !/^\d+$/.test(String(row.id)) || (row.store_id != null && String(row.store_id) !== TN_STORE_ID_))
        tnError_('Tiendanube devolvió un registro inesperado.');
      if (!seen.has(row.id)) { rows.push(row); seen.add(row.id); }
    }
    const next = /<([^>]+)>;\s*rel="?next"?/i.exec(response.headers.get('link') || '');
    url = next ? next[1] : '';
    if (url) await sleep(600);
    else if ((expected != null && (received < expected || rows.length < expected)) ||
      (expected == null && batch.length === 200))
      tnError_('La lista cambió o quedó incompleta durante la consulta. Volvé a intentar.');
  }
  return rows;
}

async function couponCodeMap(orders, range, token, deadline) {
  const missing = new Set();
  for (const order of orders) {
    if (order.status === 'cancelled' || order.payment_status !== 'paid' ||
      tnDay_(order.created_at) < range.from || tnDay_(order.created_at) > range.to ||
      tnCouponCodes_(order).length) continue;
    if (/^[1-9]\d*$/.test(String(order.coupon_id))) missing.add(String(order.coupon_id));
  }
  const codes = {};
  if (!missing.size) return codes;
  try {
    for (const coupon of await list('coupons', {fields: 'id,code'}, token, deadline)) {
      if (missing.has(String(coupon.id)) && typeof coupon.code === 'string' && coupon.code.trim())
        codes[String(coupon.id)] = coupon.code.trim().slice(0, 100);
    }
  } catch { /* Coupons are optional; orders still have valid data. */ }
  return codes;
}

export async function tiendanubeResponse(db, token, input) {
  if (!token) return {ok: true, configured: false, storeId: TN_STORE_ID_};
  let range;
  try { range = validRange(input); } catch (error) { return {ok: false, error: error.message}; }
  const key = `${range.from}|${range.to}`;
  const cached = await db.prepare('SELECT payload,updated_at FROM tiendanube_cache WHERE cache_key = ?').bind(key).first();
  if (cached && Date.now() - cached.updated_at < 300_000) return JSON.parse(cached.payload);
  try {
    const deadline = Date.now() + 150_000;
    const orders = await list('orders', {
      created_at_min: `${range.from}T00:00:00-03:00`, created_at_max: `${range.to}T23:59:59-03:00`,
      fields: 'id,number,store_id,created_at,status,payment_status,currency,total,storefront,products,discount,discount_coupon,coupon,coupon_id,gateway,gateway_name,shipping_status,has_shippable_products'
    }, token, deadline);
    await sleep(600);
    const availableFrom = tnDay_(new Date(Date.now() - 29 * 86400000));
    const checkouts = range.to < availableFrom ? [] : await list('checkouts', {
      fields: 'id,store_id,created_at,completed_at'
    }, token, deadline);
    const coupons = await couponCodeMap(orders, range, token, deadline);
    const out = tnAggregate_(orders, checkouts, range, new Date(), coupons);
    const payload = JSON.stringify(out);
    if (payload.length < 90000) {
      await db.prepare('INSERT INTO tiendanube_cache (cache_key,payload,updated_at) VALUES (?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at')
        .bind(key, payload, Date.now()).run();
    }
    return out;
  } catch (error) {
    if (cached) return {...JSON.parse(cached.payload), stale: true, warning: String(error.message)};
    return {ok: false, error: String(error.message || 'No se pudo consultar Tiendanube.')};
  }
}
