import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
const seedCatalog=readFileSync(new URL('./sound-catalog.json',import.meta.url),'utf8');
import { validSound } from './sound-library.mjs';

const MAX=100*1024*1024;
const settingsKeys=['events','theme','disabledSounds','soundCatalog'];
const columns={
  classes:['id','name','archived','draw_mode','theme'],
  students:['id','class_id','name','number','active','school_class','student_no'],
  lessons:['id','class_id','name','created','closed','must_student','board'],
  draws:['id','lesson_id','kind','student_id','student_name','student_number','event_text','created','request_id','animation','voided','void_reason','voided_at'],
  links:['student_id','token','expires'],
  avatars:['id','student_id','mime','bytes','status','created'],
  lesson_aliases:['id','class_id']
};
const fail=(message='備份格式不正確')=>{throw Object.assign(new Error(message),{status:400});};
const check=(test,message)=>{if(!test)fail(message);};
const string=(s,max=300)=>typeof s==='string'&&s.length<=max;
const identity=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(s);
const flag=n=>n===0||n===1;
const date=s=>typeof s==='string'&&s.length<=40&&Number.isFinite(Date.parse(s));
export async function backupSnapshot(db){
  const size=await db.get('SELECT COALESCE(sum(length(bytes)),0) AS total FROM avatars');
  if(Number(size.total)>60*1024*1024)throw Object.assign(new Error('頭像總容量超過 60 MB，請先整理頭像後再完整備份'),{status:413});
  const data={};
  for(const [table,fields] of Object.entries(columns)){
    data[table]=await db.all(`SELECT ${fields.join(',')} FROM ${table} ORDER BY ${table==='links'?'student_id':'id'}`);
    if(table==='avatars')data[table]=data[table].map(a=>({...a,bytes:Buffer.from(a.bytes).toString('base64')}));
  }
  data.settings=(await db.all('SELECT key,value FROM settings ORDER BY key')).filter(s=>settingsKeys.includes(s.key));
  for(const [key,value] of [['theme','basic'],['disabledSounds','[]'],['soundCatalog',seedCatalog]])if(!data.settings.some(s=>s.key===key))data.settings.push({key,value});
  data.settings.sort((a,b)=>a.key.localeCompare(b.key));
  return data;
}
export function snapshotDigest(data){return createHash('sha256').update(JSON.stringify(data)).digest('hex');}
export function packBackup(data){
  const json=JSON.stringify({format:'Monopoly_Fate10',version:1,exportedAt:new Date().toISOString(),data});
  if(Buffer.byteLength(json)>MAX)throw Object.assign(new Error('完整備份超過 100 MB 上限'),{status:413});
  return gzipSync(json);
}
export function unpackBackup(base64){
  check(typeof base64==='string'&&base64.length<=90*1024*1024,'備份檔案過大');
  try{const bytes=gunzipSync(Buffer.from(base64,'base64'),{maxOutputLength:MAX});return JSON.parse(bytes.toString('utf8'));}catch{fail('無法讀取備份，請使用本系統匯出的 .json.gz 檔案');}
}
export function backupSummary(data){return {classes:data.classes.length,students:data.students.length,draws:data.draws.length,avatars:data.avatars.length,links:data.links.length};}
export async function validateBackup(file){
  check(file?.format==='Monopoly_Fate10'&&file.version===1&&file.data,'不是支援的完整備份');
  const source=file.data,data={},limits={classes:200,students:10000,lessons:200,draws:100000,links:10000,avatars:2000,lesson_aliases:2000};
  check(Object.keys(source).every(key=>key==='settings'||Object.hasOwn(columns,key)),'備份包含不支援的登入或其他系統資料');
  for(const [table,fields] of Object.entries(columns)){
    check(Array.isArray(source[table])&&source[table].length<=limits[table],`${table} 資料過多或格式錯誤`);
    data[table]=source[table].map(row=>{check(row&&typeof row==='object'&&!Array.isArray(row));return Object.fromEntries(fields.map(key=>[key,row[key]]));});
    const key=table==='links'?'student_id':'id';check(data[table].every(r=>identity(r[key]))&&new Set(data[table].map(r=>r[key])).size===data[table].length,`${table} 識別資料重複或不正確`);
  }
  const classes=new Set(data.classes.map(c=>c.id)),students=new Set(data.students.map(s=>s.id)),lessons=new Set(data.lessons.map(l=>l.id));
  check(new Set(data.classes.map(c=>c.name)).size===classes.size,'班別名稱重複');
  for(const c of data.classes)check(string(c.name,60)&&c.name.trim()&&flag(c.archived)&&['equal','dice'].includes(c.draw_mode)&&(c.theme===null||['basic','cat','dog'].includes(c.theme)),'班別設定不正確');
  const keys=new Set();for(const s of data.students){const key=JSON.stringify([s.class_id,s.number]);check(classes.has(s.class_id)&&string(s.name,100)&&s.name.trim()&&string(s.number,50)&&s.number&&flag(s.active)&&string(s.school_class,20)&&string(s.student_no,20)&&!keys.has(key),'學生資料或班號重複');keys.add(key);}
  for(const c of data.classes)check(data.students.filter(s=>s.class_id===c.id&&s.active).length<=100,'每班最多 100 位在用學生');
  function board(value){if(value===null)return;let b;try{b=typeof value==='string'?JSON.parse(value):value;}catch{fail('棋盤資料損壞');}check(b&&Number.isInteger(b.width)&&b.width>=5&&b.width<=80&&Number.isInteger(b.height)&&b.height>=4&&b.height<=80&&Array.isArray(b.cells)&&b.cells.length===2*(b.width+b.height)-4&&b.cells.length<=120&&Number.isInteger(b.currentIndex)&&b.currentIndex>=0&&b.currentIndex<b.cells.length,'棋盤大小不正確');for(const c of b.cells)check(c&&(['chance','fate'].includes(c.type)||(c.type==='student'&&students.has(c.studentId))),'棋盤學生或事件不正確');return b;}
  check(new Set(data.lessons.map(l=>l.class_id)).size===data.lessons.length,'班別累積記錄重複');
  for(const l of data.lessons){check(classes.has(l.class_id)&&string(l.name,120)&&date(l.created)&&flag(l.closed)&&flag(l.must_student),'班別記錄不正確');board(l.board);}
  keys.clear();for(const d of data.draws){const key=JSON.stringify([d.lesson_id,d.request_id]);check(lessons.has(d.lesson_id)&&['student','chance','fate'].includes(d.kind)&&(d.student_id===null||students.has(d.student_id))&&(d.kind!=='student'||students.has(d.student_id))&&(d.student_name===null||string(d.student_name,300))&&(d.student_number===null||string(d.student_number,50))&&(d.event_text===null||string(d.event_text,500))&&date(d.created)&&string(d.request_id,400)&&d.request_id&&!keys.has(key)&&flag(d.voided)&&string(d.void_reason,200)&&(d.voided_at===null||date(d.voided_at)),'抽籤記錄損壞或重複');keys.add(key);
    if(d.animation!==null){check(string(d.animation,1000000),'抽籤動畫過大');let a;try{a=JSON.parse(d.animation);}catch{fail('抽籤動畫損壞');}if(a.board){const b=board(a.board),m=a.move;check(m&&Number.isInteger(m.steps)&&m.steps>=0&&m.steps<=1000&&Number.isInteger(m.fromIndex)&&m.fromIndex>=0&&m.fromIndex<b.cells.length&&Number.isInteger(m.targetIndex)&&m.targetIndex>=0&&m.targetIndex<b.cells.length&&Array.isArray(a.students)&&a.students.every(s=>students.has(s.id)&&string(s.name,100)&&(s.number===undefined||string(s.number,50))&&(s.school_class===undefined||string(s.school_class,20))&&(s.student_no===undefined||string(s.student_no,20))&&(s.display_id===undefined||string(s.display_id,300))&&(s.avatar_id===undefined||s.avatar_id===null||identity(s.avatar_id))),'抽籤動畫不正確');}}
  }
  for(const l of data.links)check(students.has(l.student_id)&&/^[a-f0-9]{64}$/.test(l.token)&&/^\d+$/.test(String(l.expires))&&Number.isSafeInteger(Number(l.expires))&&Number(l.expires)>0&&Number.isFinite(new Date(Number(l.expires)).getTime()),'學生連結資料不正確');
  check(new Set(data.links.map(l=>l.token)).size===data.links.length,'學生連結重複');
  for(const a of data.lesson_aliases)check(classes.has(a.class_id)&&!lessons.has(a.id),'舊記錄別名不正確');
  let total=0;const approved=new Set();for(const a of data.avatars){
    check(students.has(a.student_id)&&['pending','approved'].includes(a.status)&&date(a.created)&&typeof a.bytes==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(a.bytes),'頭像資料不正確');
    const bytes=Buffer.from(a.bytes,'base64');total+=bytes.length;check(bytes.length>0&&bytes.length<=5*1024*1024&&total<=60*1024*1024&&bytes.toString('base64')===a.bytes,'頭像過大或編碼錯誤');
    let meta;try{meta=await sharp(bytes,{animated:true,limitInputPixels:25000000}).metadata();}catch{fail('備份含無法讀取的頭像');}
    const mime={gif:'image/gif',png:'image/png',jpeg:'image/jpeg',webp:'image/webp'}[meta.format];check(mime===a.mime&&meta.width<=4096&&(meta.pageHeight||meta.height)<=4096&&(meta.pages||1)<=300,'頭像類型或大小不正確');
    if(a.status==='approved'){check(!approved.has(a.student_id),'同一學生有多個已批准頭像');approved.add(a.student_id);}
  }
  check(Array.isArray(source.settings)&&source.settings.length<=settingsKeys.length,'設定格式不正確');data.settings=[];keys.clear();
  for(const row of source.settings){check(settingsKeys.includes(row.key)&&!keys.has(row.key)&&typeof row.value==='string','不接受密碼、登入或其他系統設定');keys.add(row.key);let value;try{value=JSON.parse(row.value);}catch{if(row.key==='theme')value=row.value;else fail('設定無法讀取');}
    if(row.key==='theme')check(['basic','cat','dog'].includes(row.value),'主題不正確');
    if(row.key==='events')for(const kind of ['chance','fate'])check(Array.isArray(value[kind])&&value[kind].length>0&&value[kind].length<=100&&value[kind].every(s=>string(s,500)&&s.trim()),'機會與命運設定不正確');
    if(row.key==='disabledSounds')check(Array.isArray(value)&&value.length<=10000&&value.every(s=>typeof s==='string'&&/^\d{1,12}$/.test(s)),'音效勾選不正確');
    if(row.key==='soundCatalog')check(value&&Array.isArray(value.items)&&value.items.length<=10000&&value.items.every(s=>validSound(s)&&(!s.sourceUrl||s.sourceUrl==='https://memes.tw/sound/'+s.id)),'音效清單含不支援的網址');
    data.settings.push({key:row.key,value:row.value});
  }
  check(keys.has('events'),'缺少機會與命運設定');
  return data;
}
export async function applyBackup(db,data){
  // Caller holds the application transaction; any failure rolls the entire operation back.
  for(const table of ['avatars','links','draws','lesson_aliases','lessons','students','classes'])await db.run(`DELETE FROM ${table}`);
  for(const table of ['classes','students','lessons','draws','links','avatars','lesson_aliases']){
    const fields=columns[table];for(const row of data[table])await db.run(`INSERT INTO ${table}(${fields.join(',')}) VALUES(${fields.map(()=>'?').join(',')})`,...fields.map(f=>table==='avatars'&&f==='bytes'?Buffer.from(row[f],'base64'):row[f]));
  }
  for(const key of settingsKeys)await db.run('DELETE FROM settings WHERE key=?',key);
  for(const row of data.settings)await db.run('INSERT INTO settings(key,value) VALUES(?,?)',row.key,row.value);
}

