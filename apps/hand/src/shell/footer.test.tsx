import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { i18n } from "@lingui/core";
import { renderToStaticMarkup } from "react-dom/server";

import { compileCatalogue } from "../i18n/catalogue";
import common from "../i18n/common/en";
import ru from "../i18n/common/ru";

/**
 * The footer as decided by the owner on 2026-11-21: the footer keeps only the links and the two
 * switches. The lens switch is a bare glyph like the theme switch, with
 * no word shown and its name kept; the "Unaudited · No owner · No fee" line is gone from both
 * views; under the lens a quiet "Core 0x65ac…2309" links to /core, and off the lens there is no
 * Core line at all. The browser half is tests/e2e/smoke/lens.spec.ts.
 */

const example = readFileSync(join(import.meta.dir, "../config/config.example.json"), "utf8");
plugin({
  name: "ahand-config",
  setup(build) {
    build.module("virtual:ahand-config", () => ({ contents: `export default ${example};`, loader: "js" }));
  },
});

const CORE = (JSON.parse(example) as { cores: { canonical: string } }).cores.canonical;
const SHORT = `${CORE.slice(0, 6)}…${CORE.slice(-4)}`;

let Footer: typeof import("./Shell").Footer;
let initLens: typeof import("./lens").initLens;
let TID: typeof import("../testids").TID;

beforeAll(async () => {
  GlobalRegistrator.register({ url: "http://127.0.0.1:18301/" });
  i18n.load("en", compileCatalogue(common));
  i18n.activate("en");
  ({ Footer } = await import("./Shell"));
  ({ initLens } = await import("./lens"));
  ({ TID } = await import("../testids"));
});

afterAll(async () => {
  initLens(false);
  await GlobalRegistrator.unregister();
});

function footer(lens: boolean): Document {
  initLens(lens);
  return new DOMParser().parseFromString(renderToStaticMarkup(<Footer />), "text/html");
}

const byId = (doc: Document, id: string) => doc.querySelector(`[data-testid="${id}"]`);

describe("footer: the lens switch drawn like the theme switch, Core's line under the lens only", () => {
  test("the lens switch shows no word, keeps its name, its hint and its key, and has no rim, fill or padding", () => {
    for (const on of [false, true]) {
      const lens = byId(footer(on), TID.shell.lens) as HTMLElement;
      expect(lens.textContent).toBe("");
      expect(lens.getAttribute("aria-label")).toBe(common["common.lensToggle"]);
      expect(lens.getAttribute("aria-pressed")).toBe(String(on));
      expect(lens.getAttribute("aria-keyshortcuts")).toBe("?");
      expect(lens.getAttribute("title")).toBe(common["common.lensHint"]);
      expect(lens.getAttribute("class")).toBeNull();
      const style = lens.getAttribute("style") ?? "";
      for (const rule of ["min-width:44px", "height:44px", "padding:0", "background:none", "border:0", "cursor:pointer", "color:var(--ink)"]) {
        expect(style).toContain(rule);
      }
      const svg = lens.querySelector("svg")!;
      expect([svg.getAttribute("width"), svg.getAttribute("height"), svg.getAttribute("aria-hidden")]).toEqual(["16", "16", "true"]);
    }
  });

  test("on and off differ by shape: off an outline magnifier, on its lens filled", () => {
    const glass = (on: boolean) => byId(footer(on), TID.shell.lens)!.querySelector("circle")!.getAttribute("fill");
    expect(glass(false)).toBe("none");
    expect(glass(true)).toBe("currentColor");
  });

  test("the lens and the theme switch stand side by side", () => {
    const lens = byId(footer(false), TID.shell.lens)!;
    expect(lens.nextElementSibling?.getAttribute("data-testid")).toBe(TID.shell.theme);
  });

  test("the calm view has no Core line and none of the three old facts", () => {
    const doc = footer(false);
    expect(byId(doc, TID.shell.footerCore)).toBeNull();
    const text = byId(doc, TID.shell.footer)!.textContent ?? "";
    expect(text).not.toMatch(/unaudited|no owner|no fee|core|0x/i);
  });

  test("the lens view shows a quiet Core line with the short address, linking to /core, and nothing else of the old line", () => {
    const line = byId(footer(true), TID.shell.footerCore)!;
    expect(line.tagName.toLowerCase()).toBe("a");
    expect(line.getAttribute("href")).toBe("/core");
    expect(line.textContent).toBe(`Core ${SHORT}`);
    expect(line.textContent).not.toMatch(/unaudited|owner|fee/i);
  });

  test("the three links stay as they were", () => {
    const doc = footer(false);
    expect(byId(doc, TID.shell.footerLimits)?.getAttribute("href")).toBe("/limits");
    expect(byId(doc, TID.shell.footerWithoutUs)?.getAttribute("href")).toBe("/without-us");
    expect(byId(doc, TID.shell.footerDefaults)?.getAttribute("href")).toBe("/defaults");
  });

  test("the old keys are gone and the lens line reads the same in both languages", () => {
    for (const catalogue of [common, ru] as Record<string, string>[]) {
      for (const key of ["common.footer", "common.footer.calm", "common.lensWord"]) expect(catalogue[key]).toBeUndefined();
      expect(catalogue["common.lens.core"]).toBe("Core {core}");
    }
  });
});
