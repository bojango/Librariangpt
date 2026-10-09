import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchCoverImage, coverUrl } from '../../supabase/functions/_shared/cover-fetch.js';
test('URL covers reject private literal destinations, invalid bytes, oversized streams and unsafe redirects',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 for(const url of ['file:///tmp/test','http://127.0.0.1/test','http://[::1]/test','https://localhost/test','http://host.internal/test','https://user:pass@example.com/cover'])assert.throws(()=>coverUrl(url));
 const png=await readFile('icons/icon-192.png');
 globalThis.fetch=async()=>new Response(png,{headers:{'content-type':'image/png'}});assert.equal((await fetchCoverImage('https://images.example.com/cover')).bytes.length,png.length);
 globalThis.fetch=async()=>new Response('invalid',{headers:{'content-type':'image/png'}});await assert.rejects(fetchCoverImage('https://images.example.com/cover'),/not a supported/);
 globalThis.fetch=async()=>new Response('',{status:302,headers:{location:'http://127.0.0.1/secret'}});await assert.rejects(fetchCoverImage('https://images.example.com/cover'),/public/);
 globalThis.fetch=async()=>new Response(new Uint8Array(5*1024*1024+1),{headers:{'content-type':'image/png'}});await assert.rejects(fetchCoverImage('https://images.example.com/cover'),/5 MB/);
});
