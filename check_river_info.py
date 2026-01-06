
import requests
import json
import time

def check_river_funding():
    symbol = "RIVER"
    
    print(f"--- Checking {symbol} Funding Info ---")
    
    
    # 1. Binance
    try:
        url = "https://fapi.binance.com/fapi/v1/premiumIndex"
        params = {"symbol": f"{symbol}USDT"}
        res = requests.get(url, params=params).json()
        if "nextFundingTime" in res:
            nft = int(res["nextFundingTime"])
            print(f"Binance NextFundingTime: {nft}")
            print(f"Binance Readable: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(nft/1000))}")
        else:
            print("Binance: Not found or error", res)
    except Exception as e:
        print(f"Binance Error: {e}")

    # 2. Bybit
    try:
        url = "https://api.bybit.com/v5/market/tickers"
        params = {"category": "linear", "symbol": f"{symbol}USDT"}
        res = requests.get(url, params=params).json()
        if res["retCode"] == 0 and len(res["result"]["list"]) > 0:
            data = res["result"]["list"][0]
            nft = int(data["nextFundingTime"])
            print(f"Bybit NextFundingTime: {nft}")
            print(f"Bybit Readable: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(nft/1000))}")
        else:
            print("Bybit: Not found or error", res)
    except Exception as e:
        print(f"Bybit Error: {e}")

if __name__ == "__main__":
    check_river_funding()
