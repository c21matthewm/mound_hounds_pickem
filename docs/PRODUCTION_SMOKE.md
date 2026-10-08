# Anonymous production smoke checks

No Vercel bypass secret, GitHub app credentials, participant login, or database credentials are
required. Preview deployments keep their existing Vercel Authentication protection and are
explicitly skipped. Skipping a preview does not claim that its pages have been tested.

The workflow checks the public production origin after a successful Production deployment.
It handles Vercel’s observed `environment: Production` even when GitHub’s production boolean is
false, while excluding Preview deployments. It defaults to `https://moundhoundspickem.app`; optionally set
repository variable `PRODUCTION_BASE_URL` for a different public production origin.
A manual **Actions → Production Smoke E2E → Run workflow** can use that default or another public
origin. Protected project preview URLs are rejected; other protected targets fail clearly if
access is denied or redirects outside the app. No protection settings need to change.

The browser suite opens login, signup and password-reset pages, then checks that anonymous visits
to Dashboard, Profile and Admin redirect to login. It never submits a form or signs in. Read-only
setup/teardown return before importing database mutation helpers. Browser requests that can write
data are blocked, including automatic error-report beacons. WebSockets are blocked except for the
same-host loopback Next development reload connection. Traces, videos and artifact uploads are
disabled for this smoke suite. Diagnostic output is normal text in the job log.

Login readiness requires the application's rendered login form, bounded response size/time, and
same-origin GET redirects; a generic 200 or provider login page cannot pass.

Local command:

```bash
./scripts/with-node.sh npm run e2e:smoke
```

Before releasing, run the quality gate plus offline Admin/pick-form and isolated production-browser
checks. These use fictional data and disposable local files/fixtures. They do not touch the real
league database. The dedicated mutating Supabase E2E workflow remains opt-in and separate; it must
never be pointed at the league's Supabase project.
