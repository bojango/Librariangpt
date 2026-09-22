import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('Profile defaults to an accessible Stats reading record', () => {
  const html = profileView(state);
  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-selected="true"/);
  assert.match(html, /Reading Record/);
  assert.match(html, /UPLOAD PHOTO/);
  assert.match(html, /data-avatar-input/);
  assert.match(html, /data-avatar-menu/);
  assert.match(html, /data-profile-edit/);
});

test('Profile edit form uses the existing profile fields and escapes stored values', () => {
  const html = profileEditMarkup({ display_name: 'Calum & Co', handle: '@calum', short_bio: '<reader>' });
  assert.match(html, /name="display-name"[^>]*value="Calum &amp; Co"/);
  assert.match(html, /name="handle"[^>]*value="@calum"/);
  assert.match(html, /&lt;reader&gt;/);
  assert.doesNotMatch(html, /<reader>/);
});

test('Terminal keeps its existing profile photo control while Reading Room uses the avatar action', async () => {
  const [html, css] = await Promise.all([profileView(state), readFile('src/styles/app.css', 'utf8')]);
  assert.match(html, /terminal-profile-upload/);
  assert.match(css, /html\[data-theme="reading-room"\] \.terminal-profile-upload \{ display: none; \}/);
  assert.match(css, /html\[data-theme="terminal"\] \.profile-edit/);
});

test('Taste Profile composes real full-sentence preferences into third-person prose', () => {
  const html = profileView({ ...state, profileTab: 'taste' });
  assert.match(html, /Calum strongly prefers narratives with a clear through-line, destination, progression or central problem/);
  assert.match(html, /Calum strongly enjoys gradual discovery of unfamiliar places, systems and histories/);
  assert.match(html, /Calum has a strong aversion to graphic gore and body horror/);
  assert.match(html, /Calum prefers conflict that grows organically from character choices rather than contrivance/);
  assert.match(html, /<li><span>\+<\/span>Narrative structure<\/li>/);
  assert.match(html, /<li><span>−<\/span>Horror<\/li>/);
});

test('Taste Profile uses a neutral dimension-led sentence for declarative preferences', () => {
  const html = profileView({ ...state, profileTab: 'taste', tasteProfile: [{ dimension: 'Setting', preference: 'Stories with distinctive settings are especially memorable when the world can be gradually understood.', direction: 'Positive', strength: 'Strong', confidence: 'High', evidence_count: 4 }] });
  assert.match(html, /Evidence around Setting is consistent: Stories with distinctive settings are especially memorable/);
  assert.doesNotMatch(html, /Calum is most consistently drawn to Stories/);
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
