import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";

/**
 * The opened link carried across a social login (link-carry.ts; docs/defaults.md question 11,
 * option b): written only as the page leaves while the login window is open on a screen holding a
 * link, erased on every load and whenever the login ends on the page, used only on the way back
 * from Google, Apple or X within `CARRY_MS`, and never a throw where storage refuses. Run in a
 * happy-dom window, whose session storage stands in for the tab's; the last test hides it behind a
 * getter that throws, as a private window or blocked site data does.
 */

const SITE = "http://127.0.0.1:18312";
const LINK = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA-carried_text";
const RETURN = "?privy_oauth_code=one-time&privy_oauth_state=st&privy_oauth_provider=google";
const KEY = "ahand-link-carry";
const T0 = 1_800_000_000_000;

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
      const target = new EventTarget();
      const disarm = carry.armLinkCarry(target);
      expect(() => leave(target)).not.toThrow();
      expect(carry.writeCarry(T0)).toBe(false);
      expect(() => disarm()).not.toThrow();
      expect(() => carry.eraseCarry()).not.toThrow();
      release();
      memory.forget();
      expect(carry.takeCarried(true, T0)).toBeUndefined();
      expect(carry.restoreCarriedLink(true, T0)).toBe(false);
      expect(memory.openedLink()).toBeUndefined(); // the old way: open the link once more
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "sessionStorage", descriptor);
    }
  });

  test("nothing of the link reached the console", () => {
    expect(JSON.stringify(logs).includes(LINK)).toBe(false);
    expect(logs).toEqual([]);
  });
});
