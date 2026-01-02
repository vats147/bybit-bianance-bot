import { useState, useEffect, useMemo, useRef } from 'react';
import { ArbitrageModal } from "@/components/ArbitrageModal";
import { TradeSidePanel } from "./components/TradeSidePanel";
import { DemoTradingModal } from "./components/DemoTradingModal";
import { DashboardPage } from "./components/DashboardPage";
import { SettingsPage } from "./components/SettingsPage";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowUpDown, ExternalLink, RefreshCw, Send, AlertTriangle, LayoutDashboard, Settings, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

// --- API Helpers ---

const getBackendUrl = () => {
  const primary = localStorage.getItem("primary_backend_url") || "http://127.0.0.1:8000";
  const backup = localStorage.getItem("backup_backend_url");
  return { primary, backup };
};

const fetchRatesWithFailover = async () => {
  const { primary, backup } = getBackendUrl();
  const endpoint = "/api/rates";

  try {
    const res = await fetch(`${primary}${endpoint}`);
    if (!res.ok) throw new Error("Primary Failed");
    return await res.json();
  } catch (e) {
    if (backup) {
      try {
        console.warn("Primary API failed, trying backup...");
        const resBackup = await fetch(`${backup}${endpoint}`);
        return await resBackup.json();
      } catch (backupError) {
        console.error("Backup API also failed.");
        return { binance: {}, coinswitch: {} }; // Return empty structure on total failure
      }
    }
    return { binance: {}, coinswitch: {} };
  }
};

