import requests
import time
import hmac
import hashlib
import json

api_key = "GS68TldhIYqdRUOz4V"
api_secret = "b5suxCOFWQsV2IoGDZ2HnNyhxDvt4NQNAReK"
recv_window = str(5000)
timestamp = str(int(time.time() * 1000))

def generate_signature(payload):
    param_str = timestamp + api_key + recv_window + payload
    hash = hmac.new(bytes(api_secret, "utf-8"), param_str.encode("utf-8"), hashlib.sha256)
    return hash.hexdigest()

def check_bybit():
    # Public endpoint for tickers (usually doesn't need auth, but good to test if we want higher limits)
    # Actually, let's try public first as it's simpler.
    url = "https://api.bybit.com/v5/market/tickers?category=linear"
    
    print(f"Fetching {url}...")
    try:
        response = requests.get(url)
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            if data['retCode'] == 0:
                tickers = data['result']['list']
                print(f"Found {len(tickers)} tickers.")
                
                # Check for USDT pairs and funding rate
                usdt_tickers = [t for t in tickers if t['symbol'].endswith('USDT')]
                print(f"Found {len(usdt_tickers)} USDT tickers.")
                
                if usdt_tickers:
                    sample = usdt_tickers[0]
                    print("Sample Data:")
                    print(json.dumps(sample, indent=2))
                    print(f"Symbol: {sample['symbol']}")
                    print(f"Funding Rate: {sample['fundingRate']}")
                    print(f"Mark Price: {sample['markPrice']}")
            else:
                print(f"API Error: {data['retMsg']}")
        else:
            print(response.text)
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_bybit()
