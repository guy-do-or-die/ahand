import { Fragment } from "react";
import { clsx } from "clsx";

export interface ChainRailProps {
  /** Chain nodes before the viewer, oldest first (e.g. truncated addresses). */
  nodes: string[];
  /** Label for the viewer chip, e.g. t("YOU"). */
  youLabel: string;
  className?: string;
}

/**
 * Provenance rail: mono uppercase names joined by 2px lines; the segment
 * reaching the viewer is amber; the viewer is an amber chip.
 */
export function ChainRail({ nodes, youLabel, className }: ChainRailProps) {
  return (
    <div className={clsx("ah-rail", className)}>
      {nodes.map((name, i) => (
        <Fragment key={`${name}-${i}`}>
          <span className="ah-rail__name">{name}</span>
          <span
            aria-hidden="true"
            className={clsx(
              "ah-rail__line",
              i === nodes.length - 1 && "ah-rail__line--reaching",
            )}
          />
        </Fragment>
      ))}
      <span className="ah-rail__you">{youLabel}</span>
    </div>
  );
}
