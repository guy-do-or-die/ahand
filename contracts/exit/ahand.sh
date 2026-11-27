#!/usr/bin/env bash
# ahand.sh: read a Hand and move its money with nothing but an RPC and Foundry's `cast`.
# No site, no server, no package: this file, bash and cast.
#
#   RPC=<rpc-url> CORE=<core-address> bash ahand.sh <command> [arguments] [-- <cast send options>]
#
# Commands
#   status   <handId>                     open, time's up, or closed (thanked or refunded), by the latest block's time
#   refund   <handId>                     return an expired Hand's reward to its raiser (anyone may send it)
#   pending  <token> <payee>              what waits for <payee> in <token> (a payout that could not be delivered)
#   withdraw <token> <payee> [to]         send it to <payee> (anyone may), or to <to> (only the payee may)
#   extend   <handId> <expiry>            move the expiry later: unix seconds, or +30d, +12h, +90m from the latest block (raiser only)
#   fund     <handId> <amount>            add <amount> in whole tokens, e.g. 12.5 (raiser only); approves exactly that
#                                         first unless --from names the sender and its allowance already covers it
#   thank    <calldata-hex | file>        send a thank prepared elsewhere (see README.md: cast calldata,
#                                         exit.html, or bun tools/ahand.ts thank-calldata)
#
# Everything after -- goes to `cast send` unchanged: --account <name>, --ledger, --trezor, --from ...
# Prefer a keystore account or a hardware wallet: a key given with --private-key shows in `ps` and
# stays in your shell history.
# Environment: RPC and CORE (both required), FOUNDRY_BIN (default ~/.foundry/bin).
#
# CORE is pinned. It must equal create2(factory, salt, initcode hash) with the three values below:
# the same address on every EVM chain where 0x4e59…956C is the standard deterministic deployer and
# addresses follow the usual CREATE2 rule (not zkSync-style chains). Code at that address can only
# have been created by that deployer from that exact initcode (short of a keccak256 collision), and
# that initcode is what Core's source in this repository builds to (a forge test in the gate checks
# the hash). Any other CORE is refused; AHAND_UNPINNED_CORE=1 lifts the pin, with a loud warning, for
# a Core you deployed yourself. Before any send the code must also be there (the pin says nothing
# about a chain where Core was never deployed) and answer with Core's EIP-712 domain ("aHand", "core").
# Refund and thank say when a payout could not be delivered and waits in Core to be withdrawn.
set -euo pipefail

FOUNDRY_BIN=${FOUNDRY_BIN:-$HOME/.foundry/bin}
CAST=$FOUNDRY_BIN/cast

HANDS_SIG="hands(uint256)(address,uint40,uint40,uint40,address,uint16,uint16,uint256,address,bytes32)"
# Core's CREATE2 inputs, as in contracts/deployments/*.json.
CORE_FACTORY=0x4e59b44847b379578588920cA78FbF26c0B4956C
CORE_SALT=0x4f0ff848a233427c84043ed87224bdfcb9f141e864d27833ac5d1344e3a3347d # keccak256("aHand.core/1")
CORE_INITCODE_HASH=0x9ccc895f301e01520380241bbf8a8a04afc8f0fed6f3b4a7d1ea9fc14ad6c47d
PENDING_EVENT="Pending(uint256,address,address,uint256)"

THANK_SIG="thank(uint256,((address,address,uint16,uint16,bytes32),bytes)[],((address,address,uint16,bytes32,bytes32),bytes,bytes),bytes32)"

die() { echo "ahand: $*" >&2; exit 1; }
usage() { sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2; exit 2; }

