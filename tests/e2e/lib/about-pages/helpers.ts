/**
 * about-pages' own helpers for its smoke: the seed's fixture shape it reads, a
 * link's QR digits worked out the way the SDK writes them (no workspace import in a spec), and
 * a silent stand-in for the dev server's reload socket.
 */
import type { BrowserContext } from "@playwright/test";

/** One fixture as infra/stand/seed.ts prints it (only the fields this smoke reads). */
export interface Fixture {
  handId: string;
  title: string;
  address: string;
}

export interface SeedRun {
  chainId: number;
  site: string;
  fixtures: Record<string, Fixture>;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * The decimal form of a base64url link: the same bytes read as one big-endian number, which is
 * what a QR code carries in its numeric mode (packages/sdk link.ts toDigits).
 */
export function digitsOf(link: string): string {
  let value = 0n;
  let bits = 0;
  let buffer = 0;
  for (const char of link) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`not base64url: ${char}`);
    buffer = ((buffer << 6) | index) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      value = (value << 8n) | BigInt((buffer >> bits) & 0xff);
    }
  }
  return value.toString(10);
}

/**
 * In --dev mode Vite reloads every open page when anyone edits any file of the app, and
 * a reload forgets a link held in memory (by design). The dev server's own socket is answered
 * here by one that never reaches it. A built stand has no such socket; this changes nothing there.
 */
export async function quietDevServer(context: BrowserContext, site: string): Promise<void> {
  const origin = new URL(site).origin.replace(/^http/, "ws");
  await context.routeWebSocket((url) => url.origin === origin, () => {
    // Accepted and left silent.
  });
}
