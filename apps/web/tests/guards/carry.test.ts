import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";

/**
 * The opened link carried across a social login (link-carry.ts): written only as the page leaves
 * while the login window is open on a screen holding a link, erased on every load and whenever the
 * login ends on the page, used only on the way back from Google, Apple or X within `CARRY_MS`, and
 * never a throw where storage refuses. Run in a happy-dom window, whose session storage stands in
 * for the tab's; the last test hides it behind a getter that throws, as a private window or blocked
 * site data does. The answer typed on /give goes with the link under a second key, for its own Hand
 * only.
 */

const SITE = "http://127.0.0.1:18312";
const LINK = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA-carried_text";
const RETURN = "?privy_oauth_code=one-time&privy_oauth_state=st&privy_oauth_provider=google";
const KEY = "ahand-link-carry";
const DRAFT_KEY = "ahand-give-draft";
const T0 = 1_800_000_000_000;
const CORE = "0x65aC000000000000000000000000000000002309";
const HAND = { chainId: 84532, core: CORE, handId: "8" };
const DRAFT = "A long answer, typed before logging in.\nSecond line.";

let carry: typeof import("../../src/link-carry");
let memory: typeof import("../../src/store/memory");
const logs: unknown[][] = [];

beforeAll(async () => {
  GlobalRegistrator.register({ url: `${SITE}/` });
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    spyOn(console, method).mockImplementation((...args: unknown[]) => void logs.push(args));
  }
  memory = await import("../../src/store/memory");
  carry = await import("../../src/link-carry");
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

afterEach(() => {
  carry.takeCarriedDraft(HAND); // lets go of a draft a test restored and left
  memory.forget();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

/** Opens `fragment` on `path` as link intake would, with a screen holding it; returns the release. */
function onScreen(path: string, hand = false, fragment = LINK): () => void {
  window.history.replaceState(hand ? { view: "hand" } : null, "", path);
  memory.remember({ before: `${SITE}${path}`, fragment, via: "address" });
  return carry.holdLink();
}

const leave = (target: EventTarget) => target.dispatchEvent(new Event("pagehide"));
const stored = () => sessionStorage.getItem(KEY);

describe("writing: only as the page leaves, only with a link on screen", () => {
  test("the login window open on a screen with a link: leaving writes the link, where it stood and when", () => {
    const release = onScreen("/31337/12?d=AAEC");
    const target = new EventTarget();
    const disarm = carry.armLinkCarry(target);
    expect(stored()).toBeNull(); // opening the window writes nothing
    leave(target);
    const written = JSON.parse(stored()!);
    expect(written).toMatchObject({ before: `${SITE}/31337/12?d=AAEC`, fragment: LINK, via: "address", path: "/31337/12", hand: false });
    expect(typeof written.at).toBe("number");
    release();
    disarm();
  });

  test("no link in memory, or no screen holding one: nothing is written", () => {
    const target = new EventTarget();
    const disarm = carry.armLinkCarry(target);
    const release = carry.holdLink();
    leave(target); // a screen that holds, but memory is empty
    expect(stored()).toBeNull();
    release();
    memory.remember({ before: `${SITE}/raise`, fragment: LINK, via: "address" });
    leave(target); // a link in memory, but /raise does not hold it
    expect(stored()).toBeNull();
    expect(carry.writeCarry(T0)).toBe(false);
    disarm();
  });

  test("a release twice takes back only its own hold", () => {
    const a = carry.holdLink();
    const b = carry.holdLink();
    a();
    a();
    memory.remember({ before: `${SITE}/give`, fragment: LINK, via: "address" });
    expect(carry.writeCarry(T0)).toBe(true); // b still holds
    b();
    sessionStorage.clear();
    expect(carry.writeCarry(T0)).toBe(false);
  });

  test("the login ends on the page (in, closed, failed): the key is erased and leaving later writes nothing", () => {
    const release = onScreen("/give");
    const target = new EventTarget();
    const disarm = carry.armLinkCarry(target);
    leave(target);
    expect(stored()).not.toBeNull();
    disarm();
    expect(stored()).toBeNull();
    leave(target);
    expect(stored()).toBeNull();
    disarm(); // twice is harmless
    release();
  });

  test("back from the back-forward cache with memory intact: erased; a plain pageshow keeps it", () => {
    const release = onScreen("/pass");
    const target = new EventTarget();
    const disarm = carry.armLinkCarry(target);
    leave(target);
    target.dispatchEvent(new Event("pageshow"));
    expect(stored()).not.toBeNull();
    target.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    expect(stored()).toBeNull();
    leave(target); // forward to the provider again: written again
    expect(stored()).not.toBeNull();
    disarm();
    release();
  });

  test("without a window there is nothing to arm", () => {
    const disarm = carry.armLinkCarry(undefined);
    expect(() => disarm()).not.toThrow();
  });
});

describe("taking it out: erased on every load, used only on the way back and in time", () => {
  const write = (path: string, at: number, hand = false) => {
    const release = onScreen(path, hand);
    expect(carry.writeCarry(at)).toBe(true);
    release();
    memory.forget(); // the fresh load forgot it
  };

  test("the way back within CARRY_MS: the link comes back and the key is gone", () => {
    write("/give", T0);
    const taken = carry.takeCarried(true, T0 + carry.CARRY_MS - 1);
    expect(taken).toMatchObject({ fragment: LINK, path: "/give", via: "address", at: T0 });
    expect(stored()).toBeNull();
    expect(carry.takeCarried(true, T0 + 1)).toBeUndefined(); // once only
  });

  test("any other load: erased unused", () => {
    write("/give", T0);
    expect(carry.takeCarried(false, T0 + 1)).toBeUndefined();
    expect(stored()).toBeNull();
  });

  test("older than CARRY_MS, or written in the future: erased unused", () => {
    write("/give", T0);
    expect(carry.takeCarried(true, T0 + carry.CARRY_MS)).toBeUndefined();
    expect(stored()).toBeNull();
    write("/give", T0 + 60_000);
    expect(carry.takeCarried(true, T0)).toBeUndefined();
    expect(stored()).toBeNull();
  });

  test("ten minutes: a social trip with a second factor fits, an abandoned one does not", () => {
    expect(carry.CARRY_MS).toBe(10 * 60_000);
  });

  test("anything else under the key: erased unused", () => {
    for (const junk of ["not json", "null", "{}", JSON.stringify({ before: "", fragment: "", via: "address", path: "/", hand: false, at: T0 }), JSON.stringify({ before: "", fragment: LINK, via: "address", path: "/#x", hand: false, at: T0 })]) {
      sessionStorage.setItem(KEY, junk);
      expect(carry.takeCarried(true, T0)).toBeUndefined();
      expect(stored()).toBeNull();
    }
  });
});

describe("restoring on load", () => {
  test("back from Google on a numbered Hand: memory holds the link with its old address, not Privy's code", () => {
    const release = onScreen("/31337/12?d=AAEC");
    carry.writeCarry(T0);
    release();
    memory.forget();
    window.history.replaceState(null, "", `/31337/12${RETURN}`);
    expect(carry.restoreCarriedLink(true, T0 + 30_000)).toBe(true);
    expect(memory.openedLink()).toEqual({ before: `${SITE}/31337/12?d=AAEC`, fragment: LINK, via: "address" });
    expect(memory.addressOf()).not.toContain("privy_oauth");
    expect(window.location.hash).toBe(""); // never back in the address bar
    expect(window.location.search).toBe(RETURN); // Privy's query is left for Privy
    expect(stored()).toBeNull();
  });

  test("a bare link on /: the entry is marked as the Hand view again", () => {
    const release = onScreen("/", true);
    carry.writeCarry(T0);
    release();
    memory.forget();
    window.history.replaceState(null, "", `/${RETURN}`);
    expect(carry.restoreCarriedLink(true, T0 + 1)).toBe(true);
    expect(window.history.state).toEqual({ view: "hand" });
    expect(window.location.pathname + window.location.search).toBe(`/${RETURN}`);
    expect(memory.openedLink()?.fragment).toBe(LINK);
  });

  test("Privy's cleanup wipes the mark (its replaceState({}) as it takes its code out): the mark comes back, and the router drops Privy's query", async () => {
    const router = await import("../../src/router");
    const release = onScreen("/", true);
    carry.writeCarry(T0);
    release();
    memory.forget();
    window.history.replaceState(null, "", `/${RETURN}`);
    router.refresh();
    expect(carry.restoreCarriedLink(true, T0 + 1)).toBe(true);
    await Bun.sleep(carry.MARK_EVERY_MS * 2); // Privy still finishing: its query is there, nothing changes
    expect(window.history.state).toEqual({ view: "hand" });
    window.history.replaceState({}, "", "/"); // Privy 3.51.3's Dr()
    expect(window.history.state).toEqual({});
    await Bun.sleep(carry.MARK_EVERY_MS * 3);
    expect(window.history.state).toEqual({ view: "hand" });
    expect(router.placeNow()).toEqual({ path: "/", search: "", state: { view: "hand" } });
  });

  test("Privy's cleanup after the person moved on to the start page: no mark is put back", async () => {
    const router = await import("../../src/router");
    const release = onScreen("/", true);
    carry.writeCarry(T0);
    release();
    memory.forget();
    window.history.replaceState(null, "", `/${RETURN}`);
    router.refresh();
    expect(carry.restoreCarriedLink(true, T0 + 1)).toBe(true);
    router.navigate("/"); // the start page, a new entry with no mark
    window.history.replaceState({}, "", "/");
    await Bun.sleep(carry.MARK_EVERY_MS * 3);
    expect(window.history.state).toEqual({});
    expect(router.placeNow().state).toBeNull();
  });

  test("the way back landed on another path: erased unused", () => {
    const release = onScreen("/give");
    carry.writeCarry(T0);
    release();
    memory.forget();
    window.history.replaceState(null, "", `/pass${RETURN}`);
    expect(carry.restoreCarriedLink(true, T0 + 1)).toBe(false);
    expect(memory.openedLink()).toBeUndefined();
    expect(stored()).toBeNull();
  });

  test("the address brought a link of its own: that one stays, the carried one is erased", () => {
    const release = onScreen("/give");
    carry.writeCarry(T0);
    release();
    memory.remember({ before: `${SITE}/give`, fragment: "newer-link", via: "address" });
    window.history.replaceState(null, "", `/give${RETURN}`);
    expect(carry.restoreCarriedLink(true, T0 + 1)).toBe(false);
    expect(memory.openedLink()?.fragment).toBe("newer-link");
    expect(stored()).toBeNull();
  });

  test("not the way back from a social login: erased, nothing restored", () => {
    const release = onScreen("/give");
    carry.writeCarry(T0);
    release();
    memory.forget();
    expect(carry.restoreCarriedLink(false, T0 + 1)).toBe(false);
    expect(memory.openedLink()).toBeUndefined();
    expect(stored()).toBeNull();
  });
});

describe("the answer draft on /give: with the link, for its own Hand, once", () => {
  const draftStored = () => sessionStorage.getItem(DRAFT_KEY);

  /** /give with a link and `text` typed for `hand`; returns the release of both holds. */
  function typing(text: string, hand = HAND): () => void {
    const release = onScreen("/give");
    const releaseDraft = carry.holdDraft(hand, text);
    return () => {
      releaseDraft();
      release();
    };
  }

  /** Written as the page left at `at`, then the fresh load on the way back to /give. */
  function leaveAndReturn(text: string, at = T0, hand = HAND): void {
    const release = typing(text, hand);
    expect(carry.writeCarry(at)).toBe(true);
    release();
    memory.forget();
    window.history.replaceState(null, "", `/give${RETURN}`);
  }

  test("leaving while the login window is open writes the draft beside the link, with its Hand and the same time", () => {
    const release = typing(DRAFT);
    const target = new EventTarget();
    const disarm = carry.armLinkCarry(target);
    expect(draftStored()).toBeNull();
    leave(target);
    const link = JSON.parse(stored()!);
    const written = JSON.parse(draftStored()!);
    expect(written).toEqual({ chainId: 84532, core: CORE.toLowerCase(), handId: "8", text: DRAFT, at: link.at });
    disarm();
    release();
  });

  test("an empty or blank field writes no draft, and erases one left from before", () => {
    sessionStorage.setItem(DRAFT_KEY, "left over");
    const release = typing("  \n ");
    expect(carry.writeCarry(T0)).toBe(true);
    expect(stored()).not.toBeNull();
    expect(draftStored()).toBeNull();
    release();
  });

  test("a draft but no link on screen, or no link in memory: nothing at all is written", () => {
    const releaseDraft = carry.holdDraft(HAND, DRAFT);
    memory.remember({ before: `${SITE}/give`, fragment: LINK, via: "address" });
    expect(carry.writeCarry(T0)).toBe(false); // nothing holds the link
    memory.forget();
    const release = carry.holdLink();
    expect(carry.writeCarry(T0)).toBe(false); // nothing in memory
    expect(stored()).toBeNull();
    expect(draftStored()).toBeNull();
    release();
    releaseDraft();
  });

  test("a released draft is not written; an older release leaves the newer draft held", () => {
    const release = onScreen("/give");
    const first = carry.holdDraft(HAND, "first");
    const second = carry.holdDraft(HAND, "second");
    first();
    carry.writeCarry(T0);
    expect(JSON.parse(draftStored()!).text).toBe("second");
    second();
    carry.writeCarry(T0);
    expect(draftStored()).toBeNull();
    release();
  });

  test("the login ends on the page, or the page comes back from the back-forward cache: the draft is erased with the link", () => {
    const release = typing(DRAFT);
    const target = new EventTarget();
    const disarm = carry.armLinkCarry(target);
    leave(target);
    target.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    expect(stored()).toBeNull();
    expect(draftStored()).toBeNull();
    leave(target);
    expect(draftStored()).not.toBeNull();
    disarm();
    expect(stored()).toBeNull();
    expect(draftStored()).toBeNull();
    release();
  });

  test("the way back to /give within CARRY_MS: the same Hand gets the draft once, and both keys are gone", () => {
    leaveAndReturn(DRAFT);
    expect(carry.restoreCarriedLink(true, T0 + 30_000)).toBe(true);
    expect(stored()).toBeNull();
    expect(draftStored()).toBeNull();
    expect(carry.takeCarriedDraft({ chainId: 84532, core: CORE.toLowerCase(), handId: "8" })).toBe(DRAFT);
    expect(carry.takeCarriedDraft(HAND)).toBeUndefined(); // once only
  });

  test("another Hand (another number, Core or chain): nothing, and the draft is let go", () => {
    for (const other of [
      { ...HAND, handId: "9" },
      { ...HAND, core: "0x0000000000000000000000000000000000000001" },
      { ...HAND, chainId: 8453 },
    ]) {
      leaveAndReturn(DRAFT);
      expect(carry.restoreCarriedLink(true, T0 + 1)).toBe(true);
      expect(carry.takeCarriedDraft(other)).toBeUndefined();
      expect(carry.takeCarriedDraft(HAND)).toBeUndefined();
      memory.forget();
    }
  });

  test("memory moved on to another link before /give took it: nothing", () => {
    leaveAndReturn(DRAFT);
    expect(carry.restoreCarriedLink(true, T0 + 1)).toBe(true);
    memory.remember({ before: `${SITE}/give`, fragment: "another-link", via: "paste" });
    expect(carry.takeCarriedDraft(HAND)).toBeUndefined();

    leaveAndReturn(DRAFT);
    expect(carry.restoreCarriedLink(true, T0 + 1)).toBe(true);
    memory.forget();
    expect(carry.takeCarriedDraft(HAND)).toBeUndefined();
  });

  test("not the way back, too late, another path, or a link in the address: both keys erased, no draft", () => {
    leaveAndReturn(DRAFT);
    expect(carry.restoreCarriedLink(false, T0 + 1)).toBe(false);
    expect(draftStored()).toBeNull();
    expect(carry.takeCarriedDraft(HAND)).toBeUndefined();

    leaveAndReturn(DRAFT);
    expect(carry.restoreCarriedLink(true, T0 + carry.CARRY_MS)).toBe(false);
    expect(draftStored()).toBeNull();
    expect(carry.takeCarriedDraft(HAND)).toBeUndefined();

    leaveAndReturn(DRAFT);
    window.history.replaceState(null, "", `/pass${RETURN}`);
    expect(carry.restoreCarriedLink(true, T0 + 1)).toBe(false);
    expect(draftStored()).toBeNull();
    expect(carry.takeCarriedDraft(HAND)).toBeUndefined();

    leaveAndReturn(DRAFT);
    memory.remember({ before: `${SITE}/give`, fragment: "newer-link", via: "address" });
    expect(carry.restoreCarriedLink(true, T0 + 1)).toBe(false);
    expect(draftStored()).toBeNull();
    expect(carry.takeCarriedDraft(HAND)).toBeUndefined();
  });

  test("a draft with no link beside it, from another write, or not of the written shape: erased unused, the link still comes back", () => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...HAND, core: CORE.toLowerCase(), text: DRAFT, at: T0 }));
    expect(carry.takeCarried(true, T0 + 1)).toBeUndefined();
    expect(draftStored()).toBeNull();

    leaveAndReturn(DRAFT);
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...HAND, core: CORE.toLowerCase(), text: DRAFT, at: T0 - 1 }));
    expect(carry.restoreCarriedLink(true, T0 + 1)).toBe(true);
    expect(carry.takeCarriedDraft(HAND)).toBeUndefined();
    memory.forget();

    for (const junk of ["not json", "null", "{}", JSON.stringify({ ...HAND, text: DRAFT, at: T0 }), JSON.stringify({ ...HAND, core: CORE.toLowerCase(), text: "x".repeat(carry.DRAFT_MAX_UNITS + 1), at: T0 }), JSON.stringify({ ...HAND, core: CORE.toLowerCase(), handId: "8a", text: DRAFT, at: T0 })]) {
      leaveAndReturn(DRAFT);
      sessionStorage.setItem(DRAFT_KEY, junk);
      expect(carry.restoreCarriedLink(true, T0 + 1)).toBe(true);
      expect(draftStored()).toBeNull();
      expect(carry.takeCarriedDraft(HAND)).toBeUndefined();
      memory.forget();
    }
  });

  test("the longest draft the field allows fits: 1000 characters, 2000 UTF-16 units at most", async () => {
    const { MAX_WORDS } = await import("../../src/screens/give/flow");
    expect(carry.DRAFT_MAX_UNITS).toBe(2 * MAX_WORDS);
    const longest = "😀".repeat(MAX_WORDS);
    leaveAndReturn(longest);
    expect(carry.restoreCarriedLink(true, T0 + 1)).toBe(true);
    expect(carry.takeCarriedDraft(HAND)).toBe(longest);
  });

  test("storage refusing only the draft (full): the link still goes, the field comes back empty", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    const real = sessionStorage;
    const full = {
      getItem: (key: string) => real.getItem(key),
      removeItem: (key: string) => real.removeItem(key),
      setItem: (key: string, value: string) => {
        if (key === DRAFT_KEY) throw new Error("QuotaExceededError");
        real.setItem(key, value);
      },
    };
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get: () => full });
    try {
      leaveAndReturn(DRAFT);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "sessionStorage", descriptor);
    }
    expect(draftStored()).toBeNull();
    expect(carry.restoreCarriedLink(true, T0 + 1)).toBe(true);
    expect(carry.takeCarriedDraft(HAND)).toBeUndefined();
  });

  test("refusing to read the link key: the draft key is still erased", () => {
    leaveAndReturn(DRAFT);
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    const real = sessionStorage;
    const partial = {
      getItem: (key: string) => {
        if (key === KEY) throw new Error("SecurityError");
        return real.getItem(key);
      },
      removeItem: (key: string) => real.removeItem(key),
      setItem: (key: string, value: string) => real.setItem(key, value),
    };
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get: () => partial });
    try {
      expect(carry.takeCarried(true, T0 + 1)).toBeUndefined();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "sessionStorage", descriptor);
    }
    expect(draftStored()).toBeNull();
  });
});

describe("storage that refuses", () => {
  test("a private window or blocked site data: nothing written, nothing restored, nothing thrown", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      const release = onScreen("/give");
      const releaseDraft = carry.holdDraft(HAND, DRAFT);
      const target = new EventTarget();
      const disarm = carry.armLinkCarry(target);
      expect(() => leave(target)).not.toThrow();
      expect(carry.writeCarry(T0)).toBe(false);
      expect(() => disarm()).not.toThrow();
      expect(() => carry.eraseCarry()).not.toThrow();
      releaseDraft();
      release();
      memory.forget();
      expect(carry.takeCarried(true, T0)).toBeUndefined();
      expect(carry.restoreCarriedLink(true, T0)).toBe(false);
      expect(memory.openedLink()).toBeUndefined(); // the old way: open the link once more
      expect(carry.takeCarriedDraft(HAND)).toBeUndefined(); // and type the answer again
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "sessionStorage", descriptor);
    }
  });

  test("nothing of the link or the draft reached the console", () => {
    expect(JSON.stringify(logs).includes(LINK)).toBe(false);
    expect(JSON.stringify(logs).includes("typed before logging in")).toBe(false);
    expect(logs).toEqual([]);
  });
});
