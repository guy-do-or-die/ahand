#!/usr/bin/env bash
# Proves the shell exit kit on a fresh local chain: every money move of ahand.sh, each asserted from
# Core's own views (hands, pending, thanks, counters) and the tokens' balances.
#
#   bash contracts/exit/selftest.sh
#
# 0. uint256  with a stand-in cast and no chain: a pending 10e18 is withdrawn, an unlimited
#             allowance (2^256-1) sends no approve, and 10e18 with allowance 0 approves first: amounts
#             past bash's signed 64 bits are compared as uint256 (early review C-4).
# 1. refund   a Hand is extended, funded, refused a refund while it runs, then refunded by a
#             stranger after a time jump; the raiser gets the whole reward back.
# 2. pending  a refund to a blocked payee (BlacklistToken, D-14) waits in Core; a withdraw to the
#             payee itself is refused in one plain line naming the way out (estimated, and mined
#             with --gas-limit); a stranger may not send it elsewhere; the payee withdraws it to another address; a second one is
#             withdrawn by a stranger to the payee once unblocked.
# 3. thank    a Give signed with cast (EIP-712 typed data) is thanked from calldata in a file; a
#             stranger's thank is refused; the giver is paid.
#
# Starts its own anvil on the first free port of 18945..18954 (or SELFTEST_PORT), deploys with
# script/Deploy.s.sol under the stand's forge lock, and stops and removes everything it started.
# Uses anvil's public test keys only. Needs bash, Foundry and jq. Environment: FOUNDRY_BIN (default ~/.foundry/bin).
set -euo pipefail

command -v jq >/dev/null || {
  echo "selftest: needs jq to read the deployment JSON; install it (apt install jq, brew install jq, or https://jqlang.org) and run again" >&2
  exit 1
}

FOUNDRY_BIN=${FOUNDRY_BIN:-$HOME/.foundry/bin}
export FOUNDRY_BIN
CAST=$FOUNDRY_BIN/cast
contracts=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
root=$(cd "$contracts/.." && pwd)
kit=$contracts/exit/ahand.sh
cd "$contracts"

# anvil's public test accounts (mnemonic "test test ... junk")
KEY1=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d # raiser A
KEY2=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a # raiser B
KEY3=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6 # a stranger
KEY4=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a # the giver
KEY6=0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e # a link's root key
addr() { "$CAST" wallet address --private-key "$1"; }
A=$(addr $KEY1) B=$(addr $KEY2) S=$(addr $KEY3) G=$(addr $KEY4) ROOT=$(addr $KEY6)
ZERO32=0x0000000000000000000000000000000000000000000000000000000000000000

step() { echo; echo "== $*"; }
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*" >&2; exit 1; }
expect_eq() { [[ $1 == "$2" ]] || fail "$3: expected $2, got $1"; pass "$3"; }

# ---- 0. uint256 amounts, with a stand-in cast (no chain) ----
standin=$(mktemp -d)
trap 'rm -rf "$standin"' EXIT
cp "$contracts/exit/selftest-cast.sh" "$standin/cast"
chmod +x "$standin/cast"
T=0x3333333333333333333333333333333333333333 P=0x5555555555555555555555555555555555555555
standin_kit() { # standin_kit <log> <env...> -- <ahand.sh args...>: ahand.sh against the stand-in cast
  local log=$1; shift
  local -a envs=()
  while [[ $1 != -- ]]; do envs+=("$1"); shift; done
  shift
  : >"$log"
  env FOUNDRY_BIN="$standin" RPC=http://127.0.0.1:1 CORE=0x65ac707E2AE7392583de5d6192C619F1D8862309 CAST_LOG="$log" "${envs[@]}" \
    bash "$kit" "$@" -- --private-key 0xdead >/dev/null 2>&1
}
sends() { grep '^cast send' "$1" | awk '{print $6}' | paste -sd' ' -; }
step "0. uint256 amounts past 64 bits, with a stand-in cast"
standin_kit "$standin/1.log" PENDING=10000000000000000000 -- withdraw $T $P || fail "withdraw of a pending 10e18 failed"
expect_eq "$(sends "$standin/1.log")" "withdraw(address,address,address)" "a pending 10e18 (past 2^63) is seen and withdrawn"
standin_kit "$standin/2.log" ALLOWANCE=115792089237316195423570985008687907853269984665640564039457584007913129639935 -- fund 7 1 ||
  fail "fund with an unlimited allowance failed"
