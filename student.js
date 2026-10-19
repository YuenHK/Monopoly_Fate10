import { $, api, notice, form } from './shared.js';
const token = new URLSearchParams(location.hash.slice(1)).get('token');
let previewURL;
async function load() {
  if (!token) throw new Error('請使用老師提供的個人連結開啟此頁。');
  const s = await api('/api/student', { token });
  $('student-class').textContent = s.className;
  $('student-name').textContent = s.display_id || `${s.number} · ${s.name}`;
  $('upload-status').textContent = s.avatars.some(a => a.status === 'pending') ? '🕒 你有一張頭像正在等候老師審批。' : s.avatars.some(a => a.status === 'approved') ? '✓ 你的頭像已獲批准。' : '尚未有已批准的頭像。';
  $('loading').hidden = true; $('student-content').hidden = false;
}
$('avatar-file').addEventListener('change', () => {
  if (previewURL) URL.revokeObjectURL(previewURL);
  const file = $('avatar-file').files[0]; $('preview').hidden = true;
  if (!file) return;
  if (!['image/gif','image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { $('avatar-file').value=''; return notice('請選擇最多 5 MB 的 GIF、PNG、JPEG 或 WebP 圖片。',true); }
  previewURL = URL.createObjectURL(file); $('preview-image').src = previewURL; $('preview').hidden = false; notice('');
});
form('upload-form',async () => {
  const file = $('avatar-file').files[0]; if (!file) throw new Error('請先選擇圖片');
  const base64 = await new Promise((resolve,reject) => { const r=new FileReader(); r.onload=()=>resolve(String(r.result).split(',')[1]); r.onerror=()=>reject(new Error('無法讀取圖片')); r.readAsDataURL(file); });
  await api('/api/student/avatar',{token,base64});
  $('avatar-file').value=''; $('preview').hidden=true;
  if (previewURL) URL.revokeObjectURL(previewURL);
  await load(); notice('提交成功！請等候老師審批。');
});
try { await load(); } catch(e) { $('loading').textContent='未能開啟提交頁'; notice(e.message,true); }
