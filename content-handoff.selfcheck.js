// Synthetic caller regression: no network, database, audio or real credentials.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'hype-audio.js'), 'utf8');
function load(fetchImpl) {
  const timers = new Map(); let next = 0;
  const store = { hype_audio_upload_secret: 'synthetic' };
  const sandbox = { window: {}, navigator: {}, console, AbortController,
    localStorage: { getItem: k => store[k] || null, setItem: (k,v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    fetch: fetchImpl, setTimeout: fn => { const id = ++next; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id) };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  return { send: () => sandbox.window.HypeAudio.sendToContentIdea({ id: 'clip', storage_url: 'https://fixture.invalid/audio' }, { title: 'Test', pillar: 'mindset' }),
    expire: () => { for (const fn of [...timers.values()]) fn(); }, timers, store };
}
const drain = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };
(async () => {
  for (const phase of ['headers', 'body']) {
    let signal, calls=0;
    const h = load(async (url,opts) => { calls++; signal=opts.signal; if(phase==='headers') return new Promise(()=>{}); return { ok:true, json:()=>new Promise(()=>{}) }; });
    let settled=false, result;
    h.send().then(r=>{settled=true;result=r;}); await drain(); h.expire(); await drain();
    assert.equal(settled,true,phase+' stall must release the caller');
    assert.equal(result.id,null); assert.match(result.error,/not confirmed/i);
    assert.equal(signal.aborted,true); assert.equal(calls,1); assert.equal(h.timers.size,0);
  }
  for (const body of [{}, {id:''}, {id:42}, {id:'saved-id'}]) {
    const h=load(async()=>({ok:true,json:async()=>body}));
    const result=await h.send();
    if(body.id==='saved-id') { assert.equal(result.id,'saved-id'); assert.equal(result.error,null); }
    else { assert.equal(result.id,null); assert.match(result.error,/not confirmed/i); }
    assert.equal(h.timers.size,0);
  }
  const auth=load(async()=>({ok:false,status:401,json:async()=>({error:'Unauthorized'})}));
  assert.equal((await auth.send()).error,'Unauthorized'); assert.equal(auth.store.hype_audio_upload_secret,undefined);
  let finishBody, observed;
  const late=load(async()=>({ok:true,json:()=>new Promise(r=>{finishBody=r;})}));
  late.send().then(r=>{observed=r;}); await drain(); late.expire(); await drain();
  assert.equal(observed.id,null);
  finishBody({id:'late-id'}); await drain(); assert.equal(observed.id,null);
  assert.equal(late.timers.size,0);
  console.log('content-handoff selfcheck: 8 synthetic cases passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
