/**
 * My hands in a real browser against a real local chain and
 * relay:
 *
 *   STAND_SLOT=5 bunx playwright test tests/e2e/smoke/my.spec.ts
 *   STAND_FILE=<folder>/stand.json STAND_BASE_URL=http://127.0.0.1:<port> bunx playwright test tests/e2e/smoke/my.spec.ts
 *     (a stand on other ports: tests/e2e/lib/feat-my/own-stand.ts)
 *
 * - a Hand raised as a device raises it (tests/e2e/lib/feat-my/raise.ts: its own random book,
 *   n = 0) is written into the device's store through the app's own store functions; after a
 *   reload and one unlock, "Show the link again" writes an address that opens the same Hand with
 *   its words;
 * - a give envelope sent to the Hand's inbox by `craft deliver-send` shows as an answer only once
 *   Core's checkGive said yes; one with a broken giver confirmation shows as refused with its
 *   sentence; a reply typed here arrives at `craft deliver-listen` on the helper's key;
 * - the seed's test book typed into "Rebuild a link from another device's code" rebuilds a seeded
 *   Hand's link, which opens with its words not arrived;
 * - "Add a hand by its number" refuses a Hand raised by another account;
 * - while the session is locked the list and the Hand's page say the answers are locked, in both
 *   languages, and never that there are none; "No answers yet" comes only after every relay has
 *   answered an unlocked read; with no relay in reach the screen says that instead;
 * - the helper's words are quoted “…” in English and «…» in Russian;
 * - no eth_getLogs without a handId topic is sent by these screens (every RPC request is read).
 */
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { account, pickDevAccount } from "../lib/accounts";
import { deviceAll, deviceDelete, devicePut, handKey } from "../lib/feat-my/store";
import { readStand, runProgram, seed, standSlot } from "../lib/stand";

test.describe.configure({ mode: "serial" });

const stand = readStand();
const STAND = process.env.STAND_FILE ? ["--stand", resolve(process.env.STAND_FILE)] : ["--slot", String(standSlot())];

interface MyRaise {
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
  expiry: number;
  rootKey: string;
  inbox: string;
  inboxSecret: string;
  /** The first live link, as the raise screen hands it out. */
  address: string;
}

function json<T>(script: string, args: string[], allowFailure = false): T {
  const { stdout } = runProgram(script, [...args, ...STAND], { allowFailure });
  return JSON.parse(stdout) as T;
}
const craft = <T = Record<string, unknown>>(...args: string[]) => json<T>("tests/e2e/lib/craft.ts", args, true);
const myRaise = (...args: string[]) => json<MyRaise>("tests/e2e/lib/feat-my/raise.ts", args);
const keyOf = (r: { chainId: number; core: string; handId: string }) => `${r.chainId}:${r.core.toLowerCase()}:${r.handId}`;

/** Reads every request to the chain's RPC and keeps each eth_getLogs that names no handId topic. */
function watchLogs(page: Page): { unbounded: unknown[]; getLogs: number } {
  const seen = { unbounded: [] as unknown[], getLogs: 0 };
  const origin = new URL(stand.rpc).origin;
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== origin || request.method() !== "POST") return;
    let body: unknown;
    try {
      body = request.postDataJSON();
    } catch {
      return;
    }
    for (const call of Array.isArray(body) ? body : [body]) {
      const { method, params } = (call ?? {}) as { method?: string; params?: { topics?: unknown[] }[] };
      if (method !== "eth_getLogs") continue;
      seen.getLogs++;
      const topics = params?.[0]?.topics;
      if (!Array.isArray(topics) || topics[1] === undefined || topics[1] === null) seen.unbounded.push(call);
    }
  });
  return seen;
}

/** Writes the Hand into this browser's device store, in the shape the app's store/db.ts keeps. */
async function keepOnDevice(page: Page, r: MyRaise, repeats = true): Promise<void> {
  // An account whose confirmations differ: the verdict is learned at unlock; its inbox secret is kept, as the raise keeps it.
  await devicePut(page, [
    { store: "books", value: { raiser: r.raiser.toLowerCase(), book: r.book, next: r.n + 1, ...(repeats ? { repeats: true } : {}) } },
    {
      store: "hands",
      value: {
        intent: `smoke-${r.handId}`,
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
        ...(repeats ? {} : { inboxSecret: r.inboxSecret }),
      },
    },
  ]);
}