const BINANCE_API = "/api/binance/fapi/v1/premiumIndex";
// Using the all-pairs ticker endpoint for comprehensive data, targeting coinswitch.co directly
const COINSWITCH_API_URL = "https://coinswitch.co/trade/api/v2/24hr/all-pairs/ticker?exchange=coinswitchx";


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
    // 1. Sync Time if needed (lazy load) - kept for potential future use or if other endpoints need it, 
    // but simplified for now as this public endpoint doesn't strictly require it.
    if (serverTimeOffset === 0) {
      try {
        const timeRes = await fetch('/api/coinswitch/trade/api/v2/ping');
        if (timeRes.ok) {
          const timeData = await timeRes.json();
          // Check common timestamp keys
          const serverTime = timeData.time || timeData.server_time || timeData.timestamp || timeData.server_timestamp;
          if (serverTime) {
            serverTimeOffset = serverTime - Date.now();
          }
        }
      } catch (e) {
        console.warn("Time sync failed, using local time", e);
      }
    }

    // Use Proxy URL regarding vite.config.js to bypass CORS
    // https://coinswitch.co/... -> /api/coinswitch/...
    const proxyUrl = COINSWITCH_API_URL.replace('https://coinswitch.co', '/api/coinswitch');

    // Auth headers removed as this is a public endpoint
    const res = await fetch(proxyUrl);

    if (!res.ok) {
      console.error("CoinSwitch API Error", res.status, res.statusText);
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
      // Normalize symbol: "BTC/USDT" -> "BTC", "BTC/INR" -> "BTC"
      const rawSymbol = item.symbol || item.pair;
      if (rawSymbol) {
        let symbol = rawSymbol;
        // Remove /INR, INR, /USDT, USDT suffixes
        symbol = symbol.replace(/\/INR$/, "").replace(/INR$/, "").replace(/\/USDT$/, "").replace(/USDT$/, "");

        // Look for funding rate parameter
        // Might be camelCase or snake_case
        // If missing (spot market), default to 0
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
  const [currentTab, setCurrentTab] = useState("scanner"); // 'scanner', 'dashboard', 'settings'

  // Filters
  const [minSpread, setMinSpread] = useState(0); // Default 0% to show all pairs
  const [sortConfig, setSortConfig] = useState({ key: 'spread', direction: 'desc' });
  const [telegramConfig, setTelegramConfig] = useState({ token: '', chatId: '' });

  // Modal State
  const [selectedOpportunity, setSelectedOpportunity] = useState(null);

  // --- WebSocket Logic ---
  const [connectionStatus, setConnectionStatus] = useState({ binance: 'disconnected', coinswitch: 'disconnected' });

  // detailed map to keep store of latest data
  // symbol -> { binanceRate, bybitRate, ... }
  const dataRef = useRef({});

  const getBackendUrl = () => {
    const primary = localStorage.getItem("primary_backend_url") || "http://127.0.0.1:8000";
    const backup = localStorage.getItem("backup_backend_url");
    return { primary, backup };
  };

  const intervalMapRef = useRef({}); // Use Ref to avoid stale closure in setInterval
  const [metadataCount, setMetadataCount] = useState(0);

  useEffect(() => {
    // Fetch Interval Metadata with Retry/Polling
    const fetchMetadata = async () => {
      try {
        const { primary } = getBackendUrl();
        // Add cache busting
        const res = await fetch(`${primary}/api/metadata?_t=${Date.now()}`);
        if (res.ok) {
          const map = await res.json();
          intervalMapRef.current = map; // Update Ref
          setMetadataCount(Object.keys(map).length);
        }
      } catch (e) { console.error("Metadata fetch failed", e); }
    };

    fetchMetadata();
    const pollId = setInterval(fetchMetadata, 10000); // Poll every 10s to ensure we get data

    return () => clearInterval(pollId);
  }, []);

  const updateTableData = () => {
    // Allow rows if we have a symbol key (populated by initial fetch or WS)
    const merged = Object.values(dataRef.current)
      .map(item => {
        let spread = 0;
        let diff = 0;
        let apr = 0;
        const binanceRateVal = item.binanceRate !== undefined ? item.binanceRate : 0;
        const bybitRateVal = item.bybitRate !== undefined ? item.bybitRate : 0;
        const markPrice = item.markPrice || 0;
        const nextFundingTime = item.nextFundingTime || 0;

        const binanceRatePct = binanceRateVal * 100;
        const bybitRatePct = bybitRateVal * 100; // Treat as decimal like Binance

        // Only calculate spread if we have both
        if (item.binanceRate !== undefined && item.bybitRate !== undefined) {
          spread = Math.abs(binanceRatePct - bybitRatePct);
          diff = binanceRatePct - bybitRatePct;
          apr = spread * 3 * 365;
        }

        // Interval Lookup via Ref
        const intervals = intervalMapRef.current[item.symbol] || {};
        const bybitInt = intervals.bybit || 8;
        const binanceInt = intervals.binance || 8;

        return {
          ...item,
          nextFundingTime,
          spread,
          diff: diff || 0,
          apr,
          markPrice,
          binanceRate: binanceRateVal * 100,
          bybitRate: bybitRateVal * 100,
          binanceRateRaw: binanceRateVal,
          bybitRateRaw: bybitRateVal,
          intervals: { bybit: bybitInt, binance: binanceInt }
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
    // let bybitWS = null; // Placeholder

    const connectSockets = () => {
      // ... (existing WS connection logic)
      // 1. Binance
      binanceWS = new WebSocket('wss://fstream.binance.com/ws/!markPrice@arr@1s');
      binanceWS.onopen = () => setConnectionStatus(prev => ({ ...prev, binance: 'connected' }));
      binanceWS.onclose = () => setConnectionStatus(prev => ({ ...prev, binance: 'disconnected' }));
      binanceWS.onerror = (err) => { if (binanceWS && binanceWS.readyState !== WebSocket.CLOSED) { } };
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
      // 2. Bybit - No Public WebSocket known yet
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
        const { binance, bybit } = await fetchRatesWithFailover();

        const b = binance || {};
        const c = bybit || {};

        Object.keys(b).forEach(s => {
          if (!dataRef.current[s]) dataRef.current[s] = { symbol: s };
          dataRef.current[s].binanceRate = b[s].rate;
          dataRef.current[s].markPrice = b[s].markPrice;
          dataRef.current[s].nextFundingTime = b[s].nextFundingTime;
        });
        Object.keys(c).forEach(s => {
          if (!dataRef.current[s]) dataRef.current[s] = { symbol: s };
          dataRef.current[s].bybitRate = c[s].rate;
          if (c[s].markPrice) dataRef.current[s].markPrice = c[s].markPrice; // Use Bybit price if available? Mostly stick to Binance
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

    // One-time fetch for funding intervals
    const fetchIntervals = async () => {
      try {
        const res = await fetch('/api/binance/fapi/v1/exchangeInfo');
        const data = await res.json();
        if (data.symbols) {
          data.symbols.forEach(s => {
            // Binance doesn't always strictly send 'fundingIntervalHours'.
            // Some endpoints send 'contractType' etc. 
            // We can check 'fundingInterval' (in ms) if available, or just default to 8.
            // Usually it is not directly in symbol info for ALL endpoints, but let's try.
            // If not present, we will default to 8 in the modal.
            if (s.pair) {
              // Remove USDT
              let sym = s.pair.replace('USDT', '');
              if (!dataRef.current[sym]) dataRef.current[sym] = { symbol: sym };

              if (s.fundingIntervalHours) {
                dataRef.current[sym].fundingIntervalHours = s.fundingIntervalHours;
              } else {
                // Fallback: Default to 8h
                dataRef.current[sym].fundingIntervalHours = 8;
              }
            }
          });
        }
      } catch (e) { console.error("Interval fetch failed", e); }
    };
    fetchIntervals();

    return () => clearInterval(pollInterval);
  }, []);

  const [searchQuery, setSearchQuery] = useState("");

  // Testnet Filtering Logic
  const [testnetSymbols, setTestnetSymbols] = useState(new Set());
  const [isTestnet, setIsTestnet] = useState(false);

  useEffect(() => {
    // Check setting
    const checkSetting = () => {
      const val = localStorage.getItem("user_binance_testnet") !== "false"; // Default true if not set, or check logic
      // Actually SettingsPage default is true if null? 
      // In SettingsPage: useState(localStorage.getItem("user_binance_testnet") !== "false")
      // So let's match that.
      setIsTestnet(val);
    };
    checkSetting();
    // Listen for storage changes (if user changes settings in another tab)
    window.addEventListener('storage', checkSetting);

    // Also fetch the list
    const fetchTestnetList = async () => {
      try {
        const { primary } = getBackendUrl();
        const res = await fetch(`${primary}/api/binance/testnet-symbols`);
        if (res.ok) {
          const d = await res.json();
          setTestnetSymbols(new Set(d.symbols));
        }
      } catch (e) {
        console.error("Failed to fetch testnet symbols", e);
      }
    };
    fetchTestnetList();

    return () => window.removeEventListener('storage', checkSetting);
  }, []);

  // Update isTestnet when tab changes to 'scanner' in case user just came from Settings
  useEffect(() => {
    if (currentTab === 'scanner') {
      const val = localStorage.getItem("user_binance_testnet") !== "false";
      setIsTestnet(val);
    }
  }, [currentTab]);


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
    return sortableItems.filter(item => {
      const matchesSpread = item.spread >= parseFloat(minSpread);
      const matchesSearch = item.symbol.toLowerCase().includes(searchQuery.toLowerCase());

      // Filter by Testnet Availability if Testnet is ON
      // If we are in testnet mode, and the symbol is NOT in the allowed list, hide it.
      // But only if we have fetched the list (size > 0).
      let matchesTestnet = true;
      if (isTestnet && testnetSymbols.size > 0) {
        matchesTestnet = testnetSymbols.has(item.symbol);
      }

      return matchesSpread && matchesSearch && matchesTestnet;
    });
  }, [data, sortConfig, minSpread, searchQuery, isTestnet, testnetSymbols]);

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
        `💠 Bybit: ${item.bybitRate.toFixed(4)}%`
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
              Real-time funding rate arbitrage monitor
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Tab Navigation */}
            <div className="flex p-1 bg-muted rounded-lg">
              <Button
                variant={currentTab === 'scanner' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setCurrentTab('scanner')}
                className="gap-2"
              >
                <Activity className="h-4 w-4" /> Scanner
              </Button>
              <Button
                variant={currentTab === 'dashboard' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setCurrentTab('dashboard')}
                className="gap-2"
              >
                <LayoutDashboard className="h-4 w-4" /> Dashboard
              </Button>
              <Button
                variant={currentTab === 'settings' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setCurrentTab('settings')}
                className="gap-2"
              >
                <Settings className="h-4 w-4" /> Settings
              </Button>
            </div>
          </div>
        </div>

        {/* --- SCANNER TAB --- */}
        {currentTab === 'scanner' && (
          <>
            <div className="flex justify-between items-center bg-card p-2 rounded-lg border">
              <div className="flex items-center gap-2 ml-2">
                <span className="text-sm font-medium">Live Mode</span>
                <Switch checked={isLive} onCheckedChange={setIsLive} />
                <span className={`text-[10px] px-1 rounded border ml-2 ${metadataCount > 0 ? "bg-green-500/10 text-green-500 border-green-500/50" : "bg-red-500/10 text-red-500 border-red-500/50"}`}>
                  Meta: {metadataCount}
                </span>
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
                    BB: {connectionStatus.coinswitch === 'connected' ? 'LIVE' : 'OFF'}
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
                  <div className="flex items-center gap-2">
                    <span className="text-xs whitespace-nowrap w-20">Search</span>
                    <Input
                      type="text"
                      placeholder="Symbol..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
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
                    onChange={e => setTelegramConfig({ ...telegramConfig, token: e.target.value })}
                    className="bg-background"
                  />
                  <Input
                    placeholder="Chat ID"
                    value={telegramConfig.chatId}
                    onChange={e => setTelegramConfig({ ...telegramConfig, chatId: e.target.value })}
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
                      <TableHead className="min-w-[120px]">Funding / Intervals</TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-primary transition-colors hover:bg-muted/50" onClick={() => requestSort('bybitRateRaw')}>
                        Bybit (Int.) {sortConfig.key === 'bybitRateRaw' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-primary transition-colors hover:bg-muted/50" onClick={() => requestSort('binanceRateRaw')}>
                        Binance (Int.) {sortConfig.key === 'binanceRateRaw' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-primary transition-colors hover:bg-muted/50" onClick={() => requestSort('spread')}>
                        Spread {sortConfig.key === 'spread' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-primary transition-colors hover:bg-muted/50" onClick={() => requestSort('apr')}>
                        APR {sortConfig.key === 'apr' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead className="text-right">Action</TableHead>
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
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {(() => {
                              if (!item.nextFundingTime) return '-';
                              const diff = item.nextFundingTime - Date.now();
                              if (diff <= 0) return 'Now';
                              const h = Math.floor(diff / (1000 * 60 * 60));
                              const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

                              return (
                                <div className="flex flex-col">
                                  <span className="text-xs">{h}h {m}m</span>
                                  <span className="text-[10px] text-muted-foreground font-semibold">
                                    Bin: {item.intervals?.binance}h / Byb: {item.intervals?.bybit}h
                                  </span>
                                </div>
                              );
                            })()}
                          </TableCell>
                          <TableCell className={cn("font-medium", item.binanceRate > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                            {item.binanceRate.toFixed(4)}%
                          </TableCell>
                          <TableCell className={cn("font-medium", item.bybitRate > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                            {item.bybitRate ? item.bybitRate.toFixed(4) : '0.0000'}%
                          </TableCell>
                          <TableCell className="font-mono font-bold text-blue-600 dark:text-blue-400">
                            {item.spread.toFixed(4)}%
                          </TableCell>
                          <TableCell className={cn("font-medium", item.diff > 0 ? "text-green-600 dark:text-green-400" : item.diff < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                            {item.diff.toFixed(4)}%
                          </TableCell>
                          <TableCell className="font-medium">
                            {item.apr.toFixed(2)}%
                          </TableCell>
                          <TableCell className="text-right sticky right-0 z-10 bg-background shadow-[-1px_0_5px_rgba(0,0,0,0.05)] border-l">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                className="h-8 bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 shadow-sm border border-blue-500/50"
                                onClick={() => setSelectedOpportunity(item)}
                              >
                                Trade
                              </Button>
                              <Button size="icon" variant="outline" className="h-8 w-8 p-0 border-yellow-500/50 hover:bg-yellow-500/10" asChild title="Binance">
                                <a href={`https://www.binance.com/en/futures/${item.symbol}USDT`} target="_blank" rel="noopener noreferrer">
                                  <img src="https://bin.bnbstatic.com/static/images/common/favicon.ico" alt="Binance" className="w-4 h-4" />
                                </a>
                              </Button>
                              <Button size="icon" variant="outline" className="h-8 w-8 p-0 border-purple-500/50 hover:bg-purple-500/10" asChild title="Bybit">
                                <a href={`https://www.bybit.com/trade/usdt/${item.symbol}USDT`} target="_blank" rel="noopener noreferrer">
                                  <img src="https://www.bybit.com/favicon.ico" alt="Bybit" className="w-4 h-4" />
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


// ... existing imports
            import {TradeSidePanel} from "./components/TradeSidePanel";

            // ... existing code ...

            {/* Modal - Replaced/Augmented with Side Panel */}
            {/* Keeping ArbitrageModal logic if needed but user requested Trade to open Side Panel */}

            <TradeSidePanel
              isOpen={!!selectedOpportunity}
              onClose={() => setSelectedOpportunity(null)}
              data={selectedOpportunity}
            />

            {/* Temporarily commented out old modal for direct replacement as per request */}
            {/* <ArbitrageModal
              isOpen={!!selectedOpportunity}
              onClose={() => setSelectedOpportunity(null)}
              data={selectedOpportunity}
            /> */}
          </>
        )}

        {/* --- DASHBOARD TAB --- */}
        {currentTab === 'dashboard' && <DashboardPage />}

        {/* --- SETTINGS TAB --- */}
        {currentTab === 'settings' && <SettingsPage />}

      </div>
    </div >
  );
}

export default App;

