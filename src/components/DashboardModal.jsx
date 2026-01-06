import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X, LayoutDashboard, Wallet, TrendingUp, History, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

export function DashboardModal() {
    const [isOpen, setIsOpen] = useState(false);
    const [balanceData, setBalanceData] = useState(null);
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Helper to get backend URL (with smart network detection)
    const getBackendUrl = () => {
        const saved = localStorage.getItem("primary_backend_url");
        const hostname = window.location.hostname;

        // Check if we're on a local network IP
        const isLocalNetworkIP = /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

        // If on local network IP, ALWAYS use local backend (ignore saved cloud URLs)
        if (isLocalNetworkIP) {
            const localBackend = `http://${hostname}:8000`;
            // Only use saved URL if it's also a local IP
            if (saved && (saved.includes(hostname) || saved.includes("localhost") || saved.includes("127.0.0.1"))) {
                return saved;
            }
            return localBackend;
        }

        if (hostname === "localhost" || hostname === "127.0.0.1") {
            return saved || "http://localhost:8000";
        }

        return saved || "https://bybit-bianance-bot.onrender.com";
    };

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const backendUrl = getBackendUrl();
            // Fetch Wallet Balance
            const balRes = await fetch(`${backendUrl}/api/wallet-balance`);
            const balJson = await balRes.json();

            if (balJson.retCode === 0 && balJson.result.list.length > 0) {
                setBalanceData(balJson.result.list[0]);
            } else {
                throw new Error(balJson.retMsg || "Failed to fetch balance");
            }

            // Fetch Transactions
            const txRes = await fetch(`${backendUrl}/api/transaction-log`);
            const txJson = await txRes.json();

            if (txJson.retCode === 0) {
                setTransactions(txJson.result.list);
            }

        } catch (err) {
            console.error(err);
            setError(err.message || "Failed to load dashboard data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchData();
        }
    }, [isOpen]);

    // Data Processing (Account for potential undefined/null)
    const totalEquity = balanceData?.totalEquity || "0.00";

    // Sort Assets by USD Value descending and filter out small dust
    const assets = balanceData?.coin?.filter(c => parseFloat(c.usdValue) > 0.1 || parseFloat(c.equity) > 0) || [];
    assets.sort((a, b) => parseFloat(b.usdValue) - parseFloat(a.usdValue));

    const topAssets = assets.slice(0, 5);

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white border-0 hover:from-blue-700 hover:to-indigo-700">
                    <LayoutDashboard className="h-4 w-4" />
                    Dashboard
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-6">
                <DialogHeader className="pb-4 border-b">
                    <DialogTitle className="flex items-center gap-2 text-2xl">
                        <Wallet className="h-6 w-6 text-primary" />
                        Live Demo Dashboard
                    </DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto py-4 space-y-6">
                    {loading ? (
                        <div className="flex justify-center items-center h-48 animate-pulse text-muted-foreground">
                            Loading Account Data...
                        </div>
                    ) : error ? (
                        <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2 border border-red-200">
                            <Activity className="h-5 w-5" />
                            {error} <span className="text-xs">(Check backend console & API Keys)</span>
                        </div>
                    ) : (
                        <>
                            {/* Summary Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <Card className="bg-gradient-to-br from-background to-muted border-primary/20 shadow-sm transition-all hover:shadow-md">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Total Equity (USD)</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-3xl font-black text-primary tracking-tight">
                                            ${parseFloat(totalEquity).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Margin Balance</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-2xl font-bold">
                                            ${parseFloat(balanceData?.totalMarginBalance || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Total PnL (Unrealized)</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className={`text-2xl font-bold ${parseFloat(balanceData?.totalPerpUPL || "0") >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                            {parseFloat(balanceData?.totalPerpUPL || "0") >= 0 ? '+' : ''}
                                            {parseFloat(balanceData?.totalPerpUPL || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* Top Assets */}
                                <div className="lg:col-span-2 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-lg font-bold flex items-center gap-2">
                                            <TrendingUp className="h-5 w-5 text-blue-500" />
                                            Top Holdings
                                        </h3>
                                    </div>
                                    <div className="space-y-3">
                                        {topAssets.length === 0 ? (
                                            <div className="text-muted-foreground text-sm italic p-4 border rounded-lg text-center bg-muted/30">
                                                No significant assets found.
                                            </div>
                                        ) : (
                                            topAssets.map((asset) => (
                                                <div key={asset.coin} className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors">
                                                    <div className="flex items-center gap-3">
                                                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center font-bold text-xs text-primary">
                                                            {asset.coin}
                                                        </div>
                                                        <div className="flex flex-col">
                                                            <span className="font-bold">{asset.coin}</span>
                                                            <span className="text-xs text-muted-foreground">{parseFloat(asset.walletBalance).toFixed(4)} Bal</span>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="font-mono font-bold">${parseFloat(asset.usdValue).toFixed(2)}</div>
                                                        <div className={`text-xs ${parseFloat(asset.unrealisedPnl) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                            PnL: {parseFloat(asset.unrealisedPnl).toFixed(2)}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>

                                {/* Transaction History */}
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-lg font-bold flex items-center gap-2">
                                            <History className="h-5 w-5 text-amber-500" />
                                            Activities
                                        </h3>
                                    </div>
                                    <ScrollArea className="h-[300px] border rounded-lg bg-card p-2">
                                        <div className="space-y-2">
                                            {transactions.length === 0 ? (
                                                <div className="text-muted-foreground text-sm italic p-4 text-center">No recent transactions.</div>
                                            ) : (
                                                transactions.map((tx) => (
                                                    <div key={tx.id} className="text-sm p-2 border-b last:border-0 hover:bg-muted/50 rounded transition-colors group">
                                                        <div className="flex justify-between font-medium">
                                                            <span>{tx.symbol}</span>
                                                            <span className={tx.side === 'Buy' ? 'text-green-600' : 'text-red-500'}>
                                                                {tx.side.toUpperCase()}
                                                            </span>
                                                        </div>
                                                        <div className="flex justify-between text-xs text-muted-foreground mt-1">
                                                            <span>{tx.qty} @ {parseFloat(tx.tradePrice).toFixed(4)}</span>
                                                            <span className="font-mono">{new Date(parseInt(tx.transactionTime)).toLocaleTimeString()}</span>
                                                        </div>
                                                        {tx.type === "SETTLEMENT" && (
                                                            <Badge variant="outline" className="mt-1 text-[10px] h-4">Funding</Badge>
                                                        )}
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </ScrollArea>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
