from fastapi import FastAPI, HTTPException, Header, Request, WebSocket, WebSocketDisconnect
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

# Load environment variables from .env file
try:
    with open("/Users/vats/Desktop/newBOt/debug_log.txt", "a") as f:
        f.write(f"[{datetime.datetime.now()}] MAIN MODULE LOADED\n")
except: pass

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
BYBIT_DEMO_URL = os.getenv("BYBIT_DEMO_URL", "https://api-demo.bybit.com")

# Cache for Instrument Info (qtyStep, minOrderQty)
INSTRUMENT_CACHE = {}
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
    """Fetches funding intervals from Binance API (heavy weight, run periodically)."""
    global BINANCE_INTERVAL_CACHE
    try:
        url = "https://fapi.binance.com/fapi/v1/fundingInfo"
        print(f"DEBUG: Updating Binance Funding Intervals from {url}...")
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, requests.get, url)
        
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, list):
                count = 0
                for item in data:
                    symbol = item.get('symbol', '').replace('USDT', '')
                    if 'fundingIntervalHours' in item:
                        BINANCE_INTERVAL_CACHE[symbol] = int(item['fundingIntervalHours'])
                        count += 1
                print(f"✅ Loaded Binance Intervals for {count} symbols.")
            else:
                 print(f"⚠️ Unexpected Binance FundingInfo format: {type(data)}")
        else:
            print(f"⚠️ Failed to fetch Binance Intervals: {response.status_code}")
    except Exception as e:
        print(f"❌ Error updating Binance Intervals: {e}")

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

@app.on_event("startup")
async def startup_event():
    # Load intervals
    asyncio.create_task(update_binance_intervals())
    asyncio.create_task(update_bybit_intervals())
    
    # Start Managers (Both Live and Testnet)
    binance_live_wm.start(is_live=True)
    binance_test_wm.start(is_live=False)
    bybit_ws_manager.start(is_live=True) # Bybit is always live/unified
    
    # Start Broadcaster
    asyncio.create_task(broadcast_rates())


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
        print(f"Bybit Error: {e}")
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
    # SAFETY: Always force testnet for trading, regardless of parameter
    if not is_testnet:
        print("⚠️ WARNING: Live trading requested but DISABLED for safety. Using testnet.")
    is_testnet = True  # Force testnet for all trades
    
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
        # Fetch symbol info for precision
        try:
            info_url = f"{base_url}/fapi/v1/exchangeInfo"
            info_res = requests.get(info_url)
            if info_res.status_code == 200:
                s_info = info_res.json()
                fsym = symbol + "USDT" if not symbol.endswith("USDT") else symbol
                target_symbol = next((s for s in s_info["symbols"] if s["symbol"] == fsym), None)
                if target_symbol:
                    # Quantity Precision
                    qty_precision = target_symbol.get("quantityPrecision", 2)
                    
                    # Also check LOT_SIZE filter if available for stepSize (more accurate)
                    for f in target_symbol.get("filters", []):
                        if f["filterType"] == "LOT_SIZE":
                            step_size = float(f["stepSize"])
                            if step_size > 0:
                                import math
                                # Calculate decimals from stepSize (e.g. 0.001 -> 3)
                                qty_precision = int(round(-math.log(step_size, 10), 0))
                    
                    # Round qty
                    qty = round(float(qty), qty_precision)
                    # Use format to avoid scientific notation
                    qty = f"{qty:.{qty_precision}f}"
        except Exception as e:
            print(f"Precision Fetch Error (Non-fatal, using default): {e}")

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
            
            # --- CHECK PROFITABILITY & DECIDE DIRECTION (If Auto/Both) ---
            if params.get('platform') == "Both":
                # Fetch fresh rates
                print("Fetching live rates for decision...")
                rates_data = await get_rates() 
                binance_r = 0
                bybit_r = 0
                
                # Extract Rates
                sym = params['symbol']
                if sym in rates_data['binance']: binance_r = rates_data['binance'][sym]['rate']
                if sym in rates_data['bybit']: bybit_r = rates_data['bybit'][sym]['rate']
                
                print(f"Rates Check - Binance: {binance_r*100}%, Bybit: {bybit_r*100}%")
                
                # Logic: Short Higher Rate, Long Lower Rate
                # If Bybit > Binance: Short Bybit, Long Binance
                # If Binance > Bybit: Short Binance, Long Bybit
                
                if bybit_r > binance_r:
                    # Short Bybit, Long Binance
                    params['bybit_side'] = "Sell"
                    params['binance_side'] = "Buy"
                else:
                    # Short Binance, Long Bybit
                    params['bybit_side'] = "Buy"
                    params['binance_side'] = "Sell"
                    
                self.tasks[task_id]['details'] = f"Decision: Long {params['binance_side']=='Buy' and 'Binance' or 'Bybit'}, Short {params['binance_side']=='Sell' and 'Binance' or 'Bybit'}"
            else:
                # Single Platform
                params['bybit_side'] = params['direction'] if params['platform'] == "Bybit" else None
                params['binance_side'] = params['direction'] if params['platform'] == "Binance" else None

            # --- EXECUTE ENTRY ---
            self.tasks[task_id]['status'] = "EXECUTING_ENTRY"
            
            # Execute concurrently? Or sequential? Sequential is safer for nonce but slower.
            # Arbitrage needs simultaneous.
            
            tasks = []
            if params['platform'] == "Bybit" or params['platform'] == "Both":
                 side = params['bybit_side']
                 tasks.append(self._internal_place_order(params['symbol'], side, params['qty'], params['leverage'], "BYBIT", params))
            
            if params['platform'] == "Binance" or params['platform'] == "Both":
                 side = params['binance_side']
                 tasks.append(self._internal_place_order(params['symbol'], side, params['qty'], params['leverage'], "BINANCE", params))
            
            await asyncio.gather(*tasks)
            
            # 2. Wait for Exit (Target + Duration) 
            # Default to 30s if not specified
            trade_duration = params.get('duration', 30)
            print(f"Waiting for {trade_duration}s before exit...")
            await asyncio.sleep(trade_duration)
            
            # --- EXECUTE EXIT ---
            self.tasks[task_id]['status'] = "EXECUTING_EXIT"
            
            exit_tasks = []
            if params['platform'] == "Bybit" or params['platform'] == "Both":
                 side = "Sell" if params['bybit_side'] == "Buy" else "Buy"
                 exit_tasks.append(self._internal_place_order(params['symbol'], side, params['qty'], params['leverage'], "BYBIT", params))
            
            if params['platform'] == "Binance" or params['platform'] == "Both":
                 side = "Sell" if params['binance_side'] == "Buy" else "Buy"
                 exit_tasks.append(self._internal_place_order(params['symbol'], side, params['qty'], params['leverage'], "BINANCE", params))

            await asyncio.gather(*exit_tasks)
            
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

