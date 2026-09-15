import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('generation 59 document, worker and built app remain coherent with no generation-58 cache reference', async () => {
  const [html, worker, built] = await Promise.all([
    readFile('index.html', 'utf8'),
    readFile('sw.js', 'utf8'),
    readFile('dist/app.js', 'utf8')
  ]);
  assert.match(html, /reading-room-generation" content="59"/);
  assert.match(html, /dist\/app\.js\?v=59/);
  assert.match(worker, /const GENERATION = '59'/);
  assert.match(worker, /reading-room-shell-v\$\{GENERATION\}/);
  assert.match(worker, /key\.startsWith\('reading-room-shell-'\) && key !== SHELL/);
  assert.doesNotMatch(`${html}\n${worker}`, /(?:generation|shell|app\.js\?v=)[^\n]{0,20}58/i);
  assert.match(built, /book-librarian-note/);
  assert.doesNotMatch(built, /readingCardNotes/);
});
