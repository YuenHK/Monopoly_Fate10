const SOURCE='https://memes.tw/sound';
const AUDIO_HOST='memeprod.sgp1.digitaloceanspaces.com';
const decode=s=>s.replace(/&#(x[\da-f]+|\d+);|&(amp|quot|apos|lt|gt|nbsp);/gi,(m,n,key)=>n?String.fromCodePoint(parseInt(n.replace(/^x/i,''),/^x/i.test(n)?16:10)):({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '})[key.toLowerCase()]);
export function validSound(s){
  if(!s||!/^\d{1,12}$/.test(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>250)return false;
  try{const u=new URL(s.url);return u.protocol==='https:'&&u.hostname===AUDIO_HOST&&!u.port&&!u.username&&!u.password&&/^\/user-sound\/[\w.-]+\.(mp3|wav|ogg|m4a)$/i.test(u.pathname)&&!u.search&&!u.hash;}catch{return false;}
}
export function parseSoundPage(html){
  const items=[];
  for(const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)){
    const attr=match[1].match(/\bonclick\s*=\s*"([^"]*)"/i);if(!attr)continue;
    const play=decode(attr[1]).match(/^\s*play\(\s*'([^']+)'\s*,\s*(\d+)/);if(!play)continue;
    const s={id:play[2],url:play[1],name:decode(match[2].replace(/<[^>]*>/g,'')).trim(),sourceUrl:SOURCE+'/'+play[2]};if(validSound(s))items.push(s);
  }
  if(!items.length)throw new Error('來源未提供可讀取的音效清單，保留上次清單');
  let pages=1;
  for(const m of html.matchAll(/\bhref\s*=\s*"([^"]+)"/gi)){
    try{const u=new URL(decode(m[1]),SOURCE);const value=u.searchParams.get('page');if(u.origin==='https://memes.tw'&&u.pathname==='/sound'&&/^\d+$/.test(value||''))pages=Math.max(pages,Number(value));}catch{}
  }
  if(pages>100)throw new Error('來源頁數超出上限，保留上次清單');
  return {items,pages};
}
async function readPage(fetcher,url){
  const response=await fetcher(url,{signal:AbortSignal.timeout(12000),redirect:'error',headers:{Accept:'text/html'}});
  if(!response.ok)throw new Error(response.status===403?'來源網站拒絕自動讀取（Cloudflare 403）；保留已取得的清單及勾選':`來源網站暫時未能讀取（HTTP ${response.status}）；保留上次清單`);
  if(Number(response.headers.get('content-length'))>4e6)throw new Error('來源內容過大');
  const reader=response.body.getReader();let size=0,chunks=[];
  try{while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>4e6)throw new Error('來源內容過大');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  return parseSoundPage(Buffer.concat(chunks).toString('utf8'));
}
export async function fetchSoundCatalog(fetcher=fetch){
  const started=Date.now();const first=await readPage(fetcher,SOURCE+'?sort=new'),map=new Map(first.items.map(s=>[s.id,s]));
  // Sequential small batches avoid a burst of requests against the source.
  for(let page=2;page<=first.pages;page++){
    if(Date.now()-started>60000)throw new Error('來源更新時間過長；保留上次完整清單');
    const result=await readPage(fetcher,SOURCE+'?sort=new&page='+page);for(const s of result.items)map.set(s.id,s);
  }
  return {source:SOURCE,scope:`來源全部 ${first.pages} 頁`,updatedAt:new Date().toISOString(),items:[...map.values()]};
}
