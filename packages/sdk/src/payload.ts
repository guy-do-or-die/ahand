import { bytesToHex, hexToBytes, type Hex } from "viem";
import { ShakeSchema, type Shake } from "./types.js";

/**
 * Payload envelope (Appendix P of the protocol), byte-exact as in test-vectors.json:
 *   ver(1) | handId(32) | chainId(8) | core(20) | nShakes(1)
 *   | [ shake(81) + sig(65) ]*  | latestPriv(32) | metaLen(2) | meta
 *
 * CONSTITUTIONAL RULE (§3 app-spec, I-15 protocol):
 * the forwarded payload contains EXACTLY ONE private key — that of the latest capability.
 * The forwarding compilation function DOES NOT ACCEPT an array of keys — only a single fresh one.
 * The stripping of the parent key is not "validated" here, but structurally ENFORCED:
 * the codec schema physically cannot fit a second private key.
 */

const VER = 1;

export interface SignedShake {
  shake: Shake;
  signature: Hex;
}

export interface DecodedPayload {
  version: number;
  handId: bigint;
  chainId: number;
  core: `0x${string}`;
  shakes: SignedShake[];
  latestPrivateKey: Hex; // the only private key in the payload
  metadata: unknown; // parsed JSON
}

function u(nBytes: number, value: bigint): Uint8Array {
  const out = new Uint8Array(nBytes);
  let v = value;
  for (let i = nBytes - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}
function toBig(b: Uint8Array): bigint {
  let v = 0n;
  for (const byte of b) v = (v << 8n) | BigInt(byte);
  return v;
}

function encodeShakeFields(s: Shake): Uint8Array {
  const parts = [
    u(32, s.handId),
    hexToBytes(s.childCapability as Hex),
    hexToBytes(s.payout as Hex),
    u(2, BigInt(s.parentClaimBps)),
    u(2, BigInt(s.childClaimBps)),
    u(5, s.deadline),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out; // 32+20+20+2+2+5 = 81 bytes
}

function b64urlEncode(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * Encode payload for FORWARDING. Takes a single fresh private key for the latest capability.
 * It is structurally impossible to pass a second key by signature. Thus, stripping
 * becomes a property of the type schema rather than developer discipline.
 */
export function encodePayload(params: {
  handId: bigint;
  chainId: number;
  core: `0x${string}`;
  shakes: SignedShake[];
  latestPrivateKey: Hex; // exactly one private key
  metadata: unknown;
}): string {
  const metaBytes = new TextEncoder().encode(JSON.stringify(params.metadata));
  const chunks: Uint8Array[] = [
    Uint8Array.of(VER),
    u(32, params.handId),
    u(8, BigInt(params.chainId)),
    hexToBytes(params.core),
    Uint8Array.of(params.shakes.length),
  ];
  for (const s of params.shakes) {
    chunks.push(encodeShakeFields(s.shake));
    chunks.push(hexToBytes(s.signature));
  }
  chunks.push(hexToBytes(params.latestPrivateKey));
  chunks.push(u(2, BigInt(metaBytes.length)));
  chunks.push(metaBytes);

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const body = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    body.set(c, o);
    o += c.length;
  }
  return b64urlEncode(body);
}

export function decodePayload(fragment: string): DecodedPayload {
  const b = b64urlDecode(fragment);
  let o = 0;
  const take = (n: number) => {
    const s = b.subarray(o, o + n);
    o += n;
    return s;
  };

  const version = take(1)[0];
  if (version !== VER) throw new Error(`unsupported payload version ${version}`);
  const handId = toBig(take(32));
  const chainId = Number(toBig(take(8)));
  const core = bytesToHex(take(20)) as `0x${string}`;
  const nShakes = take(1)[0];

  const shakes: SignedShake[] = [];
  for (let i = 0; i < nShakes; i++) {
    const f = take(81);
    const shake = ShakeSchema.parse({
      handId: toBig(f.subarray(0, 32)),
      childCapability: bytesToHex(f.subarray(32, 52)),
      payout: bytesToHex(f.subarray(52, 72)),
      parentClaimBps: Number(toBig(f.subarray(72, 74))),
      childClaimBps: Number(toBig(f.subarray(74, 76))),
      deadline: toBig(f.subarray(76, 81)),
    });
    const signature = bytesToHex(take(65));
    shakes.push({ shake, signature });
  }

  const latestPrivateKey = bytesToHex(take(32));
  const metaLen = Number(toBig(take(2)));
  const metadata = JSON.parse(new TextDecoder().decode(take(metaLen)));

  return { version, handId, chainId, core, shakes, latestPrivateKey, metadata };
}
