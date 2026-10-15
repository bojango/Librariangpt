import { readFile } from 'node:fs/promises';
import { plannerDb, owner, other, bookId, sessionId } from './planner-db.js';
export {owner,other,bookId,sessionId};
export const reflectionsMigration='supabase/migrations/20261010205823_librarian_feed_reflections.sql';
export async function reflectionsDb(){
  const db=await plannerDb();
  await db.exec((await readFile('supabase/migrations/20260919120000_add_private_reader_profiles.sql','utf8')).split('insert into storage.buckets')[0]);
  await db.exec(await readFile('supabase/migrations/20260909181552_book_quotes_and_passages.sql','utf8'));
  await db.exec(await readFile('supabase/migrations/20261010110322_private_profile_activity.sql','utf8'));
  await db.exec(await readFile('supabase/migrations/20261010110712_automation_librarian_entries.sql','utf8'));
  await db.exec(`insert into reader_profiles(user_id,display_name,handle) values('${owner}','Calum','Calum Lewis');
    insert into books(id,title) values('${bookId(1)}','Editorial fixture'),('${bookId(2)}','Other fixture');
    insert into library_entries(user_id,book_id,overall_status,current_page,total_pages) values('${owner}','${bookId(1)}','Currently Reading',100,200),('${owner}','${bookId(2)}','Owned - Unread',0,200);
    insert into reading_sessions(id,user_id,book_id,status,current_page,total_pages) values('${sessionId}','${owner}','${bookId(1)}','Reading',100,200);
    insert into reading_feedback(user_id,book_id,session_id,user_feedback,sentiment,aspect,confidence,created_at)
      values('${owner}','${bookId(1)}','${sessionId}','The opening feels slow and the pace is leaving me disengaged.','Negative','Pacing / setup','High',now()-interval '2 days');`);
  await db.exec(await readFile(reflectionsMigration,'utf8'));
  await db.exec(await readFile('supabase/migrations/20261010210016_librarian_feed_book_indexes.sql','utf8'));
  return db;
}
export async function addFeedback(db,{text='The pace has picked up and the exploration is keeping me curious.',sentiment='Positive',aspect='Pacing / payoff',stage='Middle',confidence='High',strength='Moderate',book=bookId(1),session=sessionId,user=owner,addedBy='chatgpt',createdAt=null}={}){
  return (await db.query(`insert into reading_feedback(user_id,book_id,session_id,user_feedback,sentiment,aspect,reading_stage,confidence,evidence_strength,added_by,created_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11::timestamptz,clock_timestamp())) returning id`,[user,book,session,text,sentiment,aspect,stage,confidence,strength,addedBy,createdAt])).rows[0].id;
}
export async function candidates(db){return (await db.query('select public.librarian_feed_candidates() candidate')).rows.map(r=>r.candidate);}
export async function publish(db,c,{text='Calum is more engaged now that the exploration has gained momentum.',ids=c.new_feedback.map(f=>f.id),key='pacing:engaged:exploration-gains-momentum',reason='reading_reaction',comparison=[]}={}){
  return (await db.query('select public.publish_librarian_feed_reflection($1,$2,$3,$4,$5,$6) result',[c.candidate_id,text,ids,key,reason,comparison])).rows[0].result;
}
