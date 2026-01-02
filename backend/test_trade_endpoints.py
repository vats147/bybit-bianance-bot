import requests
import json

# Local Backend URL
BACKEND_URL = "http://127.0.0.1:8000"

# User's Binance Testnet Keys (from chat)
BINANCE_KEY = "3rzxFtTUD5Uk2sjIWypOUsfX7CMUUy2OS17glilS5KkqBcUoc7BGZmY9yh7AXMX8"
BINANCE_SECRET = "wPAOk6XhLjHOUDXapCS5LvpcAuNXGYPkfAuotI4IMXDJtUoPPCTeJJFEwb2puHlv"

# Bybit Demo Keys (using default or placeholders if not known, but I'll use the ones from earlier verify if possible)
# I'll rely on the backend's default keys for Bybit if I don't pass headers, or pass dummy ones to check error format.
# The user's curl used: 
BYBIT_KEY = "GS68TldhIYqdRUOz4V"
BYBIT_SECRET = "b5suxCOFWQsV2IoGDZ2HnNyhxDvt4NQNAReK"

def test_bybit_order():
    print("\n--- Testing Bybit Order ---")
    headers = {
        "X-User-Bybit-Key": BYBIT_KEY,
        "X-User-Bybit-Secret": BYBIT_SECRET,
        "Content-Type": "application/json"
    }
    payload = {
        "symbol": "BTC", # Use a valid symbol
        "side": "Buy",
        "qty": 100, # Bybit Linear Qty is in contracts (usually 0.001 BTC min? No, Bybit Linear is usually in Base Token for USDT perp?? 
                    # Wait, for Inverse it's USD. For Linear (USDT Perp), qty is in BTC.
                    # 100 BTC is huge. 100 USDT value? 
                    # If I send 100 for BTCUSDT, that's 100 BTC -> Millions of dollars.
                    # ERROR: "Order price/qty/value out of range" likely.
                    # I should use a smaller quantity like 0.01
        "qty": 0.01,
        "leverage": 5,
        "category": "linear"
    }
    
    try:
        r = requests.post(f"{BACKEND_URL}/api/place-order", headers=headers, json=payload)
        print(f"Status: {r.status_code}")
        print(f"Response: {r.text}")
    except Exception as e:
        print(f"Request Failed: {e}")

def test_binance_order():
    print("\n--- Testing Binance Order ---")
    headers = {
        "X-User-Binance-Key": BINANCE_KEY,
        "X-User-Binance-Secret": BINANCE_SECRET,
        "Content-Type": "application/json"
    }
    payload = {
        "symbol": "BTC",
        "side": "Buy", 
        "qty": 0.01, # Binance Qty for BTCUSDT is in BTC. 0.01 BTC is valid.
        "leverage": 5,
        "is_testnet": True
    }
    
    try:
        r = requests.post(f"{BACKEND_URL}/api/binance/place-order", headers=headers, json=payload)
        print(f"Status: {r.status_code}")
        print(f"Response: {r.text}")
    except Exception as e:
        print(f"Request Failed: {e}")

if __name__ == "__main__":
    test_bybit_order()
    test_binance_order()
