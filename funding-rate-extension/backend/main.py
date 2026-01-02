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
# Load environment variables from .env file
load_dotenv()

# --- SCHEDULER & PROFIT TRACKING ---
class TradeScheduler:
    def __init__(self):
        self.tasks = {} # taskId -> { status, details, profit }
        self.profit_log = [] # List of { time, symbol, profit }

    async def execute_trade_sequence(self, task_id, params):
        """
        Executes:
        1. Wait until (TargetTime - 20s) -> MARKET BUY
        2. Wait until (TargetTime + 10s) -> MARKET SELL
        3. Record estimated profit
        """
        try:
            target_time = params['targetTime'] # Unix timestamp in seconds
            now = time.time()
            
            # 1. Wait for Entry (Target - 20s)
            entry_time = target_time - 20
            delay_entry = entry_time - now
            
            if delay_entry > 0:
                self.tasks[task_id]['status'] = f"WAITING_ENTRY (Starts in {int(delay_entry)}s)"
                await asyncio.sleep(delay_entry)
            
            # --- EXECUTE ENTRY ---
            self.tasks[task_id]['status'] = "EXECUTING_ENTRY"
            
            # Call Place Order Logic (Reuse existing function logic or direct call)
            # For simplicity, we'll simulate the call logic or verify connection
            # In production, you'd call the `place_order` internal function directly
            
            # Entry Order
            entry_side = params['direction']
            await self._internal_place_order(params['symbol'], entry_side, params['qty'], params['leverage'], params['platform'])
            
            # 2. Wait for Exit (Target + 10s) -> 30s duration from entry
            # Total wait from Entry point is ~30s (20s pre + 10s post)
            await asyncio.sleep(30)
            
            # --- EXECUTE EXIT ---
            self.tasks[task_id]['status'] = "EXECUTING_EXIT"
            exit_side = "Sell" if entry_side == "Buy" else "Buy"
            await self._internal_place_order(params['symbol'], exit_side, params['qty'], params['leverage'], params['platform'])
            
            # 3. PROFIT CALCULATION ( Simulated / Estimated )
            # Profit ~ (Position Value * Funding Rate) - Fees
            # We'll use a simplified estimate: Qty * Mark Price * Funding Rate (if available)
            estimated_profit = self._calculate_profit(params)
            
            self.tasks[task_id]['status'] = "COMPLETED"
            self.tasks[task_id]['profit'] = estimated_profit
            self.profit_log.append({
                "time": time.time(),
                "symbol": params['symbol'],
                "profit": estimated_profit,
                "type": "Funding Arbitrage"
            })
            
        except Exception as e:
            print(f"Scheduler Error: {e}")
            self.tasks[task_id]['status'] = f"FAILED: {str(e)}"

    async def _internal_place_order(self, symbol, side, qty, leverage, platform):
        # Depending on platform, call appropriate internal logic
        # For Demo/Test, we print. For Real, we'd invoke the same logic as the API route.
        print(f"⚡️ SCHEDULER EXECUTION: {platform} {side} {symbol} x{leverage} Qty:{qty}")
        
        # NOTE: To actually execute, we need to extract the logic from `place_order` into a reusable function 
        # that doesn't depend on FastAPI Request objects (Header dependency injection).
        # For now, we assume we have default keys or this method handles it.
        pass

    def _calculate_profit(self, params):
        # Mock calculation based on typical funding rate
        # Real calculation would need current funding rate fetch
        return float(params['qty']) * 0.0001 * 100 # Mock: 0.01% of notional? Just a placeholder.

scheduler = TradeScheduler()


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
    return await execute_bybit_logic(api_key, api_secret, order.symbol, order.side, order.qty, order.leverage, order.category)

# --- REUSABLE LOGIC ---

