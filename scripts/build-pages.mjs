import {mkdir,writeFile} from 'node:fs/promises';
const value = process.env.RENDER_APP_URL;
if(!value)throw new Error('請先設定 GitHub Repository Variable：RENDER_APP_URL');
const url = new URL(value);
if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('RENDER_APP_URL 須為 HTTPS 服務根網址，例如 https://your-app.onrender.com');
await mkdir('pages-dist',{recursive:true});
// Keep authentication and uploads on the same origin; Pages is a public entry point only.
const escaped = url.origin.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const html = `<!doctype html><html lang="zh-HK"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>大富翁抽籤｜課堂入口</title><style>body{font-family:system-ui;background:#edf2e6;color:#263f37;margin:0;padding:12vh 24px}main{max-width:560px;margin:auto;background:#fffdf5;padding:38px;border-radius:18px;border:1px solid #c7d0c4}a{display:inline-block;background:#cf3444;color:#fff;padding:14px 24px;border-radius:9px;text-decoration:none;font-weight:700}p{line-height:1.8;color:#5b6e61}</style></head><body><main><h1>🎲 大富翁抽籤</h1><p>命運加強版 · 班別管理 · 課堂統計</p><a href="${escaped}/">進入課堂網站 →</a><p>教師請在課堂網站登入管理後台。學生請使用老師提供的個人頭像連結。免費服務首次開啟可能需要稍候。</p></main></body></html>`;
await writeFile('pages-dist/index.html',html);
await writeFile('pages-dist/.nojekyll','');
console.log('GitHub Pages 入口已建立');
