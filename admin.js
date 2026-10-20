import { $, api, node, button, notice, date, today, options, form, avatar, downloadCSV } from './shared.js';
import { parseEventText, formatEventText } from './event-format.js';
import { studentDisplay, studentKey } from './student-identity.js';
import { THEMES, themeById } from './themes.js?v=2.6.2';
import { celebrate } from './celebration.js';
import { createBackgroundPlaylist } from './background-playlist.js?v=2.6.2';
import { withBackgroundLibrary, loadBackgroundLibrary } from './background-library.js?v=2.6.2';
const themePreviewPlaylist=createBackgroundPlaylist($('theme-preview-video'));
let rosterPreview = null;
let classStats = null, statsRevision = 0;
let classes = [], students = [], avatarRows = [], setupRequired = false;
const kindLabel = { student: '學生', chance: '機會', fate: '命運' };
const countFormat=new Intl.NumberFormat('zh-HK');
function tabCount(id,text,description){const badge=$(id);badge.textContent=text;badge.title=description;badge.setAttribute('aria-label',description);}
function eventTabCount(events){const total=events.chance.length+events.fate.length;tabCount('events-tab-count',`${countFormat.format(total)} 項`,`已儲存 ${events.chance.length} 項機會、${events.fate.length} 項命運`);}
function setThemeCardPlayback(active){document.querySelectorAll('.theme-card-frame').forEach(frame=>{
  if(active){if(!frame.getAttribute('src'))frame.src=frame.dataset.previewSrc+'&play='+(frame.dataset.theme===selectedTheme?'1':'0');else frame.contentWindow?.postMessage({type:'theme-preview-play',playing:frame.dataset.theme===selectedTheme},location.origin);}
  else frame.removeAttribute('src');
});}
function setTab(name) {
  setThemeCardPlayback(name==='themes');
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  if(name!=='sounds')$('sound-preview').pause();
  if(name!=='themes'){$('theme-preview-audio').pause();themePreviewPlaylist.setEnabled(false);}
  for (const tab of ['classes', 'statistics', 'avatars', 'sounds', 'themes', 'events', 'backup']) $('tab-' + tab).hidden = tab !== name;
}
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
  setTab(b.dataset.tab);
  const refresh = b.dataset.tab === 'avatars' ? loadAvatars : b.dataset.tab === 'statistics' ? loadStatsClasses : b.dataset.tab === 'themes' ? loadThemes : async () => {};
  refresh().catch(e => notice(e.message, true));
}));
async function showAuth() {
  setThemeCardPlayback(false);
  $('theme-preview-audio').pause();themePreviewPlaylist.setEnabled(false);
  setupRequired = (await api('/api/status')).setupRequired;
  $('auth').hidden = false; $('workspace').hidden = true; $('logout').hidden = true;
  $('setup-code-label').hidden = !setupRequired; $('setup-code').required = setupRequired;
  $('auth-title').textContent = setupRequired ? '設定教師帳戶' : '登入教師後台';
  $('auth-hint').textContent = setupRequired ? '首次使用：輸入伺服器終端顯示的設定代碼，再建立至少 12 字元的教師密碼。' : '輸入教師密碼，管理班別、頭像及抽籤紀錄。';
  $('password').autocomplete = setupRequired ? 'new-password' : 'current-password';
  $('password').minLength = setupRequired ? 12 : 1;
  $('auth-submit').textContent = setupRequired ? '建立教師帳戶並登入' : '登入';
}
form('auth-form', async () => {
  const password = $('password').value;
  if (setupRequired) await api('/api/setup', { code: $('setup-code').value.trim(), password });
  await api('/api/login', { password }); $('password').value = ''; $('setup-code').value = '';
  await enter(); notice('已登入教師後台');
});
async function enter() {
  await loadClasses();
  await Promise.all([loadAvatars(), loadEvents(), loadStatsClasses(), loadThemes()]);
  $('auth').hidden = true; $('workspace').hidden = false; $('logout').hidden = false;
  const query=new URLSearchParams(location.search),classId=query.get('class');
  if(classId){$('class-select').value=classId;await loadRoster();$('stats-class').value=classId;await loadClassStats();}
  if(query.get('view')==='statistics')setTab('statistics');
  await loadSounds();
  if(soundData.refreshing)pollSounds().catch(e=>{$('sound-sync-status').textContent=e.message;});
  else if(!soundData.autoSync?.enabled)refreshSounds().catch(e=>{$('sound-sync-status').textContent=e.message;});
}
$('logout').addEventListener('click', async () => { try { await api('/api/logout', {}); await showAuth(); notice('已登出'); } catch (e) { notice(e.message, true); } });
async function loadClasses() {
  classes = await api('/api/classes');
  const totalStudents=classes.reduce((sum,c)=>sum+Number(c.student_count),0);
  const backupCount=await api('/api/backup/summary');tabCount('backup-tab-count',`${countFormat.format(backupCount.students)} 人`,`完整備份包含 ${backupCount.classes} 個班別、${backupCount.students} 位學生（包括停用及封存資料）`);
  tabCount('classes-tab-count',`${classes.length} 班 · ${countFormat.format(totalStudents)} 人`,`使用中 ${classes.length} 個班別、${totalStudents} 位學生`);
  options($('class-select'), classes, '選擇要管理的班別', c => `${c.name} · ${c.student_count} 人`);

  if (!$('class-select').value && classes.length) $('class-select').value = classes[0].id;

  await loadRoster();
}
function updateStatsBadge(rows){const total=rows.reduce((sum,c)=>sum+Number(c.draw_count),0);tabCount('statistics-tab-count',`${countFormat.format(total)} 筆`,`${total} 筆所有班別的累積抽籤記錄，包括機會、命運及已封存班別`);}
form('create-class', async () => {
  const c = await api('/api/classes', { name: $('class-name').value }); $('class-name').value = '';
  await loadClasses(); $('class-select').value = c.id;  await loadRoster(); $('create-dialog').close();notice('已新增班別，可匯入 Excel 或批次文字編輯');
});
let rosterRevision=0,editingStudent=null,editingClass=null;
function renderClassList(){
  $('class-total').textContent=classes.length;
  $('class-list').replaceChildren(...classes.map(c=>{
    const b=button('',async()=>{$('class-select').value=c.id;await loadRoster();},'class-card');
    b.classList.toggle('selected',c.id===$('class-select').value);b.setAttribute('aria-pressed',String(c.id===$('class-select').value));
    b.append(node('strong',c.name),node('span',`${c.student_count} 位學生`));return b;
  }));
}
async function loadRoster() {
  const revision=++rosterRevision,classId=$('class-select').value;
  renderClassList();$('roster-editor').hidden=!classId;$('roster-empty').hidden=Boolean(classId);
  if(!classId){students=[];return;}
  const result=await api(`/api/classes/${classId}/students`);if(revision!==rosterRevision)return;
  students=result;const prefs=await api(`/api/classes/${classId}/preferences`);if(revision!==rosterRevision)return;$('class-draw-mode').value=prefs.drawMode;$('class-theme').value=prefs.theme||'';
  $('selected-class-name').textContent=classes.find(c=>c.id===classId)?.name||'';
  $('selected-class-count').textContent=`${students.length} 位學生 · 每位同學都有機會抽中`;
  $('start-class').href='/?class='+encodeURIComponent(classId);
  $('export-current-roster').href='/api/roster/export?classId='+encodeURIComponent(classId);
  $('roster-input').value=students.map(s=>s.school_class?`${s.school_class},${s.number},${s.name}`:`${s.number},${s.name}`).join('\n');
  renderStudents();
}
function renderStudents(){
  const query=$('student-search').value.trim().toLowerCase();
  const visible=students.filter(s=>studentDisplay(s).toLowerCase().includes(query));
  $('visible-students').textContent=`顯示 ${visible.length} / ${students.length} 位學生`;$('no-matching-students').hidden=Boolean(visible.length);
  $('student-rows').replaceChildren(...visible.map(s=>{
    const tr=node('tr'),identity=node('td',undefined,'student-identity'),text=node('div');
    text.append(node('strong',s.name),node('small',[s.school_class,s.number?'學號 '+s.number:''].filter(Boolean).join(' · ')));
    identity.append(avatar(s.avatar_id,s.name),text);
    const status=node('td');status.append(node('span',s.avatar_id?'已設定':'預設貓咪','badge '+(s.avatar_id?'approved':'')));
    const actions=node('td',undefined,'student-actions');actions.append(button('編輯',()=>openStudent(s)),button('頭像連結',async()=>{
      const link=await api(`/api/students/${s.id}/link`,{});$('link-student').textContent=studentDisplay(s);
      $('link-url').value=new URL(link.path,location.origin).href;$('link-expiry').textContent='有效至 '+date(link.expires)+'。先前的連結已失效。';$('link-dialog').showModal();
    }));
    actions.append(button('停用連結',async()=>{await api(`/api/students/${s.id}/link`,{},'DELETE');notice(`已停用 ${s.name} 的提交連結`);},'danger'));tr.append(identity,status,actions);return tr;
  }));
}
function openStudent(student=null){
  editingStudent=student;editingClass=$('class-select').value;if(!editingClass)return;
  $('student-dialog-title').textContent=student?'編輯學生':'加入學生';
  $('student-name').value=student?.name||'';$('student-school-class').value=student?.school_class||'';$('student-number').value=student?.number||'';
  notice('');$('student-dialog').showModal();
}
form('student-form',async()=>{
  await api(editingStudent?'/api/students/'+editingStudent.id:'/api/students',{classId:editingClass,name:$('student-name').value,school_class:$('student-school-class').value,number:$('student-number').value},editingStudent?'PUT':'POST');
  $('student-dialog').close();await loadClasses();notice('學生資料已儲存');
});
$('student-search').addEventListener('input',renderStudents);
for(const [id,dialog] of [['open-import','import-dialog'],['open-create','create-dialog'],['open-batch','batch-dialog']])$(id).addEventListener('click',()=>{notice('');document.querySelectorAll('details[open]').forEach(d=>d.open=false);$(dialog).showModal();});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
$('class-select').addEventListener('change', () => loadRoster().catch(e => notice(e.message, true)));
$('rename-class').addEventListener('click', async () => {
  const c = classes.find(c => c.id === $('class-select').value); if (!c) return;
  const name = prompt('班別新名稱', c.name); if (name === null) return;
  try { await api(`/api/classes/${c.id}`, { name }, 'PUT'); await loadClasses(); notice('已更新班別名稱'); } catch (e) { notice(e.message, true); }
});
$('archive-class').addEventListener('click', async () => {
  const c = classes.find(c => c.id === $('class-select').value); if (!c || !confirm(`封存「${c.name}」？學生提交連結會停用；既有統計仍可查閱。`)) return;
  try { await api(`/api/classes/${c.id}`, {}, 'DELETE'); await loadClasses(); notice('班別已封存，既有統計保留'); } catch (e) { notice(e.message, true); }
});
form('save-roster', async () => {
  const rows = $('roster-input').value.split('\n').map(r => r.trim()).filter(Boolean).map((line, i) => {
    const parts=line.split(/[,，\t]/).map(p=>p.trim());
    if(parts.length>=3)return {school_class:parts[0].toUpperCase(),number:parts[1],name:parts.slice(2).join(',')};
    return {school_class:'',number:parts.length===2?parts[0]:String(i+1),name:parts.length===2?parts[1]:line};
  });
  const removed = students.filter(s => !rows.some(r => studentKey(r.school_class,r.number) === studentKey(s.school_class,s.number)));
  const renamed = students.filter(s => rows.some(r => studentKey(r.school_class,r.number) === studentKey(s.school_class,s.number) && r.name !== s.name));
  if ((removed.length || renamed.length) && !confirm(`將移除 ${removed.length} 位學生、改名 ${renamed.length} 位學生。相同學號會保留原有頭像及身份；若是不同學生，請使用新學號。確定儲存？`)) return;
  await api(`/api/classes/${$('class-select').value}/students`, { students: rows }, 'PUT'); $('batch-dialog').close(); await loadClasses(); notice('名單已儲存，所有名單內學生均可被抽中');
});
$('close-link').addEventListener('click', () => $('link-dialog').close());
$('copy-link').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('link-url').value); notice('已複製學生連結'); }
  catch { $('link-url').select(); notice('請複製已選取的連結'); }
});
$('export-links').addEventListener('click', async () => {
  if (!students.length) return notice('請先加入學生', true);
  if (!confirm('這會產生全班的新個人連結，並停用全班舊連結。確定繼續？')) return;
  const b = $('export-links'); b.disabled = true;
  try {
    const links = await api(`/api/classes/${$('class-select').value}/links`, {});
    const className=classes.find(c=>c.id===$('class-select').value)?.name||'班別';
    downloadCSV(className.replace(/[\/:*?"<>|]/g,'_')+'學生頭像個人連結.csv', [['學號','學生顯示 ID','個人連結','有效至（香港）'], ...links.map(l => [l.number,l.display_id||l.name,new URL(l.path,location.origin).href,date(l.expires)])]); notice('已匯出，請把每人的連結個別交給本人');
  } catch (e) { notice(e.message, true); } finally { b.disabled = false; }
});
async function loadAvatars() {
  avatarRows = await api('/api/avatars');const pending=avatarRows.filter(a=>a.status==='pending').length;tabCount('pending-count',countFormat.format(pending),`${pending} 張頭像待審批`);$('pending-count').classList.toggle('pending',pending>0);renderAvatars();
}
function renderAvatars() {
  $('avatar-grid').replaceChildren(); const filter = $('avatar-filter').value;
  const visible = avatarRows.filter(a => filter === 'all' || a.status === filter);
  if (!visible.length) { $('avatar-grid').append(node('p','這裏暫時沒有頭像。學生提交後，可按「重新整理」查看。','empty')); return; }
  visible.forEach(a => {
    const card = node('article',undefined,'card avatar-card');
    card.append(avatar(a.id,a.name,'avatar-large'),node('h3',studentDisplay(a)),node('p',a.class_name + (a.active ? '' : ' · 已移出名單'),'muted'),node('span',a.status === 'pending' ? '待審批' : '已批准','badge ' + a.status),node('p',date(a.created),'footnote'));
    const actions = node('div',undefined,'actions');
    if (a.status === 'pending') actions.append(button('批准顯示', async () => { await api('/api/avatars/'+a.id,{status:'approved'},'PUT'); await loadAvatars(); notice('頭像已批准，下次載入棋盤會顯示'); },'primary'));
    actions.append(button(a.status === 'pending' ? '拒絕並刪除' : '刪除頭像', async () => {
      if (!confirm(`刪除 ${a.name} 的這個頭像？${a.status === 'approved' ? '棋盤會改用預設貓咪。' : ''}`)) return;
      await api('/api/avatars/'+a.id,{},'DELETE'); await loadAvatars(); notice('頭像已刪除');
    },'danger')); card.append(actions); $('avatar-grid').append(card);
  });
}
$('avatar-filter').addEventListener('change',renderAvatars);
$('refresh-avatars').addEventListener('click', () => loadAvatars().catch(e => notice(e.message,true)));
function eventPreview(kind) {
  const items = parseEventText($(kind+'-input').value);
  $(kind+'-count').textContent = `${items.length} 項`;

}
async function loadEvents() {
  const events = await api('/api/events');eventTabCount(events);
  for (const kind of ['chance','fate']) { $(kind+'-input').value=formatEventText(events[kind]); eventPreview(kind); }
}
for (const kind of ['chance','fate']) {
  $(kind+'-input').addEventListener('input',()=>eventPreview(kind));
  $('format-'+kind).addEventListener('click',()=>{ $(kind+'-input').value=formatEventText(parseEventText($(kind+'-input').value)); eventPreview(kind); });
}
form('save-events',async () => {
  const events = await api('/api/events',{chance:parseEventText($('chance-input').value),fate:parseEventText($('fate-input').value)},'PUT');
  for (const kind of ['chance','fate']) { $(kind+'-input').value=formatEventText(events[kind]); eventPreview(kind); }
  eventTabCount(events);
  notice('機會與命運已儲存，每項已按分行及分號整理');
});

$('stats-month').value = today().slice(0,7);
$('stats-week').value = today();
async function loadStatsClasses() {
  const rows = await api('/api/classes?includeArchived=1');
  updateStatsBadge(rows);
  options($('stats-class'),rows,'選擇統計班別',c=>c.name+(c.archived?'（已封存）':''));
  if (!$('stats-class').value && rows.length) $('stats-class').value=rows[0].id;
  await loadClassStats();
}
function renderBars(container, rows) {
  container.replaceChildren();
  if (!rows.length) { container.append(node('p','此範圍暫時沒有中籤紀錄。','empty')); return; }
  const max = Math.max(1,...rows.map(r=>Number(r.count)));
  for (const row of rows) {
    const bar = node('div',undefined,'bar-row');
    const label=node('span',row.label,'bar-label');
    const track=node('div',undefined,'bar-track'),fill=node('div',undefined,'bar-fill');
    track.setAttribute('aria-hidden','true'); fill.style.width=(Number(row.count)/max*100)+'%'; track.append(fill);
    bar.append(label,track,node('strong',String(row.count),'bar-value')); container.append(bar);
  }
}
async function loadClassStats() {
  const revision=++statsRevision;
  const classId=$('stats-class').value, period=$('stats-period').value;
  $('stats-month-label').hidden=period!=='month'; $('stats-week-label').hidden=period!=='week';
  classStats=null;
  $('class-stats-empty').textContent='請選擇班別以查看統計。';
  $('class-stats-content').hidden=true; $('class-stats-empty').hidden=Boolean(classId);
  $('class-metrics').replaceChildren(); $('class-stats-range').textContent='';
  if(!classId)return;
  const value=period==='month'?$('stats-month').value:period==='week'?$('stats-week').value:'';
  if(period!=='all'&&!value){$('class-stats-empty').textContent='請選擇統計日期。';$('class-stats-empty').hidden=false;return;}
  const query=new URLSearchParams({period,...(value?{date:value}:{})});
  const result=await api(`/api/classes/${classId}/stats?${query}`);
  if(revision!==statsRevision)return;
  classStats=result; $('class-stats-content').hidden=false; $('class-stats-empty').hidden=true;
  const caption=`${result.class.name} · ${result.range.label}`;
  $('class-stats-range').textContent=caption; $('class-list-caption').textContent=caption;
  for(const [value,label] of [[result.summary.studentDraws,'抽中學生次數'],[result.summary.uniqueStudents,'曾中籤學生'],[result.summary.eventDraws,'機會／命運次數']]){
    const m=node('div',undefined,'metric');m.append(node('strong',value),node('span',label));$('class-metrics').append(m);
  }
  renderBars($('student-chart'),result.students.map(s=>({label:studentDisplay(s),count:s.count})));
  $('timeline-title').textContent=period==='all'?'各月中籤次數':'每日中籤次數';
  renderBars($('timeline-chart'),result.timeline);
  $('class-stats-rows').replaceChildren();
  for(const s of result.students){const tr=node('tr');tr.append(node('td',s.number),node('td',studentDisplay(s)+(s.active?'':'（已移出名單）')),node('td',s.count));$('class-stats-rows').append(tr);}
  $('class-history-rows').replaceChildren();
  for(const d of result.draws.slice(0,100)){
    const tr=node('tr'),actions=node('td');actions.append(button(d.voided?'恢復計入':'不計入統計',async()=>{
      notice('');voidTarget=d;$('void-draw-title').textContent=d.voided?'恢復計入統計':'標記不計入統計';$('void-reason-label').hidden=Boolean(d.voided);$('void-reason').required=!d.voided;$('void-reason').value='誤按抽籤';$('void-draw-dialog').showModal();
    }));tr.append(node('td',date(d.created)),node('td',kindLabel[d.kind]),node('td',d.kind==='student'?`${d.student_number} · ${d.student_name}`:d.event_text),node('td',d.voided?'不計入：'+d.void_reason:'計入統計'),actions);$('class-history-rows').append(tr);
  }
}
for(const id of ['stats-class','stats-period','stats-month','stats-week'])$(id).addEventListener('change',()=>loadClassStats().catch(e=>notice(e.message,true)));
$('refresh-class-stats').addEventListener('click',()=>loadStatsClasses().catch(e=>notice(e.message,true)));
$('export-class-stats').addEventListener('click',()=>{
  if(!classStats)return;const s=classStats;
  downloadCSV(s.class.name+'-'+s.range.label+'-中籤名單.csv',[['班別','範圍','學號','學生','中籤次數'],...s.students.map(r=>[s.class.name,s.range.label,r.number,studentDisplay(r),r.count])]);
});
$('export-class-history').addEventListener('click',()=>{
  if(!classStats)return;const s=classStats;
  downloadCSV(s.class.name+'-'+s.range.label+'-抽籤紀錄.csv',[['班別','範圍','時間（香港）','類型','學號','學生','事件','計入統計','取消原因'],...s.draws.map(d=>[s.class.name,s.range.label,date(d.created),kindLabel[d.kind],d.student_number,d.student_name,d.event_text,d.voided?'否':'是',d.void_reason])]);
});
function clearImportPreview() {
  rosterPreview=null;$('import-preview').hidden=true;$('import-preview-rows').replaceChildren();
}
for(const id of ['roster-file','import-mode'])$(id).addEventListener('change',clearImportPreview);
$('cancel-import').addEventListener('click',clearImportPreview);
form('import-roster',async()=>{
  clearImportPreview();
  const file=$('roster-file').files[0];
  if(!file||!file.name.toLowerCase().endsWith('.xlsx'))throw new Error('請選擇 .xlsx Excel 檔案');
  if(file.size>5*1024*1024)throw new Error('Excel 檔案最多 5 MB');
  const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('無法讀取檔案'));reader.readAsDataURL(file);});
  const preview=await api('/api/roster/import/preview',{base64,mode:$('import-mode').value});
  rosterPreview=preview;$('import-preview').hidden=false;
  $('import-file-caption').textContent=`${file.name} · 預覽有效至 ${date(preview.expires)}`;
  $('import-summary').replaceChildren();
  for(const [value,label] of [[preview.summary.newGroups,'新增 GROUP'],[preview.summary.reactivatedGroups,'重新啟用 GROUP'],[preview.summary.added,'新增學生'],[preview.summary.updated,'更新學生'],[preview.summary.unchanged,'保持不變'],[preview.summary.removed,'移出學生']]){
    const m=node('div',undefined,'metric');m.append(node('strong',value),node('span',label));$('import-summary').append(m);
  }
  $('import-errors').hidden=!preview.errors.length;
  $('import-errors').replaceChildren(...preview.errors.map(message=>node('p',message)));
  $('confirm-import').disabled=Boolean(preview.errors.length);
  $('import-groups').textContent='涉及 GROUP：'+preview.groups.map(g=>g.name).join('、');
  const labels={add:'新增',update:'更新',unchanged:'不變'};
  for(const c of preview.changes){
    const tr=node('tr');tr.append(node('td',`${c.sheet} 第${c.row}行`),node('td',labels[c.action]),node('td',c.group),node('td',c.before?`${c.before.group} / ${studentDisplay(c.before)}`:'—'),node('td',studentDisplay(c.after)));$('import-preview-rows').append(tr);
  }
  for(const s of preview.removed){const tr=node('tr');tr.append(node('td','檔案未列出'),node('td','移出'),node('td',preview.groups.find(g=>g.id===s.class_id)?.name||''),node('td',studentDisplay(s)),node('td','停用，保留紀錄'));$('import-preview-rows').append(tr);}
  notice(preview.errors.length?'檔案有錯誤，請修正後重新上載':'已讀取檔案，請檢查預覽後按「確認套用匯入」',Boolean(preview.errors.length));
});
$('confirm-import').addEventListener('click',async()=>{
  if(!rosterPreview||rosterPreview.errors.length)return;
  const button=$('confirm-import');button.disabled=true;
  try {
    const imported=await api('/api/roster/import/commit',{previewId:rosterPreview.previewId});
    const group=rosterPreview.groups[0];clearImportPreview();$('roster-file').value='';
    $('import-dialog').close();await loadClasses();if(group){$('class-select').value=group.id;await loadRoster();}
    await Promise.all([loadStatsClasses(),loadAvatars()]);
    notice(`匯入完成：新增 ${imported.summary.added} 位、更新 ${imported.summary.updated} 位、保持 ${imported.summary.unchanged} 位、移出 ${imported.summary.removed} 位。`);
  }catch(error){notice(error.message,true);button.disabled=false;}
});


