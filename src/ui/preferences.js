import { THEMES, normaliseTheme } from './theme.js';
import { UI_COPY, setCopyOverrides } from './copy.js';

export const PREFERENCES_STORAGE_KEY = 'reading-room-ui-preferences-v1';
export const FONT_OPTIONS = Object.freeze([
  ['reading-room-default', 'Reading Room Default'],
  ['jetbrains-mono', 'JetBrains Mono'],
  ['commit-mono', 'Commit Mono'],
  ['ibm-plex-mono', 'IBM Plex Mono'],
  ['space-mono', 'Space Mono'],
  ['system-mono', 'System Mono']
]);
export const FONT_STACKS = Object.freeze({
  'reading-room-default': 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  'jetbrains-mono': '"JetBrains Mono Local", ui-monospace, monospace',
  'commit-mono': '"Commit Mono Local", ui-monospace, monospace',
  'ibm-plex-mono': '"IBM Plex Mono Local", ui-monospace, monospace',
  'space-mono': '"Space Mono Local", ui-monospace, monospace',
  'system-mono': 'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace'
});
export const CANONICAL_APPEARANCE = Object.freeze({
  'reading-room': Object.freeze({
    baseSize: 16, headingAdjust: 0, lineHeight: 1.48, letterSpacing: 0, fontWeight: '400',
    bg: '#F1EEE5', surface: '#F7F4EC', surfaceAlt: '#E9E5DA', text: '#171613', muted: '#656158', border: '#D0CDC4', accent: '#171613', activeBg: '#171613', activeText: '#F1EEE5',
    cardRadius: 0, controlRadius: 0, borderWidth: 1, density: 1, navHeight: 56, navIconSize: 19, navLabelSize: 10, showNavLabels: true
  }),
  terminal: Object.freeze({
    baseSize: 15, headingAdjust: 0, lineHeight: 1.48, letterSpacing: 0, fontWeight: '400',
    bg: '#EEE5C4', surface: '#EEE5C4', surfaceAlt: '#E6DBB8', text: '#1B1914', muted: '#625D4D', border: '#625D4D', accent: '#1B1914', activeBg: '#1B1914', activeText: '#EEE5C4',
    cardRadius: 6, controlRadius: 4, borderWidth: 1, density: 1, navHeight: 54, navIconSize: 17, navLabelSize: 8, showNavLabels: true
  })
});
export function canonicalAppearance(theme) { return CANONICAL_APPEARANCE[normaliseTheme(theme)]; }
export function effectiveAppearance(preferences, theme) {
  const safe = normalisePreferences(preferences || {});
  const active = normaliseTheme(theme);
  return { ...canonicalAppearance(active), ...safe.appearanceOverrides[active] };
}
export const APPEARANCE_SECTIONS = Object.freeze({
  typography: ['font', 'baseSize', 'headingAdjust', 'lineHeight', 'letterSpacing', 'fontWeight'],
  colours: ['bg', 'surface', 'surfaceAlt', 'text', 'muted', 'border', 'accent', 'activeBg', 'activeText'],
  geometry: ['cardRadius', 'controlRadius', 'borderWidth', 'density'],
  navigation: ['navHeight', 'navIconSize', 'navLabelSize', 'showNavLabels']
});
const ranges = { baseSize:[12,20], headingAdjust:[-8,8], lineHeight:[1.2,1.8], letterSpacing:[-.04,.12], cardRadius:[0,20], controlRadius:[0,16], borderWidth:[0,3], density:[.85,1.2], navHeight:[44,76], navIconSize:[14,26], navLabelSize:[8,16] };
const colorKeys = new Set(APPEARANCE_SECTIONS.colours);
const numberKeys = new Set(Object.keys(ranges));
const fontIds = new Set(FONT_OPTIONS.map(([id]) => id));
const weightIds = new Set(['400', '500', '600', '700']);
const hex = /^#[0-9a-f]{6}$/i;

