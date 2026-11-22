import { describe, expect, test } from "bun:test";
import { UserRejectedRequestError } from "viem";

import { unknownNetwork } from "./errors";

/**
 * A wallet that does not know the build's network answers the switch with 4902 and
 * then fails to add it; wagmi wraps that failure as a UserRejectedRequestError, so the screen said
 * "You said no". The cause chain tells the two apart.
 */

const coded = (code: number, message: string) => Object.assign(new Error(message), { code });

describe("unknownNetwork", () => {
  test("a 4902 anywhere in the chain", () => {
    expect(unknownNetwork(Object.assign(new Error("Unrecognized chain ID."), { code: 4902 }))).toBe(true);
    expect(unknownNetwork(new Error("switch failed", { cause: coded(4902, "nope") }))).toBe(true);
  });

  test("wagmi's 4001 wrapping a failed wallet_addEthereumChain (4200) is not a refusal", () => {
    const wrapped = new UserRejectedRequestError(coded(4200, "wallet_addEthereumChain is not supported"));
    expect(unknownNetwork(wrapped)).toBe(true);
  });

  test("a real no stays a no", () => {
    expect(unknownNetwork(new UserRejectedRequestError(coded(4001, "User rejected the request.")))).toBe(false);
    expect(unknownNetwork(coded(4001, "User rejected the request."))).toBe(false);
    expect(unknownNetwork(new Error("something else"))).toBe(false);
  });
});
