import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, DollarSign, History, TrendingUp, RefreshCw, BarChart3, Database } from "lucide-react";
import { useToast } from "@/components/ui/toast";

export function PnLPage() {
    const [overview, setOverview] = useState(null);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [rebuilding, setRebuilding] = useState(false);
    const toast = useToast();

    // Helper to get backend URL (reused logic)
    const getBackendUrl = () => {
        const saved = localStorage.getItem("primary_backend_url");
        const hostname = window.location.hostname;
        const isLocalNetworkIP = /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
        if (isLocalNetworkIP) {
            const localBackend = `http://${hostname}:8000`;
            if (saved && (saved.includes(hostname) || saved.includes("localhost") || saved.includes("127.0.0.1"))) return saved;
            return localBackend;
        }
        if (hostname === "localhost" || hostname === "127.0.0.1") return saved || "http://localhost:8000";
        return saved || "https://bybit-bianance-bot.onrender.com";
    };

    const fetchData = async () => {
        try {
            setLoading(true);
            const url = getBackendUrl();
            const [resOverview, resHistory] = await Promise.all([
                fetch(`${url}/api/pnl/overview`),
                fetch(`${url}/api/pnl/history`)
            ]);
            if (resOverview.ok) {
                const data = await resOverview.json();
                setOverview(data);
            }
            if (resHistory.ok) {
                const data = await resHistory.json();
                setHistory(data);
            }
        } catch (error) {
            console.error("PnL Fetch Error:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleRebuildHistory = async () => {
        if (!confirm("This will scan your Bybit Transaction Logs (Last 50 entries) and attempt to reconstruct your trade history. Use this if your local history was lost. Continue?")) return;

        try {
            setRebuilding(true);
            const url = getBackendUrl();

            // Need headers
            const headers = {};
            const isLive = localStorage.getItem("is_live_mode") === "true";

            if (isLive) {
                headers["X-User-Bybit-Key"] = localStorage.getItem("user_bybit_live_key");
                headers["X-User-Bybit-Secret"] = localStorage.getItem("user_bybit_live_secret");
            } else {
                headers["X-User-Bybit-Key"] = localStorage.getItem("user_bybit_demo_key");
                headers["X-User-Bybit-Secret"] = localStorage.getItem("user_bybit_demo_secret");
            }

            const res = await fetch(`${url}/api/pnl/rebuild?is_live=${isLive}`, {
                method: "POST",
                headers: headers
            });
            const data = await res.json();

            if (data.status === "success") {
                toast.toast({
                    title: "History Rebuilt",
                    description: `Recovered ${data.added} trades from exchange logs.`,
                });
                fetchData();
            } else {
                alert("Failed: " + data.msg);
            }
        } catch (e) {
            alert("Error: " + e.message);
        } finally {
            setRebuilding(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, []);

    const { total_pnl, total_trades, pnl_24h } = overview?.summary || {};
    const activeCount = overview?.active_trades?.count || 0;

    return (
        <div className="space-y-6 animate-in fade-in duration-500 max-w-7xl mx-auto p-4 md:p-8">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 to-teal-600 bg-clip-text text-transparent flex items-center gap-2">
                        <BarChart3 className="text-emerald-500 h-8 w-8" /> Performance & History
                    </h2>
                    <p className="text-muted-foreground mt-1">Real-time P&L tracking and trade analysis</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleRebuildHistory} disabled={rebuilding}>
                        <Database className={`h-4 w-4 mr-2 ${rebuilding ? "animate-pulse" : ""}`} />
                        {rebuilding ? "Scanning..." : "Sync from Exchange"}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={fetchData} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
                    </Button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="bg-gradient-to-br from-emerald-950 to-slate-900 border-emerald-900 shadow-lg shadow-emerald-900/10">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-emerald-400/80">Total Realized P&L</CardTitle>
                        <DollarSign className="h-4 w-4 text-emerald-400" />
                    </CardHeader>
                    <CardContent>
                        <div className={`text-2xl font-black ${(total_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            ${(total_pnl || 0).toFixed(2)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Net funding fees collected</p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-slate-900 to-slate-900 border-slate-800">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">24h P&L</CardTitle>
                        <TrendingUp className="h-4 w-4 text-blue-400" />
                    </CardHeader>
                    <CardContent>
                        <div className={`text-2xl font-bold ${(pnl_24h || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            ${(pnl_24h || 0).toFixed(2)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Last 24 hours performance</p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-slate-900 to-slate-900 border-slate-800">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Total Trades</CardTitle>
                        <History className="h-4 w-4 text-purple-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-foreground">{total_trades || 0}</div>
                        <p className="text-xs text-muted-foreground mt-1">Completed arbitrage cycles</p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-slate-900 to-slate-900 border-slate-800">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Active Positions</CardTitle>
                        <Activity className="h-4 w-4 text-amber-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-foreground">{activeCount}</div>
                        <p className="text-xs text-muted-foreground mt-1">Currently open trades</p>
                    </CardContent>
                </Card>
            </div>

            {/* Active Positions Table */}
            <Card className="border-border/40 shadow-md bg-card/50 backdrop-blur-sm border-l-4 border-l-amber-500">
                <CardHeader>
                    <CardTitle className="text-amber-500 flex items-center gap-2">
                        <Activity className="h-5 w-5" /> Active Positions (Live)
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent border-border/50">
                                <TableHead className="text-muted-foreground">Entry Time</TableHead>
                                <TableHead className="text-muted-foreground">Symbol</TableHead>
                                <TableHead className="text-muted-foreground">Sides</TableHead>
                                <TableHead className="text-right text-muted-foreground">Qty</TableHead>
                                <TableHead className="text-right text-muted-foreground">Invested</TableHead>
                                <TableHead className="text-right text-muted-foreground">Next Funding</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {overview?.active_trades?.list?.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground italic bg-muted/20">
                                        No active positions currently open.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                overview?.active_trades?.list?.map((trade, idx) => (
                                    <TableRow key={trade.symbol + idx} className="hover:bg-muted/50 border-border/50">
                                        <TableCell className="font-mono text-xs text-muted-foreground">
                                            {new Date(trade.entry_time * 1000).toLocaleTimeString()}
                                        </TableCell>
                                        <TableCell className="font-bold text-lg flex items-center gap-2">
                                            <img
                                                src={`https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${trade.symbol.toLowerCase()}.png`}
                                                className="w-5 h-5 rounded-full"
                                                onError={(e) => e.target.style.display = 'none'}
                                            />
                                            {trade.symbol}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex gap-2">
                                                <Badge variant="outline" className={trade.sides?.binance === 'Buy' ? 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10' : 'text-rose-500 border-rose-500/30 bg-rose-500/10'}>
                                                    BN: {trade.sides?.binance}
                                                </Badge>
                                                <Badge variant="outline" className={trade.sides?.bybit === 'Buy' ? 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10' : 'text-rose-500 border-rose-500/30 bg-rose-500/10'}>
                                                    BB: {trade.sides?.bybit}
                                                </Badge>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-foreground font-bold">
                                            {trade.qty}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-amber-500 font-medium">
                                            ${Math.round(trade.amount || 0)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                                            {trade.nft ? new Date(trade.nft).toLocaleTimeString() : '-'}
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Trade History Table */}
            <Card className="border-border/40 shadow-md bg-card/50 backdrop-blur-sm">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <History className="h-5 w-5" /> Trade History
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent border-border/50">
                                <TableHead className="text-muted-foreground">Time</TableHead>
                                <TableHead className="text-muted-foreground">Symbol</TableHead>
                                <TableHead className="text-muted-foreground">Direction</TableHead>
                                <TableHead className="text-right text-muted-foreground">Size</TableHead>
                                <TableHead className="text-right text-muted-foreground">Est. P&L</TableHead>
                                <TableHead className="text-right text-muted-foreground">Realized P&L</TableHead>
                                <TableHead className="text-right text-muted-foreground">Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {history.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground italic bg-muted/20">
                                        No trade history available yet.<br />
                                        <span className="text-xs opacity-70">If you have closed trades on exchange but they are missing here, try 'Sync from Exchange'.</span>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                history.map((trade) => (
                                    <TableRow key={trade.id} className="hover:bg-muted/50 border-border/50">
                                        <TableCell className="font-mono text-xs text-muted-foreground">
                                            {new Date(trade.exit_time * 1000).toLocaleString()}
                                        </TableCell>
                                        <TableCell className="font-bold flex items-center gap-2">
                                            <img
                                                src={`https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${trade.symbol.toLowerCase()}.png`}
                                                className="w-4 h-4 rounded-full"
                                                onError={(e) => e.target.style.display = 'none'}
                                            />
                                            {trade.symbol}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col text-[10px] gap-1">
                                                <span className={trade.side_binance === 'Buy' ? 'text-emerald-500' : 'text-rose-500'}>
                                                    BN: {trade.side_binance}
                                                </span>
                                                <span className={trade.side_bybit === 'Buy' ? 'text-emerald-500' : 'text-rose-500'}>
                                                    BB: {trade.side_bybit}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-foreground">
                                            ${Math.round(trade.amount || 0)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-muted-foreground">
                                            ${(trade.est_profit || 0).toFixed(4)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono font-bold">
                                            {trade.realized_profit ? (
                                                <span className={trade.realized_profit > 0 ? 'text-emerald-500' : 'text-rose-500'}>
                                                    ${trade.realized_profit.toFixed(4)}
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground">-</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 text-[10px]">
                                                {trade.status}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
