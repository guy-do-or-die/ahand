import { describe, expect, test } from "bun:test";
import { approveCall, CORE_ABI, withdrawCall } from "@ahand/sdk";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, erc20Abi, type Address, type Hex } from "viem";

import { approvalProbe, withdrawnProbe } from "./effects";
import { resume, sendCalls, type Intent, type SendEnv } from "./send";
import { testChain, testWallet, type TestChain, type TxIn } from "./testchain";

/**
 * Ported from an early review's scratch test, which
 * ran the same sends on a bare anvil): a wallet that broadcasts the transaction and then answers
 * with an error that is not a refusal (-32603, or viem's "HTTP request failed" when the page's
 * own RPC drops the answer). At 74b7af7 and de1d968 `sendCalls` called that `reason: "error"`
 * with `sent: []`, so the screens said "Nothing was sent" after the money had moved, and a second
 * press sent it again. Now the answer is "unknown" and carries the intent (account, nonce, block),
 * and `resume` finds what happened without sending anything.
 *
 * The chain is in memory (testchain.ts); each `tick` mines one block.
 */

const ACCOUNT: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TOKEN: Address = "0x00000000000000000000000000000000000000aa";
const CORE: Address = "0x65ac707E2AE7392583de5d6192C619F1D8862309";
const PAYEE: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

/** What the test chain's token and Core do: an approve logs `Approval`; a withdraw logs `Withdrawn` once, then refuses. */
function effects(chain: TestChain, state: { pending: bigint }) {
  chain.effect = (tx: TxIn) => {
    if (tx.to.toLowerCase() === TOKEN.toLowerCase()) {
      const { args } = decodeFunctionData({ abi: erc20Abi, data: tx.data });
      const [spender, value] = args as [Address, bigint];
      return {
        logs: [{ address: TOKEN, topics: encodeEventTopics({ abi: erc20Abi, eventName: "Approval", args: { owner: tx.from, spender } }) as Hex[], data: encodeAbiParameters([{ type: "uint256" }], [value]) }],
      };
    }
    if (state.pending === 0n) return { reverted: true };
    const amount = state.pending;
    state.pending = 0n;
    return {
      logs: [
        {
          address: CORE,
          topics: encodeEventTopics({ abi: CORE_ABI, eventName: "Withdrawn", args: { token: TOKEN, payee: PAYEE } }) as Hex[],
          data: encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [amount, PAYEE]),
        },
      ],
    };
  };
}

const lost = {
  rpc: () => Object.assign(new Error("Internal JSON-RPC error."), { code: -32603 }),
  http: () => new Error("HTTP request failed. Details: Failed to fetch"),
};

function envOf(chain: TestChain, signal?: AbortSignal): SendEnv {
  return { client: chain.client, chainId: 31337, tick: async () => chain.mine(), ...(signal ? { signal } : {}) };
}

describe("a lost answer after the broadcast", () => {
  for (const kind of ["rpc", "http"] as const) {
    test(`is "unknown", never "Nothing was sent", and resume finds it landed (${kind})`, async () => {
      const chain = testChain();
      const state = { pending: 0n };
      effects(chain, state);
      const wallet = testWallet(chain, ACCOUNT, {
        afterBroadcast: () => {
          throw lost[kind]();
        },
      });
      const intents: Intent[] = [];
      const call = approveCall(TOKEN, CORE, 5_000_000n);
      const startBlock = chain.tip();
      const first = await sendCalls(envOf(chain), wallet.wallet, [call], { onIntent: (intent) => void intents.push(intent), steps: [{ action: "approve", probe: approvalProbe(TOKEN, CORE) }] });

      // The wallet did broadcast: the account's nonce moved.
      expect(await chain.client.getTransactionCount({ address: ACCOUNT })).toBe(1);
      expect(first.ok).toBe(false);
      expect(first).toMatchObject({ ok: false, reason: "unknown", step: 0 });
      if (first.ok || first.reason !== "unknown") return;
      expect(first.intent).toMatchObject({ kind: "tx", from: ACCOUNT, nonce: 0, fromBlock: startBlock, action: "approve" });
      // The intent was handed over before the wallet was asked, so a reload would find it.
      expect(intents[0]).toMatchObject({ kind: "tx", nonce: 0, action: "approve" });
      expect(intents[0]!.hash).toBeUndefined();

      const found = await resume(envOf(chain), first.intent, { probe: approvalProbe(TOKEN, CORE) });
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.receipt.status).toBe("success");
      expect(wallet.sends()).toBe(1);
    });
  }
});

