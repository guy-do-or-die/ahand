import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The design system's gallery (apps/hand/gallery.html), served by Vite or by a built stand:
 *
 *   STAND_BASE_URL=http://127.0.0.1:18321 bunx playwright test tests/e2e/smoke/gallery.spec.ts
 *
 * It needs no chain. Sample addresses are anvil's public test accounts; the contract's address
 * is the one in the configuration the site was built with (the example configuration's here).
 */

/** The kit of ARCHITECTURE §7, plus the theme switch. */
const KIT = [
  "SwipeButton",
  "QuietButton",
  "ChipRow",
  "RewardBar",
  "DealCard",
  "ChainRail",
  "ReceiptTable",
  "Sheet",
  "Disclose",
  "Mark",
  "TxRail",
  "MoneyInput",
  "AddressInput",
  "LandSheet",
  "Identity",
  "Qr",
  "CostLine",
  "ErrorBand",
  "CopyRow",
  "MetaLine",
  "Logo",
  "Emoji",
  "ThemeToggle",
] as const;

const THEMES = ["light", "dark"] as const;
const PAPER = { light: "rgb(250, 250, 247)", dark: "rgb(16, 16, 20)" } as const;

const ZERO = "0x0000000000000000000000000000000000000000";
const EXAMPLE_CORE = "0x65ac707E2AE7392583de5d6192C619F1D8862309";
const ASKER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const SOMEONE_ELSE = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";

async function open(page: Page, query = ""): Promise<void> {
  await page.goto(`/gallery.html${query}`);
  await expect(page.locator("[data-kit]").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

const panel = (page: Page, theme: (typeof THEMES)[number]): Locator => page.locator(`[data-panel="${theme}"]`);

/** The fonts Chromium really drew a node's text with, by family name. */
async function fontsDrawn(page: Page, selector: string): Promise<string[]> {
  const session = await page.context().newCDPSession(page);
  await session.send("DOM.enable");
  await session.send("CSS.enable");
  const { root } = await session.send("DOM.getDocument");
  const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  expect(nodeId, `no node for ${selector}`).toBeGreaterThan(0);
  const { fonts } = await session.send("CSS.getPlatformFontsForNode", { nodeId });
  await session.detach();
  return fonts.filter((font) => font.glyphCount > 0).map((font) => font.familyName);
}

test("every component of the kit is visible in light and in dark", async ({ page }) => {
  await open(page);
  for (const theme of THEMES) {
    const side = panel(page, theme);
    await expect(side).toHaveCSS("background-color", PAPER[theme]);
    for (const name of KIT) {
      const section = side.locator(`[data-kit="${name}"]`);
      await section.scrollIntoViewIfNeeded();
      await expect(section, `${name} in ${theme}`).toBeVisible();
      // A section is more than its heading: something of the component itself is on screen.
      await expect(section.locator(":scope > :not(h2)").first(), `${name} in ${theme} has content`).toBeVisible();
    }
  }
});

test("at 1280 pixels the two themes stand side by side; at 390 nothing runs off the screen", async ({ page }) => {
  await open(page);
  // Against the device's own width: a phone widens its layout to fit content that runs off,
  // so the window's inner width would hide exactly the fault this looks for.
  const overflow = async () => (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(await overflow()).toBeLessThanOrEqual(0);
  await open(page, "?lang=ru&lens=on");
  expect(await overflow()).toBeLessThanOrEqual(0);

  await page.setViewportSize({ width: 1280, height: 800 });
  const light = await panel(page, "light").boundingBox();
  const dark = await panel(page, "dark").boundingBox();
  expect(light && dark && Math.abs(light.y - dark.y) < 2 && dark.x >= light.x + light.width - 1).toBe(true);
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test("the Deal card shows each state in words, and a hand with no reward never says $0", async ({ page }) => {
  await open(page);
  for (const theme of THEMES) {
    const card = (id: string) => panel(page, theme).locator(`[data-case="${id}"] .ah-deal`);
    await expect(card("open")).toContainText("Someone is looking for");
    await expect(card("open")).toContainText("$40 reward · open until 20 Dec");
    await expect(card("open")).toContainText("If you help and they thank you");
    await expect(card("open")).toContainText("at least $28");
    await expect(card("open")).toContainText("the whole reward goes back");
    await expect(card("expired")).toContainText("Time's up.");
    await expect(card("expired")).not.toContainText("If you help");
    await expect(card("thanked")).toContainText("Thanked on 3 Dec.");
    await expect(card("thanked").locator("table")).toContainText("$38.00");
    await expect(card("refunded")).toContainText("The reward went back on 21 Dec.");
    await expect(card("lost")).toContainText("The description didn't arrive with this link. Ask whoever sent it.");
    await expect(card("lost")).not.toContainText("sublet");
    await expect(card("no-clock")).toContainText("Can't reach the network right now.");
    await expect(card("no-clock")).not.toContainText("open until");

    const bare = card("no-reward");
    await expect(bare).toContainText("No reward: a thank-you only · open until 20 Dec");
    await expect(bare).toContainText("it's free; there is no share to keep");
    await expect(bare).toContainText("the hand closes");
    await expect(bare).not.toContainText("at least");
    await expect(bare).not.toContainText("$0");
    await expect(panel(page, theme).locator('[data-case="receipt-thanks-only"]')).not.toContainText("$0");
  }

  await open(page, "?lang=ru");
  const bareRu = panel(page, "light").locator('[data-case="no-reward"] .ah-deal');
  await expect(bareRu).toContainText("Без награды: только спасибо · открыта до 20 дек");
  await expect(bareRu).toContainText("бесплатно; доли здесь нет");
  await expect(bareRu).toContainText("рука закроется");
  await expect(bareRu).not.toContainText("$0");
  await expect(panel(page, "light").locator('[data-case="open"] .ah-deal')).toContainText("минимум $28");
});

test("a figure opens to its source, and the lens opens them all", async ({ page }) => {
  await open(page);
  const card = panel(page, "light").locator('[data-case="open"] .ah-deal');
  await expect(card).not.toContainText("hands(12).reward");
  await card.getByRole("button", { name: "$40" }).click();
  await expect(card).toContainText("hands(12).reward = 40000000");
  await expect(card.locator(".ah-mark--chain")).toBeVisible();
  await card.getByRole("button", { name: "at least $28" }).click();
  await expect(card).toContainText("40 × 7000 / 10 000 = 28");

  await open(page, "?lens=on");
  const lensed = panel(page, "dark").locator('[data-case="open"] .ah-deal');
  await expect(lensed).toContainText("hands(12).reward = 40000000");
  await expect(lensed).toContainText("Network time · block 1 234 · 20 Nov 14:02");
});

test("Cyrillic headlines are drawn in Onest, Latin ones in Schibsted Grotesk", async ({ page }) => {
  await open(page, "?lang=ru");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  const title = '[data-panel="light"] [data-case="open"] .ah-deal__title';
  await expect(page.locator(title)).toHaveText("квартиру в Ереване на июнь.");
  const russian = await fontsDrawn(page, title);
  expect(russian.some((family) => /Onest/i.test(family)), `drawn with: ${russian.join(", ")}`).toBe(true);
  expect(russian.every((family) => /Onest|Schibsted/i.test(family)), `drawn with: ${russian.join(", ")}`).toBe(true);

  // Mono in Russian is still IBM Plex Mono, whose Cyrillic is self-hosted too.
  const mono = await fontsDrawn(page, '[data-panel="light"] [data-kit="Mark"] .ah-mark--checked');
  expect(mono.some((family) => /IBM Plex Mono/i.test(family)), `drawn with: ${mono.join(", ")}`).toBe(true);

  await open(page);
  const english = await fontsDrawn(page, title);
  expect(english.length > 0 && english.every((family) => /Schibsted/i.test(family)), `drawn with: ${english.join(", ")}`).toBe(true);
});

test("the address field refuses the zero address and the contract's, and flags the asker's", async ({ page }) => {
  await open(page);
  const section = panel(page, "light").locator('[data-kit="AddressInput"]');
  const field = section.locator("textarea");
  const state = section.locator("[data-reading]");

  await field.fill(ZERO);
  await expect(state).toHaveAttribute("data-reading", "refused");
  await expect(state).toHaveAttribute("data-problem", "zero");
  await expect(section).toContainText("Refused");
  await expect(section).toContainText("That is the empty address.");

  await field.fill(EXAMPLE_CORE.toLowerCase());
  await expect(state).toHaveAttribute("data-reading", "refused");
  await expect(state).toHaveAttribute("data-problem", "core");
  await expect(section).toContainText("That is the contract's own address.");

  await field.fill(ASKER);
  await expect(state).toHaveAttribute("data-reading", "flagged");
  await expect(state).toHaveAttribute("data-problem", "raiser");
  await expect(section).toContainText("That is the asker's own address.");

  await field.fill(SOMEONE_ELSE);
  await expect(state).toHaveAttribute("data-reading", "ok");
  await expect(section).toContainText("We can't check who owns an address. Read it twice.");

  await field.fill("0x15d3");
  await expect(state).toHaveAttribute("data-reading", "incomplete");
});

test("zero is a valid amount", async ({ page }) => {
  await open(page);
  const section = panel(page, "light").locator('[data-kit="MoneyInput"]');
  const field = section.getByRole("textbox");
  await field.fill("0");
  await expect(section.locator("[data-reading]")).toHaveAttribute("data-reading", "ok");
  await expect(section.locator("[data-reading]")).toHaveAttribute("data-amount", "0");
  await expect(section.getByRole("alert")).toHaveCount(0);
  await field.fill("12,5");
  await expect(section.locator("[data-reading]")).toHaveAttribute("data-amount", "12500000");
  await field.fill("abc");
  await expect(section.locator("[data-reading]")).toHaveAttribute("data-reading", "invalid");
  await expect(section.getByRole("alert")).toBeVisible();
});

test("a 428-byte link gets a code and its version; a link past version 25 is called too dense", async ({ page }) => {
  await open(page);
  for (const theme of THEMES) {
    const code = panel(page, theme).locator('[data-case="qr-428"] .ah-qr');
    await expect(code).toHaveAttribute("data-qr-dense", "false");
    const version = Number(await code.getAttribute("data-qr-version"));
    expect(version).toBeGreaterThanOrEqual(13);
    expect(version).toBeLessThanOrEqual(15);
    await expect(code).toContainText(`QR v${version}`);
    const drawing = code.locator("svg");
    await drawing.scrollIntoViewIfNeeded();
    await expect(drawing).toBeVisible();
    // Three pixels a module at the least, quiet zone of four modules included.
    const box = await drawing.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual((17 + 4 * version + 8) * 3);
    expect((await drawing.locator("path").getAttribute("d"))!.length).toBeGreaterThan(1000);

    const dense = panel(page, theme).locator('[data-case="qr-dense"] .ah-qr');
    await expect(dense).toHaveAttribute("data-qr-dense", "true");
    expect(Number(await dense.getAttribute("data-qr-version"))).toBeGreaterThan(25);
    await expect(dense).toContainText("Too long for a code. Send it as text.");
    await expect(dense.locator("svg")).toHaveCount(0);
  }
});

test("where the money lands: twelve words are shown once, kept nowhere, and must be ticked", async ({ page }) => {
  await open(page);
  const bare = panel(page, "light").locator('[data-case="land-bare"]');
  const readout = bare.getByTestId("land-read");
  await expect(readout).toHaveText("not chosen yet");

  await bare.getByRole("button", { name: "Connect a wallet" }).click();
  await expect(bare.getByTestId("land-connect-asked")).toBeVisible();

  await bare.getByRole("radio", { name: "I have none — make one" }).check();
  // evaluateAll does not wait; the list is drawn after the key is made (a slow derivation).
  await expect(bare.getByTestId("land-words").locator("li")).toHaveCount(12);
  const words = await bare.getByTestId("land-words").locator("li").evaluateAll((items) => items.map((item) => item.lastChild?.textContent ?? ""));
  expect(words).toHaveLength(12);
  expect(words.every((word) => /^[a-z]{3,8}$/.test(word))).toBe(true);
  await expect(readout).toHaveText("not chosen yet");

  await bare.getByRole("checkbox", { name: "I wrote them down" }).check();
  await expect(readout).toContainText("fresh · payee 0x");
  await expect(readout).toContainText("confirmed by words");

  // Nothing of the key was written anywhere a later visit could read.
  const kept = await page.evaluate(async () => {
    const stores = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), document.cookie, window.location.href];
    const databases = "databases" in indexedDB ? await indexedDB.databases() : [];
    return { text: stores.join("\n"), databases: databases.length };
  });
  for (const word of words) expect(kept.text).not.toContain(word);
  expect(kept.databases).toBe(0);

  // With a connected account, the account is first and chosen.
  const connected = panel(page, "light").locator('[data-case="land-connected"]');
  await expect(connected.getByRole("radio", { name: "My connected account" })).toBeChecked();
  await expect(connected.getByTestId("land-read")).toContainText("confirmed by account");

  // "An address I have": the contract's address is refused, another one is taken.
  await connected.getByRole("radio", { name: "An address I have" }).check();
  await expect(connected.getByTestId("land-read")).toHaveText("not chosen yet");
  await connected.locator("textarea").fill(EXAMPLE_CORE);
  await expect(connected.getByTestId("land-read")).toHaveText("not chosen yet");
  await connected.locator("textarea").fill(SOMEONE_ELSE);
  await expect(connected.getByTestId("land-read")).toContainText(`address · payee ${SOMEONE_ELSE} · confirmed by one-time`);
});

test("a sheet opens as a dialog in both themes, holds its action off until the choice is made, and closes", async ({ page }) => {
  await open(page);
  for (const theme of THEMES) {
    const side = panel(page, theme);
    await side.getByTestId("sheet-open").click();
    const sheet = page.getByRole("dialog", { name: "Pass it on" });
    await expect(sheet).toBeVisible();
    const viewport = page.viewportSize()!;
    if (viewport.width < 768) {
      // On a phone the sheet is the whole screen, in its panel's theme.
      await expect(sheet).toHaveCSS("background-color", PAPER[theme]);
      expect(await sheet.boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
    } else {
      // From 768 pixels it is a 560-pixel panel over a scrim.
      const inner = sheet.locator(".ah-sheet__panel");
      await expect(inner).toHaveCSS("background-color", PAPER[theme]);
      expect((await inner.boundingBox())!.width).toBe(560);
      await expect(sheet).not.toHaveCSS("background-color", PAPER[theme]);
    }
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toHaveCount(0);

    await side.getByTestId("land-sheet-open").click();
    const land = page.getByRole("dialog", { name: "Where should your share land?" });
    await expect(land).toBeVisible();
    const done = land.getByRole("button", { name: "Use this address" });
    await expect(done).toBeDisabled();
    await land.getByRole("radio", { name: "An address I have" }).check();
    await land.locator("textarea").fill(ASKER);
    await expect(land).toContainText("That is the asker's own address.");
    await expect(done).toBeEnabled();
    await done.click();
    await expect(land).toHaveCount(0);
    await expect(side.locator('[data-case="land-sheet"]').getByTestId("land-read")).toContainText(`payee ${ASKER} · confirmed by one-time · flagged raiser`);
  }
});

for (const query of ["", "?lang=ru", "?lens=on"]) {
  test(`axe finds no serious or critical issue on the gallery${query ? ` (${query})` : ""}`, async ({ page }) => {
    await open(page, query);
    // Open what is closed by default, so its content is checked too.
    const side = panel(page, "light");
    await side.locator('[data-case="land-bare"]').getByRole("radio").last().check();
    await side.locator('[data-kit="AddressInput"] textarea').fill(ZERO);

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
    const grave = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    const report = grave.map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`);
    expect(report).toEqual([]);

    await side.getByTestId("land-sheet-open").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const inSheet = await new AxeBuilder({ page }).include("dialog").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(inSheet.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id)).toEqual([]);
  });
}
