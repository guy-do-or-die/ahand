import { Fragment, Suspense, useEffect, useRef, type ReactNode } from "react";

import { config, TESTNET } from "../config";
import { LANGS, setLang, t, useLang, type Lang } from "../i18n";
import { chainName } from "../i18n/common/chain";
import { shortAddress } from "../ui/format";
import { TID } from "../testids";
import { Logo } from "../ui/Logo";
import { ThemeToggle } from "../ui/ThemeToggle";
import { toggleLens, useLens } from "./lens";

/**
 * The frame every screen is mounted in (UX-SPEC §6): the header (the local ribbon, then lockup,
 * EN · RU, the lens), the screen, and the footer (the mono line to /core, the three honest
 * links, the theme switch).
 */

const MONO = "font-[family-name:var(--font-meta)] uppercase tracking-[var(--track-mono-sm)]";

/** The test-money ribbon: on a local stand, and on a public test network (Base Sepolia) named by its network. */
export function Ribbon() {
  if (!TESTNET) return null;
  return (
    <div
      role="note"
      data-testid={TID.shell.ribbon}
      className={`${MONO} bg-amber px-4 py-[5px] text-center text-[length:var(--fs-mono-sm)] font-medium`}
      style={{ color: "var(--on-amber)" }}
    >
      {config.chain.local ? t("common.ribbon") : t("common.ribbon.testnet", { network: chainName(config.chain) })}
    </div>
  );
}

function LangSwitch() {
  const lang = useLang();
  return (
    <div role="group" aria-label={t("common.language")} className={`${MONO} flex items-center text-[length:var(--fs-mono-lg)]`}>
      {LANGS.map((code: Lang, i) => (
        <span key={code} className="flex items-center">
          {i > 0 ? (
            <span aria-hidden="true" className="px-0.5 text-ink/40">
              ·
            </span>
          ) : null}
          <button
            type="button"
            lang={code}
            aria-label={`${code.toUpperCase()} — ${t(`common.language.${code}`)}`}
            aria-pressed={lang === code}
            data-testid={code === "en" ? TID.shell.langEn : TID.shell.langRu}
            onClick={() => void setLang(code)}
            className={`min-h-11 min-w-11 cursor-pointer border-0 bg-transparent p-0 font-[inherit] uppercase tracking-[inherit] ${
              lang === code ? "font-medium text-ink underline decoration-[1.5px] underline-offset-[5px]" : "text-ink/70"
            }`}
          >
            {code}
          </button>
        </span>
      ))}
    </div>
  );
}

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
      className={`ml-1 flex size-11 cursor-pointer items-center justify-center rounded-[var(--r-control)] border-[1.5px] border-solid p-0 text-[20px] leading-none ${
        on ? "border-ink bg-amber" : "border-transparent bg-transparent"
      }`}
    >
      <span aria-hidden="true" style={{ fontFamily: "var(--emoji)" }}>
        🔍
      </span>
    </button>
  );
}

/**
 * The banner landmark: the test-money ribbon (test networks only) above the row of lockup, EN · RU and
 * the lens. The ribbon stands inside the banner so that no content sits outside a landmark.
 */
export function Header() {
  return (
    <header data-testid={TID.shell.header}>
      <Ribbon />
      <div className="flex items-center justify-between gap-3 px-4 py-2 sm:px-6 md:px-10">
        {/* Named by its text, not by aria-label: the lockup's letters sit in separate boxes around the
            hands, so the drawn word is hidden from assistive technology and the name is given whole. */}
        <a href="/" data-testid={TID.shell.logo} className="inline-flex min-h-11 items-center text-ink no-underline">
          <span aria-hidden="true" className="inline-flex">
            <Logo size={22} />
          </span>
          <span className="sr-only">{t("common.home")}</span>
        </a>
        <div className="flex items-center gap-1">
          <LangSwitch />
          <LensToggle />
        </div>
      </div>
    </header>
  );
}

/**
 * The footer's mono line. Each "·"-separated part stays on one line, and the Core address keeps
 * its case (mono is exact data; the style sets the rest in capitals).
 */
function CoreLine({ core }: { core: string }) {
  const MARK = "\u0000";
  return (
    <>
      {t("common.footer", { core: MARK })
        .split(" · ")
        .map((part, i) => {
          const [before = "", after] = part.split(MARK);
          return (
            <Fragment key={i}>
              {i > 0 ? " · " : ""}
              <span className="whitespace-nowrap">
              {before}
              {after === undefined ? null : (
                <>
                  <span className="normal-case">{shortAddress(core)}</span>
                  {after}
                </>
              )}
              </span>
            </Fragment>
          );
        })}
    </>
  );
}

export function Footer() {
  const core = config.cores.canonical ?? config.cores.trusted.find((c) => c.chainId === config.chain.id)!.core;
  const link = "inline-flex min-h-11 items-center text-ink/70 underline decoration-ink/30 decoration-dashed decoration-[1.5px] underline-offset-[5px] hover:text-ink";
  return (
    <footer data-testid={TID.shell.footer} className="mt-10 border-t border-solid border-ink/10 px-4 pb-6 pt-4 sm:px-6 md:px-10">
      <a
        href="/core"
        data-testid={TID.shell.footerCore}
        className={`${MONO} inline-flex min-h-11 items-center text-[length:var(--fs-mono-sm)] leading-[1.6] text-ink/60 no-underline hover:text-ink`}
      >
        <span>
          <CoreLine core={core} />
        </span>
      </a>
      <div className="flex items-center gap-x-5">
        <nav aria-label={t("common.footer.nav")} className="flex flex-1 flex-wrap gap-x-5 text-[length:var(--fs-body-sm)]">
          <a href="/limits" data-testid={TID.shell.footerLimits} className={link}>
            {t("common.footer.limits")}
          </a>
          <a href="/without-us" data-testid={TID.shell.footerWithoutUs} className={link}>
            {t("common.footer.withoutUs")}
          </a>
          <a href="/defaults" data-testid={TID.shell.footerDefaults} className={link}>
            {t("common.footer.defaults")}
          </a>
        </nav>
        <span data-testid={TID.shell.theme} className="shrink-0 self-start">
          <ThemeToggle />
        </span>
      </div>
    </footer>
  );
}

function Loading() {
  return (
    <p role="status" className={`${MONO} m-0 px-6 py-12 text-[length:var(--fs-mono-sm)] text-ink/55 md:px-10`}>
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
    </div>
  );
}
