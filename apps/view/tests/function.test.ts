import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { fromBase64Url, refundCall, toText } from "@ahand/sdk";
import { ANVIL_KEYS, startChain, type Chain } from "@ahand/sdk/testing";

import { isolate } from "@ahand/card";
import { tokensOf, viewTokensOf } from "../src/config.ts";
import { viewFunction, type FunctionConfig } from "../src/function.ts";
import { cspFor, inlineScriptHashes } from "../src/headers.ts";
import { metaOf, pngSize, raiseHand, send, unescape, USD, type RaiseOptions } from "./hands.ts";

/**
 * The view server as one serverless function (function.ts), called the way a Node.js function
 * runtime calls it: with a web Request. It runs against a chain of its own with Hands raised
 * through the SDK, and with tests/fixtures/index.html standing in for the app's built index.html
 * (in a deployment the app's build supplies the real one beside the bundle; function-entry.ts).
 */

const SITE = "https://ahand.example";
const raiser = ANVIL_KEYS[1]!;
const GENERIC_TITLE = "Someone raised a hand.";
const RPC = "https://rpc.example";
const RELAYS = ["wss://relay.example"];

let chain: Chain;
let handle: (request: Request) => Promise<Response>;
const index = readFileSync(join(import.meta.dir, "fixtures/index.html"), "utf8");
const config: Omit<FunctionConfig, "chainId" | "trusted" | "canonical" | "tokens"> = { rpc: RPC, relays: RELAYS, privy: true };

const raise = (opts: RaiseOptions) => raiseHand(chain, SITE, raiser, opts);
const call = async (path: string, init: RequestInit = {}) => {
  const response = await handle(new Request(`${SITE}${path}`, init));
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { response, status: response.status, bytes, text: new TextDecoder().decode(bytes), header: (name: string) => response.headers.get(name) };
};
/** The page with the server's tags taken out and the built title put back: must be index.html byte for byte. */
const untagged = (page: string) =>
  page
    .replace(/ {4}<meta (?:property|name)="[^"]*" content="[^"]*" \/>(?:\n {4}<meta (?:property|name)="[^"]*" content="[^"]*" \/>)*\n {2}(?=<\/head>)/, "")
    .replace(/<title>[\s\S]*?<\/title>/, "<title>aHand</title>");

beforeAll(async () => {
  chain = await startChain();
  // The function reads the test chain through its client; the RPC and relays it names in the CSP
  // are the configuration's.
  const fn: FunctionConfig = { ...config, chainId: chain.chainId, trusted: [chain.core], canonical: chain.core, tokens: tokensOf(viewTokensOf(chain.tokens)) };
  handle = viewFunction(fn, index, { client: chain.client, previewTtlMs: 0 });
}, 60_000);

afterAll(async () => {
  await chain?.stop();
});

