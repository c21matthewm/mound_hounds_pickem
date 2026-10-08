import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Run directly with Node so an older npm cannot reject the devEngines contract
// before it has had a chance to install the project's package manager.
const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const nodeMajor = /^([0-9]+)\.x$/.exec(manifest.engines?.node)?.[1];
const npmVersion = /^npm@([0-9]+\.[0-9]+\.[0-9]+)$/.exec(manifest.packageManager ?? "")?.[1];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!nodeMajor || !npmVersion) {
  fail("The project must declare engines.node as a major.x range and an exact npm packageManager version.");
}
if (process.versions.node.split(".")[0] !== nodeMajor) {
  fail(`Node ${nodeMajor} is required; this command is using Node ${process.versions.node}. Run nvm install && nvm use first.`);
}

const executableDirectory = path.dirname(process.execPath);
const runtimePrefix = process.platform === "win32"
  ? executableDirectory
  : path.dirname(executableDirectory);
const npmCli = path.join(runtimePrefix, process.platform === "win32" ? "node_modules" : "lib/node_modules", "npm/bin/npm-cli.js");
if (!existsSync(npmCli)) {
  fail("The selected Node installation does not include npm. Install Node with npm included, then run this command again.");
}
const environment = {
  ...process.env,
  // npm's subprocesses must use this same Node installation even when an app
  // inherited a PATH pointing to a different version.
  PATH: `${executableDirectory}${path.delimiter}${process.env.PATH ?? ""}`
};
const npm = (args, capture = false) => spawnSync(process.execPath, [npmCli, ...args], {
  cwd: tmpdir(),
  env: environment,
  encoding: "utf8",
  stdio: capture ? "pipe" : "inherit"
});
const readNpmVersion = () => {
  const result = npm(["--version"], true);
  if (result.error || result.status !== 0) {
    fail("Unable to run npm from the selected Node installation. Reinstall that Node version and retry.");
  }
  return result.stdout.trim();
};

if (readNpmVersion() === npmVersion) {
  console.log(`Toolchain ready: Node ${process.versions.node}, npm ${npmVersion}.`);
  process.exit(0);
}

console.log(`Installing npm ${npmVersion} for the selected Node ${process.versions.node} installation.`);
const installation = npm([
  "install", "--global", "--prefix", runtimePrefix,
  "--ignore-scripts", "--no-audit", "--no-fund", `npm@${npmVersion}`
]);
if (installation.error || installation.status !== 0) {
  fail("npm installation failed. Check that this Node installation is writable and that the npm registry is reachable, then retry.");
}
if (readNpmVersion() !== npmVersion) {
  fail("npm installation completed but the selected Node installation still has the wrong npm version.");
}
console.log(`Toolchain ready: Node ${process.versions.node}, npm ${npmVersion}.`);
