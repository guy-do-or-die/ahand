/**
 * The survival drill: switch the
 * stand's servers off one at a time and show that money still moves, asserting Core's state after
 * every step with plain RPC reads.
 *
 *   bun infra/stand/drill.ts --slot N [--reuse]
 *
 * Without --reuse it brings up a fresh built stand on the slot (it refuses a slot in use) and
 * brings it down at the end, whatever happened. With --reuse it drills a built stand that is
 * already up and, at the end, starts again what it switched off (the site as the view server or static.ts, as
 * it was, and the relay).
 *
 *   stage 1  site off, static.ts on: the same built files with no view server. A dark link still opens
 *            (its page fetched; the SDK opens the address), and tools/ahand.ts pass passes it on.
 *   stage 2  relay off: tools/ahand.ts thank-calldata on a give address, then
 *            contracts/exit/ahand.sh thank, closes the Hand as thanked.
 *   stage 3  site off too, so nothing serves the app: ahand.sh refund sends an expired Hand back
 *            after a jump of the chain's clock; ahand.sh withdraw delivers a pending amount once
 *            the payee is unblocked; ahand.sh status and pending agree with Core's views.
 *
 * Every switch is one of the stand's own commands (stand.ts stop / start, time.ts). Fixtures are
 * made with the seed's library (account 1 raises). The checks read Core and the tokens through
 * eth_call with ABIs written here, not through the SDK, so the SDK is not asked to confirm
 * itself. The first mismatch stops the drill with exit status 1.
 *
 * This is a rehearsal on a local chain, not the plan's M4 gate evidence. Keys: only
 * anvil's public test keys, on chain 31337.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPublicClient, getAddress, http, isAddressEqual, parseAbi, zeroAddress, zeroHash, type Address, type Hex, type PublicClient } from "viem";
import { foundry } from "viem/chains";
import { ANVIL_KEYS } from "@ahand/sdk/testing";

import { checkSlot, pathsOf, portsOf, REPO_ROOT, type SlotPorts } from "./ports.ts";
import { ROLE, World, seed, standFrom, withChainLock, type FixtureName } from "./seed.ts";

/* ------------------------------------------------------------------ output */

/** A drill step whose result differs from what Core or a token says. */
export class Mismatch extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Mismatch";
  }
}

export function expectThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Mismatch(message);
}

const say = (line: string) => console.log(line);
const step = (stage: number, text: string) => say(`  [${stage}] ok  ${text}`);

/* ------------------------------------------------------------- arguments */

export interface DrillArgs {
  slot: number;
  reuse: boolean;
}

export function parseDrillArgs(argv: string[], env: Record<string, string | undefined> = process.env): DrillArgs {
  let slot: number | undefined;
  let reuse = false;
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i]!;
    if (word === "--slot") {
      const text = argv[++i];
      if (text === undefined || !/^[0-9]$/.test(text)) throw new Error("--slot takes a slot from 0 to 9");
      slot = Number(text);
    } else if (word === "--reuse") reuse = true;
    else throw new Error(`unknown argument ${word}; usage: bun infra/stand/drill.ts --slot N [--reuse]`);
  }
  if (slot === undefined) {
    const text = env.STAND_SLOT;
    if (text === undefined || text === "") throw new Error("name the slot: bun infra/stand/drill.ts --slot N");
    slot = Number(text);
  }
  return { slot: checkSlot(slot), reuse };
}

/* --------------------------------------------------------------- programs */

const BUN = process.execPath;
const FOUNDRY_BIN = process.env.FOUNDRY_BIN || join(process.env.HOME ?? "", ".foundry/bin");

interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], env: Record<string, string> = {}): Ran {
  const done = spawnSync(command, args, { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, ...env }, timeout: 600_000, maxBuffer: 64 << 20 });
  return { code: done.status ?? 1, stdout: done.stdout ?? "", stderr: done.stderr ?? "" };
}

function must(what: string, ran: Ran): Ran {
  if (ran.code !== 0) throw new Error(`${what} exited ${ran.code}\n${(ran.stderr || ran.stdout).trim()}`);
  return ran;
}

