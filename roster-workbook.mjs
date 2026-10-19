import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import {createHash,randomUUID} from 'node:crypto';
import {studentKey,studentDisplay} from './student-identity.js';
const fail = message => {throw Object.assign(new Error(message),{status:400});};
const LIMIT = 5000;
const key = (group,schoolClass,number)=>JSON.stringify([group,studentKey(schoolClass,number)]);

async function checkZip(bytes) {
  if (!bytes.length || bytes.length > 5*1024*1024) fail('Excel 檔案須小於 5 MB');
  await new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
    if(error)return reject(Object.assign(new Error('無法讀取 Excel，請上載 .xlsx 檔案'),{status:400}));
    let total=0,actualTotal=0,count=0,finished=false;
    const stop=message=>{if(finished)return;finished=true;zip.close();reject(Object.assign(new Error(message),{status:400}));};
    zip.on('error',()=>stop('Excel 檔案損壞'));
    zip.on('entry',entry=>{
      total+=entry.uncompressedSize;count++;
      if(total>30*1024*1024 || count>2000 || (entry.generalPurposeBitFlag&1))return stop('Excel 內容太大或已加密，請移除圖片、密碼及多餘格式後重試');
      zip.openReadStream(entry,(error,stream)=>{
        if(error)return stop('Excel 檔案內容損壞');
        stream.on('data',chunk=>{actualTotal+=chunk.length;if(actualTotal>30*1024*1024){stream.destroy();stop('Excel 解壓後內容太大，請移除圖片和多餘格式');}});
        stream.on('error',()=>stop('Excel 檔案內容損壞'));
        stream.on('end',()=>{if(!finished)zip.readEntry();});
      });
    });
    zip.on('end',()=>{if(!finished){finished=true;resolve();}});zip.readEntry();
  }));
}
function cellValue(cell) {
  if(cell.type===ExcelJS.ValueType.Formula || cell.type===ExcelJS.ValueType.Error)fail('請把公式轉為文字或數值後再匯入');
  const value=cell.value;
  if(value===null || value===undefined)return '';
  if(typeof value==='string' || typeof value==='number')return String(value).trim();
  if(value?.richText)return value.richText.map(part=>part.text).join('').trim();
  fail('欄位只能使用文字或數值');
}
export async function readRosterWorkbook(bytes) {
  await checkZip(bytes);
  const workbook=new ExcelJS.Workbook();
  try {await workbook.xlsx.load(bytes,{ignoreNodes:['drawing','picture','extLst','conditionalFormatting','dataValidations']});}
  catch {fail('Excel 檔案損壞或格式不支援，請另存為 .xlsx 後重試');}
  const rows=[],errors=[];let matched=0;
  for(const sheet of workbook.worksheets.filter(s=>s.state==='visible' || !s.state)) {
    const columns=new Map();
    sheet.getRow(1).eachCell((cell,col)=>{
      const raw=cell.text.trim(), upper=raw.toUpperCase();
      const name=['NUMBER','NO.'].includes(upper)?'NO':upper;
      if(columns.has(name) && ['GROUP','CLASS','NO','中文姓名','_STUDENT_ID'].includes(name))errors.push(`${sheet.name}：標題 ${raw} 重複`);
      columns.set(name,col);
    });
    if(!['GROUP','CLASS','NO','中文姓名'].every(name=>columns.has(name)))continue;
    matched++;
    if(sheet.actualRowCount>LIMIT+1 || sheet.rowCount>LIMIT+100)fail(`每個檔案最多 ${LIMIT} 位學生，請移除末尾多餘空白列`);
    for(let n=2;n<=sheet.rowCount;n++) {
      const row=sheet.getRow(n);
      try {
        const values=Object.fromEntries(['GROUP','CLASS','NO','中文姓名','_STUDENT_ID'].map(name=>[name,columns.has(name)?cellValue(row.getCell(columns.get(name))):'']));
        if(!['GROUP','CLASS','NO','中文姓名'].some(name=>values[name]))continue;
        const group=values.GROUP,schoolClass=values.CLASS.toUpperCase(),name=values['中文姓名'],studentId=values._STUDENT_ID;
        if([group,schoolClass,name].some(s=>/[\u0000-\u001f\u007f]/.test(s)))fail('欄位不可包含換行或控制字元');
        if(!group || group.length>60)fail('GROUP 須有 1–60 字');
        if(schoolClass.length>20 || (!schoolClass && !studentId))fail('CLASS 不可空白，最多 20 字（系統匯出既有學生除外）');
        if(!name || name.length>100)fail('中文姓名須有 1–100 字');
        let number=values.NO;
        if(schoolClass || !studentId) {
          if(!/^\d+(?:\.0+)?$/.test(number) || Number(number)<1 || Number(number)>9999)fail('NO 須為 1–9999 的整數');
          number=String(Number(number));
        } else if(!number || number.length>20)fail('NO 不可空白，最多 20 字');
        if(studentId && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(studentId))fail('學生識別資料不正確，請重新匯出檔案');
        rows.push({group,school_class:schoolClass,number,name,studentId:studentId||null,sheet:sheet.name,row:n});
      } catch(error){errors.push(`${sheet.name} 第 ${n} 行：${error.message}`);}
      if(rows.length>LIMIT)fail(`每個檔案最多 ${LIMIT} 位學生`);
    }
  }
  if(!matched)fail('找不到標題列，請使用 GROUP、CLASS、NO、中文姓名 四個欄位');
  if(!rows.length && !errors.length)fail('檔案沒有學生資料');
  const seen=new Map(),ids=new Map();
  for(const row of rows) {
    const k=key(row.group,row.school_class,row.number),previous=seen.get(k);
    if(previous)errors.push(`${row.sheet} 第 ${row.row} 行：與第 ${previous.row} 行的 GROUP／CLASS／NO 重複`);
    if(row.studentId && ids.has(row.studentId))errors.push(`${row.sheet} 第 ${row.row} 行：同一位學生出現多次`);
    seen.set(k,row);if(row.studentId)ids.set(row.studentId,row);
  }
  return {rows,errors};
}
export function rosterFingerprint(classes,students) {
  return createHash('sha256').update(JSON.stringify({classes:[...classes].sort((a,b)=>a.id.localeCompare(b.id)),students:[...students].sort((a,b)=>a.id.localeCompare(b.id))})).digest('hex');
}
export function planRosterImport(rows,classes,students,mode='merge',sourceErrors=[]) {
  if(!['merge','replace'].includes(mode))fail('匯入方式不正確');
  const errors=[...sourceErrors],byId=new Map(students.map(s=>[s.id,s])),byClassId=new Map(classes.map(c=>[c.id,c]));
  const natural=new Map(students.map(s=>[key(byClassId.get(s.class_id)?.name,s.school_class,s.student_no||s.number),s]));
  const groups=new Map();
  for(const row of rows)if(!groups.has(row.group)) {
    const current=classes.find(c=>c.name===row.group);
    groups.set(row.group,{id:current?.id||randomUUID(),name:row.group,action:!current?'create':current.archived?'reactivate':'keep'});
  }
  const changes=[],targetIds=new Set();
  for(const row of rows) {
    const existing=row.studentId?byId.get(row.studentId):natural.get(key(row.group,row.school_class,row.number));
    if(row.studentId && !existing){errors.push(`${row.sheet} 第 ${row.row} 行：找不到原有學生，請重新匯出`);continue;}
    const group=groups.get(row.group);
    const after={id:existing?.id||randomUUID(),class_id:group.id,name:row.name,number:studentKey(row.school_class,row.number),school_class:row.school_class,student_no:row.number,active:1};
    if(targetIds.has(after.id))errors.push(`${row.sheet} 第 ${row.row} 行：同一位學生被配對多次，請保留匯出檔案的識別資料`);
    targetIds.add(after.id);
    const changed=existing && ['class_id','name','number','school_class','student_no','active'].some(k=>(existing[k]??'')!==after[k]);
    changes.push({action:!existing?'add':changed?'update':'unchanged',row:row.row,sheet:row.sheet,group:row.group,before:existing?{...existing,group:byClassId.get(existing.class_id)?.name}:null,after});
  }
  const removed=mode==='replace'?students.filter(s=>s.active && [...groups.values()].some(g=>g.id===s.class_id) && !targetIds.has(s.id)):[];
  const finalStudents=students.filter(s=>!targetIds.has(s.id)).map(s=>removed.some(r=>r.id===s.id)?{...s,active:0}:s).concat(changes.map(c=>c.after));
  const slots=new Map(),groupCounts=new Map();
  // Inactive students retain their identity. A duplicate seat cannot silently overwrite one.
  for(const s of finalStudents) {
    const k=JSON.stringify([s.class_id,s.number]);
    if(slots.has(k))errors.push(`學號衝突：${studentDisplay(s)} 的 CLASS／NO 已被另一位學生使用`);
    slots.set(k,s.id);
    if(s.active)groupCounts.set(s.class_id,(groupCounts.get(s.class_id)||0)+1);
  }
  for(const g of groups.values())if((groupCounts.get(g.id)||0)>100)errors.push(`${g.name} 匯入後超過每班 100 人，請按 GROUP 分組`);
  return {mode,groups:[...groups.values()],changes,removed,errors,summary:{rows:rows.length,newGroups:[...groups.values()].filter(g=>g.action==='create').length,reactivatedGroups:[...groups.values()].filter(g=>g.action==='reactivate').length,added:changes.filter(c=>c.action==='add').length,updated:changes.filter(c=>c.action==='update').length,unchanged:changes.filter(c=>c.action==='unchanged').length,removed:removed.length}};
}
export async function writeRosterWorkbook(students=[]) {
  const workbook=new ExcelJS.Workbook();
  workbook.creator='大富翁抽籤';const sheet=workbook.addWorksheet('學生名單',{views:[{state:'frozen',ySplit:1}]});
  sheet.columns=[{header:'GROUP',key:'group',width:20},{header:'CLASS',key:'school_class',width:14},{header:'NO',key:'student_no',width:12},{header:'中文姓名',key:'name',width:24},{header:'_STUDENT_ID',key:'id',width:40,hidden:true}];
  for(const s of students)sheet.addRow({group:s.group,school_class:s.school_class||'',student_no:s.student_no||s.number,name:s.name,id:s.id});
  sheet.autoFilter={from:'A1',to:`E${Math.max(1,sheet.rowCount)}`};
  sheet.getRow(1).font={name:'Microsoft JhengHei',bold:true,color:{argb:'FFFFFFFF'}};
  sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF285D43'}};sheet.getRow(1).height=26;
  for(let i=2;i<=sheet.rowCount;i++){sheet.getRow(i).font={name:'Microsoft JhengHei',size:12};sheet.getRow(i).height=24;sheet.getRow(i).alignment={vertical:'middle'};if(i%2===0)sheet.getRow(i).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF0F5EC'}};}
  // These are identifiers: store them as text and never create executable formulas.
  for(const c of ['A','B','C','D','E'])sheet.getColumn(c).numFmt='@';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
