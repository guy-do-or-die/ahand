import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The design system's gallery (apps/web/gallery.html), served by Vite or by a built stand:
 *
 *   STAND_BASE_URL=http://127.0.0.1:18321 bunx playwright test tests/e2e/smoke/gallery.spec.ts
 *
 * It needs no chain. Sample addresses are anvil's public test accounts; the contract's address
 * is the one in the configuration the site was built with (the example configuration's here).
 */

/** The UI kit, plus the theme switch. */
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
const EXAMPLE_CORE = "0x0f0555972388151D2C187f636A0855b6eE9B9685";
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
    // The lead-in is a whole sentence, so a question reads after it as well as a noun phrase.
    await expect(card("open").locator(".ah-deal__intro")).toHaveText("Someone raised a hand:");
    await expect(card("open").locator(".ah-deal__title")).toHaveText("Who knows of a sublet in Yerevan for June?");
    await expect(card("public").locator(".ah-deal__intro")).toHaveText("Someone raised a hand:");
    await expect(card("public").locator(".ah-deal__title")).toHaveText("A sublet in Yerevan, June.");
    await expect(card("open")).not.toContainText("is looking for");
    // The card is the route's spine: the whole reward and the date stand at the asker, and at the
    // viewer's place, on amber, what reaches whoever helps from here, under its condition (a
    // condition, not a promise of thanks). The gallery's card knows no route, so what passes kept
    // is said beside the amount.
    await expect(card("open").locator('[data-role="asker"]')).toContainText("Reward $40 · open until 20 Dec");
    await expect(card("open").locator(".ah-deal__money")).toHaveAttribute("data-plate", "reaches");
    await expect(card("open").locator(".ah-deal__sum")).toHaveText("$28");
    await expect(card("open").locator('[data-role="you"]')).toContainText("It reached you$28 If you help and they thank you · of $40: $12 was kept along the way");
    // A Hand that is over ends with what it came to, and nobody has a place on it.
    await expect(card("expired").locator('[data-role="end"]')).toContainText("Time's up.");
    await expect(card("expired").locator('[data-role="you"]')).toHaveCount(0);
    await expect(card("thanked").locator('[data-role="end"]')).toContainText("Thanked on 3 Dec.");
    await expect(card("open")).toContainText("the whole reward goes back");
    await expect(card("expired")).toContainText("Time's up.");
    await expect(card("expired")).not.toContainText("If you help");
    await expect(card("thanked")).toContainText("Thanked on 3 Dec.");
    await expect(card("thanked").locator("table")).toContainText("$38.00");
    // The receipt says what left the contract, never what somebody got.
    await expect(card("thanked").locator("table caption")).toHaveText("What was sent to whom, from the chain's own records");
    await expect(card("refunded")).toContainText("The reward went back on 21 Dec.");
    await expect(card("lost")).toContainText("The description didn't arrive with this link. Ask whoever sent it.");
    await expect(card("lost")).not.toContainText("sublet");
    await expect(card("lost").locator(".ah-deal__title")).toHaveText("Someone raised a hand.");
    await expect(card("lost").locator(".ah-deal__intro")).toHaveCount(0);
    await expect(card("no-clock")).toContainText("Can't reach the network right now.");
    await expect(card("no-clock")).not.toContainText("open until");

    const bare = card("no-reward");
    // Each fact once: the date at the asker, with how far off it is; "no reward" at the viewer's own place.
    await expect(bare.locator('[data-role="asker"]')).toContainText("open until 20 Dec, in 1 month");
    await expect(bare.locator('[data-role="you"]')).toContainText("No reward: a thank-you only");
    await expect(bare.locator('[data-role="asker"]')).not.toContainText("No reward");
    await expect(bare).toContainText("it's free. There is no share to keep");
    await expect(bare).toContainText("the hand closes");
    await expect(bare).not.toContainText("at least");
    await expect(bare).not.toContainText("$0");
    await expect(panel(page, theme).locator('[data-case="receipt-thanks-only"]')).not.toContainText("$0");
  }

  await open(page, "?lang=ru");
  const bareRu = panel(page, "light").locator('[data-case="no-reward"] .ah-deal');
  // The hand is open, not the reward.
  await expect(bareRu.locator('[data-role="asker"]')).toContainText("рука открыта до 20 дек, через 1 месяц");
  await expect(bareRu.locator('[data-role="you"]')).toContainText("Без награды: только спасибо");
  await expect(bareRu).toContainText("бесплатно. Доли здесь нет");
  await expect(bareRu).toContainText("рука закроется");
  await expect(bareRu).not.toContainText("$0");
  const openRu = panel(page, "light").locator('[data-case="open"] .ah-deal');
  // A condition, not a promise of thanks.
  await expect(openRu.locator('[data-role="asker"]')).toContainText("Награда $40 · рука открыта до 20 дек");
  await expect(openRu.locator('[data-role="you"]')).toContainText("Дошло до тебя$28 Если поможешь и тебя поблагодарят · из $40: $12 оставили себе по пути");
  await expect(openRu).not.toContainText("Поможешь, и тебя поблагодарят");
  await expect(openRu.locator(".ah-deal__intro")).toHaveText("Кто-то поднял руку:");
  await expect(openRu.locator(".ah-deal__title")).toHaveText("Кто знает, где снять квартиру в Ереване на июнь?");
  await expect(openRu).not.toContainText("Кто-то ищет");
  await expect(panel(page, "light").locator('[data-case="public"] .ah-deal__title')).toHaveText("Квартира в Ереване на июнь.");
  await expect(panel(page, "light").locator('[data-case="thanked"] table caption')).toHaveText("Кому сколько отправлено — по записям самой сети");
});

