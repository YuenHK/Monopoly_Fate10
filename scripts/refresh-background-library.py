#!/usr/bin/env python3
"""Replace one licensed animal clip per theme; publish only after the whole batch succeeds."""
import argparse, copy, datetime as dt, hashlib, html, json, os, re, shutil, subprocess, tempfile, time
from pathlib import Path
from urllib.parse import urlencode, urlparse, quote
from urllib.request import Request, urlopen
from html.parser import HTMLParser
from zoneinfo import ZoneInfo

API = 'https://commons.wikimedia.org/w/api.php'
UA = 'MonopolyFate10/2.6.2 (https://github.com/YuenHK/Monopoly_Fate10; classroom video updater)'
MAX_SOURCE = 30 * 1024 * 1024
LICENSES = {'CC0': 'https://creativecommons.org/publicdomain/zero/1.0/', 'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/', 'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/', 'CC BY 3.0': 'https://creativecommons.org/licenses/by/3.0/', 'CC BY-SA 3.0': 'https://creativecommons.org/licenses/by-sa/3.0/'}
QUERIES = {'basic': ['filetype:video intitle:cat intitle:toy', 'filetype:video intitle:dog intitle:ball'], 'cat': ['filetype:video intitle:kitten playing', 'filetype:video intitle:kittens playing'], 'dog': ['filetype:video intitle:puppy playing', 'filetype:video intitle:puppies playing']}
BLOCKED = re.compile(r'dead|death|injur|birth|mating|copulat|fight|attack|surg|aggress|blood|hunt|mouse|mice|rat\b|bird|snake|monkey|bibi|street day|mobilization|film|compilation|mosque|rescue|slaughter|虐|血|死亡|交配|打鬥|捕食', re.I)
ALLOWED_FILES = {'basic': ['meme-emoji.mp4', 'meme-ladle.mp4', 'meme-mop.mp4'], 'cat': ['cat-play.mp4', 'cat-sleep.mp4', 'cat-ball.mp4'], 'dog': ['dog-play.mp4', 'dog-sleep.mp4', 'dog-outdoor.mp4']}
class PlainText(HTMLParser):
    def __init__(self): super().__init__(); self.parts = []
    def handle_data(self, text): self.parts.append(text)
def plain(value):
    parser = PlainText(); parser.feed(str(value)); return ' '.join(''.join(parser.parts).split())[:1200]
def read_url(url, limit, host):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname != host or parsed.username or parsed.password or parsed.port not in (None, 443): raise ValueError('Untrusted source URL')
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={'User-Agent': UA}), timeout=30) as response:
                final = urlparse(response.url)
                if final.scheme != 'https' or final.hostname != host or final.port not in (None,443): raise ValueError('Untrusted redirect')
                if int(response.headers.get('Content-Length', '0')) > limit: raise ValueError('Source too large')
                data = response.read(limit + 1)
                if len(data) > limit: raise ValueError('Source too large')
                return data
        except Exception:
            if attempt == 2: raise
            time.sleep(2 ** attempt)
