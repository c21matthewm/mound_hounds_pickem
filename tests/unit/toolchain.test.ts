import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const scriptRoot = path.resolve("scripts");
const fixture = () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "toolchain tests ")));
  temporaryDirectories.push(root);
  mkdirSync(path.join(root, "scripts"));
  mkdirSync(path.join(root, "node runtime/bin"), { recursive: true });
  mkdirSync(path.join(root, "node runtime/lib/node_modules/npm/bin"), { recursive: true });
  writeFileSync(path.join(root, "node runtime/lib/node_modules/npm/bin/npm-cli.js"), "// Offline npm fixture\n");
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ engines: { node: "24.x" }, packageManager: "npm@11.20.0" }));
  writeFileSync(path.join(root, ".nvmrc"), "24.21.0\n");
  for (const script of ["install-toolchain.mjs", "check-toolchain.mjs", "vercel-npm.mjs", "with-node.sh"]) {
    copyFileSync(path.join(scriptRoot, script), path.join(root, "scripts", script));
  }
  return root;
};
const writeExecutable = (file: string, content: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, { mode: 0o755 });
};
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

type NpmCall = { command: string; args: string[]; cwd: string; path: string };
function runNodeScript(root: string, script: string, options: { node?: string; npm?: string; userAgent?: string; installStatus?: number; installedNpm?: string; args?: string[]; npxStatus?: number; enforceNpxDevEngines?: boolean; lifecycleNpm?: string } = {}) {
  const npmCli = path.join(root, "node runtime/lib/node_modules/npm/bin/npm-cli.js");
  if (options.lifecycleNpm) writeFileSync(path.join(path.dirname(npmCli), "../package.json"), JSON.stringify({ name: "npm", version: options.lifecycleNpm }));
  const guard = path.join(root, "offline-process.cjs");
  const callLog = path.join(root, "npm-calls.json");
  // Every child-process call is replaced. Tests never contact a registry or
  // change a real npm installation, even if the bootstrap implementation errs.
  writeFileSync(guard, `
    const fs = require("node:fs");
    const child = require("node:child_process");
    const calls = [];
    let installed = false;
    Object.defineProperty(process.versions, "node", { value: process.env.FAKE_NODE_VERSION });
    Object.defineProperty(process, "execPath", { value: process.env.FAKE_NODE_PATH });
    child.spawnSync = (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd, path: options.env.PATH });
      fs.writeFileSync(process.env.FAKE_CALL_LOG, JSON.stringify(calls));
      if (command === "npx") {
        // Model the observed bundled npm preflight: it rejects a project before
        // --package can select the required npm. No real registry is contacted.
        if (process.env.FAKE_NPX_DEV_ENGINES === "true" && fs.existsSync(require("node:path").join(options.cwd, "package.json"))) {
          return { status: 1, stdout: "", stderr: "EBADDEVENGINES: bundled npm cannot bootstrap inside the project" };
        }
        return { status: Number(process.env.FAKE_NPX_STATUS), stdout: "", stderr: "" };
      }
      if (args.includes("install")) {
        installed = true;
        return { status: Number(process.env.FAKE_INSTALL_STATUS), stdout: "", stderr: "" };
      }
      return { status: 0, stdout: (installed ? process.env.FAKE_INSTALLED_NPM : process.env.FAKE_NPM_VERSION) + "\\n", stderr: "" };
    };
    require("node:module").syncBuiltinESMExports();
  `);
  const result = spawnSync(process.execPath, ["--require", guard, path.join(root, "scripts", script), ...(options.args ?? [])], {
    encoding: "utf8",
    cwd: root,
    env: {
      NODE_ENV: "test",
      PATH: "/a/different/node/bin:/usr/bin:/bin",
      HOME: root,
      TMPDIR: tmpdir(),
      FAKE_NODE_VERSION: options.node ?? "24.21.0",
      FAKE_NODE_PATH: path.join(root, "node runtime/bin/node"),
      FAKE_NPM_VERSION: options.npm ?? "11.20.0",
      FAKE_INSTALLED_NPM: options.installedNpm ?? "11.20.0",
      FAKE_INSTALL_STATUS: String(options.installStatus ?? 0),
      FAKE_NPX_STATUS: String(options.npxStatus ?? 0),
      FAKE_NPX_DEV_ENGINES: String(options.enforceNpxDevEngines ?? false),
      FAKE_CALL_LOG: callLog,
      ...(options.userAgent === undefined ? {} : { npm_config_user_agent: options.userAgent }),
      ...(options.lifecycleNpm === undefined ? {} : { npm_execpath: npmCli })
    }
  });
  const calls: NpmCall[] = existsSync(callLog) ? JSON.parse(readFileSync(callLog, "utf8")) : [];
  return { ...result, calls };
}