test("the asker's own card speaks about whoever helps and calls the 70% the floor they set", async ({ page }) => {
  await open(page);
  const card = panel(page, "light").locator('[data-case="asker"] .ah-deal');
  await expect(card).toHaveAttribute("data-viewer", "asker");
  await expect(card.locator(".ah-deal__intro")).toHaveText("You raised a hand:");
  await expect(card).toContainText("Whoever helps and is thanked");
  await expect(card).toContainText("at least $35 (the floor you set: 70%)");
  await expect(card).toContainText("Whoever passes it on");
  await expect(card).toContainText("If you thank nobody by then");
  await expect(card).toContainText("the whole reward comes back to you");
  await expect(card).not.toContainText("If you help");
  await expect(card).not.toContainText("If you pass it on");
  await expect(card).not.toContainText("Someone raised a hand");
  await open(page, "?lang=ru");
  const ru = panel(page, "light").locator('[data-case="asker"] .ah-deal');
  await expect(ru.locator(".ah-deal__intro")).toHaveText("Ты поднял руку:");
  await expect(ru).toContainText("минимум $35 (нижняя граница, которую ты задал: 70%)");
  await expect(ru).not.toContainText("Поможешь");
  await expect(ru).not.toContainText("Передашь дальше");
});

test("the rail flags a pass at the asker's own address and crosses out a holder a re-signed answer left out", async ({ page }) => {
  await open(page);
  const flagged = panel(page, "light").locator('[data-case="rail-asker"]');
  await expect(flagged.locator('[data-flag="asker"]')).toHaveCount(1);
  await expect(flagged.getByTestId("kit-rail-flag")).toHaveText("the asker's own address");
  const dropped = panel(page, "light").locator('[data-case="rail-dropped"]');
  const out = dropped.locator('[data-dropped="true"]');
  await expect(out).toHaveCount(1);
  await expect(out.locator("s")).toHaveCount(2);
  await expect(out).toContainText("5%");
  await expect(out).toContainText("left out of this route");
  // The left-out holder is not counted among the hands.
  await expect(dropped.locator("ol")).toHaveAttribute("aria-label", "3 hands so far.");
});

