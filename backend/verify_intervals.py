import requests

def check_binance_premium_index(symbol):
    try:
        url = f"https://fapi.binance.com/fapi/v1/premiumIndex?symbol={symbol}"
        print(f"Fetching {url}...")
        resp = requests.get(url)
        data = resp.json()
        print(f"Premium Index: {data}")
    except Exception as e:
        print(e)
        
def check_funding_info(symbol):
    try:
        url = "https://fapi.binance.com/fapi/v1/fundingInfo"
        print(f"Fetching {url}...")
        resp = requests.get(url)
        data = resp.json()
        print(f"Funding Info (First 1): {data[0] if data else 'Empty'}")
        
        for item in data:
            if item['symbol'] == symbol:
                print(f"Funding Info for {symbol}: {item}")
                return
    except Exception as e:
        print(e)

if __name__ == "__main__":
    check_binance_premium_index("FLOWUSDT")
    check_funding_info("FLOWUSDT")
