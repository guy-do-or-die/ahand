/**
 * The tests' craft tool (ARCHITECTURE §14): SDK and delivery work for spec files, run as a child
 * process, printing one JSON object on stdout. Spec files never import a workspace package; they
 * run this instead.
 *
 *   bun tests/e2e/lib/craft.ts <command> [arguments] (--slot N | --stand FILE)
 *
 *   make [--mode unlisted|dark|public] [--title T] [--content C] [--reward 25] [--token usd|blacklist]
 *        [--expiry SECONDS] [--min-claim BPS] [--gas-k K]       raise a Hand as account 1 (test book, next n)
 *   open <address>                                               the Hand as JSON; exit 1 with {code} when it does not open
 *   pass <address> [--keep BPS] [--payee ADDRESS | --payee-account N] [--shape bare]
 *   give <address> [--giver N | --key HEX] [--payee ADDRESS]     a give address Core accepts
 *   wrap-6492 <address> [--owner N] [--salt S]                   a Give by the KeyAccount of account N (default 6), not deployed
 *   tamper <address> --how flip|cut-d|giver-sig|other-core|version|other-number [--at BYTE] [--core ADDRESS]
 *   deliver-send <address> [--to KEY] [--text T] [--from SECRET] [--relay URL]
 *   deliver-listen (--secret HEX | --n N) [--wait MS] [--count K] [--relay URL]
 *   secrets <address>                                            the link's seed as hex, base64url and decimal digits
 *
 * `secrets` exists for the hygiene guard only, which searches requests, consoles and storage for
 * these three forms; no other command prints a seed. Time is read from the chain only.
 */
import {
  getAddress,
  isAddress,
  parseErc6492Signature,
  parseUnits,
  serializeErc6492Signature,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  LinkError,
  UntrustedCore,
  carryFor,
  checkGiveOnChain,
  encodeGive,
  fromText,
  giveHash,
  innerGiverSig,
  isErc6492,
  messageIdOf,
  passesLeft,
  readDescription,
  readHand,
  toAddress,
  toDigits,
  toText,
  unwrap6492,
  type OpenedAddress,
} from "@ahand/sdk";
import { nostrTransport, publicKeyOf, type Envelope } from "@ahand/deliver";

import { ROLE, TEST_BOOK, World, flagValue, refusalName, standFrom, toJson, withChainLock, type RaiseSpec } from "../../../infra/stand/seed.ts";

class Usage extends Error {}

function positional(argv: string[]): string {
  const value = argv[1];
  if (value === undefined || value.startsWith("--")) throw new Usage(`${argv[0]} takes an address`);
  return value;
}

function numberFlag(argv: string[], name: string): number | undefined {
  const text = flagValue(argv, name);
  if (text === undefined) return undefined;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) throw new Usage(`${name} takes a whole number`);
  return value;
}

function addressFlag(argv: string[], name: string): Address | undefined {
  const text = flagValue(argv, name);
  if (text === undefined) return undefined;
  if (!isAddress(text, { strict: false })) throw new Usage(`${name} takes an address`);
  return getAddress(text);
}

/** What a failure to open is called: the LinkError code, "untrusted", or Core's error name. */
function failure(error: unknown): { ok: false; code: string; messageId?: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof LinkError) return { ok: false, code: error.code, messageId: messageIdOf(error), message };
  if (error instanceof UntrustedCore) return { ok: false, code: "untrusted", messageId: messageIdOf(error), message };
  const name = refusalName(error);
  if (name) return { ok: false, code: name, messageId: `core.${name}`, message };
  return { ok: false, code: "error", message };
}

/* --------------------------------------------------------------- commands */

async function make(world: World, argv: string[]) {
  const mode = (flagValue(argv, "--mode") ?? "unlisted") as RaiseSpec["mode"];
  if (!["unlisted", "dark", "public"].includes(mode)) throw new Usage("--mode is unlisted, dark or public");
  const tokenKind = (flagValue(argv, "--token") ?? "usd") as "usd" | "blacklist";
  const token = world.token(tokenKind);
  const raised = await withChainLock(world.stand.rpc, () =>
    world.raise({
      mode,
      title: flagValue(argv, "--title") ?? "Who can help me find a good bakery nearby?",
      content: flagValue(argv, "--content") ?? "Sourdough, open early, walking distance from the old town.",
      token: tokenKind,
      reward: parseUnits(flagValue(argv, "--reward") ?? "25", token.decimals),
      expirySeconds: numberFlag(argv, "--expiry"),
      minClaimBps: numberFlag(argv, "--min-claim"),
      payoutGasK: numberFlag(argv, "--gas-k"),
    }),
  );
  return {
    ok: true,
    handId: raised.handId,
    n: raised.n,
    book: TEST_BOOK,
    mode: raised.mode,
    token: raised.token.kind,
    reward: raised.reward,
    expiry: raised.view.expiry,
    rootKey: raised.view.rootKey,
    inbox: raised.inbox,
    title: raised.title,
    content: raised.content,
    address: raised.address,
  };
}

