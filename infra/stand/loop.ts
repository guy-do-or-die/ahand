/**
 * The whole core loop through the SDK alone, on a running chain, asserting Core's state after
 * every step. One named line per part:
 *
 *   usd                 raise, pass twice, give, delivery over the stand's relay (when it has one), thank, receipt against balances
 *   pending             a payee blocked by the token waits; unblocked, anyone delivers it with withdraw
 *   refund              refused before expiry; after a jump of the chain's clock, anyone refunds
 *   zero-reward         raise 0, pass, give, thank: Thanked and Given, no Paid, no Pending
 *   second-token        a whole cycle in BlacklistToken with nobody blocked
 *   undeployed-account  a Give by an account not deployed yet (ERC-6492), thanked by setupCall then thankCall
 *
 *   bun infra/stand/loop.ts --slot N | --stand FILE [--only part,part]
 *
 * Exits 0 only when every part passed. Time is read from the chain only.
 */
import { encodeEventTopics, erc20Abi, formatUnits, isAddressEqual, parseAbi, zeroHash, type Address, type Hex, type TransactionReceipt } from "viem";

import {
  CORE_ABI,
  checkGiveOnChain,
  checkRouteOnChain,
  decodeCoreError,
  readHand,
  readPending,
  readThank,
  refundCall,
  withdrawCall,
  type HandState,
  type ReceiptRow,
} from "@ahand/sdk";
import { nostrTransport, type Envelope } from "@ahand/deliver";

import { ROLE, World, check, flagValue, standFrom, withChainLock, type Raised, type StandToken } from "./seed.ts";

const UNITS = 1_000_000n;
const short = (address: Address) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const money = (amount: bigint, token: StandToken) => `${formatUnits(amount, token.decimals)} ${token.symbol}`;

/** Core's view of a Hand, asserted: its state by the chain's clock, its reward, and how it closed. */
async function assertHand(world: World, raised: Raised, expected: HandState): Promise<string> {
  const [{ coreHand, stateAt }, now, thank] = await Promise.all([
    readHand(world.client, world.core, raised.handId),
    world.now(),
    readThank(world.client, world.core, raised.handId),
  ]);
  const state = stateAt(now.timestamp);
  check(state === expected, `Hand ${raised.handId} is ${state}, expected ${expected}`);
  check(isAddressEqual(coreHand.raiser, world.address(ROLE.raiser)), `Hand ${raised.handId}: another raiser`);
  check(coreHand.reward === raised.reward, `Hand ${raised.handId}: reward ${coreHand.reward}, raised with ${raised.reward}`);
  check((coreHand.closedAt === 0) === (expected === "open" || expected === "expired"), `Hand ${raised.handId}: closedAt ${coreHand.closedAt}`);
  check((thank.giveHash !== zeroHash) === (expected === "thanked"), `Hand ${raised.handId}: thanks.giveHash ${thank.giveHash}`);
  return `${state}${coreHand.closedAt ? ` (closedAt ${coreHand.closedAt})` : ""}`;
}

const BLOCKED_ABI = parseAbi(["function blocked(address) view returns (bool)"]);

/** Each of Core's events by its first topic, from the SDK's ABI. */
const EVENT_BY_TOPIC = new Map<Hex, string>(
  CORE_ABI.filter((item) => item.type === "event").map((item) => [encodeEventTopics({ abi: CORE_ABI, eventName: item.name })[0] as Hex, item.name]),
);

/** Core's events in a transaction, by name, in order: what Core actually emitted, read from the receipt. */
function eventsIn(receipt: TransactionReceipt, world: World): string[] {
  return receipt.logs
    .filter((log) => isAddressEqual(log.address, world.core))
    .map((log) => EVENT_BY_TOPIC.get(log.topics[0] as Hex) ?? "unknown");
}

/** The payout row (Paid or Pending) of `payee` in a receipt. */
function payoutTo(rows: ReceiptRow[], payee: Address): ReceiptRow | undefined {
  return rows.find((row) => (row.eventName === "Paid" || row.eventName === "Pending") && row.payee && isAddressEqual(row.payee, payee));
}

