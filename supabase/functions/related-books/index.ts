import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const norm = (value: unknown) => String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const cleanIsbn = (value: unknown) => String(value || '').replace(/[^0-9Xx]/g, '').toUpperCase();
function validIsbn(value: string) {
  if (/^\d{13}$/.test(value)) {
    const sum = value.slice(0, 12).split('').reduce((total, char, index) => total + Number(char) * (index % 2 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === Number(value[12]);
  }
  if (/^\d{9}[\dX]$/.test(value)) {
    let sum = 0;
    for (let index = 0; index < 10; index += 1) sum += (value[index] === 'X' ? 10 : Number(value[index])) * (10 - index);
    return sum % 11 === 0;
  }
  return false;
}
function description(value: any) {
  const text = String(typeof value === 'string' ? value : value?.value || '').replace(/\s+/g, ' ').trim();
  return text ? (text.length > 2200 ? `${text.slice(0, 2197)}…` : text) : null;
}
async function fetchJson(url: string, timeout = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'ReadingRoom/related-books' } });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
  finally { clearTimeout(timer); }
}
function statusItem(row: any, fallback: any, authorName: string) {
  return {
    kind: 'library',
    book_id: fallback.id,
    title: row?.title || fallback.title,
    authors: row?.authors || authorName,
    publication_year: row?.original_publication_year || fallback.original_publication_year || null,
    synopsis: row?.synopsis || fallback.synopsis || null,
    cover_url: row?.cover_url || fallback.cover_url_preferred || null,
    overall_status: row?.overall_status || null,
    ownership_status: row?.ownership_status || null,
    series_order: row?.series_order == null ? null : Number(row.series_order)
  };
}
function externalFromDoc(doc: any, relationship: 'series' | 'author', authorName: string, seriesName: string | null, seriesOrder: number | null = null) {
  const isbns = (Array.isArray(doc?.isbn) ? doc.isbn : []).map(cleanIsbn).filter(validIsbn);
  const isbn13 = isbns.find((value: string) => value.length === 13) || null;
  const isbn10 = isbns.find((value: string) => value.length === 10) || null;
  if (!isbn13 && !isbn10) return null;
  const edition = Array.isArray(doc?.edition_key) ? doc.edition_key[0] || null : null;
  const workId = String(doc?.key || '').match(/\/works\/(OL\d+W)/)?.[1] || null;
  const title = String(doc?.title || '').trim();
  if (!title) return null;
  const authors = Array.isArray(doc?.author_name) && doc.author_name.length ? doc.author_name : [authorName];
  const coverId = Number(doc?.cover_i) || null;
  const publisher = Array.isArray(doc?.publisher) ? doc.publisher[0] || null : null;
  const publicationYear = Number(doc?.first_publish_year) || null;
  const pageCount = Number(doc?.number_of_pages_median) || null;
  const providerId = edition ? `/books/${edition}` : workId ? `/works/${workId}` : null;
  const item: any = {
    kind: 'external', relationship, discovery_id: workId || edition || `${norm(title)}-${publicationYear || ''}`,
    title, authors: authors.join(', '), publication_year: publicationYear, synopsis: null,
    cover_url: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false` : null,
    series_name: relationship === 'series' ? seriesName : null, series_order: seriesOrder,
    overall_status: null, ownership_status: null, provider_id: providerId,
    add_payload: {
      title, subtitle: null, authors, isbn10, isbn13, publisher, publication_year: publicationYear,
      page_count: pageCount, format: 'Book', cover_url: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false` : null,
      synopsis: null, primary_genre: null, language: null, open_library_work_id: workId,
      provider: 'Open Library discovery', provider_id: providerId, score: 1
    }
  };
  return item;
}
async function addSynopsis(item: any) {
  const workId = item?.add_payload?.open_library_work_id;
  if (!workId) return item;
  const work = await fetchJson(`https://openlibrary.org/works/${encodeURIComponent(workId)}.json`, 5000);
  const synopsis = description(work?.description);
  if (synopsis) {
    item.synopsis = synopsis;
    item.add_payload.synopsis = synopsis;
  }
  return item;
}
async function openLibrarySearch(author: string, query = '', limit = 40) {
  const url = new URL('https://openlibrary.org/search.json');
  url.searchParams.set('author', author);
  if (query) url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('fields', 'key,title,author_name,first_publish_year,cover_i,isbn,publisher,number_of_pages_median,edition_key');
  const data = await fetchJson(url.toString(), 7500);
  return Array.isArray(data?.docs) ? data.docs : [];
}
async function explicitSeriesOrder(doc: any, seriesName: string) {
  const workKey = String(doc?.key || '');
  if (!workKey.startsWith('/works/')) return { matches: false, order: null };
  const data = await fetchJson(`https://openlibrary.org${workKey}/editions.json?limit=8`, 5000);
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  const target = norm(seriesName);
  for (const entry of entries) {
    const values = Array.isArray(entry?.series) ? entry.series : entry?.series ? [entry.series] : [];
    for (const value of values) {
      const text = String(value || '');
      if (!text || (!norm(text).includes(target) && !target.includes(norm(text)))) continue;
      const match = text.match(/(?:#|book\s*)?(\d+(?:\.\d+)?)/i);
      return { matches: true, order: match ? Number(match[1]) : null };
    }
  }
  return { matches: false, order: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'Authentication required' }, 401);
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    const userResult = await userClient.auth.getUser();
    if (userResult.error || !userResult.data.user) return json({ error: 'Invalid session' }, 401);
    const owner = await userClient.rpc('is_library_owner');
    if (owner.error || owner.data !== true) return json({ error: 'Not authorized' }, 403);
    const userId = userResult.data.user.id;
    const admin = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const bookId = String(body?.book_id || '').trim();
    if (!bookId) return json({ error: 'book_id required' }, 400);

    const bookQuery = await admin.from('books').select('id,title,original_publication_year,synopsis,cover_url_preferred').eq('id', bookId).maybeSingle();
    if (bookQuery.error || !bookQuery.data) return json({ error: 'Book not found' }, 404);
    const currentBook = bookQuery.data;

    const authorLink = await admin.from('book_authors').select('author_id,author_order').eq('book_id', bookId).order('author_order', { ascending: true }).limit(1).maybeSingle();
    const authorId = authorLink.data?.author_id || null;
    const authorRow = authorId ? await admin.from('authors').select('id,name').eq('id', authorId).maybeSingle() : { data: null } as any;
    const authorName = String(authorRow.data?.name || '').trim();

    const seriesLink = await admin.from('book_series').select('series_id,series_order').eq('book_id', bookId).order('series_order', { ascending: true, nullsFirst: false }).limit(1).maybeSingle();
    const seriesId = seriesLink.data?.series_id || null;
    const seriesRow = seriesId ? await admin.from('series').select('id,name').eq('id', seriesId).maybeSingle() : { data: null } as any;
    const seriesName = String(seriesRow.data?.name || '').trim() || null;

    const authorLinks = authorId ? await admin.from('book_authors').select('book_id').eq('author_id', authorId) : { data: [] } as any;
    const seriesLinks = seriesId ? await admin.from('book_series').select('book_id,series_order').eq('series_id', seriesId) : { data: [] } as any;
    const authorBookIds = [...new Set((authorLinks.data || []).map((row: any) => row.book_id))];
    const seriesBookIds = [...new Set((seriesLinks.data || []).map((row: any) => row.book_id))];
    const allIds = [...new Set([...authorBookIds, ...seriesBookIds])];
    const baseBooks = allIds.length ? await admin.from('books').select('id,title,original_publication_year,synopsis,cover_url_preferred').in('id', allIds) : { data: [] } as any;
    const baseMap = new Map((baseBooks.data || []).map((row: any) => [row.id, row]));
    const libraryRows = allIds.length ? await admin.from('v_library').select('id,title,authors,overall_status,ownership_status,cover_url,original_publication_year,synopsis,series,series_order').in('id', allIds) : { data: [] } as any;
    const libraryMap = new Map((libraryRows.data || []).map((row: any) => [row.id, row]));

    const currentSeriesIds = new Set(seriesBookIds);
    const seriesItems = (seriesLinks.data || [])
      .filter((link: any) => link.book_id !== bookId)
      .map((link: any) => ({ ...statusItem(libraryMap.get(link.book_id), baseMap.get(link.book_id), authorName), series_order: link.series_order == null ? null : Number(link.series_order), relationship: 'series', series_name: seriesName }))
      .filter((item: any) => item.title);
    const authorItems = authorBookIds
      .filter((id: string) => id !== bookId && !currentSeriesIds.has(id))
      .map((id: string) => ({ ...statusItem(libraryMap.get(id), baseMap.get(id), authorName), relationship: 'author' }))
      .filter((item: any) => item.title);

    const knownAuthorTitles = new Set(authorBookIds.map((id: string) => norm(baseMap.get(id)?.title)).filter(Boolean));
    const knownSeriesTitles = new Set(seriesBookIds.map((id: string) => norm(baseMap.get(id)?.title)).filter(Boolean));
    const externalSeries: any[] = [];
    const externalAuthor: any[] = [];

    if (authorName) {
      const [authorDocs, seriesDocs] = await Promise.all([
        openLibrarySearch(authorName, '', 40),
        seriesName ? openLibrarySearch(authorName, seriesName, 16) : Promise.resolve([])
      ]);
      const seen = new Set<string>();
      if (seriesName && seriesDocs.length) {
        const checks = await Promise.all(seriesDocs.slice(0, 10).map(async (doc: any) => ({ doc, relation: await explicitSeriesOrder(doc, seriesName) })));
        for (const { doc, relation } of checks) {
          if (!relation.matches) continue;
          const key = norm(doc.title);
          if (!key || knownSeriesTitles.has(key) || seen.has(key)) continue;
          const item = externalFromDoc(doc, 'series', authorName, seriesName, relation.order);
          if (!item) continue;
          seen.add(key);
          externalSeries.push(item);
          if (externalSeries.length >= 6) break;
        }
      }
      const seriesExternalTitles = new Set(externalSeries.map(item => norm(item.title)));
      for (const doc of authorDocs) {
        const key = norm(doc.title);
        if (!key || knownAuthorTitles.has(key) || knownSeriesTitles.has(key) || seriesExternalTitles.has(key) || seen.has(key)) continue;
        const item = externalFromDoc(doc, 'author', authorName, null, null);
        if (!item) continue;
        seen.add(key);
        externalAuthor.push(item);
        if (externalAuthor.length >= 8) break;
      }
      await Promise.all([...externalSeries, ...externalAuthor].slice(0, 12).map(addSynopsis));
    }

    const seriesBooks = [...seriesItems, ...externalSeries].sort((a: any, b: any) => {
      const ao = Number.isFinite(Number(a.series_order)) ? Number(a.series_order) : 9999;
      const bo = Number.isFinite(Number(b.series_order)) ? Number(b.series_order) : 9999;
      return ao - bo || (a.publication_year || 9999) - (b.publication_year || 9999) || String(a.title).localeCompare(String(b.title));
    });
    const authorBooks = [...authorItems, ...externalAuthor];

    return json({
      series: seriesName ? {
        id: seriesId, name: seriesName, current_order: seriesLink.data?.series_order == null ? null : Number(seriesLink.data.series_order),
        total_books: seriesBookIds.length + externalSeries.length, books: seriesBooks
      } : null,
      author: authorName ? { id: authorId, name: authorName, books: authorBooks } : null,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Related books lookup failed' }, 500);
  }
});
