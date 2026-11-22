/**
 * Review round 1, feat-hand: the four findings looked at live, for a person (a tool, not a test).
 *
 *   bun tests/e2e/lib/feat-hand/round1.ts --stand <stand.json of a helper chain> --out <folder>
 *
 * It needs a chain it may stop and start again: the helper chain of
 * `packages/sdk/tests/helpers/anvil.ts --serve --write-stand FILE` (its file names anvil's pid),
 * with the app served at the file's `site`. A slot's stand is refused: `stand.ts` can stop a
 * chain and cannot start it again with its Hands.
 *
 * 1. The network fails as a link opens. The chain's state is saved (`anvil_dumpState`), anvil is
 *    killed, a dark link is opened in a fresh browser: the band, in English and Russian. anvil is
 *    started again on the same port from the saved state (`--load-state`): the Hand appears in
 *    the same document, with no reload. The same on /pass.
 * 2. The first screen of an open Hand at 390×844 with a three-line title, both languages, both
 *    themes; the foot of the page; 1280 px.
 * 3. A link under another Hand's address, under another number, and under another chain.
 * 4. The share sentence on /pass, as it is and with the tabular figures it had (the class is put
 *    back on the element in the page, for the picture only).
 *
 * Every step prints what it saw; a step that does not see what it should throws.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { flagValue } from "../../../../infra/stand/seed.ts";
import { runProgram } from "../stand";
import { quietDevServer, type SeedRun } from "./helpers";

const argv = process.argv.slice(2);
const standFile = resolve(flagValue(argv, "--stand") ?? process.env.STAND_FILE ?? "");
const out = resolve(flagValue(argv, "--out") ?? "shots");
mkdirSync(out, { recursive: true });
process.env.STAND_FILE = standFile;

interface HelperStand {
  mode: string;
  site: string | null;
  rpc: string;
  chainId: number;
  pid?: number;
}
const stand = JSON.parse(readFileSync(standFile, "utf8")) as HelperStand;
if (!stand.site) throw new Error(`${standFile} names no site`);
if (typeof stand.pid !== "number") throw new Error(`${standFile} names no anvil pid: this tool stops and starts the chain, so it needs a helper chain's file`);
const site = stand.site;
const port = Number(new URL(stand.rpc).port);

function craft<T>(args: string[]): T {
  return JSON.parse(runProgram("tests/e2e/lib/craft.ts", [...args, "--stand", standFile]).stdout) as T;
}

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(stand.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = (await response.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

async function until(what: string, ms: number, done: () => Promise<boolean> | boolean): Promise<void> {
  for (let waited = 0; waited < ms; waited += 100) {
    if (await done()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${what}: not within ${ms} ms`);
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const answers = () => rpc<string>("eth_chainId").then(() => true, () => false);

type Lang = "en" | "ru";
const browser: Browser = await chromium.launch();

async function open(width: number, lang: Lang, scheme: "light" | "dark" = "light"): Promise<{ context: BrowserContext; page: Page }> {
  const phone = width < 768;
  const context = await browser.newContext({
    viewport: { width, height: phone ? 844 : 800 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
    locale: lang === "ru" ? "ru-RU" : "en-US",
    ...(phone ? { hasTouch: true, isMobile: true } : {}),
  });
  await quietDevServer(context, site);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log(`  page error: ${error.message}`));
  return { context, page };
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`  ${name}.png`);
}

const text = async (page: Page, testid: string) => ((await page.getByTestId(testid).innerText()) ?? "").replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------ fixtures */

const run = JSON.parse(runProgram("infra/stand/seed.ts", ["--json", "--stand", standFile, "--only", "unlisted,dark,twoPasses"]).stdout) as SeedRun;
const fixture = (name: string) => run.fixtures[name]!;
const threeLines: Record<Lang, { address: string; title: string }> = {
  en: craft(["make", "--title", "Who can lend me a tent for one weekend?", "--content", "For two people, back on Monday.", "--reward", "40"]),
  ru: craft(["make", "--title", "Кто одолжит палатку на одни выходные?", "--content", "На двоих, верну в понедельник.", "--reward", "40"]),
};

/* ------------------------------------------------------------ 2. the first screen on a phone */

