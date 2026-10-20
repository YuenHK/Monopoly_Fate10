import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('./theme-media/',import.meta.url);
// A stored legacy catalog or online search can never expand this playback allowlist.
export function schoolSoundItems(){
 const catalog=JSON.parse(readFileSync(new URL('school-sounds.json',root),'utf8'));
 if(catalog.version!==1||catalog.policy!=='school-sfx-v1'||catalog.items?.length!==4)throw Error('Invalid school sound catalog');
 const seen=new Set();return catalog.items.map(s=>{
  if(!/^school-sounds\/confirmation-[1-4]\.mp3$/.test(s.asset)||seen.has(s.asset)||s.review?.status!=='approved'||s.review.policy!=='school-sfx-v1')throw Error('Unapproved school sound');
  seen.add(s.asset);const bytes=readFileSync(new URL(s.asset,root));if(createHash('sha256').update(bytes).digest('hex')!==s.sha256)throw Error('School sound changed; review required');
  return {id:s.id,name:s.name,url:'theme-media/'+s.asset+'?v='+s.sha256,enabled:true};
 });
}
