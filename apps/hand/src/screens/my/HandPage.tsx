import { readDescription, openAddress } from "@ahand/sdk";
import { useMemo, useState } from "react";
import type { Address, Hex } from "viem";

import { useHand, useNow } from "../../chain";
import { t } from "../../i18n";
import { handKey, type HandRecord } from "../../store/db";
import { TID } from "../../testids";
import { CopyRow, DealCard, Mark, QuietButton, shortAddress, useLens, type DealDescription } from "../../ui";
import { ConnectButton, useWallet } from "../../wallet";
import { AnswerCard } from "./Answer";
import { useAnswers, useMyHand, useSecrets } from "./hooks";
import { RELAYS, isListening, useInboxVersion } from "./inbox";
import { daysLeft, formatCode, secondsLeft, wantsCare } from "./logic";
import { GET_HAND, OPTIONS, SITE, coreOn, decimalsOf, domainOn } from "./place";
import { describeKept, rebuildBare, rebuildWithWords, seedFitsRoot } from "./rebuild";
import { hasBook, type HandSecrets } from "./session";
import { Line, Section, Title, UnlockBar } from "./parts";

type Shown =
  | { status: "idle" | "building" }
  | { status: "ok"; address: string; words: "attached" | "mismatch" | "none" }
  | { status: "no"; id: string };

/** /my/<chain>/<hand>: one Hand of this device, its link again, and its answers (UX-SPEC §7.3). */
export default function HandPage({ chainId, handId }: { chainId: number; handId: bigint }) {
  const wallet = useWallet();
  const account = wallet.status === "connected" ? wallet.address : undefined;
  const core = coreOn(chainId);
  const key = core ? handKey(chainId, core, handId) : "";
  const stored = useMyHand(key);
  const record = stored.status === "ok" ? stored.value : undefined;
  const read = useHand(core, handId, chainId);
  const now = useNow(chainId);
  const secrets = useSecrets(record, account);
  const answers = useAnswers(record ? key : undefined, core ? { chainId, core, handId } : undefined, read.data?.state);
  const lens = useLens();
  useInboxVersion();

  const view = read.data?.view;
  const state = read.data?.state;
  const decimals = view ? decimalsOf(view.token) : 18;
  const left = view ? secondsLeft(view.expiry, now?.timestamp) : undefined;
  const words = useCheckedWords(record, secrets, view?.dataHash);

  const description: DealDescription = words === "attached" && record ? { status: "attached", title: record.title, ...(record.content ? { content: record.content } : {}) } : { status: "none" };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <a href="/my" className="ah-meta self-start">
          ← {t("my.hand.back")}
        </a>
        {record?.title && words !== "attached" ? (
          <div className="flex flex-col gap-2">
            <Title>{record.title}</Title>
            {record.content ? <p className="m-0 text-[length:var(--fs-body-lg)]">{record.content}</p> : null}
            <Line dim>{words === "mismatch" ? t("my.hand.wordsMismatch") : t("my.hand.keptWords")}</Line>
          </div>
        ) : null}
        {!record?.title ? <Title>{t("my.added", { id: handId.toString() })}</Title> : null}
      </div>

      {view && read.data ? (
        <div data-testid={TID.hand.dealCard}>
          <DealCard
            state={state === "missing" ? undefined : state}
            description={description}
            reward={view.reward}
            decimals={decimals}
            expiry={view.expiry}
            closedAt={view.closedAt}
            claimBps={view.minClaimBps}
            raiser={view.raiser}
            handId={handId}
            heading={words === "attached" ? "h1" : "h2"}
            {...(now ? { block: { number: now.number, timestamp: now.timestamp } } : {})}
          />
        </div>
      ) : read.error ? (
        <Line>{t("common.time.offline")}</Line>
      ) : (
        <Line>{t("common.loading")}</Line>
      )}

      {view && wantsCare(state, left) ? (
        <a href={`/care/${chainId}/${handId}`} className="ah-alert no-underline" data-testid={TID.my.careBand}>
          {t("my.careBand", { n: daysLeft(left!) })}
        </a>
      ) : null}

      <div className="flex flex-col gap-4">
        <ConnectButton />
        {record ? <UnlockBar account={account} /> : null}
      </div>

      {stored.status === "ok" && !record ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 font-semibold">{t("my.hand.notHere")}</p>
          <Line dim>{t("my.hand.notHereWhy")}</Line>
        </div>
      ) : null}

      {record && view ? <ShowLink record={record} secrets={secrets} rootKey={view.rootKey} chainId={chainId} core={core!} handId={handId} /> : null}

      <div className="flex flex-wrap gap-3">
        <a href="/thank" className="ah-quiet ah-quiet--compact" data-testid={TID.my.pasteAnswer}>
          {t("my.paste")}
        </a>
        <a href={`/care/${chainId}/${handId}`} className="ah-quiet ah-quiet--compact" data-testid={TID.my.addReward}>
          {t("my.addReward")}
        </a>
        <a href={`/care/${chainId}/${handId}`} className="ah-quiet ah-quiet--compact" data-testid={TID.my.keepOpen}>
          {t("my.keepOpen")}
        </a>
        <a href="/print" className="ah-quiet ah-quiet--compact" data-testid={TID.my.print}>
          {t("my.print")}
        </a>
      </div>

      {record && core ? (
        <Section title={t("my.answers.title")} testId={TID.my.answers}>
          {RELAYS.length === 0 ? <Line>{t("my.answers.noRelay")}</Line> : secrets?.inbox && isListening(key) ? <Line dim>{t("my.answers.listening", { n: RELAYS.length })}</Line> : <Line dim>{t("my.answers.locked")}</Line>}
          {answers.length === 0 ? <Line>{t("my.answers.none")}</Line> : null}
          {answers.map((answer) => (
            <AnswerCard
              key={answer.record.id}
              read={answer}
              handKey={key}
              ref_={{ chainId, core, handId: handId.toString() }}
              reward={view?.reward ?? 0n}
              decimals={decimals}
              open={state === "open"}
              {...(secrets?.inbox ? { inboxSecret: secrets.inbox.secret } : {})}
            />
          ))}
        </Section>
      ) : null}

      {lens && record ? (
        <Section title={t("my.lens.title")}>
          {view ? <p className="ah-meta ah-meta--exact m-0">{t("my.lens.rootKey", { key: view.rootKey })}</p> : null}
          {secrets?.inbox ? <p className="ah-meta ah-meta--exact m-0 break-all">{t("my.lens.inbox", { key: secrets.inbox.pub })}</p> : null}
          {hasBook(record) ? (
            <p className="ah-meta ah-meta--exact m-0">
              {t("my.lens.code")}: {formatCode(record.book)} · n = {record.n}
            </p>
          ) : null}
          <p className="ah-meta ah-meta--exact m-0">raiser {shortAddress(record.raiser)}</p>
        </Section>
      ) : null}
    </div>
  );
}

