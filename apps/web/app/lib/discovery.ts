/**
 * Discovery doc publishing — canonical bytes → CIDv1 locator + optional pin.
 *
 * The CID is computed locally (raw codec 0x55, sha2-256 multihash, base32
 * multibase) so the locator never depends on a pinning provider agreeing
 * with us: for a single-block raw upload every honest provider derives the
 * same CID, and a mismatch is reported as "not pinned" rather than trusted.
 *
 * Implemented by hand (≈30 lines) because `multiformats` is not resolvable
 * from apps/web — it only exists deep in the bun store as a transitive dep.
 *
 * Backends read PINATA_JWT or WEB3_STORAGE_TOKEN from the server env; with
 * neither set (anvil mode) the CID is computed locally, nothing is pinned,
 * and the caller gets an honest {pinned: false} to label availability with.
 */

const CIDV1 = 0x01;
const RAW_CODEC = 0x55;
const SHA2_256 = 0x12;
const DIGEST_LEN = 0x20;

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/** RFC 4648 base32, lowercase, no padding — the CID multibase payload. */
export function base32encode(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

/** CIDv1 bytes: <version><raw-codec><sha2-256 multihash> — no multibase. */
export async function cidBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await sha256(bytes);
  const cid = new Uint8Array(4 + digest.length);
  cid.set([CIDV1, RAW_CODEC, SHA2_256, DIGEST_LEN], 0);
  cid.set(digest, 4);
  return cid;
}

/** base32 multibase CIDv1 ("b…") for raw sha2-256 content. */
export async function cidForBytes(bytes: Uint8Array): Promise<string> {
  return `b${base32encode(await cidBytes(bytes))}`;
}

export function ipfsUri(cid: string): `ipfs://${string}` {
  return `ipfs://${cid}`;
}

export function gatewayUrl(cid: string, gateway = "https://ipfs.io"): string {
  return `${gateway.replace(/\/$/, "")}/ipfs/${cid}`;
}

/** Recompute-and-compare — gateway fetches are trusted only through this. */
export async function verifyDiscoveryBytes(bytes: Uint8Array, cid: string): Promise<boolean> {
  return (await cidForBytes(bytes)) === cid;
}

export type PinProvider = "pinata" | "web3.storage";

export interface PinBackend {
  provider: PinProvider;
  /** Pins the bytes; resolves to the CID the provider reports. */
  pin: (bytes: Uint8Array) => Promise<string>;
}

export interface DiscoveryRef {
  cid: string;
  uri: `ipfs://${string}`;
  /** True only when a provider confirmed the bytes under OUR cid. */
  pinned: boolean;
  provider: PinProvider | null;
  /** Present when pinning was attempted and failed or disagreed. */
  pinError?: string;
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as any).process?.env;
  const value = env?.[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function pinataBackend(jwt: string): PinBackend {
  return {
    provider: "pinata",
    async pin(bytes: Uint8Array): Promise<string> {
      const form = new FormData();
      form.append("file", new Blob([bytes as BlobPart], { type: "application/json" }), "discovery.json");
      // cidVersion 1 ⇒ raw-leaves; a single-block doc gets exactly our CID.
      form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
      const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
        body: form,
      });
      if (!res.ok) throw new Error(`pinata ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { IpfsHash: string };
      return json.IpfsHash;
    },
  };
}

export function web3StorageBackend(token: string): PinBackend {
  return {
    provider: "web3.storage",
    async pin(bytes: Uint8Array): Promise<string> {
      const res = await fetch("https://api.web3.storage/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-NAME": "ahand-discovery",
        },
        body: bytes as BodyInit,
      });
      if (!res.ok) throw new Error(`web3.storage ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { cid: string };
      return json.cid;
    },
  };
}

/** Server-env backend; null = anvil mode (compute CID locally, never pin). */
export function pinBackendFromEnv(): PinBackend | null {
  const pinataJwt = readEnv("PINATA_JWT");
  if (pinataJwt) return pinataBackend(pinataJwt);
  const web3Token = readEnv("WEB3_STORAGE_TOKEN");
  if (web3Token) return web3StorageBackend(web3Token);
  return null;
}

/**
 * Canonical discovery bytes → {cid, uri, pinned}. Never throws on pin
 * trouble: the locator is always valid, pinned honestly reports whether
 * anyone besides the link is serving the bytes.
 */
export async function publishDiscovery(
  bytes: Uint8Array,
  opts?: { backend?: PinBackend | null },
): Promise<DiscoveryRef> {
  const cid = await cidForBytes(bytes);
  const backend = opts?.backend === undefined ? pinBackendFromEnv() : opts.backend;

  if (!backend) {
    return { cid, uri: ipfsUri(cid), pinned: false, provider: null };
  }

  try {
    const providerCid = await backend.pin(bytes);
    if (providerCid !== cid) {
      return {
        cid,
        uri: ipfsUri(cid),
        pinned: false,
        provider: backend.provider,
        pinError: `provider derived ${providerCid}, expected ${cid}`,
      };
    }
    return { cid, uri: ipfsUri(cid), pinned: true, provider: backend.provider };
  } catch (err: any) {
    return {
      cid,
      uri: ipfsUri(cid),
      pinned: false,
      provider: backend.provider,
      pinError: String(err?.message ?? err),
    };
  }
}