function fakeTools(root: string, directory: string, nodeVersion: string, npmVersion = "11.20.0") {
  const bin = path.join(root, directory);
  writeExecutable(path.join(bin, "node"), `#!/bin/sh\ncase "$1" in\n--version) printf '%s\\n' ${shellQuote(nodeVersion)} ;;\n-p) printf '%s\\n' 'npm@11.20.0' ;;\n*) exit 127 ;;\nesac\n`);
  writeExecutable(path.join(bin, "npm"), `#!/bin/sh\nprintf '%s\\n' ${shellQuote(npmVersion)}\n`);
  return bin;
}
function runLauncher(root: string, nodeVersion: string, options: { npm?: string; nvm?: "switch" | "missing-version"; command?: string[] } = {}) {
  const currentBin = fakeTools(root, "current tools", nodeVersion, options.npm);
  const selectedBin = fakeTools(root, "selected tools", "v24.21.0");
  const nvmDirectory = path.join(root, "nvm home");
  mkdirSync(nvmDirectory);
  if (options.nvm) {
    writeFileSync(path.join(nvmDirectory, "nvm.sh"), `nvm() {\n printf '%s\\n' "$*" >> ${shellQuote(path.join(root, "nvm.log"))}\n ${options.nvm === "switch" ? `PATH=${shellQuote(selectedBin)}:"$PATH"; export PATH; return 0` : "return 3"}\n}\n`);
  }
  return spawnSync("/bin/sh", [path.join(root, "scripts/with-node.sh"), ...(options.command ?? ["/bin/sh", "-c", "printf '%s\\n' \"$PWD\""])], {
    encoding: "utf8",
    cwd: tmpdir(),
    env: { NODE_ENV: "test", HOME: root, NVM_DIR: nvmDirectory, PATH: `${currentBin}:/usr/bin:/bin` }
  });
}

describe("toolchain bootstrap", () => {
  it("leaves an already-correct npm installation untouched", () => {
    const result = runNodeScript(fixture(), "install-toolchain.mjs");
    expect(result.status).toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].args.at(-1)).toBe("--version");
    expect(result.stdout).toContain("Toolchain ready");
  });

  it("installs only into the selected Node prefix outside the project, then verifies npm", () => {
    const root = fixture();
    const result = runNodeScript(root, "install-toolchain.mjs", { npm: "10.9.8" });
    expect(result.status).toBe(0);
    expect(result.calls).toHaveLength(3);
    const installation = result.calls[1];
    expect(installation.command).toBe(path.join(root, "node runtime/bin/node"));
    expect(installation.args).toContain("npm@11.20.0");
    expect(installation.args[installation.args.indexOf("--prefix") + 1]).toBe(path.join(root, "node runtime"));
    expect(installation.args).toContain("--global");
    expect(installation.cwd).toBe(tmpdir());
    expect(installation.cwd).not.toBe(root);
    expect(installation.path.split(path.delimiter)[0]).toBe(path.join(root, "node runtime/bin"));
    expect(result.calls[2].args.at(-1)).toBe("--version");
  });

  it("rejects an incompatible Node before attempting npm commands", () => {
    const result = runNodeScript(fixture(), "install-toolchain.mjs", { node: "20.20.0" });
    expect(result.status).toBe(1);
    expect(result.calls).toHaveLength(0);
    expect(result.stderr).toContain("nvm install && nvm use");
  });

  it("reports a failed installation without claiming success", () => {
    const result = runNodeScript(fixture(), "install-toolchain.mjs", { npm: "10.9.8", installStatus: 42 });
    expect(result.status).toBe(1);
    expect(result.calls).toHaveLength(2);
    expect(result.stderr).toContain("npm installation failed");
    expect(result.stdout).not.toContain("Toolchain ready");
  });

  it("does not accept an install that leaves a different npm version selected", () => {
    const result = runNodeScript(fixture(), "install-toolchain.mjs", { npm: "10.9.8", installedNpm: "11.19.0" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("still has the wrong npm version");
  });
});

