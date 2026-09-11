import test from 'node:test';
import assert from 'node:assert/strict';
import { installMotionController } from '../../src/ui/motion.js';

function target(properties = {}) {
  const events = new EventTarget();
  return Object.assign(properties, {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events)
  });
}

test('bottom navigation minimises and expands only after intentional scroll thresholds', () => {
  let nextFrame = 1;
  const frames = new Map();
  const classes = new Set();
  const nav = { classList: { add: value => classes.add(value), remove: value => classes.delete(value) } };
  const win = target({
    scrollY: 0,
    navigator: {},
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }
  });
  const doc = target({ querySelector: selector => selector === '.bottom-nav' ? nav : null });
  const runFrame = () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } };
  const destroy = installMotionController({ getRoute: () => ({ name: 'home' }), goBack() {}, win, doc });

  win.scrollY = 20;
  win.dispatchEvent(new Event('scroll'));
  runFrame();
  assert.equal(classes.has('compact'), false);

  win.scrollY = 85;
  win.dispatchEvent(new Event('scroll'));
  runFrame();
  assert.equal(classes.has('compact'), true);

  win.scrollY = 75;
  win.dispatchEvent(new Event('scroll'));
  runFrame();
  assert.equal(classes.has('compact'), true);

  win.scrollY = 56;
  win.dispatchEvent(new Event('scroll'));
  runFrame();
  assert.equal(classes.has('compact'), false);
  destroy();
});
