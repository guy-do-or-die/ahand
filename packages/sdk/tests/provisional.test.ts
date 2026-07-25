import { describe, expect, it } from "vitest";
import {
  hashTypedData,
  hexToBytes,
  keccak256,
  recoverAddress,
  sha256,
  stringToBytes,
  type Hex,
} from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import {
  BPS_DENOMINATOR,
  GIVE_TYPEHASH,
  GIVER_ACCEPTANCE_TYPEHASH,
  MAX_ENCODED_LINK_LENGTH,
  MAX_INLINE_BODY_BYTES,
  PAYLOAD_KIND_LIVE_ROUTE,
  PAYLOAD_KIND_TERMINAL_PROOF,
  PayloadCodecError,
  SHAKE_TYPEHASH,
  SHAKER_ACCEPTANCE_TYPEHASH,
  SHAKER_ACCEPTANCE_TYPES,
  WrongPayloadKind,
  ZERO_ADDRESS,
  ZERO_BYTES32,
  buildLiveRoute,
  buildTerminalProof,
  decodeLiveRoute,
  decodePayload,
  decodeTerminalProof,
  domain,
  domainSeparator,
  eip712Digest,
  fromCompactSig,
  giveDigest,
  giveHash,
  giverAcceptanceDigest,
  handRef,
  routeHash,
  routeHashOf,
  shakeDigest,
  shakeStructHash,
  shakerAcceptanceDigest,
  signGive,
  signGiverAcceptance,
  signShake,
  signShakerAcceptance,
  toCompactSig,
  verifyLiveRoute,
  verifyTerminalProof,
  type Give,
  type HandRef,
  type Shake,
  type SignedShake,
  type TypedSigner,
  type VerifyResult,
} from "../src/index.js";

/**
 * Provisional self-consistency suite: every expectation here is derived from
 * the SDK itself, NOT from the contract. It freezes round-trips, the wire
 * layout, structural stripping and the failure taxonomy — byte identity with
 * the chain is the job of the Foundry-generated vector suite that replaces
 * the provisional flag.
 */
const fixtures = { provisional: true } as const;

