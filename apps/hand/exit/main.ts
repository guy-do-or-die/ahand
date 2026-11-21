import "../src/design/tokens.css";
import "./exit.css";

import {
  CORE_ABI,
  FORWARDER_ABI,
  LinkError,
  checkGiveOnChain,
  costOf,
  decodeCoreError,
  digest,
  domainSeparator,
  fromText,
  giveHash,
  isKeySignature,
  messageIdOf,
  openAddress,
  openLink,
  readHand,
  readPending,
  readThank,
  refundCall,
  setupCall,
  simulate,
  thankCall,
  innerGiverSig,
  unwrap6492,
  withdrawCall,
  worstThankGas,
  type AccountSetup,
  type Call,
  type Hand,
  type HandState,
  type HandView,
  type LinkHead,
  type OpenedLink,
  type SignedGive,
} from "@ahand/sdk";
import raw from "virtual:ahand-config";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  isAddressEqual,
  parseAbi,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { parseConfig } from "../src/config/load";
import { pollMsOf } from "../src/config/schema";
import { MARK, MARK_DESCENT_EM } from "../src/lib/markSpec";
import { codeBlock, h, type Child } from "./dom";
import { bpsText, castCall, castSend, explorerValue, fileServe, shareOf, span, stateBadge, unitsText, type ShareRow } from "./logic";
import { connectWallet, discoverWallets, ensureChain, isUserRejection, sendWithWallet, WrongChain, type FoundWallet } from "./wallet";
import { say, startLang, type Lang, type WordKey } from "./words";

/**
 * exit.html: the page that still moves money when the site is gone (ARCHITECTURE §1 rule 2, §10).
 * Read a Hand, send it back, deliver waiting money, thank from a give address: each with a wallet,
 * with one cast line, or field by field on a block explorer. No router, no wagmi, no request but
 * to the RPC address in the first field. Every "now" is the latest block's timestamp (D-61).
 */

const config = parseConfig(raw);
const HANDS_SIG = "hands(uint256)(address,uint40,uint40,uint40,address,uint16,uint16,uint256,address,bytes32)";
const PENDING_SIG = "pending(address,address)(uint256)";
const ERC1271 = parseAbi(["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"]);
const SERVE_PORT = 8000;
const POLL_MS = Math.max(2_000, pollMsOf(config.chain) * 4);

type ActionKey = "refund" | "withdraw" | "setup" | "thank";

interface TokenFacts {
  address: Address;
  symbol?: string;
  decimals?: number;
}

interface TxState {
  phase: "checking" | "sent" | "mined" | "error";
  hash?: Hex;
  block?: bigint;
  ok?: boolean;
  message?: string;
}

interface Net {
  client: PublicClient;
  chainId: number;
  block: { number: bigint; timestamp: number };
}

interface HandRead {
  id: bigint;
  view: HandView;
  stateAt: (now: number) => HandState;
  giveHash: Hex;
  token: TokenFacts;
}

interface ThankRead {
  opened: OpenedLink;
  hand: HandRead;
  signedGive: SignedGive;
  setup?: AccountSetup;
  /** The account was set up by now (it had code at the check, or step 1 landed). */
  deployed: boolean;
  checkedAt: bigint;
  checkedThroughForwarder: boolean;
  gasLimit: number;
  shares: ShareRow[];
}

const S = {
  lang: startLang(navigator.languages ?? [navigator.language]),
  rpc: config.chain.rpcUrls[0] ?? "",
  core: (config.cores.canonical ?? config.cores.trusted[0]?.core ?? "") as string,
  forwarder: (config.forwarder ?? "") as string,
  handInput: "",
  waitToken: (config.tokens[0]?.address ?? "") as string,
  waitPayee: "",
  waitTo: "",
  thankInput: "",
  net: undefined as Net | undefined,
  netError: undefined as string | undefined,
  netWarn: [] as string[],
  reading: false,
  wallets: [] as FoundWallet[],
  wallet: undefined as FoundWallet | undefined,
  account: undefined as Address | undefined,
  walletError: undefined as string | undefined,
  hand: undefined as HandRead | undefined,
  handError: undefined as string | undefined,
  pending: undefined as { token: TokenFacts; payee: Address; amount: bigint; block: bigint } | undefined,
  waitError: undefined as string | undefined,
  thank: undefined as ThankRead | undefined,
  thankError: undefined as string | undefined,
  tx: {} as Partial<Record<ActionKey, TxState>>,
  /** Which actions show their explorer form and calldata: kept across re-renders. */
  more: new Set<ActionKey>(),
};

const T = (key: WordKey | `core.${string}` | `link.${string}`, values?: Record<string, string | number>) => say(S.lang, key, values);
const root = document.getElementById("exit")!;

/* ------------------------------------------------------------- formatting */

function dateText(seconds: number): string {
  const locale = S.lang === "ru" ? "ru-RU" : "en-GB";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(seconds * 1000));
}

function amountText(amount: bigint, token: TokenFacts): string {
  return unitsText(amount, token.decimals, token.symbol);
}

async function tokenFacts(client: PublicClient, address: Address): Promise<TokenFacts> {
  const known = config.tokens.find((token) => isAddressEqual(token.address, address));
  if (known) return { address, symbol: known.symbol, decimals: known.decimals };
  try {
    const [symbol, decimals] = await Promise.all([
      client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
    ]);
    return { address, symbol: symbol.slice(0, 16), decimals };
  } catch {
    return { address };
  }
}

