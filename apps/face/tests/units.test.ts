import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import { configFromEnv } from "../src/config.ts";
import { cspFor, inlineScriptHashes } from "../src/headers.ts";
import { cardOf, escapeHtml, oneLine, withCard } from "../src/meta.ts";
import { drawable } from "../src/og.tsx";
import type { Preview } from "../src/preview.ts";
import { fileIn } from "../src/static.ts";
import { WORDS, amountText, day, langOf, termsLine } from "../src/words.ts";

const USD = { symbol: "mUSD", decimals: 6 };
// 2026-12-20 00:00 UTC
const DEC_20 = 1_797_724_800;

describe("words", () => {
  it("writes dollars as the app does, cents cut", () => {
    expect(amountText(40_000_000n, USD, "en")).toBe("$40");
    expect(amountText(1_250_509_999n, USD, "en")).toBe("$1,250.50");
    expect(amountText(800_000n, USD, "ru")).toBe("$0,80");
    expect(amountText(1n, USD, "en")).toBe("under $0.01");
    expect(amountText(15n * 10n ** 17n, { symbol: "WETH", decimals: 18 }, "en")).toBe("1.5 WETH");
  });

  it("writes a day in UTC in both languages", () => {
    expect(day(DEC_20, "en")).toBe("20 Dec");
    expect(day(DEC_20, "ru")).toBe("20 дек");
  });

  it("a Hand with no reward says a thank-you only and never an amount", () => {
    for (const lang of ["en", "ru"] as const) {
      for (const state of ["open", "expired", "thanked", "refunded"] as const) {
        const line = termsLine({ state, date: DEC_20 }, lang);
        expect(line).not.toContain("$");
        expect(line).not.toMatch(/\b0\b/);
      }
    }
    expect(termsLine({ state: "open", date: DEC_20 }, "en")).toBe("No reward: a thank-you only · open until 20 Dec");
    expect(termsLine({ state: "open", date: DEC_20 }, "ru")).toBe("Без награды: только спасибо · открыта до 20 дек");
    expect(termsLine({ state: "open", date: DEC_20, amount: "$40" }, "en")).toBe("$40 reward · open until 20 Dec");
    expect(termsLine({ state: "open", date: DEC_20, amount: "$40" }, "ru")).toBe("Награда $40 · открыта до 20 дек");
  });

  it("picks the language from l=, then Accept-Language, then English", () => {
    expect(langOf(new URLSearchParams("l=ru"), "en")).toBe("ru");
    expect(langOf(new URLSearchParams(""), "ru-RU,ru;q=0.9,en;q=0.8")).toBe("ru");
    expect(langOf(new URLSearchParams(""), "de-DE,en;q=0.5,ru;q=0.4")).toBe("en");
    expect(langOf(new URLSearchParams(""), "fr")).toBe("en");
    expect(langOf(new URLSearchParams(""), undefined)).toBe("en");
  });
});

describe("tags", () => {
  const INDEX = `<!doctype html><html><head><title>aHand</title><meta property="og:title" content="old" /></head><body></body></html>`;
  const hand: Preview = {
    kind: "hand",
    chainId: 31337,
    core: "0x65ac707E2AE7392583de5d6192C619F1D8862309",
    handId: 7n,
    path: "/31337/7",
    d: "AQID",
    title: `"><script>alert(1)</script>`,
    state: "open",
    date: DEC_20,
    reward: { amount: 40_000_000n, ...USD },
    block: 12n,
  };

  it("escapes every word a raiser wrote", () => {
    const html = withCard(INDEX, cardOf(hand, "http://127.0.0.1:1", "en", false));
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&#34;&#62;&#60;script&#62;");
    expect(escapeHtml(`a&b<c>"d'`)).toBe("a&#38;b&#60;c&#62;&#34;d&#39;");
  });

  it("replaces tags the page had, and links the image with d, theme and language", () => {
    const html = withCard(INDEX, cardOf(hand, "http://127.0.0.1:1", "ru", true));
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(html).toContain(`<meta property="og:image" content="http://127.0.0.1:1/og/31337/7.png?d=AQID&#38;th=d&#38;l=ru" />`);
    expect(html).toContain(`content="Награда $40 · открыта до 20 дек."`);
    expect(html).toContain(`<meta name="twitter:card" content="summary_large_image" />`);
  });

  it("the generic card keeps the page's own title", () => {
    const html = withCard(INDEX, cardOf({ kind: "generic" }, "http://x.test", "en", false, "/raise"));
    expect(html).toContain("<title>aHand</title>");
    expect(html).toContain(`content="${WORDS.en.genericTitle}"`);
    expect(html).toContain(`content="http://x.test/og/generic.png"`);
  });

  it("cuts a long line at a word", () => {
    expect(oneLine("one two three four", 12)).toBe("one two…");
    expect(oneLine("  a\n b ", 10)).toBe("a b");
  });

  it("leaves out of the picture only what no font draws", () => {
    expect(drawable("Ищу квартиру 🙂 в Ереване 👩🏽‍💻")).toBe("Ищу квартиру в Ереване");
    expect(drawable("Café № 5 — ok?")).toBe("Café № 5 — ok?");
  });
});

