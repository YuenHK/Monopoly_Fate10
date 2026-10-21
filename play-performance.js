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

// Grow into the visible viewport without reducing the existing readable row heights.
export function fitBoardHeight({viewportHeight,boardTop,rows,rowHeight,bottomGap=10}){
 return Math.floor(Math.max(520,rows*rowHeight,viewportHeight-Math.max(0,boardTop)-bottomGap));
}

// Preserve every perimeter cell while fitting a phone in either orientation.
export function phoneBoardLayout({cellCount,width,height}){
 const sum=(cellCount+4)/2;
 let best=null;
 for(let columns=4;columns<=sum-4;columns++){
  const rows=sum-columns,cellWidth=(width-6-(columns-1)*2)/columns,cellHeight=(height-6-(rows-1)*2)/rows;
  const centerWidth=(columns-2)*(cellWidth+2)-16,centerHeight=(rows-2)*(cellHeight+2)-16;
  if(centerWidth<150||centerHeight<176)continue;
  const score=Math.min(cellWidth/52,cellHeight/36);
  if(!best||score>best.score)best={columns,rows,score,cellWidth,cellHeight};
 }
 return best||{columns:4,rows:sum-4};
}
