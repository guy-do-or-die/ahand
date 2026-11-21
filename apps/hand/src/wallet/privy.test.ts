import { describe, expect, test } from "bun:test";
import { createWalletClient, custom, numberToHex, recoverTypedDataAddress, UserRejectedRequestError, type Address, type EIP1193Provider, type Hex, type PublicClient, type TypedDataDefinition } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createConfig, http } from "wagmi";
import { connect, disconnect, getConnection, switchChain } from "wagmi/actions";

import { chainOf } from "../chain/clients";
import type { ChainConfig } from "../config/schema";
import { reviveTypedData } from "./dev";
import { guardedProvider, privyAllowsOrigin, privyConnector, privyPhase, privyUnavailable, PrivyUnavailableError, watchPrivyPhase, type PrivyHost, type PrivyLoader } from "./privy";
import { canBatch } from "./send";
import { signTypedWith } from "./typed";

/**
 * The email connector (wallet/privy.ts) with a fake of what Privy hands it: an EIP-1193 provider
 * that behaves as Privy's wallet provider does for the calls the app makes (account, chain, chain
 * switch, typed-data signatures, sends; no EIP-5792), and a fake host in place of Privy's SDK. The
 * money paths (useSend, useTypedSigner) reach a wallet only through `connector.getProvider()`
 * wrapped in a viem wallet client (state.ts `connectedWallet`), so that is what is driven here.
 */

const SEPOLIA: ChainConfig = { id: 84532, name: "Base Sepolia", rpcUrls: ["https://sepolia.base.org"], blockTimeMs: 2000, local: false, hasL1: true, testnet: true };
const SETTINGS = { appId: "clt69jwp204btq1o3q72cupji" };
// anvil's public test key 7: never a real account.
const KEY = privateKeyToAccount("0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356");

type Listener = (...args: unknown[]) => void;

interface Fake {
  provider: EIP1193Provider;
  calls: { method: string; params?: unknown }[];
  chainId(): number;
}

/** A stand-in for the provider Privy's `wallet.getEthereumProvider()` returns. */
function fakePrivyProvider(startChain = 1): Fake {
  let chainId = startChain;
  const calls: Fake["calls"] = [];
  const listeners = new Map<string, Set<Listener>>();
  const emit = (event: string, value: unknown) => listeners.get(event)?.forEach((listener) => listener(value));
  const refuse = (code: number, message: string) => Object.assign(new Error(message), { code });
  const request = async ({ method, params }: { method: string; params?: unknown }) => {
    calls.push({ method, ...(params === undefined ? {} : { params }) });
    const list = (params ?? []) as unknown[];
    switch (method) {
      case "eth_chainId":
        return numberToHex(chainId);
      case "eth_accounts":
      case "eth_requestAccounts":
        return [KEY.address];
      case "wallet_switchEthereumChain": {
        const wanted = Number((list[0] as { chainId: Hex }).chainId);
        if (wanted !== 84532) throw refuse(4902, "Unrecognized chain");
        chainId = wanted;
        emit("chainChanged", numberToHex(wanted));
        return null;
      }
      case "eth_signTypedData_v4": {
        const [from, json] = list as [Address, string];
        if (from.toLowerCase() !== KEY.address.toLowerCase()) throw refuse(4100, "not this account");
        return KEY.signTypedData(reviveTypedData(json) as never);
      }
      case "eth_sendTransaction":
        return `0x${"ab".repeat(32)}`;
      default:
        throw refuse(4200, `Privy's provider does not answer ${method}`);
    }
  };
  return {
    calls,
    chainId: () => chainId,
    provider: {
      request: request as EIP1193Provider["request"],
      on: ((event: string, listener: Listener) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(listener);
      }) as EIP1193Provider["on"],
      removeListener: ((event: string, listener: Listener) => listeners.get(event)?.delete(listener)) as EIP1193Provider["removeListener"],
    },
  };
}

/** A host that does what privy-host.tsx does once the person is in: switch to the build's chain, hand over the provider. */
function fakeHost(fake: Fake, behaviour: { closes?: boolean } = {}) {
  const seen = { signIns: 0, signOuts: 0 };
  const host: PrivyHost = {
    async signIn() {
      seen.signIns++;
      if (behaviour.closes) throw new UserRejectedRequestError(new Error("the email window was closed"));
      await fake.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: numberToHex(SEPOLIA.id) }] });
      return { address: KEY.address, provider: fake.provider };
    },
    async signOut() {
      seen.signOuts++;
    },
  };
  return { host, seen };
}

