/**
 * The stand (ARCHITECTURE §14): its pure parts (arguments, anvil's flags, the app configuration,
 * stand.json, the static server's rule and headers), the static server live on a test port, and
 * two whole stands, slots 8 and 9, brought up in the same second and taken down again.
 *
 * The two-stand test needs slots 8 and 9 to be free. When either slot's ports are taken (a gate or
 * another agent runs a stand there) it is skipped with a line saying so, rather than fighting over
 * the ports. STAND_TEST_SLOTS="a,b" picks two other slots.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { parseConfig } from "../../../apps/hand/src/config/load.ts";
import { hashDir } from "../../../tools/manifest.ts";
import { pathsOf, portsOf, REPO_ROOT } from "../ports.ts";
import { AHEAD_SECONDS, anvilArgs, assertLocalChain, configOf, parseArgs, standOf, type StandRecord } from "../stand.ts";
import { contentSecurityPolicy, inlineScriptHashes, resolvePath, securityHeaders, startStatic } from "../static.ts";

const CORE = "0x65ac707E2AE7392583de5d6192C619F1D8862309";
const DEPLOYMENT = {
  chainId: 31337,
  core: CORE,
  factory: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
  salt: "0x4f0ff848a233427c84043ed87224bdfcb9f141e864d27833ac5d1344e3a3347d",
  initcodeHash: "0x9f4031e9df87b432822254b2e546d1fc8b88a6bb8798522e7b47d1ab5a08de65",
  runtimeHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
  deployBlock: 3,
  tokens: [
    { address: "0x1000000000000000000000000000000000000001", symbol: "mUSD", decimals: 6, kind: "usd" },
    { address: "0x1000000000000000000000000000000000000002", symbol: "bUSD", decimals: 6, kind: "blacklist" },
  ],
  forwarder: "0x2000000000000000000000000000000000000002",
  accountFactory: "0x3000000000000000000000000000000000000003",
  commit: "a5d3ed6a5d3ed6a5d3ed6a5d3ed6a5d3ed6a5d3e",
  dirty: true,
  solc: "0.8.35",
  optimizerRuns: 200,
  evmVersion: "prague",
  oz: "5.6.1",
} as const;

describe("arguments", () => {
  test("up with every flag", () => {
    expect(parseArgs(["up", "--slot", "9", "--dev", "--no-face", "--ahead", "0"])).toEqual({
      command: "up",
      slot: 9,
      dev: true,
      noFace: true,
      ahead: 0,
      all: false,
      json: false,
      service: undefined,
      slotGiven: true,
    });
  });
  test("defaults: slot from STAND_SLOT or 0, 40 days ahead", () => {
    const parsed = parseArgs(["up"], {});
    expect(parsed.slot).toBe(0);
    expect(parsed.ahead).toBe(AHEAD_SECONDS);
    expect(AHEAD_SECONDS).toBe(40 * 86_400);
    expect(parseArgs(["status"], { STAND_SLOT: "8" }).slot).toBe(8);
  });
  test("stop and start name their service", () => {
    expect(parseArgs(["stop", "--slot", "9", "relay"]).service).toBe("relay");
    expect(parseArgs(["start", "--slot", "9", "static"]).service).toBe("static");
    expect(() => parseArgs(["stop", "--slot", "9", "face"])).toThrow(/chain, relay, site or dev/);
    expect(() => parseArgs(["start", "--slot", "9", "chain"])).toThrow(/relay, face, static or dev/);
    expect(() => parseArgs(["stop", "--slot", "9"])).toThrow();
  });
  test("refuses what it does not know", () => {
    expect(() => parseArgs(["up", "--slot", "10"])).toThrow(/0 to 9/);
    expect(() => parseArgs(["up", "--fast"])).toThrow(/--fast/);
    expect(() => parseArgs(["launch"])).toThrow(/launch/);
    expect(() => parseArgs(["up", "--ahead", "-5"])).toThrow(/--ahead/);
  });
});

describe("the chain", () => {
  test("anvil runs on the slot's port, 31337, a clock ahead, one block a second, safe and finalized trailing", () => {
    const args = anvilArgs(18635, 1_800_000_000);
    const flag = (name: string) => args[args.indexOf(name) + 1];
    expect(flag("--port")).toBe("18635");
    expect(flag("--host")).toBe("127.0.0.1");
    expect(flag("--chain-id")).toBe("31337");
    expect(flag("--timestamp")).toBe("1800000000");
    expect(flag("--block-time")).toBe("1");
    expect(flag("--slots-in-an-epoch")).toBe("1");
  });
  test("refuses any chain but 31337", () => {
    expect(() => assertLocalChain(31337)).not.toThrow();
    expect(() => assertLocalChain(8453)).toThrow(/31337/);
    expect(() => assertLocalChain(1)).toThrow(/31337/);
  });
});

describe("configuration and stand.json", () => {
  const ports = portsOf(9);
  const config = configOf(DEPLOYMENT, ports, "http://127.0.0.1:18390");

  test("the app's own loader accepts it", () => {
    expect(() => parseConfig(config)).not.toThrow();
  });
  test("chain, Cores, deployment facts, tokens, helpers, relay, site, prices", () => {
    expect(config.chain).toEqual({ id: 31337, name: "Local test network", rpcUrls: ["http://127.0.0.1:18635"], blockTimeMs: 1000, local: true, hasL1: false });
    expect(config.cores).toEqual({ trusted: [{ chainId: 31337, core: CORE }], canonical: CORE });
    expect(config.deployment).toEqual({
      factory: DEPLOYMENT.factory,
      salt: DEPLOYMENT.salt,
      initcodeHash: DEPLOYMENT.initcodeHash,
      deployBlock: 3,
      commit: DEPLOYMENT.commit,
      dirty: true,
    });
    expect(config.tokens.map((t) => [t.kind, t.label])).toEqual([
      ["usd", "Test dollars"],
      ["blacklist", "Test dollars that can block"],
    ]);
    expect(config.forwarder).toBe(DEPLOYMENT.forwarder);
    expect(config.accountFactory).toBe(DEPLOYMENT.accountFactory);
    expect(config.relays).toEqual(["ws://127.0.0.1:18637"]);
    expect(config.site).toBe("http://127.0.0.1:18390");
    expect(config.prices.date).toBe("2026-11-10");
    expect(config.defaults).toEqual({ minClaimBps: 7000, payoutGasK: 250, expiryDays: 30 });
  });
  test("a deployment that left commit and dirty unset still makes a valid configuration", () => {
    const loose = configOf({ ...DEPLOYMENT, commit: null, dirty: null }, ports, "http://127.0.0.1:18390");
    expect(loose.deployment?.commit).toBe("");
    expect(loose.deployment?.dirty).toBe(false);
    expect(() => parseConfig(loose)).not.toThrow();
  });
  test("stand.json carries every field of §14", () => {
    const stand = standOf({ slot: 9, mode: "built", site: "http://127.0.0.1:18390", ports, deployment: DEPLOYMENT, aheadSeconds: AHEAD_SECONDS, server: "static", serverNote: "", deploymentFile: "/x", deploymentSha256: "ab" });
    for (const field of ["slot", "mode", "site", "rpc", "relay", "chainId", "core", "tokens", "forwarder", "accountFactory", "aheadSeconds"]) {
      expect(stand).toHaveProperty(field);
    }
    expect(stand.rpc).toBe("http://127.0.0.1:18635");
    expect(stand.relay).toBe("ws://127.0.0.1:18637");
    expect(stand.tokens[0]).toEqual(DEPLOYMENT.tokens[0]);
  });
});

describe("static server: rule and headers", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "ahand-static-"));
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "index.html"), "<!doctype html><title>index</title>");
    writeFileSync(join(root, "exit.html"), '<!doctype html><title>exit</title><script type="module">run()</script>');
    writeFileSync(join(root, "build.json"), '{"hash":"x"}');
    writeFileSync(join(root, "assets", "app-1.js"), "console.log(1)");
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("CSP of ARCHITECTURE §11, with the RPC and the relay in connect-src", () => {
    expect(contentSecurityPolicy(["http://127.0.0.1:18635", "ws://127.0.0.1:18637"])).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; " +
        "connect-src 'self' http://127.0.0.1:18635 ws://127.0.0.1:18637; worker-src 'none'; object-src 'none'; base-uri 'none'; " +
        "form-action 'none'; frame-ancestors 'none'",
    );
    expect(() => contentSecurityPolicy(["http://a.example; script-src *"])).toThrow();
    const headers = securityHeaders([]);
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["Content-Security-Policy"]).toContain("connect-src 'self';");
  });

  test("existing files as they are, every other path to index, missing files with an extension 404", () => {
    expect(resolvePath(root, "/")).toEqual({ file: join(root, "index.html"), fallback: false });
    expect(resolvePath(root, "/exit.html")).toEqual({ file: join(root, "exit.html"), fallback: false });
    expect(resolvePath(root, "/build.json")).toEqual({ file: join(root, "build.json"), fallback: false });
    expect(resolvePath(root, "/assets/app-1.js")).toEqual({ file: join(root, "assets", "app-1.js"), fallback: false });
    expect(resolvePath(root, "/31337/1")).toEqual({ file: join(root, "index.html"), fallback: true });
    expect(resolvePath(root, "/31337/0x65ac707E2AE7392583de5d6192C619F1D8862309/1")).toEqual({ file: join(root, "index.html"), fallback: true });
    expect(resolvePath(root, "/assets")).toEqual({ file: join(root, "index.html"), fallback: true });
    expect(resolvePath(root, "/assets/app-2.js")).toEqual({ status: 404 });
  });

  test("never leaves the folder", () => {
    expect(resolvePath(root, "/../package.json")).toEqual({ status: 400 });
    expect(resolvePath(root, "/%2e%2e/package.json")).toEqual({ status: 400 });
    expect(resolvePath(root, "/a/%2e%2e/%2e%2e/x")).toEqual({ status: 400 });
    expect(resolvePath(root, "/%E0%A4%A")).toEqual({ status: 400 });
    expect(resolvePath(root, "/x%00.html")).toEqual({ status: 400 });
  });

  test("live on a test port: headers on every answer, HEAD, methods", async () => {
    const server = startStatic({ dir: root, port: 16001, connect: ["http://127.0.0.1:18635"], log: () => {} });
    try {
      const base = "http://127.0.0.1:16001";
      const deep = await fetch(`${base}/31337/1?d=abc`);
      expect(deep.status).toBe(200);
      expect(await deep.text()).toContain("<title>index</title>");
      expect(deep.headers.get("content-security-policy")).toContain("connect-src 'self' http://127.0.0.1:18635;");
      expect(deep.headers.get("referrer-policy")).toBe("no-referrer");
      expect(deep.headers.get("content-type")).toContain("text/html");

      // index.html has no inline script: the plain §11 policy, no extra RPC.
      expect(deep.headers.get("content-security-policy")).toContain("script-src 'self';");
      expect(deep.headers.get("content-security-policy")).not.toContain("https:");

      const exit = await fetch(`${base}/exit.html`);
      expect(await exit.text()).toContain("<title>exit</title>");
      // exit.html: exactly its own inline script may run, and it may reach an RPC its reader types.
      const hash = createHash("sha256").update("run()", "utf8").digest("base64");
      expect(inlineScriptHashes('<script type="module">run()</script><script src="/a.js"></script>')).toEqual([`'sha256-${hash}'`]);
      const exitCsp = exit.headers.get("content-security-policy")!;
      expect(exitCsp).toContain(`script-src 'self' 'sha256-${hash}';`);
      expect(exitCsp).toContain("connect-src 'self' http://127.0.0.1:18635 https: http://127.0.0.1:* http://localhost:*;");
      const build = await fetch(`${base}/build.json`);
      expect(build.status).toBe(200);
      expect(await build.json()).toEqual({ hash: "x" });

      const missing = await fetch(`${base}/assets/nope.js`);
      expect(missing.status).toBe(404);
      expect(missing.headers.get("referrer-policy")).toBe("no-referrer");

      const head = await fetch(`${base}/exit.html`, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers.get("content-security-policy")).not.toBeNull();
      expect(await head.text()).toBe("");

      expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(405);
    } finally {
      server.stop(true);
    }
  });
});

/* ---------------------------------------------------------------- two whole stands */

