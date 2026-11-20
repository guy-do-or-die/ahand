import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cspFor } from "../../face/src/headers.ts";
import { appCsp, appHeaders, cspMetaTag } from "../csp.ts";

const sources = { rpcUrls: ["http://127.0.0.1:18555/"], relays: ["ws://127.0.0.1:18557"] };

describe("the app's CSP (ARCHITECTURE §11)", () => {
  test("the header form is the policy of §11, word for word", () => {
    expect(appCsp(sources)).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; " +
        "connect-src 'self' http://127.0.0.1:18555 ws://127.0.0.1:18557; worker-src 'none'; object-src 'none'; " +
        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  });

  test("face sends exactly the header the app's meta tag repeats", () => {
    const face = cspFor({ rpc: sources.rpcUrls[0]!, relays: [...sources.relays] });
    expect(face).toBe(appCsp(sources, "header"));
    expect(appCsp(sources, "meta")).toBe(face.replace("; frame-ancestors 'none'", ""));
  });

  test("the meta form leaves out frame-ancestors, which only works as a header", () => {
    expect(appCsp(sources, "meta")).not.toContain("frame-ancestors");
    expect(cspMetaTag(sources)).toStartWith('<meta http-equiv="Content-Security-Policy" content="default-src');
  });

  test("connect-src names origins only, once each", () => {
    const csp = appCsp({ rpcUrls: ["https://rpc.example/v1/path?q=1", "https://rpc.example/other"], relays: [] });
    expect(csp).toContain("connect-src 'self' https://rpc.example;");
  });

  test("vite preview sends the CSP, Referrer-Policy no-referrer, nosniff, COOP and Permissions-Policy, as face does", () => {
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
