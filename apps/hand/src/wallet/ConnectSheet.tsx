import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Address } from "viem";

import { config as app } from "../config";
import { t } from "../i18n";
import { chainName } from "../i18n/common/chain";
import { TID } from "../testids";
import { ErrorBand, Identity, QuietButton, Sheet } from "../ui";
import { clsx } from "../lib/clsx";
import { PRIVY } from "./config";
import { privyPhase, watchPrivyPhase } from "./privy";
import { cameBackFromSocial } from "./privy-mark";
import { connectWallet, disconnectWallet, foundOptions, logIn, optionAddress, useWallet, useWalletOptions, type ConnectOutcome, type WalletOption } from "./state";
import { useWalletWords } from "./words";

/**
 * The way in (ARCHITECTURE §7 Wallets, D-29).
 *
 * A build whose configuration has `privy` has one way in: Privy's own window, opened directly by
 * "Log in" («Войти») or by an action that needs an account, with email, social accounts, a passkey
 * and crypto wallets all in it (wallet/privy.ts). Nothing of the app's own comes before it: while
 * Privy's code loads (the first time on this page) a status line says "Opening log in…", and while
 * Privy's window is open the app shows nothing. If Privy cannot be reached, the app's own sheet
 * comes instead, saying so, with the wallets this browser announced.
 *
 * Without `privy` (the local stand) the app's own sheet is the way in: "Connect a wallet" lists the
 * wallets this browser announced (EIP-6963), each with the name and icon it gave itself, or, when
 * none announced, the page's own `window.ethereum` as "The crypto app in this browser" (a phone
 * app's built-in browser): an icon only as a `data:` image shown through <img>, and nothing ever
 * read from its `rdns`; the sheet says that these names are the apps' own. In a local build the
 * dev wallet's test accounts follow, under their own heading.
 *
 * Test ids: the button that opens the way in is `connect-wallet`, each dev account
 * `dev-account-<n>` / `dev-account-not-set-up` (tests/e2e/lib/accounts.ts); each found wallet
 * `kit-connect-option` with its connector id in `data-value`; Privy's status line `privy-status`.
 */

/** This build logs in through Privy. */
const VIA_PRIVY = PRIVY && app.privy !== undefined;

export const CONNECT_TID = TID.wallet.connect;
export const devAccountTid = (who: number | "not-set-up") => `${TID.wallet.devAccount}-${who}`;

