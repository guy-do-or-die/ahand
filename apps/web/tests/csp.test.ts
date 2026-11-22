import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cspFor, PRIVY_SOURCES } from "../../view/src/headers.ts";
import { appCsp, appHeaders, cspMetaTag, PRIVY_CSP } from "../csp.ts";

const sources = { rpcUrls: ["http://127.0.0.1:18555/"], relays: ["ws://127.0.0.1:18557"] };

describe("the app's CSP", () => {
  test("the header form is the app's policy, word for word", () => {
    expect(appCsp(sources)).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; " +
        "connect-src 'self' http://127.0.0.1:18555 ws://127.0.0.1:18557; worker-src 'none'; object-src 'none'; " +
        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  });

  test("the view server sends exactly the header the app's meta tag repeats", () => {
    const view = cspFor({ rpc: sources.rpcUrls[0]!, relays: [...sources.relays] });
    expect(view).toBe(appCsp(sources, "header"));
    expect(appCsp(sources, "meta")).toBe(view.replace("; frame-ancestors 'none'", ""));
  });

  test("with Privy, the app and the view server add the same: Privy's frame, API and RPC, WalletConnect's verify frame, relay and wallet list, nothing else", () => {
    expect(PRIVY_SOURCES).toEqual(PRIVY_CSP);
    const privy = { ...sources, privy: true };
    expect(appCsp(privy)).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://explorer-api.walletconnect.com; font-src 'self'; " +
        "connect-src 'self' http://127.0.0.1:18555 ws://127.0.0.1:18557 https://auth.privy.io https://*.rpc.privy.systems wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://explorer-api.walletconnect.com; " +
        "frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org; child-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org; " +
        "worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    expect(cspFor({ rpc: sources.rpcUrls[0]!, relays: [...sources.relays], privy: true })).toBe(appCsp(privy, "header"));
    // A page with inline code (exit.html) never gets Privy, even when the app has it.
    const exit = cspFor({ rpc: sources.rpcUrls[0]!, relays: [], privy: true }, { anyRpc: true });
    expect(exit).not.toContain("privy");
    expect(exit).not.toContain("walletconnect");
    expect(appCsp({ ...sources, privy: false })).toBe(appCsp(sources));
    // Nothing Privy's page lists for parts this app leaves out: Coinbase's relay, Cloudflare, Telegram.
    expect(appCsp(privy)).not.toMatch(/cloudflare|telegram|blob:/);
    expect(appCsp(privy)).toContain("script-src 'self';");
  });

  test("the meta form leaves out frame-ancestors, which only works as a header", () => {
    expect(appCsp(sources, "meta")).not.toContain("frame-ancestors");
    expect(cspMetaTag(sources)).toStartWith('<meta http-equiv="Content-Security-Policy" content="default-src');
  });

  test("connect-src names origins only, once each", () => {
    const csp = appCsp({ rpcUrls: ["https://rpc.example/v1/path?q=1", "https://rpc.example/other"], relays: [] });
    expect(csp).toContain("connect-src 'self' https://rpc.example;");
  });

  test("vite preview sends the CSP, Referrer-Policy no-referrer, nosniff, COOP and Permissions-Policy, as the view server does", () => {
    const headers = appHeaders(sources);
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
  });

  test("both HTML entries of the main build carry the referrer tag the CSP meta is placed after", () => {
    for (const page of ["index.html", "gallery.html"]) {
      expect(readFileSync(resolve(import.meta.dirname, "..", page), "utf8")).toContain('<meta name="referrer" content="no-referrer" />');
    }
  });
});
