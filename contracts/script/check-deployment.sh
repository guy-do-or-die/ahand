#!/usr/bin/env bash
# Checks a deployment JSON against its chain and this tree. Exits non-zero on the first mismatch.
#
#   bash script/check-deployment.sh <deployment.json> <rpc-url>
#
# Needs bash, Foundry's cast and jq.
#
# 1. Every field of the deployment JSON (deployments/README.md) is present.
# 2. The chain answers with the file's chain id.
# 3. `factory` is the deterministic deployer, `salt` is keccak256("aHand.core/1"),
#    `core` = create2(factory, salt, initcodeHash), and code is there. Code at that address can only
#    have come from that initcode: this is what lets anyone trust the address without trusting us.
#    Off the local chain `core` must also be aHand's Core, the address contracts/exit/ahand.sh pins.
# 4. Core's EIP-712 domain is "aHand" / "core"; the code's hash equals `runtimeHash`.
# 5. `deployBlock` is at or before Core's creation: no code at deployBlock - 1 (needs an RPC that
#    serves old state; skipped when it does not). An earlier block is safe: log scans start there.
# 6. `initcodeHash` equals the AHandCore this tree builds (contracts/out), and the recorded build
#    settings equal foundry.toml and the OpenZeppelin package.
# 7. Off the local chain, a warning when `commit` is null or `dirty` is true: the record then does
#    not name a clean commit to rebuild Core from (the initcodeHash check above still holds).
# 8. On 31337: the test tokens, forwarder and account factory have code; the tokens' symbols and
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
warn() { echo "WARN $*" >&2; }

# The deterministic deployer (the same address on every chain that has it) and aHand's Core, which
# it deploys from Core's initcode to the same address everywhere.
FACTORY=0x4e59b44847b379578588920ca78fbf26c0b4956c
PINNED_CORE=0x65ac707e2ae7392583de5d6192c619f1d8862309
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
[[ $(field .factory | lower) == "$FACTORY" ]] || fail "factory $(field .factory) is not the deterministic deployer $FACTORY"
ok "factory is the deterministic deployer"
derived=$("$cast" compute-address "$(field .factory)" --salt "$(field .salt)" --init-code-hash "$(field .initcodeHash)" | awk '{print $NF}')
[[ $(echo "$derived" | lower) == $(echo "$core" | lower) ]] || fail "core $core is not create2(factory, salt, initcodeHash) = $derived"
ok "core $core = create2(factory, salt, initcodeHash)"
[[ $(field .salt | lower) == $("$cast" keccak "aHand.core/1") ]] || fail "salt is not keccak256(\"aHand.core/1\")"
ok "salt = keccak256(\"aHand.core/1\")"
if [[ $chain_id != 31337 ]]; then
  [[ $(echo "$core" | lower) == "$PINNED_CORE" ]] || fail "core $core is not aHand's Core $PINNED_CORE"
  ok "core is aHand's Core, the address ahand.sh pins"
fi

code=$("$cast" code "$core" --rpc-url "$rpc")
[[ $code != "0x" ]] || fail "no code at $core"
[[ $("$cast" keccak "$code") == $(field .runtimeHash | lower) ]] || fail "the code's hash is not runtimeHash"
ok "code is there and its hash is runtimeHash"

domain=$("$cast" call "$core" "eip712Domain()(bytes1,string,string,uint256,address,bytes32,uint256[])" --rpc-url "$rpc")
[[ $(sed -n 2p <<<"$domain") == '"aHand"' && $(sed -n 3p <<<"$domain") == '"core"' ]] || fail "EIP-712 domain is not aHand/core"
ok "EIP-712 domain aHand / core"

deploy_block=$(field .deployBlock)
# Checked before any arithmetic: bash evaluates a name inside (( )) as an expression, so a crafted
# value in someone else's record could run a command.
[[ $deploy_block =~ ^[0-9]+$ ]] || fail "deployBlock is not a whole number"
if ((deploy_block > 0)); then
  if before=$("$cast" code "$core" --block $((deploy_block - 1)) --rpc-url "$rpc" 2>/dev/null); then
    [[ $before == "0x" ]] || fail "deployBlock $deploy_block is after Core's creation: code is there at block $((deploy_block - 1))"
    ok "deployBlock $deploy_block is at or before Core's creation"
  else
    echo "skip deployBlock against the chain: the RPC does not serve block $((deploy_block - 1))"
  fi
fi

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

if [[ $chain_id != 31337 ]]; then
  [[ $(field .commit) != null ]] || warn "commit is null: the record names no commit to rebuild Core from"
  [[ $(field .dirty) != true ]] || warn "dirty is true: Core was built from uncommitted changes to src/ or foundry.toml"
fi

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
