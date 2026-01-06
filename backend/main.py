from fastapi import FastAPI, HTTPException, Header, Request, WebSocket, WebSocketDisconnect
from contextlib import asynccontextmanager
from typing import List
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import time
import hmac
import hashlib
import json
import requests
import asyncio
from typing import Dict, Any, Optional
import os
from dotenv import load_dotenv
import datetime
import functools
import uuid

# Load environment variables from .env file
try:
    with open("/Users/vats/Desktop/newBOt/debug_log.txt", "a") as f:
        f.write(f"[{datetime.datetime.now()}] MAIN MODULE LOADED\n")
except: pass

# Load environment variables from .env file
# --- SCHEDULER & PROFIT TRACKING ---
class TradeScheduler:
    def __init__(self):
        self.tasks = {} # taskId -> { status, details, profit }
        self.profit_log = [] # List of { time, symbol, profit }

    async def execute_trade_sequence(self, task_id, params):
        try:
            target_time = params['targetTime']
            now = time.time()
            if (target_time - 20) - now > 0:
                self.tasks[task_id]['status'] = f"WAITING_ENTRY"
                await asyncio.sleep((target_time-20)-now)
            
            if params.get('platform') == "Both":
                rates_data = await get_rates() 
                sym = params['symbol']
                bin_r = rates_data['binance'].get(sym, {}).get('rate', 0)
                byb_r = rates_data['bybit'].get(sym, {}).get('rate', 0)
                if byb_r > bin_r:
                    params['bybit_side'], params['binance_side'] = "Sell", "Buy"
                else:
                    params['bybit_side'], params['binance_side'] = "Buy", "Sell"
            
            self.tasks[task_id]['status'] = "EXECUTING_ENTRY"
            tasks = []
            if params['platform'] in ["Bybit", "Both"]:
                tasks.append(self._internal_place_order(params['symbol'], params['bybit_side'], params['qty'], params['leverage'], "BYBIT", params))
            if params['platform'] in ["Binance", "Both"]:
                tasks.append(self._internal_place_order(params['symbol'], params['binance_side'], params['qty'], params['leverage'], "BINANCE", params))
            await asyncio.gather(*tasks)
            
            await asyncio.sleep(params.get('duration', 30))
            self.tasks[task_id]['status'] = "EXECUTING_EXIT"
            exits = []
            if params['platform'] in ["Bybit", "Both"]:
                exits.append(self._internal_place_order(params['symbol'], "Sell" if params['bybit_side']=="Buy" else "Buy", params['qty'], params['leverage'], "BYBIT", params))
            if params['platform'] in ["Binance", "Both"]:
                exits.append(self._internal_place_order(params['symbol'], "Sell" if params['binance_side']=="Buy" else "Buy", params['qty'], params['leverage'], "BINANCE", params))
            await asyncio.gather(*exits)
            
            self.tasks[task_id]['status'] = "COMPLETED"
        except Exception as e:
            self.tasks[task_id]['status'] = f"FAILED: {e}"

    async def _internal_place_order(self, symbol, side, qty, leverage, platform, params={}):
        try:
             bybit_key = params.get('bybit_key') or os.getenv("USER_BYBIT_KEY") 
             bybit_secret = params.get('bybit_secret') or os.getenv("USER_BYBIT_SECRET")
             binance_key = params.get('binance_key') or os.getenv("USER_BINANCE_KEY")
             binance_secret = params.get('binance_secret') or os.getenv("USER_BINANCE_SECRET")
             session = session_manager.get_session(bybit_key, bybit_secret, binance_key, binance_secret)
             is_live = session.config.get('is_live', False) if session else False
             
             res = {"status": "error", "message": "Execution bypassed"}
             if platform == "BYBIT":
                  api_key = bybit_key or DEFAULT_BYBIT_API_KEY
                  api_secret = bybit_secret or DEFAULT_BYBIT_SECRET
                  if api_key and "YOUR_" not in api_key:
                      res = await execute_bybit_logic(api_key, api_secret, symbol, side, qty, leverage, is_live=is_live)
             elif platform == "BINANCE":
                  api_key = binance_key or os.getenv("USER_BINANCE_KEY")
                  api_secret = binance_secret or os.getenv("USER_BINANCE_SECRET")
                  if api_key and "YOUR_" not in api_key:
                      res = await execute_binance_logic(api_key, api_secret, symbol, side, qty, leverage, is_testnet=not is_live)

             return res if res else {"status": "error", "message": "No response"}
        except Exception as e:
            raise e

    def _calculate_profit(self, params):
        return float(params['qty']) * 0.0001 * float(params['leverage'])

scheduler = TradeScheduler()
load_dotenv()

# --- SCHEDULER & PROFIT TRACKING ---
# --- SCHEDULER & PROFIT TRACKING ---
# (Class definition moved lower to consolidate all logic)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic
    asyncio.create_task(update_binance_intervals())
    asyncio.create_task(update_bybit_intervals())
    
    # Start Managers (Both Live and Testnet)
    binance_live_wm.start(is_live=True)
    binance_test_wm.start(is_live=False)
    bybit_ws_manager.start(is_live=True)
    
    # Start services
    asyncio.create_task(broadcast_rates())
    asyncio.create_task(auto_trade_service())
    
    yield
    # Shutdown logic (optional)
    print("Shutting down...")

app = FastAPI(lifespan=lifespan)

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"status": "success", "message": "Binance Bot API is running on Hugging Face Spaces!"}

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
BYBIT_API_TESTNET_URL = "https://api-testnet.bybit.com/v5/market/tickers"

BYBIT_WS_LIVE = "wss://stream.bybit.com/v5/public/linear"
BYBIT_WS_TESTNET = "wss://stream-testnet.bybit.com/v5/public/linear"

# Default Keys from Env or Hardcoded (Fallback)
# Default Keys from Env or Hardcoded (Fallback)
DEFAULT_BYBIT_API_KEY = os.getenv("BYBIT_API_KEY", "GS68TldhIYqdRUOz4V")
DEFAULT_BYBIT_SECRET = os.getenv("BYBIT_SECRET", "b5suxCOFWQsV2IoGDZ2HnNyhxDvt4NQNAReK")
BYBIT_DEMO_URL = os.getenv("BYBIT_DEMO_URL", "https://api-testnet.bybit.com")

# Cache for Instrument Info (qtyStep, minOrderQty)
INSTRUMENT_CACHE = {}
# Cache for Binance symbol info (precision, stepSize)
BINANCE_SYMBOL_INFO = {}
# Cache for Binance Funding Intervals
BINANCE_INTERVAL_CACHE = {}
# Cache for Bybit Funding Intervals
BYBIT_INTERVAL_CACHE = {}

async def update_bybit_intervals():
    """Fetches funding intervals from Bybit API."""
    global BYBIT_INTERVAL_CACHE
    try:
        url = "https://api.bybit.com/v5/market/tickers?category=linear"
        print(f"DEBUG: Updating Bybit Funding Intervals from {url}...")
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, requests.get, url)
        
        if response.status_code == 200:
            data = response.json()
            if data['retCode'] == 0:
                count = 0
                for item in data['result']['list']:
                    symbol_raw = item.get('symbol', '')
                    if symbol_raw.endswith('USDT'):
                        symbol = symbol_raw.replace('USDT', '')
                        # Bybit uses 'fundingIntervalHour' (singular, in hours)
                        fih = item.get('fundingIntervalHour', '8')
                        try:
                            interval_hours = int(fih) if int(fih) < 24 else int(fih) // 60
                            BYBIT_INTERVAL_CACHE[symbol] = interval_hours
                            count += 1
                        except:
                            BYBIT_INTERVAL_CACHE[symbol] = 8
                print(f"✅ Loaded Bybit Intervals for {count} symbols.")
            else:
                print(f"⚠️ Bybit API Error: {data['retMsg']}")
        else:
            print(f"⚠️ Failed to fetch Bybit Intervals: {response.status_code}")
    except Exception as e:
        print(f"❌ Error updating Bybit Intervals: {e}")

async def update_binance_intervals():
    """Fetches funding intervals from Binance API."""
    global BINANCE_INTERVAL_CACHE, BINANCE_SYMBOL_INFO
    try:
        # 1. Update Intervals
        itv_url = "https://fapi.binance.com/fapi/v1/fundingInfo"
        print(f"DEBUG: Updating Binance Funding Intervals...")
        itv_res = await asyncio.to_thread(requests.get, itv_url, timeout=10)
        if itv_res.status_code == 200:
            data = itv_res.json()
            for item in data:
                s = item.get('symbol', '').replace('USDT', '')
                if 'fundingIntervalHours' in item:
                    BINANCE_INTERVAL_CACHE[s] = int(item['fundingIntervalHours'])
            print(f"✅ Loaded Binance Intervals for {len(BINANCE_INTERVAL_CACHE)} symbols.")

        # 2. Update Exchange Info (Precision)
        info_url = "https://fapi.binance.com/fapi/v1/exchangeInfo"
        print(f"DEBUG: Updating Binance Exchange Info (Precision)...")
        info_res = await asyncio.to_thread(requests.get, info_url, timeout=10)
        if info_res.status_code == 200:
            info_data = info_res.json()
            for s in info_data.get("symbols", []):
                sym = s["symbol"].replace("USDT","")
                BINANCE_SYMBOL_INFO[sym] = {
                    "quantityPrecision": s.get("quantityPrecision", 2),
                    "stepSize": 0.001 # Default
                }
                for f in s.get("filters", []):
                    if f["filterType"] == "LOT_SIZE":
                        BINANCE_SYMBOL_INFO[sym]["stepSize"] = float(f["stepSize"])
            print(f"✅ Loaded Binance Symbol Info for {len(BINANCE_SYMBOL_INFO)} symbols.")
    except Exception as e:
        print(f"❌ Error updating Binance data: {e}")

# --- CLIENT WEBSOCKET MANAGER ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception as e:
                # Handle disconnection or send error gracefully
                pass

manager = ConnectionManager()

@app.websocket("/ws/clients")
async def websocket_endpoint(websocket: WebSocket, is_live: bool = False):
    print(f"WS: Connection attempt received. is_live={is_live}")
    try:
        await manager.connect(websocket)
        print("WS: Connection accepted and added to manager.")
        while True:
            # Keep connection alive, listen for ping/commands
            data = await websocket.receive_text()
            try:
                # Parse message
                msg = json.loads(data)
                if msg.get("op") == "ping":
                    # Respond with pong
                    await websocket.send_text(json.dumps({"op": "pong"}))
                elif msg.get("op") == "init":
                     # Client just informing of its local mode, no server toggle needed.
                     pass
            except json.JSONDecodeError:
                pass # Ignore non-JSON (if any)
            except Exception as e:
                print(f"WS: Message handling error: {e}")

    except WebSocketDisconnect:
        print("WS: Client disconnected.")
        manager.disconnect(websocket)
    except Exception as e:
        print(f"WS: Error in endpoint: {e}")
        manager.disconnect(websocket)

async def broadcast_rates():
    """Background task to push rates to connected clients every 1s."""
    print("🚀 Rate Broadcaster Started")
    while True:
        try:
            if manager.active_connections:
                # 1. Gather Data from Dual Managers
                bn_live_data = binance_live_wm.get_rates()
                bn_test_data = binance_test_wm.get_rates()
                bb_data = bybit_ws_manager.get_rates()
                
                # Transform Binance Live
                bn_live_out = {sym: {"rate": info['fundingRate'], "markPrice": info['markPrice'], "nextFundingTime": info['nextFundingTime'], "fundingIntervalHours": info.get('fundingIntervalHours', 8)} 
                                 for sym, info in bn_live_data.items()}
                
                # Transform Binance Testnet
                bn_test_out = {sym: {"rate": info['fundingRate'], "markPrice": info['markPrice'], "nextFundingTime": info['nextFundingTime'], "fundingIntervalHours": info.get('fundingIntervalHours', 8)} 
                                 for sym, info in bn_test_data.items()}
                
                # Transform Bybit (Shared Source)
                bybit_out = {sym: {"rate": info['fundingRate'], "markPrice": info['markPrice'], "nextFundingTime": info['nextFundingTime'], "fundingIntervalHours": info.get('fundingIntervalHours', 8)} 
                               for sym, info in bb_data.items()}
                
                payload = {
                    "live": {
                        "binance": bn_live_out,
                        "bybit": bybit_out
                    },
                    "testnet": {
                        "binance": bn_test_out,
                        "bybit": bybit_out
                    },
                    "source": "websocket_dual_stream",
                    "timestamp": time.time() * 1000
                }
                
                await manager.broadcast(json.dumps(payload))
            
            # Throttle to 1s
            await asyncio.sleep(1)
        except Exception as e:
            print(f"Broadcaster Error: {e}")
            await asyncio.sleep(1)



# --- BINANCE WEBSOCKET CONFIG ---
# Note: Binance testnet market data streams may use the same URL as live (stream.binancefuture.com)
# The WS-API (for trading) uses testnet.binancefuture.com/ws-fapi/v1
BINANCE_WS_LIVE = os.getenv("BINANCE_WS_LIVE", "wss://fstream.binance.com/ws/!markPrice@arr")
BINANCE_WS_TESTNET = os.getenv("BINANCE_WS_TESTNET", "wss://stream.binancefuture.com/ws/!markPrice@arr")

import websockets
import threading