async function unlock(page: Page): Promise<void> {
  const button = page.getByTestId("my-unlock");
  await expect(button).toBeVisible();
  if ((await button.getAttribute("data-value")) !== "unlocked") await button.click();
  await expect(page.getByTestId("my-unlock")).toHaveAttribute("data-value", "unlocked");
}

/** The device's list, connected as account 1 (the asker), after a reload. */
async function openMine(page: Page, raised: MyRaise): Promise<void> {
  await page.goto("/my");
  await keepOnDevice(page, raised);
  await page.reload();
  await pickDevAccount(page, 1);
  await expect(page.getByTestId("wallet-connected").first()).toHaveAttribute("data-value", account(1).address);
}

let mine: MyRaise;
let liveAddress: string;

test.beforeAll(() => {
  // Three days: the "keep it open longer?" band must show.
  mine = myRaise("--days", "3");
});

test("raised on this device, reloaded, unlocked: Show the link again writes an address that opens the same hand", async ({ page }) => {
  const logs = watchLogs(page);
  await page.goto("/my");
  await expect(page.getByTestId("my-empty")).toBeVisible();
  await expect(page.getByTestId("my-device-only")).toBeVisible();

  await openMine(page, mine);
  const item = page.locator(`[data-testid="my-item"][data-value="${keyOf(mine)}"]`);
  await expect(item).toContainText(mine.title);
  await expect(item).toHaveAttribute("data-state", "open");
  await expect(item.getByRole("meter")).toBeVisible();
  await expect(item.getByTestId("my-care-band")).toHaveAttribute("href", `/care/${mine.chainId}/${mine.handId}`);
  await expect(item).toContainText(/2 days left|3 days left/);

  await unlock(page);
  await item.getByRole("link", { name: mine.title }).click();
  await expect(page).toHaveURL(new RegExp(`/my/${mine.chainId}/${mine.handId}$`));
  await expect(page.getByTestId("hand-deal-card")).toContainText(mine.title); // the kept words matched Core's dataHash

  await page.getByTestId("my-show-link").click();
  const row = page.getByTestId("my-link-row");
  await expect(row).toHaveAttribute("data-words", "attached");
  liveAddress = (await row.getAttribute("data-value"))!;
  expect(liveAddress.startsWith(`${stand.site}/${mine.chainId}/${mine.handId}?d=`)).toBe(true);

  const opened = craft<{ ok: boolean; handId: string; state: string; description: { status: string; title?: string; content?: string } }>("open", liveAddress);
  expect(opened.ok).toBe(true);
  expect(opened.handId).toBe(mine.handId);
  expect(opened.state).toBe("open");
  expect(opened.description).toMatchObject({ status: "attached", title: mine.title, content: mine.content });

  // The same address opens in a fresh tab of this browser: the fragment is read and dropped.
  // (Written for the site the build names; opened on whichever origin this run serves the app from.)
  const origin = new URL(page.url()).origin;
  const fresh = await page.context().newPage();
  await fresh.goto(`${origin}${liveAddress.slice(new URL(liveAddress).origin.length)}`);
  await expect(fresh).toHaveURL(`${origin}/${mine.chainId}/${mine.handId}${new URL(liveAddress).search}`);
  await fresh.close();

  expect(logs.unbounded).toEqual([]);
});