async function balances(world: World, token: Address, who: Address[]): Promise<bigint[]> {
  return Promise.all(who.map((address) => world.balance(token, address)));
}

/** Delivers a give link to the Hand's inbox over the stand's relay and returns the link that arrived. */
async function deliver(world: World, raised: Raised, giveAddress: string): Promise<{ link: string; line: string }> {
  const relay = world.stand.relay;
  if (!relay) return { link: giveAddress, line: "no relay on this stand: the give link went by hand" };
  const transport = nostrTransport([relay]);
  const secret = await world.inboxSecret(raised.n);
  let stop = () => {};
  const arrived = new Promise<Envelope>((done, fail) => {
    const timer = setTimeout(() => fail(new Error("nothing arrived at the Hand's inbox within 10 s")), 10_000);
    stop = transport.listen(secret, (envelope) => {
      clearTimeout(timer);
      done(envelope);
    });
  });
  try {
    const sent = await transport.send(raised.inbox, {
      v: 1,
      kind: "give",
      hand: { chainId: world.stand.chainId, core: world.core, handId: raised.handId.toString() },
      giveLink: giveAddress,
    });
    check(sent.acks === sent.of && sent.of > 0, `delivered to ${sent.acks} of ${sent.of} relays`);
    const envelope = await arrived;
    check(envelope.kind === "give" && envelope.giveLink === giveAddress, "the inbox received another message");
    check(envelope.hand.handId === raised.handId.toString(), "the envelope names another Hand");
    return { link: envelope.giveLink!, line: `delivered to ${sent.acks} of ${sent.of} relay and read from the Hand's inbox` };
  } finally {
    stop();
  }
}

/* ------------------------------------------------------------------ parts */

async function usd(world: World): Promise<string> {
  const token = world.token("usd");
  const A = world.address(ROLE.holderA);
  const B = world.address(ROLE.holderB);
  const giver = world.address(ROLE.giver);
  const coreBefore = await world.balance(token.address, world.core);
  const raised = await world.raise({ mode: "unlisted", title: "Who can tune a 1920s upright piano?", content: "In Vake, any weekday morning.", reward: 100n * UNITS });
  await assertHand(world, raised, "open");
  check((await world.balance(token.address, world.core)) - coreBefore === raised.reward, "Core does not hold the reward");

  const first = await world.pass(raised.address, { payee: A, keepBps: 500 });
  check((await checkRouteOnChain(world.client, world.core, raised.handId, first.opened.signedShakes)).claimBps === 9_500, "Core's checkRoute after pass 1");
  const second = await world.pass(first.address, { payee: B, keepBps: 1_000 });
  const end = await checkRouteOnChain(world.client, world.core, raised.handId, second.opened.signedShakes);
  check(end.claimBps === 8_500 && end.routeHash === second.opened.end.routeHash, "Core's checkRoute after pass 2 differs from the link's");
  await assertHand(world, raised, "open");

  const given = await world.giveAs(second.address, ROLE.giver);
  const delivered = await deliver(world, raised, given.address);

  const before = await balances(world, token.address, [A, B, giver, world.core]);
  const thanked = await world.thank(delivered.link);
  const after = await balances(world, token.address, [A, B, giver, world.core]);
  const state = await assertHand(world, raised, "thanked");
  const thank = await readThank(world.client, world.core, raised.handId);
  check(thank.giveHash === given.giveHash, "thanks(id).giveHash is not the Give's hash");

  const expected = [5n * UNITS, 10n * UNITS, 85n * UNITS];
  const rows = thanked.rows.rows;
  [A, B, giver].forEach((payee, at) => {
    const row = payoutTo(rows, payee);
    check(row?.eventName === "Paid" && row.amount === expected[at], `no Paid of ${expected[at]} to ${payee}`);
    check(after[at]! - before[at]! === expected[at], `${payee}'s balance moved by ${after[at]! - before[at]!}, the receipt says ${expected[at]}`);
  });
  check(before[3]! - after[3]! === raised.reward, "Core paid out other than the reward");
  return (
    `hand ${raised.handId}: raised ${money(raised.reward, token)} → passed twice (5%, 10%; Core's checkRoute leaves 85%) → given by ${short(giver)} → ` +
    `${delivered.line} → thanked; Core: ${state}, giveHash ${thank.giveHash.slice(0, 10)}…; ` +
    `receipt ${rows.map((row) => row.eventName).join(", ")}; Paid ${expected.map((amount) => formatUnits(amount, token.decimals)).join(" + ")} = balances moved, Core −${formatUnits(raised.reward, token.decimals)}`
  );
}

