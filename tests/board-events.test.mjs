import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBoard,hasEventCounts,nextDraw,sameRoster} from '../game.mjs';
import {createApplication} from '../server.mjs';

test('all roster sizes retain each student once and exactly ten cells of each event',()=>{
 for(let n=1;n<=100;n++){
  const students=Array.from({length:n},(_,i)=>({id:'s'+i})),board=createBoard(students);
  assert.ok(hasEventCounts(board));assert.ok(sameRoster(board,students));
  assert.equal(board.cells.length,2*(board.width+board.height)-4);
  assert.equal(board.cells.filter(c=>c.type==='start').length,n%2);
  for(const must of [false,true]){
   const targets=board.cells.filter(c=>c.type!=='start'&&(!must||c.type==='student'));
   for(let target=0;target<targets.length;target++){
    const move=nextDraw(board,must,'quick','equal',size=>{assert.equal(size,targets.length);return target;});
    assert.deepEqual(move.cell,targets[target]);assert.notEqual(move.cell.type,'start');
   }
  }
 }
});
test('dice and quick draw skip the non-drawable start cell',()=>{
 const board={cells:[{type:'start'},{type:'student',studentId:'s'}],currentIndex:0};
 for(const mode of ['quick','dice'])for(let n=0;n<25;n++)assert.equal(nextDraw(board,false,mode,'dice').cell.type,'student');
});
test('an existing class upgrades its board once without losing draws or follow-up state',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'monopoly-events-')),app=await createApplication({dataDir:dir,autoSoundSync:false,setupCode:'board-test'});
 try{
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+app.server.address().port;
  const setup=await fetch(origin+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'board-test',password:'board-migration-test-password'})});assert.equal(setup.status,200);
  const c=await app.db.get('SELECT id FROM classes LIMIT 1');
  const open=async()=>{const r=await fetch(origin+'/api/play/classes/'+c.id+'/game',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,200);return r.json();};
  const first=await open(),r=await fetch(origin+'/api/play/classes/'+c.id+'/draw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'quick',requestId:'before-upgrade'})});assert.equal(r.status,200);
  const cells=first.board.cells.filter(c=>c.type==='student');for(let i=0;i<6;i++)cells.push({type:'chance'},{type:'fate'});
  const old={width:14,height:10,cells,currentIndex:0};
  await app.db.run('UPDATE lessons SET board=?,must_student=1 WHERE id=?',JSON.stringify(old),first.id);
  const before=await app.db.get('SELECT COUNT(*) AS n FROM draws WHERE lesson_id=?',first.id),upgraded=await open();
  assert.equal(upgraded.id,first.id);assert.ok(hasEventCounts(upgraded.board));assert.ok(sameRoster(upgraded.board,first.students));assert.equal(Number(upgraded.must_student),1);
  assert.deepEqual(upgraded.board.cells[upgraded.board.currentIndex],cells[0]);
  assert.deepEqual(await app.db.get('SELECT COUNT(*) AS n FROM draws WHERE lesson_id=?',first.id),before);
  assert.deepEqual((await open()).board,upgraded.board);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
