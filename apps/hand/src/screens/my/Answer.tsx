import type { HandRef } from "@ahand/deliver";
import { useState } from "react";
import type { Hex } from "viem";

import { useHand } from "../../chain";
import { navigate } from "../../router";
import type { InboxRecord } from "../../store/db";
import { rememberText } from "../../store/memory";
import { TID } from "../../testids";
import { t } from "../../i18n";
import { ChainRail, Mark, Proof, QuietButton, SwipeButton, count, minute, money, percent, railHandsOf, shortAddress, useLang, useLens, type RailHand } from "../../ui";
import { handPath } from "../give/Mine";
import { useThanksOnWay, type AnswerRead, type ThankOnWay } from "./hooks";
import { reply, threadOf, useInboxVersion } from "./inbox";
import { predictSplit } from "./logic";
import { Line, Section } from "./parts";

/**
 * One message that reached this Hand's inbox (UX-SPEC §7.3). An answer only after Core's
 * `checkGive` said yes: then the helper's words (labelled as theirs), the route as people, who
 * would get what, "Thank", and a reply box. Anything Core or the link refused is listed with
 * its plain reason.
 */
export function AnswerCard(props: {
  read: AnswerRead;
  handKey: string;
  ref_: HandRef;
  reward: bigint;
  decimals: number;
  open: boolean;
  /** The Hand's inbox secret, to reply from; none while locked. */
  inboxSecret?: Hex;
}) {
  const { read, reward, decimals, open } = props;
  const lang = useLang();
  const lens = useLens();
  const judged = read.judged;
  const firstSeen = minute(Math.floor(read.record.firstSeen / 1000), lang);

  if (!judged || judged.verdict === "offline") {
    // Not judged yet: still asking Core, or the network did not answer (asked again when it does).
    return (
      <article className="ah-card flex flex-col gap-2 p-4" aria-busy={judged ? undefined : "true"}>
        <Line>{t("my.answers.checking")}</Line>
        {judged ? <Line dim>{t("common.time.offline")}</Line> : null}
      </article>
    );
  }

  if (judged.verdict === "refused") {
    return (
      <article className="ah-card flex flex-col gap-2 border-dashed p-4" data-testid={TID.my.answerRefused} data-value={judged.messageId}>
        <p className="ah-meta m-0">{t("my.refused.title")}</p>
        <p className="m-0 font-semibold">{t(judged.messageId)}</p>
        {read.record.words ? (
          <p className="ah-label ah-label--dim m-0">
            {t("my.answer.words")}: {t("my.answer.quoted", { words: read.record.words })}
          </p>
        ) : null}
        <Proof>
          <p className="ah-meta ah-meta--dim m-0">{t("my.lens.firstSeen", { time: firstSeen })}</p>
        </Proof>
      </article>
    );
  }

  const { opened } = judged;
  const give = opened.signedGive!.give;
  const rows = predictSplit(reward, opened.signedShakes, give);
  const hands: RailHand[] = railHandsOf(opened, { helper: "signer" });
  const thank = () => {
    rememberText(read.record.giveLink, "handover");
    navigate("/thank");
  };

  return (
    <article className="ah-card flex flex-col gap-4 p-4 md:p-5" data-testid={TID.my.answer} data-value={judged.giveHash}>
      <div className="flex flex-col gap-1">
        <p className="ah-meta m-0">{t("my.answer.words")}</p>
        {read.record.words ? <p className="m-0 text-[length:var(--fs-body-lg)] font-semibold leading-snug">{t("my.answer.quoted", { words: read.record.words })}</p> : <Line dim>{t("my.answer.noWords")}</Line>}
      </div>

      <ChainRail hands={hands} you={false} next={false} route={{ chainId: opened.head.chainId, core: opened.head.core, hand: opened.hand, signedShakes: opened.signedShakes, signedGive: opened.signedGive, reward, decimals }} />

      <div className="flex flex-col gap-2">
        <p className="ah-meta m-0">{t("my.answer.split")}</p>
        <dl className="m-0 flex flex-col gap-1">
          {rows.map((row, index) => (
            <div key={index} className="flex items-baseline justify-between gap-3 border-b border-[var(--ink-a10)] py-1">
              <dt className="min-w-0 text-[length:var(--fs-body-sm)]">
                {row.role === "helper" ? t("my.answer.helper") : t("my.answer.passer")}
                {row.payee && lens ? <span className="ah-exact ah-meta ml-2">{shortAddress(row.payee)}</span> : null}
              </dt>
              <dd className="m-0 shrink-0 text-right font-bold tabular-nums">
                {row.amount > 0n ? (
                  <span className={row.role === "helper" ? "ah-marker px-1" : undefined}>{money(row.amount, decimals, lang, { cents: true })}</span>
                ) : (
                  <span className="ah-label ah-label--dim">{row.role === "helper" ? t("my.answer.thanksOnly") : t("my.answer.keepsNothing")}</span>
                )}
                {lens ? <span className="ah-meta ml-2">{percent(row.bps, lang)}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
        {lens ? <p className="ah-meta ah-meta--dim m-0">{t("my.lens.split")}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Mark kind="chain" source={<span className="ah-meta ah-meta--exact">{t("my.lens.coreOk", { block: count(judged.block) })}</span>} />
        {lens ? <span className="ah-meta ah-meta--exact">{t("my.lens.giveHash", { hash: `${judged.giveHash.slice(0, 10)}…${judged.giveHash.slice(-6)}` })}</span> : null}
      </div>
      {judged.needsSetup ? <Line>{t("my.answer.setup")}</Line> : null}
      <Proof>
        <p className="ah-meta ah-meta--dim m-0">{t("my.lens.firstSeen", { time: firstSeen })}</p>
      </Proof>

      {open ? (
        <SwipeButton gesture="bow" variant="amber" compact data-testid={TID.my.answerThank} onClick={thank}>
          {t("my.answer.thank")}
        </SwipeButton>
      ) : (
        <Line>{t("my.answer.closed")}</Line>
      )}

      {props.inboxSecret && read.record.replyTo ? <Thread handKey={props.handKey} ref_={props.ref_} secret={props.inboxSecret} peer={read.record.replyTo as Hex} /> : null}
    </article>
  );
}

function Thread({ handKey, ref_, secret, peer }: { handKey: string; ref_: HandRef; secret: Hex; peer: Hex }) {
  useInboxVersion();
  const lines = threadOf(handKey, peer);
  const [text, setText] = useState("");
  const [state, setState] = useState<{ status: "idle" | "sending" } | { status: "sent"; acks: number; of: number } | { status: "failed" }>({ status: "idle" });
  const send = async () => {
    const words = text.trim();
    if (!words) return;
    setState({ status: "sending" });
    try {
      const sent = await reply(handKey, ref_, secret, peer, words);
      if (sent.acks > 0) {
        setText("");
        setState({ status: "sent", ...sent });
      } else setState({ status: "failed" });
    } catch {
      setState({ status: "failed" });
    }
  };
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--ink-a10)] pt-3">
      {lines.length > 0 ? (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {lines.map((line, index) => (
            <li key={index} className={line.mine ? "self-end text-right" : "self-start"}>
              <span className="ah-meta mr-2">{line.mine ? t("my.reply.you") : t("my.reply.them")}</span>
              <span className="text-[length:var(--fs-body-sm)]">{line.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <label className="ah-field">
        <span className="ah-field__label">{t("my.reply.label")}</span>
        <input
          className="ah-chatline"
          data-testid={TID.my.replyInput}
          value={text}
          maxLength={2000}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void send();
          }}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <QuietButton compact data-testid={TID.my.replySend} disabled={state.status === "sending" || text.trim() === ""} onClick={() => void send()}>
          {t("my.reply.send")}
        </QuietButton>
        <span className="ah-label ah-label--dim" role="status">
          {state.status === "sent" ? (
            <Proof calm={t("my.reply.sent.calm")}>{t("my.reply.sent", { acks: state.acks, of: state.of })}</Proof>
          ) : state.status === "failed" ? (
            t("my.reply.failed")
          ) : (
            t("my.reply.hint")
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * Thanks on their way (FINDINGS R-5): every inbox record that keeps a thank's intent, so a thank
 * sent from this device is not forgotten after a reload. Each one reads its Hand: once the Hand is
 * thanked, it says so. Sending, and following the thank to its end, is /thank's.
 */
export function ThanksOnWay() {
  const records = useThanksOnWay();
  if (records.status !== "ok" || records.value.length === 0) return null;
  return (
    <Section title={t("my.onWay.title")}>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {records.value.map((record) => (
          <OnWay key={record.id} record={record} />
        ))}
      </ul>
    </Section>
  );
}

function OnWay({ record }: { record: InboxRecord & { thank: ThankOnWay } }) {
  const lens = useLens();
  const [chain, core, id] = record.hand.split(":");
  const chainId = Number(chain);
  const handId = id && /^[0-9]+$/.test(id) ? BigInt(id) : undefined;
  const read = useHand(core as Hex | undefined, handId, chainId);
  const thanked = read.data?.state === "thanked";
  const { kind, hash, chainId: on } = record.thank;
  return (
    <li className="flex flex-col gap-2 border-b border-[var(--ink-a10)] pb-3" data-testid={TID.my.thankOnWay} data-value={record.id} data-state={thanked ? "thanked" : "on-way"}>
      <p className="m-0 font-semibold">{thanked ? t("my.onWay.thanked", { id: id ?? "" }) : t("my.onWay.item", { id: id ?? "" })}</p>
      {lens ? <span className="ah-meta ah-meta--exact break-all normal-case">{t("my.lens.onWay", { kind: kind ?? "?", chain: String(on ?? chainId), hash: hash ?? "—" })}</span> : null}
      {core && id ? (
        <a href={handPath(chainId, core, id)} className="ah-quiet ah-quiet--compact self-start">
          {t("my.openHand")}
        </a>
      ) : null}
    </li>
  );
}
