const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
class FixedDate extends Date {
  constructor(...args){ super(...(args.length?args:['2026-09-29T15:00:00Z'])); }
  static now(){ return Date.parse('2026-09-29T15:00:00Z'); }
}
const source=fs.readFileSync(require('node:path').join(__dirname,'../backend/Tiendanube.gs'),'utf8');
function setup({role='direccion',active=true,responses=[]}={}){
  const calls=[],cache=new Map();
  const context={Date:FixedDate,Number,JSON,Math,Object,Array,String,isFinite,encodeURIComponent,Error,
    verificarToken_:token=>token==='session'?{usuario:'admin',rol:role}:null,
    esDireccion_:s=>s?.rol==='direccion',filas_:()=>[{usuario:'admin',rol:role,activo:active}],tabUsr_:()=>({}),
    PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'PROVIDER_SECRET'})},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(alg,v)=>[...crypto.createHash(alg).update(v).digest()],
      formatDate:date=>new Date(date.getTime()-3*3600000).toISOString().slice(0,10),sleep:()=>{}},
    CacheService:{getScriptCache:()=>({get:key=>cache.get(key),put:(key,v)=>cache.set(key,v)})},
    UrlFetchApp:{fetch:(url,options)=>{calls.push({url,options});const response=responses.shift();if(!response)throw Error('Unexpected fetch');return {
      getResponseCode:()=>response.code||200,getAllHeaders:()=>response.headers||{},getContentText:()=>JSON.stringify(response.body)
    };}}
  };vm.createContext(context);vm.runInContext(source,context);
  return {c:context,calls,cache};
}
const range={from:'2026-09-01',to:'2026-09-29'};
const now=new Date('2026-09-29T15:00:00Z');
const order=(id,payment='paid',extra={})=>({id,store_id:1301166,created_at:'2026-09-15T12:00:00Z',status:'open',payment_status:payment,currency:'ARS',total:'100.50',storefront:'store',products:[{product_id:1,name:'Producto',quantity:2}],...extra});
const plain=value=>JSON.parse(JSON.stringify(value));
test('authentication and current role are checked before reading credentials or API',()=>{
  for(const options of [{role:'vendedora'},{active:false},{}]){
    const {c,calls}=setup(options);const out=c.opTiendanube_({token:options.role||options.active===false?'session':'bad',rol:'direccion',...range});
    assert.equal(out.ok,false);assert.equal(calls.length,0);
  }
});
test('date validation rejects overflow, reverse range, excessive range and injection',()=>{
  const {c}=setup();for(const r of [{from:'2026-02-30',to:'2026-03-02'},{from:'2026-09-02',to:'2026-09-01'},{from:'2024-01-01',to:'2026-01-01'},{from:'2026-01-01&fields=token',to:'2026-01-02'}])assert.throws(()=>c.tnRange_(r));
});
test('aggregates mutually exclusive states, includes mobile/manual and never mixes Odoo',()=>{
  const {c}=setup();const data=c.tnAggregate_([order(1),order(2,'pending'),order(3,'paid',{status:'cancelled'}),order(4,'partially_paid'),order(5,'refunded'),order(6,'paid',{storefront:'mobile'}),order(7,'paid',{storefront:'form'})],[],range,now);
  assert.equal(data.summary.orders,7);assert.equal(data.summary.paid,3);assert.equal(data.summary.paidTotalArs,301.5);assert.equal(data.summary.paidUnits,6);
  assert.equal(data.summary.pending,1);assert.equal(data.summary.cancelled,1);assert.equal(data.summary.partial,1);assert.equal(data.summary.refunded,1);
  assert.equal(data.origins.length,3);
  assert.equal(data.daily[0].paidUnits,6,'Daily units support weekly and monthly averages');
});
test('amounts missing or foreign currency are flagged instead of silently summed',()=>{
  const {c}=setup();const data=c.tnAggregate_([order(1,'paid',{currency:'USD'}),order(2,'paid',{total:null}),order(3)],[],range,now);
  assert.equal(data.summary.missingAmounts,2);assert.equal(data.summary.paidTotalArs,100.5);
});
test('business dates use Argentina timezone, not UTC substring',()=>{
  const {c}=setup();const data=c.tnAggregate_([order(1,'paid',{created_at:'2026-09-01T02:00:00Z'})],[],range,now);assert.equal(data.summary.orders,0);
});
test('checkouts exclude completed records and mark partial and absent coverage',()=>{
  const {c}=setup(),checkout={id:1,created_at:'2026-09-10T12:00:00Z',completed_at:null};
  let data=c.tnAggregate_([], [checkout,{...checkout,id:2,completed_at:'2026-09-11T12:00:00Z'}],{from:'2026-08-01',to:'2026-09-29'},now);
  assert.equal(data.abandoned.count,1);assert.equal(data.abandoned.partialCoverage,true);
  data=c.tnAggregate_([],[],{from:'2026-08-01',to:'2026-08-20'},now);assert.equal(data.abandoned.count,null);
});
test('follows safe pagination and does not return customer fields',()=>{
  const url='https://api.tiendanube.com/2025-03/1301166/orders?page=2';
  const {c,calls}=setup({responses:[{body:[order(1)],headers:{'X-Total-Count':'2',Link:`<${url}>; rel="next"`}},{body:[order(2)]}]});
  const rows=c.tnList_('orders',{},'secret',Date.now()+10000);assert.equal(rows.length,2);assert.equal(calls[1].url,url);assert.equal(calls[0].options.followRedirects,false);
  const data=c.tnAggregate_([{...order(1),contact_email:'PRIVATE_EMAIL',token:'PRIVATE_TOKEN'}],[],range,now);
  assert.doesNotMatch(JSON.stringify(data),/PRIVATE_EMAIL|PRIVATE_TOKEN|contact_email/);
});
test('rejects pagination to another store or host without sending its token',()=>{
  for(const url of ['https://evil.example/orders?page=2','https://api.tiendanube.com/2025-03/99/orders?page=2']){
    const {c,calls}=setup({responses:[{body:[order(1)],headers:{Link:`<${url}>; rel="next"`}}]});
    assert.throws(()=>c.tnList_('orders',{},'secret',Date.now()+10000));assert.equal(calls.length,1);
  }
});
test('incomplete and duplicate pagination cannot become an apparently complete report',()=>{
  for(const response of [{body:[order(1)],headers:{'x-total-count':'2'}},{body:[order(1),order(1)],headers:{'x-total-count':'2'}}]){
    const {c}=setup({responses:[response]});assert.throws(()=>c.tnList_('orders',{},'secret',Date.now()+10000));
  }
});
test('provider error bodies are never exposed and 404 is not zero records',()=>{
  const {c}=setup({responses:[{code:404,body:{description:'PRIVATE_TOKEN'}}]});
  assert.throws(()=>c.tnList_('orders',{},'secret',Date.now()+10000),error=>!error.message.includes('PRIVATE_TOKEN')&&error.message.includes('no se interpreta'));
});
test('successful reports cache scoped data only and reuse cache after authorization',()=>{
  const {c,calls,cache}=setup({responses:[{body:[order(1)],headers:{'x-total-count':'1'}},{body:[],headers:{'x-total-count':'0'}}]});
  const d={token:'session',...range};let out=c.opTiendanube_(d);assert.equal(out.ok,true);assert.equal(out.summary.paid,1);assert.equal(calls.length,2);
  out=c.opTiendanube_(d);assert.equal(out.ok,true);assert.equal(calls.length,2);assert.doesNotMatch([...cache.values()].join(''),/PROVIDER_SECRET|contact_email/);
});
test('malformed quantities do not produce fabricated unit totals',()=>{
  const {c}=setup();assert.throws(()=>c.tnAggregate_([order(1,'paid',{products:[{quantity:'bad'}]})],[],range,now));
});
test('commercial metrics use only fully paid noncancelled orders within the creation range',()=>{
  const {c}=setup();
  const extra={discount:'12.50',coupon_id:19,gateway_name:'Transferencia',shipping_status:'unpacked',has_shippable_products:true};
  const out=c.tnAggregate_([order(1,'paid',extra),order(2,'pending',extra),order(3,'paid',{...extra,status:'cancelled'}),order(4,'partially_paid',extra),order(5,'paid',{...extra,created_at:'2026-08-15T12:00:00Z'})],[],range,now);
  assert.equal(out.summary.paidTotalArs,100.5,'Discounts must not be subtracted twice');
  assert.equal(out.commerce.discountOrders,1);assert.equal(out.commerce.couponOrders,1);
  assert.equal(out.commerce.discountDaily[0].paidTotalArs,12.5);
  assert.equal(out.commerce.providers[0].orders,1);assert.equal(out.commerce.awaitingDispatch,1);
});
test('discount cases identify each paid order, coupon code and non-coupon discount without buyer data',()=>{
  const {c}=setup();
  const out=c.tnAggregate_([
    order(1,'paid',{number:17,discount:'12.50',discount_coupon:'10.00',coupon_id:19,
      coupon:[{id:19,code:'ARIEL10'}],contact_email:'PRIVATE_BUYER'}),
    order(2,'paid',{number:18,discount:'5.00',discount_coupon:'0.00',coupon_id:null,coupon:[]}),
    order(3,'pending',{discount:'15.00',coupon_id:20,coupon:[{code:'NOT_PAID'}]})
  ],[],range,now);
  assert.equal(out.commerce.discountCases.length,2);
  assert.deepEqual(plain(out.commerce.discountCases[0]),{orderId:'2',orderNumber:'18',date:'2026-09-15',
    couponId:null,couponCodes:[],discountArs:5,couponDiscountArs:0});
  assert.equal(out.commerce.discountCases[1].couponCodes[0],'ARIEL10');
  assert.equal(out.commerce.discountCases[1].couponDiscountArs,10);
  assert.doesNotMatch(JSON.stringify(out),/PRIVATE_BUYER|NOT_PAID/);
});
test('coupon catalog resolves codes when the order only includes coupon_id',()=>{
  const {c,calls}=setup({responses:[{body:[{id:19,code:'PROMO19'}],headers:{'x-total-count':'1'}}]});
  const orders=[order(1,'paid',{coupon_id:19,coupon:[],discount:'10'})];
  const codes=c.tnCouponCodeMap_(orders,range,'secret',Date.now()+10000);
  assert.equal(codes['19'],'PROMO19');
  assert.match(calls[0].url,/\/coupons\?/);
  assert.equal(c.tnAggregate_(orders,[],range,now,codes).commerce.discountCases[0].couponCodes[0],'PROMO19');
});
test('missing coupon read permission keeps order metrics and marks code unavailable',()=>{
  const {c}=setup({responses:[{code:403,body:{description:'PRIVATE'}}]});
  const orders=[order(1,'paid',{coupon_id:19,discount:'10'})];
  const codes=c.tnCouponCodeMap_(orders,range,'secret',Date.now()+10000);
  const out=c.tnAggregate_(orders,[],range,now,codes);
  assert.equal(out.commerce.couponOrders,1);
  assert.equal(out.commerce.discountCases[0].couponId,'19');
  assert.deepEqual(plain(out.commerce.discountCases[0].couponCodes),[]);
  assert.doesNotMatch(JSON.stringify(out),/PRIVATE/);
});
test('unknown discount and coupon fields stay distinct from an explicit zero or no coupon',()=>{
  const {c}=setup();const out=c.tnAggregate_([order(1,'paid',{discount:'0.00',coupon_id:null}),order(2,'paid',{discount:null}),order(3,'paid',{discount:'-20',coupon_id:'invalid'})],[],range,now).commerce;
  assert.equal(out.discountKnown,1);assert.equal(out.discountOrders,0);assert.equal(out.couponKnown,1);assert.equal(out.couponOrders,0);
  assert.equal(out.discountDaily[0].missingAmounts,2);
});
test('discount totals keep their business date and reject foreign-currency sums',()=>{
  const {c}=setup();const out=c.tnAggregate_([order(1,'paid',{discount:'10',currency:'USD'}),order(2,'paid',{discount:'20',created_at:'2026-09-16T02:00:00Z'})],[],range,now).commerce;
  assert.equal(out.discountKnown,2);assert.equal(out.discountOrders,2);
  assert.equal(out.discountDaily.length,1);assert.equal(out.discountDaily[0].date,'2026-09-15');
  assert.equal(out.discountDaily[0].paidTotalArs,20);assert.equal(out.discountDaily[0].missingAmounts,1);
});
test('dispatch counts exclude delivered, dispatched and nonphysical orders; age uses elapsed days',()=>{
  const {c}=setup();const out=c.tnAggregate_([
    order(1,'paid',{shipping_status:'unpacked',created_at:'2026-09-22T15:00:00Z'}),
    order(2,'paid',{shipping_status:'partially_fulfilled',created_at:'2026-09-22T15:00:01Z'}),
    order(3,'paid',{shipping_status:'shipped'}),order(4,'paid',{shipping_status:'delivered'}),
    order(5,'paid',{shipping_status:'unpacked',has_shippable_products:false}),order(6,'paid',{shipping_status:null})
  ],[],range,now).commerce;
  assert.equal(out.awaitingDispatch,2);assert.equal(out.awaitingDispatch7Days,1);assert.equal(out.shippingKnown,5);
  assert.equal(out.shipping.find(x=>x.name==='unknown').orders,1);
  assert.equal(out.shipping.reduce((s,x)=>s+x.orders,0),6);
});
test('provider names cannot corrupt aggregate keys and no buyer or payment identifiers are returned',()=>{
  const {c}=setup();const out=c.tnAggregate_([
    order(1,'paid',{gateway_name:'__proto__',contact_email:'PRIVATE',gateway_id:'PRIVATE',payment_details:{credit_card_number:'PRIVATE'}}),
    order(2,'paid',{gateway:'internal',gateway_name:'PRIVATE'})
  ],[],range,now).commerce;
  assert.equal(out.providers.find(x=>x.name==='__proto__').orders,1);
  assert.equal(out.providers.find(x=>x.name==='Marcado manualmente').orders,1);
  assert.doesNotMatch(JSON.stringify(out),/PRIVATE|credit_card_number|gateway_id/);
});