expect_eq "$(sends "$standin/2.log")" "fund(uint256,uint256)" "an unlimited allowance (2^256-1) sends no approve"
standin_kit "$standin/3.log" ALLOWANCE=0 -- fund 7 10 || fail "fund of 10e18 with allowance 0 failed"
expect_eq "$(sends "$standin/3.log")" "approve(address,uint256) fund(uint256,uint256)" "10e18 with allowance 0 approves first, then funds"
standin_kit "$standin/4.log" ALLOWANCE=10000000000000000000 -- fund 7 10 || fail "fund with an equal allowance failed"
expect_eq "$(sends "$standin/4.log")" "fund(uint256,uint256)" "an allowance equal to 10e18 sends no approve"
standin_kit "$standin/5.log" ALLOWANCE=9999999999999999999 -- fund 7 10 || fail "fund with an allowance one unit short failed"
expect_eq "$(sends "$standin/5.log")" "approve(address,uint256) fund(uint256,uint256)" "an allowance one unit short of 10e18 approves first"
if standin_kit "$standin/6.log" PENDING=0 -- withdraw $T $P; then fail "a pending 0 was withdrawn"; fi
expect_eq "$(sends "$standin/6.log")" "" "a pending 0 sends nothing"
rm -rf "$standin"

# ---- a fresh chain ----
busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
port=${SELFTEST_PORT:-}
if [[ -z $port ]]; then
  for p in $(seq 18945 18954); do busy "$p" || { port=$p; break; }; done
  [[ -n $port ]] || fail "no free port in 18945..18954"
fi
busy "$port" && fail "port $port is taken"
export RPC=http://127.0.0.1:$port
out=deployments/31337-selftest-$port.json
work=$(mktemp -d)
lock=$root/infra/stand/.run/forge.lock
anvil_pid=""
locked=0

cleanup() {
  [[ -n $anvil_pid ]] && kill "$anvil_pid" 2>/dev/null && wait "$anvil_pid" 2>/dev/null
  ((locked)) && rmdir "$lock" 2>/dev/null
  rm -rf "$work" "$contracts/$out"
  return 0
}
trap cleanup EXIT

"$FOUNDRY_BIN/anvil" --port "$port" --silent &
anvil_pid=$!
for _ in $(seq 50); do "$CAST" block-number --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.1; done
"$CAST" block-number --rpc-url "$RPC" >/dev/null || fail "anvil did not start on $port"
echo "anvil on $port (pid $anvil_pid)"

# The stand's forge lock (ARCHITECTURE §14): a folder taken by mkdir, stale after 120 seconds.
mkdir -p "$(dirname "$lock")"
for _ in $(seq 600); do
  if mkdir "$lock" 2>/dev/null; then locked=1; break; fi
  age=$(($(date +%s) - $(stat -c %Y "$lock" 2>/dev/null || date +%s)))
  ((age > 120)) && rmdir "$lock" 2>/dev/null
  sleep 0.2
done
((locked)) || fail "could not take $lock"
DEPLOY_OUT=$out "$FOUNDRY_BIN/forge" script script/Deploy.s.sol --rpc-url "$RPC" --broadcast >"$work/deploy.log" 2>&1 ||
  { cat "$work/deploy.log" >&2; fail "deploy"; }
rmdir "$lock"; locked=0
bash script/check-deployment.sh "$out" "$RPC" >/dev/null || fail "check-deployment"
mkdir "$work/empty-path"
for script in script/check-deployment.sh exit/selftest.sh; do
  if said=$(PATH="$work/empty-path" "$BASH" "$script" "$out" "$RPC" 2>&1); then fail "$script ran without jq"; fi
  grep -q "needs jq" <<<"$said" || fail "$script without jq said: $said"
  pass "$script without jq stops with: $said"
done

export CORE=$(jq -r .core "$out")
USD=$(jq -r '.tokens[] | select(.kind == "usd") | .address' "$out")
BL=$(jq -r '.tokens[] | select(.kind == "blacklist") | .address' "$out")
echo "Core $CORE, mUSD $USD, blacklist mUSD $BL"