/** One sentence for whatever went wrong: Core's refusal, a link that does not open, the wallet, the network. */
function sentenceOf(error: unknown): string {
  if (error instanceof WrongChain) return T("wallet.wrongChain", { got: error.walletChainId, want: error.wantedChainId });
  if (isUserRejection(error)) return T("wallet.rejected");
  if (error instanceof LinkError) return T(messageIdOf(error) as `link.${string}`);
  if (error instanceof Untrusted) return T("link.untrusted");
  const refusal = decodeCoreError(error);
  if (refusal) return `${T(`core.${refusal.name}`, { position: (refusal.position ?? 0) + 1 })} (${refusal.name})`;
  const text = error instanceof Error ? error.message : String(error);
  if (/fetch|network|HTTP request failed|timed? ?out|Failed to fetch/i.test(text)) return T("net.down");
  return text.split("\n")[0]!.slice(0, 240);
}

class Untrusted extends Error {}

/* ------------------------------------------------------------------ chain */

function needNet(): Net {
  if (!S.net) throw new Error(T("net.down"));
  return S.net;
}

function coreAddress(): Address {
  if (!isAddress(S.core, { strict: false })) throw new Error(T("net.notCore"));
  return getAddress(S.core);
}

async function readChain(): Promise<void> {
  S.reading = true;
  S.netError = undefined;
  S.netWarn = [];
  render();
  try {
    if (!/^https?:\/\/\S+$/.test(S.rpc)) throw new Error(T("net.down"));
    const client = createPublicClient({ transport: http(S.rpc, { retryCount: 1, timeout: 15_000 }) }) as PublicClient;
    const chainId = await client.getChainId();
    const latest = await client.getBlock({ blockTag: "latest" });
    const core = coreAddress();
    const code = await client.getCode({ address: core });
    if (!code || code === "0x") throw new Error(T("net.notCore"));
    const domain = await client.readContract({ address: core, abi: CORE_ABI, functionName: "eip712Domain" }).catch(() => undefined);
    if (!domain || domain[1] !== "aHand" || domain[2] !== "core" || Number(domain[3]) !== chainId || !isAddressEqual(domain[4], core)) {
      throw new Error(T("net.notCore"));
    }
    if (chainId !== config.chain.id) S.netWarn.push(T("net.otherChain", { got: chainId, want: config.chain.id }));
    if (config.cores.canonical && !isAddressEqual(core, config.cores.canonical)) S.netWarn.push(T("net.otherCore", { built: config.cores.canonical }));
    S.net = { client, chainId, block: { number: latest.number, timestamp: Number(latest.timestamp) } };
  } catch (error) {
    S.net = undefined;
    S.netError = sentenceOf(error);
  }
  S.reading = false;
  render();
}

/** Keeps the network's clock fresh; a Hand whose state turns with it is shown again. */
async function tick(): Promise<void> {
  const net = S.net;
  if (!net) return;
  try {
    const latest = await net.client.getBlock({ blockTag: "latest" });
    if (S.net !== net) return;
    const before = S.hand?.stateAt(net.block.timestamp);
    net.block = { number: latest.number, timestamp: Number(latest.timestamp) };
    const time = document.querySelector<HTMLElement>("[data-testid='exit-time']");
    if (time) time.textContent = T("net.time", { block: String(net.block.number), date: dateText(net.block.timestamp) });
    if (S.hand && before !== S.hand.stateAt(net.block.timestamp)) render();
  } catch {
    // the next tick tries again; actions say "can't reach the network" themselves
  }
}

async function readHandById(id: bigint): Promise<HandRead> {
  const { client } = needNet();
  const core = coreAddress();
  const { view, stateAt } = await readHand(client, core, id);
  const giveHash = view.closedAt !== 0 ? (await readThank(client, core, id)).giveHash : zeroHash;
  return { id, view, stateAt, giveHash, token: await tokenFacts(client, view.token) };
}

async function readHandAction(): Promise<void> {
  S.handError = undefined;
  S.hand = undefined;
  delete S.tx.refund;
  try {
    const text = S.handInput.trim();
    if (!/^[0-9]+$/.test(text)) throw new Error(T("state.missing"));
    if (!S.net) await readChain();
    S.hand = await readHandById(BigInt(text));
    await tick();
  } catch (error) {
    S.handError = sentenceOf(error);
  }
  render();
}

async function readWaiting(): Promise<void> {
  S.waitError = undefined;
  S.pending = undefined;
  delete S.tx.withdraw;
  try {
    if (!isAddress(S.waitToken, { strict: false }) || !isAddress(S.waitPayee, { strict: false })) throw new Error(T("core.ZeroDestination"));
    if (!S.net) await readChain();
    const { client, block } = needNet();
    const token = getAddress(S.waitToken);
    const payee = getAddress(S.waitPayee);
    const amount = await readPending(client, coreAddress(), token, payee);
    S.pending = { token: await tokenFacts(client, token), payee, amount, block: block.number };
  } catch (error) {
    S.waitError = sentenceOf(error);
  }
  render();
}

/* ------------------------------------------------------------------ thank */

