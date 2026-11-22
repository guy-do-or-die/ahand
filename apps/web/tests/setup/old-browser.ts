/**
 * Every unit test runs without what Safari 15.4 does not have, so code that calls one of these
 * fails here and not on someone's phone. A phone that was never updated keeps its first Safari:
 * an iPhone 14 on iOS 16.0 is still in use, and the app's stylesheets are written for 15.4 up.
 *
 * Taken away (the Safari that brought each): AbortSignal.any and Promise.withResolvers (17.4),
 * Object.groupBy and Map.groupBy (17.4), the Set algebra (17.0), Array.fromAsync (16.4),
 * AbortSignal.timeout and the copying array methods toSorted, toReversed, toSpliced and with (16.0).
 * tests/guards/browser.test.ts reads the sources for the same names and for what cannot be taken
 * away at run time (a regular expression that looks behind, 16.4).
 */
const drop = (owner: object, names: readonly string[]): void => {
  for (const name of names) Reflect.deleteProperty(owner, name);
};

drop(AbortSignal, ["any", "timeout"]);
drop(Promise, ["withResolvers"]);
drop(Object, ["groupBy"]);
drop(Map, ["groupBy"]);
drop(Array, ["fromAsync"]);
drop(Array.prototype, ["toSorted", "toReversed", "toSpliced", "with"]);
drop(Set.prototype, ["union", "intersection", "difference", "symmetricDifference", "isSubsetOf", "isSupersetOf", "isDisjointFrom"]);
