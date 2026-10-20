import {loadMediaPolicy,filterThemeMedia} from './media-policy.js?v=2.6.9';
import {SCHOOL_VIDEO_ASSETS} from './themes.js?v=2.6.9';
// One public manifest is shared by Pages and Render; no teacher data or credentials leave the app.
export const LIBRARY_BASE = 'https://yuenhk.github.io/Monopoly_Fate10/theme-media/';
export const LIBRARY_URL = LIBRARY_BASE + 'library.json';
const files = {cat:['cat-play.mp4','cat-sleep.mp4','cat-ball.mp4'],dog:['dog-play.mp4','dog-sleep.mp4','dog-outdoor.mp4']};
export function validateLibrary(data) {
  if (data?.version!==4 || data.policy!=='school-v1' || !Array.isArray(data.clips) || data.clips.length!==6) return null;
  const seen=new Set();
  for (const clip of data.clips) {
    if (!files[clip.theme]?.includes(clip.file) || seen.has(clip.file) || !SCHOOL_VIDEO_ASSETS[clip.theme]?.includes(clip.asset) || clip.review?.status!=='approved' || clip.review?.policy!=='school-v1' || !/^[a-f0-9]{64}$/.test(clip.sha256)) return null;
    seen.add(clip.file);
  }
  if (data.updatedAt!==undefined && (typeof data.updatedAt!=='string'||!Number.isFinite(Date.parse(data.updatedAt)))) return null;
  return data;
}
export function createLibraryLoader({fetcher=(...args)=>fetch(...args),now=()=>Date.now()}={}) {
  let cached=null,expires=0,pending=null;
  return async function load() {
    if (now()<expires) return cached;
    if (pending) return pending;
    pending=(async()=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
      try {
        const response=await fetcher(LIBRARY_URL,{credentials:'omit',mode:'cors',cache:'no-cache',signal:controller.signal});
        if (!response.ok) throw Error('Library unavailable');
        const text=await response.text();
        if (text.length>262144) throw Error('Library too large');
        const data=validateLibrary(JSON.parse(text));
        if (!data) throw Error('Invalid library');
        cached=data;expires=now()+15*60*1000;return cached;
      } catch { expires=now()+60*1000;return cached; }
      finally {clearTimeout(timer);pending=null;}
    })();
    return pending;
  };
}
export const loadBackgroundLibrary=createLibraryLoader();
export async function withBackgroundLibrary(theme,{policy}={}) {
  if(policy===undefined)policy=await loadMediaPolicy();
  if(!policy)return filterThemeMedia(theme,null);
  if(theme.id==='basic')return filterThemeMedia({...theme,video:null,videos:[],libraryRevision:'rickroll-external-v1'},policy);
  const data=await loadBackgroundLibrary();
  if (!data) return filterThemeMedia({...theme,libraryRevision:'bundled-school-v1'},policy);
  const revision=data.updatedAt||'initial-2026-10-20';
  return filterThemeMedia({...theme,libraryRevision:revision,videos:data.clips.filter(clip=>clip.theme===theme.id).map(clip=>LIBRARY_BASE+clip.asset+'?v='+encodeURIComponent(clip.sha256||revision))},policy);
}