/** One of the stand's own commands: `stand.ts <command> --slot N [...]`. */
function stand(slot: number, ...words: string[]): Ran {
  return must(`stand.ts ${words.join(" ")}`, run(BUN, ["infra/stand/stand.ts", words[0]!, "--slot", String(slot), ...words.slice(1)]));
}

/** contracts/exit/ahand.sh with RPC and CORE set, as a person without the site runs it. */
function exitScript(rpc: string, core: Address, args: string[]): Ran {
  return run("bash", ["contracts/exit/ahand.sh", ...args], { RPC: rpc, CORE: core, FOUNDRY_BIN });
}

/* ------------------------------------------------------------------ ports */

/** True when something accepts a TCP connection on 127.0.0.1:port. */
export function listening(port: number, timeoutMs = 1_500): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (open: boolean) => {
      socket.destroy();
      done(open);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

/* ------------------------------------------------------------ plain reads */

const CORE = parseAbi([
  "function hands(uint256) view returns (address raiser, uint40 expiry, uint40 openedAt, uint40 closedAt, address token, uint16 payoutGasK, uint16 minClaimBps, uint256 reward, address rootKey, bytes32 dataHash)",
  "function thanks(uint256) view returns (bytes32 giveHash, bytes32 dataHash)",
  "function pending(address token, address payee) view returns (uint256)",
]);
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

interface Row {
  raiser: Address;
  expiry: number;
  closedAt: number;
  token: Address;
  reward: bigint;
  dataHash: Hex;
}

class Reads {
  readonly client: PublicClient;
  constructor(
    readonly rpc: string,
    readonly core: Address,
  ) {
    this.client = createPublicClient({ chain: foundry, transport: http(rpc) }) as PublicClient;
  }
  async hand(id: bigint): Promise<Row> {
    const r = await this.client.readContract({ address: this.core, abi: CORE, functionName: "hands", args: [id] });
    return { raiser: r[0], expiry: Number(r[1]), closedAt: Number(r[3]), token: r[4], reward: r[7], dataHash: r[9] };
  }
  async giveHash(id: bigint): Promise<Hex> {
    return (await this.client.readContract({ address: this.core, abi: CORE, functionName: "thanks", args: [id] }))[0];
  }
  pending(token: Address, payee: Address): Promise<bigint> {
    return this.client.readContract({ address: this.core, abi: CORE, functionName: "pending", args: [token, payee] });
  }
  balance(token: Address, owner: Address): Promise<bigint> {
    return this.client.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [owner] });
  }
  async now(): Promise<number> {
    return Number((await this.client.getBlock({ blockTag: "latest" })).timestamp);
  }
}

/* --------------------------------------------------------------- the drill */

const USD = 1_000_000n;
const REFUND_AFTER = 3_600;

interface StandRecord {
  slot: number;
  mode: "built" | "dev";
  site: string;
  rpc: string;
  core: Address;
  server: "view" | "static" | null;
  ports: SlotPorts;
}

function readRecord(slot: number): StandRecord {
  return JSON.parse(readFileSync(pathsOf(slot).stand, "utf8")) as StandRecord;
}

async function slotBusy(slot: number, ports: SlotPorts): Promise<string[]> {
  const busy: string[] = [];
  for (const [service, port] of Object.entries(ports)) if (await listening(port)) busy.push(`${service} on ${port}`);
  return busy;
}

/** The part of an address a browser sends: everything before `#`. */
export function requestPart(address: string): string {
  const at = address.indexOf("#");
  return at < 0 ? address : address.slice(0, at);
}

/** The `--gas-limit N` of tools/ahand.ts thank-calldata's send line. */
export function gasLimitOf(output: string): bigint {
  const match = /^send .* --gas-limit ([0-9]+)\b/m.exec(output);
  if (!match) throw new Mismatch(`thank-calldata printed no send line with a gas limit:\n${output}`);
  return BigInt(match[1]!);
}

/** A field of `ahand.sh status`: the rest of the line after its label, trimmed. */
export function statusField(output: string, label: string): string | undefined {
  const match = new RegExp(`^  ${label} +(.+)$`, "m").exec(output);
  return match?.[1]!.trim();
}