/** Core's own answer to a give link: bare, and with the account's setup when the signature is wrapped. */
async function coreAnswers(world: World, opened: OpenedAddress) {
  const signedGive = opened.signedGive!;
  const wrapped = unwrap6492(signedGive.giverSig);
  const ask = async (setup?: Parameters<typeof checkGiveOnChain>[5]) => {
    try {
      await checkGiveOnChain(world.client, world.core, opened.hand.handId, opened.signedShakes, signedGive, setup);
      return "accepted";
    } catch (error) {
      return refusalName(error) ?? (error instanceof Error ? error.message : String(error));
    }
  };
  const bare = await ask();
  if (!wrapped) return { wrapped6492: false, core: bare };
  const forwarder = world.stand.forwarder;
  const code = await world.client.getCode({ address: signedGive.give.signer });
  return {
    wrapped6492: true,
    factory: wrapped.factory,
    factoryData: wrapped.factoryData,
    deployed: code !== undefined && code !== "0x",
    core: bare,
    coreWithSetup: forwarder ? await ask({ forwarder, factory: wrapped.factory, factoryData: wrapped.factoryData }) : "no forwarder on this stand",
  };
}

async function open(world: World, argv: string[]) {
  const opened = await world.open(positional(argv));
  const [{ view, stateAt }, now] = await Promise.all([readHand(world.client, world.core, opened.hand.handId), world.now()]);
  const description = readDescription(opened);
  const json: Record<string, unknown> = {
    ok: true,
    kind: opened.head.kind,
    shape: opened.seen.shape,
    chainId: opened.head.chainId,
    core: opened.head.core,
    handId: opened.hand.handId,
    shakes: opened.head.shakes,
    state: stateAt(now.timestamp),
    now: { block: now.number, timestamp: now.timestamp },
    hand: opened.hand,
    view: { reward: view.reward, expiry: view.expiry, openedAt: view.openedAt, closedAt: view.closedAt },
    description,
    route: opened.signedShakes.map(({ shake }, position) => ({
      position,
      payee: shake.payee === zeroAddress ? null : shake.payee,
      keptBps: shake.claimBps - shake.nextClaimBps,
      claimBps: shake.claimBps,
      nextClaimBps: shake.nextClaimBps,
    })),
    end: opened.end,
    passesLeft: passesLeft(opened.hand, opened.signedShakes),
  };
  if (opened.signedGive) {
    const { give } = opened.signedGive;
    json.give = {
      signer: give.signer,
      payee: give.payee,
      claimBps: give.claimBps,
      giveHash: giveHash(opened.hand, give),
      ...(await coreAnswers(world, opened)),
    };
  }
  return json;
}

async function pass(world: World, argv: string[]) {
  const keepBps = numberFlag(argv, "--keep") ?? 0;
  const payeeAccount = numberFlag(argv, "--payee-account");
  const payee = addressFlag(argv, "--payee") ?? (payeeAccount === undefined ? undefined : world.address(payeeAccount));
  const shape = flagValue(argv, "--shape");
  if (shape !== undefined && shape !== "bare" && shape !== "same") throw new Usage("--shape is bare or same");
  const passed = await world.pass(positional(argv), {
    keepBps,
    payee: payee ?? (keepBps > 0 ? world.address(ROLE.holderA) : undefined),
    shape: shape === "bare" ? "bare" : undefined,
  });
  const last = passed.opened.signedShakes.at(-1)!.shake;
  return {
    ok: true,
    address: passed.address,
    shape: passed.opened.seen.shape,
    shakes: passed.opened.signedShakes.length,
    payee: last.payee === zeroAddress ? null : last.payee,
    keptBps: last.claimBps - last.nextClaimBps,
    claimBps: last.nextClaimBps,
  };
}

async function give(world: World, argv: string[]) {
  const address = positional(argv);
  const key = flagValue(argv, "--key") as Hex | undefined;
  const payee = addressFlag(argv, "--payee");
  let given;
  if (key) {
    const account = privateKeyToAccount(key);
    given = await world.give(address, { signer: account, address: account.address, kind: "key", payee });
  } else {
    given = await world.giveAs(address, numberFlag(argv, "--giver") ?? ROLE.giver, payee);
  }
  const { give } = given.signedGive;
  return { ok: true, address: given.address, signer: give.signer, payee: give.payee, claimBps: give.claimBps, giveHash: given.giveHash, core: "accepted" };
}