async function pending(world: World): Promise<string> {
  const token = world.token("blacklist");
  const holder = world.address(ROLE.loopBlockedPayee);
  const raised = await world.raise({ mode: "dark", title: "Who can lend me a ladder for an afternoon?", token: "blacklist", reward: 50n * UNITS });
  const passed = await world.pass(raised.address, { payee: holder, keepBps: 1_000 });
  const given = await world.giveAs(passed.address, ROLE.giver);
  await world.send(ROLE.anyone, world.blockCall(token.address, holder, true));
  const waitingBefore = await readPending(world.client, world.core, token.address, holder);
  const thanked = await world.thank(given.address);
  await assertHand(world, raised, "thanked");
  const row = payoutTo(thanked.rows.rows, holder);
  check(row?.eventName === "Pending" && row.amount === 5n * UNITS, "the blocked payee's share is not Pending");
  const waiting = await readPending(world.client, world.core, token.address, holder);
  check(waiting - waitingBefore === 5n * UNITS, `pending() grew by ${waiting - waitingBefore}`);

  // While blocked, the token refuses the delivery: Core keeps the amount waiting.
  let refused = false;
  try {
    await world.send(ROLE.anyone, withdrawCall(world.core, token.address, holder, holder));
  } catch {
    refused = true;
  }
  check(refused, "withdraw to a blocked payee went through");
  check((await readPending(world.client, world.core, token.address, holder)) === waiting, "a refused withdraw changed pending()");

  await world.send(ROLE.anyone, world.blockCall(token.address, holder, false));
  const balanceBefore = await world.balance(token.address, holder);
  const receipt = await world.send(ROLE.anyone, withdrawCall(world.core, token.address, holder, holder));
  check(eventsIn(receipt, world).includes("Withdrawn"), "no Withdrawn event");
  check((await readPending(world.client, world.core, token.address, holder)) === 0n, "pending() is not zero after withdraw");
  check((await world.balance(token.address, holder)) - balanceBefore === waiting, "the payee did not receive what waited");
  return (
    `hand ${raised.handId} in BlacklistToken: ${short(holder)} blocked → thanked with Pending ${money(5n * UNITS, token)} ` +
    `(pending() ${formatUnits(waiting, token.decimals)}); withdraw refused while blocked; unblocked → withdraw by ${short(world.address(ROLE.anyone))} ` +
    `delivered ${formatUnits(waiting, token.decimals)}, pending() 0, Withdrawn emitted`
  );
}

async function refund(world: World): Promise<string> {
  const token = world.token("usd");
  const raiser = world.address(ROLE.raiser);
  const raised = await world.raise({ mode: "public", title: "Who can water my plants this weekend?", reward: 20n * UNITS, expirySeconds: 60 });
  await assertHand(world, raised, "open");
  let early: string | undefined;
  try {
    await world.send(ROLE.anyone, refundCall(world.core, raised.handId));
  } catch (error) {
    early = decodeCoreError(error)?.name;
  }
  check(early === "NotExpired", `refund before expiry: ${early ?? "went through"}`);
  const jumped = await world.jumpTo(raised.coreHand.expiry);
  await assertHand(world, raised, "expired");
  const before = await world.balance(token.address, raiser);
  const { rows } = await world.refund(raised.handId);
  const state = await assertHand(world, raised, "refunded");
  const paid = payoutTo(rows.rows, raiser);
  check(paid?.eventName === "Paid" && paid.amount === raised.reward, "no Paid of the whole reward to the raiser");
  check((await world.balance(token.address, raiser)) - before === raised.reward, "the raiser's balance did not get the reward back");
  return (
    `hand ${raised.handId}: refund before expiry refused by Core (NotExpired); clock jumped to ${jumped.timestamp} ≥ expiry ${raised.coreHand.expiry} → expired; ` +
    `refund sent by ${short(world.address(ROLE.anyone))} → Core: ${state}, thanks.giveHash 0; receipt ${rows.rows.map((row) => row.eventName).join(", ")}; ` +
    `raiser +${money(raised.reward, token)}`
  );
}

