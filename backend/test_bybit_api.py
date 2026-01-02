import requests
import json

def test_bybit():
    url = "https://api.bybit.com/v5/market/tickers"
    params = {"category": "linear"}
    response = requests.get(url, params=params)
    if response.status_code == 200:
        data = response.json()
        if data['retCode'] == 0:
            targets = ["1000XECUSDT", "AIOUSDT", "NAORISUSDT", "NTRNUSDT", "VICUSDT", "1000XUSDT"]
            for item in data['result']['list']:
                if item['symbol'] in targets:
                    print(f"Symbol: {item['symbol']}, Rate: {item.get('fundingRate')}, Next: {item.get('nextFundingTime')}")
            print(f"Total symbols: {len(data['result']['list'])}")
        else:
            print(f"Error: {data['retMsg']}")
    else:
        print(f"HTTP Error: {response.status_code}")

if __name__ == "__main__":
    test_bybit()