const pk = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}` as Hex;

const CHAIN_ID = 31337n;
const CORE = "0x00000000000000000000000000000000000c0ffe" as const;
const HAND_ID = 1n;
const EXPIRY = 2_000_000_000n;
const REF: HandRef = { chainId: CHAIN_ID, core: CORE, handId: HAND_ID };

const rootPriv = pk(0xa0);
const cap1Priv = pk(0xa1);
const cap2Priv = pk(0xa2);
const shakerPriv = pk(0xb1);
const giverPriv = pk(0xb2);
const rootAddr = privateKeyToAddress(rootPriv);
const cap1Addr = privateKeyToAddress(cap1Priv);
const cap2Addr = privateKeyToAddress(cap2Priv);
const shakerAddr = privateKeyToAddress(shakerPriv);
const giverAddr = privateKeyToAddress(giverPriv);

const ctx = { handRef: REF, expiry: EXPIRY, rootCapability: rootAddr };
const baseFacts = {
  handRef: REF,
  rootCapability: rootAddr,
  expiry: EXPIRY,
  minGiverClaimBps: 2_000,
  now: EXPIRY - 1_000n,
};

const utf8 = (s: string) => new TextEncoder().encode(s);
const envelope = utf8('{"v":1,"schema":"note"}');

function mkShake(over: Partial<Shake>): Shake {
  return {
    handId: HAND_ID,
    childCapability: cap1Addr,
    shaker: ZERO_ADDRESS,
    parentClaimBps: BPS_DENOMINATOR,
    childClaimBps: BPS_DENOMINATOR,
    hopDataHash: ZERO_BYTES32,
    deadline: EXPIRY,
    ...over,
  };
}

async function signedHop(
  parentPriv: Hex,
  over: Partial<Shake>,
  acceptBy?: Hex,
): Promise<SignedShake> {
  const shake = mkShake(over);
  const signature = await signShake(shake, parentPriv, CHAIN_ID, CORE);
  const acceptanceSig = acceptBy
    ? await signShakerAcceptance(
        shakeStructHash(shake),
        privateKeyToAccount(acceptBy) as TypedSigner,
        CHAIN_ID,
        CORE,
      )
    : undefined;
  return { shake, signature, acceptanceSig };
}

/** Two hops: anonymous zero-margin, then explicit with a consented margin. */
async function baseRoute(): Promise<SignedShake[]> {
  return [
    await signedHop(rootPriv, {}),
    await signedHop(
      cap1Priv,
      {
        childCapability: cap2Addr,
        shaker: shakerAddr,
        parentClaimBps: 10_000,
        childClaimBps: 9_000,
      },
      shakerPriv,
    ),
  ];
}

async function baseGive(shakes: SignedShake[]) {
  const give: Give = {
    handId: HAND_ID,
    routeHash: routeHashOf(
      REF,
      shakes.map((s) => s.shake),
    ),
    giver: giverAddr,
    solutionHash: keccak256(stringToBytes("solution")),
    finalClaimBps: 9_000,
    deadline: EXPIRY,
  };
  const signature = await signGive(give, cap2Priv, CHAIN_ID, CORE);
  const giverAcceptanceSig = await signGiverAcceptance(
    giveHash(give),
    privateKeyToAccount(giverPriv) as TypedSigner,
    CHAIN_ID,
    CORE,
  );
  return { give, signature, giverAcceptanceSig };
}

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected function to throw");
}

function codeOf(fn: () => unknown): string {
  const e = thrown(fn);
  expect(e).toBeInstanceOf(PayloadCodecError);
  return (e as PayloadCodecError).code;
}

function reasons(result: VerifyResult): string[] {
  return result.ok ? [] : result.failures.map((f) => f.reason);
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++)
      if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  return Uint8Array.from(atob(b64 + pad), (c) => c.charCodeAt(0));
}

/** Hand-rolled writer: locks the byte layout independently of the codec. */
function craft(...parts: (number[] | Uint8Array | Hex)[]): string {
  const chunks = parts.map((p) =>
    typeof p === "string" ? hexToBytes(p) : Uint8Array.from(p),
  );
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return b64urlEncode(out);
}
const HEADER = (kind: number): (number[] | Uint8Array | Hex)[] => [
  [0x61, 0x48, 0x02, kind], // magic "aH" | version | kind
  [0, 0, 0, 0, 0, 0, 0x7a, 0x69], // chainId 31337 as u64
  CORE,
  new Uint8Array(31),
  [0x01], // handId 1 as u256
];

describe("provisional fixtures", () => {
  it("are marked provisional until Foundry vectors land", () => {
    expect(fixtures.provisional).toBe(true);
  });
});

describe("typed data coherence", () => {
  it("domain is aHand version 2", () => {
    expect(domain(CHAIN_ID, CORE)).toEqual({
      name: "aHand",
      version: "2",
      chainId: 31337,
      verifyingContract: CORE,
    });
  });

  it("typehashes derive from the frozen literals", () => {
    expect(SHAKE_TYPEHASH).toBe(
      keccak256(
        stringToBytes(
          "Shake(uint256 handId,address childCapability,address shaker,uint16 parentClaimBps,uint16 childClaimBps,bytes32 hopDataHash,uint40 deadline)",
        ),
      ),
    );
    expect(SHAKER_ACCEPTANCE_TYPEHASH).toBe(
      keccak256(stringToBytes("ShakerAcceptance(bytes32 shakeHash)")),
    );
    expect(GIVE_TYPEHASH).toBe(
      keccak256(
        stringToBytes(
          "Give(uint256 handId,bytes32 routeHash,address giver,bytes32 solutionHash,uint16 finalClaimBps,uint40 deadline)",
        ),
      ),
    );
    expect(GIVER_ACCEPTANCE_TYPEHASH).toBe(
      keccak256(stringToBytes("GiverAcceptance(bytes32 giveHash)")),
    );
  });

  it("shakeDigest agrees between the types table and the typehash path", () => {
    const s = mkShake({ shaker: shakerAddr, childClaimBps: 9_000 });
    expect(shakeDigest(s, CHAIN_ID, CORE)).toBe(
      eip712Digest(domainSeparator(CHAIN_ID, CORE), shakeStructHash(s)),
    );
  });

  it("giveDigest agrees between the types table and the typehash path", async () => {
    const { give } = await baseGive(await baseRoute());
    expect(giveDigest(give, CHAIN_ID, CORE)).toBe(
      eip712Digest(domainSeparator(CHAIN_ID, CORE), giveHash(give)),
    );
  });

  it("acceptance digests agree with hashTypedData over the acceptance tables", () => {
    const shakeHash = keccak256(stringToBytes("x"));
    expect(shakerAcceptanceDigest(shakeHash, CHAIN_ID, CORE)).toBe(
      hashTypedData({
        domain: domain(CHAIN_ID, CORE),
        types: SHAKER_ACCEPTANCE_TYPES,
        primaryType: "ShakerAcceptance",
        message: { shakeHash },
      }),
    );
    expect(giverAcceptanceDigest(shakeHash, CHAIN_ID, CORE)).not.toBe(
      shakerAcceptanceDigest(shakeHash, CHAIN_ID, CORE),
    );
  });
});

describe("handRef and routeHash layout", () => {
  const refHash = handRef(REF);

  it("handRef is keccak256(abi.encode(chainId, core, handId))", () => {
    const manual = keccak256(
      ("0x" +
        CHAIN_ID.toString(16).padStart(64, "0") +
        CORE.slice(2).padStart(64, "0") +
        HAND_ID.toString(16).padStart(64, "0")) as Hex,
    );
    expect(refHash).toBe(manual);
  });

  it("empty route: keccak256(handRef ++ offset 0x40 ++ length 0)", () => {
    const manual = keccak256(
      (refHash +
        "40".padStart(64, "0") +
        "".padStart(64, "0")) as Hex,
    );
    expect(routeHash(refHash, [])).toBe(manual);
  });

  it("two-hop route: keccak256(handRef ++ offset ++ length 2 ++ h0 ++ h1)", () => {
    const h0 = keccak256(stringToBytes("h0"));
    const h1 = keccak256(stringToBytes("h1"));
    const manual = keccak256(
      (refHash +
        "40".padStart(64, "0") +
        "2".padStart(64, "0") +
        h0.slice(2) +
        h1.slice(2)) as Hex,
    );
    expect(routeHash(refHash, [h0, h1])).toBe(manual);
  });

  it("routeHashOf covers struct hashes, not signature bytes", async () => {
    const shakes = await baseRoute();
    expect(
      routeHash(
        refHash,
        shakes.map((s) => shakeStructHash(s.shake)),
      ),
    ).toBe(
      routeHashOf(
        REF,
        shakes.map((s) => s.shake),
      ),
    );
  });
});

describe("EIP-2098 compact signatures", () => {
  it("round-trips and still recovers the signer", async () => {
    const s = mkShake({});
    const sig = await signShake(s, rootPriv, CHAIN_ID, CORE);
    const compact = toCompactSig(sig);
    expect(hexToBytes(compact).length).toBe(64);
    expect(fromCompactSig(compact)).toBe(sig);
    expect(
      await recoverAddress({
        hash: shakeDigest(s, CHAIN_ID, CORE),
        signature: fromCompactSig(compact),
      }),
    ).toBe(rootAddr);
  });

  it("passes already-converted forms through", async () => {
    const sig = await signShake(mkShake({}), rootPriv, CHAIN_ID, CORE);
    expect(toCompactSig(toCompactSig(sig))).toBe(toCompactSig(sig));
    expect(fromCompactSig(sig)).toBe(sig);
  });
});

describe("LiveRoute codec", () => {
  it("round-trips a zero-hop bearer link (the raise link)", () => {
    const frag = buildLiveRoute({
      handRef: REF,
      expiry: EXPIRY,
      rootCapability: rootAddr,
      shakes: [],
      capability: { mode: "bearer", secret: rootPriv },
      metadata: { envelope, body: utf8("hello") },
    });
    const d = decodeLiveRoute(frag, ctx);
    expect(d.kind).toBe("live-route");
    expect(d.shakes).toEqual([]);
    expect(d.capability).toEqual({ mode: "bearer", secret: rootPriv });
    expect(new TextDecoder().decode(d.metadata.envelope)).toBe(
      new TextDecoder().decode(envelope),
    );
    expect(new TextDecoder().decode(d.metadata.body)).toBe("hello");
  });

  it("round-trips anonymous, explicit and self hops with derived modes", async () => {
    const shakes = [
      ...(await baseRoute()),
      // self hop: the personal wallet holding cap2 attributes itself
      await signedHop(cap2Priv, {
        childCapability: privateKeyToAddress(pk(0xa3)),
        shaker: cap2Addr,
        parentClaimBps: 9_000,
        childClaimBps: 9_000,
        hopDataHash: keccak256(stringToBytes("hop-data")),
      }),
    ];
    const frag = buildLiveRoute({
      handRef: REF,
      expiry: EXPIRY,
      rootCapability: rootAddr,
      shakes,
      capability: { mode: "bearer", secret: pk(0xa3) },
      metadata: { envelope },
    });
    const d = decodeLiveRoute(frag, ctx);
    expect(d.modes).toEqual(["anonymous", "explicit", "self"]);
    expect(d.shakes.map((s) => s.shake.parentClaimBps)).toEqual([
      10_000, 10_000, 9_000,
    ]);
    expect(d.shakes.map((s) => s.shake.deadline)).toEqual([
      EXPIRY, EXPIRY, EXPIRY,
    ]);
    expect(d.shakes[1]!.shake.shaker.toLowerCase()).toBe(
      shakerAddr.toLowerCase(),
    );
    expect(d.shakes[2]!.shake.shaker.toLowerCase()).toBe(
      cap2Addr.toLowerCase(),
    );
    expect(d.shakes[2]!.shake.hopDataHash).toBe(
      keccak256(stringToBytes("hop-data")),
    );
    expect(d.shakes.map((s) => s.signature)).toEqual(
      shakes.map((s) => s.signature),
    );
    expect(d.shakes[1]!.acceptanceSig).toBe(shakes[1]!.acceptanceSig);
    // decoded structs re-encode to the identical fragment
    expect(
      buildLiveRoute({
        handRef: REF,
        expiry: EXPIRY,
        rootCapability: rootAddr,
        shakes: d.shakes,
        capability: d.capability,
        metadata: d.metadata,
      }),
    ).toBe(frag);
  });

  it("round-trips a personal capability tail without any secret", async () => {
    const shakes = [
      await signedHop(rootPriv, { childCapability: shakerAddr }),
    ];
    const frag = buildLiveRoute({
      handRef: REF,
      expiry: EXPIRY,
      rootCapability: rootAddr,
      shakes,
      capability: { mode: "personal", address: shakerAddr },
      metadata: { envelope },
    });
    const d = decodeLiveRoute(frag, ctx);
    expect(d.capability.mode).toBe("personal");
    expect(containsBytes(b64urlDecode(frag), hexToBytes(rootPriv))).toBe(false);
  });

  it("STRIPPING: the forwarded link carries exactly the latest secret", async () => {
    const shakes = await baseRoute();
    const frag = buildLiveRoute({
      handRef: REF,
      expiry: EXPIRY,
      rootCapability: rootAddr,
      shakes,
      capability: { mode: "bearer", secret: cap2Priv },
      metadata: { envelope },
    });
    const raw = b64urlDecode(frag);
    expect(containsBytes(raw, hexToBytes(cap2Priv))).toBe(true);
    expect(containsBytes(raw, hexToBytes(rootPriv))).toBe(false);
    expect(containsBytes(raw, hexToBytes(cap1Priv))).toBe(false);
  });

  it("rejects a decode against the wrong Hand", async () => {
    const frag = buildLiveRoute({
      handRef: REF,
      expiry: EXPIRY,
      rootCapability: rootAddr,
      shakes: [],
      capability: { mode: "bearer", secret: rootPriv },
      metadata: { envelope },
    });
    expect(
      codeOf(() =>
        decodeLiveRoute(frag, { ...ctx, handRef: { ...REF, handId: 2n } }),
      ),
    ).toBe("wrong-hand");
  });
});

describe("TerminalProof codec", () => {
  async function baseProof() {
    const shakes = await baseRoute();
    const { give, signature, giverAcceptanceSig } = await baseGive(shakes);
    const frag = buildTerminalProof({
      handRef: REF,
      expiry: EXPIRY,
      rootCapability: rootAddr,
      shakes,
      give: { give, signature },
      giverAcceptanceSig,
      evidence: [utf8("xmtp:msg-1"), utf8("ipfs://bafy...")],
    });
    return { shakes, give, signature, giverAcceptanceSig, frag };
  }

  it("round-trips and re-derives the Give binding fields", async () => {
    const { give, signature, giverAcceptanceSig, frag } = await baseProof();
    const d = decodeTerminalProof(frag, ctx);
    expect(d.kind).toBe("terminal-proof");
    expect(d.give.give.routeHash).toBe(give.routeHash);
    expect(d.give.give.finalClaimBps).toBe(9_000);
    expect(d.give.give.deadline).toBe(EXPIRY);
    expect(d.give.give.giver.toLowerCase()).toBe(giverAddr.toLowerCase());
    expect(d.give.give.solutionHash).toBe(give.solutionHash);
    expect(d.give.signature).toBe(signature);
    expect(d.giverAcceptanceSig).toBe(giverAcceptanceSig);
    expect(d.evidence.map((e) => new TextDecoder().decode(e))).toEqual([
      "xmtp:msg-1",
      "ipfs://bafy...",
    ]);
  });

  it("ADVERSARIAL: yields no competing-Give material", async () => {
    const { frag } = await baseProof();
    const raw = b64urlDecode(frag);
    for (const secret of [rootPriv, cap1Priv, cap2Priv, giverPriv, shakerPriv])
      expect(containsBytes(raw, hexToBytes(secret))).toBe(false);
    const d = decodeTerminalProof(frag, ctx);
    expect("capability" in d).toBe(false);
  });

  it("buildTerminalProof refuses unsigned or inconsistent artifacts", async () => {
    const shakes = await baseRoute();
    const { give, signature, giverAcceptanceSig } = await baseGive(shakes);
    const build = (g: Give) => () =>
      buildTerminalProof({
        handRef: REF,
        expiry: EXPIRY,
        rootCapability: rootAddr,
        shakes,
        give: { give: g, signature },
        giverAcceptanceSig,
      });
    expect(codeOf(build({ ...give, routeHash: ZERO_BYTES32 }))).toBe(
      "non-canonical",
    );
    expect(codeOf(build({ ...give, finalClaimBps: 8_000 }))).toBe(
      "non-canonical",
    );
    expect(codeOf(build({ ...give, deadline: EXPIRY - 1n }))).toBe(
      "non-canonical",
    );
    expect(codeOf(build({ ...give, giver: ZERO_ADDRESS }))).toBe(
      "non-canonical",
    );
    expect(codeOf(build({ ...give, handId: 2n }))).toBe("wrong-hand");
  });

  it("rejects a truncated proof", async () => {
    const { frag } = await baseProof();
    const raw = b64urlDecode(frag);
    expect(
      codeOf(() =>
        decodeTerminalProof(b64urlEncode(raw.subarray(0, raw.length - 8)), ctx),
      ),
    ).toBe("truncated");
  });
});

describe("kind discrimination", () => {
  async function bothFragments() {
    const shakes = await baseRoute();
    const live = buildLiveRoute({
      handRef: REF,
      expiry: EXPIRY,
      rootCapability: rootAddr,
      shakes,
      capability: { mode: "bearer", secret: cap2Priv },
      metadata: { envelope },
    });
    const { give, signature, giverAcceptanceSig } = await baseGive(shakes);
    const proof = buildTerminalProof({
      handRef: REF,
      expiry: EXPIRY,
      rootCapability: rootAddr,
      shakes,
      give: { give, signature },
      giverAcceptanceSig,
    });
    return { live, proof };
  }

  it("decodeLiveRoute refuses a terminal proof and vice versa", async () => {
    const { live, proof } = await bothFragments();
    const e1 = thrown(() => decodeLiveRoute(proof, ctx));
    expect(e1).toBeInstanceOf(WrongPayloadKind);
    expect((e1 as WrongPayloadKind).expected).toBe(PAYLOAD_KIND_LIVE_ROUTE);
    expect((e1 as WrongPayloadKind).actual).toBe(PAYLOAD_KIND_TERMINAL_PROOF);
    const e2 = thrown(() => decodeTerminalProof(live, ctx));
    expect(e2).toBeInstanceOf(WrongPayloadKind);
  });

  it("decodePayload dispatches on the kind byte", async () => {
    const { live, proof } = await bothFragments();
    expect(decodePayload(live, ctx).kind).toBe("live-route");
    expect(decodePayload(proof, ctx).kind).toBe("terminal-proof");
    expect(codeOf(() => decodePayload(craft(...HEADER(0x03)), ctx))).toBe(
      "wrong-kind",
    );
  });

  it("rejects foreign magic and foreign versions", () => {
    expect(codeOf(() => decodePayload(craft([0x00, 0x00, 0x02, 0x01]), ctx))).toBe(
      "bad-magic",
    );
    expect(codeOf(() => decodePayload(craft([0x61, 0x48, 0x01, 0x01]), ctx))).toBe(
      "unsupported-version",
    );
  });
});

describe("size boundaries", () => {
  const buildWith = (envLen: number, bodyLen: number) => () =>
    buildLiveRoute({
      handRef: REF,
      expiry: EXPIRY,
      rootCapability: rootAddr,
      shakes: [],
      capability: { mode: "bearer", secret: rootPriv },
      metadata: {
        envelope: new Uint8Array(envLen),
        body: new Uint8Array(bodyLen),
      },
    });

  it("accepts an inline body of exactly the cap and round-trips it", () => {
    const frag = buildWith(0, MAX_INLINE_BODY_BYTES)();
    expect(decodeLiveRoute(frag, ctx).metadata.body.length).toBe(
      MAX_INLINE_BODY_BYTES,
    );
  });

  it("rejects an inline body one byte over the cap on encode", () => {
    expect(codeOf(buildWith(0, MAX_INLINE_BODY_BYTES + 1))).toBe(
      "inline-body-too-large",
    );
  });

  it("rejects an oversized body length on decode before reading it", () => {
    // zero-hop live route crafted by hand, claiming a body over the cap
    const frag = craft(
      ...HEADER(0x01),
      [0x00], // hopCount
      [0x00], // bearer capability
      rootPriv,
      [0x00, 0x00], // envelopeLen
      [0x01, 0x01], // bodyLen = 257
      new Uint8Array(257),
    );
    expect(codeOf(() => decodeLiveRoute(frag, ctx))).toBe(
      "inline-body-too-large",
    );
  });

  it("renders a link of exactly the cap, and refuses one byte more", () => {
    // zero-hop bearer payload is 102 bytes + envelope; 1425 bytes render to 1900 chars
    const atCap = buildWith(1_323, 0)();
    expect(atCap.length).toBe(MAX_ENCODED_LINK_LENGTH);
    expect(decodeLiveRoute(atCap, ctx).metadata.envelope.length).toBe(1_323);
    expect(codeOf(buildWith(1_324, 0))).toBe("link-too-long");
  });

  it("rejects an oversized fragment before touching its bytes", () => {
    expect(codeOf(() => decodeLiveRoute("A".repeat(1_901), ctx))).toBe(
      "link-too-long",
    );
    // one char shorter reaches the parser and fails structurally instead
    expect(codeOf(() => decodeLiveRoute("A".repeat(1_900), ctx))).toBe(
      "bad-magic",
    );
  });

  it("refuses more than MAX_SHAKES hops on encode and decode", async () => {
    const shakes: SignedShake[] = [];
    let parent = rootPriv;
    for (let i = 0; i < 7; i++) {
      const child = pk(0xc0 + i);
      shakes.push(
        await signedHop(parent, {
          childCapability: privateKeyToAddress(child),
        }),
      );
      parent = child;
    }
    expect(
      codeOf(() =>
        buildLiveRoute({
          handRef: REF,
          expiry: EXPIRY,
          rootCapability: rootAddr,
          shakes,
          capability: { mode: "bearer", secret: parent },
          metadata: { envelope },
        }),
      ),
    ).toBe("too-many-shakes");
    const frag = craft(...HEADER(0x01), [0x07]);
    expect(codeOf(() => decodeLiveRoute(frag, ctx))).toBe("too-many-shakes");
  });
});

describe("canonical-mode rejections", () => {
  const build = (shakes: SignedShake[], secret: Hex) => () =>
    buildLiveRoute({
      handRef: REF,
      expiry: EXPIRY,
      rootCapability: rootAddr,
      shakes,
      capability: { mode: "bearer", secret },
      metadata: { envelope },
    });

  it("explicit hop must carry an acceptance", async () => {
    const hop = await signedHop(rootPriv, { shaker: shakerAddr });
    expect(codeOf(build([hop], cap1Priv))).toBe("non-canonical");
  });

  it("anonymous and self hops must not carry an acceptance", async () => {
    const anon = await signedHop(rootPriv, {}, shakerPriv);
    expect(codeOf(build([anon], cap1Priv))).toBe("non-canonical");
    const self = await signedHop(rootPriv, { shaker: rootAddr }, shakerPriv);
    expect(codeOf(build([self], cap1Priv))).toBe("non-canonical");
  });

  it("parentClaim chain and deadlines are not transported and must be canonical", async () => {
    const broken = await signedHop(rootPriv, { parentClaimBps: 9_999 });
    expect(codeOf(build([broken], cap1Priv))).toBe("non-canonical");
    const early = await signedHop(rootPriv, { deadline: EXPIRY - 1n });
    expect(codeOf(build([early], cap1Priv))).toBe("non-canonical");
  });

  it("capability tail must resolve to the terminal childCapability", async () => {
    const hop = await signedHop(rootPriv, {});
    expect(codeOf(build([hop], cap2Priv))).toBe("non-canonical");
    expect(
      codeOf(() =>
        buildLiveRoute({
          handRef: REF,
          expiry: EXPIRY,
          rootCapability: rootAddr,
          shakes: [hop],
          capability: { mode: "personal", address: rootAddr },
          metadata: { envelope },
        }),
      ),
    ).toBe("non-canonical");
  });

  it("decoder rejects impossible flags and collapsed explicit shakers", () => {
    const hopHead = (flags: number) => [
      ...HEADER(0x01),
      [0x01], // hopCount
      cap1Addr,
      [0x27, 0x10], // childClaimBps 10000
      [flags],
    ];
    expect(
      codeOf(() => decodeLiveRoute(craft(...hopHead(0b0000_0011)), ctx)),
    ).toBe("non-canonical"); // mode ordinal 3
    expect(
      codeOf(() => decodeLiveRoute(craft(...hopHead(0b0000_1000)), ctx)),
    ).toBe("non-canonical"); // reserved bit
    expect(
      codeOf(() =>
        decodeLiveRoute(
          craft(...hopHead(0b0000_0010), ZERO_ADDRESS, new Uint8Array(64)),
          ctx,
        ),
      ),
    ).toBe("non-canonical"); // explicit shaker == zero
    expect(
      codeOf(() =>
        decodeLiveRoute(
          craft(...hopHead(0b0000_0010), rootAddr, new Uint8Array(64)),
          ctx,
        ),
      ),
    ).toBe("non-canonical"); // explicit shaker == signing parent
    expect(
      codeOf(() =>
        decodeLiveRoute(
          craft(...hopHead(0b0000_0100), ZERO_BYTES32, new Uint8Array(64)),
          ctx,
        ),
      ),
    ).toBe("non-canonical"); // zero hopDataHash must be omitted
  });
});

describe("verifyLiveRoute", () => {
  async function baseline() {
    const shakes = await baseRoute();
    const frag = buildLiveRoute({
      handRef: REF,
      expiry: EXPIRY,
      rootCapability: rootAddr,
      shakes,
      capability: { mode: "bearer", secret: cap2Priv },
      metadata: { envelope },
    });
    return decodeLiveRoute(frag, ctx);
  }

  it("accepts the untampered baseline", async () => {
    expect(await verifyLiveRoute(await baseline(), baseFacts)).toEqual({
      ok: true,
    });
    expect(
      await verifyLiveRoute(await baseline(), {
        ...baseFacts,
        metadataCommitment: sha256(envelope),
        distributablePool: 1_000_000n,
      }),
    ).toEqual({ ok: true });
  });

  it("TAMPER: a flipped signature byte betrays the capability", async () => {
    const d = await baseline();
    const sig = hexToBytes(d.shakes[0]!.signature as Hex);
    sig[10]! ^= 0xff;
    d.shakes[0]!.signature = `0x${Buffer.from(sig).toString("hex")}` as Hex;
    const r = await verifyLiveRoute(d, baseFacts);
    expect(reasons(r)).toContain("capability-proof");
  });

  it("TAMPER: a raised child claim breaks both chain and signature", async () => {
    const d = await baseline();
    d.shakes[1]!.shake.childClaimBps = 9_500;
    const r = await verifyLiveRoute(d, baseFacts);
    expect(reasons(r)).toContain("capability-proof");
  });

  it("TAMPER: a swapped shaker invalidates shake and acceptance", async () => {
    const d = await baseline();
    d.shakes[1]!.shake.shaker = giverAddr;
    const r = await verifyLiveRoute(d, baseFacts);
    expect(reasons(r)).toEqual(
      expect.arrayContaining(["capability-proof", "shaker-acceptance-invalid"]),
    );
  });

  it("TAMPER: claim growth, floor, chain and deadline each get named", async () => {
    const d = await baseline();
    d.shakes[1]!.shake.parentClaimBps = 9_000;
    d.shakes[1]!.shake.childClaimBps = 9_500;
    d.shakes[1]!.shake.deadline = EXPIRY - 5n;
    const r = await verifyLiveRoute(d, {
      ...baseFacts,
      minGiverClaimBps: 9_600,
    });
    expect(reasons(r)).toEqual(
      expect.arrayContaining([
        "claim-mismatch",
        "claim-must-not-grow",
        "claim-below-floor",
        "deadline-mismatch",
      ]),
    );
  });

  it("TAMPER: margin without a shaker, margin rounding to dust", async () => {
    const d = await baseline();
    d.shakes[0]!.shake.childClaimBps = 9_990; // anonymous hop suddenly claims margin
    d.shakes[1]!.shake.parentClaimBps = 9_990;
    const r = await verifyLiveRoute(d, {
      ...baseFacts,
      distributablePool: 3n, // 3 * margin / 10000 floors to zero
    });
    expect(reasons(r)).toEqual(
      expect.arrayContaining([
        "anonymous-shaker-with-margin",
        "margin-rounds-to-zero",
      ]),
    );
  });

  it("TAMPER: acceptance presence must match the mode", async () => {
    const d = await baseline();
    const acceptance = d.shakes[1]!.acceptanceSig;
    d.shakes[1]!.acceptanceSig = undefined;
    d.shakes[0]!.acceptanceSig = acceptance;
    const r = await verifyLiveRoute(d, baseFacts);
    expect(reasons(r)).toEqual(
      expect.arrayContaining(["acceptance-missing", "unexpected-acceptance"]),
    );
  });

  it("TAMPER: capability tail and metadata commitment", async () => {
    const d = await baseline();
    d.capability = { mode: "bearer", secret: cap1Priv };
    const r = await verifyLiveRoute(d, {
      ...baseFacts,
      metadataCommitment: sha256(utf8("other-envelope")),
    });
    expect(reasons(r)).toEqual(
      expect.arrayContaining([
        "capability-mismatch",
        "metadata-commitment-mismatch",
      ]),
    );
  });

  it("fails closed at and after expiry", async () => {
    const d = await baseline();
    const r = await verifyLiveRoute(d, { ...baseFacts, now: EXPIRY });
    expect(reasons(r)).toContain("expired");
  });

  it("flags a payload replayed against another hand", async () => {
    const d = await baseline();
    d.handRef = { ...REF, handId: 2n };
    const r = await verifyLiveRoute(d, baseFacts);
    expect(reasons(r)).toContain("wrong-hand");
  });
});

describe("verifyTerminalProof", () => {
  async function baseline() {
    const shakes = await baseRoute();
    const { give, signature, giverAcceptanceSig } = await baseGive(shakes);
    const frag = buildTerminalProof({
      handRef: REF,
      expiry: EXPIRY,
      rootCapability: rootAddr,
      shakes,
      give: { give, signature },
      giverAcceptanceSig,
      evidence: [utf8("xmtp:msg-1")],
    });
    return decodeTerminalProof(frag, ctx);
  }

  it("accepts the untampered baseline", async () => {
    expect(await verifyTerminalProof(await baseline(), baseFacts)).toEqual({
      ok: true,
    });
  });

  it("TAMPER: a swapped solutionHash breaks the give signature", async () => {
    const d = await baseline();
    d.give.give.solutionHash = keccak256(stringToBytes("stolen"));
    const r = await verifyTerminalProof(d, baseFacts);
    expect(reasons(r)).toContain("capability-proof");
  });

  it("TAMPER: a dropped tail hop breaks the route binding", async () => {
    const d = await baseline();
    d.shakes.pop();
    d.modes.pop();
    const r = await verifyTerminalProof(d, baseFacts);
    expect(reasons(r)).toContain("route-hash-mismatch");
  });

  it("TAMPER: a foreign giver acceptance is named", async () => {
    const d = await baseline();
    d.giverAcceptanceSig = await signGiverAcceptance(
      giveHash(d.give.give),
      privateKeyToAccount(shakerPriv) as TypedSigner,
      CHAIN_ID,
      CORE,
    );
    const r = await verifyTerminalProof(d, baseFacts);
    expect(reasons(r)).toContain("giver-acceptance-invalid");
  });

  it("TAMPER: a swapped giver invalidates give and acceptance", async () => {
    const d = await baseline();
    d.give.give.giver = shakerAddr;
    const r = await verifyTerminalProof(d, baseFacts);
    expect(reasons(r)).toEqual(
      expect.arrayContaining(["capability-proof", "giver-acceptance-invalid"]),
    );
  });
});
