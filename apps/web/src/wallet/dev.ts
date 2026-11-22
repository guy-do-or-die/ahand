import {
  ChainDisconnectedError,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  numberToHex,
  parseAbi,
  serializeErc6492Signature,
  stringToBytes,
  UnsupportedProviderMethodError,
  UserRejectedRequestError,
  type Address,
  type Chain,
  type EIP1193Provider,
  type Hex,
  type PublicClient,
  type TypedDataDefinition,
} from "viem";
import { mnemonicToAccount, setSignEntropy, type HDAccount } from "viem/accounts";
import { createConnector, type CreateConnectorFn } from "wagmi";

import { LOCAL_CHAIN_ID } from "../config/local";
import type { AppConfig } from "../config/schema";
import { chainOf } from "../chain/clients";

/**
 * The dev wallet: local builds only. `config.ts` imports this file
 * behind the build's `__AHAND_LOCAL__` flag, so a public build carries neither it nor anvil's
 * well-known test mnemonic. It signs in the page with viem, so Playwright can drive every flow.
 *
 * Accounts are anvil's public test accounts 1 to 5 (account 0 deploys the stand), plus one that
 * stands in for a smart account nobody has set up yet:
 *
 * - accounts 1 to 4 answer the same typed data with the same signature every time, as a key does;
 * - account 5 "answers differently each time": it signs with added entropy (viem's
 *   `setSignEntropy`), as passkeys, MPC and many smart wallets do;
 * - "not set up yet" is the counterfactual `KeyAccount` of account 6's key, made by the stand's
 *   `KeyAccountFactory` with `DEV_UNSET_SALT`. While it has no code, its typed-data answers are
 *   account 6's signature wrapped per ERC-6492 (factory, `createAccount` calldata, signature),
 *   and it cannot send. Once something deploys it (a thank's setup call), it answers unwrapped.
 *
 * The keys are public, so the wallet works on anvil's chain only, checked twice: `devConnectors`
 * refuses a configuration that is not local on chain 31337 (the build and `parseConfig` already
 * refuse one), and every provider asks its RPC for `eth_chainId` before the first connection,
 * signature or send, and refuses with 4901 unless the RPC answers 31337. The RPC's host is not
 * checked: a phone on the LAN reaches the stand by the machine's address.
 *
 * The provider answers only what a wallet must: the account, the chain, typed-data signatures,
 * sending (signed here, `eth_sendRawTransaction` to the RPC), EIP-5792 capabilities (no atomic
 * batches: a key account in a page cannot run two calls as one), and a fixed list of reads it
 * passes to the RPC. Everything else is refused with 4200, so nothing is ever forwarded to anvil's
 * own unlocked accounts.
 */

/** anvil's public test mnemonic: the source of accounts 0 to 9 on every local chain. */
const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

/** The salt of the "not set up yet" account: its own, so the stand's fixtures never deploy it. */
export const DEV_UNSET_SALT = BigInt(keccak256(stringToBytes("aHand.dev-wallet.not-set-up/1")));
/** Account 6's key owns the "not set up yet" account. */
export const DEV_UNSET_OWNER_INDEX = 6;

export type DevRole = "key" | "entropy" | "unset";
export type DevWho = 1 | 2 | 3 | 4 | 5 | "not-set-up";

export const DEV_WHO: readonly DevWho[] = [1, 2, 3, 4, 5, "not-set-up"];

export function roleOf(who: DevWho): DevRole {
  return who === "not-set-up" ? "unset" : who === 5 ? "entropy" : "key";
}

/** The connector id of a dev account: dev-1 … dev-5, dev-not-set-up. */
export function devConnectorId(who: DevWho): string {
  return `dev-${who}`;
}

const keyCache = new Map<number, HDAccount>();
function keyOf(index: number): HDAccount {
  let account = keyCache.get(index);
  if (!account) {
    account = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index });
    keyCache.set(index, account);
  }
  return account;
}

const factoryAbi = parseAbi([
  "function createAccount(address owner, uint256 salt) returns (address)",
  "function getAddress(address owner, uint256 salt) view returns (address)",
]);

/** The address a dev account answers for; the "not set up yet" one is read from the factory. */
export async function devAddress(who: DevWho, client: PublicClient, accountFactory: Address | null): Promise<Address> {
  if (who !== "not-set-up") return keyOf(who).address;
  if (!accountFactory) throw new Error("this configuration has no test account factory");
  return client.readContract({ address: accountFactory, abi: factoryAbi, functionName: "getAddress", args: [keyOf(DEV_UNSET_OWNER_INDEX).address, DEV_UNSET_SALT] });
}

/** The ERC-6492 setup a "not set up yet" answer carries: the factory and `createAccount`'s calldata. */
export function devUnsetSetup(accountFactory: Address): { factory: Address; factoryData: Hex } {
  return {
    factory: accountFactory,
    factoryData: encodeFunctionData({ abi: factoryAbi, functionName: "createAccount", args: [keyOf(DEV_UNSET_OWNER_INDEX).address, DEV_UNSET_SALT] }),
  };
}

