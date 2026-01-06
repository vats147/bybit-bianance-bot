import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/components/ui/toast";
import { Play, Square, Activity, Settings, TrendingUp, Save, Zap, Clock, Terminal, Trash2 } from "lucide-react";

// Compact Input Helper - Moved OUTSIDE to prevent re-creation on render
const SettingInput = ({ label, value, onChange, type = "number", step = "1", suffix = "" }) => (
    <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase font-bold text-muted-foreground">{label}</label>
        <div className="flex items-center gap-2">
            <Input
                type={type}
                step={step}
                value={value}
                onChange={onChange}
                className="h-7 text-xs px-2"
            />
            {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
        </div>
    </div>
);

export function AutoTradePage({ topOpportunities = [], allMarketData = [], isLive = false }) {
    const [config, setConfig] = useState({
        active: false,
        total_investment: 100,
        max_trades: 1,
        leverage: 10,
        min_diff: 0.5,
        is_live: isLive,
        start_time: "00:00",
        end_time: "23:59",
        max_price_diff: 2.0,
        auto_exit: true,
        entry_before_seconds: 300,
        exit_after_seconds: 30,
        ignore_timing: false
    });

    const [status, setStatus] = useState({ active_trades: 0, active_positions: [], logs: [], pending_opportunities: [] });
    const [loading, setLoading] = useState(false);
    const toast = useToast();
    const logsEndRef = React.useRef(null);

    // Auto-scroll logs
    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [status.logs]);

    // Helper to get backend URL
    const getBackendUrl = () => localStorage.getItem("primary_backend_url") || "http://127.0.0.1:8000";

    const fetchStatus = async (shouldUpdateConfig = false) => {
        try {
            const res = await fetch(`${getBackendUrl()}/api/auto-trade/status`);
            if (res.ok) {
                const data = await res.json();
                if (shouldUpdateConfig) {
                    setConfig(prev => ({ ...prev, ...data.config }));
                }
                setStatus({
                    active_trades: data.active_trades,
                    active_positions: data.active_positions || [],
                    logs: data.logs.reverse(),
                    pending_opportunities: data.pending_opportunities || []
                });
            }
        } catch (e) {
            console.error("Status fetch failed", e);
        }
    };

    useEffect(() => {
        fetchStatus(true);
        const interval = setInterval(() => fetchStatus(false), 2000);
        return () => clearInterval(interval);
    }, []);

    const handleRemoveTrade = async (symbol) => {
        if (!window.confirm(`Are you sure you want to CLOSE and REMOVE ${symbol}? This will attempt to exit positions on both exchanges.`)) {
            return;
        }

        try {
            await fetch(`${getBackendUrl()}/api/auto-trade/trade/${symbol}?close_on_exchange=true`, { method: 'DELETE' });

            // Optimistic update
            setStatus(prev => ({
                ...prev,
                active_positions: prev.active_positions.filter(p => p.symbol !== symbol),
                active_trades: Math.max(0, prev.active_trades - 1)
            }));

            toast.success(`Closed and Removed ${symbol}`);
        } catch (e) {
            toast.error("Remove failed");
        }
    };

    const handleSaveConfig = async (newConfig) => {
        setLoading(true);
        try {
            const headers = { "Content-Type": "application/json" };
            const ks = ["user_binance_key", "user_binance_secret", "user_bybit_key", "user_bybit_secret"];
            ks.forEach(k => {
                const v = localStorage.getItem(k);
                if (v) headers[`X-${k.replace(/_/g, '-').replace('user', 'User').replace(/\b\w/g, l => l.toUpperCase())}`] = v;
            });

            if (localStorage.getItem("user_binance_key")) headers["X-User-Binance-Key"] = localStorage.getItem("user_binance_key");
            if (localStorage.getItem("user_binance_secret")) headers["X-User-Binance-Secret"] = localStorage.getItem("user_binance_secret");
            if (localStorage.getItem("user_bybit_key")) headers["X-User-Bybit-Key"] = localStorage.getItem("user_bybit_key");
            if (localStorage.getItem("user_bybit_secret")) headers["X-User-Bybit-Secret"] = localStorage.getItem("user_bybit_secret");

            const res = await fetch(`${getBackendUrl()}/api/auto-trade/config`, {
                method: "POST",
                headers,
                body: JSON.stringify(newConfig || config)
            });

            if (res.ok) {
                const data = await res.json();
                setConfig(data.config);
                toast.success("Settings Saved");
            } else {
                toast.error("Save Failed");
            }
        } catch (e) {
            toast.error(e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-[calc(100vh-140px)] flex flex-col gap-4 overflow-hidden animate-in fade-in">
            {/* Top Bar: Status & Main Toggle */}
            <div className="flex items-center justify-between bg-card border rounded-lg p-3 shadow-sm shrink-0">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Activity className={`w-5 h-5 ${config.active ? "text-green-500 animate-pulse" : "text-gray-400"}`} />
                        <span className="font-bold text-sm">
                            Status: <span className={config.active ? "text-green-500" : "text-muted-foreground"}>{config.active ? "RUNNING" : "STOPPED"}</span>
                        </span>
                    </div>
                    <div className="h-4 w-[1px] bg-border" />
                    <div className="text-xs text-muted-foreground">
                        Execution: <b className={config.is_live ? "text-green-600" : "text-amber-500"}>{config.is_live ? "LIVE MONEY" : "PAPER TRADING (TESTNET)"}</b>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        size="sm"
                        variant={config.active ? "destructive" : "default"}
                        className="h-8 text-xs font-bold"
                        onClick={() => handleSaveConfig({ ...config, active: !config.active })}
                    >
                        {config.active ? <><Square className="w-3 h-3 mr-2" /> STOP BOT</> : <><Play className="w-3 h-3 mr-2" /> START BOT</>}
                    </Button>
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-12 gap-4 h-full min-h-0">

                {/* LEFT COL: Settings (Span 3) */}
                <Card className="col-span-3 h-full flex flex-col shadow-sm border-l-4 border-l-blue-500">
                    <CardHeader className="py-2 px-4 border-b bg-muted/20 flex flex-row items-center justify-between">
                        <CardTitle className="text-sm font-bold flex items-center gap-2">
                            <Settings className="w-4 h-4" /> Configuration
                        </CardTitle>
                        <Button
                            size="sm"
                            variant="default"
                            className="h-6 text-xs gap-1"
                            onClick={() => handleSaveConfig(config)}
                            disabled={loading}
                        >
                            <Save className="w-3 h-3" /> Save
                        </Button>
                    </CardHeader>
                    <ScrollArea className="flex-1">
                        <CardContent className="space-y-4 p-4">
                            <div className="space-y-3">
                                <h4 className="text-xs font-black text-primary border-b pb-1">Money Management</h4>
                                <SettingInput
                                    label="Inv. Amount ($)"
                                    value={config.total_investment}
                                    onChange={(e) => setConfig({ ...config, total_investment: parseFloat(e.target.value) || 0 })}
                                />
                                <SettingInput
                                    label="Leverage (x)"
                                    value={config.leverage}
                                    onChange={(e) => setConfig({ ...config, leverage: parseFloat(e.target.value) || 1 })}
                                />
                                <SettingInput
                                    label="Max Positions"
                                    value={config.max_trades}
                                    onChange={(e) => setConfig({ ...config, max_trades: parseInt(e.target.value) || 1 })}
                                />
                            </div>

                            <div className="space-y-3 pt-2">
                                <h4 className="text-xs font-black text-primary border-b pb-1">Risk & Filters</h4>
                                <SettingInput
                                    label="Min Spread (%)"
                                    step="0.01"
                                    value={config.min_diff}
                                    onChange={(e) => setConfig({ ...config, min_diff: parseFloat(e.target.value) || 0 })}
                                />
                                <SettingInput
                                    label="Max Price Diff (%)"
                                    step="0.1"
                                    value={config.max_price_diff}
                                    onChange={(e) => setConfig({ ...config, max_price_diff: parseFloat(e.target.value) || 0 })}
                                />
                            </div>

                            <div className="space-y-3 pt-2">
                                <h4 className="text-xs font-black text-primary border-b pb-1 flex justify-between">
                                    Timing
                                    <Clock className="w-3 h-3" />
                                </h4>
                                <SettingInput
                                    label="Enter Seconds Before"
                                    value={config.entry_before_seconds}
                                    suffix="sec"
                                    onChange={(e) => setConfig({ ...config, entry_before_seconds: parseInt(e.target.value) || 60 })}
                                />
                                <SettingInput
                                    label="Exit Seconds After"
                                    value={config.exit_after_seconds}
                                    suffix="sec"
                                    onChange={(e) => setConfig({ ...config, exit_after_seconds: parseInt(e.target.value) || 30 })}
                                />
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-bold text-muted-foreground">Auto-Exit</label>
                                    <Switch
                                        className="scale-75 origin-right"
                                        checked={config.auto_exit}
                                        onCheckedChange={(v) => setConfig({ ...config, auto_exit: v })}
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-bold text-muted-foreground">Ignore Time (Force)</label>
                                    <Switch
                                        className="scale-75 origin-right"
                                        checked={config.ignore_timing}
                                        onCheckedChange={(v) => setConfig({ ...config, ignore_timing: v })}
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </ScrollArea>
                </Card>

                {/* MIDDLE COL: Radar (Span 5) */}
                <Card className="col-span-5 h-full flex flex-col shadow-sm border-l-4 border-l-purple-500">
                    <CardHeader className="py-3 px-4 border-b bg-muted/20 flex flex-row items-center justify-between">
                        <CardTitle className="text-sm font-bold flex items-center gap-2">
                            <Zap className="w-4 h-4" /> Opportunities Radar
                        </CardTitle>
                        <Badge variant="outline" className="text-[10px] font-mono">
                            {status.pending_opportunities.length} found
                        </Badge>
                    </CardHeader>
                    <div className="flex-1 overflow-hidden p-0 bg-secondary/5">
                        {/* Header Row */}
                        <div className="grid grid-cols-6 px-4 py-2 text-[10px] font-bold text-muted-foreground border-b gap-2">
                            <div>SYMBOL</div>
                            <div className="text-right">PRICES (BN/BB)</div>
                            <div className="text-right cursor-help" title="Price Difference %">P.DIFF</div>
                            <div className="text-right">RATES (BN/BB)</div>
                            <div className="text-right">SPREAD</div>
                            <div className="text-right">TIME</div>
                        </div>
                        <ScrollArea className="h-full">
                            <div className="divide-y divide-border/50">
                                {status.pending_opportunities.length === 0 ? (
                                    <div className="p-8 text-center text-xs text-muted-foreground italic">
                                        Scanning market...<br />(Min Spread: {config.min_diff}%)
                                    </div>
                                ) : (
                                    status.pending_opportunities.map(op => {
                                        // LIVE MERGE LOGIC
                                        // If we have live market data from props, override the Polled data
                                        const live = allMarketData ? allMarketData.find(d => d.symbol === op.symbol) : null;
                                        const item = live ? {
                                            ...op,
                                            markPrice: live.markPrice,
                                            bybitPrice: live.bybitPrice,
                                            // Keep priceDiff from live if possible, else backend
                                            priceDiff: live.priceDiff || op.priceDiff,
                                            binance_rate: live.binanceRate,
                                            bybit_rate: live.bybitRate,
                                            rate_diff: live.diff
                                        } : op;

                                        return (
                                            <div key={item.symbol} className="grid grid-cols-6 px-4 py-2 text-xs hover:bg-muted/50 items-center gap-2">
                                                {/* 1. Symbol */}
                                                <div className="font-bold flex items-center gap-2 overflow-hidden">
                                                    <img
                                                        src={`https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${item.symbol.toLowerCase()}.png`}
                                                        className="w-4 h-4 rounded-full shrink-0"
                                                        onError={(e) => { e.target.style.display = 'none'; }}
                                                    />
                                                    <span className="truncate">{item.symbol}</span>
                                                </div>

                                                {/* 2. Prices (BN / BB) */}
                                                <div className="text-right flex flex-col text-[10px] items-end font-mono text-muted-foreground leading-tight">
                                                    <span className="text-foreground transition-all duration-300">{Number(item.markPrice).toLocaleString()}</span>
                                                    <span className="opacity-70 transition-all duration-300">{Number(item.bybitPrice).toLocaleString()}</span>
                                                </div>

                                                {/* 3. Price Diff */}
                                                <div className={`text-right font-mono text-[10px] font-bold ${item.priceDiff > config.max_price_diff ? "text-red-500" : "text-blue-500"}`}>
                                                    {Number(item.priceDiff).toFixed(2)}%
                                                </div>

                                                {/* 4. Rates (BN / BB) */}
                                                <div className="text-right flex flex-col text-[10px] items-end font-mono text-muted-foreground leading-tight">
                                                    <span className={item.binance_rate > 0 ? "text-green-500" : "text-red-500"}>{(Number(item.binance_rate) * 100).toFixed(4)}%</span>
                                                    <span className={item.bybit_rate > 0 ? "text-green-500" : "text-red-500"}>{(Number(item.bybit_rate) * 100).toFixed(4)}%</span>
                                                </div>

                                                {/* 5. Spread */}
                                                <div className="text-right font-mono text-xs font-black text-green-600">
                                                    {(Number(item.rate_diff) * 100).toFixed(4)}%
                                                </div>

                                                {/* 6. Time (Dual) */}
                                                <div className="text-right flex flex-col text-[10px] items-end font-mono text-muted-foreground leading-tight">
                                                    <TimeDisplay ms={item.nextFundingTime} label="BN" />
                                                    <TimeDisplay ms={item.nextFundingTimeBybit || item.nextFundingTime} label="BB" />
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </ScrollArea>
                    </div>
                </Card>

                {/* RIGHT COL: Logs & Terminal (Span 4) */}
                <div className="col-span-4 h-full flex flex-col gap-4">
                    {/* Active Trades */}
                    <Card className="flex-1 shadow-sm border-l-4 border-l-green-500 flex flex-col min-h-0">
                        <CardHeader className="py-2 px-4 border-b bg-muted/20">
                            <CardTitle className="text-sm font-bold flex items-center justify-between">
                                <span className="flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Active Trades</span>
                                <Badge variant="secondary" className="font-mono text-xs">{status.active_trades}</Badge>
                            </CardTitle>
                        </CardHeader>
                        <ScrollArea className="flex-1">
                            {status.active_trades === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center bg-black/5 opacity-50 p-4">
                                    <div className="text-3xl font-black text-muted-foreground/30 mb-1">0</div>
                                    <div className="text-[10px] uppercase font-bold text-muted-foreground/50">Active</div>
                                </div>
                            ) : (
                                <div className="divide-y divide-border/50">
                                    {status.active_positions?.map((pos, idx) => {
                                        // Calculate Live PnL
                                        const live = allMarketData ? allMarketData.find(d => d.symbol === pos.symbol) : null;
                                        const currentPriceBN = live?.markPrice || pos.entry_price_binance || 0;
                                        const currentPriceBB = live?.bybitPrice || pos.entry_price_bybit || 0;

                                        // Directions
                                        const dirBN = pos.sides.binance === 'Buy' ? 1 : -1;
                                        const dirBB = pos.sides.bybit === 'Buy' ? 1 : -1;

                                        // Current Value
                                        const valBN = pos.qty_binance * currentPriceBN;
                                        const valBB = pos.qty_bybit * currentPriceBB;

                                        // Entry Value
                                        const entryValBN = pos.qty_binance * pos.entry_price_binance;
                                        const entryValBB = pos.qty_bybit * pos.entry_price_bybit;

                                        // UPNL = (CurrentVal - EntryVal) * Direction
                                        // Wait, for Short: (EntryPrice - CurrentPrice) * Qty
                                        // Which is (EntryVal - CurrentVal).
                                        // Standard Formula: Value * (Mark - Entry) / Entry * Side?? No.
                                        // Linear Contract PnL = (ExitPrice - EntryPrice) * Qty * Side
                                        const pnlBN = (currentPriceBN - pos.entry_price_binance) * pos.qty_binance * dirBN;
                                        const pnlBB = (currentPriceBB - pos.entry_price_bybit) * pos.qty_bybit * dirBB;
                                        const totalPnL = pnlBN + pnlBB;

                                        // Est Funding
                                        // Funding = PositionValue * Rate * -1 (if paying)
                                        // If Short (Sell), we Pay if Rate < 0? No.
                                        // Funding Fee = Nominal Value * Funding Rate
                                        // If Long, Pay if Rate > 0. Receive if Rate < 0.
                                        // If Short, Pay if Rate < 0. Receive if Rate > 0.
                                        // Standard: CashFlow = -1 * PositionSize * Price * Rate
                                        // PositionSize is + for Long, - for Short.
                                        const rateBN = live?.binanceRate || 0;
                                        const rateBB = live?.bybitRate || 0;

                                        const feeBN = -1 * (pos.qty_binance * currentPriceBN * dirBN) * rateBN;
                                        const feeBB = -1 * (pos.qty_bybit * currentPriceBB * dirBB) * rateBB;
                                        const totalFunding = feeBN + feeBB;

                                        return (
                                            <div key={idx} className="p-3 text-xs hover:bg-muted/50 transition-colors">
                                                <div className="flex items-center justify-between mb-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold">{pos.symbol}</span>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6 text-red-500 hover:bg-red-100 hover:text-red-700 transition-colors"
                                                            onClick={() => handleRemoveTrade(pos.symbol)}
                                                            title="Close Position & Remove"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                    <span className={`font-mono font-bold ${totalPnL >= 0 ? "text-green-600" : "text-red-500"}`}>
                                                        {totalPnL >= 0 ? "+" : ""}{totalPnL.toFixed(2)} USDT
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                                    <div className="flex gap-2">
                                                        <span>Est. Fees: <b className="text-green-600">+{totalFunding.toFixed(3)}</b></span>
                                                    </div>
                                                    <TimeDisplay ms={pos.nft} label="Next" />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </ScrollArea>
                    </Card>

                    {/* Live Terminal */}
                    <Card className="flex-1 shadow-sm border-l-4 border-l-black flex flex-col min-h-0 bg-black text-green-400 font-mono text-xs">
                        <CardHeader className="py-2 px-4 border-b border-green-900/30 bg-green-900/10">
                            <CardTitle className="text-xs font-bold flex items-center gap-2">
                                <Terminal className="w-3 h-3" /> Live Terminal
                            </CardTitle>
                        </CardHeader>
                        <ScrollArea className="flex-1 p-2">
                            <div className="flex flex-col gap-1">
                                {status.logs.length === 0 && <span className="opacity-50 italic">System ready...</span>}
                                {status.logs.map((log, i) => (
                                    <div key={i} className="flex gap-2">
                                        <span className="opacity-50">[{new Date(log.time * 1000).toLocaleTimeString()}]</span>
                                        <span className={log.type === "EXIT" ? "text-amber-400 font-bold" : "text-green-300"}>
                                            {log.msg || `Action on ${log.symbol}`}
                                        </span>
                                    </div>
                                ))}
                                <div ref={logsEndRef} />
                            </div>
                        </ScrollArea>
                    </Card>
                </div>

            </div>
        </div >
    );
}

// Helper for Time Display
const TimeDisplay = ({ ms, label }) => {
    if (!ms) return <span className="opacity-30">-</span>;
    const diff = ms - Date.now();
    const mins = Math.floor(diff / 60000);
    const hrs = Math.floor(mins / 60);
    const m = mins % 60;

    // Highlight if < 1 hour
    const isUrgent = hrs === 0 && m < 60;

    return (
        <span className={`${isUrgent ? "text-amber-500 font-bold" : "text-muted-foreground"}`}>
            <span className="text-[8px] opacity-70 mr-1">{label}:</span>
            {hrs}h {m}m
        </span>
    );
};