export function backupDifferences(current,incoming){
  const labels={classes:'班別及抽籤／主題設定',students:'學生名單',draws:'抽籤紀錄',avatars:'頭像',links:'學生連結',settings:'全站設定'};
  const names=data=>new Map(data.classes.map(c=>[c.id,c.name]));const beforeClasses=names(current),afterClasses=names(incoming);
  function description(key,row,classNames){if(!row)return '（沒有這筆資料）';if(key==='classes')return `${row.name} · ${row.archived?'封存':'在用'} · ${row.draw_mode==='equal'?'等機率':'骰子'} · ${row.theme||'沿用預設'}`;if(key==='students')return `${classNames.get(row.class_id)||row.class_id} · ${[row.school_class,row.student_no||row.number,row.name].filter(Boolean).join(' ')} · ${row.active?'在用':'停用'}`;if(key==='draws')return `${row.created} · ${row.student_name||row.event_text||row.kind} · ${row.voided?'不計入':'計入統計'}`;if(key==='avatars')return `${row.student_id} · ${row.status} · 圖片 ${createHash('sha256').update(row.bytes).digest('hex').slice(0,8)} · ${row.created}`;if(key==='links')return `${row.student_id} · 有效至 ${new Date(Number(row.expires)).toISOString()}`;if(key==='settings'){if(row.key==='theme')return '預設主題：'+row.value;const value=JSON.parse(row.value);if(row.key==='events')return ['chance','fate'].map(k=>(k==='chance'?'機會':'命運')+value[k].length+' 項：'+value[k].slice(0,3).map(s=>s.slice(0,60)).join('；')).join(' ／ ');if(row.key==='disabledSounds')return '未選用音效 '+value.length+' 項';return '音效清單 '+value.items.length+' 項';}return row.key;}
  return Object.entries(labels).map(([key,label])=>{
    const identity=key==='settings'?'key':key==='links'?'student_id':'id',old=new Map(current[key].map(r=>[r[identity],r])),next=new Map(incoming[key].map(r=>[r[identity],r]));let added=0,removed=0,changed=0;const examples=[];
    for(const id of new Set([...old.keys(),...next.keys()])){const before=old.get(id),after=next.get(id);if(!before)added++;else if(!after)removed++;else if(JSON.stringify(before)!==JSON.stringify(after))changed++;else continue;if(examples.length<20)examples.push({before:description(key,before,beforeClasses),after:description(key,after,afterClasses)});}
    return {key,label,added,removed,changed,examples};
  });
}