async function openGive(): Promise<void> {
  S.thankError = undefined;
  S.thank = undefined;
  delete S.tx.setup;
  delete S.tx.thank;
  render();
  try {
    if (!S.net) await readChain();
    const net = needNet();
    const core = coreAddress();
    const text = S.thankInput.trim();
    const options = config.cores.canonical ? { canonicalCore: getAddress(config.cores.canonical) } : {};
    let read: HandRead | undefined;
    const getHand = async (head: LinkHead): Promise<Hand> => {
      if (head.chainId !== net.chainId || !isAddressEqual(head.core, core)) throw new Untrusted();
      read = await readHandById(head.handId);
      if (read.view.openedAt === 0) throw new Error(T("core.NotRaised"));
      const { raiser, token, rootKey, payoutGasK, minClaimBps, dataHash } = read.view;
      return { handId: head.handId, raiser, token, rootKey, payoutGasK, minClaimBps, dataHash };
    };
    const opened = text.includes("#") ? await openAddress(text, getHand, options) : await openLink(fromText(text), getHand, options);
    if (!opened.signedGive || !read) throw new Error(T("thank.notGive"));
    const hand = read;
    const state = hand.stateAt(net.block.timestamp);
    if (state !== "open") throw new Error(T("thank.notOpen", { id: String(hand.id), state: stateLine(hand, net.block.timestamp) }));

    const signedGive = opened.signedGive;
    const wrapped = unwrap6492(signedGive.giverSig);
    const signerCode = (await net.client.getCode({ address: signedGive.give.signer })) ?? "0x";
    const deployed = signerCode !== "0x";
    let setup: AccountSetup | undefined;
    if (wrapped) {
      if (!isAddress(S.forwarder, { strict: false })) {
        if (!deployed) throw new Error(T("thank.noForwarder"));
      } else {
        const forwarder = getAddress(S.forwarder);
        setup = { forwarder, factory: wrapped.factory, factoryData: wrapped.factoryData };
        if (!deployed) {
          const code = await net.client.getCode({ address: forwarder });
          if (!code || code === "0x") throw new Error(T("thank.noForwarderCode", { address: forwarder }));
        }
      }
    }
    S.thank = await judgeThank(opened, hand, signedGive, setup, deployed);
  } catch (error) {
    S.thankError = sentenceOf(error);
  }
  render();
}

/**
 * Asks Core's checkGive (through the forwarder after the setup call while the account has no
 * code), and prices the thank at its worst, the account's own check included.
 */
async function judgeThank(opened: OpenedLink, hand: HandRead, signedGive: SignedGive, setup: AccountSetup | undefined, deployed: boolean): Promise<ThankRead> {
  const { client, block } = needNet();
  const core = coreAddress();
  const inner: SignedGive = { ...signedGive, giverSig: innerGiverSig(signedGive.giverSig) };
  const throughForwarder = !deployed && setup !== undefined;
  await checkGiveOnChain(client, core, hand.id, opened.signedShakes, throughForwarder ? signedGive : inner, throughForwarder ? setup : undefined);

  const signed = digest(domainSeparator(opened.domain), giveHash(opened.hand, inner.give));
  const isValid = encodeFunctionData({ abi: ERC1271, functionName: "isValidSignature", args: [signed, inner.giverSig] });
  let giverCodeGas = 0;
  if (throughForwarder) {
    const setupData = setupCall(setup!).data;
    const both = encodeFunctionData({
      abi: FORWARDER_ABI,
      functionName: "aggregate3",
      args: [[{ target: setup!.factory, allowFailure: false, callData: setup!.factoryData }, { target: inner.give.signer, allowFailure: false, callData: isValid }]],
    });
    const [withCheck, alone] = await Promise.all([client.estimateGas({ to: setup!.forwarder, data: both }), client.estimateGas({ to: setup!.forwarder, data: setupData })]);
    giverCodeGas = Number(withCheck - alone);
  } else if (deployed) {
    const code = (await client.getCode({ address: inner.give.signer })) ?? "0x";
    const delegated = code.toLowerCase().startsWith("0xef0100") && code.length === 2 + 46;
    if (!(delegated && isKeySignature(inner.giverSig))) {
      giverCodeGas = Number(await client.estimateGas({ to: inner.give.signer, data: isValid })) - 21_000;
    }
  }
  const gas = worstThankGas(opened.hand, opened.signedShakes, inner, { giverCodeGas });
  return {
    opened,
    hand,
    signedGive,
    setup,
    deployed,
    checkedAt: block.number,
    checkedThroughForwarder: throughForwarder,
    gasLimit: gas.gasLimit,
    shares: shareOf(hand.view.reward, opened.signedShakes, signedGive.give),
  };
}

/* ----------------------------------------------------------------- wallet */

async function pickWallet(wallet: FoundWallet): Promise<void> {
  S.walletError = undefined;
  try {
    S.account = await connectWallet(wallet);
    S.wallet = wallet;
  } catch (error) {
    S.walletError = sentenceOf(error);
  }
  render();
}

/**
 * Sends one call from the connected wallet: Core is asked first by eth_call (a refusal stops here
 * with its sentence), then the wallet signs and sends, and the receipt is read back from the RPC
 * this page reads, never from the wallet.
 */
