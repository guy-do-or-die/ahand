/**
 * Paths through the Hand model (hand.ts) and what the catalogue already plays of them.
 *
 *   - `modelPaths("shortest")`: one shortest path to every distinct end (a closed Hand with its
 *     passes, answer, top-up and extension): the nightly set;
 *   - `modelPaths("simple", k)`: every path to an end with at most k events, in every order.
 *   - `traceOf(scenario)`: each Hand a written scenario raises, read back as model events (its
 *     steps abstracted: a pass, an answer, a thank, a clock past the end…), run through the model.
 *     A step the model does not allow fails loudly: the scenario and the model disagree.
 *   - `coverage(scenarios, paths)`: which ends and which exact paths the catalogue reaches.
 */
import { getNextSnapshot, getInitialSnapshot } from "xstate";
import { getShortestPaths, getSimplePaths } from "xstate/graph";

import type { Scenario } from "../engine/scenario";
import { EVENTS, handModel, LIMITS, type HandContext, type HandEvent, type HandStateName } from "./hand";

export type EventName = HandEvent["type"];

export interface ModelPath {
  events: EventName[];
  end: HandStateName;
  context: HandContext;
  /** The end as one string: state and context ("thanked p2 g1 f0 e1"). */
  key: string;
}

type Snap = ReturnType<typeof getInitialSnapshot<typeof handModel>>;

export function keyOf(state: HandStateName, c: HandContext): string {
  return `${state} p${c.passes} g${c.gives} f${c.funds} e${c.extends}`;
}

function toPath(events: EventName[], snap: Snap): ModelPath {
  const end = snap.value as HandStateName;
  return { events, end, context: { ...snap.context }, key: keyOf(end, snap.context) };
}

const serializeState = (s: Snap) => JSON.stringify([s.value, s.context]);

export function modelPaths(mode: "shortest" | "simple", maxEvents = Infinity): ModelPath[] {
  const options = { events: EVENTS, serializeState, toState: (s: Snap) => s.status === "done" };
  const raw = mode === "shortest" ? getShortestPaths(handModel, options) : getSimplePaths(handModel, options);
  return raw
    // Each path starts with xstate's own init step: not a person's doing.
    .map((p) => toPath(p.steps.map((s) => s.event.type).filter((t) => !t.startsWith("xstate.")), p.state as Snap))
    .filter((p) => p.events.length <= maxEvents)
    .sort((a, b) => a.events.length - b.events.length || a.key.localeCompare(b.key) || a.events.join().localeCompare(b.events.join()));
}

/** Runs events through the model; an event the model refuses throws. */
export function walk(events: EventName[], where = "a path"): Snap {
  let snap = getInitialSnapshot(handModel);
  for (const [i, type] of events.entries()) {
    const next = getNextSnapshot(handModel, snap, { type } as HandEvent);
    if (next === snap || serializeState(next) === serializeState(snap)) throw new Error(`${where}: event ${i + 1} (${type}) is not allowed in "${snap.value as string}" with ${JSON.stringify(snap.context)}: ${events.join(" → ")}`);
    snap = next;
  }
  return snap;
}

export interface Trace {
  scenario: string;
  hand: string;
  events: EventName[];
  path: ModelPath;
  /** Steps the model counts once (a third pass, a second answer…): read past its limits. */
  capped: string[];
}

/**
 * Each Hand a scenario raises, as model events. Links are followed the way a person carries them:
 * a link opened by a persona belongs to the Hand it was made for, and so does what that persona
 * passes on or answers from it. Hands a seed fixture makes are not traced (their story happens
 * in the stand's seed, not in the scenario's steps).
 */
