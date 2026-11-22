import { Component, type ReactNode } from "react";

import { t } from "../i18n";
import { TID } from "../testids";

/**
 * Catches a screen that throws while drawing. It shows one sentence and a way to try again:
 * never the error's message, a stack, or anything the error carried (it could hold a link).
 * Nothing is logged; main.tsx also silences React's own reporting of caught errors.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section role="alert" data-testid={TID.shell.crash} className="mx-auto w-full max-w-[680px] px-6 py-12 md:px-10">
        <h1 className="m-0 mb-3 text-[length:var(--fs-title-m-sm)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">
          {t("common.crash.title")}
        </h1>
        <p className="m-0 mb-6 text-[length:var(--fs-body-lg)] leading-[1.5]">{t("common.crash.body")}</p>
        <button type="button" className="ah-quiet" data-testid={TID.shell.crashRetry} onClick={() => this.setState({ failed: false })}>
          {t("common.crash.retry")}
        </button>
      </section>
    );
  }
}
