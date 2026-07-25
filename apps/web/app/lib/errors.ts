import { t } from "../i18n";

/**
 * Chain errors must never speak raw protocol at the user (vocabulary law).
 * Returns the house-voice headline plus the technical detail for a dim
 * mono sub-line.
 */
/** The person dismissed the confirm sheet — never an error state. */
export function isUserRejection(err: any): boolean {
  const raw: string = err?.shortMessage || err?.message || "";
  const lower = raw.toLowerCase();
  return lower.includes("user rejected") || lower.includes("user denied") || err?.code === 4001;
}

export function humanizeChainError(err: any): { message: string; detail?: string } {
  const raw: string = err?.shortMessage || err?.message || "";
  if (isUserRejection(err)) {
    return { message: t("You closed the confirm — no harm done, nothing left your pocket.") };
  }
  const lower = raw.toLowerCase();
  if (lower.includes("exceeds 1000 bytes")) {
    return { message: t("Too long for one link — trim it a little.") };
  }
  // Sponsored-send (ERC-4337) failures. AA23/AA24 = the account's signature
  // or validation was refused; paymaster/timeout = the sponsor didn't carry it.
  if (lower.includes("aa23") || lower.includes("aa24")) {
    return {
      message: t("Your pocket couldn't sign that — reconnect and try again."),
      detail: raw || undefined,
    };
  }
  if (lower.includes("paymaster") || lower.includes("sponsor")) {
    return {
      message: t("Gas cover didn't come through — try again in a moment."),
      detail: raw || undefined,
    };
  }
  if (lower.includes("userop") || lower.includes("user operation") || lower.includes("bundler")) {
    return {
      message: t("The send didn't land — try again in a moment."),
      detail: raw || undefined,
    };
  }
  return {
    message: t("The chain hiccuped — try again in a moment."),
    detail: raw || undefined,
  };
}
