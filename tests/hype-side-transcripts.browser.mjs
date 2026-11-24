// node tests/hype-side-transcripts.browser.mjs   Reuses the installed Playwright (same as hype-fold.browser.mjs); no install.
// The real index.html and hype-audio.js with a fake sign-in whose client serves the 'hype-audio:transcripts' side row. Checks that global search finds
// a clip by words that exist ONLY in the side row (and shows the preview), that a refused read leaves title search working, and that nothing errors.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {chromium}=createRequire(process.env.HYPE_PLAYWRIGHT_PACKAGE || 'C:/Users/gregm/row/package.json')('playwright');
const clips=[
 {id:'side',title:'Fixture rant',pillar:'carl',mentality:'drive',moment:'mid_set',source_type:'personal_use',storage_url:'https://media.invalid/clip_side.mp3'},
 {id:'row',title:'Fixture row text',pillar:'carl',mentality:'drive',moment:'mid_set',source_type:'personal_use',storage_url:'https://media.invalid/clip_row.mp3',transcript_text:'the row already has this text'},
];
const SIDE={'clip_side.mp3':{t:'Discipline is what you do when nobody is watching',d:20,l:-14,n:0.01}};
const cases=[];const check=(name,run,opts)=>cases.push({name,run,opts});
async function fixture(browser,{refuse=false}={}){
 const page=await browser.newPage({viewport:{width:375,height:812},serviceWorkers:'block'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='hype.test'||url.pathname.startsWith('/api/'))return route.abort();
  if(url.pathname==='/sync.js')return route.fulfill({contentType:'application/javascript',body:'window.initCloudSync=opts=>{window.cloudFixture=opts;opts.onStatusChange("offline");};'});
  if(url.pathname==='/hype-auth.js')return route.fulfill({contentType:'application/javascript',body:'window.HypeAuth={showLogin(){},onChange(){},status:async()=>"owner",getAccessToken:async()=>null,getClient(){return {from(t){return {select(){return {eq(c,k){return {maybeSingle:async()=>{window.sideReads=(window.sideReads||0)+1;return window.sideRefuse?{data:null,error:{code:"42501"}}:{data:{data:window.SIDE},error:null};}};}};}};}};}};'});
  const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!path.startsWith(root+sep))return route.abort();
  try{return route.fulfill({contentType:({'.html':'text/html','.js':'application/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg'})[extname(path)]||'application/octet-stream',body:await readFile(path)});}catch{return route.abort();}
 });
 await page.addInitScript(({clips,SIDE,refuse})=>{
  window.SIDE=SIDE;window.sideRefuse=refuse;
  localStorage.setItem('hype_audio',JSON.stringify(clips));localStorage.setItem('hype_quote_bed','0');window.audioPlays=[];
  class FakeAudio extends EventTarget {constructor(src){super();this.src=src;this.paused=true;this.currentTime=0;this.duration=10;this.volume=1;}play(){this.paused=false;window.audioPlays.push(this.src);return Promise.resolve();}pause(){this.paused=true;}load(){}removeAttribute(){} }
  window.Audio=FakeAudio;
 },{clips,SIDE,refuse});
 await page.goto('https://hype.test/');
 try{await page.waitForFunction(()=>typeof window.HypeAudio==='object'&&document.querySelector('#tiles button'),null,{timeout:8000});}
 catch(e){throw new Error('page did not boot; page errors: '+JSON.stringify(errors)+'; tiles: '+await page.evaluate(()=>(document.getElementById('tiles')||{}).innerHTML+' | hypeAudio:'+typeof window.HypeAudio));}
 assert.deepEqual(errors,[],'fixture boots without page errors');return {page,errors};
}
check('side-search',async page=>{
 await page.locator('#global-search-input').fill('discipline');
 await page.locator('.search-result').getByRole('button',{name:'Play Fixture rant',exact:true}).waitFor({timeout:3000});
 assert.ok((await page.locator('.search-result .clip-quote').innerText()).includes('Discipline is what you do'),'the result shows the side transcript as its preview');
 assert.equal(await page.evaluate(()=>window.sideReads),1,'the side row is read once');
 await page.locator('#global-search-input').fill('the row already');
 await page.locator('.search-result').getByRole('button',{name:'Play Fixture row text',exact:true}).waitFor({timeout:1500});
 assert.equal(await page.evaluate(()=>window.sideReads),1,'a second search does not read it again');
});
check('side-content-ideas',async page=>{
 // The 'carl' clip with only a side transcript becomes eligible for the content-ideas review once the side row loads.
 await page.evaluate(()=>{window.__renderContentIdeas=typeof renderContentIdeas==='function'?renderContentIdeas:null;});
 assert.ok(await page.evaluate(()=>!!window.__renderContentIdeas),'renderContentIdeas is reachable from the page');
 await page.evaluate(()=>window.__renderContentIdeas());
 // The list sits in a hidden section until opened, so count rows in the DOM rather than waiting for visibility.
 await page.waitForFunction(()=>document.querySelectorAll('#content-ideas-list .clip').length===2,null,{timeout:3000});
 assert.equal(await page.evaluate(()=>document.querySelectorAll('#content-ideas-list .clip').length),2,'both carl clips with a transcript (row text and side text) are pending');
});
check('side-refused',async page=>{
 await page.locator('#global-search-input').fill('Fixture rant');
 await page.locator('.search-result').getByRole('button',{name:'Play Fixture rant',exact:true}).waitFor({timeout:1500});
 await page.locator('#global-search-input').fill('discipline');
 await page.waitForTimeout(400);
 assert.equal(await page.locator('.search-result').count(),0,'a refused side read finds nothing by transcript, and does not loop');
 assert.ok(await page.evaluate(()=>window.sideReads)<=3,'a refused read is not retried in a loop');
},{refuse:true});
// HYPE_BROWSER_CHANNEL=chrome runs it in the installed Chrome when Playwright's own Chromium is not installed.
const browser=await chromium.launch(process.env.HYPE_BROWSER_CHANNEL?{channel:process.env.HYPE_BROWSER_CHANNEL}:{});let failed=0;
for(const c of cases){
 const {page,errors}=await fixture(browser,c.opts||{});
 try{await c.run(page);assert.deepEqual(errors,[],'no page errors');console.log('ok  ',c.name);}catch(e){failed++;console.log('FAIL',c.name,'-',e.message);}
 await page.close();
}
await browser.close();process.exit(failed?1:0);
