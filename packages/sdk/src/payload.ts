import { bytesToHex, hexToBytes, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import {
  BPS_DENOMINATOR,
  MAX_ENCODED_LINK_LENGTH,
  MAX_INLINE_BODY_BYTES,
  MAX_SHAKES,
  ShakeSchema,
  ZERO_ADDRESS,
  ZERO_BYTES32,
  type HandRef,
  type Give,
  type Shake,
  type ShakerMode,
} from "./types.js";
import { routeHashOf } from "./hash.js";
import { fromCompactSig, toCompactSig } from "./sign.js";

/**
 * Payload envelope, kind-discriminated:
 *
 *   header (both kinds):
 *     magic "aH"(2) | version(1) | kind(1)
 *     | chainId u64(8) | core(20) | handId u256(32) | hopCount(1)
 *   per hop:
 *     childCapability(20) | childClaimBps u16(2)
 *     | flags(1): bits0-1 mode (0 anonymous, 1 self, 2 explicit), bit2 hasHopDataHash
 *     | explicit ⇒ shaker(20) + acceptanceSig(64, EIP-2098)
 *     | hasHopDataHash ⇒ hopDataHash(32)
 *     | shakeSig(64, EIP-2098)
 *   LiveRoute (0x01) tail:
 *     capMode(1): 0x00 bearer ⇒ secret(32) | 0x01 personal ⇒ address(20)
 *     | envelopeLen u16(2) | envelope | bodyLen u16(2) | body
 *   TerminalProof (0x02) tail:
 *     giver(20) | solutionHash(32) | giveSig(64) | giverAcceptanceSig(64)
 *     | evidenceCount(1) | [refLen u16(2) + ref]*
 *
 * Everything reconstructible is NOT transported: handId comes once from the
 * header; parentClaimBps telescopes from BPS_DENOMINATOR; parent capabilities
 * chain from the Hand's rootCapability; every deadline equals the Hand expiry;
 * Give.routeHash and finalClaimBps re-derive from the hops. A byte that is not
 * on the wire is a byte that cannot be tampered with in transit.
 *
 * CONSTITUTIONAL RULE (single-secret):
 * the forwarded payload contains EXACTLY ONE structural secret slot — the
 * bearer capability tail of the LiveRoute. The compilation functions DO NOT
 * ACCEPT an array of keys — only a single fresh capability. Stripping of the
 * parent key is not "validated" here, but structurally ENFORCED: the codec
 * schema physically cannot fit a second private key. The TerminalProof has NO
 * secret slot at all — a viewer of a settled route holds no competing-Give
 * material.
 */

const MAGIC0 = 0x61; // "a"
const MAGIC1 = 0x48; // "H"
const VER = 2;

export const PAYLOAD_KIND_LIVE_ROUTE = 0x01;
export const PAYLOAD_KIND_TERMINAL_PROOF = 0x02;
export type PayloadKind =
  | typeof PAYLOAD_KIND_LIVE_ROUTE
  | typeof PAYLOAD_KIND_TERMINAL_PROOF;

const FLAG_MODE_MASK = 0b0000_0011;
const FLAG_HOP_DATA = 0b0000_0100;
const FLAG_RESERVED = 0b1111_1000;
const MODE_ORDINAL: Record<ShakerMode, number> = {
  anonymous: 0,
  self: 1,
  explicit: 2,
};
const MODE_NAME: ShakerMode[] = ["anonymous", "self", "explicit"];

/*//////////////////////////////////////////////////////////////
                            Errors
//////////////////////////////////////////////////////////////*/

export type PayloadErrorCode =
  | "link-too-long"
  | "inline-body-too-large"
  | "too-many-shakes"
  | "non-canonical"
  | "wrong-hand"
  | "bad-magic"
  | "unsupported-version"
  | "wrong-kind"
  | "truncated"
  | "trailing-bytes"
  | "malformed";

export class PayloadCodecError extends Error {
  constructor(
    readonly code: PayloadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PayloadCodecError";
  }
}

export class WrongPayloadKind extends PayloadCodecError {
  constructor(
    readonly expected: PayloadKind,
    readonly actual: number,
  ) {
    super(
      "wrong-kind",
      `expected payload kind 0x${expected.toString(16).padStart(2, "0")}, got 0x${actual
        .toString(16)
        .padStart(2, "0")}`,
    );
    this.name = "WrongPayloadKind";
  }
}

/*//////////////////////////////////////////////////////////////
                        Public shapes
//////////////////////////////////////////////////////////////*/

export interface SignedShake {
  shake: Shake;
  signature: Hex; // by the parent capability
  acceptanceSig?: Hex; // by the shaker wallet; present IFF the hop is explicit
}

export interface SignedGive {
  give: Give;
  signature: Hex; // by the terminal capability
}

/** The single structural secret slot of the entire codec. */
export type Capability =
  | { mode: "bearer"; secret: Hex } // fresh ephemeral private key
  | { mode: "personal"; address: `0x${string}` }; // recipient wallet; no secret travels

/** On-chain facts the codec reconstructs untransported fields from. */
export interface RouteContext {
  handRef: HandRef;
  expiry: bigint; // every Shake and Give deadline equals this
  rootCapability: `0x${string}`; // parent of hop zero
}

export interface LiveRoutePayload {
  kind: "live-route";
  handRef: HandRef;
  shakes: SignedShake[];
  modes: ShakerMode[]; // transport-only, aligned with shakes
  capability: Capability; // the ONLY secret-bearing field anywhere
  metadata: { envelope: Uint8Array; body: Uint8Array };
}

export interface TerminalProofPayload {
  kind: "terminal-proof";
  handRef: HandRef;
  shakes: SignedShake[];
  modes: ShakerMode[];
  give: SignedGive;
  giverAcceptanceSig: Hex;
  evidence: Uint8Array[]; // app-opaque refs (locators, message ids)
}

/*//////////////////////////////////////////////////////////////
                        Byte plumbing
//////////////////////////////////////////////////////////////*/

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

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s))
    throw new PayloadCodecError("malformed", "not base64url");
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function eqAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

