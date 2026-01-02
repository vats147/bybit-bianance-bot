import requests
import time
import hmac
import hashlib
import json

# Your Config (Ensure these are your DEMO keys)
# Note: These must match what is in main.py for this test to be valid contextually, 
# but for this standalone script, we need the user's keys. 
# Since I cannot see them, I will ask this script to import them from main if possible, 
# or just provide the logic for the user to run.

# Start with imports from main to reuse keys if they are there
try:
    from main import BYBIT_API_KEY, BYBIT_SECRET, BYBIT_DEMO_URL, generate_signature
except ImportError:
    # Fallback if running from root without path adjustment
    import sys
    import os
    sys.path.append(os.path.join(os.path.dirname(__file__)))
    from main import BYBIT_API_KEY, BYBIT_SECRET, BYBIT_DEMO_URL, generate_signature

def test_local_order():
    print("Testing Order Placement with Valid Value (> 5 USDT)...")
    
    # Symbol: BTCUSDT (Price ~95k, so 0.001 is ~$95. Safe)
    # Or POLYX (Price ~0.20. Need > 25 units. Let's try 50.)
    
    # Let's try POLYX with massive qty to be safe
    symbol = "RIVER"
    qty = "10" 
    side = "Sell"
    
    print(f"Placing Market Order: {side} {qty} {symbol}USDT on {BYBIT_DEMO_URL}")
    print("Ensure this value is > 5 USDT")

    endpoint = "/v5/order/create"
    url = BYBIT_DEMO_URL + endpoint
    
    order_payload = {
        "category": "linear",
        "symbol": symbol + "USDT",
        "side": side,
        "orderType": "Market",
        "qty": qty,
    }
    
    payload_json = json.dumps(order_payload)
    timestamp, recv_window, signature = generate_signature(BYBIT_API_KEY, BYBIT_SECRET, payload_json)
    
    headers = {
        "X-BAPI-API-KEY": BYBIT_API_KEY,
        "X-BAPI-SIGN": signature,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recv_window,
        "Content-Type": "application/json"
    }
    
    try:
        response = requests.post(url, headers=headers, data=payload_json)
        print(f"Status Code: {response.status_code}")
        print("Response:", response.text)
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_local_order()