async function send(key: ActionKey, call: Call, after: () => Promise<void>, gasLimit?: number): Promise<void> {
  const wallet = S.wallet;
  const from = S.account;
  if (!wallet || !from) return;
  S.tx[key] = { phase: "checking" };
  render();
  try {
    const net = needNet();
    await ensureChain(wallet, net.chainId);
    const simulated = await simulate(net.client, call, from);
    if (!simulated.ok) {
      S.tx[key] = { phase: "error", message: `${T(`core.${simulated.refusal.name}`, { position: (simulated.refusal.position ?? 0) + 1 })} (${simulated.refusal.name})` };
      render();
      return;
    }
    const hash = await sendWithWallet(wallet, from, call, gasLimit === undefined ? undefined : BigInt(gasLimit));
    S.tx[key] = { phase: "sent", hash };
    render();
    const receipt = await net.client.waitForTransactionReceipt({ hash, pollingInterval: Math.min(1_000, pollMsOf(config.chain)), timeout: 180_000 });
    S.tx[key] = { phase: "mined", hash, block: receipt.blockNumber, ok: receipt.status === "success" };
    await tick();
    if (receipt.status === "success") await after();
  } catch (error) {
    S.tx[key] = { ...S.tx[key], phase: "error", message: sentenceOf(error) };
  }
  render();
}

/* ------------------------------------------------------------------- view */

function stateLine(hand: HandRead, now: number): string {
  const state = hand.stateAt(now);
  const values = {
    left: span(Math.max(0, hand.view.expiry - now)),
    date: dateText(state === "expired" ? hand.view.expiry : hand.view.closedAt),
  };
  return T(stateBadge(state), values);
}

const copyWords = () => ({ copy: T("copy"), copied: T("copied"), failed: T("copyFailed") });

function field(label: string, key: "rpc" | "core" | "forwarder" | "handInput" | "waitToken" | "waitPayee" | "waitTo", testId: string, extra: Record<string, unknown> = {}): HTMLElement {
  const input = h("input", {
    class: "x-input",
    value: S[key],
    "data-testid": testId,
    "data-key": key,
    spellcheck: "false",
    autocomplete: "off",
    autocapitalize: "off",
    ...extra,
    oninput: (event: Event) => (S[key] = (event.target as HTMLInputElement).value),
  });
  return h("label", { class: "x-field" }, h("span", {}, label), input);
}

function errorBox(message: string | undefined, testId: string): Child {
  return message ? h("p", { class: "x-err", role: "alert", "data-testid": testId }, message) : null;
}

function lockup(): HTMLElement {
  const hands = h(
    "span",
    {
      "aria-hidden": "true",
      style: `position:absolute;left:50%;bottom:${MARK_DESCENT_EM.toFixed(3)}em;transform:translateX(-50%);font-size:${MARK.emojiScale.toFixed(3)}em;line-height:1;font-family:var(--emoji);letter-spacing:0`,
    },
    "🙌",
  );
  return h(
    "span",
    {
      class: "x-brand",
      "aria-label": "aHand",
      style: `display:inline-flex;align-items:center;height:52px;font-size:34px;font-weight:${MARK.fontWeight};letter-spacing:${MARK.letterSpacing};line-height:1`,
    },
    "a",
    h("span", { style: "position:relative;display:inline-block" }, "H", hands),
    "and",
  );
}

/**
 * The three ways one call can be made: the wallet's button, a cast line, and the fields of a block
 * explorer's Write Contract form, with the raw calldata under them.
 */
