import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('generation 88 document, worker and built app remain coherent with no generation-87 cache reference', async () => {
  const [html, worker, built] = await Promise.all([
    readFile('index.html', 'utf8'),
    readFile('sw.js', 'utf8'),
    readFile('dist/app.js', 'utf8')
  ]);
  assert.match(html, /reading-room-generation" content="87"/);
  assert.match(html, /dist\/app\.js\?v=87/);
  assert.match(worker, /const GENERATION = '88'/);
  assert.match(worker, /reading-room-shell-v\$\{GENERATION\}/);
  assert.match(worker, /jetbrains-mono-regular\.ttf/);
  assert.match(worker, /jetbrains-mono-semibold\.ttf/);
  assert.match(worker, /commit-mono-regular\.woff2/);
  assert.match(worker, /ibm-plex-mono-regular\.woff2/);
  assert.match(worker, /space-mono-regular\.woff2/);
  assert.match(worker, /key\.startsWith\('reading-room-shell-'\) && key !== SHELL/);
  assert.doesNotMatch(`${html}\n${worker}`, /(?:generation|shell|app\.js\?v=)[^\n]{0,20}87/i);
  assert.match(built, /book-librarian-note/);
  assert.doesNotMatch(built, /readingCardNotes/);
});
