import { config } from "../../config";
import { t, useLang } from "../../i18n";
import { TID } from "../../testids";
import { chainName } from "../../i18n/common/chain";

/**
 * "Do it without us" (UX-SPEC §11): the three exits for thank, send back and take out, said before
 * they are needed. exit.html (one file, saved from here), one command over contracts/exit/ahand.sh,
 * and a block explorer's form field by field. The Core's address and the network close the page.
 */

const H2 = "m-0 text-[length:var(--fs-card-title-lg)] font-extrabold leading-[1.1] tracking-[-0.02em]";

function Command({ lines, testId }: { lines: string[]; testId?: string }) {
  return (
    <pre
      data-testid={testId}
      className="m-0 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-[var(--r-control-lg)] border border-[color:var(--ink-a20)] bg-[color:var(--ink-a035)] p-3 font-mono text-[length:var(--fs-mono-md)] leading-[1.55]"
    >
      {lines.join("\n")}
    </pre>
  );
}

function Form({ fn, say, fields }: { fn: string; say: string; fields: [string, string][] }) {
  return (
    <div className="flex flex-col gap-2 border-t-[1.5px] border-[color:var(--ink)] pt-3">
      <p className="m-0 font-mono text-[length:var(--fs-mono-lg)] font-medium">{fn}</p>
      <p className="ah-label m-0">{say}</p>
      <dl className="m-0 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1">
        {fields.map(([name, meaning]) => (
          <div key={name} className="contents">
            <dt className="font-mono text-[length:var(--fs-mono-md)] break-all">{name}</dt>
            <dd className="ah-label m-0">{meaning}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function WithoutUsScreen() {
  useLang(); // re-render on a language switch
  const core = config.cores.canonical ?? config.cores.trusted[0]?.core ?? "";
  const rpc = config.chain.rpcUrls[0] ?? "https://…";
  const env = `RPC=${rpc} CORE=${core}`;
  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col gap-[var(--gap-section)] px-6 py-10 md:px-10" data-screen="without-us">
      <header className="flex flex-col gap-3">
        <h1 className="m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{t("without-us.title")}</h1>
        <p className="m-0 text-[length:var(--fs-body-lg)]">{t("without-us.lead")}</p>
      </header>

      <article className="ah-card flex flex-col gap-3 p-5" data-testid={TID.about.exitFile}>
        <h2 className={H2}>{t("without-us.file.title")}</h2>
        <p className="m-0">{t("without-us.file.body")}</p>
        <a
          href="/exit.html"
          download="ahand-exit.html"
          data-testid={TID.about.download}
          className="inline-flex min-h-[48px] items-center justify-center self-start rounded-[var(--r-btn)] border-[1.5px] border-[color:var(--ink)] bg-[color:var(--amber)] px-5 font-bold text-[color:var(--on-amber)] no-underline"
        >
          {t("without-us.file.download")}
        </a>
        <p className="ah-meta m-0">exit.html · {t("without-us.file.size")}</p>
      </article>

      <article className="ah-card flex flex-col gap-3 p-5">
        <h2 className={H2}>{t("without-us.command.title")}</h2>
        <p className="m-0">{t("without-us.command.body")}</p>
        <Command
          testId={TID.about.command}
          lines={[
            `${env} bash contracts/exit/ahand.sh status 12`,
            `${env} bash contracts/exit/ahand.sh refund 12 -- --ledger`,
            `${env} bash contracts/exit/ahand.sh pending <token> <payee>`,
            `${env} bash contracts/exit/ahand.sh withdraw <token> <payee> -- --ledger`,
          ]}
        />
        <p className="m-0">{t("without-us.command.thank")}</p>
        <Command
          lines={[`bun tools/ahand.ts thank-calldata '<give address>' --rpc ${rpc} --out thank.hex`, `${env} bash contracts/exit/ahand.sh thank thank.hex -- --ledger`]}
        />
      </article>

      <article className="ah-card flex flex-col gap-4 p-5" data-testid={TID.about.explorer}>
        <h2 className={H2}>{t("without-us.explorer.title")}</h2>
        <p className="m-0">{t("without-us.explorer.body")}</p>
        <Form fn="refund" say={t("without-us.explorer.refund")} fields={[["handId (uint256)", t("without-us.explorer.handId")]]} />
        <Form
          fn="withdraw"
          say={t("without-us.explorer.withdraw")}
          fields={[
            ["token (address)", t("without-us.explorer.token")],
            ["payee (address)", t("without-us.explorer.payee")],
            ["to (address)", t("without-us.explorer.to")],
          ]}
        />
        <Form
          fn="thank"
          say={t("without-us.explorer.thank")}
          fields={[
            ["handId (uint256)", t("without-us.explorer.handId")],
            ["signedShakes (tuple[])", t("without-us.explorer.shakes")],
            ["signedGive (tuple)", t("without-us.explorer.give")],
            ["dataHash (bytes32)", t("without-us.explorer.dataHash")],
          ]}
        />
      </article>

      <footer className="flex flex-col gap-1 border-t-[1.5px] border-[color:var(--ink)] pt-3" data-testid={TID.about.core}>
        <p className="ah-label m-0">{t("without-us.core")}</p>
        <p className="ah-meta ah-meta--ink ah-meta--exact m-0 text-[length:var(--fs-mono-lg)]">{core}</p>
        <p className="ah-meta m-0">{t("without-us.chain", { chain: config.chain.id, name: chainName(config.chain) })}</p>
      </footer>
    </section>
  );
}
