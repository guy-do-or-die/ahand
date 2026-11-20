import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

/**
 * What every kit component needs to know about the page around it: the language and whether
 * the lens is on. Both are read from <html> (`lang`, `data-lens="on"`), which the shell sets,
 * so the kit imports nothing from the shell and a screen passes nothing down. A subtree can
 * be given its own values with <Ambient> (the gallery shows both languages on one page).
 */
export type Lang = "en" | "ru";

export interface AmbientValue {
  lang: Lang;
  /** The specialist's lens: every disclosure stands open. */
  lens: boolean;
}

const Override = createContext<Partial<AmbientValue>>({});

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang", "data-lens"] });
  return () => observer.disconnect();
}

const pageLang = (): Lang => (document.documentElement.lang.toLowerCase().startsWith("ru") ? "ru" : "en");
const pageLens = (): boolean => document.documentElement.dataset.lens === "on";

export function useLang(): Lang {
  const page = useSyncExternalStore(subscribe, pageLang, (): Lang => "en");
  return useContext(Override).lang ?? page;
}

export function useLens(): boolean {
  const page = useSyncExternalStore(subscribe, pageLens, () => false);
  return useContext(Override).lens ?? page;
}

/** Gives a subtree its own language or lens; what is left out is inherited. */
export function Ambient({ lang, lens, children }: Partial<AmbientValue> & { children: ReactNode }) {
  const outer = useContext(Override);
  const value: Partial<AmbientValue> = { ...outer };
  if (lang !== undefined) value.lang = lang;
  if (lens !== undefined) value.lens = lens;
  return (
    <Override.Provider value={value}>
      {lang !== undefined ? (
        <div lang={lang} style={{ display: "contents" }}>
          {children}
        </div>
      ) : (
        children
      )}
    </Override.Provider>
  );
}
