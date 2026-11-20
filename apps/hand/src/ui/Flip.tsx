import { Fragment, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";

import enCommon from "../i18n/common/en";
import ruCommon from "../i18n/common/ru";
import { clsx } from "../lib/clsx";
import { useLang, type Lang } from "./ambient";
import { TID } from "../testids";

/**
 * The twist (UX-SPEC §3, D-54): every hand turns over. `Flip` is a two-sided card. Its front is
 * whatever it wraps, inside a real button with `aria-expanded`; its back follows that button in
 * the document, so a screen reader reads the proof as the next paragraph. A tap, Enter or Space
 * turns it: 360 ms of `rotateY`, both faces with `backface-visibility: hidden`. Under
 * `prefers-reduced-motion` the sides swap with no motion. Tapping the back turns it again.
 *
 * The back is rendered only while it is shown (or turning), so what it checks is checked when
 * someone looks: "the checks this browser just ran".
 */

/** The turn takes this long; twist.css says the same in its transition. */
export const FLIP_MS = 360;

export interface FlipProps {
  /** The front: phrasing content only (it sits inside a button). */
  front: ReactNode;
  /** The back, built only while it is shown. */
  back: () => ReactNode;
  /** What the back is, for a screen reader: "what was checked". */
  backLabel: string;
  /** "rail" sizes the back as a card on the ChainRail; "row" spans a receipt row. */
  variant: "rail" | "row";
  className?: string;
  /** Called after each turn with the side now up. */
  onTurn?: (flipped: boolean) => void;
}

const reduceQuery = "(prefers-reduced-motion: reduce)";

function subscribeMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const query = window.matchMedia(reduceQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Whether the reader asked for less motion; the twist then shows end states at once. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(reduceQuery).matches,
    () => false,
  );
}

export function Flip({ front, back, backLabel, variant, className, onTurn }: FlipProps) {
  const words = useTwistWords();
  const reduced = useReducedMotion();
  const id = useId();
  const [flipped, setFlipped] = useState(false);
  // The back stays in the document while it turns away, and leaves once it faces away.
  const [mounted, setMounted] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const turn = useCallback(() => {
    clearTimeout(timer.current);
    const next = !flipped;
    setFlipped(next);
    if (next) {
      setMounted(true);
      // A card on a sideways rail brings itself into view; with less motion, without a glide.
      requestAnimationFrame(() => root.current?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: reduced ? "auto" : "smooth" }));
    } else if (reduced) {
      setMounted(false);
    } else {
      timer.current = setTimeout(() => setMounted(false), FLIP_MS);
    }
    onTurn?.(next);
  }, [flipped, reduced, onTurn]);

  // A tap anywhere on the back turns it again, unless it lands on something of its own to press.
  const onBack = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button, a, input, select, textarea, summary")) return;
    turn();
  };

  return (
    <div
      ref={root}
      className={clsx("ah-flip", `ah-flip--${variant}`, flipped && "ah-flip--flipped", className)}
      data-testid={TID.twist.flip}
      data-flipped={String(flipped)}
    >
      <div className="ah-flip__card">
        <button
          type="button"
          className="ah-flip__face ah-flip__front"
          aria-expanded={flipped}
          aria-controls={id}
          onClick={turn}
          data-testid={TID.twist.front}
        >
          {front}
          <span className="sr-only"> · {flipped ? words.turnBack : words.turnOver}</span>
        </button>
        <div
          id={id}
          role="group"
          aria-label={backLabel}
          className="ah-flip__face ah-flip__back"
          hidden={!mounted}
          onClick={onBack}
          data-testid={TID.twist.back}
        >
          {mounted ? back() : null}
          {mounted ? (
            <p aria-hidden="true" className="ah-flip__hint">
              {words.tapBack}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Reveals `total` items one by one once `ready`, `stepMs` apart: the checks ticking in Core's
 * order. With less motion, all at once. Returns how many are shown.
 */
export function useTicks(total: number, ready: boolean, stepMs = TICK_MS): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!ready) {
      setShown(0);
      return;
    }
    if (reduced) {
      setShown(total);
      return;
    }
    setShown(0);
    let at = 0;
    const id = setInterval(() => {
      at += 1;
      setShown(at);
      if (at >= total) clearInterval(id);
    }, stepMs);
    return () => clearInterval(id);
  }, [total, ready, reduced, stepMs]);
  return reduced && ready ? total : shown;
}

