import { useState, useEffect, useMemo, useRef } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowUpDown, ExternalLink, RefreshCw, Send, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// --- API Helpers ---

import CryptoJS from 'crypto-js';

// --- API Helpers ---

const BINANCE_API = "/api/binance/fapi/v1/premiumIndex";
// Using the all-pairs ticker endpoint for comprehensive data, targeting coinswitch.co directly
const COINSWITCH_API_URL = "https://coinswitch.co/trade/api/v2/24hr/all-pairs/ticker?exchange=coinswitchx"; 

const COINSWITCH_API_KEY = "327aea81b9f9bde5830049fa5636af4d8e3057d2739a89b3aef911c49d875b13";
const COINSWITCH_SECRET_KEY = "7d33e755773b872e39d574ffb61137375a0abd0e1ce8878057fdc94b11bdfe61";

const generateSignature = (method, url, body, epoch) => {
  // Extract path and query from full URL
  const urlObj = new URL(url);
  const path = urlObj.pathname + urlObj.search;
  
  // Signature payload: epoch + method + path + body
  // Source: <epoch_time><HTTP_method><url_path_with_query_params><request_body>
  const payload = epoch + method + path + (body ? JSON.stringify(body) : "");
  
  const signature = CryptoJS.HmacSHA256(payload, COINSWITCH_SECRET_KEY).toString(CryptoJS.enc.Hex);
  return signature;
};

const fetchBinanceRates = async () => {
  try {
    const res = await fetch(BINANCE_API);
    const data = await res.json();
    const rates = {};
    data.forEach(item => {
      if (item.symbol.endsWith('USDT')) {
        const symbol = item.symbol.replace('USDT', '');
        rates[symbol] = {
          rate: parseFloat(item.lastFundingRate),
          markPrice: parseFloat(item.markPrice),
          nextFundingTime: item.nextFundingTime
        };
      }
    });
    return rates;
  } catch (error) {
    console.error("Binance Fetch Error", error);
    return {};
  }
};


let serverTimeOffset = 0;

const fetchCoinSwitchRates = async () => {
  try {
    // 1. Sync Time if needed (lazy load)
    if (serverTimeOffset === 0) {
        try {
            const timeRes = await fetch('/api/coinswitch/trade/api/v2/ping');
            if (timeRes.ok) {
                const timeData = await timeRes.json();
                // Check common timestamp keys
                const serverTime = timeData.time || timeData.server_time || timeData.timestamp || timeData.server_timestamp;
                if (serverTime) {
                    serverTimeOffset = serverTime - Date.now();
                    console.log("Time Sync Offset:", serverTimeOffset);
                }
            }
        } catch (e) {
            console.warn("Time sync failed, using local time", e);
        }
    }

    const method = "GET";
    // Apply offset to match server time
    const epoch = (Date.now() + serverTimeOffset).toString();
    const signature = generateSignature(method, COINSWITCH_API_URL, null, epoch);

    const headers = {
        "Content-Type": "application/json",
        "X-AUTH-KEY": COINSWITCH_API_KEY,
        "X-AUTH-SIGNATURE": signature,
        "X-AUTH-EPOCH": epoch
    };

    // Use Proxy URL regarding vite.config.js to bypass CORS
    // https://coinswitch.co/... -> /api/coinswitch/...
    const proxyUrl = COINSWITCH_API_URL.replace('https://coinswitch.co', '/api/coinswitch');
    
    const res = await fetch(proxyUrl, {
        method: method,
        headers: headers
    });
    
    if (!res.ok) {
        console.error("CoinSwitch API Error", res.status, res.statusText);
        // If 401, maybe force re-sync next time?
        if (res.status === 401) serverTimeOffset = 0;
        return {};
    }

    const data = await res.json();
    const rates = {};
    
    // Parse CoinSwitch structure
    // Expecting: { data: { "BTC/USDT": { ... }, ... } } OR { data: [ { symbol: ... } ] }
    // "all-pairs" usually returns a map or list.
    // We'll handle both map and list to be safe.
    
    let items = [];
    if (Array.isArray(data.data)) {
        items = data.data;
    } else if (typeof data.data === 'object' && data.data !== null) {
        // If it's a map (Symbol -> Data), convert to array
        items = Object.entries(data.data).map(([k, v]) => ({ ...v, symbol: k }));
    }
    
    items.forEach(item => {
        // Normalize symbol: "BTC/USDT" -> "BTC"
        const rawSymbol = item.symbol || item.pair; 
        if (rawSymbol && rawSymbol.includes('USDT')) {
             const symbol = rawSymbol.replace('/USDT', '').replace('USDT', '');
             
             // Look for funding rate parameter
             // Might be camelCase or snake_case
             const rate = item.funding_rate || item.lastFundingRate || 0;
             
             rates[symbol] = {
                 rate: parseFloat(rate),
                 markPrice: parseFloat(item.mark_price || item.last_price || 0)
             };
        }
    });

    return rates;
  } catch (error) {
    console.error("CoinSwitch Fetch Error", error);
    return {};
  }
};


