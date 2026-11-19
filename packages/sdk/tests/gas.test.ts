import { describe, expect, it } from "vitest";
import { hexToBytes, zeroAddress, zeroHash, type Address, type Hex } from "viem";

import gas from "../../../contracts/test/fixtures/sdk-gas.json" with { type: "json" };
import {
  THANK_GAS_PRAGUE,
  TX_BYTES_LIMIT,
  TX_ENVELOPE_BYTES,
  TX_GAS_LIMIT,
  passesLeft,
  thankCalldata,
  worstThankGas,
  type Hand,
  type SignedGive,
  type SignedShake,
} from "../src/index.js";

/**
 * contracts/test/fixtures/sdk-gas.json is written by contracts/test/SdkGas.t.sol from Core itself:
 * the four measured parts of a thank's worst gas and, for routes of several shapes, the worst gas
 * the formula gives in Solidity and what Core spent when every payee burned its limit.
 */

const STATED: Hex = `0x${"5a".repeat(32)}`;
const SIGNATURE: Hex = `0x${"11".repeat(65)}`;
const address = (number: number): Address => `0x${number.toString(16).padStart(40, "0")}`;

function handOf(payoutGasK: number): Hand {
  return {
    handId: 1n,
    raiser: address(0xa11ce),
    token: address(0x70c3),
    rootKey: address(0x4007),
    payoutGasK,
    minClaimBps: 0,
    dataHash: zeroHash,
  };
}

/** A route of the fixture's shape: first the Shakes that keep a margin, then those that keep nothing. */
function routeOf(shakes: number, paid: number): { signedShakes: SignedShake[]; signedGive: SignedGive } {
  const signedShakes: SignedShake[] = [];
  let claim = 10_000;
  for (let position = 0; position < shakes; ++position) {
    const keeps = position < paid;
    const nextClaimBps = keeps ? claim - 1 : claim;
    signedShakes.push({
      shake: { nextKey: address(0xb0b0 + position), payee: keeps ? address(0xb0001 + position) : zeroAddress, claimBps: claim, nextClaimBps, dataHash: STATED },
      keySig: SIGNATURE,
    });
    claim = nextClaimBps;
  }
  const signedGive: SignedGive = {
    give: { signer: address(0xca401), payee: address(0xb0000), claimBps: claim, routeHash: STATED, dataHash: STATED },
    keySig: SIGNATURE,
    giverSig: SIGNATURE,
  };
  return { signedShakes, signedGive };
}

