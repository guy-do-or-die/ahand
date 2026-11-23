/**
 * The atlas: every screen of the app in every state the stand can be put in, to click through
 * without doing anything on a chain. A fresh stand on a free slot (about 3 s), every seed fixture
 * of infra/stand/seed.ts (about 2 s: open, public, dark, a lost-and-found tag, a route with two
 * passes, an answer, a re-signed route, a helper not set up yet, no reward, thanked, time's up,
 * sent back, a blocked payee's share waiting), then a picture of each screen in each state, in
 * English and Russian, light and dark, the lens off and on, and one page that shows them with the
 * switches and a link that opens the same screen live on the stand.
 *
 *   bun tests/demo/atlas.ts [--only hand,thank] [--langs ru,en] [--themes light,dark] [--lens off,on] [--widths 390,1280] [--down]
 *   bun tests/demo/atlas.ts --repo ../design-pass-copy --out tests/demo/.atlas-design   # another branch's checkout
 *
 * --repo shoots another checkout of this repository (a branch with another design, say): its stand,
 * its seed and its routes, with this engine; it must have its dependencies installed and contracts built.
 *
 * The page: tests/demo/.atlas/index.html. The stand stays up so the live links work (--down takes it
 * down at the end; `bun infra/stand/stand.ts down --slot N` later). Everything on screen is made by
 * Core on the stand: no mock draws a state it could not reach.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { chromium, expect, type Browser, type Page } from "@playwright/test";

import { slotInUse } from "../../infra/stand/stand.ts";
import { quiet, visit } from "../e2e/guards/lib/guard";
import { lensOn } from "../e2e/lib/lens";

const argv = process.argv.slice(2);
const ENGINE = resolve(import.meta.dirname, "../..");
/** The checkout whose app the atlas shows: this one, or --repo. */
const REPO = argv.includes("--repo") ? resolve(argv[argv.indexOf("--repo") + 1]!) : ENGINE;
const OUT = argv.includes("--out") ? resolve(argv[argv.indexOf("--out") + 1]!) : join(ENGINE, "tests/demo/.atlas");
const list = (flag: string, all: string[]) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1]!.split(",") : all);
const LANGS = list("--langs", ["ru", "en"]) as ("ru" | "en")[];
const THEMES = list("--themes", ["light", "dark"]) as ("light" | "dark")[];
const LENSES = list("--lens", ["off", "on"]) as ("off" | "on")[];
/** A phone (390) and a desktop (1280), as tests/e2e/shots.spec.ts takes them. */
const WIDTHS = list("--widths", ["390", "1280"]).map(Number);
const ONLY = argv.includes("--only") ? argv[argv.indexOf("--only") + 1]!.split(",") : undefined;
const env = { ...(process.env as Record<string, string>), STAND_PORT_BASE: process.env.STAND_PORT_BASE ?? "47000" };
const bun = process.execPath;

type Fixture = Record<string, string> & { handId: string; address: string };
interface Seeded {
  chainId: number;
  site: string;
  accounts: Record<string, string>;
  fixtures: Record<string, Fixture>;
}

/** One picture: a screen in a state. `go` brings a fresh page to it; `live` is the address that opens it in a browser, if one does. */
interface Card {
  screen: string;
  state: { en: string; ru: string };
  go(page: Page): Promise<void>;
  live?: string;
  /** What shows the screen is ready (the shell's main region by default). */
  ready?: (page: Page) => Promise<void>;
}