describe("the take-out's answer is lost", () => {
  test("first unknown, then found landed: never 'error' followed by NothingPending", async () => {
    const chain = testChain();
    const state = { pending: 5_000_000n };
    effects(chain, state);
    // Core's check refuses a second withdraw once nothing waits (as `NothingPending` would).
    chain.onCall = (tx) => {
      if (tx.to.toLowerCase() === CORE.toLowerCase() && state.pending === 0n) throw Object.assign(new Error("execution reverted"), { code: 3, data: "0x5e95ef53" });
    };
    const wallet = testWallet(chain, PAYEE, {
      afterBroadcast: () => {
        throw lost.rpc();
      },
    });
    const call = withdrawCall(CORE, TOKEN, PAYEE, PAYEE);
    const probe = withdrawnProbe(CORE, TOKEN, PAYEE);
    const first = await sendCalls(envOf(chain), wallet.wallet, [call], { steps: [{ action: "withdraw", probe }] });
    expect(state.pending).toBe(0n); // the money left Core
    expect(first).toMatchObject({ ok: false, reason: "unknown" });
    if (first.ok || first.reason !== "unknown") return;
    const found = await resume(envOf(chain), first.intent, { probe });
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.receipt.logs).toHaveLength(1);
    expect(wallet.sends()).toBe(1);
  });
});

describe("the nonce and the effect decide when the hash cannot", () => {
  test("a dropped send whose answer was lost: dropped once the node has held nothing at its nonce for a while", async () => {
    const chain = testChain({ automine: false });
    effects(chain, { pending: 0n });
    const wallet = testWallet(chain, ACCOUNT, {
      afterBroadcast: (hash) => {
        chain.drop(hash);
        throw lost.rpc();
      },
    });
    const probe = approvalProbe(TOKEN, CORE);
    const first = await sendCalls(envOf(chain), wallet.wallet, [approveCall(TOKEN, CORE, 1n)], { steps: [{ action: "approve", probe }] });
    expect(first).toMatchObject({ ok: false, reason: "unknown" });
    if (first.ok || first.reason !== "unknown") return;
    let ticks = 0;
    const stop = new AbortController();
    const settled = await resume(
      {
        ...envOf(chain, stop.signal),
        tick: async () => {
          chain.mine();
          if (++ticks > 50) stop.abort(new Error("followed for ever"));
        },
      },
      first.intent,
      { probe },
    );
    expect(settled).toMatchObject({ ok: false, reason: "dropped" });
    expect(ticks).toBeLessThan(50);
    expect(wallet.sends()).toBe(1);
  });

  test("a sped-up send: the page knows the first hash, the replacement lands, and the send ends on it", async () => {
    const chain = testChain({ automine: false });
    effects(chain, { pending: 0n });
    let replacement: Hex | undefined;
    const wallet = testWallet(chain, ACCOUNT, {
      afterBroadcast: (hash) => {
        replacement = chain.replace(hash);
      },
    });
    let ticks = 0;
    const stop = new AbortController();
    const probe = approvalProbe(TOKEN, CORE);
    const result = await sendCalls(
      {
        ...envOf(chain, stop.signal),
        tick: async () => {
          chain.mine();
          if (++ticks > 50) stop.abort(new Error("followed for ever"));
        },
      },
      wallet.wallet,
      [approveCall(TOKEN, CORE, 2n)],
      { steps: [{ action: "approve", probe }] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.transactionHash).toBe(replacement!);
    expect(ticks).toBeLessThan(50);
  });
});
