/**
 * A whole local stand on ports of one's own choosing, for runs that may not take a stand slot's
 * fixed ports (infra/stand/ports.ts: 18xxx), e.g. while other agents hold the slots. It does what
 * `stand.ts up` does, with the stand's own pieces (anvilArgs, Deploy.s.sol under the forge lock,
 * configOf, standOf, the relay, the app's build, static.ts), into a folder of its own:
 *
 *   bun tests/e2e/lib/care-print/stand.ts up   --dir DIR --base PORT   # chain PORT, relay +1, site +2
 *   bun tests/e2e/lib/care-print/stand.ts down --dir DIR
 *   bun tests/e2e/lib/care-print/stand.ts build --dir DIR              # rebuild the app after a change
 *
 * Then: STAND_FILE=DIR/stand.json STAND_BASE_URL=http://127.0.0.1:<PORT+2> bunx playwright test …
 *
 * Every process is started detached in its own group; its pid is in DIR/pids.json and `down`
 * kills exactly those groups. Chain 31337 only; anvil's public test account 0 deploys, inside
 * Deploy.s.sol, as for every stand.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parseDeployment } from "@ahand/abi";

import { forge, foundryPath } from "../../../../infra/stand/foundry.ts";
import { REPO_ROOT, type SlotPorts } from "../../../../infra/stand/ports.ts";
import { AHEAD_SECONDS, anvilArgs, assertLocalChain, configOf, portBusy, rpcUrl, siteUrl, standOf, type DeploymentIn } from "../../../../infra/stand/stand.ts";

const HOST = "127.0.0.1";
type Pids = Record<string, number>;

function flag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at < 0 ? undefined : argv[at + 1];
}

function pidsOf(dir: string): Pids {
  const file = join(dir, "pids.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Pids) : {};
}

function keep(dir: string, name: string, pid: number): void {
  writeFileSync(join(dir, "pids.json"), JSON.stringify({ ...pidsOf(dir), [name]: pid }, null, 2));
}

function start(dir: string, name: string, command: string, args: string[], env: Record<string, string> = {}, cwd = REPO_ROOT): number {
  const fd = openSync(join(dir, `${name}.log`), "a");
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  child.unref();
  keep(dir, name, child.pid!);
  return child.pid!;
}

async function until(what: string, ms: number, check: () => Promise<boolean>): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${what}: not within ${ms} ms`);
}

async function ok(url: string, init?: RequestInit): Promise<boolean> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(1_000) });
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}

const chainIdOf = async (rpc: string) =>
  Number(((await (await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) })).json()) as { result: string }).result);

function git(args: string[]): string | undefined {
  const run = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return run.status === 0 ? run.stdout.trim() : undefined;
}

function build(dir: string): void {
  const run = spawnSync(process.execPath, ["run", "build"], {
    cwd: join(REPO_ROOT, "apps/web"),
    env: { ...process.env, AHAND_CONFIG: join(dir, "config.json"), AHAND_OUT_DIR: join(dir, "dist"), AHAND_VITE_CACHE: join(dir, "vite") },
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  writeFileSync(join(dir, "build.log"), `${run.stdout}\n${run.stderr}`);
  if (run.status !== 0 || !existsSync(join(dir, "dist/index.html"))) throw new Error(`the app's build failed; see ${join(dir, "build.log")}`);
}

async function up(dir: string, base: number): Promise<void> {
  const ports: SlotPorts = { chain: base, relay: base + 1, site: base + 2, dev: base + 3 };
  for (const port of Object.values(ports)) if (await portBusy(port)) throw new Error(`port ${port} is in use`);
  mkdirSync(dir, { recursive: true });
  rmSync(join(dir, "pids.json"), { force: true });

  start(dir, "chain", foundryPath("anvil"), anvilArgs(ports.chain, Math.floor(Date.now() / 1000) + AHEAD_SECONDS));
  await until("anvil", 30_000, async () => (await chainIdOf(rpcUrl(ports)).catch(() => 0)) > 0);
  assertLocalChain(await chainIdOf(rpcUrl(ports)));

  const deployOut = `deployments/31337-care-print-${base}.json`;
  const file = join(REPO_ROOT, "contracts", deployOut);
  rmSync(file, { force: true });
  const commit = git(["rev-parse", "HEAD"]);
  const dirty = git(["status", "--porcelain", "--", "contracts/src", "contracts/foundry.toml"]) ? "true" : "false";
  const deployed = await forge(["script", "script/Deploy.s.sol", "--rpc-url", rpcUrl(ports), "--broadcast"], { env: { DEPLOY_OUT: deployOut, ...(commit ? { DEPLOY_COMMIT: commit, DEPLOY_DIRTY: dirty } : {}) } });
  writeFileSync(join(dir, "deploy.log"), `${deployed.stdout}\n${deployed.stderr}`);
  if (deployed.code !== 0 || !existsSync(file)) throw new Error(`Deploy.s.sol failed; see ${join(dir, "deploy.log")}`);
  const bytes = readFileSync(file);
  const deployment = parseDeployment(JSON.parse(bytes.toString("utf8"))) as DeploymentIn;
  assertLocalChain(deployment.chainId);

  const site = siteUrl(ports);
  writeFileSync(join(dir, "config.json"), JSON.stringify(configOf(deployment, ports, site), null, 2));
  const record = standOf({
    slot: -1,
    mode: "built",
    site,
    ports,
    deployment,
    aheadSeconds: AHEAD_SECONDS,
    server: "static",
    serverNote: "care-print's own-ports stand",
    deploymentFile: file,
    deploymentSha256: createHash("sha256").update(bytes).digest("hex"),
  });
  writeFileSync(join(dir, "stand.json"), JSON.stringify(record, null, 2));

  start(dir, "relay", process.execPath, [join(REPO_ROOT, "infra/relay/relay.ts")], { PORT: String(ports.relay), HOST });
  await until("relay", 10_000, () => portBusy(ports.relay));
  build(dir);
  startSite(dir, ports.site);
  await until("static.ts", 10_000, () => ok(`${site}/`));
  console.log(JSON.stringify({ stand: join(dir, "stand.json"), site, rpc: rpcUrl(ports), core: deployment.core, pids: pidsOf(dir) }));
}

function startSite(dir: string, port: number): void {
  start(dir, "site", process.execPath, [join(REPO_ROOT, "infra/stand/static.ts"), "--dir", join(dir, "dist"), "--port", String(port), "--config", join(dir, "config.json"), "--host", HOST]);
}

function stop(pid: number): void {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, "SIGTERM");
      return;
    } catch {
      // not a group leader or already gone
    }
  }
}

async function down(dir: string): Promise<void> {
  const pids = pidsOf(dir);
  for (const pid of Object.values(pids)) stop(pid);
  rmSync(join(dir, "pids.json"), { force: true });
  console.log(JSON.stringify({ stopped: pids }));
}

async function rebuild(dir: string): Promise<void> {
  const stand = JSON.parse(readFileSync(join(dir, "stand.json"), "utf8")) as { ports: SlotPorts; site: string };
  build(dir);
  const pid = pidsOf(dir).site;
  if (pid) stop(pid);
  await until("site port frees", 5_000, async () => !(await portBusy(stand.ports.site)));
  startSite(dir, stand.ports.site);
  await until("static.ts", 10_000, () => ok(`${stand.site}/`));
  console.log(JSON.stringify({ rebuilt: stand.site }));
}

if (import.meta.main) {
  const [command, ...argv] = process.argv.slice(2);
  const dir = resolve(flag(argv, "--dir") ?? "");
  const run = command === "up" ? up(dir, Number(flag(argv, "--base"))) : command === "down" ? down(dir) : command === "build" ? rebuild(dir) : Promise.reject(new Error("usage: stand.ts up|down|build --dir DIR [--base PORT]"));
  run.catch(async (error) => {
    console.error((error as Error).message);
    if (command === "up") await down(dir);
    process.exit(1);
  });
}
