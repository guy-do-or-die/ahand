import { lazy, useEffect, useState, type ComponentType, type LazyExoticComponent } from "react";

import { t } from "../i18n";
import { TID } from "../testids";
import { ErrorBand } from "../ui/ErrorBand";

/** A screen's module, as `import("./screens/<name>/index.tsx")` gives it. */
type Load<P> = () => Promise<{ default: ComponentType<P> }>;

/**
 * A lazy screen whose code may fail to arrive (FINDINGS U-1). React.lazy keeps a rejected import
 * for good, so a chunk that could not load while the browser was offline would throw into the
 * crash boundary on every try. Here a failed load resolves to a stand-in that draws the offline
 * band with "Try again", and loads the screen again itself (on the button, and when the browser
 * says it is back online). Nothing reloads the page: the tab's link lives only in memory (D-39).
 */
export function lazyScreen<P extends object>(load: Load<P>): LazyExoticComponent<ComponentType<P>> {
  return lazy(async () => {
    try {
      return await load();
    } catch {
      return { default: notLoaded(load) };
    }
  });
}

function notLoaded<P extends object>(load: Load<P>): ComponentType<P> {
  let loaded: ComponentType<P> | undefined;
  return function NotLoaded(props: P) {
    const [screen, setScreen] = useState<{ Screen: ComponentType<P> } | undefined>(loaded ? { Screen: loaded } : undefined);
    const [trying, setTrying] = useState(false);

    async function retry() {
      if (trying) return;
      setTrying(true);
      try {
        const module = await load();
        loaded = module.default;
        setScreen({ Screen: module.default });
      } catch {
        // still out of reach: the band stays
      } finally {
        setTrying(false);
      }
    }

    useEffect(() => {
      if (screen) return;
      const back = () => void retry();
      window.addEventListener("online", back);
      return () => window.removeEventListener("online", back);
    }); // re-bound each draw so `retry` sees `trying`

    if (screen) return <screen.Screen {...props} />;
    return (
      <section data-testid={TID.shell.offline} data-value="common.time.offline" className="mx-auto w-full max-w-[680px] px-6 py-12 md:px-10">
        <ErrorBand
          what={t("common.time.offline")}
          kept={t("common.offline.kept")}
          action={
            <button type="button" className="ah-quiet" data-testid={TID.shell.offlineRetry} disabled={trying} onClick={() => void retry()}>
              {t("common.crash.retry")}
            </button>
          }
        />
      </section>
    );
  };
}
