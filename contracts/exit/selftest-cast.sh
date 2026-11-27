#!/usr/bin/env bash
# A stand-in for Foundry's cast, for selftest.sh's first part: it answers only what ahand.sh asks in
# withdraw and fund, from the environment (PENDING, ALLOWANCE), logs every call to $CAST_LOG and
# sends nothing. No chain is needed. It reproduces an earlier bug: amounts past 64 bits wrapped in
# bash's arithmetic.
echo "cast $*" >>"$CAST_LOG"
case $1 in
  code) echo 0x6080 ;;
  sig) echo 0x12345678 ;;
  block) echo 1800000000 ;;
  compute-address) echo 0x0f0555972388151D2C187f636A0855b6eE9B9685 ;; # the pinned Core; selftest.sh checks the real one on its chain
  parse-units) # whole tokens to units, exactly: "10" at 18 decimals is 10 followed by 18 zeros
    whole=${2%%.*} fraction=""
    [[ $2 == *.* ]] && fraction=${2#*.}
    while ((${#fraction} < $3)); do fraction+=0; done
    units=$whole$fraction units=${units#"${units%%[!0]*}"}
    echo "${units:-0}" ;;
  format-units) echo "$2" ;;
  send) printf 'transactionHash 0xabc\nstatus 1 (success)\nblockNumber 5\n' ;;
  call)
    case $3 in
      eip712Domain*) printf '0x0f\n"aHand"\n"core"\n31337\n0x0f0555972388151D2C187f636A0855b6eE9B9685\n0x00\n[]\n' ;;
      pending*) echo "$PENDING [x]" ;;
      allowance*) echo "$ALLOWANCE [x]" ;;
      decimals*) echo 18 ;;
      symbol*) echo '"DAI"' ;;
      hands*) printf '0x2222222222222222222222222222222222222222\n1900000000\n1799000000\n0\n0x3333333333333333333333333333333333333333\n250\n7000\n1000000000000000000\n0x4444444444444444444444444444444444444444\n0x00\n' ;;
      *) echo "unexpected call $3" >&2; exit 1 ;;
    esac ;;
  *) echo "unexpected cast $1" >&2; exit 1 ;;
esac
