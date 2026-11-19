import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  stringToBytes,
  zeroAddress,
  zeroHash,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { foundry } from "viem/chains";

import {
  Refusal,
  checkGive,
  checkRoute,
  dataHashOf,
  domain,
  encodeGive,
  encodeLive,
  fromText,
  giveHash,
  keyOfSeed,
  newKey,
  newSeed,
  openLink,
  passOn,
  routeHash,
  signGiveWithKey,
  signGiveWithWallet,
  signShake,
  textValue,
  thankCalldata,
  toCoreSignature,
  toDigits,
  toText,
  worstThankGas,
  type Give,
  type Hand,
  type LinkHead,
  type Shake,
  type SignedGive,
  type SignedShake,
  type Statement,
} from "../src/index.js";

/**
 * The SDK against a Core that runs: a local chain is started, Core and a test token are deployed
 * from the contracts' build, and one Hand goes its whole way — raised, passed on by two Shakes,
 * answered by a Give, checked by Core's own `checkRoute` and `checkGive`, and thanked.
 *
 * Needs `anvil` (Foundry) and `forge build` in ../../contracts; skipped where either is missing.
 */

const contracts = fileURLToPath(new URL("../../../contracts/out/", import.meta.url));
const anvilPath = [process.env.ANVIL, join(homedir(), ".foundry/bin/anvil")].find(
  (path): path is string => !!path && existsSync(path),
);
const built = existsSync(join(contracts, "AHandCore.sol/AHandCore.json"));

function artifact(name: string, file = `${name}.sol`): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(readFileSync(join(contracts, `${file}/${name}.json`), "utf8"));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

// The first three accounts of every anvil: keys known to everyone, for local chains only.
const raiser = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const giver = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const shaker = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a").address;

const REWARD = 100_000_000n;

