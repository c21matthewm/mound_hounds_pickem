# Home Screen app and offline policy

Mound Hounds supports iPhone/iPad and Android Home Screen installation. The manifest uses a
stable root ID, root launch URL, and `standalone` display. Opening the icon follows the existing
sign-in, season-registration, and dashboard flow. Installation does not create an account.

The public `/install` guide is linked from Sign in and the League Menu. Chrome can offer its native
install dialog there. Safari users use Share → Add to Home Screen, with Open as Web App enabled
when shown. Users may need to sign in again in the installed app.

## Offline contract

| Feature | Offline behavior |
| --- | --- |
| Opening the installed app after a successful online worker install | A branded recovery page explains the limits and offers manual retry. Browser storage must remain available. |
| An already-open pick form | Editing can continue. Existing participant/race-scoped local drafts remain where browser storage permits. These are unsent drafts, not accepted picks. |
| Reconnecting | No automatic page reload or pick submission. Users retry navigation or save explicitly; the existing server deadline and authorization checks still apply. Normal schedule refresh resumes while online. |
| Fresh/current dashboard, standings, race details, rules, and archives | Internet required. Already-visible content may remain on screen but cannot refresh offline. Race/year selectors pause offline to avoid mismatched labels and data. |
| Sign-in, pick submission, feedback, and Admin operations | Internet required. Form submissions and recovery API actions are guarded offline. |
| Queued writes, background submission, background sync, push notifications | Not implemented. |

A draft cannot be opened from a fresh offline launch: application pages and JavaScript are not
preloaded for offline league browsing. Reconnect, reopen the form, and use its existing draft
recovery. Private browsing, clearing site data, or device storage eviction can remove drafts.

## Data and update boundaries

`public/sw.js` precaches only `/offline.html` and `/icons/icon-192.png` (roughly 24 KB total).
No authenticated HTML, Next RSC responses, API/Supabase data, uploads, result tables, or request
bodies enter this cache. Non-GET traffic is never intercepted or replayed. Normal document
navigation uses the network with `no-store`; only a network rejection returns the generic offline
page with HTTP 503. Real HTTP errors remain visible. APIs never receive fallback HTML.

Each worker version has one fixed two-resource cache. Activation removes older caches only in
its own `mound-hounds-pwa-` namespace, preserving unrelated caches and the existing local draft
store. New workers wait for existing tabs/windows to close; no forced reload discards an edit.
When changing the offline page or cached icon, bump `CACHE_NAME` in `public/sw.js`. The worker
script is served with no-cache/no-store headers and registered with `updateViaCache: "none"`.

The exact public GET/HEAD routes `/install`, `/manifest.webmanifest`, `/sw.js`, and `/offline.html`
bypass session-refresh middleware. Other routes/methods retain their existing authentication
checks. Existing CSP already permits the same-origin manifest and worker; no policy was relaxed.
No database migration, subscription, notification permission, or new dependency is required.

## Development and verification

Registration runs only in a production build on a secure origin. HTTPS is required on a phone;
the desktop localhost exception is suitable for automated tests. Plain LAN HTTP on port 3007
can verify responsive layouts but does not provide normal phone service-worker installation.
Workers blocked by browser settings degrade to the normal online website without reporting an
application error or creating telemetry records.

```sh
./scripts/with-node.sh npm run lint
./scripts/with-node.sh npm run typecheck
./scripts/with-node.sh npm run test
./scripts/with-node.sh npm run test:picks:ui
./scripts/with-node.sh npm run test:admin:ui
./scripts/with-node.sh npm run test:pwa
```

The PWA runner builds a physical temporary copy without dotenv files. It uses fictional keys,
loopback-only services, network guards, and an in-memory API route created only in that copy.
It exercises real Chromium worker activation, cache bounds, fresh offline navigation, manual
reconnect/retry, and failed-write non-replay. Everything is removed afterward. Production smoke
checks continue to block service workers and remain anonymous; their network protections are not
weakened to test installation. Unit tests simulate the worker and verify public routes/icons.

Before launch, manually check the HTTPS deployment on an actual iPhone and Android device: install
from `/install`, open the icon, confirm standalone navigation/icon/notch clearance, then open once
online before testing airplane-mode launch and manual retry. Automated mobile emulation is not
an actual installed iPhone test.

## Icon maintenance

`npm run icons:generate` derives PNGs from the existing official
`public/images/branding/mound-hound.webp`: 32px favicon, 180px Apple touch icon, 192/512px normal
icons, and a 512px maskable icon with safe padding. Rebuild and bump the worker cache version when
changing its cached 192px icon. Retain opaque backgrounds; device platforms apply their own masks.

References: [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps),
[MDN service workers and secure origins](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers),
[WebKit Home Screen web apps](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/).

## Verified on 2026-11-04

Release checks also updated Next.js and its matching ESLint configuration to 16.4.5 after
the production dependency audit identified the older version as vulnerable. The updated
production audit reports zero vulnerabilities. Development-only lint/test dependencies still
have moderate advisories; the full development audit is not reported as clean.

- Full lint/typecheck/production-build gate and 723 unit tests across 69 files passed in a
  physical temporary copy with fictional loopback services and all real dotenv files excluded.
- 99 isolated Admin and 35 mobile/pick-form checks passed, including local draft retention,
  offline submission blocking, install prompt states, iOS/standalone detection, safe-area
  clearance, paused offline refresh, and disabled offline selectors.
- 15 real production-build PWA checks passed, including worker activation, exact cache bounds,
  offline API failure, generic 503 recovery, and no replay on reconnect.
- Six existing browser regressions passed across desktop/mobile Chromium and desktop Firefox
  with service workers blocked, preserving the production-smoke network boundary.

No live accounts, league database writes, deployment changes, or remote application requests were
used. Actual iPhone/Android Home Screen installation remains a manual HTTPS deployment check.
