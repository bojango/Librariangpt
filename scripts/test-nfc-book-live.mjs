// Synthetic HTTP probe only. Raw capability stays in process memory, never output.
// Use the emitted UUID/hash to insert a separate synthetic bookmark, two books,
// and owner library entries via the management connection. Always clean them up.
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';

const bookmarkId=randomUUID(), bookId=randomUUID(), secondBookId=randomUUID();
const token=`${bookmarkId}.${randomBytes(32).toString('hex')}`;
const hash=createHash('sha256').update(token).digest('hex');
const endpoint='https://fbbpovieqfsjunmqtxvf.supabase.co/functions/v1/nfc-open-book';
const input=createInterface({ input:process.stdin,output:process.stdout,terminal:false });
console.log(JSON.stringify({ bookmark_id:bookmarkId,book_id:bookId,second_book_id:secondBookId,token_hash:hash }));
async function post(id, value=token) {
  const response=await fetch(endpoint,{ method:'POST',headers:{ 'Content-Type':'application/json','X-NFC-Bookmark-Token':value },body:JSON.stringify({ book_id:id }),signal:AbortSignal.timeout(20000) });
  return { code:response.status,result:await response.json() };
}
for await (const command of input) {
  try {
    if(command==='disabled') {
      assert.equal((await post(bookId)).code,401);
      console.log(JSON.stringify({ disabled:401 }));
    } else if(command==='test') {
      for(const value of ['bad',`${bookmarkId}.${'ff'.repeat(32)}`]) assert.equal((await post(bookId,value)).code,401);
      assert.equal((await post('invalid')).code,400);
      assert.deepEqual(await post(randomUUID()),{ code:404,result:{ status:'book_not_found' } });
      const first=await post(bookId);
      assert.deepEqual(first,{ code:200,result:{ status:'queued',book_id:bookId,book_title:'Synthetic NFC HTTP A' } });
      const second=await post(secondBookId);
      assert.deepEqual(second,{ code:200,result:{ status:'queued',book_id:secondBookId,book_title:'Synthetic NFC HTTP B' } });
      console.log(JSON.stringify({ malformed:401,wrong_token:401,malformed_book:400,missing_book:404,first,second }));
    } else if(command==='exit') break;
  } catch(error) { console.error(JSON.stringify({ test_failed:error.message })); process.exitCode=1; break; }
}
input.close();
