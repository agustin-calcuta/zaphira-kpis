const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('async function api('),html.indexOf('const SES_KEY='));

function setup(responses){
  const calls=[];
  const context={URL,AbortController,Promise,Error,JSON,Object,
    EXEC_URL:'https://zaphira-sales-api.example/api',setTimeout,clearTimeout,
    fetch:async(url,options)=>{
      calls.push({url,options});
      const value=responses.shift();
      if(!value)throw Error('Unexpected request');
      return {ok:value.status===200,status:value.status,json:async()=>value.body};
    }
  };
  vm.createContext(context);vm.runInContext(source,context);
  return {api:context.api,calls};
}

test('sends credentials once to the fixed proxy endpoint and reads JSON',async()=>{
  const {api,calls}=setup([{status:200,body:{ok:true,token:'synthetic-token'}}]);
  assert.equal((await api('login',{u:'synthetic-user',p:'synthetic-password'})).token,'synthetic-token');
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://zaphira-sales-api.example/api');
  assert.equal(calls[0].options.method,'POST');
  assert.equal(calls[0].options.headers['Content-Type'],'text/plain;charset=utf-8');
  assert.deepEqual(JSON.parse(calls[0].options.body),{op:'login',u:'synthetic-user',p:'synthetic-password'});
});
test('shows the proxy error and never repeats a write',async()=>{
  const {api,calls}=setup([{status:503,body:{ok:false,error:'El servidor tardó demasiado.'}}]);
  await assert.rejects(api('guardarObjetivos',{filas:[]}),/El servidor tardó demasiado/);
  assert.equal(calls.length,1);
});
test('keeps an HTTP error when the response is not JSON',async()=>{
  const {api,calls}=setup([{status:502,body:{}}]);
  await assert.rejects(api('login'),/HTTP 502/);
  assert.equal(calls.length,1);
});