console.log("2. both actions on the first screen of a phone");
for (const lang of ["en", "ru"] as const) {
  for (const scheme of ["light", "dark"] as const) {
    const { context, page } = await open(390, lang, scheme);
    await page.goto(threeLines[lang].address);
    await page.getByTestId("hand-deal-card").waitFor();
    for (const id of ["hand-pass", "hand-help"]) {
      const box = (await page.getByTestId(id).boundingBox())!;
      if (box.y < 0 || box.y + box.height > 844) throw new Error(`${lang} ${id}: ${box.y}–${box.y + box.height} is outside the 844 px screen`);
      console.log(`  ${lang} ${scheme} ${id}: y ${Math.round(box.y)}–${Math.round(box.y + box.height)} of 844, ${Math.round(box.width)}×${Math.round(box.height)}`);
    }
    await shot(page, `2-after-phone-first-screen-${lang}-${scheme}-390`);
    if (scheme === "light") {
      await page.evaluate(() => window.scrollTo(0, 420));
      await shot(page, `2-after-phone-scrolled-${lang}-390`);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await shot(page, `2-after-phone-foot-${lang}-390`);
    }
    await context.close();
  }
}
{
  const { context, page } = await open(1280, "en");
  await page.goto(threeLines.en.address);
  await page.getByTestId("hand-deal-card").waitFor();
  if ((await page.getByTestId("hand-action-bar").count()) !== 0) throw new Error("the bar shows at 1280 px");
  await shot(page, "2-after-desk-en-1280");
  await context.close();
}

/* ------------------------------------------------------------ 3. an address that is not its link's */

console.log("3. a link under an address that is not its own");
{
  const [before, link] = fixture("unlisted").address.split("#") as [string, string];
  const other = fixture("twoPasses");
  const numbered = before.slice(0, before.indexOf("?d="));
  const cases: [string, Lang, string, string][] = [
    ["another-hand", "en", `${other.address.split("#")[0]}#${link}`, "link.another-hand"],
    ["another-number", "ru", `${numbered.slice(0, numbered.lastIndexOf("/"))}/${other.handId}#${link}`, "link.another-hand"],
    ["another-chain", "en", `${before.replace(`/${run.chainId}/`, "/8453/")}#${link}`, "link.untrusted"],
    ["another-chain", "ru", `${before.replace(`/${run.chainId}/`, "/8453/")}#${link}`, "link.untrusted"],
  ];
  for (const [name, lang, address, id] of cases) {
    const { context, page } = await open(390, lang);
    await page.goto(address);
    const error = page.getByTestId("hand-error");
    await error.waitFor();
    const got = await error.getAttribute("data-value");
    if (got !== id) throw new Error(`${name}: ${got}, not ${id}`);
    console.log(`  ${name} ${lang}: ${got} | ${await text(page, "hand-error")}`);
    await shot(page, `3-after-${name}-${lang}-390`);
    await context.close();
  }
}

/* ------------------------------------------------------------ 4. the share sentence */

console.log("4. the share sentence on /pass");
for (const lang of ["en", "ru"] as const) {
  const { context, page } = await open(390, lang);
  await page.goto(fixture("dark").address);
  await page.getByTestId("hand-pass").click();
  await page.getByTestId("pass-slider").fill("500");
  const sentence = page.getByTestId("pass-share-money");
  console.log(`  ${lang}: "${await text(page, "pass-share-money")}" · font-variant-numeric ${await sentence.evaluate((el) => getComputedStyle(el).fontVariantNumeric)}`);
  await sentence.screenshot({ path: join(out, `4-after-share-sentence-${lang}.png`) });
  await page.getByTestId("pass-slider").fill("0");
  await sentence.screenshot({ path: join(out, `4-after-share-sentence-zero-${lang}.png`) });
  // What the reviewers saw: the same element with the tabular figures it had.
  await page.getByTestId("pass-slider").fill("500");
  await sentence.evaluate((el) => el.classList.add("tabular-nums"));
  await sentence.screenshot({ path: join(out, `4-before-share-sentence-${lang}.png`) });
  await sentence.evaluate((el) => el.classList.remove("tabular-nums"));
  await shot(page, `4-after-pass-${lang}-390`);
  await context.close();
}

/* ------------------------------------------------------------ 1. the chain stops and comes back */

