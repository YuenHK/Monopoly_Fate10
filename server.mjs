import http from 'node:http';
import { openDatabase } from './database.mjs';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, createReadStream } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { backupSnapshot, packBackup, unpackBackup, validateBackup, applyBackup, snapshotDigest, backupSummary, backupDifferences } from './backup.mjs';
import { createBoard, sameRoster, nextDraw } from './game.mjs';
import { periodRange, countTimeline } from './statistics.mjs';
import { publicStudent, studentKey, studentDisplay } from './student-identity.js';
import { nextSoundSync, DEFAULT_SOUND_INTERVAL, DEFAULT_SOUND_RETRY } from './sound-sync.mjs';
import { fetchSoundCatalog, validSound } from './sound-library.mjs';
import { mergeClassRecords } from './class-records.mjs';
import { THEMES, themeById, THEME_MEDIA } from './themes.js';
import { readRosterWorkbook, writeRosterWorkbook, planRosterImport, rosterFingerprint } from './roster-workbook.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const id = () => randomUUID();
const now = () => new Date().toISOString();
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (value, max = 120) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `請輸入 1–${max} 字的內容`);
  return value.trim();
};
const defaultEvents = {
  chance: ['下一位抽到的同學，可在今堂隨意移動座位', '下一位抽到的同學，可重抽一次', '下一位抽到的同學，可點播一首歌'],
  fate: ['下一位抽到的同學，需使用英文作答', '下一位抽到的同學，需邊跳舞邊回答', '下一位抽到的同學，需模仿帶貨直播主的語氣回答', '下一位抽到的同學，需用唱歌的方式把答案唱出來']
};

