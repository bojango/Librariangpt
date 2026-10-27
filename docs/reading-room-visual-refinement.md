# Reading Room visual refinement

Review branch: `feat/reading-room-visual-refinement`
Base: `f069921a2987504dde1b0370671776adc60b4890`

## Changes

- Startup uses the existing logo and warm theme canvas, with “Entering Reading Room”. Critical styles and the initial theme colour live in `index.html`, so the background is correct before the external stylesheet arrives. `src/ui/motion.js` consumes the splash once on first paint: a 160 ms fade overlaps a maximum of four visible Home groups, completing their small opacity/4 px transitions within 300 ms. Reduced motion removes the splash immediately. No readiness delay, cover download gate, animation loop or dependency was added.
- Active and finished sessions share the compact cover/title header and ruled information grid in `src/views/reading-session-shared.js`. Covers use the existing renderer and the canonical `cover_url` included in the existing session book query. Dates use the existing date formatter and UK time formatting in the device’s time zone. Timer arithmetic, page rules, pace, Reading/Test classification and RPC submission remain unchanged.
- Save Session and End Session use the existing button variants in an action area above the measured navigation dock. Content reserves the action area’s space. Keyboard viewport changes and very short landscape screens return the actions to normal document flow. Input focus follows an explicit tap rather than opening the keyboard on entry. Event listeners are removed when leaving the session.
- Eligible Start/Resume actions now follow the rating cards and precede Synopsis. Non-reading Edit cover lives directly below Edit book settings inside the accordion. The open accordion survives a same-book refresh, keeping the relocated action available after saving a cover. Currently Reading controls and unrelated wishlist actions keep their existing locations and handlers.

Other source changes are limited to scoped session CSS, startup status-surface handling, and a null guard in the existing book lookup: tapping a session input before any book detail had been opened exposed the pre-existing null lookup during browser verification.

`index.html`, `sw.js` and the generation assertion advance the app shell to generation **127**. Generated `dist/app.js` and its source map are rebuilt. Cover cache versions, priorities and reuse logic are unchanged. No database, migration, live session or production deployment was changed.

## Main files

| Files | Purpose |
| --- | --- |
| `index.html`, `src/ui/motion.js` | Critical boot canvas, original logo and once-only handoff |
| `src/ui/status-surface.js`, `src/ui/theme.js` | Startup status colour, then existing header/page surface behaviour |
| `src/views/reading-session-{shared,active,finish}.js` | Shared book header, date stamps, information grid and existing semantic controls |
| `src/features/reading-session.js`, `src/data/nfc.js` | Action-area measurements/cleanup, UK time display and existing cover field |
| `src/views/book-detail.js` | Status-preserving action relocation |
| `src/app.js` | First-paint handoff, deliberate page-entry focus, safe book lookup and same-book disclosure continuity |
| `src/styles/app.css` | Scoped session layout and accordion button stacking |
| `sw.js`, `dist/app.js`, `dist/app.js.map` | Coherent release generation and generated bundle |
| `tests/e2e/visual-refinement.spec.js`, `tests/helpers/nfc-app.js` | Responsive/theme/boot/keyboard/action regression matrix with isolated fixtures |
| Existing NFC, edition-route, stability, motion and generation tests | Regression expectations and focused motion checks |
| `scripts/verify-reading-room-refinement.mjs` | Reproducible rendered screenshots and interaction evidence |

## Rendered evidence

These are actual browser screenshots using isolated HTTP fixtures. The small Influx cover is a deterministic fixture image, not an external download. [Browser measurements](reading-room-visual-refinement/browser-evidence.json) record zero scroll at capture, visible Save buttons above the dock, no horizontal overflow and an advancing live timer in both engines and themes.

| Interface | Screenshot |
| --- | --- |
| Loading screen | [Loading](reading-room-visual-refinement/loading.png) |
| Home after startup | [Home](reading-room-visual-refinement/home.png) |
| Active session | [Active session](reading-room-visual-refinement/active-session.png) |
| Finished session, Save visible without scrolling | [Finished session](reading-room-visual-refinement/finished-session.png) |
| Unread book, Start reading below ratings | [Unread book](reading-room-visual-refinement/unread-book.png) |
| Expanded edition details, Edit cover beneath settings | [Edition details](reading-room-visual-refinement/edition-details.png) |
| Currently Reading controls | [Currently Reading](reading-room-visual-refinement/currently-reading.png) |
| Terminal session | [Terminal](reading-room-visual-refinement/terminal-session.png) |
| Tablet / desktop | [768 px](reading-room-visual-refinement/tablet-session.png), [1280 px](reading-room-visual-refinement/desktop-session.png) |
| Supplied base comparison | [Original session](reading-room-visual-refinement/baseline-finished-session.png), [original unread book](reading-room-visual-refinement/baseline-unread-book.png) |

The focused E2E matrix uses widths **320, 375, 390, 430, 768 and 1280 px**, both themes, Chromium and WebKit. Additional cases cover long titles/multiple authors, absent covers, enlarged appearance settings, reduced motion, resized keyboard viewports, short landscape screens and simulated safe-area insets with a customised dock height.

## Verification

- `npm ci`: passed with the locked dependencies.
- `npm run build`: passed.
- `npm run check`: passed; no new runtime observers or clients.
- `npm test`: **451 passed**.
- `npm run test:e2e -- --workers=2 --reporter=line`: **301 passed, 1 intentionally skipped** (the mobile navigation case does not apply to the desktop side rail). Final complete run: no failures.

The regression tests cover session End/Restart/Change, save/skip, invalid pages, live pace, Test sessions, NFC cold/warm routing, authentication, cover picker uploads and persistence, status-based actions, service-worker generation, Home, Library, Collections and Profile. Old cover tests now open the accordion before clicking the relocated button; status-canvas assertions wait for the startup fade to complete. The cover fixture now keeps its metadata timestamp stable across reads instead of inventing a change on every fetch.

Reproduce screenshots with the local server running:

```sh
node scripts/serve.mjs
node scripts/verify-reading-room-refinement.mjs
```

Screenshots and measurements are also written to `output/playwright/refinement/`.

The iPhone checks use simulated WebKit, including a standalone navigator flag and synthetic safe-area/keyboard scenarios. Native iOS status-bar colour, keyboard animation and installed-PWA compositor behaviour still need a physical iPhone check. No physical-device verification is claimed.
