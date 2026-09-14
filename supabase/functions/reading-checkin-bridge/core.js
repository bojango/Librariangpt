const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, private',
  Pragma: 'no-cache',
  'X-Robots-Tag': 'noindex, nofollow',
});

const OPTIONS_HEADERS = Object.freeze({
  ...JSON_HEADERS,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Max-Age': '600',
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function constantTimeEqual(supplied, expected) {
  const left = encoder.encode(typeof supplied === 'string' ? supplied : '');
  const right = encoder.encode(typeof expected === 'string' ? expected : '');
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0 && right.length > 0;
}

function codePointLength(value) {
  return [...value].length;
}

function optionalString(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || null;
}

function optionalInteger(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  if (typeof value === 'number' && Number.isSafeInteger(value)) return { value };
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return { value: parsed };
  }
  return { error: true };
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { value } : { error: true };
  }
  if (typeof value !== 'string') return { error: true };
  const trimmed = value.trim();
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return { error: true };
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? { value: parsed } : { error: true };
}

async function requestInput(request) {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    return {
      action: url.searchParams.get('action'),
      token: url.searchParams.get('token'),
      book_id: url.searchParams.get('book_id'),
      note_text: url.searchParams.get('note'),
      page: url.searchParams.get('page'),
      progress_percent: url.searchParams.get('progress_percent'),
      chapter_number: url.searchParams.get('chapter_number'),
      chapter_title: url.searchParams.get('chapter_title'),
    };
  }

  const length = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > 8192) throw new Error('invalid_request');
  const raw = await request.text();
  if (raw.length > 8192) throw new Error('invalid_request');
  try {
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    return parsed;
  } catch {
    throw new Error('invalid_request');
  }
}

function notePayload(input) {
  const noteText = optionalString(input.note_text);
  if (noteText === undefined || noteText === null) return { error: 'note_required' };
  if (codePointLength(noteText) > 400) return { error: 'note_too_long' };

  const bookId = optionalString(input.book_id);
  if (bookId === undefined || (bookId !== null && !UUID_PATTERN.test(bookId))) {
    return { error: 'invalid_book' };
  }

  const page = optionalInteger(input.page);
  if (page.error || (page.value !== null && page.value < 0)) return { error: 'invalid_page' };
  const progress = optionalNumber(input.progress_percent);
  if (progress.error || (progress.value !== null && (progress.value < 0 || progress.value > 100))) {
    return { error: 'invalid_progress' };
  }

  const chapterNumber = optionalString(input.chapter_number);
  const chapterTitle = optionalString(input.chapter_title);
  if (chapterNumber === undefined || chapterTitle === undefined
      || (chapterNumber !== null && codePointLength(chapterNumber) > 80)
      || (chapterTitle !== null && codePointLength(chapterTitle) > 300)) {
    return { error: 'invalid_chapter' };
  }

  return {
    value: {
      p_note_text: noteText,
      p_book_id: bookId,
      p_page: page.value,
      p_progress_percent: progress.value,
      p_chapter_number: chapterNumber,
      p_chapter_title: chapterTitle,
    },
  };
}

export async function handleBridgeRequest(request, dependencies) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: OPTIONS_HEADERS });
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405);
  }

  let input;
  try {
    input = await requestInput(request);
  } catch {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }

  const action = typeof input.action === 'string' ? input.action : '';
  if (action !== 'snapshot' && action !== 'note') {
    return json({ ok: false, error: 'unsupported_action' }, 400);
  }

  const expectedToken = action === 'snapshot' ? dependencies.readToken : dependencies.writeToken;
  if (!constantTimeEqual(input.token, expectedToken)) {
    return json({ ok: false, error: 'invalid_credentials' }, 401);
  }

  try {
    if (action === 'snapshot') {
      const snapshot = await dependencies.readSnapshot();
      if (!snapshot) throw new Error('snapshot_unavailable');
      return json({ ok: true, snapshot, bridge_version: 1 });
    }

    const parsed = notePayload(input);
    if (parsed.error) return json({ ok: false, error: parsed.error }, 400);
    const result = await dependencies.saveNote(parsed.value);
    if (!result || typeof result !== 'object') throw new Error('save_unavailable');
    if (result.ok === false) return json(result, 400);
    return json(result);
  } catch {
    return json({ ok: false, error: 'temporarily_unavailable' }, 503);
  }
}

export { constantTimeEqual, JSON_HEADERS };
