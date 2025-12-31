from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import time
import hmac
import hashlib
import json
import requests
import asyncio
from typing import Dict, Any

app = FastAPI()

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
BINANCE_API = "https://fapi.binance.com/fapi/v1/premiumIndex"
# Using the working endpoint found in testing
COINSWITCH_API_URL = "https://coinswitch.co/trade/api/v2/24hr/all-pairs/ticker?exchange=coinswitch_pro"

COINSWITCH_API_KEY = "327aea81b9f9bde5830049fa5636af4d8e3057d2739a89b3aef911c49d875b13"
COINSWITCH_SECRET_KEY = "7d33e755773b872e39d574ffb61137375a0abd0e1ce8878057fdc94b11bdfe61"

from cryptography.hazmat.primitives.asymmetric import ed25519
from urllib.parse import urlparse, urlencode, unquote_plus
import urllib


import functools

async def fetch_binance_rates():
    try:
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, requests.get, BINANCE_API)
        if response.status_code == 200:
            data = response.json()
            rates = {}
            for item in data:
                if item['symbol'].endswith('USDT'):
                    symbol = item['symbol'].replace('USDT', '')
                    rates[symbol] = {
                        "rate": float(item['lastFundingRate']),
                        "markPrice": float(item['markPrice']),
                        "nextFundingTime": item['nextFundingTime']
                    }
            return rates
    except Exception as e:
        print(f"Binance Error: {e}")
        return {}
    return {}

# Circuit Breaker Globals
CS_FAIL_COUNT = 0
CS_CIRCUIT_OPEN = False

def generate_signature(method, endpoint, params, payload):
    # Logic from user provided snippet
    signing_endpoint = endpoint
    if method == "GET" and params:
        separator = '&' if '?' in endpoint else '?'
        signing_endpoint += separator + urlencode(params)
        signing_endpoint = unquote_plus(signing_endpoint)
    else:
        signing_endpoint = unquote_plus(endpoint)

    json_payload = json.dumps(payload, separators=(',', ':'), sort_keys=True) if payload else "{}"
    
    signature_msg = method + signing_endpoint + json_payload
    
    secret_key_bytes = bytes.fromhex(COINSWITCH_SECRET_KEY)
    secret_key_obj = ed25519.Ed25519PrivateKey.from_private_bytes(secret_key_bytes)
    signature_bytes = secret_key_obj.sign(bytes(signature_msg, 'utf-8'))
    return signature_bytes.hex()

async def fetch_coinswitch_rates():
    global CS_FAIL_COUNT, CS_CIRCUIT_OPEN
    
    if CS_CIRCUIT_OPEN:
        return {}

async def fetch_coinswitch_rates():
    global CS_FAIL_COUNT, CS_CIRCUIT_OPEN
    
    if CS_CIRCUIT_OPEN:
        return {}

    try:
        endpoint_path = "/trade/api/v2/24hr/all-pairs/ticker"
        # User requested coinswitchx
        exchange = "coinswitchx"
        
        all_rates = {}
        loop = asyncio.get_event_loop()
        
        params = {"exchange": exchange}
        # Generate signature for this specific request
        signature = generate_signature("GET", endpoint_path, params, {})
        
        headers = {
            'Content-Type': 'application/json',
            'X-AUTH-SIGNATURE': signature,
            'X-AUTH-APIKEY': COINSWITCH_API_KEY
        }
        
        url = "https://coinswitch.co" + endpoint_path
        
        # Run request
        try:
            response = await loop.run_in_executor(
                None, 
                functools.partial(requests.get, url, params=params, headers=headers)
            )
            
            if response.status_code == 200:
                CS_FAIL_COUNT = 0
                data = response.json()
                
                items = []
                if 'data' in data:
                    d = data['data']
                    if isinstance(d, list):
                        items = d
                    elif isinstance(d, dict):
                        for k, v in d.items():
                            v['symbol'] = k
                            items.append(v)
                
                for item in items:
                    raw_symbol = item.get('symbol', '') or item.get('pair', '')
                    if raw_symbol:
                        # Normalize
                        symbol = raw_symbol.split('/')[0]
                        
                        rate = float(item.get('funding_rate', 0) or item.get('lastFundingRate', 0))
                        mark_price = float(item.get('mark_price', 0) or item.get('last_price', 0))
                        
                        all_rates[symbol] = {
                            "rate": rate,
                            "markPrice": mark_price
                        }
                return all_rates

            else:
                CS_FAIL_COUNT += 1
                print(f"CS {exchange} Failed: {response.status_code} | {response.text[:100]}")
                if CS_FAIL_COUNT >= 5:
                    CS_CIRCUIT_OPEN = True
                return {}

        except Exception as e:
            CS_FAIL_COUNT += 1
            print(f"CS {exchange} Error: {e}")
            if CS_FAIL_COUNT >= 5:
                CS_CIRCUIT_OPEN = True
            return {}

    except Exception as e:
        CS_FAIL_COUNT += 1
        print(f"CoinSwitch connection error: {e}")
        if CS_FAIL_COUNT >= 5:
            CS_CIRCUIT_OPEN = True
        return {}

@app.get("/api/rates")
async def get_rates():
    binance_task = fetch_binance_rates()
    coinswitch_task = fetch_coinswitch_rates()
    
    binance_rates, coinswitch_rates = await asyncio.gather(binance_task, coinswitch_task)
    
    return {
        "binance": binance_rates,
        "coinswitch": coinswitch_rates
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
