import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { i18n } from "@lingui/core";

import { compileCatalogue } from "../i18n/catalogue";
import en from "../i18n/common/en";
import ru from "../i18n/common/ru";
import type { PasskeyOutcome } from "../wallet";

/**
 * "Add a passkey" in the viewer's sheet (shell/passkey.tsx): what it draws for an account with no
 * passkey, with some, and after a press that added nothing; and the press itself, with the
 * wallet's `addPasskey` stood in for (Privy's window cannot be opened here, nor a real passkey
 * made): the sheet steps aside while the window is open and comes back with one line.
 */

const example = readFileSync(join(import.meta.dir, "../config/config.example.json"), "utf8");
plugin({
  name: "ahand-config",
  setup(build) {
    build.module("virtual:ahand-config", () => ({ contents: `export default ${example};`, loader: "js" }));
  },
});

let TID: typeof import("../testids").TID;
let PasskeyRow: typeof import("./passkey").PasskeyRow;
let addPasskeyAside: typeof import("./passkey").addPasskeyAside;
let clearPasskeyNote: typeof import("./passkey").clearPasskeyNote;
let noteOf: typeof import("./passkey").noteOf;
let passkeyNote: typeof import("./passkey").passkeyNote;
let hidePerson: typeof import("./person").hidePerson;
let personShown: typeof import("./person").personShown;
let showMe: typeof import("./person").showMe;

beforeAll(async () => {
  GlobalRegistrator.register({ url: "http://127.0.0.1:18302/" });
  i18n.load({ en: compileCatalogue(en), ru: compileCatalogue(ru) });
  i18n.activate("en");
  ({ TID } = await import("../testids"));
  ({ PasskeyRow, addPasskeyAside, clearPasskeyNote, noteOf, passkeyNote } = await import("./passkey"));
  ({ hidePerson, personShown, showMe } = await import("./person"));
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

afterEach(() => {
  clearPasskeyNote();
  hidePerson();
  i18n.activate("en");
});

function drawn(props: Parameters<typeof PasskeyRow>[0]): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(<PasskeyRow {...props} />), "text/html");
}

const shownWho = () => personShown()?.who;
/** What the row says, piece by piece, in order. */
const text = (doc: Document) => [...(doc.body.firstElementChild?.children ?? [])].map((element) => element.textContent).join(" | ");

describe("the passkey row", () => {
  test("no passkey yet: the action and what it is for", () => {
    const doc = drawn({ passkeys: 0, onAdd: () => undefined });
    expect(doc.querySelector(`[data-testid="${TID.shell.personPasskey}"]`)?.getAttribute("data-value")).toBe("0");
    expect(doc.querySelector(`[data-testid="${TID.shell.personPasskeyAdd}"]`)?.textContent).toBe("Add a passkey");
    expect(text(doc)).toBe("Add a passkey | Log in next time with your face, fingerprint or screen lock.");
  });

  test("with one or more: said plainly, and another can be added (Privy keeps several)", () => {
    const doc = drawn({ passkeys: 2, onAdd: () => undefined });
    expect(doc.querySelector(`[data-testid="${TID.shell.personPasskey}"]`)?.getAttribute("data-value")).toBe("2");
    expect(text(doc)).toBe("Passkey added. | Add another passkey");
  });

  test("after a press that added nothing, one line says why, in place of the others", () => {
    expect(text(drawn({ passkeys: 0, note: "none", onAdd: () => undefined }))).toBe("Add a passkey | No new passkey was added.");
    expect(text(drawn({ passkeys: 1, note: "unsupported", onAdd: () => undefined }))).toBe("Add another passkey | This browser can't make passkeys.");
    expect(text(drawn({ passkeys: 0, note: "failed", onAdd: () => undefined }))).toBe("Add a passkey | The passkey window didn't open. Try again.");
    expect(drawn({ passkeys: 0, note: "failed", onAdd: () => undefined }).querySelector('[role="status"]')).not.toBeNull();
  });

  test("in Russian too", () => {
    i18n.activate("ru");
    expect(text(drawn({ passkeys: 0, onAdd: () => undefined }))).toBe("Добавить passkey | В следующий раз входи по лицу, отпечатку или коду разблокировки.");
    expect(text(drawn({ passkeys: 1, onAdd: () => undefined }))).toBe("Passkey добавлен. | Добавить ещё passkey");
    expect(text(drawn({ passkeys: 1, note: "none", onAdd: () => undefined }))).toBe("Добавить ещё passkey | Новый passkey не добавлен.");
  });
});

describe("the press", () => {
  test("a line only when nothing was added: an added or removed passkey shows in the count", () => {
    expect(noteOf("added")).toBeUndefined();
    expect(noteOf("removed")).toBeUndefined();
    expect(noteOf("none")).toBe("none");
    expect(noteOf("unsupported")).toBe("unsupported");
    expect(noteOf("failed")).toBe("failed");
  });

  test("the sheet steps aside while Privy's window is open and comes back after, with the outcome's line", async () => {
    showMe();
    let release!: (outcome: PasskeyOutcome) => void;
    const seen: (string | undefined)[] = [];
    const pressed = addPasskeyAside(() => {
      seen.push(shownWho());
      return new Promise<PasskeyOutcome>((resolve) => (release = resolve));
    });
    expect(shownWho()).toBeUndefined();
    release("none");
    expect(await pressed).toBe("none");
    expect(seen).toEqual([undefined]);
    expect(shownWho()).toBe("me");
    expect(passkeyNote()).toBe("none");
  });

  test("a new press forgets the last line, an added passkey leaves none, and a throw is \"failed\" with the sheet back", async () => {
    await addPasskeyAside(async () => "failed");
    expect(passkeyNote()).toBe("failed");
    await addPasskeyAside(async () => "added");
    expect(passkeyNote()).toBeUndefined();
    expect(await addPasskeyAside(() => Promise.reject(new Error("Privy went away")))).toBe("failed");
    expect(passkeyNote()).toBe("failed");
    expect(shownWho()).toBe("me");
    clearPasskeyNote();
    expect(passkeyNote()).toBeUndefined();
  });
});
