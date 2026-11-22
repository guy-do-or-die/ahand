/**
 * The landing's example Hands: what people ask their people for, as the person each one reaches
 * would see it. The set is there to show the range, so its members differ on three things at
 * once: the kind of need, the size of the reward (none, a few dollars, tens, hundreds, thousands)
 * and the shape of the route (no pass, one pass that kept nothing, a few passes with different
 * shares, a dozen and more).
 *
 * An example is here only if it really travels from person to person and paying on thanks suits
 * it: the answer is with someone the asker cannot find alone, a friend of a friend can point at
 * it, and the asker can tell whether it helped. Things a search or a marketplace does better, and
 * things it is unlawful or unsafe to reward, are left out (docs/app.md, "The landing's examples").
 *
 * This module holds what has no language: the amounts and the route. The asker's words are in the
 * catalogues, `landing.example.<id>.title` and `landing.example.<id>.details` in en.ts and ru.ts,
 * so they are typed for parity, read by the words guards, and only the reader's language is
 * fetched. None names a brand or a real person.
 */

/** The kind of need: every kind stands in the set at least once (examples.test.ts). */
export type Kind =
  /** A person to be found or an introduction. */
  | "person"
  /** A place to live. */
  | "home"
  /** A rare thing or a repair. */
  | "thing"
  /** A specialist. */
  | "expert"
  /** Something or someone lost. */
  | "lost"
  /** A job or a hire. */
  | "work"
  /** What only someone who lives there knows. */
  | "local"
  /** A favour that cannot wait. */
  | "favour"
  /** What only a friend of a friend still has or remembers. */
  | "memory";

export interface Example {
  /** Names the example's words in the catalogues and the example in tests. */
  id: string;
  kind: Kind;
  /** The reward in the stand-in dollar's smallest units. Zero is a Hand with no reward. */
  reward: bigint;
  /**
   * What each pass kept, in the route's order and the same units. Zero is a pass that kept nothing.
   * Core counts a pass's share in basis points of the reward, so each is a whole number of them:
   * an example shows only amounts a real Hand could show.
   */
  route: readonly bigint[];
  /** Whether the asker added a line of details under the title. */
  details: boolean;
}

/** The stand-in dollar's decimals. */
export const DECIMALS = 6;

const usd = (dollars: number): bigint => BigInt(dollars) * 10n ** BigInt(DECIMALS);
/** `passes` passes that kept nothing, but for the ones named by their place (from 0) and what they kept in dollars. */
const chain = (passes: number, kept: Record<number, number> = {}): bigint[] => Array.from({ length: passes }, (_, place) => usd(kept[place] ?? 0));

/**
 * In the order a visitor meets them. The first is the plain case (a reward in the tens, two passes
 * that each kept a share), and each next one differs from the one before it in kind, in reward
 * and in the shape of its route.
 */
export const EXAMPLES: readonly Example[] = [
  { id: "sublet", kind: "home", reward: usd(40), route: [usd(8), usd(4)], details: true },
  { id: "cat", kind: "lost", reward: usd(200), route: chain(9), details: true },
  { id: "bank", kind: "local", reward: usd(15), route: [], details: true },
  { id: "chef", kind: "work", reward: usd(2000), route: [usd(300), usd(150), usd(50)], details: false },
  { id: "wheelchair", kind: "favour", reward: 0n, route: [0n], details: true },
  { id: "recorder", kind: "thing", reward: usd(80), route: [0n, usd(10), usd(5)], details: true },
  { id: "medic", kind: "person", reward: usd(50), route: chain(17), details: true },
  { id: "drummer", kind: "favour", reward: usd(120), route: [usd(18), 0n], details: true },
  { id: "recipe", kind: "memory", reward: usd(10), route: [0n, usd(1), 0n], details: true },
  { id: "skipper", kind: "expert", reward: usd(1500), route: [usd(150), 0n, usd(75), usd(75)], details: true },
  { id: "documents", kind: "favour", reward: usd(30), route: [usd(3)], details: true },
  { id: "class", kind: "person", reward: 0n, route: chain(13), details: true },
  { id: "tortoise", kind: "expert", reward: usd(20), route: [], details: true },
  { id: "dairy", kind: "person", reward: usd(100), route: [usd(15), usd(10)], details: true },
  { id: "camera", kind: "lost", reward: usd(300), route: chain(12, { 2: 30, 5: 15, 9: 15 }), details: true },
  { id: "pastry", kind: "work", reward: usd(150), route: [0n, usd(30)], details: true },
  { id: "therapist", kind: "expert", reward: usd(60), route: [0n], details: true },
  { id: "photos", kind: "memory", reward: usd(25), route: [0n, 0n, usd(5)], details: true },
];

/** What the passes kept together. */
export const keptOf = (example: Example): bigint => example.route.reduce((sum, share) => sum + share, 0n);

/** What reaches whoever helps from the end of the route: the reward less what the passes kept. */
export const reachesOf = (example: Example): bigint => example.reward - keptOf(example);

/** The catalogue keys of an example's words. */
export const titleKey = (example: Example): string => `landing.example.${example.id}.title`;
export const detailsKey = (example: Example): string => `landing.example.${example.id}.details`;
