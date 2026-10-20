import {loadMediaPolicy,approvedSchoolSound} from './media-policy.js?v=2.6.8';
import { celebrate } from './celebration.js';
import { $, playApi as api, apiOrigin, node, notice, today, options, form, avatar } from './shared.js';
import { themeById } from './themes.js?v=2.6.8';
import { createBackgroundPlaylist } from './background-playlist.js?v=2.6.8';
import { withBackgroundLibrary } from './background-library.js?v=2.6.8';
const appPath=new URL('./',location.href).pathname;
$('stats-link').href=apiOrigin()+'/admin.html';
let classes=[],lesson=null,currentIndex=0,busy=false,muted=false,pending=null,soundChoices=[],renderedBoard=null;
let currentTheme=themeById('basic'),themeLoaded=false,mediaUnlocked=false;
// Page-only preference: never write this selection to browser storage or teacher settings.
let temporaryTheme='',configuredTheme='basic';
const bgm=$('bgm'),sfx=$('sfx'); bgm.volume=.1;
const themeVideo=$('theme-video');
const backgroundPlaylist=createBackgroundPlaylist(themeVideo,{onFailure:()=>notice('主題背景影片暫時未能播放，請稍後重試',true)});
let devicePrefs={music:10,effects:100,lowPower:matchMedia('(prefers-reduced-motion: reduce)').matches};
try{const saved=JSON.parse(localStorage.getItem('monopoly-playback')||'null');if(saved){for(const key of ['music','effects'])if(Number.isFinite(saved[key]))devicePrefs[key]=Math.max(0,Math.min(100,saved[key]));if(typeof saved.lowPower==='boolean')devicePrefs.lowPower=saved.lowPower;}}catch{}
const reducedMedia=()=>devicePrefs.lowPower||matchMedia('(prefers-reduced-motion: reduce)').matches;
function syncMediaPreferences(){
  bgm.volume=devicePrefs.music/100;sfx.volume=devicePrefs.effects/100;
  for(const [key,id] of [['music','music-volume'],['effects','effects-volume']]){$(id).value=devicePrefs[key];$(id+'-value').textContent=devicePrefs[key]+'%';}
  $('low-power').checked=devicePrefs.lowPower;themeVideo.hidden=reducedMedia();
  backgroundPlaylist.setEnabled(!reducedMedia()&&document.visibilityState!=='hidden');
  if(!currentTheme.music||devicePrefs.music===0)bgm.pause();else if(currentTheme.music&&mediaUnlocked&&!muted&&devicePrefs.music>0)bgm.play().catch(()=>{});
}
for(const [key,id] of [['music','music-volume'],['effects','effects-volume']])$(id).addEventListener('input',()=>{devicePrefs[key]=Number($(id).value);syncMediaPreferences();try{localStorage.setItem('monopoly-playback',JSON.stringify(devicePrefs));}catch{}});
$('low-power').addEventListener('change',()=>{devicePrefs.lowPower=$('low-power').checked;syncMediaPreferences();try{localStorage.setItem('monopoly-playback',JSON.stringify(devicePrefs));}catch{}});
const boardMenu=$('board-menu');
function closeBoardMenu(restoreFocus=false){boardMenu.open=false;$('display-settings').open=false;if(restoreFocus)$('board-menu-toggle').focus();}
document.addEventListener('pointerdown',e=>{if(boardMenu.open&&!boardMenu.contains(e.target))closeBoardMenu();});
boardMenu.addEventListener('focusout',e=>{if(e.relatedTarget&&!boardMenu.contains(e.relatedTarget))closeBoardMenu();});
boardMenu.addEventListener('toggle',()=>{if(!boardMenu.open)$('display-settings').open=false;});
function project(on){document.body.classList.toggle('projection-mode',on);$('exit-projection').hidden=!on;$('projection-mode').checked=on;if(on)closeBoardMenu();}
$('projection-mode').addEventListener('change',()=>project($('projection-mode').checked));$('exit-projection').addEventListener('click',()=>project(false));document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(boardMenu.open){e.preventDefault();closeBoardMenu(true);}else project(false);}});
syncMediaPreferences();

