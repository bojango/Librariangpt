import { supabase } from './supabase.js';
import { normaliseAuthors, normaliseIdentity, resolveWork } from '../features/collections.js';
import { isValidIsbn } from '../utils/text.js';

async function rows(client,table,columns='*') {
  const all=[];
  for(let offset=0;;offset+=1000) {
    const {data,error}=await client.from(table).select(columns).range(offset,offset+999);
    if(error) throw error;
    all.push(...(data || []));
    if(!data || data.length<1000) return all;
  }
}

export async function loadCollectionData(client=supabase) {
  let base;
  try {
    const [books,series,bookSeries] = await Promise.all([
      rows(client,'books','id,title,original_publication_year,cover_url_preferred,book_authors(author_order,authors(name))'),
      rows(client,'series','id,name,notes'),rows(client,'book_series','book_id,series_id,series_order')
    ]);
    base={books:books.map(book=>({...book,authors:(book.book_authors || []).sort((a,b)=>(a.author_order??0)-(b.author_order??0)).map(a=>a.authors?.name).filter(Boolean).join(', ')})),series,bookSeries};
  } catch(error) { return {error:'Collection status is temporarily unavailable. Your books are unchanged.',errorDetail:error.message,available:false}; }
  try {
    const collections=await rows(client,'collections');
    const [works,memberships,paths,entries]=await Promise.all([
      rows(client,'collection_catalogue_books'),rows(client,'collection_memberships'),rows(client,'reading_paths'),rows(client,'reading_path_entries')
    ]);
    return {...base,collections,works,memberships,paths,entries,available:collections.length>0&&works.length>0};
  } catch(error) {
    // An explicitly supported deployment order: verified public catalogue works
    // before the additive backend migration. Other failures remain visible.
    if(['42P01','PGRST205'].includes(error.code)) return {...base,available:false};
    return {...base,available:false,error:'Saved reading paths could not be loaded. Try again.',errorDetail:error.message};
  }
}

const pendingAdds=new Map();
export async function addCatalogueToWishlist(work,client=supabase,search=null) {
  const {data:{user},error:authError}=await client.auth.getUser();
  if(authError) throw authError;
  if(!user) throw new Error('Sign in to add a book to your Library.');
  const key=`${user.id}:${work.key}`;
  if(pendingAdds.has(key)) return pendingAdds.get(key);
  const request=(async()=>{
    // Refresh canonical identity at the moment of the explicit user action.
    // Never trust an old Library snapshot or an ambiguous title-only match.
    const records=await rows(client,'books','id,title,book_authors(author_order,authors(name))');
    const books=records.map(book=>({...book,authors:(book.book_authors || []).sort((a,b)=>(a.author_order??0)-(b.author_order??0)).map(a=>a.authors?.name).filter(Boolean).join(', ')}));
    const matches=books.filter(book=>normaliseIdentity(book.title)===normaliseIdentity(work.title)&&normaliseAuthors(book.authors)===normaliseAuthors(work.authors));
    if(matches.length>1) throw new Error('This title has multiple catalogue records. Choose the correct book through Add book.');
    const canonical=resolveWork({...work,book_id:null},books);
    if(work.book_id&&canonical?.id!==work.book_id) throw new Error('This catalogue identity has changed. Refresh the collection before adding it.');
    if(canonical) {
      // ON CONFLICT DO NOTHING is intentional: a second click/tab must never
      // reset an Owned/Read/Paused/Wishlist entry or modify a selected edition.
      const {data,error}=await client.from('library_entries').upsert({user_id:user.id,book_id:canonical.id,overall_status:'Wishlist',ownership_status:'Not Owned',source:'collection-catalogue'},{onConflict:'book_id',ignoreDuplicates:true}).select('book_id');
      if(error) throw error;
      return {book_id:canonical.id,already_in_library:!data?.length};
    }
    let payload=work.add_payload;
    if(!payload || ![payload.isbn13,payload.isbn10].some(isValidIsbn)) {
      const lookup=search || (await import('./library.js')).searchBooks;
      const results=await lookup({query:work.title,author:work.authors});
      payload=results.find(result=>normaliseIdentity(result.title)===normaliseIdentity(work.title)
        && normaliseAuthors(result.authors)===normaliseAuthors(work.authors)
        && [result.isbn13,result.isbn10].some(isValidIsbn));
    }
    if(!payload) throw new Error('An exact source-backed edition could not be verified. Use Add book to choose an edition.');
    // Verify ISBN collisions before invoking the existing atomic, ISBN-locked
    // creation flow. Never overwrite series metadata or attach a guessed edition.
    const isbn13=isValidIsbn(payload.isbn13)?payload.isbn13:null,isbn10=isValidIsbn(payload.isbn10)?payload.isbn10:null;
    const isbn=isbn13 || isbn10;
    const {data:editions,error:editionError}=await client.from('editions').select('book_id').eq(isbn13?'isbn13':'isbn10',isbn);
    if(editionError) throw editionError;
    if(editions?.length) throw new Error('This edition is already catalogued under a different identity. Use Add book to review it.');
    const {data:{user:currentUser},error:currentAuthError}=await client.auth.getUser();
    if(currentAuthError) throw currentAuthError;
    if(currentUser?.id!==user.id) throw new Error('Your signed-in account changed. Refresh before adding this book.');
    const {data,error}=await client.rpc('library_add_selected_result',{p_result:{title:work.title,authors:work.authors.split(', '),isbn13,isbn10,provider:payload.provider || 'Verified catalogue',provider_id:payload.provider_id || null,source_url:payload.source_url || work.source_url},p_status:'Wishlist',p_ownership:'Not Owned'});
    if(error) throw error;
    return data;
  })().finally(()=>pendingAdds.delete(key));
  pendingAdds.set(key,request);
  return request;
}

export async function saveReadingPath(collectionKey,entries,client=supabase) {
  const {data,error}=await client.rpc('save_reading_path',{p_collection_key:collectionKey,p_entries:entries.map(({key,selection,reasoning})=>({work_key:key,selection,reasoning:reasoning || null}))});
  if(error) throw error;
  return data;
}