function cards(s: Seeded): Card[] {
  const f = (name: string) => s.fixtures[name]!;
  const at = (path: string) => async (page: Page) => void (await page.goto(path, { waitUntil: "networkidle" }));
  const hand = (name: string, en: string, ru: string, key: "address" | "giveAddress" | "secondGiveAddress" | "firstGiveAddress" = "address"): Card => ({
    screen: "hand",
    state: { en, ru },
    go: (page) => visit(page, f(name)[key]!),
    live: f(name)[key],
  });
  const thank = (name: string, key: string, en: string, ru: string): Card => ({
    screen: "thank",
    state: { en, ru },
    go: async (page) => {
      await page.goto("/thank");
      await page.getByTestId("thank-input").fill(f(name)[key]!);
      await page.getByTestId("thank-open").click();
      // A prediction, or whatever the screen says instead (an answer already thanked, a problem): give it time to settle.
      await page.getByTestId("thank-predicted").waitFor({ timeout: 12_000 }).catch(() => undefined);
    },
  });
  const proof = (name: string, en: string, ru: string): Card => ({ screen: "proof", state: { en, ru }, go: at(`/${s.chainId}/${f(name).handId}/proof`), live: `/${s.chainId}/${f(name).handId}/proof` });
  const plain = (screen: string, path: string, en: string, ru: string, ready?: Card["ready"]): Card => ({ screen, state: { en, ru }, go: at(path), live: path, ...(ready ? { ready } : {}) });
  const form = (screen: "pass" | "give", en: string, ru: string): Card => ({
    screen,
    state: { en, ru },
    go: async (page) => {
      await visit(page, f("unlisted").address);
      await page.getByTestId(screen === "pass" ? "hand-pass" : "hand-help").click();
      await expect(page.getByTestId(screen === "pass" ? "pass-swipe" : "give-words")).toBeVisible({ timeout: 20_000 });
    },
  });
  return [
    plain("landing", "/", "the start", "начало"),
    plain("raise", "/raise", "empty form", "пустая форма"),
    hand("unlisted", "open, by link", "открыта, по ссылке"),
    hand("public", "open, public", "открыта, публичная"),
    hand("dark", "open, dark link", "открыта, тёмная ссылка"),
    hand("lost", "a lost-and-found tag", "бирка «потеряно-найдено»"),
    hand("twoPasses", "passed twice, shares kept", "передана дважды, с долями"),
    hand("noReward", "no reward", "без награды"),
    hand("give", "an answer's link", "ссылка ответа", "giveAddress"),
    hand("undeployed", "an answer from an account not set up yet", "ответ от неразвёрнутого аккаунта", "giveAddress"),
    hand("thanked", "thanked", "поблагодарили"),
    hand("expired", "time's up", "время вышло"),
    hand("refunded", "sent back", "награда возвращена"),
    hand("blocked", "thanked, a share waiting for a blocked payee", "поблагодарили, доля ждёт заблокированного"),
    { screen: "hand", state: { en: "by number, no link", ru: "по номеру, без ссылки" }, go: at(`/${s.chainId}/${f("thanked").handId}`), live: `/${s.chainId}/${f("thanked").handId}` },
    form("pass", "passing it on", "передать дальше"),
    form("give", "answering", "ответить"),
    plain("thank", "/thank", "empty", "пусто"),
    thank("give", "giveAddress", "an answer to thank", "ответ, за который благодарят"),
    thank("resigned", "secondGiveAddress", "a re-signed route: a holder left out", "переподписанный путь: держателя пропустили"),
    thank("undeployed", "giveAddress", "a helper's account not set up yet", "аккаунт помощника не развёрнут"),
    thank("noReward", "giveAddress", "no reward", "без награды"),
    thank("thanked", "giveAddress", "already thanked", "уже поблагодарили"),
    proof("thanked", "thanked", "поблагодарили"),
    proof("refunded", "sent back", "награда возвращена"),
    proof("expired", "time's up", "время вышло"),
    proof("blocked", "a share waiting", "доля ждёт"),
    proof("unlisted", "open", "открыта"),
    plain("waiting", `/waiting?for=${(f("blocked") as unknown as { pending: { payee: string } }).pending.payee}`, "money waiting for a blocked payee", "деньги ждут заблокированного"),
    plain("waiting", `/waiting?for=${s.accounts.holderA}`, "nothing waiting", "ничего не ждёт"),
    plain("care", `/care/${s.chainId}/${f("unlisted").handId}`, "open: top up, extend", "открыта: пополнить, продлить"),
    plain("care", `/care/${s.chainId}/${f("expired").handId}`, "time's up", "время вышло"),
    plain("my", "/my", "no wallet", "без кошелька"),
    plain("print", "/print", "empty", "пусто"),
    plain("check", "/check", "empty", "пусто"),
    plain("core", "/core", "the contract", "контракт"),
    plain("defaults", "/defaults", "the defaults", "настройки по умолчанию"),
    plain("without-us", "/without-us", "without the site", "без сайта"),
    plain("not-found", "/no/such/place", "no such page", "нет такой страницы"),
    plain("exit", "/exit.html", "the exit page", "страница выхода", async (page) => void (await expect(page.locator("body")).not.toBeEmpty())),
  ];
}

/**
 * Keeps the atlas whole as the app grows: every route of the app (apps/web/src/routes.ts) is a
 * screen of the atlas or is named here with the reason it is not. `--check-routes` runs only this
 * (no stand), and `bun run check` runs it, so a new screen without a place in the atlas fails the gate.
 */