export function validHex(value) { return hex.test(String(value || '').trim()); }
function clamp(value, [min, max]) { return Math.min(max, Math.max(min, Number(value))); }
export function validateAppearance(input = {}) {
  const out = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (colorKeys.has(key) && validHex(value)) out[key] = String(value).trim().toUpperCase();
    else if (numberKeys.has(key) && Number.isFinite(Number(value))) out[key] = clamp(value, ranges[key]);
    else if (key === 'font' && fontIds.has(value)) out[key] = value;
    else if (key === 'fontWeight' && weightIds.has(String(value))) out[key] = String(value);
    else if (key === 'showNavLabels' && typeof value === 'boolean') out[key] = value;
  }
  return out;
}
export function validateCopy(input = {}) {
  const out = {};
  for (const key of Object.keys(UI_COPY)) {
    const value = input?.[key];
    if (typeof value !== 'string') continue;
    const clean = value.replace(/[<>]/g, '').replace(/[\u0000-\u001f]/g, '').trim();
    if (clean && clean.length <= 60) out[key] = clean;
  }
  return out;
}
export function normalisePreferences(input = {}) {
  const rawAppearance = input.appearance_overrides || input.appearanceOverrides || {};
  const rawCopy = input.copy_overrides || input.copyOverrides || {};
  const appearanceOverrides = {};
  for (const theme of Object.values(THEMES)) {
    const raw = { ...(rawAppearance?.[theme] || {}) };
    // The legacy scale replaced responsive sizes with a scaled 1em. Retain the
    // user's intent conservatively by mapping each 0.05 step to one pixel.
    if (!Object.hasOwn(raw, 'headingAdjust') && Number.isFinite(Number(raw.headingScale))) {
      raw.headingAdjust = Math.round((Number(raw.headingScale) - 1) * 20);
    }
    delete raw.headingScale;
    appearanceOverrides[theme] = validateAppearance(raw);
  }
  return { version: 1, selectedTheme: normaliseTheme(input.selected_theme || input.selectedTheme), appearanceOverrides, copyOverrides: validateCopy(rawCopy) };
}
export function preferenceStatesEqual(left, right) {
  return JSON.stringify(normalisePreferences(left)) === JSON.stringify(normalisePreferences(right));
}
export function updateAppearanceDraft(preferences, theme, key, value) {
  const next = normalisePreferences(preferences);
  const target = next.appearanceOverrides[normaliseTheme(theme)];
  const validated = validateAppearance({ [key]: value });
  if (colorKeys.has(key)) {
    if (Object.hasOwn(validated, key)) target[key] = validated[key];
    return next;
  }
  if (value === '') delete target[key];
  else if (Object.hasOwn(validated, key)) target[key] = validated[key];
  return next;
}
export function updateCopyDraft(preferences, key, value) {
  const next = normalisePreferences(preferences);
  const validated = validateCopy({ [key]: value });
  if (Object.hasOwn(validated, key)) next.copyOverrides[key] = validated[key];
  else delete next.copyOverrides[key];
  return next;
}
export function readCachedPreferences(storage = window.localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(PREFERENCES_STORAGE_KEY) || '{}');
    return normalisePreferences({ ...parsed, selectedTheme: parsed.selectedTheme || storage.getItem('reading-room-theme') });
  } catch { return normalisePreferences({ selectedTheme: storage.getItem('reading-room-theme') }); }
}
export function cachePreferences(prefs, storage = window.localStorage) { try { storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(normalisePreferences(prefs))); } catch {} }
function styleSet(doc, key, value) { doc.documentElement.style.setProperty(key, String(value)); }
export function applyPreferences(preferences, theme = preferences?.selectedTheme, doc = document) {
  const safe = normalisePreferences(preferences || {}); const active = normaliseTheme(theme); const values = safe.appearanceOverrides[active] || {};
  const vars = { bg:'--user-bg', surface:'--user-surface', surfaceAlt:'--user-surface-alt', text:'--user-text', muted:'--user-muted', border:'--user-border', accent:'--user-accent', activeBg:'--user-active-bg', activeText:'--user-active-text', cardRadius:'--user-card-radius', controlRadius:'--user-control-radius', borderWidth:'--user-border-width', density:'--user-density-scale', navHeight:'--user-nav-height', navIconSize:'--user-nav-icon-size', navLabelSize:'--user-nav-label-size', showNavLabels:'--user-show-nav-labels', baseSize:'--user-base-font-size', headingAdjust:'--user-heading-adjust', lineHeight:'--user-line-height', letterSpacing:'--user-letter-spacing', fontWeight:'--user-font-weight' };
  Object.values(vars).forEach(key => doc.documentElement.style.removeProperty(key));
  doc.documentElement.style.removeProperty('--user-font');
  Object.entries(values).forEach(([key, value]) => {
    if (key === 'font' && FONT_STACKS[value]) styleSet(doc, '--user-font', FONT_STACKS[value]);
    else if (vars[key]) styleSet(doc, vars[key], numberKeys.has(key) ? `${value}${['baseSize','headingAdjust','cardRadius','controlRadius','borderWidth','navHeight','navIconSize','navLabelSize'].includes(key) ? 'px' : key === 'letterSpacing' ? 'em' : ''}` : value);
  });
  setCopyOverrides(safe.copyOverrides); return safe;
}
export function sectionReset(preferences, theme, section) {
  const next = normalisePreferences(preferences); const target = next.appearanceOverrides[normaliseTheme(theme)];
  for (const key of APPEARANCE_SECTIONS[section] || []) delete target[key]; return next;
}
export function themeReset(preferences, theme) { const next = normalisePreferences(preferences); next.appearanceOverrides[normaliseTheme(theme)] = {}; return next; }
export function copySectionReset(preferences, section) { const next = normalisePreferences(preferences); const prefix = `${section}.`; Object.keys(next.copyOverrides).filter(key => key.startsWith(prefix)).forEach(key => delete next.copyOverrides[key]); return next; }
export function changedSections(preferences, theme) { const values = normalisePreferences(preferences).appearanceOverrides[normaliseTheme(theme)]; return Object.fromEntries(Object.entries(APPEARANCE_SECTIONS).map(([name, keys]) => [name, keys.some(key => key in values)])); }
export async function loadRemotePreferences(client, userId) {
  const { data, error } = await client.from('reader_ui_preferences').select('selected_theme,appearance_overrides,copy_overrides').eq('user_id', userId).maybeSingle();
  if (error && error.code !== 'PGRST116') throw error; return data ? normalisePreferences(data) : null;
}
export async function saveRemotePreferences(client, userId, preferences) {
  const safe = normalisePreferences(preferences);
  const { error } = await client.from('reader_ui_preferences').upsert({ user_id:userId, selected_theme:safe.selectedTheme, appearance_overrides:safe.appearanceOverrides, copy_overrides:safe.copyOverrides }, { onConflict:'user_id' });
  if (error) throw error; return safe;
}