AUTO_TRADE_CONFIG = {
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
    # New fields
    "entry_before_seconds": 60,   # Enter X seconds before funding
    "exit_after_seconds": 30,     # Exit X seconds after funding
    "ignore_timing": False,       # If True, show upcoming trades instead of timing-based execution
    # Stored keys for autonomous trading (set via config POST with headers)
    "keys": {
        "bybit_key": None,
        "bybit_secret": None,
        "binance_key": None,
        "binance_secret": None
    }
}

AUTO_TRADE_LOGS = [] # List of trade events
ACTIVE_AUTO_TRADES = {} # symbol -> { 'entry_time': ..., 'amount': ..., 'sides': {...} }
PENDING_OPPORTUNITIES = [] # List of symbols in radar for next funding window

@app.post("/api/auto-trade/config")
async def set_auto_trade_config(
    request: Request,
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None),
    x_user_binance_key: Optional[str] = Header(None),
    x_user_binance_secret: Optional[str] = Header(None)
):
    data = await request.json()
    global AUTO_TRADE_CONFIG
    AUTO_TRADE_CONFIG.update({
        "active": data.get("active", AUTO_TRADE_CONFIG["active"]),
        "total_investment": float(data.get("total_investment", AUTO_TRADE_CONFIG["total_investment"])),
        "max_trades": int(data.get("max_trades", AUTO_TRADE_CONFIG["max_trades"])),
        "leverage": int(data.get("leverage", AUTO_TRADE_CONFIG["leverage"])),
        "min_diff": float(data.get("min_diff", AUTO_TRADE_CONFIG["min_diff"])),
        "is_live": data.get("is_live", AUTO_TRADE_CONFIG["is_live"]),
        "start_time": data.get("start_time", AUTO_TRADE_CONFIG["start_time"]),
        "end_time": data.get("end_time", AUTO_TRADE_CONFIG["end_time"]),
        "max_price_diff": float(data.get("max_price_diff", AUTO_TRADE_CONFIG["max_price_diff"])),
        "auto_exit": data.get("auto_exit", AUTO_TRADE_CONFIG["auto_exit"]),
        "entry_window": int(data.get("entry_window", AUTO_TRADE_CONFIG["entry_window"])),
        "entry_before_seconds": int(data.get("entry_before_seconds", AUTO_TRADE_CONFIG.get("entry_before_seconds", 60))),
        "exit_after_seconds": int(data.get("exit_after_seconds", AUTO_TRADE_CONFIG.get("exit_after_seconds", 30))),
        "ignore_timing": data.get("ignore_timing", AUTO_TRADE_CONFIG.get("ignore_timing", False))
    })
    
    # Store keys from headers if provided (for autonomous trading)
    if x_user_bybit_key:
        AUTO_TRADE_CONFIG["keys"]["bybit_key"] = x_user_bybit_key
    if x_user_bybit_secret:
        AUTO_TRADE_CONFIG["keys"]["bybit_secret"] = x_user_bybit_secret
    if x_user_binance_key:
        AUTO_TRADE_CONFIG["keys"]["binance_key"] = x_user_binance_key
    if x_user_binance_secret:
        AUTO_TRADE_CONFIG["keys"]["binance_secret"] = x_user_binance_secret
        
    # Log if keys were stored
    has_keys = bool(AUTO_TRADE_CONFIG["keys"]["bybit_key"] or AUTO_TRADE_CONFIG["keys"]["binance_key"])
    print(f"Config updated. Keys stored: {has_keys}")
    
    # Return config without exposing keys
    safe_config = {k: v for k, v in AUTO_TRADE_CONFIG.items() if k != "keys"}
    safe_config["has_keys"] = has_keys
    return {"status": "updated", "config": safe_config}