class Reader {
  private o = 0;
  constructor(private readonly b: Uint8Array) {}
  take(n: number): Uint8Array {
    if (this.o + n > this.b.length)
      throw new PayloadCodecError("truncated", "payload ends mid-field");
    const s = this.b.subarray(this.o, this.o + n);
    this.o += n;
    return s;
  }
  byte(): number {
    return this.take(1)[0]!;
  }
  expectEnd(): void {
    if (this.o !== this.b.length)
      throw new PayloadCodecError("trailing-bytes", "bytes after payload end");
  }
}

/*//////////////////////////////////////////////////////////////
                    Canonical mode derivation
//////////////////////////////////////////////////////////////*/

/** Derive the transport mode of a hop from its resolved shaker and signing parent. */
export function deriveShakerMode(
  shaker: string,
  parentCapability: string,
): ShakerMode {
  if (eqAddr(shaker, ZERO_ADDRESS)) return "anonymous";
  if (eqAddr(shaker, parentCapability)) return "self";
  return "explicit";
}

interface HopPlan {
  signed: SignedShake;
  mode: ShakerMode;
}

/**
 * Validate the route against everything the wire format will NOT carry:
 * whatever is inferred at decode must already hold at encode, or the
 * reconstructed structs would silently diverge from what was signed.
 */
