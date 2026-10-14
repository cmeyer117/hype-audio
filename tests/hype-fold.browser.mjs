// node tests/hype-fold.browser.mjs [case]. Reuse installed Playwright; no install.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {chromium}=createRequire(process.env.HYPE_PLAYWRIGHT_PACKAGE || 'C:/Users/gregm/row/package.json')('playwright');
const clips=[
 {id:'tagged',title:'Fixture drive',pillar:'carl',mentality:'drive',moment:'mid_set',source_type:'personal_use',delivery_role:'motivational_speech',storage_url:'https://media.invalid/drive.mp3',transcript:'Fixture transcript about effort'},
 {id:'blank',title:'Fixture untagged',pillar:'carl',mentality:'',moment:'mid_set',source_type:'personal_use',storage_url:'https://media.invalid/blank.mp3'},
 {id:'cue',title:'Fixture brace',pillar:'carl',mentality:'brace',delivery_role:'instructional_cue',storage_url:'https://media.invalid/cue.mp3'},
 {id:'focus',title:'Fixture focus',pillar:'carl',mentality:'focus',use_case:'study_focus',delivery_role:'instrumental',storage_url:'https://media.invalid/focus.mp3'},
];
const cases=[];const check=(name,run)=>cases.push({name,run});
async function fixture(browser){
 const page=await browser.newPage({viewport:{width:375,height:812},serviceWorkers:'block'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='hype.test'||url.pathname.startsWith('/api/'))return route.abort();
  if(url.pathname==='/sync.js')return route.fulfill({contentType:'application/javascript',body:'window.initCloudSync=opts=>{window.cloudFixture=opts;opts.onStatusChange("offline");};'});
  if(url.pathname==='/hype-auth.js')return route.fulfill({contentType:'application/javascript',body:'window.HypeAuth={showLogin(){},getAccessToken:async()=>null};'});
  const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!path.startsWith(root+sep))return route.abort();
  try{return route.fulfill({contentType:({'.html':'text/html','.js':'application/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg'})[extname(path)]||'application/octet-stream',body:await readFile(path)});}catch{return route.abort();}
 });
 await page.addInitScript(({clips})=>{
  localStorage.setItem('hype_audio',JSON.stringify(clips));localStorage.setItem('hype_audio_quote_bed','0');window.audioPlays=[];
  class FakeAudio extends EventTarget {constructor(src){super();this.src=src;this.paused=true;this.currentTime=0;this.duration=10;this.volume=1;}play(){this.paused=false;window.audioPlays.push(this.src);return Promise.resolve();}pause(){this.paused=true;}load(){}removeAttribute(){} }
  window.Audio=FakeAudio;
  navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[{stop(){}}]});
  window.MediaRecorder=class {static isTypeSupported(){return true;}constructor(){this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['fixture'],{type:'audio/webm'})});this.onstop?.();}};
 },{clips});
 await page.goto('https://hype.test/');await page.waitForFunction(()=>typeof window.HypeAudio==='object'&&document.querySelector('#tiles button'));
 assert.deepEqual(errors,[],'fixture boots without page errors');return {page,errors};
}
check('metadata',async page=>{
 await page.evaluate(()=>{document.getElementById('use-case-input').value='study_focus';document.getElementById('delivery-role-input').value='noise';window.HypeAudio.uploadClipFile=async()=>({url:'https://media.invalid/upload.mp3'});showSubcats('carl');});
 await page.locator('#sc-upload-form').evaluate(el=>el.closest('details').open=true);
 await page.locator('#sc-file-input').setInputFiles({name:'fixture.mp3',mimeType:'audio/mpeg',buffer:Buffer.from('fixture')});
 await page.locator('#sc-title-input').fill('Fixture upload');await page.locator('#sc-mentality-input').fill('drive');await page.locator('#sc-upload-form button[type=submit]').click();
 const saved=await page.evaluate(()=>HypeAudio.listActiveClips().find(c=>c.title==='Fixture upload'));
 assert.equal(saved.use_case,null,'subcategory must not inherit hidden study_focus');assert.equal(saved.delivery_role,null,'subcategory must not inherit hidden noise');
});
check('untagged',async page=>{
 await page.locator('#global-search-input').fill('Fixture untagged');await page.locator('.search-result').click();
 assert.equal(await page.locator('#view-section').isVisible(),true,'blank mentality search must open its section');
 assert.ok((await page.locator('#section-title').innerText()).includes('Untagged'));
 assert.equal(await page.locator('#clip-list').getByText('Fixture untagged',{exact:true}).count(),1);
 await page.evaluate(()=>cloudFixture.onApplied());
 assert.equal(await page.locator('#clip-list').getByText('Fixture untagged',{exact:true}).count(),1,'cloud refresh keeps untagged section');
});
const browser=await chromium.launch({channel:'msedge'});let failures=0,passed=0;
try{for(const c of cases.filter(c=>!process.argv[2]||c.name===process.argv[2])){const{page,errors}=await fixture(browser);try{await c.run(page);assert.deepEqual(errors,[]);console.log('PASS '+c.name);passed++;}catch(e){failures++;console.error('FAIL '+c.name+': '+e.message);}finally{await page.close();}}}finally{await browser.close();}
console.log(`Edge375×812: ${passed} passed, ${failures} failed`);process.exitCode=failures?1:0;