function actionBlock(spec: {
  key: ActionKey;
  call: Call;
  label: string;
  gesture?: string;
  fn: string;
  fields: [string, unknown][];
  gasLimit?: number;
  enabled: boolean;
  why?: string;
  onSend: () => void;
  doneWords: string;
}): HTMLElement {
  const net = S.net!;
  const tx = S.tx[spec.key];
  const busy = tx?.phase === "checking" || tx?.phase === "sent";
  const canSend = spec.enabled && !!S.wallet && !!S.account && !busy;
  const why = !S.wallet ? T("wallet.needed") : spec.why;
  const txLine: Child[] = [];
  if (tx?.phase === "checking") txLine.push(h("p", { class: "x-tx", "data-testid": `exit-${spec.key}-tx`, "data-value": "checking" }, T("tx.checking")));
  if (tx?.phase === "sent") txLine.push(h("p", { class: "x-tx", "data-testid": `exit-${spec.key}-tx`, "data-value": "sent" }, T("tx.sent", { hash: tx.hash! })));
  if (tx?.phase === "mined") {
    txLine.push(
      h(
        "p",
        { class: "x-tx", "data-testid": `exit-${spec.key}-tx`, "data-value": tx.ok ? "mined" : "reverted" },
        T("tx.sent", { hash: tx.hash! }),
        h("br"),
        T("tx.mined", { block: String(tx.block), status: T(tx.ok ? "tx.ok" : "tx.reverted") }),
      ),
    );
    if (tx.ok) txLine.push(h("p", { class: "x-done", role: "status", "data-testid": `exit-${spec.key}-done` }, spec.doneWords));
  }
  if (tx?.phase === "error") txLine.push(errorBox(tx.message, `exit-${spec.key}-error`));

  return h(
    "div",
    { class: "x-action", "data-action": spec.key },
    h(
      "div",
      { class: "x-way" },
      h("span", { class: "x-mono" }, `① ${T("way.wallet")}`),
      h(
        "button",
        { type: "button", class: "x-btn x-btn--amber", disabled: !canSend, "data-testid": `exit-${spec.key}-send`, onclick: spec.onSend },
        spec.gesture ? h("span", { class: "x-gesture", "aria-hidden": "true" }, spec.gesture) : null,
        spec.label,
      ),
      !canSend && why && !busy ? h("p", { class: "x-mono", style: "text-transform:none" }, why) : null,
      txLine,
    ),
    h(
      "div",
      { class: "x-way" },
      h("span", { class: "x-mono" }, `② ${T("way.cast")}`),
      codeBlock(castSend(spec.call, S.rpc, spec.gasLimit), `exit-${spec.key}-cast`, copyWords()),
      h("p", { class: "x-mono", style: "text-transform:none" }, T("way.castSign")),
    ),
    // The explorer's form and the raw calldata: exhaustive, so one tap away.
    h(
      "details",
      {
        class: "x-more",
        open: S.more.has(spec.key),
        ontoggle: (event: Event) => {
          if ((event.target as HTMLDetailsElement).open) S.more.add(spec.key);
          else S.more.delete(spec.key);
        },
      },
      h("summary", { "data-testid": `exit-${spec.key}-more` }, `③ ${T("way.explorer")} · ${T("way.calldata")}`),
      h(
        "div",
        { class: "x-way" },
        h("p", { class: "x-exact" }, `${spec.call.to} · ${T("way.explorerHow", { fn: spec.fn })}`),
        h(
          "dl",
          { class: "x-fields", "data-testid": `exit-${spec.key}-explorer` },
          spec.fields.map(([name, value]) => h("div", {}, h("dt", {}, name), h("dd", {}, codeBlock(explorerValue(value), `exit-${spec.key}-field-${name.split(" ")[0]}`, copyWords())))),
        ),
      ),
      h(
        "div",
        { class: "x-way" },
        h("span", { class: "x-mono" }, `${T("way.calldata")} · ${T("way.to")} ${spec.call.to} · chain ${net.chainId}`),
        codeBlock(spec.call.data, `exit-${spec.key}-calldata`, copyWords()),
      ),
    ),
  );
}

function card(num: string, title: string, gesture: string | undefined, testId: string, ...children: Child[]): HTMLElement {
  return h(
    "section",
    { class: "x-card", "data-testid": testId, "aria-labelledby": `${testId}-h` },
    h("h2", { id: `${testId}-h` }, h("span", { class: "x-num" }, num), title, gesture ? h("span", { class: "x-gesture", "aria-hidden": "true" }, gesture) : null),
    ...children,
  );
}

function fileNote(): Child {
  const serve = fileServe(location.href, SERVE_PORT);
  if (!serve) return null;
  return h(
    "section",
    { class: "x-card x-card--note", "data-testid": "exit-file-note" },
    h("p", { class: "x-say" }, T("file.title")),
    h("p", {}, T("file.body")),
    codeBlock(serve.command, "exit-file-command", copyWords()),
    h("p", { class: "x-mono" }, T("file.then")),
    codeBlock(serve.open, "exit-file-open", copyWords()),
  );
}

function netCard(): HTMLElement {
  const net = S.net;
  const walletRow: Child[] = [];
  if (S.account && S.wallet) {
    walletRow.push(h("p", { class: "x-line x-line--ok x-exact", "data-testid": "exit-wallet-account", "data-value": S.account }, T("wallet.connected", { account: `${S.account} · ${S.wallet.name}` })));
  } else if (S.wallets.length === 0) {
    walletRow.push(h("p", { class: "x-mono", style: "text-transform:none", "data-testid": "exit-wallet-none" }, T("wallet.none")));
  }
  if (!S.account) {
    walletRow.push(
      h(
        "div",
        { class: "x-wallets" },
        S.wallets.map((wallet) =>
          h(
            "button",
            { type: "button", class: "x-btn x-btn--quiet", "data-testid": "exit-wallet-connect", "data-value": wallet.name, onclick: () => void pickWallet(wallet) },
            wallet.icon ? h("img", { src: wallet.icon, alt: "" }) : null,
            T("wallet.connect", { name: wallet.name }),
          ),
        ),
      ),
    );
  }
  return card(
    "01",
    T("net.title"),
    undefined,
    "exit-net",
    field(T("net.rpc"), "rpc", "exit-rpc", { inputmode: "url" }),
    field(T("net.core"), "core", "exit-core"),
    field(T("net.forwarder"), "forwarder", "exit-forwarder"),
    h("button", { type: "button", class: "x-btn", "data-testid": "exit-read-chain", disabled: S.reading, onclick: () => void readChain() }, S.reading ? T("net.reading") : T("net.read")),
    errorBox(S.netError, "exit-net-error"),
    net
      ? h(
          "div",
          { class: "x-facts", "data-testid": "exit-net-facts", "data-chain": net.chainId },
          h("p", { class: "x-line x-line--ok x-mono" }, T("net.coreOk", { chain: net.chainId })),
          S.netWarn.map((warning) => h("p", { class: "x-line x-line--warn" }, warning)),
          h("p", { class: "x-line x-line--ok x-mono", "data-testid": "exit-time" }, T("net.time", { block: String(net.block.number), date: dateText(net.block.timestamp) })),
          h("p", { class: "x-mono", style: "text-transform:none" }, T("net.clock")),
        )
      : null,
    h("h3", {}, T("wallet.title")),
    walletRow,
    errorBox(S.walletError, "exit-wallet-error"),
  );
}