function planHops(
  handRef: HandRef,
  expiry: bigint,
  rootCapability: `0x${string}`,
  shakes: SignedShake[],
): HopPlan[] {
  if (shakes.length > MAX_SHAKES)
    throw new PayloadCodecError(
      "too-many-shakes",
      `route has ${shakes.length} hops; max is ${MAX_SHAKES}`,
    );
  const plans: HopPlan[] = [];
  let parentCap: string = rootCapability;
  let parentClaim = BPS_DENOMINATOR;
  for (const [i, signed] of shakes.entries()) {
    const s = ShakeSchema.parse(signed.shake);
    if (s.handId !== handRef.handId)
      throw new PayloadCodecError("wrong-hand", `hop ${i} handId mismatch`);
    if (s.deadline !== expiry)
      throw new PayloadCodecError(
        "non-canonical",
        `hop ${i} deadline is not transported; it must equal the Hand expiry`,
      );
    if (s.parentClaimBps !== parentClaim)
      throw new PayloadCodecError(
        "non-canonical",
        `hop ${i} parentClaimBps breaks the telescoping chain`,
      );
    const mode = deriveShakerMode(s.shaker, parentCap);
    if (mode === "explicit" && !signed.acceptanceSig)
      throw new PayloadCodecError(
        "non-canonical",
        `hop ${i} is explicit and must carry a ShakerAcceptance signature`,
      );
    if (mode !== "explicit" && signed.acceptanceSig)
      throw new PayloadCodecError(
        "non-canonical",
        `hop ${i} is ${mode} and must not carry an acceptance`,
      );
    plans.push({ signed: { ...signed, shake: s }, mode });
    parentCap = s.childCapability;
    parentClaim = s.childClaimBps;
  }
  return plans;
}

function encodeHops(plans: HopPlan[]): Uint8Array[] {
  const chunks: Uint8Array[] = [Uint8Array.of(plans.length)];
  for (const { signed, mode } of plans) {
    const s = signed.shake;
    const hasHopData = s.hopDataHash !== ZERO_BYTES32;
    const flags = MODE_ORDINAL[mode] | (hasHopData ? FLAG_HOP_DATA : 0);
    chunks.push(hexToBytes(s.childCapability as Hex));
    chunks.push(u(2, BigInt(s.childClaimBps)));
    chunks.push(Uint8Array.of(flags));
    if (mode === "explicit") {
      chunks.push(hexToBytes(s.shaker as Hex));
      chunks.push(hexToBytes(toCompactSig(signed.acceptanceSig!)));
    }
    if (hasHopData) chunks.push(hexToBytes(s.hopDataHash as Hex));
    chunks.push(hexToBytes(toCompactSig(signed.signature)));
  }
  return chunks;
}

function terminalCapability(
  rootCapability: `0x${string}`,
  shakes: SignedShake[],
): string {
  return shakes.length === 0
    ? rootCapability
    : shakes[shakes.length - 1]!.shake.childCapability;
}

function terminalClaim(shakes: SignedShake[]): number {
  return shakes.length === 0
    ? BPS_DENOMINATOR
    : shakes[shakes.length - 1]!.shake.childClaimBps;
}

function encodeHeader(kind: PayloadKind, handRef: HandRef): Uint8Array[] {
  return [
    Uint8Array.of(MAGIC0, MAGIC1, VER, kind),
    u(8, handRef.chainId),
    hexToBytes(handRef.core as Hex),
    u(32, handRef.handId),
  ];
}

/*//////////////////////////////////////////////////////////////
                        LiveRoute (0x01)
//////////////////////////////////////////////////////////////*/

/**
 * Compile the payload for FORWARDING. Takes a single fresh capability for the
 * next holder. It is structurally impossible to pass a second key by
 * signature. Thus, stripping becomes a property of the type schema rather
 * than developer discipline.
 */
