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
#   fund     <handId> <amount>            add <amount> in whole tokens, e.g. 12.5 (raiser only; approves exactly that first)
#   thank    <calldata-hex | file>        send a thank prepared elsewhere (bun tools/ahand.ts thank-calldata, or exit.html)
#
# Everything after -- goes to `cast send` unchanged: --private-key, --ledger, --trezor, --account <name>, --from ...
# Environment: RPC and CORE (both required), FOUNDRY_BIN (default ~/.foundry/bin).
# Before any send, the address in CORE must answer as an aHand Core (EIP-712 domain "aHand", "core").
set -euo pipefail

FOUNDRY_BIN=${FOUNDRY_BIN:-$HOME/.foundry/bin}
CAST=$FOUNDRY_BIN/cast

HANDS_SIG="hands(uint256)(address,uint40,uint40,uint40,address,uint16,uint16,uint256,address,bytes32)"
THANK_SIG="thank(uint256,((address,address,uint16,uint16,bytes32),bytes)[],((address,address,uint16,bytes32,bytes32),bytes,bytes),bytes32)"

die() { echo "ahand: $*" >&2; exit 1; }
usage() { sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2; exit 2; }

# ---- arguments: the command's own, then everything after -- for cast send ----
ARGS=()
SEND=()
while [[ $# -gt 0 ]]; do
  if [[ $1 == "--" ]]; then shift; SEND=("$@"); break; fi
  ARGS+=("$1"); shift
done
[[ ${#ARGS[@]} -ge 1 ]] || usage
CMD=${ARGS[0]}
ARGS=("${ARGS[@]:1}")
case $CMD in -h|--help|help) usage ;; esac

[[ -x $CAST ]] || die "no cast at $CAST (install Foundry, or set FOUNDRY_BIN)"
[[ -n ${RPC:-} ]] || die "set RPC to the chain's RPC address"
[[ -n ${CORE:-} ]] || die "set CORE to the Core's address"

c() { "$CAST" "$@" --rpc-url "$RPC"; }
call() { c call "$CORE" "$@"; }
first() { awk '{print $1; exit}'; }                     # "1000000 [1e6]" -> "1000000"
is_address() { [[ $1 =~ ^0x[0-9a-fA-F]{40}$ ]]; }
is_uint() { [[ $1 =~ ^[0-9]+$ ]]; }
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

# Core's errors in plain words (brief 02 §3). On a refused send, every known selector found in
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
  ((found)) || echo "$out" >&2
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

send() { # send <to> <sig or --data hex> [args...]
  local out
  if out=$("$CAST" send --rpc-url "$RPC" "$@" "${SEND[@]}" 2>&1); then
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

# The sending address when the cast send options name it without a device or a password prompt
# (--from, or --private-key); otherwise empty.
sender() {
  local i
  for ((i = 0; i < ${#SEND[@]}; i++)); do
    case ${SEND[i]} in
      --from) echo "${SEND[i + 1]:-}"; return ;;
      --private-key) "$CAST" wallet address --private-key "${SEND[i + 1]:-}" 2>/dev/null; return ;;
    esac
  done
}

# Reads hands(id) into H_* and the latest block's time into NOW; sets STATE.
read_hand() {
  local id=$1 fields
  is_uint "$id" || die "a Hand number is a whole number, not '$id'"
  mapfile -t fields < <(call "$HANDS_SIG" "$id" | awk '{print $1}')
  [[ ${#fields[@]} -eq 10 ]] || die "could not read Hand $id from $CORE"
  H_GIVEHASH=""
  H_RAISER=${fields[0]} H_EXPIRY=${fields[1]} H_OPENED=${fields[2]} H_CLOSED=${fields[3]}
  H_TOKEN=${fields[4]} H_GASK=${fields[5]} H_MINCLAIM=${fields[6]} H_REWARD=${fields[7]}
  H_ROOTKEY=${fields[8]} H_DATAHASH=${fields[9]}
  NOW=$(now)
  if ((H_OPENED == 0)); then
    STATE="not-raised"
  elif ((H_CLOSED != 0)); then
    H_GIVEHASH=$(call "thanks(uint256)(bytes32,bytes32)" "$id" | head -1)
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
  ((raw > 0)) || die "nothing is waiting for $payee in $token"
  [[ $(lower <<<"$to") == $(lower <<<"$payee") ]] || echo "note: sending elsewhere than the payee: only the payee's own account may do that"
  echo "withdrawing $(amount "$token" "$raw") for $payee to $to"
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
  from=$(sender)
  if [[ -n $from ]]; then
    allowance=$(c call "$H_TOKEN" "allowance(address,address)(uint256)" "$from" "$CORE" | first)
  else
    allowance=0
  fi
  if ((allowance < raw)); then
    echo "approving Core to take exactly $(amount "$H_TOKEN" "$raw")"
    send "$H_TOKEN" "approve(address,uint256)" "$CORE" "$raw"
  fi
  echo "funding Hand $id with $(amount "$H_TOKEN" "$raw")"
  send "$CORE" "fund(uint256,uint256)" "$id" "$raw"
}

cmd_thank() {
  [[ ${#ARGS[@]} -eq 1 ]] || die "usage: thank <calldata-hex | file> -- <cast send options>"
  local input=${ARGS[0]} data selector id
  if [[ -f $input ]]; then data=$(tr -d ' \t\r\n' <"$input"); else data=$input; fi
  data=$(lower <<<"$data")
  [[ $data =~ ^0x([0-9a-f]{2})+$ ]] || die "the thank is hex calldata (0x...) or a file holding it"
  selector=$("$CAST" sig "$THANK_SIG")
  [[ ${data:0:10} == "$selector" ]] || die "this calldata is not a call of Core's thank (selector ${data:0:10}, expected $selector)"
  id=$("$CAST" decode-calldata "$THANK_SIG" "$data" | head -1 | first)
  core_check
  read_hand "$id"
  [[ $STATE == open ]] || die "Hand $id cannot be thanked: $STATE"
  echo "thanking Hand $id: $(amount "$H_TOKEN" "$H_REWARD") along the signed route (raiser $H_RAISER sends this)"
  send "$CORE" --data "$data"
}

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