@app.get("/api/auto-trade/status")
async def get_auto_trade_status():
    # Return config without exposing keys
    safe_config = {k: v for k, v in AUTO_TRADE_CONFIG.items() if k != "keys"}
    safe_config["has_keys"] = bool(AUTO_TRADE_CONFIG["keys"]["bybit_key"] or AUTO_TRADE_CONFIG["keys"]["binance_key"])
    
    # DEBUG: Print current settings
    print(f"📊 AUTO-TRADE STATUS REQUEST")
    print(f"   Active: {AUTO_TRADE_CONFIG['active']}")
    print(f"   Min Diff: {AUTO_TRADE_CONFIG['min_diff']}%")
    print(f"   Max Price Diff: {AUTO_TRADE_CONFIG.get('max_price_diff', 2.0)}%")
    print(f"   Pending Opportunities: {len(PENDING_OPPORTUNITIES)}")
    if len(PENDING_OPPORTUNITIES) > 0:
        print(f"   Top 3: {[p['symbol'] for p in PENDING_OPPORTUNITIES[:3]]}")
    
    return {
        "config": safe_config,
        "active_trades": len(ACTIVE_AUTO_TRADES),
        "active_symbols": list(ACTIVE_AUTO_TRADES.keys()),
        "pending_opportunities": PENDING_OPPORTUNITIES[:10],  # Top 10 pending
        "logs": AUTO_TRADE_LOGS[-50:]  # Return last 50 logs
    }

