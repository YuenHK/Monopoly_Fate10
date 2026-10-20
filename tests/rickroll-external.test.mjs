import test from 'node:test';
import assert from 'node:assert/strict';
import {themeById} from '../themes.js';
import {withBackgroundLibrary} from '../background-library.js';
import {filterThemeMedia} from '../media-policy.js';
import {mediaCatalog} from '../media-catalog.mjs';
test('meme theme loops only the supplied licensed MP4 without an external watch link',async()=>{
 const theme=await withBackgroundLibrary(themeById('basic'),{policy:{revision:0,blocked:[]}});
 assert.equal(theme.video,'theme-media/approved/rickroll-original.mp4');assert.deepEqual(theme.videos,[theme.video]);assert.ok(!theme.externalVideo);
 const videos=mediaCatalog().filter(m=>m.kind==='video'&&m.themes.includes('basic'));assert.equal(videos.length,1);assert.ok(!videos[0].playback);assert.match(videos[0].url,/rickroll-original\.mp4\?v=[a-f0-9]{64}$/);
});
test('new and legacy teacher bans stop the supplied background without affecting pet videos',()=>{
 const theme=themeById('basic');assert.equal(filterThemeMedia(theme,null).video,null);
 for(const key of ['video:approved/rickroll-original.mp4','video:rickroll-original']){
  const policy={revision:2,blocked:[key]},blocked=filterThemeMedia(theme,policy);assert.equal(blocked.video,null);assert.deepEqual(blocked.videos,[]);assert.ok(filterThemeMedia(themeById('cat'),policy).videos.length);
 }
});
