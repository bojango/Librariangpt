import test from 'node:test';
import assert from 'node:assert/strict';
import { normalisePreferences, sectionReset, themeReset, validateAppearance, validateCopy, validHex } from '../../src/ui/preferences.js';
import { UI_COPY, setCopyOverrides, uiCopy, uiCopyHtml } from '../../src/ui/copy.js';

test('appearance validation clamps ranges, allows only bundled font IDs, and ignores unknown values', () => {
  const values = validateAppearance({ baseSize: 99, headingScale: .1, font: 'jetbrains-mono', bg: '#aBc123', unknown: 'nope', lineHeight: '1.5' });
  assert.deepEqual(values, { baseSize: 20, headingScale: .75, font: 'jetbrains-mono', bg: '#ABC123', lineHeight: 1.5 });
  assert.deepEqual(validateAppearance({ font: 'Comic Sans', bg: 'rgb(0,0,0)', navHeight: 'no' }), {});
  assert.equal(validHex('#12abEF'), true);
  assert.equal(validHex('#fff'), false);
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
