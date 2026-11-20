import { useState } from "react";

import { config } from "./config";
import { LANGS, i18n, setLang, t, type Lang } from "./i18n";
import { truncateAddress } from "./lib/format";
import LandingScreen from "./screens/landing";
import { Logo } from "./ui/Logo";

/**
 * Wave 1 frame: the lockup, the language switch, the landing stub and the footer line, so the
 * build, the configuration and the catalogues are proven end to end. The shell (router, lens,
 * ribbon, error boundary) replaces it in wave 2 (app-shell).
 */
export function App() {
  const [lang, setLangState] = useState<Lang>(i18n.locale as Lang);
  const choose = (next: Lang) => {
    setLang(next);
    setLangState(next);
  };
  const core = config.cores.canonical ?? config.cores.trusted[0]!.core;

  return (
    <div className="flex min-h-dvh flex-col" lang={lang}>
      {config.chain.local ? (
        <div className="ah-meta bg-amber px-6 py-1 text-center" style={{ color: "var(--on-amber)" }}>{t("common.ribbon")}</div>
      ) : null}
      <header className="flex items-center justify-between px-6 py-4 md:px-10">
        <Logo size={26} />
        <nav aria-label={t("common.language")} className="ah-meta flex gap-2">
          {LANGS.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => choose(code)}
              aria-pressed={lang === code}
              className={`cursor-pointer border-0 bg-transparent p-1 font-[inherit] uppercase tracking-[inherit] ${lang === code ? "text-ink" : "text-ink/50"}`}
            >
              {code}
            </button>
          ))}
        </nav>
      </header>
      <main className="flex-1">
        <LandingScreen />
      </main>
      <footer className="ah-meta px-6 py-6 md:px-10">{t("common.footer", { core: truncateAddress(core) })}</footer>
    </div>
  );
}
