import { createWalletClient, http, parseEventLogs, type Address, type Hex } from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";

import { aHandCoreAbi } from "@ahand/abi";
import {
  approveCall,
  chainNow,
  describeHand,
  domain,
  encodeLive,
  expiryAfter,
  keyOfSeed,
  newSeed,
  packAttachments,
  raiseCall,
  readHand,
  readLimits,
  toAddress,
  type Call,
  type DescribeMode,
} from "@ahand/sdk";
import type { Chain } from "@ahand/sdk/testing";

/**
 * Hands raised directly through the SDK, the way the app raises them, for the view server's tests,
 * and what they read back from a page.
 */

export const USD = 1_000_000n;
export const DAY = 86_400;

/** What a Hand is raised on: a test chain (`startChain`) or anything shaped like one (a fork). */
export type RaiseChain = Pick<Chain, "rpc" | "client" | "core" | "chainId" | "tokens">;

export async function send(chain: Pick<Chain, "rpc" | "client">, key: Hex, call: Call) {
  // No chain object: viem asks the node for its id, so the same code raises on 31337 and on a fork.
  const wallet = createWalletClient({ account: privateKeyToAccount(key), transport: http(chain.rpc) });
  const hash = await wallet.sendTransaction({ chain: null, to: call.to, data: call.data, value: call.value ?? 0n });
  const receipt = await chain.client.waitForTransactionReceipt({ hash, pollingInterval: 50 });
  if (receipt.status !== "success") throw new Error(`reverted: ${hash}`);
  return receipt;
}

export interface RaiseOptions {
  mode: DescribeMode;
  title: string;
  content?: string;
  reward: bigint;
  seconds?: number;
  /** The reward's token; the test chain's dollar (`kind: "usd"`) when left out. */
  token?: Address;
}

/**
 * Raises a Hand described in `mode` from `key` and returns its described (or bare) address on `site`,
 * as the app writes it, and `before`: what a browser or a robot sends (path and query, never `#`).
 */
export async function raiseHand(chain: RaiseChain, site: string, key: Hex, opts: RaiseOptions) {
  const usd = opts.token ?? chain.tokens.find((token) => token.kind === "usd")!.address;
  const described = describeHand({ mode: opts.mode, title: opts.title, content: opts.content });
  const seed = newSeed();
  if (opts.reward > 0n) await send(chain, key, approveCall(usd, chain.core, opts.reward));
  const { timestamp } = await chainNow(chain.client);
  const { maxExpiryPeriod } = await readLimits(chain.client, chain.core);
  const receipt = await send(
    chain,
    key,
    raiseCall(chain.core, {
      token: usd,
      reward: opts.reward,
      expiry: expiryAfter(timestamp, opts.seconds ?? 30 * DAY, maxExpiryPeriod),
      rootKey: privateKeyToAddress(keyOfSeed(seed)),
      payoutGasK: 250,
      minClaimBps: 7_000,
      dataHash: described.dataHash,
    }),
  );
  const [raised] = parseEventLogs({ abi: aHandCoreAbi, logs: receipt.logs, eventName: "Raised" });
  const handId = raised!.args.handId;
  const { hand } = await readHand(chain.client, chain.core, handId);
  const options = { canonicalCore: chain.core };
  const publicPart = described.publicPart && packAttachments(described.publicPart);
  const link = await encodeLive(
    { domain: domain(chain.chainId, chain.core), hand, signedShakes: [], seed, attachments: described.linkPart },
    { ...options, publicPart },
  );
  const address = toAddress({ site, link, shape: described.shape, publicPart: described.publicPart }, options);
  const before = address.split("#")[0]!.slice(site.length);
  return { handId, address, before };
}

/** The content of a preview tag, as written (escaped). */
export const metaOf = (html: string, property: string) =>
  new RegExp(`<meta (?:property|name)="${property.replace(/[.:]/g, "\\$&")}" content="([^"]*)"`).exec(html)?.[1];

export const unescape = (text: string | undefined) => text?.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));

/** A PNG's signature and its size from the IHDR chunk. */
export function pngSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const magic = Buffer.from(bytes.subarray(0, 8)).toString("hex");
  return { magic, width: view.getUint32(16), height: view.getUint32(20) };
}
