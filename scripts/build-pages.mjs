import {mkdir,writeFile,readFile,copyFile,cp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
const value = process.env.RENDER_APP_URL;
if(!value)throw new Error('請先設定 GitHub Repository Variable：RENDER_APP_URL');
const url = new URL(value);
if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('RENDER_APP_URL 須為 HTTPS 服務根網址');
const out=resolve('pages-dist');
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});
// Publish only the public board and its assets; admin, upload and private data stay on Render.
for(const file of ['app.js','shared.js','ui.css','board.css','celebration.js','favicon.svg','themes.js','background-playlist.js','themes.css'])await copyFile(file,resolve(out,file));
for(const dir of ['sound','theme-media'])await cp(dir,resolve(out,dir),{recursive:true});
const html=(await readFile('index.html','utf8')).replace('<script type="module"','<script src="play-config.js"></script><script type="module"');
await writeFile(resolve(out,'index.html'),html);
await writeFile(resolve(out,'play-config.js'),'globalThis.MONOPOLY_API_ORIGIN='+JSON.stringify(url.origin)+';\n');
await writeFile(resolve(out,'.nojekyll'),'');
console.log('GitHub Pages 棋盤已建立；後台及資料服務：'+url.origin);
