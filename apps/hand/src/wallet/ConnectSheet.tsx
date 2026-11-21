import { useEffect, useState, useSyncExternalStore } from "react";
import type { Address } from "viem";

import { config as app } from "../config";
import { t } from "../i18n";
import { chainName } from "../i18n/common/chain";
import { TID } from "../testids";
import { ErrorBand, Identity, Proof, QuietButton, Sheet } from "../ui";
import { clsx } from "../lib/clsx";
import { privyPhase, watchPrivyPhase } from "./privy";
import { connectWallet, disconnectWallet, foundOptions, optionAddress, useWallet, useWalletOptions, type WalletOption } from "./state";
import { useWalletWords } from "./words";

/**
 * "Connect a wallet" (ARCHITECTURE §7 Wallets, D-29). It lists the wallets this browser announced
 * (EIP-6963), each with the name and icon it gave itself, or, when none announced, the page's own
 * `window.ethereum` as "The crypto app in this browser" (a phone app's built-in browser): an icon only as a `data:` image shown
 * through <img>, and nothing ever read from its `rdns`; the sheet says that these names are the
 * apps' own. In a local build the dev wallet's test accounts follow, under their own heading.
 *
 * When the configuration has `privy`, "Continue with email" comes first, for someone with no
 * crypto app (wallet/privy.ts). While Privy's own window is open the sheet steps aside (its modal
 * <dialog> would make Privy's window unreachable) and comes back if the person closes it or
 * Privy cannot be reached, with a sentence that says so; the browser's wallets stay offered.
 *
 * Test ids: the button that opens the sheet is `connect-wallet`, each dev account
 * `dev-account-<n>` / `dev-account-not-set-up` (tests/e2e/lib/accounts.ts); each found wallet
 * `kit-connect-option` with its connector id in `data-value`; email `connect-email`.
 */

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
  /** Called once an account is connected; the sheet closes itself after it. */
  onConnected?: (address: Address) => void;
}

export function ConnectSheet({ onClose, onConnected }: ConnectSheetProps) {
  const words = useWalletWords();
  const options = useWalletOptions();
  const wallet = useWallet();
  const [busy, setBusy] = useState<WalletOption | undefined>();
  const [problem, setProblem] = useState<"refused" | "failed" | "unknown-network" | "unavailable" | undefined>();
  const phase = useSyncExternalStore(watchPrivyPhase, privyPhase, privyPhase);
  const found = foundOptions(options);
  const dev = options.filter((o) => o.kind === "dev");
  const email = options.find((o) => o.kind === "email");

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

  // Privy's window is on screen: the sheet's modal dialog would sit above it and block it.
  if (busy?.kind === "email" && phase === "open") return null;

  return (
    <Sheet label={email ? words.logIn : words.title} onClose={onClose}>
      <div data-testid={TID.kit.connectSheet} className="flex flex-col gap-5 pt-4">
        <h2 className="m-0 text-[length:var(--fs-title-m-sm)] font-extrabold leading-[1.06] tracking-[-0.03em]">{email ? words.logIn : words.title}.</h2>

        {email ? (
          <section className="flex flex-col gap-3" aria-labelledby="connect-email">
            <span id="connect-email" className="ah-label">
              {words.email.heading}
            </span>
            <button
              type="button"
              data-testid={TID.wallet.email}
              data-value={email.id}
              disabled={busy !== undefined}
              onClick={() => void pick(email)}
              className={clsx(
                "flex min-h-[64px] w-full items-center gap-3 rounded-[var(--r-card-sm)] border-[length:var(--bw-emph)] border-[var(--ink)] bg-[var(--card)] px-4 py-3 text-left text-[var(--ink)]",
                "hover:border-[var(--ink-a50)] focus-visible:border-[var(--ink)] disabled:opacity-50",
              )}
            >
              <Initial name={words.email.action} mark="@" />
              <span className="text-[length:var(--fs-card-title-sm)] font-bold leading-tight">{words.email.action}</span>
            </button>
            {/* Who keeps the key is for those who check; the calm view says what will happen. */}
            <p className="ah-label ah-label--dim m-0">
              <Proof calm={words.email.calm}>{words.email.note}</Proof>
            </p>
          </section>
        ) : null}

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
            <p className="m-0 text-[length:var(--fs-body-md)] leading-snug">{email ? words.email.none : words.none}</p>
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

        {busy?.kind === "email" ? (
          <p role="status" className="ah-label m-0">
            {words.email.opening}
          </p>
        ) : busy ? (
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
                  ? words.email.unavailable
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
 * The connect control a screen puts where a wallet is needed: "Connect a wallet", or the connected
 * address with "Disconnect" and "Use another account" (the same sheet, never a second "Connect a
 * wallet" beside a connected one). It opens the sheet itself; both states keep the `connect-wallet` id.
 */
export function ConnectButton({ className, onConnected }: { className?: string; onConnected?: (address: Address) => void }) {
  const words = useWalletWords();
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  return (
    <div className={clsx("flex flex-wrap items-center gap-3", className)}>
      {wallet.status === "connected" && wallet.address ? (
        <>
          <span className="ah-label flex flex-wrap items-baseline gap-2" data-testid={TID.wallet.connected} data-value={wallet.address}>
            {words.connected}: <Identity address={wallet.address} own />
          </span>
          <QuietButton compact variant="text" onClick={() => void disconnectWallet()}>
            {words.disconnect}
          </QuietButton>
          <QuietButton compact variant="text" data-testid={CONNECT_TID} onClick={() => setOpen(true)}>
            {words.another}
          </QuietButton>
        </>
      ) : (
        // Where email is offered, someone with no crypto app should still see a way in: "Log in".
        <QuietButton compact data-testid={CONNECT_TID} onClick={() => setOpen(true)} aria-label={app.privy ? words.logIn : words.title}>
          {app.privy ? words.logIn : words.title}
        </QuietButton>
      )}
      {open ? <ConnectSheet onClose={() => setOpen(false)} {...(onConnected ? { onConnected } : {})} /> : null}
    </div>
  );
}