export async function createApplication(options = {}) {
  if (process.env.RENDER && !process.env.DATABASE_URL && !options.database) throw new Error('Render 必須設定 DATABASE_URL（Neon）；不會使用暫存 SQLite');
  const dataDir = resolve(options.dataDir || process.env.DATA_DIR || resolve(ROOT, 'data'));
  const db = options.database || await openDatabase({ dataDir, databaseUrl: options.databaseUrl ?? process.env.DATABASE_URL });
  (await db.exec(`
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS logins(token TEXT PRIMARY KEY,expires BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS classes(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,archived INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS students(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classes(id),name TEXT NOT NULL,number TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,UNIQUE(class_id,number));
    CREATE TABLE IF NOT EXISTS lessons(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classes(id),name TEXT NOT NULL,created TEXT NOT NULL,closed INTEGER NOT NULL DEFAULT 0,must_student INTEGER NOT NULL DEFAULT 0,board TEXT);
    CREATE TABLE IF NOT EXISTS draws(id TEXT PRIMARY KEY,lesson_id TEXT NOT NULL REFERENCES lessons(id),kind TEXT NOT NULL,student_id TEXT REFERENCES students(id),student_name TEXT,student_number TEXT,event_text TEXT,created TEXT NOT NULL,request_id TEXT NOT NULL,animation TEXT,UNIQUE(lesson_id,request_id));
    CREATE TABLE IF NOT EXISTS links(student_id TEXT PRIMARY KEY REFERENCES students(id),token TEXT NOT NULL UNIQUE,expires BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS avatars(id TEXT PRIMARY KEY,student_id TEXT NOT NULL REFERENCES students(id),mime TEXT NOT NULL,bytes ${db.postgres ? "BYTEA" : "BLOB"} NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS draws_lesson ON draws(lesson_id);
    CREATE INDEX IF NOT EXISTS draws_student_created ON draws(student_id,created);
    CREATE INDEX IF NOT EXISTS lessons_class ON lessons(class_id);
    CREATE INDEX IF NOT EXISTS avatars_student ON avatars(student_id,status);
  `));
  const studentColumns = db.postgres
    ? (await db.all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='students'")).map(c=>c.name)
    : (await db.all('PRAGMA table_info(students)')).map(c=>c.name);
  for (const column of ['school_class','student_no']) if (!studentColumns.includes(column)) await db.exec(`ALTER TABLE students ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
  await db.run("UPDATE students SET student_no=number WHERE student_no=''");
  async function addColumns(table,definitions){
    const columns=db.postgres?(await db.all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=?",table)).map(c=>c.name):(await db.all(`PRAGMA table_info(${table})`)).map(c=>c.name);
    for(const [column,type] of definitions)if(!columns.includes(column))await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  await addColumns('classes',[['draw_mode',"TEXT NOT NULL DEFAULT 'dice'"],['theme','TEXT']]);
  await addColumns('draws',[['voided','INTEGER NOT NULL DEFAULT 0'],['void_reason',"TEXT NOT NULL DEFAULT ''"],['voided_at','TEXT']]);

  const get = (...args) => db.get(...args);
  const all = (...args) => db.all(...args);
  const run = (...args) => db.run(...args);
  const setting = async key => (await get('SELECT value FROM settings WHERE key=?', key))?.value;
  const put = async (key, value) => (await run('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value));
  if (!(await setting('events'))) (await put('events', JSON.stringify(defaultEvents)));
  if (!(await setting('legacyImported'))) {
    const names = JSON.parse(readFileSync(resolve(ROOT, 'legacy-roster.json'), 'utf8'));
    const classId = id();
    await db.exec('BEGIN IMMEDIATE');
    try {
      await run('INSERT INTO classes(id,name) VALUES(?,?)', classId, '原有班別');
      for (let i=0;i<names.length;i++) await run('INSERT INTO students(id,class_id,name,number) VALUES(?,?,?,?)', id(), classId, names[i], String(i+1));
      await put('legacyImported', '1');
      await db.exec('COMMIT');
    } catch(e) { await db.exec('ROLLBACK'); throw e; }
  }
  await mergeClassRecords(db);
  const setupCode = options.setupCode || secret();
  const rates = new Map();
  const importPreviews = new Map();
  const backupPreviews = new Map();
  let dataGeneration=0;
  const secure = options.secureCookies ?? process.env.COOKIE_SECURE === 'true';
  const appOrigin = options.origin || process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL;
  const publicAppOrigin = options.publicOrigin || process.env.PUBLIC_APP_ORIGIN;
  async function transaction(fn) {
    (await db.exec('BEGIN IMMEDIATE'));
    try { const value = await fn(); (await db.exec('COMMIT')); return value; }
    catch (error) { (await db.exec('ROLLBACK')); throw error; }
  }
  function limit(key, max, ms) {
    const time = Date.now();
    if (rates.size > 5000) for (const [k,v] of rates) if (v.end < time) rates.delete(k);
    const entry = rates.get(key);
    if (!entry || entry.end < time) { rates.set(key, { count: 1, end: time + ms }); return; }
    if (++entry.count > max) fail(429, '操作太頻密，請稍後再試');
  }
  async function auth(req) {
    const token = /(?:^|;\s*)monopoly_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    if (!token || !(await get('SELECT token FROM logins WHERE token=? AND expires>?', hash(token), Date.now()))) fail(401, '請先登入教師後台');
  }
  const seedSounds=JSON.parse(readFileSync(resolve(ROOT,'sound-catalog.json'),'utf8'));
  let soundRefresh=null,soundTimer=null,closing=false;
  const autoSoundSync=Boolean(options.autoSoundSync);
  const soundTiming={intervalMs:options.soundSyncIntervalMs??DEFAULT_SOUND_INTERVAL,retryMs:options.soundSyncRetryMs??DEFAULT_SOUND_RETRY};
  async function armSoundSync(){
    if(!autoSoundSync||closing)return;
    if(soundTimer)clearTimeout(soundTimer);
    const attempt=await schedule(async()=>JSON.parse(await setting('soundAttempt')||'null'));
    if(closing)return;
    soundTimer=setTimeout(()=>{soundTimer=null;startSoundRefresh();},Math.max(0,nextSoundSync(attempt,soundTiming)-Date.now()));
    soundTimer.unref();
  }
  async function soundState(){
    const catalog=JSON.parse(await setting('soundCatalog')||'null')||{...seedSounds,updatedAt:seedSounds.capturedAt};
    const disabled=new Set(JSON.parse(await setting('disabledSounds')||'[]'));
    const attempt=JSON.parse(await setting('soundAttempt')||'null');
    return {...catalog,items:catalog.items.filter(validSound).map(s=>({...s,enabled:!disabled.has(s.id)})),attempt,refreshing:Boolean(soundRefresh),autoSync:{enabled:autoSoundSync,intervalHours:soundTiming.intervalMs/3600000,nextAt:autoSoundSync&&!soundRefresh?new Date(nextSoundSync(attempt,soundTiming)).toISOString():null}};
  }
  function schedule(work){const next=queue.then(work);queue=next.catch(()=>{});return next;}
  function startSoundRefresh(){
    if(soundRefresh||closing)return;
    if(soundTimer){clearTimeout(soundTimer);soundTimer=null;}
    // Fetch outside the DB request queue: a slow source must not block drawing/login.
    soundRefresh=(async()=>{
      const startedAt=now(),generation=dataGeneration;
      try{
        const catalog=await fetchSoundCatalog(options.soundFetcher||fetch);
        await schedule(async()=>{if(generation!==dataGeneration)return;await transaction(async()=>{await put('soundCatalog',JSON.stringify(catalog));await put('soundAttempt',JSON.stringify({at:startedAt,finishedAt:now(),ok:true,failures:0}));});});
      }catch(error){
        const message=error.message.includes('Cloudflare')||error.message.includes('來源')?error.message:'來源連線逾時或暫時中斷；保留上次清單及勾選';
        await schedule(async()=>{if(generation!==dataGeneration)return;const previous=JSON.parse(await setting('soundAttempt')||'null');await put('soundAttempt',JSON.stringify({at:startedAt,finishedAt:now(),ok:false,error:message,failures:(previous?.ok===false?Number(previous.failures)||1:0)+1}));});
      }
    })().finally(()=>{soundRefresh=null;return armSoundSync();});
  }
  async function studentLink(token) {
    const link = (await get(`SELECT s.*,c.name AS class_name FROM links l JOIN students s ON s.id=l.student_id JOIN classes c ON c.id=s.class_id WHERE l.token=? AND l.expires>? AND s.active=1 AND c.archived=0`, hash(text(token, 100)), Date.now()));
    if (!link) fail(404, '連結已失效或過期，請向老師索取新連結');
    return link;
  }
  async function classRow(classId) {
    const row = (await get('SELECT * FROM classes WHERE id=? AND archived=0', classId));
    if (!row) fail(404, '找不到班別');
    return row;
  }
  async function roster(classId) {
    return (await all(`SELECT s.id,s.name,s.number,s.school_class,s.student_no,(SELECT id FROM avatars WHERE student_id=s.id AND status='approved' ORDER BY created DESC LIMIT 1) AS avatar_id FROM students s WHERE class_id=? AND active=1 ORDER BY school_class,length(COALESCE(NULLIF(student_no,''),number)),COALESCE(NULLIF(student_no,''),number),name`, classId)).map(publicStudent);
  }
  async function lessonRow(lessonId) {
    const row = (await get('SELECT * FROM lessons WHERE id=?', lessonId)) || (await get('SELECT l.* FROM lessons l JOIN lesson_aliases a ON a.class_id=l.class_id WHERE a.id=?',lessonId));
    if (!row) fail(404, '找不到課堂');
    return row;
  }
  async function classRecord(classId) {
    await classRow(classId);
    let row=await get('SELECT * FROM lessons WHERE class_id=?',classId);
    if(!row){const recordId=id();await run('INSERT INTO lessons(id,class_id,name,created) VALUES(?,?,?,?)',recordId,classId,'班別累積記錄',now());row=await lessonRow(recordId);}
    if(row.closed){await run('UPDATE lessons SET closed=0 WHERE id=?',row.id);row.closed=0;}
    return row;
  }
  async function drawRecord(recordId,b) {
    const rawRequestId=text(b.requestId,100);
    return transaction(async()=>{
      const l=await lessonRow(recordId);
      const requestId=recordId===l.id?rawRequestId:recordId+'/'+rawRequestId;
      const existing=await get('SELECT * FROM draws WHERE lesson_id=? AND request_id=?',l.id,requestId);
      if(existing)return {...await result(existing),...JSON.parse(existing.animation||'{}')};
      if(l.closed)fail(409,'這個班別記錄已暫停，請重新選班');
      await classRow(l.class_id);
      const students=await roster(l.class_id);if(!students.length)fail(400,'班別沒有學生');
      if(!['dice','quick'].includes(b.mode))fail(400,'抽籤模式不正確');
      const c=await classRow(l.class_id);
      const board=await boardFor(l,students),move=nextDraw(board,l.must_student,b.mode,c.draw_mode);
      let kind=move.cell.type,student=null,eventText=null;
      if(kind==='student')student=students.find(s=>s.id===move.cell.studentId);
      else {const pool=JSON.parse(await setting('events'))[kind];eventText=pool[randomInt(pool.length)];}
      board.currentIndex=move.targetIndex;const drawId=id();
      await run('INSERT INTO draws(id,lesson_id,kind,student_id,student_name,student_number,event_text,created,request_id,animation) VALUES(?,?,?,?,?,?,?,?,?,?)',drawId,l.id,kind,student?.id||null,student?.display_id||student?.name||null,student?.number||null,eventText,now(),requestId,JSON.stringify({move,board,students}));
      await run('UPDATE lessons SET must_student=?,board=? WHERE id=?',Number(kind!=='student'),JSON.stringify(board),l.id);
      return {...await result(await get('SELECT * FROM draws WHERE id=?',drawId)),move,board,students};
    });
  }
  async function importState() {
    const classes=await all('SELECT id,name,archived FROM classes ORDER BY id');
    const students=(await all('SELECT id,class_id,name,number,active,school_class,student_no FROM students ORDER BY id')).map(s=>({...s,student_no:s.student_no||s.number}));
    return {classes,students};
  }
  async function boardFor(lesson, students) {
    let board = lesson.board ? JSON.parse(lesson.board) : null;
    if (!sameRoster(board, students)) {
      board = createBoard(students);
      await run('UPDATE lessons SET board=? WHERE id=?', JSON.stringify(board), lesson.id);
    }
    return board;
  }
  async function body(req, max = 100000) {
    if (!String(req.headers['content-type']).startsWith('application/json')) fail(415, '請使用 JSON 格式');
    let length = 0;
    const chunks = [];
    for await (const chunk of req) { length += chunk.length; if (length > max) fail(413, '檔案或資料太大'); chunks.push(chunk); }
    try { const data = JSON.parse(Buffer.concat(chunks).toString()); if (!data || Array.isArray(data) || typeof data !== 'object') fail(400, '資料格式不正確'); return data; }
    catch { fail(400, '資料格式不正確'); }
  }
  function json(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data));
  }
  async function result(row) {
    return { ...row, avatar_id: row.student_id ? (await get("SELECT id FROM avatars WHERE student_id=? AND status='approved'", row.student_id))?.id || null : null };
  }
  const handle = async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' https://memeprod.sgp1.digitaloceanspaces.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = decodeURIComponent(url.pathname);
      if(path==='/theme-preview.html'){res.setHeader('X-Frame-Options','SAMEORIGIN');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'none'");}
      const method = req.method;
      const publicPlay = path.startsWith('/api/play/');
      const allowedPlayOrigin = req.headers.origin && [appOrigin, publicAppOrigin].filter(Boolean).includes(req.headers.origin);
      if (publicPlay && req.headers.origin) {
        const sameOrigin = req.headers.origin === (appOrigin || `${secure ? 'https' : 'http'}://${req.headers.host}`);
        if (!sameOrigin && !allowedPlayOrigin) fail(403, '不接受來自其他網站的操作');
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
        res.setHeader('Vary', 'Origin');
        if (method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          res.writeHead(204); return res.end();
        }
      }
      if (!['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(method)) fail(405, '不支援的操作');
      if (!['GET', 'HEAD'].includes(method)) {
        if (req.headers.origin) {
          const expected = appOrigin || `${secure ? 'https' : 'http'}://${req.headers.host}`;
          if (req.headers.origin !== expected && !(publicPlay && allowedPlayOrigin)) fail(403, '不接受來自其他網站的操作');
        }
        if (req.headers['sec-fetch-site'] === 'cross-site' && !(publicPlay && allowedPlayOrigin)) fail(403, '不接受跨網站操作');
      }
      if (path === '/healthz' && method === 'GET') return json(res, { ok: true });
      if (path === '/api/status' && method === 'GET') return json(res, { setupRequired: !(await setting('password')) });
      if (path === '/api/setup' && method === 'POST') {
        limit('setup:' + req.socket.remoteAddress, 10, 15 * 60e3);
        if ((await setting('password'))) fail(409, '已完成初始化');
        const b = await body(req);
        if (hash(String(b.code)) !== hash(setupCode)) fail(403, '初始化代碼不正確，請查看伺服器終端');
        const password = text(b.password, 200);
        if (password.length < 12) fail(400, '密碼至少需要 12 個字元');
        const salt = secret();
        (await transaction(async () => { (await put('salt', salt)); (await put('password', scryptSync(password, salt, 64).toString('hex'))); }));
        return json(res, { ok: true });
      }
      if (path === '/api/login' && method === 'POST') {
        limit('login:' + req.socket.remoteAddress, 10, 15 * 60e3);
        const b = await body(req);
        if (!(await setting('password'))) fail(409, '請先初始化');
        const check = scryptSync(text(b.password, 200), (await setting('salt')), 64);
        if (!timingSafeEqual(check, Buffer.from((await setting('password')), 'hex'))) fail(401, '密碼不正確');
        const token = secret();
        (await run('DELETE FROM logins WHERE expires<?', Date.now()));
        (await run('INSERT INTO logins VALUES(?,?)', hash(token), Date.now() + 12 * 3600e3));
        res.setHeader('Set-Cookie', `monopoly_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure ? '; Secure' : ''}`);
        return json(res, { ok: true });
      }
      if (path === '/api/student' && method === 'POST') {
        limit('lookup:' + req.socket.remoteAddress, 90, 60e3);
        const b = await body(req);
        const s = (await studentLink(b.token));
        return json(res, { name: s.name, number: s.student_no || s.number, display_id: studentDisplay(s), className: s.class_name, avatars: (await all('SELECT id,status,created FROM avatars WHERE student_id=? ORDER BY created DESC', s.id)) });
      }
      if (path === '/api/student/avatar' && method === 'POST') {
        limit('upload-ip:' + req.socket.remoteAddress, 60, 3600e3);
        const b = await body(req, 7100000);
        const s = (await studentLink(b.token));
        limit('upload-student:' + s.id, 12, 3600e3);
        if (typeof b.base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(b.base64) || b.base64.length % 4) fail(400, '圖片資料不正確');
        const bytes = Buffer.from(b.base64, 'base64');
        if (!bytes.length || bytes.length > 5 * 1024 * 1024) fail(413, '頭像上限為 5 MB');
        const signature = bytes.subarray(0, 12);
        const supportedSignature = signature.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
          || signature.subarray(0,3).equals(Buffer.from([255,216,255]))
          || ['GIF87a','GIF89a'].includes(signature.subarray(0,6).toString('ascii'))
          || (signature.subarray(0,4).toString('ascii') === 'RIFF' && signature.subarray(8,12).toString('ascii') === 'WEBP');
        if (!supportedSignature) fail(400, '只接受 GIF、PNG、JPEG 或 WebP 圖片');
        let meta;
        try { meta = await sharp(bytes, { animated: true, limitInputPixels: 25000000 }).metadata(); }
        catch { fail(400, '無法讀取圖片，請使用有效的 GIF、PNG、JPEG 或 WebP'); }
        const mimes = { gif: 'image/gif', png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
        if (!mimes[meta.format] || !meta.width || !meta.height || meta.width > 4096 || (meta.pageHeight || meta.height) > 4096 || meta.width * meta.height > 25000000 || (meta.pages || 1) > 300) fail(400, '圖片須為 GIF、PNG、JPEG 或 WebP；每幀最多 4096 × 4096，最多 300 幀');
        // Verify decoded pixels, but store the original bytes to preserve GIF animation.
        try { await sharp(bytes, { animated: true, limitInputPixels: 25000000 }).stats(); }
        catch { fail(400, '圖片內容損壞，請重新選擇'); }
        (await studentLink(b.token)); // Recheck after asynchronous decoding: teacher may have revoked the link.
        const avatarId = id();
        (await transaction(async () => { (await run("DELETE FROM avatars WHERE student_id=? AND status='pending'", s.id)); (await run('INSERT INTO avatars VALUES(?,?,?,?,?,?)', avatarId, s.id, mimes[meta.format], bytes, 'pending', now())); }));
        return json(res, { ok: true, id: avatarId, status: 'pending' }, 201);
      }
      if (publicPlay) {
        if (!(await setting('password'))) fail(503, '教師尚未完成網站設定');
        let match;
        if(path==='/api/play/theme'&&method==='GET'){const classId=url.searchParams.get('classId'),c=classId?await classRow(classId):null;return json(res,{theme:themeById(c?.theme||await setting('theme')).id,...(c?{drawMode:c.draw_mode}:{})});}
        if (path === '/api/play/classes' && method === 'GET') return json(res, await all('SELECT c.id,c.name,(SELECT count(*) FROM students WHERE class_id=c.id AND active=1) AS student_count FROM classes c WHERE archived=0 ORDER BY name'));
        if (path === '/api/play/sounds' && method === 'GET') return json(res, {items:(await soundState()).items.filter(s=>s.enabled).map(({id,name,url})=>({id,name,url,enabled:true}))});
        if ((match = path.match(/^\/api\/play\/classes\/([^/]+)\/game$/)) && method === 'POST') {
          return json(res, await transaction(async()=>{
            const l=await classRecord(match[1]),students=await roster(l.class_id);
            if(!students.length)fail(400,'請先加入學生');
            return {id:l.id,class_id:l.class_id,class_name:(await classRow(l.class_id)).name,draw_mode:(await classRow(l.class_id)).draw_mode,theme:themeById((await classRow(l.class_id)).theme||await setting('theme')).id,closed:l.closed,must_student:l.must_student,students,board:await boardFor(l,students)};
          }));
        }
        if ((match = path.match(/^\/api\/play\/classes\/([^/]+)\/draw$/)) && method === 'POST') {
          limit('public-draw:'+match[1],120,60e3);
          const b=await body(req), l=await transaction(()=>classRecord(match[1]));
          return json(res, await drawRecord(l.id,b));
        }
        if ((match = path.match(/^\/api\/play\/lessons\/([^/]+)$/)) && method === 'GET') {
          const l=await lessonRow(match[1]);await classRow(l.class_id);return json(res,{class_id:l.class_id});
        }
        fail(404,'找不到這個操作');
      }
      if (path.startsWith('/api/')) {
        (await auth(req));
        function backupFile(data){const bytes=packBackup(data);res.writeHead(200,{'Content-Type':'application/gzip','Content-Disposition':'attachment; filename="Monopoly-backup-'+new Date().toISOString().slice(0,10)+'.json.gz"','Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes);}
        if(path==='/api/backup/summary'&&method==='GET'){const summary={};for(const table of ['classes','students','draws','avatars','links'])summary[table]=Number((await get(`SELECT count(*) AS n FROM ${table}`)).n);return json(res,summary);}
        if(path==='/api/backup/export'&&method==='GET')return backupFile(await transaction(()=>backupSnapshot(db)));
        if(path==='/api/backup/preview'&&method==='POST'){
          const b=await body(req,92*1024*1024),data=await validateBackup(unpackBackup(b.file));
          const current=await backupSnapshot(db),previewId=secret(),expires=Date.now()+10*60e3;
          backupPreviews.clear();backupPreviews.set(previewId,{data,fingerprint:snapshotDigest(current),expires,safetyDownloaded:false});
          setTimeout(()=>backupPreviews.delete(previewId),Math.max(0,expires-Date.now())).unref();
          return json(res,{previewId,expires,current:backupSummary(current),incoming:backupSummary(data),differences:backupDifferences(current,data)});
        }
        if(path.startsWith('/api/backup/safety/')&&method==='GET'){
          const preview=backupPreviews.get(path.slice('/api/backup/safety/'.length));if(!preview||preview.expires<Date.now())fail(409,'還原預覽已過期，請重新上載');
          const current=await backupSnapshot(db);if(snapshotDigest(current)!==preview.fingerprint)fail(409,'資料已更新，請重新預覽及備份');
          const bytes=packBackup(current);preview.safetyDownloaded=true;
          res.writeHead(200,{'Content-Type':'application/gzip','Content-Disposition':'attachment; filename="Monopoly-before-restore.json.gz"','Content-Length':bytes.length,'Cache-Control':'no-store'});return res.end(bytes);
        }
        if(path==='/api/backup/restore'&&method==='POST'){
          const b=await body(req),preview=backupPreviews.get(b.previewId);
          if(!preview||preview.expires<Date.now())fail(409,'還原預覽已過期，請重新上載');
          if(!preview.safetyDownloaded||b.backupSaved!==true||b.confirmation!=='取代全部資料')fail(400,'請先下載並保存現況備份，再輸入確認文字');
          await transaction(async()=>{if(snapshotDigest(await backupSnapshot(db))!==preview.fingerprint)fail(409,'資料已更新，請重新預覽及備份');await applyBackup(db,preview.data);});
          dataGeneration++;backupPreviews.clear();importPreviews.clear();return json(res,{ok:true,summary:backupSummary(preview.data)});
        }
        if(path==='/api/theme'){
          if(method==='GET')return json(res,{theme:themeById(await setting('theme')).id});
          if(method==='PUT'){
            const b=await body(req);
            if(!THEMES.some(theme=>theme.id===b.theme))fail(400,'請選擇基礎、貓或狗主題');
            await put('theme',b.theme);return json(res,{theme:b.theme});
          }
        }
        if (path === '/api/logout' && method === 'POST') {
          const token = /(?:^|;\s*)monopoly_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
          if (token) (await run('DELETE FROM logins WHERE token=?', hash(token)));
          res.setHeader('Set-Cookie', `monopoly_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`);
          return json(res, { ok: true });
        }
        if (path === '/api/password' && method === 'PUT') {
          const b = await body(req); const password = text(b.password, 200);
          if (password.length < 12) fail(400, '密碼至少需要 12 個字元');
          if (!timingSafeEqual(scryptSync(text(b.currentPassword, 200), await setting('salt'), 64), Buffer.from(await setting('password'), 'hex'))) fail(403, '目前密碼不正確');
          const salt = secret();
          await transaction(async () => { await put('salt', salt); await put('password', scryptSync(password, salt, 64).toString('hex')); await run('DELETE FROM logins'); });
          return json(res, { ok: true });
        }
        if (path === '/api/roster/export' && method === 'GET') {
          const classId=url.searchParams.get('classId');
          if (classId) await classRow(classId);
          const rows=url.searchParams.get('template')==='1'?[]:await all(`SELECT s.id,s.name,s.number,s.school_class,s.student_no,c.name AS "group" FROM students s JOIN classes c ON c.id=s.class_id WHERE s.active=1 AND c.archived=0${classId?' AND c.id=?':''} ORDER BY c.name,s.school_class,length(s.student_no),s.student_no`,...(classId?[classId]:[]));
          const bytes=await writeRosterWorkbook(rows);
          res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="Name List.xlsx"','Content-Length':bytes.length,'Cache-Control':'no-store'});return res.end(bytes);
        }
        if (path === '/api/roster/import/preview' && method === 'POST') {
          const b=await body(req,7100000);
          if(typeof b.base64!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(b.base64)||b.base64.length%4)fail(400,'檔案資料不正確');
          const parsed=await readRosterWorkbook(Buffer.from(b.base64,'base64'));
          const state=await importState();
          const plan=planRosterImport(parsed.rows,state.classes,state.students,b.mode||'merge',parsed.errors);
          for(const [key,value] of importPreviews)if(value.expires<Date.now())importPreviews.delete(key);
          while(importPreviews.size>=10)importPreviews.delete(importPreviews.keys().next().value);
          const previewId=secret(),expires=Date.now()+10*60e3;
          importPreviews.set(previewId,{plan,fingerprint:rosterFingerprint(state.classes,state.students),expires});
          return json(res,{...plan,previewId,expires});
        }
        if (path === '/api/roster/import/commit' && method === 'POST') {
          const b=await body(req),previewId=text(b.previewId,100),preview=importPreviews.get(previewId);
          if(!preview||preview.expires<Date.now())fail(409,'預覽已過期，請重新上載並預覽');
          if(preview.plan.errors.length)fail(400,'請先修正檔案錯誤，再重新上載');
          const summary=await transaction(async()=>{
            const state=await importState();
            if(rosterFingerprint(state.classes,state.students)!==preview.fingerprint)fail(409,'名單已被修改，請重新預覽，避免覆蓋新資料');
            const plan=preview.plan;
            for(const g of plan.groups) {
              if(g.action==='create')await run("INSERT INTO classes(id,name,draw_mode) VALUES(?,?,'equal')",g.id,g.name);
              else if(g.action==='reactivate')await run('UPDATE classes SET archived=0 WHERE id=?',g.id);
            }
            // Temporary keys allow legitimate number swaps without losing either identity.
            for(const c of plan.changes.filter(c=>c.action==='update'))await run('UPDATE students SET number=? WHERE id=?','__import__'+c.after.id,c.after.id);
            for(const c of plan.changes) {
              const a=c.after;
              if(c.action==='add')await run('INSERT INTO students(id,class_id,name,number,active,school_class,student_no) VALUES(?,?,?,?,?,?,?)',a.id,a.class_id,a.name,a.number,1,a.school_class,a.student_no);
              else if(c.action==='update')await run('UPDATE students SET class_id=?,name=?,number=?,active=1,school_class=?,student_no=? WHERE id=?',a.class_id,a.name,a.number,a.school_class,a.student_no,a.id);
            }
            for(const r of plan.removed){await run('UPDATE students SET active=0 WHERE id=?',r.id);await run('DELETE FROM links WHERE student_id=?',r.id);}
            return plan.summary;
          });
          importPreviews.delete(previewId);return json(res,{ok:true,summary});
        }
        if (path === '/api/classes' && method === 'GET') return json(res, (await all('SELECT c.*,(SELECT count(*) FROM students WHERE class_id=c.id AND active=1) AS student_count,(SELECT count(*) FROM draws d JOIN lessons l ON l.id=d.lesson_id WHERE l.class_id=c.id AND d.voided=0) AS draw_count FROM classes c WHERE (archived=0 OR ?=1) ORDER BY name', Number(url.searchParams.get('includeArchived') === '1'))));
        if (path === '/api/classes' && method === 'POST') {
          const b = await body(req); const classId = id();
          try { (await run("INSERT INTO classes(id,name,draw_mode) VALUES(?,?,'equal')", classId, text(b.name, 60))); }
          catch (e) { if ((e.code?.includes('SQLITE') || e.code === '23505')) fail(409, '班別名稱已存在'); throw e; }
          return json(res, { id: classId }, 201);
        }
        let preferencesMatch;
        if((preferencesMatch=path.match(/^\/api\/classes\/([^/]+)\/preferences$/))){
          const c=await classRow(preferencesMatch[1]);
          if(method==='GET')return json(res,{theme:c.theme,drawMode:c.draw_mode});
          if(method==='PUT'){
            const b=await body(req),theme=b.theme===undefined?c.theme:b.theme,drawMode=b.drawMode??c.draw_mode;
            if(theme!==null&&!THEMES.some(t=>t.id===theme))fail(400,'主題不正確');
            if(!['equal','dice'].includes(drawMode))fail(400,'抽籤模式不正確');
            await run('UPDATE classes SET theme=?,draw_mode=? WHERE id=?',theme,drawMode,c.id);return json(res,{theme,drawMode});
          }
        }
        let voidMatch;
        if((voidMatch=path.match(/^\/api\/draws\/([^/]+)\/void$/))&&method==='PUT'){
          const b=await body(req);if(typeof b.voided!=='boolean')fail(400,'請選擇是否計入統計');
          const row=await get('SELECT id FROM draws WHERE id=?',voidMatch[1]);if(!row)fail(404,'找不到紀錄');
          const reason=b.voided?text(b.reason,200):'';
          await run('UPDATE draws SET voided=?,void_reason=?,voided_at=? WHERE id=?',Number(b.voided),reason,b.voided?now():null,row.id);return json(res,{ok:true});
        }
        let match;
        if ((match = path.match(/^\/api\/classes\/([^/]+)$/))) {
          (await classRow(match[1]));
          if (method === 'PUT') { const b = await body(req); (await run('UPDATE classes SET name=? WHERE id=?', text(b.name, 60), match[1])); return json(res, { ok: true }); }
          if (method === 'DELETE') {
            (await transaction(async () => { (await run('UPDATE classes SET archived=1 WHERE id=?', match[1])); (await run('UPDATE lessons SET closed=1 WHERE class_id=?', match[1])); (await run('DELETE FROM links WHERE student_id IN (SELECT id FROM students WHERE class_id=?)', match[1])); }));
            return json(res, { ok: true });
          }
        }
        if ((match = path.match(/^\/api\/classes\/([^/]+)\/game$/)) && method === 'POST') {
          const game=await transaction(async()=>{
            const l=await classRecord(match[1]),students=await roster(l.class_id);
            if(!students.length)fail(400,'請先加入學生');
            return {...l,class_name:(await classRow(l.class_id)).name,draw_mode:(await classRow(l.class_id)).draw_mode,theme:themeById((await classRow(l.class_id)).theme||await setting('theme')).id,students,board:await boardFor(l,students)};
          });
          return json(res,game);
        }
        if ((match = path.match(/^\/api\/classes\/([^/]+)\/draw$/)) && method === 'POST') {
          const b=await body(req);const l=await transaction(()=>classRecord(match[1]));
          return json(res,await drawRecord(l.id,b));
        }
        if ((match = path.match(/^\/api\/classes\/([^/]+)\/stats$/)) && method === 'GET') {
          const c = await get('SELECT * FROM classes WHERE id=?', match[1]);
          if (!c) fail(404, '找不到班別');
          const range = periodRange(url.searchParams.get('period') || 'all', url.searchParams.get('date'));
          const condition = range.start ? ' AND d.created>=? AND d.created<?' : '';
          const dateArgs = range.start ? [range.start,range.end] : [];
          const students = await all(`SELECT s.id,s.name,s.number,s.school_class,s.student_no,CASE WHEN s.class_id=? AND s.active=1 THEN 1 ELSE 0 END AS active,count(d.id) AS count FROM students s
            LEFT JOIN draws d ON d.student_id=s.id AND d.kind='student' AND d.voided=0 AND d.lesson_id IN (SELECT id FROM lessons WHERE class_id=?)${condition}
            WHERE (s.class_id=? AND s.active=1) OR EXISTS(SELECT 1 FROM draws old JOIN lessons oldlesson ON oldlesson.id=old.lesson_id WHERE old.student_id=s.id AND oldlesson.class_id=?)
            GROUP BY s.id,s.name,s.number,s.school_class,s.student_no,s.class_id,s.active ORDER BY s.school_class,length(s.student_no),s.student_no`, c.id,c.id,...dateArgs,c.id,c.id);
          const draws = await all(`SELECT d.id,d.lesson_id,d.kind,d.student_id,d.student_name,d.student_number,d.event_text,d.created,d.voided,d.void_reason,d.voided_at,l.name AS lesson_name FROM draws d
            JOIN lessons l ON l.id=d.lesson_id WHERE l.class_id=?${condition} ORDER BY d.created DESC,d.id DESC`, c.id, ...dateArgs);
          const counted=draws.filter(d=>!d.voided),studentDraws=counted.filter(d=>d.kind==='student');
          return json(res, {class:c,range,students:students.map(publicStudent),draws,timeline:countTimeline(counted,range),summary:{studentDraws:studentDraws.length,uniqueStudents:new Set(studentDraws.map(d=>d.student_id)).size,eventDraws:counted.length-studentDraws.length,lessonCount:new Set(draws.map(d=>d.lesson_id)).size}});
        }
        if ((match = path.match(/^\/api\/classes\/([^/]+)\/students$/))) {
          (await classRow(match[1]));
          if (method === 'GET') return json(res, (await roster(match[1])));
          if (method === 'PUT') {
            const b = await body(req);
            if (!Array.isArray(b.students) || !b.students.length || b.students.length > 100) fail(400, '每班須有 1–100 位學生');
            const students = b.students.map(s => {const schoolClass=typeof s.school_class==='string'?s.school_class.trim().toUpperCase():'';if(schoolClass.length>20)fail(400,'CLASS 最多 20 字');let number=text(s.number,20);if(schoolClass){if(!/^\d+$/.test(number)||Number(number)<1||Number(number)>9999)fail(400,'NO 須為 1–9999 的整數');number=String(Number(number));}return {name:text(s.name,100),number:studentKey(schoolClass,number),school_class:schoolClass,student_no:number};});
            if (new Set(students.map(s => s.number)).size !== students.length) fail(400, '學號不可重複；同名學生請用不同學號');
            (await transaction(async () => {
              (await run('UPDATE students SET active=0 WHERE class_id=?', match[1]));
              for (const s of students) (await run('INSERT INTO students(id,class_id,name,number,school_class,student_no) VALUES(?,?,?,?,?,?) ON CONFLICT(class_id,number) DO UPDATE SET name=excluded.name,active=1,school_class=excluded.school_class,student_no=excluded.student_no', id(), match[1], s.name, s.number,s.school_class,s.student_no));
              (await run('DELETE FROM links WHERE student_id IN (SELECT id FROM students WHERE class_id=? AND active=0)', match[1]));
            }));
            return json(res, (await roster(match[1])));
          }
        }
        if ((match = path.match(/^\/api\/classes\/([^/]+)\/links$/)) && method === 'POST') {
          await classRow(match[1]);
          const linkRequest=await body(req);
          const rows = await roster(match[1]);
          const links = await transaction(async () => {
            const links = [];
            for (const s of rows) {
              const token = secret(), expires = Date.now() + 7 * 86400e3;
              await run('INSERT INTO links VALUES(?,?,?) ON CONFLICT(student_id) DO UPDATE SET token=excluded.token,expires=excluded.expires', s.id, hash(token), expires);
              const path='/student.html#token='+token,qr=linkRequest.format==='qr'?await QRCode.toString(new URL(path,appOrigin||`${secure?'https':'http'}://${req.headers.host}`).href,{type:'svg',errorCorrectionLevel:'M',margin:3}):undefined;
              links.push({ name:s.name,display_id:s.display_id,number:s.number,path,expires,...(qr?{qr}:{}) });
            }
            return links;
          });
          return json(res, links);
        }
        if (path === '/api/students' && method === 'POST' || /^\/api\/students\/[^/]+$/.test(path) && method === 'PUT') {
          const b=await body(req),existing=method==='PUT'?await get('SELECT * FROM students WHERE id=?',path.split('/').pop()):null;
          if(method==='PUT'&&!existing)fail(404,'找不到學生');
          const classId=existing?.class_id||text(b.classId);await classRow(classId);
          const schoolClass=typeof b.school_class==='string'?b.school_class.trim().toUpperCase():'';
          if(schoolClass.length>20)fail(400,'CLASS 最多 20 字');
          let number=text(b.number,20);if(schoolClass){if(!/^\d+$/.test(number)||Number(number)<1||Number(number)>9999)fail(400,'NO 須為 1–9999 的整數');number=String(Number(number));}
          const name=text(b.name,100),seat=studentKey(schoolClass,number),studentId=existing?.id||id();
          const occupied=await get('SELECT id FROM students WHERE class_id=? AND number=?',classId,seat);
          if(occupied&&occupied.id!==studentId)fail(409,'這個 CLASS／NO 已被使用，請使用另一學號');
          if(!existing&&Number((await get('SELECT count(*) AS n FROM students WHERE class_id=? AND active=1',classId)).n)>=100)fail(400,'每班最多 100 人');
          if(existing)await run('UPDATE students SET name=?,number=?,school_class=?,student_no=? WHERE id=?',name,seat,schoolClass,number,studentId);
          else await run('INSERT INTO students(id,class_id,name,number,school_class,student_no) VALUES(?,?,?,?,?,?)',studentId,classId,name,seat,schoolClass,number);
          return json(res,{id:studentId},existing?200:201);
        }
        if ((match = path.match(/^\/api\/students\/([^/]+)\/link$/))) {
          const s = (await get('SELECT * FROM students WHERE id=? AND active=1', match[1]));
          if (!s) fail(404, '找不到學生'); (await classRow(s.class_id));
          if (method === 'POST') {
            const token = secret(); const expires = Date.now() + 7 * 86400e3;
            (await run('INSERT INTO links VALUES(?,?,?) ON CONFLICT(student_id) DO UPDATE SET token=excluded.token,expires=excluded.expires', s.id, hash(token), expires));
            return json(res, { path: '/student.html#token=' + token, expires });
          }
          if (method === 'DELETE') { (await run('DELETE FROM links WHERE student_id=?', s.id)); return json(res, { ok: true }); }
        }
        if(path==='/api/sounds'&&method==='GET')return json(res,await soundState());
        if(path==='/api/sounds/refresh'&&method==='POST'){
          await body(req);startSoundRefresh();return json(res,await soundState(),202);
        }
        if(path==='/api/sounds'&&method==='PUT'){
          const b=await body(req);if(!Array.isArray(b.disabled)||b.disabled.length>10000||b.disabled.some(id=>typeof id!=='string'||!/^\d{1,12}$/.test(id)))fail(400,'音效選擇格式不正確');
          const current=new Set((await soundState()).items.map(s=>s.id));
          // Keep preferences for temporarily absent sounds so a later refresh does not re-enable them.
          const old=JSON.parse(await setting('disabledSounds')||'[]').filter(id=>!current.has(id));
          await put('disabledSounds',JSON.stringify([...new Set([...old,...b.disabled.filter(id=>current.has(id))]) ]));return json(res,await soundState());
        }
        if (path === '/api/events') {
          if (method === 'GET') return json(res, JSON.parse((await setting('events'))));
          if (method === 'PUT') {
            const b = await body(req); const events = {};
            for (const kind of ['chance', 'fate']) { if (!Array.isArray(b[kind]) || !b[kind].length || b[kind].length > 100) fail(400, '機會及命運各須有 1–100 項'); events[kind] = b[kind].map(t => text(t, 500)); }
            (await put('events', JSON.stringify(events))); return json(res, events);
          }
        }
        if (path === '/api/lessons' && method === 'GET') {
          return json(res, (await all('SELECT l.*,c.name AS class_name,(SELECT count(*) FROM draws WHERE lesson_id=l.id AND voided=0 AND kind=\'student\') AS draw_count FROM lessons l JOIN classes c ON c.id=l.class_id ORDER BY created DESC')));
        }
        if (path === '/api/lessons' && method === 'POST') {
          const b=await body(req);const record=await transaction(()=>classRecord(text(b.classId)));return json(res,{id:record.id},200);
        }
        if ((match = path.match(/^\/api\/lessons\/([^/]+)$/))) {
          const l = (await lessonRow(match[1]));
          if (method === 'GET') {
            const students = await roster(l.class_id);
            return json(res, { ...l, class_name: (await get('SELECT name FROM classes WHERE id=?', l.class_id)).name, students, board: await boardFor(l, students) });
          }
          if (method === 'PUT') { const b = await body(req); if (typeof b.closed !== 'boolean') fail(400, '課堂狀態不正確'); if (!b.closed) (await classRow(l.class_id)); (await run('UPDATE lessons SET closed=? WHERE id=?', Number(b.closed), l.id)); return json(res, { ok: true }); }
        }
        if ((match = path.match(/^\/api\/lessons\/([^/]+)\/stats$/)) && method === 'GET') {
          const l = (await lessonRow(match[1]));
          // Include withdrawn students with draws and preserve their recorded name/number.
          const stats = (await all(`SELECT s.id,s.name,s.number,s.school_class,s.student_no,CASE WHEN s.class_id=? AND s.active=1 THEN 1 ELSE 0 END AS active,count(d.id) AS count FROM students s LEFT JOIN draws d ON d.student_id=s.id AND d.voided=0 AND d.lesson_id=? WHERE (s.class_id=? AND s.active=1) OR d.id IS NOT NULL GROUP BY s.id,s.name,s.number,s.school_class,s.student_no,s.class_id,s.active ORDER BY s.school_class,length(s.student_no),s.student_no`, l.class_id,l.id,l.class_id));
          return json(res, { lesson: l, students: stats.map(publicStudent), draws: (await all('SELECT * FROM draws WHERE lesson_id=? ORDER BY created DESC,id DESC', l.id)) });
        }
        if ((match = path.match(/^\/api\/lessons\/([^/]+)\/draw$/)) && method === 'POST') {
          const b=await body(req);return json(res,await drawRecord(match[1],b));
        }
        if (path === '/api/avatars' && method === 'GET') {
          return json(res, (await all('SELECT a.id,a.status,a.created,s.name,s.number,s.school_class,s.student_no,c.name AS class_name,s.active FROM avatars a JOIN students s ON s.id=a.student_id JOIN classes c ON c.id=s.class_id ORDER BY a.created DESC')).map(publicStudent));
        }
        if ((match = path.match(/^\/api\/avatars\/([^/]+)$/))) {
          const a = (await get('SELECT id,student_id,status FROM avatars WHERE id=?', match[1])); if (!a) fail(404, '找不到頭像');
          if (method === 'PUT') {
            const b = await body(req); if (b.status !== 'approved') fail(400, '不支援的頭像狀態');
            (await transaction(async () => { (await run("DELETE FROM avatars WHERE student_id=? AND status='approved' AND id<>?", a.student_id, a.id)); (await run("UPDATE avatars SET status='approved' WHERE id=?", a.id)); }));
            return json(res, { ok: true });
          }
          if (method === 'DELETE') { (await run('DELETE FROM avatars WHERE id=?', a.id)); return json(res, { ok: true }); }
        }
        fail(404, '找不到這個操作');
      }
      let match;
      if ((match = path.match(/^\/media\/([0-9a-f-]+)$/)) && ['GET', 'HEAD'].includes(method)) {
        const a = (await get('SELECT mime,bytes,status FROM avatars WHERE id=?', match[1])); if (!a) fail(404, '找不到頭像');
        // Pending images are only visible to the teacher, never public.
        if (a.status !== 'approved') (await auth(req));
        res.writeHead(200, { 'Content-Type': a.mime, 'Content-Length': a.bytes.length, 'Cache-Control': 'private, no-store' }); return res.end(method === 'HEAD' ? undefined : a.bytes);
      }
      if (!['GET', 'HEAD'].includes(method)) fail(405, '不支援的操作');
      const file = path === '/' ? '/index.html' : path;
      const publicFiles = ['/index.html','/admin.html','/student.html','/app.js','/admin.js','/student.js','/shared.js','/event-format.js','/student-identity.js','/ui.css','/board.css','/celebration.js','/favicon.svg','/themes.js','/background-playlist.js','/themes.css','/theme-preview.html','/theme-preview.js',...THEME_MEDIA.map(name=>'/theme-media/'+name)];
      if (!publicFiles.includes(file) && !/^\/sound\/(?:bgm|[1-9]|[12][0-9]|3[0-8])\.mp3$/.test(file) && file !== '/video/bg.mp4') fail(404, '找不到頁面');
      const filePath = resolve(ROOT, '.' + file);
      let stat; try { stat = statSync(filePath); } catch { fail(404, '找不到檔案'); }
      const type = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', mp3: 'audio/mpeg', mp4: 'video/mp4' }[file.split('.').pop()];
      let start = 0, end = stat.size - 1, status = 200;
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      if (range) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), end) : end; if (start > end) { res.setHeader('Content-Range', `bytes */${stat.size}`); fail(416, '無效的檔案範圍'); } status = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`); }
      res.writeHead(status, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': /\.(html|js|css)$/.test(file) ? 'no-cache' : 'public, max-age=3600' });
      if (method === 'HEAD') return res.end();
      const stream = createReadStream(filePath, { start, end }); stream.on('error', () => res.destroy()); stream.pipe(res);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      if (!error.status) console.error('伺服器操作失敗：', error.code || error.name);
      json(res, { error: error.status ? error.message : '伺服器未能完成操作，請稍後重試' }, error.status || 500);
    }
  };
  let queue = Promise.resolve();
  const server = http.createServer((req,res) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/media/')) queue = queue.then(() => handle(req,res)).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
    else handle(req,res);
  });
  if(autoSoundSync)await armSoundSync();
  return { server, db, setupRequired: !(await setting('password')), setupCode, close: async () => { closing=true;if(soundTimer)clearTimeout(soundTimer);await soundRefresh;await queue;return new Promise(resolve => { server.close(async () => { await db.close(); resolve(); }); server.closeIdleConnections(); }); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = (await createApplication({autoSoundSync:process.env.SOUND_AUTO_SYNC!=='false'}));
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, process.env.HOST || '127.0.0.1', () => {
    console.log(`大富翁抽籤：http://localhost:${port}\n管理後台：http://localhost:${port}/admin.html`);
    if (app.setupRequired) console.log(`首次設定代碼（只供教師使用）：${app.setupCode}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
