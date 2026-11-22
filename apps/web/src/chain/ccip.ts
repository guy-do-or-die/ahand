import { offchainLookup } from "viem";

/**
 * viem 2.52.0 loads its CCIP-Read helper lazily, and does so in the handler of every failed
 * `eth_call`, whatever made it fail (actions/public/call.ts: `await import("../../utils/ccip.js")`
 * comes before the error is even looked at). A bundler puts a lazy import in a file of its own, so
 * a call that fails because the network is gone asks the site for one more file exactly when
 * nothing can be fetched; the browser then reports a failed script on top of the failed call.
 *
 * Naming the helper here, in the chain layer every screen's reads go through, puts it in the
 * files that load with the first read: viem's lazy import then finds it already loaded, on every
 * screen. /check also asks nothing when the browser itself says it is offline; this covers a
 * network that goes away without the browser knowing.
 */
export const ccipReadIsHere: boolean = typeof offchainLookup === "function";
