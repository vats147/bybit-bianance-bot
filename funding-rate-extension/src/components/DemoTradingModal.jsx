import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { X, Play, RefreshCw, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

export function DemoTradingModal({ isOpen, onClose, data }) {
    const [platform, setPlatform] = useState("BYBIT"); // BYBIT | BINANCE | ARBITRAGE
    const [capital, setCapital] = useState(100);
    const [leverage, setLeverage] = useState(5);
    const [timeLeft, setTimeLeft] = useState("");
    const [simulationResult, setSimulationResult] = useState(null);
    const [arbitrageResult, setArbitrageResult] = useState(null); // { netPnL, legs: [] }
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

    const { symbol, bybitRate, binanceRate, markPrice, intervals } = data;
    const bybitInterval = intervals?.bybit || 8;
    const binanceInterval = intervals?.binance || 8;

    // Platform Specific Data
    let fundingRate = 0;
    let currentInterval = 8;

    if (platform === "BYBIT") {
        fundingRate = bybitRate || 0;
        currentInterval = bybitInterval;
    } else if (platform === "BINANCE") {
        fundingRate = binanceRate || 0;
        currentInterval = binanceInterval;
    }
    // For Arbitrage, we care about the SPREAD and NET rate

    const positionSize = capital * leverage;

    // Suggestion Logic
    const isRateNegative = fundingRate < 0;
    const recommendedAction = isRateNegative ? "LONG" : "SHORT";
    const recommendationColor = isRateNegative ? "text-green-600" : "text-red-600";
    const recommendationBg = isRateNegative ? "bg-green-100 dark:bg-green-900/30" : "bg-red-100 dark:bg-red-900/30";

    const runSimulation = (sizeVal, direction) => {
        let fundingIncome = 0;
        const rateAbs = Math.abs(fundingRate);
        const rateDecimal = rateAbs / 100;

        if (fundingRate > 0) {
            // Positive: Short receives
            if (direction === "SHORT") fundingIncome = sizeVal * rateDecimal;
            else fundingIncome = -(sizeVal * rateDecimal);
        } else {
            // Negative: Long receives
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

    const runArbitrageSimulation = () => {
        // Logic: Long Lower Rate, Short Higher Rate usually (to collect spread)?
        // Usually: 
        // If Binance > Bybit: Short Binance (Receive High), Long Bybit (Pay Low). Net = High - Low.
        // If Bybit > Binance: Short Bybit (Receive High), Long Binance (Pay Low).

        // Let's determine directions
        const bRate = binanceRate || 0;
        const yRate = bybitRate || 0;

        let longEx, shortEx;
        let spread = Math.abs(bRate - yRate);
        let netRate = spread; // roughly

        if (bRate > yRate) {
            shortEx = "BINANCE";
            longEx = "BYBIT";
            // Short Binance (+bRate), Long Bybit (-yRate). Net = bRate - yRate.
        } else {
            shortEx = "BYBIT";
            longEx = "BINANCE";
            // Short Bybit (+yRate), Long Binance (-bRate). Net = yRate - bRate.
        }

        const sizePerLeg = positionSize / 2; // Split capital? Or Capital * Leverage for EACH leg? Usually total exposure.
        // Let's assume Capital is TOTAL equity. Split 50/50.
        const legSize = (capital / 2) * leverage;

        // 1. Short Leg Income
        const shortRateVal = (shortEx === "BINANCE" ? bRate : yRate) / 100;
        const shortIncome = legSize * shortRateVal; // Receiving

        // 2. Long Leg Cost
        const longRateVal = (longEx === "BINANCE" ? bRate : yRate) / 100;
        const longCost = legSize * longRateVal; // Paying (if positive rate)

        // 3. Fees (2 legs)
        const fees = (legSize * 0.001) * 2; // 0.1% * 2

        const netFunding = shortIncome - longCost;
        const totalPnL = netFunding - fees;

        setArbitrageResult({
            longEx,
            shortEx,
            legSize,
            shortIncome,
            longCost,
            fees,
            totalPnL,
            spread: spread
        });
    };

    const handleExecute = () => {
        if (platform === 'ARBITRAGE') {
            runArbitrageSimulation();
        } else {
            runSimulation(positionSize, recommendedAction);
        }
    };

    const handleManualTest = async (direction) => {
        if (!realExecution) {
            const sizeVal = testQty * (markPrice || 0);
            runSimulation(sizeVal, direction);
            return;
        }

        // Single Execution Logic (Existing)
        setLoading(true);
        setOrderStatus(null);
        await executeTrade(platform, direction, testQty);
        setLoading(false);
    };

    const handleArbitrageExecute = async () => {
        if (!arbitrageResult) { runArbitrageSimulation(); return; }

        // AUTO EXECUTE BOTH LEGS
        setLoading(true);
        setOrderStatus(null);

        try {
            // 1. Execute Long
            const p1 = executeTrade(arbitrageResult.longEx, "LONG", testQty);
            // 2. Execute Short
            const p2 = executeTrade(arbitrageResult.shortEx, "SHORT", testQty);

            await Promise.all([p1, p2]);

            setOrderStatus({
                status: 'success',
                message: `Arbitrage Executed! Long ${arbitrageResult.longEx} & Short ${arbitrageResult.shortEx}`
            });

        } catch (e) {
            setOrderStatus({ status: 'error', message: `Partial/Full Failure: ${e.message}` });
        } finally {
            setLoading(false);
        }
    };


    const executeTrade = async (targetPlatform, direction, qty) => {
        const getBackendUrl = () => {
            const primary = localStorage.getItem("primary_backend_url") || "http://127.0.0.1:8000";
            const backup = localStorage.getItem("backup_backend_url");
            return { primary, backup };
        };

        const getAuthHeaders = () => {
            const headers = { 'Content-Type': 'application/json' };
            if (targetPlatform === "BYBIT") {
                const key = localStorage.getItem("user_bybit_key");
                const secret = localStorage.getItem("user_bybit_secret");
                if (key) headers["X-User-Bybit-Key"] = key;
                if (secret) headers["X-User-Bybit-Secret"] = secret;
            } else {
                const key = localStorage.getItem("user_binance_key");
                const secret = localStorage.getItem("user_binance_secret");
                if (key) headers["X-User-Binance-Key"] = key;
                if (secret) headers["X-User-Binance-Secret"] = secret;
            }
            return headers;
        };

        const { primary, backup } = getBackendUrl();
        const headers = getAuthHeaders();

        const payload = {
            symbol: symbol,
            side: direction === "LONG" ? "Buy" : "Sell",
            qty: qty,
            leverage: leverage,
        };

        if (targetPlatform === "BINANCE") {
            const isTestnet = localStorage.getItem("user_binance_testnet") !== "false";
            payload.is_testnet = isTestnet;
        } else {
            payload.category = "linear";
        }

        const endpoint = targetPlatform === "BYBIT" ? "/api/place-order" : "/api/binance/place-order";

        const attemptFetch = async (baseUrl) => {
            const res = await fetch(`${baseUrl}${endpoint}`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Order Placement Failed (${targetPlatform})`);
            return data;
        };

        // Try Primary
        try {
            return await attemptFetch(primary);
        } catch (primaryErr) {
            console.warn("Primary API failed, trying backup...", primaryErr);
            if (backup) {
                return await attemptFetch(backup);
            } else {
                throw primaryErr;
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
                            Trade: {symbol}
                        </CardTitle>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={onClose}>
                            <X className="h-4 w-4" />
                        </Button>
                    </CardHeader>

                    <CardContent className="space-y-6 pt-6">

                        {/* Platform Selector */}
                        <div className="flex bg-muted p-1 rounded-lg">
                            <button onClick={() => setPlatform("BYBIT")} className={`flex-1 text-xs font-bold py-1.5 rounded-md transition-all ${platform === "BYBIT" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                                BYBIT ({bybitRate?.toFixed(4)}%)
                            </button>
                            <button onClick={() => setPlatform("BINANCE")} className={`flex-1 text-xs font-bold py-1.5 rounded-md transition-all ${platform === "BINANCE" ? "bg-background shadow-sm text-yellow-500" : "text-muted-foreground hover:text-foreground"}`}>
                                BINANCE ({binanceRate?.toFixed(4)}%)
                            </button>
                            <button onClick={() => setPlatform("ARBITRAGE")} className={`flex-1 text-xs font-bold py-1.5 rounded-md transition-all ${platform === "ARBITRAGE" ? "bg-background shadow-sm text-blue-500" : "text-muted-foreground hover:text-foreground"}`}>
                                ARBITRAGE (Auto)
                            </button>
                        </div>

                        {platform === 'ARBITRAGE' ? (
                            <div className="space-y-4">
                                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200">
                                    <h4 className="font-bold flex items-center gap-2 mb-2">
                                        <TrendingUp className="h-4 w-4" /> One-Click Arbitrage
                                    </h4>
                                    <p className="text-xs text-muted-foreground mb-4">
                                        System will automatically <strong>Long the lower rate</strong> and <strong>Short the higher rate</strong> APIs simultaneously.
                                    </p>

                                    <div className="grid grid-cols-2 gap-4 text-center">
                                        <div className="bg-background p-2 rounded border">
                                            <div className="text-xs text-muted-foreground">Spread</div>
                                            <div className="font-bold text-lg text-blue-600">
                                                {Math.abs((binanceRate || 0) - (bybitRate || 0)).toFixed(4)}%
                                            </div>
                                        </div>
                                        <div className="bg-background p-2 rounded border">
                                            <div className="text-xs text-muted-foreground">Est. 24h P&L</div>
                                            <div className="font-bold text-lg text-green-600">
                                                ~${((Math.abs((binanceRate || 0) - (bybitRate || 0)) / 100) * (capital * leverage) * 3).toFixed(2)}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {arbitrageResult && (
                                    <div className="space-y-2 text-sm border-t pt-2">
                                        <div className="flex justify-between"><span>Long Leg:</span> <span className="font-bold text-green-600">{arbitrageResult.longEx}</span></div>
                                        <div className="flex justify-between"><span>Short Leg:</span> <span className="font-bold text-red-600">{arbitrageResult.shortEx}</span></div>
                                        <div className="flex justify-between border-t pt-1 font-bold"><span>Net Period P&L:</span> <span>${arbitrageResult.totalPnL.toFixed(4)}</span></div>
                                    </div>
                                )}

                                <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold h-12" onClick={realExecution ? handleArbitrageExecute : handleExecute} disabled={loading}>
                                    {loading ? "Executing..." : (realExecution ? "EXECUTE ARBITRAGE (Real)" : "Simulate Arbitrage")}
                                </Button>
                            </div>
                        ) : (
                            <>
                                {/* Market Data Strip */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-muted/40 p-3 rounded-lg border">
                                        <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                                            {platform} Rate (Interval: {currentInterval}h)
                                        </span>
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
                                    </div>
                                </div>

                                {/* Controls */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-muted-foreground">Capital (USDT)</label>
                                        <Input type="number" value={capital} onChange={(e) => setCapital(Number(e.target.value))} className="font-bold" />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-muted-foreground">Leverage (x)</label>
                                        <Input type="number" value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} className="font-bold" />
                                    </div>
                                </div>

                                {/* Action Button */}
                                <Button
                                    className={`w-full h-12 text-lg font-bold shadow-lg transition-all ${recommendedAction === "LONG" ? "bg-green-600 hover:bg-green-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"}`}
                                    onClick={handleExecute}
                                >
                                    <Play className="mr-2 h-5 w-5 fill-current" />
                                    Simulate Recommended ({recommendedAction})
                                </Button>

                                {/* Manual Test Section */}
                                <div className="pt-4 border-t border-dashed">
                                    <div className="flex gap-3 items-end">
                                        <div className="space-y-1 flex-1">
                                            <label className="text-xs text-muted-foreground">Qty (Units)</label>
                                            <Input type="number" value={testQty} onChange={(e) => setTestQty(Number(e.target.value))} className="h-10 font-bold" />
                                        </div>
                                        <Button className="flex-1 h-10 bg-green-500 hover:bg-green-600 text-white font-bold" onClick={() => handleManualTest("LONG")} disabled={loading}>
                                            {loading ? "Placing..." : "Buy / Long"}
                                        </Button>
                                        <Button className="flex-1 h-10 bg-red-500 hover:bg-red-600 text-white font-bold" onClick={() => handleManualTest("SHORT")} disabled={loading}>
                                            {loading ? "Placing..." : "Sell / Short"}
                                        </Button>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Simulation Result Area */}
                        {!realExecution && platform !== "ARBITRAGE" && simulationResult && (
                            <div className="bg-muted p-4 rounded-lg border-2 border-primary/10 mt-4">
                                <div className="flex justify-between font-bold border-b pb-2"><span>Net P&L</span> <span className={simulationResult.netPnL >= 0 ? "text-green-600" : "text-red-500"}>${simulationResult.netPnL.toFixed(4)}</span></div>
                                <div className="text-xs text-muted-foreground mt-2">Inc. Fees: -${simulationResult.tradingFees.toFixed(4)}</div>
                            </div>
                        )}

                        {/* Order Status Alert */}
                        {orderStatus && (
                            <div className={`p-3 rounded-md text-sm font-medium mt-4 ${orderStatus.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {orderStatus.status === 'success' ? <TrendingUp className="h-4 w-4 inline mr-2" /> : <AlertTriangle className="h-4 w-4 inline mr-2" />}
                                {orderStatus.message}
                            </div>
                        )}

                        <div className="flex items-center justify-between mt-4">
                            <div className="flex items-center gap-2">
                                <Switch checked={realExecution} onCheckedChange={setRealExecution} id="real-mode" />
                                <label htmlFor="real-mode" className={`text-xs font-bold ${realExecution ? "text-orange-600" : "text-muted-foreground"}`}>
                                    {realExecution ? "REAL EXECUTION (API)" : "Simulation Only"}
                                </label>
                            </div>
                        </div>

                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