def candidate(page, theme):
    title = re.sub(r'(puppies|kittens)(playing)', r'\1 \2', plain(page.get('title', '')), flags=re.I); info = (page.get('imageinfo') or [{}])[0]; meta = info.get('extmetadata') or {}
    if BLOCKED.search(title) or not info.get('sha1'): return None
    if theme == 'basic': relevant = re.search(r'\b(cat|dog)\b', title, re.I) and re.search(r'\b(toy|ball)\b', title, re.I)
    else: relevant = re.search(r'\bkitten(?:s)?\b' if theme == 'cat' else r'\bpupp(?:y|ies)\b', title, re.I) and re.search(r'\bplay(?:ing|s)?\b', title, re.I)
    if not relevant or not 6 <= float(info.get('duration', 0)) <= 120: return None
    if not 0 < info.get('size', 0) <= MAX_SOURCE or min(info.get('width', 0), info.get('height', 0)) < 240: return None
    if info.get('mime') not in ('video/webm', 'video/ogg', 'application/ogg', 'video/mp4'): return None
    name = plain(meta.get('LicenseShortName', {}).get('value', '')); license_url = html.unescape(meta.get('LicenseUrl', {}).get('value', '')).replace('http://', 'https://')
    if name not in LICENSES or license_url.rstrip('/') != LICENSES[name].rstrip('/'): return None
    author = plain(meta.get('Artist', {}).get('value', ''))
    url = info.get('url', ''); parsed = urlparse(url)
    if not author or parsed.scheme != 'https' or parsed.hostname != 'upload.wikimedia.org' or not parsed.path.startswith('/wikipedia/commons/'): return None
    return {'sourceKey': 'commons:' + info['sha1'], 'source': 'https://commons.wikimedia.org/wiki/' + quote(page['title'].replace(' ', '_'), safe=':'), 'title': title.removeprefix('File:'), 'author': author, 'license': LICENSES[name], 'licenseName': name, 'download': url}
def discover(theme, seen, week):
    found = {}
    for query in QUERIES[theme]:
        params = {'action':'query', 'format':'json', 'generator':'search', 'gsrsearch':query, 'gsrnamespace':6, 'gsrlimit':20, 'prop':'imageinfo', 'iiprop':'url|size|extmetadata|sha1|mime', 'iiextmetadatafilter':'LicenseShortName|LicenseUrl|Artist'}
        data = json.loads(read_url(API + '?' + urlencode(params), 2 * 1024 * 1024, 'commons.wikimedia.org'))
        if 'error' in data: raise RuntimeError('Commons search unavailable')
        for page in data.get('query', {}).get('pages', {}).values():
            item = candidate(page, theme)
            if item and item['sourceKey'] not in seen and item['source'] not in seen: found[item['sourceKey']] = item
    return sorted(found.values(), key=lambda c: hashlib.sha256((week + c['sourceKey']).encode()).hexdigest())
