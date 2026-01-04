import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
// import { Label } from "@/components/ui/label"; // Removed missing component
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/components/ui/toast";
import { Play, Square, Activity, AlertTriangle, Settings, TrendingUp, ExternalLink, Save } from "lucide-react";

export function AutoTradePage({ topOpportunities = [], isLive = false }) {
    const [config, setConfig] = useState({
        active: false,
        total_investment: 100,
        max_trades: 1,
        leverage: 10,
        min_diff: 0.5,
        is_live: isLive, // Sync with parent's isLive
        start_time: "00:00",
        end_time: "23:59",
        max_price_diff: 2.0,
        auto_exit: true,
        entry_window: 300
    });
    
    // Sync config.is_live when parent's isLive changes
    useEffect(() => {
        setConfig(prev => ({ ...prev, is_live: isLive }));
    }, [isLive]);
    
    // DEBUG: Log initial config
    console.log("🔧 Frontend Config:", config, "| Parent isLive:", isLive);
    const [status, setStatus] = useState({ active_trades: 0, logs: [], pending_opportunities: [] });
    const [loading, setLoading] = useState(false);
    const toast = useToast();

    // Helper to get backend URL (centralized or direct)
    const getBackendUrl = () => {
        return localStorage.getItem("primary_backend_url") || "https://bianance-bot.onrender.com";
    };

    const fetchStatus = async (shouldUpdateConfig = false) => {
        try {
            const url = getBackendUrl();
            const res = await fetch(`${url}/api/auto-trade/status`);
            if (res.ok) {
                const data = await res.json();
                
                // DEBUG: Log the received data
                console.log("📊 Auto-Trade Status:", {
                    config: data.config,
                    pending_count: data.pending_opportunities?.length || 0,
                    pending: data.pending_opportunities
                });
                
                // Only merge config on initial load or explicit refresh, not during polling
                if (shouldUpdateConfig) {
                    setConfig(prev => ({ ...prev, ...data.config }));
                    console.log("⚙️ Settings we are using:", data.config);
                    console.log("🎯 Min Diff:", data.config.min_diff, "%");
                    console.log("💰 Max Price Diff:", data.config.max_price_diff, "%");
                }
                setStatus({
                    active_trades: data.active_trades,
                    logs: data.logs.reverse(), // Newest first
                    pending_opportunities: data.pending_opportunities || []
                });
            }
        } catch (e) {
            console.error("Status fetch failed", e);
        }
    };

    useEffect(() => {
        fetchStatus(true); // Initial load: fetch config
        const interval = setInterval(() => fetchStatus(false), 3000); // Poll: updates logs only
        return () => clearInterval(interval);
    }, []);

    const handleSaveConfig = async (newConfig) => {
        setLoading(true);
        try {
            const url = getBackendUrl();
            const res = await fetch(`${url}/api/auto-trade/config`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(newConfig)
            });
            if (res.ok) {
                const data = await res.json();
                setConfig(data.config);
                toast.success("Configuration Updated");
            } else {
                toast.error("Failed to update config");
            }
        } catch (e) {
            toast.error(`Error: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleForceTrade = async () => {
        setLoading(true);
        try {
            const url = getBackendUrl();
            const headers = {};
            // Extract keys from localStorage (same as DashboardPage)
            const bKey = localStorage.getItem("user_binance_key");
            const bSecret = localStorage.getItem("user_binance_secret");
            const cKey = localStorage.getItem("user_bybit_key");
            const cSecret = localStorage.getItem("user_bybit_secret");

            if (bKey) headers["X-User-Binance-Key"] = bKey;
            if (bSecret) headers["X-User-Binance-Secret"] = bSecret;
            if (cKey) headers["X-User-Bybit-Key"] = cKey;
            if (cSecret) headers["X-User-Bybit-Secret"] = cSecret;

            const res = await fetch(`${url}/api/auto-trade/force`, {
                method: "POST",
                headers: headers
            });
            const data = await res.json();
            if (data.status === "success") {
                toast.success(`Forced Trade: ${data.symbol}`);
                fetchStatus(); // Refresh logs
            } else {
                toast.error(`Force Failed: ${data.message}`);
            }
        } catch (e) {
            toast.error(`Error: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    const [simulatingSymbol, setSimulatingSymbol] = useState(null);
    
    const handleSimulateTrade = async (symbol) => {
        setSimulatingSymbol(symbol);
        try {
            const url = getBackendUrl();
            const headers = { "Content-Type": "application/json" };
            
            // Extract keys from localStorage
            const bKey = localStorage.getItem("user_binance_key");
            const bSecret = localStorage.getItem("user_binance_secret");
            const cKey = localStorage.getItem("user_bybit_key");
            const cSecret = localStorage.getItem("user_bybit_secret");

            if (bKey) headers["X-User-Binance-Key"] = bKey;
            if (bSecret) headers["X-User-Binance-Secret"] = bSecret;
            if (cKey) headers["X-User-Bybit-Key"] = cKey;
            if (cSecret) headers["X-User-Bybit-Secret"] = cSecret;

            const exitDelay = config.exit_after_seconds || 30;
            
            toast.success(`🚀 Simulating ${symbol} - Exit in ${(exitDelay / 60).toFixed(1)} min`);
            
            const res = await fetch(`${url}/api/auto-trade/simulate`, {
                method: "POST",
                headers: headers,
                body: JSON.stringify({
                    symbol: symbol,
                    exit_delay_seconds: exitDelay,
                    is_live: config.is_live
                })
            });
            const data = await res.json();
            
            if (data.status === "success") {
                toast.success(`✅ ${symbol}: Entry done! Auto-exit in ${(exitDelay / 60).toFixed(1)} min`);
                fetchStatus();
            } else {
                toast.error(`❌ ${symbol}: ${data.message}`);
            }
        } catch (e) {
            toast.error(`Error: ${e.message}`);
        } finally {
            setSimulatingSymbol(null);
        }
    };

    const [simulatingAll, setSimulatingAll] = useState(false);
    
    const handleSimulateAll = async () => {
        // Get top 3 opportunities
        const displayData = (config.active && status.pending_opportunities?.length > 0) 
            ? status.pending_opportunities 
            : topOpportunities.slice(0, 3);
        
        if (!displayData || displayData.length === 0) {
            toast.error("No opportunities to simulate");
            return;
        }
        
        setSimulatingAll(true);
        toast.success(`🚀 Starting simulation of ${displayData.length} coins...`);
        
        for (let i = 0; i < displayData.length; i++) {
            const item = displayData[i];
            const symbol = item.symbol;
            
            try {
                const url = getBackendUrl();
                const headers = { "Content-Type": "application/json" };
                
                const bKey = localStorage.getItem("user_binance_key");
                const bSecret = localStorage.getItem("user_binance_secret");
                const cKey = localStorage.getItem("user_bybit_key");
                const cSecret = localStorage.getItem("user_bybit_secret");

                if (bKey) headers["X-User-Binance-Key"] = bKey;
                if (bSecret) headers["X-User-Binance-Secret"] = bSecret;
                if (cKey) headers["X-User-Bybit-Key"] = cKey;
                if (cSecret) headers["X-User-Bybit-Secret"] = cSecret;

                const exitDelay = config.exit_after_seconds || 30;
                
                const res = await fetch(`${url}/api/auto-trade/simulate`, {
                    method: "POST",
                    headers: headers,
                    body: JSON.stringify({
                        symbol: symbol,
                        exit_delay_seconds: exitDelay + (i * 10), // Stagger exits by 10 seconds
                        is_live: config.is_live
                    })
                });
                const data = await res.json();
                
                if (data.status === "success") {
                    toast.success(`✅ ${i + 1}/${displayData.length}: ${symbol} entry done`);
                } else {
                    toast.error(`❌ ${symbol}: ${data.message}`);
                }
                
                // Small delay between trades to avoid rate limiting
                if (i < displayData.length - 1) {
                    await new Promise(r => setTimeout(r, 500));
                }
            } catch (e) {
                toast.error(`Error on ${symbol}: ${e.message}`);
            }
        }
        
        toast.success(`🎉 Simulated ${displayData.length} coins! Check positions.`);
        fetchStatus();
        setSimulatingAll(false);
    };

    const toggleActive = () => {
        handleSaveConfig({ ...config, active: !config.active });
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Configuration Card */}
                <Card className="border-l-4 border-l-blue-500 shadow-sm">
                    <CardHeader className="pb-2 flex flex-row items-center justify-between">
                        <CardTitle className="flex items-center gap-2 text-xl">
                            <Settings className="h-5 w-5" /> Bot Configuration
                        </CardTitle>
                        <Button
                            size="sm"
                            onClick={() => handleSaveConfig(config)}
                            disabled={loading}
                        >
                            <Save className="w-4 h-4 mr-2" />
                            Save Config
                        </Button>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-4">
                        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg border">
                            <div className="space-y-0.5">
                                <label className="text-base font-bold">Auto-Trade Status</label>
                                <div className="text-sm text-muted-foreground">
                                    {config.active ? "Bot is currently RUNNING" : "Bot is STOPPED"}
                                </div>
                            </div>
                            <Button
                                variant={config.active ? "destructive" : "default"}
                                onClick={toggleActive}
                                className="w-32"
                                disabled={loading}
                            >
                                {config.active ? <><Square className="w-4 h-4 mr-2 fill-current" /> Stop</> : <><Play className="w-4 h-4 mr-2 fill-current" /> Start</>}
                            </Button>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium leading-none">Amount Per Trade ($)</label>
                                <Input
                                    type="number"
                                    value={(config.total_investment / (config.max_trades || 1)).toFixed(2)}
                                    onChange={(e) => {
                                        const perTrade = parseFloat(e.target.value) || 0;
                                        setConfig({ ...config, total_investment: perTrade * (config.max_trades || 1) });
                                    }}
                                    onBlur={() => handleSaveConfig(config)}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium leading-none">Max Trades</label>
                                <Input
                                    type="number"
                                    value={config.max_trades}
                                    onChange={(e) => {
                                        const newMax = parseInt(e.target.value) || 1;
                                        const currentPerTrade = config.total_investment / (config.max_trades || 1);
                                        setConfig({ ...config, max_trades: newMax, total_investment: currentPerTrade * newMax });
                                    }}
                                    onBlur={() => handleSaveConfig(config)}
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    Total Exposure: ${(config.total_investment).toFixed(2)}
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium leading-none">Leverage (x)</label>
                                <Input
                                    type="number"
                                    value={config.leverage}
                                    onChange={(e) => setConfig({ ...config, leverage: e.target.value })}
                                    onBlur={() => handleSaveConfig(config)}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium leading-none">Min Spread Diff (%)</label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    value={config.min_diff}
                                    onChange={(e) => setConfig({ ...config, min_diff: e.target.value })}
                                    onBlur={() => handleSaveConfig(config)}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium leading-none">Max Price Diff (%)</label>
                                <Input
                                    type="number"
                                    step="0.1"
                                    value={config.max_price_diff}
                                    onChange={(e) => setConfig({ ...config, max_price_diff: e.target.value })}
                                    onBlur={() => handleSaveConfig(config)}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium leading-none">Entry Window (Seconds)</label>
                                <Input
                                    type="number"
                                    value={config.entry_window}
                                    onChange={(e) => setConfig({ ...config, entry_window: e.target.value })}
                                    onBlur={() => handleSaveConfig(config)}
                                    placeholder="300"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    Trade {config.entry_window || 300}s before funding
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 pt-1">
                            {/* Auto Exit Toggle */}
                            <div className="flex flex-col space-y-3">
                                <label className="text-sm font-medium leading-none">Auto-Exit after Funding</label>
                                <div className="flex items-center gap-2">
                                    <span className={`text-xs ${!config.auto_exit ? "font-bold text-red-500" : "text-muted-foreground"}`}>Manual</span>
                                    <Switch
                                        checked={config.auto_exit}
                                        onCheckedChange={(val) => handleSaveConfig({ ...config, auto_exit: val })}
                                    />
                                    <span className={`text-xs ${config.auto_exit ? "font-bold text-green-500" : "text-muted-foreground"}`}>Auto</span>
                                </div>
                            </div>
                        </div>

                        {/* Scheduling */}
                        <div className="space-y-2 border-t pt-4">
                            <label className="text-sm font-medium leading-none flex items-center gap-2">
                                <Activity className="w-4 h-4" /> Active Hours (Schedule)
                            </label>
                            <div className="flex items-center gap-2">
                                <Input
                                    type="time"
                                    value={config.start_time}
                                    onChange={(e) => setConfig({ ...config, start_time: e.target.value })}
                                    onBlur={() => handleSaveConfig(config)}
                                    className="w-full"
                                />
                                <span className="text-sm font-bold">-</span>
                                <Input
                                    type="time"
                                    value={config.end_time}
                                    onChange={(e) => setConfig({ ...config, end_time: e.target.value })}
                                    onBlur={() => handleSaveConfig(config)}
                                    className="w-full"
                                />
                            </div>
                        </div>

                        {/* Advanced Timing */}
                        <div className="space-y-4 border-t pt-4 mt-4">
                            <label className="text-sm font-bold leading-none flex items-center gap-2 text-primary">
                                <Settings className="w-4 h-4" /> Advanced Timing
                            </label>

                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <label className="text-sm font-medium">Ignore Timing Checks</label>
                                    <p className="text-[10px] text-muted-foreground">Force trade next funding candidates regardless of time</p>
                                </div>
                                <Switch
                                    checked={config.ignore_timing}
                                    onCheckedChange={(val) => handleSaveConfig({ ...config, ignore_timing: val })}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-medium uppercase text-muted-foreground">Enter Before (sec)</label>
                                    <Input
                                        type="number"
                                        value={config.entry_before_seconds}
                                        onChange={(e) => setConfig({ ...config, entry_before_seconds: parseInt(e.target.value) || 60 })}
                                        onBlur={() => handleSaveConfig(config)}
                                        placeholder="60"
                                    />
                                    <p className="text-[10px] text-muted-foreground">
                                        = {((config.entry_before_seconds || 60) / 60).toFixed(1)} min before funding
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-medium uppercase text-muted-foreground">Exit After (sec)</label>
                                    <Input
                                        type="number"
                                        value={config.exit_after_seconds}
                                        onChange={(e) => setConfig({ ...config, exit_after_seconds: parseInt(e.target.value) || 30 })}
                                        onBlur={() => handleSaveConfig(config)}
                                        placeholder="30"
                                    />
                                    <p className="text-[10px] text-muted-foreground">
                                        = {((config.exit_after_seconds || 30) / 60).toFixed(1)} min after entry
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t mt-2">
                            <label className="text-sm font-medium leading-none">Execution Mode</label>
                            <div className="flex items-center gap-2">
                                <span className={`text-sm ${!config.is_live ? "font-bold text-amber-500" : "text-muted-foreground"}`}>Testnet</span>
                                <Switch
                                    checked={config.is_live}
                                    onCheckedChange={(val) => handleSaveConfig({ ...config, is_live: val })}
                                />
                                <span className={`text-sm ${config.is_live ? "font-bold text-green-500" : "text-muted-foreground"}`}>Live</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Status Card */}
                <Card className="shadow-sm">
                    <CardHeader className="pb-2 flex flex-row items-center justify-between">
                        <CardTitle className="flex items-center gap-2 text-xl">
                            <Activity className="h-5 w-5" /> Activity Monitor
                        </CardTitle>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleForceTrade}
                            className="bg-red-500/10 hover:bg-red-500/20 text-red-500 border-red-500/50"
                        >
                            <TrendingUp className="w-4 h-4 mr-2" /> Force Test Trade
                        </Button>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 rounded-lg bg-secondary/20 border flex flex-col items-center justify-center">
                                <span className="text-3xl font-black text-primary">{status.active_trades}</span>
                                <span className="text-xs text-muted-foreground uppercase tracking-wider">Active Trades</span>
                            </div>
                            <div className="p-4 rounded-lg bg-secondary/20 border flex flex-col items-center justify-center">
                                <span className="text-3xl font-black text-green-600">--</span>
                                <span className="text-xs text-muted-foreground uppercase tracking-wider">Est. PnL</span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none">Live Logs</label>
                            <ScrollArea className="h-[250px] border rounded-md bg-black/90 p-2 font-mono text-xs">
                                {status.logs.length === 0 ? (
                                    <div className="text-gray-500 italic p-2">Waiting for activity...</div>
                                ) : (
                                    status.logs.map((log, i) => (
                                        <div key={i} className="mb-1 border-b border-white/10 pb-1 last:border-0">
                                            <span className="text-gray-400">[{new Date(log.time * 1000).toLocaleTimeString()}]</span>{" "}
                                            <span className={`font-bold ${log.type === 'ENTRY' ? 'text-blue-400' : 'text-amber-400'}`}>{log.type}</span>{" "}
                                            <span className="text-white">{log.symbol}</span>{" "}
                                            <span className="text-gray-300">- {log.msg}</span>
                                            {log.error && <div className="text-red-500 pl-4">Error: {log.error}</div>}
                                        </div>
                                    ))
                                )}
                            </ScrollArea>
                        </div>
                    </CardContent>
                </Card>

                {/* Radar / Pending Opportunities Card */}
                <Card className="shadow-sm border-l-4 border-l-purple-500">
                    <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <Activity className="h-5 w-5 text-purple-500" /> Coins in Radar (Next Funding)
                            </CardTitle>
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-3 text-xs bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white border-0"
                                disabled={simulatingAll}
                                onClick={handleSimulateAll}
                                title="Simulate trades for top 3 coins"
                            >
                                {simulatingAll ? (
                                    <span className="animate-pulse">Simulating...</span>
                                ) : (
                                    <>🎯 Sim All Top 3</>
                                )}
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Trades planned for next funding window ({config.ignore_timing ? "TIMING IGNORED" : `Entry: -${config.entry_before_seconds || 60}s`})
                        </p>
                        {/* Display current filter settings */}
                        <div className="mt-2 p-2 bg-purple-500/10 rounded-md border border-purple-500/20">
                            <p className="text-xs font-semibold text-purple-400 mb-1">🎯 Current Filters (TOP COINS):</p>
                            <div className="flex flex-wrap gap-2 text-xs">
                                <Badge variant="outline" className="bg-purple-500/20 border-purple-500/30">
                                    Min Spread: {config.min_diff}%
                                </Badge>
                                <Badge variant="outline" className="bg-purple-500/20 border-purple-500/30">
                                    Max Price Diff: {config.max_price_diff}%
                                </Badge>
                                <Badge variant="outline" className="bg-purple-500/20 border-purple-500/30">
                                    Mode: {config.is_live ? '🔴 LIVE' : '🟡 TESTNET'}
                                </Badge>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="pt-2">
                        <ScrollArea className="h-[200px] pr-2">
                            {/* Show pending_opportunities if auto-trade is ON, otherwise show topOpportunities */}
                            {(() => {
                                const displayData = (config.active && status.pending_opportunities?.length > 0) 
                                    ? status.pending_opportunities 
                                    : topOpportunities.slice(0, 10);
                                
                                if (!displayData || displayData.length === 0) {
                                    return (
                                        <div className="text-sm text-muted-foreground p-4 text-center">
                                            <p className="mb-2">🔍 Scanning for opportunities...</p>
                                            <p className="text-xs opacity-70">
                                                Looking for coins with &gt;{config.min_diff}% spread and &lt;{config.max_price_diff}% price diff
                                            </p>
                                        </div>
                                    );
                                }
                                
                                return (
                                    <div className="space-y-2">
                                        {displayData.map((item) => {
                                            // Handle both pending_opportunities and topOpportunities structures
                                            const symbol = item.symbol;
                                            const binanceRate = item.binance_rate || item.binanceRate || 0;
                                            const bybitRate = item.bybit_rate || item.bybitRate || 0;
                                            const rateDiff = item.rate_diff || Math.abs(item.diff) || 0;
                                            const nextFunding = item.nextFundingTime || 0;
                                            
                                            return (
                                                <div key={symbol} className="flex items-center justify-between p-2 rounded bg-secondary/30 border text-xs">
                                                    <div className="flex flex-col">
                                                        <span className="font-bold flex items-center gap-1">
                                                            <img
                                                                src={`https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${symbol.toLowerCase()}.png`}
                                                                alt={symbol}
                                                                className="w-3 h-3 rounded-full"
                                                                onError={(e) => { e.target.src = "https://placehold.co/20x20?text=?"; }}
                                                            />
                                                            {symbol}
                                                        </span>
                                                        <span className="text-muted-foreground">
                                                            BN: {(binanceRate * 100).toFixed(4)}% | BB: {(bybitRate * 100).toFixed(4)}%
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex flex-col items-end">
                                                            <span className="font-black text-green-500">
                                                                {(rateDiff * 100).toFixed(4)}%
                                                            </span>
                                                            <span className="text-muted-foreground font-mono text-[10px]">
                                                                {(() => {
                                                                    if (!nextFunding) return '-';
                                                                    const diff = nextFunding - Date.now();
                                                                    if (diff <= 0) return 'Now';
                                                                    const h = Math.floor(diff / 3600000);
                                                                    const m = Math.floor((diff % 3600000) / 60000);
                                                                    return h > 0 ? `${h}h ${m}m` : `${m}m`;
                                                                })()}
                                                            </span>
                                                        </div>
                                                        <Button
                                                            size="sm"
                                                            variant="default"
                                                            className="h-7 px-2 text-[10px] bg-purple-600 hover:bg-purple-700"
                                                            disabled={simulatingSymbol === symbol}
                                                            onClick={() => handleSimulateTrade(symbol)}
                                                            title={`Simulate trade - Exit in ${((config.exit_after_seconds || 30) / 60).toFixed(1)} min`}
                                                        >
                                                            {simulatingSymbol === symbol ? (
                                                                <span className="animate-pulse">...</span>
                                                            ) : (
                                                                <>▶ Sim</>  
                                                            )}
                                                        </Button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })()}
                        </ScrollArea>
                    </CardContent>
                </Card>
            </div>

            {/* Top Opportunities Card */}
            <Card className="border-t-4 border-t-green-500 shadow-sm">
                <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-xl">
                        <TrendingUp className="h-5 w-5 text-green-600" />
                        Top 5 Opportunities (Live)
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                        Current best arbitrage pairs detected by the scanner.
                    </p>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <div className="grid grid-cols-7 p-3 font-medium bg-muted/40 text-sm">
                            <div className="col-span-1">Symbol</div>
                            <div className="text-right">Binance</div>
                            <div className="text-right">Bybit</div>
                            <div className="text-right">Price Diff</div>
                            <div className="text-right">Funding Diff</div>
                            <div className="text-right">Next Funding</div>
                            <div className="text-right">Spread</div>
                        </div>
                        {topOpportunities.length === 0 ? (
                            <div className="p-6 text-center text-muted-foreground italic">
                                No significant opportunities found yet.
                            </div>
                        ) : (
                            topOpportunities.map(item => (
                                <div key={item.symbol} className="grid grid-cols-7 p-3 border-t text-sm items-center hover:bg-muted/20">
                                    <div className="font-bold flex items-center gap-2">
                                        <img
                                            src={`https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${item.symbol.toLowerCase()}.png`}
                                            alt={item.symbol}
                                            className="w-5 h-5 rounded-full"
                                            onError={(e) => { e.target.src = "https://placehold.co/20x20?text=?"; }}
                                        />
                                        {item.symbol}
                                    </div>
                                    <div className={`text-right ${item.binanceRate > 0 ? "text-green-600" : "text-red-600"}`}>
                                        {(item.binanceRate * 100).toFixed(4)}%
                                    </div>
                                    <div className={`text-right ${item.bybitRate > 0 ? "text-green-600" : "text-red-600"}`}>
                                        {(item.bybitRate * 100).toFixed(4)}%
                                    </div>
                                    {/* Price Diff Column */}
                                    <div className={`text-right font-medium ${(item.priceSpread || 0) < (config.max_price_diff || 2) ? "text-green-600" : "text-red-600"}`}>
                                        {(item.priceSpread || 0).toFixed(2)}%
                                    </div>
                                    <div className={`text-right font-medium ${item.diff > 0 ? "text-green-600" : "text-red-600"}`}>
                                        {item.diff > 0 ? "+" : ""}{(item.diff * 100).toFixed(4)}%
                                    </div>
                                    {/* Next Funding Column */}
                                    <div className="text-right font-mono text-xs text-muted-foreground">
                                        {(() => {
                                            if (!item.nextFundingTime) return '-';
                                            const diff = item.nextFundingTime - Date.now();
                                            if (diff <= 0) return 'Now';
                                            const h = Math.floor(diff / (1000 * 60 * 60));
                                            const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                                            return `${h}h ${m}m`;
                                        })()}
                                    </div>
                                    <div className="text-right font-black">
                                        {(Math.abs(item.diff) * 100).toFixed(4)}%
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
