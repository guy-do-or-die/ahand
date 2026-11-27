import { lazy, Suspense, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { config, TESTNET } from "../config";
import { LANGS, setLang, t, useLang, type Lang } from "../i18n";
import { chainName } from "../i18n/common/chain";
import { shortAddress } from "../ui/format";
import { usePlace } from "../router";
import { TID } from "../testids";
import { Logo } from "../ui/Logo";
import { PersonDisc } from "../ui/PersonDisc";
import { ThemeToggle } from "../ui/ThemeToggle";
import { useWho } from "../wallet/who";
import { toggleLens, useLens } from "./lens";
import { askToEnter, showMe, useEntering, usePersonShown } from "./person";

/** The person sheet reads the chain and this device's store: it loads when first opened. */
const PersonSheet = lazy(() => import("./PersonSheet"));
const PersonEnter = lazy(() => import("./PersonSheet").then((module) => ({ default: module.PersonEnter })));

/**
 * The frame every screen is mounted in: the header (the local ribbon, then lockup,
 * EN · RU and the viewer's own button), the screen, and the footer (under the lens only, Core's address linking to /core;
 * then the two links (Do it without us, About these defaults), and the lens and the theme switch side by side).
 */

const MONO = "font-[family-name:var(--font-meta)] uppercase tracking-[var(--track-mono-sm)]";

/** The test-money ribbon: on a local stand, and on a public test network (Base Sepolia) named by its network. */
export function Ribbon() {
  if (!TESTNET) return null;
  return (
    <div
      role="note"
      data-testid={TID.shell.ribbon}
      className="bg-[var(--sunken)] px-4 py-[6px] text-center text-[length:var(--fs-body-xs)] font-medium leading-[1.3]"
      style={{ color: "var(--ink-a70)" }}
    >
      {config.chain.local ? t("common.ribbon") : t("common.ribbon.testnet", { network: chainName(config.chain) })}
    </div>
  );
}

/**
 * The language, in the header of every screen: one bubble with the language in use, which opens
 * the list of all of them, each under its own name. Two languages stood side by side as two
 * words; a third and a fourth would not fit a phone's header, and a list takes any number. The
 * list is the app's own (no browser draws it), closes on a choice, on Escape and on a press
 * anywhere else, and is walked with the arrows.
 */
function LangSwitch() {
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const items = () => Array.from(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
  useEffect(() => {
    if (!open) return;
    // Opened, the hand lands on the language in use; a press anywhere else closes the list.
    wrap.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const away = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const onKey = (event: KeyboardEvent) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      return close();
    }
    if (event.key === "Tab") return setOpen(false);
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const to = event.key === "ArrowDown" ? at + 1 : event.key === "ArrowUp" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 : undefined;
    if (to === undefined) return;
    event.preventDefault();
    list[(to + list.length) % list.length]?.focus();
  };
  return (
    <div ref={wrap} className="ah-lang" onKeyDown={onKey}>
      <button
        ref={button}
        type="button"
        className="ah-lang__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-testid={TID.shell.lang}
        data-value={lang}
        onClick={() => setOpen(!open)}
      >
        {/* Named by what it shows and then by what it is: "EN, language: English". */}
        <span>{lang}</span>
        <span className="sr-only">
          , {t("common.language")}: {t(`common.language.${lang}`)}
        </span>
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1 L5 5 L9 1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div id={id} role="menu" aria-label={t("common.language")} className="ah-lang__menu">
          {LANGS.map((code: Lang) => (
            <button
              key={code}
              type="button"
              role="menuitemradio"
              aria-checked={lang === code}
              lang={code}
              tabIndex={-1}
              data-testid={code === "en" ? TID.shell.langEn : TID.shell.langRu}
              onClick={() => {
                void setLang(code);
                close();
              }}
            >
              {t(`common.language.${code}`)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The lens switch, beside the theme switch and drawn exactly like it (ui/ThemeToggle.tsx): a bare
 * 16px ink glyph in a 44×44 box, no word, no rim, no fill, no padding, the same colour and cursor.
 * Since 2026-11-21: the lens switch is drawn like the theme switch.
 * The first build had the word "Proof" beside the glyph and an amber fill when pressed.
 *
 * No emoji (those are kept for the gestures). On and off differ by shape, not only by colour, the
 * way the theme glyph turns: off, an outline magnifier; on, the same magnifier with its lens
 * filled. With no word shown, the name carries what it does in both languages (`aria-label`),
 * `aria-pressed` says whether it is on, and the hint (a tooltip, `title`) names the `?` key that
 * flips it too.
 */
function LensToggle() {
  const on = useLens();
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={t("common.lensToggle")}
      title={t("common.lensHint")}
      aria-keyshortcuts="?"
      data-testid={TID.shell.lens}
      onClick={toggleLens}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 44,
        height: 44,
        padding: 0,
        background: "none",
        border: 0,
        cursor: "pointer",
        color: "var(--ink)",
      }}
    >
      <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="8.5" cy="8.5" r="6" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" />
        <path d="M13 13 L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/**
 * Whether this device keeps a hand passed on from it. A pass needs no account, so these are the
 * only hands that are someone's own with nobody logged in; a hand raised here belongs to the
 * account that raised it and is reached after logging in. Read from the device's store when the
 * place changes; the store's code is fetched only with no account connected, after the page is
 * drawn.
 */
function useDeviceHands(ask: boolean): boolean {
  const { path } = usePlace();
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (!ask) return;
    let live = true;
    import("../store/db")
      .then(({ all }) => all("passed"))
      .then(
        (passed) => live && setHas(passed.length > 0),
        () => undefined, // storage refused (a private window): nothing is kept here, so nothing to lead to
      );
    return () => {
      live = false;
    };
  }, [ask, path]);
  return ask && has;
}

/**
 * The viewer, in the header of every screen. With an account connected it is their mark, and it
 * opens their sheet (PersonSheet.tsx) over the page: the account and its money, the hands of this
 * device, this device's settings, the way out.
 *
 * With no account there is nobody to draw a mark for, and a head that opened a sheet of settings
 * told someone who came back to log in nothing. So the header says the way in in a word, and the
 * word opens it at once (shell/person.ts `askToEnter`), over the page it stands on. Language is
 * beside it in the header and the theme and the proof are in the footer, as on every screen. A
 * device that passed a hand on without an account gets one quiet link to its hands.
 */
function Viewer() {
  // The frame's own copy of who is connected: reading it starts no wallet code (wallet/who.ts).
  const address = useWho();
  const hands = useDeviceHands(address === undefined);
  if (address === undefined) {
    return (
      <>
        {hands ? (
          <a href="/my" className="ah-head-link" data-testid={TID.shell.myHands}>
            {t("common.word.myHands")}
          </a>
        ) : null}
        <LangSwitch />
        <button type="button" className="ah-head-login" aria-haspopup="dialog" data-testid={TID.shell.logIn} onClick={askToEnter}>
          {t("common.logIn")}
        </button>
      </>
    );
  }
  return (
    <>
      <LangSwitch />
      <button type="button" className="ah-person-btn" aria-label={t("common.person.open")} aria-haspopup="dialog" data-testid={TID.shell.personOpen} data-value={address} onClick={showMe}>
        <PersonDisc address={address} size={28} />
      </button>
    </>
  );
}

/** The open person sheet, if any: drawn once for the whole app, over whatever screen is shown. */
function PersonHost() {
  const shown = usePersonShown();
  const entering = useEntering();
  if (!shown && !entering) return null;
  return <Suspense fallback={null}>{shown ? <PersonSheet shown={shown} /> : <PersonEnter />}</Suspense>;
}

/**
 * The banner landmark: the test-money ribbon (test networks only) above the row of lockup and
 * EN · RU. The ribbon stands inside the banner so that no content sits outside a landmark.
 */
export function Header() {
  return (
    <header data-testid={TID.shell.header}>
      <Ribbon />
      {/* Under 360px the lockup, "My hands", the language and Log in do not fit one row: the row
          wraps, and the viewer's part stands under the lockup on the right, with nothing off the side. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 sm:px-6 md:px-10">
        {/* Named by its text, not by aria-label: the lockup's letters sit in separate boxes around the
            hands, so the drawn word is hidden from assistive technology and the name is given whole. */}
        <a href="/" data-testid={TID.shell.logo} className="inline-flex min-h-11 items-center text-ink no-underline">
          {/* The lockup at a size that holds its own beside a screen's headline: a step smaller on a phone, where the header's row is short. */}
          <span aria-hidden="true" className="inline-flex sm:hidden">
            <Logo size={24} />
          </span>
          <span aria-hidden="true" className="hidden sm:inline-flex">
            <Logo size={28} />
          </span>
          <span className="sr-only">{t("common.home")}</span>
        </a>
        <div className="ml-auto flex items-center gap-2">
          <Viewer />
        </div>
      </div>
    </header>
  );
}

/**
 * The footer's one mono line, under the lens only: "Core 0x0f05…9685", a quiet link to /core. The
 * address keeps its case (mono is exact data; the style sets the rest in capitals).
 *
 * The first build's line was "Unaudited · Core {core} · No owner · No fee" (the calm view without
 * the address). Since 2026-11-21: the footer drops "Unaudited", "No owner" and
 * "No fee" from both views, and only Core's address stays, under the lens. The warning is not lost: /core says
 * "Unaudited" in full (`core.unaudited`) and in its accepted limits.
 */
function CoreLine({ core }: { core: string }) {
  const MARK = "\u0000";
  const [before = "", after = ""] = t("common.lens.core", { core: MARK }).split(MARK);
  return (
    <span className="whitespace-nowrap">
      {before}
      <span className="normal-case">{shortAddress(core)}</span>
      {after}
    </span>
  );
}

export function Footer() {
  const core = config.cores.canonical ?? config.cores.trusted.find((c) => c.chainId === config.chain.id)!.core;
  const link = "inline-flex min-h-11 items-center text-[color:var(--ink-a70)] underline decoration-[color:var(--ink-a30)] decoration-dashed decoration-[1.5px] underline-offset-[5px] hover:text-ink";
  // Core's line is the lens's alone: off the lens the footer is the two links and the two switches.
  // It stands beside the switches, in room the footer already has, so turning the lens on and off
  // moves nothing: in one row with them on a wide screen, and under them on a narrow one, where
  // its place is kept while the lens is off.
  const lens = useLens();
  return (
    <footer data-testid={TID.shell.footer} className="mt-10 border-t border-solid border-[color:var(--ink-a10)] px-4 pb-6 pt-4 sm:px-6 md:px-10">
      <div className="flex items-start gap-x-5">
        <nav aria-label={t("common.footer.nav")} className="flex flex-1 flex-wrap gap-x-5 text-[length:var(--fs-body-sm)]">
          <a href="/without-us" data-testid={TID.shell.footerWithoutUs} className={link}>
            {t("common.footer.withoutUs")}
          </a>
          <a href="/defaults" data-testid={TID.shell.footerDefaults} className={link}>
            {t("common.footer.defaults")}
          </a>
        </nav>
        <span className="flex shrink-0 flex-col items-end lg:flex-row lg:items-center lg:gap-x-4">
          <span className="flex items-center gap-1 lg:order-2">
            <LensToggle />
            <span data-testid={TID.shell.theme}>
              <ThemeToggle />
            </span>
          </span>
          {lens ? (
            <a
              href="/core"
              data-testid={TID.shell.footerCore}
              className={`${MONO} inline-flex min-h-11 items-center text-[length:var(--fs-mono-sm)] leading-[1.6] text-[color:var(--ink-a60)] no-underline hover:text-ink lg:order-1`}
            >
              <CoreLine core={core} />
            </a>
          ) : (
            <span aria-hidden="true" className="block h-11 lg:hidden" />
          )}
        </span>
      </div>
    </footer>
  );
}

function Loading() {
  return (
    <p role="status" className={`${MONO} m-0 px-6 py-12 text-[length:var(--fs-mono-sm)] text-[color:var(--ink-quiet)] md:px-10`}>
      {t("common.loading")}
    </p>
  );
}

/** The page: the header (with the ribbon in it), the screen inside its error boundary, footer. */
export function Shell({ path, children }: { path: string; children: ReactNode }) {
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    // After a move (not on the first load), bring a screen reader to the new screen.
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.focus({ preventScroll: true });
  }, [path]);

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <button
        type="button"
        onClick={() => main.current?.focus()}
        className="absolute left-2 top-2 z-50 -translate-y-24 rounded-[var(--r-control)] border-[1.5px] border-solid border-ink bg-card min-h-[44px] px-3 py-2 text-[length:var(--fs-body-sm)] text-ink focus:translate-y-0"
      >
        {t("common.skip")}
      </button>
      <Header />
      <main ref={main} id="main" tabIndex={-1} data-testid={TID.shell.main} className="flex-1 outline-none">
        <Suspense fallback={<Loading />}>{children}</Suspense>
      </main>
      <Footer />
      <PersonHost />
    </div>
  );
}
