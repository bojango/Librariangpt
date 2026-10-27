// Verify the shared Pages deployment without touching authenticated reader data.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,webkit} from '@playwright/test';
const base='https://bojango.github.io/Librariangpt/';
const generation='125';
const textFiles=['index.html','sw.js','src/styles/app.css','dist/app.js','supabase-config.js','manifest.webmanifest'];
const evidence={url:base,verified_at:new Date().toISOString(),generation,assets:[],browser_checks:[],authenticated_owner_check:'Not performed: browser is signed out'};
for(const file of textFiles) {
 const response=await fetch(`${base}${file}?review=${Date.now()}`,{cache:'no-store'});
 assert.equal(response.status,200,file);
 const actual=(await response.text()).replaceAll('\r\n','\n'),expected=(await readFile(file,'utf8')).replaceAll('\r\n','\n');
 assert.equal(actual,expected,`${file} must match this feature checkout`);
 evidence.assets.push({file,status:response.status,sha256:createHash('sha256').update(actual).digest('hex')});
}
const worker=await readFile('sw.js','utf8');
const shell=worker.split('const APP_SHELL = [')[1].split('];')[0];
const urls=[...shell.matchAll(/['`](\.\/[^'`]+)['`]/g)].map(m=>m[1].replaceAll('${GENERATION}',generation));
for(const url of urls) {
 const response=await fetch(new URL(url,base));
 assert.equal(response.status,200,`PWA asset ${url}`);
 await response.arrayBuffer();
}
evidence.pwa_shell_assets=urls.length;
await mkdir('output/collections/live',{recursive:true});
for(const [engine,type] of Object.entries({chromium,webkit})) {
 const browser=await type.launch();
 try {
  for(const theme of ['reading-room','terminal']) {
   const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'allow'});
   await page.addInitScript(theme=>localStorage.setItem('reading-room-theme',theme),theme);
   const errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(`${base}#/collections`);
   await page.getByRole('heading',{name:'Your library.',exact:true}).waitFor();
   assert.equal(await page.locator('meta[name="reading-room-generation"]').getAttribute('content'),generation);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.evaluate(async()=>{if('serviceWorker' in navigator) await navigator.serviceWorker.ready;});
   await page.reload();await page.getByRole('heading',{name:'Your library.',exact:true}).waitFor();
   const shellKeys=await page.evaluate(()=>caches.keys());
   assert.ok(shellKeys.includes(`reading-room-shell-v${generation}`));
   assert.equal(shellKeys.some(key=>key.startsWith('reading-room-shell-')&&key!==`reading-room-shell-v${generation}`),false);
   assert.deepEqual(errors,[]);
   await page.screenshot({path:`output/collections/live/live-auth-${engine}-${theme}.png`});
   evidence.browser_checks.push({engine,theme,width:390,auth_shell:'passed',reload:'passed',pwa_cache:'passed',overflow:false,page_errors:0});
   await page.close();
  }
 } finally {await browser.close();}
}
await writeFile('output/collections/preview-verification.json',JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
