/**
 * feat-my's own fixture tool: raises a Hand the way a device does, with a fresh
 * random book of its own (a "device"), `n` = 0, and prints what that device's store would keep,
 * so a spec can write it through the app's own store functions and then ask the screen to
 * rebuild the link. Run as a child process; prints one JSON object.
 *
 *   bun tests/e2e/lib/feat-my/raise.ts --slot N [--account 1] [--mode unlisted|dark|public]
 *       [--reward 25] [--days 30] [--title T] [--content C]
 *
 * Unlike the seed's fixtures (one shared test book, numbers from handsCount), this Hand's book is
 * known to nobody but the spec, as a real device's would be. Time is read from the chain only.
 */
import { parseUnits, type Hex } from "viem";

import { approveCall, describeHand, encodeLive, expiryAfter, packAttachments, toAddress, inboxSecretOf, keyOfSeed, keysTypedData, masterOf, newBook, raiseCall, readHand, readLimits, rootSeedOf, type DescribeMode } from "@ahand/sdk";
import { publicKeyOf } from "@ahand/deliver";
import { privateKeyToAddress } from "viem/accounts";

import { DAY, DEFAULT_MIN_CLAIM_BPS, DEFAULT_PAYOUT_GAS_K, World, check, flagValue, raisedIn, standFrom, toJson, withChainLock } from "../../../../infra/stand/seed.ts";

async function main(argv: string[]): Promise<void> {
  const world = new World(standFrom(argv));
  const index = Number(flagValue(argv, "--account") ?? "1");
  const mode = (flagValue(argv, "--mode") ?? "unlisted") as DescribeMode;
  const title = flagValue(argv, "--title") ?? "Who knows a quiet café to work from near the station?";
  const content = flagValue(argv, "--content") ?? "Wi-Fi that holds, a socket by the table, open before nine.";
  const days = Number(flagValue(argv, "--days") ?? "30");
  const token = world.token("usd");
  const reward = parseUnits(flagValue(argv, "--reward") ?? "25", token.decimals);

  const raiser = world.account(index);
  const master = await masterOf(await raiser.signTypedData(keysTypedData(world.stand.chainId, world.core, raiser.address)), { chainId: world.stand.chainId, core: world.core, raiser: raiser.address });
  const book: Hex = newBook();
  const n = 0;
  const seed = await rootSeedOf(master, book, n);
  const rootKey = privateKeyToAddress(keyOfSeed(seed));
  const chatSecret = await inboxSecretOf(master, book, n);
  const inbox = publicKeyOf(chatSecret);
  const described = describeHand({ mode, title, content, inbox });

  const raised = await withChainLock(world.stand.rpc, async () => {
    const now = await world.now();
    const { maxExpiryPeriod } = await readLimits(world.client, world.core);
    const expiry = expiryAfter(now.timestamp, days * DAY, maxExpiryPeriod);
    if (reward > 0n) await world.send(index, approveCall(token.address, world.core, reward));
    const receipt = await world.send(
      index,
      raiseCall(world.core, { token: token.address, reward, expiry, rootKey, payoutGasK: DEFAULT_PAYOUT_GAS_K, minClaimBps: DEFAULT_MIN_CLAIM_BPS, dataHash: described.dataHash }),
    );
    return { handId: raisedIn(receipt, world.core), expiry };
  });
  const { coreHand, hand } = await readHand(world.client, world.core, raised.handId);
  check(coreHand.rootKey === rootKey && coreHand.dataHash === described.dataHash, "Core keeps other terms than were sent");
  // The first live link, as the raise screen hands it out: for a spec that plays a holder or helper.
  const publicPart = described.publicPart && packAttachments(described.publicPart);
  const link = await encodeLive({ domain: world.domain, hand, signedShakes: [], seed, attachments: described.linkPart }, { ...world.options, publicPart });
  const address = toAddress({ site: world.site, link, shape: described.shape, publicPart: described.publicPart }, world.options);

  console.log(
    toJson({
      ok: true,
      handId: raised.handId,
      chainId: world.stand.chainId,
      core: world.core,
      raiser: raiser.address,
      book,
      n,
      mode,
      title,
      content,
      ...(described.salt ? { salt: described.salt } : {}),
      expiry: raised.expiry,
      reward,
      rootKey,
      inbox,
      // The Hand's inbox secret: a chat key that can sign no Shake and no Give. A device whose
      // account answers differently each time keeps exactly this in its store.
      inboxSecret: chatSecret,
      address,
    }),
  );
}

main(process.argv.slice(2)).then(
  () => process.exit(0),
  (error) => {
    console.error(`feat-my raise: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
