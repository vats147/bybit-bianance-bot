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

# Bybit Configuration
BYBIT_API_URL = "https://api.bybit.com/v5/market/tickers"
BYBIT_API_KEY = "GS68TldhIYqdRUOz4V"
BYBIT_SECRET = "b5suxCOFWQsV2IoGDZ2HnNyhxDvt4NQNAReK"

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

async def fetch_bybit_rates():
    try:
        loop = asyncio.get_event_loop()
        params = {"category": "linear"}
        
        # Public endpoint allows fetching all tickers without signature if limits permit.
        # Given we just need a single call, we can try without signature first which is simpler.
        # But user gave keys, so let's use standard public access for now as verified in check_bybit.py
        
        response = await loop.run_in_executor(None, functools.partial(requests.get, BYBIT_API_URL, params=params))
        
        if response.status_code == 200:
            data = response.json()
            if data['retCode'] == 0:
                rates = {}
                for item in data['result']['list']:
                    if item['symbol'].endswith('USDT'):
                        # Remove USDT suffix
                        symbol = item['symbol'][:-4] 
                        
                        fr = item.get('fundingRate', '0')
                        mp = item.get('markPrice', '0')
                        
                        rates[symbol] = {
                            "rate": float(fr) if fr else 0.0,
                            "markPrice": float(mp) if mp else 0.0
                        }
                return rates
            else:
                print(f"Bybit API Error: {data['retMsg']}")
    except Exception as e:
        print(f"Bybit Error: {e}")
    return {}

@app.get("/api/rates")
async def get_rates():
    # Fetch both concurrently
    binance_task = fetch_binance_rates()
    bybit_task = fetch_bybit_rates()
    
    binance_rates, bybit_rates = await asyncio.gather(binance_task, bybit_task)
    
    return {
        "binance": binance_rates,
        "bybit": bybit_rates
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
