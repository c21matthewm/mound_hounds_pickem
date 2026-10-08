# Toolchain and protected-preview verification — 2026-10-07

Changes prepared on `dev`; this task did not commit, push, merge, or change remote settings.

## Result

- Installed and tested Node 24.21.0 with npm 11.20.0 through the existing NVM installation.
- Updated `.nvmrc`, npm/Node contracts, Node TypeScript definitions, lockfile, all three CI
  workflows and Vercel install/build commands. App dependencies remain on their previously
  tested versions; the dependency diff is limited to Node definitions and their Undici types.
- GitHub actions use maintained v7 releases with their own modern Node runtime.
- Older npm cannot silently start/build this app using the wrong Node: explicit lifecycle checks
  complement `devEngines` and `engine-strict`. A stale Node 20 PATH was tested and rejected.
  The repository launcher correctly selected installed Node 24 from that same stale environment.
- Backed up this computer's zsh profile to `.zshrc.codex-node-20261007.bak`, consolidated duplicate
  NVM initialization, and set NVM default to 24.21.0. New interactive shells selected the tested
  pair both inside the project and outside it. Existing app processes may retain their old PATH.
- Inventory found no npm installation below 10. No older installation or global package was
  uninstalled; Node 22 and unrelated legacy globals remain available.

## Verification

All completed with Node 24.21.0:

- Clean `npm ci`, full lint, nonincremental TypeScript check and 658 unit tests passed.
- The new suite adds 22 runtime/launcher regression tests and 14 protection/readiness tests.
  The latter test actual loopback cookie bootstrap and confirm foreign redirects receive no secret.
- Offline Admin browser checks: 98 passed. Offline pick-form checks: 21 passed.
- Native Sharp PNG resize and WebP conversion passed.
- Production dependency audit: zero vulnerabilities. The full audit still reports five development
  tool entries from the known unpatched braces advisory; no downgrade or forced audit fix was applied.
- In a temporary physical copy with fictional credentials, external connections blocked, and
  no real database access, Vercel's actual pinned-npm launcher completed a clean offline install
  and default Turbopack production build (23 generated pages).
- The new app-specific HTTP readiness check passed against that production build. The existing
  read-only browser assertions passed in desktop Chromium, mobile Chromium and desktop Firefox.
  No external or unexpected fixture requests occurred. Temporary build and fixture were removed.
- Actual older npm 10's npx running under Node 24 successfully selected cached npm 11.20.0;
  Vercel does not require writing to its global Node prefix.
- Local development restarted through the launcher on port 3007, bound to `0.0.0.0`.
  Static asset requests returned HTTP 200 through both localhost and the current LAN address.

## October 8 release adjustment

The owner declined deployment bypass automation. That draft integration was removed before release.
Production smoke now skips previews, uses the public production alias, and remains anonymous.
Browser writes and non-development WebSockets are blocked; traces and artifact uploads are disabled.
No Vercel/GitHub secret setup is required. Follow [Production smoke checks](PRODUCTION_SMOKE.md).
The October 7 counts above describe the initial draft; final October 8 evidence is recorded separately.

See [toolchain maintenance](NODE_TOOLCHAIN.md) for version updates and rollback precautions.