const NOT_IN_ATLAS: Record<string, string> = {
  gallery: "the local workbench of components (gallery.html), not a screen people see",
  "dev-wallet": "the local builds' test wallet, not a screen people see",
};

/** Atlas screens that are not routes of the app, with the reason. */
const NOT_A_ROUTE: Record<string, string> = { exit: "exit.html, a file of the build that works without the site" };

export function routeGaps(screens: string[]): string[] {
  const text = readFileSync(join(REPO, "apps/web/src/routes.ts"), "utf8");
  const routes = [...new Set([...text.matchAll(/name: "([a-z-]+)"/g)].map((m) => m[1]!))];
  const gaps = routes.filter((r) => !screens.includes(r) && !(r in NOT_IN_ATLAS)).map((r) => `route "${r}" has no card in the atlas (tests/demo/atlas.ts cards) and no reason in NOT_IN_ATLAS`);
  for (const r of Object.keys(NOT_IN_ATLAS)) if (!routes.includes(r)) gaps.push(`NOT_IN_ATLAS names "${r}", which is no longer a route`);
  // And the other way: a card for a screen the app no longer has would picture its not-found page.
  for (const x of screens) if (!routes.includes(x) && !(x in NOT_A_ROUTE)) gaps.push(`the atlas has a card for "${x}", which is no longer a route of the app`);
  return gaps;
}

/**
 * The screens the atlas has cards for, read from the cards themselves without a stand: the cards
 * are built over a stand-in seed whose every value is a placeholder (nothing is visited).
 */
function screensOfCards(): string[] {
  const any: unknown = new Proxy({}, { get: (_t, key) => (key === "pending" ? { payee: "0x0" } : key === Symbol.toPrimitive ? () => "0" : "0") });
  const standIn = { chainId: 0, site: "http://stand-in.invalid", accounts: any, fixtures: new Proxy({}, { get: () => any }) } as unknown as Seeded;
  return [...new Set(cards(standIn).map((c) => c.screen))];
}
export const ATLAS_SCREENS = screensOfCards();

const slugOf = (c: Card, i: number) => `${String(i).padStart(2, "0")}-${c.screen}-${c.state.en.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`.replace(/-+$/, "");

async function shoot(browser: Browser, s: Seeded, card: Card, slug: string): Promise<string[]> {
  const made: string[] = [];
  for (const width of WIDTHS)
  for (const lang of LANGS)
    for (const theme of THEMES)
      for (const lens of LENSES) {
        const phone = width < 768;
        const context = await browser.newContext({
          baseURL: s.site,
          viewport: { width, height: phone ? 844 : 800 },
          deviceScaleFactor: phone ? 2 : 1,
          ...(phone ? { isMobile: true, hasTouch: true } : {}),
          colorScheme: theme,
          locale: lang === "ru" ? "ru-RU" : "en-US",
          reducedMotion: "reduce",
        });
        await quiet(context, s.site);
        const page = await context.newPage();
        page.on("dialog", (d) => void d.accept());
        try {
          if (lens === "on") await lensOn(page);
          await card.go(page);
          if (card.ready) await card.ready(page);
          else await expect(page.getByTestId("shell-main")).toBeVisible({ timeout: 20_000 });
          await page.waitForTimeout(1_200);
          const file = `${slug}/${lang}-${theme}-${lens}-${width}.jpg`;
          mkdirSync(join(OUT, slug), { recursive: true });
          await page.screenshot({ path: join(OUT, file), fullPage: true, type: "jpeg", quality: 72, animations: "disabled" });
          made.push(file);
        } catch (error) {
          console.log(`atlas: ${slug} ${width} ${lang} ${theme} lens ${lens}: ${(error as Error).message.split("\n")[0]}`);
        } finally {
          await context.close();
        }
      }
  return made;
}

