import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { ArbitrageModal } from "@/components/ArbitrageModal";
import { TradeSidePanel } from "./components/TradeSidePanel";
import { DemoTradingModal } from "./components/DemoTradingModal";
import { DashboardPage } from "./components/DashboardPage";
import { AutoTradePage } from "./components/AutoTradePage";
import { SettingsPage } from "./components/SettingsPage";
import { PnLPage } from "./components/PnLPage";
import { LeaderboardPage } from "./components/LeaderboardPage";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowUpDown, ExternalLink, RefreshCw, Settings, AlertTriangle, LayoutDashboard, Activity, Zap, History, Trophy } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

// --- API Helpers ---

const getBackendUrl = () => {
  // Smart detection: if accessed via IP or non-localhost, use same host with port 8000
  const hostname = window.location.hostname;
  const savedPrimary = localStorage.getItem("primary_backend_url");
  const savedBackup = localStorage.getItem("backup_backend_url");

  // Check if we're on a local network IP
  const isLocalNetworkIP = /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

  // If on local network IP, ALWAYS use local backend (ignore saved cloud URLs)
  if (isLocalNetworkIP) {
    const localBackend = `http://${hostname}:8000`;
    // Only use saved URL if it's also a local IP, not a cloud URL
    if (savedPrimary && (savedPrimary.includes(hostname) || savedPrimary.includes("localhost") || savedPrimary.includes("127.0.0.1"))) {
      return { primary: savedPrimary, backup: savedBackup };
    }
    return { primary: localBackend, backup: savedBackup };
  }

  // Local development
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    const primary = savedPrimary || "http://localhost:8000";
    return { primary, backup: savedBackup };
  }

  // Production/external - use saved or default cloud backend
  const primary = savedPrimary || "https://bybit-bianance-bot.onrender.com";
  return { primary, backup: savedBackup };
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
    const { primary } = getBackendUrl();
    const res = await fetch(`${primary}/api/binance/fapi/v1/premiumIndex`);
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

    // Auth headers headers removed as this is a public endpoint
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
  const [currentTab, setCurrentTab] = useState("scanner"); // 'scanner', 'dashboard', 'settings', 'pnl'

  // --- GLOBAL AUTO TRADE STATE ---
  const [globalAutoTrade, setGlobalAutoTrade] = useState(false);

  const fetchGlobalAutoTradeStatus = async () => {
    try {
      const { primary } = getBackendUrl();
      const res = await fetch(`${primary}/api/auto-trade/status`);
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setGlobalAutoTrade(data.config.active);
        }
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  };

  // --- LEADERBOARD PING ---
  useEffect(() => {
    const pingLeaderboard = async () => {
      try {
        const { primary } = getBackendUrl();
        // Initialize default stats
        let stats = { total_profit: 0, win_rate: 0, trades: 0 };

        try {
          // Fetch PnL Summary first - fail safely if this endpoint is down
          const pnlRes = await fetch(`${primary}/api/pnl/overview`);
          if (pnlRes.ok) {
            const pnlData = await pnlRes.json();
            if (pnlData.summary) {
              stats = pnlData.summary;
            }
          }
        } catch (err) {
          console.warn("Leaderboard: PnL fetch failed, sending default stats", err);
        }

        // Add Active Status from current state
        stats.is_active = globalAutoTrade;

        // Get ID and Name
        let id = localStorage.getItem("bot_unique_id");
        if (!id) {
          id = "bot_" + Math.random().toString(36).substr(2, 9);
          localStorage.setItem("bot_unique_id", id);
        }
        const name = localStorage.getItem("bot_name") || `Bot-${id.substr(0, 4)}`;

        // Send Ping
        console.log("Leaderboard: Sending Ping...", { id, name, stats });
        const pingRes = await fetch(`${primary}/api/leaderboard/ping`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: id,
            name: name,
            stats: stats
          })
        });

        if (pingRes.ok) {
          console.log("Leaderboard: Ping Success");
        } else {
          console.error("Leaderboard: Ping Failed", pingRes.status);
        }
      } catch (e) {
        console.error("Leaderboard: Ping Error", e);
      }
    };

    // Ping every minute
    pingLeaderboard();
    const interval = setInterval(pingLeaderboard, 60000);
    return () => clearInterval(interval);
  }, [globalAutoTrade]);

  const toggleGlobalAutoTrade = async () => {
    try {
      const { primary } = getBackendUrl();
      const newState = !globalAutoTrade;

      // Optimistic update
      setGlobalAutoTrade(newState);

      // Step 1: Fetch current to ensure we don't overwrite
      const statusRes = await fetch(`${primary}/api/auto-trade/status`);
      const statusData = await statusRes.json();
      const currentConfig = statusData.config;

      // Get Bot Identity for Backend Keep-Alive
      let botId = localStorage.getItem("bot_unique_id");
      if (!botId) {
        botId = "bot_" + Math.random().toString(36).substr(2, 9);
        localStorage.setItem("bot_unique_id", botId);
      }
      const botName = localStorage.getItem("bot_name") || `Bot-${botId.substr(0, 4)}`;

      // Step 2: Update
      const updatedConfig = {
        ...currentConfig,
        active: newState,
        bot_id: botId,
        bot_name: botName
      };

      // Keys needed for update
      const headers = { "Content-Type": "application/json" };
      const bKey = localStorage.getItem("user_binance_key");
      const bSecret = localStorage.getItem("user_binance_secret");
      const cKey = localStorage.getItem("user_bybit_key");
      const cSecret = localStorage.getItem("user_bybit_secret");

      if (bKey) headers["X-User-Binance-Key"] = bKey;
      if (bSecret) headers["X-User-Binance-Secret"] = bSecret;
      if (cKey) headers["X-User-Bybit-Key"] = cKey;
      if (cSecret) headers["X-User-Bybit-Secret"] = cSecret;

      await fetch(`${primary}/api/auto-trade/config`, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(updatedConfig)
      });

      toast.toast({
        title: newState ? "Auto-Bet STARTED 🚀" : "Auto-Bet STOPPED 🛑",
        description: newState ? "Bot is now scanning matching funding times." : "Bot execution paused.",
        variant: newState ? "default" : "destructive"
      });

    } catch (e) {
      console.error("Toggle Failed", e);
      setGlobalAutoTrade(!globalAutoTrade); // Revert
      toast.toast({ title: "Error", description: "Failed to toggle Auto-Bet", variant: "destructive" });
    }
  };

  useEffect(() => {
    let timeoutId;
    let isMounted = true;
    let errorCount = 0;

    const poll = async () => {
      const success = await fetchGlobalAutoTradeStatus();
      if (!isMounted) return;

      let delay = 5000;
      if (!success) {
        errorCount++;
        // Backoff: 5s, 10s, 20s, 40s, 60s(max)
        delay = Math.min(5000 * Math.pow(2, errorCount), 60000);
        console.log(`Backend status unavailable. Backoff: ${delay / 1000}s`);
      } else {
        errorCount = 0;
      }
      timeoutId = setTimeout(poll, delay);
    };

    poll();
    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, []);

  // --- LIVE MODE STATE ---
  const [isLive, setIsLive] = useState(() => {
    // Initialize from LocalStorage
    return localStorage.getItem("is_live_mode") === "true";
  });

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
  // Load telegram config and auto-trade symbols from localStorage
  useEffect(() => {
    const hostname = window.location.hostname;
    // Expanded isLocal check to include network IPs
    const isLocal = hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

    // Enforcement: 
    // 1. Production -> Render
    // 2. Local -> localhost:8000 or network IP
    const targetProdUrl = "https://bybit-bianance-bot.onrender.com";
    const currentPrimary = localStorage.getItem("primary_backend_url");

    if (!isLocal && currentPrimary !== targetProdUrl) {
      console.log(`Enforcing PROD backend URL: ${currentPrimary} -> ${targetProdUrl}`);
      localStorage.setItem("primary_backend_url", targetProdUrl);
    } else if (isLocal) {
      // If strictly localhost (dev machine)
      if ((hostname === "localhost" || hostname === "127.0.0.1") && (!currentPrimary || currentPrimary.includes("127.0.0.1") || currentPrimary.includes("onrender"))) {
        console.log(`Enforcing LOCAL backend URL: ${currentPrimary} -> http://localhost:8000`);
        localStorage.setItem("primary_backend_url", "http://localhost:8000");
      }
      // If network IP, clear improper cloud urls to allow auto-detection
      else if (currentPrimary && currentPrimary.includes("onrender.com")) {
        console.log("Clearing PROD URL from local session to allow auto-detection");
        localStorage.removeItem("primary_backend_url");
      }
    }

    // Load saved config
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
  const previousDataRef = useRef({});
  const alertedPairsRef = useRef(new Map()); // symbol -> lastFundingTimeAlerted

  const intervalMapRef = useRef({}); // Use Ref to avoid stale closure in setInterval
  const [metadataCount, setMetadataCount] = useState(0);

  // STABILITY: Lock to prevent processing data during mode switch
  const modeSwitchingRef = useRef(false);
  // STABILITY: Mode generation counter - increments on each mode switch
  const modeGenerationRef = useRef(0);
  // STABILITY: Track which mode generation each data item belongs to
  const dataGenerationRef = useRef(0);

  // STABILITY: Throttle table updates to prevent rapid flickering
  const lastTableUpdateRef = useRef(0);
  const pendingUpdateRef = useRef(null);
  const TABLE_UPDATE_INTERVAL = 3000; // Update table max every 3 seconds for stability

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

  // Throttled table update - prevents rapid UI flickering
  const updateTableData = useCallback((forceUpdate = false) => {
    const now = Date.now();

    // If not forced and we updated recently, schedule for later
    if (!forceUpdate && now - lastTableUpdateRef.current < TABLE_UPDATE_INTERVAL) {
      if (!pendingUpdateRef.current) {
        pendingUpdateRef.current = setTimeout(() => {
          pendingUpdateRef.current = null;
          updateTableData(true);
        }, TABLE_UPDATE_INTERVAL - (now - lastTableUpdateRef.current));
      }
      return;
    }

    // Clear any pending update
    if (pendingUpdateRef.current) {
      clearTimeout(pendingUpdateRef.current);
      pendingUpdateRef.current = null;
    }

    lastTableUpdateRef.current = now;

    // STABILITY: Get current generation - only show data from current mode
    const currentGen = modeGenerationRef.current;

    // Convert to array - filter by generation to avoid stale data
    const rows = Object.values(dataRef.current)
      .filter(item => item._generation === currentGen) // Only current generation
      .map(item => {
        const bRate = item.binanceRate !== undefined ? item.binanceRate : -999;
        const cRate = item.bybitRate !== undefined ? item.bybitRate : -999;
        const markPrice = item.markPrice || 0;

        const bPrice = item.binancePrice || 0;
        const cPrice = item.bybitPrice || 0;
        let priceSpread = 0;
        if (bPrice > 0 && cPrice > 0) {
          priceSpread = Math.abs(bPrice - cPrice) / bPrice * 100;
        }

        // Calculate Diff/Spread and APR
        let diff = -999;
        let spread = 0;
        let apr = 0;
        let diffAbs = 0;

        if (bRate !== -999 && cRate !== -999) {
          diff = bRate - cRate;
          spread = Math.abs(diff);
          diffAbs = Math.abs(diff);

          // APR Calculation
          const bnInt = item.binanceInterval || 8;
          const bbInt = item.bybitInterval || 8;
          const interval = Math.min(bnInt, bbInt);
          const opportunitiesPerDay = 24 / interval;
          apr = (spread * opportunitiesPerDay * 365) * 100;
        }

        // Clean up expire deltas (visual indicators last 3s)
        if (item.bnDeltaTime && (now - item.bnDeltaTime > 3000)) item.bnDelta = null;
        if (item.bbDeltaTime && (now - item.bbDeltaTime > 3000)) item.bbDelta = null;

        return { ...item, diff, spread, diffAbs, apr, binanceRate: bRate, bybitRate: cRate, markPrice, priceSpread, binancePrice: bPrice, bybitPrice: cPrice };
      });

    // Sort by current config
    rows.sort((a, b) => {
      let valA = a[sortConfig.key];
      let valB = b[sortConfig.key];

      if (valA === undefined) valA = -Infinity;
      if (valB === undefined) valB = -Infinity;

      if (sortConfig.direction === 'asc') return valA - valB;
      return valB - valA;
    });

    setLastUpdated(new Date());
    setData(rows);
  }, [sortConfig]);

  // --- REUSABLE DATA PROCESSOR (Used by both WS and Polling) ---
  const getFundingDelta = (symbol, exchange, newRate) => {
    if (!previousDataRef.current[symbol]) return null;
    const oldRate = exchange === 'binance' ? previousDataRef.current[symbol].binanceRate : previousDataRef.current[symbol].bybitRate;
    if (oldRate === undefined || newRate === undefined) return null;
    if (oldRate !== newRate) {
      return newRate > oldRate ? 'up' : 'down';
    }
    return null;
  };

  const processRatesData = (binance, bybit) => {
    // STABILITY: Don't process data while switching modes
    if (modeSwitchingRef.current) {
      console.log("⏳ Mode switching in progress, ignoring data update");
      return;
    }

    // STABILITY: Check if data generation matches current mode generation
    // This prevents stale data from previous mode from being displayed
    const currentGen = modeGenerationRef.current;

    // console.log("DEBUG: processRatesData running. getFundingDelta type:", typeof getFundingDelta); 
    const b = binance || {};
    const c = bybit || {};

    Object.keys(b).forEach(s => {
      // Initialize if missing
      if (!dataRef.current[s]) dataRef.current[s] = { symbol: s };

      // Tag with current generation
      dataRef.current[s]._generation = currentGen;

      const prev = dataRef.current[s];

      // Calculate Deltas BEFORE updating
      const bnDelta = getFundingDelta(s, 'binance', b[s].rate);

      // Update Data
      dataRef.current[s].binanceRate = b[s].rate;
      dataRef.current[s].binancePrice = b[s].markPrice;
      dataRef.current[s].markPrice = b[s].markPrice;
      dataRef.current[s].nextFundingTime = b[s].nextFundingTime;
      if (b[s].fundingIntervalHours) {
        dataRef.current[s].binanceInterval = b[s].fundingIntervalHours;
      }

      // Store Transient Flash State (expires on re-render or timeout in real app, 
      // but here we rely on frequent updates to clear it naturally or we can use a timestamp)
      if (bnDelta) {
        dataRef.current[s].bnDelta = bnDelta;
        dataRef.current[s].bnDeltaTime = Date.now();
      }
    });

    Object.keys(c).forEach(s => {
      if (!dataRef.current[s]) dataRef.current[s] = { symbol: s };

      // Tag with current generation
      dataRef.current[s]._generation = currentGen;

      const prev = dataRef.current[s];
      const bbDelta = getFundingDelta(s, 'bybit', c[s].rate);

      dataRef.current[s].bybitRate = c[s].rate;
      dataRef.current[s].bybitPrice = c[s].markPrice;

      if (c[s].markPrice && !dataRef.current[s].markPrice) {
        dataRef.current[s].markPrice = c[s].markPrice;
      }

      // Sync Next Funding Time
      const bnNFT = dataRef.current[s].nextFundingTime || Infinity;
      const bbNFT = c[s].nextFundingTime || Infinity;

      if (bbNFT < bnNFT && bbNFT !== Infinity) {
        dataRef.current[s].nextFundingTime = bbNFT;
      } else if (bnNFT !== Infinity) {
        dataRef.current[s].nextFundingTime = bnNFT;
      }

      if (c[s].fundingIntervalHours) {
        dataRef.current[s].bybitInterval = c[s].fundingIntervalHours;
      }

      if (bbDelta) {
        dataRef.current[s].bbDelta = bbDelta;
        dataRef.current[s].bbDeltaTime = Date.now();
      }
    });

    // Update Previous Ref for next comparison (deep copy minimal needed)
    // We only need rates for comparison
    const snapshot = {};
    Object.keys(dataRef.current).forEach(s => {
      snapshot[s] = {
        binanceRate: dataRef.current[s].binanceRate,
        bybitRate: dataRef.current[s].bybitRate
      };
    });
    previousDataRef.current = snapshot;

    setLoading(false);
    updateTableData();
  };

  // --- FRONTEND WEBSOCKET LOGIC ---
  const [usingFallback, setUsingFallback] = useState(true); // Default to True until WS connects
  const wsRef = useRef(null);
  const isLiveRef = useRef(isLive); // Track current mode for WS handler

  // Keep isLiveRef in sync
  useEffect(() => {
    isLiveRef.current = isLive;
  }, [isLive]);

  useEffect(() => {
    const { primary } = getBackendUrl();
    // Determine WS protocol
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Remove trailing slash if present
    const baseUrl = primary.replace(/\/$/, "");

    // FORCE HARDCODED URL PATH to avoid environment leakage
    // We construct it explicitly
    const wsUrl = baseUrl.replace('http', 'ws').replace('https', 'wss') + "/ws/clients";

    console.log(`Connecting to Backend WS: ${wsUrl} (Mode: ${isLive ? 'LIVE' : 'TEST'})`);

    let reconnectTimeout = null;
    let pingInterval = null;

    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const connect = () => {
      // Prevent multiple connections
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        return;
      }

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(`✅ LIVE STREAM CONNECTED (Mode: ${isLive ? 'LIVE' : 'TEST'})`);
        setUsingFallback(false);

        // 1. Send INIT message to identify mode (Resubscribe equivalent)
        ws.send(JSON.stringify({ op: "init", is_live: isLive }));

        // 2. Start Heartbeat (Every 5s)
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: "ping" }));
          }
        }, 5000);
      };

      ws.onmessage = (event) => {
        try {
          // STABILITY: Skip if mode switching is in progress 
          // (Not strictly needed with Dual Stream but keeps UI cleaner during reset)
          // if (modeSwitchingRef.current) return;

          const payload = JSON.parse(event.data);

          // Handle PONG
          if (payload.op === 'pong') {
            return;
          }

          // DUAL STREAM: Payload contains both live and testnet
          // We simply pick the one matching our local state
          const currentIsLive = isLiveRef.current;

          let targetData = null;
          if (currentIsLive) {
            targetData = payload.live;
          } else {
            targetData = payload.testnet;
          }

          if (targetData && targetData.binance && targetData.bybit) {
            processRatesData(targetData.binance, targetData.bybit);
          }
        } catch (e) {
          console.error("WS Parse Error", e);
        }
      };

      ws.onerror = (error) => {
        console.log("WS Error", error);
        setUsingFallback(true);
      };

      ws.onclose = () => {
        console.log("❌ LIVE STREAM DISCONNECTED - Switching to Polling");
        setUsingFallback(true);
        if (pingInterval) clearInterval(pingInterval);

        // Reconnect after 3s only if this ws is still current
        reconnectTimeout = setTimeout(() => {
          if (wsRef.current === ws) {
            connect();
          }
        }, 3000);
      };
    };

    connect();

    return () => {
      if (pingInterval) clearInterval(pingInterval);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [isLive]); // Reconnect when mode changes

  // --- LIVE MODE STATE ---
  // State moved to top


  useEffect(() => {
    // Persist to LocalStorage whenever it changes
    localStorage.setItem("is_live_mode", isLive);
    return () => {
      setConnectionStatus({ binance: 'disconnected', coinswitch: 'disconnected' });
    };
  }, [isLive]);

  // --- BACKEND WS MANAGER (Switch Mode) ---
  // --- BACKEND WS MANAGER (Switch Mode) ---
  useEffect(() => {
    // With Dual-Stream backend, we no longer need to "switch" the backend mode.
    // The backend sends both streams. We just need to clear our local data to avoid visual confusion.

    // INCREMENT GENERATION: New mode = new generation
    modeGenerationRef.current += 1;
    const thisGeneration = modeGenerationRef.current;

    // RESET STALE DATA
    setLoading(true);
    dataRef.current = {};
    previousDataRef.current = {};
    alertedPairsRef.current.clear();
    setData([]);
    console.log(`🔄 Mode switched to ${isLive ? 'LIVE' : 'TEST'}: Resetting local cache.`);

    // Wait a brief moment for next WS frame to populate data
    // or fetch via REST immediately to be snappy
    const updateUI = async () => {
      try {
        const { binance, bybit } = await fetchRatesWithFailover(isLive);
        // Check generation before applying
        if (modeGenerationRef.current === thisGeneration) {
          processRatesData(binance, bybit);
        }
      } catch (e) { console.error(e); }
    };

    updateUI();

    // Ensure backend WS is running (idempotent call)
    const { primary } = getBackendUrl();
    fetch(`${primary}/api/ws/start?is_live=${isLive}`, { method: "POST" }).catch(e => console.error("WS Start ping failed", e));

    // Status Polling for UI Indicators
    const updateUiStatus = async () => {
      try {
        const statusRes = await fetch(`${primary}/api/ws/status`);
        const status = await statusRes.json();

        // Map backend status to frontend state
        // If live -> check binance_live, else binance_testnet
        const targetBinance = isLive ? status.binance_live : status.binance_testnet;

        setConnectionStatus({
          binance: targetBinance?.running ? 'connected' : 'disconnected',
          coinswitch: status.bybit?.running ? 'connected' : 'disconnected'
        });
      } catch (e) {
        setConnectionStatus({ binance: 'disconnected', coinswitch: 'disconnected' });
      }
    };

    updateUiStatus();
    const statusInterval = setInterval(updateUiStatus, 5000);

    return () => clearInterval(statusInterval);
  }, [isLive]);

  // --- DATA FETCHING (INITIAL + POLLING FALLBACK) ---
  useEffect(() => {
    const fetchData = async () => {
      try {
        // STABILITY: Skip if mode switching is in progress
        if (modeSwitchingRef.current) {
          return;
        }

        // Use ref to get current mode (avoids stale closure)
        const currentIsLive = isLiveRef.current;
        const { binance, bybit } = await fetchRatesWithFailover(currentIsLive);

        // Double-check mode hasn't changed during fetch OR mode switch started
        if (isLiveRef.current !== currentIsLive || modeSwitchingRef.current) {
          console.log("Mode changed during fetch, discarding stale data");
          return;
        }

        processRatesData(binance, bybit);

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
              const diff = Math.abs(item.binanceRate - item.bybitRate);
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

    // Initial Fetch on Load
    fetchData();

    // FALLBACK POLLING: Only active if usingFallback is true
    const pollInterval = setInterval(() => {
      if (usingFallback) {
        console.log("⚠️ WS Down. Polling API...");
        fetchData();
      }
    }, 3000); // Poll every 3s if fallback active


    // One-time fetch for funding intervals with fallback strategy
    const fetchIntervals = async () => {
      try {
        const { primary } = getBackendUrl();
        let data = null;

        // Strategy 1: Try backend proxy first
        console.log("📡 Attempting to fetch exchangeInfo via backend proxy...");
        try {
          const res = await fetch(`${primary}/api/binance/fapi/v1/exchangeInfo`, {
            signal: AbortSignal.timeout(5000)
          });

          if (res.ok) {
            data = await res.json();
            console.log("✅ Backend proxy successful");
          } else {
            console.warn(`⚠️ Backend proxy failed: ${res.status} ${res.statusText}`);
          }
        } catch (e) {
          console.warn("⚠️ Backend proxy error:", e.message);
        }

        // Strategy 2: Fallback to direct Binance API (client-side)
        if (!data) {
          console.log("📡 Attempting direct Binance API call...");
          try {
            const res = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo', {
              signal: AbortSignal.timeout(5000),
              mode: 'cors'
            });

            if (res.ok) {
              data = await res.json();
              console.log("✅ Direct Binance API successful");
            } else {
              console.warn(`⚠️ Direct Binance failed: ${res.status}`);
            }
          } catch (e) {
            console.warn("⚠️ Direct Binance error (likely CORS):", e.message);
          }
        }

        // Process if we got data
        if (data?.symbols) {
          let processedCount = 0;
          data.symbols.forEach(s => {
            if (s.pair) {
              let sym = s.pair.replace('USDT', '');
              if (!dataRef.current[sym]) dataRef.current[sym] = { symbol: sym };
              dataRef.current[sym].fundingIntervalHours = s.fundingIntervalHours || 8;
              processedCount++;
            }
          });
          console.log(`✅ Loaded intervals for ${processedCount} symbols from exchangeInfo`);
        } else {
          console.warn("⚠️ All interval fetch strategies failed.");
          console.log("ℹ️ Using intervals from /api/rates (backend provides this)");
        }
      } catch (e) {
        console.error("Interval fetch error, using /api/rates data", e);
      }
    };
    fetchIntervals();

    return () => clearInterval(pollInterval);
  }, [isLive, usingFallback]);

  const [searchQuery, setSearchQuery] = useState("");
  const [intervalFilter, setIntervalFilter] = useState("all"); // "all", "1h", "4h", "8h", "matched"

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


  // Sorting Logic - with stability optimization
  const sortedData = useMemo(() => {
    let sortableItems = [...data];
    if (sortConfig.key) {
      sortableItems.sort((a, b) => {
        let valA = a[sortConfig.key];
        let valB = b[sortConfig.key];

        // Handle undefined/null values
        if (valA === undefined || valA === null) valA = -Infinity;
        if (valB === undefined || valB === null) valB = -Infinity;

        // For diff-based columns, use absolute values
        if (sortConfig.key === 'diffAbs' || sortConfig.key === 'spread') {
          valA = Math.abs(valA);
          valB = Math.abs(valB);
        }

        if (valA < valB) {
          return sortConfig.direction === 'ascending' ? -1 : 1;
        }
        if (valA > valB) {
          return sortConfig.direction === 'ascending' ? 1 : -1;
        }
        // STABLE SORT: Use symbol as tiebreaker to prevent jumping
        return a.symbol.localeCompare(b.symbol);
      });
    }

    const filtered = sortableItems.filter(item => {
      const matchesSpread = item.spread >= parseFloat(minSpread);

      // Search matches symbol - if searching, show ALL matching results
      const matchesSearch = searchQuery.trim() === '' || item.symbol.toLowerCase().includes(searchQuery.toLowerCase());

      // High Diff Filter (> 0.5%)
      const matchesHighDiff = showHighDiff ? Math.abs(item.diff) > 0.5 : true;

      // Filter by Testnet Availability if Testnet is ON
      let matchesTestnet = true;
      if (isTestnet && testnetSymbols.size > 0) {
        matchesTestnet = testnetSymbols.has(item.symbol);
      }

      // Interval Filter
      let matchesInterval = true;
      const bnInt = item.binanceInterval || 8;
      const bbInt = item.bybitInterval || 8;
      if (intervalFilter === "1h") {
        matchesInterval = bnInt === 1 && bbInt === 1;
      } else if (intervalFilter === "4h") {
        matchesInterval = bnInt === 4 && bbInt === 4;
      } else if (intervalFilter === "8h") {
        matchesInterval = bnInt === 8 && bbInt === 8;
      } else if (intervalFilter === "matched") {
        matchesInterval = bnInt === bbInt;
      }

      return matchesSpread && matchesSearch && matchesTestnet && matchesHighDiff && matchesInterval;
    });

    return filtered;
  }, [data, sortConfig, minSpread, searchQuery, isTestnet, testnetSymbols, showHighDiff, intervalFilter]);

  // PAGINATION: Standard pagination with all data
  const totalPages = Math.ceil(sortedData.length / itemsPerPage) || 1;

  // Reset to page 1 if current page is out of bounds
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [totalPages, currentPage]);

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
    const { primary: backendUrl } = getBackendUrl();

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
              {
                {
                  'scanner': 'Scanner',
                  'dashboard': 'Dashboard',
                  'auto-trade': 'Auto-Bot',
                  'settings': 'Settings',
                  'pnl': 'History',
                  'leaderboard': 'Rankings'
                }[currentTab] || 'Funding Arb Bot'
              }
            </h1>
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

            {/* Global Auto-Trade Toggle */}
            <div className={cn(
              "flex items-center gap-2 border px-3 py-1.5 rounded-lg shadow-sm transition-all duration-300",
              globalAutoTrade ? "bg-purple-500/10 border-purple-500/30" : "bg-card"
            )}>
              <span className={cn("text-sm font-bold", globalAutoTrade ? "text-purple-500" : "text-muted-foreground")}>
                Auto-Bet
              </span>
              <Switch
                checked={globalAutoTrade}
                onCheckedChange={toggleGlobalAutoTrade}
                className="data-[state=checked]:bg-purple-600"
              />
              <span className={cn("inline-block w-2 h-2 rounded-full animate-pulse", globalAutoTrade ? "bg-purple-500" : "bg-gray-300")}></span>
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
                variant={currentTab === 'auto-trade' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setCurrentTab('auto-trade')}
                className="gap-2"
              >
                <Zap className="h-4 w-4" /> Auto-Bet
              </Button>
              <Button
                variant={currentTab === 'settings' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setCurrentTab('settings')}
                className="gap-2"
              >
                <Settings className="h-4 w-4" /> Settings
              </Button>
              <Button
                variant={currentTab === 'pnl' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setCurrentTab('pnl')}
                className="gap-2"
              >
                <History className="h-4 w-4" /> History
              </Button>
              <Button
                variant={currentTab === 'leaderboard' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setCurrentTab('leaderboard')}
                className="gap-2"
              >
                <Trophy className="h-4 w-4" /> Rankings
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
                  <div className="flex gap-2 mr-2">
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-background border rounded-md shadow-sm">
                      {/* Stream Status Badge */}
                      <span className={cn("text-[10px] uppercase font-black px-1.5 rounded-sm",
                        !usingFallback ? "bg-blue-500 text-white" : "bg-amber-500 text-white"
                      )}>
                        {!usingFallback ? "STREAM" : "POLL"}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 px-2 py-1 bg-background border rounded-md shadow-sm">
                      <span className="text-[10px] font-bold text-muted-foreground">BN</span>
                      <div className="relative flex h-2.5 w-2.5">
                        {connectionStatus.binance === 'connected' && (
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        )}
                        <span className={cn("relative inline-flex rounded-full h-2.5 w-2.5 transition-colors duration-500",
                          connectionStatus.binance === 'connected' ? "bg-green-500" : "bg-red-500"
                        )}></span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 px-2 py-1 bg-background border rounded-md shadow-sm">
                      <span className="text-[10px] font-bold text-muted-foreground">BB</span>
                      <div className="relative flex h-2.5 w-2.5">
                        {connectionStatus.coinswitch === 'connected' && (
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        )}
                        <span className={cn("relative inline-flex rounded-full h-2.5 w-2.5 transition-colors duration-500",
                          connectionStatus.coinswitch === 'connected' ? "bg-green-500" : "bg-red-500"
                        )}></span>
                      </div>
                    </div>
                  </div>
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
                  <p className="text-xs text-muted-foreground">
                    Page {currentPage} of {totalPages} &gt; {minSpread}% Spread
                  </p>
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
                  <div className="flex items-center gap-2">
                    <span className="text-xs whitespace-nowrap w-20">Interval</span>
                    <select
                      value={intervalFilter}
                      onChange={(e) => setIntervalFilter(e.target.value)}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    >
                      <option value="all">All</option>
                      <option value="1h">1H-1H Only</option>
                      <option value="4h">4H-4H Only</option>
                      <option value="8h">8H-8H Only</option>
                      <option value="matched">Matched (Same)</option>
                    </select>
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
                      <TableHead className="min-w-[120px] hidden sm:table-cell">Price (Live)</TableHead>
                      <TableHead className="min-w-[80px] cursor-pointer hover:text-primary transition-colors hover:bg-muted/50" onClick={() => requestSort('nextFundingTime')}>
                        Funding {sortConfig.key === 'nextFundingTime' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-primary transition-colors hover:bg-muted/50" onClick={() => requestSort('binanceRateRaw')}>
                        Binance {sortConfig.key === 'binanceRateRaw' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-primary transition-colors hover:bg-muted/50" onClick={() => requestSort('bybitRateRaw')}>
                        Bybit {sortConfig.key === 'bybitRateRaw' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-primary transition-colors hover:bg-muted/50" onClick={() => requestSort('diff')}>
                        Diff {sortConfig.key === 'diff' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-primary bg-muted/20" onClick={() => requestSort('diffAbs')}>
                        Diff % {sortConfig.key === 'diffAbs' && (sortConfig.direction === 'ascending' ? '↑' : '↓')}
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
                          <div className="flex flex-col justify-center items-center gap-2">
                            <RefreshCw className="h-6 w-6 animate-spin text-blue-500" />
                            <span className="text-muted-foreground font-medium">
                              {modeSwitchingRef.current ? `Switching to ${isLive ? 'LIVE' : 'TEST'} mode...` : 'Fetching market data...'}
                            </span>
                            <span className="text-xs text-muted-foreground">Please wait, this may take a few seconds</span>
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
                      paginatedData.map((item) => {
                        const isInvalid = !item.binanceRate || !item.bybitRate || item.binanceRate === 0 || item.bybitRate === 0 || Math.abs(item.binanceRate) > 10 || Math.abs(item.bybitRate) > 10;
                        return (
                          <TableRow
                            key={item.symbol}
                            className={cn(
                              "hover:bg-muted/30 transition-all",
                              isInvalid && "opacity-30 grayscale pointer-events-none cursor-not-allowed bg-muted/10"
                            )}
                          >
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

                            {/* Live Prices Column */}
                            <TableCell className="font-mono text-xs">
                              <div className="flex flex-col gap-0.5">
                                <span className="text-muted-foreground">BN: <span className="text-foreground">${item.markPrice ? item.markPrice.toFixed(4) : '0.00'}</span></span>
                                <span className="text-muted-foreground">BB: <span className="text-foreground">${item.bybitPrice ? item.bybitPrice.toFixed(4) : '0.00'}</span></span>
                              </div>
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
                                    <span className="text-xs font-mono font-bold text-foreground">{h}h {m}m</span>
                                    <span className="text-[9px] text-muted-foreground font-semibold uppercase leading-tight">
                                      Bn: {item.binanceInterval || 8}h | Bb: {item.bybitInterval || 8}h
                                    </span>
                                  </div>
                                );
                              })()}
                            </TableCell>
                            <TableCell className={cn("text-right font-medium relative", item.binanceRate > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                              {item.binanceRate !== -999 ? (item.binanceRate * 100).toFixed(4) + '%' : '-'}
                              {item.bnDelta && (
                                <span className={cn(
                                  "absolute top-1 right-1 text-[8px] transform transition-all duration-500",
                                  item.bnDelta === 'up' ? "text-green-500" : "text-red-500"
                                )}>
                                  {item.bnDelta === 'up' ? '▲' : '▼'}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className={cn("text-right font-medium relative", item.bybitRate > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                              {item.bybitRate !== -999 ? (item.bybitRate * 100).toFixed(4) + '%' : '-'}
                              {item.bbDelta && (
                                <span className={cn(
                                  "absolute top-1 right-1 text-[8px] transform transition-all duration-500",
                                  item.bbDelta === 'up' ? "text-green-500" : "text-red-500"
                                )}>
                                  {item.bbDelta === 'up' ? '▲' : '▼'}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className={cn("text-right font-bold", item.diff > 0 ? "text-green-600 dark:text-green-400" : item.diff < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                              {item.diff !== -999 ? (item.diff > 0 ? '+' : '') + (item.diff * 100).toFixed(4) + '%' : '-'}
                            </TableCell>

                            {/* Absolute Diff Percentage */}
                            <TableCell className="text-right font-black bg-muted/10">
                              {(Math.abs(item.diff) * 100).toFixed(4)}%
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
                                    <ExternalLink className="h-4 w-4" />
                                  </Button>
                                </Tooltip>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 p-4 border-t flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                  >
                    First
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    Prev
                  </Button>

                  {/* Page number buttons - show max 5 */}
                  {(() => {
                    const pages = [];
                    let start = Math.max(1, currentPage - 2);
                    let end = Math.min(totalPages, start + 4);
                    if (end - start < 4) start = Math.max(1, end - 4);

                    for (let i = start; i <= end; i++) {
                      pages.push(
                        <Button
                          key={i}
                          variant={i === currentPage ? "default" : "outline"}
                          size="sm"
                          onClick={() => setCurrentPage(i)}
                          className="min-w-[36px]"
                        >
                          {i}
                        </Button>
                      );
                    }
                    return pages;
                  })()}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                  >
                    Last
                  </Button>
                </div>
              )}
            </Card>


            {/* Modal - Replaced/Augmented with Side Panel */}
            {/* Keeping ArbitrageModal logic if needed but user requested Trade to open Side Panel */}

            <TradeSidePanel
              isOpen={!!selectedOpportunity}
              onClose={() => setSelectedOpportunity(null)}
              // LIVE UPDATE FIX: Look up the symbol in the live 'data' array
              data={data.find(d => d.symbol === selectedOpportunity?.symbol) || selectedOpportunity}
            />

            {/* Temporarily commented out old modal for direct replacement as per request */}
            {/* <ArbitrageModal
                isOpen={!!selectedOpportunity}
                onClose={() => setSelectedOpportunity(null)}
                data={selectedOpportunity}
              /> */}
          </>
        )}

        {/* --- AUTO TRADE TAB --- */}
        {currentTab === 'auto-trade' && (
          <AutoTradePage
            topOpportunities={[...data]
              .filter(item => item.spread > 0 && item.binanceRate !== -999 && item.bybitRate !== -999)
              .sort((a, b) => b.spread - a.spread)
              .slice(0, 5)
            }
            allMarketData={data} // Pass full live data for Radar updates
            isLive={isLive}
          />
        )}

        {/* --- SETTINGS TAB --- */}
        {currentTab === 'settings' && <SettingsPage />}

        {/* --- HISTORY / PNL TAB --- */}
        {currentTab === 'pnl' && <PnLPage isLive={isLive} />}

        {/* --- DASHBOARD TAB --- */}
        {currentTab === 'dashboard' && <DashboardPage />}

        {/* --- LEADERBOARD TAB --- */}
        {currentTab === 'leaderboard' && <LeaderboardPage />}

      </div>
    </div >
  );
}

export default App;