export function buildLiveRoute(params: {
  handRef: HandRef;
  expiry: bigint;
  rootCapability: `0x${string}`;
  shakes: SignedShake[];
  capability: Capability; // exactly one — bearer secret OR personal address
  metadata: { envelope: Uint8Array; body?: Uint8Array };
}): string {
  const plans = planHops(
    params.handRef,
    params.expiry,
    params.rootCapability,
    params.shakes,
  );

  const expectedCap = terminalCapability(params.rootCapability, params.shakes);
  const capAddr =
    params.capability.mode === "bearer"
      ? privateKeyToAddress(params.capability.secret)
      : params.capability.address;
  if (!eqAddr(capAddr, expectedCap))
    throw new PayloadCodecError(
      "non-canonical",
      "capability tail does not resolve to the terminal childCapability",
    );

  const body = params.metadata.body ?? new Uint8Array(0);
  if (body.length > MAX_INLINE_BODY_BYTES)
    throw new PayloadCodecError(
      "inline-body-too-large",
      `inline body is ${body.length} bytes; max is ${MAX_INLINE_BODY_BYTES}`,
    );

  const chunks: Uint8Array[] = [
    ...encodeHeader(PAYLOAD_KIND_LIVE_ROUTE, params.handRef),
    ...encodeHops(plans),
  ];
  if (params.capability.mode === "bearer") {
    chunks.push(Uint8Array.of(0x00));
    chunks.push(hexToBytes(params.capability.secret));
  } else {
    chunks.push(Uint8Array.of(0x01));
    chunks.push(hexToBytes(params.capability.address));
  }
  chunks.push(u(2, BigInt(params.metadata.envelope.length)));
  chunks.push(params.metadata.envelope);
  chunks.push(u(2, BigInt(body.length)));
  chunks.push(body);

  const fragment = b64urlEncode(concat(chunks));
  if (fragment.length > MAX_ENCODED_LINK_LENGTH)
    throw new PayloadCodecError(
      "link-too-long",
      `rendered link is ${fragment.length} chars; max is ${MAX_ENCODED_LINK_LENGTH}`,
    );
  return fragment;
}

/*//////////////////////////////////////////////////////////////
                      TerminalProof (0x02)
//////////////////////////////////////////////////////////////*/

/**
 * Compile the proof of a settled route for the raiser. Accepts ONLY signed
 * artifacts — there is no parameter through which a capability secret could
 * enter, so the proof can never hand its viewer competing-Give material.
 */
export function buildTerminalProof(params: {
  handRef: HandRef;
  expiry: bigint;
  rootCapability: `0x${string}`;
  shakes: SignedShake[];
  give: SignedGive;
  giverAcceptanceSig: Hex;
  evidence?: Uint8Array[];
}): string {
  const plans = planHops(
    params.handRef,
    params.expiry,
    params.rootCapability,
    params.shakes,
  );

  const g = params.give.give;
  if (g.handId !== params.handRef.handId)
    throw new PayloadCodecError("wrong-hand", "give handId mismatch");
  if (g.deadline !== params.expiry)
    throw new PayloadCodecError(
      "non-canonical",
      "give deadline is not transported; it must equal the Hand expiry",
    );
  const expectedRouteHash = routeHashOf(
    params.handRef,
    plans.map((p) => p.signed.shake),
  );
  if (g.routeHash.toLowerCase() !== expectedRouteHash.toLowerCase())
    throw new PayloadCodecError(
      "non-canonical",
      "give routeHash does not re-derive from the hops",
    );
  if (g.finalClaimBps !== terminalClaim(params.shakes))
    throw new PayloadCodecError(
      "non-canonical",
      "give finalClaimBps does not equal the terminal claim",
    );
  if (eqAddr(g.giver, ZERO_ADDRESS))
    throw new PayloadCodecError("non-canonical", "giver must not be zero");

  const evidence = params.evidence ?? [];
  if (evidence.length > 0xff)
    throw new PayloadCodecError("non-canonical", "too many evidence refs");

  const chunks: Uint8Array[] = [
    ...encodeHeader(PAYLOAD_KIND_TERMINAL_PROOF, params.handRef),
    ...encodeHops(plans),
    hexToBytes(g.giver as Hex),
    hexToBytes(g.solutionHash as Hex),
    hexToBytes(toCompactSig(params.give.signature)),
    hexToBytes(toCompactSig(params.giverAcceptanceSig)),
    Uint8Array.of(evidence.length),
  ];
  for (const ref of evidence) {
    if (ref.length > 0xffff)
      throw new PayloadCodecError("non-canonical", "evidence ref too long");
    chunks.push(u(2, BigInt(ref.length)));
    chunks.push(ref);
  }
  return b64urlEncode(concat(chunks));
}

/*//////////////////////////////////////////////////////////////
                            Decoding
//////////////////////////////////////////////////////////////*/

