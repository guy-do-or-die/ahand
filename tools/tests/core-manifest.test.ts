import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deploymentOf } from "@ahand/sdk/testing";

import { hashDir, hashDirCommand } from "../manifest.ts";
import { REPO, chainOn, cli, sh, type Chain } from "./fixtures.ts";

let chain: Chain;
const scratch = mkdtempSync(join(tmpdir(), "ahand-tools-core-"));

beforeAll(async () => {
  chain = await chainOn(15253);
}, 60_000);

afterAll(async () => {
  await chain?.stop();
});

function writeDeployment(name: string, change: Record<string, unknown> = {}): string {
  const file = join(scratch, name);
  writeFileSync(file, JSON.stringify({ ...deploymentOf(chain), ...change }, null, 2));
  return file;
}

describe("core-check", () => {
  test("exits 0 on a fresh deployment and prints the command that reproduces the initcode hash", () => {
    const run = cli("core-check", "--rpc", chain.rpc, "--deployment", writeDeployment("fresh.json"));
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`create2(0x4e59b44847b379578588920cA78FbF26c0B4956C, keccak256("aHand.core/1")`);
    expect(run.stdout).toContain(`= ${chain.core}`);
    expect(run.stdout).toContain(`eip712Domain() answers "aHand", "core", chain 31337`);
    expect(run.stdout).toContain(`initcode hash ${chain.initcodeHash}`);
    expect(run.stdout).toMatch(/forge" build && .*cast" keccak "\$\(jq -r \.bytecode\.object out\/AHandCore\.sol\/AHandCore\.json\)"/);
    expect(run.stdout).toContain(`Core ${chain.core} is the AHandCore this tree builds.`);
  });

  test("a stand file, which holds the deployment under `deployment`, is read too", () => {
    const file = join(scratch, "stand.json");
    writeFileSync(file, JSON.stringify({ rpc: chain.rpc, deployment: deploymentOf(chain) }));
    expect(cli("core-check", "--rpc", chain.rpc, "--deployment", file).status).toBe(0);
  });

  test("without a deployment file it checks the address this tree derives", () => {
    if (existsSync(join(REPO, "contracts/deployments/31337.json"))) return; // another run's file decides then
    const run = cli("core-check", "--rpc", chain.rpc);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("no deployment file for chain 31337");
  });

  test("exits non-zero when the deployment file names another address", () => {
    const run = cli("core-check", "--rpc", chain.rpc, "--deployment", writeDeployment("other.json", { core: chain.tokens[0]!.address }));
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/^ahand: the deployment names Core 0x[0-9a-fA-F]{40}, but create2 of its own factory, salt and initcode is /);
  });

  test("exits non-zero when the deployment names another initcode, another chain, or the RPC is down", () => {
    const initcode = cli("core-check", "--rpc", chain.rpc, "--deployment", writeDeployment("initcode.json", { initcodeHash: `0x${"11".repeat(32)}` }));
    expect(initcode.status).toBe(1);
    expect(initcode.stderr).toContain("and this tree builds");
    const other = cli("core-check", "--rpc", chain.rpc, "--deployment", writeDeployment("chain.json", { chainId: 8453, tokens: [], forwarder: null, accountFactory: null }));
    expect(other.status).toBe(1);
    expect(other.stderr).toContain("describes chain 8453");
    const down = cli("core-check", "--rpc", "http://127.0.0.1:15298");
    expect(down.status).toBe(1);
    expect(down.stderr).toBe("ahand: the RPC at http://127.0.0.1:15298 did not answer\n");
  });
});

describe("manifest", () => {
  test("writes every field of the deployment JSON, plus commit, dirty, compiler, SDK version and the app's hash", () => {
    const app = join(scratch, "app");
    mkdirSync(join(app, "assets"), { recursive: true });
    writeFileSync(join(app, "index.html"), "<!doctype html><title>aHand</title>");
    writeFileSync(join(app, "assets/app.js"), "console.log(1)");
    const out = join(scratch, "31337.manifest.json");
    const run = cli("manifest", "31337", "--deployment", writeDeployment("31337.json"), "--app", app, "--out", out);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    const manifest = JSON.parse(readFileSync(out, "utf8"));
    for (const field of [
      "chainId", "core", "factory", "salt", "initcodeHash", "runtimeHash", "deployBlock", "tokens",
      "forwarder", "accountFactory", "commit", "dirty", "solc", "optimizerRuns", "evmVersion", "oz",
    ]) {
      expect(manifest).toHaveProperty(field);
    }
    expect(manifest.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof manifest.dirty).toBe("boolean");
    expect(manifest.tree.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.compiler).toMatchObject({ solc: "0.8.35", optimizer: true, optimizerRuns: 200, evmVersion: "prague" });
    expect(manifest.initcode.matches).toBe(true);
    expect(manifest.sdk.version).toBe(JSON.parse(readFileSync(join(REPO, "packages/sdk/package.json"), "utf8")).version);
    expect(manifest.app).toMatchObject({ hash: hashDir(app).hash, files: 2 });
  });

  test("refuses a deployment file of another chain and a missing one", () => {
    const wrong = cli("manifest", "8453", "--deployment", writeDeployment("x.json"), "--out", join(scratch, "x.manifest.json"));
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain("describes chain 31337, not 8453");
    const missing = cli("manifest", "31337", "--deployment", join(scratch, "none.json"));
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("there is no deployment file at");
  });
});

describe("hashDir", () => {
  test("gives the same hash twice for one folder, another after one byte changes, and matches coreutils", () => {
    const dir = join(scratch, "dist");
    mkdirSync(join(dir, "a/b"), { recursive: true });
    writeFileSync(join(dir, "index.html"), "hello");
    writeFileSync(join(dir, "a/b/c.txt"), "deep");
    writeFileSync(join(dir, "Z.txt"), "upper case sorts first by bytes");
    const first = hashDir(dir);
    expect(hashDir(dir)).toEqual(first);
    expect(first.files.map((file) => file.path)).toEqual(["Z.txt", "a/b/c.txt", "index.html"]);

    const shell = sh(hashDirCommand(dir));
    expect(shell.stdout.split(" ")[0]).toBe(first.hash);

    // build.json is written from this hash, so it is not part of it.
    writeFileSync(join(dir, "build.json"), JSON.stringify({ hash: first.hash }));
    expect(hashDir(dir).hash).toBe(first.hash);
    expect(sh(hashDirCommand(dir)).stdout.split(" ")[0]).toBe(first.hash);

    writeFileSync(join(dir, "a/b/c.txt"), "deeP");
    const changed = hashDir(dir);
    expect(changed.hash).not.toBe(first.hash);
    expect(changed.files.find((file) => file.path === "a/b/c.txt")!.sha256).not.toBe(first.files[1]!.sha256);
  });
});
