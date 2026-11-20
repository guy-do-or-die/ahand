import { t } from "../../i18n";

/** Wave 1 stub of the pass screen (UX-SPEC §8.4). Built by feat-hand, wave 4. */
export default function PassScreen() {
  return (
    <section className="mx-auto w-full max-w-[720px] px-6 py-10 md:px-10" data-screen="pass">
      <h1 className="m-0 mb-3 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{t("pass.title")}</h1>
      <p className="ah-meta">{t("common.notBuilt")}</p>
    </section>
  );
}
