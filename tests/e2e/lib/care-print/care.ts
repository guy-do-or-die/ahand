/**
 * Helpers of the care and print smokes and of the clock test (tests/e2e/smoke/care.spec.ts,
 * tests/e2e/clock.spec.ts): open a page as a dev account, read Core's cap, run the craft tool,
 * read a downloaded calendar file, and keep screenshots in the experiment's shots folder.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { expect, type Browser, type BrowserContext, type Download, type Page } from "@playwright/test";
import type { Address } from "viem";

import { pickDevAccount } from "../accounts";
import { devicePut, handKey } from "../feat-my/store";
import type { Rpc } from "../rpc";
import { runProgram, standSlot } from "../stand";

export const DAY = 86_400;
export const MARGIN = 600;
export const USD = 1_000_000n;

/** The shots of this package, in the experiment's folder in the vault. */
const EXPERIMENT = "/home/guy_do_or_die/workspace/ahand/knowledge/plan/research/2026-11-20-experiment/shots";
/** CARE_PRINT_SHOTS=1 keeps them in the build's folder; CARE_PRINT_SHOTS=<sub/path> in that folder of the experiment's shots. */
export const SHOTS = join(EXPERIMENT, !process.env.CARE_PRINT_SHOTS || process.env.CARE_PRINT_SHOTS === "1" ? "build/care-print" : process.env.CARE_PRINT_SHOTS);

export async function shot(page: Page, name: string): Promise<void> {
  if (!process.env.CARE_PRINT_SHOTS || process.env.CARE_PRINT_SHOTS.includes("..")) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

/** A phone-sized context (390 × 844, touch), the language chosen before the first page. */
export async function phone(browser: Browser, lang: "en" | "ru" = "en"): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, acceptDownloads: true, locale: lang === "ru" ? "ru-RU" : "en-US" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  page.on("dialog", (dialog) => void dialog.accept());
  return { context, page };
}

/** Connects dev account `which` on the current page unless it is already the connected one. */
export async function connectAs(page: Page, which: number, address: Address): Promise<void> {
  const connected = page.getByTestId("wallet-connected");
  if ((await connected.count()) > 0 && (await connected.first().getAttribute("data-value"))?.toLowerCase() === address.toLowerCase()) return;
  await pickDevAccount(page, which);
  await expect(page.getByTestId("wallet-connected").first()).toHaveAttribute("data-value", new RegExp(address, "i"), { timeout: 15_000 });
}

/** Core's MAX_EXPIRY_PERIOD. */
export async function capOf(chain: Rpc, core: Address): Promise<number> {
  const value = await chain.client.readContract({
    address: core,
    abi: [{ type: "function", name: "MAX_EXPIRY_PERIOD", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }],
    functionName: "MAX_EXPIRY_PERIOD",
  });
  return Number(value);
}

/** The craft tool on this slot's stand, its JSON parsed. */
export function craft<T = Record<string, unknown>>(...args: string[]): T {
  const run = runProgram("tests/e2e/lib/craft.ts", [...args, ...standArgs()], { timeoutMs: 120_000 });
  return JSON.parse(run.stdout) as T;
}

export interface Made {
  handId: string;
  address: string;
  expiry: number;
  reward: string;
}

/** How a fixture tool is told which stand: the file in STAND_FILE, else the slot. */
export function standArgs(): string[] {
  return process.env.STAND_FILE ? ["--stand", resolve(process.env.STAND_FILE)] : ["--slot", String(standSlot())];
}

/** Raises a Hand as account 1 through the SDK (the craft tool), for a spec's own use. */
export function make(...flags: string[]): Made {
  return craft<Made>("make", ...flags);
}

/** Passes an address on `times` times with nothing kept; returns the last address. */
export function passTimes(address: string, times: number): string {
  let current = address;
  for (let i = 0; i < times; i++) current = craft<{ address: string }>("pass", current).address;
  return current;
}

/** One VEVENT of a calendar file, unfolded, with its alarm. */
export interface Ics {
  components: string[];
  event: Record<string, string>;
  alarm: Record<string, string>;
}

/** Reads an RFC 5545 file: CRLF lines, unfolded, the properties of the VEVENT and its VALARM. */
export function parseIcs(text: string): Ics {
  const lines = text.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);
  const components: string[] = [];
  const event: Record<string, string> = {};
  const alarm: Record<string, string> = {};
  const stack: string[] = [];
  for (const line of lines) {
    const colon = line.indexOf(":");
    const name = line.slice(0, colon);
    const value = line.slice(colon + 1);
    if (name === "BEGIN") {
      stack.push(value);
      components.push(value);
    } else if (name === "END") {
      expect(stack.pop()).toBe(value);
    } else if (stack.at(-1) === "VEVENT") event[name] = value;
    else if (stack.at(-1) === "VALARM") alarm[name] = value;
  }
  expect(stack).toEqual([]);
  return { components, event, alarm };
}

/** 20261220T140200Z → seconds. */
export function icsSeconds(value: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!m) throw new Error(`not a UTC date-time: ${value}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) / 1000;
}

export async function downloaded(download: Download): Promise<string> {
  const path = await download.path();
  return readFileSync(path, "utf8");
}

/** Opens `/print` and hands it an address through its paste box, as a person would. */
export async function printAddress(page: Page, address: string): Promise<void> {
  await page.goto("/print");
  await page.getByTestId("print-paste").fill(address);
  await page.getByTestId("print-open").click();
}

/** What feat-my's fixture tool prints: a Hand raised as a device raises it, and what that device keeps. */
export interface MyRaise {
  handId: string;
  chainId: number;
  core: string;
  raiser: string;
  book: string;
  n: number;
  mode: "unlisted" | "dark" | "public";
  title: string;
  content: string;
  salt?: string;
  address: string;
}

/** Raises a Hand as account 1 the way a device does (tests/e2e/lib/feat-my/raise.ts). */
export function myRaise(...flags: string[]): MyRaise {
  const run = runProgram("tests/e2e/lib/feat-my/raise.ts", [...flags, ...standArgs()], { timeoutMs: 120_000 });
  return JSON.parse(run.stdout) as MyRaise;
}

/** Writes the Hand into this browser's device store as the raise keeps it (an account whose confirmations repeat). */
export async function keepOnDevice(page: Page, r: MyRaise): Promise<void> {
  await devicePut(page, [
    { store: "books", value: { raiser: r.raiser.toLowerCase(), book: r.book, next: r.n + 1, repeats: true } },
    {
      store: "hands",
      value: {
        intent: `care-${r.handId}`,
        raiser: r.raiser.toLowerCase(),
        chainId: r.chainId,
        core: r.core,
        book: r.book,
        n: r.n,
        mode: r.mode,
        title: r.title,
        content: r.content,
        ...(r.salt ? { salt: r.salt } : {}),
        hand: handKey(r.chainId, r.core, r.handId),
        handId: r.handId,
        status: "up",
      },
    },
  ]);
}