class BinanceWebSocketManager:
    """Manages WebSocket connection to Binance Futures for real-time mark price and funding rate."""
    
    def __init__(self):
        self.data = {}  # symbol -> { markPrice, fundingRate, nextFundingTime }
        self.is_live = False
        self.ws = None
        self.running = False
        self.thread = None
        self.loop = None
    
    def get_ws_url(self):
        return BINANCE_WS_LIVE if self.is_live else BINANCE_WS_TESTNET
    
    async def _connect(self):
        url = self.get_ws_url()
        print(f"🔌 Binance WS Connecting to: {url}")
        
        # SSL context for development (bypass certificate verification)
        import ssl
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        
        while self.running:
            try:
                async with websockets.connect(
                    url, 
                    ping_interval=30, 
                    ping_timeout=10, 
                    ssl=ssl_context,
                    open_timeout=15,
                    close_timeout=5
                ) as ws:
                    self.ws = ws
                    print(f"✅ Binance WS Connected ({'LIVE' if self.is_live else 'TESTNET'})")
                    
                    async for message in ws:
                        if not self.running:
                            break
                        try:
                            data = json.loads(message)
                            if isinstance(data, list):
                                count = 0
                                for item in data:
                                    symbol = item.get('s', '').replace('USDT', '')
                                    if symbol:
                                        self.data[symbol] = {
                                            'markPrice': float(item.get('p', 0)),
                                            'fundingRate': float(item.get('r', 0)),
                                            'nextFundingTime': int(item.get('T', 0)),
                                            'fundingIntervalHours': BINANCE_INTERVAL_CACHE.get(symbol, 8) # Default 8 if missing
                                        }
                                        count += 1
                                if count > 0 and len(self.data) % 100 == 0:
                                    print(f"📊 WS Data Updated: {len(self.data)} symbols")
                        except Exception as parse_err:
                            print(f"WS Parse Error: {parse_err}")
                            
            except websockets.exceptions.ConnectionClosed as e:
                if self.running:
                    print(f"⚠️ Binance WS Disconnected: {e}. Reconnecting in 5s...")
                    await asyncio.sleep(5)
            except asyncio.TimeoutError:
                if self.running:
                    print(f"⏱️ Binance WS Timeout. Reconnecting in 5s...")
                    await asyncio.sleep(5)
            except Exception as e:
                if self.running:
                    print(f"❌ Binance WS Error: {type(e).__name__}: {e}. Reconnecting in 5s...")
                    await asyncio.sleep(5)
    
    def _run_loop(self):
        loop = asyncio.new_event_loop()
        self.loop = loop
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._connect())
        except Exception as e:
            print(f"WS Loop Error: {e}")
        finally:
            try:
                # Cancel pending tasks to ensure clean exit
                tasks = asyncio.all_tasks(loop)
                for task in tasks:
                    task.cancel()
                if tasks:
                    loop.run_until_complete(asyncio.gather(*tasks, return_exceptions=True))
                loop.close()
            except Exception as e:
                print(f"Error closing loop: {e}")


    def start(self, is_live=False):
        if self.running:
            self.stop()
        
        # Clear stale data when switching modes
        self.data = {}

        self.is_live = is_live
        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        print(f"🚀 Binance WS Manager Started ({'LIVE' if is_live else 'TESTNET'})")
    
    def stop(self):
        self.running = False
        if self.ws:
            asyncio.run_coroutine_threadsafe(self.ws.close(), self.loop)
        if self.thread:
            self.thread.join(timeout=2)
        print("🛑 Binance WS Manager Stopped")
    
    def get_rates(self):
        """Returns current cached rates for all symbols."""
        return self.data

# Global WS Manager Instances
binance_live_wm = BinanceWebSocketManager()
binance_test_wm = BinanceWebSocketManager()

class BybitWebSocketManager:
    """Manages WebSocket connection to Bybit for real-time funding rates."""
    
    def __init__(self):
        self.data = {}  # symbol -> { markPrice, fundingRate, nextFundingTime, fundingIntervalHours }
        self.is_live = False
        self.ws = None
        self.running = False
        self.thread = None
        self.loop = None
    
    def get_ws_url(self):
        # Always use Live WS for accurate funding scanner rates, even if account is Testnet
        return BYBIT_WS_LIVE
    
    async def _connect(self):
        url = self.get_ws_url()
        print(f"🔌 Bybit WS Connecting to: {url}")
        
        import ssl
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        
        while self.running:
            try:
                async with websockets.connect(
                    url, 
                    ping_interval=20, 
                    ping_timeout=10, 
                    ssl=ssl_context
                ) as ws:
                    self.ws = ws
                    print(f"✅ Bybit WS Connected ({'LIVE' if self.is_live else 'TESTNET'})")
                    
                    # Bybit V5 Linear Tickers subscription topic is tickers.{symbol}
                    # We can also use 'tickers.USDT' for SOME environments but it's not universal.
                    # Best is to fetch symbols or use the shorthand if verified.
                    # Given the ambiguity, we'll try 'tickers.USDT' first as it works in some Pro/Unified accounts,
                    # but we'll also handle the individual symbol data correctly.
                    subscribe_msg = {
                        "op": "subscribe",
                        "args": ["tickers.BTCUSDT", "tickers.ETHUSDT", "tickers.SOLUSDT", "tickers.BNBUSDT"] # Priority ones
                    }
                    # Add remaining symbols if we had a list, but for now let's try a broader one first
                    # Search suggests "tickers.USDT" might not be an official "all" but is a common pattern for some categories.
                    # Let's try to subscribe dynamically by fetching symbols once.
                    
                    # Subscribe to symbols
                    try:
                        print("DEBUG: Fetching Bybit symbols for WS subscription...")
                        loop = asyncio.get_event_loop()
                        resp = await loop.run_in_executor(None, functools.partial(requests.get, BYBIT_API_URL if self.is_live else BYBIT_API_TESTNET_URL, params={"category": "linear"}))
                        
                        if resp.status_code == 200:
                            s_data = resp.json()
                            if s_data.get("retCode") == 0:
                                symbols = [f"tickers.{item['symbol']}" for item in s_data["result"]["list"] if item["symbol"].endswith("USDT")]
                                print(f"DEBUG: Found {len(symbols)} Bybit symbols.")
                                
                                if not symbols:
                                    print("WARN: No Bybit symbols found. Subscribing to default BTCUSDT.")
                                    await ws.send(json.dumps({"op": "subscribe", "args": ["tickers.BTCUSDT", "tickers.ETHUSDT"]}))
                                else:
                                    # Subscribe in chunks
                                    chunk_size = 10
                                    for i in range(0, min(len(symbols), 500), chunk_size):
                                        chunk = symbols[i : i + chunk_size]
                                        await ws.send(json.dumps({"op": "subscribe", "args": chunk}))
                                        await asyncio.sleep(0.1) # Prevent flooding
                                    print(f"DEBUG: Subscribed to {min(len(symbols), 500)} symbols.")
                            else:
                                print(f"Bybit API Error (RetCode {s_data.get('retCode')}): {s_data.get('retMsg')}")
                                raise Exception("Bybit API RetCode Error")
                        else:
                            print(f"Bybit API HTTP Error: {resp.status_code}")
                            raise Exception("Bybit API HTTP Error")
                            
                    except Exception as e:
                        print(f"Bybit WS Subscription error: {e}")
                        print("Fallback: Subscribing to default tickers.")
                        await ws.send(json.dumps({"op": "subscribe", "args": ["tickers.BTCUSDT", "tickers.ETHUSDT", "tickers.SOLUSDT"]}))
                    
                    async for message in ws:
                        if not self.running:
                            break
                        try:
                            msg_data = json.loads(message)
                            if "topic" in msg_data and msg_data["topic"].startswith("tickers"):
                                data = msg_data.get("data", {})
                                symbol = data.get("symbol", "")
                                if symbol.endswith("USDT") or symbol.endswith("PERP"):
                                    # Normalize symbol
                                    norm_symbol = symbol.replace("USDT", "").replace("PERP", "")
                                    
                                    # Update if data is present (Bybit sends delta updates)
                                    if norm_symbol not in self.data:
                                        self.data[norm_symbol] = {}
                                        
                                    if "fundingRate" in data:
                                        self.data[norm_symbol]["fundingRate"] = float(data["fundingRate"])
                                    if "markPrice" in data:
                                        self.data[norm_symbol]["markPrice"] = float(data["markPrice"])
                                    if "nextFundingTime" in data:
                                        # Bybit sends nft as milliseconds
                                        self.data[norm_symbol]["nextFundingTime"] = int(data["nextFundingTime"])
                                    
                                    # Use cached interval from REST API, or default to 8
                                    if "fundingIntervalHours" not in self.data[norm_symbol]:
                                         self.data[norm_symbol]["fundingIntervalHours"] = BYBIT_INTERVAL_CACHE.get(norm_symbol, 8)
                                         
                        except Exception as parse_err:
                            pass # Silent for high frequency
                            
            except Exception as e:
                if self.running:
                    print(f"❌ Bybit WS Error: {e}. Reconnecting in 5s...")
                    await asyncio.sleep(5)
    
    def _run_loop(self):
        loop = asyncio.new_event_loop()
        self.loop = loop
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._connect())
        except Exception as e:
            print(f"WS Loop Error: {e}")
        finally:
            try:
                # Cancel pending tasks to ensure clean exit
                tasks = asyncio.all_tasks(loop)
                for task in tasks:
                    task.cancel()
                if tasks:
                    loop.run_until_complete(asyncio.gather(*tasks, return_exceptions=True))
                loop.close()
            except Exception as e:
                print(f"Error closing loop: {e}")

    def start(self, is_live=False):
        if self.running:
            self.stop()
        self.data = {}
        self.is_live = is_live
        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        print(f"🚀 Bybit WS Manager Started ({'LIVE' if is_live else 'TESTNET'})")
    
    def stop(self):
        self.running = False
        if self.ws:
            asyncio.run_coroutine_threadsafe(self.ws.close(), self.loop)
        if self.thread:
            self.thread.join(timeout=2)
        print("🛑 Bybit WS Manager Stopped")
    
    def get_rates(self):
        return self.data

# Global instances - now redundant but kept for any legacy ref if needed (removed binance_ws_manager)
# binance_ws_manager = BinanceWebSocketManager() 
bybit_ws_manager = BybitWebSocketManager()

async def fetch_binance_rates(is_live: bool = False):
    try:
        # Switch URL based on mode
        url = "https://fapi.binance.com/fapi/v1/premiumIndex" if is_live else "https://testnet.binancefuture.com/fapi/v1/premiumIndex"
        print(f"DEBUG: Fetching Binance Rates from: {url}")
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, requests.get, url)
        if response.status_code == 200:
            data = response.json()
            rates = {}
            for item in data:
                if item['symbol'].endswith('USDT'):
                    symbol = item['symbol'].replace('USDT', '')
                    rates[symbol] = {
                        "rate": float(item['lastFundingRate']),
                        "markPrice": float(item['markPrice']),
                        "nextFundingTime": item['nextFundingTime'],
                        "fundingIntervalHours": BINANCE_INTERVAL_CACHE.get(symbol, 8)
                    }
            return rates
    except Exception as e:
        print(f"Binance Error ({'Live' if is_live else 'Testnet'}): {e}")
        return {}
    return {}

async def fetch_bybit_rates(is_live: bool = False):
    try:
        loop = asyncio.get_event_loop()
        params = {"category": "linear"}
        # Always use Live API for accurate funding scanner rates
        url = BYBIT_API_URL
        print(f"DEBUG: Fetching Bybit Rates from: {url} (Scanner always uses Live)")
        
        response = await loop.run_in_executor(None, functools.partial(requests.get, url, params=params))
        
        if response.status_code == 200:
            data = response.json()
            if data['retCode'] == 0:
                rates = {}
                for item in data['result']['list']:
                    symbol_raw = item['symbol']
                    if symbol_raw.endswith('USDT') or symbol_raw.endswith('PERP'):
                        # Normalize symbol
                        symbol = symbol_raw.replace("USDT", "").replace("PERP", "")
                        
                        fr = item.get('fundingRate', '0')
                        mp = item.get('markPrice', '0')
                        nft = item.get('nextFundingTime', '0')
                        # Bybit V5 uses 'fundingIntervalHour' (missing 's' sometimes) or 'fundingInterval'
                        fih = item.get('fundingIntervalHour') or item.get('fundingInterval', '480')
                        
                        # Convert minutes to hours if it's 480
                        interval_hours = int(fih) if int(fih) < 24 else int(fih) // 60
                        
                        rates[symbol] = {
                            "rate": float(fr) if fr else 0.0,
                            "markPrice": float(mp) if mp else 0.0,
                            "nextFundingTime": int(nft) if nft and nft != '0' else 0,
                            "fundingIntervalHours": interval_hours
                        }
                return rates
            else:
                print(f"Bybit API Error: {data['retMsg']}")
    except Exception as e:
        try:
            with open("/Users/vats/Desktop/newBOt/debug_log.txt", "a") as f:
                f.write(f"[{datetime.datetime.now()}] BYBIT FETCH ERROR: {e}\n")
        except: pass
        # print(f"Bybit Error: {e}")
    return {}

class TelegramAlertRequest(BaseModel):
    token: str
    chatId: str
    message: str
    imageUrl: Optional[str] = None
    buttonText: Optional[str] = None
    buttonUrl: Optional[str] = None

@app.post("/api/telegram/send")
async def send_telegram_alert(req: TelegramAlertRequest):
    try:
        url = f"https://api.telegram.org/bot{req.token}/"
        payload = {
            "chat_id": req.chatId,
            "text": req.message,
            "parse_mode": "Markdown"
        }
        
        if req.buttonText and req.buttonUrl:
            # Telegram requires valid public HTTPS URLs for buttons. 
            # Localhost fails with "Bad Request: inline keyboard button URL is invalid".
            if "localhost" not in req.buttonUrl and "127.0.0.1" not in req.buttonUrl:
                payload["reply_markup"] = json.dumps({
                    "inline_keyboard": [[
                        {"text": req.buttonText, "url": req.buttonUrl}
                    ]]
                })
            else:
                print(f"Skipping Telegram Button: URL {req.buttonUrl} is local/invalid for Telegram API.")

        if req.imageUrl:
            payload["photo"] = req.imageUrl
            payload["caption"] = req.message
            del payload["text"]
            # method = "sendPhoto" # Requires multipart if sending file, but URL works too
            # For simplicity, we use sendMessage if no image, or sendPhoto if image URL is provided.
            response = requests.post(url + "sendPhoto", data=payload)
        else:
            response = requests.post(url + "sendMessage", data=payload)
            
        data = response.json()
        if data.get("ok"):
            return {"status": "success"}
        else:
            return {"status": "error", "message": data.get("description", "Unknown error")}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/rates")
async def get_rates(is_live: bool = False, use_websocket: bool = True):
    """
    Returns funding rates from both Binance and Bybit. 
    Prioritizes WebSocket data if available AND matches the requested mode.
    """
    # 1. Binance Data
    # Select correct manager based on requested mode
    target_manager = binance_live_wm if is_live else binance_test_wm
    
    use_bn_ws = (use_websocket and target_manager.running)
                 
    bn_ws_data = target_manager.get_rates() if use_bn_ws else {}
    
    if bn_ws_data:
        binance_rates = {sym: {"rate": info['fundingRate'], "markPrice": info['markPrice'], "nextFundingTime": info['nextFundingTime'], "fundingIntervalHours": info.get('fundingIntervalHours', 8)} 
                         for sym, info in bn_ws_data.items()}
    else:
        binance_rates = await fetch_binance_rates(is_live)
    
    # 2. Bybit Data
    # Check if WS is running AND matches the requested mode
    use_bb_ws = (use_websocket and 
                 bybit_ws_manager.running and 
                 bybit_ws_manager.is_live == is_live)

    bb_ws_data = bybit_ws_manager.get_rates() if use_bb_ws else {}
    
    if bb_ws_data:
        bybit_rates = {sym: {"rate": info['fundingRate'], "markPrice": info['markPrice'], "nextFundingTime": info['nextFundingTime'], "fundingIntervalHours": info.get('fundingIntervalHours', 8)} 
                       for sym, info in bb_ws_data.items()}
    else:
        bybit_rates = await fetch_bybit_rates(is_live)
    
    return {
        "binance": binance_rates,
        "bybit": bybit_rates,
        "source": "websocket" if (bn_ws_data or bb_ws_data) else "rest"
    }

