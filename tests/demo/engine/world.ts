/**
 * The world a scenario plays in: which target (the local stand, a fork, a branch site), its chain,
 * its Core and tokens, and what the personas carried between them (links, Hand numbers, fresh
 * addresses, the last transaction a step sent). Chain reads are plain eth_call through
 * tests/e2e/lib/rpc.ts; SDK work (opening an address as Core sees it, raising in another token)
 * goes through the craft tool in a child process, as the e2e suite does.
 *
 *   DEMO_TARGET=stand (default)  infra/stand/.run/<STAND_SLOT>/stand.json, as the e2e suite reads it
 *   DEMO_TARGET=fork             tests/demo/.run/fork/stand.json, written by tests/demo/fork.ts
 *   DEMO_TARGET=site             DEMO_SITE, a branch site on Base Sepolia (target.ts)
 */
import { join } from "node:path";

import { parseUnits, zeroHash, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { setBlocked } from "../../e2e/lib/feat-thank/fixtures";
import { balanceOf, chainNow, hands, jump, pending, rpc, thanks, type Rpc } from "../../e2e/lib/rpc";
import { REPO_ROOT, runProgram, standSlot, type StandInfo } from "../../e2e/lib/stand";
import type { Persona, Scenario, Token } from "./scenario";
import { standFileOf, targetOf, targetStand, type Target, type TargetStand } from "./target";
import { walletOf } from "./wallets";

export type { Target } from "./target";

/** What `craft open` says about an address: Core's own checkRoute and checkGive through the SDK. */
export interface Opened {
  ok: boolean;
  handId: string;
  state: string;
  route: { position: number; payee: Address | null; keptBps: number }[];
  give?: { signer: Address; payee: Address; claimBps: number; giveHash: Hex; core: string };
}

export const DOLLAR = 1_000_000n;
export const dollars = (text: string): bigint => parseUnits(text, 6);

export class World {
  readonly target: Target;
  readonly stand: TargetStand;
  /** The stand's slot; null on a fork or a site. */
  readonly slot: number | null;
  /** Where the craft tool and the seed find this target: `--slot N` or `--stand FILE`. */
  private readonly where: string[];
  readonly chain: Rpc;
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly core: Address;
  /** The target's tokens: the stand has both; Base Sepolia (fork, site) has its test USDC only. */
  readonly tokens: Partial<Record<Token, Address>>;
  /** Addresses a persona made or copied, by the name a step gave them. */
  readonly links = new Map<string, string>();
  /** Hand numbers by the name of the raise step that made them. */
  readonly handIds = new Map<string, bigint>();
  /** Who raised which Hand, by its name. */
  readonly raisers = new Map<string, string>();
  /** Fresh addresses by name, made on first use. */
  readonly fresh = new Map<string, Address>();
  /** Balances at the start of the scenario, per token and address, for the end checks. */
  private readonly start = new Map<string, bigint>();
  /** The block the scenario began at, for event reads. */
  startBlock = 0n;
  /** The last transaction a step sent and what it was. */
  lastTx?: { hash: Hex; what: string };
  /** Services a step stopped, restarted when the scenario ends. */
  readonly stopped = new Set<"relay" | "site">();
  /** Addresses a step blocked in the BlacklistToken, unblocked when the scenario ends. */
  readonly blocked = new Set<Address>();

  constructor(
    readonly scenario: Scenario,
    target: Target = targetOf(),
  ) {
    this.target = target;
    this.stand = targetStand(target);
    this.slot = target === "stand" ? standSlot() : null;
    this.where = target === "stand" && !process.env.STAND_FILE ? ["--slot", String(this.slot)] : ["--stand", standFileOf(target)];
    this.rpcUrl = this.stand.rpc;
    this.chainId = this.stand.chainId;
    this.chain = rpc(this.stand.rpc);
    this.core = this.stand.core;
    this.tokens = Object.fromEntries(this.stand.tokens.map((t) => [t.kind, t.address])) as Partial<Record<Token, Address>>;
  }

  token(token: Token): Address {
    const address = this.tokens[token];
    if (!address) throw new Error(`the ${this.target} has no ${token} token: this scenario belongs on the stand`);
    return address;
  }

  link(name: string): string {
    const found = this.links.get(name);
    if (!found) throw new Error(`no link named "${name}" yet: a step before must make it (as: "${name}")`);
    return found;
  }

  handId(name: string): bigint {
    const found = this.handIds.get(name.replace(/^#/, ""));
    if (found === undefined) throw new Error(`no Hand named "${name}" was raised`);
    return found;
  }

  persona(key: string): Persona {
    const found = this.scenario.personas[key];
    if (!found) throw new Error(`no persona "${key}"`);
    return found;
  }

  /** Addresses known to start at zero (made fresh here, or a new smart account). */
  private readonly zero = new Set<string>();

  /** A fresh address under a name: nobody has used it, so what lands there is exact. */
  freshAddress(name: string): Address {
    let address = this.fresh.get(name);
    if (!address) {
      address = privateKeyToAccount(generatePrivateKey()).address;
      this.fresh.set(name, address);
      this.zero.add(address.toLowerCase());
    }
    return address;
  }

  /** Names an address a fixture made; its balances are noted now (or known to be zero). */
  async name(name: string, address: Address, startsAtZero = false): Promise<void> {
    this.fresh.set(name, address);
    if (startsAtZero) this.zero.add(address.toLowerCase());
    else for (const token of Object.keys(this.tokens) as Token[]) await this.remember(token, address);
  }

  /**
   * `@name` or `name`: a fresh address made under that name; else that persona's wallet; else a
   * new fresh address for that persona.
   */
  addr(ref: string): Address {
    const name = ref.replace(/^@/, "");
    const fresh = this.fresh.get(name);
    if (fresh) return fresh;
    const persona = this.scenario.personas[name];
    if (!persona) throw new Error(`"${ref}" is neither a fresh address nor a persona`);
    return walletOf(persona.wallet).address(persona.wallet as never) ?? this.freshAddress(name);
  }

  /** Resolves `@name` and `#name` inside a value the scenario wrote. */
  resolve(value: string): string {
    if (value.startsWith("@")) return this.addr(value);
    if (value.startsWith("#")) return String(this.handId(value));
    if (value === "$core") return this.core;
    return value;
  }

  balance(token: Token, address: Address): Promise<bigint> {
    return balanceOf(this.chain, this.token(token), address);
  }

  pending(token: Token, address: Address): Promise<bigint> {
    return pending(this.chain, this.core, this.token(token), address);
  }

  /** Notes every persona wallet's balance in every token: called before the first step. */
  async rememberPersonas(): Promise<void> {
    for (const persona of Object.values(this.scenario.personas)) {
      const address = walletOf(persona.wallet).address(persona.wallet as never);
      if (address) for (const token of Object.keys(this.tokens) as Token[]) await this.remember(token, address);
    }
  }

  /** Notes an address's balance once, before anything in the scenario can change it. */
  async remember(token: Token, address: Address): Promise<void> {
    const key = `${token}:${address.toLowerCase()}`;
    if (!this.start.has(key)) this.start.set(key, this.isFresh(address) ? 0n : await this.balance(token, address));
  }

  private isFresh(address: Address): boolean {
    return this.zero.has(address.toLowerCase());
  }

  /** What an address gained in a token since it was first noted (fresh addresses start at zero). */
  async received(token: Token, address: Address): Promise<bigint> {
    const key = `${token}:${address.toLowerCase()}`;
    const now = await this.balance(token, address);
    const start = this.start.get(key) ?? (this.isFresh(address) ? 0n : undefined);
    if (start === undefined) throw new Error(`no starting balance of ${address} in ${token} was noted: a check would compare it with itself`);
    return now - start;
  }

  async stateOf(name: string): Promise<"open" | "thanked" | "refunded" | "expired"> {
    const id = this.handId(name);
    const row = await hands(this.chain, this.core, id);
    if (row.closedAt > 0) return (await thanks(this.chain, this.core, id)).giveHash !== zeroHash ? "thanked" : "refunded";
    return (await chainNow(this.chain)).timestamp >= row.expiry ? "expired" : "open";
  }

  async moveClock(days: number): Promise<void> {
    if (this.target === "site") throw new Error("a public network's clock cannot be moved");
    await jump(this.chain, Math.round(days * 86_400));
  }

  /** The craft tool on this stand (SDK work in a child process), its JSON parsed. */
  craft<T>(...args: string[]): T {
    return JSON.parse(runProgram("tests/e2e/lib/craft.ts", [...args, ...this.where], { timeoutMs: 120_000 }).stdout) as T;
  }

  /** One fixture of the stand's seed, its JSON. */
  seed<T>(fixture: string): T {
    const run = JSON.parse(runProgram("infra/stand/seed.ts", ["--json", ...this.where, "--only", fixture], { timeoutMs: 300_000 }).stdout) as { fixtures: Record<string, T> };
    return run.fixtures[fixture]!;
  }

  /** The built exit page of this stand, as a file. */
  exitFile(): string {
    return this.slot === null ? join(REPO_ROOT, "tests/demo/.run", this.target, "dist/exit.html") : join(REPO_ROOT, "infra/stand/.run", String(this.slot), "dist/exit.html");
  }

  /** An address a step carried, opened as Core sees it. */
  opened(link: string): Opened {
    return this.craft<Opened>("open", this.link(link));
  }

  /** Stops or starts one of the stand's services with its own commands (the site starts again as view, else static). */
  service(service: "relay" | "site", on: boolean): void {
    if (this.slot === null) throw new Error("only the stand's services can be switched off by a scenario");
    const slot = ["--slot", String(this.slot)];
    if (!on) runProgram("infra/stand/stand.ts", ["stop", ...slot, service]);
    else if (service === "relay") runProgram("infra/stand/stand.ts", ["start", ...slot, "relay"]);
    else if (runProgram("infra/stand/stand.ts", ["start", ...slot, "view"], { allowFailure: true }).code !== 0) runProgram("infra/stand/stand.ts", ["start", ...slot, "static"]);
    if (on) this.stopped.delete(service);
    else this.stopped.add(service);
  }

  /** Blocks or unblocks an address in the BlacklistToken (anvil's account 0 sends; the token lets anyone). */
  async block(address: Address, blocked: boolean): Promise<void> {
    await setBlocked(this.chain, this.token("blacklist"), address, blocked);
    if (blocked) this.blocked.add(address);
    else this.blocked.delete(address);
  }

  /** Starts again whatever a step stopped and unblocks what it blocked; called whatever happened. */
  /**
   * Gives back what fault steps took: stopped services start, blocked addresses are unblocked.
   * Each is tried whatever the one before did; the errors come back together.
   */
  async restore(): Promise<Error[]> {
    const errors: Error[] = [];
    for (const service of [...this.stopped]) {
      try {
        this.service(service, true);
      } catch (error) {
        errors.push(new Error(`starting the ${service} again: ${(error as Error).message}`));
      }
    }
    for (const address of [...this.blocked]) await this.block(address, false).catch((error: Error) => errors.push(new Error(`unblocking ${address}: ${error.message}`)));
    return errors;
  }
}
