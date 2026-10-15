import test from 'node:test';
import assert from 'node:assert/strict';
import { broadGenres, tasteIdentity } from '../../src/features/taste-identity.js';
import { profileView } from '../../src/views/profile.js';

const signal = (dimension,preference,patch={}) => ({dimension,preference,direction:'Positive',strength:'Strong',confidence:'High',evidence_count:4,...patch});
test('genre taxonomy consolidates supported subgenres without filling absent preferences', () => {
  const books = ['Science Fiction / Techno-thriller','Hard Science Fiction','Adventure Thriller','Nature / Travel','Historical Mystery','science fiction'].map((primary_genre,index)=>({id:String(index),primary_genre}));
  const taste = [signal('Discovery','Enjoys discovery.',{taste_evidence:books.map(book=>({book_id:book.id,relation:'supports'}))})];
  const genres = tasteIdentity(taste,books).genres;
  assert.deepEqual(genres,['Sci-Fi','Thriller','Adventure','Mystery','Nonfiction']);
  assert.equal(new Set(genres.map(x=>x.toLowerCase())).size,genres.length);
  assert.deepEqual(tasteIdentity(taste,books.slice(0,2)).genres,['Sci-Fi','Thriller']);
  assert.deepEqual(broadGenres('Psychological Thriller / Soft Science Fiction'),['Thriller','Sci-Fi']);
  assert.deepEqual(broadGenres(''),[]);
  assert.deepEqual(broadGenres('Crime'),['Crime']); // No invented Mystery preference.
});

test('short summaries use first person and full sentences, with a truthful empty state', () => {
  assert.equal(tasteIdentity([signal('Discovery','Strongly enjoys discovery.')]).summary,'I enjoy discovery.');
  assert.equal(tasteIdentity([signal('Science','Prefers grounded science')]).summary,'I prefer grounded science.');
  assert.match(tasteIdentity([]).summary,/^I'm still discovering/);
  assert.equal(tasteIdentity([signal('Mystery','Strongly enjoys layered mysteries and generally prefers meaningful answers to the questions a story asks him to care about.')]).summary,'I enjoy layered mysteries and generally prefer meaningful answers to the questions a story asks me to care about.');
});

test('long summaries group related signals, retain qualifiers and never cut sentences', () => {
  const preferences = [
    signal('Exploration / Discovery','Strongly enjoys exploring unfamiliar places when the details are concrete enough to understand. More detail follows.'),
    signal('Lore / Hidden Systems','Enjoys exploring unfamiliar places when the details are concrete enough to understand.'),
    signal('Science / Technical','Prefers grounded science and direct explanations, especially when they support discovery and build a clear mental model.'),
    signal('Speculative Grounding','Prefers discoverable rules.'),
    signal('Structure / Progression','Prefers a clear sense of progression.'),
    signal('Setting / Atmosphere','Strongly drawn to isolated settings whose history can be investigated.'),
    signal('Nonfiction','Strongly interested in focused nonfiction.'),
    signal('Horror','Strong aversion to disturbing imagery. Psychological tension can work when driven by a compelling concept.',{direction:'Negative',confidence:'Medium'})
  ];
  const original = structuredClone(preferences);
  const result = tasteIdentity(preferences);
  assert.equal(result.summaryParagraphs.length,3);
  assert.match(result.summary,/when the details are concrete enough to understand\./);
  assert.match(result.summary,/especially when they support discovery and build a clear mental model\./);
  assert.match(result.summary,/I tend to avoid disturbing imagery\./);
  assert.match(result.summary,/Psychological|psychological/);
  assert.doesNotMatch(result.summary,/Strongly|…|\.\.\./);
  assert.equal((result.summary.match(/exploring unfamiliar places/g)||[]).length,1);
  assert.doesNotMatch(result.summary,/discoverable rules/);
  assert.deepEqual(preferences,original);
  for (const paragraph of result.summaryParagraphs) assert.match(paragraph,/[.!?]$/);
});

test('confidence and conflicting evidence stay explicit instead of becoming firm preferences', () => {
  const low = tasteIdentity([signal('Tone','Enjoys cosy stories.',{confidence:'Low',evidence_count:1})]);
  assert.match(low.summary,/I tend to enjoy cosy stories\. This preference is still tentative\./);
  assert.deepEqual(low.genres,[]);
  const result = tasteIdentity([
    signal('Pacing','Enjoys fast plots.'),
    signal('Pacing','Dislikes fast plots.',{direction:'Negative'}),
    signal('Mystery','Enjoys mysteries when there are meaningful answers.',{direction:'Mixed',confidence:'Medium'})
  ]);
  assert.match(result.summary,/preferences around pacing are mixed\./);
  assert.match(result.summary,/I enjoy fast plots\./); assert.match(result.summary,/I dislike fast plots\./);
  const mixed = tasteIdentity([signal('Mystery','Enjoys mysteries when there are meaningful answers.',{direction:'Mixed',confidence:'Medium'})]);
  assert.match(mixed.summary,/response to mystery varies\./);
  assert.match(mixed.summary,/I tend to enjoy mysteries when there are meaningful answers\./);
});

test('summary reflects new canonical evidence and retains very long complete source sentences', () => {
  const text = `Enjoys stories where ${'every recorded detail matters and '.repeat(25)}the final answer connects the evidence.`;
  const input = [signal('Discovery',text)];
  const original = tasteIdentity(input).summary;
  assert.match(original,/the final answer connects the evidence\.$/);
  input[0].preference='Prefers focused mysteries.';
  assert.equal(tasteIdentity(input).summary,'I prefer focused mysteries.');
});

test('card and details share escaped complete summary; History exposes two distinct metadata lines', () => {
  const state={books:[{id:'b',title:'Long Book',authors:'Author',overall_status:'Read',primary_genre:'Science Fiction'}],tasteProfile:[signal('Discovery','Enjoys <unusual> worlds. A second sentence.')],readingHistory:[{id:'r',book_id:'b',completed_at:'2026-10-07',user_rating_5:3.8}],profile:{handle:'@reader'}};
  for (const profileTab of ['feed','taste']) assert.match(profileView({...state,profileTab}),/I enjoy &lt;unusual&gt; worlds\./);
  const history=profileView({...state,profileTab:'history'});
  assert.match(history,/class="profile-history-dates">Started not recorded · Finished 7 Oct 2026<\/small>/);
  assert.match(history,/class="profile-history-details">Duration not recorded · 3.8\/5 · Science Fiction<\/small>/);
});
