import "./design/index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { initLang } from "./i18n";
import { startIntake } from "./link-intake";
import { initLens, listenForLensKey } from "./shell/lens";
import { applyTheme, watchTheme } from "./shell/theme";
import { loadPrefs, outboxStore, type Prefs } from "./store/db";

/**
 * Boot, in this order: take the link out of the address bar first (before anything waits), then
 * read this device's preferences (language, lens, theme; none where storage is refused), then
 * render. React's own error reports are silenced: an error can carry text from a link, and
 * nothing of a link may reach the console (ARCHITECTURE §11).
 */
async function boot(): Promise<void> {
  startIntake();
  // Storage that never answers (a blocked upgrade, a locked-down profile) must not hold the page.
  const slow = new Promise<Prefs>((resolve) => setTimeout(() => resolve({}), 1500));
  const prefs: Prefs = await Promise.race([loadPrefs().catch((): Prefs => ({})), slow]);
  initLang(prefs.lang);
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
