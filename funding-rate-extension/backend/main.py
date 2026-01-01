from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
import time
import hmac
import hashlib
import json
import requests
import asyncio
from typing import Dict, Any, Optional
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

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

# Default Keys from Env or Hardcoded (Fallback)
DEFAULT_BYBIT_API_KEY = os.getenv("BYBIT_API_KEY", "GS68TldhIYqdRUOz4V")
DEFAULT_BYBIT_SECRET = os.getenv("BYBIT_SECRET", "b5suxCOFWQsV2IoGDZ2HnNyhxDvt4NQNAReK")
BYBIT_DEMO_URL = os.getenv("BYBIT_DEMO_URL", "https://api-demo.bybit.com")

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

from pydantic import BaseModel
import time
import hmac
import hashlib
import json
import requests

# Request Model
class OrderRequest(BaseModel):
    symbol: str
    side: str
    qty: float
    leverage: int = 5
    category: str = "linear"


def generate_signature(api_key, api_secret, payload):
    recv_window = "5000"
    timestamp = str(int(time.time() * 1000))
    param_str = timestamp + api_key + recv_window + payload
    hash = hmac.new(bytes(api_secret, "utf-8"), param_str.encode("utf-8"), hashlib.sha256)
    signature = hash.hexdigest()
    return timestamp, recv_window, signature

def get_api_credentials(x_user_key: Optional[str], x_user_secret: Optional[str]):
    # Priority: Header > Env/Default
    api_key = x_user_key if x_user_key else DEFAULT_BYBIT_API_KEY
    api_secret = x_user_secret if x_user_secret else DEFAULT_BYBIT_SECRET
    
    if not api_key or api_key == "YOUR_API_KEY" or api_key == "YOUR_DEMO_API_KEY":
         raise HTTPException(status_code=400, detail="API Keys not configured. Set in Settings or Backend Env.")
    
    return api_key, api_secret

@app.post("/api/place-order")
async def place_order(
    order: OrderRequest,
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None)
):
    api_key, api_secret = get_api_credentials(x_user_bybit_key, x_user_bybit_secret)
    print(f"✅ Handling Order. Key Source: {'Header' if x_user_bybit_key else 'Env/Default'}, Key: {api_key[:5]}...{api_key[-4:] if api_key else ''}")

    try:
        endpoint = "/v5/order/create"
        url = BYBIT_DEMO_URL + endpoint
        
        # 1. Set Leverage
        try:
            leverage_endpoint = "/v5/position/set-leverage"
            leverage_url = BYBIT_DEMO_URL + leverage_endpoint
            leverage_payload = {
                "category": order.category,
                "symbol": order.symbol + "USDT" if not order.symbol.endswith("USDT") else order.symbol,
                "buyLeverage": str(order.leverage),
                "sellLeverage": str(order.leverage)
            }
            lev_json = json.dumps(leverage_payload)
            ts_lev, win_lev, sig_lev = generate_signature(api_key, api_secret, lev_json)
            headers_lev = {
                "X-BAPI-API-KEY": api_key,
                "X-BAPI-SIGN": sig_lev,
                "X-BAPI-TIMESTAMP": ts_lev,
                "X-BAPI-RECV-WINDOW": win_lev,
                "Content-Type": "application/json"
            }
            requests.post(leverage_url, headers=headers_lev, data=lev_json)
        except Exception as e:
            print(f"Set Leverage Warning: {e}")

        # 2. Place Market Order
        order_payload = {
            "category": order.category,
            "symbol": order.symbol + "USDT" if not order.symbol.endswith("USDT") else order.symbol,
            "side": order.side,
            "orderType": "Market",
            "qty": str(order.qty),
        }
        
        payload_json = json.dumps(order_payload)
        timestamp, recv_window, signature = generate_signature(api_key, api_secret, payload_json)
        
        headers = {
            "X-BAPI-API-KEY": api_key,
            "X-BAPI-SIGN": signature,
            "X-BAPI-TIMESTAMP": timestamp,
            "X-BAPI-RECV-WINDOW": recv_window,
            "Content-Type": "application/json"
        }
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, lambda: requests.post(url, headers=headers, data=payload_json))
        
        data = response.json()
        
        if data.get("retCode") == 0:
            return {"status": "success", "data": data["result"], "retMsg": data["retMsg"]}
        else:
            print(f"Bybit API Error: {data}")
            raise HTTPException(status_code=400, detail=f"Bybit Error: {data.get('retMsg')} (Code: {data.get('retCode')})")

    except Exception as e:
        print(f"Order Placement Failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/wallet-balance")
async def get_wallet_balance(
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None)
):
    api_key, api_secret = get_api_credentials(x_user_bybit_key, x_user_bybit_secret)

    try:
        endpoint = "/v5/account/wallet-balance"
        url = BYBIT_DEMO_URL + endpoint
        params = "accountType=UNIFIED"
        
        timestamp, recv_window, signature = generate_signature(api_key, api_secret, params)
        
        headers = {
            "X-BAPI-API-KEY": api_key,
            "X-BAPI-SIGN": signature,
            "X-BAPI-TIMESTAMP": timestamp,
            "X-BAPI-RECV-WINDOW": recv_window,
            "Content-Type": "application/json"
        }
        
        final_url = f"{url}?{params}"
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, lambda: requests.get(final_url, headers=headers))
        
        return response.json()
    except Exception as e:
        print(f"Wallet Balance Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/transaction-log")
async def get_transaction_log(
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None)
):
    api_key, api_secret = get_api_credentials(x_user_bybit_key, x_user_bybit_secret)

    try:
        endpoint = "/v5/account/transaction-log"
        url = BYBIT_DEMO_URL + endpoint
        query_params = {
            "accountType": "UNIFIED",
            "category": "linear", 
            "limit": "20"
        }
        param_str_list = []
        for key in sorted(query_params.keys()):
            param_str_list.append(f"{key}={query_params[key]}")
        params = "&".join(param_str_list)

        timestamp, recv_window, signature = generate_signature(api_key, api_secret, params)
        
        headers = {
            "X-BAPI-API-KEY": api_key,
            "X-BAPI-SIGN": signature,
            "X-BAPI-TIMESTAMP": timestamp,
            "X-BAPI-RECV-WINDOW": recv_window,
            "Content-Type": "application/json"
        }
        
        final_url = f"{url}?{params}"
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, lambda: requests.get(final_url, headers=headers))
        
        return response.json()
    except Exception as e:
        print(f"Transaction Log Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))



if __name__ == "__main__":
    import uvicorn
    # Listen on all interfaces
    uvicorn.run(app, host="0.0.0.0", port=8000)


