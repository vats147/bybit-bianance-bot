import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Trophy, RefreshCcw, Users, TrendingUp, Cpu } from "lucide-react";

export function LeaderboardPage() {
    const [leaderboard, setLeaderboard] = useState({});
    const [loading, setLoading] = useState(true);
    const [myBotId, setMyBotId] = useState("");
    const [myName, setMyName] = useState("");
    const [isEditingName, setIsEditingName] = useState(false);
    const [editedName, setEditedName] = useState("");

    // Helper to get backend URL (Same logic as others)
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

    useEffect(() => {
        // Load local bot identity
        let id = localStorage.getItem("bot_unique_id");
        if (!id) {
            id = "bot_" + Math.random().toString(36).substr(2, 9);
            localStorage.setItem("bot_unique_id", id);
        }
        setMyBotId(id);

        const name = localStorage.getItem("bot_name") || `Bot-${id.substr(0, 4)}`;
        setMyName(name);
        setEditedName(name);

        fetchLeaderboard();
        const interval = setInterval(fetchLeaderboard, 10000);
        return () => clearInterval(interval);
    }, []);

    const fetchLeaderboard = async () => {
        try {
            setLoading(true);
            const url = getBackendUrl();
            const res = await fetch(`${url}/api/leaderboard`);
            if (res.ok) {
                const data = await res.json();
                setLeaderboard(data);
            }
        } catch (e) {
            console.error("Leaderboard fetch error", e);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveName = () => {
        localStorage.setItem("bot_name", editedName);
        setMyName(editedName);
        setIsEditingName(false);
        // Trigger immediate ping with new name
        // (This happens automatically in App.jsx via polling, but we can wait)
    };

    // Convert map to array and sort
    const sortedBots = Object.entries(leaderboard).map(([id, data]) => ({
        id,
        ...data
    })).sort((a, b) => {
        const profitA = a.stats?.total_pnl || 0;
        const profitB = b.stats?.total_pnl || 0;
        return profitB - profitA;
    });

    return (
        <div className="space-y-6 animate-in fade-in duration-500 max-w-7xl mx-auto p-4 md:p-8">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-amber-400 to-orange-600 bg-clip-text text-transparent flex items-center gap-2">
                        <Trophy className="text-amber-500 h-8 w-8" /> Global Leaderboard
                    </h2>
                    <p className="text-muted-foreground mt-1">Live performance tracking of all active arbitrage bots</p>
                </div>

                <div className="flex items-center gap-4 bg-secondary/20 p-2 rounded-lg border border-border/50">
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground">My Bot Name</span>
                        {isEditingName ? (
                            <div className="flex items-center gap-2">
                                <Input
                                    value={editedName}
                                    onChange={(e) => setEditedName(e.target.value)}
                                    className="h-6 w-32 text-xs"
                                    autoFocus
                                />
                                <Button size="sm" className="h-6 text-xs" onClick={handleSaveName}>Save</Button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 cursor-pointer hover:text-primary transition-colors" onClick={() => setIsEditingName(true)}>
                                <span className="font-bold text-sm text-foreground">{myName}</span>
                                <span className="text-xs text-muted-foreground">(Edit)</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Stats Overview */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/5 border-amber-500/20">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Active Bots</CardTitle>
                        <Users className="h-4 w-4 text-amber-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{Object.keys(leaderboard).length}</div>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/5 border-blue-500/20">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Top Profit (24h)</CardTitle>
                        <TrendingUp className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-500">
                            ${Math.max(...sortedBots.map(b => b.stats?.pnl_24h || 0), 0).toFixed(2)}
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-purple-500/10 to-pink-500/5 border-purple-500/20">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Total Network Volume</CardTitle>
                        <Cpu className="h-4 w-4 text-purple-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            ${sortedBots.reduce((acc, curr) => acc + (curr.stats?.total_volume || 0), 0).toLocaleString()}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Leaderboard Table */}
            <Card className="border-border/50 shadow-md">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle>Rankings</CardTitle>
                        <Button variant="outline" size="sm" onClick={fetchLeaderboard} disabled={loading}>
                            <RefreshCcw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="w-[50px]">Rank</TableHead>
                                <TableHead>Bot Name</TableHead>
                                <TableHead className="text-right">Total Profit</TableHead>
                                <TableHead className="text-right">24h Profit</TableHead>
                                <TableHead className="text-right">Trades</TableHead>
                                <TableHead className="text-right">Last Seen</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedBots.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                                        No active bots found. Be the first!
                                    </TableCell>
                                </TableRow>
                            ) : (
                                sortedBots.map((bot, index) => {
                                    const isMe = bot.id === myBotId;
                                    return (
                                        <TableRow key={bot.id} className={isMe ? "bg-primary/5 hover:bg-primary/10 border-l-2 border-l-primary" : ""}>
                                            <TableCell className="font-bold">
                                                {index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `#${index + 1}`}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className={`font-bold ${isMe ? "text-primary" : ""}`}>
                                                        {bot.name} {isMe && "(You)"}
                                                    </span>
                                                    <span className="text-[10px] text-muted-foreground font-mono">{bot.id.substr(0, 8)}...</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right font-bold text-green-500">
                                                ${(bot.stats?.total_pnl || 0).toFixed(2)}
                                            </TableCell>
                                            <TableCell className="text-right font-mono">
                                                ${(bot.stats?.pnl_24h || 0).toFixed(2)}
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-muted-foreground">
                                                {bot.stats?.total_trades || 0}
                                            </TableCell>
                                            <TableCell className="text-right text-xs text-muted-foreground">
                                                {Math.floor((Date.now() / 1000 - bot.last_seen) / 60)}m ago
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
