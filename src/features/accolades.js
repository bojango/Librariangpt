import { esc } from '../ui/format.js';

const resultRank = { Winner: 0, Bestseller: 1, Recognition: 1, Finalist: 2, Shortlisted: 3, Longlisted: 4, Nominee: 5 };

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch { return ''; }
}

export function displayableAccolades(rows = []) {
  const unique = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.verified || !row?.accolade?.name) continue;
    const key = [row.accolade_id || row.accolade.id || row.accolade.name, row.year ?? '', row.result || '', row.category || ''].join('|');
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()].sort((a, b) =>
    (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER)
    || (resultRank[a.result] ?? 9) - (resultRank[b.result] ?? 9)
    || (b.year ?? -1) - (a.year ?? -1)
    || String(a.accolade.name).localeCompare(String(b.accolade.name))
  );
}

function tile(row) {
  const accolade = row.accolade;
  const source = safeExternalUrl(row.source_url) || safeExternalUrl(accolade.official_url);
  const status = [row.result && row.result !== 'Recognition' ? row.result : '', row.year].filter(Boolean).join(' · ') || accolade.type;
  const mark = String(accolade.short_name || accolade.name).trim().slice(0, 3).toUpperCase();
  const logo = safeExternalUrl(accolade.logo_url);
  const body = `<span class="award-logo">${logo ? `<img class="award-logo-image" src="${esc(logo)}" alt="${esc(accolade.logo_alt || `${accolade.name} mark`)}"><span class="award-logo-fallback" aria-hidden="true">${esc(mark)}</span>` : `<span class="award-logo-fallback">${esc(mark)}</span>`}</span><span class="award-name">${esc(accolade.name)}</span><span class="award-status">${esc(status)}</span>`;
  return source ? `<a class="award-tile" href="${esc(source)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(`${accolade.name}: ${status}. Open source`)}">${body}</a>` : `<article class="award-tile">${body}</article>`;
}

export function awardsSection(rows = []) {
  const accolades = displayableAccolades(rows);
  if (!accolades.length) return '';
  return `<section class="awards-section" data-detail-slot="awards"><h2>Awards</h2><div class="awards-shelf" role="list" aria-label="Awards and recognition">${accolades.map(tile).join('')}</div></section>`;
}