@app.post("/api/ws/start")
async def start_websocket(is_live: bool = False):
    """
    Legacy Endpoint: Ensures connections are running.
    Now we run both permanently, so this just verifies they are up.
    """
    if not binance_live_wm.running:
        binance_live_wm.start(is_live=True)
    if not binance_test_wm.running:
        binance_test_wm.start(is_live=False)
    if not bybit_ws_manager.running:
        bybit_ws_manager.start(is_live=True)
        
    return {
        "status": "started", 
        "mode": "DUAL_STREAM",
        "message": "Both Live and Testnet streams are active."
    }

@app.post("/api/ws/stop")
async def stop_websocket():
    """Stop all WebSocket connections."""
    binance_live_wm.stop()
    binance_test_wm.stop()
    bybit_ws_manager.stop()
    return {"status": "stopped"}

@app.get("/api/ws/status")
async def websocket_status():
    """Check WebSocket connection status for all streams."""
    return {
        "binance_live": {
            "running": binance_live_wm.running,
            "url": binance_live_wm.get_ws_url(),
            "symbols_count": len(binance_live_wm.data)
        },
        "binance_testnet": {
            "running": binance_test_wm.running,
            "url": binance_test_wm.get_ws_url(),
            "symbols_count": len(binance_test_wm.data)
        },
        "bybit": {
            "running": bybit_ws_manager.running,
            "mode": "LIVE" if bybit_ws_manager.is_live else "TESTNET",
            "url": bybit_ws_manager.get_ws_url(),
            "symbols_count": len(bybit_ws_manager.data)
        }
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

def get_api_credentials(x_user_key: Optional[str], x_user_secret: Optional[str], require_user_keys: bool = False):
    """
    Get API credentials with proper validation.
    If require_user_keys is True, only accepts headers (no env fallback) - for user trade requests.
    """
    # Clean the inputs - treat empty strings as None
    user_key = x_user_key.strip() if x_user_key and x_user_key.strip() else None
    user_secret = x_user_secret.strip() if x_user_secret and x_user_secret.strip() else None
    
    if require_user_keys:
        # Strict mode: Must have user-provided keys via headers
        if not user_key or not user_secret:
            raise HTTPException(
                status_code=401, 
                detail="API Keys required. Please configure your Bybit API keys in Settings."
            )
        return user_key, user_secret
    
    # Fallback mode: Use headers or env defaults
    api_key = user_key if user_key else DEFAULT_BYBIT_API_KEY
    api_secret = user_secret if user_secret else DEFAULT_BYBIT_SECRET
    
    if not api_key or api_key == "YOUR_API_KEY" or api_key == "YOUR_DEMO_API_KEY":
         raise HTTPException(status_code=400, detail="API Keys not configured. Set in Settings or Backend Env.")
    
    return api_key, api_secret

# --- API KEY VERIFICATION ENDPOINTS ---

@app.post("/api/verify-bybit-keys")
async def verify_bybit_keys(
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None),
    is_live: bool = False
):
    """Verify Bybit API keys by making a test call to wallet balance endpoint."""
    print(f"verify_bybit_keys called with key={x_user_bybit_key if x_user_bybit_key else 'None'}..., is_live={is_live}")
    try:
        api_key, api_secret = get_api_credentials(x_user_bybit_key, x_user_bybit_secret, require_user_keys=True)
        
        endpoint = "/v5/account/wallet-balance"
        base_url = "https://api.bybit.com" if is_live else BYBIT_DEMO_URL
        params = "accountType=UNIFIED"
        
        timestamp, recv_window, signature = generate_signature(api_key, api_secret, params)
        
        headers = {
            "X-BAPI-API-KEY": api_key,
            "X-BAPI-SIGN": signature,
            "X-BAPI-TIMESTAMP": timestamp,
            "X-BAPI-RECV-WINDOW": recv_window,
            "Content-Type": "application/json"
        }
        
        url = f"{base_url}{endpoint}?{params}"
        print(f"Verifying Bybit key at: {url}")
        response = requests.get(url, headers=headers)
        print(f"Bybit verify response status: {response.status_code}")
        print(f"Bybit verify response text: {response.text[:200] if response.text else 'EMPTY'}")
        
        if response.status_code != 200 or not response.text:
            return {"valid": False, "error": f"HTTP {response.status_code}: {response.text[:100] if response.text else 'Empty response'}"}
        
        data = response.json()
        
        if data.get("retCode") == 0:
            return {"valid": True, "message": f"API keys are valid for {'LIVE' if is_live else 'DEMO'} trading"}
        else:
            return {"valid": False, "error": data.get("retMsg", "Unknown error")}
    except Exception as e:
        print(f"Bybit verify exception: {e}")
        return {"valid": False, "error": str(e)}

@app.post("/api/verify-binance-keys")
async def verify_binance_keys(
    x_user_binance_key: Optional[str] = Header(None),
    x_user_binance_secret: Optional[str] = Header(None),
    is_testnet: bool = True
):
    """Verify Binance API keys by making a test call to account endpoint."""
    try:
        api_key, api_secret = get_binance_credentials(x_user_binance_key, x_user_binance_secret)
        
        base_url = "https://testnet.binancefuture.com" if is_testnet else "https://fapi.binance.com"
        endpoint = "/fapi/v3/balance"
        
        timestamp = int(time.time() * 1000)
        params = {"timestamp": timestamp}
        query_string = urlencode(params)
        signature = hmac.new(api_secret.encode('utf-8'), query_string.encode('utf-8'), hashlib.sha256).hexdigest()
        
        url = f"{base_url}{endpoint}?{query_string}&signature={signature}"
        headers = {"X-MBX-APIKEY": api_key}
        
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            return {"valid": True, "message": "API keys are valid"}
        else:
            try:
                data = response.json()
                return {"valid": False, "error": data.get("msg", str(data))}
            except:
                return {"valid": False, "error": f"HTTP {response.status_code}"}
    except Exception as e:
        return {"valid": False, "error": str(e)}

@app.post("/api/place-order")
async def place_order(
    order: OrderRequest,
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None),
    is_live: bool = False
):
    """Place an order on Bybit. Requires user API keys via headers."""
    # Require user keys for trading - no fallback to env keys
    api_key, api_secret = get_api_credentials(x_user_bybit_key, x_user_bybit_secret, require_user_keys=True)
    return await execute_bybit_logic(api_key, api_secret, order.symbol, order.side, order.qty, order.leverage, order.category, is_live=is_live)

# --- REUSABLE LOGIC ---

async def get_bybit_instrument_info_cached(symbol):
    if symbol in INSTRUMENT_CACHE:
        return INSTRUMENT_CACHE[symbol]
    
    try:
        url = "https://api.bybit.com/v5/market/instruments-info"
        params = {"category": "linear", "symbol": symbol + "USDT"}
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, functools.partial(requests.get, url, params=params))
        data = response.json()
        
        if data["retCode"] == 0 and len(data["result"]["list"]) > 0:
             info = data["result"]["list"][0]["lotSizeFilter"]
             INSTRUMENT_CACHE[symbol] = {
                 "qtyStep": float(info["qtyStep"]),
                 "minOrderQty": float(info["minOrderQty"]),
                 "maxOrderQty": float(info["maxOrderQty"])
             }
             return INSTRUMENT_CACHE[symbol]
    except Exception as e:
        print(f"Instrument Info Error: {e}")
    
    # Fallback default
    return {"qtyStep": 0.001, "minOrderQty": 0.001, "maxOrderQty": 10000}

def adjust_qty_to_step(qty, step_size, min_qty):
    if qty < min_qty: return min_qty
    # Round down to nearest step
    import math
    steps = math.floor(qty / step_size)
    adjusted = steps * step_size
    # Fix floating point precision
    return round(adjusted, 10)

async def execute_bybit_logic(api_key, api_secret, symbol, side, qty, leverage, category="linear", is_live=False):
    """Execute Bybit order. is_live=True uses real API, False uses demo API."""
    base_url = "https://api.bybit.com" if is_live else BYBIT_DEMO_URL
    try:
        endpoint = "/v5/order/create"
        url = base_url + endpoint
        
        # 1. Set Leverage
        try:
            leverage_endpoint = "/v5/position/set-leverage"
            leverage_url = base_url + leverage_endpoint
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

        # 2. Prepare Order with Correct Precision
        # Fetch instrument info to fix "Qty invalid" errors
        inst_info = await get_bybit_instrument_info_cached(symbol)
        adjusted_qty = adjust_qty_to_step(float(qty), inst_info["qtyStep"], inst_info["minOrderQty"])
        print(f"DEBUG: Adjusting Qty for {symbol}: {qty} -> {adjusted_qty} (Step: {inst_info['qtyStep']})")

        order_payload = {
            "category": category,
            "symbol": symbol + "USDT" if not symbol.endswith("USDT") else symbol,
            "side": side,
            "orderType": "Market",
            "qty": str(adjusted_qty),
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
            ret_code = data.get("retCode")
            msg = data.get("retMsg", "Unknown Error")
            if ret_code == 10003:
                msg = "API Key is Invalid. (Check if you are using Live Keys on Testnet or vice-versa)"
            print(f"Bybit API Error: {data}")
            raise HTTPException(status_code=400, detail=f"Bybit Error: {msg} (Code: {ret_code})")

    except HTTPException as he:
        raise he
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Bybit Order Logic Failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def execute_binance_logic(api_key, api_secret, symbol, side, qty, leverage, is_testnet=True):
    base_url = "https://testnet.binancefuture.com" if is_testnet else "https://fapi.binance.com"
    # Ensure symbol is uppercase for Binance
    usdt_symbol = (symbol.upper() + "USDT") if not symbol.upper().endswith("USDT") else symbol.upper()
    sym_only = usdt_symbol.replace("USDT","")

    try:
        # 1. Set Leverage
        try:
            lev_endpoint = "/fapi/v1/leverage"
            lev_params = {
                "symbol": usdt_symbol,
                "leverage": leverage,
                "timestamp": int(time.time() * 1000)
            }
            lev_qs = urlencode(lev_params)
            lev_sig = hmac.new(api_secret.encode('utf-8'), lev_qs.encode('utf-8'), hashlib.sha256).hexdigest()
            lev_headers = { "X-MBX-APIKEY": api_key }
            lev_url = f"{base_url}{lev_endpoint}?{lev_qs}&signature={lev_sig}"
            
            await asyncio.to_thread(requests.post, lev_url, headers=lev_headers, timeout=5)
        except Exception as e:
            print(f"Binance Leverage Error (Non-fatal): {e}")

        # 2. Precision & Rounding (Use Cache)
        info = BINANCE_SYMBOL_INFO.get(sym_only)
        if info:
            qty_precision = info["quantityPrecision"]
            step_size = info["stepSize"]
            
            # Use stepSize for rounding
            import math
            qty_float = float(qty)
            if step_size > 0:
                steps = math.floor(qty_float / step_size)
                qty_rounded = round(steps * step_size, qty_precision)
                qty = f"{qty_rounded:.{qty_precision}f}"
            else:
                qty = f"{qty_float:.{qty_precision}f}"
        else:
            # Fallback to simple rounding
            qty = f"{float(qty):.2f}"

        # 3. Place Order
        params = {
            "symbol": usdt_symbol,
            "side": side.upper(),
            "type": "MARKET",
            "quantity": qty,
            "timestamp": int(time.time() * 1000)
        }
        
        query_string = urlencode(params)
        signature = hmac.new(api_secret.encode('utf-8'), query_string.encode('utf-8'), hashlib.sha256).hexdigest()
        final_url = f"{base_url}/fapi/v1/order?{query_string}&signature={signature}"
        headers = { "X-MBX-APIKEY": api_key }
        
        response = await asyncio.to_thread(requests.post, final_url, headers=headers, timeout=10)
        data = response.json()
        
        if "code" in data and data["code"] != 0:
             code = data["code"]
             msg = data.get("msg", "Unknown Error")
             if code == -2015:
                 msg = "Invalid API-key or Permissions. (Check if using Live Keys on Testnet or vice-versa)"
             print(f"Binance API Error for {usdt_symbol}: {data}")
             raise HTTPException(status_code=400, detail=f"Binance Error: {msg} (Code: {code})")
             
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
    x_user_bybit_secret: Optional[str] = Header(None),
    is_live: bool = False
):
    api_key, api_secret = get_api_credentials(x_user_bybit_key, x_user_bybit_secret)

    try:
        # Use wallet-balance endpoint which works with demo.bybit.com
        endpoint = "/v5/account/wallet-balance"
        base_url = "https://api.bybit.com" if is_live else BYBIT_DEMO_URL
        url = base_url + endpoint
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
        
        if response.status_code != 200:
            print(f"Bybit Wallet Error ({response.status_code}): {response.text}")
            try:
                 return response.json()
            except:
                 raise HTTPException(status_code=response.status_code, detail=f"Bybit Error: {response.text[:200]}")

        return response.json()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Wallet Balance Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class SetDemoBalanceRequest(BaseModel):
    target_balance: float = 1000.0
    coin: str = "USDT"


