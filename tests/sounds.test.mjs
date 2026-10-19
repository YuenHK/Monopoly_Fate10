import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchSoundCatalog,parseSoundPage,validSound} from '../sound-library.mjs';
import {createApplication} from '../server.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
const page=(id,name='測試 &amp; 音效',pages=1)=>`<button onclick="play('https://memeprod.sgp1.digitaloceanspaces.com/user-sound/${id}.mp3', ${id});"><span>${name}</span></button><a href="https://memes.tw/sound?page=${pages}">頁</a>`;
test('sound parser uses source IDs and decoded text, rejects unsafe media and unreadable pages',()=>{
  assert.equal(parseSoundPage(page(1).replace('?page=1','?sort=new&amp;page=32')).pages,32);
  const parsed=parseSoundPage(page(1));assert.equal(parsed.items[0].name,'測試 & 音效');
  assert.equal(validSound({...parsed.items[0],url:'https://evil.example/sound.mp3'}),false);
  assert.throws(()=>parseSoundPage('<html>Cloudflare</html>'));
});
test('full pagination deduplicates sounds; failed pages never return a partial catalog',async()=>{
  const calls=[];const result=await fetchSoundCatalog(async url=>{calls.push(url);return new Response(url.includes('page=2')?page(2):page(1,'第一',2));});
  assert.deepEqual(result.items.map(s=>s.id),['1','2']);assert.equal(calls.length,2);
  await assert.rejects(()=>fetchSoundCatalog(async url=>url.includes('page=2')?new Response('',{status:403}):new Response(page(1,'第一',2))),/Cloudflare 403/);
});
test('sound selection persists through refresh and failure; source requests never block the game API',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'monopoly-sound-'));let mode='blocked',finish;
  const app=await createApplication({dataDir,setupCode:'test-sounds',soundFetcher:async()=>{
    if(mode==='blocked')return new Response('',{status:403});
    if(mode==='delayed')return new Promise(resolve=>{finish=()=>resolve(new Response(page(987654321,'全新音效')));});
    return new Response(page(987654321,'全新音效'));
  }});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const origin='http://127.0.0.1:'+app.server.address().port;let cookie='';
  const call=async(path,data,method=data===undefined?'GET':'POST')=>{const r=await fetch(origin+path,{method,headers:{cookie,...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});return{status:r.status,body:await r.json(),headers:r.headers};};
  const idle=async()=>{for(let i=0;i<100;i++){const s=(await call('/api/sounds')).body;if(!s.refreshing)return s;await new Promise(r=>setTimeout(r,5));}throw Error('refresh did not finish');};
  try{
    assert.equal((await call('/api/sounds')).status,401);
    await call('/api/setup',{code:'test-sounds',password:'test-sounds-password'});const login=await call('/api/login',{password:'test-sounds-password'});cookie=login.headers.get('set-cookie').split(';')[0];
    const initial=(await call('/api/sounds')).body;assert.ok(initial.items.length>0);assert.ok(initial.items.every(s=>s.enabled));
    const original=initial.items[0].id;await call('/api/sounds',{disabled:[original]},'PUT');
    await call('/api/sounds/refresh',{});const blocked=await idle();assert.match(blocked.attempt.error,/Cloudflare/);assert.equal(blocked.items.find(s=>s.id===original).enabled,false);assert.equal(blocked.updatedAt,initial.updatedAt);
    mode='delayed';await call('/api/sounds/refresh',{});assert.ok((await call('/api/sounds')).body.refreshing);
    assert.equal((await call('/api/classes')).status,200);assert.ok(finish);finish();const updated=await idle();assert.equal(updated.items.length,1);assert.equal(updated.items[0].enabled,true);
    await call('/api/sounds',{disabled:['987654321']},'PUT');mode='normal';await call('/api/sounds/refresh',{});const again=await idle();assert.equal(again.items[0].enabled,false);
    assert.equal((await call('/api/sounds',{disabled:['<script>']},'PUT')).status,400);
    const dbPreference=JSON.parse((await app.db.get("SELECT value FROM settings WHERE key='disabledSounds'")).value);assert.ok(dbPreference.includes(original));assert.ok(dbPreference.includes('987654321'));
    const response=await fetch(origin+'/');assert.match(response.headers.get('content-security-policy'),/media-src 'self' https:\/\/memeprod.sgp1.digitaloceanspaces.com/);
  }finally{finish?.();await app.close();await rm(dataDir,{recursive:true,force:true});}
});

test('unattended timer refreshes without admin visits and stops cleanly',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'monopoly-sound-auto-'));let calls=0;
  const app=await createApplication({dataDir:dir,autoSoundSync:true,soundSyncIntervalMs:40,soundSyncRetryMs:40,soundFetcher:async()=>{calls++;return new Response(page(10001,'自動同步音效'));}});
  try{
    // No HTTP request or admin page is used to trigger either run.
    for(let i=0;i<100&&calls<2;i++)await new Promise(r=>setTimeout(r,10));
    assert.ok(calls>=2,'startup and periodic refresh both run');
  }finally{await app.close();}
  const stoppedAt=calls;await new Promise(r=>setTimeout(r,80));assert.equal(calls,stoppedAt);
  const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(join(dir,'monopoly.sqlite'),{readOnly:true});
  const saved=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='soundCatalog'").get().value);assert.equal(saved.items[0].id,'10001');
  const attempt=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='soundAttempt'").get().value);assert.equal(attempt.ok,true);assert.equal(attempt.failures,0);db.close();await rm(dir,{recursive:true,force:true});
});

test('persistent scheduler calculates successful interval and exponential failure backoff',async()=>{
  const {nextSoundSync}=await import('../sound-sync.mjs');const base=Date.parse('2026-10-19T00:00:00Z'),hour=3600000;
  assert.equal(nextSoundSync(null,{},base),base);
  assert.equal(nextSoundSync({ok:true,finishedAt:new Date(base).toISOString()}),base+6*hour);
  for(const [failures,hours] of [[1,1],[2,2],[3,4],[6,24],[1000,24]])assert.equal(nextSoundSync({ok:false,failures,at:new Date(base).toISOString()}),base+hours*hour);
  assert.equal(nextSoundSync({at:'bad'}, {},base),base);
});
