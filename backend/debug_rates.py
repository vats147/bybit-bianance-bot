import requests
import json

def get_rates():
    try:
        response = requests.get("http://127.0.0.1:8000/api/rates?is_live=true")
        data = response.json()
        
        print(f"Total Symbols: {len(data)}")
        
        # Check a few specific symbols
        if 'binance' not in data or 'bybit' not in data:
            print("Invalid Data Structure:", data.keys())
            return

        binance_data = data['binance']
        bybit_data = data['bybit']
        
        print(f"Binance Symbols: {len(binance_data)}")
        print(f"Bybit Symbols:   {len(bybit_data)}")
        
        # Check intersection
        common_symbols = set(binance_data.keys()) & set(bybit_data.keys())
        print(f"Common Symbols: {len(common_symbols)}")
        
        targets = ["1000SHIB", "CELR", "HOT", "GTC", "BTCDOM", "ATA"]
        
        for symbol in targets:
            print(f"\n--- {symbol} ---")
            b_item = binance_data.get(symbol, {})
            c_item = bybit_data.get(symbol, {})
            
            b_rate = b_item.get('rate')
            c_rate = c_item.get('rate')
            
            print(f"Binance Rate (Raw): {b_rate}")
            print(f"Bybit Rate (Raw):   {c_rate}")
                
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    get_rates()