const BRANCH = (() => {
  const git = (args: string[]) => spawnSync("git", args, { cwd: REPO, encoding: "utf8" }).stdout.trim();
  const name = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  return `${name === "HEAD" ? git(["describe", "--all", "--always"]) : name} ${git(["rev-parse", "--short", "HEAD"])}`;
})();

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** Each screen's name on the page, in the page's two languages. */
const SCREEN_NAMES: Record<string, [string, string]> = {
  landing: ["The start", "Главная"], raise: ["Raise a hand", "Поднять руку"], hand: ["A hand", "Рука"], pass: ["Pass it on", "Передать дальше"],
  give: ["Answer", "Ответить"], thank: ["Thank", "Поблагодарить"], proof: ["The passport", "Паспорт"], waiting: ["Money waiting", "Ожидающие деньги"],
  care: ["Care", "Забота о руке"], my: ["My hands", "Мои руки"], print: ["Print", "Печать"], check: ["Check", "Проверка"], core: ["The contract", "Контракт"],
  defaults: ["The defaults", "Настройки по умолчанию"], "without-us": ["Without us", "Без нас"],
  "not-found": ["No such page", "Нет такой страницы"], exit: ["The exit page", "Страница выхода"],
};
/** The switches' own words. */
const VALUE_NAMES: Record<string, [string, string]> = { light: ["light", "светлая"], dark: ["dark", "тёмная"], off: ["lens off", "лупа выкл."], on: ["lens on", "лупа вкл."], "390": ["phone", "телефон"], "1280": ["desktop", "десктоп"] };

function page(s: Seeded, rows: { card: Card; slug: string; shots: string[] }[], slot: number): string {
  const screens = [...new Set(rows.map((r) => r.card.screen))];
  const first = LANGS[0]!;
  // Every word of the page in both languages; the language switch changes the page as well as the pictures.
  const t = (en: string, ru: string, tag = "span", attrs = "") => `<${tag}${attrs} data-en="${esc(en)}" data-ru="${esc(ru)}">${esc(first === "ru" ? ru : en)}</${tag}>`;
  const sw = (name: string, values: string[]) =>
    `<span class="sw" data-name="${name}">${values.map((v, i) => { const [en, ru] = VALUE_NAMES[v] ?? [v, v]; return t(en, ru, "button", ` type="button" data-v="${v}"${i === 0 ? ' aria-pressed="true"' : ""}`); }).join("")}</span>`;
  const screenName = (x: string) => SCREEN_NAMES[x] ?? [x, x];
  return `<!doctype html><html lang="${first}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${first === "ru" ? "aHand: атлас экранов" : "aHand: the screens' atlas"}</title>
<style>
:root{--bg:#faf8f2;--ink:#16181d;--mute:#5b6070;--card:#fff;--line:#e4e0d4}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--ink:#e8e8e8;--mute:#9aa0ad;--card:#171a20;--line:#2a2f38}}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
h1{font-size:16px;margin:0 8px 0 0}.sw{display:inline-flex;border:1px solid var(--line);border-radius:999px;overflow:hidden}
.sw button{font:inherit;border:0;background:none;color:var(--ink);padding:3px 10px;cursor:pointer}.sw button[aria-pressed=true]{background:var(--ink);color:var(--bg)}
nav a{color:var(--ink);margin-right:10px}main{padding:12px 16px 40px}h2{margin:22px 0 8px;font-size:18px}
.row{display:flex;gap:14px;overflow-x:auto;padding-bottom:8px}.card{flex:0 0 auto;width:232px}
.card img{width:232px;height:502px;object-fit:cover;object-position:top;border:1px solid var(--line);border-radius:12px;display:block;background:var(--card)}
.card p{margin:6px 0 0;font-size:13px}
body[data-width="1280"] .card{width:480px}body[data-width="1280"] .card img{width:480px;height:300px}.card a{font-size:12px;color:var(--mute)}.none{color:var(--mute);font-size:12px}
</style>
<header>${t("The screens' atlas", "Атлас экранов", "h1")}${sw("width", WIDTHS.map(String))}${sw("lang", LANGS)}${sw("theme", THEMES)}${sw("lens", LENSES)}${t(`${BRANCH} · stand: slot ${slot}, ${s.site} · ${rows.length} states`, `${BRANCH} · стенд: слот ${slot}, ${s.site} · ${rows.length} состояний`, "span", ' class="none"')}</header>
<main><nav>${screens.map((x) => t(screenName(x)[0], screenName(x)[1], "a", ` href="#${x}"`)).join("")}</nav>
${screens
  .map(
    (x) => `${t(screenName(x)[0], screenName(x)[1], "h2", ` id="${x}"`)}<div class="row">${rows
      .filter((r) => r.card.screen === x)
      .map((r) => {
        const first = r.shots[0];
        return `<div class="card" data-slug="${r.slug}">${first ? `<a href="${r.slug}/${LANGS[0]}-${THEMES[0]}-${LENSES[0]}-${WIDTHS[0]}.jpg" target="_blank"><img loading="lazy" alt="" src="${r.slug}/${LANGS[0]}-${THEMES[0]}-${LENSES[0]}-${WIDTHS[0]}.jpg"></a>` : t("no picture", "снимка нет", "p", ' class="none"')}
${t(r.card.state.en, r.card.state.ru, "p")}${r.card.live ? t("open it live ↗", "открыть вживую ↗", "a", ` href="${esc(new URL(r.card.live, s.site).href)}" target="_blank"`) : t("reached by steps", "открывается шагами", "span", ' class="none"')}</div>`;
      })
      .join("")}</div>`,
  )
  .join("\n")}
</main>
<script>
const pick = { width: "${WIDTHS[0]}", lang: "${LANGS[0]}", theme: "${THEMES[0]}", lens: "${LENSES[0]}" };
for (const sw of document.querySelectorAll(".sw")) sw.addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  for (const o of sw.querySelectorAll("button")) o.setAttribute("aria-pressed", String(o === b));
  pick[sw.dataset.name] = b.dataset.v; draw();
});
function draw() {
  document.body.dataset.width = pick.width;
  document.documentElement.lang = pick.lang;
  document.title = pick.lang === "ru" ? "aHand: атлас экранов" : "aHand: the screens' atlas";
  for (const el of document.querySelectorAll("[data-en]")) el.textContent = el.dataset[pick.lang];
  for (const card of document.querySelectorAll(".card")) {
    const img = card.querySelector("img"); if (img) { const src = card.dataset.slug + "/" + pick.lang + "-" + pick.theme + "-" + pick.lens + "-" + pick.width + ".jpg"; img.src = src; img.parentElement.href = src; }
  }
}
</script></html>
`;
}