@app.post("/api/bybit/set-demo-balance")
async def set_bybit_demo_balance(
    request: SetDemoBalanceRequest,
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None),
):

    """
    Set Bybit demo account balance to a target amount.
    Only works for DEMO accounts (api-demo.bybit.com).
    
    - If current balance < target: Adds the difference
    - If current balance >= target: Returns error (API cannot reduce funds)
    """
    api_key, api_secret = get_api_credentials(x_user_bybit_key, x_user_bybit_secret, require_user_keys=True)
    
    try:
        # Step 1: Get current balance
        endpoint = "/v5/account/wallet-balance"
        base_url = BYBIT_DEMO_URL  # Always use demo URL for this endpoint
        params = "accountType=UNIFIED"
        
        timestamp, recv_window, signature = generate_signature(api_key, api_secret, params)
        
        headers = {
            "X-BAPI-API-KEY": api_key,
            "X-BAPI-SIGN": signature,
            "X-BAPI-TIMESTAMP": timestamp,
            "X-BAPI-RECV-WINDOW": recv_window,
            "Content-Type": "application/json"
        }
        
        final_url = f"{base_url}{endpoint}?{params}"
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, lambda: requests.get(final_url, headers=headers))
        
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=f"Failed to get current balance: {response.text[:200]}")
        
        balance_data = response.json()
        
        if balance_data.get("retCode") != 0:
            raise HTTPException(status_code=400, detail=f"Bybit API Error: {balance_data.get('retMsg')}")
        
        # Find current USDT balance
        current_balance = 0.0
        try:
            coins = balance_data.get("result", {}).get("list", [{}])[0].get("coin", [])
            for coin in coins:
                if coin.get("coin") == request.coin:
                    current_balance = float(coin.get("walletBalance", 0))
                    break
        except (IndexError, KeyError, TypeError):
            current_balance = 0.0
        
        print(f"Current {request.coin} balance: {current_balance}, Target: {request.target_balance}")
        
        # Step 2: Calculate difference
        difference = request.target_balance - current_balance
        
        if difference <= 0:
            return {
                "status": "error",
                "message": f"Current balance ({current_balance:.2f} {request.coin}) is already >= target ({request.target_balance:.2f}). Bybit API cannot reduce funds. Please use the Bybit portal to manually reset your demo account.",
                "current_balance": current_balance,
                "target_balance": request.target_balance,
                "action_needed": "manual_reset"
            }
        
        # Step 3: Add funds via demo-apply-money API
        apply_endpoint = "/v5/account/demo-apply-money"
        apply_url = base_url + apply_endpoint
        
        # Round to 2 decimal places
        amount_to_add = round(difference, 2)
        
        apply_payload = {
            "utaDemoApplyMoney": [
                {
                    "coin": request.coin,
                    "amountStr": str(amount_to_add)
                }
            ]
        }
        
        payload_json = json.dumps(apply_payload)
        ts, rw, sig = generate_signature(api_key, api_secret, payload_json)
        
        apply_headers = {
            "X-BAPI-API-KEY": api_key,
            "X-BAPI-SIGN": sig,
            "X-BAPI-TIMESTAMP": ts,
            "X-BAPI-RECV-WINDOW": rw,
            "Content-Type": "application/json"
        }
        
        print(f"Adding {amount_to_add} {request.coin} to demo account...")
        apply_response = await loop.run_in_executor(
            None, 
            lambda: requests.post(apply_url, headers=apply_headers, data=payload_json)
        )
        
        apply_data = apply_response.json()
        print(f"Demo apply money response: {apply_data}")
        
        if apply_data.get("retCode") == 0:
            new_balance = current_balance + amount_to_add
            return {
                "status": "success",
                "message": f"Successfully set {request.coin} balance to ~{request.target_balance:.2f}",
                "previous_balance": current_balance,
                "amount_added": amount_to_add,
                "new_balance": new_balance,
                "coin": request.coin
            }
        else:
            return {
                "status": "error",
                "message": f"Failed to add funds: {apply_data.get('retMsg', 'Unknown error')}",
                "error_code": apply_data.get("retCode"),
                "current_balance": current_balance
            }
            
    except HTTPException as he:
        raise he
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Set Demo Balance Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/transaction-log")
async def get_transaction_log(
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None),
    is_live: bool = False
):
    api_key, api_secret = get_api_credentials(x_user_bybit_key, x_user_bybit_secret)

    try:
        endpoint = "/v5/account/transaction-log"
        base_url = "https://api.bybit.com" if is_live else BYBIT_DEMO_URL
        url = base_url + endpoint
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
    """
    Get Binance API credentials - strictly requires user-provided keys.
    Rejects empty strings and None values.
    """
    # Clean the inputs - treat empty strings as None
    user_key = x_user_key.strip() if x_user_key and x_user_key.strip() else None
    user_secret = x_user_secret.strip() if x_user_secret and x_user_secret.strip() else None
    
    if not user_key or not user_secret:
         raise HTTPException(
             status_code=401, 
             detail="Binance API Keys required. Please configure your Binance API keys in Settings."
         )
    
    return user_key, user_secret

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
    # Use V3 endpoint for better compatibility
    endpoint = "/fapi/v3/balance"

    try:
        timestamp = int(time.time() * 1000)
        params = {"timestamp": timestamp}
        query_string = urlencode(params)
        signature = hmac.new(api_secret.encode('utf-8'), query_string.encode('utf-8'), hashlib.sha256).hexdigest()
        
        final_url = f"{base_url}{endpoint}?{query_string}&signature={signature}"
        headers = { "X-MBX-APIKEY": api_key }
        
        print(f"Binance Balance Request: {final_url[:80]}...")
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, lambda: requests.get(final_url, headers=headers))
        
        if response.status_code != 200:
             print(f"Binance Wallet Error ({response.status_code}): {response.text}")
             try:
                  error_data = response.json()
                  raise HTTPException(status_code=response.status_code, detail=error_data.get('msg', str(error_data)))
             except:
                  raise HTTPException(status_code=response.status_code, detail=f"Binance Error: {response.text[:200]}")
              
        # Filter for non-zero balances or format it nicely
        data = response.json()
        return data
    except HTTPException:
        raise
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

# --- BINANCE API PROXY ENDPOINTS ---
# These endpoints proxy requests to Binance API to avoid CORS issues in production
# The frontend calls /api/binance/* and the backend forwards to fapi.binance.com

@app.get("/api/binance/fapi/v1/exchangeInfo")
async def proxy_binance_exchange_info():
    """Proxy Binance exchangeInfo endpoint for production deployment."""
    try:
        url = "https://fapi.binance.com/fapi/v1/exchangeInfo"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json"
        }
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None, 
            lambda: requests.get(url, headers=headers, timeout=10)
        )
        
        if response.status_code == 200:
            return response.json()
        else:
            print(f"Binance API returned {response.status_code}: {response.text[:200]}")
            raise HTTPException(status_code=response.status_code, detail=f"Binance API error: {response.status_code}")
    except HTTPException:
        raise
    except Exception as e:
        print(f"Binance Exchange Info Proxy Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/binance/fapi/v1/premiumIndex")
async def proxy_binance_premium_index():
    """Proxy Binance premiumIndex endpoint for production deployment."""
    try:
        url = "https://fapi.binance.com/fapi/v1/premiumIndex"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json"
        }
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None, 
            lambda: requests.get(url, headers=headers, timeout=10)
        )
        
        if response.status_code == 200:
            return response.json()
        else:
            print(f"Binance Premium API returned {response.status_code}: {response.text[:200]}")
            raise HTTPException(status_code=response.status_code, detail=f"Binance API error: {response.status_code}")
    except HTTPException:
        raise
    except Exception as e:
        print(f"Binance Premium Index Proxy Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/binance/fapi/v1/fundingInfo")
async def proxy_binance_funding_info():
    """Proxy Binance fundingInfo endpoint for production deployment."""
    try:
        url = "https://fapi.binance.com/fapi/v1/fundingInfo"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json"
        }
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None, 
            lambda: requests.get(url, headers=headers, timeout=10)
        )
        
        if response.status_code == 200:
            return response.json()
        else:
            print(f"Binance Funding API returned {response.status_code}: {response.text[:200]}")
            raise HTTPException(status_code=response.status_code, detail=f"Binance API error: {response.status_code}")
    except HTTPException:
        raise
    except Exception as e:
        print(f"Binance Funding Info Proxy Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))




# --- LEVERAGE HELPERS ---

async def get_bybit_max_leverage(symbol: str):
    """Fetch max leverage for a symbol from Bybit."""
    try:
        # Use existing instrument info functionality if possible, or fetch new
        # /v5/market/instruments-info is public
        url = "https://api.bybit.com/v5/market/instruments-info"
        params = {"category": "linear", "symbol": symbol + "USDT" if not symbol.endswith("USDT") else symbol}
        loop = asyncio.get_event_loop()
        r = await loop.run_in_executor(None, lambda: requests.get(url, params=params))
        data = r.json()
        if data["retCode"] == 0:
            lev_filter = data["result"]["list"][0]["leverageFilter"]
            return float(lev_filter["maxLeverage"])
    except Exception as e:
        print(f"Bybit Max Lev Error: {e}")
    return 10.0 # Default safe fallback

async def get_binance_max_leverage(symbol: str):
    """Fetch max leverage for a symbol from Binance."""
    try:
        # Binance /fapi/v1/exchangeInfo contains generic limits, but Bracket is better.
        # However, public exchangeInfo often has it. Let's check common logic.
        # Ideally use /fapi/v1/leverageBracket but requires auth for precise user limits.
        # BUT exchangeInfo has valid limits for the symbol generally.
        # Actually, for unauthorized generic check, exchangeInfo is best.
        url = "https://fapi.binance.com/fapi/v1/exchangeInfo"
        loop = asyncio.get_event_loop()
        r = await loop.run_in_executor(None, requests.get, url)
        data = r.json()
        target = symbol + "USDT" if not symbol.endswith("USDT") else symbol
        for s in data["symbols"]:
            if s["symbol"] == target:
                # Binance doesn't always explicitly list max leverage in exchangeInfo directly 
                # in a simple field for all pairs (it used to be in limits).
                # But it is standard practice to assume 20x or fetch bracket.
                # Let's try to find a safe default or parse if available.
                # Actually, most pairs are 20x, 50x, 75x, 125x.
                # Without an auth key (to call leverageBracket), we can't be 100% sure of USER limit,
                # but we can get system max. 
                # Alternative: Try to set 20x, if fail, retry lower? No, that's messy.
                # Using a hardcoded list or generic fallback is safer if API doesn't give it easily.
                # WAIT: Bybit GIVES it. Binance usually implies it via margin tiers.
                # Let's assume 20x is safe for almost all perps, but user might want 50x.
                # If specific low cap, it might be 10x?
                # Let's iterate filters? No.
                # Let's use `leverageBracket` with the user's keys if available in function!
                pass
        
        # If we have keys context in the calling function, we should use them.
        # But this is a helper. Let's return 20 as a safe default for now if we can't find it.
        # Actually, let's allow passing keys to this helper if possible.
        return 20.0 
    except Exception as e:
        print(f"Binance Max Lev Error: {e}")
    return 20.0

async def get_min_common_leverage(user_leverage, symbol, keys):
    """Get the minimum available leverage between User Setting, Bybit Max, and Binance Max."""
    try:
        # 1. Bybit Max
        bybit_max = await get_bybit_max_leverage(symbol)
        
        # 2. Binance Max (Use authenticated bracket if possible)
        binance_max = 20.0
        if keys.get("binance_key"):
             try:
                 # Fetch actual bracket
                 base_url = "https://fapi.binance.com" # Use Live for check usually
                 endpoint = "/fapi/v1/leverageBracket"
                 params = {"symbol": symbol + "USDT" if not symbol.endswith("USDT") else symbol, "timestamp": int(time.time()*1000)}
                 query = urlencode(params)
                 sig = hmac.new(keys["binance_secret"].encode(), query.encode(), hashlib.sha256).hexdigest()
                 headers = {"X-MBX-APIKEY": keys["binance_key"]}
                 loop = asyncio.get_event_loop()
                 r = await loop.run_in_executor(None, lambda: requests.get(f"{base_url}{endpoint}?{query}&signature={sig}", headers=headers))
                 if r.status_code == 200:
                     # Returns list of brackets. Max leverage is the first bracket's initialLeverage? 
                     # Actually it returns brackets where each has 'initialLeverage'. max is usually the highest one available.
                     # Response: [ { symbol, brackets: [ { initialLeverage: 125, ... } ] } ]
                     # Wait, brackets are tiers. The MAX leverage allowed is the max 'initialLeverage' in the list?
                     # Usually yes.
                     data = r.json()
                     # It returns a list (sometimes just 1 obj if symbol param used).
                     brackets = data[0]['brackets'] if isinstance(data, list) else data['brackets']
                     # Max leverage is the highest 'initialLeverage' found.
                     binance_max = max([x['initialLeverage'] for x in brackets])
             except Exception as e:
                 print(f"Bn Bracket Error: {e}")

        # 3. Calculate Min
        safe_lev = min(float(user_leverage), float(bybit_max), float(binance_max))
        return int(safe_lev) # Return int usually
    except Exception as e:
        print(f"Common Lev Error: {e}")
        return int(user_leverage)


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

# Duplicate TradeScheduler removed.@app.post("/api/schedule-trade")
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

    # If direction is "Auto" or implied by "Both", we defer decision to execution time
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

@app.post("/api/close-all-positions")
async def close_all_positions(
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None),
    x_user_binance_key: Optional[str] = Header(None),
    x_user_binance_secret: Optional[str] = Header(None)
):
    results = {"bybit": [], "binance": []}
    
    # --- CLOSE BYBIT POSITIONS ---
    try:
        if x_user_bybit_key and x_user_bybit_secret:
            api_key, api_secret = get_api_credentials(x_user_bybit_key, x_user_bybit_secret)
            
            # 1. Fetch Positions
            endpoint = "/v5/position/list"
            url = BYBIT_DEMO_URL + endpoint
            params = "category=linear&settleCoin=USDT"
            timestamp, recv_window, signature = generate_signature(api_key, api_secret, params)
            
            headers = {
                "X-BAPI-API-KEY": api_key,
                "X-BAPI-SIGN": signature,
                "X-BAPI-TIMESTAMP": timestamp,
                "X-BAPI-RECV-WINDOW": recv_window
            }
            
            loop = asyncio.get_event_loop()
            res = await loop.run_in_executor(None, lambda: requests.get(f"{url}?{params}", headers=headers))
            data = res.json()
            
            if data['retCode'] == 0:
                positions = data['result']['list']
                for pos in positions:
                    size = float(pos['size'])
                    if size > 0:
                        symbol = pos['symbol'][:-4] if pos['symbol'].endswith('USDT') else pos['symbol'] # Clean symbol
                        side = pos['side'] # "Buy" or "Sell"
                        close_side = "Sell" if side == "Buy" else "Buy"
                        
                        print(f"Closing Bybit {symbol} {side} ({size})")
                        
                        # Close using execute_bybit_logic
                        try:
                            # Use reduceOnly order or simply opposite side market order
                            # We'll use our existing wrapper which does standard Market Order
                            # Note: execute_bybit_logic expects stripped symbol? No, it appends USDT.
                            # So we pass "BTC" not "BTCUSDT".
                            await execute_bybit_logic(api_key, api_secret, symbol, close_side, size, 10) # Leverage doesn't matter much for closing if market
                            results['bybit'].append(f"Closed {symbol} {side} {size}")
                        except Exception as e:
                            results['bybit'].append(f"Failed {symbol}: {str(e)}")
            else:
                 results['bybit'].append(f"Error fetching: {data['retMsg']}")
    except Exception as e:
        results['bybit'].append(f"Error: {str(e)}")

    # --- CLOSE BINANCE POSITIONS ---
    try:
        if x_user_binance_key and x_user_binance_secret:
            api_key, api_secret = get_binance_credentials(x_user_binance_key, x_user_binance_secret)
            is_testnet = True # Assumption for now, or check balance/env
            base_url = "https://testnet.binancefuture.com" if is_testnet else "https://fapi.binance.com"
            
            # 1. Fetch Positions
            endpoint = "/fapi/v2/positionRisk"
            timestamp = int(time.time() * 1000)
            q_params = {"timestamp": timestamp}
            query_string = urlencode(q_params)
            signature = hmac.new(api_secret.encode('utf-8'), query_string.encode('utf-8'), hashlib.sha256).hexdigest()
            
            headers = { "X-MBX-APIKEY": api_key }
            loop = asyncio.get_event_loop()
            res = await loop.run_in_executor(None, lambda: requests.get(f"{base_url}{endpoint}?{query_string}&signature={signature}", headers=headers))
            
            if res.status_code == 200:
                data = res.json()
                for pos in data:
                    amt = float(pos['positionAmt'])
                    if amt != 0:
                        symbol = pos['symbol'].replace("USDT", "")
                        side = "LONG" if amt > 0 else "SHORT"
                        close_side = "SELL" if amt > 0 else "BUY"
                        qty = abs(amt)
                        
                        print(f"Closing Binance {symbol} {side} ({qty})")
                        
                        try:
                            await execute_binance_logic(api_key, api_secret, symbol, close_side, qty, 10, is_testnet)
                            results['binance'].append(f"Closed {symbol} {side} {qty}")
                        except Exception as e:
                            results['binance'].append(f"Failed {symbol}: {str(e)}")
            else:
                results['binance'].append(f"Error fetching: {res.text}")
    except Exception as e:
        results['binance'].append(f"Error: {str(e)}")

    return results

