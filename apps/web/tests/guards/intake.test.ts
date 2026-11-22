import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";

/**
 * Link intake and the router in a happy-dom window: opening `/#<text>` leaves no fragment
 * in the address, memory holds the text, the entry is marked as the Hand view, nothing reaches
 * the console or storage, and the router never routes a fragment.
 */

const SITE = "http://127.0.0.1:18311";
const TEXT = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA-any_text.with~marks";

let intake: typeof import("../../src/link-intake");
let memory: typeof import("../../src/store/memory");
let router: typeof import("../../src/router");
const logs: unknown[][] = [];

beforeAll(async () => {
  GlobalRegistrator.register({ url: `${SITE}/#${TEXT}` });
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    spyOn(console, method).mockImplementation((...args: unknown[]) => void logs.push(args));
  }
  memory = await import("../../src/store/memory");
  router = await import("../../src/router");
  intake = await import("../../src/link-intake");
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

describe("link intake", () => {
  test("opening /#<text>: the address loses its fragment, memory holds the text", () => {
    expect(window.location.href).toBe(`${SITE}/#${TEXT}`);
    const stop = intake.startIntake();
    expect(window.location.href).toBe(`${SITE}/`);
    expect(window.location.hash).toBe("");
    expect(memory.openedLink()).toEqual({ before: `${SITE}/`, fragment: TEXT, via: "address" });
    expect(memory.addressOf()).toBe(`${SITE}/#${TEXT}`);
    expect(window.history.state).toEqual({ view: "hand" });
    router.refresh();
    stop();
  });

  test("a numbered or described address keeps its path and ?d=, loses only the fragment", () => {
    window.history.replaceState(null, "", "/31337/12?d=AAEC#second-link");
    expect(intake.intake()).toBe(true);
    expect(window.location.href).toBe(`${SITE}/31337/12?d=AAEC`);
    expect(memory.openedLink()?.fragment).toBe("second-link");
    expect(memory.openedLink()?.before).toBe(`${SITE}/31337/12?d=AAEC`);
    expect(window.history.state).toBeNull(); // the path itself names the Hand view
  });

  test("an empty fragment is stripped and nothing is remembered in its place", () => {
    memory.forget();
    window.history.replaceState(null, "", "/raise#");
    expect(intake.intake()).toBe(false);
    expect(window.location.href).toBe(`${SITE}/raise`);
    expect(memory.openedLink()).toBeUndefined();
  });

  test("an address with no fragment is left alone", () => {
    window.history.replaceState({ view: "hand" }, "", "/");
    expect(intake.intake()).toBe(false);
    expect(window.history.state).toEqual({ view: "hand" });
  });

  test("nothing of the link reached the console or storage", () => {
    const everything = JSON.stringify(logs) + JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage }) + document.cookie;
    expect(everything.includes(TEXT)).toBe(false);
    expect(everything.includes("second-link")).toBe(false);
    expect(logs).toEqual([]);
  });

  test("a pasted address is split at its first #; a bare link is kept whole", () => {
    memory.rememberText("  https://ahand.example/1/2#abc#def  ");
    expect(memory.openedLink()).toEqual({ before: "https://ahand.example/1/2", fragment: "abc#def", via: "paste" });
    memory.rememberText("123456789", "handover");
    expect(memory.openedLink()).toEqual({ before: "", fragment: "123456789", via: "handover" });
    expect(memory.addressOf()).toBe("123456789");
    memory.forget();
    expect(memory.addressOf()).toBeUndefined();
  });
});

describe("router", () => {
  test("navigate pushes a path, resets the scroll and refuses a fragment", () => {
    window.scrollTo(0, 500);
    router.navigate("/raise");
    expect(window.location.pathname).toBe("/raise");
    expect(window.scrollY).toBe(0);
    expect(() => router.navigate("/#secret")).toThrow(/fragment/);
    expect(() => router.navigate("https://elsewhere.example/")).toThrow();
    expect(window.location.href).toBe(`${SITE}/raise`);
  });

  test("matchPath takes params by their rules", () => {
    const rules = { chain: /^[0-9]+$/, hand: /^[0-9]+$/ };
    expect(router.matchPath("/:chain/:hand", "/31337/12", rules)).toEqual({ chain: "31337", hand: "12" });
    expect(router.matchPath("/:chain/:hand", "/31337/12/", rules)).toEqual({ chain: "31337", hand: "12" });
    expect(router.matchPath("/:chain/:hand", "/my/12", rules)).toBeUndefined();
    expect(router.matchPath("/:chain/:hand/proof", "/1/2/proof", rules)).toEqual({ chain: "1", hand: "2" });
    expect(router.matchPath("/pass", "/pass")).toEqual({});
    expect(router.matchPath("/pass", "/passes")).toBeUndefined();
    expect(router.matchPath("/", "/")).toEqual({});
    expect(router.matchPath("/:x", "/%E0%A4%A")).toBeUndefined();
  });

  test("a click on a same-site link moves without a page load; a link with # is left to the browser", () => {
    const root = document.createElement("div");
    root.innerHTML = '<a id="a" href="/defaults">x</a><a id="b" href="/#abc">y</a>';
    document.body.append(root);
    const stop = router.interceptLinks(root);
    // Runs after the router's listener: records whether it took the click, then keeps happy-dom from following it.
    const taken: boolean[] = [];
    const after = (event: Event) => {
      taken.push(event.defaultPrevented);
      event.preventDefault();
    };
    document.addEventListener("click", after);
    root.querySelector("#a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    expect(window.location.pathname).toBe("/defaults");
    root.querySelector("#b")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    expect(taken).toEqual([true, false]);
    expect(window.location.pathname).toBe("/defaults");
    document.removeEventListener("click", after);
    stop();
  });
});
