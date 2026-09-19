import test from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_APPEARANCE, FONT_OPTIONS, applyPreferences, effectiveAppearance, normalisePreferences, sectionReset, themeReset, validateAppearance, validateCopy, validHex } from '../../src/ui/preferences.js';
import { UI_COPY, setCopyOverrides, uiCopy, uiCopyHtml } from '../../src/ui/copy.js';

test('appearance validation clamps ranges, allows all curated font IDs, and ignores unknown values', () => {
  const values = validateAppearance({ baseSize: 99, headingScale: .1, font: 'jetbrains-mono', bg: '#aBc123', unknown: 'nope', lineHeight: '1.5' });
  assert.deepEqual(values, { baseSize: 20, headingScale: .75, font: 'jetbrains-mono', bg: '#ABC123', lineHeight: 1.5 });
  assert.deepEqual(validateAppearance({ font: 'Comic Sans', bg: 'rgb(0,0,0)', navHeight: 'no' }), {});
  assert.equal(validHex('#12abEF'), true);
  assert.equal(validHex('#fff'), false);
  assert.deepEqual(FONT_OPTIONS.map(([id]) => id), ['reading-room-default', 'jetbrains-mono', 'commit-mono', 'ibm-plex-mono', 'space-mono', 'system-mono']);
  for (const [font] of FONT_OPTIONS) assert.equal(validateAppearance({ font }).font, font);
});

test('untouched controls use canonical theme tokens and reset returns to them', () => {
  const reading = effectiveAppearance({}, 'reading-room');
  const terminal = effectiveAppearance({}, 'terminal');
  assert.equal(reading.baseSize, 16);
  assert.equal(reading.bg, '#F1EEE5');
  assert.equal(reading.navHeight, 56);
  assert.equal(terminal.baseSize, 15);
  assert.equal(terminal.bg, '#EEE5C4');
  assert.equal(terminal.navHeight, 54);
  assert.notDeepEqual(reading, terminal);
  const custom = normalisePreferences({ appearanceOverrides: { terminal: { baseSize: 20, bg: '#000000', font: 'commit-mono' } } });
  assert.deepEqual(effectiveAppearance(sectionReset(custom, 'terminal', 'typography'), 'terminal').baseSize, CANONICAL_APPEARANCE.terminal.baseSize);
  assert.equal(effectiveAppearance(themeReset(custom, 'terminal'), 'terminal').bg, CANONICAL_APPEARANCE.terminal.bg);
});

test('font reset removes the custom property instead of storing an empty stack', () => {
  const values = new Map();
  const doc = { documentElement: { style: { setProperty: (key, value) => values.set(key, value), removeProperty: key => values.delete(key) } } };
  const custom = normalisePreferences({ appearanceOverrides: { terminal: { font: 'space-mono' } } });
  applyPreferences(custom, 'terminal', doc);
  assert.match(values.get('--user-font'), /Space Mono Local/);
  applyPreferences(sectionReset(custom, 'terminal', 'typography'), 'terminal', doc);
  assert.equal(values.has('--user-font'), false);
});

test('preferences retain independent overrides for each canonical theme and reset safely', () => {
  const prefs = normalisePreferences({ selectedTheme: 'terminal', appearanceOverrides: { terminal: { baseSize: 18 }, 'reading-room': { cardRadius: 9 } } });
  assert.equal(prefs.appearanceOverrides.terminal.baseSize, 18);
  assert.equal(prefs.appearanceOverrides['reading-room'].cardRadius, 9);
  assert.deepEqual(sectionReset(prefs, 'terminal', 'typography').appearanceOverrides.terminal, {});
  assert.deepEqual(themeReset(prefs, 'reading-room').appearanceOverrides['reading-room'], {});
  assert.equal(prefs.appearanceOverrides['reading-room'].cardRadius, 9);
});

test('copy overrides are plain text, bounded, and always fall back to the registry default', () => {
  const copy = validateCopy({ 'home.upNext': '<b>Next</b>', 'nav.home': '', 'bad.key': 'Ignored' });
  assert.equal(copy['home.upNext'], 'bNext/b');
  assert.equal(copy['nav.home'], undefined);
  setCopyOverrides(copy);
  assert.equal(uiCopy('home.upNext'), 'bNext/b');
  assert.equal(uiCopy('nav.home'), UI_COPY['nav.home']);
  setCopyOverrides({ 'nav.home': 'Home "& <safe>' });
  assert.equal(uiCopyHtml('nav.home'), 'Home &quot;&amp; &lt;safe&gt;');
  setCopyOverrides({});
});

test('legacy reading-room-theme selection remains compatible', () => {
  assert.equal(normalisePreferences({ selectedTheme: 'terminal' }).selectedTheme, 'terminal');
  assert.equal(normalisePreferences({ selectedTheme: 'untrusted' }).selectedTheme, 'reading-room');
});
