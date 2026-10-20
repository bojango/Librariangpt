import { supabase } from './supabase.js';

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
    return {...base,collections,works,memberships,paths,entries,available:true};
  } catch(error) {
    // An explicitly supported deployment order: verified public catalogue works
    // before the additive backend migration. Other failures remain visible.
    if(['42P01','PGRST205'].includes(error.code)) return {...base,available:false};
    return {...base,available:false,error:'Saved reading paths could not be loaded. Try again.',errorDetail:error.message};
  }
}

export async function saveReadingPath(collectionKey,entries,client=supabase) {
  const {data,error}=await client.rpc('save_reading_path',{p_collection_key:collectionKey,p_entries:entries.map(({key,selection,reasoning})=>({work_key:key,selection,reasoning:reasoning || null}))});
  if(error) throw error;
  return data;
}
