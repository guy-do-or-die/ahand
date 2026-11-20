import { getHandFor, handLogsAt, receiptOf, type OpenedAddress, type ReceiptRow } from "@ahand/sdk";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { erc20Abi, isAddressEqual, type Address } from "viem";

import { CLIENTS, clientOf, useHand, useNow } from "../../chain";
import { config } from "../../config";
import { t } from "../../i18n";
import { usePlace } from "../../router";
import { rememberText, useOpened } from "../../store/memory";
import { TID } from "../../testids";
import { CopyRow, DealCard, Disclose, ErrorBand, Qr, QuietButton, ReceiptTable, SwipeButton, qrOf, type QrCode } from "../../ui";
import { CODE_MM, DPI_FOR_THREE_DOTS, MIN_MODULE_MM, moduleMm, offered, type Format } from "./fit";
import { NotPrintable, openHeldLink, passportAddress, printableOf, receiptOfSearch, type Printable } from "./link";

/**
 * /print (UX-SPEC §11, §3 item 3; D-44). The link this tab holds is re-encoded bare, with
 * everything inside, in digits, and the code's real version decides what is offered: the
 * 85 × 55 mm tag and the A6 card each only when their code keeps a module of at least 0.40 mm
 * (fit.ts). Otherwise: "Too dense to print small. Show it on a screen."
 *
 * `/print?receipt=<chain>/<hand>` prints a closed Hand's receipt instead: the table from Core's
 * events, a code leading to the passport, and the command that checks it from a clone.
 *
 * The page prints through design/print.css: only the chosen sheet, in ink on white, on a page of
 * its own size. Nothing here stores, logs or sends the link.
 */

const CORE: Address = config.cores.canonical ?? config.cores.trusted[0]!.core;
const LINK_OPTIONS = config.cores.canonical ? { canonicalCore: config.cores.canonical } : {};
const getHand = getHandFor(CLIENTS, config.cores.trusted);
const RPC = config.chain.rpcUrls[0] ?? "$RPC";

type Prepared = { status: "checking" } | { status: "ready"; opened: OpenedAddress; printable: Printable; code: QrCode } | { status: "failed"; id: string };

function decimalsOf(token: Address | undefined): number | undefined {
  return token ? config.tokens.find((item) => isAddressEqual(item.address, token))?.decimals : undefined;
}

/** The token's decimals, from the build's list or the token itself. */
function useDecimals(token: Address | undefined): number | undefined {
  const known = decimalsOf(token);
  const [read, setRead] = useState<{ token?: Address; decimals?: number }>({});
  useEffect(() => {
    if (!token || known !== undefined) return;
    let live = true;
    clientOf(config.chain.id)
      .readContract({ address: token, abi: erc20Abi, functionName: "decimals" })
      .then((decimals) => live && setRead({ token, decimals }), () => undefined);
    return () => {
      live = false;
    };
  }, [token, known]);
  return known ?? (read.token === token ? read.decimals : undefined);
}

export default function PrintScreen() {
  const place = usePlace();
  const receipt = receiptOfSearch(place.search ?? "");
  if (receipt) return <ReceiptPrint chainId={receipt.chainId} handId={receipt.handId} />;
  return <LinkPrint />;
}

/* ──────────────────────────────────────────────────── a link on paper */