export const TICK_MS = 140;

// ── Words ──────────────────────────────────────────────────────────────────
//
// The twist's own words. Mono lines are written in sentence case; the mono style sets them in
// capitals. Core's names (checkRoute, eth_call, giveHash) stay as Core spells them. Where a
// check fails, the sentence is Core's refusal from i18n/common (`core.<Error>`), the same one
// every screen says.

type StepWords = {
  shake: { claim: string; margin: string; noMargin: string; key: string };
  give: {
    notRaiser: string;
    payee: string;
    claim: string;
    route: string;
    min: string;
    key: string;
    giver: string;
  };
};

const EN = {
  turnOver: "turn over to see what was checked",
  turnBack: "turned over; press again to turn back",
  tapBack: "Tap to turn back",
  backOfPass: "What this pass carries, checked here",
  backOfGive: "What this answer carries, checked here",
  backOfAsker: "The terms of this hand",
  backOfRow: "How this row is counted, and its record on chain",
  checking: "Checking…",
  notReached: "not reached",
  inOrder: "Checked in this browser, in Core's order",
  coreAnswer: "Core's own answer",
  share: "Share kept",
  shareOf: (pct: string, amount: string) => `${pct} · ${amount} at today's reward`,
  sharePct: (pct: string) => `${pct} of the reward`,
  noShare: "No share: passed it all on",
  lands: "Lands at",
  landsNowhere: "Nowhere: no share to pay",
  heldBy: "Key that held the link",
  nextKey: "Passed to key",
  claimLeft: "Helper's claim",
  confirmedBy: "Confirmed by",
  rebuilt: "giveHash rebuilt here",
  match: "giveHash matches Core",
  differ: "giveHash differs from Core",
  thanksRead: (block: string) => `thanks(id) · eth_call · block ${block}`,
  callLine: (fn: string, block: string, answer: string) => `${fn} · eth_call · block ${block} · ${answer}`,
  ok: "ok",
  wouldRevert: "would revert:",
  refusedAs: "refused:",
  offline: enCommon["common.time.offline"],
  terms: "Every step of the route seals these terms",
  termsMatch: "Terms match Core",
  termsDiffer: "Terms differ from Core",
  rewardNow: "Reward now",
  noReward: "No reward: a thank-you only",
  steps: {
    shake: {
      claim: "shares add up",
      margin: "names someone to pay",
      noMargin: "keeps no share, so needs no one to pay",
      key: "made by the key that held the link",
    },
    give: {
      notRaiser: "the helper is not the asker",
      payee: "says where the money lands",
      claim: "takes exactly what the route left",
      route: "made for this very route",
      min: "leaves the helper at least the asker's minimum",
      key: "made by the key that held the link",
      giver: "confirmed by the helper's own account",
    },
  } satisfies StepWords,
  row: {
    formula: "Formula",
    event: "Record on chain",
    margin: "margin = reward × (claimBps − nextClaimBps) ÷ 10 000",
    rest: "amount = reward − every margin",
    back: "the whole reward goes back to the asker",
    logged: "as Core logged it",
    nothing: "No reward: nothing moved",
    eventLine: (name: string, block: string, log: number) => `${name} · block ${block} · log ${log}`,
    tx: "tx",
  },
  sweep: { done: "every row found on chain" },
};

