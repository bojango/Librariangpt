# Currently Reading — Widget Web 26

This is an isolated **medium** iPhone Home Screen JS-Widget. It renders its own HTML and CSS, not the Reading Room PWA. It uses the existing pinned Supabase SDK, public project configuration, `v_library`, canonical `progress_percent`, and the homepage's shared current-book selector. No backend deployment, migration, new endpoint or dependency is required.

## URLs after deployment

Widget:
<https://bojango.github.io/Librariangpt/widgets/currently-reading/index.html>

Connection/settings page:
<https://bojango.github.io/Librariangpt/widgets/currently-reading/setup.html>

These are expected GitHub Pages URLs. A feature-branch push or pull request does **not** publish them. The existing Pages workflow runs on pushes to `main` or manual dispatch; neither is part of this change. If Pages is later configured with a custom domain, use that domain for **both** pages.

## Add it on your iPhone

1. After this change has been reviewed, merged and deployed separately, install or open [Widget Web 26](https://apps.apple.com/gb/app/widget-web-26/id1522169352).
2. In Widget Web, create a custom **JS-Widget** using the widget URL above. Select the **medium** layout. Use the entire page at normal zoom, with its light colours; disable forced dark mode or extra cropping if enabled.
3. Open the connection page above **inside Widget Web's main-app browser**, not Safari or the Reading Room PWA. You can also reach it by opening the disconnected widget page there and tapping “Connect your library”. Enter your existing Reading Room email and password and select **Connect widget**. Wait for “Connected”. Allow cookies if the app asks.
4. Select **View widget**. Confirm your current book appears, then return to the widget configuration and keep its URL set to `index.html`, not `setup.html` or the main PWA.
5. On the iPhone Home Screen, touch and hold an empty area, choose **Edit → Add Widget**, find **Widget Web**, select its **medium** widget, and add it. Edit the placed widget to select the Reading Room JS-Widget you created.
6. Enable Widget Web's automatic refresh at your preferred interval. Use its **↻ Reload** action after setup and when checking an update. Actual refresh timing is controlled by Widget Web and iOS.
7. Tap the book card to follow its Reading Room `#/book/<id>` link. Widget Web's documented anchor navigation opens the destination in its own web view; it does not promise to launch Safari or the installed PWA. A separate Reading Room login may be needed in that destination browser. Verify this behaviour on the device.

Widget Web's exact menu labels and preview controls may vary by version. The setup and native interaction flow above still needs a physical iPhone check. The source requirements come from the [official JS-Widget documentation](https://github.com/Villy21/JsWidget); the app's [release notes](https://apps.apple.com/gb/app/widget-web-26/id1522169352) also describe page navigation and refresh settings.

## Authentication and privacy

- Safari, the standalone PWA, Widget Web's main app and its widget extension are not assumed to share sessions. The JS-Widget documentation explicitly supports cookies shared between Widget Web's main app and widgets. We use that documented bridge.
- `setup.html` uses existing Supabase email/password authentication. Passwords go directly to Supabase in a POST body, are cleared from the form, and are never persisted or included in URLs. No magic-link redirect, pairing secret or service-role key is used.
- The widget has a separate SDK storage key. A compact normal Supabase access/refresh session is stored in a host-only cookie scoped to `/Librariangpt/widgets/currently-reading/`, with `Secure` on HTTPS and `SameSite=Strict`. It excludes email, user metadata and provider tokens. Its maximum lifetime in the browser is 30 days, renewed when the session refreshes. Supabase remains responsible for token expiry and revocation; [Supabase sessions](https://supabase.com/docs/guides/auth/sessions) use short-lived access tokens and rotating refresh tokens.
- As with Reading Room's browser authentication, JavaScript must be able to read the session. GitHub Pages cannot issue `HttpOnly` cookies. Cookie path scoping reduces incidental exposure; it is not an isolation boundary from other JavaScript on the same origin. This widget loads only its own bundled code and applies a content security policy and `no-referrer` policy. Do not host untrusted scripts on the same Pages origin.
- Each load obtains/refreshes the session and verifies the user with `auth.getUser()` before requesting private data or displaying a saved book. Supabase responses use `cache: 'no-store'`; there is no anonymous book request.
- The deployed `v_library` has `security_invoker=true`. Its underlying books, library entries and reading sessions enforce the existing owner policies. The widget changes no RLS policies. Read-only checks confirmed owner access, zero rows for a non-owner context and no anonymous SELECT grant on the view.
- A single user-bound, bounded book snapshot can live in a separate cookie for up to 24 hours. It is used only after successful online user verification if the book request fails, and is labelled “Saved” with a time. If authentication itself is offline, expired or denied, no cached private book is shown. A successful empty result replaces an old book snapshot. Auth failures clear the saved session and snapshot.
- Use **Disconnect widget** on `setup.html` inside Widget Web to revoke that session locally and remove its cookies. PWA sessions on other browsers/devices are unaffected. iOS may retain an already captured screenshot until refresh or widget removal. Signing out in another browser is not assumed to disconnect this widget.
- Widget URLs and outgoing cover requests contain no session credentials. Widget cookies belong only to the Pages host, and cover requests omit referrers. Native widget screenshots themselves contain reading information: remove the widget if that should no longer be visible.

## Selection, rendering and resources

- One narrow `v_library` request: `overall_status=Currently Reading`, `started_at DESC NULLS LAST`, then `title`, `LIMIT 1`. This matches the first homepage card. A carousel selection is session-specific and is not transferred from the PWA.
- Pages and percentage come from Supabase, with the homepage's percentage clamping and rounding. Missing totals display `—`, not invented progress. Text is escaped, long titles use two lines, and author text truncates to fit.
- The medium layout was browser-tested at 329×155, 338×158, 360×170, 364×170 and 402×186 CSS pixels. `data-size="medium"` provides a place for future size-specific layouts; small and large are not implemented.
- One cover maximum. Open Library URLs are reduced to `-M.jpg`, Google Books URLs to `zoom=1` thumbnails. Unknown providers, original uploads and unsafe URLs use a typographic fallback rather than downloading an unbounded image. The current live Open Library thumbnail was measured at approximately 10 KB. No custom fonts, logo bitmaps, framework, realtime connection, PWA bundle or service worker registration is loaded by the widget.
- The widget bundle is approximately 127 KiB uncompressed and the setup bundle approximately 123 KiB, including the existing SDK. They load on different pages. Browser asset caching is permitted; API response caching is disabled. The PWA service worker excludes widget-directory requests so it cannot substitute the app shell for widget pages.
- The title uses `meta[name="js-widget-title"]`. `__wweb2WaitMillisecondsToWidgetIsReady` is installed synchronously in the head and returns 250 ms until the final render and cover decode/fallback finish, then 0. A cover has a 2.5-second budget, the runtime has a 16-second deadline, and a 20-second HTML watchdog handles missing JavaScript. These remain below Widget Web's documented 30-second readiness maximum.
- The full card is one real `<a href>` with Widget Web's documented overlay CSS. It has no progress buttons or unnecessary controls. Opening Reading Room is explicit navigation after a tap, outside the widget's lightweight rendering path.
- Widget Web caches the main HTML until its Reload action. Assets use `?v=1`; increment their versions when changing widget assets and use Reload after updates. Private snapshots are deliberately outside HTTP/Service Worker caches.

## Validation and remaining device checks

Automated coverage is in `tests/unit/widget.test.js` and `tests/e2e/widget.spec.js`. E2E uses independent browser contexts, mocked Auth/Data API responses and both Chromium and WebKit. It exercises connection/disconnection, revoked and refreshed sessions, denied access, data outages, auth outages, empty data, long/escaped text, missing/failed covers, unknown totals, progress extremes, current data replacing a snapshot, delayed data/images, stalled requests and missing JavaScript.

The live database was inspected read-only for canonical values and RLS behaviour; no real user password or browser access token was obtained for browser testing. A local WebKit screenshot with the actual public thumbnail was visually reviewed. This does not establish native widget success.

Validation on 15 October 2026: build and runtime architecture check passed; 26 focused unit checks passed; the final 20 focused browser checks passed (16 widget cases plus four PWA service-worker checks). The full unit suite returned 362 passed and one existing failure. The full browser suite returned 211 passed, one skipped and four existing failures; the final focused run additionally covers two watchdog cases added after that full run.

Physical iPhone testing is still required for cookie transfer across Widget Web processes and app termination, refresh scheduling, native anchor overlays and destination navigation, Home Screen crop/tint settings, expired-session reconnect, and memory use. Widget Web's approximately **30 MB shared widget memory limit** has not been measured here. Browser correctness and a small resource budget do not prove that memory limit is met on the device.

Run the normal checks:

```sh
npm run build
npm test
npm run check
npm run test:e2e
```

For focused widget/browser-worker checks:

```sh
node --test tests/unit/widget.test.js tests/unit/home.test.js tests/unit/award-logo-cache.test.js tests/unit/pwa-generation.test.js
npm run test:e2e -- widget.spec.js app.spec.js --grep "widget|service-worker-controlled"
```

The starting commit `c163b80` already has outdated Profile hashtag test selectors: one unit test expects `data-feed-filter="quotes"` and two E2E cases expect plain `wishlist`/`sessions` hashtag filters, while the merged source emits `hashtag:<name>`. The starting commit's checked-in bundle predates that source change; rebuilding it exposes four E2E failures (two cases in each browser). Both the unit failure and all four rebuilt E2E failures were reproduced from an untouched archive of `c163b80`. This widget change leaves those unrelated tests and Profile code untouched. See the PR validation results for final counts.
