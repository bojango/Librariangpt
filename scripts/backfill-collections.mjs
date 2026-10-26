// Offline-first production dry-run. Network and production writes are absent.
// Supply a fresh read-only snapshot. Outputs include private Library evidence;
// keep both snapshots and reports outside version control.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {discoveryDb,finish} from '../tests/helpers/collection-discovery-db.js';
import {discoverCollections} from '../supabase/functions/_shared/collection-discovery.js';
import {registry} from '../supabase/functions/_shared/collection-registry.js';
const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];
if(!args.includes('--snapshot') || args.some(a=>['--apply','--production'].includes(a))) throw new Error('Read-only dry-run only: --snapshot <json> [--out <directory>]');
const source=await readFile(resolve(arg('--snapshot')),'utf8'),snapshot=JSON.parse(source);
const reviews=args.includes('--reviews')?JSON.parse(await readFile(resolve(arg('--reviews')),'utf8')):[];
const out=resolve(args.includes('--out')?arg('--out'):'output/collections-backend');
await mkdir(out,{recursive:true});
const db=await discoveryDb(snapshot);
try {
  const report={generated_at:new Date().toISOString(),mode:'isolated-production-dry-run',snapshot_sha256:createHash('sha256').update(source).digest('hex'),registry_version:registry.version,registry_revision:registry.revision,total_books:snapshot.books.length,outside_library:snapshot.books.filter(b=>!b.in_library).length,books:[]};
  const decisions=new Map(snapshot.books.map(b=>[b.id,discoverCollections(b,snapshot,registry)]));
  const protectedState=async()=>JSON.stringify((await db.query(`select jsonb_build_object('books',(select jsonb_agg(b order by id) from public.books b),'editions',(select jsonb_agg(e order by id) from public.editions e),'library',(select jsonb_agg(l order by id) from public.library_entries l),'recommendations',(select jsonb_agg(r order by id) from public.recommendations r),'paths',(select jsonb_agg(p order by id) from public.reading_paths p),'entries',(select jsonb_agg(e order by path_id,position) from public.reading_path_entries e)) data`)).rows[0].data);
  const protectedBefore=await protectedState();
  const run=async()=>{
    for(;;) {
      const {rows:jobs}=await db.query('select * from public.claim_collection_discovery(4)');
      if(!jobs.length) break;
      for(const job of jobs) await finish(db,job,decisions.get(job.book_id));
    }
  };
  await run();
  const protectedAfter=await protectedState();
  const catalogue=async()=>JSON.stringify((await db.query(`select jsonb_build_object('collections',(select jsonb_agg(c order by key) from public.collections c),'works',(select jsonb_agg(w order by key) from public.collection_catalogue_books w),'memberships',(select jsonb_agg(m order by collection_key,work_key) from public.collection_memberships m),'book_series',(select jsonb_agg(s order by book_id,series_id) from public.book_series s)) data`)).rows[0].data);
  const once=await catalogue();
  // Explicitly replay every book, including completed and unresolved outcomes.
  await db.exec("update public.collection_discovery_jobs set status='queued',attempt_count=0");
  await run();
  report.repeat_identical=once===await catalogue();
  report.protected_data_unchanged=protectedBefore===protectedAfter&&protectedBefore===await protectedState();
  report.protected_data_sha256=createHash('sha256').update(protectedBefore).digest('hex');
  report.isolated_library_rows=(await db.query('select count(*)::int n from public.library_entries')).rows[0].n;
  if(!report.protected_data_unchanged) throw new Error('Backfill changed protected data.');
  if(!report.repeat_identical) throw new Error('Repeat backfill changed catalogue data.');
  const jobs=(await db.query('select * from public.collection_discovery_jobs order by book_id')).rows;
  const appliedLinks=(await db.query('select w.book_id,c.key,c.series_id,m.official_number from public.collection_catalogue_books w join public.collection_memberships m on m.work_key=w.key join public.collections c on c.key=m.collection_key where w.book_id is not null')).rows;
  report.books=snapshot.books.map(b=>{
    const job=jobs.find(j=>j.book_id===b.id),d=decisions.get(b.id);
    const sourceWork=registry.works.find(w=>w.key===d.work_key);
    const review=reviews.find(r=>r.book_id===b.id);
    return {book_id:b.id,title:b.title,authors:b.authors,in_library:b.in_library,library_status:b.library_entry?.overall_status || null,ownership_status:b.library_entry?.ownership_status || null,outcome:job.status==='unresolved'?'unresolved':d.status,classification:sourceWork?.serialized_novel?'serialized_novel':d.status,reason:job.last_error || review?.reason || d.reason,source_url:d.source_url || review?.source_url || null,work_key:d.work_key || null,canonical_publication_year:b.original_publication_year,verified_publication_year:sourceWork?.publication_year || null,existing_memberships:d.existing_memberships,proposed_collections:d.collections.map(c=>c.key),applied_collections:appliedLinks.filter(l=>l.book_id===b.id),provider_hints:d.candidates || [],review:review || null};
  });
  report.linked=report.books.filter(b=>b.outcome==='linked').length;
  report.verified_standalones=report.books.filter(b=>b.outcome==='standalone').length;
  report.unresolved=report.books.filter(b=>b.outcome==='unresolved').length;
  const resultingLinks=(await db.query('select * from public.book_series')).rows;
  report.existing_memberships_preserved=snapshot.book_series.every(m=>resultingLinks.some(after=>after.book_id===m.book_id&&after.series_id===m.series_id&&(m.series_order==null||Number(after.series_order)===Number(m.series_order))));
  if(!report.existing_memberships_preserved) throw new Error('An existing series relationship changed.');
  const summarise=books=>({checked:books.length,linked:books.filter(b=>b.outcome==='linked').length,standalone:books.filter(b=>b.outcome==='standalone').length,unresolved:books.filter(b=>b.outcome==='unresolved').length,serialized_novel:books.filter(b=>b.classification==='serialized_novel').length});
  report.library=summarise(report.books.filter(b=>b.in_library));
  report.additional_catalogue=summarise(report.books.filter(b=>!b.in_library));
  report.original_unresolved_review={reviewed:reviews.length,...summarise(report.books.filter(b=>reviews.some(r=>r.book_id===b.book_id)))};
  report.unresolved_categories=Object.fromEntries([...new Set(reviews.map(r=>r.category))].map(category=>[category,report.books.filter(b=>b.outcome==='unresolved'&&b.review?.category===category).length]).filter(([,n])=>n));
  report.collections=(await db.query(`select c.*,count(m.work_key)::int catalogue_books,count(w.book_id)::int canonical_books,count(*) filter(where w.publication_state='published')::int published_books,count(*) filter(where w.publication_year is null)::int missing_years,count(*) filter(where w.cover_url is null)::int missing_artwork from public.collections c left join public.collection_memberships m on m.collection_key=c.key left join public.collection_catalogue_books w on w.key=m.work_key group by c.key order by c.key`)).rows;
  report.single_canonical_book_collections=report.collections.filter(c=>c.canonical_books===1||c.catalogue_books===1).map(c=>({key:c.key,name:c.name,classification:c.catalogue_type==='serialized_novel'?'serialized_novel':c.catalogue_type==='limited'?'deliberately_scoped_catalogue':c.complete?'complete_within_stated_scope':'incomplete_catalogue',canonical_books:c.canonical_books,catalogue_books:c.catalogue_books,published_books:c.published_books,complete:c.complete,scope:c.description,source_url:c.source_url}));
  report.original_single_book_series=snapshot.series.filter(s=>snapshot.book_series.filter(m=>m.series_id===s.id).length===1).map(s=>{const c=report.collections.find(c=>c.series_id===s.id);return {series_id:s.id,name:s.name,result:c?{key:c.key,catalogue_type:c.catalogue_type,complete:c.complete,catalogue_books:c.catalogue_books}:null};});
  report.incorrect_known_multi_book_singletons=report.collections.filter(c=>c.kind==='series'&&c.catalogue_type!=='serialized_novel'&&c.catalogue_books===1&&c.provenance?.type!=='existing_database').map(c=>c.key);
  if(report.incorrect_known_multi_book_singletons.length) throw new Error('Known multi-book series still represented by one title.');
  report.complete_catalogues=report.collections.filter(c=>c.complete).length;
  report.incomplete_catalogues=report.collections.filter(c=>!c.complete).length;
  report.new_collections=report.collections.filter(c=>!snapshot.series.some(s=>s.id===c.series_id)).length;
  report.new_collections_beyond_starter=report.collections.filter(c=>!snapshot.series.some(s=>s.id===c.series_id)&&!['preston-child','pendergast','nora-kelly','nora-corrie','jurassic-park','silo'].includes(c.key)).length;
  report.publication_year_discrepancies=report.books.filter(b=>b.verified_publication_year&&b.canonical_publication_year&&b.verified_publication_year!==b.canonical_publication_year).map(b=>({book_id:b.book_id,title:b.title,canonical:b.canonical_publication_year,verified:b.verified_publication_year,action:'Canonical metadata preserved.'}));
  await writeFile(resolve(out,'coverage.json'),JSON.stringify(report,null,2)+'\n');
  const cell=s=>String(s??'').replaceAll('|','\\|').replaceAll('\n',' ');
  const table=(headers,rows)=>`| ${headers.join(' | ')} |\n|${headers.map(()=>'---').join('|')}|\n`+rows.map(r=>`| ${r.map(cell).join(' | ')} |`).join('\n')+'\n';
  await writeFile(resolve(out,'coverage.md'),`# Private Collections production dry-run\n\nGenerated ${report.generated_at}. No production writes. Do not publish this report.\n\n${report.total_books} checked; ${report.linked} linked (including one serialized novel retained as metadata); ${report.verified_standalones} verified standalones; ${report.unresolved} unresolved.\n\n`+table(['Scope','Checked','Linked','Standalone','Unresolved'],[['Library',...Object.values(report.library).slice(0,4)],['Additional catalogue',...Object.values(report.additional_catalogue).slice(0,4)]])+`\n${report.complete_catalogues} complete catalogues within stated scope; ${report.incomplete_catalogues} incomplete. Beacon 23 is a serialized novel, excluded from cards and routes without deleting metadata.\n\nRepeated catalogue import identical: ${report.repeat_identical}. Protected data unchanged across both imports: ${report.protected_data_unchanged}. SHA-256: ${report.protected_data_sha256}. Isolated Library status/ownership rows: ${report.isolated_library_rows}. Reviews, recommendations and personalised paths additionally use preservation fixtures in the integration suite; this snapshot does not export their private contents.\n\n## All original unresolved cases\n\nReviewed ${report.original_unresolved_review.reviewed}; now ${report.original_unresolved_review.linked} linked, ${report.original_unresolved_review.standalone} standalone and ${report.original_unresolved_review.unresolved} unresolved.\n\n`+table(['Book','Authors','Scope/status','Outcome','Category','Review / remaining evidence','Source'],report.books.filter(b=>b.review).sort((a,b)=>Number(!a.in_library)-Number(!b.in_library)||Number(a.ownership_status!=='Owned')-Number(b.ownership_status!=='Owned')||a.title.localeCompare(b.title)).map(b=>[b.title,b.authors,b.in_library?`${b.library_status}; ${b.ownership_status}`:'Additional catalogue',b.outcome,b.review.category,b.reason,b.source_url]))+'\n## Every collection with one canonical book or one catalogue work\n\n'+table(['Collection','Classification','Canonical','Catalogue','Published','Scope','Source'],report.single_canonical_book_collections.map(c=>[c.name,c.classification,c.canonical_books,c.catalogue_books,c.published_books,c.scope,c.source_url]))+'\nKnown multi-book series still incorrectly represented by one title: '+report.incorrect_known_multi_book_singletons.length+'.\n\n## All catalogue scopes\n\n'+table(['Collection','Complete within scope','Canonical','Catalogue','Missing years','Missing artwork','Scope'],report.collections.map(c=>[c.name,c.complete,c.canonical_books,c.catalogue_books,c.missing_years,c.missing_artwork,c.description]))+'\n## Every canonical book\n\n'+table(['Book','Authors','Library','Outcome','Reason','Evidence'],report.books.map(b=>[b.title,b.authors,b.in_library?'yes':'no',b.outcome,b.reason,b.source_url])));
  console.log(JSON.stringify({...report,books:undefined,collections:undefined,single_canonical_book_collections:undefined,original_single_book_series:undefined},null,2));
} finally {await db.close();}
