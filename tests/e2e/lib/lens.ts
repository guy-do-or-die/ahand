/**
 * The lens in a spec. Every screen opens in the calm view (lens off) for ordinary people; a spec
 * that reads the evidence (marks, Core's field names, blocks, addresses, the twist's backs)
 * turns the lens on first, the way a person does, with the switch in the footer. The choice is
 * kept on this device (the app's IndexedDB `prefs`), so every later page of the same browser
 * context opens with the lens on, reloads included.
 */
import { expect, type Page } from "@playwright/test";

/** Whether the app's own store already keeps the lens on for this origin. */
async function kept(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const open = indexedDB.open("ahand");
        open.onerror = () => resolve(false);
        open.onsuccess = () => {
          const db = open.result;
          try {
            const read = db.transaction("prefs", "readonly").objectStore("prefs").get("lens");
            read.onsuccess = () => {
              resolve(read.result === true);
              db.close();
            };
            read.onerror = () => {
              resolve(false);
              db.close();
            };
          } catch {
            resolve(false);
            db.close();
          }
        };
      }),
  );
}

/**
 * Turns the lens on with the footer's switch and waits until this device keeps it. A page that
 * shows nothing of the app yet is first taken to the start page.
 */
export async function lensOn(page: Page): Promise<void> {
  if (!/^https?:/.test(page.url())) await page.goto("/", { waitUntil: "domcontentloaded" });
  const html = page.locator("html");
  await expect(page.getByTestId("shell-lens")).toBeVisible({ timeout: 20_000 });
  if ((await html.getAttribute("data-lens")) !== "on") await page.getByTestId("shell-lens").click();
  await expect(html).toHaveAttribute("data-lens", "on");
  await expect.poll(() => kept(page), { timeout: 5_000 }).toBe(true);
}
