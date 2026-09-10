import test from 'node:test';
import assert from 'node:assert/strict';
import { installScrollLifecycle } from '../../src/scroll-lifecycle.js';

function target(properties = {}) {
  const events = new EventTarget();
  return Object.assign(properties, {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events)
  });
}

function harness({ suspended = () => false } = {}) {
  let nextFrame = 1;
  const frames = new Map();
  const win = target({
    scrollY: 0,
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }
  });
  const doc = target({ visibilityState: 'visible' });
  const saved = [];
  let cancels = 0;
  const destroy = installScrollLifecycle({
    getRoute: () => ({ name: 'home' }),
    save: (route, y) => saved.push([route, y]),
    cancelRestore: () => { cancels += 1; },
    isSuspended: suspended,
    win,
    doc
  });
  const runFrames = () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } };
  return { win, doc, saved, destroy, runFrames, cancels: () => cancels };
}

test('scroll persistence is animation-frame throttled', () => {
  const h = harness();
  h.win.scrollY = 640;
  h.win.dispatchEvent(new Event('scroll'));
  h.win.dispatchEvent(new Event('scroll'));
  assert.deepEqual(h.saved, []);
  h.runFrames();
  assert.deepEqual(h.saved, [['home', 640]]);
  h.destroy();
});

test('route-owned paint suppression ignores transient layout scroll events', () => {
  let suspended = true;
  const h = harness({ suspended: () => suspended });
  h.win.scrollY = 0;
  h.win.dispatchEvent(new Event('scroll'));
  h.runFrames();
  assert.deepEqual(h.saved, []);
  suspended = false;
  h.win.scrollY = 900;
  h.win.dispatchEvent(new Event('scroll'));
  h.runFrames();
  assert.deepEqual(h.saved, [['home', 900]]);
  h.destroy();
});

test('pagehide and hidden visibility flush the live position without restoring', () => {
  const h = harness();
  h.win.scrollY = 720;
  h.win.dispatchEvent(new Event('pagehide'));
  h.win.scrollY = 810;
  h.doc.visibilityState = 'hidden';
  h.doc.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(h.saved, [['home', 720], ['home', 810]]);
  assert.equal(h.cancels(), 2);
  h.destroy();
});

test('persisted pageshow cancels pending app restoration and never scrolls', () => {
  const h = harness();
  const event = new Event('pageshow');
  Object.defineProperty(event, 'persisted', { value: true });
  h.win.dispatchEvent(event);
  assert.equal(h.cancels(), 1);
  assert.deepEqual(h.saved, []);
  h.destroy();
});
