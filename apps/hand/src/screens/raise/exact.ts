import type { Lang } from "../../i18n";
import { money, unitsText } from "../../ui/format";

/**
 * An amount for an action's label or its confirmation (FINDINGS M-2): `money()` cuts to cents,
 * so "Add $2" would name a different amount from the 2.000003 that moves. When the amount has
 * digits below a cent, every digit is written ("$2.000003", «$2,000003»); otherwise it reads as
 * money does everywhere else.
 */
export function exactMoney(amount: bigint, decimals: number, lang: Lang): string {
  const cent = decimals >= 2 ? 10n ** BigInt(decimals - 2) : 1n;
  if (amount <= 0n || amount % cent === 0n) return money(amount, decimals, lang);
  const [whole = "0", fraction = ""] = unitsText(amount, decimals).split(".");
  const grouped = new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-GB", { maximumFractionDigits: 0 }).format(BigInt(whole));
  return `$${grouped}${lang === "ru" ? "," : "."}${fraction}`;
}