const RU: typeof EN = {
  turnOver: "переверни — там то, что проверено",
  turnBack: "перевёрнуто; нажми ещё раз, чтобы вернуть",
  tapBack: "Нажми, чтобы перевернуть обратно",
  backOfPass: "Что несёт эта передача — проверено здесь",
  backOfGive: "Что несёт этот ответ — проверено здесь",
  backOfAsker: "Условия этой руки",
  backOfRow: "Как посчитана эта строка и её запись в сети",
  checking: "Проверяю…",
  notReached: "не дошло",
  inOrder: "Проверено в этом браузере, в порядке Core",
  coreAnswer: "Ответ самого Core",
  share: "Оставил себе",
  shareOf: (pct: string, amount: string) => `${pct} · ${amount} при нынешней награде`,
  sharePct: (pct: string) => `${pct} награды`,
  noShare: "Без доли: передал всё дальше",
  lands: "Куда придут",
  landsNowhere: "Никуда: доли нет",
  heldBy: "Ключ, у которого была ссылка",
  nextKey: "Передано ключу",
  claimLeft: "Доля помогающего",
  confirmedBy: "Подтвердил",
  rebuilt: "giveHash пересчитан здесь",
  match: "giveHash совпадает с Core",
  differ: "giveHash не совпадает с Core",
  thanksRead: (block: string) => `thanks(id) · eth_call · блок ${block}`,
  callLine: (fn: string, block: string, answer: string) => `${fn} · eth_call · блок ${block} · ${answer}`,
  ok: "без отказа",
  wouldRevert: "иначе отказ:",
  refusedAs: "отказ:",
  offline: ruCommon["common.time.offline"],
  terms: "Каждый шаг пути скрепляет эти условия",
  termsMatch: "Условия совпадают с Core",
  termsDiffer: "Условия не совпадают с Core",
  rewardNow: "Награда сейчас",
  noReward: "Без награды: только спасибо",
  steps: {
    shake: {
      claim: "доли сходятся",
      margin: "назван тот, кому платить",
      noMargin: "доли не берёт — платить некому",
      key: "сделан ключом, у которого была ссылка",
    },
    give: {
      notRaiser: "помогает не сам автор",
      payee: "сказано, куда придут деньги",
      claim: "берёт ровно то, что оставил путь",
      route: "сделан именно для этого пути",
      min: "помогающему остаётся не меньше обещанного минимума",
      key: "сделан ключом, у которого была ссылка",
      giver: "подтверждён самим помогающим",
    },
  },
  row: {
    formula: "Формула",
    event: "Запись в сети",
    margin: "margin = reward × (claimBps − nextClaimBps) ÷ 10 000",
    rest: "amount = reward − все margin",
    back: "вся награда возвращается автору",
    logged: "как записал Core",
    nothing: "Без награды: ничего не двигалось",
    eventLine: (name: string, block: string, log: number) => `${name} · блок ${block} · лог ${log}`,
    tx: "транзакция",
  },
  sweep: { done: "каждая строка найдена в сети" },
};

export type TwistWords = typeof EN;

export const TWIST_WORDS: Record<Lang, TwistWords> = { en: EN, ru: RU };

export function useTwistWords(): TwistWords {
  return TWIST_WORDS[useLang()];
}

/**
 * Core's own names inside a mono line: camelCase fields and functions (payoutGasK, minClaimBps,
 * checkRoute), hands(id), eth_call, and error names (InvalidClaim). The kit's mono voice sets
 * lines in capitals; these keep Core's spelling (F15).
 */
const CORE_NAME = /(\b[a-z]+\(id\)|\beth_call\b|\b[a-z]+(?:[A-Z][a-z0-9]*)+\b|\b[A-Z][a-z]+(?:[A-Z][a-z0-9]*)+\b)/g;

/** A mono line whose Core names keep their own letters; the rest follows the line's style. */
export function CoreText({ text }: { text: string }) {
  const parts = text.split(CORE_NAME);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="ah-exact">
            {part}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** Core's refusal sentence for an error name, from i18n/common, in the reader's language. */
export function refusalSentence(name: string, lang: Lang): string | undefined {
  const table = (lang === "ru" ? ruCommon : enCommon) as Record<string, string>;
  return table[`core.${name}`];
}
