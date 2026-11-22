/** The catalogue: every scenario the engine knows, in the order the catalogue lists them. */
import type { Scenario } from "../engine/scenario";
import firstLoop from "./first-loop";
import firstThanks from "./first-thanks";
import life from "./life";
import relayDown from "./relay-down";
import { care, entropySigner, exitWithoutSite, lostAndFound, notSetUp, offline, proofAndCheck, rebuild, reloadForgets, resigned, routeFull, takeOut } from "./more";
import { appHop, blockedPayee, branching, hiring, publicPages, zeroReward } from "./simple";
import { longChain } from "./long-chain";
import { privyEmail } from "./privy";
import timesUp from "./times-up";

/** The same story with the helper on an injected EIP-6963 wallet (the kind used on a fork or a branch site). */
const injectedHelper: Scenario = {
  ...firstThanks,
  id: "first-thanks-injected-helper",
  title: "The same loop, the helper on an injected EIP-6963 wallet",
  targets: ["stand", "fork"],
  story: "As first-thanks, but Gina's wallet is announced to the page through EIP-6963 and signs in the test process, as on a fork or a branch site.",
  tags: ["core-loop", "wallet-kind"],
  personas: { ...firstThanks.personas, gina: { name: "Gina", role: "helper", wallet: { kind: "injected", account: 7 } } },
};

export const SCENARIOS: Scenario[] = [firstLoop, life, firstThanks, injectedHelper, timesUp, longChain(3, "dark"), longChain(2, "public"), relayDown, zeroReward, branching, hiring, appHop, blockedPayee,
  takeOut, care, resigned, notSetUp, entropySigner, rebuild, reloadForgets, offline, proofAndCheck, routeFull, lostAndFound, exitWithoutSite, publicPages, privyEmail];