let soundData=null,soundDirty=false,soundPoll=null;
function syncSoundStatus(){
  if(!soundData)return;
  const attempted=soundData.attempt;
  const base=`清單：${soundData.scope} · 取得時間 ${date(soundData.updatedAt)}${soundData.captureMethod==='browser-dom'?' · 瀏覽器讀取成功':''}`;
  $('sound-sync-status').textContent=soundData.refreshing?'正在從 memes.tw 更新音效，期間仍可使用原有清單⋯':attempted?.ok===false?`${base}。上次伺服器自動同步：${attempted.error}`:`${base}${attempted?.ok?' · 更新成功':''}`;
  if(soundData.autoSync?.enabled)$('sound-sync-status').textContent+=soundData.autoSync.nextAt?`。伺服器自動更新已啟用：下次 ${date(soundData.autoSync.nextAt)}（成功後每 ${soundData.autoSync.intervalHours} 小時更新）`:'。伺服器自動更新已啟用';
  $('sound-sync-status').classList.toggle('sync-error',attempted?.ok===false&&!soundData.refreshing);
}
async function loadSounds(){
  const data=await api('/api/sounds');
  if(soundDirty&&soundData){const choices=new Map(soundData.items.map(s=>[s.id,s.enabled]));for(const s of data.items)if(choices.has(s.id))s.enabled=choices.get(s.id);}
  soundData=data;syncSoundStatus();renderSounds();
}
function renderSounds(){
  if(!soundData)return;
  tabCount('sounds-tab-count',`${countFormat.format(soundData.items.length)} 項`,`${soundData.items.length} 項可管理音效`);
  const query=$('sound-search').value.trim().toLowerCase(),items=soundData.items.filter(s=>s.name.toLowerCase().includes(query));
  $('sound-count').textContent=`已選用 ${soundData.items.filter(s=>s.enabled).length} / ${soundData.items.length} 項 · 顯示 ${items.length} 項${soundDirty?' · 尚未儲存':''}`;
  $('sound-list').replaceChildren(...items.map(s=>{
    const card=node('div',undefined,'sound-row'),label=node('label'),check=document.createElement('input');check.type='checkbox';check.checked=s.enabled;check.value=s.id;
    check.addEventListener('change',()=>{s.enabled=check.checked;soundDirty=true;$('sound-count').textContent=`已選用 ${soundData.items.filter(s=>s.enabled).length} / ${soundData.items.length} 項 · 顯示 ${items.length} 項 · 尚未儲存`;});
    label.append(check,node('span',s.name));const source=node('a','來源 ↗');source.href=s.sourceUrl;source.target='_blank';source.rel='noopener';
    card.append(label,button('▶ 試聽',async()=>{const audio=$('sound-preview');audio.src=s.url;try{await audio.play();}catch{notice('這項音效暫時未能播放，請稍後重試',true);}}),source);return card;
  }));
  if(!items.length)$('sound-list').append(node('p','沒有符合的音效。','empty'));
}
async function refreshSounds(){
  if(soundPoll)clearTimeout(soundPoll);
  $('refresh-sounds').disabled=true;
  try{await api('/api/sounds/refresh',{});await pollSounds();}catch(e){$('refresh-sounds').disabled=false;throw e;}
}
async function pollSounds(){
  await loadSounds();
  if(soundData.refreshing)soundPoll=setTimeout(()=>pollSounds().catch(e=>{$('refresh-sounds').disabled=false;$('sound-sync-status').textContent=e.message;}),1500);
  else {$('refresh-sounds').disabled=false;soundPoll=null;}
}
$('refresh-sounds').addEventListener('click',()=>refreshSounds().catch(e=>notice(e.message,true)));
$('sound-search').addEventListener('input',renderSounds);
$('stop-sound-preview').addEventListener('click',()=>{$('sound-preview').pause();});
for(const [id,value] of [['select-all-sounds',true],['select-no-sounds',false]])$(id).addEventListener('click',()=>{if(soundData){for(const s of soundData.items)s.enabled=value;soundDirty=true;renderSounds();}});
form('save-sounds',async()=>{
  if(!soundData)return;
  soundData=await api('/api/sounds',{disabled:soundData.items.filter(s=>!s.enabled).map(s=>s.id)},'PUT');soundDirty=false;renderSounds();notice('音效勾選已儲存');
  if('BroadcastChannel' in window){const channel=new BroadcastChannel('monopoly-sounds');channel.postMessage('updated');channel.close();}
});

