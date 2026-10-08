import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const nodeMajor = /^([0-9]+)\.x$/.exec(manifest.engines?.node)?.[1];
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
if (!nodeMajor || !/^npm@[0-9]+\.[0-9]+\.[0-9]+$/.test(manifest.packageManager ?? "")) {
  fail("The project must declare engines.node as a major.x range and an exact npm packageManager version.");
}
if (process.versions.node.split(".")[0] !== nodeMajor) {
  fail(`Node ${nodeMajor} is required; found Node ${process.versions.node}. Set the Vercel project's Node.js version to ${nodeMajor}.x.`);
}
const args = process.argv.slice(2);
if (args.length === 0) fail("Usage: node scripts/vercel-npm.mjs <npm command> [arguments...]");

// Vercel controls its Node installation layout and permissions. Use npx's
// package cache rather than installing globally into that provider's prefix.
const result = spawnSync("npx", ["--yes", "--package", manifest.packageManager, "npm", ...args], {
  cwd: root,
  env: {
    ...process.env,
    PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`
  },
  stdio: "inherit"
});
if (result.error) console.error("Unable to run npx. The selected Node installation must include npm and npx.");
process.exit(result.status ?? 1);
