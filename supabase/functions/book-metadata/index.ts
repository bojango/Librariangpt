import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const cleanIsbn = (value: unknown) => String(value ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();

function validIsbn(isbn: string) {
  if (/^\d{13}$/.test(isbn)) {
    const sum = isbn.slice(0, 12).split('').reduce((acc, c, i) => acc + Number(c) * (i % 2 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === Number(isbn[12]);
  }
  if (/^\d{9}[\dX]$/.test(isbn)) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (isbn[i] === 'X' ? 10 : Number(isbn[i])) * (10 - i);
    return sum % 11 === 0;
  }
  return false;
}
function isoDate(value?: string | null) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`;
  return null;
}
function yearFrom(value?: string | null) {
  const match = String(value ?? '').match(/(?:^|\D)(1[0-9]{3}|20[0-9]{2}|2100)(?:\D|$)/);
  return match ? Number(match[1]) : null;
}
function normTitle(value?: string | null) { return String(value ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function titleSimilarity(a?: string | null, b?: string | null) {
  const aa = normTitle(a), bb = normTitle(b);
  if (!aa || !bb) return 1;
  if (aa.includes(bb) || bb.includes(aa)) return 1;
  const A = new Set(aa.split(' ').filter(x => x.length > 2));
  const B = new Set(bb.split(' ').filter(x => x.length > 2));
  if (!A.size || !B.size) return 0;
  return [...A].filter(x => B.has(x)).length / Math.max(A.size, B.size);
}
async function fetchJson(url: string) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'LibrarianGPT/1.0 (personal library metadata lookup)' } });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}
function googleId(v: any, type: string) { return v?.industryIdentifiers?.find((x: any) => x?.type === type)?.identifier ?? null; }

async function findReferenceIsbn(title: string, author?: string | null) {
  const olUrl = new URL('https://openlibrary.org/search.json');
  olUrl.searchParams.set('title', title);
  if (author) olUrl.searchParams.set('author', author);
  olUrl.searchParams.set('limit', '5');
  olUrl.searchParams.set('fields', 'title,author_name,isbn,edition_key,cover_i,first_publish_year');
  const olSearch = await fetchJson(olUrl.toString());
  const docs = Array.isArray(olSearch?.docs) ? olSearch.docs : [];
  const olDoc = docs.find((d: any) => titleSimilarity(title, d?.title) >= 0.5 && Array.isArray(d?.isbn) && d.isbn.length) || docs.find((d: any) => Array.isArray(d?.isbn) && d.isbn.length);
  if (olDoc) {
    const ids = olDoc.isbn.map(cleanIsbn).filter(validIsbn);
    const preferred = ids.find((x: string) => x.length === 13) || ids.find((x: string) => x.length === 10);
    if (preferred) return preferred;
  }

  const googleUrl = new URL('https://www.googleapis.com/books/v1/volumes');
  googleUrl.searchParams.set('q', `intitle:${title}${author ? ` inauthor:${author}` : ''}`);
  googleUrl.searchParams.set('maxResults', '5');
  const googleKey = Deno.env.get('GOOGLE_BOOKS_API_KEY');
  if (googleKey) googleUrl.searchParams.set('key', googleKey);
  const g = await fetchJson(googleUrl.toString());
  const items = Array.isArray(g?.items) ? g.items : [];
  const match = items.find((item: any) => titleSimilarity(title, item?.volumeInfo?.title) >= 0.5) || items[0];
  const g13 = cleanIsbn(googleId(match?.volumeInfo, 'ISBN_13'));
  const g10 = cleanIsbn(googleId(match?.volumeInfo, 'ISBN_10'));
  return validIsbn(g13) ? g13 : (validIsbn(g10) ? g10 : null);
}

async function lookupMetadata(isbn: string) {
  const ol = await fetchJson(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`);
  const googleKey = Deno.env.get('GOOGLE_BOOKS_API_KEY');
  const googleUrl = new URL('https://www.googleapis.com/books/v1/volumes');
  googleUrl.searchParams.set('q', `isbn:${isbn}`);
  googleUrl.searchParams.set('maxResults', '5');
  googleUrl.searchParams.set('projection', 'full');
  if (googleKey) googleUrl.searchParams.set('key', googleKey);
  const googleResult = await fetchJson(googleUrl.toString());
  const items = Array.isArray(googleResult?.items) ? googleResult.items : [];
  const googleItem = items.find((item: any) => {
    const v = item?.volumeInfo;
    return [googleId(v, 'ISBN_10'), googleId(v, 'ISBN_13')].map(cleanIsbn).includes(isbn);
  }) ?? items[0] ?? null;
  const gv = googleItem?.volumeInfo ?? null;
  if (!ol && !gv) throw new Error('No edition metadata found for that ISBN.');

  let work: any = null;
  const workKey = ol?.works?.[0]?.key ?? null;
  if (workKey) work = await fetchJson(`https://openlibrary.org${workKey}.json`);
  const olCoverId = Array.isArray(ol?.covers) && ol.covers.length ? ol.covers[0] : null;
  let coverUrl = olCoverId ? `https://covers.openlibrary.org/b/id/${olCoverId}-L.jpg?default=false` : null;
  if (coverUrl) {
    try { const r = await fetch(coverUrl, { method: 'HEAD' }); if (!r.ok) coverUrl = null; } catch { coverUrl = null; }
  }
  if (!coverUrl && gv?.imageLinks) {
    coverUrl = gv.imageLinks.extraLarge || gv.imageLinks.large || gv.imageLinks.medium || gv.imageLinks.small || gv.imageLinks.thumbnail || null;
    if (coverUrl) coverUrl = coverUrl.replace(/^http:/, 'https:');
  }
  let authorNames = Array.isArray(gv?.authors) ? gv.authors.filter(Boolean) : [];
  if (!authorNames.length && Array.isArray(ol?.authors)) {
    const authorDocs = await Promise.all(ol.authors.slice(0, 8).map((a: any) => a?.key ? fetchJson(`https://openlibrary.org${a.key}.json`) : null));
    authorNames = authorDocs.map((a: any) => a?.name).filter(Boolean);
  }
  const olIsbn10 = Array.isArray(ol?.isbn_10) ? ol.isbn_10.map(cleanIsbn).find((x: string) => x.length === 10) : null;
  const olIsbn13 = Array.isArray(ol?.isbn_13) ? ol.isbn_13.map(cleanIsbn).find((x: string) => x.length === 13) : null;
  const g10 = cleanIsbn(googleId(gv, 'ISBN_10')) || null;
  const g13 = cleanIsbn(googleId(gv, 'ISBN_13')) || null;
  const isbn10 = olIsbn10 || g10 || (isbn.length === 10 ? isbn : null);
  const isbn13 = olIsbn13 || g13 || (isbn.length === 13 ? isbn : null);
  const publishDateRaw = ol?.publish_date || gv?.publishedDate || null;
  const olEditionId = String(ol?.key || '').match(/\/books\/(OL\d+M)/)?.[1] || null;
  const olWorkId = String(workKey || '').match(/\/works\/(OL\d+W)/)?.[1] || null;
  const sources = [ol ? 'open_library' : null, gv ? 'google_books' : null].filter(Boolean);
  return {
    title: ol?.title || gv?.title || null,
    subtitle: ol?.subtitle || gv?.subtitle || null,
    authors: authorNames,
    publisher: Array.isArray(ol?.publishers) ? ol.publishers[0] : (gv?.publisher || null),
    publication_date: isoDate(gv?.publishedDate) || isoDate(ol?.publish_date) || null,
    publication_year: yearFrom(publishDateRaw),
    original_publication_year: yearFrom(work?.first_publish_date || null),
    page_count: Number(ol?.number_of_pages || gv?.pageCount || 0) || null,
    language: gv?.language || null,
    format: ol?.physical_format || gv?.printType || null,
    binding: ol?.physical_format || null,
    edition_statement: ol?.edition_name || null,
    physical_dimensions: ol?.physical_dimensions || (gv?.dimensions ? [gv.dimensions.height, gv.dimensions.width, gv.dimensions.thickness].filter(Boolean).join(' × ') : null),
    isbn10, isbn13, cover_url: coverUrl,
    cover_source: olCoverId ? 'Open Library' : (coverUrl ? 'Google Books' : null),
    open_library_edition_id: olEditionId,
    open_library_work_id: olWorkId,
    google_books_volume_id: googleItem?.id || null,
    metadata_source: sources.join('+'),
    metadata_match_confidence: 'Exact ISBN',
    categories: Array.isArray(gv?.categories) ? gv.categories : [],
    synopsis: typeof work?.description === 'string' ? work.description : work?.description?.value || gv?.description || null,
    raw: { open_library: ol, open_library_work: work, google_books: googleItem },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Authentication required' }, 401);
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'Invalid session' }, 401);
    const owner = await userClient.rpc('is_library_owner');
    if (owner.error || owner.data !== true) return json({ error: 'Not authorized for this library' }, 403);
    const admin = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const owned = Boolean(body?.owned);
    const setPreferred = body?.set_preferred !== false;
    let bookId = body?.book_id ? String(body.book_id) : null;
    let existingBook: any = null;
    let lookupTitle = body?.title ? String(body.title) : null;
    let lookupAuthor = body?.author ? String(body.author) : null;

    if (bookId) {
      const q = await admin.from('v_library').select('id,title,authors,cover_url,reference_edition_id').eq('id', bookId).single();
      if (q.error || !q.data) return json({ error: 'Book not found.' }, 404);
      existingBook = q.data;
      lookupTitle ||= q.data.title;
      lookupAuthor ||= String(q.data.authors || '').split(',')[0].trim() || null;
    }

    let isbn = cleanIsbn(body?.isbn);
    if (!isbn) {
      if (owned) return json({ error: 'An ISBN is required when attaching an owned copy.' }, 400);
      if (!lookupTitle) return json({ error: 'Provide an ISBN or a title for reference-edition lookup.' }, 400);
      isbn = cleanIsbn(await findReferenceIsbn(lookupTitle, lookupAuthor));
      if (!isbn) return json({ error: 'Could not find a representative ISBN for that title.' }, 404);
    }
    if (!validIsbn(isbn)) return json({ error: 'Enter a valid ISBN-10 or ISBN-13.' }, 400);
    const metadata = await lookupMetadata(isbn);

    if (existingBook && titleSimilarity(existingBook.title, metadata.title) < 0.25) {
      return json({ error: `That ISBN appears to belong to “${metadata.title}”, not “${existingBook.title}”.` }, 409);
    }

    if (!bookId) {
      if (!metadata.title) return json({ error: 'The APIs found an edition but no usable title.' }, 422);
      const inserted = await admin.from('books').insert({
        title: metadata.title, subtitle: metadata.subtitle,
        original_publication_year: metadata.original_publication_year,
        primary_genre: metadata.categories[0] || null,
        language: metadata.language, synopsis: metadata.synopsis,
        cover_url_preferred: metadata.cover_url, cover_source: metadata.cover_source,
        cover_verified: Boolean(metadata.cover_url), metadata_source: metadata.metadata_source,
        metadata_last_updated: new Date().toISOString().slice(0,10),
        notes: 'Created automatically from book metadata lookup.'
      }).select('id,title').single();
      if (inserted.error) throw inserted.error;
      bookId = inserted.data.id; existingBook = inserted.data;
      for (let i = 0; i < metadata.authors.length; i++) {
        const author = await admin.from('authors').upsert({ name: metadata.authors[i] }, { onConflict: 'name' }).select('id').single();
        if (!author.error && author.data) await admin.from('book_authors').upsert({ book_id: bookId, author_id: author.data.id, author_order: i + 1, role: 'Author' });
      }
      const status = owned ? 'Owned - Unread' : (body?.overall_status || 'Wishlist');
      const libraryInsert = await admin.from('library_entries').insert({
        user_id: userData.user.id, book_id: bookId, overall_status: status,
        ownership_status: owned ? 'Owned' : 'Not Owned',
        reading_priority: body?.reading_priority || null, source: 'book-metadata'
      });
      if (libraryInsert.error) throw libraryInsert.error;
    }

    const filters = [metadata.isbn13 ? `isbn13.eq.${metadata.isbn13}` : null, metadata.isbn10 ? `isbn10.eq.${metadata.isbn10}` : null].filter(Boolean).join(',');
    const existingEditionQuery = filters
      ? await admin.from('editions').select('id,book_id,owned,preferred_copy').or(filters).maybeSingle()
      : { data: null, error: null };
    if (existingEditionQuery.error) throw existingEditionQuery.error;
    if (existingEditionQuery.data && existingEditionQuery.data.book_id !== bookId) return json({ error: 'This ISBN is already attached to a different book in the library.' }, 409);
    if (owned && setPreferred) await admin.from('editions').update({ preferred_copy: false }).eq('book_id', bookId);

    const editionValues: any = {
      book_id: bookId, owned, preferred_copy: owned && setPreferred,
      isbn10: metadata.isbn10, isbn13: metadata.isbn13,
      publisher: metadata.publisher, publication_year: metadata.publication_year,
      publication_date: metadata.publication_date, language: metadata.language,
      format: metadata.format, binding: metadata.binding,
      edition_statement: metadata.edition_statement, page_count: metadata.page_count,
      cover_url: metadata.cover_url, cover_source: metadata.cover_source,
      cover_verified: Boolean(metadata.cover_url), edition_match_confidence: 'API Exact ISBN',
      open_library_edition_id: metadata.open_library_edition_id,
      open_library_work_id: metadata.open_library_work_id,
      google_books_volume_id: metadata.google_books_volume_id,
      metadata_source: metadata.metadata_source, metadata_last_fetched_at: new Date().toISOString(),
      metadata_match_confidence: metadata.metadata_match_confidence,
      metadata_payload: metadata.raw, is_reference: !owned,
      physical_dimensions: metadata.physical_dimensions,
    };
    let edition: any;
    if (existingEditionQuery.data) {
      const updated = await admin.from('editions').update(editionValues).eq('id', existingEditionQuery.data.id).select('*').single();
      if (updated.error) throw updated.error; edition = updated.data;
    } else {
      const insertedEdition = await admin.from('editions').insert(editionValues).select('*').single();
      if (insertedEdition.error) throw insertedEdition.error; edition = insertedEdition.data;
    }

    if (owned) {
      const entry = await admin.from('library_entries').select('overall_status').eq('book_id', bookId).single();
      const currentStatus = entry.data?.overall_status;
      const nextStatus = ['Recommended','Wishlist'].includes(currentStatus) ? 'Owned - Unread' : currentStatus;
      const updateEntry: any = { ownership_status: 'Owned', current_edition_id: edition.id };
      if (nextStatus) updateEntry.overall_status = nextStatus;
      if (metadata.page_count) updateEntry.total_pages = metadata.page_count;
      const libUpdate = await admin.from('library_entries').update(updateEntry).eq('book_id', bookId);
      if (libUpdate.error) throw libUpdate.error;
      if (metadata.page_count) await admin.from('reading_sessions').update({ total_pages: metadata.page_count }).eq('book_id', bookId).in('status', ['Reading','Paused']).is('total_pages', null);
      await admin.from('books').update({ cover_url_preferred: metadata.cover_url || null, cover_source: metadata.cover_source || null, cover_verified: Boolean(metadata.cover_url) }).eq('id', bookId);
    } else {
      await admin.from('editions').update({ is_reference: false }).eq('book_id', bookId).neq('id', edition.id);
      const bookUpdate = await admin.from('books').update({
        reference_edition_id: edition.id,
        cover_url_preferred: metadata.cover_url || existingBook?.cover_url || null,
        cover_source: metadata.cover_source || null, cover_verified: Boolean(metadata.cover_url),
        metadata_source: metadata.metadata_source, metadata_last_updated: new Date().toISOString().slice(0,10)
      }).eq('id', bookId);
      if (bookUpdate.error) throw bookUpdate.error;
    }

    await admin.from('library_events').insert({
      user_id: userData.user.id, book_id: bookId,
      event_type: owned ? 'owned_edition_enriched' : 'reference_edition_enriched', source: 'metadata_api',
      payload: { isbn, edition_id: edition.id, sources: metadata.metadata_source, page_count: metadata.page_count, cover_source: metadata.cover_source }
    });
    return json({ ok: true, book_id: bookId, edition_id: edition.id, owned, isbn_used: isbn, metadata: {
      title: metadata.title, authors: metadata.authors, isbn10: metadata.isbn10, isbn13: metadata.isbn13,
      publisher: metadata.publisher, publication_year: metadata.publication_year, page_count: metadata.page_count,
      format: metadata.format, cover_url: metadata.cover_url, cover_source: metadata.cover_source,
      sources: metadata.metadata_source, confidence: metadata.metadata_match_confidence,
    }});
  } catch (error) {
    console.error(error);
    return json({ error: error?.message || 'Metadata lookup failed.' }, 500);
  }
});
