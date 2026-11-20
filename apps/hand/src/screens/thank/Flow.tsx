import { handLogs, handLogsAt, raiserHops, readDescription, readThank, setupCall, thankCall, type Call, type Receipt } from "@ahand/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAddressEqual, parseAbi, type Address, type Hex } from "viem";

import { config } from "../../config";
import { clientOf, useChainStatus, useCost, useHand, useNow } from "../../chain";
import { t, useLang } from "../../i18n";
import { TID } from "../../testids";
import { ChainRail, CostLine, DealCard, ErrorBand, Mark, QuietButton, SwipeButton, TxRail, minute, percent, shortAddress, type RailHand } from "../../ui";
import { canBatch, ConnectButton, connectedWallet, thankedProbe, useSend, useWallet, type Intent, type SendResult } from "../../wallet";
import { keepIntent, recheck, type Checked } from "./check";
import { handLogsOf, landedFlags, payeeFindings, payeeRefusedIn, predictPayouts, verifyThanked, type Payout } from "./model";
import { Predicted } from "./Predicted";
import { ThankReceipt, WithoutUs } from "./Receipt";

/** What the screen shows after the swipe. */
type Outcome =
  | { kind: "done"; receipt: Receipt; payouts: Payout[]; hash: Hex; before?: boolean }
  | { kind: "unconfirmed"; hash: Hex; why: string }
  | { kind: "failed"; what: string; kept: string; code?: string };

const ERC20 = parseAbi(["function decimals() view returns (uint8)"]);

function tokenDecimals(token: Address | undefined): number | undefined {
  if (!token) return undefined;
  return config.tokens.find((entry) => isAddressEqual(entry.address, token))?.decimals;
}

/** The token's decimals: from the build's configuration, or asked of the token once. */
function useDecimals(token: Address | undefined): number | undefined {
  const known = tokenDecimals(token);
  const [asked, setAsked] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!token || known !== undefined) return;
    let live = true;
    clientOf()
      .readContract({ address: token, abi: ERC20, functionName: "decimals" })
      .then((value) => live && setAsked(Number(value)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [token, known]);
  return known ?? asked;
}

/** The sentence for a send that did not end in a thank, and what it did not cost. */
function failureOf(result: Exclude<SendResult, { ok: true }>, of: number): Outcome {
  const firstLanded = of > 1 && result.sent.length > 0 && result.step > 0;
  const kept = firstLanded ? t("thank.firstStepOnly") : t("common.error.nothingLeft");
  switch (result.reason) {
    case "refused":
      return { kind: "failed", what: t(`core.${result.refusal.name}`), kept, code: result.refusal.name };
    case "reverted": {
      // A revert on the chain spent the cost of trying, so "nothing left your account" would be untrue.
      const spent = firstLanded ? t("thank.firstStepOnly") : t("thank.reverted.kept");
      return result.refusal
        ? { kind: "failed", what: t(`core.${result.refusal.name}`), kept: spent, code: result.refusal.name }
        : { kind: "failed", what: t("thank.reverted"), kept: spent };
    }
    case "rejected":
      return { kind: "failed", what: t("common.error.refused"), kept: firstLanded ? kept : "" };
    case "offline":
      return { kind: "failed", what: t("common.time.offline"), kept };
    case "stopped":
      return { kind: "failed", what: firstLanded ? t("core.InvalidGiverSig") : t("common.error.nothingSent"), kept: firstLanded ? kept : "" };
    case "needs-wallet":
      return { kind: "failed", what: t("thank.connect"), kept: t("common.error.nothingSent") };
    case "dropped":
      return { kind: "failed", what: t("common.send.dropped"), kept: firstLanded ? t("thank.firstStepOnly") : "", code: "DROPPED" };
    case "unknown":
      return { kind: "failed", what: t("common.send.unknown"), kept: "", code: "UNKNOWN" };
    case "wrong-network":
      return { kind: "failed", what: t("common.error.wrongNetwork", { network: config.chain.name }), kept: "" };
    default:
      return { kind: "failed", what: t("thank.reverted"), kept, code: "message" in result ? result.message : result.reason };
  }
}

