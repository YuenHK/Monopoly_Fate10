import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {resolve,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {THEMES,SCHOOL_VIDEO_ASSETS} from '../themes.js';import {validateLibrary} from '../background-library.js';
export async function validateSchoolVideos(root=resolve(dirname(fileURLToPath(import.meta.url)),'..')){
 const media=resolve(root,'theme-media'),catalog=JSON.parse(await readFile(resolve(media,'approved-catalog.json'),'utf8')),manifest=JSON.parse(await readFile(resolve(media,'library.json'),'utf8'));
 if(catalog.policy!=='school-v1'||!validateLibrary(manifest))throw Error('Unreviewed school library');
 const entries=new Map();for(const c of catalog.entries){if(!/^approved\/[a-z0-9-]+\.mp4$/.test(c.asset)||entries.has(c.asset)||c.review?.status!=='approved'||c.review?.policy!=='school-v1')throw Error('Invalid approved catalog');const b=await readFile(resolve(media,c.asset));if(createHash('sha256').update(b).digest('hex')!==c.sha256)throw Error('Reviewed file changed: '+c.asset);entries.set(c.asset,c);}
 for(const [theme,assets] of Object.entries(SCHOOL_VIDEO_ASSETS))for(const asset of assets){if(!entries.get(asset)?.themes.includes(theme))throw Error('Unreviewed built-in video: '+asset);}
 for(const theme of THEMES){if(theme.video&&!entries.get(theme.video.replace('theme-media/',''))?.themes.includes(theme.id))throw Error('Unreviewed fallback');}
 for(const c of manifest.clips){const approved=entries.get(c.asset);if(!approved?.themes.includes(c.theme)||approved.sha256!==c.sha256)throw Error('Unreviewed playlist entry');const b=await readFile(resolve(media,c.file));if(createHash('sha256').update(b).digest('hex')!==approved.sha256)throw Error('Active clip changed: '+c.file);}
 return {approved:entries.size,active:manifest.clips.length};
}
