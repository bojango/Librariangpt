import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { carouselStart, currentReadingSignature } from '../../src/utils/carousel-memory.js';
import { upNextManagerRows } from '../../src/features/up-next-markup.js';
import { currentlyReadingBooks, homeRecommendations, homeView, VISIBLE_UP_NEXT_COUNT } from '../../src/views/home.js';

function state(overrides = {}) {
  return {
    books: [],
    chapters: [],
    upNext: [],
    aiRecommendations: [],
    ...overrides
  };
}

function queue(count, start = 1) {
  return Array.from({ length: count }, (_, index) => {
    const position = start + index;
    return { queue_id: `queue-${position}`, id: `book-${position}`, title: `Queue ${position}`, position, source: 'AI' };
  });
}

function recommendations(count, featured = 0) {
  return Array.from({ length: count }, (_, index) => ({
    recommendation_id: `rec-${index + 1}`,
    id: `book-${index + 1}`,
    title: `Recommendation ${index + 1}`,
    display_rank: index + 1,
    frontend_featured: index < featured
  }));
}

test('currently reading books sort by safe started_at descending', () => {
  const sorted = currentlyReadingBooks([
    { id: 'old', overall_status: 'Currently Reading', started_at: '2026-07-28' },
    { id: 'invalid', overall_status: 'Currently Reading', started_at: 'not-a-date' },
    { id: 'new', overall_status: 'Currently Reading', started_at: '2026-09-12' },
    { id: 'missing', overall_status: 'Currently Reading' },
    { id: 'other', overall_status: 'Read', started_at: '2030-01-01' }
  ]);
  assert.deepEqual(sorted.map(book => book.id), ['new', 'old', 'invalid', 'missing']);
});

test('carousel memory resets for changed membership and survives unchanged membership', () => {
  const ids = ['new', 'old'];
  const signature = currentReadingSignature(ids);
  assert.deepEqual(carouselStart(ids, 'old', signature), { signature, index: 1 });
  assert.deepEqual(carouselStart(['newest', ...ids], 'old', signature), {
    signature: currentReadingSignature(['newest', ...ids]),
    index: 0
  });
});

test('Home renders five Up Next entries and never renders reserve positions', () => {
  const fullQueue = queue(8);
  const html = homeView(state({ upNext: fullQueue }));
  assert.equal(VISIBLE_UP_NEXT_COUNT, 5);
  assert.equal((html.match(/data-upnext-id=/g) || []).length, 5);
  assert.ok(html.includes('data-upnext-id="queue-5"'));
  assert.ok(!html.includes('data-upnext-id="queue-6"'));
  assert.equal((upNextManagerRows(fullQueue).match(/data-queue-id=/g) || []).length, 8);
});

test('renumbered reserve becomes the visible fifth Up Next entry', () => {
  const promoted = queue(7, 2).map((item, index) => ({ ...item, position: index + 1 }));
  const html = homeView(state({ upNext: promoted }));
  assert.equal((html.match(/data-upnext-id=/g) || []).length, 5);
  assert.ok(html.includes('data-upnext-id="queue-6"'));
  assert.ok(!html.includes('data-upnext-id="queue-7"'));
});

test('recommendation selection prioritises featured picks and backfills to five', () => {
  assert.deepEqual(homeRecommendations(recommendations(5, 5)).map(item => item.recommendation_id), ['rec-1', 'rec-2', 'rec-3', 'rec-4', 'rec-5']);
  assert.deepEqual(homeRecommendations(recommendations(12, 2)).map(item => item.recommendation_id), ['rec-1', 'rec-2', 'rec-3', 'rec-4', 'rec-5']);

  const remaining = recommendations(7, 2).filter(item => item.recommendation_id !== 'rec-2');
  assert.deepEqual(homeRecommendations(remaining).map(item => item.recommendation_id), ['rec-1', 'rec-3', 'rec-4', 'rec-5', 'rec-6']);
});

test('recommendation selection deduplicates recommendation and book identities', () => {
  const items = recommendations(6, 2);
  items.splice(2, 0, { ...items[0], recommendation_id: 'duplicate-recommendation' });
  items.splice(4, 0, { ...items[3] });
  const picks = homeRecommendations(items);
  assert.equal(picks.length, 5);
  assert.equal(new Set(picks.map(item => item.recommendation_id)).size, 5);
  assert.equal(new Set(picks.map(item => item.id)).size, 5);
});

test('Home See more uses the recommendations route', () => {
  const html = homeView(state({ aiRecommendations: recommendations(1) }));
  assert.match(html, /data-route="recommendations"/);
  assert.doesNotMatch(html, /data-recommendations-page/);
});

