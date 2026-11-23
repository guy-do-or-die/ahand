import { describe, expect, test } from "bun:test";
import { createWalletClient, custom, numberToHex, recoverTypedDataAddress, UserRejectedRequestError, type Address, type EIP1193Provider, type Hex, type PublicClient, type TypedDataDefinition } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createConfig, http } from "wagmi";
import { connect, disconnect, getConnection, switchChain } from "wagmi/actions";

import { chainOf } from "../chain/clients";
import { chainConfigOf } from "../config/chains";
import type { ChainConfig } from "../config/schema";
import { reviveTypedData } from "./dev";
import {
  guardedProvider,
  isPrivyEmbedded,
  PRIVY_METHODS,
  privyAllowsOrigin,
  privyConnector,
  privyPhase,
  privyUnavailable,
  PrivyUnavailableError,
  watchPrivyPhase,
  type PrivyHost,
  type PrivyLoader,
  type PrivyLoginMethod,
} from "./privy";
import { markPrivy, privyMarked, privyReturning } from "./privy-mark";
import { canBatch } from "./send";
import { signTypedWith } from "./typed";

/**
 * The Privy connector (wallet/privy.ts) with a fake of what Privy hands it: an EIP-1193 provider
 * that behaves as Privy's wallet provider does for the calls the app makes (account, chain, chain
 * switch, typed-data signatures, sends; no EIP-5792), for a wallet Privy keeps and for a crypto
 * wallet logged in through Privy (which may refuse to switch), and a fake host in place of Privy's SDK. The
 * money paths (useSend, useTypedSigner) reach a wallet only through `connector.getProvider()`
 * wrapped in a viem wallet client (state.ts `connectedWallet`), so that is what is driven here.
 */

const SEPOLIA: ChainConfig = chainConfigOf({ id: 84532, rpcUrls: ["https://sepolia.base.org"], pollMs: 2000, logWindow: 200, local: false });
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
function fakePrivyProvider(startChain = 1, behaviour: { refusesSwitch?: boolean } = {}): Fake {
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
        if (behaviour.refusesSwitch) throw refuse(4001, "User rejected the request");
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

/**
 * A host that does what privy-host.tsx does once the person is in: a wallet Privy keeps is moved to
 * the build's chain and handed over; a crypto wallet is handed over where it is (the connector asks it).
 */
function fakeHost(fake: Fake, behaviour: { closes?: boolean; external?: boolean; session?: boolean } = {}) {
  const seen = { signIns: 0, signOuts: 0, restores: 0, methods: [] as (readonly PrivyLoginMethod[])[] };
  let session = behaviour.session ?? false;
  const handOver = async () => {
    if (!behaviour.external) await fake.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: numberToHex(SEPOLIA.id) }] });
    return { address: KEY.address, provider: fake.provider, embedded: !behaviour.external };
  };
  const host: PrivyHost = {
    async signIn(methods) {
      seen.signIns++;
      seen.methods.push(methods);
      if (behaviour.closes) throw new UserRejectedRequestError(new Error("the login window was closed"));
      session = true;
      return handOver();
    },
    async restore() {
      seen.restores++;
      return session ? handOver() : undefined;
    },
    async signOut() {
      seen.signOuts++;
      session = false;
    },
  };
  return { host, seen };
}

/** A localStorage for the mark (Bun has none): a Map behind the three calls privy-mark.ts makes. */
function withStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  return store;
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

