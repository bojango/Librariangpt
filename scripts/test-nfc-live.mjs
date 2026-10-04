// Transient capability stays only in this process. Prints UUID/hash and sanitized
// outcomes, never the raw token. Create/delete its row via the connected DB tool.
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';

const id = randomUUID();
const token = `${id}.${randomBytes(32).toString('hex')}`;
const hash = createHash('sha256').update(token).digest('hex');
const endpoint = 'https://fbbpovieqfsjunmqtxvf.supabase.co/functions/v1/nfc-reading-session';
const input = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
console.log(JSON.stringify({ bookmark_id: id, token_hash: hash, instruction: 'Insert a disabled test bookmark with this hash, pin its current book, then send disabled or taps on stdin.' }));

async function post(value = token) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'X-NFC-Bookmark-Token': value }, signal: AbortSignal.timeout(20000) });
  return { code: response.status, result: await response.json() };
}
for await (const command of input) {
  try {
    if (command === 'disabled') {
      const disabled = await post(); assert.equal(disabled.code, 401);
      const invalid = await post(`${id}.${'ff'.repeat(32)}`); assert.equal(invalid.code, 401);
      console.log(JSON.stringify({ disabled: disabled.code, invalid: invalid.code }));
    } else if (command === 'taps') {
      const first = await post(); assert.equal(first.result.status, 'started');
      const duplicates = await Promise.all([post(), post(), post()]);
      assert.ok(duplicates.every(row => row.result.status === 'duplicate_ignored'));
      console.log(JSON.stringify({ first: first.result.status, session_id: first.result.session_id, concurrent_duplicates: duplicates.map(row => row.result.status) }));
      await new Promise(resolve => setTimeout(resolve, 11000));
      const second = await post(); assert.equal(second.result.status, 'ended');
      assert.equal(second.result.session_id, first.result.session_id);
      assert.ok(second.result.duration_seconds >= 10);
      const third = await post(); assert.equal(third.result.status, 'awaiting_page');
      assert.equal(third.result.finish_url, second.result.finish_url);
      console.log(JSON.stringify({ second: second.result.status, duration_seconds: second.result.duration_seconds, third: third.result.status, finish_url: third.result.finish_url }));
    } else if (command === 'exit') break;
  } catch (error) { console.error(JSON.stringify({ test_failed: error.message })); process.exitCode = 1; break; }
}
input.close();
