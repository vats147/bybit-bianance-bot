#!/usr/bin/env python3
"""
Test Bybit API key validity directly.
Usage: python3 backend/test_bybit_key.py <api_key> <api_secret>
"""
import sys
import hmac
import hashlib
import time
import requests

def test_bybit_key(api_key: str, api_secret: str, use_demo: bool = True):
    base_url = "https://api-demo.bybit.com" if use_demo else "https://api.bybit.com"
    endpoint = "/v5/account/wallet-balance"
    params = "accountType=UNIFIED"
    
    # Generate signature
    timestamp = str(int(time.time() * 1000))
    recv_window = "5000"
    param_str = f"{timestamp}{api_key}{recv_window}{params}"
    signature = hmac.new(
        bytes(api_secret, "utf-8"),
        param_str.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
    
    headers = {
        "X-BAPI-API-KEY": api_key,
        "X-BAPI-SIGN": signature,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recv_window,
        "Content-Type": "application/json"
    }
    
    url = f"{base_url}{endpoint}?{params}"
    print(f"\n--- Testing Bybit {'Demo' if use_demo else 'Live'} API ---")
    print(f"URL: {url}")
    print(f"Key: {api_key[:8]}...{api_key[-4:]}")
    
    try:
        response = requests.get(url, headers=headers)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        return response.json()
    except Exception as e:
        print(f"Error: {e}")
        return None

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 test_bybit_key.py <api_key> <api_secret>")
        print("\nExample:")
        print("  python3 backend/test_bybit_key.py YOUR_API_KEY YOUR_API_SECRET")
        sys.exit(1)
    
    api_key = sys.argv[1].strip()
    api_secret = sys.argv[2].strip()
    
    # Test Demo first
    result = test_bybit_key(api_key, api_secret, use_demo=True)
    
    if result and result.get("retCode") != 0:
        print("\n--- Demo failed, trying Live ---")
        test_bybit_key(api_key, api_secret, use_demo=False)
