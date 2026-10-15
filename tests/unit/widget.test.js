import test from 'node:test';
import assert from 'node:assert/strict';
import { smallCover, widgetBook, loadCurrentBook, WIDGET_FIELDS } from '../../widgets/currently-reading/model.js';
import { cookieStore } from '../../widgets/currently-reading/storage.js';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

function cookies() {
  const values = new Map();
  const writes = [];
  return {
    writes,
    get cookie() { return [...values].map(([key, value]) => `${key}=${value}`).join('; '); },
    set cookie(value) {
      writes.push(value);
      const [pair] = value.split(';');
      const index = pair.indexOf('=');
      const key = pair.slice(0, index);
      if (value.includes('Max-Age=0;')) values.delete(key);
      else values.set(key, pair.slice(index + 1));
    }
  };
}

test('widget requests one current book with the homepage ordering and only required fields', async () => {
  const calls = [];
  const result = { data: [{ id:'b', title:'The Test Book', authors:'Example Author', overall_status:'Currently Reading', current_page:42, total_pages:210, progress_percent:20.1 }] };
  const query = { then: resolve => Promise.resolve(result).then(resolve) };
  for (const method of ['select','eq','order','limit','abortSignal']) query[method] = (...args) => { calls.push([method, ...args]); return query; };
  const book = await loadCurrentBook({ from: name => { assert.equal(name, 'v_library'); return query; } }, 'signal');
  assert.deepEqual(calls, [['select',WIDGET_FIELDS],['eq','overall_status','Currently Reading'],['order','started_at',{ ascending:false, nullsFirst:false }],['order','title'],['limit',1],['abortSignal','signal']]);
  assert.equal(book.percent, 20);
  assert.equal(book.pages, 42);
  assert.equal(book.total, 210);
  query.then = resolve => Promise.resolve({ error: { status:401 } }).then(resolve);
  await assert.rejects(loadCurrentBook({ from: () => query }), { status:401 });
});

test('widget preserves canonical progress, clamps extremes and does not invent unknown totals', () => {
  assert.equal(widgetBook(null), null);
  for (const [value, expected] of [[0,0],[100,100],[-3,0],[104,100],[NaN,0]]) {
    assert.equal(widgetBook({ total_pages:100, progress_percent:value }).percent, expected);
  }
  assert.equal(widgetBook({ current_page:12 }).percent, null);
  assert.equal(widgetBook({ current_page:12 }).total, null);
});

test('covers use bounded providers and reject secrets, arbitrary downloads and unsafe schemes', () => {
  assert.equal(smallCover('https://covers.openlibrary.org/b/id/285979-L.jpg?token=secret'), 'https://covers.openlibrary.org/b/id/285979-M.jpg?default=false');
  assert.match(smallCover('https://books.google.com/books/content?id=abc&zoom=9&token=secret'), /zoom=1/);
  for (const value of ['javascript:alert(1)','data:image/png,huge','https://example.com/original.jpg','https://user:pass@covers.openlibrary.org/b/id/12-L.jpg','https://covers.openlibrary.org/large.png']) assert.equal(smallCover(value), '');
});

test('widget cookies are bounded, scoped, secure and exclude account metadata', () => {
  const doc = cookies();
  const store = cookieStore(doc, { href:'https://bojango.github.io/Librariangpt/widgets/currently-reading/setup.html', protocol:'https:' });
  store.setSession(JSON.stringify({ access_token:'access', refresh_token:'refresh', expires_at:123, user:{ id:'user-1', email:'private@example.com' }, provider_token:'secret' }));
  assert.equal(JSON.parse(store.getSession()).user.id, 'user-1');
  assert.doesNotMatch(doc.cookie, /private|provider_token/);
  assert.match(doc.writes[0], /Path=\/Librariangpt\/widgets\/currently-reading\/;.*SameSite=Strict; Secure/);
  store.setSnapshot('user-1', { title:'A book' }, 1000);
  assert.equal(store.getSnapshot('user-1', 2000).book.title, 'A book');
  assert.equal(store.getSnapshot('user-2', 2000), null);
  assert.equal(store.getSnapshot('user-1', 1000 + 86400000), null);
  assert.equal(store.getSnapshot('user-1', 999), null);
  store.setSnapshot('user-1', { title:'x'.repeat(3000) });
  assert.equal(store.getSnapshot('user-1'), null);
  store.clear();
  assert.equal(doc.cookie, '');
});

test('the PWA worker never substitutes its shell for widget navigation or setup assets', async () => {
  const listeners = {};
  vm.runInNewContext(await readFile('sw.js','utf8'), {
    self: { location:{ origin:'https://bojango.github.io' }, addEventListener:(type,listener) => { listeners[type] = listener; } }, URL
  });
  for (const path of ['index.html','setup.html','widget.css']) {
    listeners.fetch({
      request:{ method:'GET',url:`https://bojango.github.io/Librariangpt/widgets/currently-reading/${path}`,destination:'document',mode:'navigate' },
      respondWith() { assert.fail('The PWA worker must not serve widget pages.'); }
    });
  }
});
