/**
 * The fixtures, the loop and the craft tool, run for real: a helper chain of its own (40 days
 * ahead, one block a second, like a stand), the stand's relay as a child process, and the three
 * programs as child processes, the way spec files and the gates call them.
 *
 *   bun test infra/stand/tests/fixtures.test.ts
 *
 * Ports 16060 (chain) and 16061 (relay); override with FIXTURES_TEST_PORT (the relay takes the next).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { checkGiveOnChain, findLaterHands, openAddress, readDescription, readPending } from "@ahand/sdk";
import { standOf, startChain, type Chain } from "@ahand/sdk/testing";

import { FIXTURE_NAMES, World, refusalName, type SeedRun, type StandFacts } from "../seed.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const PORT = Number(process.env.FIXTURES_TEST_PORT ?? 16060);
const BUN = process.execPath;

let chain: Chain;
let relay: ChildProcess;
let folder: string;
let standFile: string;
let world: World;
const runs: { run: SeedRun; seconds: number }[] = [];

/**
 * Runs `bun <script> <args>` from the root without blocking this process: the helper chain's
 * anvil writes its log into a pipe this process reads, and a blocked reader would stall the chain.
 */
async function program(script: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string; seconds: number }> {
  const started = performance.now();
  const child = Bun.spawn([BUN, script, ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, stdout, stderr, seconds: (performance.now() - started) / 1000 };
}

async function seedOnce(): Promise<{ run: SeedRun; seconds: number }> {
  const result = await program("infra/stand/seed.ts", ["--stand", standFile, "--json"]);
  if (result.code !== 0) throw new Error(`seed exited ${result.code}: ${result.stderr}`);
  return { run: JSON.parse(result.stdout) as SeedRun, seconds: result.seconds };
}

const craft = (...args: string[]) => program("tests/e2e/lib/craft.ts", [...args, "--stand", standFile]);

async function waitForRelay(port: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ok = await new Promise<boolean>((done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.onopen = () => {
        ws.close();
        done(true);
      };
      ws.onerror = () => done(false);
    });
    if (ok) return;
    await Bun.sleep(50);
  }
  throw new Error(`the relay on ${port} did not answer`);
}

beforeAll(async () => {
  chain = await startChain({ port: PORT, blockTime: 1, slotsInAnEpoch: 1 });
  relay = spawn(BUN, ["infra/relay/relay.ts"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT + 1) }, stdio: "ignore" });
  await waitForRelay(PORT + 1);
  folder = mkdtempSync(join(tmpdir(), "ahand-fixtures-"));
  standFile = join(folder, "stand.json");
  writeFileSync(standFile, JSON.stringify({ ...standOf(chain), relay: `ws://127.0.0.1:${PORT + 1}` }, null, 2));
  world = new World(JSON.parse(readFileSync(standFile, "utf8")) as StandFacts);
  runs.push(await seedOnce());
  runs.push(await seedOnce());
}, 120_000);

