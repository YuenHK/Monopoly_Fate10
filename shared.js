export const $ = id => document.getElementById(id);
export const apiOrigin = () => globalThis.MONOPOLY_API_ORIGIN || '';
export async function playApi(path, data, method = data === undefined ? 'GET' : 'POST') {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),75000);
  try{
    const response = await fetch(apiOrigin() + path.replace(/^\/api\//, '/api/play/'), {
      method, credentials: 'omit', cache: 'no-store',signal:controller.signal,
      ...(data === undefined ? {} : {headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
    });
    let result;
    try { result = await response.json(); } catch(error) { if(controller.signal.aborted)throw error;throw new Error('伺服器正在喚醒或暫時未能回應'); }
    if (!response.ok) throw Object.assign(new Error(result.error || '操作失敗'), {status:response.status});
    return result;
  }catch(error){if(controller.signal.aborted)throw new Error('連接逾時，伺服器可能仍在喚醒');throw error;}
  finally{clearTimeout(timer);}
}

export async function api(path, data, method = data === undefined ? 'GET' : 'POST') {
  const response = await fetch(path, {
    method, credentials: 'same-origin', cache: 'no-store',
    ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('伺服器暫時未能回應，請稍後再試'); }
  if (!response.ok) throw Object.assign(new Error(result.error || '操作失敗'), { status: response.status });
  return result;
}
export function node(tag, text, className) {
  const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e;
}
export function button(label, callback, className = '') {
  const b = node('button', label, className); b.type = 'button';
  b.addEventListener('click', async () => { b.disabled = true; try { await callback(); } catch (error) { notice(error.message, true); } finally { b.disabled = false; } });
  return b;
}
export function notice(message, error = false) {
  for(const box of [$('notice'),...document.querySelectorAll('dialog [data-notice]')]) { box.textContent=message;box.className='notice'+(error?' error':'');box.hidden=!message; }
}
export function date(value) { return new Date(value).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false }); }
export function today() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' }); }
export function options(select, rows, placeholder, label = r => r.name) {
  const previous = select.value; select.replaceChildren(new Option(placeholder, ''));
  rows.forEach(row => select.add(new Option(label(row), row.id)));
  if (rows.some(row => row.id === previous)) select.value = previous;
}
export function form(id, callback) {
  $(id).addEventListener('submit', async e => {
    e.preventDefault(); const b = e.submitter; if (b) b.disabled = true;
    try { await callback(); } catch (error) { notice(error.message, true); }
    finally { if (b) b.disabled = false; }
  });
}
export function avatar(avatarId, name, className = 'avatar') {
  if (!avatarId) return node('div', '🐱', className + ' fallback');
  const img = document.createElement('img'); img.className = className; img.src = apiOrigin() + '/media/' + encodeURIComponent(avatarId); img.alt = name + '的頭像';
  img.addEventListener('error', () => img.replaceWith(node('div', '🐱', className + ' fallback')), { once: true });
  return img;
}
export function downloadCSV(filename, rows) {
  const cell = value => { let str = String(value ?? ''); if (/^[=+\-@\t\r]/.test(str)) str = "'" + str; return '"' + str.replaceAll('"', '""') + '"'; };
  const data = '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