describe.skipIf(!anvilPath || !built)("a Hand's whole way on a running Core", () => {
  let anvil: ChildProcess;
  let publicClient: ReturnType<typeof createPublicClient>;
  let wallet: ReturnType<typeof createWalletClient>;
  let core: Address;
  let usd: Address;
  const Core = built ? artifact("AHandCore") : { abi: [], bytecode: "0x" as Hex };
  const Usd = built ? artifact("MockUSD") : { abi: [], bytecode: "0x" as Hex };
  // The smart wallet of the contracts' tests: it accepts its owner's signature (ERC-1271).
  const SmartWallet = built ? artifact("Wallet", "Core.t.sol") : { abi: [], bytecode: "0x" as Hex };
  // Their token that calls its recipients, and the code of a payee that burns all the gas it is handed.
  const HookToken = built ? artifact("HookToken") : { abi: [], bytecode: "0x" as Hex };
  const burnerCode: Hex = built
    ? JSON.parse(readFileSync(join(contracts, "Core.t.sol/Burner.json"), "utf8")).deployedBytecode.object
    : "0x";

  async function deploy({ abi, bytecode }: { abi: Abi; bytecode: Hex }, args: unknown[] = []): Promise<Address> {
    const hash = await wallet.deployContract({ abi, bytecode, args, account: raiser, chain: foundry });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return getAddress(receipt.contractAddress!);
  }

  async function send(address: Address, abi: Abi, functionName: string, args: unknown[]) {
    const hash = await wallet.writeContract({ address, abi, functionName, args, account: raiser, chain: foundry });
    return publicClient.waitForTransactionReceipt({ hash });
  }

  /** The Hand's signed terms, read from Core as an application reads them. */
  async function readHand(handId: bigint): Promise<Hand> {
    const onChain = (await publicClient.readContract({
      address: core,
      abi: Core.abi,
      functionName: "hands",
      args: [handId],
    })) as readonly [Address, number, number, number, Address, number, number, bigint, Address, Hex];
    return {
      handId,
      raiser: onChain[0],
      token: onChain[4],
      payoutGasK: onChain[5],
      minClaimBps: onChain[6],
      rootKey: onChain[8],
      dataHash: onChain[9],
    };
  }

  /** What the code at the signer's address says about a signature (ERC-1271), asked on the chain. */
  async function askSignerCode(signer: Address, hash: Hex, signature: Hex): Promise<boolean> {
    const answer = await publicClient
      .readContract({ address: signer, abi: SmartWallet.abi, functionName: "isValidSignature", args: [hash, signature] })
      .catch(() => undefined);
    return answer === "0x1626ba7e";
  }

  beforeAll(async () => {
    const port = await freePort();
    anvil = spawn(anvilPath!, ["--port", String(port), "--silent"], { stdio: "ignore" });
    const transport = http(`http://127.0.0.1:${port}`);
    publicClient = createPublicClient({ chain: foundry, transport, pollingInterval: 50 });
    wallet = createWalletClient({ chain: foundry, transport });
    for (let attempt = 0; ; ++attempt) {
      try {
        await publicClient.getChainId();
        break;
      } catch (error) {
        if (attempt === 50) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    core = await deploy(Core);
    usd = await deploy(Usd);
    await send(usd, Usd.abi, "mint", [raiser.address, 2n * REWARD]);
    await send(usd, Usd.abi, "approve", [core, 2n * REWARD]);
  }, 60_000);

  afterAll(() => {
    anvil?.kill();
  });

  it("is raised, passed on, answered, checked by Core and thanked as the SDK says", async () => {
    const chain = domain(foundry.id, core);
    const root = newKey();
    const first = newKey();
    const second = newKey();

    // Raise: the raiser locks the reward and names the root key of the link.
    const { timestamp } = await publicClient.getBlock();
    const ask = keccak256(stringToBytes("who can fix a 1978 Vespa in Lisbon?"));
    await send(core, Core.abi, "raise", [usd, REWARD, Number(timestamp) + 86_400, root.address, 200, 5_000, ask]);
    const handId = (await publicClient.readContract({ address: core, abi: Core.abi, functionName: "handsCount" })) as bigint;

    const hand = await readHand(handId);
    expect(hand).toMatchObject({ raiser: raiser.address, token: usd, rootKey: root.address, dataHash: ask });

    // Two Shakes: the first keeps a tenth for its payee, the second names no payee and keeps nothing.
    const shakes: Shake[] = [
      { nextKey: first.address, payee: shaker, claimBps: 10_000, nextClaimBps: 9_000, dataHash: zeroHash },
      { nextKey: second.address, payee: zeroAddress, claimBps: 9_000, nextClaimBps: 9_000, dataHash: zeroHash },
    ];
    const signedShakes: SignedShake[] = [
      { shake: shakes[0], keySig: await signShake(root.privateKey, chain, hand, shakes[0]) },
      { shake: shakes[1], keySig: await signShake(first.privateKey, chain, hand, shakes[1]) },
    ];

    // The Give: the route's last key signs it, and the giver signs it with its wallet.
    const give: Give = {
      signer: giver.address,
      payee: giver.address,
      claimBps: 9_000,
      routeHash: routeHash(hand, shakes),
      dataHash: keccak256(stringToBytes("the answer, salted")),
    };
    const signedGive: SignedGive = {
      give,
      keySig: await signGiveWithKey(second.privateKey, chain, hand, give),
      giverSig: toCoreSignature(await signGiveWithWallet(giver, chain, hand, give)),
    };

    // Core's own checks answer what the SDK answers without the chain.
    const route = await checkRoute(chain, hand, signedShakes);
    expect(
      await publicClient.readContract({
        address: core,
        abi: Core.abi,
        functionName: "checkRoute",
        args: [handId, signedShakes],
      }),
    ).toEqual([route.lastKey, route.claimBps, route.routeHash]);
    const hash = await checkGive(chain, hand, signedShakes, signedGive);
    expect(hash).toBe(giveHash(hand, give));
    expect(
      await publicClient.readContract({
        address: core,
        abi: Core.abi,
        functionName: "checkGive",
        args: [handId, signedShakes, signedGive],
      }),
    ).toBe(hash);

    // A Give for more than the route left: the SDK and Core name the same error at the same place.
    const greedy: SignedGive = { ...signedGive, give: { ...give, claimBps: 9_500 } };
    await expect(checkGive(chain, hand, signedShakes, greedy)).rejects.toEqual(new Refusal("InvalidClaim", 2));
    const reverted = await publicClient
      .readContract({ address: core, abi: Core.abi, functionName: "checkGive", args: [handId, signedShakes, greedy] })
      .then(
        () => undefined,
        (error: unknown) =>
          error instanceof BaseError ? error.walk((cause) => cause instanceof ContractFunctionRevertedError) : undefined,
      );
    expect((reverted as ContractFunctionRevertedError).data).toMatchObject({ errorName: "InvalidClaim", args: [2n] });

    // The thank: the shaker gets its tenth, the giver the rest, and Core keeps the Give's hash.
    const receipt = await send(core, Core.abi, "thank", [handId, signedShakes, signedGive, zeroHash]);
    expect(receipt.status).toBe("success");
    const balanceOf = (who: Address) =>
      publicClient.readContract({ address: usd, abi: Usd.abi, functionName: "balanceOf", args: [who] });
    expect(await balanceOf(shaker)).toBe(REWARD / 10n);
    expect(await balanceOf(giver.address)).toBe((REWARD * 9n) / 10n);
    expect(await balanceOf(core)).toBe(0n);
    const thanked = (await publicClient.readContract({
      address: core,
      abi: Core.abi,
      functionName: "thanks",
      args: [handId],
    })) as readonly [Hex, Hex];
    expect(thanked[0]).toBe(hash);
  }, 60_000);

  it("a giver that is a smart wallet is answered for by its code, on Core and through the SDK", async () => {
    const chain = domain(foundry.id, core);
    const root = newKey();
    const smartWallet = await deploy(SmartWallet, [giver.address]);

    const { timestamp } = await publicClient.getBlock();
    await send(core, Core.abi, "raise", [usd, REWARD, Number(timestamp) + 86_400, root.address, 200, 0, zeroHash]);
    const handId = (await publicClient.readContract({ address: core, abi: Core.abi, functionName: "handsCount" })) as bigint;
    const hand: Hand = {
      handId,
      raiser: raiser.address,
      token: usd,
      rootKey: root.address,
      payoutGasK: 200,
      minClaimBps: 0,
      dataHash: zeroHash,
    };

    // The wallet is the Give's signer; its owner's key makes the signature the wallet's code accepts.
    const give: Give = { signer: smartWallet, payee: smartWallet, claimBps: 10_000, routeHash: zeroHash, dataHash: zeroHash };
    const signedGive: SignedGive = {
      give,
      keySig: await signGiveWithKey(root.privateKey, chain, hand, give),
      giverSig: toCoreSignature(await signGiveWithWallet(giver, chain, hand, give)),
    };

    // Without the chain the SDK cannot tell: the wallet's own address signed nothing.
    await expect(checkGive(chain, hand, [], signedGive)).rejects.toEqual(new Refusal("InvalidGiverSig"));

    // With the chain asked, the SDK says what Core says.
    const hash = await checkGive(chain, hand, [], signedGive, askSignerCode);
    expect(
      await publicClient.readContract({ address: core, abi: Core.abi, functionName: "checkGive", args: [handId, [], signedGive] }),
    ).toBe(hash);

    // Another key's signature: the wallet's code refuses it, and so do the SDK and Core.
    const forged: SignedGive = { ...signedGive, giverSig: await signGiveWithKey(root.privateKey, chain, hand, give) };
    await expect(checkGive(chain, hand, [], forged, askSignerCode)).rejects.toEqual(new Refusal("InvalidGiverSig"));
    await expect(
      publicClient.readContract({ address: core, abi: Core.abi, functionName: "checkGive", args: [handId, [], forged] }),
    ).rejects.toThrow();

    const receipt = await send(core, Core.abi, "thank", [handId, [], signedGive, zeroHash]);
    expect(receipt.status).toBe("success");
    expect(await publicClient.readContract({ address: usd, abi: Usd.abi, functionName: "balanceOf", args: [smartWallet] })).toBe(
      REWARD,
    );
  }, 60_000);

  it("travels as links: each holder opens the text it got, and the raiser thanks from the Give link", async () => {
    const chain = domain(foundry.id, core);
    const balanceOf = (who: Address) =>
      publicClient.readContract({ address: usd, abi: Usd.abi, functionName: "balanceOf", args: [who] });
    await send(usd, Usd.abi, "mint", [raiser.address, REWARD]);
    await send(usd, Usd.abi, "approve", [core, REWARD]);

    // Raise: the root key comes from a seed, and the Hand's dataHash stands for a list of statements.
    const question = "Who can fix a 1978 Vespa in Lisbon?";
    const statements: Statement[] = [{ name: "content", value: textValue(question) }];
    const seed = newSeed();
    const { timestamp } = await publicClient.getBlock();
    await send(core, Core.abi, "raise", [
      usd,
      REWARD,
      Number(timestamp) + 86_400,
      privateKeyToAddress(keyOfSeed(seed)),
      200,
      5_000,
      dataHashOf(statements),
    ]);
    const handId = (await publicClient.readContract({ address: core, abi: Core.abi, functionName: "handsCount" })) as bigint;

    // What an application does with a link: it asks the Core the link names for the Hand it names.
    // No canonical Core is known here, so every link names Core by its address.
    const getHand = (head: LinkHead): Promise<Hand> => {
      expect(head).toMatchObject({ chainId: foundry.id, core, handId });
      return readHand(head.handId);
    };

    // The raiser's link carries the question; every holder opens the text it was sent and passes on.
    let text = toText(
      await encodeLive({
        domain: chain,
        hand: await readHand(handId),
        signedShakes: [],
        seed,
        attachments: { statements: [statements], texts: [question] },
      }),
    );
    expect((await openLink(fromText(text), getHand)).texts).toEqual([question]);

    const holders = ["first", "second", "third"].map((name) => privateKeyToAddress(keccak256(stringToBytes(`holder ${name}`))));
    const passes = [
      { payee: holders[0], nextClaimBps: 9_000 },
      { payee: zeroAddress, nextClaimBps: 9_000 },
      { payee: holders[2], nextClaimBps: 8_500, dataHash: keccak256(stringToBytes("a note of the third holder")) },
    ];
    for (const [position, terms] of passes.entries()) {
      const opened = await openLink(fromText(text), getHand);
      expect(opened.signedShakes.length).toBe(position);
      // Core says about the route what the link said.
      expect(
        await publicClient.readContract({ address: core, abi: Core.abi, functionName: "checkRoute", args: [handId, opened.signedShakes] }),
      ).toEqual([opened.end.lastKey, opened.end.claimBps, opened.end.routeHash]);
      const { link } = await passOn(opened, terms);
      text = position % 2 ? toDigits(link) : toText(link);
    }

    // The giver is a smart wallet: its owner opens the link and signs the Give with the link's key and with its own.
    const smartWallet = await deploy(SmartWallet, [giver.address]);
    const last = await openLink(fromText(text), getHand);
    const give: Give = {
      signer: smartWallet,
      payee: smartWallet,
      claimBps: last.end.claimBps,
      routeHash: last.end.routeHash,
      dataHash: keccak256(stringToBytes("the answer, salted")),
    };
    const signedGive: SignedGive = {
      give,
      keySig: await signGiveWithKey(last.linkKey!, chain, last.hand, give),
      giverSig: toCoreSignature(await signGiveWithWallet(giver, chain, last.hand, give)),
    };
    const giveLink = await encodeGive({ domain: chain, hand: last.hand, signedShakes: last.signedShakes, signedGive });
    // What goes to the raiser carries neither the seed nor the key of the link.
    expect(toText(giveLink)).not.toBe(text);
    expect(giveLink.length).toBeLessThan(600);

    // The raiser opens the Give link, checks it as Core would, and thanks with what the link gave.
    const received = await openLink(fromText(toText(giveLink)), getHand);
    expect(received.head.kind).toBe("give");
    expect(received.seed).toBeUndefined();
    const hash = await checkGive(chain, received.hand, received.signedShakes, received.signedGive!, askSignerCode);
    expect(
      await publicClient.readContract({
        address: core,
        abi: Core.abi,
        functionName: "checkGive",
        args: [handId, received.signedShakes, received.signedGive],
      }),
    ).toBe(hash);

    const receipt = await send(core, Core.abi, "thank", [handId, received.signedShakes, received.signedGive, zeroHash]);
    expect(receipt.status).toBe("success");
    expect(await balanceOf(holders[0])).toBe(REWARD / 10n);
    expect(await balanceOf(holders[2])).toBe((REWARD * 5n) / 100n);
    expect(await balanceOf(smartWallet)).toBe((REWARD * 85n) / 100n);
    const thanked = (await publicClient.readContract({ address: core, abi: Core.abi, functionName: "thanks", args: [handId] })) as readonly [
      Hex,
      Hex,
    ];
    expect(thanked[0]).toBe(hash);
  }, 60_000);

  it("is thanked with the worst gas the SDK counts: real transactions use that much and no more", async () => {
    const chain = domain(foundry.id, core);
    const stated = keccak256(stringToBytes("thanks"));
    const { timestamp } = await publicClient.getBlock();

    /** A Hand of `reward` in `token`, three Shakes that each keep 1 % for a payee, and a Give to the fourth payee. */
    async function routeTo(token: Address, payoutGasK: number, payees: Address[]) {
      const keys = [newKey(), newKey(), newKey(), newKey()];
      await send(core, Core.abi, "raise", [token, REWARD, Number(timestamp) + 86_400, keys[0].address, payoutGasK, 0, zeroHash]);
      const handId = (await publicClient.readContract({ address: core, abi: Core.abi, functionName: "handsCount" })) as bigint;
      const hand = await readHand(handId);
      const signedShakes: SignedShake[] = [];
      for (let position = 0; position < 3; ++position) {
        const shake: Shake = {
          nextKey: keys[position + 1].address,
          payee: payees[position],
          claimBps: 10_000 - 100 * position,
          nextClaimBps: 9_900 - 100 * position,
          dataHash: zeroHash,
        };
        signedShakes.push({ shake, keySig: await signShake(keys[position].privateKey, chain, hand, shake) });
      }
      const give: Give = {
        signer: giver.address,
        payee: payees[3],
        claimBps: 9_700,
        routeHash: routeHash(hand, signedShakes.map(({ shake }) => shake)),
        dataHash: zeroHash,
      };
      const signedGive: SignedGive = {
        give,
        keySig: await signGiveWithKey(keys[3].privateKey, chain, hand, give),
        giverSig: await signGiveWithKey("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", chain, hand, give),
      };
      return { hand, signedShakes, signedGive };
    }

    /** Sends the thank with exactly the worst gas the SDK counts. */
    async function thankWithWorstGas({ hand, signedShakes, signedGive }: Awaited<ReturnType<typeof routeTo>>) {
      const worst = worstThankGas(hand, signedShakes, signedGive, { dataHash: stated });
      const args = [hand.handId, signedShakes, signedGive, stated];
      // The calldata the SDK counts is the calldata the contracts' own ABI makes.
      expect(thankCalldata(hand.handId, signedShakes, signedGive, stated)).toBe(
        encodeFunctionData({ abi: Core.abi, functionName: "thank", args }),
      );
      const hash = await wallet.writeContract({
        address: core,
        abi: Core.abi,
        functionName: "thank",
        args,
        account: raiser,
        chain: foundry,
        gas: BigInt(worst.gasLimit),
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).toBe("success");
      return { worst, used: Number(receipt.gasUsed) };
    }

    const pendingOf = (token: Address, payee: Address) =>
      publicClient.readContract({ address: core, abi: Core.abi, functionName: "pending", args: [token, payee] });
    const fresh = (name: string) => privateKeyToAddress(keccak256(stringToBytes(`payee ${name}`)));

    // A limit of one thousand gas: no payout can even start, each uses its limit to the last gas
    // and stays pending. Then the count is exact but for two things it adds on purpose: 16 gas
    // per payout (the 64/63 of the limit) and 17 100 for the first thank on a Core, which this is not.
    await send(usd, Usd.abi, "mint", [raiser.address, REWARD]);
    await send(usd, Usd.abi, "approve", [core, REWARD]);
    const starved = await routeTo(usd, 1, ["one", "two", "three", "four"].map(fresh));
    const exact = await thankWithWorstGas(starved);
    expect(exact.worst.gasLimit - exact.used - 4 * 16 - 17_100).toBeGreaterThanOrEqual(0);
    expect(exact.worst.gasLimit - exact.used - 4 * 16 - 17_100).toBeLessThan(100);
    expect(await pendingOf(usd, starved.signedGive.give.payee)).toBe((REWARD * 97n) / 100n);

    // The limit the price list uses, 200 thousand, a token that calls its recipients, and four
    // payees that burn all they are handed: the thank goes through, leaves every payout pending,
    // and uses nearly all of the worst gas.
    const hook = await deploy(HookToken);
    await send(hook, HookToken.abi, "mint", [raiser.address, REWARD]);
    await send(hook, HookToken.abi, "approve", [core, REWARD]);
    const burners = ["five", "six", "seven", "eight"].map(fresh);
    for (const payee of burners) {
      await publicClient.request({ method: "anvil_setCode" as never, params: [payee, burnerCode] as never });
      await send(hook, HookToken.abi, "setHooked", [payee, true]);
    }
    const burned = await thankWithWorstGas(await routeTo(hook, 200, burners));
    expect(burned.used).toBeLessThanOrEqual(burned.worst.gasLimit);
    expect(burned.used).toBeGreaterThan(burned.worst.gasLimit * 0.94);
    expect(await pendingOf(hook, burners[0])).toBe(REWARD / 100n);
    expect(await pendingOf(hook, burners[3])).toBe((REWARD * 97n) / 100n);
  }, 60_000);
});