afterAll(async () => {
  relay?.kill("SIGTERM");
  await chain?.stop();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("seed", () => {
  test("two runs on one chain give two complete sets: the same names, other Hands, each under 20 seconds", () => {
    const [one, two] = runs;
    for (const { run, seconds } of runs) {
      expect(Object.keys(run.fixtures).sort()).toEqual([...FIXTURE_NAMES].sort());
      expect(seconds).toBeLessThan(20);
    }
    const ids = (run: SeedRun) => Object.values(run.fixtures).map((fixture) => String(fixture!.handId));
    const first = new Set(ids(one!.run));
    expect(first.size).toBe(FIXTURE_NAMES.length);
    for (const id of ids(two!.run)) expect(first.has(id)).toBe(false);
    // The n of the test book never repeats on one chain.
    const ns = [...Object.values(one!.run.fixtures), ...Object.values(two!.run.fixtures)].map((fixture) => fixture!.n);
    expect(new Set(ns).size).toBe(ns.length);
    expect(one!.run.book).toBe(two!.run.book);
  });

  test("every address opens with openAddress; the description is attached, lost for the lost one", async () => {
    let opened = 0;
    for (const [name, fixture] of Object.entries(runs[0]!.run.fixtures)) {
      for (const [field, value] of Object.entries(fixture!)) {
        if (!/address$/i.test(field) || typeof value !== "string") continue;
        const link = await openAddress(value, world.getHand, world.options);
        expect(String(link.hand.handId)).toBe(String(fixture!.handId));
        expect(readDescription(link).status).toBe(name === "lost" ? "lost" : "attached");
        opened++;
      }
    }
    expect(opened).toBeGreaterThanOrEqual(20);
  });

  test("states by the chain's clock", () => {
    const { fixtures } = runs[0]!.run;
    expect(fixtures.refunded!.state).toBe("refunded");
    expect(fixtures.thanked!.state).toBe("thanked");
    expect(fixtures.expired!.state).toBe("expired");
    expect(fixtures.blocked!.state).toBe("thanked");
    for (const name of ["unlisted", "dark", "public", "twoPasses", "lost", "give", "resigned", "undeployed", "noReward"] as const) {
      expect(fixtures[name]!.state).toBe("open");
    }
    expect(fixtures.twoPasses!.claimBps).toBe(9_500);
    expect(fixtures.noReward!.reward).toBe("0");
  });

  test("Core's checkGive accepts the give fixture", async () => {
    const link = await world.open(runs[0]!.run.fixtures.give!.giveAddress as string);
    await checkGiveOnChain(world.client, world.core, link.hand.handId, link.signedShakes, link.signedGive!);
  });

  test("the undeployed account's Give: refused bare, accepted with its setup", async () => {
    const fixture = runs[0]!.run.fixtures.undeployed!;
    const link = await world.open(fixture.giveAddress as string);
    expect(await world.client.getCode({ address: fixture.account as `0x${string}` })).toBeUndefined();
    let bare: string | undefined;
    try {
      await checkGiveOnChain(world.client, world.core, link.hand.handId, link.signedShakes, link.signedGive!);
    } catch (error) {
      bare = refusalName(error);
    }
    expect(bare).toBe("InvalidGiverSig");
    const setup = fixture.setup as { forwarder: `0x${string}`; factory: `0x${string}`; factoryData: `0x${string}` };
    await checkGiveOnChain(world.client, world.core, link.hand.handId, link.signedShakes, link.signedGive!, setup);
  });

  test("the re-signed pair: both pass Core, judged re-signed, the second holder dropped", async () => {
    const fixture = runs[0]!.run.fixtures.resigned!;
    for (const field of ["firstGiveAddress", "secondGiveAddress"]) {
      const link = await world.open(fixture[field] as string);
      await checkGiveOnChain(world.client, world.core, link.hand.handId, link.signedShakes, link.signedGive!);
    }
    expect(fixture.verdict).toBe("resigned");
    expect(fixture.dropped).toEqual([expect.objectContaining({ position: 1, payee: runs[0]!.run.accounts.holderB })]);
  });

  test("the refunded Hand's raiser has later Hands, found from the block where it ended", async () => {
    const { fixtures, raiser } = runs[0]!.run;
    const now = await world.now();
    const look = findLaterHands(world.client, world.core, raiser.address, { fromBlock: BigInt(fixtures.refunded!.endedBlock as string), toBlock: now.number });
    expect(look.requests).toBeGreaterThan(0);
    const found = (await look.run()).map((hand) => String(hand.handId));
    for (const name of ["thanked", "unlisted", "dark", "public", "blocked"] as const) expect(found).toContain(String(fixtures[name]!.handId));
    expect(found).not.toContain(String(fixtures.refunded!.handId));
  });

  test("the blocked payee's share waits in Core, with the commands that free it", async () => {
    const { pending, unblock, withdraw } = runs[1]!.run.fixtures.blocked! as Record<string, Record<string, string>>;
    expect(BigInt(pending!.amount!)).toBe(5_000_000n);
    expect(await readPending(world.client, world.core, pending!.token as `0x${string}`, pending!.payee as `0x${string}`)).toBeGreaterThanOrEqual(5_000_000n);
    expect(unblock!.cast).toContain("cast send");
    expect(withdraw!.cast).toContain(world.core);
  });
});

describe("loop", () => {
  test("every part passes on the same chain, delivery over the relay included", async () => {
    const result = await program("infra/stand/loop.ts", ["--stand", standFile]);
    expect(result.code).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines.map((line) => line.split(/\s+/)[0])).toEqual(["usd", "pending", "refund", "zero-reward", "second-token", "undeployed-account"]);
    for (const line of lines) expect(line.split(/\s+/)[1]).toBe("ok");
    expect(lines[0]).toContain("delivered to 1 of 1 relay");
  }, 60_000);
});

describe("craft", () => {
  test("open prints a fresh Hand as JSON", async () => {
    const fresh = runs[1]!.run.fixtures.unlisted!;
    const result = await craft("open", fresh.address as string);
    expect(result.code).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json).toMatchObject({ ok: true, kind: "live", shape: "faced", handId: fresh.handId, shakes: 0, state: "open" });
    expect(json.description.status).toBe("attached");
    expect(json.description.title).toBe(fresh.title);
  });

  test("tamper flip makes open exit non-zero with the code malformed; the other tampers say their own codes", async () => {
    const address = runs[1]!.run.fixtures.unlisted!.address as string;
    const codeAfter = async (how: string, of = address) => {
      const tampered = JSON.parse((await craft("tamper", of, "--how", how)).stdout).address as string;
      const result = await craft("open", tampered);
      return { exit: result.code, json: JSON.parse(result.stdout) };
    };
    const flipped = await codeAfter("flip");
    expect(flipped.exit).not.toBe(0);
    expect(flipped.json).toMatchObject({ ok: false, code: "malformed", messageId: "link.malformed" });
    expect((await codeAfter("other-core")).json.code).toBe("untrusted");
    expect((await codeAfter("version")).json.messageId).toBe("link.unsupported");
    expect((await codeAfter("other-number")).json.code).toBe("another-hand");
    expect((await codeAfter("cut-d")).json.code).toBe("unmatched-data");
    const altered = await codeAfter("giver-sig", runs[1]!.run.fixtures.give!.giveAddress as string);
    expect(altered.exit).toBe(0);
    expect(altered.json.give.core).toBe("InvalidGiverSig");
  }, 30_000);

  test("secrets prints the seed in three forms that agree", async () => {
    const address = runs[1]!.run.fixtures.dark!.address as string;
    const result = await craft("secrets", address);
    expect(result.code).toBe(0);
    const { hex, base64url, digits } = JSON.parse(result.stdout);
    const seed = (await world.open(address)).seed!;
    expect(hex).toBe(seed.slice(2));
    expect(BigInt(digits)).toBe(BigInt(seed));
    expect(Buffer.from(base64url, "base64url").toString("hex")).toBe(hex);
  });

  test("wrap-6492 gives a wrapped Give that Core accepts only with its setup", async () => {
    const result = await craft("wrap-6492", runs[1]!.run.fixtures.public!.address as string);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ wrapped6492: true, deployed: false, core: "InvalidGiverSig", coreWithSetup: "accepted" });
  });

  test("deliver-send reaches deliver-listen on the Hand's inbox", async () => {
    const fixture = runs[1]!.run.fixtures.noReward!;
    const listener = spawn(BUN, ["tests/e2e/lib/craft.ts", "deliver-listen", "--n", String(fixture.n), "--wait", "8000", "--stand", standFile], { cwd: ROOT });
    let out = "";
    listener.stdout!.on("data", (chunk) => (out += chunk));
    const exited = new Promise<number>((done) => listener.on("exit", (code) => done(code ?? 1)));
    await Bun.sleep(1_500);
    const sent = JSON.parse((await craft("deliver-send", fixture.giveAddress as string)).stdout);
    expect(sent).toMatchObject({ ok: true, kind: "give", acks: 1, of: 1 });
    expect(await exited).toBe(0);
    const heard = JSON.parse(out);
    expect(heard.envelopes[0]).toMatchObject({ kind: "give", giveLink: fixture.giveAddress, replyTo: sent.replyTo });
  }, 20_000);
});

describe("the chain's clock only", () => {
  test("no Date.now in seed.ts, loop.ts or craft.ts", () => {
    for (const file of ["infra/stand/seed.ts", "infra/stand/loop.ts", "tests/e2e/lib/craft.ts"]) {
      expect(readFileSync(join(ROOT, file), "utf8")).not.toContain("Date.now");
    }
  });
});
