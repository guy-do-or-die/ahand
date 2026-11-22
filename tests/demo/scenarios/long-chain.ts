import { defineScenario, type Persona, type Step, type Visibility } from "../engine/scenario";

/**
 * A generated family: a chain of `holders` walletless people passing at 0% before the helper,
 * in a given visibility. One function, many catalogue entries (length × visibility).
 */
export function longChain(holders: number, visibility: Visibility) {
  const names = ["Alex", "Bea", "Cem", "Dana", "Emil", "Fay", "Gus", "Hana"];
  if (holders < 1 || holders > names.length) throw new Error(`1 to ${names.length} holders`);
  const personas: Record<string, Persona> = { nina: { name: "Nina", role: "asker", wallet: { kind: "dev", account: 1 } } };
  const steps: Step[] = [{ who: "nina", do: "raise", title: `A long route, ${visibility}: who can fix an old radio?`, reward: "50", visibility, as: "radio-0" }];
  for (let i = 0; i < holders; i++) {
    const key = names[i]!.toLowerCase();
    personas[key] = { name: names[i]!, role: "holder", wallet: { kind: "none" } };
    steps.push({ who: key, do: "open", link: `radio-${i}` }, { who: key, do: "pass", as: `radio-${i + 1}` });
  }
  personas.gina = { name: "Gina", role: "helper", wallet: { kind: "dev", account: 4 } };
  steps.push(
    { who: "gina", do: "open", link: `radio-${holders}`, caption: `Gina opens the link: ${holders + 1} hands on the rail` },
    { who: "gina", do: "give", words: "I repair valve radios; bring it on Saturday.", payee: "wallet" },
    { who: "nina", do: "thank", hand: "radio-0" },
  );
  return defineScenario({
    id: `long-chain-${holders}-${visibility}`,
    title: `${holders} walletless holders pass a ${visibility} hand at 0%; the helper gets it all`,
    story: `Generated: ${holders} people pass the link on and keep nothing; the helper receives the whole reward.`,
    covers: ["U1", "U10", ...(visibility === "dark" ? ["U13"] : [])],
    targets: ["stand", "fork", "site"],
    tags: ["generated", "route-length", visibility],
    personas,
    steps,
    checks: [
      { hand: "radio-0", state: "thanked" },
      { received: "gina", amount: "50" },
    ],
  });
}
