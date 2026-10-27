// Adapt the catalogue to the existing related-books shelf without edition or
// Wishlist writes. Canonical IDs always win; catalogue-only rows open their
// existing catalogue detail route and explicit Add to library action.
export function catalogueRelatedItems(members,existing,currentBookId,seriesName) {
  const ids=new Set(existing.map(item=>item.book_id).filter(Boolean));
  return members.flatMap(member=>{
    const w=member.collection_catalogue_books;
    if(!w || w.publication_state==='forthcoming' || w.book_id===currentBookId || (w.book_id&&ids.has(w.book_id))) return [];
    return [{kind:'catalogue',book_id:w.book_id || `catalogue:${w.key}`,work_key:w.key,title:w.title,authors:w.authors,
      publication_year:w.publication_year,cover_url:w.cover_url,series_order:member.official_number==null?null:Number(member.official_number),
      series_name:seriesName,relationship:'series',source_url:w.source_url}];
  });
}
