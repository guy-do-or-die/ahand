import { passesLeft, type OpenedAddress } from "@ahand/sdk";
import { useMemo, useState, type CSSProperties } from "react";

import { useChainStatus, useHand, useNow } from "../../chain";
import { config } from "../../config";
import { t, useLang } from "../../i18n";
import { navigate } from "../../router";
import { remember, useOpened } from "../../store/memory";
import { TID } from "../../testids";
import { CopyRow, DealCard, ErrorBand, Identity, LandSheet, Mark, Qr, QuietButton, SwipeButton, money, percent, shortAddress, type Landing } from "../../ui";
import { ConnectSheet, useWallet } from "../../wallet";
import { failureOf, keepMax, makePass, pathOf, shareOf, KEEP_STEP, type Failure, type Held, type Made } from "../hand/held";
import { Unreachable } from "../hand/Unreachable";
import { LINK_OPTIONS, cardDescription, pollNow, useDecimals, useOpening, useReread } from "../hand/useHeld";

/**
 * Pass it on (UX-SPEC §8.4). The link this tab holds is opened again and passed on in this page:
 * the link key signs the next step, so no account is asked for. The share is a slider from 0%
 * (chosen) to what the asker's minimum for the helper leaves; at 0% nothing else is asked.
 * Above 0%, "Where should your share land?" (the kit's LandSheet; the address is all a pass
 * needs). The address keeps the shape it came in, or goes darker on request, never lighter. What
 * the screen then says about the new link is read back from the written link itself.
 *
 * A network that can't be reached is not a verdict on the link: the screen keeps it, says so and
 * reads again on its own (the Hand view's Unreachable).
 */
export default function PassScreen() {
  const opened = useOpened();
  useLang();
  // The link this screen passes on is the one held when it opened: after the pass, memory holds
  // the new link, and the screen must not start over on it.
  const [source] = useState<Held | undefined>(() => (opened ? { before: opened.before, fragment: opened.fragment } : undefined));
  const opening = useOpening(source);
  const [again, reread] = useReread();

  let body;
  if (!source) body = <NoLink />;
  else if (!opening || opening.status === "checking") {
    body = (
      <p className="ah-meta m-0" role="status">
        {t("common.state.checking")}
      </p>
    );
  } else if (opening.status === "unreachable") body = <Unreachable retry={opening.retry} held heading={t("pass.title")} />;
  else if (opening.status === "failed") body = <Failed failure={opening.failure} />;
  else body = <Pass key={again} opened={opening.opened} onRetry={reread} />;

  return (
    <section className="mx-auto w-full max-w-[1040px] px-6 pb-14 pt-8 md:px-10 md:pt-12" data-screen="pass">
      {body}
    </section>
  );
}

function NoLink() {
  return (
    <div className="mx-auto flex max-w-[620px] flex-col gap-4">
      <h1 className="m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{t("pass.title")}</h1>
      <p className="ah-note m-0">{t("pass.noLink")}</p>
      <QuietButton onClick={() => navigate("/")} className="self-start">
        {t("pass.toStart")}
      </QuietButton>
    </div>
  );
}

function Failed({ failure }: { failure: Failure }) {
  return (
    <div className="mx-auto flex max-w-[620px] flex-col gap-4" data-testid={TID.pass.error} data-value={failure.id}>
      <h1 className="m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em]">{t("pass.title")}</h1>
      <ErrorBand what={t(failure.id)} code={failure.label ? t(failure.label.id, failure.label.values) : failure.code} />
    </div>
  );
}