test("a give in the inbox is an answer only after Core's checkGive; a broken one is refused with its sentence; a reply reaches the helper", async ({ page }) => {
  const logs = watchLogs(page);
  const give = craft<{ ok: boolean; address: string; giveHash: string }>("give", liveAddress, "--giver", "4");
  expect(give.ok).toBe(true);
  const broken = craft<{ ok: boolean; address: string }>("tamper", give.address, "--how", "giver-sig");
  expect(broken.ok).toBe(true);
  const words = "Café Lumen, two minutes from the station: sockets everywhere, opens at eight.";
  const sent = craft<{ ok: boolean; acks: number; chatSecret: string; replyTo: string }>("deliver-send", give.address, "--text", words);
  expect(sent).toMatchObject({ ok: true, acks: 1 });
  const brokenWords = "The same, with a confirmation that does not check out.";
  const sentBroken = craft<{ ok: boolean }>("deliver-send", broken.address, "--text", brokenWords);
  expect(sentBroken.ok).toBe(true);

  await openMine(page, mine);
  await page.goto(`/my/${mine.chainId}/${mine.handId}`);
  await pickDevAccount(page, 1);
  await unlock(page);

  const answer = page.locator(`[data-testid="my-answer"][data-value="${give.giveHash}"]`);
  await expect(answer).toBeVisible({ timeout: 20_000 });
  await expect(answer).toContainText(words);
  await expect(answer).toContainText(/Their words/);
  await expect(answer.getByTestId("my-answer-thank")).toBeVisible();
  const refused = page.locator('[data-testid="my-answer-refused"][data-value="core.InvalidGiverSig"]');
  await expect(refused).toBeVisible();
  await expect(refused).toContainText("The helper's confirmation doesn't check out.");
  await expect(page.getByTestId("my-answer")).toHaveCount(1);

  // The helper's words are quoted as each language quotes: “…” in English, «…» in Russian.
  await expect(answer).toContainText(`“${words}”`);
  await expect(refused).toContainText(`“${brokenWords}”`);
  await page.getByTestId("shell-lang-ru").click();
  await expect(answer).toContainText(`«${words}»`);
  await expect(refused).toContainText(`«${brokenWords}»`);
  await expect(page.getByTestId("my-answers")).not.toContainText(/[“”]/);
  await page.getByTestId("shell-lang-en").click();
  await expect(answer).toContainText(`“${words}”`);

  const reply = "Thank you! Is it quiet in the mornings?";
  await answer.getByTestId("my-reply-input").fill(reply);
  await answer.getByTestId("my-reply-send").click();
  // The calm view says it went; how many relays took it is the lens's.
  await expect(answer.getByRole("status")).toContainText("Sent to the helper.");
  const heard = craft<{ ok: boolean; envelopes: { kind: string; text?: string; replyTo: string; hand: { handId: string } }[] }>("deliver-listen", "--secret", sent.chatSecret, "--wait", "8000");
  expect(heard.ok).toBe(true);
  expect(heard.envelopes).toContainEqual(expect.objectContaining({ kind: "note", text: reply, replyTo: mine.inbox, hand: expect.objectContaining({ handId: mine.handId }) }));

  // On /my the count says one answer: the refused one is not counted.
  await page.goto("/my");
  await pickDevAccount(page, 1);
  await expect(page.locator(`[data-testid="my-item"][data-value="${keyOf(mine)}"] [data-testid="my-answer-count"]`)).toHaveAttribute("data-value", "1");

  // Thank hands the give address to /thank through the tab's memory.
  await page.goto(`/my/${mine.chainId}/${mine.handId}`);
  await page.locator(`[data-testid="my-answer"][data-value="${give.giveHash}"] [data-testid="my-answer-thank"]`).click();
  await expect(page).toHaveURL(/\/thank$/);
  // /thank takes the handed-over give link from the tab's memory: Core's check runs and the table shows.
  await expect(page.getByTestId("thank-predicted")).toBeVisible({ timeout: 20_000 });

  expect(logs.unbounded).toEqual([]);
});

const countOf = (page: Page, r: MyRaise) => page.locator(`[data-testid="my-item"][data-value="${keyOf(r)}"] [data-testid="my-answer-count"]`);

