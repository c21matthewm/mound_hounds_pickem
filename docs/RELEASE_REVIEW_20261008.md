# Release review — 2026-10-08

## Final change

Local/CI use Node 24.21.0 and npm 11.20.0 with explicit startup/install checks, automatic local
version selection, and a portable launcher for GUI environments with a stale PATH. Vercel uses
Node 24 and the same pinned npm through its cache, without assuming its global prefix is writable.
GitHub action runtimes have moved from the old v4 actions to maintained v7 actions. A first dev
CI run caught setup-node invoking bundled npm 11.19.0 for caching before the 11.20.0 bootstrap. All
workflows now disable early caching and restore downloads only after selecting the pinned npm.

The owner declined deployment bypass automation. Its draft header/cookie integration was removed.
Preview deployment events explicitly skip smoke checks, preserving Vercel Authentication. Production
checks use the public alias and remain anonymous. The selector accounts for this project's observed
Vercel events: `environment: Production` can accompany `production_environment: false`.
No application/database credentials, login state or bypass secrets are passed to production smoke.
Browser writing requests and non-development WebSockets are blocked, traces/artifact uploads are
removed, and setup/teardown return before importing database mutation helpers.

A fresh dependency audit found security advisories affecting Next 16.3.6. Next and its matching lint
configuration were patched to 16.3.8, the fixed release within the existing minor version.
See [the official release](https://github.com/vercel/next.js/releases/tag/v16.3.8) and
[the reviewed advisory](https://github.com/advisories/GHSA-cjq9-62q9-8jv4).

## Verification

- A physical temporary repository copy excluded all real environment files. It used fictional
  credentials, an empty local season fixture, and guards rejecting external connections.
- A clean offline install using Vercel's pinned-npm launcher passed.
- The exact `npm run verify` gate passed: full lint, TypeScript, 657 tests across 67 files, and
  default Turbopack production build with 23 generated pages.
- The app-specific readiness probe passed against that production build.
- Six browser checks passed across desktop Chromium, mobile Chromium and desktop Firefox:
  existing anonymous page/redirect assertions plus a local fictional POST deliberately blocked
  before reaching the application. No external or unexpected fixture requests occurred.
- Workflow YAML parsed successfully. Behavioral regression coverage verifies production/preview
  selection, denied/foreign redirects, bounded responses, runtime mismatch handling and writing
  request blocking. Local Next dev reload sockets remain permitted only on the same loopback host.
- Production dependency audit reported zero vulnerabilities after the security patch. The full
  audit still reports five development-tool entries from one unpatched braces advisory. Its
  suggested forced downgrade to Next 14's lint configuration was not applied.
- Local development restarted with Next 16.3.8 on `0.0.0.0:3007` after clearing only generated
  dev cache. Static asset requests returned 200 through localhost and the current LAN address.

Offline Admin/pick-form evidence is included in the release completion message. No live league
mutations, SQL scripts, signed-in app tests, or database type-generation reads were run. No schema
or scoring/business-logic source changed in this release. Temporary production copies/fixtures
were removed automatically. Remote deployment/CI results are reported after publishing the branches.

## Operating instructions

Use [Node/toolchain maintenance](NODE_TOOLCHAIN.md) and
[anonymous production smoke checks](PRODUCTION_SMOKE.md). No Vercel/GitHub bypass setup is needed.
Protected previews are not validated by the public smoke workflow; the local isolated checks are
separate evidence. Read-only smoke checks confirm public auth screens and redirects, not every
signed-in production workflow. Dedicated mutating E2E remains opt-in for an isolated test project.
