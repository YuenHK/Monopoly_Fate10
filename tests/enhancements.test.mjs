import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { gunzipSync,gzipSync } from 'node:zlib';
import { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { createApplication } from '../server.mjs';
import { createBoard,nextDraw } from '../game.mjs';

async function pgAdapter(){const pg=await PGlite.create();const q=(s,a)=>{let n=0;return pg.query(s.replace(/\?/g,()=>'$'+(++n)),a);};return {postgres:true,exec:s=>pg.exec(s==='BEGIN IMMEDIATE'?'BEGIN':s),all:async(s,...a)=>(await q(s,a)).rows,get:async(s,...a)=>(await q(s,a)).rows[0],run:(s,...a)=>q(s,a),close:()=>pg.close()};}
test('equal mode maps each target once, independent of cursor, with uniform student-only follow-up',()=>{
  const students=Array.from({length:28},(_,i)=>({id:'s'+i})),board=createBoard(students);
  for(const cursor of [0,7,board.cells.length-1]){
    board.currentIndex=cursor;
    for(const must of [false,true]){
      const targets=board.cells.map((c,i)=>({c,i})).filter(t=>!must||t.c.type==='student'),seen=new Map();
      for(let n=0;n<targets.length;n++){
        const m=nextDraw(board,must,'dice','equal',size=>{assert.equal(size,targets.length);return n;});assert.equal(m.targetIndex,targets[n].i);assert.equal((cursor+m.steps)%board.cells.length,m.targetIndex);assert.equal(m.dice,null);seen.set(m.cell.studentId,(seen.get(m.cell.studentId)||0)+1);
      }
      for(const s of students)assert.equal(seen.get(s.id),1);
      if(must)assert.equal(seen.has(undefined),false);
    }
  }
});
for(const backend of ['SQLite','PostgreSQL'])test(`${backend}: preferences, reversible statistics, QR and complete restore`,async t=>{
  const dir=await mkdtemp(join(tmpdir(),'monopoly26-')),app=await createApplication({dataDir:dir,setupCode:'test26',...(backend==='PostgreSQL'?{database:await pgAdapter()}: {})});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const origin='http://127.0.0.1:'+app.server.address().port;let cookie='',classId,students,draw,token,avatarId,backup;
  async function call(path,body,method=body===undefined?'GET':'POST',authenticated=true){const r=await fetch(origin+path,{method,headers:{...(authenticated&&cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const bytes=Buffer.from(await r.arrayBuffer());return {status:r.status,headers:r.headers,body:r.headers.get('content-type')?.includes('application/json')?JSON.parse(bytes):bytes};}
  const file=data=>gzipSync(JSON.stringify(data)).toString('base64');
  try{
    await call('/api/setup',{code:'test26',password:'independent-test-password'});const login=await call('/api/login',{password:'independent-test-password'});cookie=login.headers.get('set-cookie').split(';')[0];
    await t.test('new classes default to equal, existing legacy class stays dice, themes inherit independently',async()=>{
      const legacy=(await call('/api/classes')).body[0];assert.equal(legacy.draw_mode,'dice');classId=(await call('/api/classes',{name:'示範班'})).body.id;
      assert.deepEqual((await call(`/api/classes/${classId}/preferences`)).body,{theme:null,drawMode:'equal'});
      students=(await call(`/api/classes/${classId}/students`,{students:[{number:'1',name:'示範甲'},{number:'2',name:'示範乙'}]},'PUT')).body;
      await call('/api/theme',{theme:'cat'},'PUT');assert.equal((await call('/api/play/theme?classId='+classId,undefined,'GET',false)).body.theme,'cat');
      assert.equal((await call(`/api/classes/${classId}/preferences`,{theme:'dog'},'PUT',false)).status,401);
      await call(`/api/classes/${classId}/preferences`,{theme:'dog'},'PUT');assert.equal((await call('/api/play/theme?classId='+classId,undefined,'GET',false)).body.theme,'dog');assert.equal((await call('/api/play/theme',undefined,'GET',false)).body.theme,'cat');
      assert.equal((await call(`/api/classes/${classId}/preferences`,{theme:'evil'},'PUT')).status,400);assert.equal((await call(`/api/classes/${classId}/preferences`,{drawMode:'weighted'},'PUT')).status,400);
      const g=(await call(`/api/play/classes/${classId}/game`,{},'POST',false)).body;assert.equal(g.theme,'dog');assert.equal(g.draw_mode,'equal');
      do{draw=(await call(`/api/play/classes/${classId}/draw`,{mode:'quick',requestId:'q'+Math.random()},'POST',false)).body;}while(draw.kind!=='student');assert.equal(draw.move.algorithm,'equal');
    });
    await t.test('voiding changes all count surfaces and is reversible without deleting or rewinding',async()=>{
      const initial=(await call(`/api/classes/${classId}/stats`)).body,record=await app.db.get('SELECT board FROM lessons WHERE class_id=?',classId);
      assert.equal((await call('/api/draws/'+draw.id+'/void',{voided:true,reason:'誤按'},'PUT',false)).status,401);assert.equal((await call('/api/draws/'+draw.id+'/void',{voided:true,reason:''},'PUT')).status,400);
      assert.equal((await call('/api/draws/'+draw.id+'/void',{voided:true,reason:'誤按'},'PUT')).status,200);
      const changed=(await call(`/api/classes/${classId}/stats`)).body;assert.equal(changed.summary.studentDraws,initial.summary.studentDraws-1);assert.equal(changed.students.reduce((n,s)=>n+Number(s.count),0),initial.summary.studentDraws-1);assert.equal(changed.draws.find(d=>d.id===draw.id).voided,1);
      assert.equal((await app.db.get('SELECT board FROM lessons WHERE class_id=?',classId)).board,record.board);
      const repeated=await call(`/api/play/classes/${classId}/draw`,{mode:'quick',requestId:draw.request_id},'POST',false);assert.equal(repeated.body.id,draw.id);assert.equal(repeated.body.voided,1);
      const c=(await call('/api/classes')).body.find(c=>c.id===classId);assert.equal(Number(c.draw_count),changed.draws.filter(d=>!d.voided).length);
      const l=(await call('/api/lessons')).body.find(l=>l.class_id===classId);assert.equal(Number(l.draw_count),changed.summary.studentDraws);assert.equal((await call('/api/lessons/'+l.id+'/stats')).body.students.reduce((n,s)=>n+Number(s.count),0),changed.summary.studentDraws);
      await call('/api/draws/'+draw.id+'/void',{voided:false},'PUT');assert.equal((await call(`/api/classes/${classId}/stats`)).body.summary.studentDraws,initial.summary.studentDraws);
      await call('/api/draws/'+draw.id+'/void',{voided:true,reason:'保留撤銷狀態測試'},'PUT');
    });
    await t.test('QR batch uses individual valid links and preserves animated GIF bytes',async()=>{
      const old=(await call('/api/students/'+students[0].id+'/link',{})).body.path.split('=')[1];
      const batch=(await call(`/api/classes/${classId}/links`,{format:'qr'})).body;assert.equal(batch.length,2);assert.equal(new Set(batch.map(b=>b.path)).size,2);for(const b of batch){assert.match(b.qr,/<svg/);assert.match(b.qr,/<path/);const raster=await sharp(Buffer.from(b.qr)).resize(400,400).ensureAlpha().raw().toBuffer({resolveWithObject:true});const decoded=jsQR(new Uint8ClampedArray(raster.data),raster.info.width,raster.info.height);assert.equal(decoded?.data,new URL(b.path,origin).href);assert.ok(Number(b.expires)>Date.now()+6*86400e3);}
      assert.equal((await call('/api/student',{token:old},'POST',false)).status,404);token=batch[0].path.split('=')[1];assert.equal((await call('/api/student',{token},'POST',false)).status,200);
      const png=await sharp({create:{width:4,height:4,channels:3,background:'red'}}).gif().toBuffer(),offset=13+((png[10]&128)?3*(2**((png[10]&7)+1)):0);const gif=Buffer.concat([png.subarray(0,offset),png.subarray(offset,-1),png.subarray(offset,-1),Buffer.from([0x3b])]);
      const upload=await call('/api/student/avatar',{token,base64:gif.toString('base64')},'POST',false);assert.equal(upload.status,201);avatarId=upload.body.id;await call('/api/avatars/'+avatarId,{status:'approved'},'PUT');
      const stored=await app.db.get('SELECT bytes FROM avatars WHERE id=?',avatarId);assert.deepEqual(Buffer.from(stored.bytes),gif);
    });
    await t.test('export includes all classroom data and excludes teacher credentials and sessions',async()=>{
      assert.equal((await call('/api/backup/export',undefined,'GET',false)).status,401);const exported=await call('/api/backup/export');assert.equal(exported.status,200);backup=JSON.parse(gunzipSync(exported.body));assert.equal(backup.format,'Monopoly_Fate10');const totals=(await call('/api/backup/summary')).body;assert.equal(totals.students,backup.data.students.length);assert.equal(totals.draws,backup.data.draws.length);assert.ok(backup.data.avatars.length);assert.ok(backup.data.draws.some(d=>d.voided));assert.equal(backup.data.classes.find(c=>c.id===classId).theme,'dog');
      assert.equal(backup.data.logins,undefined);for(const k of ['password','salt','legacyImported'])assert.equal(backup.data.settings.some(s=>s.key===k),false);assert.ok(backup.data.settings.some(s=>s.key==='soundCatalog'));
    });
    await t.test('malformed, credential-bearing and broken-reference backups cannot alter data',async()=>{
      const count=Number((await app.db.get('SELECT count(*) AS n FROM students')).n);
      for(const change of [b=>b.data.settings.push({key:'password',value:'x'}),b=>b.data.logins=[],b=>b.data.students[0].class_id='missing',b=>b.data.avatars[0].bytes='not-valid!',b=>b.data.classes[0].draw_mode='evil',b=>b.data.links.push({...b.data.links[0]})]){const b=structuredClone(backup);change(b);assert.equal((await call('/api/backup/preview',{file:file(b)})).status,400);}
      assert.equal((await call('/api/backup/preview',{file:'eHl6'})).status,400);assert.equal(Number((await app.db.get('SELECT count(*) AS n FROM students')).n),count);
    });
    await t.test('restore requires a downloaded safety copy and rejects stale previews',async()=>{
      let p=(await call('/api/backup/preview',{file:file(backup)})).body;assert.equal((await call('/api/backup/restore',{previewId:p.previewId,backupSaved:true,confirmation:'取代全部資料'})).status,400);
      assert.equal((await call('/api/backup/safety/'+p.previewId)).status,200);await call(`/api/classes/${classId}`,{name:'已改班名'},'PUT');assert.equal((await call('/api/backup/restore',{previewId:p.previewId,backupSaved:true,confirmation:'取代全部資料'})).status,409);
    });
    await t.test('database failure rolls back, then successful restore retains GIF, links and login password',async()=>{
      await call('/api/classes',{name:'將被還原的額外班別'});const p=(await call('/api/backup/preview',{file:file(backup)})).body;assert.ok(p.current.classes>p.incoming.classes);assert.equal(p.differences.find(d=>d.key==='classes').removed,1);assert.equal(p.differences.find(d=>d.key==='classes').changed,1);assert.equal((await call('/api/backup/safety/'+p.previewId)).status,200);
      const before=await app.db.all('SELECT id,name FROM classes ORDER BY id'),run=app.db.run;let failed=false;app.db.run=async(sql,...args)=>{if(!failed&&sql.startsWith('INSERT INTO students')){failed=true;throw new Error('test rollback');}return run(sql,...args);};
      assert.equal((await call('/api/backup/restore',{previewId:p.previewId,backupSaved:true,confirmation:'取代全部資料'})).status,500);app.db.run=run;assert.deepEqual(await app.db.all('SELECT id,name FROM classes ORDER BY id'),before);
      const restored=await call('/api/backup/restore',{previewId:p.previewId,backupSaved:true,confirmation:'取代全部資料'});assert.equal(restored.status,200);assert.equal((await call('/api/classes')).body.find(c=>c.id===classId).name,'示範班');
      assert.deepEqual(Buffer.from((await app.db.get('SELECT bytes FROM avatars WHERE id=?',avatarId)).bytes),Buffer.from(backup.data.avatars[0].bytes,'base64'));assert.equal((await call('/api/student',{token},'POST',false)).status,200);assert.equal((await call('/api/login',{password:'independent-test-password'})).status,200);
      assert.equal((await call('/api/backup/restore',{previewId:p.previewId,backupSaved:true,confirmation:'取代全部資料'})).status,409);
    });
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
