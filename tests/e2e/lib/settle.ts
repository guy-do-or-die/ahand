/**
 * When a screen is the screen a person reads: nothing on it says it is still busy, and the page
 * has stopped changing. The a11y guard audits it then, and shots.spec takes its picture then.
 *
 * The app has no one marker for "loaded": a Hand still being read stands under aria-busy, and the
 * first block's answer changes the page when it lands. So a screen counts as settled once no
 * element is aria-busy and the page went `QUIET_MS` without a change to its DOM (nodes, attributes
 * or text). These waits replaced a fixed 1.2 s pause.
 *
 * E2E_SETTLE_PROOF=1 checks that claim: the a11y guard then audits each screen once settled and
 * again 1.2 s later (the old pause), and fails when the two audits differ (a11y.spec.ts).
 */
import { expect, type Page } from "@playwright/test";

/** How long the page must go unchanged: half a block, and several renders. */
export const QUIET_MS = 500;

/** No element aria-busy, then QUIET_MS without a change to the page. */
export async function settled(page: Page, timeout = 10_000): Promise<void> {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout });
  const quiet = await page.evaluate(
    ([quietMs, capMs]) =>
      new Promise<boolean>((resolve) => {
        const watcher = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(() => done(true), quietMs);
        });
        let timer = setTimeout(() => done(true), quietMs);
        const cap = setTimeout(() => done(false), capMs);
        function done(ok: boolean) {
          watcher.disconnect();
          clearTimeout(timer);
          clearTimeout(cap);
          resolve(ok);
        }
        watcher.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      }),
    [QUIET_MS, timeout] as const,
  );
  if (!quiet) throw new Error(`the page never went ${QUIET_MS} ms without a change in ${timeout} ms: ${page.url()}`);
  // A change may have set a busy mark again (a read begun by the block that just landed).
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout });
}

export const settleProof = process.env.E2E_SETTLE_PROOF === "1";
