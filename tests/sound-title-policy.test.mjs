import test from 'node:test';
import assert from 'node:assert/strict';
import {soundTitleReason,validMemeSound} from '../sound-title-policy.js';
import {readFileSync} from 'node:fs';
test('title screening rejects profanity, adult, shock and disguised names without removing harmless memes',()=>{
 for(const name of ['Fahhh_FUCK','ＦＵＣＫ','f u c k','Shut up BITCH','你妈鸡掰','幹你娘','咪撚玩','呻吟','音效-pornhub','傑哥：讓我看看','暴音版','希特勒貓','館長_我中了兩槍','S H I T'])assert.ok(soundTitleReason(name),name);
 for(const name of ['BRUH','不要瞎掰好嗎','雞塊歌','笑死','台鐵到站聲音','Womp Womp','Discord Notification','you win','peacock'])assert.equal(soundTitleReason(name),null,name);
});
test('original catalog stays complete on disk; eligible playback accepts only trusted source links',()=>{
 const all=JSON.parse(readFileSync(new URL('../sound-catalog.json',import.meta.url))).items;
 assert.equal(all.length,1135);const allowed=all.filter(validMemeSound);assert.ok(allowed.length>800);assert.ok(allowed.every(s=>!soundTitleReason(s.name)));
 const s=allowed[0];for(const url of ['https://evil.test/a.mp3',s.url+'?redirect=x',s.url.replace('https:','http:')])assert.equal(validMemeSound({...s,url}),false);
});