async def execute_bybit_logic(api_key, api_secret, symbol, side, qty, leverage, category="linear"):
    try:
        endpoint = "/v5/order/create"
        url = BYBIT_DEMO_URL + endpoint
        
        # 1. Set Leverage
        try:
            leverage_endpoint = "/v5/position/set-leverage"
            leverage_url = BYBIT_DEMO_URL + leverage_endpoint
            leverage_payload = {
                "category": category,
                "symbol": symbol + "USDT" if not symbol.endswith("USDT") else symbol,
                "buyLeverage": str(leverage),
                "sellLeverage": str(leverage)
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
            "category": category,
            "symbol": symbol + "USDT" if not symbol.endswith("USDT") else symbol,
            "side": side,
            "orderType": "Market",
            "qty": str(qty),
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

    except HTTPException as he:
        raise he
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Bybit Order Logic Failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def execute_binance_logic(api_key, api_secret, symbol, side, qty, leverage, is_testnet=True):
    base_url = "https://testnet.binancefuture.com" if is_testnet else "https://fapi.binance.com"
    endpoint = "/fapi/v1/order"
    
    try:
        # 1. Set Leverage
        try:
            lev_endpoint = "/fapi/v1/leverage"
            lev_params = {
                "symbol": symbol + "USDT" if not symbol.endswith("USDT") else symbol,
                "leverage": leverage,
                "timestamp": int(time.time() * 1000)
            }
            lev_query_string = urlencode(lev_params)
            lev_signature = hmac.new(api_secret.encode('utf-8'), lev_query_string.encode('utf-8'), hashlib.sha256).hexdigest()
            
            lev_headers = { "X-MBX-APIKEY": api_key }
            requests.post(f"{base_url}{lev_endpoint}?{lev_query_string}&signature={lev_signature}", headers=lev_headers)
        except Exception as e:
            print(f"Binance Leverage Error (Non-fatal): {e}")

        # 2. Place Order
        params = {
            "symbol": symbol + "USDT" if not symbol.endswith("USDT") else symbol,
            "side": side.upper(),
            "type": "MARKET",
            "quantity": qty,
            "timestamp": int(time.time() * 1000)
        }
        
        query_string = urlencode(params)
        signature = hmac.new(api_secret.encode('utf-8'), query_string.encode('utf-8'), hashlib.sha256).hexdigest()
        
        final_url = f"{base_url}{endpoint}?{query_string}&signature={signature}"
        headers = { "X-MBX-APIKEY": api_key }
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, lambda: requests.post(final_url, headers=headers))
        
        data = response.json()
        
        if "code" in data and data["code"] != 0:
             print(f"Binance API Error: {data}")
             raise HTTPException(status_code=400, detail=f"Binance Error: {data.get('msg')} (Code: {data.get('code')})")
             
        return {"status": "success", "data": data}

    except HTTPException as he:
        raise he
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Binance Order Logic Failed: {e}")
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
        import traceback
        traceback.print_exc()
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



# --- BINANCE INTEGRATION ---

class BinanceOrderRequest(BaseModel):
    symbol: str
    side: str
    qty: float
    leverage: int = 5
    is_testnet: bool = True

def get_binance_credentials(x_user_key: Optional[str], x_user_secret: Optional[str]):
    # Only support Header keys for now as we didn't add env vars for Binance
    if not x_user_key or not x_user_secret:
         raise HTTPException(status_code=400, detail="Binance API Keys missing. Configure in Settings.")
    return x_user_key, x_user_secret

@app.post("/api/binance/place-order")
async def place_binance_order(
    order: BinanceOrderRequest,
    x_user_binance_key: Optional[str] = Header(None),
    x_user_binance_secret: Optional[str] = Header(None)
):
    api_key, api_secret = get_binance_credentials(x_user_binance_key, x_user_binance_secret)
    return await execute_binance_logic(api_key, api_secret, order.symbol, order.side, order.qty, order.leverage, order.is_testnet)


@app.get("/api/binance/testnet-symbols")
async def get_testnet_symbols():
    try:
        url = "https://testnet.binancefuture.com/fapi/v1/exchangeInfo"
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, requests.get, url)
        
        if response.status_code == 200:
            data = response.json()
            # Filter for symbols that are TRADING
            # And strip USDT to match our internal format
            valid_symbols = [
                s['symbol'].replace("USDT", "") 
                for s in data['symbols'] 
                if s['status'] == "TRADING" and s['symbol'].endswith("USDT")
            ]
            return {"symbols": valid_symbols}
        return {"symbols": []}
    except Exception as e:
        print(f"Error fetching testnet symbols: {e}")
        return {"symbols": []}


@app.get("/api/binance/wallet-balance")
async def get_binance_balance(
    x_user_binance_key: Optional[str] = Header(None),
    x_user_binance_secret: Optional[str] = Header(None),
    is_testnet: bool = True 
):
    # Note: is_testnet param via query, usually sent by frontend
    api_key, api_secret = get_binance_credentials(x_user_binance_key, x_user_binance_secret)
    base_url = "https://testnet.binancefuture.com" if is_testnet else "https://fapi.binance.com"
    endpoint = "/fapi/v2/balance"

    try:
        timestamp = int(time.time() * 1000)
        params = {"timestamp": timestamp}
        query_string = urlencode(params)
        signature = hmac.new(api_secret.encode('utf-8'), query_string.encode('utf-8'), hashlib.sha256).hexdigest()
        
        final_url = f"{base_url}{endpoint}?{query_string}&signature={signature}"
        headers = { "X-MBX-APIKEY": api_key }
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, lambda: requests.get(final_url, headers=headers))
        
        if response.status_code != 200:
             return {"error": response.json()}
             
        # Filter for non-zero balances or format it nicely
        data = response.json()
        return data
    except Exception as e:
        print(f"Binance Balance Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/binance/orders")
