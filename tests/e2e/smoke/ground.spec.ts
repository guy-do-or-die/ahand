import { chromium, expect, test } from "@playwright/test";

/**
 * Wave 1's only browser check: Playwright 1.65.1 launches the Chromium build in this machine's
 * cache (chromium-1255) and a page runs script. Needs no stand: STAND_BASE_URL=about:blank.
 */
test("the browser launches and runs a page", async ({ browser, page }, testInfo) => {
  const executable = chromium.executablePath();
  expect(executable).toContain("chromium");
  expect(browser.version()).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  await page.setContent("<main><h1>aHand</h1></main>");
  await expect(page.locator("h1")).toHaveText("aHand");
  expect(await page.evaluate(() => navigator.userAgent)).toContain("Chrome/");
  await testInfo.attach("browser", { body: `${browser.version()}\n${executable}\n`, contentType: "text/plain" });
});