async function zeroReward(world: World): Promise<string> {
  const token = world.token("usd");
  const A = world.address(ROLE.holderA);
  const allowanceBefore = await world.client.readContract({ address: token.address, abi: erc20Abi, functionName: "allowance", args: [world.address(ROLE.raiser), world.core] });
  const raised = await world.raise({ mode: "unlisted", title: "Who wants to join a Sunday morning run?", reward: 0n });
  await assertHand(world, raised, "open");
  const passed = await world.pass(raised.address, { payee: A, keepBps: 500 });
  const given = await world.giveAs(passed.address, ROLE.giver);
  const before = await balances(world, token.address, [A, world.address(ROLE.giver), world.core]);
  const thanked = await world.thank(given.address);
  const state = await assertHand(world, raised, "thanked");
  const events = eventsIn(thanked.receipt, world);
  check(events.includes("Thanked") && events.includes("Given") && events.includes("Shaken"), `events: ${events.join(", ")}`);
  check(!events.includes("Paid") && !events.includes("Pending"), `a payout event at a reward of zero: ${events.join(", ")}`);
  const after = await balances(world, token.address, [A, world.address(ROLE.giver), world.core]);
  check(after.every((value, at) => value === before[at]), "a balance moved at a reward of zero");
  const allowanceAfter = await world.client.readContract({ address: token.address, abi: erc20Abi, functionName: "allowance", args: [world.address(ROLE.raiser), world.core] });
  check(allowanceAfter === allowanceBefore, "an approve was sent for a reward of zero");
  return `hand ${raised.handId}: raised with reward 0 (no approve) → passed (5% of nothing) → given → thanked; Core: ${state}; events ${events.join(", ")}; no Paid, no Pending, no balance moved`;
}

async function secondToken(world: World): Promise<string> {
  const token = world.token("blacklist");
  const A = world.address(ROLE.holderA);
  const B = world.address(ROLE.holderB);
  const giver = world.address(ROLE.giver);
  const blocked = await Promise.all(
    [A, B, giver].map((who) =>
      world.client.readContract({ address: token.address, abi: BLOCKED_ABI, functionName: "blocked", args: [who] }),
    ),
  );
  // A block left by an earlier run on this chain is lifted first: this cycle is the one with nobody blocked.
  const lifted = [A, B, giver].filter((_, at) => blocked[at]);
  for (const who of lifted) await world.send(ROLE.anyone, world.blockCall(token.address, who, false));
  const raised = await world.raise({ mode: "unlisted", title: "Who can recommend a bike mechanic?", token: "blacklist", reward: 40n * UNITS });
  await assertHand(world, raised, "open");
  const first = await world.pass(raised.address, { payee: A, keepBps: 500 });
  const second = await world.pass(first.address, { keepBps: 0 });
  const given = await world.giveAs(second.address, ROLE.giver);
  const before = await balances(world, token.address, [A, giver]);
  const thanked = await world.thank(given.address);
  const state = await assertHand(world, raised, "thanked");
  const after = await balances(world, token.address, [A, giver]);
  const rows = thanked.rows.rows;
  check(payoutTo(rows, A)?.eventName === "Paid" && after[0]! - before[0]! === 2n * UNITS, "holder A was not paid 2");
  check(payoutTo(rows, giver)?.eventName === "Paid" && after[1]! - before[1]! === 38n * UNITS, "the giver was not paid 38");
  check(!rows.some((row) => row.eventName === "Pending"), "a Pending with nobody blocked");
  return (
    `hand ${raised.handId} in BlacklistToken (${short(token.address)}), nobody blocked${lifted.length ? ` (lifted ${lifted.length} block left by an earlier run)` : ""}: raised ${money(raised.reward, token)} → passed (5%, then 0% anonymous) → given → thanked; ` +
    `Core: ${state}; receipt ${rows.map((row) => row.eventName).join(", ")}; Paid 2 + 38 = balances moved`
  );
}

