/**
 * A model path (paths.ts) as a scenario the engine plays: the same people every time, each event
 * one or two steps, and the model's own prediction as the checks: the Hand's state after every
 * step that touches the chain, and at the end who received what.
 *
 *   RAISE     Nina raises 5 test dollars for 7 days, unlisted
 *   PASS      the next holder (Alex, then Bea) opens the latest link and passes it on keeping 10%
 *   GIVE      Gina opens the latest link and answers with her wallet
 *   FUND      Nina adds 5 on Care
 *   EXTEND    Nina keeps it open 30 days longer on Care
 *   TIME_UP   the chain's clock moves a day past the end
 *   THANK     Nina thanks from My hands
 *   SEND_BACK Vic, a stranger, opens Nina's link and sends the reward back
 */
import { defineScenario, type Persona, type Scenario, type Step } from "../engine/scenario";
import type { ModelPath } from "./paths";
import { wordsOf } from "./paths";

const REWARD = 5;
const DAYS = 7;
const KEEP_BPS = 1000;
const HOLDERS = [
  ["alex", "Alex"],
  ["bea", "Bea"],
] as const;

function dollars(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

export function scenarioOf(path: ModelPath): Scenario {
  const id = `model-${path.events.slice(1).map((e) => e.toLowerCase().replace("_", "-")).join("-")}`;
  const personas: Record<string, Persona> = { nina: { name: "Nina", role: "asker", wallet: { kind: "dev", account: 1 } } };
  const steps: Step[] = [];
  let link = "h";
  let passes = 0;
  let funded = 0;
  let extended = 0;
  for (const event of path.events) {
    switch (event) {
      case "RAISE":
        steps.push({ who: "nina", do: "raise", title: `Model path: ${wordsOf(path.events)}`, reward: "5", days: DAYS, visibility: "unlisted", as: "h", expect: [{ hand: "h", state: "open", reward: dollars(REWARD) }] });
        break;
      case "PASS": {
        const [key, name] = HOLDERS[passes]!;
        personas[key] = { name, role: "holder", wallet: { kind: "none" } };
        const next = `h-${++passes}`;
        steps.push({ who: key, do: "open", link }, { who: key, do: "pass", keepBps: KEEP_BPS, payee: "fresh-address", as: next });
        link = next;
        break;
      }
      case "GIVE":
        personas.gina = { name: "Gina", role: "helper", wallet: { kind: "dev", account: 4 } };
        steps.push({ who: "gina", do: "open", link }, { who: "gina", do: "give", words: "I can help with this; message me.", payee: "wallet" });
        break;
      case "FUND":
        funded += REWARD;
        steps.push({ who: "nina", do: "fund", hand: "h", amount: dollars(REWARD), expect: [{ hand: "h", state: "open", reward: dollars(REWARD + funded) }] });
        break;
      case "EXTEND":
        extended += 30;
        steps.push({ who: "nina", do: "extend", hand: "h", by: 30, expect: [{ assert: "expiry-moved", arg: "30" }, { hand: "h", state: "open" }] });
        break;
      case "TIME_UP":
        steps.push({ do: "clock", days: DAYS + extended + 1, expect: [{ hand: "h", state: "expired" }] });
        break;
      case "THANK":
        steps.push({ who: "nina", do: "thank", hand: "h", expect: [{ hand: "h", state: "thanked" }] });
        break;
      case "SEND_BACK":
        personas.vic = { name: "Vic", role: "visitor", wallet: { kind: "dev", account: 5 } };
        steps.push({ who: "vic", do: "open", link: "h" }, { who: "vic", do: "send-back", expect: [{ hand: "h", state: "refunded" }] });
        break;
    }
  }
  const total = REWARD + funded;
  const checks: Scenario["checks"] =
    path.end === "thanked"
      ? [
          { hand: "h", state: "thanked" },
          ...HOLDERS.slice(0, passes).map(([key]) => ({ received: key, amount: dollars((total * KEEP_BPS) / 10_000) })),
          { received: "gina", amount: dollars((total * (10_000 - KEEP_BPS * passes)) / 10_000) },
        ]
      : [{ hand: "h", state: "refunded" }, { askerWhole: "h" }];
  return defineScenario({
    id,
    title: wordsOf(path.events),
    story: `Generated from the Hand model (tests/demo/model): ${wordsOf(path.events)}. Ends ${path.key}.`,
    covers: [],
    targets: path.events.includes("TIME_UP") ? ["stand", "fork"] : ["stand", "fork", "site"],
    tags: ["generated", "model"],
    personas,
    steps,
    checks,
  });
}
