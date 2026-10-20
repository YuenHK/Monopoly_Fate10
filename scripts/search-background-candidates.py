#!/usr/bin/env python3
"""Metadata-only discovery. This never downloads media, approves, or edits the live library."""
import argparse,json,datetime as dt
from urllib.request import Request,urlopen
from urllib.parse import urlencode,quote
API='https://commons.wikimedia.org/w/api.php'
def search():
 results=[]
 for query in ['filetype:video intitle:kitten playing','filetype:video intitle:puppy playing']:
  params={'action':'query','format':'json','generator':'search','gsrsearch':query,'gsrnamespace':6,'gsrlimit':10,'prop':'imageinfo','iiprop':'extmetadata','iiextmetadatafilter':'LicenseShortName|LicenseUrl'}
  with urlopen(Request(API+'?'+urlencode(params),headers={'User-Agent':'MonopolyFate10-school-candidates/2.6.4 (https://github.com/YuenHK/Monopoly_Fate10)'}),timeout=20) as response:
   raw=response.read(1024*1024+1)
  if len(raw)>1024*1024:raise ValueError('Candidate response too large')
  data=json.loads(raw)
  if 'error' in data:raise ValueError('Candidate search unavailable')
  for page in data.get('query',{}).get('pages',{}).values():
   meta=(page.get('imageinfo') or [{}])[0].get('extmetadata',{});results.append({'title':page['title'],'source':'https://commons.wikimedia.org/wiki/'+quote(page['title'].replace(' ','_'),safe=':'),'license':meta.get('LicenseShortName',{}).get('value','Unknown'),'status':'pending-visual-and-license-review'})
 return {'searchedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'notice':'候選資料不是內容核准；未下載，未加入播放或已審核白名單。','candidates':results}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args()
 from pathlib import Path
 Path(a.output).write_text(json.dumps(search(),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
