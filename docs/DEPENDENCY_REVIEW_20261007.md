# Dependency and smoke verification — 2026-10-07

This follow-up addresses the failed production dependency audit after the previous dev/main
push. The earlier release review covered application behavior and builds but omitted the
production audit. The changes below are local on `dev`; no commit, push, deployment, workflow
rerun, live database mutation or production smoke request occurred during this work.

## Changes

- Next.js and its lint configuration advance together from 16.2.11 to 16.3.6; Sharp advances
  from 0.35.3 to 0.35.5. The existing Sharp override still makes Next use the patched version.
- The lockfile resolves source-map-js 1.2.2 and baseline-browser-mapping 2.11.27, removing the
  other two production advisory findings within the existing dependency ranges.
- Compatible development patches cover Vitest 4.1.11, brace-expansion 1.1.21 / 2.1.7,
  js-yaml 4.3.2, Browserslist 4.29.3 and humanfs/node 0.16.8. No new direct dependencies were
  added. Related platform packages and test-tool peers were resolved normally in the lockfile.
- The new Next.js development default generated instruction files at startup. `agentRules: false`
  preserves the existing repository behavior; only the untouched generated files were removed.
- The production smoke command now uses `--reporter=line,github`, so failing assertions appear
  in GitHub annotations. Existing browser assertions, readiness checks and audit thresholds
  remain intact. The workflow's Node.js action warning was not the failed step.

npm 10.9.8 encountered its Arborist null-parent resolver bug while resolving updated test
peers. A temporary, pinned npm 11.20.0 generated the lockfile through normal peer checks;
there was no global npm upgrade, manual lock editing, force fix or legacy peer resolution.
A subsequent clean `npm ci --ignore-scripts` with the original npm 10.9.8 passed.

## Final verification

| Check | Result |
| --- | --- |
| Production dependency audit | Passed; zero vulnerabilities |
| Full ESLint | Passed |
| TypeScript without incremental cache | Passed |
| Vitest, with dotenv loading disabled | 622 tests across 64 files passed |
| Offline Admin component browser suite | 98 checks passed |
| Offline Pick Save component browser suite | 21 checks passed |
| Native Sharp PNG → resized WebP conversion | Passed; 24 × 16 output |
| Default `npm run build` with Turbopack | Passed; all 23 pages generated |
| Production browser smoke | Three passed: desktop Chromium, mobile Chromium, desktop Firefox |
| Restarted localhost and LAN `/login` | Both HTTP 200 on port 3007 |

The production build and smoke ran in a disposable physical source/dependency copy, excluding
all dotenv files. A local HTTP fixture supplied an empty active-season result, using fictional
keys. Node fetch/HTTP/socket/TLS guards and browser HTTP/WebSocket/service-worker boundaries
blocked external application requests. The existing smoke assertions were retained; only the
staged copy gained the network-boundary fixture. There were zero unexpected fixture requests
and zero blocked external requests. The production server, copied build and temporary UI
artifacts were removed afterward. The real development server was restarted with a fresh
Next cache at localhost:3007 and 192.168.1.76:3007.

## Remaining limits

The full development audit still reports five high package entries caused by one unresolved
`braces` advisory through micromatch, fast-glob and Next's lint tooling. These are excluded
from the production dependency tree. The [upstream advisory lists no patched version](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
Keep Next's lint configuration aligned; npm's suggested older framework lint configuration
is not a suitable remediation. Recheck this development advisory when an upstream patch exists.

The deployed smoke job's exact assertion remains unavailable. The supplied annotations show
only exit code 1 and a Node.js deprecation warning; they do not establish its root cause.
Local production tests validate the application with an empty active-season fixture, not
provider deployment protection, deployed environment variables or live database availability.
Read the expanded failed step or retained Playwright trace before claiming that deployed smoke
failure is resolved. After publication, the actual Verify and Production Smoke E2E jobs must
be checked independently; successful local verification does not turn an existing red run green.
