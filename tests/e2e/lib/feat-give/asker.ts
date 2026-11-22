/**
 * The asker's side of a give, for the give smoke (a child process: spec files import no workspace
 * package). It plays the raiser's device with the seed's test book, and reads a give link the way
 * the thank screen and the CLI will.
 *
 *   bun tests/e2e/lib/feat-give/asker.ts give-of <give-address> --slot N
 *       the Give inside a give link: signer, payee, claim, dataHash, and the giver signature's form
 *   bun tests/e2e/lib/feat-give/asker.ts reply --n N --to KEY --hand <live-address> --text T --slot N
 *       the asker answers the giver from the Hand's own inbox key (the key the giver's thread trusts)
 *
 * Prints one JSON object on stdout. Time is read from the chain only; nothing here prints a seed.
 */
import { isErc6492, readDescription, unwrapErc6492 } from "@ahand/sdk";
import { nostrTransport, publicKeyOf } from "@ahand/deliver";
import type { Hex } from "viem";

import { World, flagValue, standFrom, toJson } from "../../../../infra/stand/seed.ts";

async function giveOf(world: World, argv: string[]) {
  const address = argv[1];
  if (!address || address.startsWith("--")) throw new Error("give-of takes a give address");
  const opened = await world.open(address);
  if (!opened.signedGive) return { ok: false, kind: opened.head.kind };
  const { give, giverSig } = opened.signedGive;
  const wrapped = unwrapErc6492(giverSig);
  return {
    ok: true,
    kind: opened.head.kind,
    shape: opened.seen.shape,
    handId: opened.hand.handId,
    signer: give.signer,
    payee: give.payee,
    claimBps: give.claimBps,
    routeHash: give.routeHash,
    dataHash: give.dataHash,
    giverSigBytes: (giverSig.length - 2) / 2,
    wrapped6492: isErc6492(giverSig),
    ...(wrapped ? { factory: wrapped.factory } : {}),
    seedPresent: opened.seed !== undefined,
    description: readDescription(opened).status,
  };
}

async function reply(world: World, argv: string[]) {
  const n = Number(flagValue(argv, "--n"));
  const to = flagValue(argv, "--to") as Hex | undefined;
  const text = flagValue(argv, "--text");
  const live = flagValue(argv, "--hand");
  if (!Number.isInteger(n) || !to || !text || !live) throw new Error("reply takes --n N --to KEY --hand ADDRESS --text T");
  const relay = world.stand.relay;
  if (!relay) throw new Error("this stand has no relay");
  const opened = await world.open(live);
  const secret = await world.inboxSecret(n);
  const sent = await nostrTransport([relay]).send(
    to,
    { v: 1, kind: "note", hand: { chainId: opened.head.chainId, core: opened.head.core, handId: opened.hand.handId.toString() }, text },
    secret,
  );
  return { ok: sent.acks > 0, acks: sent.acks, of: sent.of, from: publicKeyOf(secret) };
}

const COMMANDS = { "give-of": giveOf, reply } as const;

async function main(argv: string[]): Promise<number> {
  const name = argv[0] as keyof typeof COMMANDS | undefined;
  if (!name || !(name in COMMANDS)) {
    console.error(`usage: asker.ts <${Object.keys(COMMANDS).join("|")}> … (--slot N | --stand FILE)`);
    return 2;
  }
  const world = new World(standFrom(argv), flagValue(argv, "--site"));
  const result = await COMMANDS[name](world, argv);
  console.log(toJson(result));
  return (result as { ok: boolean }).ok ? 0 : 1;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`asker: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