let themeLoadRevision=0;
async function applyTheme(id,policy){
  configuredTheme=id;$('temporary-theme').value=temporaryTheme||id;
  const request=++themeLoadRevision,theme=await withBackgroundLibrary(themeById(temporaryTheme||configuredTheme),{policy});if(request!==themeLoadRevision)return;
  if(themeLoaded&&theme.id===currentTheme.id&&theme.libraryRevision===currentTheme.libraryRevision)return;
  const sameMusic=themeLoaded&&theme.music===currentTheme.music;
  currentTheme=theme;themeLoaded=true;document.body.dataset.theme=theme.id;
  sfx.pause();if(!sameMusic){bgm.pause();if(theme.music)bgm.src=theme.music;else bgm.removeAttribute('src');bgm.load();}
  await loadSoundChoices();
  backgroundPlaylist.setTheme(theme);
  syncMediaPreferences();
  if(currentTheme.music&&mediaUnlocked&&!muted&&devicePrefs.music>0)bgm.play().catch(()=>{});
}
$('temporary-theme').addEventListener('change',()=>{
  temporaryTheme=$('temporary-theme').value;mediaUnlocked=true;
  loadTheme().catch(e=>notice(e.message,true));
});
async function loadTheme(){const classId=lesson?.class_id;let data;try{data=await api('/api/theme'+(classId?'?classId='+encodeURIComponent(classId):''));}catch(e){await applyTheme(configuredTheme,null);throw e;}await applyTheme(data.theme,await loadMediaPolicy({force:true}));if(lesson&&data.drawMode){lesson.draw_mode=data.drawMode;$('roll').textContent=data.drawMode==='equal'?'🎲 等機率抽籤':'🎲 擲骰子';}}
bgm.addEventListener('error',()=>{if(themeLoaded&&currentTheme.music)notice('主題音樂暫時未能播放，請稍後重試',true);});
document.addEventListener('visibilitychange',()=>backgroundPlaylist.setEnabled(!reducedMedia()&&document.visibilityState!=='hidden'));
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',syncMediaPreferences);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function startMedia(){mediaUnlocked=true;backgroundPlaylist.setEnabled(!reducedMedia()&&document.visibilityState!=='hidden');if(currentTheme.music&&!muted&&devicePrefs.music>0)bgm.play().catch(()=>{});}
function sound(){startMedia();if(muted||devicePrefs.effects===0||!currentTheme.mediaAvailable||!soundChoices.length)return;sfx.src=soundChoices[Math.floor(Math.random()*soundChoices.length)].url;sfx.play().catch(()=>notice('音效暫時未能播放，請稍後重試',true));}
async function loadSoundChoices(){const theme=currentTheme.id;try{const data=await api('/api/sounds?theme='+theme);if(theme===currentTheme.id)soundChoices=data.items.filter(approvedSchoolSound);}catch{soundChoices=[];}}
if('BroadcastChannel' in window){const channel=new BroadcastChannel('monopoly-sounds');channel.onmessage=()=>loadSoundChoices().catch(()=>{});}
window.addEventListener('focus',()=>{loadSoundChoices().catch(()=>{});loadTheme().catch(()=>{});});
if('BroadcastChannel' in window){const channel=new BroadcastChannel('monopoly-theme');channel.onmessage=()=>loadTheme().catch(()=>{});}
setInterval(()=>{if(document.visibilityState==='visible')loadTheme().catch(()=>{});},30000);
$('sound-toggle').addEventListener('click',async()=>{muted=!muted;$('sound-toggle').textContent=muted?'🔇 音效關閉':'🔊 音效開啟';$('sound-toggle').setAttribute('aria-pressed',String(!muted));if(muted){bgm.pause();sfx.pause();}else{try{await loadTheme();await loadSoundChoices();sound();}catch(e){bgm.pause();sfx.pause();notice(e.message,true);}}});
async function lobby(){
  lesson=null;await Promise.all([loadSoundChoices(),loadTheme()]);classes=await api('/api/classes');options($('class-select'),classes,'請選擇班別',c=>`${c.name} · ${c.student_count} 人`);
  if(!$('class-select').value&&classes.length)$('class-select').value=classes[0].id;
  $('lobby-controls').hidden=false;
}
form('lobby-controls',async()=>{await loadTheme();await openClass($('class-select').value);startMedia();});
function pendingKey(){return 'monopoly-pending:'+lesson.id;}
function savePending(value){pending=value;try{if(value)sessionStorage.setItem(pendingKey(),JSON.stringify(value));else sessionStorage.removeItem(pendingKey());}catch{}$('recover').hidden=!value;}
function lock(value){busy=value;$('temporary-theme').disabled=value;for(const id of ['roll','quick','change-lesson','recover'])$(id).disabled=value||Boolean(lesson?.closed);}
async function openClass(classId){
  if(busy)return;
  lesson=await api('/api/classes/'+classId+'/game',{});$('roll').textContent=lesson.draw_mode==='equal'?'🎲 等機率抽籤':'🎲 擲骰子';await applyTheme(lesson.theme);currentIndex=lesson.board.currentIndex;
  $('draw-hint').textContent=lesson.draw_mode==='equal'?'每位同學等機率；棋盤走格只作動畫。事件後下一抽必定是學生。':'機會與命運之後，下一抽必定抽中學生。';
  $('lobby').hidden=true;$('game').hidden=false;$('change-lesson').hidden=false;
  $('context-text').textContent=lesson.class_name;
  $('stats-link').href=apiOrigin()+'/admin.html?class='+lesson.class_id;
  $('status-text').textContent=lesson.must_student?'下一抽必定抽中學生！':'準備好了嗎？';
  history.replaceState(null,'',appPath+'?class='+lesson.class_id);
  renderBoard(lesson.board);lock(false);
  // A closed lesson must still allow switching to a different class.
  $('change-lesson').disabled=false;
  try{pending=JSON.parse(sessionStorage.getItem(pendingKey())||'null');}catch{pending=null;}
  $('recover').hidden=!pending;
  if(pending)$('recover').disabled=false;
  notice('');
}
function gridPos(i,w,h){if(i<w)return[1,i+1];if(i<w+h-1)return[i-w+2,w];if(i<2*w+h-2)return[h,w-(i-(w+h-2))];return[h-(i-(2*w+h-3)),1];}
function renderBoard(board){
  renderedBoard=board;const container=$('board-container'),compact=document.documentElement.clientWidth<=1024;
  const width=Math.max(5,Math.min(board.width,Math.floor((document.documentElement.clientWidth-(compact?24:40))/78)));
  const height=(board.cells.length+4)/2-width;container.style.gridTemplateColumns=`repeat(${width},minmax(0,1fr))`;container.style.gridTemplateRows=`repeat(${height},minmax(0,1fr))`;container.style.setProperty('--board-rows',height);container.classList.toggle('long-board',height*72>innerHeight-180);
  container.querySelectorAll('.cell').forEach(c=>c.remove());
  board.cells.forEach((cell,i)=>{
    const e=node('div',undefined,'cell '+cell.type);e.id='cell-'+i;
    if(cell.type==='student'){
      const s=lesson.students.find(s=>s.id===cell.studentId);
      if(s?.school_class)e.classList.add('has-identity');
      e.setAttribute('aria-label',s?.display_id||s?.name||'學生');
      e.append(avatar(s?.avatar_id,s?.name||'學生'),node('span',s?.name||'學生','cell-text'),node('span',[s?.school_class,s?.number].filter(Boolean).join(' '),'cell-number'));
    }else e.append(node('span',cell.type==='chance'?'❓':'❗','special-icon'),node('span',cell.type==='chance'?'機會':'命運','cell-text'));
    const[r,c]=gridPos(i,width,height);e.style.gridRow=r;e.style.gridColumn=c;container.append(e);
  });active();
}
function active(){document.querySelectorAll('.cell.active').forEach(e=>e.classList.remove('active'));$('cell-'+currentIndex)?.classList.add('active');}
async function draw(mode){
  if(busy||!lesson)return;
  lock(true);
  if(!pending)savePending({requestId:crypto.randomUUID(),mode});
  try{
    await loadTheme();await loadSoundChoices();sound();
    const result=await api(`/api/classes/${lesson.class_id}/draw`,pending);
    lesson.students=result.students||lesson.students;currentIndex=result.move.fromIndex;renderBoard(result.board);
    $('dice1').textContent=result.move.dice?.[0]??'⚡';$('dice2').textContent=result.move.dice?.[1]??'⚡';
    $('status-text').textContent='幸運正在路上⋯';
    const reduced=reducedMedia();
    const stepDelay=result.move.algorithm==='equal'?Math.min(pending.mode==='quick'?55:160,(pending.mode==='quick'?900:1800)/result.move.steps):pending.mode==='quick'?Math.min(55,3000/result.move.steps):160;
    for(let i=0;i<result.move.steps;i++){currentIndex=(currentIndex+1)%result.board.cells.length;active();if(!reduced)await sleep(stepDelay);}
    savePending(null);showResult(result);loadSoundChoices().catch(()=>{});
    lesson.must_student=result.kind==='student'?0:1;
    $('status-text').textContent=lesson.must_student?'下一抽必定抽中學生！':'再來一次，下一位會是誰？';
    $('last-result').textContent=result.kind==='student'?`剛才抽中：${result.student_number} · ${result.student_name}`:`剛才抽中：${result.kind==='chance'?'機會':'命運'}`;
    $('draw-hint').textContent=result.move.algorithm==='equal'?'等機率模式：先抽取目標，棋盤走格只作動畫。':result.move.dice&&result.move.steps!==result.move.dice[0]+result.move.dice[1]?`骰子共 ${result.move.dice[0]+result.move.dice[1]} 點；按「下一抽必中學生」規則，前進至第 ${result.move.steps} 步。`:'機會與命運之後，下一抽必定抽中學生。';
  }catch(e){
    if([400,404,409].includes(e.status))savePending(null);
    notice(e.message+(pending?'。可按「恢復上次抽籤結果」安全重試。':''),true);
    if(e.status===401)notice('登入已過期，請到教師後台重新登入，再恢復上次抽籤結果。',true);
  }finally{lock(false);if(lesson.closed){$('change-lesson').disabled=false;}}
}
function showResult(result){
  const student=result.kind==='student';$('result-title').textContent=student?'🎉 恭喜幸運兒':result.kind==='chance'?'❓ 機會時刻':'❗ 命運降臨';
  $('result-kicker').textContent=student?'THE LUCKY ONE':'A LITTLE SURPRISE';$('result-display').replaceChildren();
  if(student){$('result-display').append(avatar(result.avatar_id,result.student_name,'avatar-large'),node('div',result.student_name,'result-name'));$('result-note').textContent='';$('result-note').hidden=true;}
  else{$('result-note').hidden=false;$('result-display').append(node('div',result.event_text,'result-event'));$('result-note').textContent='下一位抽到的同學適用這項事件。下一抽必定抽中人名！';}
  $('result-modal').showModal();if(student)celebrate($('result-modal'),currentTheme.effect,{lowPower:devicePrefs.lowPower});
}
$('roll').addEventListener('click',()=>draw('dice'));$('quick').addEventListener('click',()=>draw('quick'));$('recover').addEventListener('click',()=>draw(pending?.mode||'quick'));
$('close-result').addEventListener('click',()=>{$('result-modal').close();});
$('change-lesson').addEventListener('click',async()=>{if(busy)return;$('game').hidden=true;$('lobby').hidden=false;history.replaceState(null,'',appPath);try{await lobby();}catch(e){notice(e.message,true);}});
window.addEventListener('resize',()=>{if(renderedBoard)renderBoard(renderedBoard);});
try{await lobby();const query=new URLSearchParams(location.search);let classId=query.get('class');if(!classId&&query.get('lesson'))classId=(await api('/api/lessons/'+query.get('lesson'))).class_id;if(classId)await openClass(classId);}
catch(e){notice(e.message,true);}