function wagmiWith(load: PrivyLoader) {
  const chain = chainOf(SEPOLIA);
  const config = createConfig({ chains: [chain], connectors: [privyConnector(SETTINGS, SEPOLIA, load)], transports: { [chain.id]: http("http://127.0.0.1:1") }, multiInjectedProviderDiscovery: false, storage: null, ssr: false });
  return { config, connector: config.connectors[0]! };
}

/** The wallet client the app's money paths build (state.ts `connectedWallet`). */
async function walletClientOf(connector: ReturnType<typeof wagmiWith>["connector"]) {
  const provider = (await connector.getProvider()) as EIP1193Provider;
  return createWalletClient({ account: KEY.address, chain: chainOf(SEPOLIA), transport: custom(provider) });
}

const noCode = { getCode: async () => undefined } as unknown as PublicClient;

const GIVE: TypedDataDefinition = {
  domain: { name: "aHand", version: "1", chainId: 84532, verifyingContract: "0x65ac707E2AE7392583de5d6192C619F1D8862309" },
  types: { Give: [{ name: "handId", type: "uint256" }, { name: "to", type: "address" }, { name: "note", type: "string" }] },
  primaryType: "Give",
  message: { handId: 7n, to: "0x00000000000000000000000000000000000000aa", note: "for the ladder" },
};

describe("the site addresses Privy's dashboard allows", () => {
  const settings = { appId: "clt69jwp204btq1o3q72cupji", origins: ["https://ahand.in", "https://*.ahand.in"] };
  test("an exact origin and any address under a wildcard are allowed", () => {
    for (const origin of ["https://ahand.in", "https://exp-e2e.ahand.in", "https://a.b.ahand.in"]) expect(privyAllowsOrigin(settings, origin)).toBe(true);
  });
  test("a preview host, plain http, a look-alike and the bare wildcard's host are not", () => {
    for (const origin of ["https://ahand-git-x.vercel.app", "http://exp-e2e.ahand.in", "https://evilahand.in", "https://ahand.in.evil.example", "https://.ahand.in", "http://127.0.0.1:47173"]) {
      expect(privyAllowsOrigin(settings, origin)).toBe(false);
    }
  });
  test("with no list every address is tried", () => {
    expect(privyAllowsOrigin({ appId: settings.appId }, "http://127.0.0.1:47173")).toBe(true);
  });
});