async def get_binance_orders(
    x_user_binance_key: Optional[str] = Header(None),
    x_user_binance_secret: Optional[str] = Header(None),
    is_testnet: bool = True,
    symbol: Optional[str] = None
):
    api_key, api_secret = get_binance_credentials(x_user_binance_key, x_user_binance_secret)
    base_url = "https://testnet.binancefuture.com" if is_testnet else "https://fapi.binance.com"
    endpoint = "/fapi/v1/userTrades" # User Trades (Fills) is better than All Orders for history

    try:
        timestamp = int(time.time() * 1000)
        params = {"timestamp": timestamp}
        if symbol:
            params['symbol'] = symbol
            
        # If no symbol provided, Binance usually requires it or has a different endpoint /fapi/v1/userTrades requires symbol? 
        # Actually /fapi/v1/userTrades REQUIRES symbol. 
        # /fapi/v1/allOrders REQUIRES symbol.
        # Handling: If no symbol, maybe return empty or error? Or iterate typical pairs? 
        # For a dashboard, maybe we want recent account activity? 
        # Endpoint /fapi/v1/income might be better for general history without symbol.
        # Let's try /fapi/v1/userTrades but warn if no symbol.
        # BUT, /fapi/v1/income (Transaction History) works without symbol (defaults to last 7 days).
        
        endpoint = "/fapi/v1/income" # Switch to income/transaction history
        
        query_string = urlencode(params)
        signature = hmac.new(api_secret.encode('utf-8'), query_string.encode('utf-8'), hashlib.sha256).hexdigest()
        
        final_url = f"{base_url}{endpoint}?{query_string}&signature={signature}"
        headers = { "X-MBX-APIKEY": api_key }
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, lambda: requests.get(final_url, headers=headers))
        
        return response.json()
    except Exception as e:
        print(f"Binance Orders Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/metadata")