function LinkPrint() {
  const held = useOpened();
  const [prepared, setPrepared] = useState<Prepared>({ status: "checking" });
  const key = held ? `${held.before}#${held.fragment}` : undefined;

  useEffect(() => {
    if (!held) return;
    let live = true;
    setPrepared({ status: "checking" });
    (async (): Promise<Prepared> => {
      const opened = await openHeldLink(held, getHand, LINK_OPTIONS);
      const printable = await printableOf(opened, config.site, LINK_OPTIONS);
      return { status: "ready", opened, printable, code: qrOf(printable.address, 40) };
    })().then(
      (next) => live && setPrepared(next),
      (error: unknown) => live && setPrepared({ status: "failed", id: error instanceof NotPrintable ? "print.notLive" : failureId(error) }),
    );
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- `key` carries the held link

  return (
    <Frame>
      <Head title={t("print.title")} lead={t("print.lead")} />
      {!held ? <Paste /> : prepared.status === "checking" ? <p className="ah-label m-0">{t("print.checking")}</p> : prepared.status === "failed" ? <ErrorBand what={t(prepared.id)} /> : <Sheets ready={prepared} />}
    </Frame>
  );
}

/** A LinkError's or the network's sentence (UX-SPEC §12); anything else is said as unknown. */
function failureId(error: unknown): string {
  const named = error as { name?: string; code?: string };
  if (named?.name === "LinkError" && named.code) return `link.${named.code}`;
  if (named?.name === "UntrustedCore") return "link.untrusted";
  return "common.time.offline";
}

function Paste() {
  const [text, setText] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <p className="ah-label m-0">{t("print.none")}</p>
      <div className="ah-field">
        <label htmlFor="print-paste" className="ah-field__label">
          {t("print.paste.label")}
        </label>
        <textarea id="print-paste" data-testid={TID.print.paste} className="ah-input" rows={3} value={text} onChange={(event) => setText(event.target.value)} />
      </div>
      <QuietButton className="self-start" data-testid={TID.print.open} disabled={text.trim() === ""} onClick={() => rememberText(text, "paste")}>
        {t("print.paste.open")}
      </QuietButton>
      <p className="ah-label ah-label--dim m-0">{t("print.paste.memory")}</p>
    </div>
  );
}

function Sheets({ ready }: { ready: Extract<Prepared, { status: "ready" }> }) {
  const { opened, printable, code } = ready;
  const formats = offered(code.version === undefined ? undefined : code.side);
  const [format, setFormat] = useState<Format | undefined>(formats[0]);
  const chosen = format && formats.includes(format) ? format : formats[0];
  const now = useNow();
  const read = useHand(opened.head.core, opened.hand.handId, opened.head.chainId);
  const view = read.data?.view;
  const decimals = useDecimals(view?.token);
  const digits = printable.address.length - printable.address.indexOf("#") - 1;

  return (
    <div className="flex flex-col gap-5">
      {formats.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="ah-field__label">{t("print.format")}</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("print.format")}>
            {formats.map((item) => (
              <button key={item} type="button" role="radio" aria-checked={item === chosen} data-value={item} className={`ah-chip${item === chosen ? " ah-chip--selected" : ""}`} onClick={() => setFormat(item)}>
                {t(`print.format.${item}`)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {!formats.includes("tag") ? (
        <div className="flex flex-col gap-3" data-testid={TID.print.tooDense} data-version={code.version ?? ""}>
          <p className="m-0 text-[length:var(--fs-body-lg)] font-semibold">{t("print.tooDense")}</p>
          {formats.length === 0 ? (
            <div className="flex flex-col gap-2">
              <span className="ah-field__label">{t("print.onScreen")}</span>
              <Qr value={printable.address} />
            </div>
          ) : null}
        </div>
      ) : null}

      {chosen === "tag" ? (
        <Sheet format="tag" testId={TID.print.tag} version={code.version!}>
          <div className="ah-print-tag">
            <Code code={code} format="tag" />
            <div className="ah-print-tag__words">
              <p className="ah-print-tag__found">{t("print.tag.found")}</p>
              <p className="ah-print-tag__free">{t("print.tag.free")}</p>
              <span className="ah-print-tag__mark">aHand · HAND {opened.hand.handId.toString()}</span>
            </div>
          </div>
        </Sheet>
      ) : null}

      {chosen === "card" ? (
        <Sheet format="card" testId={TID.print.card} version={code.version!}>
          <div className="ah-print-card">
            {view && decimals !== undefined ? (
              <DealCard
                state={now && read.data?.state !== "missing" ? read.data?.state : undefined}
                description={printable.description.status === "attached" && printable.description.title !== undefined ? { status: "attached", title: printable.description.title, ...(printable.description.content ? { content: printable.description.content } : {}) } : { status: printable.description.status === "lost" ? "lost" : "none" }}
                reward={view.reward}
                decimals={decimals}
                expiry={view.expiry}
                claimBps={opened.end.claimBps}
                raiser={view.raiser}
                handId={opened.hand.handId}
              />
            ) : null}
            <div className="ah-print-card__code">
              <Code code={code} format="card" />
              <p className="ah-print-card__scan">{t("print.card.scan")}</p>
            </div>
          </div>
        </Sheet>
      ) : null}

      {chosen ? (
        <div className="flex flex-col gap-2">
          <SwipeButton gesture="raise" data-testid={TID.print.go} onClick={() => window.print()}>
            {t("print.go")}
          </SwipeButton>
          <p className="ah-label m-0">{t("print.inkOnly")}</p>
          <p className="ah-label ah-label--dim m-0">{t("print.secret")}</p>
        </div>
      ) : null}

      <Disclose label={t("print.how")}>
        <span className="ah-meta ah-meta--exact">
          {code.version !== undefined
            ? t("print.lens.code", { version: String(code.version), modules: String(code.modules), digits: String(digits), shakes: String(printable.shakes) })
            : `QR > v40 · ${digits} digits`}
        </span>
        <span className="ah-meta ah-meta--exact">{t("print.lens.rule", { min: MIN_MODULE_MM.toFixed(3), dpi: String(DPI_FOR_THREE_DOTS) })}</span>
        {code.version !== undefined ? (
          <>
            <span className="ah-meta ah-meta--exact">{t("print.lens.tag", { modules: String(code.modules), mm: moduleMm(code.side, CODE_MM.tag).toFixed(3) })}</span>
            <span className="ah-meta ah-meta--exact">{t("print.lens.card", { modules: String(code.modules), mm: moduleMm(code.side, CODE_MM.card).toFixed(3) })}</span>
          </>
        ) : null}
      </Disclose>
    </div>
  );
}

/** The code at its printed size: a plain SVG in millimetres, ink modules on white. */
function Code({ code, format, label }: { code: QrCode; format: Format | "receipt"; label?: string }) {
  const mm = format === "receipt" ? 40 : CODE_MM[format];
  return (
    <svg className="ah-print-code" viewBox={`0 0 ${code.side} ${code.side}`} style={{ width: `${mm}mm`, height: `${mm}mm` }} role="img" aria-label={label ?? `QR v${code.version}`} shapeRendering="crispEdges">
      <rect width={code.side} height={code.side} className="ah-print-code__ground" />
      <path d={code.path} className="ah-print-code__ink" />
    </svg>
  );
}

/** One sheet: what print.css prints alone, on a page of its own size, ink on white in every theme. */
function Sheet({ format, testId, version, children }: { format: Format | "receipt"; testId: string; version?: number; children: ReactNode }) {
  return (
    <div className="ah-print-frame">
      <div className={`ah-print-sheet ah-print-sheet--${format}`} data-theme="light" data-print-target="" data-format={format} data-testid={testId} {...(version !== undefined ? { "data-version": version } : {})}>
        {children}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────── the receipt */

function ReceiptPrint({ chainId, handId }: { chainId: number; handId: bigint }) {
  const known = chainId === config.chain.id;
  const read = useHand(known ? CORE : undefined, known ? handId : undefined);
  const view = read.data?.view;
  const state = read.data?.state;
  const decimals = useDecimals(view?.token);
  const [rows, setRows] = useState<ReceiptRow[]>();
  const closedAt = view?.closedAt ?? 0;

  useEffect(() => {
    if (!known || closedAt === 0) return;
    let live = true;
    handLogsAt(clientOf(chainId), CORE, handId, closedAt).then(
      (logs) => live && setRows(receiptOf(logs).rows),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [known, chainId, handId, closedAt]);

  const passport = passportAddress(config.site, chainId, CORE, handId, config.cores.canonical ?? undefined);
  const code = useMemo(() => qrOf(passport, 40), [passport]);
  const verify = `bun tools/ahand.ts verify --rpc ${RPC} --core ${CORE} ${handId}`;

  return (
    <Frame>
      <Head title={t("print.receipt.title")} lead={t("print.receipt.lead")} />
      {!known ? (
        <ErrorBand what={t("print.receipt.unknown")} />
      ) : !view || decimals === undefined ? (
        <p className="ah-label m-0">{read.error ? t("common.time.offline") : t("print.checking")}</p>
      ) : state !== "thanked" && state !== "refunded" ? (
        <p className="ah-label m-0">{state === "missing" ? t("core.NotRaised") : t("print.receipt.open")}</p>
      ) : (
        <>
          <Sheet format="receipt" testId={TID.print.receipt}>
            <div className="ah-print-receipt">
              <p className="ah-print-receipt__head">
                aHand · HAND {handId.toString()} · CHAIN {chainId}
              </p>
              {rows ? <ReceiptTable rows={rows} decimals={decimals} /> : <p className="ah-label m-0">{t("print.checking")}</p>}
              <div className="ah-print-receipt__foot">
                <Code code={code} format="receipt" label={passport} />
                <div className="flex min-w-0 flex-col gap-2">
                  <p className="m-0 font-semibold">{t("print.receipt.scan")}</p>
                  <p className="ah-meta ah-meta--exact m-0 break-all normal-case">{passport}</p>
                  <p className="ah-label m-0">{t("print.receipt.verify")}</p>
                  <p className="ah-meta ah-meta--exact m-0 break-all normal-case" data-testid={TID.print.verify}>
                    {verify}
                  </p>
                </div>
              </div>
            </div>
          </Sheet>
          <CopyRow value={verify} />
          <SwipeButton gesture="raise" data-testid={TID.print.go} onClick={() => window.print()}>
            {t("print.go")}
          </SwipeButton>
          <p className="ah-label m-0">{t("print.inkOnly")}</p>
        </>
      )}
    </Frame>
  );
}

/* ──────────────────────────────────────────────────── frame */

function Head({ title, lead }: { title: string; lead: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="ah-meta">{t("print.kicker")}</span>
      <h1 className="m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{title}</h1>
      <p className="ah-label m-0">{lead}</p>
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 py-10 md:px-10" data-screen="print">
      {children}
    </section>
  );
}