async function wrap6492(world: World, argv: string[]) {
  const owner = numberFlag(argv, "--owner") ?? ROLE.undeployedOwner;
  const saltText = flagValue(argv, "--salt");
  // Without --salt, 16 random bytes: a fresh account that nobody has set up.
  const salt = saltText === undefined ? BigInt(toHex(crypto.getRandomValues(new Uint8Array(16)))) : BigInt(saltText);
  const given = await world.giveUndeployed(positional(argv), owner, salt);
  const opened = await world.open(given.address);
  return {
    ok: true,
    address: given.address,
    account: given.account,
    owner: world.address(owner),
    salt,
    forwarder: given.setup.forwarder,
    giveHash: given.giveHash,
    ...(await coreAnswers(world, opened)),
  };
}

/** Where the Shake count stands in a link's bytes: after the first byte, the chain, Core if named, and the Hand. */
function headOffsets(bytes: Uint8Array): { chainEnd: number; hasCore: boolean; countAt: number } {
  let at = 1;
  const skipVarint = () => {
    while (at < bytes.length && (bytes[at]! & 0x80) !== 0) at++;
    at++;
  };
  skipVarint();
  const chainEnd = at;
  const hasCore = (bytes[0]! & 0x04) !== 0;
  if (hasCore) at += 20;
  skipVarint();
  if (at >= bytes.length) throw new Error("a link too short to tamper with");
  return { chainEnd, hasCore, countAt: at };
}

function withFragment(address: string, bytes: Uint8Array): string {
  return `${address.slice(0, address.indexOf("#"))}#${toText(bytes)}`;
}

async function tamper(world: World, argv: string[]) {
  const address = positional(argv);
  const how = flagValue(argv, "--how");
  const hash = address.indexOf("#");
  if (hash < 0) throw new Usage("an address with a link after #");
  const bytes = fromText(address.slice(hash + 1));
  switch (how) {
    case "flip": {
      // Default: the byte that counts the Shakes, so the link names more Shakes than it holds.
      const at = numberFlag(argv, "--at") ?? headOffsets(bytes).countAt;
      if (at >= bytes.length) throw new Usage(`--at is below ${bytes.length}`);
      const out = Uint8Array.from(bytes);
      out[at] = out[at]! ^ 0x7f;
      return { ok: true, how, at, address: withFragment(address, out) };
    }
    case "cut-d": {
      const before = address.slice(0, hash);
      const mark = before.indexOf("?");
      if (mark < 0) throw new Usage("this address carries no d");
      const kept = before.slice(mark + 1).split("&").filter((part) => !part.startsWith("d="));
      return { ok: true, how, address: `${before.slice(0, mark)}${kept.length ? `?${kept.join("&")}` : ""}${address.slice(hash)}` };
    }
    case "giver-sig": {
      const opened = await world.open(address);
      if (!opened.signedGive) throw new Usage("giver-sig takes a give link");
      const original = opened.signedGive.giverSig;
      const inner = innerGiverSig(original);
      // One bit of `r` changed: still a signature's form, no longer the giver's.
      const altered = `${inner.slice(0, 64)}${(Number.parseInt(inner.slice(64, 66), 16) ^ 0x01).toString(16).padStart(2, "0")}${inner.slice(66)}` as Hex;
      let giverSig = altered;
      if (isErc6492(original)) {
        const parsed = parseErc6492Signature(original);
        giverSig = serializeErc6492Signature({ address: parsed.address!, data: parsed.data!, signature: altered });
      }
      const carry = carryFor(opened, "bare");
      const link = await encodeGive(
        { domain: opened.domain, hand: opened.hand, signedShakes: opened.signedShakes, signedGive: { ...opened.signedGive, giverSig }, attachments: carry.attachments },
        world.options,
      );
      return { ok: true, how, address: toAddress({ site: world.site, link, shape: "bare" }, world.options) };
    }
    case "other-core": {
      const other = addressFlag(argv, "--core") ?? getAddress("0xc0dec0dec0dec0dec0dec0dec0dec0dec0dec0de");
      const { chainEnd, hasCore } = headOffsets(bytes);
      const core = Uint8Array.from(Buffer.from(other.slice(2), "hex"));
      const out = hasCore
        ? Uint8Array.from([...bytes.slice(0, chainEnd), ...core, ...bytes.slice(chainEnd + 20)])
        : Uint8Array.from([bytes[0]! | 0x04, ...bytes.slice(1, chainEnd), ...core, ...bytes.slice(chainEnd)]);
      // Written bare: a numbered path would name the canonical Core and contradict the link.
      return { ok: true, how, core: other, address: `${world.site}/#${toText(out)}` };
    }
    case "version": {
      const out = Uint8Array.from(bytes);
      out[0] = (2 << 4) | (out[0]! & 0x0f);
      return { ok: true, how, address: withFragment(address, out) };
    }
    case "other-number": {
      const before = address.slice(0, hash);
      const match = /\/([0-9]+)(\?|$)/.exec(before);
      if (!match) throw new Usage("other-number takes a numbered or faced address");
      const other = BigInt(match[1]!) + 1n;
      return { ok: true, how, handId: other, address: `${before.replace(/\/([0-9]+)(\?|$)/, `/${other}$2`)}${address.slice(hash)}` };
    }
    default:
      throw new Usage("--how is flip, cut-d, giver-sig, other-core, version or other-number");
  }
}

