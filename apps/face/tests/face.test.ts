import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createWalletClient, http, parseEventLogs, type Address, type Hex } from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { foundry } from "viem/chains";

import {
  CORE_ABI,
  approveCall,
  chainNow,
  describeHand,
  domain,
  encodeLive,
  expiryAfter,
  fromBase64Url,
  keyOfSeed,
  newSeed,
  packAttachments,
  raiseCall,
  readHand,
  readLimits,
  refundCall,
  toAddress,
  toText,
  type Call,
  type DescribeMode,
} from "@ahand/sdk";
import { ANVIL_KEYS, startChain, type Chain } from "@ahand/sdk/testing";

import { isolate } from "../src/bidi.ts";
import type { FaceConfig } from "../src/config.ts";
import { createFace } from "../src/server.ts";

/**
 * Face against a chain of its own (the wave 1 helper: anvil 40 days ahead of this machine), with
 * Hands raised directly through the SDK, the way the app raises them. Ports 16150 (face in this
 * process) and 16151 (face as its own program).
 */

const PORT = 16150;
const PROCESS_PORT = 16151;
const SITE = `http://127.0.0.1:${PORT}`;
const USD = 1_000_000n;
const DAY = 86_400;

let chain: Chain;
let face: Server;
let dist: string;
const logs: string[] = [];
const raiserKey = ANVIL_KEYS[1]!;

const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="referrer" content="no-referrer" />
    <title>aHand</title>
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`;
const EXIT = `<!doctype html><html><head><title>exit</title><script type="module">document.title = "exit ran";</script></head><body>exit, byte for byte é</body></html>\n`;

const rpc = (method: string, params: unknown[] = []) =>
  (chain.client.request as (a: { method: string; params: unknown[] }) => Promise<unknown>)({ method, params });

async function send(key: Hex, call: Call) {
  const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: foundry, transport: http(chain.rpc) });
  const hash = await wallet.sendTransaction({ to: call.to, data: call.data, value: call.value ?? 0n });
  const receipt = await chain.client.waitForTransactionReceipt({ hash, pollingInterval: 50 });
  if (receipt.status !== "success") throw new Error(`reverted: ${hash}`);
  return receipt;
}

/** Raises a Hand described in `mode` and returns its faced (or bare) address, as the app writes it. */
async function raise(opts: { mode: DescribeMode; title: string; content?: string; reward: bigint; seconds?: number }) {
  const usd = chain.tokens.find((token) => token.kind === "usd")!.address;
  const described = describeHand({ mode: opts.mode, title: opts.title, content: opts.content });
  const seed = newSeed();
  if (opts.reward > 0n) await send(raiserKey, approveCall(usd, chain.core, opts.reward));
  const { timestamp } = await chainNow(chain.client);
  const { maxExpiryPeriod } = await readLimits(chain.client, chain.core);
  const receipt = await send(
    raiserKey,
    raiseCall(chain.core, {
      token: usd,
      reward: opts.reward,
      expiry: expiryAfter(timestamp, opts.seconds ?? 30 * DAY, maxExpiryPeriod),
      rootKey: privateKeyToAddress(keyOfSeed(seed)),
      payoutGasK: 250,
      minClaimBps: 7_000,
      dataHash: described.dataHash,
    }),
  );
  const [raised] = parseEventLogs({ abi: CORE_ABI, logs: receipt.logs, eventName: "Raised" });
  const handId = raised!.args.handId;
  const { hand } = await readHand(chain.client, chain.core, handId);
  const options = { canonicalCore: chain.core };
  const outside = described.outside && packAttachments(described.outside);
  const link = await encodeLive(
    { domain: domain(chain.chainId, chain.core), hand, signedShakes: [], seed, attachments: described.inside },
    { ...options, outside },
  );
  const address = toAddress({ site: SITE, link, shape: described.shape, outside: described.outside }, options);
  // What a browser or a robot sends: everything before `#`, as path and query.
  const before = address.split("#")[0]!.slice(SITE.length);
  return { handId, address, before };
}

async function get(path: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${SITE}${path}`, { headers, redirect: "manual" });
  return { response, status: response.status, text: await response.clone().text(), bytes: new Uint8Array(await response.arrayBuffer()) };
}

const metaOf = (html: string, property: string) =>
  new RegExp(`<meta (?:property|name)="${property.replace(/[.:]/g, "\\$&")}" content="([^"]*)"`).exec(html)?.[1];