function handCard(): HTMLElement {
  const hand = S.hand;
  const net = S.net;
  const body: Child[] = [];
  if (hand && net) {
    const state = hand.stateAt(net.block.timestamp);
    const v = hand.view;
    const rows: [string, string, string][] = [
      ["raiser", v.raiser, T("field.raiser")],
      ["expiry", String(v.expiry), `${dateText(v.expiry)} · ${T("field.expiry")}`],
      ["openedAt", String(v.openedAt), v.openedAt ? `${dateText(v.openedAt)} · ${T("field.openedAt")}` : T("state.missing")],
      ["closedAt", String(v.closedAt), v.closedAt ? dateText(v.closedAt) : T("field.closedAt")],
      ["token", v.token, `${hand.token.symbol ?? "?"} · ${T("field.token")}`],
      ["payoutGasK", String(v.payoutGasK), T("field.payoutGasK")],
      ["minClaimBps", String(v.minClaimBps), `${bpsText(v.minClaimBps)} · ${T("field.minClaimBps")}`],
      ["reward", String(v.reward), `${amountText(v.reward, hand.token)} · ${T("field.reward")}`],
      ["rootKey", v.rootKey, T("field.rootKey")],
      ["dataHash", v.dataHash, T("field.dataHash")],
    ];
    if (v.closedAt !== 0) rows.push(["giveHash", hand.giveHash, T("field.giveHash", { id: String(hand.id) })]);
    body.push(
      h("p", { class: `x-state x-state--${state}`, "data-testid": "exit-hand-state", "data-value": state }, stateLine(hand, net.block.timestamp)),
      h("p", { class: "x-mono" }, T("hand.fields", { id: String(hand.id), block: String(net.block.number) })),
      h(
        "table",
        { class: "x-table" },
        h(
          "tbody",
          {},
          rows.map(([name, value, meaning]) =>
            h("tr", { "data-testid": "exit-hand-field", "data-name": name }, h("th", { scope: "row" }, name), h("td", {}, h("span", { class: "x-exact" }, value), h("span", { class: "x-mean" }, meaning))),
          ),
        ),
      ),
      h("p", { class: "x-mono" }, T("hand.yourself")),
      codeBlock(castCall(coreAddress(), HANDS_SIG, [String(hand.id)], S.rpc), "exit-hand-cast", copyWords()),
    );
  }
  return card(
    "02",
    T("hand.title"),
    "✋",
    "exit-hand",
    h(
      "div",
      { class: "x-row" },
      field(T("hand.number"), "handInput", "exit-hand-number", { inputmode: "numeric", placeholder: "12" }),
      h("button", { type: "button", class: "x-btn", "data-testid": "exit-hand-read", onclick: () => void readHandAction() }, T("hand.read")),
    ),
    errorBox(S.handError, "exit-hand-error"),
    body,
  );
}

function refundCard(): HTMLElement {
  const hand = S.hand;
  const net = S.net;
  const body: Child[] = [];
  if (!hand || !net) {
    body.push(h("p", { class: "x-mono", style: "text-transform:none" }, T("refund.pick")));
  } else {
    const state = hand.stateAt(net.block.timestamp);
    const sentence =
      state === "expired"
        ? T("refund.expired", { amount: amountText(hand.view.reward, hand.token), raiser: hand.view.raiser })
        : state === "open"
          ? T("refund.open", { date: dateText(hand.view.expiry), left: span(hand.view.expiry - net.block.timestamp) })
          : T("refund.closed");
    const done = S.tx.refund?.phase === "mined" && S.tx.refund.ok;
    body.push(h("p", { class: "x-say", "data-testid": "exit-refund-say" }, sentence));
    if (state === "expired" || state === "open" || done) {
      const call = refundCall(coreAddress(), hand.id);
      body.push(
        actionBlock({
          key: "refund",
          call,
          label: T("refund.send"),
          fn: "refund",
          fields: [["handId (uint256)", hand.id]],
          enabled: state === "expired",
          why: state === "open" ? T("core.NotExpired") : undefined,
          onSend: () => void send("refund", call, async () => void (S.hand = await readHandById(hand.id))),
          doneWords: T("refund.done"),
        }),
      );
    }
  }
  return card("03", T("refund.title"), undefined, "exit-refund", ...body);
}

