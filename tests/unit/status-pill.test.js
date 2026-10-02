import test from 'node:test';
import assert from 'node:assert/strict';
import { statusPill } from '../../src/ui/format.js';

test('collection status pill can render as a button without changing its semantic styling', () => {
  const passive = statusPill('Owned');
  assert.match(passive, /^<span class="status-pill status-owned">/);
  assert.doesNotMatch(passive, /data-collection-status|status-pill-chevron/);

  const interactive = statusPill('Owned', { interactive: true });
  assert.match(interactive, /^<button type="button" class="status-pill status-owned status-pill-action"/);
  assert.match(interactive, /data-collection-status/);
  assert.match(interactive, /aria-label="Change library status from Owned"/);
  assert.match(interactive, /status-pill-chevron/);
  assert.match(interactive, /<span>Owned<\/span>/);
});

test('interactive neutral statuses retain the same neutral pill class', () => {
  const markup = statusPill('On Order', { interactive: true });
  assert.match(markup, /status-pill status-neutral status-pill-action/);
  assert.match(markup, /<span>On Order<\/span>/);
});
