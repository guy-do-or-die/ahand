import { approveCall, unwrap6492 } from "@ahand/sdk";
import { useMemo, useState, type ReactNode } from "react";
import type { Hex, TypedDataDefinition } from "viem";

import { config } from "../../config";
import { useChainStatus, useNow } from "../../chain";
import { intlLocale, t, useLang } from "../../i18n";
import { deviceClock } from "../../store/db";
import { TID } from "../../testids";
import { ErrorBand, Identity, QuietButton, TxRail, type TxReached } from "../../ui";
import { ConnectButton, useSend, useTypedSigner, useWallet, type SendResult, type TypedAnswer } from "../../wallet";
import { sayNoNext, willSayNo } from "../../wallet/dev";

/**
 * /dev/wallet (local builds only): the wallet layer on one page, for people and for the wallet
 * smoke. Connect a test account, ask it for the same typed message twice (equal for a key,
 * different for account 5, ERC-6492-wrapped for "not set up yet"), see the network's clock beside
 * this device's (the stand runs 40 days ahead), and send a test approve through `useSend` with the
 * four states. The device's clock is read through `store/db.ts deviceClock()`, labelled as such.
 */

const DAY = 86_400;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t-[length:var(--bw-emph)] border-[var(--ink)] pt-4">
      <h2 className="ah-meta ah-meta--ink m-0">{title}</h2>
      {children}
    </section>
  );
}

function stamp(seconds: number, lang: "en" | "ru"): string {
  return new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeStyle: "medium" }).format(new Date(seconds * 1000));
}

