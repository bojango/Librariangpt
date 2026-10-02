import test from 'node:test';
import assert from 'node:assert/strict';
import { bookStatusPills, collectionStatusLabel, statusPill } from '../../src/ui/format.js';

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


test('collection status remains one clickable pill as availability changes', () => {
  assert.equal(collectionStatusLabel({ overall_status: 'Wishlist', ownership_status: 'Not Owned' }), 'Wishlist');
  assert.equal(collectionStatusLabel({ overall_status: 'Wishlist', ownership_status: 'On Order' }), 'On Order');
  assert.equal(collectionStatusLabel({ overall_status: 'Owned - Unread', ownership_status: 'Owned' }), 'Owned');

  const wishlist = bookStatusPills({ overall_status: 'Wishlist', ownership_status: 'Not Owned' });
  assert.match(wishlist, /data-collection-status/);
  assert.match(wishlist, /<span>Wishlist<\/span>/);
  assert.doesNotMatch(wishlist, /<span>Not Owned<\/span>/);

  const ordered = bookStatusPills({ overall_status: 'Wishlist', ownership_status: 'On Order' });
  assert.match(ordered, /data-collection-status/);
  assert.match(ordered, /<span>On Order<\/span>/);
  assert.doesNotMatch(ordered, /<span>Wishlist<\/span>/);

  const owned = bookStatusPills({ overall_status: 'Owned - Unread', ownership_status: 'Owned' });
  assert.match(owned, /data-collection-status/);
  assert.match(owned, /<span>Owned<\/span>/);
  assert.doesNotMatch(owned, /Owned - Unread/);
});

test('reading lifecycle stays visible beside the persistent collection control', () => {
  const markup = bookStatusPills({ overall_status: 'Currently Reading', ownership_status: 'Owned' });
  assert.match(markup, /status-currently-reading/);
  assert.match(markup, /<span>Currently Reading<\/span>/);
  assert.match(markup, /data-collection-status/);
  assert.match(markup, /<span>Owned<\/span>/);
});
