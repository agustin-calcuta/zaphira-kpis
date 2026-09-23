// Run against an authenticated pull of the deployed Apps Script source:
// node tests/backend_permissions.cjs <backend-directory>
// Synthetic records only; no calls to production or changes to real users.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(process.argv[2], 'Usuarios.js'), 'utf8');
const names = ['recortarPorVendedora_', 'opData_', 'opXlsx_', 'opObjetivos_',
  'opUsuarios_', 'opGuardarObjetivos_', 'opAlta_', 'opBaja_', 'opReset_'];
const functions = names.map(name => {
  const match = source.match(new RegExp('^function '+name+'\\([^]*?^}', 'm'));
  assert.ok(match, name);
  return match[0];
});
functions.push(source.match(/^function esDireccion_.*$/m)[0]);
const raw = {dict: {VEN: ['Clarisa', 'Valeria']},
  O: [[0,0,100],[0,1,999]], L: [[0,0,10],[0,1,99]],
  P: [[0,0,1],[0,1,9]], C: [[0,0,2],[0,1,8]]};
const sessions = {seller: {rol:'vendedora', vendedora:'Clarisa'},
  director: {rol:'direccion'}, unknown: {rol:'vendedora', vendedora:'Unknown'}};
let exported;
const ctx = {
  verificarToken_: token => sessions[token] || null,
  TZ:'UTC', Utilities: {formatDate: ()=>'2026-09'},
  getData_: ()=>JSON.stringify(raw),
  objetivosDe_: ()=>({empresa:9999, vendedoras:{Clarisa:1000,Valeria:9000}}),
  exportXlsx: (filters, data)=>{exported=data; return {b64:'synthetic'};},
};
vm.createContext(ctx);
vm.runInContext(functions.join('\n'), ctx);
const own = value => {
  assert.equal(JSON.stringify(value.dict.VEN), '["Clarisa"]');
  for (const key of ['O','L','P','C']) {
    assert.equal(value[key].length, 1);
    assert.equal(value[key][0][1], 0);
    assert.equal(value[key][0][2], raw[key][0][2]);
  }
};
// Client-supplied seller and role cannot replace the authenticated identity.
const hostile = {token:'seller', ven:'1', vendedora:'Valeria', rol:'direccion'};
const result = ctx.opData_(hostile);
own(result.raw);
assert.equal(result.objetivo.mio,1000);
assert.equal(result.objetivo.vendedoras,undefined);
assert.equal(ctx.opXlsx_(hostile).ok,true);
own(exported);
assert.equal(ctx.opObjetivos_(hostile).mio,1000);
assert.equal(JSON.stringify(ctx.opObjetivos_(hostile).objetivos),'{"empresa":0,"vendedoras":{}}');
for(const name of ['opUsuarios_','opGuardarObjetivos_','opAlta_','opBaja_','opReset_']) {
  assert.equal(ctx[name](hostile).ok,false,name);
}
for(const name of ['opData_','opXlsx_','opObjetivos_']) {
  assert.equal(ctx[name]({token:'invalid'}).ok,false,name);
}
assert.equal(ctx.opData_({token:'unknown'}).ok,false);
assert.equal(ctx.opXlsx_({token:'unknown'}).ok,false);
assert.equal(JSON.parse(ctx.opData_({token:'director'})._json).raw.O.length,2);
console.log('PASS: seller data, CRM, objectives, Excel isolation, invalid sessions and admin restrictions.');
