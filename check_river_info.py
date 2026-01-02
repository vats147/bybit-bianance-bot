
import requests
import json

def get_instrument_info(symbol):
    url = "https://api.bybit.com/v5/market/instruments-info"
    params = {
        "category": "linear",
        "symbol": symbol
    }
    response = requests.get(url, params=params)
    data = response.json()
    if data['retCode'] == 0:
        for item in data['result']['list']:
            if item['symbol'] == symbol:
                print(f"Symbol: {symbol}")
                print(f"Lot Size Filter: {item['lotSizeFilter']}")
                print(f"Qty Step: {item['lotSizeFilter']['qtyStep']}")
                return
    print(f"Could not find info for {symbol}")
    print(data)

if __name__ == "__main__":
    get_instrument_info("RIVERUSDT")
