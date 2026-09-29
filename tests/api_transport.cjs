const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('async function api('),html.indexOf("const SES_KEY="));
const echo='https://script.googleusercontent.com/macros/echo?user_content_key=synthetic';
function setup(responses){
  const calls=[];
  const context={URL,AbortController,Promise,Error,JSON,Object,
    EXEC_URL:'https://script.google.com/macros/s/test/exec',
    setTimeout:(fn,ms)=>setTimeout(fn,ms===3000?0:ms),clearTimeout,
    fetch:async(url,options)=>{calls.push({url,options});const value=responses.shift();if(!value)throw Error('Unexpected request');return {ok:value.status===200,json:async()=>({ok:true}),redirected:true,url:echo,...value};}
  };
  vm.createContext(context);vm.runInContext(source,context);
  return {api:context.api,calls};
}
test('recovers a temporary Google response without repeating a write or its credentials',async()=>{
  const {api,calls}=setup([{status:404},{status:404},{status:200}]);
  assert.equal((await api('guardarObjetivos',{token:'synthetic-secret'})).ok,true);
  assert.deepEqual(calls.map(c=>c.options.method),['POST','GET','GET']);
  for(const call of calls.slice(1)){
    assert.equal(call.url,echo);assert.equal(call.options.body,undefined);
    assert.equal(call.options.credentials,'omit');
  }
});
test('permanent response errors have a bounded retry count',async()=>{
  const {api,calls}=setup([{status:404},{status:404},{status:404}]);
  await assert.rejects(api('data'),/HTTP 404/);assert.equal(calls.length,3);
});
test('does not retry untrusted URLs, nonredirected errors or other HTTP failures',async()=>{
  for(const response of [{status:404,url:'https://evil.example/macros/echo'},{status:404,redirected:false},{status:403},{status:500}]){
    const {api,calls}=setup([response]);await assert.rejects(api('login'),/HTTP/);assert.equal(calls.length,1);
  }
});
