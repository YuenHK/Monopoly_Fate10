import { celebrate } from './celebration.js';
import { $, api, node, notice, today, options, form, avatar } from './shared.js';
let classes=[],lesson=null,currentIndex=0,busy=false,muted=false,pending=null,soundChoices=[],renderedBoard=null;
const bgm=$('bgm'),sfx=$('sfx'); bgm.volume=.1;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function sound(){if(muted)return;bgm.play().catch(()=>{});if(!soundChoices.length)return;sfx.src=soundChoices[Math.floor(Math.random()*soundChoices.length)].url;sfx.play().catch(()=>notice('音效暫時未能播放，可在後台試聽或更換音效',true));}
async function loadSoundChoices(){const data=await api('/api/sounds');soundChoices=data.items.filter(s=>s.enabled);}
if('BroadcastChannel' in window){const channel=new BroadcastChannel('monopoly-sounds');channel.onmessage=()=>loadSoundChoices().catch(()=>{});}
window.addEventListener('focus',()=>loadSoundChoices().catch(()=>{}));
$('sound-toggle').addEventListener('click',()=>{muted=!muted;$('sound-toggle').textContent=muted?'🔇 音效關閉':'🔊 音效開啟';$('sound-toggle').setAttribute('aria-pressed',String(!muted));if(muted){bgm.pause();sfx.pause();}else sound();});
async function lobby(){
  await loadSoundChoices();classes=await api('/api/classes');options($('class-select'),classes,'請選擇班別',c=>`${c.name} · ${c.student_count} 人`);
  if(!$('class-select').value&&classes.length)$('class-select').value=classes[0].id;
  $('lobby-controls').hidden=false;
}
form('lobby-controls',async()=>{await openClass($('class-select').value);});
function pendingKey(){return 'monopoly-pending:'+lesson.id;}
function savePending(value){pending=value;try{if(value)sessionStorage.setItem(pendingKey(),JSON.stringify(value));else sessionStorage.removeItem(pendingKey());}catch{}$('recover').hidden=!value;}
function lock(value){busy=value;for(const id of ['roll','quick','change-lesson','recover'])$(id).disabled=value||Boolean(lesson?.closed);}
async function openClass(classId){
  if(busy)return;
  lesson=await api('/api/classes/'+classId+'/game',{});currentIndex=lesson.board.currentIndex;
  $('lobby').hidden=true;$('game').hidden=false;$('change-lesson').hidden=false;
  $('context-text').textContent=lesson.class_name;
  $('stats-link').href='/admin.html?class='+lesson.class_id+'&view=statistics';
  $('status-text').textContent=lesson.must_student?'下一抽必定抽中學生！':'準備好了嗎？';
  history.replaceState(null,'','/?class='+lesson.class_id);
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
  lock(true);sound();
  if(!pending)savePending({requestId:crypto.randomUUID(),mode});
  try{
    const result=await api(`/api/classes/${lesson.class_id}/draw`,pending);
    lesson.students=result.students||lesson.students;currentIndex=result.move.fromIndex;renderBoard(result.board);
    $('dice1').textContent=result.move.dice?.[0]??'⚡';$('dice2').textContent=result.move.dice?.[1]??'⚡';
    $('status-text').textContent='幸運正在路上⋯';
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    for(let i=0;i<result.move.steps;i++){currentIndex=(currentIndex+1)%result.board.cells.length;active();if(!reduced)await sleep(pending.mode==='quick'?Math.min(55,3000/result.move.steps):160);}
    savePending(null);showResult(result);loadSoundChoices().catch(()=>{});
    lesson.must_student=result.kind==='student'?0:1;
    $('status-text').textContent=lesson.must_student?'下一抽必定抽中學生！':'再來一次，下一位會是誰？';
    $('last-result').textContent=result.kind==='student'?`剛才抽中：${result.student_number} · ${result.student_name}`:`剛才抽中：${result.kind==='chance'?'機會':'命運'}`;
    $('draw-hint').textContent=result.move.dice&&result.move.steps!==result.move.dice[0]+result.move.dice[1]?`骰子共 ${result.move.dice[0]+result.move.dice[1]} 點；按「下一抽必中學生」規則，前進至第 ${result.move.steps} 步。`:'機會與命運之後，下一抽必定抽中學生。';
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
  $('result-modal').showModal();if(student)celebrate($('result-modal'));
}
$('roll').addEventListener('click',()=>draw('dice'));$('quick').addEventListener('click',()=>draw('quick'));$('recover').addEventListener('click',()=>draw(pending?.mode||'quick'));
$('close-result').addEventListener('click',()=>{$('result-modal').close();});
$('change-lesson').addEventListener('click',async()=>{if(busy)return;$('game').hidden=true;$('lobby').hidden=false;history.replaceState(null,'','/');try{await lobby();}catch(e){notice(e.message,true);}});
window.addEventListener('resize',()=>{if(renderedBoard)renderBoard(renderedBoard);});
try{await lobby();const query=new URLSearchParams(location.search);let classId=query.get('class');if(!classId&&query.get('lesson'))classId=(await api('/api/lessons/'+query.get('lesson'))).class_id;if(classId)await openClass(classId);}
catch(e){if(e.status===401){$('login-required').hidden=false;$('lobby-controls').hidden=true;}else notice(e.message,true);}