test("locked, the screen says the answers are locked and never that there are none; 'No answers yet' comes only after an unlocked read of the inbox", async ({ page }) => {
  const logs = watchLogs(page);
  const answered = myRaise("--title", "Who can lend a ladder on Saturday?");
  const quiet = myRaise("--title", "Who knows a good piano tuner?");
  const words = "I have one, three metres. Come by after ten.";
  const give = craft<{ ok: boolean; address: string; giveHash: string }>("give", answered.address, "--giver", "4");
  expect(give.ok).toBe(true);
  // The answer is on the relay before the asker opens the page: delivered, and not yet readable here.
  expect(craft<{ ok: boolean; acks: number }>("deliver-send", give.address, "--to", answered.inbox, "--text", words)).toMatchObject({ ok: true, acks: 1 });

  await page.goto("/my");
  await keepOnDevice(page, answered);
  await keepOnDevice(page, quiet);
  await page.reload();
  await pickDevAccount(page, 1);

  // The list, locked: neither hand claims to have no answers, in either language.
  for (const hand of [answered, quiet]) {
    await expect(countOf(page, hand)).toHaveAttribute("data-state", "locked");
    await expect(countOf(page, hand)).toHaveText("Answers are locked — unlock to check.");
  }
  await expect(page.getByTestId("my-list")).not.toContainText("No answers yet");
  await page.getByTestId("shell-lang-ru").click();
  await expect(countOf(page, answered)).toHaveText("Ответы закрыты — открой доступ, чтобы проверить.");
  await expect(page.getByTestId("my-list")).not.toContainText("Ответов пока нет");
  await page.getByTestId("shell-lang-en").click();

  // Unlocking on the list: the line goes from locked to the answer that was waiting, and at no
  // moment in between does it say there are none (every text it shows is kept and read).
  await countOf(page, answered).evaluate((line) => {
    const seen = [line.textContent ?? ""];
    new MutationObserver(() => seen.push(line.textContent ?? "")).observe(line, { childList: true, characterData: true, subtree: true });
    (window as unknown as { seenCounts: string[] }).seenCounts = seen;
  });
  await unlock(page);
  await expect(countOf(page, answered)).toHaveAttribute("data-value", "1", { timeout: 20_000 });
  await expect(countOf(page, answered)).toHaveAttribute("data-state", "read");
  await expect(countOf(page, answered)).toHaveText("1 answer");
  const seen = await page.evaluate(() => (window as unknown as { seenCounts: string[] }).seenCounts);
  expect(seen[0]).toBe("Answers are locked — unlock to check.");
  expect(seen).not.toContain("No answers yet");
  // The hand nobody answered says so only now, after the relay answered an unlocked read.
  await expect(countOf(page, quiet)).toHaveAttribute("data-state", "read");
  await expect(countOf(page, quiet)).toHaveText("No answers yet");

  // The quiet hand's page, locked again by the reload: the same sentence, and not "Nothing has arrived yet."
  await page.goto(`/my/${quiet.chainId}/${quiet.handId}`);
  await pickDevAccount(page, 1);
  const section = page.getByTestId("my-answers");
  await expect(section).toHaveAttribute("data-state", "locked");
  await expect(section).toContainText("Answers are locked — unlock to check.");
  await expect(section).not.toContainText("Nothing has arrived yet.");
  await page.getByTestId("shell-lang-ru").click();
  await expect(section).toContainText("Ответы закрыты — открой доступ, чтобы проверить.");
  await expect(section).not.toContainText("Пока ничего не пришло.");
  await page.getByTestId("shell-lang-en").click();
  await unlock(page);
  await expect(section).toHaveAttribute("data-state", "read");
  await expect(section).toContainText("Nothing has arrived yet.");

  // The answered hand's page, locked: the answer this device already holds is shown, with the
  // note that more may wait; unlocked, the relay is read again.
  await page.goto(`/my/${answered.chainId}/${answered.handId}`);
  await pickDevAccount(page, 1);
  await expect(section).toHaveAttribute("data-state", "locked");
  await expect(page.locator(`[data-testid="my-answer"][data-value="${give.giveHash}"]`)).toContainText(words, { timeout: 20_000 });
  await expect(section).toContainText("Unlock to check for new answers.");
  await expect(section).not.toContainText("Nothing has arrived yet.");
  await unlock(page);
  await expect(section).toHaveAttribute("data-state", "read");
  await expect(section).not.toContainText("Nothing has arrived yet.");

  // The list after a reload (locked again): what is held is counted, and more may wait.
  await page.goto("/my");
  await pickDevAccount(page, 1);
  await expect(countOf(page, answered)).toHaveAttribute("data-value", "1");
  await expect(countOf(page, answered)).toHaveText("1 answer here — unlock to check for more.");
  await expect(countOf(page, quiet)).toHaveText("Answers are locked — unlock to check.");

  expect(logs.unbounded).toEqual([]);
});