const unescape = (text: string | undefined) =>
  text?.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));

function pngSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const magic = Buffer.from(bytes.subarray(0, 8)).toString("hex");
  return { magic, width: view.getUint32(16), height: view.getUint32(20) };
}

beforeAll(async () => {
  chain = await startChain();
  dist = mkdtempSync(join(tmpdir(), "face-dist-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), INDEX);
  writeFileSync(join(dist, "exit.html"), EXIT);
  writeFileSync(join(dist, "build.json"), JSON.stringify({ files: { "index.html": "00" } }));
  writeFileSync(join(dist, "assets", "index-abc.js"), "console.log('app')");
  const config: FaceConfig = {
    port: PORT,
    dist,
    rpc: chain.rpc,
    chainId: chain.chainId,
    trusted: [chain.core],
    canonical: chain.core,
    site: SITE,
    relays: ["ws://127.0.0.1:18547"],
  };
  face = createFace(config, { log: (line) => logs.push(line) });
  await new Promise<void>((done) => face.listen(PORT, "127.0.0.1", done));
}, 60_000);

afterAll(async () => {
  await new Promise<void>((done) => {
    face?.close(() => done());
    face?.closeAllConnections();
  });
  await chain?.stop();
});

describe("previews of a Hand", () => {
  it("an unlisted Hand shows its title and reward; one byte of d changed shows the generic card", async () => {
    const title = "Looking for a sublet in Yerevan for June";
    const { before } = await raise({ mode: "unlisted", title, content: "Two rooms, near the metro. Hidden from robots.", reward: 40n * USD });
    expect(before).toMatch(/^\/31337\/\d+\?d=[A-Za-z0-9_-]+$/);

    const page = await get(before);
    expect(page.status).toBe(200);
    expect(unescape(metaOf(page.text, "og:title"))).toBe(isolate(title));
    expect(unescape(metaOf(page.text, "twitter:title"))).toBe(isolate(title));
    expect(metaOf(page.text, "og:description")).toMatch(/^\$40 reward on chain · open until \d{1,2} [A-Z][a-z]{2}\.$/);
    expect(page.text).toContain("$40 reward");
    expect(page.text).not.toContain("Hidden from robots");
    expect(unescape(metaOf(page.text, "og:image"))).toBe(`${SITE}/og${before.replace("?", ".png?")}`);
    expect(page.text).toContain(`<title>${isolate(title)} · aHand</title>`);
    // The app still loads: the page is index.html with tags added.
    expect(page.text).toContain(`<script type="module" crossorigin src="/assets/index-abc.js"></script>`);

    // One byte of d changed: a byte of the title's text, re-encoded as the address writes it.
    const d = before.split("?d=")[1]!;
    const bytes = fromBase64Url(d);
    bytes[bytes.length - 1] ^= 0x01;
    const tampered = await get(`${before.split("?")[0]}?d=${toText(bytes)}`);
    expect(tampered.status).toBe(200);
    expect(unescape(metaOf(tampered.text, "og:title"))).toBe("Someone raised a hand.");
    expect(tampered.text).not.toContain(title);
    expect(tampered.text).not.toContain("$40");

    // One character of the base64 changed, too.
    const flipped = d.slice(0, 10) + (d[10] === "A" ? "B" : "A") + d.slice(11);
    const second = await get(`${before.split("?")[0]}?d=${flipped}`);
    expect(unescape(metaOf(second.text, "og:title"))).toBe("Someone raised a hand.");

    // In Russian, by Accept-Language.
    const ru = await get(before, { "Accept-Language": "ru-RU,ru;q=0.9" });
    expect(unescape(metaOf(ru.text, "og:title"))).toBe(isolate(title));
    expect(metaOf(ru.text, "og:description")).toStartWith("Награда $40 в сети · открыта до ");
    expect(unescape(metaOf(ru.text, "og:image"))).toBe(`${SITE}/og${before.replace("?", ".png?")}&l=ru`);
  });

  it("a numbered address shows the terms from hands() under the generic title", async () => {
    const { before } = await raise({ mode: "unlisted", title: "Not for robots without d", reward: 25n * USD });
    const numbered = before.split("?")[0]!;
    const page = await get(numbered);
    expect(unescape(metaOf(page.text, "og:title"))).toBe("Someone raised a hand.");
    expect(metaOf(page.text, "og:description")).toStartWith("$25 reward on chain · open until ");
    expect(page.text).not.toContain("Not for robots");
  });

  it("a public Hand with no reward says a thank-you only, and shows its details", async () => {
    const { before } = await raise({ mode: "public", title: "Who can fix a 1978 Vespa?", content: "It stalls at idle.", reward: 0n });
    const page = await get(before);
    expect(unescape(metaOf(page.text, "og:title"))).toBe(isolate("Who can fix a 1978 Vespa?"));
    const description = metaOf(page.text, "og:description")!;
    expect(description).toStartWith("No reward on chain: a thank-you only · open until ");
    expect(description).toEndWith(`. The asker wrote: “${isolate("It stalls at idle.")}”`);
    expect(page.text).not.toContain("$");
  });

  it("a dark Hand's bare address, the root, an unknown Hand and an untrusted Core give the generic card with 200", async () => {
    const dark = await raise({ mode: "dark", title: "Dark words", reward: 5n * USD });
    expect(dark.before).toBe("/");
    const other: Address = "0x1111111111111111111111111111111111111111";
    for (const path of ["/", "/raise", "/31337/999999", `/31337/${other.toLowerCase()}/1`, "/1/1", "/31337/1?d=AAAA", "/31337/1?d=a&d=b"]) {
      const page = await get(path);
      expect(page.status).toBe(200);
      expect(unescape(metaOf(page.text, "og:title"))).toBe("Someone raised a hand.");
      expect(metaOf(page.text, "og:description")).toBe("Open to see.");
      expect(unescape(metaOf(page.text, "og:image"))).toBe(`${SITE}/og/generic.png`);
      expect(page.text).not.toContain("Dark words");
    }
  });

  it("judges time's up by the chain's clock, then shows the reward went back", async () => {
    const { handId, before } = await raise({ mode: "unlisted", title: "Short one", reward: 3n * USD, seconds: 3_600 });
    expect(metaOf((await get(before)).text, "og:description")).toStartWith("$3 reward on chain · open until ");

    // The chain moves two hours on; this machine's clock (40 days behind the chain) does not.
    await rpc("evm_increaseTime", [7_200]);
    await rpc("evm_mine");
    expect(unescape(metaOf((await get(before)).text, "og:description"))).toStartWith("$3 reward on chain · time's up on ");

    await send(ANVIL_KEYS[4]!, refundCall(chain.core, handId));
    const closed = await get(before);
    expect(metaOf(closed.text, "og:description")).toStartWith("The $3 reward went back on ");
    expect(unescape(metaOf(closed.text, "og:title"))).toBe(isolate("Short one"));
  });
});

describe("the card image", () => {
  it("is a 1200×630 PNG, the same bytes each time, another in dark and in Russian", async () => {
    const { before } = await raise({ mode: "unlisted", title: "A PNG for this hand", reward: 12n * USD });
    const path = `/og${before.replace("?", ".png?")}`;
    const first = await get(path);
    expect(first.status).toBe(200);
    expect(first.response.headers.get("content-type")).toBe("image/png");
    expect(pngSize(first.bytes)).toEqual({ magic: "89504e470d0a1a0a", width: 1200, height: 630 });

    const again = await get(path);
    expect(Buffer.from(again.bytes).equals(Buffer.from(first.bytes))).toBe(true);

    const dark = await get(`${path}&th=d`);
    expect(pngSize(dark.bytes)).toMatchObject({ width: 1200, height: 630 });
    expect(Buffer.from(dark.bytes).equals(Buffer.from(first.bytes))).toBe(false);

    const ru = await get(`${path}&l=ru`);
    expect(Buffer.from(ru.bytes).equals(Buffer.from(first.bytes))).toBe(false);

    // Without d, or with a wrong one, it is a card all the same, never an error.
    const generic = await get("/og/generic.png");
    const wrong = await get("/og/31337/999999.png?d=AAAA");
    expect(generic.status).toBe(200);
    expect(Buffer.from(wrong.bytes).equals(Buffer.from(generic.bytes))).toBe(true);
    const untrusted = await get("/og/31337/0x1111111111111111111111111111111111111111/1.png");
    expect(Buffer.from(untrusted.bytes).equals(Buffer.from(generic.bytes))).toBe(true);
  });
});

describe("files, headers and the log", () => {
  it("answers /healthz, serves exit.html and build.json as they are, and every other path the app", async () => {
    expect((await get("/healthz")).status).toBe(200);

    const exit = await get("/exit.html");
    expect(exit.status).toBe(200);
    expect(Buffer.from(exit.bytes).equals(readFileSync(join(dist, "exit.html")))).toBe(true);
    // Its inline script is allowed by its own hash, and it may reach any RPC its reader types.
    const exitCsp = exit.response.headers.get("content-security-policy")!;
    expect(exitCsp).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
    expect(exitCsp).toContain("https:");

    const build = await get("/build.json");
    expect(build.response.headers.get("content-type")).toStartWith("application/json");
    expect(build.text).toBe(readFileSync(join(dist, "build.json"), "utf8"));

    const asset = await get("/assets/index-abc.js");
    expect(asset.response.headers.get("cache-control")).toContain("immutable");

    for (const path of ["/nowhere", "/../../etc/passwd", "/assets", "/31337/1/proof"]) {
      const page = await get(path);
      expect(page.status).toBe(200);
      expect(page.text).toContain('<div id="root"></div>');
    }
    expect((await fetch(`${SITE}/`, { method: "POST" })).status).toBe(405);
  });

  it("sends the CSP and no-referrer on every response", async () => {
    const { before } = await raise({ mode: "unlisted", title: "Headers", reward: USD });
    for (const path of ["/", before, `/og${before.replace("?", ".png?")}`, "/healthz", "/exit.html", "/build.json", "/assets/index-abc.js", "/nowhere"]) {
      const { response } = await get(path);
      const csp = response.headers.get("content-security-policy")!;
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      for (const directive of ["default-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'", "worker-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"]) {
        expect(csp).toContain(directive);
      }
      expect(csp).toContain(`connect-src 'self' ${chain.rpc} ws://127.0.0.1:18547`);
    }
  });

  it("logs method, path and status, and never a query", async () => {
    const { before } = await raise({ mode: "unlisted", title: "Log me not", reward: USD });
    logs.length = 0;
    await get(before);
    await get(`/og${before.replace("?", ".png?")}&th=d`);
    await new Promise((done) => setTimeout(done, 50));
    const path = before.split("?")[0]!;
    expect(logs).toEqual([`GET ${path} 200`, `GET /og${path}.png 200`]);
    expect(logs.join("\n")).not.toContain("d=");
  });
});

describe("face as its own program", () => {
  let child: ChildProcess | undefined;
  afterAll(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise((done) => child!.once("exit", done));
      child.kill("SIGTERM");
      await exited;
    }
  });

  it("reads ARCHITECTURE §14's environment, answers /healthz and logs no query", async () => {
    child = spawn(process.execPath, [join(import.meta.dir, "../src/server.ts")], {
      env: {
        ...process.env,
        FACE_PORT: String(PROCESS_PORT),
        FACE_DIST: dist,
        FACE_RPC: chain.rpc,
        FACE_CHAIN: String(chain.chainId),
        FACE_CORES: chain.core,
        FACE_CANONICAL: chain.core,
        FACE_SITE: `http://127.0.0.1:${PROCESS_PORT}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout!.on("data", (chunk) => (out += chunk));
    child.stderr!.on("data", (chunk) => (out += chunk));
    const base = `http://127.0.0.1:${PROCESS_PORT}`;
    let healthy = false;
    for (let i = 0; i < 100 && !healthy; i++) {
      healthy = await fetch(`${base}/healthz`).then((r) => r.ok, () => false);
      if (!healthy) await new Promise((done) => setTimeout(done, 50));
    }
    expect(healthy).toBe(true);

    const { before } = await raise({ mode: "unlisted", title: "From the program", reward: 2n * USD });
    const page = await fetch(`${base}${before}`).then((r) => r.text());
    expect(page).toContain(`content="${isolate("From the program")}"`);
    const png = await fetch(`${base}/og${before.replace("?", ".png?")}`);
    expect(png.headers.get("content-type")).toBe("image/png");
    await png.arrayBuffer();
    await new Promise((done) => setTimeout(done, 100));

    const path = before.split("?")[0]!;
    expect(out).toContain(`GET ${path} 200`);
    expect(out).toContain(`GET /og${path}.png 200`);
    expect(out).not.toContain("?");
    expect(out).not.toContain("d=");
  }, 30_000);
});