@app.get("/api/positions")
async def get_positions(
    symbol: str, 
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None),
    x_user_binance_key: Optional[str] = Header(None),
    x_user_binance_secret: Optional[str] = Header(None)
):
    positions = {"bybit": None, "binance": None}
    
    # --- BYBIT POSITIONS ---
    try:
        if x_user_bybit_key and x_user_bybit_secret:
            api_key, api_secret = get_api_credentials(x_user_bybit_key, x_user_bybit_secret)
            endpoint = "/v5/position/list"
            url = BYBIT_DEMO_URL + endpoint
            params = f"category=linear&symbol={symbol}USDT"
            timestamp, recv_window, signature = generate_signature(api_key, api_secret, params)
            
            headers = {
                "X-BAPI-API-KEY": api_key,
                "X-BAPI-SIGN": signature,
                "X-BAPI-TIMESTAMP": timestamp,
                "X-BAPI-RECV-WINDOW": recv_window
            }
            
            loop = asyncio.get_event_loop()
            res = await loop.run_in_executor(None, lambda: requests.get(f"{url}?{params}", headers=headers))
            data = res.json()
            
            if data['retCode'] == 0:
                # Bybit returns a list, usually 2 items (Buy/Sell side) or 1 depending on mode
                # We want the one with size > 0
                for pos in data['result']['list']:
                    if float(pos['size']) > 0:
                        positions['bybit'] = {
                            "side": pos['side'],
                            "size": float(pos['size']),
                            "entryPrice": float(pos['avgPrice']),
                            "pnl": float(pos['unrealisedPnl'])
                        }
    except Exception as e:
        print(f"Bybit Pos Error: {e}")

    # --- BINANCE POSITIONS ---
    try:
        if x_user_binance_key and x_user_binance_secret:
            api_key, api_secret = get_binance_credentials(x_user_binance_key, x_user_binance_secret)
            is_testnet = True 
            base_url = "https://testnet.binancefuture.com" if is_testnet else "https://fapi.binance.com"
            
            endpoint = "/fapi/v2/positionRisk"
            timestamp = int(time.time() * 1000)
            q_params = {"timestamp": timestamp, "symbol": f"{symbol}USDT"}
            query_string = urlencode(q_params)
            signature = hmac.new(api_secret.encode('utf-8'), query_string.encode('utf-8'), hashlib.sha256).hexdigest()
            
            headers = { "X-MBX-APIKEY": api_key }
            loop = asyncio.get_event_loop()
            res = await loop.run_in_executor(None, lambda: requests.get(f"{base_url}{endpoint}?{query_string}&signature={signature}", headers=headers))
            
            if res.status_code == 200:
                data = res.json()
                # Binance returns list (one per symbol usually in this endpoint filter, or checks directions)
                for pos in data:
                    amt = float(pos['positionAmt'])
                    if amt != 0:
                        positions['binance'] = {
                            "side": "Buy" if amt > 0 else "Sell",
                            "size": abs(amt),
                            "entryPrice": float(pos['entryPrice']),
                            "pnl": float(pos['unRealizedProfit'])
                        }
    except Exception as e:
        print(f"Binance Pos Error: {e}")

    return positions

# --- Auto-Trade State & Logic ---


# --- USER SESSION MANAGEMENT ---

class UserSession:
    def __init__(self, user_id, keys):
        self.user_id = user_id
        self.keys = keys # { 'bybit_key', 'bybit_secret', 'binance_key', 'binance_secret' }
        self.config = {
            "active": False,
            "total_investment": 100.0,
            "max_trades": 1,
            "leverage": 10,
            "min_diff": 0.01,
            "is_live": False,
            "start_time": "00:00",
            "end_time": "23:59",
            "max_price_diff": 2.0,
            "auto_exit": True,
            "entry_window": 300,
            "entry_before_seconds": 60,
            "exit_after_seconds": 30,
            "ignore_timing": False
        }
        self.logs = []
        self.active_trades = {} # symbol -> trade_info
        self.manual_closed_trades = {} # symbol -> timestamp
        self.failed_trades = {} # symbol -> timestamp
        self.pending_opportunities = []
        self.last_active_time = time.time()
        self.last_balance_warning = 0
        self.last_entry_time = 0 

class SessionManager:
    def __init__(self):
        self.sessions = {} # user_id -> UserSession
        self.persistence_file = "sessions.json"
        self.load_sessions()

    def get_user_id(self, bybit_key, binance_key):
        # Create a unique ID based on the keys
        raw = f"{bybit_key or ''}:{binance_key or ''}"
        return hashlib.sha256(raw.encode()).hexdigest()

    def save_sessions(self):
        try:
            data = {}
            for uid, sess in self.sessions.items():
                data[uid] = {
                    "keys": sess.keys,
                    "config": sess.config,
                    "active_trades": sess.active_trades # Save full state
                }
            with open(self.persistence_file, "w") as f:
                json.dump(data, f)
        except Exception as e:
            print(f"Session Save Error: {e}")

    def load_sessions(self):
        try:
            if os.path.exists(self.persistence_file):
                with open(self.persistence_file, "r") as f:
                    data = json.load(f)
                    for uid, info in data.items():
                        # Reconstruct session
                        sess = UserSession(uid, info.get("keys", {}))
                        if "config" in info:
                            sess.config = info["config"]
                        if "active_trades" in info:
                            # Robustness: Ensure active_trades is a dictionary
                            if isinstance(info["active_trades"], dict):
                                sess.active_trades = info["active_trades"]
                            else:
                                sess.active_trades = {} # Reset if corrupt
                        self.sessions[uid] = sess
                print(f"Loaded {len(self.sessions)} sessions from disk.")
        except Exception as e:
            print(f"Session Load Error: {e}")

    def get_session(self, bybit_key, bybit_secret, binance_key, binance_secret):
        user_id = self.get_user_id(bybit_key, binance_key)
        
        if user_id not in self.sessions:
            print(f"🆕 Creating new session for User {user_id[:8]}...")
            keys = {
                "bybit_key": bybit_key,
                "bybit_secret": bybit_secret,
                "binance_key": binance_key,
                "binance_secret": binance_secret
            }
            self.sessions[user_id] = UserSession(user_id, keys)
            self.save_sessions() # Save new session
        
        # Update keys if they changed
        self.sessions[user_id].last_active_time = time.time()
        
        # We should also update keys inside the session object if provided, 
        # but UserSession keys are usually static for the ID.
        
        return self.sessions[user_id]

# Global Session Manager
session_manager = SessionManager()

# --- HELPER FOR ENDPOINTS ---
def get_current_session(
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None),
    x_user_binance_key: Optional[str] = Header(None),
    x_user_binance_secret: Optional[str] = Header(None)
):
    # If no keys provided in headers (e.g. initial load), usage is limited.
    if not x_user_bybit_key and not x_user_binance_key:
         if os.getenv("USER_BYBIT_KEY") or os.getenv("USER_BINANCE_KEY"):
             return session_manager.get_session(
                 os.getenv("USER_BYBIT_KEY"),
                 os.getenv("USER_BYBIT_SECRET"),
                 os.getenv("USER_BINANCE_KEY"),
                 os.getenv("USER_BINANCE_SECRET")
             )
         return None

    return session_manager.get_session(
        x_user_bybit_key, x_user_bybit_secret, x_user_binance_key, x_user_binance_secret
    )


@app.post("/api/auto-trade/config")
async def set_auto_trade_config(
    request: Request,
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None),
    x_user_binance_key: Optional[str] = Header(None),
    x_user_binance_secret: Optional[str] = Header(None)
):
    session = get_current_session(x_user_bybit_key, x_user_bybit_secret, x_user_binance_key, x_user_binance_secret)
    if not session:
        return {"status": "error", "message": "API Keys required to save configuration."}

    data = await request.json()
    
    # Store Bot ID in session for Leaderboard Keep-Alive
    if "bot_id" in data:
        session.bot_id = data["bot_id"]
        session.bot_name = data.get("bot_name", "Unknown")

    # Update Session Config
    session.keys["bybit_key"] = x_user_bybit_key
    session.keys["bybit_secret"] = x_user_bybit_secret
    session.keys["binance_key"] = x_user_binance_key
    session.keys["binance_secret"] = x_user_binance_secret
    
    session.config.update({
        "active": data.get("active", session.config["active"]),
        "total_investment": float(data.get("total_investment", session.config["total_investment"])),
        "max_trades": int(data.get("max_trades", session.config["max_trades"])),
        "leverage": int(data.get("leverage", session.config["leverage"])),
        "min_diff": float(data.get("min_diff", session.config["min_diff"])),
        "is_live": data.get("is_live", session.config["is_live"]),
        "start_time": data.get("start_time", session.config["start_time"]),
        "end_time": data.get("end_time", session.config["end_time"]),
        "max_price_diff": float(data.get("max_price_diff", session.config["max_price_diff"])),
        "auto_exit": data.get("auto_exit", session.config["auto_exit"]),
        "entry_window": int(data.get("entry_window", session.config["entry_window"])),
        "entry_before_seconds": int(data.get("entry_before_seconds", session.config.get("entry_before_seconds", 60))),
        "exit_after_seconds": int(data.get("exit_after_seconds", session.config.get("exit_after_seconds", 30))),
        "ignore_timing": data.get("ignore_timing", session.config.get("ignore_timing", False))
    })
    
    session_manager.save_sessions()
        
    print(f"Config updated for User {session.user_id[:8]}. Active: {session.config['active']}")
    
    # Return config without keys
    safe_config = session.config.copy()
    safe_config["has_keys"] = True
    return {"status": "updated", "config": safe_config}

@app.delete("/api/auto-trade/trade/{symbol}")
async def close_manual_trade(
    symbol: str, 
    close_on_exchange: bool = False,
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None),
    x_user_binance_key: Optional[str] = Header(None),
    x_user_binance_secret: Optional[str] = Header(None)
):
    session = get_current_session(x_user_bybit_key, x_user_bybit_secret, x_user_binance_key, x_user_binance_secret)
    if not session:
        raise HTTPException(status_code=400, detail="Session not found or keys missing")
    
    # Normalize symbol
    target_symbol = symbol
    if target_symbol not in session.active_trades:
         if f"{symbol}USDT" in session.active_trades:
             target_symbol = f"{symbol}USDT"
         else:
             # Just return success if already gone, to fix UI state
             return {"status": "ignored", "message": "Trade not found in active session"}

    trade_info = session.active_trades[target_symbol]
    
    if close_on_exchange:
        try:
            # Extract info
            sides = trade_info.get("sides", {})
            entry_side_binance = sides.get("binance", "BUY")
            entry_side_bybit = sides.get("bybit", "Buy")
            
            close_side_binance = "SELL" if str(entry_side_binance).upper() == "BUY" else "BUY"
            close_side_bybit = "Sell" if str(entry_side_bybit).capitalize() == "Buy" else "Buy"
            
            qty_binance = trade_info.get("qty_binance", 0)
            qty_bybit = trade_info.get("qty_bybit", 0)
            leverage = int(session.config.get("leverage", 10))
            is_live = session.config.get("is_live", False)
            
            # Execute Both
            tasks = [
                execute_bybit_logic(session.keys['bybit_key'], session.keys['bybit_secret'], target_symbol, close_side_bybit, qty_bybit, leverage, is_live=is_live),
                execute_binance_logic(session.keys['binance_key'], session.keys['binance_secret'], target_symbol, close_side_binance, qty_binance, leverage, is_testnet=not is_live)
            ]
            await asyncio.gather(*tasks)
            
        except Exception as e:
            print(f"Error closing positions for {target_symbol}: {e}")
            # We continue to remove it from session locally even if exchange fails?
            # Ideally yes, to prevent stuck UI.

    # Remove from active
    if target_symbol in session.active_trades:
        del session.active_trades[target_symbol]
    
    # Add to cooldown
    session.manual_closed_trades[target_symbol] = time.time()
    session_manager.save_sessions()
    
    return {"status": "success", "message": f"Trade {target_symbol} removed/closed"}

@app.post("/api/auto-trade/exit/{symbol}")
async def simulate_auto_exit(
    symbol: str,
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None),
    x_user_binance_key: Optional[str] = Header(None),
    x_user_binance_secret: Optional[str] = Header(None)
):
    """Manually triggers the exit logic for an active trade immediately (for testing)."""
    session = get_current_session(x_user_bybit_key, x_user_bybit_secret, x_user_binance_key, x_user_binance_secret)
    if not session:
        raise HTTPException(status_code=400, detail="Session not found")
    
    target_symbol = symbol
    if target_symbol not in session.active_trades:
         if f"{symbol}USDT" in session.active_trades:
             target_symbol = f"{symbol}USDT"
         else:
             raise HTTPException(status_code=404, detail=f"No active trade found for {symbol}")

    trade = session.active_trades[target_symbol]
    
    msg = f"🧪 SIMULATING EXIT: {target_symbol}..."
    print(msg)
    try:
        await manager.broadcast(json.dumps({"type": "log", "msg": msg, "color": "orange"}))
    except:
        pass

    try:
        e_bin = "SELL" if str(trade['sides']['binance']).upper() == "BUY" else "BUY"
        e_byb = "Sell" if str(trade['sides']['bybit']).capitalize() == "Buy" else "Buy"
        leverage = int(session.config.get("leverage", 10))
        
        await execute_auto_trade_exit(
            target_symbol, 
            e_bin, 
            e_byb, 
            trade['qty_binance'], 
            trade['qty_bybit'], 
            leverage, 
            session.config["is_live"], 
            session
        )
        
        session.logs.append({
            "time": time.time(),
            "type": "EXIT (SIMULATE)",
            "symbol": target_symbol,
            "msg": f"Manual simulation of auto-exit triggered"
        })
        
        if target_symbol in session.active_trades:
            del session.active_trades[target_symbol]
        
        session_manager.save_sessions()
        return {"status": "success", "message": f"Exit simulated for {target_symbol}"}
    except Exception as e:
        err = f"Simulation Error: {str(e)}"
        print(err)
        try:
            await manager.broadcast(json.dumps({"type": "error", "msg": err}))
        except:
            pass
        raise HTTPException(status_code=500, detail=err)

@app.get("/api/auto-trade/status")
async def get_auto_trade_status(
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None),
    x_user_binance_key: Optional[str] = Header(None),
    x_user_binance_secret: Optional[str] = Header(None)
):
    session = get_current_session(x_user_bybit_key, x_user_bybit_secret, x_user_binance_key, x_user_binance_secret)
    
    if not session:
        return {
             "config": { "active": False, "has_keys": False },
             "active_trades": 0,
             "active_positions": [],
             "pending_opportunities": [],
             "logs": []
        }

    safe_config = session.config.copy()
    safe_config["has_keys"] = True
    
    # Construct detailed active positions list
    active_positions_list = []
    for sym, data in session.active_trades.items():
        pos = data.copy()
        if "keys" in pos: del pos["keys"]
        pos["symbol"] = sym
        active_positions_list.append(pos)

    return {
        "config": safe_config,
        "active_trades": len(session.active_trades),
        "active_symbols": list(session.active_trades.keys()),
        "active_positions": active_positions_list,
        "pending_opportunities": session.pending_opportunities[:10],
        "logs": session.logs[-50:]
    }

