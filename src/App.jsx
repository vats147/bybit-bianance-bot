import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
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
import { ArrowUpDown, ExternalLink, RefreshCw, Settings, AlertTriangle, LayoutDashboard, Activity, Zap } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

// --- API Helpers ---

// --- API Helpers ---

const getBackendUrl = () => {
  const primary = localStorage.getItem("primary_backend_url") || "https://bianance-bot.onrender.com";
  const backup = localStorage.getItem("backup_backend_url");
  return { primary, backup };
};

const fetchRatesWithFailover = async (isLive) => {
  const { primary, backup } = getBackendUrl();
  const endpoint = `/api/rates?is_live=${isLive ? 'true' : 'false'}`;

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
        return { binance: {}, bybit: {} };
      }
    }
    return { binance: {}, bybit: {} };
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
  const toast = useToast();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [currentTab, setCurrentTab] = useState("scanner"); // 'scanner', 'dashboard', 'settings'

  // Filters
  const [minSpread, setMinSpread] = useState(0); // Default 0% to show all pairs
  const [showHighDiff, setShowHighDiff] = useState(false); // Filter > 0.5% Diff
  const [sortConfig, setSortConfig] = useState({ key: 'apr', direction: 'desc' });

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // Telegram config - now loads from localStorage (configured in Settings)
  const [telegramConfig, setTelegramConfig] = useState({ token: '', chatId: '' });

  // Auto-trade symbols state
  const [autoTradeSymbols, setAutoTradeSymbols] = useState(new Set());

  // Load telegram config and auto-trade symbols from localStorage
  useEffect(() => {
    // Enforcement: Force reset primary backend URL to Render (ONLY in production)
    const targetUrl = "https://bianance-bot.onrender.com";
    const currentPrimary = localStorage.getItem("primary_backend_url");
    const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

    if (!isLocal && currentPrimary !== targetUrl) {
      console.log(`Enforcing backend URL: ${currentPrimary} -> ${targetUrl}`);
      localStorage.setItem("primary_backend_url", targetUrl);
    }

    const savedToken = localStorage.getItem("telegram_token") || '';
    const savedChatId = localStorage.getItem("telegram_chat_id") || '';
    setTelegramConfig({ token: savedToken, chatId: savedChatId });

    const savedAutoTrade = localStorage.getItem("auto_trade_symbols");
    if (savedAutoTrade) {
      try {
        setAutoTradeSymbols(new Set(JSON.parse(savedAutoTrade)));
      } catch (e) {
        console.error("Failed to parse auto_trade_symbols", e);
      }
    }
  }, []);

  const toggleAutoTrade = (symbol) => {
    setAutoTradeSymbols(prev => {
      const newSet = new Set(prev);
      if (newSet.has(symbol)) {
        newSet.delete(symbol);
      } else {
        newSet.add(symbol);
      }
      localStorage.setItem("auto_trade_symbols", JSON.stringify([...newSet]));
      return newSet;
    });
  };

  // Modal State
  const [selectedOpportunity, setSelectedOpportunity] = useState(null);

  // --- WebSocket Logic ---
  const [connectionStatus, setConnectionStatus] = useState({ binance: 'disconnected', coinswitch: 'disconnected' });

  // detailed map to keep store of latest data
  // symbol -> { binanceRate, bybitRate, ... }
  const dataRef = useRef({});
  const alertedPairsRef = useRef(new Map()); // symbol -> lastFundingTimeAlerted

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
    const pollId = setInterval(fetchMetadata, 30000); // Poll every 30s (was 10s)

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

          // Interval Lookup via Ref (fallback)
          const intervals = intervalMapRef.current[item.symbol] || {};
          const bybitInt = item.fundingIntervalHours || intervals.bybit || 8;
          const binanceInt = intervals.binance || 8;

          // Use the higher frequency (smaller interval) for APR projection
          // This is a conservative estimate of the opportunities per day
          const freqPerDay = 24 / Math.min(bybitInt, binanceInt);
          apr = spread * freqPerDay * 365;
        }

        // Already calculated above in apr block, but for the return structure:
        const intervals = intervalMapRef.current[item.symbol] || {};
        const bybitInt = item.fundingIntervalHours || intervals.bybit || null;
        const binanceInt = intervals.binance || null; // Binance currently only in metadata

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

    // Limit to top 200 symbols to avoid memory issues
    const topSymbols = merged
      .sort((a, b) => Math.abs(b.spread) - Math.abs(a.spread))
      .slice(0, 200);

    setData(topSymbols);
    setLastUpdated(new Date());
    // Only send alerts if we have meaningful data
    if (topSymbols.length > 0 && topSymbols[0].spread > 0.01) {
      checkAndSendAlerts(topSymbols);
    }
  };
  // ... keep existing useEffects ...

  useEffect(() => {
    // Throttled UI updater - reduced from 1s to 3s for performance
    const interval = setInterval(updateTableData, 3000);
    return () => clearInterval(interval);
  }, []);

  // --- WebSocket Logic with Cleanup Safety ---
  const [isLive, setIsLive] = useState(false); // Default OFF

  useEffect(() => {
    // We now rely on Backend WebSocket (starting/stopping via manageWS)
    // for both Binance and Bybit to ensure stability and alerts.
    // Direct frontend WS is disabled to save browser resources.
    return () => {
      setConnectionStatus({ binance: 'disconnected', coinswitch: 'disconnected' });
    };
  }, [isLive]);



  // Toast on Live Mode Change & Trigger WebSocket
  useEffect(() => {
    // RESET STALE DATA: Clear the data cache when switching modes
    dataRef.current = {};
    setData([]);
    console.log("🔄 Mode switched: Resetting symbol data cache.");

    const mode = isLive ? "LIVE" : "TESTNET";
    const { primary } = getBackendUrl();

    // Start/Stop WebSocket based on mode
    const manageWS = async () => {
      try {
        const fetchMode = isLive ? "true" : "false";
        await fetch(`${primary}/api/ws/start?is_live=${fetchMode}`, { method: "POST" });

        // Polling loop to update connection UI from backend status
        const updateStatus = async () => {
          try {
            const statusRes = await fetch(`${primary}/api/ws/status`);
            const status = await statusRes.json();

            // New structure: { binance: { running, symbols_count }, bybit: { running, symbols_count } }
            setConnectionStatus({
              binance: status.binance?.symbols_count > 0 ? 'connected' : 'disconnected',
              coinswitch: status.bybit?.symbols_count > 0 ? 'connected' : 'disconnected'
            });

            if (status.binance?.symbols_count > 0 || status.bybit?.symbols_count > 0) {
              console.log(`📡 WS Active: BN(${status.binance?.symbols_count}) BB(${status.bybit?.symbols_count})`);
            }
          } catch (e) { console.error("Status check failed", e); }
        };

        updateStatus();
        const statusPoll = setInterval(updateStatus, 10000);
        return () => clearInterval(statusPoll);

      } catch (e) {
        toast.error(`Mode switch error: ${e.message}`);
      }
    };

    const cleanup = manageWS();
    return () => { if (typeof cleanup === 'function') cleanup(); };
  }, [isLive]);

  // Fetch initial snapshot & Polling Backup
  useEffect(() => {
    const fetchData = async () => {
      // Don't show global loading spinner on background refreshes
      // setLoading(true); 
      try {
        const { binance, bybit } = await fetchRatesWithFailover(isLive);

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

          // Store both rates
          dataRef.current[s].bybitRate = c[s].rate;

          // If Binance didn't have a markprice but bybit does, use it
          if (c[s].markPrice && !dataRef.current[s].markPrice) {
            dataRef.current[s].markPrice = c[s].markPrice;
          }

          // Prefer Bybit funding time if Binance is missing or Bybit is more recent (earlier)
          const bnNFT = dataRef.current[s].nextFundingTime || Infinity;
          const bbNFT = c[s].nextFundingTime || Infinity;

          if (bbNFT < bnNFT && bbNFT !== Infinity) {
            dataRef.current[s].nextFundingTime = bbNFT;
          } else if (bnNFT !== Infinity) {
            dataRef.current[s].nextFundingTime = bnNFT;
          }

          if (c[s].fundingIntervalHours) {
            dataRef.current[s].fundingIntervalHours = c[s].fundingIntervalHours;
          }
        });

        // If this was the first load, turn off loading
        setLoading(false);
        // Trigger table update immediately after fetch
        updateTableData();

        // --- TELEGRAM ALERT MONITORING ---
        const threshold = parseFloat(localStorage.getItem("alert_threshold") || "0.5");
        const leadTimeMs = parseInt(localStorage.getItem("alert_lead_time") || "10") * 60000;
        const tgToken = localStorage.getItem("telegram_token");
        const tgChatId = localStorage.getItem("telegram_chat_id");
        const { primary } = getBackendUrl();

        if (tgToken && tgChatId) {
          Object.keys(dataRef.current).forEach(symbol => {
            const item = dataRef.current[symbol];
            if (item.binanceRate !== undefined && item.bybitRate !== undefined && item.nextFundingTime) {
              const diff = Math.abs(item.binanceRate - item.bybitRate); // Both are already in % (e.g. 0.01)
              const timeToFunding = item.nextFundingTime - Date.now();

              if (diff >= threshold && timeToFunding > 0 && timeToFunding <= leadTimeMs) {
                const lastAlertWindow = alertedPairsRef.current.get(symbol);
                if (lastAlertWindow !== item.nextFundingTime) {
                  alertedPairsRef.current.set(symbol, item.nextFundingTime);

                  // Send Alert
                  fetch(`${primary}/api/telegram/send`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      token: tgToken,
                      chatId: tgChatId,
                      message: `🚨 *High Funding Alert: ${symbol}*\n\n` +
                        `*Difference:* ${diff.toFixed(4)}%\n` +
                        `*Binance:* ${item.binanceRate.toFixed(4)}%\n` +
                        `*Bybit:* ${item.bybitRate.toFixed(4)}%\n` +
                        `*Time to Funding:* ${Math.floor(timeToFunding / 60000)}m ${Math.floor((timeToFunding % 60000) / 1000)}s`,
                      buttonText: `Trade ${symbol} on Bybit`,
                      buttonUrl: `https://www.bybit.com/trade/usdt/${symbol}USDT`
                    })
                  }).catch(e => console.error("Telegram Alert Failed", e));
                }
              }
            }
          });
        }
      } catch (err) {
        console.error("Polling Error", err);
      }
    };

    fetchData(); // Initial run
    const pollInterval = setInterval(fetchData, 15000); // Poll every 15s (was 10s)

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
  }, [isLive]);

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

      // High Diff Filter (> 0.5%)
      const matchesHighDiff = showHighDiff ? Math.abs(item.diff) > 0.5 : true;

      // Filter by Testnet Availability if Testnet is ON
      // If we are in testnet mode, and the symbol is NOT in the allowed list, hide it.
      // But only if we have fetched the list (size > 0).
      let matchesTestnet = true;
      if (isTestnet && testnetSymbols.size > 0) {
        matchesTestnet = testnetSymbols.has(item.symbol);
      }

      return matchesSpread && matchesSearch && matchesTestnet && matchesHighDiff;
    });
  }, [data, sortConfig, minSpread, searchQuery, isTestnet, testnetSymbols, showHighDiff]);

  // Pagination Logic
  const totalPages = Math.ceil(sortedData.length / itemsPerPage);
  const paginatedData = sortedData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

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

  const handleCloseAllTrades = async () => {
    if (!confirm("⚠️ DANGER: This will close ALL open positions on Bybit and Binance immediately.\n\nAre you sure you want to proceed?")) return;

    const bybitKey = localStorage.getItem("user_bybit_key");
    const bybitSecret = localStorage.getItem("user_bybit_secret");
    const binanceKey = localStorage.getItem("user_binance_key");
    const binanceSecret = localStorage.getItem("user_binance_secret");
    const backendUrl = localStorage.getItem("primary_backend_url") || "http://127.0.0.1:8000";

    try {
      const res = await fetch(`${backendUrl}/api/close-all-positions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Bybit-Key": bybitKey || "",
          "X-User-Bybit-Secret": bybitSecret || "",
          "X-User-Binance-Key": binanceKey || "",
          "X-User-Binance-Secret": binanceSecret || ""
        }
      });
      const data = await res.json();

      let msg = "Close All Result:\n";
      if (data.bybit && data.bybit.length) msg += `Bybit: ${data.bybit.join(", ")}\n`;
      if (data.binance && data.binance.length) msg += `Binance: ${data.binance.join(", ")}`;

      if (!data.bybit?.length && !data.binance?.length) msg = "No open positions found to close.";

      alert(msg);

    } catch (e) {
      console.error(e);
      alert(`Failed to close all trades: ${e.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground transition-all duration-300 ease-in-out">
      {/* Wrapper to handle Layout Shift */}
      <div
        className="max-w-7xl mx-auto space-y-6 p-4 md:p-8 transition-all duration-300 ease-in-out"
        style={{ marginRight: selectedOpportunity ? '400px' : 'auto' }}
      >

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

          <div className="flex items-center gap-4">
            {/* Mode Badge */}
            <div className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest border shadow-sm",
              isLive
                ? "bg-green-500/10 text-green-600 border-green-500/20"
                : "bg-amber-500/10 text-amber-600 border-amber-500/20"
            )}>
              {isLive ? "Mainnet" : "Testnet"}
            </div>

            {/* Live Mode Toggle (moved here) */}
            <div className="flex items-center gap-2 bg-card border px-3 py-1.5 rounded-lg shadow-sm">
              <span className="text-sm font-medium">Live Toggle</span>
              <Switch checked={isLive} onCheckedChange={setIsLive} />
              <span className={cn("inline-block w-2 h-2 rounded-full animate-pulse", isLive ? "bg-green-500" : "bg-gray-400")}></span>
            </div>

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
                {/* Metadata Status */}
                <span className={`text-[10px] px-1 rounded border ${metadataCount > 0 ? "bg-green-500/10 text-green-500 border-green-500/50" : "bg-red-500/10 text-red-500 border-red-500/50"}`}>
                  Meta: {metadataCount}
                </span>
                {/* Filter Checkbox */}
                <div className="flex items-center gap-2 ml-4">
                  <Switch id="high-diff" checked={showHighDiff} onCheckedChange={setShowHighDiff} />
                  <label htmlFor="high-diff" className="text-sm font-medium cursor-pointer">
                    Diff &gt; 0.5%
                  </label>
                </div>
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


            {/* Main Table */}
            <Card className="overflow-hidden border-t-4 border-t-primary">
              <div className="p-1 overflow-x-auto relative min-h-[500px]">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-[100px] font-bold text-primary sticky left-0 z-20 bg-muted/50 shadow-[1px_0_5px_rgba(0,0,0,0.1)]">Symbol</TableHead>
                      <TableHead className="min-w-[80px] hidden sm:table-cell">Price</TableHead>
                      <TableHead className="min-w-[80px]">Funding</TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-primary transition-colors hover:bg-muted/50" onClick={() => requestSort('binanceRateRaw')}>
                        Binance {sortConfig.key === 'binanceRateRaw' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-primary transition-colors hover:bg-muted/50" onClick={() => requestSort('bybitRateRaw')}>
                        Bybit {sortConfig.key === 'bybitRateRaw' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-primary transition-colors hover:bg-muted/50" onClick={() => requestSort('diff')}>
                        Diff {sortConfig.key === 'diff' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-primary transition-colors hover:bg-muted/50" onClick={() => requestSort('apr')}>
                        APR {sortConfig.key === 'apr' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead className="text-right sticky right-0 z-20 bg-muted/50">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={8} className="h-24 text-center">
                          <div className="flex justify-center items-center gap-2">
                            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                            <span className="text-muted-foreground">Fetching market data...</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : paginatedData.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                          No arbitrage opportunities found matching criteria.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedData.map((item) => (
                        <TableRow key={item.symbol} className="hover:bg-muted/30">
                          <TableCell className="font-bold sticky left-0 z-10 bg-background shadow-[1px_0_5px_rgba(0,0,0,0.05)] border-r">
                            <div className="flex items-center gap-2">
                              {autoTradeSymbols.has(item.symbol) && (
                                <Zap className="w-4 h-4 text-yellow-500 animate-pulse" title="Auto-Trade Enabled" />
                              )}
                              <img
                                src={`https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${item.symbol.toLowerCase()}.png`}
                                alt={item.symbol}
                                className="w-6 h-6 rounded-full bg-white"
                                onError={(e) => {
                                  e.target.onerror = null;
                                  e.target.src = `https://ui-avatars.com/api/?name=${item.symbol}&background=F3BA2F&color=fff&size=64&font-size=0.4&bold=true`;
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
                                  <span className="text-xs font-mono">{h}h {m}m</span>
                                  <span className="text-[9px] text-muted-foreground font-semibold uppercase leading-tight">
                                    Bn: {item.intervals?.binance || '?'}h | Bb: {item.intervals?.bybit || '?'}h
                                  </span>
                                </div>
                              );
                            })()}
                          </TableCell>
                          <TableCell className={cn("text-right font-medium", item.binanceRate > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                            {item.binanceRate.toFixed(4)}%
                          </TableCell>
                          <TableCell className={cn("text-right font-medium", item.bybitRate > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                            {item.bybitRate ? item.bybitRate.toFixed(4) : '0.0000'}%
                          </TableCell>
                          <TableCell className={cn("text-right font-bold", item.diff > 0 ? "text-green-600 dark:text-green-400" : item.diff < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                            {item.diff > 0 ? '+' : ''}{item.diff.toFixed(4)}%
                          </TableCell>
                          <TableCell className="text-right font-bold text-blue-600 dark:text-blue-400">
                            {item.apr.toFixed(2)}%
                          </TableCell>
                          <TableCell className="text-right sticky right-0 z-10 bg-background shadow-[-1px_0_5px_rgba(0,0,0,0.05)] border-l">
                            <div className="flex justify-end gap-1">
                              <Tooltip content={
                                (Math.abs(item.binanceRate) === 0 || Math.abs(item.bybitRate) === 0)
                                  ? "Trade Locked: 0% Rate detected"
                                  : "Open Trade Panel"
                              } side="top">
                                <Button
                                  size="sm"
                                  className={cn(
                                    "h-8 font-bold px-2 sm:px-3 shadow-sm border",
                                    (Math.abs(item.binanceRate) === 0 || Math.abs(item.bybitRate) === 0)
                                      ? "bg-gray-500/20 text-gray-500 border-gray-500/30 cursor-not-allowed"
                                      : "bg-blue-600 hover:bg-blue-700 text-white border-blue-500/50"
                                  )}
                                  onClick={() => setSelectedOpportunity(item)}
                                  disabled={Math.abs(item.binanceRate) === 0 || Math.abs(item.bybitRate) === 0}
                                >
                                  Trade
                                </Button>
                              </Tooltip>
                              <Tooltip content="Open Binance Futures" side="top">
                                <Button size="icon" variant="outline" className="h-8 w-8 p-0 border-yellow-500/50 hover:bg-yellow-500/10" asChild>
                                  <a href={`https://www.binance.com/en/futures/${item.symbol}USDT`} target="_blank" rel="noopener noreferrer">
                                    <img src="https://bin.bnbstatic.com/static/images/common/favicon.ico" alt="Binance" className="w-4 h-4" />
                                  </a>
                                </Button>
                              </Tooltip>
                              <Tooltip content="Open Bybit" side="top">
                                <Button size="icon" variant="outline" className="h-8 w-8 p-0 border-purple-500/50 hover:bg-purple-500/10" asChild>
                                  <a href={`https://www.bybit.com/trade/usdt/${item.symbol}USDT`} target="_blank" rel="noopener noreferrer">
                                    <img src="https://www.bybit.com/favicon.ico" alt="Bybit" className="w-4 h-4" />
                                  </a>
                                </Button>
                              </Tooltip>
                              <Tooltip content="Open Both Exchanges" side="top">
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-8 w-8 p-0 border-green-500/50 hover:bg-green-500/10"
                                  onClick={() => {
                                    window.open(`https://www.binance.com/en/futures/${item.symbol}USDT`, '_blank');
                                    window.open(`https://www.bybit.com/trade/usdt/${item.symbol}USDT`, '_blank');
                                  }}
                                >
                                  <ExternalLink className="w-4 h-4 text-green-500" />
                                </Button>
                              </Tooltip>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 p-4 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm font-medium">Page {currentPage} of {totalPages}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </Button>
                </div>
              )}
            </Card>


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

