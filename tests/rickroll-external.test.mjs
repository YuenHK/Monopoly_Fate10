import test from 'node:test';
import assert from 'node:assert/strict';
import {themeById,RICKROLL_VIDEO} from '../themes.js';
import {withBackgroundLibrary} from '../background-library.js';
import {filterThemeMedia} from '../media-policy.js';
import {mediaCatalog} from '../media-catalog.mjs';
test('meme theme offers only canonical official watch link and never resurrects background clips',async()=>{
 const theme=await withBackgroundLibrary(themeById('basic'),{policy:{revision:0,blocked:[]}});
 assert.equal(theme.video,null);assert.deepEqual(theme.videos,[]);assert.equal(theme.externalVideo.url,'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
 const videos=mediaCatalog().filter(m=>m.kind==='video'&&m.themes.includes('basic'));assert.equal(videos.length,1);assert.equal(videos[0].playback,'external');assert.equal(videos[0].url,RICKROLL_VIDEO.url);
});
test('teacher ban or unavailable policy hides external link while keeping pet backgrounds separate',()=>{
 const theme=themeById('basic');assert.equal(filterThemeMedia(theme,null).externalVideo,null);
 const policy={revision:2,blocked:[RICKROLL_VIDEO.key]};assert.equal(filterThemeMedia(theme,policy).externalVideo,null);assert.ok(filterThemeMedia(themeById('cat'),policy).videos.length);
});
