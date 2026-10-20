import {$,api,node,notice} from './shared.js';
export function createThemeReview({onPolicyChanged=()=>{}}={}){
 let data=null,theme='basic',revision=0,saving=false,query='',page=0;
 const host=$('theme-media-list');
 function stop(){for(const media of host.querySelectorAll('audio,video'))media.pause();}
 host.addEventListener('play',e=>{for(const m of document.querySelectorAll('audio,video'))if(m!==e.target)m.pause();},true);
 async function change(item,blocked){
  if(saving)return;saving=true;host.querySelectorAll('input').forEach(i=>i.disabled=true);stop();
  try{const saved=await api('/api/theme-media',{key:item.key,blocked,revision:data.revision},'PUT');data.revision=saved.revision;for(const i of data.items)i.blocked=saved.blocked.includes(i.key);render();await onPolicyChanged();notice((blocked?'已在全站禁播：':'已重新啟用：')+item.title+'。前台下次操作或約30秒內更新。');}
  catch(e){notice(e.message,true);await load(theme);}finally{saving=false;host.querySelectorAll('input').forEach(i=>i.disabled=false);}
 }
 function render(){
  stop();host.replaceChildren();const items=data.items.filter(i=>i.themes.includes(theme));
  $('theme-media-count').textContent=`音效 ${items.filter(i=>i.kind==='sound').length} 段 · 影片 ${items.filter(i=>i.kind==='video').length} 段 · 音樂 ${items.filter(i=>i.kind==='music').length} 段 · 已禁播 ${items.filter(i=>i.blocked).length} 項`;
  for(const [kind,title] of [['sound','搞笑／主題音效清單'],['video','影片清單（包括輪播及後備）'],['music','背景音樂']]){
   const section=node('section',undefined,'stack'),heading=node('h3',title),wrap=node('div',undefined,'table-wrap media-review-list'),table=node('table'),head=node('thead'),headrow=node('tr'),grid=node('tbody');table.setAttribute('aria-label',title);for(const text of ['名稱／資料','試播','全站播放','來源']){const th=node('th',text);th.scope='col';headrow.append(th);}head.append(headrow);table.append(head,grid);wrap.append(table);section.append(heading,wrap);
   let shown=items.filter(i=>i.kind===kind);
   if(kind==='sound'&&shown.length>24){
    const tools=node('div',undefined,'actions'),search=document.createElement('input');search.type='search';search.placeholder='搜尋音效名稱';search.setAttribute('aria-label','搜尋音效名稱');search.value=query;
    search.addEventListener('input',()=>{query=search.value;page=0;render();const next=host.querySelector('input[type=search]');next.focus();next.setSelectionRange(query.length,query.length);});
    shown=shown.filter(i=>i.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));const pages=Math.max(1,Math.ceil(shown.length/24));page=Math.min(page,pages-1);
    const prev=node('button','上一頁'),next=node('button','下一頁');prev.type=next.type='button';prev.disabled=page===0;next.disabled=page>=pages-1;prev.onclick=()=>{page--;render();};next.onclick=()=>{page++;render();};
    tools.append(search,prev,node('span',`${page+1} / ${pages} 頁 · ${shown.length} 段`),next);section.insertBefore(tools,wrap);shown=shown.slice(page*24,(page+1)*24);
    if(data.soundScreening)section.insertBefore(node('p',`原庫 ${data.soundScreening.total} 段；名稱自動排除 ${data.soundScreening.excluded} 段。名稱篩選不等於內容聽審；可另行取消全站播放。`,'muted'),wrap);
   }
   for(const item of shown){
    const card=node('tr'),info=node('td'),preview=node('td'),toggle=node('td'),sourceCell=node('td'),header=node('div',undefined,'actions'),name=node('strong',item.title),badge=node('span',item.blocked?'已禁播':'允許播放',item.blocked?'badge closed':'badge');header.append(name,badge);info.append(header);
    const media=document.createElement(kind==='video'?'video':'audio');media.controls=true;media.preload=kind==='video'?'metadata':'none';media.src=item.url;media.setAttribute('aria-label',item.title+'試播');if(kind==='video'){media.muted=true;media.playsInline=true;}preview.append(media);
    if(item.caption||item.description||item.transcript){const details=node('details'),summary=node('summary','素材資料');details.append(summary);if(item.caption||item.description)details.append(node('p',item.caption||item.description,'muted'));if(item.transcript)details.append(node('small','對白：'+item.transcript));info.append(details);}
    const label=node('label'),check=document.createElement('input');check.type='checkbox';check.checked=!item.blocked;check.disabled=saving;check.setAttribute('aria-label','允許全站播放：'+item.title);check.addEventListener('change',()=>change(item,!check.checked));const text=node('span',' 允許全站播放');label.append(check,text);toggle.append(label);
    const sources=node('div',undefined,'actions');if(item.source){const link=node('a','素材來源 ↗');link.href=item.source;link.target='_blank';link.rel='noopener';sources.append(link);}if(item.license){const link=node('a','授權 ↗');link.href=item.license;link.target='_blank';link.rel='noopener';sources.append(link);}sourceCell.append(sources);card.append(info,preview,toggle,sourceCell);grid.append(card);
   }
   host.append(section);
  }
 }
 async function load(id){if(theme!==id){query='';page=0;}theme=id;const request=++revision;const result=await api('/api/theme-media');if(request!==revision)return;data=result;render();}
 return {load,stop};
}
