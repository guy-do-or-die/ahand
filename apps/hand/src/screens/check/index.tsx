import { t } from "../../i18n";

/** Wave 1 stub of the check screen (UX-SPEC §10.2). Built by proof-pages, wave 5. */
export default function CheckScreen() {
  return (
    <section className="mx-auto w-full max-w-[720px] px-6 py-10 md:px-10" data-screen="check">
      <h1 className="m-0 mb-3 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{t("check.title")}</h1>
      <p className="ah-meta">{t("common.notBuilt")}</p>
    </section>
  );
}
