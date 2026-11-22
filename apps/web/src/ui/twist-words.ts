import enCommon from "../i18n/common/en";
import ruCommon from "../i18n/common/ru";
import type { Lang } from "./ambient";

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
  turnBack: "turned over. Press again to turn back",
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
  turnBack: "перевёрнуто. Нажми ещё раз, чтобы вернуть",
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
