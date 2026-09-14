const WORK_PATTERN = /\/works\/(OL\d+W)/i;
const EDITION_PATTERN = /\/books\/(OL\d+M)/i;

export function clean(value) {
  return String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeTitle(value) {
  return clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function publisherKey(value) {
  return normalizeTitle(value).replace(/\b(?:limited|ltd|incorporated|inc|llc|plc|company|co)\b/g, '').replace(/\s+/g, ' ').trim();
}

function languageKey(value) {
  const raw = clean(typeof value === 'object' ? value?.key : value).toLowerCase().replace(/^\/languages\//, '');
  const aliases = { english: 'eng', en: 'eng', spanish: 'spa', es: 'spa', french: 'fre', fra: 'fre', fr: 'fre' };
  return aliases[raw] || raw;
}

function languages(edition, fallback) {
  const values = Array.isArray(edition?.languages) ? edition.languages : [];
  const keys = new Set([...values.map(languageKey), languageKey(fallback)].filter(Boolean));
  return keys;
}

export function pageNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const match = clean(value).match(/(-?\d{1,4})/);
  return match ? Number(match[1]) : null;
}

export function editionPageCount(edition) {
  const direct = Number(edition?.number_of_pages);
  if (Number.isSafeInteger(direct) && direct > 0) return direct;
  const pagination = clean(edition?.pagination);
  if (/^\d{1,4}$/.test(pagination)) return Number(pagination);
  return null;
}

export function editionId(edition) {
  return clean(edition?.key).match(EDITION_PATTERN)?.[1] || null;
}

export function workId(edition) {
  const works = Array.isArray(edition?.works) ? edition.works : [];
  return works.map(work => clean(work?.key).match(WORK_PATTERN)?.[1] || null).find(Boolean) || null;
}

function classify(title) {
  const value = title.toLowerCase();
  if (/^part\b/.test(value)) return 'part';
  if (/^introduction\b/.test(value)) return 'introduction';
  if (/^prologue\b/.test(value)) return 'prologue';
  if (/^epilogue\b/.test(value)) return 'epilogue';
  if (/^(appendix|acknowledg|notes|bibliograph|index)\b/.test(value)) return 'appendix';
  return 'chapter';
}

function splitTitle(raw, sequence) {
  const title = clean(raw);
  let match = title.match(/^chapter\s+([0-9ivxlcdm]+)\s*(?:[:.\-–—]\s*)?(.*)$/i);
  if (match) return { number: match[1], title: clean(match[2]) || `Chapter ${match[1]}` };
  match = title.match(/^([0-9]+)\s*[.:\-–—]\s*(.+)$/);
  if (match) return { number: match[1], title: clean(match[2]) };
  return { number: null, title: title || `Chapter ${sequence}` };
}

export function usableToc(edition, maximumPage = editionPageCount(edition)) {
  const toc = Array.isArray(edition?.table_of_contents)
    ? edition.table_of_contents
    : Array.isArray(edition?.toc) ? edition.toc : [];
  const entries = [];
  let previousPage = -1;
  for (const item of toc) {
    const page = pageNumber(item?.pagenum ?? item?.page ?? item?.start_page);
    if (page == null) continue;
    const title = clean(item?.title ?? item?.label ?? '');
    if (!title || page < 0 || page < previousPage || (maximumPage != null && page > maximumPage)) {
      return { usable: false, rows: [], tocCount: toc.length, reason: 'nonsensical_pages' };
    }
    previousPage = page;
    const parsed = splitTitle(title, entries.length + 1);
    entries.push({
      sequence_no: entries.length + 1,
      level: Number.isFinite(Number(item?.level)) ? Math.max(0, Math.floor(Number(item.level))) : 1,
      entry_type: classify(title),
      chapter_number: parsed.number,
      chapter_title: parsed.title,
      start_page: page,
      end_page: null,
    });
  }
  return { usable: entries.length > 0, rows: entries, tocCount: toc.length, reason: entries.length ? null : 'no_page_rows' };
}

function publisherMatch(requested, exactEdition, candidate) {
  const current = [requested.publisher, requested.imprint, ...(exactEdition?.publishers || [])].map(publisherKey).filter(Boolean);
  const alternate = (candidate?.publishers || []).map(publisherKey).filter(Boolean);
  return current.some(value => alternate.includes(value));
}

function languageCompatible(requested, exactEdition, candidate) {
  const current = languages(exactEdition, requested.language);
  const alternate = languages(candidate, null);
  return current.size > 0 && alternate.size > 0 && [...current].some(value => alternate.has(value));
}

export function selectSafeAlternate({ requested, exactEdition, candidates, expectedWorkId }) {
  const expectedPages = Number(requested.page_count);
  const expectedTitle = normalizeTitle(requested.title || exactEdition?.title);
  const requestedEditionId = requested.open_library_edition_id;
  let tocCandidates = 0;
  let inspected = 0;

  for (const candidate of candidates || []) {
    if (editionId(candidate) === requestedEditionId) continue;
    inspected += 1;
    const toc = usableToc(candidate);
    if (!toc.usable) continue;
    tocCandidates += 1;
    if (!expectedWorkId || workId(candidate) !== expectedWorkId) continue;
    if (!expectedTitle || normalizeTitle(candidate?.title) !== expectedTitle) continue;
    if (!languageCompatible(requested, exactEdition, candidate)) continue;
    const candidatePages = editionPageCount(candidate);
    if (!Number.isSafeInteger(expectedPages) || expectedPages <= 0 || candidatePages !== expectedPages) continue;
    if (!publisherMatch(requested, exactEdition, candidate)) continue;
    return {
      candidate,
      rows: toc.rows,
      candidateCountInspected: inspected,
      tocCandidateCount: tocCandidates,
      matchingReason: 'same_work_same_page_count_same_publisher',
    };
  }

  return { candidate: null, rows: [], candidateCountInspected: inspected, tocCandidateCount: tocCandidates, matchingReason: null };
}

export function chapterRows(tocRows, { editionId: targetEditionId, sourceEditionId }) {
  return tocRows.map(row => ({
    ...row,
    edition_id: targetEditionId,
    source: 'open_library',
    source_url: `https://openlibrary.org/books/${sourceEditionId}`,
    verified: false,
    notes: sourceEditionId === targetEditionId
      ? 'Imported automatically from the exact Open Library edition table of contents.'
      : `Imported from pagination-compatible Open Library edition ${sourceEditionId}.`,
  }));
}
