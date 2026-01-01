import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet, TrendingUp, History, Activity, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

export function DashboardPage() {
    const [balanceData, setBalanceData] = useState(null);
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [activeBackend, setActiveBackend] = useState("primary");

    const getBackendUrl = () => {
        const primary = localStorage.getItem("primary_backend_url") || "http://127.0.0.1:8000";
        const backup = localStorage.getItem("backup_backend_url");
        return { primary, backup };
    };

    const getAuthHeaders = () => {
        const key = localStorage.getItem("user_bybit_key");
        const secret = localStorage.getItem("user_bybit_secret");
        const headers = {};
        if (key) headers["X-User-Bybit-Key"] = key;
        if (secret) headers["X-User-Bybit-Secret"] = secret;
        return headers;
    };

    const fetchWithFailover = async (endpoint) => {
        const { primary, backup } = getBackendUrl();
        const headers = getAuthHeaders();
        const options = { headers };

        try {
            setActiveBackend("primary");
            const res = await fetch(`${primary}${endpoint}`, options);
            if (!res.ok) throw new Error("Primary failed");
            return await res.json();
        } catch (e) {
            console.warn(`Primary backend failed for ${endpoint}. Trying backup...`);
            if (backup) {
                try {
                    setActiveBackend("backup");
                    const resBackup = await fetch(`${backup}${endpoint}`, options);
                    return await resBackup.json();
                } catch (backupError) {
                    throw new Error(`Both Backends Failed: ${e.message}`);
                }
            } else {
                throw e;
            }
        }
    };

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            // Fetch Wallet Balance
            const balJson = await fetchWithFailover("/api/wallet-balance");

            if (balJson.retCode === 0 && balJson.result.list.length > 0) {
                setBalanceData(balJson.result.list[0]);
            } else {
                throw new Error(balJson.retMsg || "Failed to fetch balance");
            }

            // Fetch Transactions
            const txJson = await fetchWithFailover("/api/transaction-log");

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
        fetchData();
    }, []);

    // Data Processing
    const totalEquity = balanceData?.totalEquity || "0.00";
    const assets = balanceData?.coin?.filter(c => parseFloat(c.usdValue) > 0.1 || parseFloat(c.equity) > 0) || [];
    assets.sort((a, b) => parseFloat(b.usdValue) - parseFloat(a.usdValue));
    const topAssets = assets.slice(0, 5);

    return (
        <div className="space-y-6 max-w-7xl mx-auto p-4 md:p-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Wallet className="h-8 w-8 text-primary" />
                        Live Dashboard
                    </h2>
                    <p className="text-muted-foreground mt-1">
                        Real-time overview of your Bybit Demo account.
                    </p>
                </div>
                <div className="flex items-center gap-2 text-xs font-mono bg-muted px-3 py-1 rounded-full border">
                    {activeBackend === 'primary' ? (
                        <Wifi className="h-3 w-3 text-green-500" />
                    ) : (
                        <WifiOff className="h-3 w-3 text-amber-500" />
                    )}
                    <span>Backend: {localStorage.getItem(`${activeBackend}_backend_url`) || "Default"}</span>
                </div>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-pulse">
                    {[1, 2, 3].map(i => <div key={i} className="h-32 bg-muted rounded-xl" />)}
                </div>
            ) : error ? (
                <div className="bg-red-50 text-red-600 p-6 rounded-xl flex flex-col items-center gap-2 border border-red-200">
                    <Activity className="h-8 w-8 text-red-500" />
                    <span className="font-bold text-lg">Connection Error</span>
                    <span>{error}</span>
                    <Button variant="outline" onClick={fetchData} className="mt-2 border-red-200 hover:bg-red-100">Retry</Button>
                </div>
            ) : (
                <>
                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Card className="bg-gradient-to-br from-background to-muted border-primary/20 shadow-sm">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Total Equity (USD)</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-4xl font-black text-primary tracking-tight">
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
                            <h3 className="text-lg font-bold flex items-center gap-2">
                                <TrendingUp className="h-5 w-5 text-blue-500" />
                                Top Holdings
                            </h3>
                            <div className="space-y-3">
                                {topAssets.length === 0 ? (
                                    <div className="text-muted-foreground text-sm italic p-4 border rounded-lg text-center bg-muted/30">
                                        No significant assets found.
                                    </div>
                                ) : (
                                    topAssets.map((asset) => (
                                        <div key={asset.coin} className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-sm text-primary">
                                                    {asset.coin}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-lg">{asset.coin}</span>
                                                    <span className="text-xs text-muted-foreground">{parseFloat(asset.walletBalance).toFixed(4)} Bal</span>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-mono font-bold text-lg">${parseFloat(asset.usdValue).toFixed(2)}</div>
                                                <div className={`text-sm ${parseFloat(asset.unrealisedPnl) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
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
                            <h3 className="text-lg font-bold flex items-center gap-2">
                                <History className="h-5 w-5 text-amber-500" />
                                Activities
                            </h3>
                            <ScrollArea className="h-[400px] border rounded-lg bg-card p-2">
                                <div className="space-y-2">
                                    {transactions.length === 0 ? (
                                        <div className="text-muted-foreground text-sm italic p-4 text-center">No recent transactions.</div>
                                    ) : (
                                        transactions.map((tx) => (
                                            <div key={tx.id} className="text-sm p-3 border-b last:border-0 hover:bg-muted/50 rounded transition-colors">
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
    );
}
