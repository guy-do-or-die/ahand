import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { i18n } from "@lingui/core";
import { renderToStaticMarkup } from "react-dom/server";

import { compileCatalogue } from "../../src/i18n/catalogue";
import common from "../../src/i18n/common/en";
import { SRC } from "./files";

/**
 * The shell's landmarks (review round 1, axe `region`): every piece of the frame sits inside a
 * landmark. On a local build the LOCAL TEST NETWORK ribbon is part of the banner (`<header>`),
 * not a loose block above it. The shell is rendered to markup with the example configuration
 * (a local chain) standing in for Vite's `virtual:ahand-config`.
 */

const example = readFileSync(join(SRC, "config/config.example.json"), "utf8");
plugin({
  name: "ahand-config",
  setup(build) {
    build.module("virtual:ahand-config", () => ({ contents: `export default ${example};`, loader: "js" }));
  },
});

i18n.load("en", compileCatalogue(common));
i18n.activate("en");

GlobalRegistrator.register({ url: "http://127.0.0.1:18300/" });
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const { Shell } = await import("../../src/shell/Shell");
const { TID } = await import("../../src/testids");

describe("landmarks: nothing of the frame outside a landmark", () => {
  const html = renderToStaticMarkup(
    <Shell path="/">
      <p>screen</p>
    </Shell>,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");

  test("the local ribbon is rendered, inside the header", () => {
    const ribbon = doc.querySelector(`[data-testid="${TID.shell.ribbon}"]`);
    expect(ribbon?.textContent).toBe(common["common.ribbon"]);
    expect(ribbon?.closest("header")?.getAttribute("data-testid")).toBe(TID.shell.header);
  });

  test("the frame's top-level children are the skip button and the three landmarks", () => {
    const frame = doc.body.firstElementChild!;
    expect([...frame.children].map((child) => child.tagName.toLowerCase())).toEqual(["button", "header", "main", "footer"]);
  });
});
