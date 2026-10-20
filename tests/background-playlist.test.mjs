import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { shuffledCycle, createBackgroundPlaylist } from '../background-playlist.js';
import { THEMES, THEME_MEDIA } from '../themes.js';
class Media extends EventTarget {
  src=''; error=null; plays=0; loads=[]; paused=true;
  pause(){this.paused=true;}
  load(){this.error=null;this.loads.push(this.src);}
  play(){this.plays++;this.paused=false;return Promise.resolve();}
  end(){this.dispatchEvent(new Event('ended'));}
  fail(){this.error={code:4};this.dispatchEvent(new Event('error'));}
}
const theme={id:'cat',videos:['a','b','c'],video:'fallback'};
test('each shuffled cycle contains all clips once and avoids repeating across cycle boundaries',()=>{
  for(const random of [()=>0,()=>.5,()=>.999])for(const previous of [null,'a','b','c']){
    const cycle=shuffledCycle(['a','b','c','a'],previous,random);
    assert.deepEqual([...cycle].sort(),['a','b','c']);assert.notEqual(cycle[0],previous);
  }
});
test('ending advances clips without repetition; refreshing same theme does not restart current clip',()=>{
  const media=new Media(),p=createBackgroundPlaylist(media,{random:()=>.5});p.setEnabled(true);p.setTheme(theme);
  const seen=[media.src];for(let i=0;i<5;i++){const old=media.src;media.end();assert.notEqual(media.src,old);seen.push(media.src);}
  assert.equal(new Set(seen.slice(0,3)).size,3);assert.equal(new Set(seen.slice(3)).size,3);
  const count=media.loads.length;p.setTheme({...theme});assert.equal(media.loads.length,count);
  assert.equal(media.muted,true);assert.equal(media.loop,false);assert.equal(media.autoplay,false);
});
test('inactive previews and low-power pages do not autoplay or advance; resuming keeps current clip',()=>{
  const media=new Media(),p=createBackgroundPlaylist(media);p.setTheme(theme);assert.equal(media.plays,0);
  p.setEnabled(true);const src=media.src,plays=media.plays;p.setEnabled(false);media.end();assert.equal(media.src,src);assert.equal(media.plays,plays);assert.equal(media.paused,true);
  p.setEnabled(true,{play:false});assert.equal(media.plays,plays);p.setEnabled(true);assert.equal(media.src,src);assert.equal(media.paused,false);
});
test('bad clips are skipped, all-bad library uses bundled fallback, fallback failure stops boundedly',()=>{
  const media=new Media();let failures=0;const p=createBackgroundPlaylist(media,{onFailure:()=>failures++});p.setEnabled(true);p.setTheme(theme);
  for(let i=0;i<3;i++)media.fail();assert.equal(media.src,'fallback');media.fail();assert.equal(failures,1);assert.equal(media.loads.length,4);assert.equal(media.paused,true);
  media.fail();assert.equal(failures,1);assert.equal(media.loads.length,4);
  p.setTheme({id:'dog',video:'dog-fallback',videos:['dog']});assert.equal(media.src,'dog');assert.equal(media.paused,false);
});
test('all built-in, fallback, active and reviewed video bytes match their approved hashes',async()=>{
 const {validateSchoolVideos}=await import('../scripts/validate-school-videos.mjs');assert.deepEqual(await validateSchoolVideos(),{approved:8,active:6});
 for(const theme of THEMES){assert.equal(theme.videos.length,theme.id==='basic'?0:3);for(const src of [theme.video,...theme.videos].filter(Boolean))assert.ok(THEME_MEDIA.includes(src.replace('theme-media/','')));}
});
test('a newer weekly revision replaces media even when the selected theme stays the same',()=>{const media=new Media(),p=createBackgroundPlaylist(media);p.setTheme({...theme,libraryRevision:'one'});const count=media.loads.length;p.setTheme({...theme,libraryRevision:'two',videos:['weekly-new']});assert.equal(media.loads.length,count+1);assert.equal(media.src,'weekly-new');});
