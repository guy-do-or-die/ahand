/**
 * An entry on /limits is one limit in a plain sentence, then what it means (F13): the first
 * sentence is set bold, the rest in body weight. The split is at the first sentence's end, a
 * full stop, "!" or "?" followed by a space and a capital; an entry that is one sentence is all
 * lead.
 */
export function leadOf(text: string): { lead: string; rest: string } {
  const found = /^(.+?[.!?])\s+(?=[A-ZА-ЯЁ«"“(])([\s\S]*)$/u.exec(text);
  return found ? { lead: found[1]!, rest: found[2]! } : { lead: text, rest: "" };
}
