import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanIsbn, dedupeResults, exactIsbnMatch, isValidIsbn, normaliseText, titleAuthorKey } from '../../src/utils/text.js';

test('validates and normalises ISBN-10 and ISBN-13', () => {
  assert.equal(cleanIsbn('978-0-306-40615-7'), '9780306406157');
  assert.equal(isValidIsbn('978-0-306-40615-7'), true);
  assert.equal(isValidIsbn('0-306-40615-2'), true);
});

test('accepts only the same ISBN as an exact provider match', () => {
  assert.equal(exactIsbnMatch('9780306406157', { isbn13: '978-0-306-40615-7' }), true);
  assert.equal(exactIsbnMatch('9780306406157', { isbn13: '9780143127741' }), false);
});

test('deduplicates results by ISBN and then title/author identity', () => {
  const results = dedupeResults([
    { title: 'The Book', authors: ['A. Writer'], isbn13: '9780306406157' },
    { title: 'Book', authors: ['A Writer'], isbn13: '978-0-306-40615-7' },
    { title: 'Another Book', authors: ['B Writer'] },
    { title: 'Another Book!', authors: ['B. Writer'] }
  ]);
  assert.equal(results.length, 2);
});

test('normalises title and author matching consistently', () => {
  assert.equal(normaliseText('The Café — A Story'), 'cafe a story');
  assert.equal(titleAuthorKey('The Book', 'A. Writer'), titleAuthorKey('Book', 'A Writer'));
});