async function undeployedAccount(world: World): Promise<string> {
  const token = world.token("usd");
  const raised = await world.raise({ mode: "unlisted", title: "Who can check my Georgian grammar?", reward: 20n * UNITS });
  // A salt of its own per run, above any the seed uses (the seed's is the Hand number).
  const salt = (1n << 64n) + raised.handId;
  const given = await world.giveUndeployed(raised.address, ROLE.undeployedOwner, salt);
  const account = given.account;
  check((await world.client.getCode({ address: account })) === undefined, "the account has code before the thank");
  let bare: string | undefined;
  try {
    await checkGiveOnChain(world.client, world.core, raised.handId, given.signedShakes, given.signedGive);
  } catch (error) {
    bare = decodeCoreError(error)?.name;
  }
  check(bare === "InvalidGiverSig", `Core's checkGive on the bare wrapper: ${bare ?? "accepted"}`);
  await checkGiveOnChain(world.client, world.core, raised.handId, given.signedShakes, given.signedGive, given.setup);

  const before = await world.balance(token.address, account);
  const thanked = await world.thank(given.address);
  check(thanked.setupSent, "the thank did not send the setup call first");
  const code = await world.client.getCode({ address: account });
  check(code !== undefined && code !== "0x", "the account has no code after the setup call");
  const state = await assertHand(world, raised, "thanked");
  const givenRow = thanked.rows.rows.find((row) => row.eventName === "Given");
  check(givenRow && givenRow.payee && isAddressEqual(givenRow.payee, account), "Given does not pay the account");
  check(isAddressEqual(givenRow.log.args.signer as Address, account), "Given names another signer");
  check((await world.balance(token.address, account)) - before === raised.reward, "the account did not receive the reward");
  return (
    `hand ${raised.handId}: Give by KeyAccount ${short(account)} of ${short(world.address(ROLE.undeployedOwner))}, no code, signature wrapped per ERC-6492; ` +
    `Core's checkGive refuses it bare (InvalidGiverSig) and accepts it with the setup through the forwarder; setupCall sent, then thankCall with the inner signature → ` +
    `Core: ${state}; the account has code; Given signer and payee = the account; Paid ${money(raised.reward, token)} to it`
  );
}

/* ------------------------------------------------------------------- main */

const PARTS = {
  usd,
  pending,
  refund,
  "zero-reward": zeroReward,
  "second-token": secondToken,
  "undeployed-account": undeployedAccount,
} as const;
type PartName = keyof typeof PARTS;

async function main(argv: string[]): Promise<number> {
  const stand = standFrom(argv);
  const onlyText = flagValue(argv, "--only");
  const names = (onlyText ? onlyText.split(",") : Object.keys(PARTS)) as PartName[];
  for (const name of names) if (!(name in PARTS)) throw new Error(`no part named ${name}; the parts are ${Object.keys(PARTS).join(", ")}`);
  const world = new World(stand);
  let failed = 0;
  await withChainLock(stand.rpc, async () => {
    for (const name of names) {
      try {
        const line = await PARTS[name](world);
        console.log(`${name.padEnd(18)} ok      ${line}`);
      } catch (error) {
        failed++;
        console.log(`${name.padEnd(18)} FAILED  ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
  return failed === 0 ? 0 : 1;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`loop: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