async function drill(slot: number, ports: SlotPorts): Promise<void> {
  const facts = standFrom(["--slot", String(slot)]);
  const record = readRecord(slot);
  expectThat(record.mode === "built", `slot ${slot} runs in ${record.mode} mode: the drill needs the built files (bun infra/stand/stand.ts up --slot ${slot})`);
  const reads = new Reads(facts.rpc, facts.core);
  const world = new World(facts);
  const usd = world.token("usd").address;
  const dist = pathsOf(slot).dist;
  const indexHtml = readFileSync(join(dist, "index.html"), "utf8");

  // Fixtures, made while every server is still up (account 1 raises; one lock per chain).
  const made = await withChainLock(facts.rpc, async () => {
    const run = await seed(world, ["dark", "give", "blocked"] as FixtureName[]);
    const short = await world.raise({
      mode: "unlisted",
      title: "Who can water my plants while I'm away?",
      content: "Three days, a balcony in Saburtalo, the key at the neighbour's.",
      reward: 12n * USD,
      expirySeconds: REFUND_AFTER,
    });
    return { run, short };
  });
  const fx = made.run.fixtures as Record<string, Record<string, unknown>>;
  const dark = fx.dark! as { handId: bigint; address: string; reward: bigint };
  const give = fx.give! as { handId: bigint; giveAddress: string; giveHash: Hex; giver: Address; claimBps: number; reward: bigint };
  const blocked = fx.blocked! as { handId: bigint; pending: { token: Address; payee: Address; amount: bigint } };
  const short = made.short;
  say(`  fixtures: dark Hand ${dark.handId}, give Hand ${give.handId}, blocked Hand ${blocked.handId} (BlacklistToken), short Hand ${short.handId} (ends ${REFUND_AFTER} s after it was raised)`);

  /* ---------------------------------------------------------- stage 1 */
  say(`stage 1: site off, static.ts on (no view server)`);
  stand(slot, "stop", "site");
  expectThat(!(await listening(ports.site)), `the site port ${ports.site} still answers after stop site`);
  step(1, `stop site: port ${ports.site} refuses connections`);
  stand(slot, "start", "static");
  expectThat(readRecord(slot).server === "static", "stand.json does not name static.ts as the site's server after start static");
  step(1, `start static: static.ts serves ${dist} on port ${ports.site} (stand.json server: static)`);

  const darkBefore = await reads.hand(dark.handId);
  const coreUsdBefore = await reads.balance(usd, facts.core);
  const page = await fetch(requestPart(dark.address), { redirect: "manual" });
  const body = await page.text();
  expectThat(page.status === 200, `the dark link's page answered ${page.status}, not 200`);
  expectThat(body === indexHtml, "the dark link's page is not the built index.html");
  expectThat(page.headers.get("referrer-policy") === "no-referrer" && (page.headers.get("content-security-policy") ?? "").includes("default-src 'self'"), "static.ts answered without its CSP or Referrer-Policy");
  step(1, `dark link page: GET ${requestPart(dark.address)} -> 200, the same bytes as dist/index.html, CSP and no-referrer (the part after # is never sent)`);

  const opened = await world.open(dark.address);
  expectThat(opened.hand.handId === dark.handId && opened.linkKey !== undefined && opened.signedShakes.length === 0, `the SDK opened the dark link as Hand ${opened.hand.handId} with ${opened.signedShakes.length} passes`);
  step(1, `the SDK opens the dark address: Hand ${dark.handId}, a live link, 0 passes, Core's terms match the link`);

  const passed = must("tools/ahand.ts pass", run(BUN, ["tools/ahand.ts", "pass", dark.address, "--rpc", facts.rpc, "--core", facts.core]));
  const next = passed.stdout.trim();
  expectThat(next.split("\n").length === 1 && next.startsWith(`${facts.site ?? record.site}/`) && next !== dark.address, `tools/ahand.ts pass printed something else than one new address: ${next.slice(0, 80)}`);
  const reopened = await world.open(next);
  const last = reopened.signedShakes.at(-1)?.shake;
  expectThat(reopened.signedShakes.length === 1 && last && isAddressEqual(last.payee, zeroAddress) && last.nextClaimBps === last.claimBps, "the passed link does not read back as one pass at 0%");
  const nextPage = await fetch(requestPart(next));
  expectThat(nextPage.status === 200 && (await nextPage.text()) === indexHtml, "the passed link's page is not served");
  const darkAfter = await reads.hand(dark.handId);
  const coreUsdAfter = await reads.balance(usd, facts.core);
  expectThat(darkAfter.closedAt === 0 && darkAfter.reward === darkBefore.reward && darkAfter.dataHash === darkBefore.dataHash, `Hand ${dark.handId} changed on Core while it was only passed`);
  expectThat(coreUsdAfter === coreUsdBefore, "Core's balance changed while a link was only passed");
  step(1, `tools/ahand.ts pass: a new address with 1 pass at 0%, its page served; Core: Hand ${dark.handId} closedAt 0, reward ${darkAfter.reward} unchanged, Core holds ${coreUsdAfter} units as before (passing writes nothing)`);

  /* ---------------------------------------------------------- stage 2 */
  say(`stage 2: relay off`);
  stand(slot, "stop", "relay");
  expectThat(!(await listening(ports.relay)), `the relay port ${ports.relay} still answers after stop relay`);
  step(2, `stop relay: port ${ports.relay} refuses connections`);

  const scratch = mkdtempSync(join(tmpdir(), "ahand-drill-"));
  try {
    const file = join(scratch, "thank.hex");
    const prepared = must("tools/ahand.ts thank-calldata", run(BUN, ["tools/ahand.ts", "thank-calldata", give.giveAddress, "--rpc", facts.rpc, "--core", facts.core, "--out", file]));
    const gasLimit = gasLimitOf(prepared.stdout);
    expectThat(prepared.stdout.includes(`give hash ${give.giveHash}`), "thank-calldata's Core answer names another give hash");
    step(2, `tools/ahand.ts thank-calldata: Core's checkGive accepts the give address (give hash ${give.giveHash.slice(0, 10)}…), worst gas ${gasLimit}`);

    const holder = world.address(ROLE.holderA);
    const before = { holder: await reads.balance(usd, holder), giver: await reads.balance(usd, give.giver), core: await reads.balance(usd, facts.core) };
    const thanked = exitScript(facts.rpc, facts.core, ["thank", file, "--", "--gas-limit", String(gasLimit), "--private-key", ANVIL_KEYS[ROLE.raiser]!]);
    expectThat(thanked.code === 0, `ahand.sh thank exited ${thanked.code}: ${(thanked.stderr || thanked.stdout).trim()}`);
    const row = await reads.hand(give.handId);
    const after = { holder: await reads.balance(usd, holder), giver: await reads.balance(usd, give.giver), core: await reads.balance(usd, facts.core) };
    const holderShare = (give.reward * BigInt(10_000 - give.claimBps)) / 10_000n;
    expectThat(row.closedAt > 0, `Hand ${give.handId}: closedAt is 0 after ahand.sh thank`);
    expectThat((await reads.giveHash(give.handId)) === give.giveHash, `Hand ${give.handId}: thanks() keeps another give hash`);
    expectThat(after.holder - before.holder === holderShare, `the holder got ${after.holder - before.holder}, not ${holderShare}`);
    expectThat(after.giver - before.giver === give.reward - holderShare, `the giver got ${after.giver - before.giver}, not ${give.reward - holderShare}`);
    expectThat(before.core - after.core === give.reward, `Core paid out ${before.core - after.core}, not the reward ${give.reward}`);
    step(2, `ahand.sh thank (sent by the raiser with cast): Hand ${give.handId} closedAt ${row.closedAt}, thanks() = the give hash; holder +${holderShare}, giver +${give.reward - holderShare}, Core -${give.reward} units`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  /* ---------------------------------------------------------- stage 3 */
  say(`stage 3: site off too: nothing serves the app`);
  stand(slot, "stop", "site");
  const site = await listening(ports.site);
  const relay = await listening(ports.relay);
  expectThat(!site && !relay, `still listening: ${[site && `site ${ports.site}`, relay && `relay ${ports.relay}`].filter(Boolean).join(", ")}`);
  step(3, `connection attempts: site ${ports.site} and relay ${ports.relay} both refused; only the chain answers on ${ports.chain}`);

  // Refund: too early first, then after a jump of the chain's clock.
  const early = exitScript(facts.rpc, facts.core, ["refund", String(short.handId), "--", "--private-key", ANVIL_KEYS[ROLE.anyone]!]);
  expectThat(early.code !== 0 && /too early/.test(early.stderr), `ahand.sh refund did not refuse a running Hand: ${(early.stderr || early.stdout).trim()}`);
  expectThat((await reads.hand(short.handId)).closedAt === 0, `Hand ${short.handId} closed by a refused refund`);
  step(3, `ahand.sh refund before the end: refused ("too early"), Hand ${short.handId} still open`);

  const shortRow = await reads.hand(short.handId);
  const wait = shortRow.expiry - (await reads.now());
  if (wait >= 0) must("time.ts", run(BUN, ["infra/stand/time.ts", "--slot", String(slot), String(wait + 1)]));
  expectThat((await reads.now()) >= shortRow.expiry, "the chain's clock did not reach the Hand's end");
  const raiser = world.address(ROLE.raiser);
  const refundBefore = { raiser: await reads.balance(usd, raiser), core: await reads.balance(usd, facts.core) };
  const refunded = exitScript(facts.rpc, facts.core, ["refund", String(short.handId), "--", "--private-key", ANVIL_KEYS[ROLE.anyone]!]);
  expectThat(refunded.code === 0, `ahand.sh refund exited ${refunded.code}: ${(refunded.stderr || refunded.stdout).trim()}`);
  const refundedRow = await reads.hand(short.handId);
  const refundAfter = { raiser: await reads.balance(usd, raiser), core: await reads.balance(usd, facts.core) };
  expectThat(refundedRow.closedAt > 0 && (await reads.giveHash(short.handId)) === zeroHash, `Hand ${short.handId} is not closed as refunded`);
  expectThat(refundAfter.raiser - refundBefore.raiser === short.reward && refundBefore.core - refundAfter.core === short.reward, `the refund moved ${refundAfter.raiser - refundBefore.raiser} to the raiser, not ${short.reward}`);
  step(3, `time.ts +${wait + 1} s, then ahand.sh refund (sent by a stranger): Hand ${short.handId} closedAt ${refundedRow.closedAt}, no give hash; raiser +${short.reward}, Core -${short.reward} units`);

  // Withdraw: the payee is blocked by the token, its payout waits on Core.
  const { token, payee } = blocked.pending;
  const waiting = await reads.pending(token, payee);
  expectThat(waiting >= BigInt(blocked.pending.amount), `pending for ${payee} is ${waiting}, below the fixture's ${blocked.pending.amount}`);
  const shown = exitScript(facts.rpc, facts.core, ["pending", token, payee]);
  expectThat(shown.code === 0 && shown.stdout.includes(`(${waiting} units)`), `ahand.sh pending does not say ${waiting} units: ${shown.stdout.trim()}`);
  await withChainLock(facts.rpc, () => world.send(ROLE.anyone, world.blockCall(token, payee, false)));
  const withdrawBefore = { payee: await reads.balance(token, payee), core: await reads.balance(token, facts.core) };
  const withdrew = exitScript(facts.rpc, facts.core, ["withdraw", token, payee, "--", "--private-key", ANVIL_KEYS[ROLE.anyone]!]);
  expectThat(withdrew.code === 0, `ahand.sh withdraw exited ${withdrew.code}: ${(withdrew.stderr || withdrew.stdout).trim()}`);
  const withdrawAfter = { payee: await reads.balance(token, payee), core: await reads.balance(token, facts.core) };
  expectThat((await reads.pending(token, payee)) === 0n, `pending for ${payee} is not 0 after ahand.sh withdraw`);
  expectThat(withdrawAfter.payee - withdrawBefore.payee === waiting && withdrawBefore.core - withdrawAfter.core === waiting, `withdraw moved ${withdrawAfter.payee - withdrawBefore.payee}, not ${waiting}`);
  step(3, `the token unblocks ${payee}; ahand.sh withdraw (sent by a stranger): pending ${waiting} -> 0, payee +${waiting}, Core -${waiting} units`);

  // Status agrees with Core's views, for each kind of Hand the drill touched.
  for (const [id, want] of [
    [dark.handId, "open"],
    [give.handId, "thanked"],
    [short.handId, "refunded"],
    [blocked.handId, "thanked"],
  ] as const) {
    const status = exitScript(facts.rpc, facts.core, ["status", String(id)]);
    expectThat(status.code === 0, `ahand.sh status ${id} exited ${status.code}`);
    const row = await reads.hand(id);
    const coreState = row.closedAt === 0 ? "open" : (await reads.giveHash(id)) === zeroHash ? "refunded" : "thanked";
    expectThat(coreState === want, `Core says Hand ${id} is ${coreState}, the drill expected ${want}`);
    expectThat(statusField(status.stdout, "state")?.split(" ")[0] === want, `ahand.sh status ${id} says ${statusField(status.stdout, "state")}, Core says ${want}`);
    expectThat(getAddress(statusField(status.stdout, "raiser") ?? zeroAddress) === getAddress(row.raiser), `ahand.sh status ${id} names another raiser`);
    expectThat((statusField(status.stdout, "reward") ?? "").includes(`(${row.reward} units)`), `ahand.sh status ${id} shows another reward than ${row.reward}`);
    expectThat((statusField(status.stdout, "expiry") ?? "").includes(`(${row.expiry})`), `ahand.sh status ${id} shows another expiry than ${row.expiry}`);
    if (want === "thanked") expectThat(statusField(status.stdout, "give hash") === (await reads.giveHash(id)), `ahand.sh status ${id} shows another give hash`);
  }
  step(3, `ahand.sh status agrees with hands() and thanks() on Hands ${dark.handId} (open), ${give.handId} (thanked), ${short.handId} (refunded), ${blocked.handId} (thanked): state, raiser, reward, expiry, give hash`);
}

async function main(argv: string[]): Promise<number> {
  const { slot, reuse } = parseDrillArgs(argv);
  const paths = pathsOf(slot);
  // The stand's own ports, as its stand.json recorded them; computed only to check a free slot.
  let ports = (existsSync(paths.stand) ? readRecord(slot).ports : undefined) ?? portsOf(slot); // a stand.json from before the field: the computed ones
  let fresh = false;
  let restoreSite: "view" | "static" | null = null;

  if (reuse) {
    if (!existsSync(paths.stand)) throw new Error(`--reuse: no stand on slot ${slot}`);
    restoreSite = readRecord(slot).server;
    say(`drill on slot ${slot}: the running stand (built, served by ${restoreSite ?? "nothing"}); its services are started again at the end`);
  } else {
    const busy = await slotBusy(slot, ports);
    if (busy.length || existsSync(paths.stand)) {
      throw new Error(`slot ${slot} is in use (${busy.join(", ") || "stand.json exists"}): bun infra/stand/stand.ts down --slot ${slot}, or drill it as it is with --reuse`);
    }
    say(`drill on slot ${slot}: bringing up a fresh built stand`);
    fresh = true;
    stand(slot, "up");
    const record = readRecord(slot);
    ports = record.ports;
    say(`  stand up: chain ${record.rpc}, Core ${record.core}, site ${record.site} served by ${record.server}`);
  }

  let failed: unknown;
  try {
    await drill(slot, ports);
  } catch (error) {
    failed = error;
  }

  // Put the slot back, whatever happened.
  try {
    if (fresh) {
      stand(slot, "down");
      const left = await slotBusy(slot, ports);
      if (left.length) throw new Error(`after down, still listening: ${left.join(", ")}`);
      say(`stand down: slot ${slot} has nothing running`);
    } else {
      if (!(await listening(ports.relay))) stand(slot, "start", "relay");
      if (restoreSite) {
        if ((await listening(ports.site)) && readRecord(slot).server !== restoreSite) stand(slot, "stop", "site");
        if (!(await listening(ports.site))) stand(slot, "start", restoreSite);
      }
      say(`slot ${slot} restored: relay and site (${restoreSite ?? "none"}) running as before`);
    }
  } catch (error) {
    failed ??= error;
  }

  if (failed) {
    const label = failed instanceof Mismatch ? "MISMATCH" : "FAILED";
    console.error(`drill ${label}: ${failed instanceof Error ? failed.message : String(failed)}`);
    return 1;
  }
  say("drill passed: with the view server, the relay and then the whole site off, links opened and passed, and thank, refund and withdraw moved the money as Core says (a rehearsal on a local chain)");
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`drill: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(2);
    },
  );
}
