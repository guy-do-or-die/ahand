import { recoverAddress, sha256, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import {
  BPS_DENOMINATOR,
  MAX_SHAKES,
  ZERO_ADDRESS,
  type HandRef,
} from "./types.js";
import {
  giveDigest,
  giveHash,
  giverAcceptanceDigest,
  routeHashOf,
  shakeDigest,
  shakerAcceptanceDigest,
  shakeStructHash,
} from "./hash.js";
import type {
  LiveRoutePayload,
  SignedShake,
  TerminalProofPayload,
} from "./payload.js";

/**
 * Pure verification of decoded payloads — no chain access, no clock beyond
 * what the caller supplies. Mirrors the contract's thank() walk so the UI can
 * fail CLOSED with the same judgement the chain would render, and can name
 * exactly which byte betrayed the route. Failures accumulate: a tampered
 * payload shows everything wrong with it, not just the first thing.
 */

export type VerifyFailureReason =
  | "wrong-hand"
  | "route-too-long"
  | "capability-proof" // signature not from the expected capability
  | "claim-mismatch" // parentClaim != childClaim of the previous hop
  | "claim-must-not-grow"
  | "claim-below-floor" // < minGiverClaimBps
  | "anonymous-shaker-with-margin"
  | "margin-rounds-to-zero"
  | "unexpected-acceptance" // self/anonymous hop carrying acceptance bytes
  | "acceptance-missing"
  | "shaker-acceptance-invalid"
  | "deadline-mismatch" // deadline must equal the Hand expiry
  | "expired"
  | "capability-mismatch" // tail does not resolve to the terminal capability
  | "metadata-commitment-mismatch"
  | "route-hash-mismatch"
  | "final-claim-mismatch"
  | "zero-giver"
  | "giver-acceptance-invalid";

export interface VerifyFailure {
  reason: VerifyFailureReason;
  hop?: number; // absent for route-level and Give-level failures
  detail?: string;
}

export type VerifyResult = { ok: true } | { ok: false; failures: VerifyFailure[] };

/** On-chain facts about the viewed Hand; the sole authority verification trusts. */
export interface HandFacts {
  handRef: HandRef;
  rootCapability: `0x${string}`;
  expiry: bigint;
  minGiverClaimBps: number;
  metadataCommitment?: Hex; // sha256 of the envelope; checked when provided
  distributablePool?: bigint; // pool after charity; enables margin-rounds-to-zero
  now?: bigint; // seconds; defaults to the wall clock
}

function nowOf(facts: HandFacts): bigint {
  return facts.now ?? BigInt(Math.floor(Date.now() / 1000));
}

function eqAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

async function recoversTo(
  digest: Hex,
  signature: Hex,
  expected: string,
): Promise<boolean> {
  try {
    const addr = await recoverAddress({ hash: digest, signature });
    return eqAddr(addr, expected);
  } catch {
    return false;
  }
}

/** Walk the hops exactly as the contract will; shared by both payload kinds. */
async function walkRoute(
  handRef: HandRef,
  shakes: SignedShake[],
  facts: HandFacts,
  failures: VerifyFailure[],
): Promise<void> {
  if (
    handRef.chainId !== facts.handRef.chainId ||
    !eqAddr(handRef.core, facts.handRef.core) ||
    handRef.handId !== facts.handRef.handId
  )
    failures.push({ reason: "wrong-hand" });
  if (shakes.length > MAX_SHAKES) failures.push({ reason: "route-too-long" });

  const now = nowOf(facts);
  if (now >= facts.expiry) failures.push({ reason: "expired" });

  let expectedCap: string = facts.rootCapability;
  let expectedClaim = BPS_DENOMINATOR;
  for (const [hop, signed] of shakes.entries()) {
    const s = signed.shake;

    if (s.handId !== facts.handRef.handId)
      failures.push({ reason: "wrong-hand", hop });
    if (s.parentClaimBps !== expectedClaim)
      failures.push({ reason: "claim-mismatch", hop });
    if (s.childClaimBps > s.parentClaimBps)
      failures.push({ reason: "claim-must-not-grow", hop });
    if (s.childClaimBps < facts.minGiverClaimBps)
      failures.push({ reason: "claim-below-floor", hop });
    if (s.deadline !== facts.expiry)
      failures.push({ reason: "deadline-mismatch", hop });

    const digest = shakeDigest(s, handRef.chainId, handRef.core as Hex);
    if (!(await recoversTo(digest, signed.signature, expectedCap)))
      failures.push({ reason: "capability-proof", hop });

    const margin = s.parentClaimBps - s.childClaimBps;
    const anonymous = eqAddr(s.shaker, ZERO_ADDRESS);
    if (margin > 0 && anonymous)
      failures.push({ reason: "anonymous-shaker-with-margin", hop });
    if (
      margin > 0 &&
      facts.distributablePool !== undefined &&
      (facts.distributablePool * BigInt(margin)) / BigInt(BPS_DENOMINATOR) === 0n
    )
      failures.push({ reason: "margin-rounds-to-zero", hop });

    const explicit = !anonymous && !eqAddr(s.shaker, expectedCap);
    if (explicit) {
      if (!signed.acceptanceSig) {
        failures.push({ reason: "acceptance-missing", hop });
      } else {
        const accDigest = shakerAcceptanceDigest(
          shakeStructHash(s),
          handRef.chainId,
          handRef.core as Hex,
        );
        if (!(await recoversTo(accDigest, signed.acceptanceSig, s.shaker)))
          failures.push({ reason: "shaker-acceptance-invalid", hop });
      }
    } else if (signed.acceptanceSig) {
      failures.push({ reason: "unexpected-acceptance", hop });
    }

    expectedCap = s.childCapability;
    expectedClaim = s.childClaimBps;
  }
}

export async function verifyLiveRoute(
  payload: LiveRoutePayload,
  facts: HandFacts,
): Promise<VerifyResult> {
  const failures: VerifyFailure[] = [];
  await walkRoute(payload.handRef, payload.shakes, facts, failures);

  const expectedCap =
    payload.shakes.length === 0
      ? facts.rootCapability
      : payload.shakes[payload.shakes.length - 1]!.shake.childCapability;
  const capAddr =
    payload.capability.mode === "bearer"
      ? (() => {
          try {
            return privateKeyToAddress(payload.capability.secret);
          } catch {
            return ZERO_ADDRESS;
          }
        })()
      : payload.capability.address;
  if (!eqAddr(capAddr, expectedCap))
    failures.push({ reason: "capability-mismatch" });

  if (
    facts.metadataCommitment !== undefined &&
    sha256(payload.metadata.envelope).toLowerCase() !==
      facts.metadataCommitment.toLowerCase()
  )
    failures.push({ reason: "metadata-commitment-mismatch" });

  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}

export async function verifyTerminalProof(
  payload: TerminalProofPayload,
  facts: HandFacts,
): Promise<VerifyResult> {
  const failures: VerifyFailure[] = [];
  await walkRoute(payload.handRef, payload.shakes, facts, failures);

  const g = payload.give.give;
  const terminalCap =
    payload.shakes.length === 0
      ? facts.rootCapability
      : payload.shakes[payload.shakes.length - 1]!.shake.childCapability;
  const terminalClaim =
    payload.shakes.length === 0
      ? BPS_DENOMINATOR
      : payload.shakes[payload.shakes.length - 1]!.shake.childClaimBps;

  if (g.handId !== facts.handRef.handId)
    failures.push({ reason: "wrong-hand", detail: "give" });
  const expectedRouteHash = routeHashOf(
    payload.handRef,
    payload.shakes.map((s) => s.shake),
  );
  if (g.routeHash.toLowerCase() !== expectedRouteHash.toLowerCase())
    failures.push({ reason: "route-hash-mismatch" });
  if (g.finalClaimBps !== terminalClaim)
    failures.push({ reason: "final-claim-mismatch" });
  if (g.deadline !== facts.expiry)
    failures.push({ reason: "deadline-mismatch", detail: "give" });
  if (eqAddr(g.giver, ZERO_ADDRESS)) failures.push({ reason: "zero-giver" });

  const gDigest = giveDigest(
    g,
    payload.handRef.chainId,
    payload.handRef.core as Hex,
  );
  if (!(await recoversTo(gDigest, payload.give.signature, terminalCap)))
    failures.push({ reason: "capability-proof", detail: "give" });

  const gaDigest = giverAcceptanceDigest(
    giveHash(g),
    payload.handRef.chainId,
    payload.handRef.core as Hex,
  );
  if (!(await recoversTo(gaDigest, payload.giverAcceptanceSig, g.giver)))
    failures.push({ reason: "giver-acceptance-invalid" });

  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}
