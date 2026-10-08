import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const nodeMajor = /^([0-9]+)\.x$/.exec(manifest.engines?.node)?.[1];
const npmVersion = /^npm@([0-9]+\.[0-9]+\.[0-9]+)$/.exec(manifest.packageManager ?? "")?.[1];
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
if (!nodeMajor || !npmVersion) {
  fail("The project must declare engines.node as a major.x range and an exact npm packageManager version.");
}
if (process.versions.node.split(".")[0] !== nodeMajor) {
  fail(`Node ${nodeMajor} is required; found Node ${process.versions.node}. Run nvm install && nvm use, or use ./scripts/with-node.sh to run the command.`);
}

// npm 10 does not enforce devEngines. Lifecycle checks must validate the npm
// actually running the command, rather than another npm found on PATH.
let activeNpm = /^npm\/([0-9]+\.[0-9]+\.[0-9]+)(?: |$)/.exec(process.env.npm_config_user_agent ?? "")?.[1];
if (!activeNpm && !process.env.npm_config_user_agent) {
  // Also support a direct `node scripts/check-toolchain.mjs` invocation.
  const executableDirectory = path.dirname(process.execPath);
  const runtimePrefix = process.platform === "win32" ? executableDirectory : path.dirname(executableDirectory);
  const npmCli = path.join(runtimePrefix, process.platform === "win32" ? "node_modules" : "lib/node_modules", "npm/bin/npm-cli.js");
  if (existsSync(npmCli)) {
    const result = spawnSync(process.execPath, [npmCli, "--version"], {
      cwd: tmpdir(),
      env: { ...process.env, PATH: `${executableDirectory}${path.delimiter}${process.env.PATH ?? ""}` },
      encoding: "utf8"
    });
    if (!result.error && result.status === 0) activeNpm = result.stdout.trim();
  }
}
if (activeNpm !== npmVersion) {
  fail(`npm ${npmVersion} is required; found ${activeNpm ?? "an unsupported package manager"}. Run node scripts/install-toolchain.mjs, then retry.`);
}