function portBusy(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.once("connect", () => (socket.destroy(), done(true)));
    socket.once("error", () => done(false));
    socket.setTimeout(500, () => (socket.destroy(), done(false)));
  });
}

const STAND = join(REPO_ROOT, "infra/stand/stand.ts");
function stand(args: string[]) {
  return new Promise<{ code: number; out: string }>((done) => {
    const child = Bun.spawn([process.execPath, STAND, ...args], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
    Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]).then(([out, err, code]) =>
      done({ code, out: out + err }),
    );
  });
}

async function rpc(url: string, method: string, params: unknown[] = []): Promise<any> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = (await response.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

const slots = (process.env.STAND_TEST_SLOTS ?? "8,9").split(",").map(Number);

describe("two stands side by side", () => {
  let free = true;
  beforeAll(async () => {
    for (const slot of slots) {
      const ports = portsOf(slot);
      for (const port of [ports.chain, ports.relay, ports.site, ports.dev]) {
        if (await portBusy(port)) free = false;
      }
    }
    if (!free) console.warn(`skipping: a port of slot ${slots.join(" or ")} is in use; bring those stands down first`);
  });
  afterAll(async () => {
    if (free) await Promise.all(slots.map((slot) => stand(["down", "--slot", String(slot)])));
  });

  test(
    "come up in the same second, each with its own deployment file, and go down leaving no port",
    async () => {
      if (!free) return;
      const results = await Promise.all(slots.map((slot) => stand(["up", "--slot", String(slot), "--no-face"])));
      results.forEach((r, i) => expect(r.code, `slot ${slots[i]}: ${r.out}`).toBe(0));

      for (const slot of slots) {
        const paths = pathsOf(slot);
        const record = JSON.parse(readFileSync(paths.stand, "utf8")) as StandRecord;
        // It read its own file, and the file it read is the one on disk now.
        expect(record.deploymentFile).toBe(paths.deployment);
        expect(existsSync(paths.deployment)).toBe(true);
        expect(record.deploymentSha256).toBe(createHash("sha256").update(readFileSync(paths.deployment)).digest("hex"));
        for (const other of slots.filter((s) => s !== slot)) expect(record.deploymentFile).not.toBe(pathsOf(other).deployment);

        // Its chain has the contracts it names, and runs its clock ahead.
        expect(record.rpc).toBe(`http://127.0.0.1:${portsOf(slot).chain}`);
        for (const address of [record.core, record.forwarder!, record.accountFactory!, ...record.tokens.map((t) => t.address)]) {
          expect((await rpc(record.rpc, "eth_getCode", [address, "latest"])).length).toBeGreaterThan(2);
        }
        const latest = await rpc(record.rpc, "eth_getBlockByNumber", ["latest", false]);
        expect(Number(latest.timestamp) - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(39 * 86_400);

        // The built site, with the build hash beside it.
        const build = JSON.parse(readFileSync(join(paths.dist, "build.json"), "utf8"));
        expect(build.hash).toBe(hashDir(paths.dist).hash);
        const page = await fetch(`${record.site}/31337/1`);
        expect(page.status).toBe(200);
        expect(page.headers.get("referrer-policy")).toBe("no-referrer");
      }

      const down = await Promise.all(slots.map((slot) => stand(["down", "--slot", String(slot)])));
      down.forEach((r) => expect(r.code, r.out).toBe(0));
      for (const slot of slots) {
        const ports = portsOf(slot);
        for (const port of [ports.chain, ports.relay, ports.site, ports.dev]) expect(await portBusy(port)).toBe(false);
        expect(existsSync(pathsOf(slot).pids)).toBe(false);
        expect(existsSync(pathsOf(slot).deployment)).toBe(false);
      }
      // No anvil of these slots is left.
      const anvils = spawnSync("pgrep", ["-af", "anvil"], { encoding: "utf8" }).stdout;
      for (const slot of slots) expect(anvils).not.toContain(`--port ${portsOf(slot).chain}`);
    },
    600_000,
  );
});
