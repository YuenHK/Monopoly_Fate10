import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PGlite } from '@electric-sql/pglite';
import { mergeClassRecords } from '../class-records.mjs';
import { createApplication } from '../server.mjs';
import { THEME_MEDIA } from '../themes.js';

const password = 'testing-teacher-password-2026';
async function postgresAdapter() {
  const pg = await PGlite.create();
  const query = (sql,args) => {let n=0;return pg.query(sql.replace(/\?/g,()=>'$'+(++n)),args);};
  return {
    postgres:true,
    exec:sql=>pg.exec(sql === 'BEGIN IMMEDIATE' ? 'BEGIN' : sql),
    all:async(sql,...args)=>(await query(sql,args)).rows,
    get:async(sql,...args)=>(await query(sql,args)).rows[0],
    run:(sql,...args)=>query(sql,args),
    close:()=>pg.close()
  };
}
for (const backend of ['SQLite','PostgreSQL']) {
  test(`${backend}: classroom workflow, authorization and persistence`, async t => {
    const dataDir=await mkdtemp(join(tmpdir(),'monopoly-test-'));
    const publicOrigin='https://yuenhk.github.io';
    const app=await createApplication({dataDir,setupCode:'test-setup',publicOrigin,...(backend==='PostgreSQL'?{database:await postgresAdapter()}:{})});
    app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
    const origin='http://127.0.0.1:'+app.server.address().port;let cookie='';
    async function call(path,data,method=data===undefined?'GET':'POST',auth=true,headers={}){
      const res=await fetch(origin+path,{method,headers:{...(auth&&cookie?{cookie}:{}),...(data===undefined?{}:{'content-type':'application/json'}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
      const body=await res.json();return{status:res.status,body,res};
    }
    let classId, otherClass, lessonId, lesson2, studentRows, token, approvedId, gif;
    try {
      await t.test('teacher setup, private roster, and cross-origin protection',async()=>{
        assert.equal((await call('/api/classes',undefined,'GET',false)).status,401);
        assert.equal((await call('/api/setup',{code:'wrong',password})).status,403);
        assert.equal((await call('/api/setup',{code:'test-setup',password})).status,200);
        assert.equal((await call('/api/setup',{code:'test-setup',password})).status,409);
        assert.equal((await call('/api/login',{password:'wrong-password'})).status,401);
        const login=await call('/api/login',{password});assert.equal(login.status,200);cookie=login.res.headers.get('set-cookie').split(';')[0];
        const original=(await call('/api/classes')).body;assert.equal(Number(original[0].student_count),32);
        assert.equal((await call('/api/classes',{name:'evil'},'POST',true,{origin:'https://evil.example'})).status,403);
        for(const path of ['/data/monopoly.sqlite','/server.mjs','/.archive/index.original.html','/legacy-roster.json'])assert.equal((await call(path)).status,404);
      });
      await t.test('multiple classes, same-name students, duplicate numbers and stable identity',async()=>{
        classId=(await call('/api/classes',{name:'4A'})).body.id;
        otherClass=(await call('/api/classes',{name:'4B'})).body.id;
        assert.equal((await call(`/api/classes/${classId}/preferences`)).body.drawMode,'equal');
        await call(`/api/classes/${classId}/preferences`,{drawMode:'dice'},'PUT');
        assert.equal((await call('/api/classes',{name:'4A'})).status,409);
        const roster=[{number:'1',name:'楊凱喬'},{number:'2',name:'楊茵晴'},{number:'3',name:'同名同學'},{number:'4',name:'同名同學'}];
        assert.equal((await call(`/api/classes/${classId}/students`,{students:[roster[0],roster[0]]},'PUT')).status,400);
        studentRows=(await call(`/api/classes/${classId}/students`,{students:roster},'PUT')).body;
        assert.equal(studentRows.length,4);assert.notEqual(studentRows[2].id,studentRows[3].id);
        const again=(await call(`/api/classes/${classId}/students`,{students:roster},'PUT')).body;
        assert.equal(again[0].id,studentRows[0].id);
        await call(`/api/classes/${otherClass}/students`,{students:[{number:'1',name:'另一班學生'}]},'PUT');
        lessonId=(await call('/api/lessons',{classId,name:'第一課'})).body.id;
        lesson2=(await call(`/api/classes/${otherClass}/game`,{})).body.id;
        assert.equal((await call('/api/lessons',{classId,name:'第二課'})).body.id,lessonId);
        assert.equal((await call(`/api/classes/${classId}/game`,{})).body.id,lessonId);
      });
      await t.test('GIF upload stays pending, exact animation bytes survive approval, and links revoke',async()=>{
        const one=await sharp({create:{width:2,height:2,channels:3,background:'red'}}).gif().toBuffer();
        const offset=13+((one[10]&128)?3*(2**((one[10]&7)+1)):0);
        gif=Buffer.concat([one.subarray(0,offset),one.subarray(offset,-1),one.subarray(offset,-1),Buffer.from([0x3b])]);
        assert.equal((await sharp(gif,{animated:true}).metadata()).pages,2);
        const link=(await call(`/api/students/${studentRows[0].id}/link`,{})).body;
        token=new URLSearchParams(link.path.split('#')[1]).get('token');
        assert.equal((await call('/api/student',{token},'POST',false)).body.name,'楊凱喬');
        assert.equal((await call('/api/student/avatar',{token,base64:Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')},'POST',false)).status,400);
        assert.equal((await call('/api/student/avatar',{token,base64:gif.toString('base64')},'POST',false)).status,201);
        let avatars=(await call('/api/avatars')).body;approvedId=avatars[0].id;
        assert.equal(avatars[0].status,'pending');
        assert.equal((await fetch(origin+'/media/'+approvedId)).status,401);
        assert.equal((await call(`/api/classes/${classId}/students`)).body[0].avatar_id,null);
        await call('/api/avatars/'+approvedId,{status:'approved'},'PUT');
        assert.equal((await call(`/api/classes/${classId}/students`)).body[0].avatar_id,approvedId);
        const media=await fetch(origin+'/media/'+approvedId);assert.equal(media.headers.get('content-type'),'image/gif');assert.deepEqual(Buffer.from(await media.arrayBuffer()),gif);
        await call('/api/student/avatar',{token,base64:gif.toString('base64')},'POST',false);
        assert.equal((await call(`/api/classes/${classId}/students`)).body[0].avatar_id,approvedId);
        const pending=(await call('/api/avatars')).body.find(a=>a.status==='pending');await call('/api/avatars/'+pending.id,{},'DELETE');
        const newLink=(await call(`/api/students/${studentRows[0].id}/link`,{})).body;
        assert.equal((await call('/api/student',{token},'POST',false)).status,404);
        token=new URLSearchParams(newLink.path.split('#')[1]).get('token');
        await call(`/api/students/${studentRows[0].id}/link`,{},'DELETE');
        assert.equal((await call('/api/student',{token},'POST',false)).status,404);
        const batch=(await call(`/api/classes/${classId}/links`,{})).body;assert.equal(batch.length,4);assert.equal(new Set(batch.map(l=>l.path)).size,4);
      });
      await t.test('all students eligible, special events force next student, server records once on retries',async()=>{
        assert.equal((await call('/api/events',{chance:[],fate:['命運']},'PUT')).status,400);
        await call('/api/events',{chance:['新的機會'],fate:['新的命運']},'PUT');
        const first=await call(`/api/lessons/${lessonId}/draw`,{mode:'dice',requestId:'first'});
        assert.equal(first.status,200);assert.equal(first.body.move.dice.length,2);
        const again=await call(`/api/lessons/${lessonId}/draw`,{mode:'dice',requestId:'first'});
        assert.equal(again.body.id,first.body.id);assert.deepEqual(again.body.move,first.body.move);
        const simultaneous=await Promise.all(Array.from({length:4},()=>call(`/api/lessons/${lessonId}/draw`,{mode:'quick',requestId:'concurrent'})));
        assert.equal(new Set(simultaneous.map(r=>r.body.id)).size,1);
        const hits=new Set();let last=simultaneous[0].body,events=0;
        for(let i=0;i<120;i++){
          const {status,body:r}=await call(`/api/lessons/${lessonId}/draw`,{mode:'quick',requestId:randomUUID()});assert.equal(status,200);
          if(last.kind!=='student')assert.equal(r.kind,'student');
          if(r.kind==='student')hits.add(r.student_name);else{events++;assert.equal(r.event_text,r.kind==='chance'?'新的機會':'新的命運');}
          last=r;
        }
        assert.ok(hits.has('楊凱喬'));assert.ok(hits.has('楊茵晴'));assert.ok(events>0);
        const summary=(await call(`/api/lessons/${lessonId}/stats`)).body;
        assert.equal(summary.draws.length,122);assert.equal(summary.students.length,4);
        assert.equal(summary.students.reduce((n,s)=>n+Number(s.count),0),summary.draws.filter(d=>d.kind==='student').length);
        const untouched=(await call(`/api/lessons/${lesson2}/stats`)).body;assert.equal(untouched.draws.length,0);assert.ok(untouched.students.every(s=>Number(s.count)===0));
      });
      await t.test('class totals use one persistent record with Hong Kong month and Monday week boundaries',async()=>{
        const l1=(await call('/api/lessons',{classId:otherClass,name:'統計範圍測試一'})).body.id;
        const l2=(await call('/api/lessons',{classId:otherClass,name:'統計範圍測試二'})).body.id;
        const student=(await call(`/api/classes/${otherClass}/students`)).body[0];
        try {
          const times=['2026-10-11T15:59:59.000Z','2026-10-11T16:00:00.000Z','2026-10-18T15:59:59.000Z','2026-10-18T16:00:00.000Z','2026-10-31T15:59:59.000Z','2026-10-31T16:00:00.000Z'];
          for(let i=0;i<times.length;i++)await app.db.run('INSERT INTO draws(id,lesson_id,kind,student_id,student_name,student_number,event_text,created,request_id,animation) VALUES(?,?,?,?,?,?,?,?,?,?)',randomUUID(),i%2?l1:l2,'student',student.id,student.name,student.number,null,times[i],randomUUID(),null);
          await app.db.run('INSERT INTO draws(id,lesson_id,kind,student_id,student_name,student_number,event_text,created,request_id,animation) VALUES(?,?,?,?,?,?,?,?,?,?)',randomUUID(),l1,'chance',null,null,null,'機會事件','2026-10-18T16:00:00.000Z',randomUUID(),null);
          const total=(await call(`/api/classes/${otherClass}/stats`)).body;
          assert.equal(total.summary.studentDraws,6);assert.equal(total.summary.eventDraws,1);assert.equal(total.summary.lessonCount,1);assert.equal(Number(total.students[0].count),6);
          assert.deepEqual(total.timeline,[{label:'2026-10',count:5},{label:'2026-11',count:1}]);
          const month=(await call(`/api/classes/${otherClass}/stats?period=month&date=2026-10`)).body;
          assert.equal(month.summary.studentDraws,5);assert.equal(month.timeline.length,31);
          const week=(await call(`/api/classes/${otherClass}/stats?period=week&date=2026-10-19`)).body;
          assert.equal(week.summary.studentDraws,1);assert.equal(week.summary.eventDraws,1);assert.equal(week.timeline.length,7);
          assert.equal((await call(`/api/classes/${otherClass}/stats?period=week&date=2026-10-12`)).body.summary.studentDraws,2);
          const empty=(await call(`/api/classes/${otherClass}/stats?period=month&date=2026-12`)).body;
          assert.equal(empty.summary.studentDraws,0);assert.equal(Number(empty.students[0].count),0);
          assert.equal((await call(`/api/classes/${otherClass}/stats?period=week&date=2026-02-30`)).status,400);
          assert.equal((await call(`/api/classes/${otherClass}/stats`,undefined,'GET',false)).status,401);
        } finally {await app.db.run('DELETE FROM draws WHERE lesson_id IN (?,?)',l1,l2);await app.db.run('DELETE FROM lessons WHERE id IN (?,?)',l1,l2);}
      });
      await t.test('closed lessons, removed students, and archived classes preserve history',async()=>{
        await call(`/api/lessons/${lessonId}`,{closed:true},'PUT');
        assert.equal((await call(`/api/lessons/${lessonId}/draw`,{mode:'quick',requestId:randomUUID()})).status,409);
        assert.equal((await call(`/api/lessons/${lessonId}/draw`,{mode:'dice',requestId:'first'})).status,200);
        await call(`/api/lessons/${lessonId}`,{closed:false},'PUT');
        const oldCount=(await call(`/api/lessons/${lessonId}/stats`)).body.draws.length;
        await call(`/api/classes/${classId}/students`,{students:[{number:'2',name:'楊茵晴'}]},'PUT');
        const historical=(await call(`/api/lessons/${lessonId}/stats`)).body;
        assert.equal(historical.draws.length,oldCount);assert.ok(historical.students.some(s=>s.name==='楊凱喬'&&!s.active));
        assert.equal((await call(`/api/lessons/${lessonId}`)).body.students.length,1);
        await call(`/api/classes/${classId}`,{},'DELETE');
        assert.equal((await call(`/api/lessons/${lessonId}`,{closed:false},'PUT')).status,404);
        assert.equal((await call(`/api/lessons/${lessonId}/stats`)).body.draws.length,oldCount);
        assert.equal((await call(`/api/classes/${classId}/stats`)).body.draws.length,oldCount);
        assert.ok((await call('/api/classes?includeArchived=1')).body.some(c=>c.id===classId&&c.archived));
      });
      await t.test('one class record resumes, migration retains old draws and aliases, individual edits keep identity',async()=>{
        const c=(await call('/api/classes',{name:'持續記錄測試'})).body.id;
        const added=await call('/api/students',{classId:c,name:'測試同學',school_class:'4A',number:'01'});
        assert.equal(added.status,201);const sid=added.body.id;
        const opens=await Promise.all(Array.from({length:4},()=>call(`/api/classes/${c}/game`,{})));
        const record=opens[0].body;assert.equal(new Set(opens.map(r=>r.body.id)).size,1);
        const first=(await call(`/api/classes/${c}/draw`,{mode:'quick',requestId:'same'})).body;
        const resume=(await call(`/api/classes/${c}/game`,{})).body;
        assert.equal(resume.id,record.id);assert.deepEqual(resume.board,first.board);
        assert.equal(Number(resume.must_student),Number(first.kind!=='student'));
        assert.equal((await call(`/api/classes/${c}/draw`,{mode:'quick',requestId:'same'})).body.id,first.id);
        await app.db.run('INSERT INTO avatars(id,student_id,mime,bytes,status,created) VALUES(?,?,?,?,?,?)','edit-avatar',sid,'image/gif',gif,'approved','2026-01-01');
        const edited=await call('/api/students/'+sid,{name:'改名同學',school_class:'4B',number:'2'},'PUT');assert.equal(edited.status,200);assert.equal(edited.body.id,sid);
        const roster=(await call(`/api/classes/${c}/students`)).body;assert.equal(roster[0].display_id,'4B 2 改名同學');assert.equal(roster[0].avatar_id,'edit-avatar');
        assert.equal((await call('/api/students',{classId:c,name:'另一同學',school_class:'4B',number:'2'})).status,409);
        assert.equal((await call(`/api/classes/${c}/stats`)).body.draws.length,1);
        await app.db.exec('DROP INDEX one_record_per_class');
        const old='old-record-'+c,oldDraw=randomUUID();
        await app.db.run('INSERT INTO lessons(id,class_id,name,created) VALUES(?,?,?,?)',old,c,'舊課堂','2025-01-01');
        await app.db.run('INSERT INTO draws(id,lesson_id,kind,student_id,student_name,student_number,event_text,created,request_id,animation) VALUES(?,?,?,?,?,?,?,?,?,?)',oldDraw,old,'student',sid,'舊姓名','1',null,'2025-01-01T00:00:00.000Z','same',null);
        await mergeClassRecords(app.db);await mergeClassRecords(app.db);
        assert.equal(Number((await app.db.get('SELECT count(*) AS n FROM lessons WHERE class_id=?',c)).n),1);
        const migrated=(await call(`/api/classes/${c}/stats`)).body;assert.equal(migrated.draws.length,2);assert.ok(migrated.draws.some(d=>d.id===oldDraw&&d.student_name==='舊姓名'));
        assert.equal((await call(`/api/lessons/${old}`)).body.id,record.id);
        assert.equal((await call(`/api/lessons/${old}/draw`,{mode:'quick',requestId:'same'})).body.id,oldDraw);
        assert.equal((await call(`/api/classes/${c}/draw`,{mode:'quick',requestId:'same'})).body.id,first.id);
        await app.db.run('DELETE FROM draws WHERE lesson_id=?',record.id);
      });
      await t.test('anonymous Pages game records once while admin and archived classes stay protected',async()=>{
        const c=(await call('/api/classes',{name:'公開抽籤測試'})).body.id;
        await call(`/api/classes/${c}/students`,{students:[{name:'公開測試學生',number:'1'}]},'PUT');
        const headers={origin:publicOrigin,'sec-fetch-site':'cross-site'};
        const preflight=await fetch(origin+`/api/play/classes/${c}/draw`,{method:'OPTIONS',headers:{origin:publicOrigin,'access-control-request-method':'POST','access-control-request-headers':'content-type'}});
        assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),publicOrigin);
        assert.equal(preflight.headers.get('access-control-allow-credentials'),null);
        const list=await call('/api/play/classes',undefined,'GET',false,headers);
        assert.ok(list.body.some(row=>row.id===c));assert.deepEqual(Object.keys(list.body.find(row=>row.id===c)).sort(),['id','name','student_count']);
        const game=await call(`/api/play/classes/${c}/game`,{},'POST',false,headers);
        assert.equal(game.status,200);assert.equal(game.body.students.length,1);assert.equal(game.body.class_name,'公開抽籤測試');
        const draw=await call(`/api/play/classes/${c}/draw`,{mode:'quick',requestId:'public-once'},'POST',false,headers);
        assert.equal(draw.status,200);assert.equal((await call(`/api/play/classes/${c}/draw`,{mode:'quick',requestId:'public-once'},'POST',false,headers)).body.id,draw.body.id);
        assert.equal((await call(`/api/classes/${c}/stats`)).body.draws.length,1);
        assert.equal((await call(`/api/play/classes/${c}/game`,{},'POST',false,headers)).body.id,game.body.id);
        assert.equal((await call('/api/play/lessons/'+game.body.id,undefined,'GET',false,headers)).body.class_id,c);
        const sounds=await call('/api/play/sounds',undefined,'GET',false,headers);assert.equal(sounds.status,200);assert.deepEqual(Object.keys(sounds.body),['items']);assert.ok(sounds.body.items.every(s=>s.enabled));assert.equal(sounds.body.items.length,8);for(const s of sounds.body.items){assert.match(s.url,/^theme-media\/school-sounds\/[a-z0-9-]+\.mp3\?v=[a-f0-9]{64}$/);assert.equal((await fetch(origin+'/'+s.url)).status,200);}assert.equal((await fetch(origin+'/sound/1.mp3')).status,404);
        for(const path of ['/api/classes','/api/avatars','/api/events',`/api/classes/${c}/stats`,`/api/classes/${c}/students`])assert.equal((await call(path,undefined,'GET',false)).status,401);
        for(const path of ['/api/play/events','/api/play/students','/api/play/avatars','/api/play/sounds/refresh'])assert.equal((await call(path,{},'POST',false,headers)).status,404);
        assert.equal((await call('/api/play/classes',undefined,'GET',false,{origin:'https://evil.example'})).status,403);
        assert.equal((await call('/api/events',{chance:['x'],fate:['y']},'PUT',true,headers)).status,403);
        await call('/api/classes/'+c,{},'DELETE');
        assert.ok(!(await call('/api/play/classes',undefined,'GET',false,headers)).body.some(row=>row.id===c));
        assert.equal((await call(`/api/play/classes/${c}/game`,{},'POST',false,headers)).status,404);
        assert.equal((await call(`/api/play/classes/${c}/draw`,{mode:'quick',requestId:'archived'},'POST',false,headers)).status,404);
        await app.db.run('DELETE FROM draws WHERE lesson_id=?',game.body.id);
      });
      await t.test('teacher theme selection persists and public clients can only read preset IDs',async()=>{
        assert.deepEqual((await call('/api/theme')).body,{theme:'basic'});
        assert.deepEqual((await call('/api/play/theme',undefined,'GET',false,{origin:publicOrigin})).body,{theme:'basic'});
        assert.equal((await call('/api/theme',{theme:'cat'},'PUT',false)).status,401);
        assert.equal((await call('/api/play/theme',{theme:'cat'},'PUT',false,{origin:publicOrigin})).status,404);
        for(const theme of ['cat','dog']){
          assert.equal((await call('/api/theme',{theme},'PUT')).status,200);
          const current=await call('/api/play/theme',undefined,'GET',false,{origin:publicOrigin});
          assert.equal(current.status,200);assert.equal(current.res.headers.get('access-control-allow-origin'),publicOrigin);assert.deepEqual(current.body,{theme});
        }
        for(const theme of ['unknown','https://evil.example/video.mp4','<script>',null])assert.equal((await call('/api/theme',{theme},'PUT')).status,400);
        assert.deepEqual((await call('/api/theme')).body,{theme:'dog'});
        for(const file of THEME_MEDIA){const r=await fetch(origin+'/theme-media/'+file,{method:'HEAD'});assert.equal(r.status,200,file);assert.ok(Number(r.headers.get('content-length'))>100,file);}
        const preview=await fetch(origin+'/theme-preview.html?theme=cat');assert.equal(preview.status,200);assert.equal(preview.headers.get('x-frame-options'),'SAMEORIGIN');assert.match(preview.headers.get('content-security-policy'),/connect-src 'self' https:\/\/yuenhk\.github\.io/);assert.match(preview.headers.get('content-security-policy'),/frame-ancestors 'self'/);const previewHTML=await preview.text();assert.match(previewHTML,/theme-preview.js/);assert.doesNotMatch(previewHTML,/src="app.js/);
        const adminPage=await fetch(origin+'/admin.html');assert.equal(adminPage.headers.get('x-frame-options'),'DENY');
        const range=await fetch(origin+'/theme-media/cat.mp4',{headers:{range:'bytes=0-15'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,16);
        await call('/api/theme',{theme:'cat'},'PUT');
      });
      await t.test('logout revokes teacher session',async()=>{
        await call('/api/logout',{});assert.equal((await call('/api/avatars')).status,401);
      });
    } finally { await app.close(); }
    if(backend==='SQLite'){
      const restarted=await createApplication({dataDir});
      restarted.server.listen(0,'127.0.0.1');await once(restarted.server,'listening');
      try{assert.equal(restarted.setupRequired,false);assert.equal((await restarted.db.get('SELECT count(*) AS n FROM draws')).n,122);assert.equal((await restarted.db.get("SELECT value FROM settings WHERE key='events'")).value.includes('新的機會'),true);assert.equal((await restarted.db.get("SELECT value FROM settings WHERE key='theme'")).value,'cat');}
      finally{await restarted.close();}
    }
    await rm(dataDir,{recursive:true,force:true});
  });
}