test("with no relay in reach the screen says it can't check, not that there are no answers", async ({ page }) => {
  const quiet = myRaise("--title", "Who has a spare bicycle pump?");
  // Every connection to the stand's relay is closed as it is made: the relay is out of reach from this browser.
  await page.routeWebSocket(stand.relay!, (socket) => void socket.close());

  await page.goto("/my");
  await keepOnDevice(page, quiet);
  await page.reload();
  await pickDevAccount(page, 1);
  await expect(countOf(page, quiet)).toHaveAttribute("data-state", "locked");
  await unlock(page);
  await expect(countOf(page, quiet)).toHaveAttribute("data-state", "unreachable");
  await expect(countOf(page, quiet)).toHaveText("No relay can be reached right now, so answers can't be checked.");
  await expect(page.getByTestId("my-list")).not.toContainText("No answers yet");

  await page.goto(`/my/${quiet.chainId}/${quiet.handId}`);
  await pickDevAccount(page, 1);
  await unlock(page);
  const section = page.getByTestId("my-answers");
  await expect(section).toHaveAttribute("data-state", "unreachable");
  await expect(section).toContainText("No relay can be reached right now, so answers can't be checked.");
  await expect(section).not.toContainText("Nothing has arrived yet.");
});

test("one Give is one inbox record under its giveHash: sent twice through the relay, heard again after a reload, its first-seen time stays; a thank kept as an intent shows as on its way", async ({ page }) => {
  const give = craft<{ ok: boolean; address: string; giveHash: string }>("give", liveAddress, "--giver", "5");
  expect(give.ok).toBe(true);
  const words = "The library on the corner: quiet until noon.";
  for (let i = 0; i < 2; i++) expect(craft<{ ok: boolean }>("deliver-send", give.address, "--text", words).ok).toBe(true);

  await openMine(page, mine);
  await page.goto(`/my/${mine.chainId}/${mine.handId}`);
  await pickDevAccount(page, 1);
  await unlock(page);
  const card = page.locator(`[data-testid="my-answer"][data-value="${give.giveHash}"]`);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toHaveCount(1);
  type Row = { id: string; hand: string; giveLink: string; firstSeen: number; words?: string };
  const ofThisGive = async () => (await deviceAll<Row>(page, "inbox")).filter((row) => row.giveLink === give.address);
  await expect.poll(async () => (await ofThisGive()).map((row) => row.id)).toEqual([give.giveHash]);
  const first = (await ofThisGive())[0]!;
  expect(first.words).toBe(words);

  // A reload is a new session: the relay sends both wraps again; nothing writes over the first time.
  await page.reload();
  await pickDevAccount(page, 1);
  await unlock(page);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2_000);
  expect((await ofThisGive()).map((row) => [row.id, row.firstSeen])).toEqual([[give.giveHash, first.firstSeen]]);

  // A thank this device sent and has not seen through: /my says it is on its way.
  const hash = `0x${"ab".repeat(32)}`;
  await devicePut(page, [
    { store: "inbox", value: { id: `on-way-${mine.handId}`, hand: keyOf(mine), giveLink: give.address, firstSeen: first.firstSeen, thank: { kind: "tx", chainId: mine.chainId, hash, step: 0, of: 1 } } },
  ]);
  await page.goto("/my");
  const onWay = page.locator(`[data-testid="my-thank-on-way"][data-value="on-way-${mine.handId}"]`);
  await expect(onWay).toBeVisible({ timeout: 20_000 });
  await expect(onWay).toHaveAttribute("data-state", "on-way");
  await expect(onWay).toContainText(`hand ${mine.handId}`);
  await deviceDelete(page, "inbox", `on-way-${mine.handId}`);
});

