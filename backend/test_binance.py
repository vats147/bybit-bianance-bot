import requests
import time
import hmac
import hashlib
import os
from urllib.parse import urlencode

# CONFIG (User can edit this or rely on inputs)
BASE_URL = "https://testnet.binancefuture.com" # Futures Testnet
# BASE_URL = "https://fapi.binance.com" # Futures Mainnet

def check_server_time():
    print(f"Testing connectivity to {BASE_URL}...")
    try:
        r = requests.get(f"{BASE_URL}/fapi/v1/time")
        if r.status_code == 200:
            print("✅ Connectivity OK. Server Time:", r.json()['serverTime'])
            return True
        else:
            print(f"❌ Connectivity Failed: {r.status_code} - {r.text}")
            return False
    except Exception as e:
        print(f"❌ Connection Error: {e}")
        return False

def check_account(api_key, api_secret):
    endpoint = "/fapi/v2/account"
    timestamp = int(time.time() * 1000)
    params = {"timestamp": timestamp}
    query_string = urlencode(params)
    signature = hmac.new(api_secret.encode('utf-8'), query_string.encode('utf-8'), hashlib.sha256).hexdigest()
    
    headers = {"X-MBX-APIKEY": api_key}
    url = f"{BASE_URL}{endpoint}?{query_string}&signature={signature}"
    
    print("\nAttempting to fetch Account Balance...")
    try:
        r = requests.get(url, headers=headers)
        if r.status_code == 200:
            data = r.json()
            print("✅ specific Account Data Fetched!")
            print(f"   Can Trade: {data['canTrade']}")
            print(f"   Wallet Balance: {data['totalWalletBalance']} USDT")
            return True
        else:
            print(f"❌ Account Check Failed: {r.status_code}")
            print(f"   Error: {r.text}")
            print("   (Note: If you are using Spot Keys, they will fail here. You need Futures Keys.)")
            return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    if check_server_time():
        print("\n--- ENTER API KEYS TO TEST (Press Enter to skip) ---")
        key = input("API Key: ").strip()
        secret = input("API Secret: ").strip()
        
        if key and secret:
            check_account(key, secret)
        else:
            print("Skipping Account Check.")
