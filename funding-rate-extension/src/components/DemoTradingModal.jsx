import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { X, Play, RefreshCw, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

export function DemoTradingModal({ isOpen, onClose, data }) {
    const [capital, setCapital] = useState(100);
    const [leverage, setLeverage] = useState(5);
    const [timeLeft, setTimeLeft] = useState("");
    const [simulationResult, setSimulationResult] = useState(null);
    const [testQty, setTestQty] = useState(100);
    const [realExecution, setRealExecution] = useState(false);
    const [orderStatus, setOrderStatus] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!data || !data.nextFundingTime) return;

        const calculateTimeLeft = () => {
            const now = Date.now();
            const target = data.nextFundingTime;
            const diff = target - now;

            if (diff <= 0) return "Funding Imminent";

            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);

            return `${hours}h ${minutes}m ${seconds}s`;
        };

        setTimeLeft(calculateTimeLeft());
        const timer = setInterval(() => {
            setTimeLeft(calculateTimeLeft());
        }, 1000);

        return () => clearInterval(timer);
    }, [data?.nextFundingTime]);

    if (!isOpen || !data) return null;

    const { symbol, bybitRate, markPrice } = data; // Focusing on Bybit for this demo
    const fundingRate = bybitRate || 0; // Ensure fallback
    const positionSize = capital * leverage;

    // Suggestion Logic
    // If Funding Rate is NEGATIVE: Shorts PAY Longs. -> We should go LONG.
    // If Funding Rate is POSITIVE: Longs PAY Shorts. -> We should go SHORT.
    const isRateNegative = fundingRate < 0;
    const recommendedAction = isRateNegative ? "LONG" : "SHORT";
    const recommendationColor = isRateNegative ? "text-green-600" : "text-red-600";
    const recommendationBg = isRateNegative ? "bg-green-100 dark:bg-green-900/30" : "bg-red-100 dark:bg-red-900/30";

    const runSimulation = (sizeVal, direction) => {
        // Funding Calculation
        // Rate Positive (>0): Longs PAY Shorts. 
        // Rate Negative (<0): Shorts PAY Longs.

        let fundingIncome = 0;
        const rateAbs = Math.abs(fundingRate);
        const rateDecimal = rateAbs / 100;

        // If Funding is POSITIVE (pay shorts):
        if (fundingRate > 0) {
            // Short receives, Long pays
            if (direction === "SHORT") fundingIncome = sizeVal * rateDecimal;
            else fundingIncome = -(sizeVal * rateDecimal);
        } else {
            // Negative Rate (pay longs):
            // Long receives, Short pays
            if (direction === "LONG") fundingIncome = sizeVal * rateDecimal;
            else fundingIncome = -(sizeVal * rateDecimal);
        }

        const tradingFeeRate = 0.1; // 0.1% total round trip
        const estimatedTradingFees = sizeVal * (tradingFeeRate / 100);

        const netPnL = fundingIncome - estimatedTradingFees;

        setSimulationResult({
            direction,
            size: sizeVal,
            fundingIncome,
            tradingFees: estimatedTradingFees,
            netPnL,
            time: new Date().toLocaleTimeString()
        });
    };

    const handleExecute = () => {
        runSimulation(positionSize, recommendedAction);
    };

    const handleManualTest = async (direction) => {
        if (!realExecution) {
            // Simulation Mode (Existing)
            const sizeVal = testQty * (markPrice || 0);
            runSimulation(sizeVal, direction);
        } else {
            // Real Execution Mode
            setLoading(true);
            setOrderStatus(null);

            const getBackendUrl = () => {
                const primary = localStorage.getItem("primary_backend_url") || "http://127.0.0.1:8000";
                const backup = localStorage.getItem("backup_backend_url");
                return { primary, backup };
            };

            const getAuthHeaders = () => {
                const key = localStorage.getItem("user_bybit_key");
                const secret = localStorage.getItem("user_bybit_secret");
                const headers = { 'Content-Type': 'application/json' };
                if (key) headers["X-User-Bybit-Key"] = key;
                if (secret) headers["X-User-Bybit-Secret"] = secret;
                return headers;
            };

            const { primary, backup } = getBackendUrl();
            const headers = getAuthHeaders();

            const payload = {
                symbol: symbol,
                side: direction === "LONG" ? "Buy" : "Sell",
                qty: testQty,
                leverage: leverage,
                category: "linear"
            };

            const attemptFetch = async (baseUrl) => {
                const res = await fetch(`${baseUrl}/api/place-order`, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || "Order Placement Failed");
                return data;
            };

            try {
                // Try Primary
                try {
                    const data = await attemptFetch(primary);
                    setOrderStatus({
                        status: 'success',
                        data: data,
                        message: `Order Placed! ID: ${data.data.orderId}`
                    });
                } catch (primaryErr) {
                    console.warn("Primary API failed, trying backup...", primaryErr);
                    if (backup) {
                        try {
                            const dataBackup = await attemptFetch(backup);
                            setOrderStatus({
                                status: 'success',
                                data: dataBackup,
                                message: `Order Placed (Backup)! ID: ${dataBackup.data.orderId}`
                            });
                        } catch (backupErr) {
                            throw new Error(`Primary & Backup Failed: ${backupErr.message}`);
                        }
                    } else {
                        throw primaryErr;
                    }
                }

            } catch (err) {
                setOrderStatus({
                    status: 'error',
                    message: err.message
                });
            } finally {
                setLoading(false);
            }
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in zoom-in-95 duration-200">
            <div className="relative w-full max-w-lg mx-4">
                <Card className="shadow-2xl border-2 border-primary/20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 border-b">
                        <CardTitle className="text-xl font-bold flex items-center gap-2">
                            <span className="bg-primary/10 p-2 rounded-full"><RefreshCw className="h-5 w-5 text-primary" /></span>
                            Demo Trade: {symbol}
                        </CardTitle>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={onClose}>
                            <X className="h-4 w-4" />
                        </Button>
                    </CardHeader>

                    <CardContent className="space-y-6 pt-6">

                        {/* Market Data Strip */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-muted/40 p-3 rounded-lg border">
                                <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Funding Rate</span>
                                <div className={`text-2xl font-black ${fundingRate > 0 ? 'text-orange-500' : 'text-green-500'}`}>
                                    {fundingRate.toFixed(4)}%
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">Countdown: {timeLeft}</div>
                            </div>
                            <div className={`p-3 rounded-lg border flex flex-col justify-center items-center ${recommendationBg}`}>
                                <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Signal</span>
                                <div className={`text-2xl font-black ${recommendationColor} flex items-center gap-1`}>
                                    {recommendedAction}
                                    {recommendedAction === "LONG" ? <TrendingUp className="h-6 w-6" /> : <TrendingDown className="h-6 w-6" />}
                                </div>
                                <div className="text-[10px] text-muted-foreground text-center leading-tight mt-1">
                                    {isRateNegative
                                        ? "Rate is Negative. Longs receive funding."
                                        : "Rate is Positive. Shorts receive funding."}
                                </div>
                            </div>
                        </div>

                        {/* Order Status Alert */}
                        {orderStatus && (
                            <div className={`p-3 rounded-md text-sm font-medium mb-4 ${orderStatus.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {orderStatus.status === 'success' ? (
                                    <div className="flex items-center gap-2">
                                        <TrendingUp className="h-4 w-4" />
                                        {orderStatus.message}
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <AlertTriangle className="h-4 w-4" />
                                        Error: {orderStatus.message}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Controls */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-muted-foreground">Capital (USDT)</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                                    <Input
                                        type="number"
                                        value={capital}
                                        onChange={(e) => setCapital(Number(e.target.value))}
                                        className="pl-7 font-bold"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-muted-foreground">Leverage (x)</label>
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="number"
                                        value={leverage}
                                        onChange={(e) => setLeverage(Number(e.target.value))}
                                        className="font-bold"
                                        min={1}
                                        max={100}
                                    />
                                    <span className="text-sm font-bold text-muted-foreground whitespace-nowrap">
                                        Total: ${(capital * leverage).toLocaleString()}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Action Button */}
                        <Button
                            className={`w-full h-12 text-lg font-bold shadow-lg transition-all
                                ${recommendedAction === "LONG"
                                    ? "bg-green-600 hover:bg-green-700 text-white"
                                    : "bg-red-600 hover:bg-red-700 text-white"
                                }`}
                            onClick={handleExecute}
                        >
                            <Play className="mr-2 h-5 w-5 fill-current" />
                            Simulate Recommended ({recommendedAction})
                        </Button>

                        {/* Manual Test Section */}
                        <div className="pt-4 border-t border-dashed">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex flex-col">
                                    <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Test Trade</span>
                                    <div className="flex items-center gap-2 mt-1">
                                        <Switch checked={realExecution} onCheckedChange={setRealExecution} id="real-mode" />
                                        <label htmlFor="real-mode" className={`text-xs font-bold ${realExecution ? "text-orange-600" : "text-muted-foreground"}`}>
                                            {realExecution ? "REAL EXECUTION (API)" : "Simulation Only"}
                                        </label>
                                    </div>
                                </div>
                                <Badge variant="secondary">Qty: {testQty} Units</Badge>
                            </div>

                            <div className="flex gap-3 items-end">
                                <div className="space-y-1 flex-1">
                                    <label className="text-xs text-muted-foreground">Qty (Units)</label>
                                    <Input
                                        type="number"
                                        value={testQty}
                                        onChange={(e) => setTestQty(Number(e.target.value))}
                                        className="h-10 font-bold"
                                    />
                                    <div className="flex justify-between items-center text-[10px] text-muted-foreground pt-1 px-1">
                                        <span>Value: ~${(testQty * (markPrice || 0)).toFixed(2)}</span>
                                        <span className={(testQty * (markPrice || 0)) < 5 ? "text-red-500 font-bold" : ""}>
                                            Min: $5.00
                                        </span>
                                    </div>
                                </div>
                                <Button
                                    className="flex-1 h-10 bg-green-500 hover:bg-green-600 text-white font-bold"
                                    onClick={() => handleManualTest("LONG")}
                                    disabled={loading}
                                >
                                    {loading ? "Placing..." : "Buy / Long"}
                                </Button>
                                <Button
                                    className="flex-1 h-10 bg-red-500 hover:bg-red-600 text-white font-bold"
                                    onClick={() => handleManualTest("SHORT")}
                                    disabled={loading}
                                >
                                    {loading ? "Placing..." : "Sell / Short"}
                                </Button>
                            </div>
                        </div>

                        {/* Results Area (Only for Simulation) */}
                        {!realExecution && simulationResult && (
                            <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
                                <div className="bg-muted p-4 rounded-lg border-2 border-primary/10 space-y-3">
                                    <div className="flex justify-between items-center border-b pb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold">Simulation Result</span>
                                            <Badge variant={simulationResult.direction === "LONG" ? "default" : "destructive"}>
                                                {simulationResult.direction || recommendedAction}
                                            </Badge>
                                        </div>
                                        <Badge variant="outline">{simulationResult.time}</Badge>
                                    </div>

                                    <div className="grid grid-cols-2 gap-y-2 text-sm">
                                        <span className="text-muted-foreground">Position Value:</span>
                                        <span className="font-mono text-right">${simulationResult.size.toFixed(2)}</span>

                                        <span className="text-muted-foreground">Est. Funding Income:</span>
                                        <span className={`font-mono text-right font-bold ${simulationResult.fundingIncome >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                            {simulationResult.fundingIncome >= 0 ? '+' : ''}{simulationResult.fundingIncome.toFixed(4)}
                                        </span>

                                        <span className="text-muted-foreground" title="Est. 0.1% Round Trip">Est. Trading Fees (0.1%):</span>
                                        <span className="font-mono text-right text-red-500">
                                            -${simulationResult.tradingFees.toFixed(4)}
                                        </span>
                                    </div>

                                    <div className="flex justify-between items-center pt-2 border-t mt-2 bg-background/50 p-2 rounded">
                                        <span className="font-bold">Net P&L</span>
                                        <span className={`font-mono text-xl font-black ${simulationResult.netPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {simulationResult.netPnL >= 0 ? '+' : ''}{simulationResult.netPnL.toFixed(4)}
                                        </span>
                                    </div>

                                    {simulationResult.netPnL < 0 && (
                                        <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
                                            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                                            <span>Warning: Fees {'>'} Funding Income</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <p className="text-[10px] text-center text-muted-foreground border-t pt-2 mt-4">
                            {realExecution
                                ? "⚠️ REAL EXECUTION MODE: Orders will be placed on Bybit Testnet/Mainnet."
                                : "*Demo Mode. No real funds used. Assumes perfect execution at Mark Price."}
                        </p>

                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
