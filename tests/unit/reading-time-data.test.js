import test from 'node:test';
import assert from 'node:assert/strict';
import { loadReadingTimeSessions } from '../../src/data/library.js';

function clientFor(results) {
  const calls = [];
  const client = { from(table) {
    const call = { table, filters: [] };
    calls.push(call);
    return {
      select(fields) { call.fields = fields; return this; },
      eq(...args) { call.filters.push(['eq', ...args]); return this; },
      not(...args) { call.filters.push(['not', ...args]); return this; },
      order(column) { call.order = column; return this; },
      range(...bounds) { call.range = bounds; return this; },
      then(resolve, reject) { return Promise.resolve(results[calls.indexOf(call)]).then(resolve, reject); }
    };
  } };
  return { client, calls };
}

test('session query filters genuine completed sessions and pages past the default row cap', async () => {
  const first = Array.from({ length: 1000 }, (_, id) => ({ id }));
  const { client, calls } = clientFor([{ data: first }, { data: [{ id: 1000 }] }]);
  const result = await loadReadingTimeSessions({ bookId: 'book-1' }, client);
  assert.equal(result.length, 1001);
  assert.deepEqual(calls.map(call => call.range), [[0, 999], [1000, 1999]]);
  for (const call of calls) {
    assert.equal(call.table, 'reading_time_sessions');
    assert.equal(call.order, 'id');
    assert.deepEqual(call.filters, [['eq', 'session_kind', 'reading'], ['not', 'ended_at', 'is', null], ['eq', 'book_id', 'book-1']]);
  }
});

test('all-book query handles empty data and rejects page failures instead of returning partial totals', async () => {
  const empty = clientFor([{ data: [] }]);
  assert.deepEqual(await loadReadingTimeSessions({}, empty.client), []);
  assert.equal(empty.calls[0].filters.length, 2);
  const error = new Error('unavailable');
  const failed = clientFor([{ data: Array(1000).fill({}) }, { error }]);
  await assert.rejects(loadReadingTimeSessions({}, failed.client), error);
});