function decodeHeader(r: Reader, ctx: RouteContext): number {
  if (r.byte() !== MAGIC0 || r.byte() !== MAGIC1)
    throw new PayloadCodecError("bad-magic", "not an aHand payload");
  const version = r.byte();
  if (version !== VER)
    throw new PayloadCodecError(
      "unsupported-version",
      `unsupported payload version ${version}`,
    );
  const kind = r.byte();
  const chainId = toBig(r.take(8));
  const core = bytesToHex(r.take(20));
  const handId = toBig(r.take(32));
  if (
    chainId !== ctx.handRef.chainId ||
    !eqAddr(core, ctx.handRef.core) ||
    handId !== ctx.handRef.handId
  )
    throw new PayloadCodecError(
      "wrong-hand",
      "payload HandRef does not match the viewed Hand",
    );
  return kind;
}

function decodeHops(
  r: Reader,
  ctx: RouteContext,
): { shakes: SignedShake[]; modes: ShakerMode[] } {
  const hopCount = r.byte();
  if (hopCount > MAX_SHAKES)
    throw new PayloadCodecError(
      "too-many-shakes",
      `route has ${hopCount} hops; max is ${MAX_SHAKES}`,
    );

  const shakes: SignedShake[] = [];
  const modes: ShakerMode[] = [];
  let parentCap: string = ctx.rootCapability;
  let parentClaim = BPS_DENOMINATOR;
  for (let i = 0; i < hopCount; i++) {
    const childCapability = bytesToHex(r.take(20));
    const childClaimBps = Number(toBig(r.take(2)));
    const flags = r.byte();
    if ((flags & FLAG_RESERVED) !== 0)
      throw new PayloadCodecError(
        "non-canonical",
        `hop ${i} carries reserved flag bits`,
      );
    const modeOrdinal = flags & FLAG_MODE_MASK;
    if (modeOrdinal >= MODE_NAME.length)
      throw new PayloadCodecError("non-canonical", `hop ${i} mode is invalid`);
    const mode = MODE_NAME[modeOrdinal]!;

    let shaker: string;
    let acceptanceSig: Hex | undefined;
    if (mode === "explicit") {
      shaker = bytesToHex(r.take(20));
      if (eqAddr(shaker, ZERO_ADDRESS) || eqAddr(shaker, parentCap))
        throw new PayloadCodecError(
          "non-canonical",
          `hop ${i} explicit shaker collapses to an implicit mode`,
        );
      acceptanceSig = fromCompactSig(bytesToHex(r.take(64)));
    } else {
      shaker = mode === "self" ? parentCap : ZERO_ADDRESS;
    }

    let hopDataHash: string = ZERO_BYTES32;
    if (flags & FLAG_HOP_DATA) {
      hopDataHash = bytesToHex(r.take(32));
      if (hopDataHash === ZERO_BYTES32)
        throw new PayloadCodecError(
          "non-canonical",
          `hop ${i} zero hopDataHash must be omitted`,
        );
    }
    const signature = fromCompactSig(bytesToHex(r.take(64)));

    const shake = ShakeSchema.parse({
      handId: ctx.handRef.handId,
      childCapability,
      shaker,
      parentClaimBps: parentClaim,
      childClaimBps,
      hopDataHash,
      deadline: ctx.expiry,
    });
    shakes.push({ shake, signature, acceptanceSig });
    modes.push(mode);
    parentCap = childCapability;
    parentClaim = childClaimBps;
  }
  return { shakes, modes };
}

