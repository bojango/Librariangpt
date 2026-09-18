import test from 'node:test';
import assert from 'node:assert/strict';
import { awardsSection, displayableAccolades } from '../../src/features/accolades.js';

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
