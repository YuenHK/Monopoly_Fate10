// Memory-only, bounded caches. Failures are never cached and invalidation discards in-flight results.
export function createReadCache({ttl=60000,now=()=>Date.now(),limit=12}={}){
 const entries=new Map();
 return {
  load(key,fetcher){
   const old=entries.get(key);
   if(old?.pending)return old.pending;
   if(old&&old.expires>now())return Promise.resolve(old.value);
   const entry={};entries.set(key,entry);
   while(entries.size>limit)entries.delete(entries.keys().next().value);
   entry.pending=Promise.resolve().then(fetcher).then(value=>{
    if(entries.get(key)===entry){entry.value=value;entry.expires=now()+ttl;entry.pending=null;}
    return value;
   },error=>{if(entries.get(key)===entry)entries.delete(key);throw error;});
   return entry.pending;
  },
  clear(){entries.clear();}
 };
}
export function createLoadingTask({render,slowMs=8000,schedule=setTimeout,cancel=clearTimeout}){
 let pending=null,retry=null;
 function run(task){
  if(pending)return pending;
  retry=task;render({state:'loading'});
  const timer=schedule(()=>render({state:'slow'}),slowMs);
  pending=Promise.resolve().then(task).then(()=>{render({state:'ready'});return true;},error=>{render({state:'error',error});return false;}).finally(()=>{cancel(timer);pending=null;});
  return pending;
 }
 return {run,retry:()=>retry?run(retry):Promise.resolve(false)};
}
