/**
 * Russian (UX-SPEC §5, §12, PLAN rule 12): the first five steps of a Hand's life with every
 * browser set to ru-RU — raise, open, pass on, help, thank — asserting UX-SPEC's Russian sentences
 * word for word, and that no English value of the app's catalogues appears on those screens.
 *
 *   STAND_SLOT=2 bunx playwright test tests/e2e/guards/russian.spec.ts
 *
 * The catalogues are read by the guards' forge tool in a child process (spec files import no
 * workspace code). An English value counts as leaked when a literal run of it at least 14
 * characters long (outside its {placeholders}) stands on screen, compared without regard to case
 * because mono labels are drawn in capitals; values identical in both languages are skipped.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

import { account, pickDevAccount } from "../lib/accounts";
import { compose, copied, swipe } from "../lib/feat-raise/raise";
import { hands, rpc } from "../lib/rpc";
import { readStand } from "../lib/stand";
import { forge, quiet, visit } from "./lib/guard";

const stand = readStand();
const chain = rpc(stand.rpc);

/** The literal runs of an ICU message: what is left once every {…} is cut out. */
function literals(message: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of message) {
    if (char === "{") {
      if (depth === 0) {
        out.push(current);
        current = "";
      }
      depth++;
    } else if (char === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0) current += char;
  }
  out.push(current);
  return out.map((part) => part.trim()).filter(Boolean);
}

let english: { key: string; run: string }[] = [];

test.beforeAll(() => {
  const catalogue = forge<{ ok: boolean; en: Record<string, string>; ru: Record<string, string> }>("catalogue");
  expect(catalogue.ok).toBe(true);
  for (const [key, value] of Object.entries(catalogue.en)) {
    if (catalogue.ru[key] === value) continue;
    for (const run of literals(value)) if (run.length >= 14 && !(catalogue.ru[key] ?? "").includes(run)) english.push({ key, run: run.toLowerCase() });
  }
  expect(english.length).toBeGreaterThan(100);
});

/** The English catalogue values on the screen now. */
async function englishOn(page: Page): Promise<string[]> {
  await page.waitForTimeout(300);
  const text = (await page.locator("body").innerText()).toLowerCase();
  return english.filter(({ run }) => text.includes(run)).map(({ key, run }) => `${key}: "${run}"`);
}

/** No English catalogue value on the screen now. */
async function noEnglish(page: Page, where: string): Promise<void> {
  expect(await englishOn(page), `English on ${where}`).toEqual([]);
}

test("the search works: /raise in English shows English catalogue values", async ({ browser }) => {
  const context = await browser.newContext({ locale: "en-US" });
  await quiet(context, stand.site!);
  const page = await context.newPage();
  await page.goto("/raise");
  await expect(page.getByTestId("raise-what")).toBeVisible({ timeout: 20_000 });
  expect((await englishOn(page)).length).toBeGreaterThan(3);
  await context.close();
});

async function person(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ locale: "ru-RU", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await quiet(context, stand.site!);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  page.on("dialog", (dialog) => void dialog.accept());
  return page;
}

