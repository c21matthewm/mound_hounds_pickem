# Home Screen app and offline policy

For everyday instructions, use [Start here](START_HERE.md).

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
| Queued writes, background submission, background sync | Not implemented. |
| Opted-in device notifications | Network delivery is required; notifications do not submit picks or cache league data. |

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
Home Screen installation itself needs no account permission. Optional notifications require the device subscription migration and an explicit Profile opt-in; permission is never requested on page load.

## Development and verification

Automatic registration runs in a production build on a secure origin. Opening notification settings prepares the worker on supported standalone installations, including secure localhost during development. HTTPS is required on a phone;
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


## Opt-in Web Push

Worker v2 adds visible push and same-origin notification clicks while retaining
exactly the same two public cached recovery assets. It never requests permission
on page load and never caches authenticated data, APIs or notification payloads.
Device controls are in Profile and require an installed standalone app, secure
context and Web Push support (iOS 16.4+ Home Screen or supported Android browser).
The page checks worker readiness before offering Enable notifications, and permission
is requested directly from that tap. An old installed worker with a waiting update
shows close/reopen guidance before permission. Slow or temporarily unavailable
workers have a retry path; no page reload or worker takeover is forced.
Email and scheduled push are independently controlled; no subscription means off.
Sign-out keeps an explicitly enabled subscription, so a reminder can open the
sign-in flow and return to Picks. Explicit device opt-out stops future delivery.
See the [complete VAPID/operator and device-test runbook](RESULTS_AUTOMATION.md).


## iOS and Android notification compatibility checks

Run `./scripts/with-node.sh npm run test:push:mobile` for focused iPhone WebKit and
Android Chromium emulation. Install the pinned test engines first, if needed, with
`./scripts/with-node.sh npx playwright install chromium webkit`.

The suite mounts the real PwaProvider and notification card. iPhone cases exercise
`navigator.standalone`; Android cases exercise `(display-mode: standalone)`. It
checks touch-triggered permission requests, 65-byte P256 subscription keys, enable,
test and disable controls, slow startup, denied/dismissed permission, old-worker
updates and narrow layouts. It also verifies that unrelated page state survives.
It reads no dotenv files, creates no league data and blocks all external requests.
Permission responses, push registration and server replies are explicit fixtures.

Both engine runs passed all 36 checks. This is browser emulation, not physical
Home Screen installation or APNs/FCM delivery certification. Supported phone paths
are iOS/iPadOS 16.4+ Home Screen apps and current Android Chrome installed apps over
HTTPS. The commissioner confirmed an earlier real iPhone test arrived; the revised
flow still needs its post-deployment phone check, and actual Android delivery needs
one explicit test on an Android phone. No additional compatibility blocker was
found in the shared VAPID transport or worker notification/click handling.

Platform references: [Apple/WebKit Home Screen Web Push](https://webkit.org/blog/13878/),
[Google's Push API subscription guidance](https://web.dev/articles/push-notifications-subscribing-a-user),
and [Playwright emulation limits](https://playwright.dev/docs/emulation).
