/**
 * The exit page's pure parts: Core's arithmetic for who gets what, the words for numbers, the
 * strings a block explorer's form and a terminal take, and the one line that serves this file.
 * No DOM, no network: everything here is tested in logic.test.ts.
 */
import { castLine, type Call, type Give, type HandState, type SignedShake } from "@ahand/sdk";
import { formatUnits, type Address } from "viem";

/** Core's BPS: the whole reward. */
const BPS = 10_000n;

export interface ShareRow {
  role: "pass" | "give";
  /** The Shake's place on the route; absent for the Give. */
  position?: number;
  payee: Address;
  bps: number;
  amount: bigint;
}

/**
 * What a thank pays, as Core computes it in `_payShakers` and `_payGiver`: each pass keeps
 * mulDiv(reward, claimBps − nextClaimBps, BPS), rounded down; the Give's payee gets the rest.
 */
export function shareOf(reward: bigint, signedShakes: readonly SignedShake[], give: Give): ShareRow[] {
  let rest = reward;
  const rows: ShareRow[] = signedShakes.map(({ shake }, position) => {
    const bps = shake.claimBps - shake.nextClaimBps;
    const amount = (reward * BigInt(bps)) / BPS;
    rest -= amount;
    return { role: "pass", position, payee: shake.payee, bps, amount };
  });
  rows.push({ role: "give", payee: give.payee, bps: give.claimBps, amount: rest });
  return rows;
}

export function bpsText(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

/** "15 mUSD"; "7 units" when the token did not say its decimals. */
export function unitsText(amount: bigint, decimals: number | undefined, symbol: string | undefined): string {
  if (decimals === undefined) return `${amount} units`;
  return `${formatUnits(amount, decimals)}${symbol ? ` ${symbol}` : ""}`;
}

/** Seconds as "3d 4h 5m", the way contracts/exit/ahand.sh writes them. */
export function span(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  return `${d ? `${d}d ` : ""}${d || h ? `${h}h ` : ""}${m}m`;
}

/** The words key of a Hand's state badge. */
export function stateBadge(state: HandState): `state.${HandState}` {
  return `state.${state}`;
}

/**
 * A value as a block explorer's "Write Contract" form takes it: numbers and booleans bare,
 * addresses and bytes in quotes, structs and arrays in brackets (contracts/exit/README.md).
 */
export function explorerValue(value: unknown): string {
  if (typeof value === "bigint" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return `"${value}"`;
  if (Array.isArray(value)) return `[${value.map(explorerValue).join(", ")}]`;
  throw new TypeError(`no explorer form for ${typeof value}`);
}

const SHELL_SAFE = /^[A-Za-z0-9_./:@%+=,-]+$/;

/** A word for a POSIX shell: as it is when safe, else in single quotes. */
export function shellWord(text: string): string {
  return SHELL_SAFE.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`;
}

/** The SDK's `cast send` line for this RPC; with `--gas-limit` when the worst gas is known (a thank). */
export function castSend(call: Call, rpc: string, gasLimit?: number): string {
  const line = castLine(call, { rpc });
  return gasLimit === undefined ? line : `${line} --gas-limit ${gasLimit}`;
}

/** A `cast call` line that reads a view: `cast call <to> '<sig>' <args> --rpc-url <rpc>`. */
export function castCall(to: Address, signature: string, args: readonly string[], rpc: string): string {
  return ["cast", "call", to, shellWord(signature), ...args.map(shellWord), "--rpc-url", shellWord(rpc)].join(" ");
}

/**
 * For a page opened from a file: the folder it is in, the one command that serves that folder on
 * this computer only, and the address to open then. Undefined for a page served over http(s).
 */
export function fileServe(href: string, port: number): { folder: string; command: string; open: string } | undefined {
  const url = new URL(href);
  if (url.protocol !== "file:") return undefined;
  let path = decodeURIComponent(url.pathname);
  if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1); // file:///C:/… on Windows
  const cut = path.lastIndexOf("/");
  const folder = cut > 0 ? path.slice(0, cut) : "/";
  const file = path.slice(cut + 1) || "exit.html";
  return {
    folder,
    command: `cd ${shellWord(folder)} && python3 -m http.server ${port} --bind 127.0.0.1`,
    open: `http://127.0.0.1:${port}/${encodeURIComponent(file)}`,
  };
}
