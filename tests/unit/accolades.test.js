import test from 'node:test';
import assert from 'node:assert/strict';
import { activateAwardLogos, awardsSection, displayableAccolades, safeAwardLogoUrl } from '../../src/features/accolades.js';

const accolade = (name, extra = {}) => ({ id: name, name, type: 'Award', ...extra });
const row = (name, extra = {}) => ({ id: `${name}-row`, accolade_id: name, accolade: accolade(name), verified: true, result: 'Winner', source_url: 'https://example.test/source', ...extra });

test('Awards is absent without verified displayable accolades', () => {
  assert.equal(awardsSection([]), '');
  assert.equal(awardsSection([row('Unverified', { verified: false })]), '');
});

test('Awards renders verified source-backed accolades safely and deterministically', () => {
  const html = awardsSection([row('Zeta', { year: 2020 }), row('<Nebula>', { year: 2024, sort_order: 1 }), row('Alpha', { year: 2025, sort_order: 1 })]);
  assert.match(html, /<h2>Awards<\/h2>/);
  assert.match(html, /&lt;Nebula&gt;/);
  assert.doesNotMatch(html, /<Nebula>/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.ok(html.indexOf('Alpha') < html.indexOf('&lt;Nebula&gt;'));
});

test('duplicate claims collapse, missing logos have a mark, and unsafe sources do not link', () => {
  const rows = [row('Booker', { year: 2024 }), row('Booker', { id: 'duplicate', year: 2024 }), row('Unsafe', { source_url: 'javascript:alert(1)' })];
  const html = awardsSection(rows);
  assert.equal(displayableAccolades(rows).length, 2);
  assert.match(html, /class="award-logo-fallback">BOO/);
  assert.doesNotMatch(html, /javascript:/);
});

test('managed award logos render with escaped metadata and untrusted logo hosts fall back', () => {
  const trusted = 'https://fbbpovieqfsjunmqtxvf.supabase.co/storage/v1/object/public/award-logos/hugo-award-v1.webp';
  const logoRow = row('Hugo Award', { accolade: accolade('Hugo Award', { logo_url: trusted, logo_alt: 'Hugo <Award> logo' }) });
  const unsafeRow = row('Unsafe Logo', { accolade: accolade('Unsafe Logo', { logo_url: 'https://example.test/logo.webp' }) });
  const html = awardsSection([logoRow, unsafeRow]);
  assert.match(html, new RegExp(`src="${trusted.replaceAll('.', '\\.')}`));
  assert.match(html, /alt="Hugo &lt;Award&gt; logo"/);
  assert.equal((html.match(/class="award-logo-image"/g) || []).length, 1);
  assert.equal(safeAwardLogoUrl('javascript:alert(1)'), '');
  assert.equal(safeAwardLogoUrl('https://fbbpovieqfsjunmqtxvf.supabase.co/storage/v1/object/public/book-covers/not-an-award.webp'), '');
  assert.equal(safeAwardLogoUrl(trusted), trusted);
});

test('a failed award image is hidden so its adjacent fallback becomes visible', () => {
  let errorHandler;
  const image = {
    dataset: {},
    hidden: false,
    addEventListener(type, handler) { if (type === 'error') errorHandler = handler; }
  };
  const root = { querySelectorAll: selector => selector === '.award-logo-image' ? [image] : [] };
  activateAwardLogos(root);
  assert.equal(image.dataset.awardLogoActive, 'true');
  errorHandler();
  assert.equal(image.hidden, true);
});

test('award shelves preserve one, two, three and more-than-three real claim counts', () => {
  for (const count of [1, 2, 3, 4]) {
    const html = awardsSection(Array.from({ length: count }, (_, index) => row(`Award ${index + 1}`)));
    assert.equal((html.match(/class="award-tile"/g) || []).length, count);
  }
});

test('awards shelf is a three-up native horizontal scroll shelf', async () => {
  const css = await (await import('node:fs/promises')).readFile('src/styles/app.css', 'utf8');
  assert.match(css, /\.awards-shelf\{[^}]*grid-auto-columns:calc\(\(100% - 2 \* 10px\)\/3\)[^}]*overflow-x:auto[^}]*scroll-snap-type:x mandatory/);
  assert.match(css, /\.award-logo-image\[hidden\]\+\.award-logo-fallback\{display:grid/);
});

test('accolade migration normalizes claims with provenance, indexes, RLS, and owner policies', async () => {
  const sql = await (await import('node:fs/promises')).readFile('supabase/migrations/20260918110000_add_book_accolades.sql', 'utf8');
  assert.match(sql, /create table public\.accolades/i);
  assert.match(sql, /create table public\.book_accolades/i);
  assert.match(sql, /source_url text not null/i);
  assert.match(sql, /unique nulls not distinct \(book_id, accolade_id, year, result, category\)/i);
  assert.match(sql, /book_accolades_book_display_idx/i);
  assert.match(sql, /alter table public\.accolades enable row level security/i);
  assert.match(sql, /create policy owner_all_book_accolades/i);
});

test('award-logo migration records provenance and creates a restricted public media bucket', async () => {
  const sql = await (await import('node:fs/promises')).readFile('supabase/migrations/20260919054627_create_award_logo_library.sql', 'utf8');
  assert.match(sql, /logo_source_url text/i);
  assert.match(sql, /logo_source_name text/i);
  assert.match(sql, /'award-logos', 'award-logos', true, 1048576/i);
  assert.match(sql, /array\['image\/png', 'image\/webp'\]/i);
  assert.match(sql, /create policy owner_manage_award_logos[\s\S]*to authenticated[\s\S]*private\.is_owner\(\)/i);
  assert.doesNotMatch(sql, /to anon[\s\S]*insert/i);
});
