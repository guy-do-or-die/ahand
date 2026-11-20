#!/usr/bin/env bash
# Deploys AHandCore (and, on chain 31337, the test contracts) with script/Deploy.s.sol, filling
# `commit` and `dirty` of the deployment JSON from git, then checks the written file against the chain.
#
#   bash script/deploy.sh <rpc-url> [forge script arguments, e.g. --private-key, --ledger, --account]
#
# Environment: DEPLOY_OUT (default deployments/<chainId>.json), FOUNDRY_BIN (default ~/.foundry/bin).
# `dirty` is true when the Core's build inputs (src/, foundry.toml) differ from the commit.
set -euo pipefail

FOUNDRY_BIN=${FOUNDRY_BIN:-$HOME/.foundry/bin}
contracts=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$contracts"

if [[ $# -lt 1 ]]; then
  echo "usage: bash script/deploy.sh <rpc-url> [forge script arguments]" >&2
  exit 2
fi
rpc=$1
shift

chain_id=$("$FOUNDRY_BIN/cast" chain-id --rpc-url "$rpc")
export DEPLOY_OUT=${DEPLOY_OUT:-deployments/$chain_id.json}

if commit=$(git rev-parse HEAD 2>/dev/null); then
  export DEPLOY_COMMIT=$commit
  if [[ -n $(git status --porcelain -- src foundry.toml) ]]; then export DEPLOY_DIRTY=true; else export DEPLOY_DIRTY=false; fi
fi

"$FOUNDRY_BIN/forge" script script/Deploy.s.sol --rpc-url "$rpc" --broadcast "$@"
bash script/check-deployment.sh "$DEPLOY_OUT" "$rpc"