def transcode(data, target, ffmpeg):
    source = target.with_suffix('.source'); source.write_bytes(data)
    filt = '[0:v]fps=24,scale=854:480:force_original_aspect_ratio=decrease,setsar=1,split[sharp][b];[b]scale=854:480:force_original_aspect_ratio=increase,crop=854:480,boxblur=20:2[blur];[blur][sharp]overlay=(W-w)/2:(H-h)/2,format=yuv420p[out]'
    subprocess.run([ffmpeg, '-nostdin', '-y', '-i', str(source), '-t', '24', '-filter_complex', filt, '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '25', '-maxrate', '900k', '-bufsize', '1800k', '-movflags', '+faststart', '-threads', '2', str(target)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=120)
    if not 10000 < target.stat().st_size < 4 * 1024 * 1024 or target.read_bytes()[4:8] != b'ftyp': raise ValueError('Invalid output video')
    # Decode the entire output before it is eligible for publication.
    subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-i', str(target), '-f', 'null', '-'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=60)
def credits_section(data):
    rows = []
    for c in data['clips']:
        e = lambda x: html.escape(str(x), quote=True)
        rows.append('<li><code>' + e(c['file']) + '</code>：' + e(c['title']) + '；作者 ' + e(c['author']) + '。<a href="' + e(c['source']) + '">原始素材頁</a> · <a href="' + e(c['license']) + '">' + e(c['licenseName']) + '</a>。修改：' + e(c['modifications']) + '</li>')
    return '<section id="weekly-video-library"><h2>每週背景影片輪播</h2><p>每週一香港時間 06:15 嘗試為每個主題更換一條不同素材；更新失敗保留現有影片。新片指本網站尚未使用的授權素材，不代表當週發布或全網熱門。基礎主題的新片以搞笑動物玩耍為主。最近成功更新：' + html.escape(data.get('updatedAt', '2026-10-20（初始影片庫）')) + '</p><ul>' + ''.join(rows) + '</ul><p>輪播素材只隨本網站背景使用，各自保留原授權；Pexels、Mixkit 或 CC 授權不改變其他程式的授權。<a href="library.json">完整來源記錄</a></p></section>'
def validate_library(data):
    if len(data.get('clips', [])) != 9: raise ValueError('Expected nine existing clips')
    files = set()
    for c in data['clips']:
        if c.get('file') not in ALLOWED_FILES.get(c.get('theme'), []) or c['file'] in files: raise ValueError('Unexpected library file')
        files.add(c['file'])
def refresh(root, now=None, force=False, ffmpeg='ffmpeg', finder=discover, reader=read_url, encoder=transcode):
    root = Path(root); media = root / 'theme-media'; manifest = media / 'library.json'; original = json.loads(manifest.read_text()); validate_library(original)
    now = now or dt.datetime.now(ZoneInfo('Asia/Hong_Kong')); week = now.strftime('%G-W%V')
    if original.get('updatedWeek') == week and not force: return False
    updated = copy.deepcopy(original); seen = set(updated.get('history', [])); seen.update(c.get('sourceKey', c['source']) for c in original['clips']); seen.update({'https://commons.wikimedia.org/wiki/File:Puppy_playing.webm','https://commons.wikimedia.org/wiki/File:Cat_playing_with_a_laser_pointer.webm'})
    with tempfile.TemporaryDirectory(prefix='monopoly-weekly-') as temp:
        staged = []; temp = Path(temp)
        for theme in ('basic', 'cat', 'dog'):
            old = min((c for c in updated['clips'] if c['theme'] == theme), key=lambda c: c.get('updatedAt', c.get('checked', '')))
            chosen = None
            for item in finder(theme, seen, week)[:5]:
                try:
                    target = temp / old['file']; encoder(reader(item['download'], MAX_SOURCE, 'upload.wikimedia.org'), target, ffmpeg); chosen = item; break
                except Exception as error: print('Skipped unusable source:', type(error).__name__, flush=True)
            if chosen is None: raise RuntimeError('No usable new licensed clip for ' + theme + '; old library retained')
            seen.add(chosen['sourceKey']); entry = {k:v for k,v in chosen.items() if k != 'download'}
            entry.update(id=old['id'], theme=theme, file=old['file'], checked=now.date().isoformat(), updatedAt=now.isoformat(timespec='seconds'), modifications='靜音、保留前 24 秒（或較短的完整原片）、轉為 854×480 H.264 MP4／24 fps；直向片以模糊側邊延伸。', sha256=hashlib.sha256(target.read_bytes()).hexdigest())
            updated['clips'][updated['clips'].index(old)] = entry; staged.append((target, media / old['file']))
        updated.update(version=2, updatedAt=now.isoformat(timespec='seconds'), updatedWeek=week, history=sorted(seen), schedule='每週一 06:15 Asia/Hong_Kong')
        text = (media / 'credits.html').read_text(); section = credits_section(updated)
        if '<section id="weekly-video-library">' not in text: raise ValueError('Missing credits section marker')
        text = re.sub(r'<section id="weekly-video-library">.*?</section>', lambda _: section, text, count=1, flags=re.S)
        # Nothing in the working library is touched until all three clips and credits are ready.
        for source, destination in staged:
            sibling = destination.with_name('.' + destination.name + '.weekly-tmp'); shutil.copyfile(source, sibling); os.replace(sibling, destination)
        (media / 'credits.html').write_text(text); manifest.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + '\n')
    return True
if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--root', default=str(Path(__file__).resolve().parents[1])); p.add_argument('--force', action='store_true'); p.add_argument('--ffmpeg', default=os.environ.get('FFMPEG_BIN', 'ffmpeg')); args = p.parse_args()
    print('Updated all three themes' if refresh(args.root, force=args.force, ffmpeg=args.ffmpeg) else 'Already updated this week; no changes')