test("raise, open, pass on, help and thank in Russian: UX-SPEC's sentences, and no English", async ({ browser }) => {
  test.setTimeout(240_000);

  // 1. Raise.
  const asker = await person(browser);
  await asker.goto("/raise");
  await expect(asker.getByTestId("raise-what")).toBeVisible({ timeout: 20_000 });
  await expect(asker.locator("html")).toHaveAttribute("lang", "ru");
  await expect(asker.getByTestId("shell-main")).toContainText("Кого или что ищешь?");
  await expect(asker.getByTestId("raise-swipe")).toContainText("Поднять руку");
  // The calm view says what the money is; that an issuer can freeze an address is the lens's.
  await expect(asker.getByTestId("raise-issuer-line")).toContainText("Награда в тестовых долларах.");
  await compose(asker, { title: "Кто одолжит палатку на выходные?", details: "На двоих, верну в понедельник.", reward: "20" });
  await noEnglish(asker, "/raise");
  await swipe(asker, 1);
  const up = asker.getByTestId("raise-up");
  await expect(up).toBeVisible({ timeout: 40_000 });
  await expect(up).toContainText("Рука поднята.");
  const handId = BigInt((await up.getAttribute("data-hand-id"))!);
  await expect(asker.getByTestId("shell-main")).toContainText("Отправь тем, кто может знать нужного человека. Передать дальше — бесплатно.");
  await noEnglish(asker, "/raise, the hand is up");
  const raised = await copied(asker);

  // 2. Open.
  const holder = await person(browser);
  await visit(holder, raised);
  await expect(holder.getByTestId("hand-deal-card")).toContainText("Кто одолжит палатку на выходные?");
  await expect(holder.getByTestId("hand-deal-card")).toContainText("Кто-то поднял руку:");
  await expect(holder.getByTestId("hand-pass")).toContainText("Передать дальше");
  await expect(holder.getByTestId("hand-help")).toContainText("Могу помочь");
  await expect(holder.getByTestId("hand-help-note")).toContainText("Благодарить или нет — решает автор.");
  await expect(holder.getByTestId("hand-tab-only")).toContainText("Ссылка живёт только в этой вкладке.");
  await noEnglish(holder, "the Hand view");

  // 3. Pass on, at 0%.
  await holder.getByTestId("hand-pass").click();
  await expect(holder.getByTestId("shell-main")).toContainText("Оставь себе чуть-чуть — или передай всё дальше.");
  await noEnglish(holder, "/pass");
  await holder.getByTestId("pass-swipe").click();
  await expect(holder.getByTestId("pass-read-back")).toHaveAttribute("data-bps", "0");
  await noEnglish(holder, "/pass, the link is made");
  const passed = ((await holder.getByTestId("pass-copy").locator(".ah-linkrow__value").textContent()) ?? "").trim();

  // 4. Help, as dev account 4.
  const helper = await person(browser);
  await visit(helper, passed);
  await helper.getByTestId("hand-help").click();
  await expect(helper.getByTestId("give-words")).toBeVisible({ timeout: 20_000 });
  await expect(helper.getByTestId("shell-main")).toContainText("Напиши, чем поможешь. Если поблагодарят — тебе минимум");
  await expect(helper.getByTestId("shell-main")).toContainText("Куда придут деньги");
  await noEnglish(helper, "/give");
  await helper.getByTestId("give-words").fill("У меня есть палатка на двоих, могу привезти в пятницу.");
  await helper.getByRole("button", { name: "Подключить кошелёк" }).click();
  await pickDevAccount(helper, 4);
  await expect(helper.getByTestId("give-swipe")).toContainText("Отправить ответ");
  await helper.getByTestId("give-swipe").click();
  // The calm view says it plainly; how many relays took it is the lens's (data-value keeps the count).
  await expect(helper.getByTestId("give-delivered")).toHaveText("Отправлено автору.", { timeout: 30_000 });
  await expect(helper.getByTestId("give-delivered")).toHaveAttribute("data-value", "1/1");
  await noEnglish(helper, "/give, delivered");
  const given = (await helper.getByTestId("give-copy").getAttribute("data-value"))!;

  // 5. Thank.
  await asker.goto("/thank");
  await asker.getByTestId("thank-input").fill(given);
  await asker.getByTestId("thank-open").click();
  await expect(asker.getByTestId("thank-predicted")).toBeVisible({ timeout: 30_000 });
  if (!(await asker.getByTestId("wallet-connected").isVisible())) await pickDevAccount(asker, 1);
  await expect(asker.getByTestId("wallet-connected")).toHaveAttribute("data-value", account(1).address);
  await expect(asker.getByTestId("thank-warning")).toHaveText("Спасибо — и помощник, и все, кто передавал, получат свою долю. Отменить нельзя.");
  await expect(asker.getByTestId("thank-swipe")).toContainText("Сказать спасибо");
  await expect(asker.getByTestId("thank-swipe")).toBeEnabled({ timeout: 20_000 });
  await noEnglish(asker, "/thank");
  await asker.getByTestId("thank-swipe").click();
  await expect(asker.getByTestId("thank-done")).toContainText("Спасибо сказано. Вот все выплаты.", { timeout: 45_000 });
  await noEnglish(asker, "/thank, thanked");
  expect((await hands(chain, stand.core, handId)).closedAt).toBeGreaterThan(0);

  for (const page of [asker, holder, helper]) await page.context().close();
});
