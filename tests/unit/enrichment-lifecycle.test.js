import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildEditionEnrichmentPatch,
  chooseReferenceEdition,
  mergeEditionCandidates,
  sameEdition,
  shouldAutoSelectReference
} from '../../supabase/functions/_shared/edition-ranking.js';

const workId = 'OL5724837W';
const printEdition = {
  id: 'print-reference', owned: false, preferred_copy: false, exact_copy_verified: false,
  open_library_edition_id: 'OL100M', open_library_work_id: workId,
  isbn13: '9780306406157', language: 'English', format: 'Paperback',
  cover_url: 'https://covers.openlibrary.org/b/id/1-L.jpg?default=false',
  page_count: 560, publisher: 'Gollancz', publication_year: 2009,
  metadata_payload: { open_library: { key: '/books/OL100M' } }
};
const audioEdition = {
  ...printEdition, id: 'audio-reference', open_library_edition_id: 'OL200M',
  isbn13: '9783161484100', format: 'Audiobook', page_count: null
};

test('thin wishlist book deterministically receives a credible print reference edition', () => {
  const book = { overall_status: 'Wishlist', ownership_status: 'Not Owned', current_edition_id: null, reference_edition_id: null };
  assert.equal(shouldAutoSelectReference(book, [audioEdition, printEdition]), true);
  assert.equal(chooseReferenceEdition([audioEdition, printEdition], { workId }).id, 'print-reference');
  assert.equal(chooseReferenceEdition([printEdition, audioEdition], { workId }).id, 'print-reference');
});

test('discovered Open Library editions remain a usable fallback when direct Google lookup has no candidate', () => {
  const fallback = chooseReferenceEdition([audioEdition, printEdition], { workId });
  assert.equal(fallback.open_library_work_id, workId);
  assert.equal(fallback.isbn13, '9780306406157');
  assert.ok(fallback.cover_url);
  assert.equal(fallback.page_count, 560);
});

test('owned and verified copies are never auto-selected as generic references or overwritten', () => {
  const owned = {
    ...printEdition, id: 'owned-copy', owned: true, preferred_copy: true, exact_copy_verified: true,
    identity_locked: true, cover_locked: true, cover_uploaded_by_user: true,
    isbn13: '9780306406157', publisher: 'My exact publisher', page_count: 543, cover_url: 'user-upload.jpg',
    open_library_work_id: null
  };
  const book = { ownership_status: 'Owned', current_edition_id: owned.id, reference_edition_id: null };
  assert.equal(shouldAutoSelectReference(book, [owned, printEdition]), false);
  const patch = buildEditionEnrichmentPatch(owned, {
    isbn13: '9783161484100', publisher: 'Generic publisher', page_count: 999,
    cover_url: 'generic.jpg', open_library_work_id: workId
  }, '2026-09-15T00:00:00.000Z');
  assert.equal(patch.isbn13, undefined);
  assert.equal(patch.publisher, undefined);
  assert.equal(patch.page_count, undefined);
  assert.equal(patch.cover_url, undefined);
  assert.equal(patch.open_library_work_id, workId);
});

test('repeat refresh merges provider identities without duplicate editions and keeps a stable reference', () => {
  const google = {
    isbn13: '9780306406157', google_books_volume_id: 'google-1', publisher: 'Gollancz',
    metadata_payload: { google_books: { id: 'google-1' } }
  };
  const mergedOnce = mergeEditionCandidates([printEdition, google]);
  const mergedTwice = mergeEditionCandidates([...mergedOnce, google, printEdition]);
  assert.equal(mergedOnce.length, 1);
  assert.equal(mergedTwice.length, 1);
  assert.equal(mergedTwice[0].open_library_edition_id, 'OL100M');
  assert.equal(mergedTwice[0].google_books_volume_id, 'google-1');
  assert.equal(sameEdition(mergedTwice[0], printEdition), true);
});

test('edge-function sources enforce discovery-first orchestration and terminal states', async () => {
  const [editionSource, contentSource, backgroundSource, frontendSource] = await Promise.all([
    readFile('supabase/functions/edition-options/index.ts', 'utf8'),
    readFile('supabase/functions/content-enrichment/index.ts', 'utf8'),
    readFile('supabase/functions/book-background-enrich/index.ts', 'utf8'),
    readFile('src/features/reading-actions.js', 'utf8')
  ]);

  assert.doesNotMatch(editionSource, /from\('books'\)\.select\([^\n]*open_library_work_id/);
  assert.doesNotMatch(editionSource, /bookPatch\.open_library_work_id/);
  assert.ok(backgroundSource.indexOf("call('edition-options'") < backgroundSource.indexOf("call('content-enrichment'"));
  assert.match(backgroundSource, /state\.editions_status === 'refreshing'/);
  assert.match(backgroundSource, /state\.metadata_status === 'resolving'/);
  assert.match(contentSource, /resolver_v8_edition_fallback/);
  assert.match(contentSource, /chooseReferenceEdition\(loadedEditions/);
  assert.match(frontendSource, /invoke\('book-background-enrich'/);
  assert.doesNotMatch(frontendSource, /Promise\.allSettled\(\[invoke\('content-enrichment'/);
});
