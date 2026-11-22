import { useEffect, useRef, useState } from "react";

export interface StripSection {
  /** The id of the element the strip moves to (it should carry `ah-section` and `tabIndex={-1}`). */
  id: string;
  label: string;
  /** What the section is set to now ("$20", "30 Jan"); a section with nothing to set has none. */
  value?: string | undefined;
  /**
   * The section stands beside the others on a wide screen, in view throughout: the strip then has
   * nowhere to move to and leaves its item out there (design/talk.css, `.ah-strip__beside`).
   */
  beside?: boolean;
}

/**
 * A long screen's sections as one row that stays at the window's top: each names a section and
 * what it is set to now, so the whole of what the screen will do is read from any place on it, and
 * pressing one moves there. The section in view is marked.
 *
 * The move is a scroll and a focus, never an address: on this site the part of the address after
 * `#` can carry a link's secret (link-intake.ts), so the strip's items are buttons and write
 * nothing to the address or to history. Focus goes to the section, so a keyboard or a screen
 * reader goes on from where the eye was sent. The scroll is smooth unless the device asks for
 * less motion.
 */
export function SectionStrip({ label, sections, testId }: { label: string; sections: StripSection[]; testId?: string }) {
  const [current, setCurrent] = useState(sections[0]?.id);
  const row = useRef<HTMLUListElement>(null);
  const ids = sections.map((section) => section.id).join(" ");
  // Just after a press the page is still on its way: the mark stays on what was pressed.
  const held = useRef(false);
  const release = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(release.current), []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id, entry.isIntersecting);
        if (held.current) return;
        // The first section with a part in the band under the strip is the one being read.
        const first = ids.split(" ").find((id) => seen.get(id));
        if (first) setCurrent(first);
      },
      // The band starts under the strip and ends above the window's middle.
      { rootMargin: "-76px 0px -55% 0px" },
    );
    for (const id of ids.split(" ")) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [ids]);

  // The marked item is kept in sight inside the row when the row itself scrolls sideways.
  useEffect(() => {
    const item = row.current?.querySelector<HTMLElement>('[aria-current="true"]');
    const list = row.current;
    if (!item || !list || list.scrollWidth <= list.clientWidth) return;
    const left = item.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft + 24 || left + item.offsetWidth > list.scrollLeft + list.clientWidth - 24) {
      list.scrollTo({ left: Math.max(0, left - 24), behavior: calm() ? "auto" : "smooth" });
    }
  }, [current]);

  const move = (id: string) => {
    const element = document.getElementById(id);
    if (!element) return;
    held.current = true;
    clearTimeout(release.current);
    release.current = setTimeout(() => (held.current = false), 900);
    setCurrent(id);
    element.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" });
    element.focus({ preventScroll: true });
  };

  return (
    <nav className="ah-strip" aria-label={label} data-testid={testId}>
      <ul className="ah-strip__row" ref={row}>
        {sections.map((section) => (
          <li key={section.id} className={section.beside ? "ah-strip__beside" : undefined}>
            <button type="button" className="ah-strip__item" aria-current={current === section.id ? "true" : undefined} data-section={section.id} onClick={() => move(section.id)}>
              <span className="ah-strip__label">{section.label}</span>
              {section.value ? <span className="ah-strip__value">{section.value}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function calm(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