function waitCard(): HTMLElement {
  const pending = S.pending;
  const body: Child[] = [];
  if (pending && S.net) {
    const to = isAddress(S.waitTo, { strict: false }) ? getAddress(S.waitTo) : pending.payee;
    const amount = amountText(pending.amount, pending.token);
    body.push(
      h(
        "p",
        { class: "x-say x-exact", "data-testid": "exit-wait-amount", "data-value": String(pending.amount) },
        T("wait.amount", { token: pending.token.address, payee: pending.payee, amount: `${amount} (${pending.amount})` }),
      ),
      codeBlock(castCall(coreAddress(), PENDING_SIG, [pending.token.address, pending.payee], S.rpc), "exit-wait-cast", copyWords()),
    );
    const done = S.tx.withdraw?.phase === "mined" && S.tx.withdraw.ok;
    if (pending.amount === 0n && !done) {
      body.push(h("p", { class: "x-mono", style: "text-transform:none" }, T("wait.nothing")));
    } else {
      const call = withdrawCall(coreAddress(), pending.token.address, pending.payee, to);
      const elsewhere = !isAddressEqual(to, pending.payee);
      body.push(
        actionBlock({
          key: "withdraw",
          call,
          label: T("wait.send"),
          fn: "withdraw",
          fields: [
            ["token (address)", pending.token.address],
            ["payee (address)", pending.payee],
            ["to (address)", to],
          ],
          enabled: pending.amount > 0n && (!elsewhere || (!!S.account && isAddressEqual(S.account, pending.payee))),
          why: elsewhere ? T("core.NotPayee") : undefined,
          onSend: () =>
            void send("withdraw", call, async () => {
              const amount = await readPending(needNet().client, coreAddress(), pending.token.address, pending.payee);
              S.pending = { ...pending, amount, block: needNet().block.number };
            }),
          doneWords: T("wait.done"),
        }),
      );
    }
  }
  const tokens = h(
    "datalist",
    { id: "exit-tokens" },
    config.tokens.map((token) => h("option", { value: token.address }, `${token.symbol} · ${token.label}`)),
  );
  return card(
    "04",
    T("wait.title"),
    undefined,
    "exit-wait",
    h("p", {}, T("wait.lead")),
    tokens,
    field(T("wait.token"), "waitToken", "exit-wait-token", { list: "exit-tokens" }),
    field(T("wait.payee"), "waitPayee", "exit-wait-payee", { placeholder: "0x…" }),
    field(T("wait.to"), "waitTo", "exit-wait-to", { placeholder: "0x…" }),
    h("button", { type: "button", class: "x-btn", "data-testid": "exit-wait-read", onclick: () => void readWaiting() }, T("wait.read")),
    errorBox(S.waitError, "exit-wait-error"),
    body,
  );
}

function thankCard(): HTMLElement {
  const thank = S.thank;
  const body: Child[] = [];
  if (thank && S.net) {
    const { hand, signedGive, opened } = thank;
    const give = signedGive.give;
    const wrapped = unwrap6492(signedGive.giverSig) !== undefined;
    const kind = wrapped ? T("thank.kind.wrapped") : isKeySignature(signedGive.giverSig) ? T("thank.kind.key") : T("thank.kind.code");
    const cost = costOf(BigInt(thank.gasLimit), config.prices);
    const rows = thank.shares.map((row) =>
      h(
        "tr",
        { class: row.role === "give" ? "x-you" : undefined, "data-testid": "exit-thank-share", "data-role": row.role, "data-amount": String(row.amount) },
        h("th", { scope: "row" }, row.role === "give" ? T("thank.giver") : T("thank.pass", { n: (row.position ?? 0) + 1 })),
        h(
          "td",
          {},
          h("span", { class: "x-exact" }, row.role === "pass" && isAddressEqual(row.payee, zeroAddress) ? T("thank.passNone") : row.payee),
          h("span", { class: "x-mean" }, bpsText(row.bps)),
        ),
        h("td", { class: "x-amount" }, amountText(row.amount, hand.token)),
      ),
    );
    body.push(
      h("p", { class: `x-state x-state--open` }, `#${hand.id} · ${stateLine(hand, S.net.block.timestamp)}`),
      h("h3", {}, T("thank.route", { reward: amountText(hand.view.reward, hand.token) })),
      h("table", { class: "x-table", "data-testid": "exit-thank-route" }, h("colgroup", {}, h("col", { style: "width:26%" }), h("col"), h("col", { style: "width:30%" })), h("tbody", {}, rows)),
      h("p", { class: "x-exact" }, T("thank.signer", { signer: give.signer, kind })),
      h(
        "div",
        { class: "x-facts" },
        h("p", { class: "x-line x-line--ok x-mono", "data-testid": "exit-thank-core" }, T(thank.checkedThroughForwarder ? "thank.coreSetup" : "thank.core", { block: String(thank.checkedAt) })),
        h(
          "p",
          { class: "x-line x-line--ok x-mono", "data-testid": "exit-thank-gas", "data-value": thank.gasLimit },
          T("thank.gas", { gas: thank.gasLimit.toLocaleString("en-US").replaceAll(",", " "), base: cost.base.usd, eth: cost.ethereum.usd, date: config.prices.date }),
        ),
      ),
    );
    const isRaiser = !!S.account && isAddressEqual(S.account, hand.view.raiser);
    if (thank.setup && !thank.deployed) {
      const call = setupCall(thank.setup);
      body.push(
        h("h3", {}, T("thank.step1")),
        h("p", {}, T("thank.step1.body")),
        actionBlock({
          key: "setup",
          call,
          label: T("thank.step1.send"),
          fn: "aggregate3",
          fields: [["calls (tuple[])", [[thank.setup.factory, false, thank.setup.factoryData]]]],
          enabled: true,
          onSend: () =>
            void send("setup", call, async () => {
              S.thank = await judgeThank(opened, hand, signedGive, thank.setup, true);
            }),
          doneWords: T("thank.step1.done"),
        }),
        h("h3", {}, T("thank.step2")),
      );
    } else if (thank.setup && S.tx.setup?.phase === "mined") {
      body.push(h("h3", {}, T("thank.step1")), h("p", { class: "x-done", "data-testid": "exit-setup-done" }, T("thank.step1.done")), h("h3", {}, T("thank.step2")));
    }
    const ready = !thank.setup || thank.deployed;
    const call = thankCall(coreAddress(), hand.id, opened.signedShakes, signedGive);
    const inner = innerGiverSig(signedGive.giverSig);
    body.push(
      actionBlock({
        key: "thank",
        call,
        label: T("thank.send"),
        gesture: "🙏",
        fn: "thank",
        gasLimit: thank.gasLimit,
        fields: [
          ["handId (uint256)", hand.id],
          ["signedShakes (tuple[])", opened.signedShakes.map(({ shake, keySig }) => [[shake.nextKey, shake.payee, shake.claimBps, shake.nextClaimBps, shake.dataHash], keySig])],
          ["signedGive (tuple)", [[give.signer, give.payee, give.claimBps, give.routeHash, give.dataHash], signedGive.keySig, inner]],
          ["dataHash (bytes32)", zeroHash],
        ],
        enabled: ready && isRaiser,
        why: !ready ? T("thank.step2.wait") : !isRaiser ? T("wallet.notRaiser", { raiser: hand.view.raiser }) : undefined,
        onSend: () => void send("thank", call, async () => void (S.hand = S.hand && S.hand.id === hand.id ? await readHandById(hand.id) : S.hand), thank.gasLimit),
        doneWords: T("thank.done"),
      }),
    );
  }
  const input = h("textarea", {
    class: "x-input",
    rows: 4,
    "data-testid": "exit-thank-input",
    "data-key": "thankInput",
    spellcheck: "false",
    autocomplete: "off",
    placeholder: "https://…/#…",
    oninput: (event: Event) => (S.thankInput = (event.target as HTMLTextAreaElement).value),
  });
  input.value = S.thankInput;
  return card(
    "05",
    T("thank.title"),
    "🙏",
    "exit-thank",
    h("p", {}, T("thank.lead")),
    h("label", { class: "x-field" }, h("span", {}, T("thank.input")), input),
    h("button", { type: "button", class: "x-btn", "data-testid": "exit-thank-open", onclick: () => void openGive() }, T("thank.open")),
    errorBox(S.thankError, "exit-thank-error"),
    body,
  );
}