describe("the worst gas of a thank", () => {
  it("is counted by the rules and limits Core's own test measured", () => {
    expect(gas.evm).toBe("prague");
    expect(THANK_GAS_PRAGUE).toEqual(gas.rules);
    expect({ txGas: TX_GAS_LIMIT, txBytes: TX_BYTES_LIMIT, txEnvelopeBytes: TX_ENVELOPE_BYTES }).toEqual(gas.limits);
  });

  for (const shape of gas.cases) {
    const name = `${shape.shakes} Shakes, ${shape.paid} of them paid, payout gas ${shape.payoutGasK} thousand${shape.stated ? ", stated" : ""}`;
    it(`${name}: the formula in Solidity gives the same, and Core spent no more`, () => {
      const { signedShakes, signedGive } = routeOf(shape.shakes, shape.paid);
      const worst = worstThankGas(handOf(shape.payoutGasK), signedShakes, signedGive, { dataHash: shape.stated ? STATED : undefined });
      expect(worst.execution).toBe(shape.worstExecution);
      expect(worst.calldataBytes).toBe(shape.calldataBytes);
      expect(worst.execution).toBeGreaterThanOrEqual(shape.spent);
      expect(worst.fits).toBe(true);
    });
  }

  it("adds what a transaction costs before Core runs: 21 000 and each byte of the calldata", () => {
    const { signedShakes, signedGive } = routeOf(3, 2);
    const hand = handOf(200);
    const worst = worstThankGas(hand, signedShakes, signedGive);
    const calldata = hexToBytes(thankCalldata(hand.handId, signedShakes, signedGive));
    let bytesGas = 0;
    for (const byte of calldata) bytesGas += byte === 0 ? 4 : 16;
    expect(calldata.length).toBe(644 + 3 * 352);
    expect(worst.gasLimit).toBe(21_000 + bytesGas + worst.execution);
    // Three Shakes, three payouts (two margins and the Give), nothing stated.
    expect(worst.execution).toBe(80_410 + 3 * 12_197 + 3 * (Math.ceil((200_000 * 64) / 63) + 24_969));
  });

  it("counts a payout only where a margin is kept, and always the Give's", () => {
    const hand = handOf(200);
    const { signedShakes, signedGive } = routeOf(4, 0);
    const none = worstThankGas(hand, signedShakes, signedGive).execution;
    // A payee named without a margin is not paid.
    const named = signedShakes.map(({ shake, keySig }) => ({ shake: { ...shake, payee: address(0xbeef) }, keySig }));
    expect(worstThankGas(hand, named, signedGive).execution).toBe(none);
    const one = routeOf(4, 1);
    expect(worstThankGas(hand, one.signedShakes, one.signedGive).execution - none).toBe(Math.ceil((200_000 * 64) / 63) + 24_969);
  });

  it("takes the gas a contract giver's code needs from the application, with the same 64/63", () => {
    const hand = handOf(200);
    const { signedShakes, signedGive } = routeOf(1, 1);
    const plain = worstThankGas(hand, signedShakes, signedGive).execution;
    expect(worstThankGas(hand, signedShakes, signedGive, { giverCodeGas: 63_000 }).execution).toBe(plain + 64_000);
  });

  it("says when one transaction can no longer carry the thank: too much gas, or too many bytes", () => {
    // Payouts of 200 thousand gas: gas runs out first.
    const burning = routeOf(70, 70);
    expect(worstThankGas(handOf(200), burning.signedShakes, burning.signedGive).fits).toBe(false);
    const fewer = routeOf(60, 60);
    expect(worstThankGas(handOf(200), fewer.signedShakes, fewer.signedGive).fits).toBe(true);
    // Shakes that keep nothing: the size runs out first. 369 is the longest route Core's own test thanks.
    const longest = routeOf(369, 0);
    expect(worstThankGas(handOf(200), longest.signedShakes, longest.signedGive).fits).toBe(true);
    const tooLong = routeOf(370, 0);
    expect(worstThankGas(handOf(200), tooLong.signedShakes, tooLong.signedGive).fits).toBe(false);
  });
});

describe("how many more times a route can be passed on", () => {
  /** The same answer the slow way: Shakes that keep a margin are added until the worst gas no longer fits. */
  function byTrying(payoutGasK: number, shakes: number, paid: number): number {
    const hand = handOf(payoutGasK);
    let more = 0;
    for (;;) {
      const { signedShakes, signedGive } = routeOf(shakes + more + 1, paid + more + 1);
      if (!worstThankGas(hand, signedShakes, signedGive, { dataHash: STATED }).fits) return more;
      ++more;
    }
  }

  it("never promises a pass the worst gas would refuse, and holds back 3 % at most", () => {
    for (const [payoutGasK, shakes, paid] of [
      [200, 0, 0],
      [200, 10, 10],
      [200, 30, 5],
      [50, 3, 3],
      [1_000, 2, 2],
      [1, 0, 0],
      [1, 300, 0],
    ]) {
      const left = passesLeft(handOf(payoutGasK), routeOf(shakes, paid).signedShakes);
      const tried = byTrying(payoutGasK, shakes, paid);
      expect(left).toBeLessThanOrEqual(tried);
      // What is held back comes from counting every byte of the calldata at its highest price.
      expect(tried - left).toBeLessThanOrEqual(Math.ceil(tried * 0.03));
    }
  });

  it("is 66 for payouts of 200 thousand gas, 369 by size alone, and zero past the limit", () => {
    expect(passesLeft(handOf(200), [])).toBe(66);
    expect(passesLeft(handOf(200), routeOf(60, 60).signedShakes)).toBe(6);
    expect(passesLeft(handOf(1), [])).toBe(369);
    expect(passesLeft(handOf(1), routeOf(369, 0).signedShakes)).toBe(0);
    expect(passesLeft(handOf(200), routeOf(80, 80).signedShakes)).toBe(0);
    expect(passesLeft(handOf(65_535), [])).toBe(0);
  });
});
