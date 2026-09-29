/* Tiendanube: sólo lectura; separado del dataset comercial Odoo.
   Configurar TN_ACCESS_TOKEN en Script Properties, nunca en este archivo.
   API del dashboard: op='tiendanube', token de Dirección, from/to YYYY-MM-DD.
   Devuelve agregados sin datos de compradores. No escribe nada en Tiendanube. */
var TN_STORE_ID_ = '1301166';
var TN_BASE_ = 'https://api.tiendanube.com/2025-03/' + TN_STORE_ID_;
var TN_TZ_ = 'America/Argentina/Buenos_Aires';

function tnError_(message) { throw new Error(message); }
function tnDay_(value) {
  var date = new Date(value);
  if (!value || !isFinite(date.getTime())) tnError_('Tiendanube devolvió una fecha inválida.');
  return Utilities.formatDate(date, TN_TZ_, 'yyyy-MM-dd');
}
function tnRange_(d) {
  var valid = function(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(s || '') &&
      isFinite(new Date(s + 'T00:00:00Z').getTime()) &&
      new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
  };
  if (!valid(d.from) || !valid(d.to) || d.from > d.to) tnError_('Elegí un rango de fechas válido.');
  if ((Date.parse(d.to) - Date.parse(d.from)) / 86400000 > 365) tnError_('Consultá hasta 366 días por vez.');
  if (d.to > tnDay_(new Date())) tnError_('La fecha final no puede ser posterior a hoy.');
  return {from: d.from, to: d.to};
}
function tnAuth_(d) {
  var ses = verificarToken_(d.token);
  if (!ses) return {ok: false, code: 'sesion', error: 'Tu sesión venció. Volvé a entrar.'};
  if (!esDireccion_(ses)) return {ok: false, code: 'permiso', error: 'Esta sección está disponible para Dirección.'};
  // Revalidar la cuenta: una sesión antigua no conserva permisos tras una baja.
  var active = filas_(tabUsr_()).some(function(u) {
    return u.usuario === ses.usuario && u.rol === 'direccion' &&
      u.activo !== false && String(u.activo).toUpperCase() !== 'FALSE';
  });
  return active ? null : {ok: false, code: 'permiso', error: 'Tu cuenta no tiene acceso a esta sección.'};
}
function tnFetch_(url, token, deadline) {
  if (url.indexOf(TN_BASE_ + '/') !== 0) tnError_('La API devolvió un enlace de paginación inválido.');
  for (var attempt = 0; attempt < 3; attempt++) {
    if (Date.now() > deadline) tnError_('La consulta demoró demasiado. Probá con un período más corto.');
    var response;
    try {
      response = UrlFetchApp.fetch(url, {method: 'get', followRedirects: false, muteHttpExceptions: true,
        headers: {Authorization: 'Bearer ' + token, 'User-Agent': 'Zaphira Dashboard (https://calcutaconsulting.com)', Accept: 'application/json'}});
    } catch (e) { tnError_('No se pudo conectar con Tiendanube. Volvé a intentar.'); }
    var code = response.getResponseCode();
    if ((code === 429 || code >= 500) && attempt < 2) { Utilities.sleep(1500 * (attempt + 1)); continue; }
    if (code !== 200) {
      var messages = {401: 'La clave de Tiendanube dejó de ser válida.', 402: 'Tiendanube suspendió el acceso por un pago pendiente.',
        403: 'Falta permiso de lectura de pedidos en Tiendanube.', 404: 'Tiendanube no encontró el recurso; no se interpreta como cero registros.',
        422: 'Tiendanube rechazó los parámetros de la consulta.', 429: 'Tiendanube alcanzó su límite de consultas. Reintentá en unos minutos.'};
      tnError_(messages[code] || 'Tiendanube no pudo completar la consulta (HTTP ' + code + ').');
    }
    var body;
    try { body = JSON.parse(response.getContentText()); } catch (e) { tnError_('Tiendanube devolvió una respuesta inválida.'); }
    var headers = {}, rawHeaders = response.getAllHeaders();
    Object.keys(rawHeaders).forEach(function(k) { headers[k.toLowerCase()] = String(rawHeaders[k]); });
    return {body: body, headers: headers};
  }
}
function tnList_(resource, params, token, deadline) {
  var root = TN_BASE_ + '/' + resource + '?';
  params.page = 1; params.per_page = 200;
  var url = root + Object.keys(params).map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
  var rows = [], seen = {}, urls = {}, page = 0, expected = null, received = 0;
  while (url) {
    if (url.indexOf(root) !== 0 || urls[url] || ++page > 50) tnError_('No se pudo completar la paginación de Tiendanube. Acortá el período.');
    urls[url] = true;
    var response = tnFetch_(url, token, deadline), batch = response.body;
    if (!Array.isArray(batch)) tnError_('Tiendanube devolvió una lista inválida.');
    if (page === 1 && response.headers['x-total-count'] != null) {
      expected = Number(response.headers['x-total-count']);
      if (!isFinite(expected) || expected < 0 || expected > 10000) tnError_('El período tiene demasiados registros o un conteo inválido. Acortá el período.');
    }
    received += batch.length;
    batch.forEach(function(row) {
      if (!row || !/^\d+$/.test(String(row.id)) || (row.store_id != null && String(row.store_id) !== TN_STORE_ID_)) tnError_('Tiendanube devolvió un registro inesperado.');
      if (!seen[row.id]) { rows.push(row); seen[row.id] = true; }
    });
    var next = /<([^>]+)>;\s*rel="?next"?/i.exec(response.headers.link || '');
    url = next ? next[1] : '';
    if (url) Utilities.sleep(600);
    else if ((expected != null && (received < expected || rows.length < expected)) || (expected == null && batch.length === 200))
      tnError_('La lista cambió o quedó incompleta durante la consulta. Volvé a intentar.');
  }
  return rows;
}
function tnAmount_(value) {
  if (value == null || value === '' || !/^\d+(\.\d+)?$/.test(String(value))) return null;
  var n = Number(value);
  return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
function tnAggregate_(orders, checkouts, range, now) {
  var summary = {orders: 0, paid: 0, pending: 0, cancelled: 0, refunded: 0, partial: 0, other: 0,
    paidTotalArs: 0, paidUnits: 0, missingAmounts: 0, nonArs: 0};
  var daily = {}, products = {}, origins = {};
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
    if (!daily[day]) daily[day] = {date: day, orders: 0, paid: 0, paidTotalArs: 0, missingAmounts: 0};
    daily[day].orders++;
    if (kind !== 'paid') return;
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
      summary.paidUnits += qty;
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
    abandoned: abandoned, analytics: {available: false, reason: 'Google Analytics 4 todavía no está conectado.'}};
}
function opTiendanube_(d) {
  var denied = tnAuth_(d);
  if (denied) return denied;
  var token = PropertiesService.getScriptProperties().getProperty('TN_ACCESS_TOKEN');
  if (!token) return {ok: true, configured: false, storeId: TN_STORE_ID_};
  var range;
  try { range = tnRange_(d); } catch (e) { return {ok: false, error: e.message}; }
  var fingerprint = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token).map(function(b) { return ('0'+((b+256)%256).toString(16)).slice(-2); }).join('').slice(0,20);
  var key = 'tn-v1-' + fingerprint + '-' + range.from + '-' + range.to;
  var cache = CacheService.getScriptCache(), previous = null;
  try { previous = JSON.parse(cache.get(key) || 'null'); } catch (e) {}
  if (previous && Date.now() - Date.parse(previous.updatedAt) < 300000) return previous;
  try {
    var deadline = Date.now() + 150000;
    var orders = tnList_('orders', {created_at_min: range.from+'T00:00:00-03:00', created_at_max: range.to+'T23:59:59-03:00',
      fields: 'id,store_id,created_at,status,payment_status,currency,total,storefront,products'}, token, deadline);
    Utilities.sleep(600);
    var availableFrom = tnDay_(new Date(Date.now() - 29*86400000));
    var checkouts = range.to < availableFrom ? [] : tnList_('checkouts', {fields: 'id,store_id,created_at,completed_at'}, token, deadline);
    var out = tnAggregate_(orders, checkouts, range, new Date());
    var json = JSON.stringify(out);
    if (json.length < 90000) { try { cache.put(key, json, 21600); } catch (e) {} }
    return out;
  } catch (e) {
    if (previous) { previous.stale = true; previous.warning = String(e.message); return previous; }
    return {ok: false, error: String(e.message || 'No se pudo consultar Tiendanube.')};
  }
}