console.log("1. the chain stops as a link opens, and comes back");
{
  const dark = fixture("dark");
  // A second person already has the Hand open when the chain stops.
  const held = await open(390, "en");
  await held.page.goto(fixture("unlisted").address);
  await held.page.getByTestId("hand-deal-card").waitFor();

  // anvil hands its state over as gzipped JSON in hex; `--load-state` reads the JSON itself.
  const state = await rpc<string>("anvil_dumpState");
  const latest = await rpc<{ number: string; timestamp: string }>("eth_getBlockByNumber", ["latest", false]);
  const stateDir = mkdtempSync(join(tmpdir(), "ahand-round1-"));
  const stateFile = join(stateDir, "state.json");
  writeFileSync(stateFile, gunzipSync(Buffer.from(state.slice(2), "hex")));
  console.log(`  state saved at block ${Number(latest.number)}, chain time ${Number(latest.timestamp)}`);
  process.kill(stand.pid, "SIGKILL");
  await until("anvil stops", 5_000, () => !alive(stand.pid!));
  await until("the RPC stops answering", 5_000, async () => !(await answers()));
  console.log(`  anvil ${stand.pid} killed; ${stand.rpc} refuses connections`);

  const views: { lang: Lang; width: number; context: BrowserContext; page: Page }[] = [];
  for (const [lang, width] of [["en", 390], ["ru", 390], ["en", 1280]] as const) {
    const { context, page } = await open(width, lang);
    await page.goto(dark.address);
    const band = page.getByTestId("hand-unreachable");
    await band.waitFor({ timeout: 20_000 });
    const words = await text(page, "hand-unreachable");
    if (/ContractFunction|HttpRequest/.test(words)) throw new Error(`a library's class name is on screen: ${words}`);
    if (page.url().includes("#")) throw new Error("the fragment is still in the address bar");
    console.log(`  ${lang} ${width}: ${words}`);
    await page.evaluate(() => {
      (window as unknown as { stillHere?: boolean }).stillHere = true;
    });
    await shot(page, `1-after-chain-stopped-${lang}-${width}`);
    views.push({ lang, width, context, page });
  }
  // The person who already had the Hand open goes to pass it on: /pass opens the link again.
  await held.page.getByTestId("hand-pass").click();
  await held.page.getByTestId("hand-unreachable").waitFor({ timeout: 20_000 });
  console.log(`  /pass: ${await text(held.page, "hand-unreachable")}`);
  await held.page.evaluate(() => {
    (window as unknown as { stillHere?: boolean }).stillHere = true;
  });
  await shot(held.page, "1-after-pass-chain-stopped-en-390");
  // Left alone for three retry intervals: the band stays, nothing else appears.
  await views[0]!.page.waitForTimeout(13_000);
  if (!(await views[0]!.page.getByTestId("hand-unreachable").isVisible())) throw new Error("the band went away while the chain was down");

  // The chain comes back on the same port with the state it had.
  const anvil = spawn(join(process.env.FOUNDRY_BIN ?? join(homedir(), ".foundry/bin"), "anvil"), [
    "--port", String(port), "--host", "127.0.0.1", "--chain-id", String(stand.chainId),
    "--load-state", stateFile, "--block-time", "1", "--slots-in-an-epoch", "1",
  ], { detached: true, stdio: "ignore" });
  anvil.unref();
  await until("anvil answers again", 15_000, answers);
  rmSync(stateDir, { recursive: true, force: true });
  const back = await rpc<{ number: string; timestamp: string }>("eth_getBlockByNumber", ["latest", false]);
  if (Number(back.number) < Number(latest.number) || Number(back.timestamp) < Number(latest.timestamp)) {
    throw new Error(`the chain came back behind itself: block ${Number(back.number)} at ${Number(back.timestamp)}, was ${Number(latest.number)} at ${Number(latest.timestamp)}`);
  }
  console.log(`  the chain is back at block ${Number(back.number)}, chain time ${Number(back.timestamp)}`);
  writeFileSync(standFile, `${JSON.stringify({ ...JSON.parse(readFileSync(standFile, "utf8")), pid: anvil.pid }, null, 2)}\n`);
  console.log(`  anvil started again as pid ${anvil.pid} with the saved state; ${standFile} now names it`);

  for (const { lang, width, context, page } of views) {
    const card = page.getByTestId("hand-deal-card");
    await card.waitFor({ timeout: 30_000 });
    await page.getByText(dark.title).first().waitFor({ timeout: 10_000 });
    if (!(await page.evaluate(() => (window as unknown as { stillHere?: boolean }).stillHere))) throw new Error("the page was reloaded");
    console.log(`  ${lang} ${width}: the Hand is here, state ${await card.getAttribute("data-state")}, same document, address bar ${page.url()}`);
    await shot(page, `1-after-chain-back-${lang}-${width}`);
    await context.close();
  }
  await held.page.getByTestId("pass-slider").waitFor({ timeout: 30_000 });
  if (!(await held.page.evaluate(() => (window as unknown as { stillHere?: boolean }).stillHere))) throw new Error("the pass page was reloaded");
  await held.page.getByTestId("pass-swipe").click();
  await held.page.getByTestId("pass-read-back").waitFor();
  console.log(`  /pass: the slider came without a reload, and the link passes: ${await text(held.page, "pass-read-back")}`);
  await shot(held.page, "1-after-pass-chain-back-en-390");
  await held.context.close();
}

await browser.close();
console.log("done");