describe("npm lifecycle runtime checks", () => {
  it("rejects old Node even when npm ignores devEngines", () => {
    const result = runNodeScript(fixture(), "check-toolchain.mjs", { node: "20.20.0", userAgent: "npm/10.8.2 node/v20.20.0 darwin arm64" });
    expect(result.status).toBe(1);
    expect(result.calls).toHaveLength(0);
    expect(result.stderr).toContain("Node 24 is required");
  });

  it("checks the npm running the lifecycle rather than a different npm on PATH", () => {
    const result = runNodeScript(fixture(), "check-toolchain.mjs", { userAgent: "npm/10.8.2 node/v24.21.0 darwin arm64" });
    expect(result.status).toBe(1);
    expect(result.calls).toHaveLength(0);
    expect(result.stderr).toContain("node scripts/install-toolchain.mjs");
  });

  it("accepts the pinned npm lifecycle without running any subprocess", () => {
    const result = runNodeScript(fixture(), "check-toolchain.mjs", { userAgent: "npm/11.20.0 node/v24.21.0 darwin arm64" });
    expect(result.status).toBe(0);
    expect(result.calls).toHaveLength(0);
  });

  it("accepts the actual pinned npm when npx inherited an older parent's user-agent", () => {
    const result = runNodeScript(fixture(), "check-toolchain.mjs", {
      userAgent: "npm/11.19.0 node/v24.21.0", lifecycleNpm: "11.20.0"
    });
    expect(result.status).toBe(0);
    expect(result.calls).toHaveLength(0);
  });

  it("rejects an older actual npm even when its user-agent claims the pinned version", () => {
    const result = runNodeScript(fixture(), "check-toolchain.mjs", {
      userAgent: "npm/11.20.0 node/v24.21.0", lifecycleNpm: "11.19.0"
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("found 11.19.0");
  });

  it("supports a direct Node check using that runtime's npm", () => {
    const result = runNodeScript(fixture(), "check-toolchain.mjs");
    expect(result.status).toBe(0);
    expect(result.calls).toHaveLength(1);
  });
});

describe("portable Node launcher", () => {
  it("works from another directory and preserves literal arguments, spaces and command failures", () => {
    const root = fixture();
    const result = runLauncher(root, "v24.21.0", { command: ["/bin/sh", "-c", "printf '%s\\n' \"$PWD\" \"$1\" \"$2\"; exit 7", "capture", "argument with spaces", "$(do-not-execute); *"] });
    expect(result.status).toBe(7);
    expect(result.stdout.trim().split("\n")).toEqual([root, "argument with spaces", "$(do-not-execute); *"]);
  });

  it("selects the exact installed NVM version when inherited Node is incompatible", () => {
    const root = fixture();
    const result = runLauncher(root, "v20.20.0", { nvm: "switch" });
    expect(result.status).toBe(0);
    expect(readFileSync(path.join(root, "nvm.log"), "utf8").trim()).toBe("use --silent 24.21.0");
  });

  it("selects the exact NVM version even if the inherited Node has the same major", () => {
    const root = fixture();
    const result = runLauncher(root, "v24.20.0", { nvm: "switch" });
    expect(result.status).toBe(0);
    expect(existsSync(path.join(root, "nvm.log"))).toBe(true);
  });

  it("permits a provider-managed compatible Node patch when NVM is absent", () => {
    const result = runLauncher(fixture(), "v24.20.0");
    expect(result.status).toBe(0);
  });

  it("does not install Node automatically when the NVM pin is missing", () => {
    const result = runLauncher(fixture(), "v20.20.0", { nvm: "missing-version" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("nvm install");
    expect(result.stdout).toBe("");
  });

  it("fails clearly when incompatible Node is inherited and NVM is absent", () => {
    const result = runLauncher(fixture(), "v22.23.1");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Node 24 is required");
  });

  it("blocks the command when npm is wrong and gives the bootstrap instruction", () => {
    const result = runLauncher(fixture(), "v24.21.0", { npm: "10.9.8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("node scripts/install-toolchain.mjs");
  });

  it("reports usage when no command is supplied", () => {
    const result = runLauncher(fixture(), "v24.21.0", { command: [] });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage:");
  });
});


describe("provider-managed pinned npm launcher", () => {
  it("uses npx's cache with the pinned npm and preserves arguments without global installation", () => {
    const root = fixture();
    const result = runNodeScript(root, "vercel-npm.mjs", { args: ["run", "build", "--", "argument with spaces", "$(do-not-execute)"] });
    expect(result.status).toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].command).toBe("npx");
    expect(result.calls[0].args).toEqual(["--yes", "--package", "npm@11.20.0", "npm", "--prefix", `${root}${path.sep}`, "run", "build", "--", "argument with spaces", "$(do-not-execute)"]);
    expect(result.calls[0].args).not.toContain("--global");
    expect(result.calls[0].cwd).toBe(tmpdir());
    expect(result.calls[0].path.split(path.delimiter)[0]).toBe(path.join(root, "node runtime/bin"));
  });

  it("selects pinned npm before bundled npm can enforce the project contract", () => {
    const result = runNodeScript(fixture(), "vercel-npm.mjs", {
      npm: "11.19.0", enforceNpxDevEngines: true, args: ["ci"]
    });
    expect(result.status).toBe(0);
    expect(result.calls).toHaveLength(1);
  });

  it("preserves an npm command failure", () => {
    const result = runNodeScript(fixture(), "vercel-npm.mjs", { args: ["ci"], npxStatus: 42 });
    expect(result.status).toBe(42);
  });

  it("rejects the wrong Node before npx runs", () => {
    const result = runNodeScript(fixture(), "vercel-npm.mjs", { node: "22.23.1", args: ["ci"] });
    expect(result.status).toBe(1);
    expect(result.calls).toHaveLength(0);
    expect(result.stderr).toContain("Set the Vercel project's Node.js version to 24.x");
  });

  it("requires an npm command", () => {
    const result = runNodeScript(fixture(), "vercel-npm.mjs");
    expect(result.status).toBe(1);
    expect(result.calls).toHaveLength(0);
    expect(result.stderr).toContain("Usage:");
  });
});


describe("project toolchain contract", () => {
  it("keeps install/runtime enforcement aligned with the selected Node and npm", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    const nodePin = readFileSync(".nvmrc", "utf8").trim();
    const npmPin = manifest.packageManager.replace(/^npm@/, "");
    expect(manifest.packageManager).toMatch(/^npm@\d+\.\d+\.\d+$/);
    expect(manifest.engines.node).toBe(`${nodePin.split(".")[0]}.x`);
    expect(manifest.devEngines.runtime).toMatchObject({ name: "node", version: manifest.engines.node, onFail: "error" });
    expect(manifest.engines.npm).toBe(npmPin);
    expect(manifest.devEngines.packageManager).toMatchObject({ name: "npm", version: npmPin, onFail: "error" });
    expect(readFileSync(".npmrc", "utf8")).toMatch(/^engine-strict=true$/m);
  });
});