function Clocks() {
  const lang = useLang();
  const now = useNow();
  const { offline } = useChainStatus();
  // Read on every render; a new block re-renders this, so both clocks move together.
  const device = Math.floor(deviceClock() / 1000);
  const gap = now ? now.timestamp - device : undefined;
  return (
    <Section title={t("dev-wallet.time.heading")}>
      <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1" data-testid={TID.devWallet.networkTime} data-value={now ? String(now.timestamp) : ""} data-block={now ? String(now.number) : ""} data-rpc={config.chain.rpcUrls[0]}>
          <dt className="ah-meta">{t("dev-wallet.time.network")}</dt>
          <dd className="m-0 text-[length:var(--fs-body-lg)] font-bold tabular-nums">{now ? stamp(now.timestamp, lang) : "—"}</dd>
          <dd className="ah-meta ah-meta--exact m-0">{now ? `${t("dev-wallet.time.block", { block: now.number.toString() })} · ${now.timestamp}` : ""}</dd>
        </div>
        <div className="flex flex-col gap-1" data-testid={TID.devWallet.deviceTime} data-value={String(device)}>
          <dt className="ah-meta">{t("dev-wallet.time.device")}</dt>
          <dd className="m-0 text-[length:var(--fs-body-lg)] font-bold tabular-nums">{stamp(device, lang)}</dd>
          <dd className="ah-meta ah-meta--exact m-0">{device}</dd>
        </div>
      </dl>
      {gap !== undefined ? (
        <p className="ah-label m-0" data-testid={TID.devWallet.ahead} data-value={String(gap)}>
          {t(gap >= 0 ? "dev-wallet.time.ahead" : "dev-wallet.time.behind", { days: new Intl.NumberFormat(intlLocale(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(gap) / DAY) })}
        </p>
      ) : (
        <p className="ah-label m-0">{t("dev-wallet.time.waiting")}</p>
      )}
      {offline ? <p className="ah-label m-0">{t("dev-wallet.time.offline")}</p> : now?.stale ? <p className="ah-label m-0">{t("dev-wallet.time.stale")}</p> : null}
      <p className="ah-label ah-label--dim m-0">{t("dev-wallet.time.why")}</p>
    </Section>
  );
}

type Asked = { ok: true; answers: [TypedAnswer, TypedAnswer] } | { ok: false; reason: "rejected" | "failed" | "no-wallet"; message?: string };

function Sign() {
  const wallet = useWallet();
  const signer = useTypedSigner();
  const [asked, setAsked] = useState<Asked | undefined>();
  const core = config.cores.canonical ?? config.cores.trusted[0]!.core;
  // One fixed message per account, so the two answers are to exactly the same thing.
  const typedData = useMemo<TypedDataDefinition>(
    () => ({
      domain: { name: "aHand dev wallet", version: "1", chainId: config.chain.id, verifyingContract: core },
      types: { Sample: [{ name: "text", type: "string" }, { name: "account", type: "address" }, { name: "n", type: "uint256" }] },
      primaryType: "Sample",
      message: { text: "The same message, asked twice.", account: wallet.address ?? "0x0000000000000000000000000000000000000000", n: 1n },
    }),
    [core, wallet.address],
  );

  async function ask() {
    setAsked(undefined);
    const first = await signer.sign(typedData);
    if (!first.ok) return setAsked(first);
    const second = await signer.sign(typedData);
    if (!second.ok) return setAsked(second);
    setAsked({ ok: true, answers: [first, second] });
  }

  const same = asked?.ok ? asked.answers[0].signature === asked.answers[1].signature : undefined;
  const wrapped = asked?.ok ? unwrap6492(asked.answers[0].signature) : undefined;
  return (
    <Section title={t("dev-wallet.sign.heading")}>
      <span hidden data-testid={TID.devWallet.sample} data-core={core} data-chain={String(config.chain.id)} />
      <QuietButton compact data-testid={TID.devWallet.sign} disabled={wallet.status !== "connected" || signer.asking} onClick={() => void ask()} className="self-start">
        {signer.asking ? t("dev-wallet.sign.asking") : t("dev-wallet.sign.go")}
      </QuietButton>
      {asked?.ok ? (
        <div className="flex flex-col gap-2">
          {asked.answers.map((answer, index) => (
            <div key={index} className="flex flex-col gap-1">
              <span className="ah-meta">{t(index === 0 ? "dev-wallet.sign.first" : "dev-wallet.sign.second")}</span>
              <code data-testid={TID.devWallet.signature} data-index={index + 1} data-value={answer.signature} className="ah-meta ah-meta--exact break-all normal-case">
                {answer.signature.length > 200 ? `${answer.signature.slice(0, 98)}…${answer.signature.slice(-98)}` : answer.signature}
              </code>
            </div>
          ))}
          <p className="ah-label m-0 font-bold" data-testid={TID.devWallet.verdict} data-value={same ? "same" : "different"}>
            {t(same ? "dev-wallet.sign.same" : "dev-wallet.sign.different")}
          </p>
          <p className="ah-meta ah-meta--exact m-0 break-all" data-testid={TID.devWallet.wrapped} data-value={wrapped ? "true" : "false"}>
            {wrapped ? t("dev-wallet.sign.wrapped", { factory: wrapped.factory }) : t("dev-wallet.sign.plain")}
          </p>
          <p className="ah-meta m-0">{t("dev-wallet.sign.kind", { kind: asked.answers[0].kind })}</p>
        </div>
      ) : null}
      {asked && !asked.ok ? (
        <ErrorBand what={asked.reason === "rejected" ? t("dev-wallet.sign.refused") : t("dev-wallet.sign.failed", { message: asked.message ?? asked.reason })} />
      ) : null}
    </Section>
  );
}

function Approve() {
  const wallet = useWallet();
  const tx = useSend();
  const token = config.tokens[0];
  const core = config.cores.canonical ?? config.cores.trusted[0]!.core;
  const amount = token ? 10n ** BigInt(token.decimals) : 0n;
  const [result, setResult] = useState<SendResult | undefined>();
  const [hashes, setHashes] = useState<Hex[]>([]);
  const busy = tx.state.phase !== "idle" && tx.state.phase !== "done" && tx.state.phase !== "failed";

  async function go() {
    if (!token) return;
    setResult(undefined);
    setHashes([]);
    const outcome = await tx.send([approveCall(token.address, core, amount)], {
      // A real screen stores the intent here (IndexedDB) so it can resume after a reload.
      onIntent: (intent) => setHashes((before) => (intent.hash ? [...before, intent.hash] : before)),
    });
    setResult(outcome);
  }

  const reached: TxReached | undefined = tx.state.reached;
  return (
    <Section title={t("dev-wallet.approve.heading")}>
      {token ? (
        <>
          <p className="ah-label m-0">{t("dev-wallet.approve.what", { amount: "1", symbol: token.symbol })}</p>
          <QuietButton compact data-testid={TID.devWallet.approve} data-token={token.address} data-core={core} disabled={wallet.status !== "connected" || busy} onClick={() => void go()} className="self-start">
            {t("dev-wallet.approve.go")}
          </QuietButton>
          {tx.state.of > 1 ? <p className="ah-meta m-0">{t("dev-wallet.approve.step", { n: tx.state.step + 1, of: tx.state.of })}</p> : null}
          {reached ? (
            <div data-testid={TID.kit.txRail} data-value={reached}>
              <TxRail reached={reached} local={!config.chain.hasL1} />
            </div>
          ) : null}
          {hashes.map((hash) => (
            <code key={hash} data-testid={TID.devWallet.hash} className="ah-meta ah-meta--exact break-all normal-case">
              {hash}
            </code>
          ))}
          {tx.state.reorged ? <p className="ah-label m-0">{t("dev-wallet.approve.reorged")}</p> : null}
          {result?.ok ? <p className="ah-label m-0">{t(reached === "final" ? "dev-wallet.approve.final" : "dev-wallet.approve.done")}</p> : null}
          {result && !result.ok ? <ErrorBand what={failure(result)} /> : null}
        </>
      ) : (
        <p className="ah-label m-0">{t("dev-wallet.approve.noToken")}</p>
      )}
    </Section>
  );
}

function failure(result: Exclude<SendResult, { ok: true }>): string {
  switch (result.reason) {
    case "refused":
      return t("dev-wallet.approve.refused", { name: result.refusal.name });
    case "rejected":
      return t("dev-wallet.approve.rejected");
    case "cannot-send":
      return t("dev-wallet.approve.cannot");
    case "reverted":
      return t("dev-wallet.approve.reverted");
    default:
      return t("dev-wallet.approve.failed", { reason: result.reason, message: "message" in result ? result.message : "" });
  }
}

function Account() {
  const wallet = useWallet();
  // The flag is used up by the request it answers; each block re-renders this, so the box follows.
  useNow();
  const [, flip] = useState(0);
  const no = willSayNo();
  const role = wallet.devRole ?? "found";
  return (
    <Section title={t("dev-wallet.connect.heading")}>
      <ConnectButton />
      {wallet.status === "connected" && wallet.address ? (
        <div className="flex flex-col gap-1" data-testid={TID.devWallet.account} data-value={wallet.address} data-role={role}>
          <Identity address={wallet.address} full />
          <p className="ah-label m-0">{t(`dev-wallet.connect.role.${role}`)}</p>
        </div>
      ) : (
        <p className="ah-label ah-label--dim m-0">{t("dev-wallet.connect.none")}</p>
      )}
      <label className="ah-label flex min-h-[44px] items-center gap-3">
        <input
          type="checkbox"
          data-testid={TID.devWallet.sayNo}
          checked={no}
          onChange={(event) => {
            sayNoNext(event.target.checked);
            flip((n) => n + 1);
          }}
          className="h-5 w-5 accent-[var(--ink)]"
        />
        {t("dev-wallet.sayNo")}
      </label>
    </Section>
  );
}

export default function DevWalletScreen() {
  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 py-10 md:px-10" data-screen="dev-wallet">
      <div className="flex flex-col gap-3">
        <h1 className="m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{t("dev-wallet.title")}</h1>
        <p className="m-0 text-[length:var(--fs-body-md)] leading-snug">{t("dev-wallet.intro")}</p>
      </div>
      <Account />
      <Clocks />
      <Sign />
      <Approve />
    </section>
  );
}
