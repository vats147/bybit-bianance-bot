import requests
import json
import time

def check_api():
    try:
        url = "http://localhost:8000/api/rates"
        print(f"Querying {url}...")
        response = requests.get(url)
        
        if response.status_code == 200:
            data = response.json()
            binance_keys = list(data.get('binance', {}).keys())
            cs_keys = list(data.get('coinswitch', {}).keys())
            
            print(f"Binance Pairs Count: {len(binance_keys)}")
            print(f"CoinSwitch Pairs Count: {len(cs_keys)}")
            print(f"CoinSwitch Sample Keys: {cs_keys[:10]}")
            
            # Check specific top coins
            for coin in ["BTC", "ETH", "SOL", "RIVER"]:
                bn_rate = data.get('binance', {}).get(coin, {}).get('rate')
                cs_rate = data.get('coinswitch', {}).get(coin, {}).get('rate')
                print(f"{coin}: BN={bn_rate} | CS={cs_rate}")
                
        else:
            print(f"Error: Status {response.status_code}")
            print(response.text)
            
    except Exception as e:
        print(f"Connection Error: {e}")

if __name__ == "__main__":
    check_api()
