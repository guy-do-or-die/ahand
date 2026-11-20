#!/usr/bin/env bash
# Checks a deployment JSON against its chain and this tree. Exits non-zero on the first mismatch.
#
#   bash script/check-deployment.sh <deployment.json> <rpc-url>
#
# Needs bash, Foundry's cast and jq.
#
# 1. Every field of ARCHITECTURE §3 is present.
# 2. The chain answers with the file's chain id.
# 3. `core` = create2(factory, salt, initcodeHash), and code is there. Code at that address can only
#    have come from that initcode: this is the trust anchor (D-10).
# 4. Core's EIP-712 domain is "aHand" / "core"; the code's hash equals `runtimeHash`.
# 5. `initcodeHash` equals the AHandCore this tree builds (contracts/out), and the recorded build
#    settings equal foundry.toml and the OpenZeppelin package.
# 6. On 31337: the test tokens, forwarder and account factory have code; the tokens' symbols and
#    decimals read back as written.
set -euo pipefail

command -v jq >/dev/null || {
  echo "check-deployment: needs jq to read the deployment JSON; install it (apt install jq, brew install jq, or https://jqlang.org) and run again" >&2
  exit 1
}

FOUNDRY_BIN=${FOUNDRY_BIN:-$HOME/.foundry/bin}
cast=$FOUNDRY_BIN/cast
contracts=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

if [[ $# -ne 2 ]]; then
  echo "usage: bash script/check-deployment.sh <deployment.json> <rpc-url>" >&2
  exit 2
fi
file=$1
rpc=$2

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "ok   $*"; }
lower() { tr '[:upper:]' '[:lower:]'; }
field() { jq -r "$1" "$file"; }

[[ -f $file ]] || fail "no file $file"
for key in chainId core factory salt initcodeHash runtimeHash deployBlock tokens forwarder accountFactory \
  commit dirty solc optimizerRuns evmVersion oz; do
  jq -e "has(\"$key\")" "$file" >/dev/null || fail "field $key is missing"
done
ok "every field is present"

chain_id=$(field .chainId)
[[ $("$cast" chain-id --rpc-url "$rpc") == "$chain_id" ]] || fail "the RPC is not chain $chain_id"
ok "chain $chain_id"

core=$(field .core)
derived=$("$cast" compute-address "$(field .factory)" --salt "$(field .salt)" --init-code-hash "$(field .initcodeHash)" | awk '{print $NF}')
[[ $(echo "$derived" | lower) == $(echo "$core" | lower) ]] || fail "core $core is not create2(factory, salt, initcodeHash) = $derived"
ok "core $core = create2(factory, salt, initcodeHash)"
[[ $(field .salt | lower) == $("$cast" keccak "aHand.core/1") ]] || fail "salt is not keccak256(\"aHand.core/1\")"
ok "salt = keccak256(\"aHand.core/1\")"

code=$("$cast" code "$core" --rpc-url "$rpc")
[[ $code != "0x" ]] || fail "no code at $core"
[[ $("$cast" keccak "$code") == $(field .runtimeHash | lower) ]] || fail "the code's hash is not runtimeHash"
ok "code is there and its hash is runtimeHash"

domain=$("$cast" call "$core" "eip712Domain()(bytes1,string,string,uint256,address,bytes32,uint256[])" --rpc-url "$rpc")
[[ $(sed -n 2p <<<"$domain") == '"aHand"' && $(sed -n 3p <<<"$domain") == '"core"' ]] || fail "EIP-712 domain is not aHand/core"
ok "EIP-712 domain aHand / core"

artifact=$contracts/out/AHandCore.sol/AHandCore.json
if [[ -f $artifact ]]; then
  built=$("$cast" keccak "$(jq -r .bytecode.object "$artifact")")
  [[ $built == $(field .initcodeHash | lower) ]] || fail "initcodeHash differs from the AHandCore this tree builds ($built)"
  ok "initcodeHash = the AHandCore built in contracts/out"
else
  echo "skip initcodeHash against contracts/out: not built"
fi

toml=$contracts/foundry.toml
[[ $(grep -E '^solc *=' "$toml" | sed -E 's/.*"(.*)".*/\1/') == $(field .solc) ]] || fail "solc differs from foundry.toml"
[[ $(grep -E '^optimizer_runs *=' "$toml" | sed -E 's/[^0-9]//g') == $(field .optimizerRuns) ]] || fail "optimizerRuns differs from foundry.toml"
[[ $(grep -E '^evm_version *=' "$toml" | sed -E 's/^[^"]*"([^"]*)".*/\1/') == $(field .evmVersion) ]] || fail "evmVersion differs from foundry.toml"
oz=$(jq -r .version "$contracts/lib/openzeppelin-contracts/package.json" 2>/dev/null || echo "?")
[[ $oz == $(field .oz) ]] || fail "oz $(field .oz) differs from lib/openzeppelin-contracts ($oz)"
ok "solc $(field .solc), optimizer $(field .optimizerRuns), evm $(field .evmVersion), OpenZeppelin $(field .oz)"

if [[ $chain_id == 31337 ]]; then
  for key in forwarder accountFactory; do
    addr=$(field ".$key")
    [[ $addr != null && $("$cast" code "$addr" --rpc-url "$rpc") != "0x" ]] || fail "$key has no code"
  done
  count=$(jq '.tokens | length' "$file")
  [[ $count -ge 2 ]] || fail "expected the two test tokens"
  for ((i = 0; i < count; i++)); do
    addr=$(field ".tokens[$i].address")
    [[ $("$cast" call "$addr" "symbol()(string)" --rpc-url "$rpc") == "\"$(field ".tokens[$i].symbol")\"" ]] || fail "token $addr: symbol"
    [[ $("$cast" call "$addr" "decimals()(uint8)" --rpc-url "$rpc") == "$(field ".tokens[$i].decimals")" ]] || fail "token $addr: decimals"
  done
  ok "forwarder, account factory and $count tokens have code and read back"
else
  [[ $(field .forwarder) == null && $(field .accountFactory) == null ]] || fail "forwarder and accountFactory must be null off 31337"
fi

echo "deployment $file holds on chain $chain_id"