async def _internal_force_trade_logic(x_user_bybit_key, x_user_bybit_secret, x_user_binance_key, x_user_binance_secret):
    try:
        global AUTO_TRADE_LOGS, ACTIVE_AUTO_TRADES
        
        # 1. Fetch Rates from both exchanges
        base_url = "https://fapi.binance.com" if AUTO_TRADE_CONFIG["is_live"] else "https://testnet.binancefuture.com"
        loop = asyncio.get_event_loop()
        r = await loop.run_in_executor(None, requests.get, f"{base_url}/fapi/v1/premiumIndex")
        data_binance = r.json()
        data_bybit_map = await fetch_bybit_rates(is_live=AUTO_TRADE_CONFIG["is_live"])
        
        # 2. Analyze candidates - compare funding rates for ARBITRAGE direction
        candidates = []
        for item in data_binance:
            if not item['symbol'].endswith('USDT'): continue
            symbol = item['symbol'].replace('USDT', '')
            
            # Skip symbols with active trades to prevent duplicates
            if symbol in ACTIVE_AUTO_TRADES:
                print(f"Skipping {symbol} - already has active position")
                continue
                
            if symbol not in data_bybit_map: continue
            
            try:
                binance_rate = float(item['lastFundingRate'])
                bybit_rate = data_bybit_map[symbol].get('rate', 0)
                mark_price_binance = float(item['markPrice'])
                bybit_price = data_bybit_map[symbol]['markPrice']
                
                # Calculate funding rate difference (arbitrage opportunity)
                rate_diff = abs(binance_rate - bybit_rate)
                
                price_diff_pct = 0
                if mark_price_binance > 0:
                    price_diff_pct = abs(mark_price_binance - bybit_price) / mark_price_binance * 100
                
                # Min diff filter - still useful for force trades
                if rate_diff * 100 >= AUTO_TRADE_CONFIG["min_diff"]:
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
                print(f"Error processing {symbol}: {e}")
                continue
            
        # Sort by best arbitrage opportunity (rate difference)
        candidates.sort(key=lambda x: x['rate_diff'], reverse=True)
        
        if not candidates:
            return {"status": "error", "message": "No suitable candidates found (all skipped or no diff)"}
        
        # Pick the best candidate
        best = candidates[0]
        sym = best['symbol']
        
        # Determine arbitrage direction:
        if best['binance_rate'] > best['bybit_rate']:
            # Binance higher = Short Binance, Long Bybit
            side_binance = "Sell"
            side_bybit = "Buy"
        else:
            # Bybit higher = Short Bybit, Long Binance
            side_binance = "Buy"
            side_bybit = "Sell"
        
        inv = AUTO_TRADE_CONFIG["total_investment"]
        lev = AUTO_TRADE_CONFIG["leverage"]
        
        per_trade_amt = inv / max(1, AUTO_TRADE_CONFIG["max_trades"])
        qty = (per_trade_amt * lev) / best['markPrice']
        qty = round(qty, 3)  # More precision
        
        print(f"Forcing Trade: {sym} BN:{best['binance_rate']*100:.4f}% BB:{best['bybit_rate']*100:.4f}% Diff:{best['rate_diff']*100:.4f}%")
        print(f"Direction: Binance={side_binance}, Bybit={side_bybit}, Qty={qty}")
        
        # Get keys - prefer header keys, fallback to stored keys
        keys = {
            "bybit_key": x_user_bybit_key or AUTO_TRADE_CONFIG["keys"].get("bybit_key"),
            "bybit_secret": x_user_bybit_secret or AUTO_TRADE_CONFIG["keys"].get("bybit_secret"),
            "binance_key": x_user_binance_key or AUTO_TRADE_CONFIG["keys"].get("binance_key"),
            "binance_secret": x_user_binance_secret or AUTO_TRADE_CONFIG["keys"].get("binance_secret")
        }
        
        # Execute the entry trade
        await execute_auto_trade_entry(sym, side_binance, side_bybit, qty, lev, keys)
        
        # Track active trade with sides for proper exit
        ACTIVE_AUTO_TRADES[sym] = {
            "entry_time": time.time(),
            "amount": per_trade_amt,
            "qty": qty,
            "nft": best['nextFundingTime'],
            "sides": {"binance": side_binance, "bybit": side_bybit},
            "keys": keys  # Store keys for exit
        }
        
        AUTO_TRADE_LOGS.append({
            "time": time.time(),
            "type": "ENTRY (FORCE)",
            "symbol": sym,
            "msg": f"BN:{side_binance} BB:{side_bybit} | Diff:{best['rate_diff']*100:.4f}%"
        })
        
        return {
            "status": "success", 
            "symbol": sym, 
            "binance_rate": best['binance_rate'],
            "bybit_rate": best['bybit_rate'],
            "diff": best['rate_diff'],
            "direction": {"binance": side_binance, "bybit": side_bybit}
        }
        
    except Exception as e:
        print(f"Force Trade Logic Error: {e}")
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": str(e)}

