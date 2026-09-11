import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installMotionController } from '../../src/ui/motion.js';

function target(properties = {}) {
  const events = new EventTarget();
  return Object.assign(properties, { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) });
}

function classList() {
  const values = new Set();
  return { add: value => values.add(value), remove: value => values.delete(value), contains: value => values.has(value), toggle: (value, force) => { if (force === undefined ? !values.has(value) : force) values.add(value); else values.delete(value); } };
}

function createHarness({ reduced = false, standalone = false } = {}) {
  let nextFrame = 1;
  const frames = new Map();
  const navClasses = classList();
  const mainClasses = classList();
  const navStyle = new Map();
  let active = { offsetLeft: 20, offsetWidth: 80 };
  const nav = { classList: navClasses, style: { setProperty: (name, value) => navStyle.set(name, value) }, querySelector: selector => selector === '.nav-btn.active' ? active : null };
  const main = target({ classList: mainClasses, style: { setProperty() {}, removeProperty() {} }, getBoundingClientRect: () => ({ width: 390 }) });
  const win = target({ scrollY: 0, navigator: { standalone }, matchMedia: query => ({ matches: query.includes('reduced-motion') ? reduced : standalone }), requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; }, cancelAnimationFrame(id) { frames.delete(id); } });
  const doc = target({ querySelector: selector => ({ '.bottom-nav': nav, main, '#app main': main }[selector] || null) });
  const runFrames = () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } };
  return { win, doc, navClasses, main, mainClasses, navStyle, runFrames, setActive: next => { active = next; } };
}

function touchEvent(type, touches) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'touches', { value: touches });
  return event;
}

test('programmatic scroll is ignored while restoration is suspended, while deliberate scrolling controls the nav', () => {
  const harness = createHarness();
  const controller = installMotionController({ getRoute: () => ({ name: 'home' }), goBack() {}, ...harness });
  controller.suspend();
  harness.win.scrollY = 600;
  harness.win.dispatchEvent(new Event('scroll'));
  harness.runFrames();
  assert.equal(harness.navClasses.contains('compact'), false);
  controller.resume();
  harness.win.scrollY = 660;
  harness.win.dispatchEvent(new Event('scroll'));
  harness.runFrames();
  assert.equal(harness.navClasses.contains('compact'), true);
  harness.win.scrollY = 642;
  harness.win.dispatchEvent(new Event('scroll'));
  harness.runFrames();
  assert.equal(harness.navClasses.contains('compact'), false);
  controller.destroy();
});

test('tab navigation can explicitly expand the nav and reset its scroll baseline', () => {
  const harness = createHarness();
  const controller = installMotionController({ getRoute: () => ({ name: 'home' }), goBack() {}, ...harness });
  harness.navClasses.add('compact');
  harness.win.scrollY = 421;
  controller.suspend({ expand: true });
  assert.equal(harness.navClasses.contains('compact'), false);
  controller.resume();
  harness.win.scrollY = 440;
  harness.win.dispatchEvent(new Event('scroll'));
  harness.runFrames();
  assert.equal(harness.navClasses.contains('compact'), false);
  controller.destroy();
});

test('the shared nav indicator tracks the active button and is instant for reduced motion', () => {
  const harness = createHarness();
  const controller = installMotionController({ getRoute: () => ({ name: 'home' }), goBack() {}, ...harness });
  controller.alignIndicator();
  assert.equal(harness.navStyle.get('--nav-indicator-x'), '53px');
  harness.setActive({ offsetLeft: 260, offsetWidth: 80 });
  controller.alignIndicator();
  assert.equal(harness.navStyle.get('--nav-indicator-x'), '293px');
  controller.destroy();
  const reducedHarness = createHarness({ reduced: true });
  const reducedController = installMotionController({ getRoute: () => ({ name: 'home' }), goBack() {}, ...reducedHarness });
  reducedController.alignIndicator();
  assert.equal(reducedHarness.navClasses.contains('indicator-instant'), true);
  reducedController.destroy();
});

test('standalone book swipe waits for settling before back navigation and cancellation stays put', () => {
  const harness = createHarness({ standalone: true });
  let backCalls = 0;
  const controller = installMotionController({ getRoute: () => ({ name: 'book' }), goBack: () => { backCalls += 1; }, ...harness });
  harness.doc.dispatchEvent(touchEvent('touchstart', [{ clientX: 10, clientY: 100 }]));
  harness.doc.dispatchEvent(touchEvent('touchmove', [{ clientX: 72, clientY: 105 }]));
  harness.doc.dispatchEvent(touchEvent('touchend', []));
  assert.equal(backCalls, 0);
  assert.equal(harness.mainClasses.contains('swipe-settling'), true);
  const completed = new Event('transitionend');
  Object.defineProperty(completed, 'propertyName', { value: 'transform' });
  harness.main.dispatchEvent(completed);
  assert.equal(backCalls, 1);
  harness.doc.dispatchEvent(touchEvent('touchstart', [{ clientX: 10, clientY: 100 }]));
  harness.doc.dispatchEvent(touchEvent('touchmove', [{ clientX: 35, clientY: 104 }]));
  harness.doc.dispatchEvent(touchEvent('touchend', []));
  harness.main.dispatchEvent(completed);
  assert.equal(backCalls, 1);
  controller.destroy();
});

test('book detail hydration does not replay a route entrance', async () => {
  const app = await readFile(new URL('../../src/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /markRouteExit|route-leave-overlay|detailResolve/);
  assert.match(app, /transition: transition && !paintedLoading/);
});