test('On order appears only when populated and is excluded from the Home Wishlist shelf', () => {
  const withoutOrders = homeView(state({ books: [{ id: 'wish', title: 'Wish', overall_status: 'Wishlist', ownership_status: 'Not Owned' }] }));
  assert.doesNotMatch(withoutOrders, />On order</);

  const withOrders = homeView(state({ books: [
    { id: 'order', title: 'Incoming', authors: 'Author', overall_status: 'Wishlist', ownership_status: 'On Order' },
    { id: 'unread', title: 'Unread', authors: 'Author', overall_status: 'Owned - Unread', ownership_status: 'Owned' },
    { id: 'wish', title: 'Wish', authors: 'Author', overall_status: 'Wishlist', ownership_status: 'Not Owned' }
  ] }));
  assert.match(withOrders, />On order</);
  assert.ok(withOrders.indexOf('>On order<') < withOrders.indexOf('>Owned &amp; unread<'));
  assert.equal((withOrders.match(/data-open-book="order"/g) || []).length, 1);
  const wishlistStart = withOrders.indexOf('>Wishlist<');
  const recentStart = withOrders.indexOf('>Recently finished<');
  assert.doesNotMatch(withOrders.slice(wishlistStart, recentStart), /data-open-book="order"/);
});

test('current chapter renders only when supplied and Home never renders Librarian notes', () => {
  const book = { id: 'current', title: 'Current', authors: 'Reader', overall_status: 'Currently Reading', current_page: 50, total_pages: 100 };
  const html = homeView(state({
    books: [book],
    chapters: [{ id: 'current', current_chapter_number: '4', current_chapter_title: 'Return' }]
  }));
  assert.match(html, /Chapter 4: Return/);
  assert.doesNotMatch(html, /Librarian note|librarian-note|book-librarian-note/);

  const withoutContext = homeView(state({ books: [book] }));
  assert.doesNotMatch(withoutContext, /chapter-progress-line/);
  assert.doesNotMatch(withoutContext, /librarian-note/);
});

test('current-reading progress styling is scoped and leaves progress maths unchanged', async () => {
  const css = await readFile('src/styles/app.css', 'utf8');
  assert.match(css, /\.current-reading-card-v36 \.progress-track\{height:10px/);
  assert.equal((50 / 100) * 100, 50);
});

test('mobile current-reading cards use compact content-driven height and scoped spacing', async () => {
  const [css, carousel] = await Promise.all([
    readFile('src/styles/app.css', 'utf8'),
    readFile('src/features/current-reading-carousel.js', 'utf8')
  ]);
  assert.match(css, /\.current-reading-track-v36\{align-items:flex-start\}/);
  assert.match(css, /@media\(max-width:700px\)\{[\s\S]*?\.current-reading-track-v36>\.hero\.current-reading-card-v36\{height:auto!important;min-height:292px!important;max-height:none!important;overflow:visible!important;padding:14px!important\}/);
  assert.match(css, /\.current-reading-card-v36 \.progress-block\{margin:14px 0 11px!important\}/);
  assert.match(css, /\.current-reading-card-v36 \.hero-actions\{margin-top:12px!important;\}/);
  assert.doesNotMatch(css, /@media\(max-width:700px\)\{\.current-reading-track-v36>\.hero\.current-reading-card-v36\{height:420px/);
  assert.doesNotMatch(css, /\.current-reading-track-v36>\.hero\.current-reading-card-v36\{height:420px/);
  assert.match(css, /\.current-reading-track-v36\{[^}]*scroll-behavior:auto/);
  assert.doesNotMatch(css, /\.current-reading-track-v36\s*\{\s*transition:\s*height/);
  assert.doesNotMatch(carousel, /track\.style\.height/);
  assert.match(carousel, /stabiliseCardHeight/);
  assert.match(carousel, /onSettledChange\?\./);
});

test('header keeps the existing Reading Room mark as a visible image', async () => {
  const [markup, css] = await Promise.all([
    readFile('src/ui/chrome.js', 'utf8'),
    readFile('src/styles/app.css', 'utf8')
  ]);
  assert.match(markup, /<div class="brand-mark"><img src="\.\/assets\/reading-room-mark\.svg" alt=""><\/div>/);
  assert.match(css, /\.topbar \.wordmark>\.brand-mark img\{display:block!important/);
  assert.doesNotMatch(css, /\.topbar \.wordmark>\.brand-mark img\{display:none!important/);
});

test('reserve migration appends recommendation-backed Owned - Unread candidates to depth eight', async () => {
  const sql = await readFile('supabase/migrations/20260912120000_replenish_up_next_reserve.sql', 'utf8');
  assert.match(sql, /private\.replenish_up_next/);
  assert.match(sql, /le\.overall_status = 'Owned - Unread'/);
  assert.match(sql, /not exists \([\s\S]*public\.up_next_queue queued/);
  assert.match(sql, /candidate\.why_recommended,[\s\S]*candidate\.match_score_10,[\s\S]*candidate\.match_confidence/);
  assert.match(sql, /v_max_position \+ row_number\(\)/);
  assert.match(sql, /perform private\.replenish_up_next\(new\.user_id, 8\)/);
});
