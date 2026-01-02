import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { X, Play, RefreshCw, AlertTriangle, TrendingUp, TrendingDown, Clock, Timer, CheckCircle2 } from "lucide-react";
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

    // Scheduler State
    const [scheduleMode, setScheduleMode] = useState(false);
    const [scheduledTime, setScheduledTime] = useState("");
    const [autoSellDelay, setAutoSellDelay] = useState(60); // Seconds
    const [schedulerStatus, setSchedulerStatus] = useState("IDLE"); // IDLE | WAITING | EXECUTING | COMPLETED | FAILED
    const [scheduledTimerId, setScheduledTimerId] = useState(null);
    const [orderStatus, setOrderStatus] = useState(null);
    const [loading, setLoading] = useState(false);

    // Refs for closure access
    const paramsRef = useRef({ capital, leverage, testQty, platform, realExecution });
    useEffect(() => {
        paramsRef.current = { capital, leverage, testQty, platform, realExecution };
    }, [capital, leverage, testQty, platform, realExecution]);

    // --- HOST HELPERS ---
    const getBackendUrl = () => {
        const primary = localStorage.getItem("primary_backend_url") || "http://127.0.0.1:8000";
        const backup = localStorage.getItem("backup_backend_url");
        return { primary, backup };
    };

    // --- BACKEND SCHEDULER POLLING ---
    const [backendTasks, setBackendTasks] = useState({});

    useEffect(() => {
        const pollTasks = async () => {
            try {
                const { primary } = getBackendUrl();
                const res = await fetch(`${primary}/api/scheduled-tasks`);
                if (res.ok) {
                    const data = await res.json();
                    setBackendTasks(data.tasks);

                    // Sync UI Status
                    const tasks = Object.values(data.tasks);
                    if (tasks.length > 0) {
                        const latest = tasks.sort((a, b) => b.created_at - a.created_at)[0];
                        if (latest.status.includes("WAITING")) setSchedulerStatus("WAITING");
                        else if (latest.status.includes("EXECUTING")) setSchedulerStatus("EXECUTING");
                        else if (latest.status === "COMPLETED") setSchedulerStatus("COMPLETED");
                        else if (latest.status.startsWith("FAILED")) setSchedulerStatus("FAILED");
                    }
                }
            } catch (e) {
                // Silent fail on poll
            }
        };
        const interval = setInterval(pollTasks, 2000); // 2s polling
        return () => clearInterval(interval);
    }, []);


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

    const positionSize = capital * leverage;

    // Suggestion Logic
    const isRateNegative = fundingRate < 0;
    const recommendedAction = isRateNegative ? "LONG" : "SHORT";
    const recommendationColor = isRateNegative ? "text-green-600" : "text-red-600";
    const recommendationBg = isRateNegative ? "bg-green-100 dark:bg-green-900/30" : "bg-red-100 dark:bg-red-900/30";

    // --- LOGIC HELPERS ---

    const calculateArbitrageParams = () => {
        const bRate = binanceRate || 0;
        const yRate = bybitRate || 0;
        const spread = Math.abs(bRate - yRate);

        let longEx = "BYBIT";
        let shortEx = "BINANCE";

        // If Binance Rate > Bybit Rate:
        // We Short Binance (Receive High), Long Bybit (Pay Low/Receive Negative)
        if (bRate > yRate) {
            shortEx = "BINANCE";
            longEx = "BYBIT";
        } else {
            shortEx = "BYBIT";
            longEx = "BINANCE";
        }

        const legSize = (capital / 2) * leverage;
        // Calc PnL
        const shortRateVal = (shortEx === "BINANCE" ? bRate : yRate) / 100;
        const longRateVal = (longEx === "BINANCE" ? bRate : yRate) / 100;
        const shortIncome = legSize * shortRateVal;
        const longCost = legSize * longRateVal;
        const fees = (legSize * 0.001) * 2;
        const netFunding = shortIncome - longCost;
        const totalPnL = netFunding - fees;

        return {
            longEx, shortEx,
            legSize, shortIncome, longCost, fees, totalPnL, spread,
            bRate, yRate
        };
    };

    const runSimulation = (sizeVal, direction) => {
        let fundingIncome = 0;
        const rateAbs = Math.abs(fundingRate);
        const rateDecimal = rateAbs / 100;

        if (fundingRate > 0) {
            if (direction === "SHORT") fundingIncome = sizeVal * rateDecimal;
            else fundingIncome = -(sizeVal * rateDecimal);
        } else {
            if (direction === "LONG") fundingIncome = sizeVal * rateDecimal;
            else fundingIncome = -(sizeVal * rateDecimal);
        }

        const tradingFeeRate = 0.1;
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
        const params = calculateArbitrageParams();
        setArbitrageResult(params);
        return params;
    };

    const handleExecute = () => {
        if (platform === 'ARBITRAGE') {
            runArbitrageSimulation();
        } else {
            runSimulation(positionSize, recommendedAction);
        }
    };

    // --- EXECUTION HANDLERS ---

    const handleManualTest = async (direction) => {
        if (!realExecution) {
            const sizeVal = testQty * (markPrice || 0);
            runSimulation(sizeVal, direction);
            return;
        }
        setLoading(true);
        setOrderStatus(null);
        await executeTrade(platform, direction, testQty);
        setLoading(false);
    };

    const handleArbitrageExecute = async () => {
        // Always recalculate fresh for execution to be safe
        const params = calculateArbitrageParams();
        setArbitrageResult(params); // Update UI

        if (!realExecution) {
            // Just simulation was run above
            return;
        }

        setLoading(true);
        setOrderStatus(null);

        try {
            // Execute Simultaneously
            const p1 = executeTrade(params.longEx, "LONG", testQty);
            const p2 = executeTrade(params.shortEx, "SHORT", testQty);

            await Promise.all([p1, p2]);

            setOrderStatus({
                status: 'success',
                message: `Arbitrage Entry: Long ${params.longEx} / Short ${params.shortEx}`
            });

        } catch (e) {
            setOrderStatus({ status: 'error', message: `Execution Error: ${e.message}` });
        } finally {
            setLoading(false);
        }
    };


    const executeTrade = async (targetPlatform, direction, qty) => {
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

    // --- SCHEDULER LOGIC ---

    const startScheduler = async () => {
        if (!scheduledTime) {
            alert("Please select a valid start time.");
            return;
        }

        const targetTime = new Date(scheduledTime).getTime();
        const now = Date.now();
        const delay = targetTime - now;

        if (delay <= 0) {
            alert("Scheduled time in past! Please select future time.");
            setSchedulerStatus("IDLE");
            return;
        }

        // Construct Payload
        const payload = {
            symbol: symbol,
            // direction will be set below
            targetTime: targetTime / 1000,
            leverage: leverage,
            qty: testQty,
            platform: platform === "ARBITRAGE" ? "Both" : platform
        };

        // Derive direction if not explicit (or allow user to pick?)
        // For simplicity in this Demo Modal, let's assume direction is "recommendedAction" unless Arbitrage
        if (platform !== "ARBITRAGE") {
            payload.direction = recommendedAction === "LONG" ? "Buy" : "Sell";
        } else {
            // For Arbitrage, Backend handles "Buy Long / Sell Short" logic effectively or we send "Arbitrage"
            // Our current backend 'schedule_trade' expects 'direction' for single leg or we handle Arbitrage logic in Backend.
            // Let's pass "Buy" as placeholder and let logic handle it, OR better:
            // The User wants to "Take Next Funding".
            // We'll pass the direction derived from Funding Rate sign.
            const isNeg = (binanceRate || 0) < 0; // Simple check
            payload.direction = isNeg ? "Buy" : "Sell"; // Long if negative? 
        }

        setSchedulerStatus("WAITING");
        console.log(`Scheduling Backend Task for ${new Date(targetTime).toLocaleTimeString()}...`);

        // Prepare Headers with Keys
        const headers = { 'Content-Type': 'application/json' };

        const bybitKey = localStorage.getItem("user_bybit_key");
        const bybitSecret = localStorage.getItem("user_bybit_secret");
        if (bybitKey) headers["X-User-Bybit-Key"] = bybitKey;
        if (bybitSecret) headers["X-User-Bybit-Secret"] = bybitSecret;

        const binanceKey = localStorage.getItem("user_binance_key");
        const binanceSecret = localStorage.getItem("user_binance_secret");
        if (binanceKey) headers["X-User-Binance-Key"] = binanceKey;
        if (binanceSecret) headers["X-User-Binance-Secret"] = binanceSecret;

        try {
            const { primary } = getBackendUrl();
            const res = await fetch(`${primary}/api/schedule-trade`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                const data = await res.json();
                console.log(`✅ Task Scheduled! ID: ${data.taskId}`);
            } else {
                console.error(`❌ Schedule Failed.`);
                setSchedulerStatus("FAILED");
            }
        } catch (e) {
            console.error(`❌ Error: ${e.message}`);
            setSchedulerStatus("FAILED");
        }
    };

    const cancelScheduler = () => {
        // Backend task cancellation not implemented yet, just reset UI
        setSchedulerStatus("IDLE");
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

                        {/* SCHEDULER SECTION */}
                        <div className="border border-indigo-200 dark:border-indigo-800 rounded-lg overflow-hidden bg-muted/10">
                            <div className="flex items-center justify-between p-3 bg-indigo-50/50 dark:bg-indigo-950/20">
                                <label className="text-sm font-bold flex items-center gap-2 text-indigo-700 dark:text-indigo-400">
                                    <Clock className="h-4 w-4" />
                                    Timed Execution / Sniper
                                </label>
                                <Switch checked={scheduleMode} onCheckedChange={setScheduleMode} />
                            </div>

                            {scheduleMode && (
                                <div className="p-4 space-y-4 animate-in slide-in-from-top-2">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold flex items-center gap-1"><Play className="h-3 w-3" /> Entry Time</label>
                                            <Input
                                                type="datetime-local"
                                                className="text-xs font-mono h-8"
                                                value={scheduledTime}
                                                onChange={e => setScheduledTime(e.target.value)}
                                                disabled={schedulerStatus === "WAITING"}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold flex items-center gap-1"><Timer className="h-3 w-3" /> Exit Delay (s)</label>
                                            <Input
                                                type="number"
                                                value={autoSellDelay}
                                                onChange={e => setAutoSellDelay(Number(e.target.value))}
                                                className="text-xs font-mono h-8"
                                                disabled={schedulerStatus === "WAITING"}
                                            />
                                        </div>
                                    </div>

                                    {schedulerStatus === "IDLE" || schedulerStatus === "COMPLETED" || schedulerStatus === "FAILED" ? (
                                        <Button size="sm" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold" onClick={startScheduler}>
                                            Arm Scheduler
                                        </Button>
                                    ) : (
                                        <div className="text-center space-y-2 bg-indigo-100 dark:bg-indigo-900/30 p-2 rounded">
                                            <div className="text-xs font-mono animate-pulse text-indigo-600 dark:text-indigo-400 font-bold uppercase">
                                                STATUS: {schedulerStatus}
                                            </div>
                                            <Button size="sm" variant="destructive" className="w-full h-7 text-xs" onClick={cancelScheduler}>
                                                Cancel / Disarm
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {platform === 'ARBITRAGE' ? (
                            <div className="space-y-4">
                                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200">
                                    <h4 className="font-bold flex items-center gap-2 mb-2">
                                        <TrendingUp className="h-4 w-4" /> One-Click Arbitrage
                                    </h4>
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
                                    </div>
                                )}

                                <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold h-12" onClick={realExecution ? handleArbitrageExecute : handleExecute} disabled={loading || schedulerStatus === "WAITING"}>
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
                                    disabled={schedulerStatus === "WAITING"}
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
                                        <Button className="flex-1 h-10 bg-green-500 hover:bg-green-600 text-white font-bold" onClick={() => handleManualTest("LONG")} disabled={loading || schedulerStatus === "WAITING"}>
                                            {loading ? "Placing..." : "Buy / Long"}
                                        </Button>
                                        <Button className="flex-1 h-10 bg-red-500 hover:bg-red-600 text-white font-bold" onClick={() => handleManualTest("SHORT")} disabled={loading || schedulerStatus === "WAITING"}>
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
                                {orderStatus.status === 'success' ? <CheckCircle2 className="h-4 w-4 inline mr-2" /> : <AlertTriangle className="h-4 w-4 inline mr-2" />}
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
