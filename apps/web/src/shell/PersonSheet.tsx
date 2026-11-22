import { useRef, type ReactNode } from "react";
import { erc20Abi, isAddressEqual, type Address } from "viem";

import { CANONICAL_CORE, clientOf, useBlockRead, usePending } from "../chain";
import { config, TESTNET } from "../config";
import { LANGS, setLang, t, useLang, type Lang } from "../i18n";
import { chainName } from "../i18n/common/chain";
import { navigate } from "../router";
import { useMyHands, usePassed } from "../screens/my/hooks";
import { TID } from "../testids";
import { CopyRow, QuietButton, Sheet, ThemeToggle, money } from "../ui";
import { PersonDisc } from "../ui/PersonDisc";
import { ConnectSheet, disconnectWallet, useWallet, useWalletWords } from "../wallet";
import { askToEnter, doneEntering } from "./person";
import { Faucets, OnExplorer } from "./OnExplorer";
import { toggleLens, useLens } from "./lens";
import { hidePerson, type PersonShown } from "./person";

/**
 * The sheet of a person: the viewer's own, opened from the header at any time, or anyone else's,
 * opened from their name. One frame for both, so what the site can say about a person stands in
 * one place whoever it is: who they are, then what belongs to them. For someone else that is
 * only the address today; for the viewer it is also the money at that address and what waits for
 * them in the contract, the hands this device raised and passed on, this device's settings, and
 * the way out of the account.
 *
 * It is a layer over the page (ui/Sheet), never a place: opening and closing it moves nothing, so
 * the link this tab holds and a half-written form stay where they were. A row that leads to a
 * screen (the list of hands, what waits) closes the sheet and goes there.
 *
 * Sections that have nothing behind them yet are not drawn: notifications, and what others have
 * said about a person (the signals contract), each get a section here when they exist.
 */
export default function PersonSheet({ shown }: { shown: PersonShown }) {
  const wallet = useWallet();
  useLang();
  const own = wallet.status === "connected" ? wallet.address : undefined;
  const me = shown.who === "me" || (own !== undefined && isAddressEqual(own, shown.address));
  return (
    <Sheet label={t(me ? "common.person.sheet.me" : "common.person.sheet.other")} onClose={hidePerson}>
      <div className="ah-person" data-testid={TID.shell.person} data-who={me ? "me" : "other"}>
        {me ? <Me address={own} /> : shown.who === "other" ? <Other address={shown.address} name={shown.name} role={shown.role} /> : null}
      </div>
    </Sheet>
  );
}

/** Go to a screen from the sheet: the sheet closes first, so the screen is not left under a layer. */
function go(path: string): void {
  hidePerson();
  navigate(path);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ah-person__section">
      <h3 className="ah-person__title">{title}</h3>
      {children}
    </section>
  );
}

/** A row that leads somewhere: what it is on the left, its figure or its arrow on the right. */
function RowLink({ to, label, value, testId }: { to: string; label: string; value?: string | undefined; testId?: string }) {
  return (
    <a
      href={to}
      className="ah-person__row ah-person__row--link"
      data-testid={testId}
      onClick={(event) => {
        event.preventDefault();
        go(to);
      }}
    >
      <span>{label}</span>
      <span className="ah-person__value">
        {value}
        <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden="true">
          <path d="M1 1 L7 7 L1 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </a>
  );
}

function Head({ address, title, sub }: { address?: Address | undefined; title: string; sub?: ReactNode }) {
  return (
    <div className="ah-person__head">
      <PersonDisc address={address} size={52} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="ah-person__name">{title}</h2>
        {sub}
      </div>
    </div>
  );
}

// ── The viewer ───────────────────────────────────────────────────────────

function Me({ address }: { address: Address | undefined }) {
  const wallet = useWallet();
  const words = useWalletWords();
  const viaPrivy = config.privy !== undefined;
  return (
    <>
      <Head
        address={address}
        title={t("common.person.me")}
        sub={<span className="ah-label">{address ? (wallet.privy ? words.privy.loggedIn : words.connected) : t("common.person.loggedOut")}</span>}
      />
      {address ? (
        <div data-testid={TID.shell.personAddress}>
          <CopyRow value={address} />
        </div>
      ) : (
        // The way in opens over the page, not over this sheet (shell/person.ts `askToEnter`).
        <QuietButton data-testid={TID.shell.personLogIn} onClick={askToEnter} className="self-start">
          {viaPrivy ? words.logIn : words.title}
        </QuietButton>
      )}

      {address ? <Money address={address} /> : null}
      <Hands />
      <Settings />

      {address ? (
        <QuietButton
          variant="text"
          data-testid={TID.shell.personLogOut}
          className="self-start"
          onClick={() => {
            void disconnectWallet();
            hidePerson();
          }}
        >
          {wallet.privy ? words.privy.logOut : words.disconnect}
        </QuietButton>
      ) : null}
    </>
  );
}

/** The token every screen of this build counts in (the raise screen picks it the same way). */
const TOKEN = config.tokens.find((token) => token.kind === "usdc") ?? config.tokens.find((token) => token.kind === "usd") ?? config.tokens[0];

/**
 * The money at the viewer's address, read from the token itself on every block, and what the
 * contract holds for them (`pending`: a thank-you that could not be delivered at once), which
 * leads to the screen that takes it. Nothing is claimed while the network can't be read.
 */