async def _internal_force_trade_logic(session: UserSession):
    try:
        # Use session-specific config
        config = session.config
        
        # 1. Fetch Rates (Shared logic? No, live/testnet depends on user config)
        base_url = "https://fapi.binance.com" if config["is_live"] else "https://testnet.binancefuture.com"
        loop = asyncio.get_event_loop()
        r = await loop.run_in_executor(None, requests.get, f"{base_url}/fapi/v1/premiumIndex")
        data_binance = r.json()
        data_bybit_map = await fetch_bybit_rates(is_live=config["is_live"])
        
        # 2. Analyze candidates
        candidates = []
        for item in data_binance:
            if not item['symbol'].endswith('USDT'): continue
            symbol = item['symbol'].replace('USDT', '')
            
            if symbol in session.active_trades:
                continue
                
            if symbol not in data_bybit_map: continue
            
            try:
                binance_rate = float(item['lastFundingRate'])
                bybit_rate = data_bybit_map[symbol].get('rate', 0)
                mark_price_binance = float(item['markPrice'])
                bybit_price = data_bybit_map[symbol]['markPrice']
                
                rate_diff = abs(binance_rate - bybit_rate)
                
                price_diff_pct = 0
                if mark_price_binance > 0:
                    price_diff_pct = abs(mark_price_binance - bybit_price) / mark_price_binance * 100
                
                if rate_diff * 100 >= config["min_diff"]:
                    candidates.append({
                        "symbol": symbol,
                        "binance_rate": binance_rate,
                        "bybit_rate": bybit_rate,
                        "rate_diff": rate_diff,
                        "markPrice": mark_price_binance,
                        "bybitPrice": bybit_price,
                        "priceDiff": price_diff_pct,
                        "nextFundingTime": int(item['nextFundingTime']) 
                    })
            except Exception as e:
                continue
            
        candidates.sort(key=lambda x: x['rate_diff'], reverse=True)
        
        if not candidates:
            return {"status": "error", "message": "No suitable candidates found"}
        
        best = candidates[0]
        sym = best['symbol']
        
        if best['binance_rate'] > best['bybit_rate']:
            side_binance = "Sell"
            side_bybit = "Buy"
        else:
            side_binance = "Buy"
            side_bybit = "Sell"
        
        inv = config["total_investment"]
        lev = config["leverage"]
        
        per_trade_amt = inv / max(1, config["max_trades"])
        qty_binance = round((per_trade_amt * lev) / best['markPrice'], 3)
        qty_bybit = round((per_trade_amt * lev) / best['bybitPrice'], 3)
        
        print(f"Forcing Trade (User {session.user_id[:8]}): {sym}")
        
        await execute_auto_trade_entry(sym, side_binance, side_bybit, qty_binance, qty_bybit, lev, session.keys)
        
        session.active_trades[sym] = {
            "entry_time": time.time(),
            "amount": per_trade_amt,
            "qty_binance": qty_binance,
            "qty_bybit": qty_bybit,
            "nft": best['nextFundingTime'],
            "sides": {"binance": side_binance, "bybit": side_bybit},
            "keys": session.keys
        }
        
        session.logs.append({
            "time": time.time(),
            "type": "ENTRY (FORCE)",
            "symbol": sym,
            "msg": f"BN:{side_binance} BB:{side_bybit} | Diff:{best['rate_diff']*100:.4f}%"
        })
        
        return {"status": "success", "symbol": sym}
        
    except Exception as e:
        print(f"Force Trade Logic Error: {e}")
        return {"status": "error", "message": str(e)}

@app.post("/api/auto-trade/force")
async def force_auto_trade(
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None),
    x_user_binance_key: Optional[str] = Header(None),
    x_user_binance_secret: Optional[str] = Header(None)
):
    session = get_current_session(x_user_bybit_key, x_user_bybit_secret, x_user_binance_key, x_user_binance_secret)
    if not session: return {"status": "error", "message": "Session not found"}

    if not hasattr(app.state, "trade_lock"):
         app.state.trade_lock = asyncio.Lock()
    
    await app.state.trade_lock.acquire()
    try: 
         return await _internal_force_trade_logic(session)
    finally:
         if app.state.trade_lock.locked():
            app.state.trade_lock.release()

class SimulateTradeRequest(BaseModel):
    symbol: str
    exit_delay_seconds: int = 30
    is_live: bool = False

@app.post("/api/auto-trade/simulate")
async def simulate_trade(
    request: SimulateTradeRequest,
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None),
    x_user_binance_key: Optional[str] = Header(None),
    x_user_binance_secret: Optional[str] = Header(None)
):
    session = get_current_session(x_user_bybit_key, x_user_bybit_secret, x_user_binance_key, x_user_binance_secret)
    if not session: return {"status": "error", "message": "Session not found"}

    symbol = request.symbol.upper().replace("USDT", "")
    exit_delay = request.exit_delay_seconds
    is_live = request.is_live
    
    try:
        base_url = "https://fapi.binance.com" if is_live else "https://testnet.binancefuture.com"
        loop = asyncio.get_event_loop()
        r = await loop.run_in_executor(None, requests.get, f"{base_url}/fapi/v1/premiumIndex")
        data_binance = r.json()
        data_bybit_map = await fetch_bybit_rates(is_live=is_live)
        
        binance_item = next((x for x in data_binance if x['symbol'] == f"{symbol}USDT"), None)
        bybit_item = data_bybit_map.get(symbol)
        
        if not binance_item or not bybit_item:
            return {"status": "error", "message": f"Symbol {symbol} not found"}
        
        binance_rate = float(binance_item['lastFundingRate'])
        bybit_rate = bybit_item.get('rate', 0)
        mark_price = float(binance_item['markPrice'])
        
        if binance_rate > bybit_rate:
            side_binance = "SELL" 
            side_bybit = "Buy"    
        else:
            side_binance = "BUY"   
            side_bybit = "Sell"   
        
        investment = session.config["total_investment"] / session.config["max_trades"]
        leverage = session.config["leverage"]
        
        qty_binance = round((investment * leverage) / mark_price, 3)
        bybit_price = bybit_item.get('markPrice', mark_price)
        qty_bybit = round((investment * leverage) / bybit_price, 3)
        
        session.logs.append({
            "time": time.time(),
            "type": "SIM_ENTRY",
            "symbol": symbol,
            "msg": f"Simulated Entry: BN={side_binance} BB={side_bybit}"
        })
        
        await execute_auto_trade_entry(symbol, side_binance, side_bybit, qty_binance, qty_bybit, leverage, session.keys)
        
        session.active_trades[symbol] = {
            "entry_time": time.time(),
            "qty_binance": qty_binance,
            "qty_bybit": qty_bybit,
            "sides": {"binance": side_binance, "bybit": side_bybit}
        }
        
        async def delayed_exit():
            await asyncio.sleep(exit_delay)
            exit_binance = "BUY" if side_binance == "SELL" else "SELL"
            exit_bybit = "Sell" if side_bybit == "Buy" else "Buy"
            
            await execute_auto_trade_exit(symbol, exit_binance, exit_bybit, qty_binance, qty_bybit, leverage, is_live, session)
            
            session.logs.append({
                "time": time.time(),
                "type": "SIM_EXIT",
                "symbol": symbol,
                "msg": f"Simulated Exit complete"
            })
            if symbol in session.active_trades:
                del session.active_trades[symbol]
        
        asyncio.create_task(delayed_exit())
        
        return {"status": "success", "symbol": symbol}
        
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def execute_auto_trade_entry(symbol, side_binance, side_bybit, qty_binance, qty_bybit, leverage, keys={}):
    """
    Triggers the entry logic via the TradeScheduler.
    """
    try:
        scheduler_params = {
            "symbol": symbol,
            "qty_binance": qty_binance,
            "qty_bybit": qty_bybit,
            "leverage": leverage,
            "platform": "Both",
            "direction": "Auto",
            "bybit_side": side_bybit,
            "binance_side": side_binance,
            # Inject keys
            "bybit_key": keys.get("bybit_key"),
            "bybit_secret": keys.get("bybit_secret"),
            "binance_key": keys.get("binance_key"),
            "binance_secret": keys.get("binance_secret")
        }
        
        # Key Check
        if not keys.get("bybit_key") or not keys.get("binance_key"):
            msg = f"❌ AUTO-ENTRY BLOCKED: Missing keys for {symbol}. (Bybit: {bool(keys.get('bybit_key'))}, Binance: {bool(keys.get('binance_key'))})"
            print(msg)
            try:
                await manager.broadcast(json.dumps({"type": "error", "msg": msg}))
            except:
                pass
            return

        print(f"Auto-Trade executing ENTRY for {symbol} (BN:{qty_binance} BB:{qty_bybit})")
        
        tasks = []
        # Bybit
        tasks.append(scheduler._internal_place_order(symbol, side_bybit, qty_bybit, leverage, "BYBIT", scheduler_params))
        # Binance 
        tasks.append(scheduler._internal_place_order(symbol, side_binance, qty_binance, leverage, "BINANCE", scheduler_params))
        
        # Run both in parallel and wait for both to finish (return_exceptions=True)
        t_api_start = time.time()
        results = await asyncio.gather(*tasks, return_exceptions=True)
        t_api_end = time.time()
        print(f"⚡ API Response Time (Entry): {int((t_api_end - t_api_start) * 1000)}ms")
        
        # results[0] = Bybit, results[1] = Binance
        bybit_res = results[0]
        binance_res = results[1]
        
        bybit_success = not isinstance(bybit_res, Exception) and bybit_res.get("status") == "success"
        binance_success = not isinstance(binance_res, Exception) and binance_res.get("status") == "success"
        
        if bybit_success and binance_success:
            return True # Perfect entry
            
        # SAFETY: If one side succeeded and the other failed, we MUST close the orphan side
        if bybit_success and not binance_success:
            # Extract error detail
            error_detail = str(binance_res)
            if isinstance(binance_res, dict) and "msg" in binance_res:
                 error_detail = f"{binance_res.get('msg')} (Code: {binance_res.get('code')})"
            elif isinstance(binance_res, Exception):
                error_detail = str(binance_res)

            rollback_msg = f"⚠️ ARB FAILED: Binance failed ({error_detail}), rolling back Bybit for {symbol}..."
            print(rollback_msg)
            try: await manager.broadcast(json.dumps({"type": "error", "msg": rollback_msg}))
            except: pass
            # Reverse Bybit order
            close_side = "Sell" if side_bybit == "Buy" else "Buy"
            await scheduler._internal_place_order(symbol, close_side, qty_bybit, leverage, "BYBIT", scheduler_params)
            raise Exception(f"One-legged trade prevented (Binance failed: {error_detail})")
            
        if binance_success and not bybit_success:
            # Extract error detail
            error_detail = str(bybit_res)
            if isinstance(bybit_res, dict) and "retMsg" in bybit_res:
                 error_detail = f"{bybit_res.get('retMsg')} (Code: {bybit_res.get('retCode')})"
            elif isinstance(bybit_res, Exception):
                error_detail = str(bybit_res)

            rollback_msg = f"⚠️ ARB FAILED: Bybit failed ({error_detail}), rolling back Binance for {symbol}..."
            print(rollback_msg)
            try: await manager.broadcast(json.dumps({"type": "error", "msg": rollback_msg}))
            except: pass
            # Reverse Binance order
            close_side = "Sell" if side_binance == "Buy" else "Buy"
            await scheduler._internal_place_order(symbol, close_side, qty_binance, leverage, "BINANCE", scheduler_params)
            raise Exception(f"One-legged trade prevented (Bybit failed: {error_detail})")
            
        # If both failed
        if isinstance(bybit_res, Exception): raise bybit_res
        if isinstance(binance_res, Exception): raise binance_res
        raise Exception("Arbitrage Entry Failed on both sides")
        
    except Exception as e:
        err_msg = str(e)
        if hasattr(e, "detail"):
            err_msg = e.detail
        print(f"Auto-Trade Entry Error Detail: {err_msg}")
        try:
            await manager.broadcast(json.dumps({"type": "error", "msg": f"❌ Entry Failed: {err_msg}"}))
        except: pass
        raise e

async def execute_auto_trade_exit(symbol, side_binance, side_bybit, qty_binance, qty_bybit, leverage, is_live, session=None):
    """
    Exits the auto-trade positions and records history.
    """
    keys = session.keys if session else {}
    
    try:
        # --- CLOSE LOGIC ---
        close_side_binance = "Sell" if side_binance == "Buy" else "Buy"
        close_side_bybit = "Sell" if side_bybit == "Buy" else "Buy"
        
        params = {
            "symbol": symbol,
            "qty": qty_binance, # Use binance qty as base if similar, or handled per call
            "leverage": leverage,
            "bybit_key": keys.get("bybit_key"),
            "bybit_secret": keys.get("bybit_secret"),
            "binance_key": keys.get("binance_key"),
            "binance_secret": keys.get("binance_secret")
        }
        
        # Execute concurrently
        tasks = []
        # Bybit Close
        tasks.append(scheduler._internal_place_order(symbol, close_side_bybit, qty_bybit, leverage, "BYBIT", params))
        # Binance Close
        tasks.append(scheduler._internal_place_order(symbol, close_side_binance, qty_binance, leverage, "BINANCE", params))
        
        t_api_start = time.time()
        await asyncio.gather(*tasks)
        t_api_end = time.time()
        print(f"⚡ API Response Time (Exit): {int((t_api_end - t_api_start) * 1000)}ms")
        
    except Exception as e:
        print(f"Auto-Exit Error: {e}")



