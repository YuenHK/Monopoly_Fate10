#!/usr/bin/env python3
"""Rotate only reviewed, hash-pinned local clips. No network or automatic approval."""
import argparse,copy,datetime as dt,hashlib,html,json,os,re,tempfile
from pathlib import Path
from zoneinfo import ZoneInfo
ALLOWED_FILES={'basic':['meme-emoji.mp4','meme-ladle.mp4','meme-mop.mp4'],'cat':['cat-play.mp4','cat-sleep.mp4','cat-ball.mp4'],'dog':['dog-play.mp4','dog-sleep.mp4','dog-outdoor.mp4']}
POLICY='school-v1'
def approved_entries(media):
 data=json.loads((media/'approved-catalog.json').read_text(encoding='utf-8'))
 if data.get('version')!=1 or data.get('policy')!=POLICY:raise ValueError('Unknown school review policy')
 entries=data.get('entries',[]);seen=set()
 for entry in entries:
  asset=entry.get('asset','');review=entry.get('review',{})
  if not re.fullmatch(r'approved/[a-z0-9-]+\.mp4',asset) or asset in seen:raise ValueError('Invalid or duplicate approved asset')
  seen.add(asset)
  if review.get('status')!='approved' or review.get('policy')!=POLICY or not review.get('checkedAt') or not review.get('method'):raise ValueError('Clip has not passed review')
  if not entry.get('author') or not entry.get('source','').startswith('https://') or not entry.get('license','').startswith('https://'):raise ValueError('Missing attribution')
  path=media/asset
  if path.is_symlink() or path.resolve().parent!=(media/'approved').resolve():raise ValueError('Invalid approved asset path')
  content=path.read_bytes()
  if len(content)>4*1024*1024 or content[4:8]!=b'ftyp' or hashlib.sha256(content).hexdigest()!=entry.get('sha256'):raise ValueError('Reviewed video changed; review again before publication')
 for theme in ALLOWED_FILES:
  if len([e for e in entries if theme in e.get('themes',[])])<4:raise ValueError('Each theme needs at least four reviewed clips')
 return entries

def credits_section(data):
 esc=lambda value:html.escape(str(value),quote=True)
 rows=[]
 for c in data['clips']:
  rows.append('<li><code>'+esc(c['file'])+'</code>：'+esc(c['title'])+'；作者 '+esc(c['author'])+'。<a href="'+esc(c['source'])+'">來源</a> · <a href="'+esc(c['license'])+'">'+esc(c['licenseName'])+'</a>。修改：'+esc(c['modifications'])+'；學校片庫畫面檢查：'+esc(c['review']['checkedAt'])+'。</li>')
 return '<section id="weekly-video-library"><h2>學校適用：已審核影片庫</h2><p>每週一香港時間 06:15 只在已審核片庫輪替，每個主題維持三條。禁止色情、血腥、虐待、驚嚇及怪異內容；迷因主題採用已審核的真人搞笑／反應短片，貓狗主題維持溫馨可愛。新搜尋結果只列候選，不會自動播放。最近輪替：'+esc(data['updatedAt'])+'</p><ul>'+''.join(rows)+'</ul><p>審查方式：全段每0.25秒抽幀並核對來源，並非教師親自審批或逐幀觀看，仍可能漏檢。<a href="approved-catalog.json">全部已審核素材、授權及檔案指紋</a> · <a href="school-review.json">本次排除及搜尋記錄</a>。新增或改動影片須重新檢查，雜湊不符時停止發布。</p></section>'

def refresh(root,now=None,force=False):
 media=Path(root)/'theme-media';entries=approved_entries(media)
 now=now or dt.datetime.now(ZoneInfo('Asia/Hong_Kong'));now=now.astimezone(ZoneInfo('Asia/Hong_Kong'));week=now.strftime('%G-W%V')
 manifest=media/'library.json';original=json.loads(manifest.read_text(encoding='utf-8'))
 if original.get('policy')==POLICY and original.get('updatedWeek')==week and not force:return False
 clips=[];staged={};week_index=(now.date().toordinal()-1)//7
 for theme,names in ALLOWED_FILES.items():
  pool=[e for e in entries if theme in e['themes']];offset=week_index%len(pool)
  for index,name in enumerate(names):
   entry=copy.deepcopy(pool[(offset+index)%len(pool)]);entry.update(id=Path(name).stem,theme=theme,file=name,approvedId=entry['id'],checked=entry['review']['checkedAt']);entry.pop('themes',None)
   clips.append(entry);staged[name]=(media/entry['asset']).read_bytes()
 data={'version':3,'policy':POLICY,'description':'學校背景：只輪替已審核、固定指紋的影片；新搜尋不直接播放。','updatedAt':now.isoformat(timespec='seconds'),'updatedWeek':week,'schedule':'每週一06:15 Asia/Hong_Kong：已審核片庫輪替','approvedCount':len(entries),'clips':clips}
 text=(media/'credits.html').read_text(encoding='utf-8')
 if '<section id="weekly-video-library">' not in text:raise ValueError('Missing credits marker')
 text=re.sub(r'<section id="weekly-video-library">.*?</section>',lambda _:credits_section(data),text,count=1,flags=re.S)
 # Validate and stage every byte before touching live output files.
 staged.update({'library.json':(json.dumps(data,ensure_ascii=False,indent=2)+'\n').encode(),'credits.html':text.encode()})
 with tempfile.TemporaryDirectory(prefix='monopoly-reviewed-') as temp:
  for name,content in staged.items():(Path(temp)/name).write_bytes(content)
  for name in staged:
   destination=media/name;replacement=destination.with_name('.'+name+'.weekly-tmp');replacement.write_bytes((Path(temp)/name).read_bytes());os.replace(replacement,destination)
 return True
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',default=str(Path(__file__).resolve().parents[1]));p.add_argument('--force',action='store_true');args=p.parse_args()
 print('Rotated reviewed school library' if refresh(args.root,force=args.force) else 'Already rotated this week; no changes')