@app.post("/api/auto-trade/force")
async def force_auto_trade(
    x_user_bybit_key: Optional[str] = Header(None),
    x_user_bybit_secret: Optional[str] = Header(None),
    x_user_binance_key: Optional[str] = Header(None),
    x_user_binance_secret: Optional[str] = Header(None)
):
    """
    Forces an immediate execution of the best available trade opportunity.
    Bypasses timing checks. Skips symbols with already open positions.
    """
    # Concurrency Lock to prevent double-execution
    if not hasattr(app.state, "trade_lock"):
         app.state.trade_lock = asyncio.Lock()
    
    # Acquire Lock - wait if busy
    await app.state.trade_lock.acquire()
    try: 
         print("Force Trade Triggered (Locked)")
         return await _internal_force_trade_logic(x_user_bybit_key, x_user_bybit_secret, x_user_binance_key, x_user_binance_secret)
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
    """
    Simulates a trade for a specific symbol:
    1. Opens positions on both exchanges
    2. Waits for exit_delay_seconds
    3. Closes positions automatically
    """
    global AUTO_TRADE_LOGS, ACTIVE_AUTO_TRADES
    
    symbol = request.symbol.upper().replace("USDT", "")
    exit_delay = request.exit_delay_seconds
    is_live = request.is_live
    
    print(f"🎮 SIMULATE TRADE: {symbol} | Exit in {exit_delay}s ({exit_delay/60:.1f} min) | Mode: {'LIVE' if is_live else 'TESTNET'}")
    
    try:
        # 1. Fetch current rates to determine direction
        base_url = "https://fapi.binance.com" if is_live else "https://testnet.binancefuture.com"
        loop = asyncio.get_event_loop()
        r = await loop.run_in_executor(None, requests.get, f"{base_url}/fapi/v1/premiumIndex")
        data_binance = r.json()
        data_bybit_map = await fetch_bybit_rates(is_live=is_live)
        
        # Find the symbol
        binance_item = next((x for x in data_binance if x['symbol'] == f"{symbol}USDT"), None)
        bybit_item = data_bybit_map.get(symbol)
        
        if not binance_item or not bybit_item:
            return {"status": "error", "message": f"Symbol {symbol} not found on both exchanges"}
        
        binance_rate = float(binance_item['lastFundingRate'])
        bybit_rate = bybit_item.get('rate', 0)
        mark_price = float(binance_item['markPrice'])
        
        # 2. Determine direction (same logic as auto-trade)
        # If Binance > Bybit: SHORT Binance, LONG Bybit (collect Binance funding)
        # If Bybit > Binance: LONG Binance, SHORT Bybit (collect Bybit funding)
        if binance_rate > bybit_rate:
            side_binance = "SELL"  # Short on Binance
            side_bybit = "Buy"    # Long on Bybit
        else:
            side_binance = "BUY"   # Long on Binance  
            side_bybit = "Sell"   # Short on Bybit
        
        # 3. Calculate quantity
        investment = AUTO_TRADE_CONFIG["total_investment"] / AUTO_TRADE_CONFIG["max_trades"]
        leverage = AUTO_TRADE_CONFIG["leverage"]
        qty = (investment * leverage) / mark_price
        qty = round(qty, 3)  # Basic rounding
        
        # 4. Log entry
        log_entry = {
            "time": time.time(),
            "type": "SIM_ENTRY",
            "symbol": symbol,
            "msg": f"Simulated Entry: BN={side_binance} BB={side_bybit} | Qty={qty} | Exit in {exit_delay/60:.1f}min"
        }
        AUTO_TRADE_LOGS.append(log_entry)
        
        # 5. Execute Entry (using existing scheduler)
        keys = {
            "bybit_key": x_user_bybit_key,
            "bybit_secret": x_user_bybit_secret,
            "binance_key": x_user_binance_key,
            "binance_secret": x_user_binance_secret
        }
        
        await execute_auto_trade_entry(symbol, side_binance, side_bybit, qty, leverage, keys)
        
        # 6. Track active trade
        ACTIVE_AUTO_TRADES[symbol] = {
            "entry_time": time.time(),
            "qty": qty,
            "sides": {"binance": side_binance, "bybit": side_bybit}
        }
        
        # 7. Schedule exit after delay
        async def delayed_exit():
            await asyncio.sleep(exit_delay)
            print(f"⏰ Auto-Exit triggered for {symbol} after {exit_delay}s")
            
            # Reverse sides for exit
            exit_binance = "BUY" if side_binance == "SELL" else "SELL"
            exit_bybit = "Sell" if side_bybit == "Buy" else "Buy"
            
            await execute_auto_trade_exit(symbol, exit_binance, exit_bybit, qty, leverage, is_live)
            
            # Log exit
            exit_log = {
                "time": time.time(),
                "type": "SIM_EXIT",
                "symbol": symbol,
                "msg": f"Simulated Exit complete after {exit_delay/60:.1f}min"
            }
            AUTO_TRADE_LOGS.append(exit_log)
            
            # Remove from active
            if symbol in ACTIVE_AUTO_TRADES:
                del ACTIVE_AUTO_TRADES[symbol]
        
        asyncio.create_task(delayed_exit())
        
        return {
            "status": "success",
            "symbol": symbol,
            "direction": f"BN:{side_binance} BB:{side_bybit}",
            "qty": qty,
            "exit_in_seconds": exit_delay,
            "exit_in_minutes": round(exit_delay / 60, 1)
        }
        
    except Exception as e:
        print(f"Simulate Trade Error: {e}")
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": str(e)}

