import {
  createPublicClient,
  createWalletClient,
  custom,
  keccak256,
  numberToHex,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { foundry } from "viem/chains";

import type { SignedInWallet } from "./send";

/**
 * A chain in memory, for tests of the sending engine without anvil: an EIP-1193 `request` that
 * answers the JSON-RPC methods the engine and the finality code use, with a pool, nonces, blocks,
 * receipts and logs. What a transaction does is the test's `effect`. It can drop a transaction from
 * its pool, or replace one by another at the same nonce (a wallet's "speed up"). `safe` is one
 * block behind the tip and `finalized` two, as on the stand.
 *
 * Test-only: nothing in the app imports it.
 */

export interface TxIn {
  from: Address;
  to: Address;
  data: Hex;
  value?: bigint;
}

export interface LogOut {
  address: Address;
  topics: Hex[];
  data: Hex;
}

export interface Effect {
  logs?: LogOut[];
  reverted?: boolean;
}

interface PooledTx extends TxIn {
  hash: Hex;
  nonce: number;
}

interface Mined extends PooledTx {
  blockNumber: number;
  index: number;
  status: "0x1" | "0x0";
  logs: LogOut[];
}

interface Block {
  number: number;
  hash: Hex;
  parentHash: Hex;
  timestamp: number;
  txs: Hex[];
}

const ZERO32 = `0x${"0".repeat(64)}` as Hex;

export interface TestChain {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  client: PublicClient;
  /** Puts a transaction in the pool (mined at once when automine is on); returns its hash. */
  broadcast(tx: TxIn): Hex;
  mine(): void;
  drop(hash: Hex): void;
  /** Swaps a pooled transaction for the same call at the same nonce under a new hash. */
  replace(hash: Hex): Hex;
  tip(): number;
  automine: boolean;
  /** What a call would do (eth_call): throw to refuse it. */
  onCall?: (tx: TxIn) => void;
  /** What a mined transaction does. */
  effect: (tx: TxIn) => Effect;
  /** Every JSON-RPC method asked, in order. */
  asked: string[];
}

export function testChain(options: { effect?: (tx: TxIn) => Effect; automine?: boolean; startBlock?: number } = {}): TestChain {
  const blocks: Block[] = [];
  const mined = new Map<Hex, Mined>();
  const pool: PooledTx[] = [];
  const minedCount = new Map<string, number>();
  let salt = 0;

  const blockHash = (n: number) => keccak256(toHex(`block ${n}`));
  for (let n = 0; n <= (options.startBlock ?? 5); n++) blocks.push({ number: n, hash: blockHash(n), parentHash: n ? blockHash(n - 1) : ZERO32, timestamp: 1_800_000_000 + n, txs: [] });

  const countOf = (address: string) => minedCount.get(address.toLowerCase()) ?? 0;
  const pendingOf = (address: string) => countOf(address) + pool.filter((tx) => tx.from.toLowerCase() === address.toLowerCase()).length;

  const chain: TestChain = {
    asked: [],
    automine: options.automine ?? true,
    effect: options.effect ?? (() => ({})),
    tip: () => blocks.length - 1,
    broadcast(tx) {
      const nonce = pendingOf(tx.from);
      const hash = keccak256(toHex(`tx ${tx.from} ${nonce} ${++salt}`));
      pool.push({ ...tx, hash, nonce });
      if (chain.automine) chain.mine();
      return hash;
    },
    mine() {
      const number = blocks.length;
      const txs: Hex[] = [];
      let index = 0;
      for (;;) {
        const next = pool.findIndex((tx) => tx.nonce === countOf(tx.from));
        if (next < 0) break;
        const [tx] = pool.splice(next, 1);
        const effect = chain.effect(tx!);
        mined.set(tx!.hash, { ...tx!, blockNumber: number, index: index++, status: effect.reverted ? "0x0" : "0x1", logs: effect.reverted ? [] : (effect.logs ?? []) });
        minedCount.set(tx!.from.toLowerCase(), countOf(tx!.from) + 1);
        txs.push(tx!.hash);
      }
      blocks.push({ number, hash: blockHash(number), parentHash: blockHash(number - 1), timestamp: 1_800_000_000 + number, txs });
    },
    drop(hash) {
      const at = pool.findIndex((tx) => tx.hash === hash);
      if (at >= 0) pool.splice(at, 1);
    },
    replace(hash) {
      const at = pool.findIndex((tx) => tx.hash === hash);
      if (at < 0) throw new Error("not in the pool");
      const old = pool[at]!;
      const fresh = { ...old, hash: keccak256(toHex(`tx ${old.from} ${old.nonce} ${++salt} faster`)) };
      pool.splice(at, 1, fresh);
      if (chain.automine) chain.mine();
      return fresh.hash;
    },
    async request({ method, params }) {
      chain.asked.push(method);
      const list = (params ?? []) as unknown[];
      switch (method) {
        case "eth_chainId":
          return numberToHex(foundry.id);
        case "eth_blockNumber":
          return numberToHex(chain.tip());
        case "eth_getBlockByNumber": {
          const tag = list[0] as string;
          const tip = chain.tip();
          const n = tag === "latest" || tag === "pending" ? tip : tag === "safe" ? tip - 1 : tag === "finalized" ? tip - 2 : tag === "earliest" ? 0 : Number(tag);
          const block = blocks[n];
          return block ? rpcBlock(block) : null;
        }
        case "eth_getBlockByHash": {
          const block = blocks.find((b) => b.hash === list[0]);
          return block ? rpcBlock(block) : null;
        }
        case "eth_getTransactionCount": {
          const [address, tag] = list as [string, string];
          return numberToHex(tag === "pending" ? pendingOf(address) : countOf(address));
        }
        case "eth_call": {
          const [tx] = list as [{ from: Address; to: Address; data: Hex }];
          chain.onCall?.({ from: tx.from, to: tx.to, data: tx.data });
          return "0x";
        }
        case "eth_estimateGas":
          return numberToHex(60_000);
        case "eth_gasPrice":
        case "eth_maxPriorityFeePerGas":
          return numberToHex(1_000_000_000);
        case "eth_getTransactionReceipt": {
          const tx = mined.get(list[0] as Hex);
          return tx ? rpcReceipt(tx, blocks[tx.blockNumber]!) : null;
        }
        case "eth_getTransactionByHash": {
          const hash = list[0] as Hex;
          const tx = mined.get(hash) ?? pool.find((p) => p.hash === hash);
          if (!tx) return null;
          const at = "blockNumber" in tx ? (tx as Mined) : undefined;
          return {
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            input: tx.data,
            nonce: numberToHex(tx.nonce),
            value: numberToHex(tx.value ?? 0n),
            gas: numberToHex(60_000),
            gasPrice: numberToHex(1_000_000_000),
            type: "0x0",
            chainId: numberToHex(foundry.id),
            v: "0x1b",
            r: ZERO32,
            s: ZERO32,
            blockNumber: at ? numberToHex(at.blockNumber) : null,
            blockHash: at ? blocks[at.blockNumber]!.hash : null,
            transactionIndex: at ? numberToHex(at.index) : null,
          };
        }
        case "eth_getLogs": {
          const [filter] = list as [{ address?: Address | Address[]; topics?: (Hex | Hex[] | null)[]; fromBlock?: string; toBlock?: string }];
          const from = filter.fromBlock && filter.fromBlock !== "latest" ? Number(filter.fromBlock) : 0;
          const to = filter.toBlock && filter.toBlock !== "latest" ? Number(filter.toBlock) : chain.tip();
          const addresses = filter.address ? (Array.isArray(filter.address) ? filter.address : [filter.address]).map((a) => a.toLowerCase()) : undefined;
          const out: unknown[] = [];
          for (const tx of mined.values()) {
            if (tx.blockNumber < from || tx.blockNumber > to) continue;
            tx.logs.forEach((log, logIndex) => {
              if (addresses && !addresses.includes(log.address.toLowerCase())) return;
              const topics = filter.topics ?? [];
              const matches = topics.every((want, i) => want === null || want === undefined || (Array.isArray(want) ? want.map((w) => w.toLowerCase()).includes(log.topics[i]?.toLowerCase() ?? "") : want.toLowerCase() === log.topics[i]?.toLowerCase()));
              if (matches) out.push(rpcLog(log, tx, blocks[tx.blockNumber]!, logIndex));
            });
          }
          return out;
        }
        default:
          throw Object.assign(new Error(`the test chain does not answer ${method}`), { code: -32601 });
      }
    },
    client: undefined as unknown as PublicClient,
  };
  chain.client = createPublicClient({ chain: foundry, transport: custom({ request: chain.request }) }) as PublicClient;
  return chain;
}

function rpcBlock(block: Block) {
  return {
    number: numberToHex(block.number),
    hash: block.hash,
    parentHash: block.parentHash,
    timestamp: numberToHex(block.timestamp),
    transactions: block.txs,
    gasLimit: numberToHex(30_000_000),
    gasUsed: numberToHex(0),
    baseFeePerGas: numberToHex(1_000_000_000),
    miner: "0x0000000000000000000000000000000000000000",
    nonce: "0x0000000000000000",
    difficulty: "0x0",
    extraData: "0x",
    logsBloom: `0x${"0".repeat(512)}`,
    sha3Uncles: ZERO32,
    stateRoot: ZERO32,
    receiptsRoot: ZERO32,
    transactionsRoot: ZERO32,
    size: "0x0",
    uncles: [],
  };
}

function rpcLog(log: LogOut, tx: Mined, block: Block, logIndex: number) {
  return {
    address: log.address,
    topics: log.topics,
    data: log.data,
    blockNumber: numberToHex(block.number),
    blockHash: block.hash,
    transactionHash: tx.hash,
    transactionIndex: numberToHex(tx.index),
    logIndex: numberToHex(logIndex),
    removed: false,
  };
}

function rpcReceipt(tx: Mined, block: Block) {
  return {
    transactionHash: tx.hash,
    transactionIndex: numberToHex(tx.index),
    blockHash: block.hash,
    blockNumber: numberToHex(block.number),
    from: tx.from,
    to: tx.to,
    cumulativeGasUsed: numberToHex(60_000),
    gasUsed: numberToHex(60_000),
    effectiveGasPrice: numberToHex(1_000_000_000),
    contractAddress: null,
    logs: tx.logs.map((log, i) => rpcLog(log, tx, block, i)),
    logsBloom: `0x${"0".repeat(512)}`,
    status: tx.status,
    type: "0x2",
  };
}

/**
 * A wallet over the test chain. `afterBroadcast` runs once the transaction is in the pool and
 * may throw, as a wallet whose answer is lost after it broadcast; `before` may throw before it.
 */
export function testWallet(
  chain: TestChain,
  from: Address,
  hooks: { before?: (tx: TxIn) => void; afterBroadcast?: (hash: Hex, tx: TxIn) => void } = {},
): { wallet: SignedInWallet; sends: () => number } {
  let sends = 0;
  const request = async ({ method, params }: { method: string; params?: unknown }) => {
    const list = (params ?? []) as unknown[];
    switch (method) {
      case "eth_accounts":
      case "eth_requestAccounts":
        return [from];
      case "wallet_getCapabilities":
        return {};
      case "eth_sendTransaction": {
        sends++;
        const [raw] = list as [{ to: Address; data: Hex; value?: Hex }];
        const tx: TxIn = { from, to: raw.to, data: raw.data, ...(raw.value ? { value: BigInt(raw.value) } : {}) };
        hooks.before?.(tx);
        const hash = chain.broadcast(tx);
        hooks.afterBroadcast?.(hash, tx);
        return hash;
      }
      default:
        return chain.request({ method, params });
    }
  };
  return { wallet: createWalletClient({ account: from, chain: foundry, transport: custom({ request }) }) as SignedInWallet, sends: () => sends };
}