let refuseNext = false;
/** The next request that would need a person's yes (connect, a signature, a send) is answered no. */
export function sayNoNext(on: boolean): void {
  refuseNext = on;
}
export function willSayNo(): boolean {
  return refuseNext;
}
function personSaysNo(): boolean {
  if (!refuseNext) return false;
  refuseNext = false;
  return true;
}

/**
 * Signs with or without added entropy. viem keeps the entropy setting for the whole page, and
 * `sign` reads it synchronously when it starts, so it is set right before the call starts and set
 * back to none ("0x": no extra bytes, the same as RFC 6979 alone) right after.
 */
function signTyped(account: HDAccount, typedData: TypedDataDefinition, entropy: boolean): Promise<Hex> {
  if (!entropy) {
    setSignEntropy("0x");
    return account.signTypedData(typedData);
  }
  setSignEntropy(true);
  try {
    return account.signTypedData(typedData);
  } finally {
    setSignEntropy("0x");
  }
}

const INT = /^u?int(\d+)?$/;

/** Typed data as a wallet receives it (JSON: numbers as strings) back into what viem hashes. */
export function reviveTypedData(json: string): TypedDataDefinition {
  const parsed = JSON.parse(json) as {
    domain?: Record<string, unknown>;
    types: Record<string, { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, unknown>;
  };
  const { EIP712Domain: _domainTypes, ...types } = parsed.types;
  const revive = (type: string, value: unknown): unknown => {
    if (type.endsWith("]")) return Array.isArray(value) ? value.map((item) => revive(type.slice(0, type.lastIndexOf("[")), item)) : value;
    if (INT.test(type) && (typeof value === "string" || typeof value === "number")) return BigInt(value);
    const struct = types[type];
    if (struct && value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return Object.fromEntries(struct.map((field) => [field.name, revive(field.type, record[field.name])]));
    }
    return value;
  };
  const domain = { ...(parsed.domain ?? {}) };
  if (domain.chainId !== undefined) domain.chainId = Number(BigInt(domain.chainId as string | number));
  return {
    domain,
    types,
    primaryType: parsed.primaryType,
    message: revive(parsed.primaryType, parsed.message) as Record<string, unknown>,
  } as unknown as TypedDataDefinition;
}

/** Reads the provider passes to the RPC as they are. Nothing that signs or sends is among them. */
const READS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "eth_simulateV1",
  "net_version",
]);

export interface DevProviderOptions {
  who: DevWho;
  chain: Chain;
  rpcUrl: string;
  accountFactory: Address | null;
}

type Listener = (...args: unknown[]) => void;

/** The dev wallet will not act: the chain it was given, or the RPC behind it, is not anvil's. */
export function devWalletRefused(why: string): ChainDisconnectedError {
  return new ChainDisconnectedError(new Error(`The test accounts work on the local chain ${LOCAL_CHAIN_ID} only: ${why}.`));
}