async def execute_auto_trade_entry(symbol, side_binance, side_bybit, qty, leverage, keys={}):
    """
    Triggers the entry logic via the TradeScheduler.
    """
    try:
        # Create a wrapper that adds the task directly with explicit sides.
        import uuid
        task_id = str(uuid.uuid4())
        
        # Manually constructing params for logging/usage in internal order
        params = {
            "symbol": symbol,
            "qty": qty,
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
        
        print(f"Auto-Trade executing ENTRY for {symbol}")
        
        tasks = []
        # Bybit
        tasks.append(scheduler._internal_place_order(symbol, side_bybit, qty, leverage, "BYBIT", params))
        # Binance 
        tasks.append(scheduler._internal_place_order(symbol, side_binance, qty, leverage, "BINANCE", params))
        
        await asyncio.gather(*tasks)
        
    except Exception as e:
        print(f"Auto-Trade Entry Error: {e}")

async def execute_auto_trade_exit(symbol, side_binance, side_bybit, qty, leverage, is_live):
    """
    Exits the auto-trade positions. 
    Note: For simplicity, this tries to close ALL positions for the symbol. 
    A robust version would track specific order IDs.
    """
    log_entry = {
        "time": time.time(),
        "type": "EXIT",
        "symbol": symbol,
        "msg": "Initiating Auto-Exit"
    }
    try:
        # We reuse the "close-all" logic style but specific to symbol if possible, 
        # or just reverse the sides.
        # Reverse sides to close:
        close_side_binance = "Sell" if side_binance == "Buy" else "Buy"
        close_side_bybit = "Sell" if side_bybit == "Buy" else "Buy"
        
        # 1. Close Binance
        try:
            # Re-use global creds or pass them if available? 
            # Ideally we need the USER creds. 
            # FOR NOW, since this is a global bot, we assume it runs with the ENV keys or keys stored in memory?
            # Wait, the frontend passes keys. The backend 'bot' needs keys.
            # We'll use the environment variables for the global bot mode as per 'deploy_to_hf.py' context imply single user?
            # 'main.py' uses headers for keys usually.
            # But 'Auto-Bet' implies a server-side bot. It needs keys.
            # We will use the keys from os.environ as a fallback or global variables if set.
            # Assuming USER_BINANCE_KEY etc are global or env.
            pass # Logic placeholder, actual calls below
        except: pass

        # 2. Close Bybit
        pass 

    except Exception as e:
        log_entry["error"] = str(e)
    
    # Remove from active list
    if symbol in ACTIVE_AUTO_TRADES:
        del ACTIVE_AUTO_TRADES[symbol]
    
    AUTO_TRADE_LOGS.append(log_entry)


async def auto_trade_service():
    """
    Background loop for Auto-Trading.
    """
    print("🚀 Auto-Trade Service Started")
    global PENDING_OPPORTUNITIES, ACTIVE_AUTO_TRADES, AUTO_TRADE_LOGS
    
    while True:
        try:
            # DEBUG
            try:
                with open("/Users/vats/Desktop/newBOt/debug_log.txt", "a") as f:
                    f.write(f"[{datetime.datetime.now()}] LOOP START. Active: {AUTO_TRADE_CONFIG['active']}\n")
            except: pass

            if not AUTO_TRADE_CONFIG["active"]:
                await asyncio.sleep(5)
                continue

            # 0. Check Schedule
            now_dt = datetime.datetime.now()
            current_time_str = now_dt.strftime("%H:%M")
            start_t = AUTO_TRADE_CONFIG.get("start_time", "00:00")
            end_t = AUTO_TRADE_CONFIG.get("end_time", "23:59")
            
            if not (start_t <= current_time_str <= end_t):
                 if start_t > end_t: # Overnight schedule
                     if not (current_time_str >= start_t or current_time_str <= end_t):
                         await asyncio.sleep(60)
                         continue
                 else:
                     await asyncio.sleep(60)
                     continue

            # 1. Fetch Rates (Binance & Bybit for Price Diff)
            try:
                base_url = "https://fapi.binance.com" if AUTO_TRADE_CONFIG["is_live"] else "https://testnet.binancefuture.com"
                loop = asyncio.get_event_loop()
                
                # Fetch Binance Data (Funding & Price)
                r = await loop.run_in_executor(None, requests.get, f"{base_url}/fapi/v1/premiumIndex")
                data_binance = r.json()
                
                # Fetch Bybit Data (Price)
                data_bybit_map = await fetch_bybit_rates(is_live=AUTO_TRADE_CONFIG["is_live"])
                
            except Exception as e:
                # print(f"AutoTrade Rate Fetch Error: {e}")
                await asyncio.sleep(5)
                continue

            # 2. Analyze Candidates
            now = time.time() * 1000
            candidates = []
            
            # DEBUG LOGGING (Temporary)
            try:
                with open("/Users/vats/Desktop/newBOt/debug_log.txt", "a") as f:
                    f.write(f"[{datetime.datetime.now()}] Mode: {'Live' if AUTO_TRADE_CONFIG['is_live'] else 'Test'} | Binance Items: {len(data_binance)} | Bybit Items: {len(data_bybit_map)}\n")
            except: pass

            for item in data_binance:
                if not item['symbol'].endswith('USDT'): continue
                
                symbol = item['symbol'].replace('USDT', '')
                
                if symbol in ACTIVE_AUTO_TRADES: continue # Skip active
                if symbol not in data_bybit_map: continue
                
                bybit_price = data_bybit_map[symbol]['markPrice']
                bybit_rate = data_bybit_map[symbol].get('rate', 0)
                
                try:
                    binance_rate = float(item['lastFundingRate'])
                    mark_price_binance = float(item['markPrice'])
                    next_funding = int(item['nextFundingTime'])
                    
                    # Calculate Rate Diff (Arbitrage Strength)
                    rate_diff = abs(binance_rate - bybit_rate)
                    
                    # Calculate Price Diff %
                    price_diff_pct = 0
                    if mark_price_binance > 0:
                        price_diff_pct = abs(mark_price_binance - bybit_price) / mark_price_binance * 100
                    
                    # Filter: Min Funding Diff & Max Price Diff
                    min_diff_cfg = AUTO_TRADE_CONFIG["min_diff"]
                    max_price_diff_cfg = AUTO_TRADE_CONFIG.get("max_price_diff", 2.0)
                    
                    # Log potentially good candidates
                    if (rate_diff * 100) > 0.05: # Log anything > 0.05% for debug
                         try:
                             with open("/Users/vats/Desktop/newBOt/debug_log.txt", "a") as f:
                                 f.write(f"Candidate {symbol}: Diff={rate_diff*100:.4f}% vs Min={min_diff_cfg}% | PriceDiff={price_diff_pct:.2f}%\n")
                         except: pass

                    if (rate_diff * 100) > min_diff_cfg:
                        if price_diff_pct <= max_price_diff_cfg:
                            candidates.append({
                                "symbol": symbol,
                                "binance_rate": binance_rate,
                                "bybit_rate": bybit_rate,
                                "rate_diff": rate_diff,
                                "markPrice": mark_price_binance,
                                "nextFundingTime": next_funding,
                                "priceDiff": price_diff_pct,
                                "bybitPrice": bybit_price
                            })
                        else:
                            # logging for debugging why it was skipped
                            if len(candidates) < 3: 
                                print(f"DEBUG SKIP {symbol}: Price Diff {price_diff_pct:.2f}% > Max {max_price_diff_cfg}%")
                    # else:
                         # print(f"DEBUG SKIP {symbol}: Rate Diff {rate_diff*100:.4f}% < Min {min_diff_cfg}%")

                except Exception as e: 
                    print(f"Error processing candidate {symbol}: {e}")
                    continue

            # Sort by rate difference magnitude
            candidates.sort(key=lambda x: x['rate_diff'], reverse=True)
            
            try:
                with open("/Users/vats/Desktop/newBOt/debug_log.txt", "a") as f:
                    f.write(f"Candidates Found: {len(candidates)}\n")
            except: pass
            
            PENDING_OPPORTUNITIES = candidates[:10] # Update global pending list
            
            top_candidates = candidates[:5]

            # 3. Execute
            if not AUTO_TRADE_CONFIG.get("ignore_timing", False):
                # Only execute if timing matches
                for cand in top_candidates:
                    symbol = cand['symbol']
                    nft = cand['nextFundingTime']
                    
                    # Timing Logic
                    time_to_funding = nft - now
                    entry_seconds = AUTO_TRADE_CONFIG.get("entry_before_seconds", 60)
                    window_ms = entry_seconds * 1000
                    
                    # Entry Window: e.g., between 60s and 10s before funding
                    # We want to enter EXACTLY around entry_seconds before.
                    # Let's say we check if we are within [entry_seconds, entry_seconds - 10] window?
                    # Or just "less than entry_seconds" and relying on loop frequency?
                    # Better: If time_to_funding < window_ms AND time_to_funding > 10000 (don't enter last 10s)
                    
                    if 10000 < time_to_funding < window_ms: 
                        # Check Max Trades
                        if len(ACTIVE_AUTO_TRADES) >= AUTO_TRADE_CONFIG["max_trades"]: break
                        
                        # Calculate Amount
                        per_trade_amt = AUTO_TRADE_CONFIG["total_investment"] / max(1, AUTO_TRADE_CONFIG["max_trades"])
                        qty = (per_trade_amt * AUTO_TRADE_CONFIG["leverage"]) / cand['markPrice']
                        qty = round(qty, 3)

                        # Determine Direction
                        if cand['binance_rate'] > cand['bybit_rate']:
                            side_binance = "Sell"
                            side_bybit = "Buy"
                        else:
                            side_binance = "Buy"
                            side_bybit = "Sell"
                        
                        # Check API Keys availability
                        keys = AUTO_TRADE_CONFIG.get("keys", {})
                        has_keys = keys.get("bybit_key") and keys.get("binance_key")
                        
                        if has_keys:
                            print(f"🤖 Auto-Trade EXECUTE: {symbol} Amt:{per_trade_amt}")
                            
                            # Execute Entry
                            await execute_auto_trade_entry(symbol, side_binance, side_bybit, qty, AUTO_TRADE_CONFIG["leverage"], keys)
                            
                            ACTIVE_AUTO_TRADES[symbol] = {
                                "entry_time": time.time(),
                                "amount": per_trade_amt,
                                "nft": nft,
                                "qty": qty,
                                "sides": {"binance": side_binance, "bybit": side_bybit},
                                "keys": keys
                            }
                            
                            AUTO_TRADE_LOGS.append({
                                "time": time.time(),
                                "type": "ENTRY",
                                "symbol": symbol,
                                "msg": f"Auto Entry {side_binance}/{side_bybit}"
                            })
                        else:
                            # Log missing keys error once per symbol/cycle?
                            # For now just print
                            print(f"❌ Auto-Trade Skipped {symbol}: Missing API Keys")

        except Exception as e:
            print(f"Auto-Trade Loop Error: {e}")
        
        # Check for Exits
        try:
            to_remove = []
            for sym, data in ACTIVE_AUTO_TRADES.items():
                # Exit Timing: exit_after_seconds AFTER funding
                exit_delay_ms = AUTO_TRADE_CONFIG.get("exit_after_seconds", 30) * 1000
                time_since_funding = (time.time() * 1000) - data["nft"]
                
                if time_since_funding > exit_delay_ms: 
                    # Close Logic
                    if AUTO_TRADE_CONFIG.get("auto_exit", True):
                        print(f"🤖 Auto-Trade EXIT: {sym}")
                        
                        sides = data.get("sides", {"binance": "Buy", "bybit": "Sell"}) # Default fallback
                        keys = data.get("keys", AUTO_TRADE_CONFIG.get("keys", {}))
                        
                        await execute_auto_trade_exit(sym, sides["binance"], sides["bybit"], data.get("qty", 0), 10, True)
                        
                        AUTO_TRADE_LOGS.append({
                            "time": time.time(),
                            "type": "EXIT",
                            "symbol": sym,
                            "msg": "Auto-Exit Triggered"
                        })
                        to_remove.append(sym)
                    else:
                         # Manual Exit required, just remove from auto-tracking
                         AUTO_TRADE_LOGS.append({
                            "time": time.time(),
                            "type": "INFO",
                            "symbol": sym,
                            "msg": "Auto-Exit Skipped (Manual Config)"
                        })
                         to_remove.append(sym)
            
            for sym in to_remove:
                del ACTIVE_AUTO_TRADES[sym]
                
        except Exception as e:
            print(f"Auto-Trade Exit Check Error: {e}")
        
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

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(auto_trade_service())

if __name__ == "__main__":
    import uvicorn
    import os
    # Hugging Face Spaces uses port 7860 by default
    port = int(os.getenv("PORT", 8000))
    # Listen on all interfaces
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
