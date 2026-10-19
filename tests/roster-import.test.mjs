import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {readRosterWorkbook,writeRosterWorkbook} from '../roster-workbook.mjs';
import {createApplication} from '../server.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
async function file(rows,headers=['GROUP','CLASS','NO','中文姓名']) {
 const wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet('名單');sheet.addRow(headers);for(const row of rows)sheet.addRow(row);return Buffer.from(await wb.xlsx.writeBuffer());
}
async function pgAdapter(){const pg=await PGlite.create();const query=(sql,args)=>{let n=0;return pg.query(sql.replace(/\?/g,()=>'$'+(++n)),args);};return{postgres:true,exec:sql=>pg.exec(sql==='BEGIN IMMEDIATE'?'BEGIN':sql),get:async(sql,...args)=>(await query(sql,args)).rows[0],all:async(sql,...args)=>(await query(sql,args)).rows,run:(sql,...args)=>query(sql,args),close:()=>pg.close()};}
test('Excel parser validates columns, formulas, duplicates and decimal number normalization',async()=>{
 const input=await file([['ICT','4a',1.0,'陳同學'],['ICT','4B','1.0','李同學']]);
 const parsed=await readRosterWorkbook(input);assert.equal(parsed.errors.length,0);assert.equal(parsed.rows[0].number,'1');assert.equal(parsed.rows[0].school_class,'4A');
 assert.ok((await readRosterWorkbook(await file([['ICT','4A',1,'甲'],['ICT','4A',1,'乙']]))).errors.some(e=>e.includes('重複')));
 assert.ok((await readRosterWorkbook(await file([['ICT','4A',1,{formula:'1+1',result:2}]]))).errors.some(e=>e.includes('公式')));
 assert.ok((await readRosterWorkbook(await file([['ICT','4A','bad','甲']]))).errors.some(e=>e.includes('NO')));
 await assert.rejects(()=>readRosterWorkbook(Buffer.from('not an Excel file')));
 await assert.rejects(()=>readRosterWorkbook(Buffer.alloc(6*1024*1024)));
 const missing=await file([['ICT','4A',1,'甲']],['Wrong']);await assert.rejects(()=>readRosterWorkbook(missing));
});
for(const backend of ['SQLite','PostgreSQL'])test(`${backend}: bulk import, export and stable-identity updates`,async t=>{
 const dataDir=await mkdtemp(join(tmpdir(),'roster-import-'));
 const app=await createApplication({dataDir,setupCode:'setup',...(backend==='PostgreSQL'?{database:await pgAdapter()}:{})});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const base='http://127.0.0.1:'+app.server.address().port;let cookie='';
 async function call(path,data,method=data===undefined?'GET':'POST',auth=true){const response=await fetch(base+path,{method,headers:{...(cookie&&auth?{cookie}:{}),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});const result=await response.json();return{status:response.status,result,response};}
 const preview=async(bytes,mode='merge')=>call('/api/roster/import/preview',{base64:bytes.toString('base64'),mode});
 const commit=async p=>call('/api/roster/import/commit',{previewId:p.result.previewId});
 let input,group,roster,student,lessonId,avatarId;
 try{
  await call('/api/setup',{code:'setup',password:'testing-password-2026'});const login=await call('/api/login',{password:'testing-password-2026'});cookie=login.response.headers.get('set-cookie').split(';')[0];
  await t.test('preview is read-only, distinct CLASS numbers import, repeat file is unchanged',async()=>{
   input=await file([['ICT','4A',1,'甲同學'],['ICT','4B',1,'乙同學'],['ICT','4A',2,'丙同學']]);
   assert.equal((await call('/api/roster/import/preview',{base64:input.toString('base64')},'POST',false)).status,401);
   assert.equal((await fetch(base+'/api/roster/export')).status,401);
   const p=await preview(input);assert.equal(p.status,200);assert.equal(p.result.summary.added,3);assert.equal(p.result.errors.length,0);
   assert.ok(!(await call('/api/classes')).result.some(c=>c.name==='ICT'));
   assert.equal((await commit(p)).status,200);assert.equal((await commit(p)).status,409);
   group=(await call('/api/classes')).result.find(c=>c.name==='ICT');roster=(await call(`/api/classes/${group.id}/students`)).result;
   assert.equal(roster.length,3);assert.ok(roster.some(s=>s.display_id==='4A 1 甲同學'));assert.ok(roster.some(s=>s.display_id==='4B 1 乙同學'));
   student=roster.find(s=>s.name==='甲同學');
   const repeat=await preview(input);assert.equal(repeat.result.summary.added,0);assert.equal(repeat.result.summary.unchanged,3);
   assert.equal((await commit(repeat)).status,200);
  });
  await t.test('export retains four visible columns and stable IDs; number swaps keep identities',async()=>{
   const response=await fetch(base+`/api/roster/export?classId=${group.id}`,{headers:{cookie}});assert.equal(response.status,200);
   const wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(await response.arrayBuffer()));const sheet=wb.worksheets[0];
   assert.deepEqual([1,2,3,4].map(i=>sheet.getRow(1).getCell(i).value),['GROUP','CLASS','NO','中文姓名']);assert.equal(sheet.getColumn(5).hidden,true);
   let first,third;sheet.eachRow((row,n)=>{if(n>1&&row.getCell(4).value==='甲同學')first=row;if(n>1&&row.getCell(4).value==='丙同學')third=row;});
   first.getCell(3).value='2';third.getCell(3).value='1';
   const p=await preview(Buffer.from(await wb.xlsx.writeBuffer()));assert.equal(p.result.errors.length,0);assert.equal(p.result.summary.updated,2);
   assert.equal((await commit(p)).status,200);
   roster=(await call(`/api/classes/${group.id}/students`)).result;assert.equal(roster.find(s=>s.id===student.id).number,'2');
   assert.equal((await readRosterWorkbook(Buffer.from(await wb.xlsx.writeBuffer()))).errors.length,0);
  });
  await t.test('name, CLASS, NO and GROUP edits preserve avatar and historical class statistics',async()=>{
   lessonId=(await call('/api/lessons',{classId:group.id,name:'舊課堂'})).result.id;
   await app.db.run('INSERT INTO draws VALUES(?,?,?,?,?,?,?,?,?,?)',randomUUID(),lessonId,'student',student.id,'4A 2 甲同學','2',null,'2026-10-19T02:00:00.000Z',randomUUID(),null);
   avatarId=randomUUID();await app.db.run('INSERT INTO avatars VALUES(?,?,?,?,?,?)',avatarId,student.id,'image/gif',Buffer.from('kept-avatar'),'approved','2026-10-19T02:00:00.000Z');
   const response=await fetch(base+'/api/roster/export',{headers:{cookie}});const wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(await response.arrayBuffer()));
   const sheet=wb.worksheets[0];sheet.eachRow((row,n)=>{if(n>1&&row.getCell(5).value===student.id){row.getCell(1).value='Maker';row.getCell(2).value='4C';row.getCell(3).value=8;row.getCell(4).value='甲同學修訂';}});
   const p=await preview(Buffer.from(await wb.xlsx.writeBuffer()));assert.equal(p.result.errors.length,0);assert.equal(p.result.summary.updated,1);assert.equal(p.result.summary.added,0);
   assert.equal((await commit(p)).status,200);
   const moved=(await app.db.get('SELECT * FROM students WHERE id=?',student.id));assert.equal(moved.school_class,'4C');assert.equal(moved.student_no,'8');assert.equal(moved.name,'甲同學修訂');
   assert.equal((await app.db.get('SELECT id FROM avatars WHERE student_id=?',student.id)).id,avatarId);
   const oldStats=(await call(`/api/classes/${group.id}/stats`)).result;assert.equal(oldStats.summary.studentDraws,1);assert.equal(Number(oldStats.students.find(s=>s.id===student.id).count),1);
   assert.equal((await call(`/api/lessons/${lessonId}/stats`)).result.students.find(s=>s.id===student.id).active,0);
   assert.equal((await call(`/api/classes/${moved.class_id}/stats`)).result.summary.studentDraws,0);
  });
  await t.test('merge keeps missing students; replace deactivates only groups present in the file',async()=>{
   const partial=await file([['ICT','4B',1,'乙同學']]);
   const merge=await preview(partial);assert.equal(merge.result.summary.removed,0);await commit(merge);
   assert.equal((await call(`/api/classes/${group.id}/students`)).result.length,2);
   const replace=await preview(partial,'replace');assert.equal(replace.result.summary.removed,1);assert.equal((await commit(replace)).status,200);
   assert.equal((await call(`/api/classes/${group.id}/students`)).result.length,1);
   assert.equal((await app.db.get('SELECT active FROM students WHERE id=?',student.id)).active,1);
  });
  await t.test('bad files and stale previews never partially apply changes',async()=>{
   const bad=await preview(await file([['ERROR','4A',1,'甲'],['ERROR','4A',1,'乙']]));assert.ok(bad.result.errors.length);assert.equal((await commit(bad)).status,400);
   assert.ok(!(await call('/api/classes')).result.some(c=>c.name==='ERROR'));
   const stale=await preview(await file([['STALE','4A',1,'甲']]));await call('/api/classes',{name:'其他教師的新班別'});assert.equal((await commit(stale)).status,409);
   assert.ok(!(await call('/api/classes')).result.some(c=>c.name==='STALE'));
  });
 }finally{await app.close();await rm(dataDir,{recursive:true,force:true});}
});