test("a figure is plain words in the calm view, and the lens opens every source", async ({ page }) => {
  await open(page);
  const card = panel(page, "light").locator('[data-case="open"] .ah-deal');
  // The calm view (since 2026-11-21): the amount and the floor are words, nothing opens.
  await expect(card.locator(".ah-deal__sum")).toHaveText("$28");
  await expect(card).toContainText("of $40: $12 was kept along the way");
  await expect(card).not.toContainText("hands(12).reward");
  await expect(card.getByRole("button", { name: "$40" })).toHaveCount(0);
  await expect(card.locator(".ah-mark")).toHaveCount(0);

  await open(page, "?lens=on");
  const lensed = panel(page, "dark").locator('[data-case="open"] .ah-deal');
  await expect(lensed).toContainText("hands(12).reward = 40000000");
  await expect(lensed.locator(".ah-mark--chain").first()).toBeVisible();
  // Core rounds each pass's share down, so the helper's least is the ceiling.
  await expect(lensed).toContainText("⌈40 × 7000 / 10 000⌉ = 28");
  await expect(lensed).toContainText("hands(12).expiry = 1797768000");
  await expect(lensed).toContainText("Network time · block 1 234 · 20 Nov 14:02");
  await expect(panel(page, "dark").locator('[data-case="thanked"] .ah-deal')).toContainText("hands(12).closedAt = 1796299200");
  // A card with no hand behind it yet (the raise screen's preview) names no source, lens or not.
  const preview = panel(page, "dark").locator('[data-case="preview"] .ah-deal');
  await expect(preview).toContainText("$40 reward · open until 20 Dec");
  await expect(preview).not.toContainText("hands(");
  await expect(preview.locator(".ah-mark--chain")).toHaveCount(0);
});

test("under the lens a date on the Deal card stands with the second Core keeps, in the reader's zone and in UTC", async ({ page }) => {
  await open(page);
  const calm = panel(page, "light");
  await expect(calm.locator('[data-case="open"] .ah-deal')).not.toContainText("hands(12).expiry");
  await expect(calm.locator('[data-case="thanked"] .ah-deal')).not.toContainText("closedAt");
  await expect(calm.locator('[data-case="thanked"] .ah-deal').getByRole("button", { name: "On chain" })).toHaveCount(0);

  await open(page, "?lens=on");
  const side = panel(page, "light");
  const card = (id: string) => side.locator(`[data-case="${id}"] .ah-deal`);
  const source = (id: string, field: "expiry" | "closedAt") => card(id).locator(`[data-source="${field}"]`);

  // Open: "open until 20 Dec" is hands(12).expiry. The gallery's reader is in UTC: one line.
  await expect(source("open", "expiry")).toContainText("hands(12).expiry = 1797768000");
  await expect(source("open", "expiry")).toContainText("20 Dec 2026, 12:00:00 UTC");
  await expect(source("open", "expiry").locator(".ah-mark--chain")).toBeVisible();
  await expect(source("open", "expiry")).toContainText("block 1 234");

  // A reader elsewhere gets their own zone first, then UTC.
  await expect(source("zone", "expiry").locator(".ah-meta--exact")).toHaveText(["hands(12).expiry = 1797768000", "20 Dec 2026, 16:00:00 GMT+4", "20 Dec 2026, 12:00:00 UTC"]);

  // Time's up, and no block yet: the same field behind "was open until" and "until".
  await expect(source("expired", "expiry")).toContainText("hands(12).expiry = 1797768000");
  await expect(source("no-clock", "expiry")).toContainText("hands(12).expiry = 1797768000");
  await expect(source("no-clock", "expiry")).not.toContainText("block");

  // Closed: "Thanked on 3 Dec." is hands(12).closedAt, and the chain mark beside it says it is open.
  const thanked = card("thanked");
  await expect(thanked.locator(".ah-deal__closed").getByRole("button", { name: "On chain" })).toHaveAttribute("aria-expanded", "true");
  await expect(source("thanked", "closedAt").locator(".ah-meta--exact")).toHaveText(["hands(12).closedAt = 1796299200", "3 Dec 2026, 12:00:00 UTC"]);
  await expect(source("thanked", "closedAt")).toContainText("block 1 234");
  await expect(source("refunded", "closedAt")).toContainText("hands(12).closedAt = 1797854400");

  // In Russian the dates are written the Russian way; Core's names stay as they are.
  await open(page, "?lang=ru&lens=on");
  const ru = panel(page, "light").locator('[data-case="zone"] .ah-deal');
  await expect(ru.locator('[data-source="expiry"] .ah-meta--exact')).toHaveText(["hands(12).expiry = 1797768000", "20 дек. 2026 г., 16:00:00 GMT+4", "20 дек. 2026 г., 12:00:00 UTC"]);
});