export function ThankFlow({ checked, onAnother }: { checked: Checked; onAnother: () => void }) {
  const lang = useLang();
  const { opened, hand, signedShakes, signedGive, setup } = checked;
  const core = opened.head.core;
  const chainId = opened.head.chainId;
  const read = useHand(core, hand.handId, chainId);
  const now = useNow(chainId);
  const status = useChainStatus(chainId);
  const offline = status.offline || status.stale;
  const view = read.data?.view;
  const state = read.data?.state;
  const decimals = useDecimals(view?.token);
  const wallet = useWallet();
  const send = useSend();
  const [outcome, setOutcome] = useState<Outcome | undefined>(undefined);
  const [landed, setLanded] = useState<boolean[] | undefined>(undefined);
  const [ticked, setTicked] = useState<boolean[]>(() => checked.dropped.map(() => false));
  const [anyway, setAnyway] = useState(false);
  const [atomic, setAtomic] = useState<boolean | undefined>(undefined);
  /** The wallet's answer was lost: the thanks is being looked for by the nonce and the Hand's `Thanked`. */
  const [unknown, setUnknown] = useState(false);
  const busy = useRef(false);
  const probe = useMemo(() => thankedProbe(core, hand.handId), [core, hand.handId]);
  const keep = useCallback((intent: Intent) => keepIntent(checked.record, intent), [checked.record]);

  const calls = useMemo<Call[]>(() => {
    const thank = thankCall(core, hand.handId, signedShakes, signedGive);
    return setup ? [setupCall(setup), thank] : [thank];
  }, [core, hand.handId, signedShakes, signedGive, setup]);

  const payouts = useMemo(() => (view ? predictPayouts(view.reward, signedShakes, signedGive.give) : undefined), [view, signedShakes, signedGive]);
  const findings = useMemo(() => (payouts && view ? payeeFindings(payouts, { core, raiser: view.raiser, token: view.token }) : []), [payouts, view, core]);
  // Duty 11: a payee at the raiser's address is already among `findings`; a link handed to a key at
  // the raiser's address pays nothing by itself, so it is named here once per Shake.
  const keyHops = useMemo(() => raiserHops(hand.raiser, signedShakes).filter((hop) => hop.as !== "payee"), [hand.raiser, signedShakes]);
  const isRaiser = wallet.status === "connected" && wallet.address !== undefined && isAddressEqual(wallet.address, hand.raiser);
  const resigned = checked.verdict === "resigned";

  const stoppedBy: string | undefined = !checked.gas.fits
    ? "too-long"
    : payeeRefusedIn(findings)
      ? "payee"
      : state === "thanked" || state === "refunded"
        ? "closed"
        : state === "expired"
          ? "expired"
          : resigned && !anyway
            ? "resigned"
            : undefined;
  const ready = stoppedBy === undefined && state === "open" && isRaiser && decimals !== undefined;
  const cost = useCost(ready && !outcome ? calls : undefined, ready ? wallet.address : undefined, chainId);

  // Whether this wallet can carry the setup and the thanks as one: known only once it is connected.
  useEffect(() => {
    if (!setup || !isRaiser) return;
    let live = true;
    void connectedWallet().then(async (signed) => {
      const can = signed ? await canBatch(signed, chainId) : false;
      if (live) setAtomic(can);
    });
    return () => {
      live = false;
    };
  }, [setup, isRaiser, chainId]);

  /** Reads this Hand's logs in the receipt's block again and flags each row as the chain shows it. */
  const flagLanded = useCallback(
    async (receipt: Receipt, block: bigint) => {
      setLanded(receipt.rows.map(() => false));
      let again: Awaited<ReturnType<typeof handLogs>>;
      try {
        again = await handLogs(clientOf(chainId), core, hand.handId, { fromBlock: block, toBlock: block });
      } catch {
        return; // the rows stay unflagged; the receipt itself came from the transaction's logs
      }
      const flags = landedFlags(receipt, again);
      // One row after another, in Core's order: the pace of the sweep, not a reading of any clock.
      flags.forEach((flag, index) => {
        setTimeout(() => setLanded((before) => (before ? before.map((value, i) => (i === index ? flag : value)) : before)), 140 * (index + 1));
      });
    },
    [chainId, core, hand.handId],
  );

  const settle = useCallback(
    async (result: SendResult) => {
      if (!result.ok) {
        // The screen was left: the thanks may still land, and the intent stays for the next visit.
        if (result.reason === "stopped" && result.intent) return;
        setOutcome(failureOf(result, calls.length));
        await keepIntent(checked.record, undefined).catch(() => undefined);
        return;
      }
      if (result.step < result.of - 1) {
        // Only the setup step landed (resumed after a reload): the thanks itself was not sent.
        await keepIntent(checked.record, undefined).catch(() => undefined);
        return;
      }
      const logs = handLogsOf(result.receipt.logs, core, hand.handId);
      const verdict = verifyThanked(logs, { signedShakes, give: signedGive.give });
      await keepIntent(checked.record, undefined).catch(() => undefined);
      if (!verdict.ok) {
        setOutcome({ kind: "unconfirmed", hash: result.receipt.transactionHash, why: verdict.why });
        return;
      }
      setOutcome({ kind: "done", receipt: verdict.receipt, payouts: verdict.payouts, hash: result.receipt.transactionHash });
      void flagLanded(verdict.receipt, result.receipt.blockNumber);
    },
    [calls.length, checked.record, core, hand.handId, signedShakes, signedGive, flagLanded],
  );

  // A thanks sent from this device before a reload: follow its stored hash, send nothing.
  useEffect(() => {
    const intent = checked.record.thank;
    if (!intent || busy.current) return;
    busy.current = true;
    void send.resume(intent, { probe, onIntent: keep }).then(async (result) => {
      await settle(result);
      busy.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A Hand already thanked for this very Give (and no send of ours in flight): its receipt, from the chain.
  useEffect(() => {
    if (state !== "thanked" || outcome || busy.current || !view) return;
    let live = true;
    (async () => {
      const client = clientOf(chainId);
      const stored = await readThank(client, core, hand.handId);
      if (stored.giveHash.toLowerCase() !== checked.giveHash.toLowerCase()) return;
      const logs = await handLogsAt(client, core, hand.handId, view.closedAt);
      const verdict = verifyThanked(logs, { signedShakes, give: signedGive.give });
      if (!live || !verdict.ok) return;
      const hash = verdict.receipt.rows[0]!.log.transactionHash;
      setOutcome({ kind: "done", receipt: verdict.receipt, payouts: verdict.payouts, hash, before: true });
      setLanded(landedFlags(verdict.receipt, logs));
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [state, outcome, view, chainId, core, hand.handId, checked.giveHash, signedShakes, signedGive]);

  const sayThanks = async () => {
    if (busy.current || !ready) return;
    busy.current = true;
    setOutcome(undefined);
    let result = await send.send(calls, {
      onIntent: keep,
      between: () => recheck(clientOf(chainId), checked),
      steps: setup ? [{ action: "setup" }, { action: "thank", probe }] : [{ action: "thank", probe }],
    });
    if (!result.ok && result.reason === "unknown") {
      // Never "nothing was sent" and never a second thanks: look for this one first.
      setUnknown(true);
      result = await send.resume(result.intent, { probe, onIntent: keep });
      setUnknown(false);
    }
    await settle(result);
    busy.current = false;
  };

  const sending = send.state.phase !== "idle" && send.state.phase !== "done" && send.state.phase !== "failed";
  const description = readDescription(opened);
  const rail: RailHand[] = [
    { role: "asker", address: hand.raiser },
    ...signedShakes.map(({ shake }) => ({ role: "passer" as const, ...(shake.claimBps > shake.nextClaimBps ? { address: shake.payee } : {}) })),
    { role: "helper", address: signedGive.give.payee },
  ];
  const noReward = view !== undefined && view.reward === 0n;
  const allTicked = ticked.every(Boolean);
  const done = outcome?.kind === "done";

  return (
    <div className="flex flex-col gap-6">
      {view && decimals !== undefined ? (
        <DealCard
          state={state === "missing" ? undefined : state}
          description={description.status === "attached" ? { status: "attached", title: description.title ?? "", ...(description.content ? { content: description.content } : {}) } : { status: description.status }}
          reward={view.reward}
          decimals={decimals}
          expiry={view.expiry}
          {...(view.closedAt ? { closedAt: view.closedAt } : {})}
          raiser={view.raiser}
          handId={hand.handId}
          {...(now ? { block: { number: now.number, timestamp: now.timestamp } } : {})}
        />
      ) : (
        <p className="ah-label m-0">{t("common.loading")}</p>
      )}

      {/* Step 2 passed: Core's own answer, with its source. */}
      <div className="flex flex-col gap-2">
        <p className="m-0 flex flex-wrap items-center gap-2 text-[length:var(--fs-body-md)] font-semibold">
          <Mark
            kind="chain"
            source={
              <span className="flex flex-col gap-1">
                <span className="ah-meta ah-meta--exact">{t(setup ? "thank.lens.checkedSetup" : "thank.lens.checked", { block: checked.checkedAt.toString() })}</span>
                <span className="ah-meta ah-meta--exact break-all">{t("thank.lens.giveHash", { hash: checked.giveHash })}</span>
                <span className="ah-meta">{t("thank.lens.firstSeen", { time: minute(Math.floor(checked.firstSeen / 1000), lang) })}</span>
              </span>
            }
          />
          <span>{t("thank.checked")}</span>
        </p>
        <ChainRail hands={rail} you={false} next={false} />
      </div>

      {resigned ? (
        <div className="ah-card flex flex-col gap-3 p-4" data-testid={TID.thank.resigned}>
          <p className="m-0 font-semibold leading-snug">
            {t("thank.resigned", {
              holders: checked.dropped.map((d) => (d.payee ? shortAddress(d.payee) : shortAddress(d.key))).join(", "),
            })}
          </p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {checked.dropped.map((holder, index) => (
              <li key={holder.key} className="flex flex-col gap-1" data-testid={TID.thank.dropped} data-index={index} data-payee={holder.payee ?? ""} data-bps={holder.bps}>
                <s className="ah-meta ah-meta--exact break-all">
                  {holder.payee ?? holder.key} · {holder.bps > 0 ? t("thank.resigned.share", { share: percent(holder.bps, lang) }) : t("thank.resigned.noShare")}
                </s>
                <label className="flex min-h-[44px] items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[var(--ink)]"
                    data-testid={TID.thank.droppedTick}
                    data-index={index}
                    checked={ticked[index] ?? false}
                    disabled={anyway || done}
                    onChange={(event) => setTicked((before) => before.map((value, i) => (i === index ? event.target.checked : value)))}
                  />
                  <span>{t("thank.resigned.tick")}</span>
                </label>
              </li>
            ))}
          </ul>
          {checked.earlierSeen !== undefined ? (
            <p className="ah-meta m-0" data-testid={TID.thank.firstSeen}>
              {t("thank.lens.firstSeen", { time: minute(Math.floor(checked.earlierSeen / 1000), lang) })}
            </p>
          ) : null}
          {anyway ? (
            <p className="ah-label m-0">{t("thank.resigned.overridden")}</p>
          ) : (
            <QuietButton className="self-start" data-testid={TID.thank.anyway} disabled={!allTicked} onClick={() => setAnyway(true)}>
              {t("thank.resigned.anyway")}
            </QuietButton>
          )}
        </div>
      ) : null}
      {checked.verdict === "branch" ? <p className="ah-note m-0">{t("thank.branch")}</p> : null}

      {findings.map((finding) => (
        <p
          key={`${finding.row}-${finding.problem}`}
          className={finding.problem === "core" ? "ah-alert m-0" : "ah-note m-0"}
          data-testid={finding.problem === "core" ? TID.thank.payeeRefused : TID.thank.payeeFlag}
          data-value={finding.payee}
        >
          {t(`thank.payee.${finding.problem}`)} <span className="ah-exact break-all">{finding.payee}</span>
        </p>
      ))}
      {keyHops.map((hop) => (
        <p key={`key-${hop.position}`} className="ah-note m-0" data-testid={TID.thank.keyFlag} data-value={hop.position}>
          {t("thank.key.raiser", { n: hop.position + 1 })}
        </p>
      ))}

      {!checked.gas.fits ? (
        <p className="ah-alert m-0" data-testid={TID.thank.tooLong}>
          {t("thank.tooLong")}
        </p>
      ) : null}

      {setup ? (
        <div className="ah-note flex flex-col gap-2" data-testid={TID.thank.setupBand}>
          <p className="m-0">{t("thank.setup")}</p>
          {atomic !== true ? (
            <p className="m-0 font-normal" data-testid={TID.thank.twoSteps}>
              {t("thank.twoSteps")}
            </p>
          ) : null}
          <span className="ah-meta ah-meta--exact break-all">{t("thank.lens.factory", { factory: setup.factory })}</span>
          <span className="ah-meta ah-meta--exact break-all">{t("thank.lens.setupRuns", { forwarder: setup.forwarder })}</span>
        </div>
      ) : null}

      {payouts && decimals !== undefined && !done ? <Predicted payouts={payouts} decimals={decimals} noReward={noReward} gas={checked.gas} /> : null}

      {send.state.phase !== "idle" ? (
        <div className="flex flex-col gap-2" data-testid={TID.thank.txRail} data-phase={send.state.phase} data-step={send.state.step} data-of={send.state.of}>
          {send.state.of > 1 && !send.state.atomic ? (
            <p className="ah-label m-0">
              {t("thank.step", { step: send.state.step + 1, of: send.state.of })} · {t(send.state.step === 0 ? "thank.step.setup" : "thank.step.thanks")}
            </p>
          ) : null}
          <TxRail reached={send.state.reached ?? "sent"} local={!config.chain.hasL1} offline={offline && send.state.phase === "watching"} />
          {unknown ? (
            <p className="ah-note m-0" role="status" data-testid={TID.thank.unknown}>
              {t("common.send.unknown")}
            </p>
          ) : null}
        </div>
      ) : null}

      {outcome?.kind === "done" && decimals !== undefined ? (
        <ThankReceipt receipt={outcome.receipt} landed={landed} decimals={decimals} hash={outcome.hash} before={outcome.before === true} chainId={chainId} handId={hand.handId} />
      ) : null}

      {outcome?.kind === "unconfirmed" ? (
        <div data-testid={TID.thank.error} data-value="unconfirmed">
          <ErrorBand what={t("thank.notConfirmed")} code={outcome.why} />
        </div>
      ) : null}

      {outcome?.kind === "failed" ? (
        <div data-testid={TID.thank.error} data-value={outcome.code ?? ""}>
          <ErrorBand what={outcome.what} {...(outcome.kept ? { kept: outcome.kept } : {})} {...(outcome.code ? { code: outcome.code } : {})} />
        </div>
      ) : null}

      {/* The action: the wallet, the cost, the warning and the swipe. */}
      {!done && stoppedBy !== "closed" && stoppedBy !== "expired" ? (
        <div className="flex flex-col gap-4">
          {wallet.status !== "connected" ? <p className="ah-label m-0">{t("thank.connect")}</p> : null}
          <ConnectButton />
          {wallet.status === "connected" && !isRaiser ? (
            <div data-testid={TID.thank.error} data-value="NotRaiser">
              <ErrorBand what={t("core.NotRaiser")} kept={t("common.error.nothingSent")} code="NotRaiser" />
            </div>
          ) : null}
          {ready && !outcome ? (
            <div data-testid={TID.thank.cost}>
              {cost.status === "ok" ? (
                <CostLine cost={cost.cost} prices={config.prices} gas={cost.gas} />
              ) : cost.status === "refused" ? (
                <ErrorBand what={t(`core.${cost.refusal.name}`)} kept={t("common.error.nothingSent")} code={cost.refusal.name} />
              ) : cost.status === "offline" ? (
                <ErrorBand what={t("common.error.offline")} />
              ) : (
                <p className="ah-meta m-0">{t("thank.costChecking")}</p>
              )}
            </div>
          ) : null}
          <p className="m-0 text-[length:var(--fs-body-lg)] font-bold leading-snug" data-testid={TID.thank.warning}>
            {t(noReward ? "thank.warning.noReward" : "thank.warning")}
          </p>
          <SwipeButton
            gesture="bow"
            variant="amber"
            className="w-full"
            data-testid={TID.thank.swipe}
            disabled={!ready || sending || cost.status === "refused" || outcome?.kind === "failed"}
            onClick={() => void sayThanks()}
          >
            {t("thank.swipe")}
          </SwipeButton>
        </div>
      ) : null}

      {stoppedBy === "closed" && !done ? (
        <div data-testid={TID.thank.error} data-value="closed">
          <ErrorBand what={t(state === "thanked" ? "thank.error.thankedOther" : "thank.error.closed")} />
        </div>
      ) : null}
      {stoppedBy === "expired" ? (
        <div data-testid={TID.thank.error} data-value="Expired">
          <ErrorBand what={t("core.Expired")} code="Expired" />
        </div>
      ) : null}

      <WithoutUs calls={calls} />

      {done || outcome?.kind === "failed" || outcome?.kind === "unconfirmed" ? (
        <QuietButton className="self-start" onClick={onAnother}>
          {t("thank.again")}
        </QuietButton>
      ) : null}
    </div>
  );
}