describe("logging in through Privy, as a wagmi connector over the EIP-1193 provider of the wallet the person is in with", () => {
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
    expect(connector.name).toBe("Privy");
    expect(seen.methods).toEqual([PRIVY_METHODS]);
    expect(isPrivyEmbedded(getConnection(config).connector)).toBe(true);
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

  test("the ways asked for reach Privy's window: every way in, Google, Apple and X among them, on every screen", async () => {
    const fake = fakePrivyProvider();
    const { host, seen } = fakeHost(fake);
    const { config, connector } = wagmiWith(async () => host);
    await connect(config, { connector, chainId: SEPOLIA.id, privy: { methods: PRIVY_METHODS } } as { connector: typeof connector; chainId: number });
    expect(seen.methods).toEqual([["email", "google", "apple", "twitter", "farcaster", "passkey", "wallet"]]);
  });

  test("a crypto wallet logged in through Privy is asked to move to Base Sepolia, and confirms in its own window", async () => {
    const fake = fakePrivyProvider(1);
    const { host } = fakeHost(fake, { external: true });
    const { config, connector } = wagmiWith(async () => host);
    const result = await connect(config, { connector, chainId: SEPOLIA.id });
    expect(result.chainId).toBe(84532);
    expect(fake.calls.filter((call) => call.method === "wallet_switchEthereumChain")).toHaveLength(1);
    expect(isPrivyEmbedded(getConnection(config).connector)).toBe(false);
  });

  test("a crypto wallet that says no to the switch stays connected on its own chain; the screens ask again", async () => {
    const fake = fakePrivyProvider(1, { refusesSwitch: true });
    const { host } = fakeHost(fake, { external: true });
    const { config, connector } = wagmiWith(async () => host);
    const result = await connect(config, { connector, chainId: SEPOLIA.id });
    expect(result.chainId).toBe(1);
    expect(getConnection(config).status).toBe("connected");
    await expect(switchChain(config, { chainId: 84532 })).rejects.toBeDefined();
  });

  test("the mark: set when someone is in, removed on Log out; a silent restore opens no window and asks nothing of a crypto wallet", async () => {
    const store = withStorage();
    try {
      const fake = fakePrivyProvider(1);
      const { host, seen } = fakeHost(fake, { external: true, session: true });
      const { config, connector } = wagmiWith(async () => host);
      const phases: string[] = [];
      const stop = watchPrivyPhase(() => phases.push(privyPhase()));
      const restored = await connect(config, { connector, chainId: SEPOLIA.id, privy: { restore: true } } as { connector: typeof connector; chainId: number });
      stop();
      expect(restored.accounts).toEqual([KEY.address]);
      expect(seen).toMatchObject({ signIns: 0, restores: 1 });
      expect(phases).toEqual([]);
      expect(fake.calls.filter((call) => call.method === "wallet_switchEthereumChain")).toHaveLength(0);
      expect(privyMarked()).toBe(true);
      expect(store.get("ahand-privy")).toBe("1");
      await disconnect(config, { connector });
      expect(privyMarked()).toBe(false);
      expect(seen.signOuts).toBe(1);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  test("the wallet itself ending the session removes the mark, so the next visit loads nothing", async () => {
    withStorage();
    try {
      const fake = fakePrivyProvider();
      const { host } = fakeHost(fake);
      const { config, connector } = wagmiWith(async () => host);
      await connect(config, { connector, chainId: SEPOLIA.id });
      expect(privyMarked()).toBe(true);
      connector.onDisconnect(new Error("the wallet went away"));
      expect(privyMarked()).toBe(false);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  test("a restore with no session left fails quietly and removes the mark", async () => {
    withStorage();
    try {
      markPrivy(true);
      const fake = fakePrivyProvider();
      const { host, seen } = fakeHost(fake);
      const { config, connector } = wagmiWith(async () => host);
      const error = await connect(config, { connector, chainId: SEPOLIA.id, privy: { restore: true } } as { connector: typeof connector; chainId: number }).catch((e: unknown) => e);
      expect(error).toBeDefined();
      expect(privyUnavailable(error)).toBe(false);
      expect(getConnection(config).status).toBe("disconnected");
      expect(seen.signIns).toBe(0);
      expect(privyMarked()).toBe(false);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  test("storage that refuses: the mark reads as none and writing it throws nothing", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    try {
      expect(() => markPrivy(true)).not.toThrow();
      expect(privyMarked()).toBe(false);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
    expect(privyMarked()).toBe(false);
  });

  test("the way back from a social login is Privy's code and state in the query, nothing less", () => {
    const at = (search: string) => {
      Object.defineProperty(globalThis, "location", { value: { search }, configurable: true });
      try {
        return privyReturning();
      } finally {
        delete (globalThis as { location?: unknown }).location;
      }
    };
    expect(at("?privy_oauth_code=abc&privy_oauth_state=def&privy_oauth_provider=google")).toBe(true);
    expect(at("?privy_oauth_code=abc")).toBe(false);
    expect(at("?d=1")).toBe(false);
    expect(at("")).toBe(false);
    expect(privyReturning()).toBe(false);
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