describe("headers", () => {
  it("is the CSP of ARCHITECTURE §11, with the RPC and relays", () => {
    const csp = cspFor({ rpc: "http://127.0.0.1:18545", relays: ["ws://127.0.0.1:18547"] });
    expect(csp).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; " +
        "connect-src 'self' http://127.0.0.1:18545 ws://127.0.0.1:18547; worker-src 'none'; object-src 'none'; " +
        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  });

  it("names the hash of each inline script, and only those", () => {
    const html = `<script type="module" src="/a.js"></script><script type="module">console.log(1)</script>`;
    expect(inlineScriptHashes(html)).toEqual(["'sha256-CihokcEcBW4atb/CW/XWsvWwbTjqwQlE9nj9ii5ww5M='"]);
    expect(cspFor({ rpc: "http://r.test", relays: [] }, { anyRpc: true })).toContain("connect-src 'self' http://r.test https: http://127.0.0.1:* http://localhost:*");
    // exit.html carries its fonts inline (one self-contained file); the app's pages do not.
    expect(cspFor({ rpc: "http://r.test", relays: [] }, { anyRpc: true })).toContain("font-src 'self' data:;");
    expect(cspFor({ rpc: "http://r.test", relays: [] })).toContain("font-src 'self';");
  });
});

describe("static files", () => {
  const dist = mkdtempSync(join(tmpdir(), "face-static-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), "i");
  writeFileSync(join(dist, "assets", "a.js"), "a");

  it("finds files inside the folder and nothing outside it", async () => {
    expect(await fileIn(dist, "/assets/a.js")).toBe(join(dist, "assets", "a.js"));
    expect(await fileIn(dist, "/assets/%61.js")).toBe(join(dist, "assets", "a.js"));
    expect(await fileIn(dist, "/assets")).toBeUndefined();
    expect(await fileIn(dist, "/../../etc/passwd")).toBeUndefined();
    expect(await fileIn(dist, "/%2e%2e/%2e%2e/etc/passwd")).toBeUndefined();
    expect(await fileIn(dist, "/a%00.js")).toBeUndefined();
    expect(await fileIn(dist, "/%E0%A4%A")).toBeUndefined();
  });
});

describe("configuration", () => {
  const env = {
    FACE_PORT: "16199",
    FACE_DIST: "/tmp/x",
    FACE_RPC: "http://127.0.0.1:18545",
    FACE_CHAIN: "31337",
    FACE_CORES: "0x65ac707e2ae7392583de5d6192c619f1d8862309",
    FACE_CANONICAL: "0x65ac707E2AE7392583de5d6192C619F1D8862309",
    FACE_SITE: "http://127.0.0.1:18300/",
  };

  it("reads the names of ARCHITECTURE §14", () => {
    const config = configFromEnv(env);
    expect(config.port).toBe(16199);
    expect(config.chainId).toBe(31337);
    expect(config.trusted).toEqual(["0x65ac707E2AE7392583de5d6192C619F1D8862309"]);
    expect(config.canonical).toBe("0x65ac707E2AE7392583de5d6192C619F1D8862309");
    expect(config.site).toBe("http://127.0.0.1:18300");
    expect(config.relays).toEqual([]);
  });

  it("refuses what it cannot use, in a sentence", () => {
    expect(() => configFromEnv({ ...env, FACE_CORES: "" })).toThrow("FACE_CORES names no Core");
    expect(() => configFromEnv({ ...env, FACE_CHAIN: "x" })).toThrow("FACE_CHAIN");
    expect(() => configFromEnv({ ...env, FACE_CANONICAL: "0x0000000000000000000000000000000000000001" })).toThrow("not among");
    expect(() => configFromEnv({ ...env, FACE_RELAYS: "http://x" })).toThrow("WebSocket");
    expect(() => configFromEnv({ ...env, FACE_SITE: undefined })).toThrow("FACE_SITE is not set");
  });
});