function relayOf(world: World, argv: string[]): string {
  const relay = flagValue(argv, "--relay") ?? world.stand.relay;
  if (!relay) throw new Usage("this stand has no relay: pass --relay URL");
  return relay;
}

async function deliverSend(world: World, argv: string[]) {
  const opened = await world.open(positional(argv));
  const text = flagValue(argv, "--text");
  const to = (flagValue(argv, "--to") as Hex | undefined) ?? readDescription(opened).inbox;
  if (!to) throw new Usage("the Hand's description names no inbox: pass --to KEY");
  const kind = opened.signedGive ? "give" : "note";
  if (kind === "note" && !text) throw new Usage("a link that is not a give link is sent as a note: pass --text");
  const envelope: Omit<Envelope, "replyTo"> = {
    v: 1,
    kind,
    hand: { chainId: opened.head.chainId, core: opened.head.core, handId: opened.hand.handId.toString() },
    ...(kind === "give" ? { giveLink: positional(argv) } : {}),
    ...(text ? { text } : {}),
  };
  const sent = await nostrTransport([relayOf(world, argv)]).send(to, envelope, flagValue(argv, "--from") as Hex | undefined);
  // The chat key is a per-Give key that can sign no Shake and no Give; a test keeps it to read replies.
  return { ok: sent.acks > 0, kind, to, acks: sent.acks, of: sent.of, id: sent.id, chatSecret: sent.key, replyTo: publicKeyOf(sent.key) };
}

async function deliverListen(world: World, argv: string[]) {
  const secretFlag = flagValue(argv, "--secret") as Hex | undefined;
  const n = numberFlag(argv, "--n");
  if (!secretFlag && n === undefined) throw new Usage("deliver-listen takes --secret HEX or --n N (the test book's Hand number)");
  const secret = secretFlag ?? (await world.inboxSecretOf(n!));
  const wait = numberFlag(argv, "--wait") ?? 5_000;
  const count = numberFlag(argv, "--count") ?? 1;
  const envelopes: Record<string, unknown>[] = [];
  await new Promise<void>((done) => {
    const timer = setTimeout(finish, wait);
    const stop = nostrTransport([relayOf(world, argv)]).listen(secret, (envelope, from, meta) => {
      envelopes.push({ ...envelope, from, id: meta.id, at: meta.at });
      if (envelopes.length >= count) finish();
    });
    function finish() {
      clearTimeout(timer);
      stop();
      done();
    }
  });
  return { ok: envelopes.length >= count, envelopes };
}

async function secrets(world: World, argv: string[]) {
  const opened = await world.open(positional(argv));
  if (!opened.seed) throw new Usage("this link carries no seed: only a live link has one");
  const bytes = Uint8Array.from(Buffer.from(opened.seed.slice(2), "hex"));
  return { ok: true, hex: opened.seed.slice(2).toLowerCase(), base64url: toText(bytes), digits: toDigits(bytes) };
}

const COMMANDS = {
  make,
  open,
  pass,
  give,
  "wrap-6492": wrap6492,
  tamper,
  "deliver-send": deliverSend,
  "deliver-listen": deliverListen,
  secrets,
} as const;

export async function main(argv: string[]): Promise<number> {
  const name = argv[0] as keyof typeof COMMANDS | undefined;
  if (!name || !(name in COMMANDS)) {
    console.error(`usage: craft.ts <${Object.keys(COMMANDS).join("|")}> … (--slot N | --stand FILE)`);
    return 2;
  }
  let world: World;
  try {
    world = new World(standFrom(argv), flagValue(argv, "--site"));
  } catch (error) {
    console.error(`craft: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  try {
    const result = await COMMANDS[name](world, argv);
    console.log(toJson(result));
    return (result as { ok: boolean }).ok ? 0 : 1;
  } catch (error) {
    if (error instanceof Usage) {
      console.error(`craft ${name}: ${error.message}`);
      return 2;
    }
    console.log(toJson(failure(error)));
    return 1;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`craft: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