export function traceOf(s: Scenario): Trace[] {
  const traces = new Map<string, { events: EventName[]; days: number; capped: string[] }>();
  const handOfLink = new Map<string, string>();
  const opened = new Map<string, string>();
  let clock = 0;
  const raisedAt = new Map<string, number>();
  const count = (hand: string, type: EventName) => traces.get(hand)!.events.filter((e) => e === type).length;
  const add = (hand: string | undefined, type: EventName, step: number) => {
    if (!hand || !traces.has(hand)) return;
    const t = traces.get(hand)!;
    const limit = { PASS: LIMITS.passes, GIVE: LIMITS.gives, FUND: LIMITS.funds, EXTEND: LIMITS.extends }[type as "PASS"];
    // After an answer the model keeps the route as it is: later passes are another story.
    const pastLimit = (limit !== undefined && count(hand, type) >= limit) || (type === "PASS" && count(hand, "GIVE") > 0);
    const closed = t.events.some((e) => e === "THANK" || e === "SEND_BACK");
    if (pastLimit || closed) return void t.capped.push(`step ${step + 1} ${type}`);
    t.events.push(type);
  };
  for (const [i, step] of s.steps.entries()) {
    const who = step.who ?? "";
    switch (step.do) {
      case "raise":
      case "raise-sdk":
        traces.set(step.as, { events: ["RAISE"], days: step.do === "raise" ? (step.days ?? 30) : 30, capped: [] });
        raisedAt.set(step.as, clock);
        handOfLink.set(step.as, step.as);
        break;
      case "open":
        opened.set(who, handOfLink.get(step.link) ?? "");
        break;
      case "rebuild":
        handOfLink.set(step.as, step.hand);
        break;
      case "pass":
        handOfLink.set(step.as, opened.get(who) ?? "");
        add(opened.get(who), "PASS", i);
        break;
      case "pass-sdk": {
        const hand = handOfLink.get(step.link);
        handOfLink.set(step.as, hand ?? "");
        for (let n = 0; n < (step.until === "full" ? LIMITS.passes + 1 : (step.times ?? 1)); n++) add(hand, "PASS", i);
        break;
      }
      case "give":
        if (step.as) handOfLink.set(step.as, opened.get(who) ?? "");
        add(opened.get(who), "GIVE", i);
        break;
      case "give-sdk":
        handOfLink.set(step.as, handOfLink.get(step.link) ?? "");
        add(handOfLink.get(step.link), "GIVE", i);
        break;
      case "thank":
        add(step.hand ?? (step.link ? handOfLink.get(step.link) : undefined), "THANK", i);
        break;
      case "exit-thank":
        add(handOfLink.get(step.link), "THANK", i);
        break;
      case "fund":
        add(step.hand, "FUND", i);
        break;
      case "extend":
        if (traces.has(step.hand)) traces.get(step.hand)!.days += step.by === "max" ? 180 : step.by;
        add(step.hand, "EXTEND", i);
        break;
      case "clock":
        clock += step.days;
        for (const [hand, t] of traces) {
          const before = t.events.includes("TIME_UP");
          if (!before && clock - raisedAt.get(hand)! >= t.days && !t.events.some((e) => e === "THANK" || e === "SEND_BACK")) t.events.push("TIME_UP");
        }
        break;
      case "send-back":
        add(opened.get(who), "SEND_BACK", i);
        break;
    }
  }
  return [...traces].map(([hand, t]) => ({ scenario: s.id, hand, events: t.events, capped: t.capped, path: toPath(t.events, walk(t.events, `${s.id}, Hand "${hand}"`)) }));
}

export interface Coverage {
  traces: Trace[];
  /** Each path with the written scenarios that reach its end, and those that play it exactly. */
  paths: { path: ModelPath; sameEnd: string[]; samePath: string[] }[];
  /** Model transitions ("open p0 g0 f0 e0 --PASS-->") no written scenario takes. */
  untakenTransitions: string[];
  allTransitions: number;
}

function transitionsOf(events: EventName[]): string[] {
  let snap = getInitialSnapshot(handModel);
  const out: string[] = [];
  for (const type of events) {
    out.push(`${keyOf(snap.value as HandStateName, snap.context)} --${type}-->`);
    snap = getNextSnapshot(handModel, snap, { type } as HandEvent);
  }
  return out;
}

export function coverage(scenarios: Scenario[], paths: ModelPath[]): Coverage {
  const traces = scenarios.flatMap(traceOf);
  const label = (t: Trace) => (traces.filter((u) => u.scenario === t.scenario).length > 1 ? `${t.scenario} (${t.hand})` : t.scenario);
  const taken = new Set(traces.flatMap((t) => transitionsOf(t.events)));
  const every = new Set(modelPaths("simple").flatMap((p) => transitionsOf(p.events)));
  return {
    traces,
    paths: paths.map((path) => ({
      path,
      sameEnd: [...new Set(traces.filter((t) => t.path.key === path.key).map(label))],
      samePath: [...new Set(traces.filter((t) => t.events.join() === path.events.join()).map(label))],
    })),
    untakenTransitions: [...every].filter((t) => !taken.has(t)).sort(),
    allTransitions: every.size,
  };
}

/** A path in words, for the catalogue and the console. */
export function wordsOf(events: EventName[]): string {
  const say: Record<EventName, string> = { RAISE: "raise", PASS: "pass", GIVE: "answer", FUND: "top up", EXTEND: "extend", TIME_UP: "time's up", THANK: "thank", SEND_BACK: "send back" };
  return events.map((e) => say[e]).join(" → ");
}