function Pass({ opened, onRetry }: { opened: OpenedAddress; onRetry: () => void }) {
  const read = useHand(opened.head.core, opened.hand.handId);
  const now = useNow();
  const chain = useChainStatus();
  const lang = useLang();
  const wallet = useWallet();
  const decimals = useDecimals(read.data?.view.token);
  const left = useMemo(() => passesLeft(opened.hand, opened.signedShakes), [opened]);

  const [keep, setKeep] = useState(0);
  const [landing, setLanding] = useState<Landing>();
  const [sheet, setSheet] = useState<"land" | "connect">();
  const [darker, setDarker] = useState(false);
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState<Made>();
  const [failure, setFailure] = useState<Failure>();

  if (!read.data || decimals === undefined) {
    const failure = read.error && !read.data ? failureOf(read.error) : undefined;
    if (failure && !failure.network) return <Failed failure={failure} />;
    if (failure || (!read.data && chain.offline)) return <Unreachable retry={onRetry} auto={pollNow} held heading={t("pass.title")} />;
    return (
      <p className="ah-meta m-0" role="status">
        {t("common.state.checking")}
      </p>
    );
  }
  const { view, state } = read.data;
  const funded = view.reward > 0n;
  const claim = opened.end.claimBps;
  const max = keepMax(claim, opened.hand.minClaimBps);
  const ctx = { core: opened.head.core, raiser: view.raiser, token: view.token };
  const shape = darker ? "bare" : opened.seen.shape;
  const closed = state === "thanked" || state === "refunded";

  let stop: string | undefined;
  if (opened.head.kind !== "live") stop = t("pass.answer");
  else if (closed) stop = t("pass.closed");
  else if (state === "expired") stop = t("pass.timeUp");
  else if (state === undefined) stop = t("pass.waiting");
  else if (left === 0) stop = t("pass.cannot");

  async function make() {
    setFailure(undefined);
    setMaking(true);
    try {
      const pass = await makePass(opened, { keepBps: keep, ...(keep > 0 && landing ? { payee: landing.payee } : {}) }, shape, config.site, LINK_OPTIONS);
      // The new link is what this tab now holds: Copy and Share read it from memory's copy here.
      const mark = pass.address.indexOf("#");
      remember({ before: pass.address.slice(0, mark), fragment: pass.address.slice(mark + 1), via: "handover" });
      setMade(pass);
    } catch (error) {
      setFailure(failureOf(error));
    } finally {
      setMaking(false);
    }
  }

  const card = (
    <DealCard
      state={state === "open" || state === "expired" || closed ? state : undefined}
      description={cardDescription(opened)}
      reward={view.reward}
      decimals={decimals}
      expiry={view.expiry}
      {...(closed ? { closedAt: view.closedAt } : {})}
      claimBps={claim}
      raiser={view.raiser}
      handId={view.handId}
      {...(now ? { block: { number: now.number, timestamp: now.timestamp } } : {})}
    />
  );

  if (made) return <MadeView made={made} decimals={decimals} reward={view.reward} />;

  const fill = max > 0 ? `${(keep / max) * 100}%` : "0%";
  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_420px] md:items-start md:gap-10">
      <div className="order-2 min-w-0 md:order-1">{card}</div>
      <div className="order-1 flex min-w-0 flex-col gap-6 md:order-2">
        <div className="flex flex-col gap-3">
          <h1 className="m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{t("pass.title")}</h1>
          {funded && !stop ? <p className="m-0 text-[length:var(--fs-body-lg)] font-semibold leading-snug">{t("pass.lead")}</p> : null}
        </div>

        {stop ? <p className="ah-note m-0">{stop}</p> : null}

        {!stop && funded ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="pass-share" className="ah-field__label">
              {t("pass.slider")}
            </label>
            <input
              id="pass-share"
              type="range"
              className="ah-slider"
              min={0}
              max={max}
              step={KEEP_STEP}
              value={keep}
              disabled={max === 0}
              style={{ "--slider-fill": fill } as CSSProperties}
              aria-valuetext={percent(keep, lang)}
              data-testid={TID.pass.slider}
              data-max={max}
              onChange={(event) => setKeep(Number(event.target.value))}
            />
            {/* A running sentence, not a table: tabular figures would make "." and "," digit-wide in this face ("$2 . 50"). */}
            <p className="m-0 text-[length:var(--fs-body-lg)] font-bold" data-testid={TID.pass.shareMoney} data-value={keep} aria-live="polite">
              {keep === 0 ? t("pass.shareNone") : t("pass.share", { pct: percent(keep, lang), amount: money(shareOf(view.reward, keep), decimals, lang) })}
            </p>
            <p className="ah-label m-0">{t("pass.shareMax", { pct: percent(max, lang) })}</p>
          </div>
        ) : null}
        {!stop && !funded ? (
          <p className="ah-note m-0" data-testid={TID.pass.noReward}>
            {t("pass.noReward")}
          </p>
        ) : null}

        {!stop && keep > 0 ? (
          <div className="flex flex-col gap-2" data-testid={TID.land.sheet} data-value={landing?.payee ?? ""}>
            {landing ? (
              <>
                <span className="ah-label">{t("pass.land.at")}</span>
                <Identity address={landing.payee} full />
                <QuietButton compact variant="text" onClick={() => setSheet("land")} className="self-start">
                  {t("pass.land.change")}
                </QuietButton>
              </>
            ) : (
              <QuietButton onClick={() => setSheet("land")} className="self-start">
                {t("pass.land.choose")}
              </QuietButton>
            )}
          </div>
        ) : null}

        {!stop && opened.seen.shape !== "bare" ? (
          <label className="ah-check">
            <input type="checkbox" data-testid={TID.pass.darker} checked={darker} onChange={(event) => setDarker(event.target.checked)} />
            <span>
              {t("pass.darker")}
              <span className="ah-label block">{t("pass.darker.hint")}</span>
            </span>
          </label>
        ) : null}

        {!stop ? (
          <div className="flex flex-col gap-3 pt-6">
            <SwipeButton gesture="shake" data-testid={TID.pass.swipe} disabled={making || (keep > 0 && !landing)} onClick={() => void make()} className="w-full">
              {t("pass.make")}
            </SwipeButton>
            {making ? (
              <p className="ah-meta m-0" role="status">
                {t("pass.making")}
              </p>
            ) : null}
          </div>
        ) : null}
        {failure ? (
          <div data-testid={TID.pass.error} data-value={failure.id}>
            <ErrorBand what={t(failure.id)} code={failure.label ? t(failure.label.id, failure.label.values) : failure.code} />
          </div>
        ) : null}
        <p className="ah-label ah-label--dim m-0">{t("common.tabOnly")}</p>
      </div>

      {sheet === "land" ? (
        <LandSheet
          purpose="share"
          {...(wallet.address ? { account: wallet.address } : {})}
          onConnect={() => setSheet("connect")}
          ctx={ctx}
          {...(landing?.choice === "address" ? { initialAddress: landing.payee } : {})}
          onDone={(next) => {
            setLanding(next);
            setSheet(undefined);
          }}
          onClose={() => setSheet(undefined)}
        />
      ) : null}
      {sheet === "connect" ? <ConnectSheet onClose={() => setSheet("land")} onConnected={() => setSheet("land")} /> : null}
    </div>
  );
}

