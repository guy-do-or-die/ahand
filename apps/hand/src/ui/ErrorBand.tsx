import type { ReactNode } from "react";

import { clsx } from "../lib/clsx";

export interface ErrorBandProps {
  /** What happened, in one plain sentence. */
  what: string;
  /** What was not lost: "Nothing was sent." Every error that could put money in doubt has one. */
  kept?: string;
  /** Core's or the link's own name for it, in mono: exact data for whoever wants it. */
  code?: string;
  /** One quiet way on: try again, go back. */
  action?: ReactNode;
  className?: string;
}

/**
 * An error is a band of ink and words: there is no error colour in this language. It is
 * announced to a screen reader when it appears.
 */
export function ErrorBand({ what, kept, code, action, className }: ErrorBandProps) {
  return (
    <div role="alert" className={clsx("ah-alert", className)}>
      {code ? <div className="ah-alert__label ah-exact">{code}</div> : null}
      <p className="ah-alert__text" style={{ margin: code ? undefined : 0 }}>
        {what}
        {kept ? <span className="ah-alert__kept">{kept}</span> : null}
      </p>
      {action ? <div className="ah-alert__action">{action}</div> : null}
    </div>
  );
}