async def get_metadata():
    """
    Fetches instrument info (Funding Intervals) from Bybit and Binance.
    Returns a map: Symbol -> { bybitInterval: int (hours), binanceInterval: int (hours) }
    """
    try:
        loop = asyncio.get_event_loop()
        
        # 1. Fetch Bybit Intervals
        bybit_url = "https://api.bybit.com/v5/market/instruments-info?category=linear"
        bybit_task = loop.run_in_executor(None, requests.get, bybit_url)
        
        # 2. Fetch Binance Intervals (Use fundingInfo for accurate hours)
        binance_url = "https://fapi.binance.com/fapi/v1/fundingInfo"
        binance_task = loop.run_in_executor(None, requests.get, binance_url)
        
        r_bybit, r_binance = await asyncio.gather(bybit_task, binance_task)
        
        metadata = {}
        
        # Process Bybit
        if r_bybit.status_code == 200:
            d = r_bybit.json()
            if d['retCode'] == 0:
                for item in d['result']['list']:
                    if not item['symbol'].endswith("USDT"): continue
                    sym = item['symbol'].replace("USDT", "") 
                    
                    interval_min = int(item.get('fundingInterval', 480))
                    metadata[sym] = { "bybit": interval_min // 60 } # Convert to hours
        
        # Process Binance (fundingInfo returns list of objects)
        if r_binance.status_code == 200:
            d = r_binance.json()
            # Binance returns list of { symbol, fundingIntervalHours, ... }
            if isinstance(d, list):
                for item in d:
                    if not item['symbol'].endswith("USDT"): continue
                    sym = item['symbol'].replace("USDT", "")
                    
                    interval_hours = item.get('fundingIntervalHours', 8)
                    
                    if sym not in metadata: metadata[sym] = {}
                    metadata[sym]["binance"] = interval_hours

        return metadata

    except Exception as e:
        print(f"Metadata Error: {e}")
        return {}


# --- SCHEDULER LOGIC ---

class ScheduleRequest(BaseModel):
    symbol: str
    direction: str # "Buy" or "Sell"
    targetTime: float # Unix timestamp
    leverage: int = 5
    qty: float
    platform: str = "Both"

class TradeScheduler:
    def __init__(self):
        self.tasks = {} # taskId -> { status, details, profit }
        self.profit_log = [] # List of { time, symbol, profit }

    async def execute_trade_sequence(self, task_id, params):
        """
        Executes:
        1. Wait until (TargetTime - 20s) -> MARKET BUY
        2. Wait until (TargetTime + 10s) -> MARKET SELL
        3. Record estimated profit
        """
        try:
            target_time = params['targetTime'] # Unix timestamp in seconds
            now = time.time()
            
            # 1. Wait for Entry (Target - 20s)
            entry_time = target_time - 20
            delay_entry = entry_time - now
            
            if delay_entry > 0:
                self.tasks[task_id]['status'] = f"WAITING_ENTRY (Starts in {int(delay_entry)}s)"
                await asyncio.sleep(delay_entry)
            
            # --- EXECUTE ENTRY ---
            self.tasks[task_id]['status'] = "EXECUTING_ENTRY"
            
            entry_side = params['direction']
            await self._internal_place_order(params['symbol'], entry_side, params['qty'], params['leverage'], params['platform'], params)
            
            # 2. Wait for Exit (Target + 10s) -> 30s duration from entry
            # Total wait from Entry point is ~30s (20s pre + 10s post)
            await asyncio.sleep(30)
            
            # --- EXECUTE EXIT ---
            self.tasks[task_id]['status'] = "EXECUTING_EXIT"
            exit_side = "Sell" if entry_side == "Buy" else "Buy"
            await self._internal_place_order(params['symbol'], exit_side, params['qty'], params['leverage'], params['platform'], params)
            
            # 3. PROFIT CALCULATION ( Simulated / Estimated )
            # Profit ~ (Position Value * Funding Rate) - Fees
            # We'll use a simplified estimate: Qty * Mark Price * Funding Rate (if available)
            estimated_profit = self._calculate_profit(params)
            
            self.tasks[task_id]['status'] = "COMPLETED"
            self.tasks[task_id]['profit'] = estimated_profit
            self.profit_log.append({
                "time": time.time(),
                "symbol": params['symbol'],
                "profit": estimated_profit,
                "type": "Funding Arbitrage"
            })
            
        except Exception as e:
            print(f"Scheduler Error: {e}")
            self.tasks[task_id]['status'] = f"FAILED: {str(e)}"

    async def _internal_place_order(self, symbol, side, qty, leverage, platform, params={}):
        # Depending on platform, call appropriate internal logic
        print(f"⚡️ SCHEDULER EXECUTION: {platform} {side} {symbol} x{leverage} Qty:{qty}")
        
        # REAL EXECUTION USING KEYS (Params > Env)
        try:
            if platform == "BYBIT" or platform == "Both":
                 # Load Keys (Params first, then Env)
                 api_key = params.get('bybit_key') or os.getenv("USER_BYBIT_KEY") 
                 api_secret = params.get('bybit_secret') or os.getenv("USER_BYBIT_SECRET")
                 
                 if not api_key:
                     # Check fallbacks or default demo
                     api_key = DEFAULT_BYBIT_API_KEY
                     api_secret = DEFAULT_BYBIT_SECRET
                 
                 # Only execute if we have keys (and not placeholder)
                 if api_key and "YOUR_" not in api_key:
                     print(f"Executing Bybit Order via Scheduler...")
                     await execute_bybit_logic(api_key, api_secret, symbol, side, qty, leverage)
            
            if platform == "BINANCE" or platform == "Both":
                 # Load Keys
                 api_key = params.get('binance_key') or os.getenv("USER_BINANCE_KEY") 
                 api_secret = params.get('binance_secret') or os.getenv("USER_BINANCE_SECRET")
                 
                 if api_key and "YOUR_" not in api_key:
                     print(f"Executing Binance Order via Scheduler...")
                     # Assume Testnet for Scheduler unless specified?
                     is_testnet = True 
                     await execute_binance_logic(api_key, api_secret, symbol, side, qty, leverage, is_testnet)

        except Exception as e:
            print(f"❌ Scheduler Execution Failed: {e}")
            raise e


    def _calculate_profit(self, params):
        # Mock calculation
        # In real world, fetch current funding rate for symbol
        return float(params['qty']) * 0.0001 * float(params['leverage']) # Mock 0.01%


scheduler = TradeScheduler()
@app.post("/api/schedule-trade")
async def schedule_trade(
    req: ScheduleRequest,
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None),
    x_user_binance_key: Optional[str] = Header(None),
    x_user_binance_secret: Optional[str] = Header(None)
):
    import uuid
    task_id = str(uuid.uuid4())
    
    # Enrich params with keys from headers if present
    params = req.dict()
    if x_user_bybit_key: params['bybit_key'] = x_user_bybit_key
    if x_user_bybit_secret: params['bybit_secret'] = x_user_bybit_secret
    if x_user_binance_key: params['binance_key'] = x_user_binance_key
    if x_user_binance_secret: params['binance_secret'] = x_user_binance_secret

    scheduler.tasks[task_id] = {
        "status": "QUEUED",
        "params": params,
        "profit": 0,
        "created_at": time.time()
    }
    
    # Fire and Forget
    asyncio.create_task(scheduler.execute_trade_sequence(task_id, params))
    
    return {"status": "queued", "taskId": task_id}

@app.get("/api/scheduled-tasks")
async def get_scheduled_tasks():
    return {
        "tasks": scheduler.tasks,
        "profit_log": scheduler.profit_log
    }

if __name__ == "__main__":
    import uvicorn
    # Listen on all interfaces with Hot Reload enabled
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
