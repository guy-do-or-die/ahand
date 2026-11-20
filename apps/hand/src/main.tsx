import "./design/index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { initLang, preloadLang } from "./i18n";
import { startIntake } from "./link-intake";
import { initLens, listenForLensKey } from "./shell/lens";
import { applyTheme, watchTheme } from "./shell/theme";
import { escrowStamps, loadPrefs, outboxStore, type Prefs } from "./store/db";

/**
 * Boot, in this order: take the link out of the address bar first (before anything waits), start
 * fetching the device language's words, read this device's preferences (language, lens, theme;
 * none where storage is refused), load the chosen language's words, then render. React's own error reports are silenced: an error can carry text from a link, and
 * nothing of a link may reach the console (ARCHITECTURE §11).
 */
async function boot(): Promise<void> {
  startIntake();
  preloadLang();
  // Storage that never answers (a blocked upgrade, a locked-down profile) must not hold the page.
  const slow = new Promise<Prefs>((resolve) => setTimeout(() => resolve({}), 1500));
  const prefs: Prefs = await Promise.race([loadPrefs().catch((): Prefs => ({})), slow]);
  await initLang(prefs.lang);
  initLens(prefs.lens);
  applyTheme(prefs.theme);
  watchTheme();
  listenForLensKey();

  const quiet = () => undefined;
  createRoot(document.getElementById("root")!, {
    onCaughtError: quiet,
    onUncaughtError: quiet,
    onRecoverableError: quiet,
  }).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  void resumeOutbox();
  void sweepCopies();
}

/**
 * The raiser's locked copies are swept on every start (screens/raise/sweep.ts): a device that holds none
 * loads nothing for it. A copy whose Hand cannot be read now is kept for the next start.
 */
async function sweepCopies(): Promise<void> {
  try {
    if ((await escrowStamps()).length === 0) return;
    const [{ sweepLockedCopies }, { clientOf }, { chainNow, readHand }, { config }] = await Promise.all([import("./screens/raise/sweep"), import("./chain"), import("@ahand/sdk"), import("./config")]);
    const client = clientOf();
    const now = await chainNow(client);
    await sweepLockedCopies(now.timestamp, async (record) => {
      const trusted = config.cores.trusted.some((entry) => entry.chainId === record.chainId && entry.core.toLowerCase() === record.core.toLowerCase());
      if (record.chainId !== config.chain.id || !trusted || record.handId === undefined) return undefined;
      const { view } = await readHand(client, record.core as `0x${string}`, BigInt(record.handId));
      return { expiry: view.expiry, closedAt: view.closedAt };
    });
  } catch {
    // Storage refused, the network away, or the code failed to load: the next start tries again.
  }
}

/**
 * A give written into the outbox but not yet acknowledged by a relay is retried on every screen,
 * not only on /give: when this device holds one, the giver's outbox (screens/give/deliver.ts) is
 * opened, which retries until a relay holds it. A device with nothing waiting loads no delivery
 * code and contacts no relay.
 */
async function resumeOutbox(): Promise<void> {
  try {
    const store = outboxStore<{ acks?: number }>();
    const keys = await store.keys();
    const entries = await Promise.all(keys.map((key) => store.get(key)));
    if (!entries.some((entry) => entry && !(Number(entry.acks) >= 1))) return;
    const { giverOutbox } = await import("./screens/give/deliver");
    await giverOutbox();
  } catch {
    // Storage refused or the delivery code failed to load: /give itself still retries.
  }
}

void boot();
