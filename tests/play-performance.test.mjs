import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadCache,createLoadingTask,fitBoardHeight} from '../play-performance.js';
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
test('concurrent sound reads share one request, cache expires, and policy revisions cannot reuse old choices',async()=>{
 let time=0,calls=0;const cache=createReadCache({ttl:60000,now:()=>time});
 const gate=deferred(),read=()=>{calls++;return gate.promise;};
 const a=cache.load('basic:policy-1',read),b=cache.load('basic:policy-1',read);assert.equal(a,b);
 gate.resolve(['allowed']);assert.deepEqual(await a,['allowed']);assert.equal(calls,1);
 assert.deepEqual(await cache.load('basic:policy-1',()=>{throw Error('unexpected network');}),['allowed']);
 assert.deepEqual(await cache.load('basic:policy-2',()=>['new-policy']),['new-policy']);
 time=60001;assert.deepEqual(await cache.load('basic:policy-1',()=>['refreshed']),['refreshed']);
});
test('failed requests and invalidated in-flight sound responses cannot poison the cache',async()=>{
 const cache=createReadCache();await assert.rejects(cache.load('cat',()=>{throw Error('offline');}));
 const gate=deferred(),old=cache.load('cat',()=>gate.promise);cache.clear();
 assert.deepEqual(await cache.load('cat',()=>['current']),['current']);gate.resolve(['obsolete']);await old;
 assert.deepEqual(await cache.load('cat',()=>{throw Error('unexpected');}),['current']);
});
test('slow startup reports wake-up, failed connection supports explicit retry, and clicks cannot duplicate pending writes',async()=>{
 const states=[];let tick,cancelled=0,calls=0;const gate=deferred();
 const task=createLoadingTask({render:s=>states.push(s),schedule:fn=>{tick=fn;return 1;},cancel:()=>cancelled++});
 const work=()=>{calls++;return gate.promise;};const a=task.run(work),b=task.retry();assert.equal(a,b);
 await Promise.resolve();assert.equal(calls,1);tick();assert.equal(states.at(-1).state,'slow');
 gate.reject(Error('offline'));assert.equal(await a,false);assert.equal(states.at(-1).state,'error');assert.equal(cancelled,1);
 let attempt=0;assert.equal(await task.run(()=>{attempt++;if(attempt===1)throw Error('offline');}),false);
 assert.equal(await task.retry(),true);assert.equal(attempt,2);assert.equal(states.at(-1).state,'ready');
});

test('public server serves the startup helper as JavaScript',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {createApplication}=await import('../server.mjs');const dir=await mkdtemp(join(tmpdir(),'monopoly-startup-'));
 const app=await createApplication({dataDir:dir,autoSoundSync:false});
 try{await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const r=await fetch('http://127.0.0.1:'+app.server.address().port+'/play-performance.js');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/javascript/);assert.match(await r.text(),/export function createLoadingTask/);}
 finally{await app.close();await rm(dir,{recursive:true,force:true});}
});

test('desktop and tablet boards fill actual free height and respond to header folding',()=>{
 assert.equal(fitBoardHeight({viewportHeight:900,boardTop:42,rows:6,rowHeight:72}),848);
 assert.equal(fitBoardHeight({viewportHeight:900,boardTop:42.3,rows:6,rowHeight:72}),847);
 assert.equal(fitBoardHeight({viewportHeight:900,boardTop:138,rows:6,rowHeight:72}),752);
 assert.equal(fitBoardHeight({viewportHeight:1180,boardTop:42,rows:10,rowHeight:82,bottomGap:18}),1120);
});
test('phone and short landscape screens retain readable rows and allow vertical scrolling',()=>{
 assert.equal(fitBoardHeight({viewportHeight:844,boardTop:42,rows:17,rowHeight:84,bottomGap:14}),1428);
 assert.equal(fitBoardHeight({viewportHeight:390,boardTop:42,rows:6,rowHeight:72}),520);
});
