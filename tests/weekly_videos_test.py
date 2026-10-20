import unittest,tempfile,shutil,json,datetime,importlib.util,socket
from pathlib import Path
from unittest.mock import patch
s=importlib.util.spec_from_file_location('weekly',Path(__file__).resolve().parents[1]/'scripts/refresh-background-library.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Weekly(unittest.TestCase):
 def fixture(self,root):
  media=root/'theme-media';media.mkdir();src=Path(__file__).resolve().parents[1]/'theme-media'
  for name in ['library.json','credits.html','approved-catalog.json']:shutil.copyfile(src/name,media/name)
  shutil.copytree(src/'approved',media/'approved');data=json.loads((media/'library.json').read_text());data.pop('updatedWeek',None);(media/'library.json').write_text(json.dumps(data))
  for names in m.ALLOWED_FILES.values():
   for name in names:(media/name).write_bytes(b'original-output')
 def test_basic_stays_human_only_and_pet_themes_stay_separate_across_cycle(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);self.fixture(root)
   for week in range(4):
    m.refresh(root,now=datetime.datetime(2026,10,20,tzinfo=datetime.timezone.utc)+datetime.timedelta(weeks=week),force=True)
    clips=json.loads((root/'theme-media/library.json').read_text())['clips']
    basic={c['approvedId'] for c in clips if c['theme']=='basic'}
    self.assertTrue(all(id.startswith('basic-human-') for id in basic))
    self.assertEqual(len(basic),3)
    for c in clips:
     if c['theme'] in ('cat','dog'):self.assertTrue(c['approvedId'].startswith(c['theme']+'-'))
 def test_offline_rotation_then_skip_and_next_week(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);self.fixture(root);now=datetime.datetime(2026,10,20,tzinfo=datetime.timezone.utc)
   with patch.object(socket,'create_connection',side_effect=AssertionError('No network allowed')):self.assertTrue(m.refresh(root,now=now))
   first=json.loads((root/'theme-media/library.json').read_text());self.assertEqual(first['version'],3);self.assertFalse(m.refresh(root,now=now));self.assertTrue(m.refresh(root,now=now+datetime.timedelta(days=7)))
   second=json.loads((root/'theme-media/library.json').read_text())
   for theme in m.ALLOWED_FILES:
    a={c['approvedId'] for c in first['clips'] if c['theme']==theme};b={c['approvedId'] for c in second['clips'] if c['theme']==theme};self.assertEqual(len(a&b),2);self.assertEqual(len(a-b),1)
 def test_tampered_file_or_pending_review_never_touches_outputs(self):
  for mode in ['tamper','pending','traversal','missing']:
   with self.subTest(mode=mode),tempfile.TemporaryDirectory() as d:
    root=Path(d);self.fixture(root);media=root/'theme-media';catalog=json.loads((media/'approved-catalog.json').read_text());e=catalog['entries'][0]
    if mode=='tamper':(media/e['asset']).write_bytes(b'new unreviewed content')
    elif mode=='pending':e['review']['status']='pending'
    elif mode=='traversal':e['asset']='../outside.mp4'
    else:(media/e['asset']).unlink()
    (media/'approved-catalog.json').write_text(json.dumps(catalog));before={p.name:p.read_bytes() for p in media.iterdir() if p.is_file()}
    with self.assertRaises((ValueError,FileNotFoundError)):m.refresh(root)
    self.assertEqual(before,{p.name:p.read_bytes() for p in media.iterdir() if p.is_file()})
 def test_even_same_week_requires_valid_reviewed_files(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);self.fixture(root);m.refresh(root);catalog=json.loads((root/'theme-media/approved-catalog.json').read_text());(root/'theme-media'/catalog['entries'][0]['asset']).write_bytes(b'changed')
   with self.assertRaises(ValueError):m.refresh(root)
if __name__=='__main__':unittest.main()
