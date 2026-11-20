/**
 * feat-waiting's own fixture, run as a child process (PLAN rule 9): money waiting for one of the
 * dev wallet's accounts, so a spec can connect as that payee and take it out. The seed's
 * `blocked` fixture waits for account 7, which the dev wallet does not offer.
 *
 *   bun tests/e2e/lib/feat-waiting/pending.ts --payee-account N (--slot S | --stand FILE)
 *
 * The same path as the seed's `blocked` fixture, through the SDK alone: account 1 raises in the
 * BlacklistToken, a holder passes it on naming account N as the payee of a 10% share, account 4
 * helps, the token blocks N, account 1 thanks (N's share goes to `pending`), and the token lets N
 * through again. Prints one JSON object: { token, payee, amount, handId, pendingAfter }.
 */
import { isAddressEqual } from "viem";

import { ROLE, World, check, flagValue, standFrom, toJson, withChainLock } from "../../../../infra/stand/seed.ts";

const USD = (dollars: number) => BigInt(dollars) * 1_000_000n;

async function main(argv: string[]): Promise<number> {
  const payeeIndex = Number(flagValue(argv, "--payee-account") ?? "2");
  if (!Number.isInteger(payeeIndex) || payeeIndex < 1 || payeeIndex > 5) throw new Error("--payee-account is one of the dev wallet's accounts, 1 to 5");
  const world = new World(standFrom(argv));
  const out = await withChainLock(world.stand.rpc, async () => {
    const token = world.token("blacklist");
    const payee = world.address(payeeIndex);
    const raised = await world.raise({ mode: "unlisted", title: "Who can lend a ladder for an afternoon?", token: "blacklist", reward: USD(20) });
    const passed = await world.pass(raised.address, { payee, keepBps: 1_000 });
    const given = await world.giveAs(passed.address, ROLE.giver);
    await world.send(ROLE.anyone, world.blockCall(token.address, payee, true));
    let thanked;
    try {
      thanked = await world.thank(given.address);
    } finally {
      await world.send(ROLE.anyone, world.blockCall(token.address, payee, false));
    }
    const waiting = thanked.rows.rows.find((row) => row.eventName === "Pending");
    check(waiting && waiting.payee && isAddressEqual(waiting.payee, payee) && waiting.amount, "no Pending for the payee");
    const pendingAfter = await world.client.readContract({
      address: world.core,
      abi: [{ type: "function", name: "pending", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] }],
      functionName: "pending",
      args: [token.address, payee],
    });
    return { token: token.address, payee, amount: waiting.amount, handId: raised.handId, pendingAfter };
  });
  console.log(toJson(out));
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`feat-waiting pending: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