/**
 * Whether the words this device keeps are the Hand's own: they (with the inbox key) give the
 * dataHash Core keeps. Known only once the inbox key is known, so after unlocking.
 */
function useCheckedWords(record: HandRecord | undefined, secrets: HandSecrets | undefined, dataHash: Hex | undefined): "attached" | "mismatch" | "unknown" {
  return useMemo(() => {
    if (!record?.title || !secrets || !dataHash) return "unknown";
    const words = { mode: record.mode, title: record.title, ...(record.content !== undefined ? { content: record.content } : {}), ...(record.salt ? { salt: record.salt } : {}) };
    return describeKept(words, secrets.inbox?.pub, dataHash) ? "attached" : "mismatch";
  }, [record, secrets, dataHash]);
}

/**
 * "Show the link again": the first link, rebuilt from (book, n) and the kept words. The derived
 * key must be the root key Core keeps; if it is not, the screen says so plainly and shows nothing.
 * The link stays in this tab's memory (React state); it is never stored or logged.
 */
function ShowLink({ record, secrets, rootKey, chainId, core, handId }: { record: HandRecord; secrets: HandSecrets | undefined; rootKey: Address; chainId: number; core: Address; handId: bigint }) {
  const [shown, setShown] = useState<Shown>({ status: "idle" });
  const show = async () => {
    if (!secrets) return;
    if (!secrets.seed) return setShown({ status: "no", id: secrets.noSeed === "no-book" ? "my.link.noBook" : "my.link.copyDropped" });
    if (!seedFitsRoot(secrets.seed, rootKey)) return setShown({ status: "no", id: "my.link.keyBad" });
    setShown({ status: "building" });
    try {
      const hand = await GET_HAND({ chainId, core, handId });
      const domain = domainOn(chainId, core);
      const rebuilt = record.title
        ? await rebuildWithWords({
            domain,
            hand,
            seed: secrets.seed,
            ...(secrets.inbox ? { inbox: secrets.inbox.pub } : {}),
            words: { mode: record.mode, title: record.title, ...(record.content !== undefined ? { content: record.content } : {}), ...(record.salt ? { salt: record.salt } : {}) },
            site: SITE,
            options: OPTIONS,
          })
        : { address: await rebuildBare({ domain, hand, seed: secrets.seed, site: SITE, options: OPTIONS }), words: "none" as const };
      // Opened here as a reader would open it before it is shown.
      const opened = await openAddress(rebuilt.address, GET_HAND, OPTIONS);
      if (opened.hand.handId !== handId) throw new Error("the rebuilt link names another hand");
      const status = readDescription(opened).status;
      setShown({ status: "ok", address: rebuilt.address, words: status === "attached" ? "attached" : rebuilt.words === "attached" ? "mismatch" : rebuilt.words });
    } catch {
      setShown({ status: "no", id: "common.time.offline" });
    }
  };

  if (!secrets) {
    return (
      <QuietButton data-testid={TID.my.showLink} disabled className="self-start">
        {t("my.link.show")}
      </QuietButton>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {shown.status !== "ok" ? (
        <QuietButton data-testid={TID.my.showLink} disabled={shown.status === "building"} onClick={() => void show()} className="self-start">
          {t("my.link.show")}
        </QuietButton>
      ) : null}
      {shown.status === "no" ? (
        <p className="ah-label m-0" role="status" data-testid={TID.my.linkRefused} data-value={shown.id}>
          {t(shown.id)}
        </p>
      ) : null}
      {shown.status === "ok" ? (
        <div className="flex flex-col gap-2" data-testid={TID.my.linkRow} data-value={shown.address} data-words={shown.words}>
          <Line>{shown.words === "attached" ? t("my.link.here") : t("my.link.bare")}</Line>
          <CopyRow value={shown.address} />
          <div className="flex flex-wrap items-center gap-2">
            <Mark kind="checked" />
            <span className="ah-label ah-label--dim">{t("my.link.keyOk")}</span>
          </div>
          {shown.words === "mismatch" ? <Line dim>{t("my.hand.wordsMismatch")}</Line> : null}
          <Line dim>{t("common.tabOnly")}</Line>
        </div>
      ) : null}
    </div>
  );
}
