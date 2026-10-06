// Published Apps Script dataset logic, ported without changing the KPI rules.
const TZ = 'America/Argentina/Buenos_Aires';
const DATA_FROM = '2026-03-01';
function formatDate(date, zone, pattern) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(date).map(x=>[x.type,x.value]));
  return pattern.replace('yyyy',p.year).replace('MM',p.month).replace('dd',p.day)
    .replace('HH',p.hour).replace('mm',p.minute);
}
function uniq_(a) { const s=new Set(); return a.filter(x => { if(s.has(x)) return false; s.add(x); return true; }); }
function dayNum_(s) { const d=s.slice(0,10).split('-'); return Date.UTC(+d[0],+d[1]-1,+d[2])/86400000; }

export function buildData_(orders, ordDate, pinfo, lines, catOf, crm, pick, stageInfo, stageOrder, options) {
  stageInfo = stageInfo || {};
  stageOrder = stageOrder || [];
  var usd = {venta:0, fuente:'', fecha:''};
  usd = options.usd || usd;
  var usdMon = {};
  usdMon = options.usdMon || {};

  /* TIPO tiene 3 valores desde el 04/09/2026. Antes eran 2 y 'Ecommerce' caía en 'Tradicional'
     por descarte: 739 de las 1.258 órdenes rotuladas "Tradicional" eran en realidad de la tienda
     online. Los índices 0 y 1 NO se movieron, así que un frontend viejo sigue leyendo bien lo que
     ya conocía; 'Ecommerce' se agrega al final. */
  var VEN=[], CAN=['Venta directa','Web (Tiendanube)'], TIPO=['Tradicional','Pronta Entrega','Ecommerce'],
      PROV=[], IND=[], CAT=[], MON=[], STAGE=[];
  function idx(arr,v){ var i=arr.indexOf(v); if(i<0){ i=arr.length; arr.push(v); } return i; }
  function vendedorTablero_(user) {
    if (!user) return 'Sin vendedora';
    var nombre = String(user[1] || '').trim();
    /* Yeni es la usuaria técnica de Tiendanube en esta base, no una vendedora. Se agrupa con
       OdooBot para que filtros, rankings y CRM tengan una sola fila Web (Tiendanube). */
    return user[0] === 1 || /^(odoo\s*bot|yeni)$/i.test(nombre) ? 'Web (Tiendanube)' : nombre;
  }

  // DÍA por fila, como offset entero desde day0 (el registro más viejo del dataset): habilita
  // filtros por rango de fechas en el frontend. Se guarda como offset y no como fecha/día absoluto
  // porque son 1-3 dígitos en vez de 5-10 chars por fila (el dataset entra en Script Properties).
  var allDays = [];
  orders.forEach(function (o) { if (o.date_order) allDays.push(dayNum_(o.date_order)); });
  crm.forEach(function (c) {
    if (c.create_date) allDays.push(dayNum_(c.create_date));
    if (c.date_closed) allDays.push(dayNum_(c.date_closed));
    if (c.date_conversion) allDays.push(dayNum_(c.date_conversion));
  });
  var day0 = allDays.length ? Math.min.apply(null, allDays)
                            : dayNum_(formatDate(new Date(), TZ, 'yyyy-MM-dd'));
  var maxDay = allDays.length ? Math.max.apply(null, allDays) : day0;
  function dayOff_(s) { return s ? dayNum_(s) - day0 : 0; }

  var ordAttr = {};   // id -> [monIdx, venIdx, canIdx, tipoIdx, dayOff, provinciaIdx]
  var commitmentLoaded = false;
  var O = orders.map(function (o) {
    var mon = (o.date_order||'').slice(0,7);
    /* Canal y vendedora se decidían juntos y estaba mal (corregido 04/09/2026).
       CANAL: sale del TIPO de orden, no de quién la cargó. Ecommerce = web. Antes se miraba si la
       había cargado OdooBot, y por eso las 10 órdenes de Yeni —la cuenta de la tienda,
       tienda@zaphirauniformes.com.ar, con las 10 en tipo Ecommerce— contaban como venta directa.
       Leerlo del tipo se auto-mantiene: si mañana la tienda carga con otro usuario, sigue andando.
       VENDEDORA: sigue siendo el usuario real de Odoo, salvo las cuentas técnicas Yeni y OdooBot,
       que se agrupan como 'Web (Tiendanube)' para no aparecer como personas en filtros o rankings.
       Ambos endurecidos por id, con fallback a string por si cambia el nombre en Odoo. */
    var tipoId = o.type_id ? o.type_id[0] : 0, tipoNom = (o.type_id && o.type_id[1]) || '';
    var esEcom  = tipoId === 4 || tipoNom.indexOf('commerce') >= 0;
    var esPronta = tipoId === 2 || tipoNom.indexOf('Pronta') >= 0;
    var ven = vendedorTablero_(o.user_id);
    var can = esEcom ? 'Web (Tiendanube)' : 'Venta directa';
    var tipo = esEcom ? 'Ecommerce' : (esPronta ? 'Pronta Entrega' : 'Tradicional');
    if (o.commitment_date) commitmentLoaded = true;
    var p = o.partner_id ? pinfo[o.partner_id[0]] : null;
    var prov = (p && p.state_id) ? p.state_id[1].replace(' (AR)','') : '(sin provincia)';
    var ind  = (p && p.industry_id) ? p.industry_id[1] : '(sin industria)';
    /* REPOSICIÓN vs PEDIDO NUEVO (pedido de Ariel, definido el 04/09/2026: por antigüedad del
       cliente). Es nuevo si la ficha del cliente se creó dentro del mismo mes de la venta; si el
       cliente ya existía antes, es reposición. Se eligió este corte y no "su primera compra"
       porque Odoo arranca el 06/02/2026: con aquel criterio, un cliente de hace años aparecía
       como nuevo la primera vez que compraba dentro del sistema. Las fichas sí tienen historia
       previa (hay altas desde feb-2025), así que este corte se apoya en un dato real.
       Sin create_date no se puede saber: queda como reposición, que es el caso más frecuente. */
    var altaCli = (p && p.create_date) ? String(p.create_date).slice(0, 7) : '';
    var esNuevo = altaCli ? (altaCli >= mon) : false;
    var iMon=idx(MON,mon), iVen=idx(VEN,ven), iCan=CAN.indexOf(can), iTipo=TIPO.indexOf(tipo);
    var dOff = dayOff_(o.date_order);
    var iProv=idx(PROV,prov), iInd=idx(IND,ind);
    ordAttr[o.id] = [iMon, iVen, iCan, iTipo, dOff, iProv];
    // [6]=total CON IVA (era amount_untaxed hasta el 04/09/2026; Ariel pidió ver todo con IVA)
    // [7]=día · [8]=1 pedido nuevo / 0 reposición (campo agregado al final para no romper la
    // ventana entre el deploy y el re-sync: el frontend tiene un guard si no viene)
    // [9]=id de oportunidad CRM vinculada · [10]=id de la orden. Permiten conciliar por qué la
    // cantidad de órdenes no coincide necesariamente con las tarjetas ganadas.
    return [iMon, iVen, iCan, iTipo, iProv, iInd, Math.round(o.amount_total), dOff,
            esNuevo ? 1 : 0, o.opportunity_id ? o.opportunity_id[0] : 0, o.id];
  });

  var L = [];
  lines.forEach(function (l) {
    var a = ordAttr[l.order_id[0]]; if (!a) return;
    var cat = (catOf[l.product_id[0]] || '(sin)').split(' / ')[0].trim();   // ROOT de la categoría (el bucketeo va en el frontend)
    // [7]=subtotal CON IVA, [8]=día de la orden, [9]=provincia del cliente de la orden.
    L.push([a[0], a[1], a[2], a[3], idx(CAT,cat), Math.round(l.product_uom_qty), Math.round(l.qty_delivered||0), Math.round(l.price_total != null ? l.price_total : l.price_subtotal), a[4], a[5]]);
  });

  var P = [];
  pick.forEach(function (pk) {
    if (pk.state === 'cancel' || !pk.sale_id) return;
    var a = ordAttr[pk.sale_id[0]]; if (!a) return;
    var sc = pk.state === 'done' ? 1 : pk.state === 'waiting' ? 3 : 2;  // 1 entregado · 2 preparación · 3 espera
    var days = -1;
    if (pk.state === 'done' && pk.date_done && ordDate[pk.sale_id[0]]) {
      var d = dayNum_(pk.date_done) - dayNum_(ordDate[pk.sale_id[0]]); if (d >= 0) days = d;
    }
    P.push([a[0], a[1], a[2], sc, days, a[4]]);  // [5]=día de la orden (el remito se atribuye a su venta)
  });

  /* ESTADO de la oportunidad, agregado el 04/09/2026 en C[5]: 0 abierta · 1 ganada · 2 perdida.
     El embudo mostraba la ETAPA donde quedó cada oportunidad y la trataba como si fuera su estado.
     Cuando el equipo pierde una, la archiva en la etapa donde estaba, no la mueve a 'NO AVANZARA':
     por eso el gráfico decía 48 perdidas cuando en Odoo hay 361 archivadas, 270 de ellas paradas
     en 'Qualified'. Ganada sale de is_won (Won + Pedido confirmado), perdida de active=false.
     Va como campo NUEVO al final y no reemplazando a won (C[3]) a propósito: entre el push y el
     re-sync del trigger pasan hasta 30 min sirviendo el dataset viejo, y el frontend necesita
     poder caer al comportamiento anterior sin quedar en blanco. */
  var crmLost = 0;
  var C = crm.map(function (c) {
    if (c.active === false) crmLost++;
    var mon = (c.create_date||'').slice(0,7);
    var ven = c.user_id ? vendedorTablero_(c.user_id) : 'Sin asignar';
    var stName = c.stage_id ? c.stage_id[1] : '(sin etapa)';
    var stId = c.stage_id ? c.stage_id[0] : null;
    /* La conversión acordada usa el cierre Ganado de Odoo (anticipo cobrado). Pedido confirmado
       es una etapa anterior, de acuerdo verbal, y por eso no se fuerza como ganada por nombre. */
    var won = stageInfo.hasOwnProperty(stId) ? (stageInfo[stId].won ? 1 : 0) : (/^(won|ganad[oa])$/i.test(String(stName).trim()) ? 1 : 0);
    var est = won ? 1 : (c.active === false ? 2 : 0);
    /* [4]=alta/recibida · [5]=estado · [6]=cierre · [7]=conversión lead→oportunidad ·
       [8]=id CRM · [9]=tipo · [10]=motivo de pérdida · [11]=activo (1/0). Los nuevos campos van al final para que
       el frontend pueda convivir con el dataset anterior durante la ventana de resincronización. */
    return [idx(MON,mon), idx(VEN,ven), idx(STAGE,stName), won, dayOff_(c.create_date), est,
            c.date_closed ? dayOff_(c.date_closed) : -1,
            c.date_conversion ? dayOff_(c.date_conversion) : -1,
            c.id, c.type || 'opportunity', c.lost_reason_id ? c.lost_reason_id[1] : '', c.active === false ? 0 : 1];
  });

  // Cobertura de datos sobre los clientes con venta (no sobre todos los partners de Odoo)
  var pidsUsed = uniq_(orders.map(function (o) { return o.partner_id ? o.partner_id[0] : 0; }).filter(Boolean));
  var provCount = 0, indCount = 0;
  pidsUsed.forEach(function (id) {
    var p = pinfo[id];
    if (p && p.state_id) provCount++;
    if (p && p.industry_id) indCount++;
  });
  var provinceCov = pidsUsed.length ? provCount / pidsUsed.length : 0;
  var industryCov = pidsUsed.length ? indCount / pidsUsed.length : 0;

  // rateMon sólo para los meses presentes en dict.MON; si falta un mes queda sin rate (frontend: "en construcción").
  // El mes en curso usa el spot del día (usd.venta), no el promedio de usd_mon, aunque éste ya lo tenga.
  var curMon = formatDate(new Date(), TZ, 'yyyy-MM');
  var rateMon = {};
  MON.forEach(function (m) {
    if (m === curMon) { if (usd.venta) rateMon[m] = usd.venta; }
    else if (usdMon[m] != null) rateMon[m] = usdMon[m];
  });

  // rateDay[i] = oficial del día (day0 + i), mismo índice que el offset guardado en cada fila.
  // Convertir cada venta al dólar de SU día es lo que hace honesto el filtro por rango: con el
  // promedio mensual, un rango sub-mensual (ej. 1-10 de marzo) se valuaría al promedio de todo marzo.
  // El oficial no publica finde/feriados → se arrastra el último valor conocido (fill-forward).
  // Día sin dato ni arrastre (histórico previo a la ventana) queda 0 y el frontend cae a rateMon.
  var usdDay = {};
  usdDay = options.usdDay || {};
  var rateDay = [];
  if (usdDay.from && usdDay.v && usdDay.v.length) {
    var uBase = dayNum_(usdDay.from) - day0;   // índice en rateDay donde arranca la serie
    var carry = 0;
    for (var i = 0; i <= maxDay - day0; i++) {
      var j = i - uBase;
      if (j >= 0 && j < usdDay.v.length && usdDay.v[j]) carry = usdDay.v[j];
      rateDay.push(carry);
    }
  }
  // Hoy usa el spot de dolarapi: llega antes que el histórico de argentinadatos.
  if (usd.venta && rateDay.length) {
    var tOff = dayNum_(formatDate(new Date(), TZ, 'yyyy-MM-dd')) - day0;
    if (tOff >= 0 && tOff < rateDay.length) rateDay[tOff] = Math.round(usd.venta);
  }

  return {
    pull: formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm'),
    usdFuente: usd.fuente || '',
    usdFecha: usd.fecha || '',
    rate: usd.venta || 0,        // spot de hoy (fallback final)
    rateMon: rateMon,            // promedio oficial venta por mes (fallback si falta el día)
    rateDay: rateDay,            // oficial por día, indexado por el mismo offset que las filas
    dict: {VEN:VEN, CAN:CAN, TIPO:TIPO, PROV:PROV, IND:IND, CAT:CAT, MON:MON, STAGE:STAGE},
    O: O, L: L, P: P, C: C,
    meta: {
      commitmentLoaded: commitmentLoaded,
      dateFrom: DATA_FROM,
      industryCov: industryCov,
      provinceCov: provinceCov,
      crmLost: crmLost,
      stageOrder: stageOrder.map(function (s) { return s.name; }),
      crmDateFields: crm.some(function (c) { return !!(c.date_closed || c.date_conversion); }),
      curMon: curMon,
      // Base de los montos. El frontend lo usa para rotular: hasta el 04/09/2026 era 'neto' y
      // ahora es 'total'. Publicarlo evita que el tablero afirme "sin IVA" sobre datos con IVA
      // durante los ~30 min en que todavía se sirve el dataset viejo.
      base: 'total',
      // Se quedan en 0 mientras exista algún frontend leyéndolas (ver anuladasPorNC_, eliminada).
      anuladasN: 0,
      anuladasMonto: 0,
      // Referencias del filtro por rango de fechas. day0 = base de los offsets guardados en cada fila.
      // today sale del TZ del negocio (no del navegador): así "mes actual"/"YTD" coinciden con los datos.
      day0: formatDate(new Date(day0 * 86400000), 'UTC', 'yyyy-MM-dd'),
      maxDate: formatDate(new Date(maxDay * 86400000), 'UTC', 'yyyy-MM-dd'),
      today: formatDate(new Date(), TZ, 'yyyy-MM-dd'),
      // Sólo un booleano (nunca el valor): permite confirmar desde afuera que las credenciales
      // ya viven en Script Properties antes de vaciar los literales del código.
      credsEnProps: true
    }
  };
}