// --- Main Component ---

function App() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  
  // Filters
  const [minSpread, setMinSpread] = useState(0.01); // Default 0.01%
  const [sortConfig, setSortConfig] = useState({ key: 'spread', direction: 'desc' });
  const [telegramConfig, setTelegramConfig] = useState({ token: '', chatId: '' });

  // --- WebSocket Logic ---
  const [connectionStatus, setConnectionStatus] = useState({ binance: 'disconnected', coinswitch: 'disconnected' });

  // detailed map to keep store of latest data
  // symbol -> { binanceRate, coinSwitchRate, ... }
  const dataRef = useRef({});

  const updateTableData = () => {
     // Allow rows if we have a symbol key (populated by initial fetch or WS)
     const merged = Object.values(dataRef.current)
        .map(item => {
        let spread = 0;
        let apr = 0;
        const binanceRateVal = item.binanceRate !== undefined ? item.binanceRate : 0;
        const coinSwitchRateVal = item.coinSwitchRate !== undefined ? item.coinSwitchRate : 0;
        const markPrice = item.markPrice || 0;

        // Calculate spread if we have rates (or default to 0)
        // Ensure we display rows even if one side is missing to help debug 'missing data'
        
        const binanceRatePct = binanceRateVal * 100;
        const coinSwitchRatePct = coinSwitchRateVal * 100; // Treat as decimal like Binance
        
        // Only calculate spread if we have both
        if (item.binanceRate !== undefined && item.coinSwitchRate !== undefined) {
             spread = Math.abs(binanceRatePct - coinSwitchRatePct);
             apr = spread * 3 * 365;
        }
        
        return { 
            ...item, 
            spread, 
            apr,
            markPrice,
            binanceRate: binanceRateVal * 100, 
            coinSwitchRate: coinSwitchRateVal * 100, 
            binanceRateRaw: binanceRateVal, 
            coinSwitchRateRaw: coinSwitchRateVal 
        };
     })
     // Filter out incomplete rows ONLY if user wants strict mode (optional), 
     // but for now let's just filter out completely empty ones
     .filter(item => item.symbol);
     
     setData(merged);
     setLastUpdated(new Date());
     checkAndSendAlerts(merged);
  };
   // ... keep existing useEffects ...

  useEffect(() => {
    // Throttled UI updater
    const interval = setInterval(updateTableData, 1000); 
    return () => clearInterval(interval);
  }, []);

  // --- WebSocket Logic with Cleanup Safety ---
  const [isLive, setIsLive] = useState(false); // Default OFF
  
  useEffect(() => {
    if (!isLive) return; // Don't connect if Live Mode is OFF

    let binanceWS = null;
    // let coinSwitchWS = null; // Placeholder

    const connectSockets = () => {
        // ... (existing WS connection logic)
        // 1. Binance
        binanceWS = new WebSocket('wss://fstream.binance.com/ws/!markPrice@arr@1s');
        binanceWS.onopen = () => setConnectionStatus(prev => ({ ...prev, binance: 'connected' }));
        binanceWS.onclose = () => setConnectionStatus(prev => ({ ...prev, binance: 'disconnected' }));
        binanceWS.onerror = (err) => { if (binanceWS && binanceWS.readyState !== WebSocket.CLOSED) {} };
        binanceWS.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (Array.isArray(msg)) {
                    msg.forEach(update => {
                        if (update.s && update.s.endsWith('USDT')) {
                            const symbol = update.s.replace('USDT', '');
                            if (!dataRef.current[symbol]) { dataRef.current[symbol] = { symbol }; }
                            dataRef.current[symbol].binanceRate = parseFloat(update.r);
                            if (update.p) dataRef.current[symbol].markPrice = parseFloat(update.p);
                        }
                    });
                }
            } catch (e) { }
        };
    // 2. CoinSwitch - No Public WebSocket known yet
    // Placeholder for future implementation
    };

    connectSockets();

    return () => {
        if (binanceWS) { binanceWS.close(); }
        setConnectionStatus({ binance: 'disconnected', coinswitch: 'disconnected' });
    };
  }, [isLive]); // Re-run when toggle changes



  // Fetch initial snapshot & Polling Backup
  useEffect(() => {
     const fetchData = async () => {
        // Don't show global loading spinner on background refreshes
        // setLoading(true); 
        try {
            const [b, c] = await Promise.all([fetchBinanceRates(), fetchCoinSwitchRates()]);
            
            Object.keys(b).forEach(s => {
                if(!dataRef.current[s]) dataRef.current[s] = { symbol: s };
                dataRef.current[s].binanceRate = b[s].rate;
                dataRef.current[s].markPrice = b[s].markPrice;
            });
            Object.keys(c).forEach(s => {
                if(!dataRef.current[s]) dataRef.current[s] = { symbol: s };
                dataRef.current[s].coinSwitchRate = c[s].rate;
                if (c[s].markPrice) dataRef.current[s].markPrice = c[s].markPrice; // Use CS price if available? Mostly stick to Binance
            });
            
            // If this was the first load, turn off loading
            setLoading(false);
            // Trigger table update immediately after fetch
            updateTableData();
        } catch (err) {
            console.error("Polling Error", err);
        }
     };

     fetchData(); // Initial run
     const pollInterval = setInterval(fetchData, 10000); // Poll every 10s as backup
     
     return () => clearInterval(pollInterval);
  }, []);

  // Sorting Logic
  const sortedData = useMemo(() => {
    let sortableItems = [...data];
    if (sortConfig.key) {
      sortableItems.sort((a, b) => {
        if (a[sortConfig.key] < b[sortConfig.key]) {
          return sortConfig.direction === 'ascending' ? -1 : 1;
        }
        if (a[sortConfig.key] > b[sortConfig.key]) {
          return sortConfig.direction === 'ascending' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems.filter(item => item.spread >= parseFloat(minSpread));
  }, [data, sortConfig, minSpread]);

  const requestSort = (key) => {
    let direction = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  // Telegram Alert Logic
  const checkAndSendAlerts = async (currentData) => {
    if (!telegramConfig.token || !telegramConfig.chatId) return;

    // Get top 5 opportunities
    const top5 = [...currentData]
      .sort((a, b) => b.spread - a.spread)
      .slice(0, 5)
      .filter(item => item.spread > 0.1); // Only alert if meaningful

    if (top5.length === 0) return;

    const message = `🚨 *Arbitrage Opportunity Alert* 🚨\n\n` + 
      top5.map(item => 
        `🪙 *${item.symbol}*\n` +
        `📉 Spread: ${item.spread.toFixed(4)}%\n` +
        `🔶 Binance: ${item.binanceRate.toFixed(4)}%\n` +
        `💠 CoinSwitch: ${item.coinSwitchRate.toFixed(4)}%`
      ).join('\n\n');

    try {
      await fetch(`https://api.telegram.org/bot${telegramConfig.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramConfig.chatId,
          text: message,
          parse_mode: 'Markdown'
        })
      });
      console.log("Telegram alert sent");
    } catch (e) {
      console.error("Failed to send Telegram alert", e);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
              Funding Arb Bot
            </h1>
            <p className="text-muted-foreground mt-1">
              Real-time funding rate arbitrage monitor (Binance vs CoinSwitch)
            </p>
          </div>
          
            <div className="flex items-center gap-2 mr-4">
               <span className="text-sm font-medium">Live Mode</span>
               <Switch checked={isLive} onCheckedChange={setIsLive} />
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground mr-2">
                Last update: {lastUpdated ? lastUpdated.toLocaleTimeString() : '...'}
              </span>
            <div className="flex gap-1 mr-2">
                 <span className={cn("text-[10px] px-1 rounded border", connectionStatus.binance === 'connected' ? "bg-green-500/20 border-green-500 text-green-500" : "bg-red-500/20 border-red-500 text-red-500")}>
                    BN: {connectionStatus.binance === 'connected' ? 'LIVE' : 'OFF'}
                 </span>
                 <span className={cn("text-[10px] px-1 rounded border", connectionStatus.coinswitch === 'connected' ? "bg-green-500/20 border-green-500 text-green-500" : "bg-red-500/20 border-red-500 text-red-500")}>
                    CS: {connectionStatus.coinswitch === 'connected' ? 'LIVE' : 'OFF'}
                 </span>
            </div>
            <Button size="sm" variant="outline" onClick={updateTableData} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Controls & Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Market Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.length}</div>
              <p className="text-xs text-muted-foreground">Total Pairs Monitored</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Opportunities</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">
                {sortedData.length}
              </div>
              <p className="text-xs text-muted-foreground">Pairs &gt; {minSpread}% Spread</p>
            </CardContent>
          </Card>

          <Card>
             <CardHeader className="pb-2">
               <CardTitle className="text-sm font-medium">Settings</CardTitle>
             </CardHeader>
             <CardContent className="space-y-2">
               <div className="flex items-center gap-2">
                 <span className="text-xs whitespace-nowrap w-20">Min Spread %</span>
                 <Input 
                   type="number" 
                   step="0.01" 
                   value={minSpread} 
                   onChange={(e) => setMinSpread(e.target.value)}
                   className="h-8"
                 />
               </div>
             </CardContent>
          </Card>
        </div>
        
        {/* Telegram Config */}
         <Card className="border-blue-500/20 bg-blue-500/5">
             <CardHeader className="py-4">
               <CardTitle className="text-sm font-medium flex items-center gap-2">
                 <Send className="h-4 w-4" /> Telegram Alert Configuration
               </CardTitle>
             </CardHeader>
             <CardContent className="pb-4">
               <div className="flex flex-col md:flex-row gap-4">
                 <Input 
                   placeholder="Bot Token" 
                   value={telegramConfig.token}
                   onChange={e => setTelegramConfig({...telegramConfig, token: e.target.value})}
                   className="bg-background"
                 />
                 <Input 
                   placeholder="Chat ID" 
                   value={telegramConfig.chatId}
                   onChange={e => setTelegramConfig({...telegramConfig, chatId: e.target.value})}
                   className="bg-background"
                 />
                 <Button variant="secondary" onClick={() => checkAndSendAlerts(data)}>
                   Test Alert
                 </Button>
               </div>
             </CardContent>
          </Card>


        {/* Main Table */}
        <Card className="overflow-hidden border-t-4 border-t-primary">
          <div className="p-1 overflow-x-auto relative">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px] font-bold text-primary sticky left-0 z-20 bg-background shadow-[1px_0_5px_rgba(0,0,0,0.1)]">Symbol</TableHead>
                  <TableHead className="min-w-[100px]">Mark Price</TableHead>
                  <TableHead onClick={() => requestSort('binanceRate')} className="cursor-pointer hover:text-primary transition-colors whitespace-nowrap min-w-[120px]">
                     Binance Rate % <ArrowUpDown className="inline h-3 w-3 ml-1"/>
                  </TableHead>
                  <TableHead onClick={() => requestSort('coinSwitchRate')} className="cursor-pointer hover:text-primary transition-colors whitespace-nowrap min-w-[120px]">
                     CoinSwitch Rate % <ArrowUpDown className="inline h-3 w-3 ml-1"/>
                  </TableHead>
                  <TableHead onClick={() => requestSort('spread')} className="cursor-pointer hover:text-primary transition-colors whitespace-nowrap min-w-[120px]">
                     Spread % <ArrowUpDown className="inline h-3 w-3 ml-1"/>
                  </TableHead>
                   <TableHead onClick={() => requestSort('apr')} className="cursor-pointer hover:text-primary transition-colors whitespace-nowrap min-w-[120px]">
                     Est. 3-Day APR %
                  </TableHead>
                  <TableHead className="text-right sticky right-0 z-20 bg-background shadow-[-1px_0_5px_rgba(0,0,0,0.1)]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center">
                      <div className="flex justify-center items-center gap-2">
                        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                        <span className="text-muted-foreground">Fetching market data...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : sortedData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      No arbitrage opportunities found matching criteria.
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedData.map((item) => (
                    <TableRow key={item.symbol} className="hover:bg-muted/30">
                      <TableCell className="font-bold sticky left-0 z-10 bg-background shadow-[1px_0_5px_rgba(0,0,0,0.05)] border-r">
                        <div className="flex items-center gap-2">
                          <img 
                            src={`https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${item.symbol.toLowerCase()}.png`}
                            alt={item.symbol}
                            className="w-6 h-6 rounded-full bg-white"
                            onError={(e) => {
                              // Try generic Binance-like URL logic or fallback
                              e.target.onerror = null; 
                              e.target.src = `https://ui-avatars.com/api/?name=${item.symbol}&background=F3BA2F&color=fff&size=64&font-size=0.4&bold=true`; // Binance yellow fallback
                            }}
                          />
                        <span className="text-foreground">{item.symbol}</span>
                        </div>
                      </TableCell>
                       <TableCell className="font-mono text-muted-foreground">
                        ${item.markPrice ? item.markPrice.toFixed(4) : '0.0000'}
                      </TableCell>
                      <TableCell className={cn("font-medium", item.binanceRate > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                        {item.binanceRate.toFixed(4)}%
                      </TableCell>
                      <TableCell className={cn("font-medium", item.coinSwitchRate > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                         {item.coinSwitchRate ? item.coinSwitchRate.toFixed(4) : '0.0000'}%
                      </TableCell>
                      <TableCell className="font-mono font-bold text-blue-600 dark:text-blue-400">
                         {item.spread.toFixed(4)}%
                      </TableCell>
                       <TableCell className="font-medium">
                         {item.apr.toFixed(2)}%
                      </TableCell>
                      <TableCell className="text-right sticky right-0 z-10 bg-background shadow-[-1px_0_5px_rgba(0,0,0,0.05)] border-l">
                        <div className="flex justify-end gap-2">
                          <Button size="icon" variant="outline" className="h-8 w-8 p-0 border-yellow-500/50 hover:bg-yellow-500/10" asChild title="Binance"> 
                             <a href={`https://www.binance.com/en/futures/${item.symbol}USDT`} target="_blank" rel="noopener noreferrer">
                               <img src="https://bin.bnbstatic.com/static/images/common/favicon.ico" alt="Binance" className="w-4 h-4" />
                             </a>
                          </Button>
                          <Button size="icon" variant="outline" className="h-8 w-8 p-0 border-purple-500/50 hover:bg-purple-500/10" asChild title="CoinSwitch"> 
                             <a href={`https://coinswitch.co/pro/spot/${item.symbol}-USDT`} target="_blank" rel="noopener noreferrer">
                               <img src="https://coinswitch.co/favicon.ico" alt="CS" className="w-4 h-4" />
                             </a>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

      </div>
    </div>
  );
}

export default App;