@app.post("/api/auto-trade/sync-positions")
async def sync_auto_trade_positions(
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None),
    x_user_binance_key: Optional[str] = Header(None),
    x_user_binance_secret: Optional[str] = Header(None),
    is_live: bool = False # Query param default, but frontend should send it
):
    session = get_current_session(x_user_bybit_key, x_user_bybit_secret, x_user_binance_key, x_user_binance_secret)
    if not session: return {"status": "error", "message": "Session not found"}
    
    keys = session.keys
    restored = []
    
    # --- BINANCE ---
    binance_positions = {}
    try:
        if keys["binance_key"] and keys["binance_secret"]:
             api_key, api_secret = get_binance_credentials(keys["binance_key"], keys["binance_secret"])
             # Use is_live param effectively
             base_url = "https://fapi.binance.com" if is_live else "https://testnet.binancefuture.com"
             
             # Fetch
             endpoint = "/fapi/v2/positionRisk"
             ts = int(time.time() * 1000)
             q = f"timestamp={ts}"
             sig = hmac.new(api_secret.encode('utf-8'), q.encode('utf-8'), hashlib.sha256).hexdigest()
             
             loop = asyncio.get_event_loop()
             res = await loop.run_in_executor(None, lambda: requests.get(f"{base_url}{endpoint}?{q}&signature={sig}", headers={"X-MBX-APIKEY": api_key}))
             
             if res.status_code == 200:
                 for p in res.json():
                     amt = float(p['positionAmt'])
                     if amt != 0:
                         sym = p['symbol'].replace("USDT", "")
                         binance_positions[sym] = {
                             "side": "Buy" if amt > 0 else "Sell",
                             "amt": abs(amt),
                             "entryPrice": float(p['entryPrice'])
                         }
    except Exception as e:
        print(f"Binance Sync Error: {e}")

    # --- BYBIT ---
    bybit_positions = {}
    try:
        if keys["bybit_key"] and keys["bybit_secret"]:
             api_key, api_secret = get_api_credentials(keys["bybit_key"], keys["bybit_secret"])
             
             url_base = "https://api.bybit.com" if is_live else "https://api-testnet.bybit.com" 
             
             endpoint = "/v5/position/list"
             params = "category=linear&settleCoin=USDT&limit=200"
             
             ts_bybit, recv, sig_bybit = generate_signature(api_key, api_secret, params)
             headers = {
                "X-BAPI-API-KEY": api_key,
                "X-BAPI-SIGN": sig_bybit,
                "X-BAPI-TIMESTAMP": ts_bybit,
                "X-BAPI-RECV-WINDOW": recv
             }
             
             loop = asyncio.get_event_loop()
             res = await loop.run_in_executor(None, lambda: requests.get(f"{url_base}{endpoint}?{params}", headers=headers))
             data = res.json()
             
             if data['retCode'] == 0:
                 for p in data['result']['list']:
                     size = float(p['size'])
                     if size > 0:
                         sym = p['symbol'].replace("USDT", "")
                         bybit_positions[sym] = {
                             "side": p['side'],
                             "size": size,
                             "entryPrice": float(p['avgPrice'])
                         }
    except Exception as e:
        print(f"Bybit Sync Error: {e}")
        
    # --- MERGE & RESTORE ---
    all_symbols = set(binance_positions.keys()) | set(bybit_positions.keys())
    
    for sym in all_symbols:
        bn = binance_positions.get(sym)
        bb = bybit_positions.get(sym)
        
        if sym not in session.active_trades:
            # Reconstruct
            side_binance = bn['side'] if bn else "None"
            side_bybit = bb['side'] if bb else "None"
            qty = bn['amt'] if bn else (bb['size'] if bb else 0)
            
            session.active_trades[sym] = {
                "entry_time": time.time(), 
                "amount": qty * (bn['entryPrice'] if bn else 0), 
                "qty": qty,
                "nft": int(time.time() * 1000) + 3600000, # Temp fallback
                "sides": {"binance": side_binance, "bybit": side_bybit},
                "keys": keys
            }
            restored.append(sym)
    
    # Update NFT for restored
    if restored:
        try:
             base_url = "https://fapi.binance.com" # Sync NFT from Live usually
             loop = asyncio.get_event_loop()
             r = await loop.run_in_executor(None, requests.get, f"{base_url}/fapi/v1/premiumIndex")
             data = r.json()
             for item in data:
                 s = item['symbol'].replace("USDT","")
                 if s in session.active_trades:
                      session.active_trades[s]["nft"] = int(item['nextFundingTime'])
        except: pass

    if restored:
        session.logs.append({
            "time": time.time(),
            "type": "INFO",
            "symbol": "SYSTEM",
            "msg": f"Synced: Restored {', '.join(restored)}"
        })
    
    return {
        "status": "success", 
        "restored": restored, 
        "active_count": len(session.active_trades)
    }

async def auto_trade_service():
    """
    Background loop for Auto-Trading.
    """
    print("🚀 Auto-Trade Service Started")
    
    while True:
        try:
            # 1. Fetch Rates (Fetch ONCE for all users to save API calls)
            data_binance = []
            data_bybit_map = {}
            
            try:
                base_url = "https://fapi.binance.com"
                loop = asyncio.get_event_loop()
                r = await loop.run_in_executor(None, requests.get, f"{base_url}/fapi/v1/premiumIndex")
                data_binance = r.json()
                data_bybit_map = await fetch_bybit_rates(is_live=True)
            except Exception as e:
                print(f"Global Data Fetch Error: {e}")
                await asyncio.sleep(5)
                continue
                
            now = time.time() * 1000
            
            # 2. Iterate over all Active Sessions
            current_sessions = list(session_manager.sessions.values()) # Snapshot
            
            for session in current_sessions:
                # Leaderboard Keep-Alive: If session is active and has a Bot ID, update its last_seen
                # This ensures bot stays on leaderboard even if frontend is closed
                if session.config.get("active") and hasattr(session, 'bot_id'):
                    # We can use global trade_manager stats for now (assuming single user per session for now)
                    # Or we could track per-session profit. For now, just keep it alive.
                     try:
                        stats = trade_manager.get_summary() # Using global stats for now
                        stats['is_active'] = True
                        leaderboard.update_bot(session.bot_id, getattr(session, 'bot_name', 'Auto-Bot'), stats)
                     except: pass

                # Always scan to update pending_opportunities based on user config
                    
                # Analyze candidates for THIS session
                candidates = []
                
                # Check for active trade exits (Timing checks)
                for sym, info in list(session.active_trades.items()):
                    pass

                for item in data_binance:
                    if not item['symbol'].endswith('USDT'): continue
                    symbol = item['symbol'].replace('USDT', '')
                    
                    if symbol in session.active_trades: continue
                    
                    # Check Cooldowns
                    if symbol in session.manual_closed_trades:
                        if time.time() - session.manual_closed_trades[symbol] < 300:
                            continue
                        else:
                            del session.manual_closed_trades[symbol]
                    
                    if symbol in session.failed_trades:
                        if time.time() - session.failed_trades[symbol] < 120: # 2 min cooldown for failed entries
                            continue
                        else:
                            del session.failed_trades[symbol]
                    
                    if symbol not in data_bybit_map: continue

                    # Safety: Ensure symbol is present in our Binance cache (valid futures symbol)
                    if symbol not in BINANCE_SYMBOL_INFO:
                        continue
                    
                    bybit_price = data_bybit_map[symbol]['markPrice']
                    bybit_rate = data_bybit_map[symbol].get('rate', 0)
                    bybit_nft = int(data_bybit_map[symbol].get('nextFundingTime', 0))

                    if bybit_price == 0: continue
                    
                    try:
                        binance_rate = float(item['lastFundingRate'])
                        mark_price_binance = float(item['markPrice'])
                        next_funding_binance = int(item['nextFundingTime'])
                        
                        if mark_price_binance == 0: continue
                        
                        # --- VALIDATION: Check for Invalid/Suspicious Rates ---
                        is_invalid = False
                        # High outlier or error codes (like -999)
                        if abs(binance_rate) > 10 or abs(bybit_rate) > 10:
                            is_invalid = True
                        # Exact zero is usually an error/placeholder
                        if binance_rate == 0 or bybit_rate == 0:
                            is_invalid = True
                        
                        # Hard skip only if funding time is absolutely 0 (breaks logic)
                        if next_funding_binance == 0 or bybit_nft == 0:
                            continue
                        # ----------------------------------------

                        rate_diff = abs(binance_rate - bybit_rate)
                        
                        price_diff_pct = 0
                        if mark_price_binance > 0:
                            price_diff_pct = abs(mark_price_binance - bybit_price) / mark_price_binance * 100
                        
                        min_diff_cfg = session.config["min_diff"]
                        # Default max price diff to 2% if not set
                        max_price_diff_cfg = session.config.get("max_price_diff", 2.0) 
                        
                        if (rate_diff * 100) > min_diff_cfg:
                            candidates.append({
                                "symbol": symbol,
                                "binance_rate": binance_rate,
                                "bybit_rate": bybit_rate,
                                "rate_diff": rate_diff,
                                "markPrice": mark_price_binance,
                                "nextFundingTime": next_funding_binance,
                                "nextFundingTimeBybit": bybit_nft,
                                "priceDiff": price_diff_pct,
                                "bybitPrice": bybit_price,
                                "is_invalid": is_invalid
                            })
                    except Exception as e:
                        print(f"Error processing symbol {symbol}: {e}")
                        continue

                # Sort by Time to Funding
                candidates.sort(key=lambda x: (min(x['nextFundingTime'], x['nextFundingTimeBybit'] if x['nextFundingTimeBybit'] > 0 else x['nextFundingTime']), -x['rate_diff']))
                
                # Update Pending Opportunities (Always Visible)
                session.pending_opportunities = candidates[:20] 
                
                
                # --- EXECUTION CHECK ---
                if not session.config["active"]:
                    continue

                # --- AUTO ENTRY EXECUTION ---
                # If we recently hit a balance error, wait 30s before trying ANY auto-entries again
                if (time.time() - session.last_balance_warning) < 30:
                    continue
                
                # Gap between ANY two auto-entries (global session cooldown)
                if (time.time() - session.last_entry_time) < 10:
                    continue

                execution_candidates = candidates[:30]
                ignore_timing = session.config.get("ignore_timing", False)
                entries_this_cycle = 0
                
                for cand in execution_candidates:
                    if cand.get("is_invalid"):
                        continue
                    
                    # Limit entries per cycle strictly
                    if entries_this_cycle >= 1:
                        break

                    symbol = cand['symbol']
                    
                    # Already failed recently?
                    if symbol in session.failed_trades:
                        if time.time() - session.failed_trades[symbol] < 120:
                            continue

                    nft = cand['nextFundingTime']
                    
                    time_to_funding = nft - now
                    entry_seconds = session.config.get("entry_before_seconds", 60)
                    window_ms = entry_seconds * 1000
                    
                    should_enter = False
                    if ignore_timing:
                         should_enter = True
                    elif 10000 < time_to_funding < window_ms:
                         should_enter = True
                    
                    if should_enter:
                        # Safety Check: Enforce Max Price Diff for Auto-Execution
                        if cand['priceDiff'] > session.config.get("max_price_diff", 2.0):
                             continue

                        # Check Max Trades
                        if len(session.active_trades) >= session.config["max_trades"]:
                            break
                        
                        # Mark as entry intent identified
                        session.last_entry_time = time.time()
                        entries_this_cycle += 1
                        
                        # Leverage
                        target_leverage = session.config["leverage"]
                        effective_leverage = await get_min_common_leverage(target_leverage, symbol, session.keys)
                        
                        # Direction
                        if cand['binance_rate'] > cand['bybit_rate']:
                            side_binance = "Sell"
                            side_bybit = "Buy"
                        else:
                            side_binance = "Buy"
                            side_bybit = "Sell"

                        inv = session.config["total_investment"]
                        per_trade_amt = inv / max(1, session.config["max_trades"])
                        
                        qty_binance = round((per_trade_amt * effective_leverage) / cand['markPrice'], 3)
                        qty_bybit = round((per_trade_amt * effective_leverage) / cand['bybitPrice'], 3)
                        
                        # Execute
                        user_prefix = f"[{session.user_id[:8]}] "
                        exec_msg = f"🚀 {user_prefix}AUTO-ENTRY: {symbol} | BN: {side_binance} {qty_binance} | BB: {side_bybit} {qty_bybit}"
                        print(exec_msg)
                        try:
                            await manager.broadcast(json.dumps({"type": "log", "msg": exec_msg, "color": "cyan"}))
                        except:
                            pass

                        try:
                            # TIMING START
                            t_start = time.time()
                            
                            await execute_auto_trade_entry(symbol, side_binance, side_bybit, qty_binance, qty_bybit, effective_leverage, session.keys)
                            
                            # TIMING END
                            t_end = time.time()
                            duration_ms = int((t_end - t_start) * 1000)
                            
                            # Log Execution Time
                            timing_msg = f"⏱️ TRADE EXECUTED in {duration_ms}ms"
                            print(f"{user_prefix} {timing_msg}")
                            session.logs.append({
                                "time": time.time(),
                                "type": "TIMING", 
                                "symbol": symbol,
                                "msg": timing_msg
                            })

                            session.active_trades[symbol] = {
                                "entry_time": time.time(),
                                "amount": per_trade_amt,
                                "qty_binance": qty_binance,
                                "qty_bybit": qty_bybit,
                                "nft": nft,
                                "sides": {"binance": side_binance, "bybit": side_bybit},
                                "keys": session.keys
                            }
                            
                            session.logs.append({
                                "time": time.time(),
                                "type": "ENTRY (AUTO)",
                                "symbol": symbol,
                                "msg": f"BN:{side_binance} BB:{side_bybit} | Diff:{cand['rate_diff']*100:.4f}%"
                            })
                            
                            # Update record
                            session.last_entry_time = time.time()
                            entries_this_cycle += 1
                            
                            # Standard Delay
                            await asyncio.sleep(3) 

                            # Schedule Auto-Exit
                            if session.config["auto_exit"]:
                                exit_delay = session.config.get("exit_after_seconds", 30)
                                
                                if ignore_timing:
                                    # When ignore_timing is ON, we entry IMMEDIATELY.
                                    # The exit is just a quick scalp/test duration.
                                    wait_seconds = exit_delay
                                    schedule_reason = "Force/Test Mode (Immediate)"
                                else:
                                    # Standard funding-based timing
                                    # We wait exactly until funding triggers, plus the configured seconds
                                    wait_seconds = (time_to_funding / 1000) + exit_delay
                                    schedule_reason = f"Funding Disbursal (+{exit_delay}s)"
                                
                                if wait_seconds < 1: wait_seconds = 1
                                
                                # Inform User of Schedule
                                print(f"{user_prefix}🕒 Scheduled Auto-Exit in {wait_seconds:.1f}s | Reason: {schedule_reason}")
                                
                                async def scheduled_exit_task(s_symbol, s_wait, s_session): # Closure capture
                                    await asyncio.sleep(s_wait)
                                    # Check if still active
                                    if s_symbol in s_session.active_trades:
                                        trade = s_session.active_trades[s_symbol]
                                        e_bin = "BUY" if trade['sides']['binance'] == "Sell" else "SELL"
                                        e_byb = "Sell" if trade['sides']['bybit'] == "Buy" else "Buy"
                                        
                                        t_exit_start = time.time()
                                        await execute_auto_trade_exit(s_symbol, e_bin, e_byb, trade['qty_binance'], trade['qty_bybit'], effective_leverage, s_session.config["is_live"], s_session)
                                        t_exit_end = time.time()
                                        dur_exit = int((t_exit_end - t_exit_start) * 1000)
                                        
                                        # Calculate Total Lifecycle Duration (Entry to Exit)
                                        entry_time = trade.get('entry_time', t_exit_end)
                                        total_duration = t_exit_end - entry_time
                                        total_dur_str = f"{total_duration:.2f}s"

                                        log_msg = f"Auto Exit after Funding ({dur_exit}ms API) | Total Held: {total_dur_str}"
                                        print(f"{user_prefix}✅ {log_msg}")

                                        s_session.logs.append({
                                            "time": time.time(),
                                            "type": "EXIT (AUTO)",
                                            "symbol": s_symbol,
                                            "msg": log_msg
                                        })
                                        if s_symbol in s_session.active_trades:
                                            del s_session.active_trades[s_symbol]

                                asyncio.create_task(scheduled_exit_task(symbol, wait_seconds, session))
                        
                        except Exception as e:
                            # If ANY leg fails, we do NOT add it to active_trades mapping
                            err_str = str(e).lower()
                            curr_time = time.time()
                            if "not enough" in err_str or "balance" in err_str or "110007" in err_str:
                                # ALWAYS SHOW WARNING (Removed 30s throttle for immediate feedback as requested)
                                balance_msg = "⚠️ INSUFFICIENT BALANCE: Ensure you have enough USDT in Bybit Unified and Binance Futures."
                                print(f"{user_prefix}{balance_msg}")
                                
                                # Broadcast to frontend toast/log
                                try:
                                    await manager.broadcast(json.dumps({"type": "error", "msg": balance_msg}))
                                except: pass
                                
                                # Also append to session logs so it stays in terminal
                                session.logs.append({
                                    "time": time.time(),
                                    "type": "ERROR",
                                    "symbol": symbol,
                                    "msg": "Insufficient Balance (Trade Skipped)"
                                })

                                session.last_balance_warning = curr_time
                                # Keep the cooldown to prevent spamming the exchange, not the user
                            else:
                                err_msg = str(e)
                                if hasattr(e, "detail"): err_msg = e.detail
                                print(f"❌ {user_prefix}FAILED TO OPEN ARBITRAGE FOR {symbol}: {err_msg}")
                                session.failed_trades[symbol] = time.time() 
                                session.last_entry_time = time.time() 
                                entries_this_cycle += 1 
                                
                                # Auto-Deactivate on persistent key errors
                                if "API Key is Invalid" in err_msg or "10003" in err_msg or "-2015" in err_msg:
                                    session.config["active"] = False
                                    session_manager.save_sessions()
                                    session_manager.save_sessions()
                                    deact_msg = f"🛑 {user_prefix}AUTO-TRADE DEACTIVATED: Invalid API keys or permissions."
                                    print(deact_msg)
                                    # Persist in session logs so frontend sees it on refresh
                                    session.logs.append({
                                        "time": time.time(),
                                        "type": "ERROR",
                                        "symbol": "SYSTEM",
                                        "msg": "Auto-Deactivated: Invalid API Keys. Check settings."
                                    })
                                    try: await manager.broadcast(json.dumps({"type": "error", "msg": deact_msg}))
                                    except: pass

                                await asyncio.sleep(5) 
                                break # Force stop this cycle for this session
                            pass

            await asyncio.sleep(1) # Loop Throttle
            
        except Exception as e:
            print(f"Service Loop Error: {e}")
            await asyncio.sleep(5)



