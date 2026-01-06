#!/bin/bash
# Test Binance Futures Testnet API
# Usage: bash backend/test_binance.sh YOUR_API_KEY YOUR_API_SECRET

API_KEY="${1:-YOUR_API_KEY}"
API_SECRET="${2:-YOUR_API_SECRET}"

# Testnet URL
BASE_URL="https://testnet.binancefuture.com"
ENDPOINT="/fapi/v3/account"

# Generate timestamp
TIMESTAMP=$(date +%s000)

# Build query string
QUERY="timestamp=${TIMESTAMP}"

# Generate HMAC SHA256 signature
SIGNATURE=$(echo -n "${QUERY}" | openssl dgst -sha256 -hmac "${API_SECRET}" | awk '{print $2}')

# Full URL with signature
FULL_URL="${BASE_URL}${ENDPOINT}?${QUERY}&signature=${SIGNATURE}"

echo "=== Binance Futures Testnet API Test ==="
echo "API Key: ${API_KEY:0:8}...${API_KEY: -4}"
echo "Endpoint: ${ENDPOINT}"
echo "URL: ${FULL_URL:0:80}..."
echo ""

# Make the request
curl -s -X GET "${FULL_URL}" \
  -H "X-MBX-APIKEY: ${API_KEY}" \
  | python3 -m json.tool 2>/dev/null || curl -s -X GET "${FULL_URL}" -H "X-MBX-APIKEY: ${API_KEY}"

echo ""
