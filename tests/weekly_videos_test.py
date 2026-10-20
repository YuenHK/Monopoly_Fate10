import unittest, tempfile, shutil, json, datetime, importlib.util
from pathlib import Path
s=importlib.util.spec_from_file_location('weekly',Path(__file__).resolve().parents[1]/'scripts/refresh-background-library.py'); m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Weekly(unittest.TestCase):
 def fixture(self, root):
  media=root/'theme-media';media.mkdir();src=Path(__file__).resolve().parents[1]/'theme-media'
  for name in ['library.json','credits.html']:shutil.copyfile(src/name,media/name)
  data=json.loads((media/'library.json').read_text());data.pop('updatedWeek',None);data.pop('history',None)
  for clip in data['clips']:
   clip.pop('sourceKey',None);clip.pop('updatedAt',None)
  (media/'library.json').write_text(json.dumps(data))
  for names in m.ALLOWED_FILES.values():
   for name in names:(media/name).write_bytes(b'old')
 def finder(self,theme,seen,week):
  return [dict(sourceKey='commons:'+theme,source='https://commons.wikimedia.org/wiki/'+theme,title=theme,author='Author',license=m.LICENSES['CC0'],licenseName='CC0',download='https://upload.wikimedia.org/wikipedia/commons/'+theme)]
 def test_batch_then_same_week_skip(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);self.fixture(root);now=datetime.datetime(2026,10,20,tzinfo=datetime.timezone.utc)
   self.assertTrue(m.refresh(root,now=now,finder=self.finder,reader=lambda *a:b'new',encoder=lambda b,p,f:p.write_bytes(b)))
   data=json.loads((root/'theme-media/library.json').read_text());self.assertEqual(data['updatedWeek'],'2026-W43');self.assertEqual(sum('sourceKey' in c for c in data['clips']),3)
   self.assertFalse(m.refresh(root,now=now,finder=lambda *a: self.fail('must skip')))
 def test_failure_retains_every_original_file(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);self.fixture(root);before={p.name:p.read_bytes() for p in (root/'theme-media').iterdir()}
   with self.assertRaises(RuntimeError):m.refresh(root,finder=lambda t,*a:[] if t=='dog' else self.finder(t,*a),reader=lambda *a:b'new',encoder=lambda b,p,f:p.write_bytes(b))
   self.assertEqual(before,{p.name:p.read_bytes() for p in (root/'theme-media').iterdir()})
 def test_sources_reject_bad_license_and_subject(self):
  info=dict(sha1='abc',duration=10,size=100000,width=640,height=480,mime='video/webm',url='https://upload.wikimedia.org/wikipedia/commons/a.webm',extmetadata={'LicenseShortName':{'value':'CC0'},'LicenseUrl':{'value':m.LICENSES['CC0']},'Artist':{'value':'<b>A</b>'}})
  page={'title':'File:Kitten playing.webm','imageinfo':[info]};self.assertIsNotNone(m.candidate(page,'cat'))
  page['title']='File:Kitten fighting.webm';self.assertIsNone(m.candidate(page,'cat'));page['title']='File:Kitten playing.webm';info['url']='https://evil.test/a';self.assertIsNone(m.candidate(page,'cat'));info['url']='https://upload.wikimedia.org/wikipedia/commons/a';info['extmetadata']['LicenseShortName']['value']='All rights reserved';self.assertIsNone(m.candidate(page,'cat'))
if __name__=='__main__':unittest.main()