function footer(): HTMLElement {
  const deployment = config.deployment;
  return h(
    "footer",
    { class: "x-foot" },
    h("p", { class: "x-mono x-exact", style: "font-size:var(--fs-mono-sm)" }, T("foot.core", { core: config.cores.canonical ?? "—", chain: `${config.chain.id} · ${config.chain.name}` })),
    deployment?.commit ? h("p", { class: "x-mono" }, T("foot.build", { commit: deployment.commit.slice(0, 12) })) : null,
    h("p", { class: "x-mono" }, T("foot.plain")),
    h("p", { class: "x-mono", style: "text-transform:none" }, T("foot.script")),
  );
}

function render(): void {
  // Keep the caret where it was: a re-render must not take a field from under the person typing.
  const active = document.activeElement as HTMLInputElement | null;
  const focusKey = active?.dataset?.key ?? active?.dataset?.testid;
  const caret = active && "selectionStart" in active ? [active.selectionStart, active.selectionEnd] : undefined;

  document.documentElement.lang = S.lang;
  const page = h(
    "div",
    { class: "x-page" },
    h(
      "header",
      { class: "x-top" },
      lockup(),
      h("button", { type: "button", class: "x-lang", "data-testid": "exit-lang", lang: S.lang === "en" ? "ru" : "en", onclick: () => ((S.lang = S.lang === "en" ? "ru" : "en"), render()) }, T("lang.other")),
    ),
    h(
      "section",
      { class: "x-hero" },
      h("p", { class: "x-mono" }, T("kicker")),
      h("h1", {}, h("span", { class: "x-swipe" }, T("title"))),
      h("p", {}, T("lead")),
      h("div", { class: "x-ways", "aria-hidden": "true" }, h("span", { class: "x-chip x-chip--amber" }, `① ${T("way.wallet")}`), h("span", { class: "x-chip" }, `② ${T("way.cast")}`), h("span", { class: "x-chip x-chip--dashed" }, `③ ${T("way.explorer")}`)),
    ),
    fileNote(),
    netCard(),
    handCard(),
    refundCard(),
    waitCard(),
    thankCard(),
    footer(),
  );
  root.replaceChildren(page);

  if (focusKey) {
    const again = root.querySelector<HTMLInputElement>(`[data-key="${focusKey}"], [data-testid="${focusKey}"]`);
    if (again) {
      again.focus();
      if (caret && "setSelectionRange" in again) {
        try {
          again.setSelectionRange(caret[0], caret[1]);
        } catch {
          // a field type without a caret
        }
      }
    }
  }
}

discoverWallets((wallets) => {
  S.wallets = wallets;
  render();
});
render();
void readChain();
setInterval(() => void tick(), POLL_MS);
