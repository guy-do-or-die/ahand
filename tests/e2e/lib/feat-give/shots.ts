/**
 * Screenshots of /give for the build's own review (not a test): both languages, phone width 390 px
 * and desk width 1280 px, light and dark, the form, the twelve words, the done screen with a
 * delivered answer and a reply, the set-up sentence and the fallback.
 *
 *   bun tests/e2e/lib/feat-give/shots.ts --slot 3 --out DIR [--no-relay-shot]
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium, type Browser, type Page } from "@playwright/test";

import { readStand, REPO_ROOT, runProgram } from "../stand";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const at = argv.indexOf(name);
  return at < 0 ? undefined : argv[at + 1];
};
const slot = Number(flag("--slot") ?? "3");
const out = flag("--out")!;
mkdirSync(out, { recursive: true });
const stand = readStand(slot);
const seeded = JSON.parse(runProgram("infra/stand/seed.ts", ["--slot", String(slot), "--json", "--only", "unlisted,dark,public,twoPasses,noReward"]).stdout) as {
  fixtures: Record<string, { address: string; n: number }>;
};
const fx = seeded.fixtures;

async function openGive(page: Page, address: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(address, { waitUntil: "networkidle" });
      await page.getByTestId("shell-main").waitFor();
      await page.waitForFunction(() => window.location.hash === "");
      await page.evaluate(() => {
        window.history.pushState(null, "", "/give");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      await page.getByTestId("give-words").waitFor({ timeout: 20_000 });
      await page.locator(".ah-deal").waitFor();
      return;
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }
}

async function lang(page: Page, which: "en" | "ru"): Promise<void> {
  const button = page.getByTestId(which === "ru" ? "shell-lang-ru" : "shell-lang-en");
  if (await button.isVisible()) await button.click();
  await page.waitForFunction((l) => document.documentElement.lang === l, which);
}

async function shot(page: Page, name: string, full = true): Promise<void> {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: full });
  console.log(join(out, `${name}.png`));
}

async function page(browser: Browser, width: number, scheme: "light" | "dark" = "light"): Promise<Page> {
  const context = await browser.newContext({ baseURL: stand.site!, viewport: { width, height: width < 768 ? 844 : 900 }, deviceScaleFactor: width < 768 ? 2 : 1, colorScheme: scheme, isMobile: width < 768, hasTouch: width < 768 });
  return context.newPage();
}

const browser = await chromium.launch();
try {
  // 1. The form, English, phone: words, a pasted address, the card.
  for (const which of ["en", "ru"] as const) {
    const p = await page(browser, 390);
    await openGive(p, fx.unlisted!.address);
    await lang(p, which);
    await p.getByTestId("give-words").fill(which === "en" ? "I know a quiet room in Vake; I can send you the owner's number tonight." : "Знаю тихую комнату в Ваке, могу сегодня прислать номер хозяйки.");
    await p.getByRole("radio").nth(0).check();
    await p.locator("textarea.ah-input--exact").fill("0x14dC79964da2C08b23698B3D3cc7Ca32193d9955");
    await shot(p, `give-form-${which}-390`);
    // 2. The done screen, delivered, with a reply from the asker.
    await p.getByTestId("give-swipe").click();
    await p.getByTestId("give-delivered").waitFor({ timeout: 20_000 });
    const listen = JSON.parse(runProgram("tests/e2e/lib/craft.ts", ["deliver-listen", "--n", String(fx.unlisted!.n), "--slot", String(slot), "--count", "9", "--wait", "4000"], { allowFailure: true }).stdout) as { envelopes: { kind: string; replyTo: string; at: number }[] };
    const last = listen.envelopes.filter((e) => e.kind === "give").sort((a, b) => a.at - b.at).at(-1)!;
    runProgram("tests/e2e/lib/feat-give/asker.ts", ["reply", "--n", String(fx.unlisted!.n), "--to", last.replyTo, "--hand", fx.unlisted!.address, "--text", which === "en" ? "Thank you! Please send the number here." : "Спасибо! Пришли номер сюда.", "--slot", String(slot)]);
    await p.getByTestId("give-thread").locator('[data-from="asker"]').waitFor({ timeout: 15_000 });
    await shot(p, `give-done-${which}-390`);
    await p.context().close();
  }

  // 3. I have none, Russian, phone, dark.
  {
    const p = await page(browser, 390, "dark");
    await openGive(p, fx.noReward!.address);
    await lang(p, "ru");
    await p.getByRole("radio").nth(1).check();
    await p.getByTestId("land-words").waitFor();
    await shot(p, "give-words-ru-390-dark");
    await p.context().close();
  }

  // 4. Not set up yet, English, phone.
  {
    const p = await page(browser, 390);
    await openGive(p, fx.public!.address);
    await p.getByRole("button", { name: "Connect a wallet" }).click();
    await p.getByTestId("dev-account-not-set-up").click();
    await p.getByTestId("give-agree").locator("[data-payee]").waitFor();
    await shot(p, "give-account-en-390");
    await p.getByTestId("give-swipe").click();
    await p.getByTestId("give-setup-band").waitFor({ timeout: 20_000 });
    await shot(p, "give-setup-en-390");
    await p.context().close();
  }

  // 5. Desk, English: the form.
  {
    const p = await page(browser, 1280);
    await openGive(p, fx.dark!.address);
    await p.getByRole("radio").nth(1).check();
    await p.getByTestId("land-words").waitFor();
    await shot(p, "give-form-en-1280");
    await p.context().close();
  }

  // 6. The fallback, with the relay stopped.
  if (!argv.includes("--no-relay-shot")) {
    spawnSync(process.execPath, ["infra/stand/stand.ts", "stop", "--slot", String(slot), "relay"], { cwd: REPO_ROOT });
    try {
      for (const which of ["en", "ru"] as const) {
        const p = await page(browser, 390);
        await openGive(p, fx.twoPasses!.address);
        await lang(p, which);
        await p.getByRole("radio").nth(0).check();
        await p.locator("textarea.ah-input--exact").fill("0x14dC79964da2C08b23698B3D3cc7Ca32193d9955");
        await p.getByTestId("give-swipe").click();
        await p.getByTestId("give-fallback").waitFor({ timeout: 20_000 });
        await p.getByTestId("give-qr").click();
        await shot(p, `give-fallback-${which}-390`);
        await p.context().close();
      }
    } finally {
      spawnSync(process.execPath, ["infra/stand/stand.ts", "start", "--slot", String(slot), "relay"], { cwd: REPO_ROOT });
    }
  }
} finally {
  await browser.close();
}
