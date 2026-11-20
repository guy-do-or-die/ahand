/**
 * Screenshots of /my and /my/<chain>/<hand> for the build note: phone (390 px) in English and
 * Russian, and one desk view, with a real Hand, a real answer and a refused one on the stand.
 *
 *   bun tests/e2e/lib/feat-my/shots.ts --slot 5 --site http://127.0.0.1:17200 --out <folder>
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium, type Page } from "@playwright/test";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const at = argv.indexOf(name);
  if (at < 0 || argv[at + 1] === undefined) throw new Error(`${name} is required`);
  return argv[at + 1]!;
};
const slot = flag("--slot");
const site = flag("--site");
const out = flag("--out");
mkdirSync(out, { recursive: true });

function run<T>(script: string, args: string[]): T {
  const result = spawnSync(process.execPath, [script, ...args, "--slot", slot], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${script} ${args.join(" ")}: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout) as T;
}

const raised = run<Record<string, string | number>>("tests/e2e/lib/feat-my/raise.ts", ["--days", "5"]);
const give = run<{ address: string }>("tests/e2e/lib/craft.ts", ["give", String(raised.address), "--giver", "4"]);
run("tests/e2e/lib/craft.ts", ["deliver-send", give.address, "--text", "Café Lumen, two minutes from the station: sockets everywhere, opens at eight."]);
const broken = run<{ address: string }>("tests/e2e/lib/craft.ts", ["tamper", give.address, "--how", "giver-sig"]);
run("tests/e2e/lib/craft.ts", ["deliver-send", broken.address, "--text", "Try the library café."]);

async function keep(page: Page): Promise<void> {
  await page.evaluate(async (r) => {
    const path = "/src/store/db.ts";
    const db = await import(/* @vite-ignore */ path);
    await db.put("books", { raiser: String(r.raiser).toLowerCase(), book: r.book, next: 1, repeats: true });
    await db.put("hands", {
      intent: `shots-${r.handId}`,
      raiser: String(r.raiser).toLowerCase(),
      chainId: r.chainId,
      core: r.core,
      book: r.book,
      n: r.n,
      mode: r.mode,
      title: r.title,
      content: r.content,
      salt: r.salt,
      hand: db.handKey(r.chainId, r.core, r.handId),
      handId: String(r.handId),
      status: "up",
    });
  }, raised);
}

async function connect(page: Page): Promise<void> {
  const entry = page.getByTestId("dev-account-1");
  if (!(await entry.isVisible())) await page.getByTestId("connect-wallet").first().click();
  await entry.click();
}

const browser = await chromium.launch();
for (const [name, viewport, lang] of [
  ["phone-en", { width: 390, height: 844 }, "en"],
  ["phone-ru", { width: 390, height: 844 }, "ru"],
  ["desk-en", { width: 1280, height: 800 }, "en"],
] as const) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`${site}/my`);
  await page.getByTestId(`shell-lang-${lang}`).click();
  await page.screenshot({ path: join(out, `${name}-empty.png`), fullPage: true });
  await keep(page);
  await page.reload();
  await connect(page);
  await page.getByTestId("my-unlock").click();
  await page.getByTestId("my-unlock").and(page.locator('[data-value="unlocked"]')).waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, `${name}-list.png`), fullPage: true });
  await page.goto(`${site}/my/${raised.chainId}/${raised.handId}`);
  await connect(page);
  await page.getByTestId("my-unlock").click();
  await page.getByTestId("my-answer").first().waitFor({ timeout: 20_000 });
  await page.getByTestId("my-answer-refused").first().waitFor();
  await page.getByTestId("my-show-link").click();
  await page.getByTestId("my-link-row").waitFor();
  await page.screenshot({ path: join(out, `${name}-hand.png`), fullPage: true });
  await page.goto(`${site}/my`);
  await connect(page);
  await page.getByTestId("shell-lens").click();
  await page.getByTestId("my-rebuild-input").fill(String(raised.book));
  await page.getByTestId("my-rebuild-hand").fill(String(raised.handId));
  await page.getByTestId("my-rebuild-submit").click();
  await page.locator('[data-testid="my-rebuild-result"], [data-testid="my-rebuild-error"]').first().waitFor({ timeout: 30_000 });
  await page.screenshot({ path: join(out, `${name}-lens.png`), fullPage: true });
  await context.close();
}
await browser.close();
console.log(`screenshots in ${out}`);