function Initial({ name, mark }: { name: string; mark?: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-control)] border-[length:var(--bw-emph)] border-[var(--ink)] font-extrabold"
    >
      {mark ?? (name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

function Option({ option, address, busy, onPick }: { option: WalletOption; address?: Address; busy: boolean; onPick: () => void }) {
  const words = useWalletWords();
  const dev = option.kind === "dev";
  const title = dev ? (option.devWho === "not-set-up" ? words.dev.unset : words.dev.account(option.devWho as number)) : option.fallback ? words.browser : option.name;
  const testId = dev ? devAccountTid(option.devWho!) : TID.kit.connectOption;
  return (
    <li>
      <button
        type="button"
        data-testid={testId}
        data-value={option.id}
        disabled={busy}
        onClick={onPick}
        className={clsx(
          "flex min-h-[64px] w-full items-center gap-3 rounded-[var(--r-card-sm)] border-[length:var(--bw-emph)] border-[var(--ink-a20)] bg-[var(--card)] px-4 py-3 text-left text-[var(--ink)]",
          "hover:border-[var(--ink-a50)] focus-visible:border-[var(--ink)] disabled:opacity-50",
        )}
      >
        {option.icon ? <img src={option.icon} alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-[var(--r-control)]" /> : <Initial name={title} {...(dev ? { mark: option.devWho === "not-set-up" ? "6" : String(option.devWho) } : {})} />}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[length:var(--fs-card-title-sm)] font-bold leading-tight">{title}</span>
          {address ? <Identity address={address} own /> : null}
          {dev && option.devRole === "entropy" ? <span className="ah-tag self-start">{words.dev.entropyTag}</span> : null}
          {dev && option.devRole === "unset" ? (
            <>
              <span className="flex flex-wrap gap-1">
                <span className="ah-tag">{words.dev.unsetTag}</span>
                <span className="ah-tag">{words.dev.wrappedTag}</span>
              </span>
              <span className="ah-meta ah-meta--dim">{words.dev.unsetKey}</span>
            </>
          ) : null}
        </span>
      </button>
    </li>
  );
}

export interface ConnectSheetProps {
  onClose: () => void;
  /** Called once an account is connected; the way in closes itself after it. */
  onConnected?: (address: Address) => void;
}

/** The way in, opened: Privy's window directly in a build with `privy`, else the app's own sheet. */
export function ConnectSheet(props: ConnectSheetProps) {
  return VIA_PRIVY ? <PrivyLogin {...props} /> : <WalletSheet {...props} />;
}

/**
 * Privy's window, opened on mount. Closed without logging in: `onClose`, nothing more. Privy
 * unreachable: the app's own sheet, saying so, with the browser's wallets. Privy reached but the
 * login did not finish: one line with "Try again", which opens Privy's window again (no sheet of
 * the app's own, and no way in beside Privy's).
 */
function PrivyLogin({ onClose, onConnected }: ConnectSheetProps) {
  const [problem, setProblem] = useState<Exclude<ConnectOutcome, { ok: true }>["reason"] | undefined>();
  const [attempt, setAttempt] = useState(0);
  const started = useRef(-1);
  const latest = useRef({ onClose, onConnected });
  latest.current = { onClose, onConnected };
  useEffect(() => {
    // Once per attempt: React's development double run of effects keeps the ref.
    if (started.current === attempt) return;
    started.current = attempt;
    void logIn().then((outcome) => {
      if (outcome.ok) {
        latest.current.onConnected?.(outcome.address);
        latest.current.onClose();
      } else if (outcome.reason === "refused") latest.current.onClose();
      else setProblem(outcome.reason);
    });
  }, [attempt]);
  if (problem === "unavailable") return <WalletSheet onClose={onClose} {...(onConnected ? { onConnected } : {})} problem={problem} />;
  if (problem) {
    return (
      <PrivyFailed
        onRetry={() => {
          setProblem(undefined);
          setAttempt((n) => n + 1);
        }}
        onClose={onClose}
      />
    );
  }
  return <PrivyStatus />;
}

/** Logging in did not finish (Privy answered with an error, or no wallet came): a line, "Try again" and "Close". */
function PrivyFailed({ onRetry, onClose }: { onRetry: () => void; onClose: () => void }) {
  const words = useWalletWords();
  return (
    <div
      role="alert"
      data-testid={TID.wallet.privyStatus}
      data-value="failed"
      className="fixed bottom-6 left-1/2 z-50 flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-3 rounded-[var(--r-card-sm)] border-[length:var(--bw-emph)] border-[var(--ink)] bg-[var(--card)] px-4 py-3 text-[var(--ink)]"
    >
      <p className="m-0 text-[length:var(--fs-body-md)] leading-snug">{words.privy.failed}</p>
      <span className="flex flex-wrap gap-3">
        <QuietButton compact onClick={onRetry}>
          {words.privy.retry}
        </QuietButton>
        <QuietButton compact variant="text" onClick={onClose}>
          {words.privy.close}
        </QuietButton>
      </span>
    </div>
  );
}

/** "Opening log in…" while Privy's code loads or the wallet is fetched: a line, not a sheet. Nothing while Privy's window is open. */
export function PrivyStatus() {
  const words = useWalletWords();
  const phase = useSyncExternalStore(watchPrivyPhase, privyPhase, privyPhase);
  if (phase !== "loading") return null;
  return (
    <p
      role="status"
      data-testid={TID.wallet.privyStatus}
      className="ah-label fixed bottom-6 left-1/2 z-50 m-0 -translate-x-1/2 rounded-[var(--r-control)] border-[length:var(--bw-emph)] border-[var(--ink)] bg-[var(--card)] px-4 py-2 text-[var(--ink)]"
    >
      {words.privy.opening}
    </p>
  );
}

type Problem = "refused" | "failed" | "unknown-network" | "unavailable";

/** The app's own sheet: the browser's wallets, and in a local build the dev accounts. Never Privy: it is reached directly. */
function WalletSheet({ onClose, onConnected, problem: initial }: ConnectSheetProps & { problem?: Problem }) {
  const words = useWalletWords();
  const options = useWalletOptions();
  const wallet = useWallet();
  const [busy, setBusy] = useState<WalletOption | undefined>();
  const [problem, setProblem] = useState<Problem | undefined>(initial);
  const found = foundOptions(options);
  const dev = options.filter((o) => o.kind === "dev");

  async function pick(option: WalletOption) {
    setBusy(option);
    setProblem(undefined);
    const outcome = await connectWallet(option.id);
    setBusy(undefined);
    if (!outcome.ok) {
      setProblem(outcome.reason);
      return;
    }
    onConnected?.(outcome.address);
    onClose();
  }

  return (
    <Sheet label={words.title} onClose={onClose}>
      <div data-testid={TID.kit.connectSheet} className="flex flex-col gap-5 pt-4">
        <h2 className="m-0 text-[length:var(--fs-title-m-sm)] font-extrabold leading-[1.06] tracking-[-0.03em]">{words.title}.</h2>

        <section className="flex flex-col gap-3" aria-labelledby="connect-found">
          <span id="connect-found" className="ah-label">
            {words.found}
          </span>
          {found.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {found.map((option) => (
                <Option key={option.id} option={option} busy={busy !== undefined} onPick={() => void pick(option)} />
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[length:var(--fs-body-md)] leading-snug">{words.none}</p>
          )}
          {found.length > 0 ? <p className="ah-label ah-label--dim m-0">{words.selfNamed}</p> : null}
        </section>

        {dev.length > 0 ? (
          <section className="flex flex-col gap-3" aria-labelledby="connect-dev">
            <span id="connect-dev" className="ah-meta">
              {words.dev.heading}
            </span>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {dev.map((option) => (
                <DevOption key={option.id} option={option} busy={busy !== undefined} onPick={() => void pick(option)} />
              ))}
            </ul>
          </section>
        ) : null}

        {busy ? (
          <p role="status" className="ah-label m-0">
            {words.waiting(busy.kind === "dev" ? (busy.devWho === "not-set-up" ? words.dev.unset : words.dev.account(busy.devWho as number)) : busy.fallback ? words.browser : busy.name)}
          </p>
        ) : null}
        {problem ? (
          <ErrorBand
            what={
              problem === "refused"
                ? words.refused
                : problem === "unavailable"
                  ? words.privy.unavailable
                  : problem === "unknown-network"
                    ? t("common.error.unknownNetwork", { network: chainName(app.chain) })
                    : words.failed
            }
          />
        ) : null}
        {wallet.status === "connected" && wallet.address ? (
          <p className="ah-label m-0 flex flex-wrap items-baseline gap-2">
            {words.connected}: <Identity address={wallet.address} own />
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

/** A dev account's row, with its address read from the dev wallet itself (the factory's, for "not set up yet"). */
function DevOption({ option, busy, onPick }: { option: WalletOption; busy: boolean; onPick: () => void }) {
  const [address, setAddress] = useState<Address | undefined>();
  useEffect(() => {
    let live = true;
    optionAddress(option.id).then(
      (found) => {
        if (live && found) setAddress(found);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [option]);
  return <Option option={option} {...(address ? { address } : {})} busy={busy} onPick={onPick} />;
}

/**
 * The connect control a screen puts where an account is needed.
 *
 * With Privy: "Log in", which opens Privy's window directly; once in, the person's own short
 * address with "Log out" (Privy's logout). Without: "Connect a wallet", or the connected address
 * with "Disconnect" and "Use another account" (the same sheet, never a second "Connect a wallet"
 * beside a connected one). It opens the way in itself; both states keep the `connect-wallet` id.
 */
export function ConnectButton({ className, onConnected }: { className?: string; onConnected?: (address: Address) => void }) {
  const words = useWalletWords();
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const connected = wallet.status === "connected" && wallet.address;
  return (
    <div className={clsx("flex flex-wrap items-center gap-3", className)}>
      {connected && wallet.address ? (
        <>
          <span className="ah-label flex flex-wrap items-baseline gap-2" data-testid={TID.wallet.connected} data-value={wallet.address}>
            {wallet.privy ? words.privy.loggedIn : words.connected}: <Identity address={wallet.address} own />
          </span>
          <QuietButton compact variant="text" onClick={() => void disconnectWallet()}>
            {wallet.privy ? words.privy.logOut : words.disconnect}
          </QuietButton>
          {/* With Privy, another account is "Log out", then "Log in": one window, not a second way in. */}
          {VIA_PRIVY ? null : (
            <QuietButton compact variant="text" data-testid={CONNECT_TID} onClick={() => setOpen(true)}>
              {words.another}
            </QuietButton>
          )}
        </>
      ) : (
        <QuietButton compact data-testid={CONNECT_TID} disabled={open && VIA_PRIVY} onClick={() => setOpen(true)} aria-label={VIA_PRIVY ? words.logIn : words.title}>
          {VIA_PRIVY ? words.logIn : words.title}
        </QuietButton>
      )}
      {open ? <ConnectSheet onClose={() => setOpen(false)} {...(onConnected ? { onConnected } : {})} /> : null}
    </div>
  );
}

/**
 * On a screen that needs an opened link and has none: after a social login (Google, Apple, X) the
 * page was loaded afresh, which forgets a link (D-39), so the person is told to open it once more.
 * The link is normally carried across that reload (link-carry.ts, question 11), so this shows only
 * where that failed: storage refused, the trip took longer than `CARRY_MS`, or the way back landed
 * on another path. Nothing at any other time.
 */
export function LinkAgain({ className }: { className?: string }) {
  const words = useWalletWords();
  const wallet = useWallet();
  if (!VIA_PRIVY || !cameBackFromSocial || !wallet.privy || wallet.status !== "connected") return null;
  return (
    <p className={clsx("ah-note m-0", className)} data-testid={TID.wallet.linkAgain}>
      {words.privy.linkAgain}
    </p>
  );
}