// Run as a script only: importing the file (for its route check) starts nothing.
if (import.meta.main) await main();

async function main(): Promise<void> {
  {
    const gaps = routeGaps(ATLAS_SCREENS);
    if (gaps.length) {
      console.error(`atlas: ${gaps.join("\n  ")}`);
      process.exit(1);
    }
    if (argv.includes("--check-routes")) {
      console.log("atlas: every route of the app has a screen in the atlas");
      process.exit(0);
    }
  }

  process.env.STAND_PORT_BASE = env.STAND_PORT_BASE;
  let slot = -1;
  for (let n = 1; n <= 8 && slot < 0; n++) if ((await slotInUse(n)).length === 0) slot = n;
  if (slot < 0) throw new Error("no free stand slot from 1 to 8");
  const run = (args: string[]) => spawnSync(bun, args, { cwd: REPO, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  console.log(`atlas: stand slot ${slot}`);
  if (run(["infra/stand/stand.ts", "up", "--slot", String(slot)]).status !== 0) throw new Error("the stand did not come up");
  try {
    const seeded = run(["infra/stand/seed.ts", "--slot", String(slot), "--json"]);
    if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stderr.slice(-2000)}`);
    const s = JSON.parse(seeded.stdout) as Seeded;
    console.log(`atlas: ${Object.keys(s.fixtures).length} fixtures on ${s.site}`);
    // --only shoots some screens again and keeps the others' pictures.
    if (!ONLY) rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    const rows: { card: Card; slug: string; shots: string[] }[] = [];
    try {
      for (const [i, card] of cards(s).entries()) {
        const slug = slugOf(card, i);
        const shots = !ONLY || ONLY.includes(card.screen) ? await shoot(browser, s, card, slug) : existsSync(join(OUT, slug)) ? readdirSync(join(OUT, slug)).map((f) => `${slug}/${f}`) : [];
        rows.push({ card, slug, shots });
        console.log(`atlas: ${slug} (${shots.length})`);
      }
    } finally {
      await browser.close();
    }
    writeFileSync(join(OUT, "index.html"), page(s, rows, slot));
    const expected = WIDTHS.length * LANGS.length * THEMES.length * LENSES.length;
    const short = rows.filter((r) => (!ONLY || ONLY.includes(r.card.screen)) && r.shots.length < expected);
    if (short.length) process.exitCode = 1;
    console.log(`atlas: ${join(OUT, "index.html")}, ${rows.reduce((n, r) => n + r.shots.length, 0)} pictures`);
  } finally {
    if (argv.includes("--down")) run(["infra/stand/stand.ts", "down", "--slot", String(slot)]);
    else console.log(`atlas: the stand stays up for the live links: bun infra/stand/stand.ts down --slot ${slot}`);
  }
}
