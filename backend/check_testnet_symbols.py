import requests

def check_symbols():
    url = "https://testnet.binancefuture.com/fapi/v1/exchangeInfo"
    try:
        print(f"Fetching symbols from {url}...")
        r = requests.get(url)
        if r.status_code == 200:
            data = r.json()
            symbols = [s['symbol'] for s in data['symbols']]
            print(f"Total Symbols on Testnet: {len(symbols)}")
            
            target = "IDEXUSDT"
            found = next((s for s in data['symbols'] if s['symbol'] == target), None)
            
            if found:
                print(f"✅ {target} IS present.")
                print(f"   Status: {found['status']}")
                print(f"   ContractType: {found['contractType']}")
                print(f"   OrderTypes: {found['orderTypes']}")
            else:
                print(f"❌ {target} is NOT available on Testnet.")
                print("Available USDT pairs (first 20):")
                usdt_pairs = [s['symbol'] for s in data['symbols'] if s['symbol'].endswith("USDT")]
                print(", ".join(usdt_pairs[:20]))
                
        else:
            print(f"Error: {r.status_code}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_symbols()