test("Cyrillic headlines are drawn in Onest, Latin ones in Schibsted Grotesk", async ({ page }) => {
  await open(page, "?lang=ru");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  // The asker's words stand isolated in a <bdi> inside the title; its text is the bdi's own.
  // They are a message from a person, set in the reader's device font, so the brand's faces are
  // read from the card's own words beside the amount.
  await expect(page.locator('[data-panel="light"] [data-case="open"] .ah-deal__title bdi')).toHaveText("Кто знает, где снять квартиру в Ереване на июнь?");
  const title = '[data-panel="light"] [data-case="open"] .ah-deal__what';
  await expect(page.locator(title)).toHaveText("Если поможешь и тебя поблагодарят");
  const russian = await fontsDrawn(page, title);
  expect(russian.some((family) => /Onest/i.test(family)), `drawn with: ${russian.join(", ")}`).toBe(true);
  expect(russian.every((family) => /Onest|Schibsted/i.test(family)), `drawn with: ${russian.join(", ")}`).toBe(true);

  // Mono in Russian is still IBM Plex Mono, whose Cyrillic is self-hosted too (a mark is proof:
  // it stands under the lens).
  await open(page, "?lang=ru&lens=on");
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

test("the asker's words are labelled unchecked, and an amount in them that is not the reward is said", async ({ page }) => {
  await open(page);
  for (const theme of THEMES) {
    const card = panel(page, theme).locator('[data-case="amount-flag"] .ah-deal');
    await expect(card.getByTestId("kit-deal-words-label")).toHaveText("In the asker's words — not checked");
    const flag = card.getByTestId("kit-deal-amount-flag");
    await expect(flag).toHaveText("The words mention $5,000 and $4,500. The reward on chain is $1.");
    await expect(flag).toHaveAttribute("data-value", "5000 4500");
    // The figures Core backs still stand in their own place, after the words and the flag.
    // (this case stands after a pass that kept a share: the amber amount is what reaches the
    // helper, and Core's whole reward, the one the flag names, stands beside it)
    await expect(card.locator(".ah-deal__money")).toContainText("of $1: $0.10 was kept along the way");
    // The open case's words mention no amount: no flag, and the line over the words alone says whose
    // they are. They stand as words: no bubble around them, and no plate under the hand.
    const plain = panel(page, theme).locator('[data-case="open"] .ah-deal');
    await expect(plain.locator(".ah-asker__words")).toBeVisible();
    await expect(plain.locator(".ah-asker__bubble")).toHaveCount(0);
    expect(await plain.locator(".ah-spine__gesture").first().evaluate((mark) => getComputedStyle(mark).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    await expect(plain.getByTestId("kit-deal-words-label")).toHaveCount(0);
    await expect(plain.getByTestId("kit-deal-amount-flag")).toHaveCount(0);
    await expect(plain.getByTestId("kit-deal-hidden-chars")).toHaveCount(0);
    // No words, no label.
    await expect(panel(page, theme).locator('[data-case="lost"] [data-testid="kit-deal-words-label"]')).toHaveCount(0);
  }
  await open(page, "?lang=ru");
  const ru = panel(page, "light").locator('[data-case="amount-flag"] .ah-deal');
  await expect(ru.getByTestId("kit-deal-words-label")).toHaveText("Словами автора — не проверено");
  await expect(ru.getByTestId("kit-deal-amount-flag")).toHaveText("В тексте написано $5\u00a0000 и $4\u00a0500. Награда в контракте — $1.");
});

test("direction controls and invisible characters are drawn as tokens, isolated, and look-alikes are marked", async ({ page }) => {
  await open(page);
  const card = panel(page, "light").locator('[data-case="hostile-words"] .ah-deal');
  const title = card.locator(".ah-deal__title");
  // The bytes as they are, in order: the override is a token, so "0005$" is not drawn as "$5000".
  await expect(title).toHaveText("Reward ⟨RLO⟩0005$⟨PDF⟩, I thank every answer");
  await expect(title.locator("bdi")).toHaveAttribute("dir", "auto");
  await expect(title.locator(".ah-hidden").first()).toHaveAttribute("data-char", "U+202E");
  // No direction control is left in the drawn text.
  const drawn = await card.locator(".ah-asker").evaluate((node) => node.textContent ?? "");
  expect(drawn).not.toMatch(/[\u202A-\u202E\u2066-\u2069\u200B-\u200D\u2060\uFEFF\u2028\u2029]/);
  const content = card.locator(".ah-deal__content");
  await expect(content.locator(".ah-hidden")).toHaveText(["⟨ZWSP⟩", "⟨LS⟩", "⟨WJ⟩", "⟨ZWJ⟩"]);
  await expect(content.locator('.ah-odd[data-why="mixed-script"]')).toHaveText(["Тhis", "hаnd", "аHаnd"]);
  await expect(content.locator('.ah-odd[data-why="compat"]')).toHaveText(["＄５０００", "＄𝟱𝟶𝟶𝟶"]);
  const hidden = card.getByTestId("kit-deal-hidden-chars");
  await expect(hidden).toHaveAttribute("data-value", "direction invisible mixed-script compat");
  await expect(hidden).toContainText("Each is marked where it stands.");
  await expect(card.getByTestId("kit-deal-amount-flag")).toHaveAttribute("data-value", "5 5000");
});

test("long words are clamped behind Read all, so the reward and the rows stay near the top", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const card = panel(page, "light").locator('[data-case="long-words"] .ah-deal');
  await card.scrollIntoViewIfNeeded();
  const more = card.getByTestId("kit-deal-read-all");
  await expect(more).toHaveText("Read all");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  const top = (await card.boundingBox())!.y;
  const money = (await card.locator(".ah-deal__money").boundingBox())!;
  // The card's last part in the calm view: its rows (the "Asked by" row is the lens's).
  const asked = (await card.locator(".ah-deal__rows").last().boundingBox())!;
  // The whole card, words clamped, is shorter than a phone's screen.
  expect(asked.y + asked.height - top).toBeLessThan(844);
  expect(money.y - top).toBeLessThan(560);
  await more.click();
  await expect(more).toHaveText("Show less");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  expect((await card.locator(".ah-deal__money").boundingBox())!.y - top).toBeGreaterThan(900);
  // A short card has nothing to read further.
  await expect(panel(page, "light").locator('[data-case="open"] [data-testid="kit-deal-read-all"]')).toHaveCount(0);
});

test("a link's copy row: a full-width Copy link first, the link itself under it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  for (const theme of THEMES) {
    const link = panel(page, theme).locator('[data-case="copy-link"]');
    const copy = link.getByTestId("kit-copy-button");
    await expect(copy).toHaveText("Copy link");
    const field = link.locator(".ah-linkrow__value");
    const [button, row] = [(await copy.boundingBox())!, (await link.locator(".ah-linkrow").boundingBox())!];
    expect(button.height).toBeGreaterThanOrEqual(48);
    expect(Math.abs(button.width - row.width)).toBeLessThan(2);
    expect(button.y).toBeLessThan(row.y);
    await copy.click();
    await expect(copy).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe((await field.textContent())!.trim());
    // Share stands only where the browser has a share sheet.
    const canShare = await page.evaluate(() => typeof navigator.share === "function");
    await expect(link.getByTestId("kit-share-button")).toHaveCount(canShare ? 1 : 0);
    // A value that is not a link keeps the row that copies itself.
    const text = panel(page, theme).locator('[data-case="copy-text"]');
    await expect(text.getByTestId("kit-copy-button")).toContainText("Copy");
    await expect(text.getByTestId("kit-copy-button")).not.toContainText("Copy link");
  }
  await open(page, "?lang=ru");
  await expect(panel(page, "light").locator('[data-case="copy-link"]').getByTestId("kit-copy-button")).toHaveText("Скопировать ссылку");
});