describe("email through Privy, as a wagmi connector over Privy's EIP-1193 provider", () => {
  test("connecting loads the host once, lands on the build's chain and reports the Privy account", async () => {
    const fake = fakePrivyProvider(1);
    const { host, seen } = fakeHost(fake);
    let loads = 0;
    const phases: string[] = [];
    const stop = watchPrivyPhase(() => phases.push(privyPhase()));
    const { config, connector } = wagmiWith(async () => {
      loads++;
      return host;
    });
    const result = await connect(config, { connector, chainId: SEPOLIA.id });
    stop();
    expect(result.accounts).toEqual([KEY.address]);
    expect(result.chainId).toBe(84532);
    expect(getConnection(config).status).toBe("connected");
    expect(getConnection(config).connector?.type).toBe("privy");
    expect(phases).toEqual(["loading", "idle"]);
    expect(loads).toBe(1);
    expect(seen.signIns).toBe(1);
    expect(connector.name).toBe("Email");
  });

  test("a give's typed data reaches Privy as eth_signTypedData_v4 with the full structure, and the answer recovers to the account", async () => {
    const fake = fakePrivyProvider();
    const { host } = fakeHost(fake);
    const { config, connector } = wagmiWith(async () => host);
    await connect(config, { connector, chainId: SEPOLIA.id });
    const wallet = await walletClientOf(connector);
    const answer = await signTypedWith(wallet, noCode, GIVE);
    expect(answer.kind).toBe("key");
    expect(answer.wrapped).toBe(false);
    expect(await recoverTypedDataAddress({ ...GIVE, signature: answer.signature } as never)).toBe(KEY.address);
    const asked = fake.calls.find((call) => call.method === "eth_signTypedData_v4")!;
    const sent = JSON.parse((asked.params as [Address, string])[1]);
    expect(sent.primaryType).toBe("Give");
    expect(sent.message).toEqual({ handId: "7", to: "0x00000000000000000000000000000000000000aa", note: "for the ladder" });
    expect(Object.keys(sent.types)).toContain("EIP712Domain");
  });

  test("a money step reaches Privy as eth_sendTransaction from the account, and steps are sent one by one (no EIP-5792)", async () => {
    const fake = fakePrivyProvider();
    const { host } = fakeHost(fake);
    const { config, connector } = wagmiWith(async () => host);
    await connect(config, { connector, chainId: SEPOLIA.id });
    const wallet = await walletClientOf(connector);
    expect(await wallet.getChainId()).toBe(84532);
    expect(await canBatch(wallet, 84532)).toBe(false);
    const hash = await wallet.sendTransaction({ account: wallet.account, chain: wallet.chain, to: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", data: "0x095ea7b3", value: 0n });
    expect(hash).toBe(`0x${"ab".repeat(32)}`);
    const sent = fake.calls.find((call) => call.method === "eth_sendTransaction")!;
    const [tx] = sent.params as [{ from: Address; to: Address; data: Hex }];
    expect(tx.from.toLowerCase()).toBe(KEY.address.toLowerCase());
    expect(tx.to).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
    expect(tx.data).toBe("0x095ea7b3");
  });

  test("a switch to the build's chain is asked of Privy; any other chain is refused as unknown", async () => {
    const fake = fakePrivyProvider();
    const { host } = fakeHost(fake);
    const { config, connector } = wagmiWith(async () => host);
    await connect(config, { connector, chainId: SEPOLIA.id });
    const before = fake.calls.filter((call) => call.method === "wallet_switchEthereumChain").length;
    await switchChain(config, { chainId: 84532 });
    expect(fake.calls.filter((call) => call.method === "wallet_switchEthereumChain").length).toBe(before + 1);
    await expect(connector.switchChain!({ chainId: 8453 })).rejects.toMatchObject({ code: 4902 });
  });

  test("Disconnect ends the Privy session, and an old wallet client can no longer reach it", async () => {
    const fake = fakePrivyProvider();
    const { host, seen } = fakeHost(fake);
    const { config, connector } = wagmiWith(async () => host);
    await connect(config, { connector, chainId: SEPOLIA.id });
    const wallet = await walletClientOf(connector);
    await disconnect(config, { connector });
    expect(seen.signOuts).toBe(1);
    expect(await connector.getAccounts()).toEqual([]);
    await expect(wallet.signTypedData({ ...GIVE, account: wallet.account } as never)).rejects.toMatchObject({ code: 4100 });
    await expect(connector.getProvider()).rejects.toBeDefined();
    expect(await connector.isAuthorized()).toBe(false);
  });

  test("closing Privy's window is a refusal (4001), not an outage", async () => {
    const fake = fakePrivyProvider();
    const { host } = fakeHost(fake, { closes: true });
    const { config, connector } = wagmiWith(async () => host);
    const error = await connect(config, { connector, chainId: SEPOLIA.id }).catch((e: unknown) => e);
    expect(privyUnavailable(error)).toBe(false);
    let node: unknown = error;
    let refused = false;
    while (node && typeof node === "object") {
      if ((node as { code?: unknown }).code === 4001) refused = true;
      node = (node as { cause?: unknown }).cause;
    }
    expect(refused).toBe(true);
    expect(privyPhase()).toBe("idle");
  });

  test("Privy unreachable: the connect fails as unavailable, and the next try loads again", async () => {
    const fake = fakePrivyProvider();
    const { host } = fakeHost(fake);
    let loads = 0;
    const { config, connector } = wagmiWith(async () => {
      loads++;
      if (loads === 1) throw new TypeError("Failed to fetch");
      return host;
    });
    const error = await connect(config, { connector, chainId: SEPOLIA.id }).catch((e: unknown) => e);
    expect(privyUnavailable(error)).toBe(true);
    expect(privyPhase()).toBe("idle");
    expect(getConnection(config).status).toBe("disconnected");
    const result = await connect(config, { connector, chainId: SEPOLIA.id });
    expect(result.accounts).toEqual([KEY.address]);
    expect(loads).toBe(2);
    expect(privyUnavailable(new PrivyUnavailableError())).toBe(true);
  });

  test("the guard passes requests and events through until it is ended", async () => {
    const fake = fakePrivyProvider(84532);
    const guarded = guardedProvider(fake.provider);
    const changes: unknown[] = [];
    guarded.on("chainChanged", ((id: unknown) => changes.push(id)) as never);
    await guarded.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x14a34" }] });
    expect(changes).toEqual(["0x14a34"]);
    expect(await guarded.request({ method: "eth_chainId" })).toBe("0x14a34");
    guarded.end();
    await expect(guarded.request({ method: "eth_chainId" })).rejects.toMatchObject({ code: 4100 });
  });
});