export function decodeLiveRoute(
  fragment: string,
  ctx: RouteContext,
): LiveRoutePayload {
  // Oversize is rejected BEFORE any parsing — a link that could not have been
  // rendered is not worth decoding.
  if (fragment.length > MAX_ENCODED_LINK_LENGTH)
    throw new PayloadCodecError(
      "link-too-long",
      `fragment is ${fragment.length} chars; max is ${MAX_ENCODED_LINK_LENGTH}`,
    );
  const r = new Reader(b64urlDecode(fragment));
  const kind = decodeHeader(r, ctx);
  if (kind !== PAYLOAD_KIND_LIVE_ROUTE)
    throw new WrongPayloadKind(PAYLOAD_KIND_LIVE_ROUTE, kind);

  const { shakes, modes } = decodeHops(r, ctx);

  const capMode = r.byte();
  let capability: Capability;
  if (capMode === 0x00) {
    capability = { mode: "bearer", secret: bytesToHex(r.take(32)) };
  } else if (capMode === 0x01) {
    capability = {
      mode: "personal",
      address: bytesToHex(r.take(20)) as `0x${string}`,
    };
  } else {
    throw new PayloadCodecError("non-canonical", "unknown capability mode");
  }

  const envelope = new Uint8Array(r.take(Number(toBig(r.take(2)))));
  const bodyLen = Number(toBig(r.take(2)));
  if (bodyLen > MAX_INLINE_BODY_BYTES)
    throw new PayloadCodecError(
      "inline-body-too-large",
      `inline body is ${bodyLen} bytes; max is ${MAX_INLINE_BODY_BYTES}`,
    );
  const body = new Uint8Array(r.take(bodyLen));
  r.expectEnd();

  return {
    kind: "live-route",
    handRef: ctx.handRef,
    shakes,
    modes,
    capability,
    metadata: { envelope, body },
  };
}

export function decodeTerminalProof(
  fragment: string,
  ctx: RouteContext,
): TerminalProofPayload {
  const r = new Reader(b64urlDecode(fragment));
  const kind = decodeHeader(r, ctx);
  if (kind !== PAYLOAD_KIND_TERMINAL_PROOF)
    throw new WrongPayloadKind(PAYLOAD_KIND_TERMINAL_PROOF, kind);

  const { shakes, modes } = decodeHops(r, ctx);

  const giver = bytesToHex(r.take(20));
  if (eqAddr(giver, ZERO_ADDRESS))
    throw new PayloadCodecError("non-canonical", "giver must not be zero");
  const solutionHash = bytesToHex(r.take(32));
  const giveSig = fromCompactSig(bytesToHex(r.take(64)));
  const giverAcceptanceSig = fromCompactSig(bytesToHex(r.take(64)));

  const evidenceCount = r.byte();
  const evidence: Uint8Array[] = [];
  for (let i = 0; i < evidenceCount; i++)
    evidence.push(new Uint8Array(r.take(Number(toBig(r.take(2))))));
  r.expectEnd();

  const give: Give = {
    handId: ctx.handRef.handId,
    routeHash: routeHashOf(
      ctx.handRef,
      shakes.map((s) => s.shake),
    ),
    giver,
    solutionHash,
    finalClaimBps: terminalClaim(shakes),
    deadline: ctx.expiry,
  };

  return {
    kind: "terminal-proof",
    handRef: ctx.handRef,
    shakes,
    modes,
    give: { give, signature: giveSig },
    giverAcceptanceSig,
    evidence,
  };
}

/** Peek the kind byte without paying for a full decode. */
export function peekPayloadKind(fragment: string): number {
  const head = b64urlDecode(fragment.slice(0, 8));
  if (head.length < 4 || head[0] !== MAGIC0 || head[1] !== MAGIC1)
    throw new PayloadCodecError("bad-magic", "not an aHand payload");
  if (head[2] !== VER)
    throw new PayloadCodecError(
      "unsupported-version",
      `unsupported payload version ${head[2]}`,
    );
  return head[3]!;
}

/** Dispatch on the kind discriminator. */
export function decodePayload(
  fragment: string,
  ctx: RouteContext,
): LiveRoutePayload | TerminalProofPayload {
  const kind = peekPayloadKind(fragment);
  if (kind === PAYLOAD_KIND_LIVE_ROUTE) return decodeLiveRoute(fragment, ctx);
  if (kind === PAYLOAD_KIND_TERMINAL_PROOF)
    return decodeTerminalProof(fragment, ctx);
  throw new PayloadCodecError(
    "wrong-kind",
    `unknown payload kind 0x${kind.toString(16).padStart(2, "0")}`,
  );
}
