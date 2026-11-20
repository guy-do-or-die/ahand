import type { HandRef } from "@ahand/deliver";
import { useState } from "react";
import { zeroAddress, type Hex } from "viem";

import { navigate } from "../../router";
import { rememberText } from "../../store/memory";
import { TID } from "../../testids";
import { t } from "../../i18n";
import { ChainRail, Mark, QuietButton, SwipeButton, count, minute, money, percent, shortAddress, useLang, useLens, type RailHand } from "../../ui";
import type { AnswerRead } from "./hooks";
import { reply, threadOf, useInboxVersion } from "./inbox";
import { predictSplit } from "./logic";
import { Line } from "./parts";

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

  if (!judged) {
    return (
      <article className="ah-card flex flex-col gap-2 p-4" aria-busy="true">
        <Line>{t("my.answers.checking")}</Line>
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
            {t("my.answer.words")}: “{read.record.words}”
          </p>
        ) : null}
        <p className="ah-meta ah-meta--dim m-0">{t("my.lens.firstSeen", { time: firstSeen })}</p>
      </article>
    );
  }

  const { opened } = judged;
  const give = opened.signedGive!.give;
  const rows = predictSplit(reward, opened.signedShakes, give);
  const hands: RailHand[] = [
    { role: "asker", address: opened.hand.raiser },
    ...opened.signedShakes.map(({ shake }): RailHand => (shake.payee === zeroAddress ? { role: "passer" } : { role: "passer", address: shake.payee })),
    { role: "helper", address: give.signer },
  ];
  const thank = () => {
    rememberText(read.record.giveLink, "handover");
    navigate("/thank");
  };

  return (
    <article className="ah-card flex flex-col gap-4 p-4 md:p-5" data-testid={TID.my.answer} data-value={judged.giveHash}>
      <div className="flex flex-col gap-1">
        <p className="ah-meta m-0">{t("my.answer.words")}</p>
        {read.record.words ? <p className="m-0 text-[length:var(--fs-body-lg)] font-semibold leading-snug">“{read.record.words}”</p> : <Line dim>{t("my.answer.noWords")}</Line>}
      </div>

      <ChainRail hands={hands} you={false} next={false} route={{ chainId: opened.head.chainId, core: opened.head.core, hand: opened.hand, signedShakes: opened.signedShakes, signedGive: opened.signedGive, reward, decimals }} />

      <div className="flex flex-col gap-2">
        <p className="ah-meta m-0">{t("my.answer.split")}</p>
        <dl className="m-0 flex flex-col gap-1">
          {rows.map((row, index) => (
            <div key={index} className="flex items-baseline justify-between gap-3 border-b border-[var(--ink-a10)] py-1">
              <dt className="min-w-0 text-[length:var(--fs-body-sm)]">
                {row.role === "helper" ? t("my.answer.helper") : t("my.answer.passer")}
                {row.payee ? <span className="ah-exact ah-meta ml-2">{shortAddress(row.payee)}</span> : null}
              </dt>
              <dd className="m-0 shrink-0 text-right font-bold tabular-nums">
                {row.amount > 0n ? (
                  <span className={row.role === "helper" ? "ah-marker px-1" : undefined}>{money(row.amount, decimals, lang, { cents: true })}</span>
                ) : (
                  <span className="ah-label ah-label--dim">{row.role === "helper" ? t("my.answer.thanksOnly") : t("my.answer.keepsNothing")}</span>
                )}
                <span className="ah-meta ml-2">{percent(row.bps, lang)}</span>
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
      <p className="ah-meta ah-meta--dim m-0">{t("my.lens.firstSeen", { time: firstSeen })}</p>

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
          {state.status === "sent" ? t("my.reply.sent", { acks: state.acks, of: state.of }) : state.status === "failed" ? t("my.reply.failed") : t("my.reply.hint")}
        </span>
      </div>
    </div>
  );
}
