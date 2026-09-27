import test from 'node:test';
import assert from 'node:assert/strict';
import { chrome, greetingForHour, headerTitle, refreshHeaderGreeting } from '../../src/ui/chrome.js';

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
});
