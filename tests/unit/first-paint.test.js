import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { coverMarkup } from '../../src/ui/cover.js';
import { currentTitleClass, currentTitlePresentation } from '../../src/utils/text.js';

test('classifies current-reading titles before rendering', () => {
  assert.equal(currentTitleClass('Outpost'), '');
  assert.equal(currentTitleClass('The Remains of the Day'), '');
  assert.equal(currentTitleClass('The Unfinished Harauld Hughes'), 'current-title-compact-v37');
  assert.equal(currentTitleClass('The Unfinished Works of Harauld Hughes'), 'current-title-compact-v37');
  assert.equal(currentTitleClass('A Very Long Chronicle of Everything We Almost Remembered About the World'), 'current-title-tight-v37');
});

test('long-title presentation contains its final inline first-paint size', () => {
  assert.deepEqual(currentTitlePresentation('The Unfinished Harauld Hughes'), {
    className: 'current-title-compact-v37',
    style: 'font-size:clamp(31px,5.2vw,58px)!important;line-height:.96!important'
  });
  assert.deepEqual(currentTitlePresentation('Outpost'), { className: '', style: '' });
});

test('cover markup starts image loading with explicit priority', () => {
  const book = { id: 'book-1', title: 'Book & One', cover_url: '/cover-one.jpg' };
  const hero = coverMarkup(book, '', { eager: true, high: true });
  const offscreen = coverMarkup(book);
  assert.match(hero, /src="\/cover-one\.jpg"/);
  assert.match(hero, /loading="eager"/);
  assert.match(hero, /fetchpriority="high"/);
  assert.match(offscreen, /loading="lazy"/);
  assert.match(offscreen, /fetchpriority="auto"/);
  assert.doesNotMatch(hero, /data-cover-src/);
  assert.match(hero, /width="400" height="600"/);
});

test('cover CSS reserves a 2:3 box without an opacity reveal gate', async () => {
  const css = await readFile('src/styles/app.css', 'utf8');
  assert.match(css, /\.cover[^\n{]*\{[^\n}]*aspect-ratio:\s*2\s*\/\s*3/);
  assert.doesNotMatch(css, /\.cover(?:\.cover-loaded)?[^\n{]*>\.cover-image\s*\{[^\n}]*opacity\s*:/);
});
