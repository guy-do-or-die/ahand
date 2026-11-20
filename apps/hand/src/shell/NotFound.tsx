import { t } from "../i18n";
import { TID } from "../testids";

/** The screen for a path no route takes. It names no path back (the path could be anything). */
export function NotFound() {
  return (
    <section data-screen="not-found" data-testid={TID.shell.notFound} className="mx-auto w-full max-w-[680px] px-6 py-12 md:px-10">
      <h1 className="m-0 mb-3 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">
        {t("common.notFound.title")}
      </h1>
      <p className="m-0 mb-6 max-w-[52ch] text-[length:var(--fs-body-lg)] leading-[1.5]">{t("common.notFound.body")}</p>
      <a href="/" className="ah-quiet no-underline" data-testid={TID.shell.notFoundHome}>
        {t("common.notFound.home")}
      </a>
    </section>
  );
}