kit() { bash "$kit" "$@"; }
q() { "$CAST" call "$@" --rpc-url "$RPC" | awk '{print $1}'; }
tx() { local key=$1; shift; "$CAST" send "$@" --rpc-url "$RPC" --private-key "$key" >/dev/null; }
now() { "$CAST" block latest -f timestamp --rpc-url "$RPC"; }
jump() { "$CAST" rpc evm_increaseTime "$1" --rpc-url "$RPC" >/dev/null; "$CAST" rpc evm_mine --rpc-url "$RPC" >/dev/null; }
hand() { q "$CORE" "hands(uint256)(address,uint40,uint40,uint40,address,uint16,uint16,uint256,address,bytes32)" "$1" | sed -n "$2p"; }
balance() { q "$1" "balanceOf(address)(uint256)" "$2"; }
pending() { q "$CORE" "pending(address,address)(uint256)" "$1" "$2"; }
raise() { # raise <key> <token> <reward> <seconds>
  tx "$1" "$2" "approve(address,uint256)" "$CORE" "$3"
  tx "$1" "$CORE" "raise(address,uint256,uint40,address,uint16,uint16,bytes32)" "$2" "$3" $(($(now) + $4)) "$ROOT" 250 0 $ZERO32
  q "$CORE" "handsCount()(uint256)"
}
refused() { # refused <what> <pattern> <command...>: the command must fail and say <pattern>
  local what=$1 pattern=$2 output
  shift 2
  if output=$("$@" 2>&1); then fail "$what: it was not refused"; fi
  grep -q -- "$pattern" <<<"$output" || fail "$what: refused, but without '$pattern': $output"
  pass "$what (refused: $(grep -m1 -- "$pattern" <<<"$output"))"
}

# ---- 1. refund ----
step "1. refund"
h=$(raise $KEY1 "$USD" 5000000 3600)
[[ $(kit status "$h") == *"OPEN"* ]] || fail "status of a running Hand"
pass "status says OPEN"
refused "refund while it runs" "too early" kit refund "$h" -- --private-key $KEY3
kit extend "$h" +2h -- --private-key $KEY1 >/dev/null
[[ $(hand "$h" 2) -gt $(($(now) + 7000)) ]] || fail "extend: expiry did not move"
pass "extend +2h moved the expiry in hands()"
kit fund "$h" 1.5 -- --private-key $KEY1 >/dev/null
expect_eq "$(hand "$h" 8)" 6500000 "fund 1.5 raised the reward in hands() to 6.5 mUSD"
before=$(balance "$USD" "$A")
jump 7300
[[ $(kit status "$h") == *"TIME'S UP"* ]] || fail "status after the expiry"
pass "status says TIME'S UP"
refused "extend after the expiry" "cannot be extended" kit extend "$h" +1d -- --private-key $KEY1
kit refund "$h" -- --private-key $KEY3
[[ $(hand "$h" 4) -gt 0 ]] || fail "refund: closedAt is still 0"
expect_eq "$(q "$CORE" "refundsCount()(uint256)")" 1 "refundsCount is 1"
expect_eq "$(balance "$USD" "$A")" $((before + 6500000)) "the raiser got the whole reward back"
[[ $(kit status "$h") == *"refunded"* ]] || fail "status of a refunded Hand"
pass "status says CLOSED, refunded"
refused "a second refund" "already closed" kit refund "$h" -- --private-key $KEY3

# ---- 2. pending and withdraw ----
step "2. pending and withdraw"
h=$(raise $KEY2 "$BL" 3000000 600)
tx $KEY3 "$BL" "setBlocked(address,bool)" "$B" true
jump 601
before=$(balance "$BL" "$B")
kit refund "$h" -- --private-key $KEY3
expect_eq "$(pending "$BL" "$B")" 3000000 "the blocked raiser's refund waits in pending()"
expect_eq "$(balance "$BL" "$B")" "$before" "nothing reached the blocked raiser"
[[ $(kit pending "$BL" "$B") == *"3 mUSD"* ]] || fail "ahand.sh pending does not say 3 mUSD"
pass "ahand.sh pending says 3 mUSD"
plain() { # plain <what> <command...>: refused with the token's plain line and none of cast's raw error
  local what=$1 output
  shift
  if output=$("$@" 2>&1); then fail "$what: it was not refused"; fi
  grep -q "the token refused to send to this payee" <<<"$output" || fail "$what: no plain line: $output"
  grep -q "ahand.sh withdraw $BL $B <to> -- <the payee's signer>" <<<"$output" || fail "$what: the remedy is not named: $output"
  grep -qiE "Failed to estimate gas|0x08c379a0|server returned" <<<"$output" && fail "$what: cast's raw error leaked: $output"
  pass "$what (refused: $(grep -m1 "the token refused" <<<"$output"))"
}
plain "a withdraw to the blocked payee itself" kit withdraw "$BL" "$B" -- --private-key $KEY3
plain "the same, mined with --gas-limit and replayed" kit withdraw "$BL" "$B" -- --private-key $KEY3 --gas-limit 200000
expect_eq "$(pending "$BL" "$B")" 3000000 "the refused withdraws left pending() as it was"
refused "a stranger sending it elsewhere" "NotPayee" kit withdraw "$BL" "$B" "$S" -- --private-key $KEY3
s_before=$(balance "$BL" "$S")
kit withdraw "$BL" "$B" "$S" -- --private-key $KEY2 >/dev/null
expect_eq "$(pending "$BL" "$B")" 0 "pending() is 0 after the payee's withdraw"
expect_eq "$(balance "$BL" "$S")" $((s_before + 3000000)) "the payee sent it to another address"
refused "withdrawing nothing" "nothing is waiting" kit withdraw "$BL" "$B" -- --private-key $KEY3

