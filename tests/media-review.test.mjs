import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../server.mjs';
import {filterThemeMedia,createMediaPolicyLoader,approvedSchoolSound} from '../media-policy.js';
import {themeById} from '../themes.js';
import {createBackgroundPlaylist} from '../background-playlist.js';

test('theme media bans are authorized, global, conflict-safe and persistent; previews create no draws',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'monopoly-review-'));let app,cookie='',origin;
 async function open(){app=await createApplication({dataDir:dir,setupCode:'review-setup'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+app.server.address().port;}
 async function call(path,data,method=data===undefined?'GET':'POST',auth=true){const r=await fetch(origin+path,{method,headers:{...(auth&&cookie?{cookie}:{}),...(data!==undefined?{'content-type':'application/json'}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{})});return {status:r.status,headers:r.headers,body:await r.json()};}
 try{
  await open();assert.equal((await call('/api/theme-media')).status,401);
  await call('/api/setup',{code:'review-setup',password:'safe-review-password'});cookie=(await call('/api/login',{password:'safe-review-password'})).headers.get('set-cookie').split(';')[0];
  const media=(await call('/api/theme-media')).body;assert.equal(media.revision,0);
  const sounds=media.items.filter(i=>i.kind==='sound'&&i.themes.includes('basic'));assert.ok(sounds.length>800);assert.equal(media.soundScreening.total,1135);assert.ok(media.soundScreening.excluded>100);assert.ok(sounds.some(s=>s.title.includes('BRUH')));
  const item=sounds[0];assert.equal((await call('/api/theme-media',{key:item.key,blocked:true,revision:0},'PUT',false)).status,401);
  let saved=(await call('/api/theme-media',{key:item.key,blocked:true,revision:0},'PUT')).body;assert.deepEqual(saved.blocked,[item.key]);
  assert.equal((await call('/api/theme-media',{key:item.key,blocked:false,revision:0},'PUT')).status,409);
  assert.equal((await call('/api/theme-media',{key:'video:../../private',blocked:true,revision:saved.revision},'PUT')).status,400);
  const pub=(await call('/api/play/sounds?theme=basic',undefined,'GET',false)).body.items;assert.equal(pub.length,sounds.length-1);assert.ok(pub.every(s=>approvedSchoolSound(s)&&s.id!==item.id));
  assert.equal((await call('/api/play/sounds?theme=cat',undefined,'GET',false)).body.items.length,1);
  for(const video of media.items.filter(i=>i.kind==='video'&&i.themes.includes('basic')))saved=(await call('/api/theme-media',{key:video.key,blocked:true,revision:saved.revision},'PUT')).body;
  const policy=(await call('/api/play/media-policy',undefined,'GET',false)).body;assert.deepEqual(policy,saved);
  const theme=filterThemeMedia(themeById('basic'),policy);assert.equal(theme.video,null);assert.deepEqual(theme.videos,[]);assert.ok(filterThemeMedia(themeById('cat'),policy).videos.length);
  const page=await fetch(origin+'/theme-preview.html?theme=basic&interactive=1');assert.equal(page.status,200);assert.match(await page.text(),/simulation-result/);
  assert.equal(Number((await app.db.get('SELECT count(*) AS n FROM draws')).n),0);
  await app.close();await open();assert.deepEqual((await call('/api/play/media-policy',undefined,'GET',false)).body,policy);
  cookie=(await call('/api/login',{password:'safe-review-password'})).headers.get('set-cookie').split(';')[0];
  const restored=(await call('/api/theme-media',{key:item.key,blocked:false,revision:policy.revision},'PUT')).body;assert.ok(!restored.blocked.includes(item.key));
  await call('/api/sounds',{disabled:[item.id]},'PUT');
  assert.ok(!(await call('/api/play/sounds?theme=basic',undefined,'GET',false)).body.items.some(s=>s.id===item.id));
  assert.equal((await call('/api/theme-media')).body.items.find(s=>s.key===item.key).blocked,true);
  await call('/api/theme-media',{key:item.key,blocked:false,revision:restored.revision},'PUT');
  assert.ok((await call('/api/play/sounds?theme=basic',undefined,'GET',false)).body.items.some(s=>s.id===item.id));
 }finally{await app?.close();await rm(dir,{recursive:true,force:true});}
});
test('missing policy stops media; blocked fallback and music cannot bypass teacher exclusions',()=>{
 const theme=themeById('cat');const unavailable=filterThemeMedia(theme,null);assert.equal(unavailable.music,null);assert.equal(unavailable.video,null);assert.deepEqual(unavailable.videos,[]);
 const policy={revision:4,blocked:['music:cat',...[theme.video,...theme.videos].map(s=>'video:'+s.replace('theme-media/',''))]};const filtered=filterThemeMedia(theme,policy);assert.equal(filtered.music,null);assert.equal(filtered.video,null);assert.deepEqual(filtered.videos,[]);
 class Media extends EventTarget{src='';pause(){this.paused=true;}load(){}play(){this.paused=false;return Promise.resolve();}}
 const media=new Media(),playlist=createBackgroundPlaylist(media);playlist.setTheme({...theme,libraryRevision:'before'});playlist.setEnabled(true);assert.ok(media.src);playlist.setTheme(filtered);assert.equal(media.src,'');assert.equal(media.paused,true);playlist.setEnabled(true);assert.equal(media.paused,true);
});
test('policy outage cannot reuse a cached allow-all result',async()=>{
 let fail=false;const load=createMediaPolicyLoader({origin:()=>'',fetcher:async()=>{if(fail)throw Error();return {ok:true,json:async()=>({revision:0,blocked:[]})};}});assert.equal((await load()).revision,0);fail=true;assert.equal(await load({force:true}),null);
});