let selectedTheme='basic',themeRevision=0,previewRevision=0;
async function previewTheme(id){
  const revision=++previewRevision;
  selectedTheme=id;setThemeCardPlayback(!$('tab-themes').hidden);const theme=themeById(id);$('open-theme-preview').href='theme-preview.html?theme='+theme.id;
  $('theme-preview-title').textContent=theme.icon+' '+theme.name+'預覽';
  const audio=$('theme-preview-audio'),video=$('theme-preview-video');audio.pause();video.pause();
  audio.src=theme.music;themePreviewPlaylist.setEnabled(false);const mediaTheme=await withBackgroundLibrary(theme);if(revision!==previewRevision)return;themePreviewPlaylist.setTheme(mediaTheme);themePreviewPlaylist.setEnabled(!$('tab-themes').hidden,{play:false});
  document.querySelectorAll('.theme-option').forEach(card=>{const active=card.dataset.theme===id;card.classList.toggle('selected',active);card.querySelector('input').checked=active;});
}
async function loadThemes(){
  const revision=++themeRevision;const global=await api('/api/theme');if(revision!==themeRevision)return;let scope=$('theme-scope').value;if(!classes.some(c=>c.id===scope))scope='';
  $('theme-scope').replaceChildren(new Option('全站預設',''),...classes.map(c=>new Option(c.name,c.id)));$('theme-scope').value=scope;
  const prefs=scope?await api('/api/classes/'+scope+'/preferences'):null;if(revision!==themeRevision)return;const saved={theme:prefs?.theme||global.theme};
  $('inherit-theme-label').hidden=!scope;$('inherit-theme').checked=Boolean(scope&&!prefs?.theme);
  $('theme-options').replaceChildren(...THEMES.map(theme=>{
    const card=node('label',undefined,'theme-option');card.dataset.theme=theme.id;
    const input=document.createElement('input');input.type='radio';input.name='theme';input.value=theme.id;input.checked=theme.id===saved.theme;
    input.addEventListener('change',()=>{if(input.checked){$('inherit-theme').checked=false;previewTheme(theme.id);}});
    const title=node('strong',theme.icon+' '+theme.name),palette=node('span',undefined,'theme-palette');palette.setAttribute('aria-hidden','true');
    for(const color of theme.colors){const chip=node('span');chip.style.background=color;palette.append(chip);}
    const preview=node('span',undefined,'theme-card-scene'),frame=node('iframe');frame.className='theme-card-frame';frame.title=theme.name+'實景預覽（示範學生）';frame.dataset.previewSrc='theme-preview.html?theme='+theme.id;frame.dataset.theme=theme.id;frame.addEventListener('load',()=>frame.contentWindow?.postMessage({type:'theme-preview-play',playing:!$('tab-themes').hidden&&frame.dataset.theme===selectedTheme},location.origin));frame.tabIndex=-1;frame.setAttribute('aria-hidden','true');preview.append(frame);
    new ResizeObserver(entries=>{const width=entries[0].contentRect.width;frame.style.transform=`scale(${width/1280})`;}).observe(preview);
    const state=node('small','影片載入中','theme-play-state');state.setAttribute('aria-live','polite');
    card.append(input,title,preview,state,palette,node('span',theme.description));return card;
  }));
  setThemeCardPlayback(!$('tab-themes').hidden);
  previewTheme(saved.theme);const library=await loadBackgroundLibrary();if(revision!==themeRevision)return;$('background-update-status').textContent='每週一香港時間 06:15 更新，每個主題換 1 條；最近成功更新：'+(library?.updatedAt?date(library.updatedAt):'2026-10-20（初始影片庫）')+'。更新失敗會保留現有影片。';$('active-theme').textContent=($('theme-scope').value?'這班':'全站預設')+'目前使用：'+themeById(saved.theme).name+($('theme-scope').value&&$('inherit-theme').checked?'（沿用全站預設）':'');
  tabCount('themes-tab-count','3 款','3 款主題，目前使用'+themeById(saved.theme).name);
}
form('save-theme',async()=>{
  const scope=$('theme-scope').value;
  const saved=scope?await api('/api/classes/'+scope+'/preferences',{theme:$('inherit-theme').checked?null:selectedTheme},'PUT'):await api('/api/theme',{theme:selectedTheme},'PUT');
  if(!saved.theme)saved.theme=(await api('/api/theme')).theme;
  $('active-theme').textContent=($('theme-scope').value?'這班':'全站預設')+'目前使用：'+themeById(saved.theme).name+($('theme-scope').value&&$('inherit-theme').checked?'（沿用全站預設）':'');
  tabCount('themes-tab-count','3 款','3 款主題，目前使用'+themeById(saved.theme).name);
  notice('已套用'+themeById(saved.theme).name+'；前台會在下次操作或約 30 秒內更新');
  if('BroadcastChannel' in window){const channel=new BroadcastChannel('monopoly-theme');channel.postMessage('updated');channel.close();}
});
$('preview-theme-effect').addEventListener('click',()=>{
  const theme=themeById(selectedTheme),dialog=$('theme-effect-dialog');
  $('theme-effect-caption').textContent=theme.icon+' '+theme.name+'：'+(theme.effect==='confetti'?'經典彩炮':theme.effect==='cats'?'不同貓咪噴發':'不同狗狗噴發');
  dialog.showModal();celebrate(dialog,theme.effect);
});