describe("the view function, called with Requests", () => {
  test("an unlisted Hand's address: index.html as built with the Hand's tags, the app's headers, no-cache", async () => {
    const title = "Looking for a sublet in Yerevan for June";
    const { before } = await raise({ mode: "unlisted", title, content: "Two rooms, near the metro. Hidden from robots.", reward: 40n * USD });
    expect(before).toMatch(/^\/31337\/\d+\?d=[A-Za-z0-9_-]+$/);
    const page = await call(before);
    expect(page.status).toBe(200);
    expect(unescape(metaOf(page.text, "og:title"))).toBe(isolate(title));
    expect(metaOf(page.text, "og:description")).toMatch(/^Reward \$40 · open until \d{1,2}\u00a0[A-Z][a-z]{2}\.$/);
    expect(page.text).not.toContain("Hidden from robots");
    expect(unescape(metaOf(page.text, "og:image"))).toBe(`${SITE}/og${before.replace("?", ".png?")}`);
    expect(unescape(metaOf(page.text, "og:url"))).toBe(`${SITE}${before}`);
    expect(page.text).toContain(`<title>${isolate(title)} · aHand</title>`);
    expect(untagged(page.text)).toBe(index);
    expect(page.header("content-type")).toBe("text/html; charset=utf-8");
    expect(page.header("cache-control")).toBe("no-cache");
    expect(page.header("vary")).toBe("Accept-Language");
    expect(page.header("content-length")).toBe(String(page.bytes.byteLength));
    expect(page.header("content-security-policy")).toBe(cspFor({ rpc: RPC, relays: RELAYS, privy: true }, { inline: inlineScriptHashes(page.text) }));
    expect(page.header("referrer-policy")).toBe("no-referrer");
    // The host in front sends Strict-Transport-Security for every answer, its files included.
    expect(page.header("strict-transport-security")).toBeNull();

    const ru = await call(before, { headers: { "Accept-Language": "ru-RU,ru;q=0.9" } });
    expect(metaOf(ru.text, "og:description")).toStartWith("Награда $40 · рука открыта до ");
    expect(unescape(metaOf(ru.text, "og:image"))).toBe(`${SITE}/og${before.replace("?", ".png?")}&l=ru`);

    const head = await call(before, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.bytes.byteLength).toBe(0);
    expect((await call(before, { method: "POST" })).status).toBe(405);
  });

  test("its card: a 1200×630 PNG kept five minutes, another in dark; the generic card for a wrong d", async () => {
    const { before } = await raise({ mode: "unlisted", title: "A PNG for this hand", reward: 12n * USD });
    const path = `/og${before.replace("?", ".png?")}`;
    const card = await call(path);
    expect(card.status).toBe(200);
    expect(card.header("content-type")).toBe("image/png");
    expect(card.header("cache-control")).toBe("public, max-age=300");
    expect(card.header("vary")).toBe("Accept-Language");
    expect(pngSize(card.bytes)).toEqual({ magic: "89504e470d0a1a0a", width: 1200, height: 630 });
    const dark = await call(`${path}&th=d`);
    expect(pngSize(dark.bytes)).toMatchObject({ width: 1200, height: 630 });
    expect(Buffer.from(dark.bytes).equals(Buffer.from(card.bytes))).toBe(false);
    const generic = await call("/og/generic.png");
    expect(pngSize(generic.bytes)).toMatchObject({ width: 1200, height: 630 });
    const wrong = await call(`/og/31337/999999.png?d=AAAA`);
    expect(Buffer.from(wrong.bytes).equals(Buffer.from(generic.bytes))).toBe(true);
  });

  test("a numbered address shows the terms under the generic title; a public Hand its details", async () => {
    const { before } = await raise({ mode: "unlisted", title: "Not for robots without d", reward: 25n * USD });
    const numbered = await call(before.split("?")[0]!);
    expect(unescape(metaOf(numbered.text, "og:title"))).toBe(GENERIC_TITLE);
    expect(metaOf(numbered.text, "og:description")).toStartWith("Reward $25 · open until ");
    expect(numbered.text).not.toContain("Not for robots");
    expect(numbered.text).toContain("<title>aHand</title>");

    const open = await raise({ mode: "public", title: "Who can fix a 1978 Vespa?", content: "It stalls at idle.", reward: 0n });
    const page = await call(open.before);
    expect(unescape(metaOf(page.text, "og:title"))).toBe(isolate("Who can fix a 1978 Vespa?"));
    expect(metaOf(page.text, "og:description")).toEndWith(`. The asker wrote: “${isolate("It stalls at idle.")}”`);
  });

  test("an unknown Hand, a mismatching d, a dark Hand, another chain and an untrusted Core: the generic card, 200", async () => {
    const dark = await raise({ mode: "dark", title: "Dark words", reward: 5n * USD });
    expect(dark.before).toBe("/"); // a dark Hand's address carries nothing before `#`: the host serves the static index
    const unlisted = await raise({ mode: "unlisted", title: "Tamper with me", reward: 2n * USD });
    const [path, d] = unlisted.before.split("?d=") as [string, string];
    const bytes = fromBase64Url(d);
    bytes[bytes.length - 1] ^= 0x01;
    const darkNumbered = `/31337/${dark.handId}`;
    for (const target of ["/31337/999999", `${path}?d=${toText(bytes)}`, `${darkNumbered}?d=AAAA`, `${path}?d=a&d=b`, "/84532/1", "/1/1", `/31337/0x1111111111111111111111111111111111111111/1`, `/31337/${unlisted.handId}?d=${"A".repeat(20_000)}`]) {
      const page = await call(target);
      expect({ target: target.slice(0, 80), status: page.status }).toEqual({ target: target.slice(0, 80), status: 200 });
      expect(unescape(metaOf(page.text, "og:title"))).toBe(GENERIC_TITLE);
      expect(metaOf(page.text, "og:description")).toBe("Open to see.");
      expect(unescape(metaOf(page.text, "og:image"))).toBe(`${SITE}/og/generic.png`);
      expect(page.text).not.toContain("Tamper with me");
      expect(page.text).not.toContain("Dark words");
      expect(untagged(page.text)).toBe(index);
    }
    // The dark Hand's own number gives its terms only, never its words.
    const terms = await call(darkNumbered);
    expect(metaOf(terms.text, "og:description")).toStartWith("Reward $5 · open until ");
    expect(terms.text).not.toContain("Dark words");
    // A card for a huge d is the generic card too.
    const huge = await call(`/og/31337/${unlisted.handId}.png?d=${"A".repeat(20_000)}`);
    expect(Buffer.from(huge.bytes).equals(Buffer.from((await call("/og/generic.png")).bytes))).toBe(true);
  });

  test("hostile words are escaped and isolated: no tag, script or direction control gets out", async () => {
    const title = `</title><script>alert(1)</script>"' & <meta property="og:title" content="pwned"> ‮evil`;
    const { before } = await raise({ mode: "public", title, content: `<img src=x onerror=alert(2)> ‮`, reward: USD });
    const page = await call(before);
    expect(page.status).toBe(200);
    expect(page.text).not.toContain("<script>alert");
    expect(page.text).not.toContain("<img src=x");
    expect(page.text).not.toContain('content="pwned"');
    expect(page.text.match(/<script\b/g)?.length ?? 0).toBe(index.match(/<script\b/g)?.length ?? 0);
    expect(page.text.match(/<title>/g)).toHaveLength(1);
    expect(unescape(metaOf(page.text, "og:title"))).toStartWith("⁨</title><script>");
    expect(unescape(metaOf(page.text, "og:title"))).toEndWith("⁩");
    expect(untagged(page.text)).toBe(index);
    const card = await call(`/og${before.replace("?", ".png?")}`);
    expect(pngSize(card.bytes)).toMatchObject({ width: 1200, height: 630 });
  });

  test("a closed Hand follows the chain: the reward went back", async () => {
    const { handId, before } = await raise({ mode: "unlisted", title: "Short one", reward: 3n * USD, seconds: 3_600 });
    expect(metaOf((await call(before)).text, "og:description")).toStartWith("Reward $3 · open until ");
    const rpc = chain.client.request as (a: { method: string; params: unknown[] }) => Promise<unknown>;
    await rpc({ method: "evm_increaseTime", params: [7_200] });
    await rpc({ method: "evm_mine", params: [] });
    await send(chain, ANVIL_KEYS[4]!, refundCall(chain.core, handId));
    expect(metaOf((await call(before)).text, "og:description")).toMatch(/^Reward \$3\. The reward went back on \d{1,2}\u00a0[A-Z][a-z]{2}\.$/);
  });

  test("the page names the host the visitor asked for (X-Forwarded-Host, as a proxy in front sets it), https, and nothing that is not a host", async () => {
    const { before } = await raise({ mode: "unlisted", title: "Which host", reward: USD });
    const viaProxy = await handle(new Request(`http://127.0.0.1:3${before}`, { headers: { "X-Forwarded-Host": "preview-branch.ahand.example" } }));
    expect(unescape(metaOf(await viaProxy.text(), "og:url"))).toBe(`https://preview-branch.ahand.example${before}`);
    const local = await handle(new Request(`http://127.0.0.1:3${before}`));
    expect(unescape(metaOf(await local.text(), "og:image"))).toStartWith("http://127.0.0.1:3/og/");
    const hostile = await handle(new Request(`${SITE}${before}`, { headers: { "X-Forwarded-Host": 'evil.example/"><script>' } }));
    const text = await hostile.text();
    expect(unescape(metaOf(text, "og:url"))).toBe(`${SITE}${before}`);
    expect(text).not.toContain("evil.example");
  });

  test("with VIEW_SITE configured, the page names it and no X-Forwarded-Host", async () => {
    const { before } = await raise({ mode: "unlisted", title: "Configured host", reward: USD });
    const fn: FunctionConfig = { ...config, chainId: chain.chainId, trusted: [chain.core], canonical: chain.core, tokens: tokensOf(viewTokensOf(chain.tokens)), site: SITE };
    const configured = viewFunction(fn, index, { client: chain.client, previewTtlMs: 0 });
    const page = await (await configured(new Request(`http://127.0.0.1:3${before}`, { headers: { "X-Forwarded-Host": "elsewhere.example" } }))).text();
    expect(unescape(metaOf(page, "og:url"))).toBe(`${SITE}${before}`);
    expect(unescape(metaOf(page, "og:image"))).toStartWith(`${SITE}/og/`);
    expect(page).not.toContain("elsewhere.example");
  });

  test("a parameter the SDK would refuse (a backslash) blanks neither the page nor the card of the address it rides on", async () => {
    const title = "A backslash next door";
    const { before } = await raise({ mode: "unlisted", title, reward: USD });
    // With the reader's memory on, as deployed.
    const remembering = viewFunction({ ...config, chainId: chain.chainId, trusted: [chain.core], canonical: chain.core, tokens: tokensOf(viewTokensOf(chain.tokens)) }, index, { client: chain.client });
    const poisoned = new Request(`${SITE}${before}&x=\\`);
    expect(new URL(poisoned.url).search).toEndWith("&x=\\");
    expect(unescape(metaOf(await (await remembering(poisoned)).text(), "og:title"))).toBe(isolate(title));
    expect(unescape(metaOf(await (await remembering(new Request(`${SITE}${before}`))).text(), "og:title"))).toBe(isolate(title));
    const card = await remembering(new Request(`${SITE}/og${before.replace("?", ".png?")}&x=\\`));
    expect(card.headers.get("cache-control")).toBe("public, max-age=300");
  });

  test("a card for a reading that failed is the generic card, and nobody may keep it", async () => {
    const down = viewFunction({ ...config, rpc: "http://127.0.0.1:1", chainId: 31337, trusted: [chain.core], canonical: chain.core, tokens: [] }, index, { previewTtlMs: 0 });
    const card = await down(new Request(`${SITE}/og/31337/1.png`));
    expect(card.status).toBe(200);
    expect(card.headers.get("cache-control")).toBe("no-store");
    const generic = await call("/og/generic.png");
    expect(Buffer.from(await card.arrayBuffer()).equals(Buffer.from(generic.bytes))).toBe(true);
  });

  test("bundled as a deploy build bundles it (function-entry.ts), with view.json, index.html, fonts and lockup beside it", async () => {
    // Inside apps/view, so the bundle finds @resvg/resvg-js in node_modules as a deployment
    // finds it beside the bundle; the folder's dot name keeps it out of git.
    const out = mkdtempSync(join(import.meta.dir, "..", ".bundle-"));
    try {
      const built = await Bun.build({ entrypoints: [join(import.meta.dir, "../src/function-entry.ts")], target: "node", outdir: out, external: ["@resvg/resvg-js"] });
      expect(built.success).toBe(true);
      cpSync(join(import.meta.dir, "fixtures/index.html"), join(out, "index.html"));
      cpSync(join(import.meta.dir, "../src/fonts"), join(out, "fonts"), { recursive: true });
      cpSync(join(import.meta.dir, "../src/og"), join(out, "og"), { recursive: true });
      const settings = {
        VIEW_RPC: chain.rpc,
        VIEW_CHAIN: String(chain.chainId),
        VIEW_CORES: chain.core,
        VIEW_CANONICAL: chain.core,
        VIEW_SITE: SITE,
        VIEW_TOKENS: viewTokensOf(chain.tokens),
        VIEW_RELAYS: RELAYS.join(","),
      };
      writeFileSync(join(out, "view.json"), JSON.stringify(settings));
      const { default: bundled } = (await import(join(out, "function-entry.js"))) as { default: { fetch: (request: Request) => Promise<Response> } };

      const title = "Read through the bundle";
      const { before } = await raise({ mode: "unlisted", title, reward: 7n * USD });
      const page = await (await bundled.fetch(new Request(`http://127.0.0.1:3${before}`))).text();
      expect(unescape(metaOf(page, "og:title"))).toBe(isolate(title));
      expect(metaOf(page, "og:description")).toStartWith("Reward $7 · open until ");
      expect(unescape(metaOf(page, "og:url"))).toBe(`${SITE}${before}`);
      const card = await bundled.fetch(new Request(`${SITE}/og/generic.png`));
      expect(card.headers.get("content-type")).toBe("image/png");
      expect(pngSize(new Uint8Array(await card.arrayBuffer()))).toMatchObject({ width: 1200, height: 630 });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);

  test("any other path the function is asked for is index.html as built, untouched", async () => {
    for (const path of ["/api/view", "/raise", "/"]) {
      const page = await call(path);
      expect(page.status).toBe(200);
      expect(page.text).toBe(index);
      expect(page.header("content-security-policy")).toBe(cspFor({ rpc: RPC, relays: RELAYS, privy: true }, { inline: inlineScriptHashes(index) }));
    }
  });
});
