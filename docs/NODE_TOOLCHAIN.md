# Node and npm maintenance

The app uses Node 24 LTS. `.nvmrc` pins a tested patch for local development and GitHub Actions;
`engines.node` selects the same major on Vercel, which maintains its own Node patch updates.
`packageManager` pins npm 11.20.0. Keep these files and the lockfile reviewed together.

Node runs the app; npm installs its packages. Their version numbers are independent. An older
npm resolver caused the earlier dependency-update failure. Vercel Preview Authentication caused
the separate browser smoke failure; changing Node cannot grant access to that preview.

## Initial setup or intentional update

From the repository:

```bash
nvm install
nvm use
node scripts/install-toolchain.mjs
npm ci
npm run verify
npm run audit:prod
```

The bootstrap installs only the pinned npm into the selected Node prefix, and first checks that
Node is 24. It leaves other Node installations alone. npm's `devEngines` check rejects incorrect
versions before `install`, `ci`, or `run`. The project also enables `engine-strict` and checks
app startup/build explicitly because older npm versions do not support `devEngines`. It is deliberate that an outdated `npm run dev` fails;
use the launcher if a GUI or old terminal inherited a stale PATH:

```bash
./scripts/with-node.sh npm run dev -- --hostname 0.0.0.0 --port 3007
./scripts/with-node.sh npm run verify
```

The launcher uses NVM to select the exact installed `.nvmrc` version. Without NVM, it accepts a
compatible Node 24 installation. It never downloads a runtime or installs packages automatically.
If npm needs repair, run `nvm use` and `node scripts/install-toolchain.mjs` first.

## Local shell

This computer's zsh configuration initializes NVM once and selects the closest `.nvmrc` on startup
and when changing directories. Outside a pinned project it selects the NVM default. Existing GUI
processes keep their original environment; open a new terminal or use the repository launcher.
An unavailable version produces setup instructions rather than a background download.

## CI and Vercel

Each GitHub workflow uses `.nvmrc` with automatic npm caching disabled, bootstraps the pinned npm,
then restores its npm download cache before `npm ci`. The cache-only setup step keeps the selected
runtime. This ordering matters: the npm bundled with Node can be older than the project pin, and
cache lookup invokes npm inside the repository where `devEngines` is enforced. Maintained
GitHub actions run on their own Node runtime; this is separate from the app runtime selected by
`setup-node`. The actions have been updated from their Node 20 versions.

`vercel.json` runs `scripts/vercel-npm.mjs` for install and build. That launcher uses `npx`
to run the exact npm declared in `packageManager` from its cache, without changing Vercel’s global
installation or assuming its Node prefix is writable. Vercel does not rely on npm detection
from the lockfile format. `packageManager` alone does not install the requested npm. Check the
printed Node/npm versions and successful build on the next Preview deployment. Keep the Vercel
project's Node setting at 24.x, and do not add a conflicting install-command override.

## Future updates

1. Stay on Node 24 LTS and review its security patches periodically. Update `.nvmrc` to a tested
   patch and install it with `nvm install`; each NVM version has its own global npm.
2. When updating npm, change `engines.npm`, `packageManager`, and the matching `devEngines.packageManager.version` together.
   Rerun the bootstrap before any npm command. Update a deliberately exact `@types/node` within
   the Node 24 family when needed.
3. Review lockfile changes, verify a clean `npm ci`, then run the quality gate, offline Admin/picks
   browser checks and production smoke checks. Do not force dependency downgrades to suppress
   unrelated development-tool advisories.
4. Validate the production build with isolated local browser fixtures before merging to main.
   Public production smoke runs after deployment; protected previews are skipped and need no bypass
   secret. See [Production smoke checks](PRODUCTION_SMOKE.md).
5. Before deleting a Node installation, inspect its global packages and other projects' pins.
   Package versions such as Nodemon 3 or `n` 9 are not npm versions. This machine's inventory
   found no npm below 10, so none met the requested removal condition.

Use LTS releases for this application. Node 24 is supported through April 2028, covering the
2027 season. Reassess the next supported LTS before then rather than following the Current line.

References: [Node release schedule](https://github.com/nodejs/Release#release-schedule),
[npm devEngines](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#devengines),
[Vercel Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions),
[Vercel package managers](https://vercel.com/docs/package-managers).
