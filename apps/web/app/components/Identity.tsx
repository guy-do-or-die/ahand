import { clsx } from "clsx";
import { useEnsIdentity } from "../hooks/useEnsIdentity";

/**
 * An address rendered as a person: primary name when one resolves,
 * shortened address otherwise, avatar when the name carries one.
 * Safe to render unconditionally — falls back without layout shift.
 */
export function Identity({
  address,
  className,
}: {
  address?: `0x${string}` | null;
  className?: string;
}) {
  const { avatar, display } = useEnsIdentity(address);
  if (!display) return null;
  return (
    <span className={clsx("inline-flex items-center gap-[6px] align-middle", className)}>
      {avatar ? (
        <img
          src={avatar}
          alt=""
          aria-hidden
          className="w-[16px] h-[16px] rounded-full object-cover"
          style={{ border: "var(--bw) solid var(--ink-dim)" }}
        />
      ) : null}
      <span className="ah-meta">{display}</span>
    </span>
  );
}
