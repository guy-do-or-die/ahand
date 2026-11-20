import { config, explorerUrl, TESTNET } from "../config";
import { t } from "../i18n";
import { chainName } from "../i18n/common/chain";
import { TID } from "../testids";

/**
 * The chain's own explorer for what a sentence names (a transaction, the contract): a small link
 * beside the hash or address, so anyone can read the record without this site. Nothing when the
 * configuration names no explorer (a local stand). It opens a new tab and sends no referrer.
 */
export function OnExplorer({ tx, address, className }: { tx?: string; address?: string; className?: string }) {
  const value = tx ?? address;
  const href = value ? explorerUrl(tx ? "tx" : "address", value) : undefined;
  if (!href || !value) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={TID.shell.explorer}
      data-value={value}
      className={`ah-meta self-start normal-case underline decoration-dashed underline-offset-[4px] ${className ?? ""}`}
    >
      {t("common.explorer", { host: new URL(href).host })} ↗
    </a>
  );
}

/**
 * Where a test network's money comes from (the configuration's `faucets`): "Test money is free on
 * Base Sepolia (test network): USDC faucet.circle.com ↗ · ETH docs.base.org ↗". Nothing on a real
 * network or a local stand (its accounts start with test money).
 */
export function Faucets({ className }: { className?: string }) {
  const faucets = config.faucets ?? [];
  if (!TESTNET || faucets.length === 0) return null;
  return (
    <p className={`ah-label m-0 ${className ?? ""}`} data-testid={TID.shell.faucets}>
      {t("common.faucets", { network: chainName(config.chain) })}{" "}
      {faucets.map((faucet, i) => (
        <span key={faucet.url} className="whitespace-nowrap">
          {i > 0 ? " · " : ""}
          {faucet.asset}{" "}
          <a href={faucet.url} target="_blank" rel="noopener noreferrer" className="underline">
            {new URL(faucet.url).host}
          </a>{" "}
          ↗
        </span>
      ))}
    </p>
  );
}