# ---- arguments: the command's own, then everything after -- for cast send ----
ARGS=()
SEND=()
while [[ $# -gt 0 ]]; do
  if [[ $1 == "--" ]]; then
    shift
    if (($#)); then SEND=("$@"); fi
    break
  fi
  ARGS+=("$1"); shift
done
[[ ${#ARGS[@]} -ge 1 ]] || usage
CMD=${ARGS[0]}
ARGS=("${ARGS[@]:1}")
case $CMD in -h|--help|help) usage ;; esac

[[ -x $CAST ]] || die "no cast at $CAST (install Foundry, or set FOUNDRY_BIN)"
[[ -n ${RPC:-} ]] || die "set RPC to the chain's RPC address"
[[ -n ${CORE:-} ]] || die "set CORE to the Core's address"
[[ $CORE =~ ^0x[0-9a-fA-F]{40}$ ]] || die "CORE is an address (0x and 40 hex digits), not '$CORE'"

c() { "$CAST" "$@" --rpc-url "$RPC"; }
call() { c call "$CORE" "$@"; }
first() { awk '{print $1; exit}'; }                     # "1000000 [1e6]" -> "1000000"
is_address() { [[ $1 =~ ^0x[0-9a-fA-F]{40}$ ]]; }
is_uint() { [[ $1 =~ ^[0-9]+$ ]]; }
# uint_lt <a> <b>: a < b for whole numbers in decimal of any size. A uint256 does not fit bash's
# signed 64-bit arithmetic (10e18 wraps, 2^256-1 reads as -1), so they are compared as text:
# leading zeros dropped, the shorter is smaller, equal lengths compare digit by digit.
uint_lt() {
  local a=${1#"${1%%[!0]*}"} b=${2#"${2%%[!0]*}"}
  if ((${#a} != ${#b})); then ((${#a} < ${#b})); else [[ $a < "$b" ]]; fi
}
lower() { tr '[:upper:]' '[:lower:]'; }

when() { # unix seconds -> UTC date, GNU or BSD date
  date -u -d "@$1" '+%Y-%m-%d %H:%M:%S UTC' 2>/dev/null || date -u -r "$1" '+%Y-%m-%d %H:%M:%S UTC'
}
span() { # seconds -> "3d 4h 5m"
  local s=$1 out=""
  ((s >= 86400)) && out+="$((s / 86400))d "
  ((s >= 3600)) && out+="$((s % 86400 / 3600))h "
  out+="$((s % 3600 / 60))m"
  echo "$out"
}

# Core's errors in plain words. On a refused send, every known selector found in
# cast's output is named and explained.
explain() {
  local out=$1 found=0 entry name sel
  local -a errors=(
    "ExpiryTooEarly()|The end date must be in the future and, when extending, later than the current one."
    "ExpiryTooLate()|The end date can be at most 180 days from now."
    "ZeroRootKey()|No link key was given."
    "MinClaimTooHigh()|The giver's minimum share is above 100 %."
    "NotOpen()|This Hand doesn't exist or is already closed (thanked or refunded)."
    "NotRaised()|No Hand has this number on this network."
    "NotRaiser()|Only the person who raised this Hand can do that."
    "Expired()|Time is up. This Hand can only be refunded now."
    "GiverIsRaiser()|You can't thank yourself: the giver signed with the raiser's address."
    "ZeroPayee()|The Give says nowhere to send the money."
    "InvalidClaim(uint256)|Shares don't add up at one pass of the route."
    "AnonymousMargin(uint256)|A pass keeps a cut but names no one to pay it to."
    "InvalidKeySig(uint256)|A link key's signature is unreadable or from another key."
    "InvalidRouteHash()|The Give was signed for a different route."
    "BelowMinClaim()|The route leaves the giver less than the raiser's guaranteed minimum."
    "InvalidGiverSig()|The giver's signature doesn't check out: wrong key, or the smart wallet refused or isn't deployed."
    "NotExpired()|It's too early to refund. The Hand is still running."
    "NotPayee()|Only the payee can send their waiting money somewhere else."
    "ZeroDestination()|Can't send to the zero address."
    "NothingPending()|Nothing is waiting for this address in this token."
    "InexactTransfer()|The token moved a different amount than asked."
    "Reentered()|A token or wallet tried to call back in mid-operation. Refused."
  )
  for entry in "${errors[@]}"; do
    name=${entry%%|*}
    sel=$("$CAST" sig "$name")
    if grep -qi "${sel#0x}" <<<"$out"; then
      echo "Core refused: ${name%%(*}. ${entry#*|}" >&2
      found=1
    fi
  done
  ((found)) && return 0
  token_refused && return 0
  echo "$out" >&2
}

# Set by withdraw: what it moves, so that a refusal Core does not name can be traced to the token.
W_TOKEN="" W_PAYEE="" W_TO="" W_RAW=""

# During a withdraw, asks the token itself whether it would move the amount from Core to the
# destination; when it would not, says so in one plain line and names the way out. False otherwise.
token_refused() {
  local said reason
  [[ -n $W_TOKEN ]] || return 1
  if said=$(c call --from "$CORE" "$W_TOKEN" "transfer(address,uint256)(bool)" "$W_TO" "$W_RAW" 2>&1); then
    [[ $said == false ]] || return 1 # the token would move it: the refusal came from elsewhere
  else
    grep -qi revert <<<"$said" || return 1 # the RPC failed, not the token
  fi
  reason=$(sed -nE 's/.*execution reverted: ([^,]+), data.*/\1/p' <<<"$said" | head -1)
  reason=${reason:+ (it says: $reason)}
  if [[ $(lower <<<"$W_TO") == $(lower <<<"$W_PAYEE") ]]; then
    echo "ahand: the token refused to send to this payee$reason; the money still waits in Core, and the payee can send it elsewhere with: ahand.sh withdraw $W_TOKEN $W_PAYEE <to> -- <the payee's signer>" >&2
  else
    echo "ahand: the token refused to send to $W_TO$reason; the money still waits in Core: name another <to>" >&2
  fi
}

# Replays a mined, failed transaction as a call on the block before it, so that Core's error
# can be named. Best effort: an earlier transaction in the same block may change the answer.
replay() {
  local hash=$1 from to input block out
  [[ -n $hash ]] || return 0
  from=$(c tx "$hash" from 2>/dev/null) || return 0
  to=$(c tx "$hash" to 2>/dev/null) || return 0
  input=$(c tx "$hash" input 2>/dev/null) || return 0
  block=$(c tx "$hash" blockNumber 2>/dev/null) || return 0
  [[ $block -gt 0 ]] || return 0
  if ! out=$(c call --from "$from" "$to" "$input" --block $((block - 1)) 2>&1); then
    explain "$out"
  fi
}

# What the last successful send printed: report_pending reads its logs.
SENT=""

send() { # send <to> <sig or --data hex> [args...]
  local out
  # ${SEND[@]+...}: an empty array is "unbound" under set -u before bash 4.4 (macOS ships 3.2).
  if out=$("$CAST" send --rpc-url "$RPC" "$@" ${SEND[@]+"${SEND[@]}"} 2>&1); then
    SENT=$out
    echo "$out" | grep -E '^(transactionHash|status|blockNumber)' || echo "$out"
    # With --gas-limit cast does not simulate first, so a refused call is mined and fails.
    if grep -qE '^status +0 \(failed\)' <<<"$out"; then
      echo "ahand: the transaction was mined and reverted; nothing changed on Core" >&2
      replay "$(awk '$1 == "transactionHash" {print $2}' <<<"$out")"
      exit 1
    fi
  else
    explain "$out"
    exit 1
  fi
}

# CORE must be the pinned address (see the header); checked before every command, offline.
core_pin() {
  local pinned
  pinned=$("$CAST" compute-address "$CORE_FACTORY" --salt "$CORE_SALT" --init-code-hash "$CORE_INITCODE_HASH" | awk '{print $NF}')
  is_address "$pinned" || die "cast could not compute Core's address"
  [[ $(lower <<<"$CORE") == $(lower <<<"$pinned") ]] && return 0
  if [[ ${AHAND_UNPINNED_CORE:-} == 1 ]]; then
    echo "ahand: WARNING: CORE $CORE is NOT aHand's Core ($pinned). AHAND_UNPINNED_CORE=1 lifts the pin:" >&2
    echo "ahand: WARNING: whatever code sits there gets your transactions and approvals. Go on only for a Core you deployed yourself." >&2
    return 0
  fi
  die "CORE $CORE is not aHand's Core, which is $pinned on every chain (create2 of the deterministic deployer, salt keccak256(\"aHand.core/1\"), Core's initcode hash). AHAND_UNPINNED_CORE=1 lifts this check for a Core you deployed yourself"
}

# Before a send: Core's code is there and answers with its EIP-712 domain.
core_check() {
  local code domain
  code=$(c code "$CORE") || die "the RPC did not answer"
  [[ $code != "0x" ]] || die "no contract at $CORE on this chain"
  domain=$(call "eip712Domain()(bytes1,string,string,uint256,address,bytes32,uint256[])" 2>/dev/null) ||
    die "$CORE does not answer as an aHand Core"
  [[ $(sed -n 2p <<<"$domain") == '"aHand"' && $(sed -n 3p <<<"$domain") == '"core"' ]] ||
    die "$CORE is not an aHand Core (its EIP-712 domain is not aHand / core)"
}

now() { c block latest -f timestamp; }

# The sending address when the cast send options name it with --from (cast refuses a --from that
# differs from the signer); otherwise empty. A key is never read here: it stays with cast send.
sender() {
  local i
  for ((i = 0; i < ${#SEND[@]}; i++)); do
    case ${SEND[i]} in
      --from) echo "${SEND[i + 1]:-}"; return ;;
      --from=*) echo "${SEND[i]#--from=}"; return ;;
    esac
  done
}

# After a refund or a thank: every payout the token did not take is a Pending event of Core in the
# transaction's logs. Says which wait in Core and how to withdraw them, or that all were delivered.
report_pending() {
  local topic core logs log token payee raw found=0 saw_core=0
  local -a found_logs=()
  # One log of cast's JSON, in its order: Core's address, the four topics (event, handId, token,
  # payee), the amount. A regex kept in a variable reads the same in every bash since 3.2.
  local re='"address":"(0x[0-9a-f]{40})","topics":\["(0x[0-9a-f]{64})","0x[0-9a-f]{64}","0x[0-9a-f]{24}([0-9a-f]{40})","0x[0-9a-f]{24}([0-9a-f]{40})"\],"data":"(0x[0-9a-f]{64})'
  topic=$("$CAST" keccak "$PENDING_EVENT")
  core=$(lower <<<"$CORE")
  logs=$(sed -n 's/^logs  *//p' <<<"$SENT" | lower)
  # Collected first, so that the cast calls below never read the loop's input.
  while IFS= read -r log; do
    [[ -n $log ]] && found_logs+=("$log")
  done <<<"$(grep -oE '\{"address":"0x[0-9a-f]{40}","topics":\[[^]]*\],"data":"0x[0-9a-f]*"' <<<"$logs" || true)"
  for log in ${found_logs[@]+"${found_logs[@]}"}; do
    [[ $log == *"\"address\":\"$core\""* ]] && saw_core=1
    [[ $log =~ $re ]] || continue
    [[ ${BASH_REMATCH[1]} == "$core" && ${BASH_REMATCH[2]} == "$topic" ]] || continue
    token=0x${BASH_REMATCH[3]} payee=0x${BASH_REMATCH[4]}
    raw=$("$CAST" to-dec "${BASH_REMATCH[5]}")
    echo "NOT DELIVERED: the token did not take the payout to $payee; $(amount "$token" "$raw") waits in Core for it."
    echo "  Withdraw it later (anyone may send it to the payee, only the payee elsewhere):"
    echo "  ahand.sh withdraw $token $payee [to] -- <cast send options>"
    found=1
  done
  ((found)) && return 0
  # Core logs Refunded or Thanked in every such transaction: having read none of its logs means the
  # output was not understood, and nothing is claimed.
  if ((saw_core)); then
    echo "every payout was delivered"
  else
    echo "note: cast printed no logs: read pending(token, payee) to see whether a payout waits in Core"
  fi
}

# Reads hands(id) into H_* and the latest block's time into NOW; sets STATE.
read_hand() {
  local id=$1 answer line
  local -a fields=()
  is_uint "$id" || die "a Hand number is a whole number, not '$id'"
  answer=$(call "$HANDS_SIG" "$id") || die "could not read Hand $id from $CORE"
  while IFS= read -r line; do fields+=("${line%% *}"); done <<<"$answer"
  [[ ${#fields[@]} -eq 10 ]] || die "could not read Hand $id from $CORE"
  H_GIVEHASH=""
  H_RAISER=${fields[0]} H_EXPIRY=${fields[1]} H_OPENED=${fields[2]} H_CLOSED=${fields[3]}
  H_TOKEN=${fields[4]} H_GASK=${fields[5]} H_MINCLAIM=${fields[6]} H_REWARD=${fields[7]}
  H_ROOTKEY=${fields[8]} H_DATAHASH=${fields[9]}
  NOW=$(now)
  if ((H_OPENED == 0)); then
    STATE="not-raised"
  elif ((H_CLOSED != 0)); then
    # Read the whole answer first: a pipe into head that closes early makes cast fail on SIGPIPE under pipefail.
    H_GIVEHASH=$(call "thanks(uint256)(bytes32,bytes32)" "$id")
    H_GIVEHASH=${H_GIVEHASH%%$'\n'*}
    if [[ $H_GIVEHASH =~ ^0x0+$ ]]; then STATE="refunded"; else STATE="thanked"; fi
  elif ((NOW >= H_EXPIRY)); then
    STATE="times-up"
  else
    STATE="open"
  fi
}

token_symbol() { c call "$1" "symbol()(string)" 2>/dev/null | tr -d '"' || echo "?"; }
token_decimals() { c call "$1" "decimals()(uint8)" 2>/dev/null | first || true; }
amount() { # amount <token> <raw units> -> "12.5 mUSD (12500000 units)"
  local dec sym
  dec=$(token_decimals "$1"); sym=$(token_symbol "$1")
  if [[ -n $dec ]]; then
    echo "$("$CAST" format-units "$2" "$dec" | sed -E 's/(\.[0-9]*[1-9])0+$/\1/; s/\.0+$//') $sym ($2 units)"
  else
    echo "$2 units"
  fi
}

cmd_status() {
  [[ ${#ARGS[@]} -eq 1 ]] || die "usage: status <handId>"
  local id=${ARGS[0]}
  read_hand "$id"
  if [[ $STATE == not-raised ]]; then echo "Hand $id: not raised on this chain (by the latest block)"; exit 3; fi
  case $STATE in
    open) echo "Hand $id: OPEN, $(span $((H_EXPIRY - NOW))) left" ;;
    times-up) echo "Hand $id: TIME'S UP since $(when "$H_EXPIRY"). Anyone can refund it: ahand.sh refund $id" ;;
    thanked) echo "Hand $id: CLOSED, thanked at $(when "$H_CLOSED")" ;;
    refunded) echo "Hand $id: CLOSED, refunded at $(when "$H_CLOSED")" ;;
  esac
  echo "  state        $STATE   (latest block's time: $(when "$NOW"))"
  echo "  raiser       $H_RAISER"
  echo "  reward       $(amount "$H_TOKEN" "$H_REWARD")"
  echo "  token        $H_TOKEN"
  echo "  opened       $(when "$H_OPENED")"
  echo "  expiry       $(when "$H_EXPIRY")   ($H_EXPIRY)"
  ((H_CLOSED != 0)) && echo "  closed       $(when "$H_CLOSED")"
  echo "  root key     $H_ROOTKEY"
  echo "  payout gas   ${H_GASK}k per payout"
  echo "  giver's min  $((H_MINCLAIM / 100)).$(printf '%02d' $((H_MINCLAIM % 100))) %"
  echo "  data hash    $H_DATAHASH"
  [[ $STATE == thanked ]] && echo "  give hash    $H_GIVEHASH"
  return 0
}

cmd_refund() {
  [[ ${#ARGS[@]} -eq 1 ]] || die "usage: refund <handId> -- <cast send options>"
  local id=${ARGS[0]}
  core_check
  read_hand "$id"
  case $STATE in
    not-raised) die "Hand $id is not raised on this chain" ;;
    thanked | refunded) die "Hand $id is already closed ($STATE)" ;;
    open) die "too early: Hand $id runs until $(when "$H_EXPIRY"), $(span $((H_EXPIRY - NOW))) from the latest block" ;;
  esac
  echo "refunding Hand $id: $(amount "$H_TOKEN" "$H_REWARD") back to $H_RAISER"
  send "$CORE" "refund(uint256)" "$id"
  report_pending
}

cmd_pending() {
  [[ ${#ARGS[@]} -eq 2 ]] || die "usage: pending <token> <payee>"
  local token=${ARGS[0]} payee=${ARGS[1]} raw
  is_address "$token" && is_address "$payee" || die "token and payee are addresses"
  raw=$(call "pending(address,address)(uint256)" "$token" "$payee" | first)
  echo "pending for $payee: $(amount "$token" "$raw")"
}

cmd_withdraw() {
  [[ ${#ARGS[@]} -ge 2 && ${#ARGS[@]} -le 3 ]] || die "usage: withdraw <token> <payee> [to] -- <cast send options>"
  local token=${ARGS[0]} payee=${ARGS[1]} to=${ARGS[2]:-${ARGS[1]}} raw
  is_address "$token" && is_address "$payee" && is_address "$to" || die "token, payee and to are addresses"
  core_check
  raw=$(call "pending(address,address)(uint256)" "$token" "$payee" | first)
  is_uint "$raw" || die "could not read what is waiting for $payee in $token"
  [[ ! $raw =~ ^0+$ ]] || die "nothing is waiting for $payee in $token"
  [[ $(lower <<<"$to") == $(lower <<<"$payee") ]] || echo "note: sending elsewhere than the payee: only the payee's own account may do that"
  echo "withdrawing $(amount "$token" "$raw") for $payee to $to"
  W_TOKEN=$token W_PAYEE=$payee W_TO=$to W_RAW=$raw
  send "$CORE" "withdraw(address,address,address)" "$token" "$payee" "$to"
}

cmd_extend() {
  [[ ${#ARGS[@]} -eq 2 ]] || die "usage: extend <handId> <unix-seconds | +30d | +12h | +90m> -- <cast send options>"
  local id=${ARGS[0]} want=${ARGS[1]} expiry
  core_check
  read_hand "$id"
  [[ $STATE == open ]] || die "Hand $id cannot be extended: $STATE"
  if [[ $want =~ ^\+([0-9]+)([dhm])$ ]]; then
    local n=${BASH_REMATCH[1]} unit=${BASH_REMATCH[2]}
    case $unit in d) expiry=$((NOW + n * 86400)) ;; h) expiry=$((NOW + n * 3600)) ;; m) expiry=$((NOW + n * 60)) ;; esac
  elif is_uint "$want"; then
    expiry=$want
  else
    die "expiry is unix seconds or +<n>d, +<n>h, +<n>m"
  fi
  ((expiry > H_EXPIRY)) || die "the new expiry $(when "$expiry") is not later than the current $(when "$H_EXPIRY")"
  ((expiry <= NOW + 180 * 86400)) || die "the new expiry is more than 180 days after the latest block"
  echo "extending Hand $id from $(when "$H_EXPIRY") to $(when "$expiry")"
  send "$CORE" "extend(uint256,uint40)" "$id" "$expiry"
}

cmd_fund() {
  [[ ${#ARGS[@]} -eq 2 ]] || die "usage: fund <handId> <amount in whole tokens> -- <cast send options>"
  local id=${ARGS[0]} human=${ARGS[1]} dec raw from allowance
  [[ $human =~ ^[0-9]+(\.[0-9]+)?$ ]] || die "amount is a number like 12.5"
  core_check
  read_hand "$id"
  [[ $STATE == open ]] || die "Hand $id cannot be funded: $STATE"
  dec=$(token_decimals "$H_TOKEN")
  [[ -n $dec ]] || die "the token $H_TOKEN does not tell its decimals"
  raw=$("$CAST" parse-units "$human" "$dec")
  is_uint "$raw" || die "could not read $human in units of $H_TOKEN"
  from=$(sender)
  if [[ -n $from ]]; then
    is_address "$from" || die "--from is an address, not '$from'"
    allowance=$(c call "$H_TOKEN" "allowance(address,address)(uint256)" "$from" "$CORE" | first)
    is_uint "$allowance" || allowance=0
  else
    echo "note: the sender is not known, so its allowance is not read; add --from <address> to skip an approve it already covers"
    allowance=0
  fi
  if uint_lt "$allowance" "$raw"; then
    echo "approving Core to take exactly $(amount "$H_TOKEN" "$raw")"
    send "$H_TOKEN" "approve(address,uint256)" "$CORE" "$raw"
  fi
  echo "funding Hand $id with $(amount "$H_TOKEN" "$raw")"
  send "$CORE" "fund(uint256,uint256)" "$id" "$raw"
}

cmd_thank() {
  [[ ${#ARGS[@]} -eq 1 ]] || die "usage: thank <calldata-hex | file> -- <cast send options>"
  local input=${ARGS[0]} data selector id decoded
  if [[ -f $input ]]; then data=$(tr -d ' \t\r\n' <"$input"); else data=$input; fi
  data=$(lower <<<"$data")
  [[ $data =~ ^0x([0-9a-f]{2})+$ ]] || die "the thank is hex calldata (0x...) or a file holding it"
  selector=$("$CAST" sig "$THANK_SIG")
  [[ ${data:0:10} == "$selector" ]] || die "this calldata is not a call of Core's thank (selector ${data:0:10}, expected $selector)"
  # The decoded call runs to many lines: read it whole, then take the first word, so cast never writes into a closed pipe.
  decoded=$("$CAST" decode-calldata "$THANK_SIG" "$data")
  id=$(first <<<"${decoded%%$'\n'*}")
  core_check
  read_hand "$id"
  [[ $STATE == open ]] || die "Hand $id cannot be thanked: $STATE"
  echo "thanking Hand $id: $(amount "$H_TOKEN" "$H_REWARD") along the signed route (raiser $H_RAISER sends this)"
  send "$CORE" --data "$data"
  report_pending
}

core_pin

case $CMD in
  status) cmd_status ;;
  refund) cmd_refund ;;
  pending) cmd_pending ;;
  withdraw) cmd_withdraw ;;
  extend) cmd_extend ;;
  fund) cmd_fund ;;
  thank) cmd_thank ;;
  *) echo "ahand: unknown command '$CMD'" >&2; usage ;;
esac
