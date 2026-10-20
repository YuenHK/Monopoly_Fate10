import {readFileSync} from 'node:fs';
import {THEMES} from './themes.js';
import {schoolSoundCatalog} from './school-sounds.mjs';
export function mediaCatalog(){
 const videos=JSON.parse(readFileSync(new URL('./theme-media/approved-catalog.json',import.meta.url),'utf8')).entries.map(e=>({...e,key:'video:'+e.asset,kind:'video',url:'theme-media/'+e.asset+'?v='+e.sha256}));
 const sounds=schoolSoundCatalog().map(e=>({...e,key:'sound:'+e.id,kind:'sound',title:e.name,url:'theme-media/'+e.asset+'?v='+e.sha256}));
 const music=THEMES.map(t=>({key:'music:'+t.id,kind:'music',themes:[t.id],title:t.name+'背景音樂',url:t.music,source:'theme-media/credits.html',description:'既有主題音樂；可預覽並在全站禁播。'}));
 return [...videos,...sounds,...music];
}
export function parseMediaPolicy(raw){
 const value=typeof raw==='string'?JSON.parse(raw):raw;
 if(!value)return {revision:0,blocked:[]};
 if(!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.blocked)||value.blocked.length>200||value.blocked.some(k=>typeof k!=='string'||!/^(video|sound|music):[a-zA-Z0-9/_.-]+$/.test(k)))throw Error('Invalid media policy');
 return {revision:value.revision,blocked:[...new Set(value.blocked)]};
}
