import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('./theme-media/',import.meta.url);
export function schoolSoundCatalog(){
 const catalog=JSON.parse(readFileSync(new URL('school-sounds.json',root),'utf8'));
 if(catalog.version!==1||catalog.policy!=='school-sfx-v1'||!Array.isArray(catalog.items)||!catalog.items.length||catalog.items.length>40)throw Error('Invalid school sound catalog');
 const seen=new Set();return catalog.items.map(s=>{
  if(!/^(school-sounds\/[a-z0-9-]+|meow|bark)\.mp3$/.test(s.asset)||seen.has(s.id)||s.review?.status!=='approved'||s.review.policy!=='school-sfx-v1'||!s.author||!s.license?.startsWith('https://'))throw Error('Unapproved school sound');
  const themes=s.themes||['basic'];if(!themes.length||themes.some(t=>!['basic','cat','dog'].includes(t)))throw Error('Invalid sound theme');
  seen.add(s.id);const bytes=readFileSync(new URL(s.asset,root));if(createHash('sha256').update(bytes).digest('hex')!==s.sha256)throw Error('School sound changed; review required');return {...s,themes};
 });
}
// Online search and old stored catalogs can never expand this playback allowlist.
export function schoolSoundItems({theme='basic',blocked=[]}={}){
 return schoolSoundCatalog().filter(s=>s.themes.includes(theme)&&!blocked.includes('sound:'+s.id)).map(s=>({id:s.id,name:s.name,url:'theme-media/'+s.asset+'?v='+s.sha256,enabled:true}));
}