/**
 * The new link: the copy row, Share, a QR on request, and what the written link says, read back
 * from its own bytes and marked "checked here".
 */
function MadeView({ made, decimals, reward }: { made: Made; decimals: number; reward: bigint }) {
  const lang = useLang();
  const [qr, setQr] = useState(false);
  const { readBack } = made;
  const see = () => {
    const path = pathOf(made.address.slice(0, made.address.indexOf("#")));
    if (made.shape === "bare" || !path) navigate("/", { state: { view: "hand" } });
    else navigate(`${path}${new URL(made.address.slice(0, made.address.indexOf("#"))).search}`);
  };
  return (
    <div className="mx-auto flex w-full max-w-[620px] flex-col gap-6">
      <h1 className="m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{t("pass.made")}</h1>
      <div data-testid={TID.pass.copy}>
        <CopyRow value={made.address} />
      </div>
      <div className="flex flex-wrap gap-3">
        <QuietButton data-testid={TID.pass.qr} aria-expanded={qr} onClick={() => setQr(!qr)}>
          {t("common.word.showQr")}
        </QuietButton>
      </div>
      {qr ? <Qr value={made.qr} /> : null}
      <div className="flex flex-col gap-2" data-testid={TID.pass.readBack} data-payee={readBack.payee ?? ""} data-bps={readBack.keptBps} data-shakes={readBack.shakes}>
        <p className="m-0 text-[length:var(--fs-body-lg)] font-bold leading-snug">
          {readBack.payee
            ? t("pass.readBack.share", { payee: shortAddress(readBack.payee), pct: `${percent(readBack.keptBps, lang)}${reward > 0n ? ` (${money(shareOf(reward, readBack.keptBps), decimals, lang)})` : ""}` })
            : t("pass.readBack.none")}
        </p>
        <span className="flex flex-wrap items-center gap-2">
          <Mark
            kind="checked"
            source={
              <>
                <span className="ah-meta ah-meta--exact break-all">{t("pass.lens.read", { shakes: readBack.shakes, shape: made.shape })}</span>
                <span className="ah-meta ah-meta--exact break-all">
                  {t("pass.lens.terms", { payee: readBack.payee ?? "0x0", claim: readBack.keptBps + readBack.nextClaimBps, next: readBack.nextClaimBps })}
                </span>
              </>
            }
          />
        </span>
      </div>
      <p className="ah-label m-0">{t("pass.sendIt")}</p>
      <p className="ah-label m-0">{t("pass.oldLink")}</p>
      <QuietButton onClick={see} className="self-start">
        {t("pass.toHand")}
      </QuietButton>
      <p className="ah-label ah-label--dim m-0">{t("common.tabOnly")}</p>
    </div>
  );
}
