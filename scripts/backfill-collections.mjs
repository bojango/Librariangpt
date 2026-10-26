// Offline-first production dry-run. Network and production writes are absent.
// Supply a fresh read-only snapshot; outputs contain bibliographic facts only.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {discoveryDb,finish} from '../tests/helpers/collection-discovery-db.js';
import {discoverCollections} from '../supabase/functions/_shared/collection-discovery.js';
import {registry} from '../supabase/functions/_shared/collection-registry.js';
const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];
if(!args.includes('--snapshot') || args.some(a=>['--apply','--production'].includes(a))) throw new Error('Read-only dry-run only: --snapshot <json> [--out <directory>]');
const source=await readFile(resolve(arg('--snapshot')),'utf8'),snapshot=JSON.parse(source);
const out=resolve(args.includes('--out')?arg('--out'):'output/collections-backend');
await mkdir(out,{recursive:true});
const db=await discoveryDb(snapshot);
try {
  const report={generated_at:new Date().toISOString(),mode:'isolated-production-dry-run',snapshot_sha256:createHash('sha256').update(source).digest('hex'),registry_version:registry.version,total_books:snapshot.books.length,outside_library:snapshot.books.filter(b=>!b.in_library).length,books:[]};
  const decisions=new Map(snapshot.books.map(b=>[b.id,discoverCollections(b,snapshot,registry)]));
  const run=async()=>{
    for(;;) {
      const {rows:jobs}=await db.query('select * from public.claim_collection_discovery(4)');
      if(!jobs.length) break;
      for(const job of jobs) await finish(db,job,decisions.get(job.book_id));
    }
  };
  await run();
  const catalogue=async()=>JSON.stringify((await db.query(`select jsonb_build_object('collections',(select jsonb_agg(c order by key) from public.collections c),'works',(select jsonb_agg(w order by key) from public.collection_catalogue_books w),'memberships',(select jsonb_agg(m order by collection_key,work_key) from public.collection_memberships m),'book_series',(select jsonb_agg(s order by book_id,series_id) from public.book_series s)) data`)).rows[0].data);
  const once=await catalogue();
  // Explicitly replay every book, including completed and unresolved outcomes.
  await db.exec("update public.collection_discovery_jobs set status='queued',attempt_count=0");
  await run();
  report.repeat_identical=once===await catalogue();
  if(!report.repeat_identical) throw new Error('Repeat backfill changed catalogue data.');
  const jobs=(await db.query('select * from public.collection_discovery_jobs order by book_id')).rows;
  const appliedLinks=(await db.query('select w.book_id,c.key,c.series_id,m.official_number from public.collection_catalogue_books w join public.collection_memberships m on m.work_key=w.key join public.collections c on c.key=m.collection_key where w.book_id is not null')).rows;
  report.books=snapshot.books.map(b=>{
    const job=jobs.find(j=>j.book_id===b.id),d=decisions.get(b.id);
    const sourceWork=registry.works.find(w=>w.key===d.work_key);
    return {book_id:b.id,title:b.title,authors:b.authors,in_library:b.in_library,outcome:job.status==='unresolved'?'unresolved':d.status,reason:job.last_error || d.reason,source_url:d.source_url || null,work_key:d.work_key || null,canonical_publication_year:b.original_publication_year,verified_publication_year:sourceWork?.publication_year || null,existing_memberships:d.existing_memberships,proposed_collections:d.collections.map(c=>c.key),applied_collections:appliedLinks.filter(l=>l.book_id===b.id),provider_hints:d.candidates || []};
  });
  report.linked=report.books.filter(b=>b.outcome==='linked').length;
  report.verified_standalones=report.books.filter(b=>b.outcome==='standalone').length;
  report.unresolved=report.books.filter(b=>b.outcome==='unresolved').length;
  const resultingLinks=(await db.query('select * from public.book_series')).rows;
  report.existing_memberships_preserved=snapshot.book_series.every(m=>resultingLinks.some(after=>after.book_id===m.book_id&&after.series_id===m.series_id&&(m.series_order==null||Number(after.series_order)===Number(m.series_order))));
  if(!report.existing_memberships_preserved) throw new Error('An existing series relationship changed.');
  report.collections=(await db.query('select key,name,kind,complete,series_id,provenance from public.collections order by key')).rows;
  report.complete_catalogues=report.collections.filter(c=>c.complete).length;
  report.incomplete_catalogues=report.collections.filter(c=>!c.complete).length;
  report.new_collections=report.collections.filter(c=>!snapshot.series.some(s=>s.id===c.series_id)).length;
  report.new_collections_beyond_starter=report.collections.filter(c=>!snapshot.series.some(s=>s.id===c.series_id)&&!['preston-child','pendergast','nora-kelly','nora-corrie','jurassic-park','silo'].includes(c.key)).length;
  report.publication_year_discrepancies=report.books.filter(b=>b.verified_publication_year&&b.canonical_publication_year&&b.verified_publication_year!==b.canonical_publication_year).map(b=>({book_id:b.book_id,title:b.title,canonical:b.canonical_publication_year,verified:b.verified_publication_year,action:'Canonical metadata preserved.'}));
  await writeFile(resolve(out,'coverage.json'),JSON.stringify(report,null,2)+'\n');
  const cell=s=>String(s??'').replaceAll('|','\\|').replaceAll('\n',' ');
  await writeFile(resolve(out,'coverage.md'),`# Collections production dry-run\n\nGenerated ${report.generated_at}. No production writes.\n\n${report.total_books} checked (${report.outside_library} outside Library); ${report.linked} linked; ${report.verified_standalones} verified standalones; ${report.unresolved} unresolved.\n\n${report.complete_catalogues} complete catalogues within stated scope; ${report.incomplete_catalogues} incomplete. Repeat import identical: ${report.repeat_identical}.\n\n| Book | Authors | Library | Outcome | Reason | Evidence |\n|---|---|---|---|---|---|\n`+report.books.map(b=>`| ${[b.title,b.authors,b.in_library?'yes':'no',b.outcome,b.reason,b.source_url].map(cell).join(' | ')} |`).join('\n')+'\n');
  console.log(JSON.stringify({...report,books:undefined,collections:undefined},null,2));
} finally {await db.close();}
