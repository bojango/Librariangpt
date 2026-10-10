import test from 'node:test';
import assert from 'node:assert/strict';
import { profileEditMarkup, profileView } from '../../src/views/profile.js';

const state = {
  session: { user: { user_metadata: { full_name: 'Calum Reader' } } },
  profile: null,
  profileTab: 'stats',
  books: [
    { id: 'book-1', title: 'Completed Book', authors: 'Author One', overall_status: 'Read', completed_at: '2026-09-18', total_pages: 250, user_rating_5: 4.5, cover_url: 'https://example.test/cover.jpg' },
    { id: 'book-2', title: 'Current Book', authors: 'Author Two', overall_status: 'Currently Reading' }
  ],
  tasteProfile: [
    { dimension: 'Narrative structure', preference: 'Strongly prefers narratives with a clear through-line, destination, progression or central problem.', direction: 'Positive', strength: 'Strong', confidence: 'High', evidence_count: 7, last_updated: '2026-09-18' },
    { dimension: 'Discovery', preference: 'Strongly enjoys gradual discovery of unfamiliar places, systems and histories.', direction: 'Positive', strength: 'Strong', confidence: 'High', evidence_count: 5, last_updated: '2026-09-17' },
    { dimension: 'Horror', preference: 'Strong aversion to graphic gore and body horror.', direction: 'Negative', strength: 'Strong', confidence: 'Medium', evidence_count: 4, last_updated: '2026-09-16' },
    { dimension: 'Conflict', preference: 'Prefers conflict that grows organically from character choices rather than contrivance.', direction: 'Mixed', strength: 'Moderate', confidence: 'Medium', evidence_count: 3, last_updated: '2026-09-15' }
  ],
  readingHistory: [{ id: 'session-1', book_id: 'book-1', completed_at: '2026-09-18', user_rating_5: 4.5, status: 'Completed' }]
};

test('Profile retains Stats with accessible tabs and invisible avatar controls', () => {
  const html = profileView(state);
  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-selected="true"/);
  assert.match(html, /Reading Record/);
  assert.doesNotMatch(html, /profile-avatar-action-icon|terminal-profile-upload/);
  assert.match(html, /data-avatar-input/);
  assert.match(html, /data-avatar-menu/);
  assert.match(html, /data-identity-edit/);
  assert.doesNotMatch(html, /data-profile-edit|nfc-profile-section/);
});

test('Profile edit form uses the existing profile fields and escapes stored values', () => {
  const html = profileEditMarkup({ display_name: 'Calum & Co', handle: '@calum', short_bio: '<reader>' });
  assert.match(html, /name="display-name"[^>]*value="Calum &amp; Co"/);
  assert.match(html, /name="handle"[^>]*value="@calum"/);
  assert.match(html, /&lt;reader&gt;/);
  assert.doesNotMatch(html, /<reader>/);
});

test('Taste Details retains full preferences, directions and confidence', () => {
  const html = profileView({ ...state, profileTab: 'taste' });
  assert.match(html, /Strongly prefers narratives with a clear through-line, destination, progression or central problem/);
  assert.match(html, /Strong aversion to graphic gore and body horror/);
  assert.match(html, /Prefers conflict that grows organically from character choices rather than contrivance/);
  assert.match(html, /Mixed . Moderate . Medium confidence/);
  assert.match(html, /Emerging Signals/);
  assert.match(html, /Overview/);
});

test('Taste Profile prose safely escapes stored preference text', () => {
  const html = profileView({ ...state, profileTab: 'taste', tasteProfile: [{ dimension: 'Tone', preference: '<script>alert(1)</script>', direction: 'Positive', strength: 'Strong', confidence: 'High', evidence_count: 2 }] });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
});

test('History preserves completed session events and links to book detail', () => {
  const html = profileView({ ...state, profileTab: 'history' });
  assert.match(html, /2026/);
  assert.match(html, /Completed Book/);
  assert.match(html, /data-open-book="book-1"/);
  assert.doesNotMatch(html, /fallback-book-1/);
});
