import {validMemeSound} from './sound-title-policy.js?v=2.6.11';
import {apiOrigin} from './shared.js';
import {THEME_MEDIA} from './themes.js?v=2.6.11';
export function validMediaPolicy(data){return data&&Number.isSafeInteger(data.revision)&&data.revision>=0&&Array.isArray(data.blocked)&&data.blocked.length<=10000&&data.blocked.every(k=>typeof k==='string'&&/^(video|sound|music):[a-zA-Z0-9/_.-]+$/.test(k));}
export function createMediaPolicyLoader({fetcher=(...args)=>fetch(...args),origin=apiOrigin,now=()=>Date.now()}={}){
 let cached=null,expires=0,pending=null;
 return async function load({force=false}={}){
  if(!force&&now()<expires)return cached;if(pending)return pending;
  pending=(async()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);try{
   const r=await fetcher(origin()+'/api/play/media-policy',{credentials:'omit',cache:'no-store',signal:controller.signal});if(!r.ok)throw Error();const data=await r.json();if(!validMediaPolicy(data))throw Error();cached=data;expires=now()+5000;return data;
  }catch{cached=null;expires=0;return null;}finally{clearTimeout(timer);pending=null;}})();return pending;
 };
}
export const loadMediaPolicy=createMediaPolicyLoader();
export function approvedSchoolSound(s){
 if(s?.enabled&&validMemeSound(s))return true;
 if(!s?.enabled||!/^school-(meme|cat|dog|confirmation)-[a-z0-9-]+$/.test(s.id)||typeof s.url!=='string'||!s.url.startsWith('theme-media/'))return false;
 const [path,hash,...extra]=s.url.split('?v=');return !extra.length&&/^[a-f0-9]{64}$/.test(hash||'')&&path.endsWith('.mp3')&&THEME_MEDIA.includes(path.slice('theme-media/'.length));
}
export function filterThemeMedia(theme,policy){
 if(!validMediaPolicy(policy))return {...theme,music:null,sound:null,externalVideo:null,video:null,videos:[],mediaAvailable:false,libraryRevision:(theme.libraryRevision||'')+':policy-unavailable'};
 const blocked=new Set(policy.blocked);
 const allowed=src=>{if(!src)return false;const pathname=new URL(src,'https://media.invalid/').pathname;const marker='/theme-media/';const asset=pathname.slice(pathname.lastIndexOf(marker)+marker.length);return !blocked.has('video:'+asset)&&!(asset==='approved/rickroll-original.mp4'&&blocked.has('video:rickroll-original'));};
 const videos=(theme.videos||[]).filter(allowed),fallback=allowed(theme.video)?theme.video:null;
 return {...theme,music:blocked.has('music:'+theme.id)?null:theme.music,sound:null,externalVideo:theme.externalVideo&&!blocked.has(theme.externalVideo.key)?theme.externalVideo:null,video:fallback,videos,mediaAvailable:true,libraryRevision:(theme.libraryRevision||'')+':policy-'+policy.revision};
}
