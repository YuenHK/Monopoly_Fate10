// Read-only demonstration: synthetic students only, no API requests or draw records.
import { themeById } from './themes.js?v=2.6.2';
import { createBackgroundPlaylist } from './background-playlist.js?v=2.6.2';
import { withBackgroundLibrary } from './background-library.js?v=2.6.2';
const theme=await withBackgroundLibrary(themeById(new URLSearchParams(location.search).get('theme')));
document.body.dataset.theme=theme.id;
const video=document.getElementById('theme-video');const playlist=createBackgroundPlaylist(video);playlist.setTheme(theme);
let requestedPlayback=false;
function playback(playing){requestedPlayback=playing;const active=playing&&document.visibilityState!=='hidden'&&!matchMedia('(prefers-reduced-motion: reduce)').matches;video.preload=active?'auto':'metadata';playlist.setEnabled(active);}
document.addEventListener('visibilitychange',()=>playback(requestedPlayback));
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>playback(requestedPlayback));
const report=()=>{if(parent!==window)parent.postMessage({type:'theme-preview-status',playing:!video.paused&&video.readyState>=2},location.origin);};
for(const event of ['play','pause','loadeddata','canplay','error'])video.addEventListener(event,report);
playback(new URLSearchParams(location.search).get('play')!=='0');
window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===parent&&event.data?.type==='theme-preview-play')playback(event.data.playing===true);});
const board=document.getElementById('board-container');
const width=12,height=10;board.style.gridTemplateColumns=`repeat(${width},minmax(0,1fr))`;board.style.gridTemplateRows=`repeat(${height},minmax(0,1fr))`;board.style.setProperty('--board-rows',height);
function position(i){if(i<width)return[1,i+1];if(i<width+height-1)return[i-width+2,width];if(i<2*width+height-2)return[height,width-(i-(width+height-2))];return[height-(i-(2*width+height-3)),1];}
function portrait(n){
  const colors=['#e4a778','#aecee6','#a8c8a0','#d9afd4','#e7cc83','#a6d6cd'],skin=['#edbf99','#d49c79','#f1cdb2'],hair=['#342c29','#644636','#242b35'];
  return 'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="16" fill="${colors[n%6]}"/><path d="M8 80Q10 50 40 52Q70 50 72 80" fill="${colors[(n+2)%6]}"/><ellipse cx="40" cy="33" rx="23" ry="26" fill="${hair[n%3]}"/><ellipse cx="40" cy="36" rx="18" ry="22" fill="${skin[n%3]}"/><path d="M20 30Q21 4 40 10Q62 7 61 31Q45 28 36 18Q30 29 20 30" fill="${hair[n%3]}"/><circle cx="33" cy="36" r="2" fill="#302624"/><circle cx="47" cy="36" r="2" fill="#302624"/><path d="M33 46Q40 52 47 46" fill="none" stroke="#9a5142" stroke-width="2" stroke-linecap="round"/>${n%4===0?'<path d="M25 34h13v9H25zM42 34h13v9H42zM38 37h4" fill="none" stroke="#343c4c" stroke-width="2"/>':''}</svg>`);
}
let student=0;
for(let i=0;i<40;i++){
  const special=i%5===0,type=special?(i%10===0?'chance':'fate'):'student';
  const cell=document.createElement('div');cell.className='cell '+type+(special?'':' has-identity')+(i===2?' active':'');
  if(special){const icon=document.createElement('span');icon.className='special-icon';icon.textContent=type==='chance'?'❓':'❗';const label=document.createElement('span');label.className='cell-text';label.textContent=type==='chance'?'機會':'命運';cell.append(icon,label);}
  else{student++;const img=document.createElement('img');img.className='avatar';img.src=portrait(student);img.alt='示範學生頭像';const name=document.createElement('span');name.className='cell-text';name.textContent='同學'+String(student).padStart(2,'0');const number=document.createElement('span');number.className='cell-number';number.textContent='4A '+student;cell.append(img,name,number);}
  const[row,col]=position(i);cell.style.gridRow=row;cell.style.gridColumn=col;board.append(cell);
}
