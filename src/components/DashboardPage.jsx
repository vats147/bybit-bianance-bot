import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet, TrendingUp, History, Activity, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";

export function DashboardPage() {
    const [balanceData, setBalanceData] = useState(null); // { bybit: ..., binance: ... }
    const [transactions, setTransactions] = useState([]); // { bybit: [], binance: [] }
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [activeBackend, setActiveBackend] = useState("primary");
    const [activeTab, setActiveTab] = useState("bybit");
    const [isLiveBybit, setIsLiveBybit] = useState(() => localStorage.getItem("user_bybit_live") === "true");
    const toast = useToast();

    const getBackendUrl = () => {
        const savedPrimary = localStorage.getItem("primary_backend_url");
        const savedBackup = localStorage.getItem("backup_backend_url");
        const hostname = window.location.hostname;

        // Check if we're on a local network IP
        const isLocalNetworkIP = /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

        // If on local network IP, ALWAYS use local backend (primary)
        if (isLocalNetworkIP) {
            const localBackend = `http://${hostname}:8000`;
            // Only use saved URL if it's also a local IP
            if (savedPrimary && (savedPrimary.includes(hostname) || savedPrimary.includes("localhost") || savedPrimary.includes("127.0.0.1"))) {
                return { primary: savedPrimary, backup: savedBackup };
            }
            return { primary: localBackend, backup: savedBackup };
        }

        if (hostname === "localhost" || hostname === "127.0.0.1") {
            const primary = savedPrimary || "http://localhost:8000";
            return { primary, backup: savedBackup };
        }

        const primary = savedPrimary || "https://bybit-bianance-bot.onrender.com";
        return { primary, backup: savedBackup };
    };

    const getAuthHeaders = (exchange) => {
        const headers = {};
        if (exchange === 'bybit') {
            const key = localStorage.getItem("user_bybit_key");
            const secret = localStorage.getItem("user_bybit_secret");
            if (key) headers["X-User-Bybit-Key"] = key;
            if (secret) headers["X-User-Bybit-Secret"] = secret;
        } else {
            const key = localStorage.getItem("user_binance_key");
            const secret = localStorage.getItem("user_binance_secret");
            const isTestnet = localStorage.getItem("user_binance_testnet") !== "false";
            if (key) headers["X-User-Binance-Key"] = key;
            if (secret) headers["X-User-Binance-Secret"] = secret;
            headers["is-testnet"] = isTestnet; // Or query param, but let's pass context if needed
        }
        return headers;
    };

    const fetchWithFailover = async (endpoint, exchange) => {
        const { primary, backup } = getBackendUrl();
        const headers = getAuthHeaders(exchange);
        const options = { headers };

        // Append query param for testnet if binance or live if bybit
        let urlSuffix = "";
        if (exchange === 'binance') {
            const isTestnet = localStorage.getItem("user_binance_testnet") !== "false";
            urlSuffix = `?is_testnet=${isTestnet}`;
        } else if (exchange === 'bybit') {
            // Use the isLiveBybit state for toggling
            urlSuffix = `?is_live=${isLiveBybit}`;
        }

        try {
            setActiveBackend("primary");
            const res = await fetch(`${primary}${endpoint}${urlSuffix}`, options);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                const errMsg = errData.detail || `Request failed (${res.status})`;
                throw new Error(errMsg);
            }
            return await res.json();
        } catch (e) {
            console.warn(`Primary backend failed for ${endpoint}. Trying backup...`);
            if (backup) {
                try {
                    setActiveBackend("backup");
                    const resBackup = await fetch(`${backup}${endpoint}${urlSuffix}`, options);
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
            // --- BYBIT FETCH ---
            let bybitBal = null;
            let bybitTx = [];
            try {
                const balJson = await fetchWithFailover("/api/wallet-balance", 'bybit');
                if (balJson.retCode === 0 && balJson.result.list.length > 0) {
                    bybitBal = balJson.result.list[0];
                }
                const txJson = await fetchWithFailover("/api/transaction-log", 'bybit');
                if (txJson.retCode === 0) {
                    bybitTx = txJson.result.list;
                }
            } catch (e) {
                console.error("Bybit Fetch Error", e);
                toast.error(`Bybit: ${e.message}`);
            }

            // --- BINANCE FETCH ---
            let binanceBal = null;
            let binanceTx = [];
            try {
                const balJson = await fetchWithFailover("/api/binance/wallet-balance", 'binance');
                // Binance structure is different. It returns array of assets or single obj?
                // /fapi/v2/balance returns list of assets.
                // We need to verify response structure. Usually list of objects.
                // Each obj: { asset: "USDT", balance: "...", crossWalletBalance: "..." }
                if (Array.isArray(balJson)) {
                    binanceBal = balJson;
                } else if (balJson.error) {
                    throw new Error(balJson.error.msg || "Binance error");
                }

                const txJson = await fetchWithFailover("/api/binance/orders", 'binance'); // Handles /income
                // /fapi/v1/income returns list of text.
                if (Array.isArray(txJson)) {
                    binanceTx = txJson;
                }
            } catch (e) {
                console.error("Binance Fetch Error", e);
                toast.error(`Binance: ${e.message}`);
            }

            setBalanceData({ bybit: bybitBal, binance: binanceBal });
            setTransactions({ bybit: bybitTx, binance: binanceTx });

        } catch (err) {
            console.error(err);
            setError(err.message || "Failed to load dashboard data");
            toast.error(err.message || "Failed to load dashboard data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [isLiveBybit]); // Re-fetch when live mode changes

    const toggleBybitLiveMode = () => {
        const newValue = !isLiveBybit;
        setIsLiveBybit(newValue);
        localStorage.setItem("user_bybit_live", newValue.toString());
    };

    const renderBybitContent = () => {
        const bal = balanceData?.bybit;
        const txs = transactions?.bybit || [];

        const totalEquity = bal?.totalEquity || "0.00";
        const totalMargin = bal?.totalMarginBalance || "0.00";
        const upl = bal?.totalPerpUPL || "0.00";

        const assets = bal?.coin?.filter(c => parseFloat(c.usdValue) > 0.1 || parseFloat(c.equity) > 0) || [];
        assets.sort((a, b) => parseFloat(b.usdValue) - parseFloat(a.usdValue));

        return (
            <div className="space-y-6 animate-in fade-in duration-300">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card className="bg-gradient-to-br from-background to-muted border-primary/20 shadow-sm">
                        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground uppercase">Total Equity (USD)</CardTitle></CardHeader>
                        <CardContent><div className="text-4xl font-black text-primary">${parseFloat(totalEquity).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground uppercase">Margin Bal</CardTitle></CardHeader>
                        <CardContent><div className="text-2xl font-bold">${parseFloat(totalMargin).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground uppercase">Unrealized P&L</CardTitle></CardHeader>
                        <CardContent><div className={`text-2xl font-bold ${parseFloat(upl) >= 0 ? 'text-green-600' : 'text-red-500'}`}>{parseFloat(upl) >= 0 ? '+' : ''}{parseFloat(upl).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></CardContent>
                    </Card>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-4">
                        <h3 className="text-lg font-bold flex items-center gap-2"><TrendingUp className="h-5 w-5 text-blue-500" /> Top Holdings</h3>
                        <div className="space-y-3">
                            {assets.length === 0 ? <div className="text-muted-foreground text-sm italic p-4 border rounded-lg text-center bg-muted/30">No assets found.</div> :
                                assets.map(asset => (
                                    <div key={asset.coin} className="flex justify-between p-4 rounded-lg border bg-card hover:bg-muted/50">
                                        <div><span className="font-bold">{asset.coin}</span> <span className="text-xs text-muted-foreground">{parseFloat(asset.walletBalance).toFixed(4)}</span></div>
                                        <div className="text-right"><div className="font-mono font-bold">${parseFloat(asset.usdValue).toFixed(2)}</div></div>
                                    </div>
                                ))
                            }
                        </div>
                    </div>
                    <div className="space-y-4">
                        <h3 className="text-lg font-bold flex items-center gap-2"><History className="h-5 w-5 text-amber-500" /> Activity</h3>
                        <ScrollArea className="h-[400px] border rounded-lg bg-card p-2">
                            {txs.length === 0 ? <div className="text-center p-4 text-sm text-muted-foreground shadow-inner">No recent transactions.</div> :
                                txs.map(tx => (
                                    <div key={tx.id || Math.random()} className="text-sm p-3 border-b hover:bg-muted/50 rounded">
                                        <div className="flex justify-between font-medium"><span>{tx.symbol}</span> <span className={tx.side === 'Buy' ? 'text-green-600' : 'text-red-500'}>{tx.side}</span></div>
                                        <div className="text-xs text-muted-foreground">{tx.qty} @ {parseFloat(tx.tradePrice || 0).toFixed(4)}</div>
                                    </div>
                                ))
                            }
                        </ScrollArea>
                    </div>
                </div>
            </div>
        );
    };

    const renderBinanceContent = () => {
        const balList = balanceData?.binance || [];
        const txs = transactions?.binance || [];

        // Calculate totals manually since Binance returns list of assets
        // Look for USDT usually
        const usdtAsset = balList.find(a => a.asset === 'USDT') || {};
        const totalBalance = parseFloat(usdtAsset.balance || 0); // Wallet Balance
        const crossBalance = parseFloat(usdtAsset.crossWalletBalance || 0);
        const upl = parseFloat(usdtAsset.crossUnPnl || 0);

        // Filter assets with > 0 balance
        const assets = balList.filter(a => parseFloat(a.balance) > 0);

        return (
            <div className="space-y-6 animate-in fade-in duration-300">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card className="bg-gradient-to-br from-background to-muted border-yellow-500/20 shadow-sm">
                        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground uppercase">USDT Balance</CardTitle></CardHeader>
                        <CardContent><div className="text-4xl font-black text-yellow-600">${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground uppercase">Cross Wallet Bal</CardTitle></CardHeader>
                        <CardContent><div className="text-2xl font-bold">${crossBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground uppercase">Unrealized P&L</CardTitle></CardHeader>
                        <CardContent><div className={`text-2xl font-bold ${upl >= 0 ? 'text-green-600' : 'text-red-500'}`}>{upl >= 0 ? '+' : ''}{upl.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></CardContent>
                    </Card>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-4">
                        <h3 className="text-lg font-bold flex items-center gap-2"><TrendingUp className="h-5 w-5 text-yellow-500" /> Asset Breakdown</h3>
                        <div className="space-y-3">
                            {assets.length === 0 ? <div className="text-muted-foreground text-sm italic p-4 border rounded-lg text-center bg-muted/30">No assets found.</div> :
                                assets.map(asset => (
                                    <div key={asset.asset} className="flex justify-between p-4 rounded-lg border bg-card hover:bg-muted/50">
                                        <div><span className="font-bold">{asset.asset}</span></div>
                                        <div className="text-right">
                                            <div className="font-mono font-bold">{parseFloat(asset.balance).toFixed(4)}</div>
                                            <div className="text-xs text-muted-foreground">Avail: {parseFloat(asset.availableBalance).toFixed(4)}</div>
                                        </div>
                                    </div>
                                ))
                            }
                        </div>
                    </div>
                    <div className="space-y-4">
                        <h3 className="text-lg font-bold flex items-center gap-2"><History className="h-5 w-5 text-amber-500" /> Income History</h3>
                        <ScrollArea className="h-[400px] border rounded-lg bg-card p-2">
                            {txs.length === 0 ? <div className="text-center p-4 text-sm text-muted-foreground shadow-inner">No recent history.</div> :
                                txs.slice(0, 50).map(tx => (
                                    <div key={tx.tranId || Math.random()} className="text-sm p-3 border-b hover:bg-muted/50 rounded">
                                        <div className="flex justify-between font-medium">
                                            <span>{tx.symbol}</span>
                                            <span className={parseFloat(tx.income) >= 0 ? 'text-green-600' : 'text-red-500'}>
                                                {parseFloat(tx.income) >= 0 ? '+' : ''}{parseFloat(tx.income).toFixed(4)} {tx.asset}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-xs text-muted-foreground mt-1">
                                            <span>{tx.incomeType}</span>
                                            <span className="font-mono">{new Date(tx.time).toLocaleTimeString()}</span>
                                        </div>
                                    </div>
                                ))
                            }
                        </ScrollArea>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6 max-w-7xl mx-auto p-4 md:p-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Wallet className="h-8 w-8 text-primary" />
                        Live Dashboard
                    </h2>
                    <p className="text-muted-foreground mt-1">
                        Review Balances, P&L, and History across platforms.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${!isLiveBybit ? 'text-blue-600' : 'text-muted-foreground'}`}>Demo</span>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={toggleBybitLiveMode}
                        className={`w-14 h-7 p-1 rounded-full relative transition-colors ${isLiveBybit ? 'bg-green-500 border-green-500' : 'bg-muted border-muted'}`}
                    >
                        <span className={`absolute w-5 h-5 rounded-full bg-white shadow transition-transform ${isLiveBybit ? 'translate-x-6' : 'translate-x-0'}`} />
                    </Button>
                    <span className={`text-sm font-medium ${isLiveBybit ? 'text-green-600' : 'text-muted-foreground'}`}>Live</span>
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
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="grid w-full max-w-md grid-cols-2 mb-6">
                        <TabsTrigger value="bybit" className="data-[state=active]:bg-cyan-950 data-[state=active]:text-cyan-400">Bybit</TabsTrigger>
                        <TabsTrigger value="binance" className="data-[state=active]:bg-yellow-950 data-[state=active]:text-yellow-400">Binance</TabsTrigger>
                    </TabsList>
                    <TabsContent value="bybit">
                        {renderBybitContent()}
                    </TabsContent>
                    <TabsContent value="binance">
                        {renderBinanceContent()}
                    </TabsContent>
                </Tabs>
            )}
        </div>
    );
}
