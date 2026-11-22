/**
 * A stand on ports of the caller's choosing, for a run that may not use the slots' ports
 * (infra/stand gives each slot fixed ones): the helper chain of packages/sdk/tests/helpers/anvil.ts
 * on `base`, the stand's relay on `base + 1`, and the built app served by infra/stand/static.ts on
 * `base + 2`. One process holds all three; SIGTERM or SIGINT stops them.
 *
 *   bun tests/e2e/lib/feat-my/own-stand.ts up --base 24600 --dir <folder>
 *   bun tests/e2e/lib/feat-my/own-stand.ts build --dir <folder>      # the app again, into the same folder
 *
 * `<folder>` gets stand.json, config.json and dist/. A spec runs against it with
 *   STAND_FILE=<folder>/stand.json STAND_BASE_URL=http://127.0.0.1:<base + 2> bunx playwright test …
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { startRelay } from "../../../../infra/relay/relay.ts";
import { connectSourcesOf, startStatic } from "../../../../infra/stand/static.ts";
import { configOf, standOf, startChain } from "../../../../packages/sdk/tests/helpers/anvil.ts";

const HOST = "127.0.0.1";
const ROOT = resolve(import.meta.dirname, "../../../..");

function flag(argv: string[], name: string): string {
  const value = argv[argv.indexOf(name) + 1];
  if (!argv.includes(name) || value === undefined) throw new Error(`${name} is required`);
  return value;
}

const filesOf = (dir: string) => ({ stand: join(dir, "stand.json"), config: join(dir, "config.json"), dist: join(dir, "dist"), cache: join(dir, "vite-cache") });

function build(dir: string): void {
  const files = filesOf(dir);
  const run = spawnSync(process.execPath, ["run", "build"], {
    cwd: join(ROOT, "apps/web"),
    env: { ...process.env, AHAND_CONFIG: files.config, AHAND_OUT_DIR: files.dist, AHAND_VITE_CACHE: files.cache },
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`the app's build failed:\n${run.stdout}\n${run.stderr}`);
}

async function up(base: number, dir: string): Promise<void> {
  const files = filesOf(dir);
  mkdirSync(dir, { recursive: true });
  const site = `http://${HOST}:${base + 2}`;
  const relayUrl = `ws://${HOST}:${base + 1}`;
  const json = (value: unknown) => `${JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`;

  const chain = await startChain({ port: base, blockTime: 1, slotsInAnEpoch: 1 });
  let stop = async () => chain.stop();
  try {
    writeFileSync(files.stand, json({ ...standOf(chain), site, relay: relayUrl }));
    writeFileSync(files.config, json(configOf(chain, site, [relayUrl])));
    const relay = startRelay({ port: base + 1, hostname: HOST, log: () => {} });
    stop = async () => {
      await relay.stop();
      await chain.stop();
    };
    build(dir);
    const server = startStatic({ dir: files.dist, port: base + 2, hostname: HOST, connect: connectSourcesOf(JSON.parse(readFileSync(files.config, "utf8"))), log: () => {} });
    stop = async () => {
      server.stop(true);
      await relay.stop();
      await chain.stop();
    };
  } catch (error) {
    await stop();
    throw error;
  }
  console.log(JSON.stringify({ pid: process.pid, site, rpc: chain.rpc, relay: relayUrl, core: chain.core, stand: files.stand }));
  const down = () => void stop().then(() => process.exit(0));
  process.on("SIGTERM", down);
  process.on("SIGINT", down);
  await new Promise(() => {});
}

const [command, ...argv] = process.argv.slice(2);
try {
  if (command === "up") await up(Number(flag(argv, "--base")), resolve(flag(argv, "--dir")));
  else if (command === "build") build(resolve(flag(argv, "--dir")));
  else throw new Error("usage: own-stand.ts up --base <port> --dir <folder> | build --dir <folder>");
} catch (error) {
  console.error(`own-stand: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