h=$(raise $KEY2 "$BL" 2000000 600)
jump 601
kit refund "$h" -- --private-key $KEY3 >/dev/null
expect_eq "$(pending "$BL" "$B")" 2000000 "a second refund waits"
tx $KEY3 "$BL" "setBlocked(address,bool)" "$B" false
before=$(balance "$BL" "$B")
kit withdraw "$BL" "$B" -- --private-key $KEY3 >/dev/null
expect_eq "$(pending "$BL" "$B")" 0 "pending() is 0 after a stranger's withdraw to the payee"
expect_eq "$(balance "$BL" "$B")" $((before + 2000000)) "the unblocked payee received it"

# ---- 3. thank ----
step "3. thank"
h=$(raise $KEY1 "$USD" 2000000 3600)
route=$("$CAST" call "$CORE" "checkRoute(uint256,((address,address,uint16,uint16,bytes32),bytes)[])(address,uint16,bytes32)" "$h" "[]" --rpc-url "$RPC")
claim=$(sed -n 2p <<<"$route" | awk '{print $1}')
routeHash=$(sed -n 3p <<<"$route")
cat >"$work/give.json" <<JSON
{
  "types": {
    "EIP712Domain": [
      {"name": "name", "type": "string"}, {"name": "version", "type": "string"},
      {"name": "chainId", "type": "uint256"}, {"name": "verifyingContract", "type": "address"}
    ],
    "Hand": [
      {"name": "handId", "type": "uint256"}, {"name": "raiser", "type": "address"}, {"name": "token", "type": "address"},
      {"name": "rootKey", "type": "address"}, {"name": "payoutGasK", "type": "uint16"},
      {"name": "minClaimBps", "type": "uint16"}, {"name": "dataHash", "type": "bytes32"}
    ],
    "Give": [
      {"name": "hand", "type": "Hand"}, {"name": "signer", "type": "address"}, {"name": "payee", "type": "address"},
      {"name": "claimBps", "type": "uint16"}, {"name": "routeHash", "type": "bytes32"}, {"name": "dataHash", "type": "bytes32"}
    ]
  },
  "primaryType": "Give",
  "domain": {"name": "aHand", "version": "core", "chainId": 31337, "verifyingContract": "$CORE"},
  "message": {
    "hand": {"handId": $h, "raiser": "$A", "token": "$USD", "rootKey": "$ROOT", "payoutGasK": 250, "minClaimBps": 0, "dataHash": "$ZERO32"},
    "signer": "$G", "payee": "$G", "claimBps": $claim, "routeHash": "$routeHash", "dataHash": "$ZERO32"
  }
}
JSON
keySig=$("$CAST" wallet sign --data --from-file "$work/give.json" --private-key $KEY6)
giverSig=$("$CAST" wallet sign --data --from-file "$work/give.json" --private-key $KEY4)
"$CAST" calldata "thank(uint256,((address,address,uint16,uint16,bytes32),bytes)[],((address,address,uint16,bytes32,bytes32),bytes,bytes),bytes32)" \
  "$h" "[]" "(($G,$G,$claim,$routeHash,$ZERO32),$keySig,$giverSig)" $ZERO32 >"$work/thank.hex"
refused "a thank sent by a stranger" "NotRaiser" kit thank "$work/thank.hex" -- --private-key $KEY3
before=$(balance "$USD" "$G")
kit thank "$work/thank.hex" -- --private-key $KEY1
expect_eq "$(balance "$USD" "$G")" $((before + 2000000)) "the giver was paid the whole reward"
expect_eq "$(q "$CORE" "thanksCount()(uint256)")" 1 "thanksCount is 1"
[[ ! $(q "$CORE" "thanks(uint256)(bytes32,bytes32)" "$h" | head -1) =~ ^0x0+$ ]] || fail "thanks(id) keeps no Give"
pass "thanks() keeps the Give's hash"
[[ $(kit status "$h") == *"thanked"* ]] || fail "status of a thanked Hand"
pass "status says CLOSED, thanked"

echo
echo "selftest passed: refund, pending, withdraw (to the payee and elsewhere), extend, fund and thank, on chain $port"