$('inherit-theme').addEventListener('change',async()=>{if($('inherit-theme').checked){try{previewTheme((await api('/api/theme')).theme);}catch(e){notice(e.message,true);}}});
let voidTarget=null;
form('void-draw-form',async()=>{if(!voidTarget)return;const d=voidTarget;await api('/api/draws/'+d.id+'/void',{voided:!d.voided,reason:d.voided?'':$('void-reason').value},'PUT');$('void-draw-dialog').close();await loadClassStats();await refreshCountBadges();notice(d.voided?'已恢復計入統計':'已標記不計入統計，原始紀錄保留');});
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.data?.type!=='theme-preview-status')return;for(const frame of document.querySelectorAll('.theme-card-frame'))if(event.source===frame.contentWindow){const state=frame.closest('.theme-option').querySelector('.theme-play-state');state.textContent=event.data.playing?'背景影片播放中':'背景影片已暫停';}});
$('theme-scope').addEventListener('change',()=>loadThemes().catch(e=>notice(e.message,true)));
form('save-class-preferences',async()=>{await api('/api/classes/'+$('class-select').value+'/preferences',{drawMode:$('class-draw-mode').value,theme:$('class-theme').value||null},'PUT');notice('班別抽籤方式及主題已儲存');if('BroadcastChannel' in window){const c=new BroadcastChannel('monopoly-theme');c.postMessage('updated');c.close();}});
async function refreshCountBadges(){const rows=await api('/api/classes?includeArchived=1');updateStatsBadge(rows);}
function saveBlob(blob,filename){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function downloadBackup(path,filename){const r=await fetch(path,{credentials:'same-origin',cache:'no-store'});if(!r.ok){const e=await r.json();throw new Error(e.error||'備份未能下載');}saveBlob(await r.blob(),filename);}
$('export-qr-links').addEventListener('click',()=>{if(!students.length)return notice('這班沒有學生',true);notice('');$('qr-links-dialog').showModal();});
form('generate-qr-links',async()=>{
  const b=$('export-qr-links');b.disabled=true;
  try{
    const links=await api('/api/classes/'+$('class-select').value+'/links',{format:'qr'}),name=classes.find(c=>c.id===$('class-select').value)?.name||'班別';
    const doc=document.implementation.createHTMLDocument(name+' 頭像 QR Code 卡');doc.documentElement.lang='zh-HK';const meta=doc.createElement('meta');meta.setAttribute('charset','utf-8');doc.head.prepend(meta);
    const style=doc.createElement('style');style.textContent='body{font-family:-apple-system,BlinkMacSystemFont,"PingFang TC",sans-serif;margin:20px}main{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}article{border:1px solid #999;padding:14px;text-align:center;break-inside:avoid;overflow-wrap:anywhere}img{width:100%;max-width:190px}h2{font-size:16px}p,small{font-size:12px}@page{size:A4;margin:12mm}@media print{body{margin:0}a{color:inherit;text-decoration:none}}';doc.head.append(style);
    const title=doc.createElement('h1');title.textContent=name+' · 學生頭像提交 QR Code';const hint=doc.createElement('p');hint.textContent='每張卡只交給對應學生。請用瀏覽器列印或另存 PDF；連結到期後須重新產生。';const main=doc.createElement('main');doc.body.append(title,hint,main);
    for(const l of links){const card=doc.createElement('article'),h=doc.createElement('h2'),img=doc.createElement('img'),caption=doc.createElement('p'),a=doc.createElement('a');h.textContent=l.display_id&&l.display_id!==l.name?l.display_id:'學號 '+l.number+' · '+l.name;img.src='data:image/svg+xml;base64,'+btoa(l.qr);img.alt='學生頭像提交 QR Code';caption.textContent='有效至（香港）：'+date(l.expires);a.href=new URL(l.path,location.origin).href;a.textContent='開啟個人頭像提交頁';card.append(h,img,caption,a);main.append(card);}
    saveBlob(new Blob(['<!doctype html>'+doc.documentElement.outerHTML],{type:'text/html;charset=utf-8'}),name.replace(/[\\/:*?"<>|]/g,'_')+'頭像QR卡.html');$('qr-links-dialog').close();notice('已下載可列印 QR Code 卡，請把每張卡個別交給本人');
  }catch(e){notice(e.message,true);}finally{b.disabled=false;}
});
let backupPreview=null,backupRevision=0;
function clearBackupPreview(){backupRevision++;backupPreview=null;$('backup-preview').hidden=true;$('backup-saved').checked=false;$('backup-confirmation').value='';$('restore-backup-button').disabled=true;}
$('backup-file').addEventListener('change',clearBackupPreview);
$('download-backup').addEventListener('click',()=>downloadBackup('/api/backup/export','Monopoly-backup-'+today()+'.json.gz').catch(e=>notice(e.message,true)));
form('preview-backup',async()=>{
  clearBackupPreview();const revision=backupRevision,file=$('backup-file').files[0];if(!file||file.size>67*1024*1024)throw new Error('請選擇最多 67 MB 的完整備份 .json.gz');
  const encoded=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(new Error('無法讀取備份'));r.readAsDataURL(file);});
  if(revision!==backupRevision)return;const result=await api('/api/backup/preview',{file:encoded});if(revision!==backupRevision)return;backupPreview=result;$('backup-differences').replaceChildren();for(const [key,label] of [['classes','班別'],['students','學生'],['draws','抽籤紀錄'],['avatars','頭像'],['links','學生連結']]){const row=node('tr');row.append(node('td',label),node('td',backupPreview.current[key]),node('td',backupPreview.incoming[key]));$('backup-differences').append(row);}
  $('backup-change-list').replaceChildren(...backupPreview.differences.map(d=>{const details=node('details'),summary=node('summary',`${d.label}：新增 ${d.added}、移除 ${d.removed}、修改 ${d.changed}`);details.append(summary);for(const e of d.examples)details.append(node('p',e.before+' → '+e.after));if(d.added+d.removed+d.changed>20)details.append(node('small','只列出前 20 個差異例子。'));return details;}));
  $('backup-expiry').textContent=file.name+' · 預覽有效至 '+date(backupPreview.expires)+'；同數量也可能包含不同資料，還原會整份取代。';$('backup-preview').hidden=false;
});
$('download-safety-backup').addEventListener('click',async()=>{if(!backupPreview)return;const previewId=backupPreview.previewId;try{await downloadBackup('/api/backup/safety/'+previewId,'Monopoly-before-restore-'+today()+'.json.gz');if(backupPreview?.previewId!==previewId)return;$('restore-backup-button').disabled=false;notice('現況備份已開始下載，請確認檔案已保存再還原');}catch(e){notice(e.message,true);}});
form('restore-backup',async()=>{if(!backupPreview)return;if($('backup-confirmation').value!=='取代全部資料')throw new Error('請輸入「取代全部資料」');await api('/api/backup/restore',{previewId:backupPreview.previewId,backupSaved:$('backup-saved').checked,confirmation:$('backup-confirmation').value});clearBackupPreview();await enter();notice('完整還原完成，教師密碼保持不變；其他前台請重新選擇班別');});

try { await enter(); } catch(e) { if (e.status === 401) await showAuth(); else { notice(e.message,true); await showAuth(); } }
