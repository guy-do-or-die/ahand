import { Link } from "@tanstack/react-router";
import { Logo } from "./Logo";
import { AccountButton } from "./AccountButton";
import { t } from "../i18n";

/** The protocol docs — the honest long-form answer to "how it works". */
const DOCS_URL = "https://github.com/guy-do-or-die/ahand/tree/main/docs";

/**
 * The one app header — logo (home) left with navigation, account slot right. Rendered once
 * at the root so every screen shares an identical shell.
 */
export function AppHeader() {
  return (
    <header className="flex items-center justify-between px-6 py-4 lg:px-10 lg:py-[18px] border-b border-(--ink-a08)">
      <div className="flex items-center gap-5 lg:gap-8">
        <Link to="/" aria-label={t("Back home")} className="flex items-center">
          <Logo size={32} />
        </Link>
        <nav className="flex items-center gap-5 lg:gap-[26px]">
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="hidden sm:flex items-center min-h-11"
            style={{ fontFamily: "var(--font-meta)", fontSize: "var(--fs-mono-lg)" }}
          >
            {t("how it works")}
          </a>
          <Link to="/hands" className="flex items-center min-h-11" style={{ fontFamily: "var(--font-meta)", fontSize: "var(--fs-mono-lg)" }}>
            {t("open hands")}
          </Link>
        </nav>
      </div>
      <AccountButton />
    </header>
  );
}
