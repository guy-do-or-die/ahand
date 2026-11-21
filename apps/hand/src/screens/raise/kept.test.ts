import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { closeDb, configureDb, loadPrefs } from "../../store/db";
import { dropKeptRaise, keepRaise, KEPT_MS, takeKeptRaise, type RaiseForm } from "./kept";

let run = 0;
beforeEach(() => configureDb({ name: `ahand-kept-${run++}` }));
afterEach(() => closeDb());

const FORM: RaiseForm = {
  poster: "Who can fix my bike's gears?",
  details: "Shimano, 8 speeds.",
  showDetails: true,
  rewardKey: "custom",
  custom: "12500000",
  days: 14,
  mode: "unlisted",
  minClaimBps: 7000,
  payoutGasK: 250,
};

describe("the raise form across a social login", () => {
  test("kept while the login is open, taken back once as /raise opens, and gone from storage after", async () => {
    await keepRaise(FORM, 1_000);
    expect((await loadPrefs()).raiseForm).toEqual({ ...FORM, at: 1_000 });
    expect(await takeKeptRaise(1_000 + KEPT_MS - 1)).toEqual(FORM);
    expect((await loadPrefs()).raiseForm).toBeUndefined();
    expect(await takeKeptRaise(1_000 + KEPT_MS - 1)).toBeUndefined();
  });

  test("a login that ended on the page leaves nothing", async () => {
    await keepRaise(FORM, 1_000);
    await dropKeptRaise();
    expect(await takeKeptRaise(1_000)).toBeUndefined();
  });

  test("older than half an hour, or written by a clock ahead of this one: removed and not filled in", async () => {
    await keepRaise(FORM, 1_000);
    expect(await takeKeptRaise(1_000 + KEPT_MS)).toBeUndefined();
    expect((await loadPrefs()).raiseForm).toBeUndefined();
    await keepRaise(FORM, 5_000);
    expect(await takeKeptRaise(4_000)).toBeUndefined();
    expect((await loadPrefs()).raiseForm).toBeUndefined();
  });
});
