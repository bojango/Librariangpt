import test from 'node:test';
import assert from 'node:assert/strict';
import { profileView } from '../../src/views/profile.js';

const state = {
  session: { user: { user_metadata: { full_name: 'Calum Reader' } } },
  profile: null,
  profileTab: 'stats',
  books: [
    { id: 'book-1', title: 'Completed Book', authors: 'Author One', overall_status: 'Read', completed_at: '2026-09-18', total_pages: 250, user_rating_5: 4.5, cover_url: 'https://example.test/cover.jpg' },
    { id: 'book-2', title: 'Current Book', authors: 'Author Two', overall_status: 'Currently Reading' }
  ],
  tasteProfile: [
    { dimension: 'Setting', preference: 'distinctive settings', direction: 'Positive', strength: 'Strong', confidence: 'High', evidence_count: 5, last_updated: '2026-09-18' },
    { dimension: 'Tone', preference: 'gore-heavy scenes', direction: 'Negative', strength: 'Strong', confidence: 'Medium', evidence_count: 3, last_updated: '2026-09-17' }
  ],
  readingHistory: [{ id: 'session-1', book_id: 'book-1', completed_at: '2026-09-18', user_rating_5: 4.5, status: 'Completed' }]
};

test('Profile defaults to an accessible Stats reading record', () => {
  const html = profileView(state);
  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-selected="true"/);
  assert.match(html, /Reading Record/);
  assert.match(html, /UPLOAD PHOTO/);
  assert.match(html, /data-avatar-input/);
});

test('Taste Profile uses current signals rather than a static summary', () => {
  const html = profileView({ ...state, profileTab: 'taste' });
  assert.match(html, /Calum is most consistently drawn to distinctive settings/);
  assert.match(html, /gore-heavy scenes less rewarding/);
  assert.match(html, /Strong signals/);
});

test('History preserves completed session events and links to book detail', () => {
  const html = profileView({ ...state, profileTab: 'history' });
  assert.match(html, /2026/);
  assert.match(html, /Completed Book/);
  assert.match(html, /data-open-book="book-1"/);
  assert.doesNotMatch(html, /fallback-book-1/);
});
