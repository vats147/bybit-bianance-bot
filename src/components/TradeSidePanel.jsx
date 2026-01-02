import { useState, useEffect, useRef } from "react";
import { X, Settings, Wallet, CheckCircle2, Calculator, TrendingUp, TrendingDown, Zap, ArrowRightLeft, AlertTriangle, ShieldCheck, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

export function TradeSidePanel({ isOpen, onClose, data, onExecute }) {
    const toast = useToast();
    const [activeTab, setActiveTab] = useState("market");
    const [marginMode, setMarginMode] = useState("Cross");
    const [leverage, setLeverage] = useState(10);
    const [duration, setDuration] = useState(30); // Default duration
    const [amount, setAmount] = useState("");
    const [sliderValue, setSliderValue] = useState(0);
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);

    // Confirmation & Positions
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [pendingTrade, setPendingTrade] = useState(null);
    const [positions, setPositions] = useState({ bybit: null, binance: null });
    const [closeStep, setCloseStep] = useState(0);

    // Dropdown states
    const [showMarginDropdown, setShowMarginDropdown] = useState(false);
    const [showLeverageDropdown, setShowLeverageDropdown] = useState(false);

    // Available options
    const marginModes = ["Cross", "Isolated"];
    const leverageOptions = [1, 2, 3, 5, 10, 20, 25, 50, 75, 100];

    // Derived from data
    const symbol = data?.symbol || "BTC";
    const markPrice = data?.markPrice || 0;
    const binanceRate = data?.binanceRate || 0;
    const bybitRate = data?.bybitRate || 0;
    const spread = data?.spread || 0;
    const balance = 175.1054; // Mock balance

    // Safety Lock
    const isTradeLocked = Math.abs(binanceRate) === 0 || Math.abs(bybitRate) === 0;

    // Strategy recommendation based on funding rates
    const recommendation = (() => {
        if (binanceRate < bybitRate) {
            return {
                longPlatform: "Binance",
                shortPlatform: "Bybit",
                longRate: binanceRate,
                shortRate: bybitRate,
                expectedProfit: Math.abs(bybitRate - binanceRate)
            };
        } else {
            return {
                longPlatform: "Bybit",
                shortPlatform: "Binance",
                longRate: bybitRate,
                shortRate: binanceRate,
                expectedProfit: Math.abs(binanceRate - bybitRate)
            };
        }
    })();

    useEffect(() => {
        if (isOpen) {
            setLogs([]);
            addLog(`Opened trade panel for ${symbol}`);
            if (spread > 0) {
                addLog(`Strategy: Long ${recommendation.longPlatform} (${recommendation.longRate.toFixed(4)}%), Short ${recommendation.shortPlatform} (${recommendation.shortRate.toFixed(4)}%)`, "info");
            }
        }
    }, [isOpen, symbol]);

    // Close dropdowns when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (!event.target.closest('.dropdown-trigger') && !event.target.closest('.dropdown-menu')) {
                setShowMarginDropdown(false);
                setShowLeverageDropdown(false);
            }
        };
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, []);

    const addLog = (message, type = "info") => {
        const timestamp = new Date().toLocaleTimeString();
        setLogs(prev => [...prev, { message, type, timestamp }]);
    };

    const handleSliderChange = (e) => {
        const val = Number(e.target.value);
        setSliderValue(val);
        const margin = (balance * val) / 100;
        const totalValue = margin * leverage;
        setAmount(totalValue.toFixed(2));
    };

    const handleAmountChange = (e) => {
        setAmount(e.target.value);
        const val = Number(e.target.value);
        if (val && leverage && balance) {
            const margin = val / leverage;
            const pct = (margin / balance) * 100;
            setSliderValue(Math.min(100, Math.max(0, pct)));
        }
    };

    const fetchPositions = async () => {
        if (!isOpen || !symbol) return;
        const bybitKey = localStorage.getItem("user_bybit_key");
        const bybitSecret = localStorage.getItem("user_bybit_secret");
        const binanceKey = localStorage.getItem("user_binance_key");
        const binanceSecret = localStorage.getItem("user_binance_secret");
        const backendUrl = localStorage.getItem("primary_backend_url") || "http://127.0.0.1:8000";

        try {
            const res = await fetch(`${backendUrl}/api/positions?symbol=${symbol}`, {
                headers: {
                    "X-User-Bybit-Key": bybitKey || "",
                    "X-User-Bybit-Secret": bybitSecret || "",
                    "X-User-Binance-Key": binanceKey || "",
                    "X-User-Binance-Secret": binanceSecret || ""
                }
            });
            const data = await res.json();
            setPositions(data);
        } catch (e) {
            console.error("Failed to fetch positions:", e);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchPositions();
            const interval = setInterval(fetchPositions, 5000); // Poll positions
            return () => clearInterval(interval);
        }
    }, [isOpen, symbol]);

    const handleExecuteClick = (side, platform) => {
        if (!amount || Number(amount) <= 0) {
            toast.error("Invalid amount entered");
            return;
        }
        setPendingTrade({ side, platform });
        setShowConfirmModal(true);
    };

    const confirmAndExecute = () => {
        setShowConfirmModal(false);
        if (pendingTrade) {
            executeTrade(pendingTrade.side, pendingTrade.platform);
        }
    };

    const executeTrade = async (side, platform) => {
        if (!amount || Number(amount) <= 0) {
            addLog("Invalid amount", "error");
            toast.error("Invalid amount entered");
            return;
        }

        setLoading(true);

        // Get API keys from localStorage (match keys from SettingsPage)
        const bybitKey = localStorage.getItem("user_bybit_key") || "";
        const bybitSecret = localStorage.getItem("user_bybit_secret") || "";
        const binanceKey = localStorage.getItem("user_binance_key") || "";
        const binanceSecret = localStorage.getItem("user_binance_secret") || "";
        const isTestnet = localStorage.getItem("user_binance_testnet") !== "false";

        const backendUrl = localStorage.getItem("primary_backend_url") || "http://127.0.0.1:8000";

        // Smart quantity calculation with proper precision based on price
        // Expensive tokens (BTC, ETH) need more decimals, cheap tokens need integers
        const calculateQty = (usdAmount, price) => {
            if (price <= 0) return usdAmount;
            const rawQty = usdAmount / price;

            // Determine precision based on price
            let precision;
            if (price >= 1000) {
                precision = 3; // BTC, ETH - allow 3 decimals
            } else if (price >= 10) {
                precision = 2; // Mid-range tokens
            } else if (price >= 1) {
                precision = 1; // Low-range tokens
            } else {
                precision = 0; // Very cheap tokens - integer only
            }

            // Round down to avoid "insufficient balance" errors
            const multiplier = Math.pow(10, precision);
            return Math.floor(rawQty * multiplier) / multiplier;
        };

        const qty = calculateQty(Number(amount), markPrice);

        try {
            if (side === "Schedule") {
                addLog(`Scheduling Auto-Trade for ${symbol} (Next Minute)...`, "info");
                // Calculate target time: Next minute boundary
                const now = Date.now();
                const nextMinute = Math.ceil(now / 60000) * 60000;
                // Add minor buffer if too close (e.g. < 10s away, move to next next minute)
                const targetTime = (nextMinute - now < 10000) ? (nextMinute + 60000) : nextMinute;

                // Add Headers for API Keys
                const res = await fetch(`${backendUrl}/api/schedule-trade`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-User-Bybit-Key": bybitKey,
                        "X-User-Bybit-Secret": bybitSecret,
                        "X-User-Binance-Key": binanceKey,
                        "X-User-Binance-Secret": binanceSecret
                    },
                    body: JSON.stringify({
                        symbol: symbol,
                        direction: "Both", // Implies Auto-Arbitrage
                        platform: "Both", // Arbitrage
                        qty: parseFloat(qty),
                        leverage: leverage,
                        targetTime: targetTime / 1000, // Send as seconds
                        duration: duration // Send duration in seconds
                    })
                });

                const data = await res.json();
                if (res.ok) {
                    addLog(`✅ Trade Scheduled! ID: ${data.taskId}`, "success");
                    toast.success(`Trade Scheduled for ${new Date(targetTime).toLocaleTimeString()}`);
                } else {
                    addLog(`❌ Schedule Failed: ${data.detail}`, "error");
                    toast.error(`Schedule Failed: ${data.detail}`);
                }
                setLoading(false);
                return;
            }

            if (platform === "Both") {
                addLog(`Executing Arbitrage Trade: Long ${recommendation.longPlatform}, Short ${recommendation.shortPlatform}...`, "info");

                // Execute Long order
                const longPlatform = recommendation.longPlatform;
                const longSide = "Buy";
                if (longPlatform === "Bybit") {
                    addLog(`Placing Long on Bybit - ${symbol} @ ${leverage}x...`, "info");
                    const res = await fetch(`${backendUrl}/api/place-order`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "X-User-Bybit-Key": bybitKey,
                            "X-User-Bybit-Secret": bybitSecret
                        },
                        body: JSON.stringify({
                            symbol: symbol,
                            side: longSide,
                            qty: parseFloat(qty),
                            leverage: leverage
                        })
                    });
                    const data = await res.json();
                    if (res.ok && data.status === "success") {
                        addLog(`✅ Long ${symbol} on Bybit - ${amount} USDC @ ${leverage}x`, "success");
                        toast.success(`Long ${symbol} on Bybit executed!`);
                    } else {
                        const errMsg = data.detail || data.retMsg || "Unknown error";
                        addLog(`❌ Bybit Long Failed: ${errMsg}`, "error");
                        toast.error(`Bybit Long Failed: ${errMsg}`);
                    }
                } else {
                    addLog(`Placing Long on Binance - ${symbol} @ ${leverage}x...`, "info");
                    const res = await fetch(`${backendUrl}/api/binance/place-order`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "X-User-Binance-Key": binanceKey,
                            "X-User-Binance-Secret": binanceSecret
                        },
                        body: JSON.stringify({
                            symbol: symbol,
                            side: longSide,
                            qty: parseFloat(qty),
                            leverage: leverage,
                            is_testnet: isTestnet
                        })
                    });
                    const data = await res.json();
                    if (res.ok && data.status === "success") {
                        addLog(`✅ Long ${symbol} on Binance - ${amount} USDC @ ${leverage}x`, "success");
                        toast.success(`Long ${symbol} on Binance executed!`);
                    } else {
                        const errMsg = data.detail || data.msg || "Unknown error";
                        addLog(`❌ Binance Long Failed: ${errMsg}`, "error");
                        toast.error(`Binance Long Failed: ${errMsg}`);
                    }
                }

                // Execute Short order
                const shortPlatform = recommendation.shortPlatform;
                const shortSide = "Sell";
                if (shortPlatform === "Bybit") {
                    addLog(`Placing Short on Bybit - ${symbol} @ ${leverage}x...`, "info");
                    const res = await fetch(`${backendUrl}/api/place-order`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "X-User-Bybit-Key": bybitKey,
                            "X-User-Bybit-Secret": bybitSecret
                        },
                        body: JSON.stringify({
                            symbol: symbol,
                            side: shortSide,
                            qty: parseFloat(qty),
                            leverage: leverage
                        })
                    });
                    const data = await res.json();
                    if (res.ok && data.status === "success") {
                        addLog(`✅ Short ${symbol} on Bybit - ${amount} USDC @ ${leverage}x`, "success");
                        toast.success(`Short ${symbol} on Bybit executed!`);
                    } else {
                        const errMsg = data.detail || data.retMsg || "Unknown error";
                        addLog(`❌ Bybit Short Failed: ${errMsg}`, "error");
                        toast.error(`Bybit Short Failed: ${errMsg}`);
                    }
                } else {
                    addLog(`Placing Short on Binance - ${symbol} @ ${leverage}x...`, "info");
                    const res = await fetch(`${backendUrl}/api/binance/place-order`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "X-User-Binance-Key": binanceKey,
                            "X-User-Binance-Secret": binanceSecret
                        },
                        body: JSON.stringify({
                            symbol: symbol,
                            side: shortSide,
                            qty: parseFloat(qty),
                            leverage: leverage,
                            is_testnet: isTestnet
                        })
                    });
                    const data = await res.json();
                    if (res.ok && data.status === "success") {
                        addLog(`✅ Short ${symbol} on Binance - ${amount} USDC @ ${leverage}x`, "success");
                        toast.success(`Short ${symbol} on Binance executed!`);
                    } else {
                        const errMsg = data.detail || data.msg || "Unknown error";
                        addLog(`❌ Binance Short Failed: ${errMsg}`, "error");
                        toast.error(`Binance Short Failed: ${errMsg}`);
                    }
                }

                addLog(`Arbitrage position opened! Expected profit: ${recommendation.expectedProfit.toFixed(4)}%`, "success");

            } else {
                // Individual trade
                const tradeDirection = side === "Long" ? "Buy" : "Sell";
                addLog(`Submitting ${side} order on ${platform} for ${amount} USDC...`, "info");

                if (platform === "Bybit") {
                    const res = await fetch(`${backendUrl}/api/place-order`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "X-User-Bybit-Key": bybitKey,
                            "X-User-Bybit-Secret": bybitSecret
                        },
                        body: JSON.stringify({
                            symbol: symbol,
                            side: tradeDirection,
                            qty: parseFloat(qty),
                            leverage: leverage
                        })
                    });
                    const data = await res.json();
                    if (res.ok && data.status === "success") {
                        addLog(`✅ Order Filled! ${side} ${symbol} on Bybit @ ${leverage}x`, "success");
                        toast.success(`${side} ${symbol} on Bybit executed!`);
                    } else {
                        const errMsg = data.detail || data.retMsg || "Unknown error";
                        addLog(`❌ Failed: ${errMsg}`, "error");
                        toast.error(`Bybit ${side} Failed: ${errMsg}`);
                    }
                } else if (platform === "Binance") {
                    const res = await fetch(`${backendUrl}/api/binance/place-order`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "X-User-Binance-Key": binanceKey,
                            "X-User-Binance-Secret": binanceSecret
                        },
                        body: JSON.stringify({
                            symbol: symbol,
                            side: tradeDirection,
                            qty: parseFloat(qty),
                            leverage: leverage,
                            is_testnet: isTestnet
                        })
                    });
                    const data = await res.json();
                    if (res.ok && data.status === "success") {
                        addLog(`✅ Order Filled! ${side} ${symbol} on Binance @ ${leverage}x`, "success");
                        toast.success(`${side} ${symbol} on Binance executed!`);
                    } else {
                        const errMsg = data.detail || data.msg || "Unknown error";
                        addLog(`❌ Failed: ${errMsg}`, "error");
                        toast.error(`Binance ${side} Failed: ${errMsg}`);
                    }
                }
            }
        } catch (error) {
            console.error("Trade execution error:", error);
            addLog(`❌ Error: ${error.message}`, "error");
            toast.error(`Trade Error: ${error.message}`);
        }

        setLoading(false);
    };

    if (!isOpen) return null;

    return (
        <>
            {/* Slide-in Panel */}
            <div className={cn(
                "fixed top-0 right-0 h-full w-full md:w-[400px] bg-[#1e1e24] z-50 shadow-2xl transform transition-transform duration-300 ease-in-out border-l border-white/10 flex flex-col",
                isOpen ? "translate-x-0" : "translate-x-full"
            )}>
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-[#25252b]">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-lg text-white">Trade</span>
                        <span className="text-sm text-yellow-500 font-mono">{symbol}USDT</span>
                    </div>
                    <div className="flex items-center gap-3 text-gray-400">
                        <Wallet className="w-5 h-5 hover:text-white cursor-pointer" />
                        <Settings className="w-5 h-5 hover:text-white cursor-pointer" />
                        <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-white/10 rounded-full h-8 w-8 text-white">
                            <X className="w-5 h-5" />
                        </Button>
                    </div>
                </div>

                {/* Content - Scrollable */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm text-gray-300">

                    {/* Strategy Recommendation Card */}
                    {spread > 0 && (
                        <div className="bg-gradient-to-r from-green-500/10 to-blue-500/10 border border-green-500/30 rounded-lg p-3 space-y-2">
                            <div className="flex items-center gap-2 text-white font-bold text-sm">
                                <Zap className="w-4 h-4 text-yellow-500" />
                                Strategy Recommendation
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="bg-green-500/20 rounded p-2 border border-green-500/30">
                                    <div className="flex items-center gap-1 text-green-400 font-bold">
                                        <TrendingUp className="w-3 h-3" /> Long
                                    </div>
                                    <div className="text-white font-bold">{recommendation.longPlatform}</div>
                                    <div className="text-gray-400">{recommendation.longRate.toFixed(4)}%</div>
                                </div>
                                <div className="bg-red-500/20 rounded p-2 border border-red-500/30">
                                    <div className="flex items-center gap-1 text-red-400 font-bold">
                                        <TrendingDown className="w-3 h-3" /> Short
                                    </div>
                                    <div className="text-white font-bold">{recommendation.shortPlatform}</div>
                                    <div className="text-gray-400">{recommendation.shortRate.toFixed(4)}%</div>
                                </div>
                            </div>
                            <div className="text-center text-xs text-green-400 font-mono">
                                Expected Spread Profit: {recommendation.expectedProfit.toFixed(4)}%
                            </div>
                        </div>
                    )}

                    {/* Safety Alert */}
                    {isTradeLocked && (
                        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-3">
                            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                            <div className="text-xs text-red-400 font-bold">
                                TRADE LOCKED: 0.0000% rate detected.
                                <span className="block font-normal opacity-80 mt-1">Trading is disabled to prevent loss-making positions.</span>
                            </div>
                        </div>
                    )}

                    {/* Top Controls: Margin Mode & Leverage */}
                    <div className="flex gap-2">
                        {/* Margin Mode Dropdown */}
                        <div className="flex-1 relative">
                            <div
                                className="dropdown-trigger bg-[#2b2b32] rounded-md px-3 py-2 flex justify-between items-center cursor-pointer hover:bg-[#32323a] border border-transparent hover:border-white/20"
                                onClick={() => {
                                    setShowMarginDropdown(!showMarginDropdown);
                                    setShowLeverageDropdown(false);
                                }}
                            >
                                <span className="font-semibold text-white">{marginMode}</span>
                                <span className={cn("text-xs text-gray-500 transition-transform", showMarginDropdown && "rotate-180")}>▼</span>
                            </div>
                            {showMarginDropdown && (
                                <div className="dropdown-menu absolute top-full left-0 right-0 mt-1 bg-[#2b2b32] rounded-md border border-white/20 overflow-hidden z-[60] shadow-xl">
                                    {marginModes.map((mode) => (
                                        <div
                                            key={mode}
                                            className={cn(
                                                "px-3 py-2 cursor-pointer hover:bg-[#3a3a42] text-sm",
                                                mode === marginMode ? "text-yellow-500 bg-[#3a3a42]" : "text-white"
                                            )}
                                            onClick={() => {
                                                setMarginMode(mode);
                                                setShowMarginDropdown(false);
                                                addLog(`Margin mode changed to ${mode}`, "info");
                                            }}
                                        >
                                            {mode}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Leverage Dropdown */}
                        <div className="flex-1 relative">
                            <div
                                className="dropdown-trigger bg-[#2b2b32] rounded-md px-3 py-2 flex justify-between items-center cursor-pointer hover:bg-[#32323a] border border-transparent hover:border-white/20"
                                onClick={() => {
                                    setShowLeverageDropdown(!showLeverageDropdown);
                                    setShowMarginDropdown(false);
                                }}
                            >
                                <span className="font-semibold text-yellow-500">{leverage}x</span>
                                <span className={cn("text-xs text-gray-500 transition-transform", showLeverageDropdown && "rotate-180")}>▼</span>
                            </div>
                            {showLeverageDropdown && (
                                <div className="dropdown-menu absolute top-full left-0 right-0 mt-1 bg-[#2b2b32] rounded-md border border-white/20 overflow-hidden z-[60] shadow-xl max-h-48 overflow-y-auto">
                                    {leverageOptions.map((lev) => (
                                        <div
                                            key={lev}
                                            className={cn(
                                                "px-3 py-2 cursor-pointer hover:bg-[#3a3a42] text-sm",
                                                lev === leverage ? "text-yellow-500 bg-[#3a3a42]" : "text-white"
                                            )}
                                            onClick={() => {
                                                setLeverage(lev);
                                                setShowLeverageDropdown(false);
                                                addLog(`Leverage changed to ${lev}x`, "info");
                                            }}
                                        >
                                            {lev}x
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Order Type Header (Simplified) */}
                    <div className="text-white/50 text-sm font-medium pb-2 border-b border-white/10 mb-4">
                        <span className="text-yellow-500 font-bold border-b-2 border-yellow-500 pb-1">Market</span>
                    </div>

                    {/* Amount Input */}
                    <div className="space-y-3">
                        <div className="bg-[#2b2b32] rounded-lg p-1 flex items-center border border-transparent focus-within:border-yellow-500/50 transition-colors">
                            <div className="flex-1 px-3 py-1">
                                <label className="text-xs text-gray-500 block">Value (per side)</label>
                                <input
                                    type="number"
                                    value={amount}
                                    onChange={handleAmountChange}
                                    placeholder="0.00"
                                    className="bg-transparent text-white font-bold text-lg w-full outline-none placeholder:text-gray-600"
                                />
                            </div>
                            <div className="px-3 border-l border-white/5 flex items-center gap-2">
                                <img src="https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/usdt.png" className="w-5 h-5 rounded-full" alt="USDT" />
                                <span className="font-bold text-white">USDT</span>
                            </div>
                        </div>

                        {/* Quantity Preview */}
                        {amount && Number(amount) > 0 && (
                            <div className="flex justify-between text-[10px] text-gray-500 font-mono px-2">
                                <span>
                                    Bybit: <span className="text-yellow-500 font-bold">≈ {(Number(amount) / (markPrice || 1)).toFixed(3)} {symbol}</span>
                                </span>
                                <span>
                                    Binance: <span className="text-yellow-500 font-bold">≈ {(Number(amount) / (markPrice || 1)).toFixed(3)} {symbol}</span>
                                </span>
                            </div>
                        )}

                        {/* Slider */}
                        <div className="pt-1 px-1">
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={sliderValue}
                                onChange={handleSliderChange}
                                className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                            />
                            <div className="flex justify-between text-xs text-gray-500 mt-1 font-mono">
                                <span>0%</span>
                                <span className="text-yellow-500 font-bold">{sliderValue.toFixed(0)}%</span>
                                <span>100%</span>
                            </div>
                        </div>

                        {/* Duration Input for Auto-Trade */}
                        <div className="bg-[#2b2b32] rounded-lg p-2 flex items-center justify-between border border-white/5">
                            <span className="text-xs text-gray-500">Auto-Close Delay (s)</span>
                            <div className="flex items-center gap-2">
                                <span className="text-white font-bold text-sm">{duration}s</span>
                                <input
                                    type="range"
                                    min="5"
                                    max="300"
                                    step="5"
                                    value={duration}
                                    onChange={(e) => setDuration(Number(e.target.value))}
                                    className="w-24 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                />
                            </div>
                        </div>

                        {/* Trade Buttons */}
                        <div className="space-y-2 pt-2">
                            {/* Execute Both - Main CTA */}
                            <Button
                                className={cn(
                                    "w-full h-12 text-white font-bold text-base rounded-md shadow-lg",
                                    isTradeLocked
                                        ? "bg-gray-700 cursor-not-allowed opacity-50"
                                        : "bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700"
                                )}
                                onClick={() => handleExecuteClick("Both", "Both")}
                                disabled={loading || !amount || isTradeLocked}
                            >
                                <ArrowRightLeft className="w-5 h-5 mr-2" />
                                {isTradeLocked ? "Trade Locked (0% Rate)" : "Execute Arbitrage Trade"}
                            </Button>

                            {/* Scheduled Trade Button */}
                            <Button
                                className={cn(
                                    "w-full h-10 font-bold text-sm rounded-md border",
                                    isTradeLocked
                                        ? "bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed"
                                        : "bg-[#3a3a42] hover:bg-[#4a4a52] text-yellow-500 border-yellow-500/20"
                                )}
                                onClick={() => handleExecuteClick("Schedule", "Both")}
                                disabled={loading || !amount || isTradeLocked}
                            >
                                <Zap className="w-4 h-4 mr-2" />
                                Auto Trade (Next Minute)
                            </Button>

                            {/* Individual Trades */}
                            <div className="grid grid-cols-2 gap-2">
                                <Button
                                    className={cn(
                                        "h-10 text-white font-bold text-sm rounded-md",
                                        isTradeLocked ? "bg-gray-700 cursor-not-allowed opacity-50" : "bg-[#2ebd85] hover:bg-[#2ebd85]/90"
                                    )}
                                    onClick={() => handleExecuteClick("Long", recommendation.longPlatform)}
                                    disabled={loading || isTradeLocked}
                                >
                                    <TrendingUp className="w-4 h-4 mr-1" />
                                    Long {recommendation.longPlatform}
                                </Button>
                                <Button
                                    className={cn(
                                        "h-10 text-white font-bold text-sm rounded-md",
                                        isTradeLocked ? "bg-gray-700 cursor-not-allowed opacity-50" : "bg-[#f6465d] hover:bg-[#f6465d]/90"
                                    )}
                                    onClick={() => handleExecuteClick("Short", recommendation.shortPlatform)}
                                    disabled={loading || isTradeLocked}
                                >
                                    <TrendingDown className="w-4 h-4 mr-1" />
                                    Short {recommendation.shortPlatform}
                                </Button>
                            </div>
                        </div>

                        <div className="text-xs text-gray-500 flex items-center gap-1 cursor-pointer hover:text-white">
                            <Calculator className="w-3 h-3" /> Calculator
                        </div>
                    </div>

                    {/* Live Trade Status (Replacing Trading Account) */}
                    <div className="border-t border-white/10 pt-4 space-y-3">
                        <div className="flex items-center justify-between text-gray-400">
                            <span className="font-bold text-sm text-white flex items-center gap-2">
                                Current Live Trade <Activity className="w-3 h-3 text-blue-500" />
                            </span>
                        </div>

                        {/* Positions Display */}
                        <div className="space-y-2">
                            {positions.bybit ? (
                                <div className="bg-[#2b2b32] p-2 rounded border border-white/10 flex justify-between items-center text-xs">
                                    <div>
                                        <div className="font-bold text-white">Bybit</div>
                                        <div className={cn("font-bold", positions.bybit.side === "Buy" ? "text-green-500" : "text-red-500")}>
                                            {positions.bybit.side.toUpperCase()} {positions.bybit.size}
                                        </div>
                                    </div>
                                    <div className={cn("font-mono", positions.bybit.pnl >= 0 ? "text-green-500" : "text-red-500")}>
                                        {positions.bybit.pnl.toFixed(2)} USDT
                                    </div>
                                </div>
                            ) : <div className="text-xs text-gray-600 text-center py-1">No Bybit Position</div>}

                            {positions.binance ? (
                                <div className="bg-[#2b2b32] p-2 rounded border border-white/10 flex justify-between items-center text-xs">
                                    <div>
                                        <div className="font-bold text-white">Binance</div>
                                        <div className={cn("font-bold", positions.binance.side === "Buy" ? "text-green-500" : "text-red-500")}>
                                            {positions.binance.side.toUpperCase()} {positions.binance.size}
                                        </div>
                                    </div>
                                    <div className={cn("font-mono", positions.binance.pnl >= 0 ? "text-green-500" : "text-red-500")}>
                                        {positions.binance.pnl.toFixed(2)} USDT
                                    </div>
                                </div>
                            ) : <div className="text-xs text-gray-600 text-center py-1">No Binance Position</div>}
                        </div>

                        {/* Close Button with 2-Step Confirmation */}
                        {(positions.bybit || positions.binance) && (
                            <Button
                                variant="destructive"
                                className="w-full font-bold h-9 text-xs"
                                onClick={() => setCloseStep(s => s === 0 ? 1 : s === 1 ? 2 : 0)}
                            >
                                {closeStep === 0 && "Close Position"}
                                {closeStep === 1 && "Confirm Close?"}
                                {closeStep === 2 && "Tap to FINAL CLOSE"}
                            </Button>
                        )}
                        {closeStep === 2 && (
                            <Button
                                variant="destructive"
                                className="w-full font-bold h-9 text-xs animate-pulse bg-red-600 mt-1"
                                onClick={async () => {
                                    const backendUrl = localStorage.getItem("primary_backend_url") || "http://127.0.0.1:8000";
                                    try {
                                        await fetch(`${backendUrl}/api/close-all-positions`, {
                                            method: "POST", headers: {
                                                "X-User-Bybit-Key": localStorage.getItem("user_bybit_key"),
                                                "X-User-Bybit-Secret": localStorage.getItem("user_bybit_secret"),
                                                "X-User-Binance-Key": localStorage.getItem("user_binance_key"),
                                                "X-User-Binance-Secret": localStorage.getItem("user_binance_secret")
                                            }
                                        });
                                        toast.success("Close command sent!");
                                        setCloseStep(0);
                                        fetchPositions();
                                    } catch (e) { toast.error("Close failed"); }
                                }}
                            >
                                EXECUTE CLOSE NOW
                            </Button>
                        )}

                    </div>
                </div>

                {/* Logs Section */}
                <div className="bg-black/40 p-3 border-t border-white/10 h-28 overflow-y-auto text-xs font-mono">
                    <div className="text-gray-500 mb-1 font-bold">Logs / Activity</div>
                    {logs.length === 0 ? (
                        <div className="text-gray-600 italic">No activity yet.</div>
                    ) : (
                        logs.map((log, i) => (
                            <div key={i} className={cn("mb-1",
                                log.type === 'error' ? 'text-red-400' :
                                    log.type === 'success' ? 'text-green-400' : 'text-gray-300'
                            )}>
                                <span className="opacity-50">[{log.timestamp}]</span> {log.message}
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Confirmation Modal */}
            <Dialog open={showConfirmModal} onOpenChange={setShowConfirmModal}>
                <DialogContent className="bg-[#1e1e24] text-white border-white/10">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <ShieldCheck className="w-5 h-5 text-green-500" />
                            Confirm Trade Execution
                        </DialogTitle>
                        <DialogDescription className="text-gray-400">
                            Please review your trade details carefully.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="flex justify-between items-center border-b border-white/5 pb-2">
                            <span className="text-gray-400">Symbol</span>
                            <span className="font-bold text-lg text-yellow-500">{symbol}</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-white/5 pb-2">
                            <span className="text-gray-400">Direction</span>
                            <span className={cn("font-bold text-lg", pendingTrade?.side === "Long" ? "text-green-500" : "text-blue-500")}>
                                {pendingTrade?.platform === "Both" ? "Hedge (Arbitrage)" : pendingTrade?.side}
                            </span>
                        </div>
                        <div className="flex justify-between items-center border-b border-white/5 pb-2">
                            <span className="text-gray-400">Investment (Value)</span>
                            <span className="font-bold">{amount} USDT</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-white/5 pb-2">
                            <span className="text-gray-400">Leverage</span>
                            <span className="font-bold text-orange-400">{leverage}x</span>
                        </div>
                        <div className="flex justify-between items-center pt-2">
                            <span className="text-gray-400">Est. Qty (Per Side)</span>
                            <span className="font-mono text-sm">{(Number(amount) / (markPrice || 1)).toFixed(3)} {symbol}</span>
                        </div>
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="ghost" onClick={() => setShowConfirmModal(false)}>Cancel</Button>
                        <Button className="bg-green-600 hover:bg-green-700" onClick={confirmAndExecute}>
                            Confirm & Execute
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
