import test from 'node:test';
import assert from 'node:assert/strict';
import { bookHeaderSubtitle, chrome, greetingForHour, headerSubtitle, headerTitle, refreshHeaderGreeting } from '../../src/ui/chrome.js';

test('shared header resolves routes and dynamic book titles', () => {
  for (const [route, title] of Object.entries({ home: 'Home', library: 'Library', wishlist: 'Wishlist', profile: 'Profile', recommendations: 'Recommended', stats: 'Stats' })) {
    assert.equal(headerTitle(route), title);
  }
  assert.equal(headerTitle('book', 'Prey'), 'Prey');
  assert.equal(headerTitle('reading-history'), 'Reading history');
  const markup = chrome('<p>Content</p>', 'library', { route: 'book', title: 'A & B' });
  assert.match(markup, /class="header-title" title="A &amp; B">A &amp; B<\/div>/);
  assert.equal((markup.match(/data-menu/g) || []).length, 1);
});

test('greeting uses local hour boundaries and refreshes in place', () => {
  for (const [hour, expected] of [[0, 'Good evening'], [4, 'Good evening'], [5, 'Good morning'], [11, 'Good morning'], [12, 'Good afternoon'], [17, 'Good afternoon'], [18, 'Good evening'], [23, 'Good evening']]) {
    assert.equal(greetingForHour(hour), expected);
  }
  const node = { textContent: '' };
  refreshHeaderGreeting({ querySelectorAll: () => [node] }, new Date(2026, 8, 27, 12, 0));
  assert.equal(node.textContent, 'Good afternoon');
  assert.match(chrome('', 'home'), /class="header-subtitle header-greeting">Good /);
  assert.doesNotMatch(chrome('', 'library'), /class="header-subtitle header-greeting"/);
});

test('shared header derives route context from current book and wishlist state', () => {
  assert.equal(headerSubtitle('library'), 'Your books');
  assert.equal(headerSubtitle('wishlist', { wishlistCount: 1 }), '1 book');
  assert.equal(headerSubtitle('wishlist', { wishlistCount: 32 }), '32 books');
  assert.equal(headerSubtitle('recommendations'), 'Picked for you');
  assert.equal(headerSubtitle('profile'), 'Your reading profile');
  assert.equal(bookHeaderSubtitle({ overall_status: 'Currently Reading', progress_percent: 64 }), 'Currently Reading · 64%');
  assert.equal(bookHeaderSubtitle({ overall_status: 'Owned - Unread' }), 'Owned · Unread');
  assert.equal(bookHeaderSubtitle({ overall_status: 'Wishlist' }), 'Wishlist');
  assert.equal(bookHeaderSubtitle({ overall_status: 'Read', user_rating_5: 4.25 }), 'Read · 4.25/5');
  assert.equal(bookHeaderSubtitle({ overall_status: 'Read' }), 'Read');
  assert.equal(bookHeaderSubtitle({ overall_status: 'DNF', current_page: 38, total_pages: 100 }), 'DNF · 38%');
  assert.equal(bookHeaderSubtitle({ overall_status: 'Paused', progress_percent: null }), 'Paused');
  assert.doesNotMatch(chrome('', 'library', { route: 'book', title: 'Prey', book: { overall_status: 'Read' } }), /header-greeting|Good evening|Good morning|Good afternoon/);
});
