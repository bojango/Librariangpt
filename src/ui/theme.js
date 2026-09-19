export const THEME_STORAGE_KEY = 'reading-room-theme';
export const THEMES = Object.freeze({
  READING_ROOM: 'reading-room',
  TERMINAL: 'terminal'
});

export function normaliseTheme(theme) {
  return Object.values(THEMES).includes(theme) ? theme : THEMES.READING_ROOM;
}

export function savedTheme(storage = window.localStorage) {
  try { return normaliseTheme(storage.getItem(THEME_STORAGE_KEY)); }
  catch { return THEMES.READING_ROOM; }
}

export function applyTheme(theme, { persist = true, doc = document } = {}) {
  const nextTheme = normaliseTheme(theme);
  doc.documentElement.dataset.theme = nextTheme;
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', nextTheme === THEMES.TERMINAL ? '#f3efe5' : '#f1eee5');
  if (persist) {
    try { window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme); }
    catch { /* Private browsing and restrictive storage should not block theme use. */ }
  }
  return nextTheme;
}

export function initialiseTheme() {
  return applyTheme(savedTheme(), { persist: false });
}

export function themeSelectorMarkup(theme = savedTheme()) {
  const active = normaliseTheme(theme);
  return `<section class="sidebar-section appearance-settings" aria-labelledby="appearance-heading"><h3 id="appearance-heading">Appearance</h3><p class="appearance-copy">Choose the interface skin for this device.</p><div class="theme-selector" role="radiogroup" aria-label="Interface skin">${[
    [THEMES.READING_ROOM, 'Reading Room'],
    [THEMES.TERMINAL, 'Terminal']
  ].map(([value, label]) => `<button type="button" class="theme-option ${active === value ? 'active' : ''}" data-theme-choice="${value}" role="radio" aria-checked="${active === value}">${label}</button>`).join('')}</div></section>`;
}