test("the seed's test book rebuilds a seeded hand's link on this device; it opens, its words not arrived", async ({ page }) => {
  const logs = watchLogs(page);
  const run = seed<{ book: string; fixtures: { unlisted: { handId: string; title: string } } }>(standSlot(), ["unlisted"]);
  const seeded = run.fixtures.unlisted;

  await page.goto("/my");
  await pickDevAccount(page, 1);
  await page.getByTestId("shell-lens").click();
  await page.getByTestId("my-rebuild-input").fill(run.book);
  await page.getByTestId("my-rebuild-hand").fill(String(seeded.handId));
  await page.getByTestId("my-rebuild-submit").click();
  const result = page.getByTestId("my-rebuild-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toContainText("they are never on the chain");
  const address = (await result.getAttribute("data-value"))!;
  expect(address.startsWith(`${stand.site}/#`)).toBe(true);

  const opened = craft<{ ok: boolean; handId: string; description: { status: string } }>("open", address);
  expect(opened).toMatchObject({ ok: true, handId: String(seeded.handId), description: { status: "lost" } });

  // Kept in the list with its place, so it shows without words, and this device knows it now.
  await expect(page.locator(`[data-testid="my-item"][data-value="${stand.chainId}:${stand.core.toLowerCase()}:${seeded.handId}"]`)).toContainText(`Hand ${seeded.handId}`);

  // A code that is not 16 hex characters is refused in words.
  await page.getByTestId("my-rebuild-input").fill("12345");
  await page.getByTestId("my-rebuild-submit").click();
  await expect(page.getByTestId("my-rebuild-error")).toHaveAttribute("data-value", "my.lens.rebuildBadCode");

  expect(logs.unbounded).toEqual([]);
});

test("Add a hand by its number refuses another account's hand and keeps one of its own; hands passed on show their state", async ({ page }) => {
  const logs = watchLogs(page);
  const theirs = myRaise("--account", "2", "--title", "Raised by someone else");
  const run = seed<{ fixtures: { public: { handId: string } } }>(standSlot(), ["public"]);
  const own = String(run.fixtures.public.handId);

  await page.goto("/my");
  await devicePut(page, [
    { store: "passed", value: { id: `smoke-passed-${mine.handId}`, hand: handKey(mine.chainId, mine.core, mine.handId), chainId: mine.chainId, core: mine.core, handId: mine.handId, position: 0 } },
  ]);
  await page.reload();
  await pickDevAccount(page, 1);
  // The connect sheet is a modal <dialog>: until the account is connected and it closes, the page
  // behind it is inert and a fill there types into nothing (the field read empty: "my.add.bad").
  await expect(page.getByTestId("wallet-connected").first()).toHaveAttribute("data-value", account(1).address);

  await page.getByTestId("my-add-by-number-input").fill(theirs.handId);
  await page.getByTestId("my-add-by-number-submit").click();
  await expect(page.getByTestId("my-add-by-number-error")).toHaveAttribute("data-value", "my.add.notYours");
  await expect(page.getByTestId("my-add-by-number-error")).toContainText("raised by another account");
  await expect(page.locator(`[data-testid="my-item"][data-value="${keyOf(theirs)}"]`)).toHaveCount(0);

  await page.getByTestId("my-add-by-number-input").fill(own);
  await page.getByTestId("my-add-by-number-submit").click();
  const added = page.locator(`[data-testid="my-item"][data-value="${stand.chainId}:${stand.core.toLowerCase()}:${own}"]`);
  await expect(added).toBeVisible();
  // Added by its number alone, this device has no reply key for it: unlocked, it says so, not "No answers yet".
  await expect(added.getByTestId("my-answer-count")).toHaveAttribute("data-state", "locked");
  await unlock(page);
  await expect(added.getByTestId("my-answer-count")).toHaveAttribute("data-state", "no-key");
  await expect(added.getByTestId("my-answer-count")).toHaveText("This device doesn't hold this hand's reply key, so it can't read its answers.");

  await expect(page.locator(`[data-testid="my-passed-item"][data-value="${keyOf(mine)}"]`)).toHaveAttribute("data-state", "open");

  expect(logs.unbounded).toEqual([]);
});

test("an account that answers differently each time: replies still open from the kept inbox key, and the screen says why the link can't be shown again", async ({ page }) => {
  const logs = watchLogs(page);
  // Account 5 in the dev wallet confirms with added entropy, so two confirmations differ.
  const differs = myRaise("--account", "5", "--title", "Who can fix a bicycle wheel this week?");
  await page.goto("/my");
  await keepOnDevice(page, differs, false);
  await page.goto(`/my/${differs.chainId}/${differs.handId}`);
  await pickDevAccount(page, 5);
  await unlock(page);
  await expect(page.getByTestId("my-unlock")).toContainText("answers differently each time");

  await page.getByTestId("my-show-link").click();
  await expect(page.getByTestId("my-link-refused")).toHaveAttribute("data-value", "my.link.copyDropped");

  // The helper answers on the link the raiser saved and sent out.
  const words = "I can, Thursday after six.";
  const give = craft<{ ok: boolean; address: string; giveHash: string }>("give", differs.address, "--giver", "4");
  expect(give.ok).toBe(true);
  expect(craft<{ ok: boolean }>("deliver-send", give.address, "--to", differs.inbox, "--text", words).ok).toBe(true);
  await expect(page.locator(`[data-testid="my-answer"][data-value="${give.giveHash}"]`)).toContainText(words, { timeout: 20_000 });

  expect(logs.unbounded).toEqual([]);
});