/** One dev account as an EIP-1193 provider that signs in the page. */
export function devProvider(options: DevProviderOptions): EIP1193Provider & { address(): Promise<Address> } {
  const { who, chain, rpcUrl, accountFactory } = options;
  const role = roleOf(who);
  const transport = http(rpcUrl);
  const client = createPublicClient({ chain, transport }) as PublicClient;
  const signer = keyOf(who === "not-set-up" ? DEV_UNSET_OWNER_INDEX : who);
  const sender = createWalletClient({ account: signer, chain, transport });
  const listeners = new Map<string, Set<Listener>>();
  let address: Promise<Address> | undefined;
  const addressOf = () => (address ??= devAddress(who, client, accountFactory));

  // Asked once per provider, before anything that uses a key; a failure (a refusal or no answer) is
  // asked again next time, so a stand that starts late still works and a wrong chain never does.
  let onLocal: Promise<void> | undefined;
  const onLocalChain = (): Promise<void> =>
    (onLocal ??= (async () => {
      if (chain.id !== LOCAL_CHAIN_ID) throw devWalletRefused(`this page is built for chain ${chain.id}`);
      const answered = await client.getChainId();
      if (answered !== LOCAL_CHAIN_ID) throw devWalletRefused(`the RPC at ${rpcUrl} answers chain ${answered}`);
    })().catch((error: unknown) => {
      onLocal = undefined;
      throw error;
    }));

  const no = (what: string) => new UserRejectedRequestError(new Error(`The test account said no to ${what}.`));
  const cannot = (what: string) => new UnsupportedProviderMethodError(new Error(`The test account does not do ${what}.`));

  async function request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    const list = (Array.isArray(params) ? params : []) as unknown[];
    switch (method) {
      case "eth_chainId":
        return numberToHex(chain.id);
      case "eth_accounts":
        return [await addressOf()];
      case "eth_requestAccounts":
        await onLocalChain();
        if (personSaysNo()) throw no("connecting");
        return [await addressOf()];
      case "wallet_switchEthereumChain": {
        const wanted = Number(BigInt((list[0] as { chainId?: string } | undefined)?.chainId ?? "0x0"));
        if (wanted !== chain.id) throw new UnsupportedProviderMethodError(new Error(`The test accounts live on chain ${chain.id} only.`));
        return null;
      }
      case "wallet_getCapabilities":
        return { [numberToHex(chain.id)]: { atomic: { status: "unsupported" } } };
      case "eth_signTypedData_v4": {
        const [from, json] = list as [string, string];
        const me = await addressOf();
        if (typeof from !== "string" || from.toLowerCase() !== me.toLowerCase()) throw new UnsupportedProviderMethodError(new Error("That is not this account."));
        await onLocalChain();
        if (personSaysNo()) throw no("this message");
        const typedData = reviveTypedData(typeof json === "string" ? json : JSON.stringify(json));
        const signature = await signTyped(signer, typedData, role === "entropy");
        if (role !== "unset") return signature;
        const code = await client.getCode({ address: me });
        if (code && code !== "0x") return signature; // set up by now: a deployed account answers plainly
        const setup = devUnsetSetup(accountFactory!);
        return serializeErc6492Signature({ address: setup.factory, data: setup.factoryData, signature });
      }
      case "eth_sendTransaction": {
        if (role === "unset") throw cannot("sending: it is not set up yet");
        await onLocalChain();
        if (personSaysNo()) throw no("sending");
        const [tx] = list as [{ to?: Address; data?: Hex; value?: Hex; gas?: Hex }];
        if (!tx?.to) throw cannot("deploying contracts");
        return sender.sendTransaction({
          to: tx.to,
          data: tx.data,
          ...(tx.value ? { value: BigInt(tx.value) } : {}),
          ...(tx.gas ? { gas: BigInt(tx.gas) } : {}),
        });
      }
      default:
        if (READS.has(method)) return client.request({ method, params } as never);
        throw cannot(method);
    }
  }

  return {
    request: request as EIP1193Provider["request"],
    on: ((event: string, listener: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    }) as EIP1193Provider["on"],
    removeListener: ((event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener);
    }) as EIP1193Provider["removeListener"],
    address: addressOf,
  };
}

export interface DevAccountInfo {
  who: DevWho;
  id: string;
  role: DevRole;
  /** Whose key signs: the account itself, or account 6 for "not set up yet". */
  keyIndex: number;
}

export function devAccounts(config: Pick<AppConfig, "accountFactory">): DevAccountInfo[] {
  return DEV_WHO.filter((who) => who !== "not-set-up" || config.accountFactory !== null).map((who) => ({
    who,
    id: devConnectorId(who),
    role: roleOf(who),
    keyIndex: who === "not-set-up" ? DEV_UNSET_OWNER_INDEX : who,
  }));
}

/**
 * A wagmi connector per dev account (`type: "dev"`), for the wallet configuration. Throws for a
 * configuration that is not local on chain 31337: no build that reaches here should be one.
 */
export function devConnectors(config: Pick<AppConfig, "chain" | "accountFactory">): CreateConnectorFn[] {
  if (config.chain.local !== true || config.chain.id !== LOCAL_CHAIN_ID) {
    throw devWalletRefused(`this configuration's chain is ${config.chain.id}${config.chain.local ? "" : ", not local"}`);
  }
  const chain = chainOf(config.chain);
  return devAccounts(config).map((info) =>
    createConnector<EIP1193Provider, { devRole: DevRole; devWho: DevWho }>((wagmi) => {
      const provider = devProvider({ who: info.who, chain, rpcUrl: config.chain.rpcUrls[0]!, accountFactory: config.accountFactory });
      let connected = false;
      return {
        id: info.id,
        name: info.who === "not-set-up" ? "Not set up yet" : `Test account ${info.who}`,
        type: "dev",
        devRole: info.role,
        devWho: info.who,
        async connect(parameters) {
          const accounts = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
          connected = true;
          const result = parameters?.withCapabilities ? accounts.map((address) => ({ address, capabilities: {} })) : accounts;
          return { accounts: result as never, chainId: chain.id };
        },
        async disconnect() {
          connected = false;
        },
        async getAccounts() {
          return connected ? [await provider.address()] : [];
        },
        async getChainId() {
          return chain.id;
        },
        async getProvider() {
          return provider;
        },
        async isAuthorized() {
          return connected;
        },
        onAccountsChanged() {},
        onChainChanged() {},
        onDisconnect() {
          connected = false;
          wagmi.emitter.emit("disconnect");
        },
      };
    }),
  );
}