function Money({ address }: { address: Address }) {
  const lang = useLang();
  const lens = useLens();
  const held = useBlockRead(TOKEN ? `person:${config.chain.id}:${TOKEN.address}:${address}` : undefined, async () => {
    const client = clientOf(config.chain.id);
    const [amount, decimals] = await Promise.all([
      client.readContract({ address: TOKEN!.address, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
      client.readContract({ address: TOKEN!.address, abi: erc20Abi, functionName: "decimals" }),
    ]);
    return { amount, decimals };
  });
  const waiting = usePending(CANONICAL_CORE, TOKEN?.address, address);
  if (!TOKEN) return null;
  const decimals = held.data?.decimals;
  return (
    <Section title={t("common.person.money")}>
      <p className="ah-person__sum" data-testid={TID.shell.personBalance} data-value={held.data?.amount.toString() ?? ""}>
        {held.data ? money(held.data.amount, held.data.decimals, lang, { cents: true }) : held.error ? "—" : "…"}
      </p>
      <p className="ah-label m-0">
        {held.error && !held.data ? t("common.person.money.unread") : t(TESTNET ? "common.person.money.test" : "common.person.money.real", { network: chainName(config.chain), symbol: TOKEN.symbol })}
      </p>
      {lens ? <p className="ah-meta ah-meta--exact m-0 break-all">{`${TOKEN.symbol} ${TOKEN.address}.balanceOf(${address})${held.data ? ` = ${held.data.amount.toString()}` : ""}`}</p> : null}
      {waiting.data !== undefined && waiting.data > 0n && decimals !== undefined ? (
        <RowLink to="/waiting" label={t("common.word.waitingForYou")} value={money(waiting.data, decimals, lang, { cents: true })} testId={TID.shell.personWaiting} />
      ) : null}
      <Faucets />
    </Section>
  );
}

/** What this device knows of the viewer's hands: it is the device's list, with or without an account. */
function Hands() {
  const raised = useMyHands();
  const passed = usePassed();
  const count = (loaded: { status: string; value?: unknown[] }) => (loaded.status === "ok" && loaded.value ? String(loaded.value.length) : undefined);
  return (
    <Section title={t("common.person.hands")}>
      <RowLink to="/my" label={t("common.person.hands.raised")} value={count(raised)} testId={TID.shell.personHands} />
      {passed.status === "ok" && passed.value.length > 0 ? <RowLink to="/my" label={t("common.person.hands.passed")} value={count(passed)} /> : null}
      <RowLink to="/raise" label={t("common.word.raise")} testId={TID.shell.personRaise} />
    </Section>
  );
}

/** This device's settings: the same three switches the page's edges carry, here with their names. */
function Settings() {
  const lang = useLang();
  const lens = useLens();
  return (
    <Section title={t("common.person.settings")}>
      <div className="ah-person__row">
        <span id="person-language">{t("common.language")}</span>
        <span role="group" aria-labelledby="person-language" className="ah-person__choice">
          {LANGS.map((code: Lang) => (
            <button key={code} type="button" lang={code} aria-pressed={lang === code} onClick={() => void setLang(code)}>
              {t(`common.language.${code}`)}
            </button>
          ))}
        </span>
      </div>
      <div className="ah-person__row">
        <span>{t("common.person.settings.theme")}</span>
        <ThemeToggle label />
      </div>
      <div className="ah-person__row">
        <span id="person-lens">{t("common.lensToggle")}</span>
        <button type="button" role="switch" aria-checked={lens} aria-labelledby="person-lens" className="ah-switch" data-testid={TID.shell.personLens} onClick={toggleLens}>
          <span aria-hidden="true" />
        </button>
      </div>
      <RowLink to="/defaults" label={t("common.footer.defaults")} />
    </Section>
  );
}

// ── Someone else ─────────────────────────────────────────────────────────

/**
 * Anyone but the viewer. The site knows a person by their address and by nothing else, and says
 * so; a name stands only when the caller proved it (ENS both ways). The address is
 * what this sheet is about, so it stands whole in both views, with the chain's own page for it.
 */
function Other({ address, name, role }: { address: Address; name?: string | undefined; role?: "asker" | "onRoute" | undefined }) {
  return (
    <>
      <Head address={address} title={name ?? t("common.person.other")} sub={role ? <span className="ah-label">{t(`common.person.role.${role}`)}</span> : undefined} />
      <Section title={t("common.person.address")}>
        <div data-testid={TID.shell.personAddress}>
          <CopyRow value={address} />
        </div>
        <OnExplorer address={address} />
        <p className="ah-label m-0">{t("common.person.onlyAddress")}</p>
      </Section>
    </>
  );
}

/**
 * The way in asked for from the viewer's sheet, drawn by the shell over the page itself: Privy's
 * window in a build that logs in through Privy, the app's own "Connect a wallet" otherwise. Once
 * someone is in, the viewer's sheet opens again, now with the account.
 */
export function PersonEnter() {
  const connected = useRef(false);
  return (
    <ConnectSheet
      onConnected={() => {
        connected.current = true;
      }}
      onClose={() => doneEntering(connected.current)}
    />
  );
}
