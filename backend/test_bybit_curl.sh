#!/bin/bash
# Test Bybit Testnet API
# Usage: bash backend/test_bybit_curl.sh YOUR_API_KEY YOUR_API_SECRET

API_KEY="${1:-YOUR_API_KEY}"
API_SECRET="${2:-YOUR_API_SECRET}"

BASE_URL="https://api-demo.bybit.com"
ENDPOINT="/v5/account/wallet-balance"
PARAMS="accountType=UNIFIED"

# Generate timestamp (milliseconds)
TIMESTAMP=$(python3 -c "import time; print(int(time.time()*1000))")
RECV_WINDOW="5000"

# Generate signature using Python (more reliable)
PARAM_STR="${TIMESTAMP}${API_KEY}${RECV_WINDOW}${PARAMS}"
SIGNATURE=$(python3 -c "
import hmac
import hashlib
param_str = '${PARAM_STR}'
secret = '${API_SECRET}'
sig = hmac.new(secret.encode('utf-8'), param_str.encode('utf-8'), hashlib.sha256).hexdigest()
print(sig)
")

echo "=== Bybit Testnet API Test ==="
echo "Base URL: ${BASE_URL}"
echo "Endpoint: ${ENDPOINT}"
echo "API Key: ${API_KEY}"
echo "Timestamp: ${TIMESTAMP}"
echo "Param String: ${PARAM_STR}"
echo "Signature: ${SIGNATURE}"
echo ""

curl -s "${BASE_URL}${ENDPOINT}?${PARAMS}" \
  -H "X-BAPI-API-KEY: ${API_KEY}" \
  -H "X-BAPI-SIGN: ${SIGNATURE}" \
  -H "X-BAPI-TIMESTAMP: ${TIMESTAMP}" \
  -H "X-BAPI-RECV-WINDOW: ${RECV_WINDOW}" \
  -H "Content-Type: application/json" | python3 -m json.tool

echo ""
