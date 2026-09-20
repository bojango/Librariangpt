import test from 'node:test';
import assert from 'node:assert/strict';
import { filteredBooks, libraryView } from '../../src/views/library.js';
import { recommendationsView } from '../../src/views/recommendations.js';

const books = [
  { id: 'b', title: 'Beta', authors: 'Two' },
  { id: 'a', title: 'Alpha', authors: 'One' }
];

test('Library Recommended is a route control and never a catalogue filter', () => {
  const state = { books, recommendations: [], filters: { library: 'All' }, queries: { library: '' } };
  const html = libraryView(state, 'library');
  assert.match(html, /data-route="recommendations"[^>]*>Recommended/);
  assert.doesNotMatch(html, /data-filter="Recommended"/);
  assert.equal(state.filters.library, 'All');

  const staleState = { ...state, filters: { library: 'Recommended' } };
  assert.deepEqual(filteredBooks(staleState, 'library').map(book => book.id), ['a', 'b']);
});

test('Recommendations route renders active AI picks as editorial rows with match scores', () => {
  const html = recommendationsView({ aiRecommendations: [{ recommendation_id: 'r1', title: 'A Pick', authors: 'A Writer', match_score_10: 9.2, recommendation_strength: 'Strong', why_recommended: 'The full reason stays visible.' }] });
  assert.match(html, /recommendation-editorial-card/);
  assert.match(html, /9\.2\/10 match/);
  assert.match(html, /The full reason stays visible\./);
  assert.doesNotMatch(html, /Goodreads/);
});