@app.post("/api/verify-binance-keys")
async def verify_binance_keys(
    request: Request,
    is_testnet: bool = True,
    x_user_binance_key: Optional[str] = Header(None),
    x_user_binance_secret: Optional[str] = Header(None)
):
    try:
        # Check if keys are provided
        if not x_user_binance_key or not x_user_binance_secret:
            return {"valid": False, "error": "Missing API Keys in headers"}

        # Define URL
        base_url = "https://testnet.binancefuture.com" if is_testnet else "https://fapi.binance.com"
        endpoint = "/fapi/v2/account" # Lightweight endpoint to check permissions
        
        # Sign Request
        timestamp = int(time.time() * 1000)
        query_string = f"timestamp={timestamp}"
        signature = hmac.new(
            x_user_binance_secret.encode('utf-8'),
            query_string.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()
        
        url = f"{base_url}{endpoint}?{query_string}&signature={signature}"
        headers = {"X-MBX-APIKEY": x_user_binance_key}
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, lambda: requests.get(url, headers=headers))
        
        if response.status_code == 200:
             return {"valid": True, "message": "API keys are valid"}
        else:
             data = response.json()
             return {"valid": False, "error": data.get("msg", "Invalid API Keys or Permissions")}
             
    except Exception as e:
        return {"valid": False, "error": str(e)}

@app.post("/api/verify-bybit-keys")
async def verify_bybit_keys(
    request: Request,
    is_live: bool = False,
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None)
):
    try:
        if not x_user_bybit_key or not x_user_bybit_secret:
            return {"valid": False, "error": "Missing Bybit Keys"}
            
        # Select Base URL
        # Note: Bybit V5 uses same endpoint structure for demo and live, just different base URL
        # Demo: https://api-demo.bybit.com
        # Testnet: https://api-testnet.bybit.com
        # Live: https://api.bybit.com
        
        # User UI says "Demo" vs "Live".
        # Demo on Bybit usually refers to the Unified Trading Account Demo or Testnet?
        # Let's assume the user means Testnet/Demo URL.
        # We'll use BYBIT_DEMO_URL env default or hardcoded
        
        url_base = "https://api.bybit.com" if is_live else "https://api-demo.bybit.com"
        endpoint = "/v5/account/wallet-balance"
        params = "accountType=UNIFIED&coin=USDT" 
        
        # Generate Signature
        ts = str(int(time.time() * 1000))
        recv_window = "5000"
        
        # Bybit V5 Signature
        to_sign = ts + x_user_bybit_key + recv_window + params
        signature = hmac.new(
            x_user_bybit_secret.encode("utf-8"),
            to_sign.encode("utf-8"),
            hashlib.sha256
        ).hexdigest()
        
        headers = {
            "X-BAPI-API-KEY": x_user_bybit_key,
            "X-BAPI-SIGN": signature,
            "X-BAPI-SIGN-TYPE": "2",
            "X-BAPI-TIMESTAMP": ts,
            "X-BAPI-RECV-WINDOW": recv_window
        }
        
        full_url = f"{url_base}{endpoint}?{params}"
        
        # print(f"Verifying Bybit: {full_url}")
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, lambda: requests.get(full_url, headers=headers))
        
        if response.status_code == 200:
            data = response.json()
            if data['retCode'] == 0:
                return {"valid": True, "message": "Bybit Keys Valid"}
            else:
                return {"valid": False, "error": f"Bybit Error: {data['retMsg']}"}
        else:
             return {"valid": False, "error": f"HTTP {response.status_code}"}

    except Exception as e:
        return {"valid": False, "error": str(e)}




# --- TRADE PERSISTENCE & P&L MANAGER ---

class TradeManager:
    def __init__(self, storage_file="backend/data/trades.json"):
        self.storage_file = storage_file
        self.history = []
        self.load_history()

    def load_history(self):
        try:
            if os.path.exists(self.storage_file):
                with open(self.storage_file, "r") as f:
                    self.history = json.load(f)
                print(f"✅ Loaded {len(self.history)} historical trades from {self.storage_file}")
            else:
                print("ℹ️ No trade history found, starting fresh.")
                self.history = []
        except Exception as e:
            print(f"❌ Error loading trade history: {e}")
            self.history = []

    def save_history(self):
        try:
            os.makedirs(os.path.dirname(self.storage_file), exist_ok=True)
            with open(self.storage_file, "w") as f:
                json.dump(self.history, f, indent=2)
        except Exception as e:
            print(f"❌ Error saving trade history: {e}")

    def add_trade(self, trade_data):
        """
        Adds a completed trade to history.
        trade_data: {
             "id": str,
             "symbol": str,
             "entry_time": float,
             "exit_time": float,
             "side_binance": str,
             "side_bybit": str,
             "amount": float,
             "est_profit": float,
             "realized_profit": float (optional, updated later),
             "funding_fee_binance": float (optional),
             "funding_fee_bybit": float (optional),
             "status": "CLOSED"
        }
        """
        self.history.append(trade_data)
        self.save_history()

    def update_trade_profit(self, trade_id, realized_pnl):
        for t in self.history:
            if t.get("id") == trade_id:
                t["realized_profit"] = realized_pnl
                self.save_history()
                return True
        return False

    def get_summary(self):
        total_pnl = sum([t.get("realized_profit", 0) for t in self.history])
        total_trades = len(self.history)
        # last 24h
        now = time.time()
        pnl_24h = sum([t.get("realized_profit", 0) for t in self.history if now - t.get("exit_time", 0) < 86400])
        
        return {
            "total_pnl": total_pnl,
            "total_trades": total_trades,
            "pnl_24h": pnl_24h
        }

trade_manager = TradeManager()

# --- LEADERBOARD MANAGER ---
class LeaderboardManager:
    def __init__(self, storage_file="backend/data/leaderboard.json"):
        self.storage_file = storage_file
        self.bots = {}
        self.load()

    def load(self):
        try:
            if os.path.exists(self.storage_file):
                with open(self.storage_file, "r") as f:
                    self.bots = json.load(f)
        except:
             self.bots = {}

    def save(self):
        try:
            os.makedirs(os.path.dirname(self.storage_file), exist_ok=True)
            with open(self.storage_file, "w") as f:
                json.dump(self.bots, f, indent=2)
        except Exception as e:
            print(f"Stats save error: {e}")

    def update_bot(self, bot_id, name, stats):
        self.bots[bot_id] = {
            "name": name,
            "last_seen": time.time(),
            "stats": stats
        }
        self.save()

    def get_all(self):
        # Filter out bots not seen in 120 seconds (2 mins) to ensure list is fresh
        now = time.time()
        active = {k: v for k, v in self.bots.items() if now - v.get("last_seen", 0) < 120}
        return active

leaderboard = LeaderboardManager()

@app.post("/api/leaderboard/ping")
async def leaderboard_ping(request: Request):
    try:
        data = await request.json()
        bot_id = data.get("id")
        name = data.get("name", "Unknown Bot")
        stats = data.get("stats", {})
        
        if bot_id:
            leaderboard.update_bot(bot_id, name, stats)
            return {"status": "ok"}
        raise HTTPException(status_code=400, detail="Missing ID")
    except Exception as e:
        print(f"Leaderboard ping error: {e}")
        return {"status": "error"}

@app.get("/api/leaderboard")
async def get_leaderboard():
    return leaderboard.get_all()

# Hook into Auto-Exit logic to save trades
# We need to modify execute_auto_trade_exit to call trade_manager.add_trade
# For now, let's create the P&L endpoints first

@app.get("/api/pnl/overview")
async def get_pnl_overview():
    summary = trade_manager.get_summary()
    
    # Calculate Unrealized PnL from Active Trades and prepare list
    unrealized_pnl = 0
    active_details = []
    
    for sym, data in ACTIVE_AUTO_TRADES.items():
        # Try to calculate rough unrealized PnL if we had live prices
        # For now just pass the data
        active_details.append({
            "symbol": sym,
            "entry_time": data.get("entry_time"),
            "amount": data.get("amount"),
            "qty": max(data.get("qty_binance", 0) or 0, data.get("qty_bybit", 0) or 0, data.get("qty", 0) or 0),
            "qty_binance": data.get("qty_binance", data.get("qty")),
            "qty_bybit": data.get("qty_bybit", data.get("qty")),
            "sides": data.get("sides"),
            "nft": data.get("nft")
        })

    active_count = len(ACTIVE_AUTO_TRADES)
    
    return {
        "summary": summary,
        "active_trades": {
            "count": active_count,
            "list": active_details,
            "estimated_unrealized_pnl": 0 # Placeholder for now
        }
    }

@app.get("/api/pnl/history")
async def get_pnl_history(limit: int = 50):
    # Return sorted by exit time desc
    sorted_history = sorted(trade_manager.history, key=lambda x: x.get("exit_time", 0), reverse=True)
    return sorted_history[:limit]

@app.post("/api/pnl/rebuild")
async def rebuild_history(
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None),
    is_live: bool = False
):
    """
    Rebuilds trade history by fetching Bybit Transaction Logs.
    Since we only have Bybit data easily (Binance allows userTrades), we use Bybit logs 
    to infer 'Closed Arbitrage Cycles' where 'Cash Flow' (Profit) is > 0 or < 0 from Realized PnL.
    """
    api_key, api_secret = get_api_credentials(x_user_bybit_key, x_user_bybit_secret)
    try:
        # Fetch Transaction Log (Type: TRADE)
        endpoint = "/v5/account/transaction-log"
        base_url = "https://api.bybit.com" if is_live else BYBIT_DEMO_URL
        url = base_url + endpoint
        
        # We need "TRADE" type logs to find Realized PnL
        # However, Bybit separates "Closed PBP" (Closed PnL).
        params = "accountType=UNIFIED&category=linear&limit=50&type=TRADE"
        
        timestamp, recv_window, signature = generate_signature(api_key, api_secret, params)
        headers = {
            "X-BAPI-API-KEY": api_key,
            "X-BAPI-SIGN": signature,
            "X-BAPI-TIMESTAMP": timestamp,
            "X-BAPI-RECV-WINDOW": recv_window
        }
        
        loop = asyncio.get_event_loop()
        res = await loop.run_in_executor(None, lambda: requests.get(f"{url}?{params}", headers=headers))
        data = res.json()
        
        added_count = 0
        if data["retCode"] == 0:
            logs = data["result"]["list"]
            # Process logs to find closed trades
            # Bybit logs show "change" in balance. CLOSED_PNL is usually separate or part of TRADE.
            # We look for where 'change' is not 0 and type is TRADE? No, explicit Realized PnL.
            # Actually, simply accumulating all "TRADE" entries that have a realized PnL.
            # In Unified Account, it's tricky. 
            # Simplified: Just ensure we have *something*.
            
            existing_ids = set(t["id"] for t in trade_manager.history)
            
            for log in logs:
                # We interpret a transaction ID as a trade ID
                t_id = log["transactionTime"] + "_" + log["symbol"]
                if t_id in existing_ids: continue
                
                # Filter strictly for closed positions? 
                # This is a rough estimation since we don't have perfect state.
                pnl = float(log.get("change", 0))
                # Only care if it looks like a PnL entry (fairly generic)
                
                if log["type"] == "TRADE" and abs(pnl) > 0:
                   trade_manager.add_trade({
                       "id": t_id,
                       "symbol": log["symbol"],
                       "entry_time": int(log["transactionTime"]) / 1000 - 60, # Fake entry
                       "exit_time": int(log["transactionTime"]) / 1000,
                       "side_bybit": log["side"], # Buy/Sell
                       "side_binance": "Opposite", # Inferred
                       "amount": abs(float(log["qty"] or 0) * float(log["price"] or 0)),
                       "est_profit": pnl, # Use change as profit
                       "realized_profit": pnl,
                       "status": "IMPORTED"
                   })
                   added_count += 1
                   
        return {"status": "success", "added": added_count}
    except Exception as e:
        print(f"Rebuild error: {e}")
        return {"status": "error", "msg": str(e)}

if __name__ == "__main__":
    import uvicorn
    import os
    # Hugging Face Spaces uses port 7860 by default
    port = int(os.getenv("PORT", 8000))
    # Listen on all interfaces
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)




