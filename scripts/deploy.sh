#!/bin/bash

# Verify script usage
if [ $# -ne 1 ]; then
  echo "Usage: $0 <env-file>"
  exit 1
fi

# Source provided env file
source "$1"

# Verify CHAIN_NAME is provided
if [ -z "$CHAIN_NAME" ]; then
  echo "Error: CHAIN_NAME is not set in the env file."
  exit 1
fi

# Optional verification flag
if [ -n "$VERIFY" ]; then
  VERIFY_FLAG="--verify"
else
  VERIFY_FLAG=""
fi


DEPLOYED_ADDRESS=$(forge create contracts/src/AHandBase.sol:AHandBase \
    --ignored-error-codes 5667 \
    --gas-limit 10000000 \
    --optimize \
    --optimizer-runs 10000 \
    --rpc-url $FORGE_RPC_URL \
    --private-key $FORGE_PRIVATE_KEY \
    --etherscan-api-key $ETHERSCAN_API_KEY \
    $VERIFY_FLAG \
    | tee /dev/tty | grep 'Deployed to:' | awk '{print $3}')


if [ -z "$DEPLOYED_ADDRESS" ]; then
  echo "Error: Failed to retrieve deployed address."
  exit 1
fi


grep -q "AHAND_${CHAIN_NAME}" .env \
  && sed -i'' -e "s/AHAND_${CHAIN_NAME}=.*/AHAND_${CHAIN_NAME}=${DEPLOYED_ADDRESS}/" .env \
  || echo "AHAND_${CHAIN_NAME}=${DEPLOYED_ADDRESS}" >> .env
