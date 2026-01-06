
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, DollarSign, History, TrendingUp } from "lucide-react";

export function PnLPage() {
    const [overview, setOverview] = useState(null);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);

    // Helper to get backend URL (reused logic)
    // Helper to get backend URL (reused logic with smart detection)
    const getBackendUrl = () => {
        const saved = localStorage.getItem("primary_backend_url");
        const hostname = window.location.hostname;

        // Check if we're on a local network IP
        const isLocalNetworkIP = /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

        // If on local network IP, ALWAYS use local backend (primary)
        if (isLocalNetworkIP) {
            const localBackend = `http://${hostname}:8000`;
            // Only use saved URL if it's also a local IP
            if (saved && (saved.includes(hostname) || saved.includes("localhost") || saved.includes("127.0.0.1"))) {
                return saved;
            }
            return localBackend;
        }

        const defaultUrl = (hostname === "localhost" || hostname === "127.0.0.1")
            ? "http://localhost:8000"
            : "https://bybit-bianance-bot.onrender.com";
        return saved || defaultUrl;
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

    const syncPositions = async () => {
        try {
            console.log("Syncing positions...");
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

            const isLive = localStorage.getItem("is_live_mode") === "true";
            console.log(`Syncing positions (Live: ${isLive})...`);

            await fetch(`${url}/api/auto-trade/sync-positions?is_live=${isLive}`, {
                method: "POST",
                headers: headers
            });
            fetchData();
        } catch (e) {
            console.error("Sync Error", e);
        }
    };

    useEffect(() => {
        syncPositions();
        fetchData();
        const interval = setInterval(fetchData, 30000); // Poll every 30s
        return () => clearInterval(interval);
    }, []);

    if (loading && !overview) {
        return <div className="p-8 text-center text-gray-500">Loading P&L Data...</div>;
    }

    const { total_pnl, total_trades, pnl_24h } = overview?.summary || {};
    const activeCount = overview?.active_trades?.count || 0;

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-green-400 to-emerald-600 bg-clip-text text-transparent">
                    Performance & History
                </h2>
                <Button variant="outline" size="sm" onClick={fetchData}>
                    Refresh
                </Button>
            </div>

            {/* Summary Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="bg-gradient-to-br from-gray-900 to-gray-800 border-gray-700">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-gray-400">Total Realized P&L</CardTitle>
                        <DollarSign className="h-4 w-4 text-green-400" />
                    </CardHeader>
                    <CardContent>
                        <div className={`text-2xl font-bold ${total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            ${(total_pnl || 0).toFixed(2)}
                        </div>
                        <p className="text-xs text-gray-500">Net funding fees collected</p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-gray-900 to-gray-800 border-gray-700">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-gray-400">24h P&L</CardTitle>
                        <TrendingUp className="h-4 w-4 text-blue-400" />
                    </CardHeader>
                    <CardContent>
                        <div className={`text-2xl font-bold ${pnl_24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            ${(pnl_24h || 0).toFixed(2)}
                        </div>
                        <p className="text-xs text-gray-500">Last 24 hours performance</p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-gray-900 to-gray-800 border-gray-700">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-gray-400">Total Trades</CardTitle>
                        <History className="h-4 w-4 text-purple-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">{total_trades || 0}</div>
                        <p className="text-xs text-gray-500">Completed arbitrage cycles</p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-gray-900 to-gray-800 border-gray-700">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-gray-400">Active Positions</CardTitle>
                        <Activity className="h-4 w-4 text-amber-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">{activeCount}</div>
                        <p className="text-xs text-gray-500">Currently open trades</p>
                    </CardContent>
                </Card>
            </div>

            {/* Active Positions Table */}
            <Card className="bg-gray-900/50 border-gray-800 mb-6 border-l-4 border-l-amber-500">
                <CardHeader>
                    <CardTitle className="text-amber-500">Active Positions (Live)</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow className="border-gray-800 hover:bg-transparent">
                                <TableHead className="text-gray-400">Entry Time</TableHead>
                                <TableHead className="text-gray-400">Symbol</TableHead>
                                <TableHead className="text-gray-400">Sides</TableHead>
                                <TableHead className="text-right text-gray-400">Qty</TableHead>
                                <TableHead className="text-right text-gray-400">Invested</TableHead>
                                <TableHead className="text-right text-gray-400">Next Funding</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {overview?.active_trades?.list?.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-24 text-center text-gray-500">
                                        No active positions currently open.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                overview?.active_trades?.list?.map((trade, idx) => (
                                    <TableRow key={trade.symbol + idx} className="border-gray-800 hover:bg-gray-800/50">
                                        <TableCell className="font-mono text-xs text-gray-300">
                                            {new Date(trade.entry_time * 1000).toLocaleTimeString()}
                                        </TableCell>
                                        <TableCell className="font-bold text-white text-lg">{trade.symbol}</TableCell>
                                        <TableCell>
                                            <div className="flex gap-2">
                                                <Badge variant="outline" className={trade.sides?.binance === 'Buy' ? 'text-green-400 border-green-500/30' : 'text-red-400 border-red-500/30'}>
                                                    BN: {trade.sides?.binance}
                                                </Badge>
                                                <Badge variant="outline" className={trade.sides?.bybit === 'Buy' ? 'text-green-400 border-green-500/30' : 'text-red-400 border-red-500/30'}>
                                                    BB: {trade.sides?.bybit}
                                                </Badge>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-gray-300">
                                            {trade.qty}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-yellow-400">
                                            ${Math.round(trade.amount || 0)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-xs text-gray-400">
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
            <Card className="bg-gray-900/50 border-gray-800">
                <CardHeader>
                    <CardTitle>Trade History</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow className="border-gray-800 hover:bg-transparent">
                                <TableHead className="text-gray-400">Time</TableHead>
                                <TableHead className="text-gray-400">Symbol</TableHead>
                                <TableHead className="text-gray-400">Direction</TableHead>
                                <TableHead className="text-right text-gray-400">Size</TableHead>
                                <TableHead className="text-right text-gray-400">Est. P&L</TableHead>
                                <TableHead className="text-right text-gray-400">Realized P&L</TableHead>
                                <TableHead className="text-right text-gray-400">Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {history.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="h-24 text-center text-gray-500">
                                        No trade history available yet.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                history.map((trade) => (
                                    <TableRow key={trade.id} className="border-gray-800 hover:bg-gray-800/50">
                                        <TableCell className="font-mono text-xs text-gray-300">
                                            {new Date(trade.exit_time * 1000).toLocaleString()}
                                        </TableCell>
                                        <TableCell className="font-bold text-white">{trade.symbol}</TableCell>
                                        <TableCell>
                                            <div className="flex flex-col text-xs">
                                                <span className={trade.side_binance === 'Buy' ? 'text-green-400' : 'text-red-400'}>
                                                    BN: {trade.side_binance}
                                                </span>
                                                <span className={trade.side_bybit === 'Buy' ? 'text-green-400' : 'text-red-400'}>
                                                    BB: {trade.side_bybit}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-gray-300">
                                            ${Math.round(trade.amount || 0)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-gray-300">
                                            ${(trade.est_profit || 0).toFixed(4)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {trade.realized_profit ? (
                                                <span className={trade.realized_profit > 0 ? 'text-green-400' : 'text-red-400'}>
                                                    ${trade.realized_profit.toFixed(4)}
                                                </span>
                                            ) : (
                                                <span className="text-gray-600">-</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30">
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
