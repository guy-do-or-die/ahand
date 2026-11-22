import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";

import { clientOf, useChainStatus } from "../../chain";
import { config } from "../../config";
import { t, useLang } from "../../i18n";
import { all } from "../../store/db";
import { addressOf, openedLink } from "../../store/memory";
import { TID } from "../../testids";
import { ErrorBand, QuietButton, TxRail } from "../../ui";
import { thankedProbe, useSend, type SendResult } from "../../wallet";
import { checkThank, isGiveFragment, keepIntent, type CheckResult, type ThankRecord } from "./check";
import { ThankFlow } from "./Flow";

/**
 * /thank: one careful tap that pays everyone. A give address is pasted here, or
 * handed over by /my through store/memory.ts. Nothing is called an answer before Core's
 * `checkGive` passes; until then the screen says it is checking.
 *
 * Before anything is pasted, a thanks sent from this device and still on its way (an inbox record
 * with a `thank` intent) is named and followed by its hash, or by the raiser's nonce and the Hand's
 * `Thanked`, and never sent again.
 */
export default function ThankScreen() {
  useLang(); // re-render on a language switch
  const [text, setText] = useState("");
  const [checking, setChecking] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<CheckResult | undefined>(undefined);
  const run = useRef(0);

  const check = useCallback(async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    const mine = ++run.current;
    setResult(undefined);
    setChecking(trimmed);
    const answer = await checkThank(trimmed, window.location.origin, clientOf());
    if (run.current !== mine) return;
    setChecking(undefined);
    setResult(answer);
  }, []);

  // A give address handed over by /my or pasted on the landing; one that arrived in this tab's
  // own address is taken only when it is a give link (a hand's link opens on the hand view).
  useEffect(() => {
    const held = openedLink();
    if (!held) return;
    if (held.via === "address" && !isGiveFragment(held.fragment)) return;
    const address = addressOf(held);
    if (!address) return;
    setText(address);
    void check(address);
  }, [check]);

  const reset = () => {
    run.current++;
    setResult(undefined);
    setChecking(undefined);
    setText("");
  };

  const showInput = !result?.ok && !checking;

  return (
    <section className="mx-auto flex w-full max-w-[680px] flex-col gap-6 px-6 py-10 md:px-10" data-screen="thank">
      <header className="flex flex-col gap-3">
        <h1 className="m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{t("thank.title")}</h1>
        {showInput ? <p className="m-0 text-[length:var(--fs-body-lg)] leading-snug">{t("thank.lead")}</p> : null}
      </header>

      {showInput ? <OnTheirWay onOpen={(link) => {
        setText(link);
        void check(link);
      }} /> : null}

      {showInput ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void check(text);
          }}
        >
          <label className="ah-field">
            <span className="ah-field__label">{t("thank.input.label")}</span>
            <textarea
              className="ah-input ah-input--exact min-h-[96px] resize-y break-all"
              data-testid={TID.thank.input}
              value={text}
              rows={3}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              placeholder={t("thank.input.placeholder")}
              onChange={(event) => setText(event.target.value)}
            />
            <span className="ah-label">{t("thank.input.hint")}</span>
          </label>
          <QuietButton type="submit" className="self-start" data-testid={TID.thank.open} disabled={!text.trim()}>
            {t("thank.open")}
          </QuietButton>
        </form>
      ) : null}

      {checking ? (
        <p className="ah-label m-0" role="status" data-testid={TID.thank.checking}>
          {t("thank.checking")}
        </p>
      ) : null}

      {result && !result.ok ? (
        <div data-testid={TID.thank.error} data-value={result.failure.code ?? result.failure.messageId}>
        <ErrorBand
          className="w-full"
          what={t(result.failure.messageId)}
          kept={/nothing (was sent|left)|ничего не (отправлено|ушло)/i.test(t(result.failure.messageId)) ? undefined : t("common.error.nothingSent")}
          {...(result.failure.code ? { code: result.failure.code } : {})}
          action={
            <QuietButton compact onClick={reset}>
              {t("thank.again")}
            </QuietButton>
          }
        />
        </div>
      ) : null}

      {result?.ok ? <ThankFlow key={result.checked.giveHash} checked={result.checked} onAnother={reset} /> : null}
    </section>
  );
}

/** The Hand a stored record belongs to: `chainId:core:handId`. */
function placeOf(record: ThankRecord): { chainId: number; core: Address; handId: bigint } | undefined {
  const [chain, core, hand] = record.hand.split(":");
  if (!chain || !core || !hand || !/^[0-9]+$/.test(chain) || !/^[0-9]+$/.test(hand)) return undefined;
  return { chainId: Number(chain), core: core as Address, handId: BigInt(hand) };
}

/** Thanks sent from this device that are still on their way, followed until each lands or is dropped. */
function OnTheirWay({ onOpen }: { onOpen: (link: string) => void }) {
  const [records, setRecords] = useState<ThankRecord[]>([]);
  useEffect(() => {
    let live = true;
    all("inbox")
      .then((list) => live && setRecords((list as ThankRecord[]).filter((record) => record.thank && record.thank.chainId === config.chain.id)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (records.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {records.map((record) => (
        <OnItsWay key={record.id} record={record} onOpen={onOpen} />
      ))}
    </ul>
  );
}

function OnItsWay({ record, onOpen }: { record: ThankRecord; onOpen: (link: string) => void }) {
  const send = useSend();
  const place = placeOf(record);
  const { offline, stale } = useChainStatus();
  const [result, setResult] = useState<SendResult | undefined>();
  useEffect(() => {
    if (!record.thank || !place) return;
    let live = true;
    const probe = thankedProbe(place.core, place.handId);
    void send.resume(record.thank, { probe, onIntent: (intent) => keepIntent(record, intent) }).then(async (settled) => {
      if (!settled.ok && settled.reason === "stopped") return;
      await keepIntent(record, undefined).catch(() => undefined);
      if (live) setResult(settled);
    });
    return () => {
      live = false;
    };
    // Followed once, when the screen opens.
  }, []);
  if (!place) return null;
  const id = place.handId.toString();
  const landed = result?.ok === true && result.step === result.of - 1;
  return (
    <li className="ah-card flex flex-col gap-3 p-4" data-testid={TID.thank.onWay} data-value={record.id} data-state={result ? (landed ? "landed" : result.ok ? "first-step" : result.reason) : "on-its-way"}>
      {result === undefined ? (
        <>
          <p className="m-0 font-semibold leading-snug">{t("thank.onWay", { id })}</p>
          <TxRail reached={send.state.reached ?? "sent"} local={!config.chain.hasL1} offline={offline || stale} />
        </>
      ) : landed ? (
        <>
          <p className="m-0 font-semibold leading-snug">{t("thank.onWay.done", { id })}</p>
          <QuietButton compact className="self-start" onClick={() => onOpen(record.giveLink)}>
            {t("thank.onWay.open")}
          </QuietButton>
        </>
      ) : !result.ok && result.reason === "dropped" ? (
        <p className="m-0 font-semibold leading-snug">{t("common.send.dropped")}</p>
      ) : null}
    </li>
  );
}
