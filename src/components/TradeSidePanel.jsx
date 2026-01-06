import { useState, useEffect, useRef } from "react";
import { X, Settings, Wallet, CheckCircle2, Calculator, TrendingUp, TrendingDown, Zap, ArrowRightLeft, AlertTriangle, ShieldCheck, Activity, Info, Loader2, DollarSign, Target, Clock } from "lucide-react";
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

// Exchange Logo URLs
const EXCHANGE_LOGOS = {
    binance: "https://cryptologos.cc/logos/binance-coin-bnb-logo.png?v=040",
    bybit: "https://s2.coinmarketcap.com/static/img/exchanges/64x64/521.png"
};

// Tooltip component
const Tooltip = ({ children, content }) => {
    const [show, setShow] = useState(false);
    return (
        <span className="relative inline-flex items-center" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
            {children}
            {show && (
                <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 text-xs bg-gray-900 border border-white/20 text-white rounded-lg shadow-xl whitespace-nowrap">
                    {content}
                    <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></span>
                </span>
            )}
        </span>
    );
};

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
    const [showCloseDialog, setShowCloseDialog] = useState(false);
    const [closingPositions, setClosingPositions] = useState(false);

    // Dropdown states
    const [showMarginDropdown, setShowMarginDropdown] = useState(false);

    // Balance states
    const [balances, setBalances] = useState({ binance: null, bybit: null });
    const [balanceLoading, setBalanceLoading] = useState(false);

    // Leverage editing state
    const [showLeverageDropdown, setShowLeverageDropdown] = useState(false);
    const [isEditingLeverage, setIsEditingLeverage] = useState(false);
    const [leverageInputValue, setLeverageInputValue] = useState("");
    const [showDetails, setShowDetails] = useState(false); // Toggle for Position Breakdown

    // Available options
    const marginModes = ["Cross", "Isolated"];
    const leverageOptions = [1, 2, 3, 5, 6, 10, 15, 20, 25, 50, 75, 100];

    // Derived from data
    const symbol = data?.symbol || "BTC";
    const markPrice = data?.markPrice || 0;
    // Rates are stored as decimals (0.0225 = 2.25%), multiply by 100 for display
    const binanceRateRaw = data?.binanceRate || 0;
    const bybitRateRaw = data?.bybitRate || 0;
    const binanceRate = binanceRateRaw * 100; // Convert to percentage
    const bybitRate = bybitRateRaw * 100;     // Convert to percentage
    const spread = data?.spread || 0;
    const balance = 175.1054; // Mock balance - kept for backward compatibility

    // Safety Lock
    const isTradeLocked = Math.abs(binanceRate) === 0 || Math.abs(bybitRate) === 0;

    // Strategy recommendation based on funding rates
    const recommendation = (() => {
        const diff = Math.abs(binanceRate - bybitRate);
        const intervalBybit = data?.bybitInterval || 8;
        const intervalBinance = data?.binanceInterval || 8;
        const minInterval = Math.min(intervalBybit, intervalBinance);
        const dailyFreq = 24 / minInterval;

        // Check if both sides are earning (rare but profitable scenario)
        const binanceEarning = binanceRate < 0; // negative rate = longs pay shorts (we go long = we receive)
        const bybitEarning = bybitRate > 0;     // positive rate = shorts pay longs (we go short = we receive)
        const twoSideEarning = (binanceRate < 0 && bybitRate > 0) || (binanceRate > 0 && bybitRate < 0);

        if (binanceRate < bybitRate) {
            return {
                longPlatform: "Binance",
                shortPlatform: "Bybit",
                longRate: binanceRate,
                shortRate: bybitRate,
                expectedProfit: diff,
                expectedProfit24h: diff * dailyFreq,
                twoSideEarning,
                longReason: binanceRate < 0
                    ? `Binance rate is negative (${binanceRate.toFixed(4)}%), so LONG positions RECEIVE funding from shorts`
                    : `Binance rate (${binanceRate.toFixed(4)}%) is lower than Bybit, minimizing funding costs`,
                shortReason: bybitRate > 0
                    ? `Bybit rate is positive (${bybitRate.toFixed(4)}%), so SHORT positions RECEIVE funding from longs`
                    : `Bybit rate (${bybitRate.toFixed(4)}%) is higher, so shorting here captures the spread`
            };
        } else {
            return {
                longPlatform: "Bybit",
                shortPlatform: "Binance",
                longRate: bybitRate,
                shortRate: binanceRate,
                expectedProfit: diff,
                expectedProfit24h: diff * dailyFreq,
                twoSideEarning,
                longReason: bybitRate < 0
                    ? `Bybit rate is negative (${bybitRate.toFixed(4)}%), so LONG positions RECEIVE funding from shorts`
                    : `Bybit rate (${bybitRate.toFixed(4)}%) is lower than Binance, minimizing funding costs`,
                shortReason: binanceRate > 0
                    ? `Binance rate is positive (${binanceRate.toFixed(4)}%), so SHORT positions RECEIVE funding from longs`
                    : `Binance rate (${binanceRate.toFixed(4)}%) is higher, so shorting here captures the spread`
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
            // Fetch balances when panel opens
            fetchBalances();
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
        setAmount(margin.toFixed(2));
    };

    const handleAmountChange = (e) => {
        setAmount(e.target.value);
        const val = Number(e.target.value);
        if (val && balance) {
            const margin = val;
            const pct = (margin / balance) * 100;
            setSliderValue(Math.min(100, Math.max(0, pct)));
        }
    };

    const fetchBalances = async () => {
        if (!isOpen) return;
        setBalanceLoading(true);

        const bybitKey = localStorage.getItem("user_bybit_key");
        const bybitSecret = localStorage.getItem("user_bybit_secret");
        const binanceKey = localStorage.getItem("user_binance_key");
        const binanceSecret = localStorage.getItem("user_binance_secret");
        const isTestnet = localStorage.getItem("user_binance_testnet") !== "false";
        const backendUrl = localStorage.getItem("primary_backend_url") || "https://vats147-bianance-bot.hf.space";

        try {
            // Only fetch balances for exchanges with valid keys
            const hasBybitKeys = bybitKey && bybitSecret;
            const hasBinanceKeys = binanceKey && binanceSecret;

            const fetchPromises = [];

            // Bybit balance fetch
            if (hasBybitKeys) {
                fetchPromises.push(
                    fetch(`${backendUrl}/api/wallet-balance?is_live=false`, {
                        headers: {
                            "X-User-Bybit-Key": bybitKey,
                            "X-User-Bybit-Secret": bybitSecret
                        }
                    }).catch(e => ({ ok: false, error: e, exchange: 'bybit' }))
                );
            } else {
                fetchPromises.push(Promise.resolve({ ok: false, noKeys: true, exchange: 'bybit' }));
            }

            // Binance balance fetch
            if (hasBinanceKeys) {
                fetchPromises.push(
                    fetch(`${backendUrl}/api/binance/wallet-balance?is_testnet=${isTestnet}`, {
                        headers: {
                            "X-User-Binance-Key": binanceKey,
                            "X-User-Binance-Secret": binanceSecret
                        }
                    }).catch(e => ({ ok: false, error: e, exchange: 'binance' }))
                );
            } else {
                fetchPromises.push(Promise.resolve({ ok: false, noKeys: true, exchange: 'binance' }));
            }

            const [bybitRes, binanceRes] = await Promise.all(fetchPromises);

            // Process Bybit balance
            let bybitBalance = null;
            let bybitNoKeys = bybitRes.noKeys;
            if (bybitRes.ok) {
                const bybitData = await bybitRes.json();
                if (bybitData.retCode === 0 && bybitData.result?.list?.length > 0) {
                    const account = bybitData.result.list[0];
                    bybitBalance = parseFloat(account.totalAvailableBalance || account.totalWalletBalance || 0);
                }
            }

            // Process Binance balance
            let binanceBalance = null;
            let binanceNoKeys = binanceRes.noKeys;
            if (binanceRes.ok) {
                const binanceData = await binanceRes.json();
                if (Array.isArray(binanceData)) {
                    // Sum all USDT balances
                    const usdtAsset = binanceData.find(a => a.asset === "USDT");
                    binanceBalance = parseFloat(usdtAsset?.availableBalance || 0);
                }
            }

            setBalances({ bybit: bybitBalance, binance: binanceBalance });

            // Build informative log message
            const bybitMsg = bybitNoKeys ? "No Keys" : (bybitBalance !== null ? `${bybitBalance.toFixed(2)}` : "Error");
            const binanceMsg = binanceNoKeys ? "No Keys" : (binanceBalance !== null ? `${binanceBalance.toFixed(2)}` : "Error");
            addLog(`Balances - Bybit: ${bybitMsg} USDT, Binance: ${binanceMsg} USDT`, bybitNoKeys || binanceNoKeys ? "warn" : "info");
        } catch (e) {
            console.error("Failed to fetch balances:", e);
            addLog("Failed to fetch balances", "error");
        } finally {
            setBalanceLoading(false);
        }
    };

    const fetchPositions = async () => {
        if (!isOpen || !symbol) return;
        const bybitKey = localStorage.getItem("user_bybit_key");
        const bybitSecret = localStorage.getItem("user_bybit_secret");
        const binanceKey = localStorage.getItem("user_binance_key");
        const binanceSecret = localStorage.getItem("user_binance_secret");
        const backendUrl = localStorage.getItem("primary_backend_url") || "https://vats147-bianance-bot.hf.space";

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

        // Balance validation
        const requiredMargin = Number(amount);

        if (platform === "Both") {
            // For arbitrage trades, check both platforms
            if (balances.binance !== null && balances.binance < requiredMargin) {
                const msg = `Insufficient Binance balance. Available: ${balances.binance.toFixed(2)} USDT, Required: ${requiredMargin.toFixed(2)} USDT`;
                addLog(msg, "error");
                toast.error(msg);
                return;
            }
            if (balances.bybit !== null && balances.bybit < requiredMargin) {
                const msg = `Insufficient Bybit balance. Available: ${balances.bybit.toFixed(2)} USDT, Required: ${requiredMargin.toFixed(2)} USDT`;
                addLog(msg, "error");
                toast.error(msg);
                return;
            }
        } else if (platform === "Binance") {
            if (balances.binance !== null && balances.binance < requiredMargin) {
                const msg = `Insufficient Binance balance. Available: ${balances.binance.toFixed(2)} USDT, Required: ${requiredMargin.toFixed(2)} USDT`;
                addLog(msg, "error");
                toast.error(msg);
                return;
            }
        } else if (platform === "Bybit") {
            if (balances.bybit !== null && balances.bybit < requiredMargin) {
                const msg = `Insufficient Bybit balance. Available: ${balances.bybit.toFixed(2)} USDT, Required: ${requiredMargin.toFixed(2)} USDT`;
                addLog(msg, "error");
                toast.error(msg);
                return;
            }
        }

        setLoading(true);

        // Get API keys from localStorage (match keys from SettingsPage)
        const bybitKey = localStorage.getItem("user_bybit_key") || "";
        const bybitSecret = localStorage.getItem("user_bybit_secret") || "";
        const bybitIsLive = localStorage.getItem("user_bybit_live") === "true";
        const binanceKey = localStorage.getItem("user_binance_key") || "";
        const binanceSecret = localStorage.getItem("user_binance_secret") || "";
        const isTestnet = localStorage.getItem("user_binance_testnet") !== "false";

        const backendUrl = localStorage.getItem("primary_backend_url") || "https://vats147-bianance-bot.hf.space";

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

        const qty = calculateQty(Number(amount) * leverage, markPrice);

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
                    addLog(`Placing Long on Bybit${bybitIsLive ? ' (LIVE)' : ''} - ${symbol} @ ${leverage}x...`, "info");
                    const res = await fetch(`${backendUrl}/api/place-order?is_live=${bybitIsLive}`, {
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
                    addLog(`Placing Short on Bybit${bybitIsLive ? ' (LIVE)' : ''} - ${symbol} @ ${leverage}x...`, "info");
                    const res = await fetch(`${backendUrl}/api/place-order?is_live=${bybitIsLive}`, {
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

                addLog(`Arbitrage position opened! Expected profit: ${recommendation.expectedProfit.toFixed(4)}% (Next) | ${recommendation.expectedProfit24h.toFixed(4)}% (24h)`, "success");

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

                    {/* Compact Balance Display with Exchange Logos */}
                    <div className="flex items-center gap-2 text-xs">
                        <div className="flex-1 flex items-center gap-2 bg-[#2b2b32] rounded px-2 py-1.5">
                            <img src={EXCHANGE_LOGOS.binance} className="w-4 h-4 rounded-full" alt="Binance" />
                            <span className="text-gray-400">Bn:</span>
                            <span className="text-white font-bold font-mono">
                                {balances.binance !== null ? `${balances.binance.toFixed(2)}` : "N/A"}
                            </span>
                        </div>
                        <div className="flex-1 flex items-center gap-2 bg-[#2b2b32] rounded px-2 py-1.5">
                            <img src={EXCHANGE_LOGOS.bybit} className="w-4 h-4 rounded-full" alt="Bybit" />
                            <span className="text-gray-400">Bb:</span>
                            <span className="text-white font-bold font-mono">
                                {balances.bybit !== null ? `${balances.bybit.toFixed(2)}` : "N/A"}
                            </span>
                        </div>
                        <button
                            onClick={fetchBalances}
                            className="text-blue-400 hover:text-blue-300 p-1"
                            disabled={balanceLoading}
                        >
                            {balanceLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "↻"}
                        </button>
                    </div>

                    {/* Strategy Recommendation Card with Tooltips and 2-Side Earning Badge */}
                    {spread > 0 && (
                        <div className="bg-gradient-to-r from-green-500/10 to-blue-500/10 border border-green-500/30 rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-white font-bold text-sm">
                                    <Zap className="w-4 h-4 text-yellow-500" />
                                    Strategy
                                </div>
                                {recommendation.twoSideEarning && (
                                    <span className="px-2 py-0.5 bg-gradient-to-r from-green-500 to-yellow-500 text-black text-[10px] font-bold rounded-full animate-pulse">
                                        🎯 2-SIDE EARNING
                                    </span>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <Tooltip content={recommendation.longReason}>
                                    <div className="bg-green-500/20 rounded p-2 border border-green-500/30 cursor-help w-full">
                                        <div className="flex items-center gap-1 text-green-400 font-bold">
                                            <img
                                                src={recommendation.longPlatform === "Binance" ? EXCHANGE_LOGOS.binance : EXCHANGE_LOGOS.bybit}
                                                className="w-3 h-3 rounded-full"
                                                alt={recommendation.longPlatform}
                                            />
                                            <TrendingUp className="w-3 h-3" /> Long
                                            <Info className="w-3 h-3 text-gray-500 ml-auto" />
                                        </div>
                                        <div className="text-white font-bold">{recommendation.longPlatform}</div>
                                        <div className="text-gray-400">{recommendation.longRate.toFixed(4)}%</div>
                                        <div className="text-[9px] text-gray-500 mt-0.5">
                                            {recommendation.longPlatform === "Binance" ? `${data?.binanceInterval || 8}H` : `${data?.bybitInterval || 8}H`} interval
                                        </div>
                                    </div>
                                </Tooltip>
                                <Tooltip content={recommendation.shortReason}>
                                    <div className="bg-red-500/20 rounded p-2 border border-red-500/30 cursor-help w-full">
                                        <div className="flex items-center gap-1 text-red-400 font-bold">
                                            <img
                                                src={recommendation.shortPlatform === "Binance" ? EXCHANGE_LOGOS.binance : EXCHANGE_LOGOS.bybit}
                                                className="w-3 h-3 rounded-full"
                                                alt={recommendation.shortPlatform}
                                            />
                                            <TrendingDown className="w-3 h-3" /> Short
                                            <Info className="w-3 h-3 text-gray-500 ml-auto" />
                                        </div>
                                        <div className="text-white font-bold">{recommendation.shortPlatform}</div>
                                        <div className="text-gray-400">{recommendation.shortRate.toFixed(4)}%</div>
                                        <div className="text-[9px] text-gray-500 mt-0.5">
                                            {recommendation.shortPlatform === "Binance" ? `${data?.binanceInterval || 8}H` : `${data?.bybitInterval || 8}H`} interval
                                        </div>
                                    </div>
                                </Tooltip>
                            </div>

                            {/* Profit Estimates */}
                            <div className="bg-black/20 rounded p-2 space-y-2">
                                {/* 1. Primary Profit Metrics (Always Visible) */}
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div className="bg-green-500/10 rounded p-1.5 border border-green-500/20 text-center">
                                        <div className="text-gray-400 text-[9px] uppercase tracking-wide">Next Funding Earning</div>
                                        <div className="text-green-400 font-bold text-sm">
                                            +${((Number(amount) * leverage * recommendation.expectedProfit) / 100).toFixed(2)}
                                        </div>
                                        <div className="text-[9px] text-green-500/80">
                                            Yield: +{recommendation.expectedProfit.toFixed(4)}%
                                        </div>
                                    </div>
                                    <div className="bg-purple-500/10 rounded p-1.5 border border-purple-500/20 text-center">
                                        <div className="text-gray-400 text-[9px] uppercase tracking-wide">Est. Daily Profit</div>
                                        <div className="text-purple-400 font-bold text-sm">
                                            +${((Number(amount) * leverage * recommendation.expectedProfit24h) / 100).toFixed(2)}
                                        </div>
                                        <div className="text-[9px] text-purple-500/80">
                                            +{recommendation.expectedProfit24h.toFixed(2)}% / day
                                        </div>
                                    </div>
                                </div>

                                {amount && Number(amount) > 0 && (
                                    <>
                                        {/* Toggle Trace Details */}
                                        <div
                                            className="flex items-center justify-center gap-1 text-[10px] text-gray-500 cursor-pointer hover:text-white py-1 border-t border-white/5 mt-1"
                                            onClick={() => setShowDetails(!showDetails)}
                                        >
                                            <span>{showDetails ? "Hide Breakdown" : "Show Position Details"}</span>
                                            <span className={cn("transition-transform", showDetails && "rotate-180")}>▼</span>
                                        </div>

                                        {/* Collapsible Section */}
                                        {showDetails && (
                                            <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                                                {/* Leverage Breakdown */}
                                                <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded p-2 mb-2 border border-blue-500/20">
                                                    <div className="text-[10px] text-blue-300 font-bold mb-1.5 flex items-center gap-1">
                                                        📊 Position Breakdown ({leverage}x)
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                                                        <div className="flex justify-between">
                                                            <span className="text-gray-400">IM (Inv):</span>
                                                            <span className="text-white font-mono font-bold">${Number(amount).toFixed(2)}</span>
                                                        </div>
                                                        <div className="flex justify-between">
                                                            <span className="text-gray-400">Borrowed:</span>
                                                            <span className="text-yellow-400 font-mono">${(Number(amount) * (leverage - 1)).toFixed(2)}</span>
                                                        </div>
                                                        <div className="flex justify-between col-span-2 border-t border-white/10 pt-1 mt-1">
                                                            <span className="text-gray-400">Total Position:</span>
                                                            <span className="text-cyan-400 font-bold font-mono">${(Number(amount) * leverage).toFixed(2)} × 2</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="text-[10px] space-y-1 pt-1">
                                                    <div className="flex justify-between">
                                                        <span className="text-gray-400">Yield / Funding</span>
                                                        <span className="text-green-400">+{recommendation.expectedProfit.toFixed(4)}%</span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-gray-400">Funding Interval</span>
                                                        <span className="text-white">{Math.min(data?.binanceInterval || 8, data?.bybitInterval || 8)} Hours</span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
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

                        {/* Leverage Dropdown with Manual Input */}
                        <div className="flex-1 relative">
                            {!isEditingLeverage ? (
                                <div
                                    className="dropdown-trigger bg-[#2b2b32] rounded-md px-3 py-2 flex justify-between items-center cursor-pointer hover:bg-[#32323a] border border-transparent hover:border-white/20"
                                    onClick={(e) => {
                                        // Check if click is directly on the leverage value (not dropdown arrow)
                                        const clickedOnValue = e.target.closest('.leverage-value');
                                        if (clickedOnValue) {
                                            setIsEditingLeverage(true);
                                            setLeverageInputValue(leverage.toString());
                                            setShowLeverageDropdown(false);
                                        } else {
                                            setShowLeverageDropdown(!showLeverageDropdown);
                                            setShowMarginDropdown(false);
                                        }
                                    }}
                                >
                                    <span className="leverage-value font-semibold text-yellow-500">{leverage}x</span>
                                    <span className={cn("text-xs text-gray-500 transition-transform", showLeverageDropdown && "rotate-180")}>▼</span>
                                </div>
                            ) : (
                                <div className="bg-[#2b2b32] rounded-md px-3 py-2 flex items-center border-2 border-yellow-500">
                                    <input
                                        type="number"
                                        value={leverageInputValue}
                                        onChange={(e) => setLeverageInputValue(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                const val = parseInt(leverageInputValue);
                                                if (!isNaN(val) && val >= 1 && val <= 100) {
                                                    setLeverage(val);
                                                    addLog(`Leverage changed to ${val}x`, "info");
                                                    setIsEditingLeverage(false);
                                                } else {
                                                    toast.error("Leverage must be between 1x and 100x");
                                                    setLeverageInputValue(leverage.toString());
                                                }
                                            } else if (e.key === 'Escape') {
                                                setIsEditingLeverage(false);
                                                setLeverageInputValue("");
                                            }
                                        }}
                                        onBlur={() => {
                                            const val = parseInt(leverageInputValue);
                                            if (!isNaN(val) && val >= 1 && val <= 100) {
                                                setLeverage(val);
                                                addLog(`Leverage changed to ${val}x`, "info");
                                            }
                                            setIsEditingLeverage(false);
                                        }}
                                        autoFocus
                                        className="bg-transparent text-yellow-500 font-semibold w-full outline-none"
                                        placeholder="1-100"
                                    />
                                    <span className="text-yellow-500 text-sm ml-1">x</span>
                                </div>
                            )}
                            {showLeverageDropdown && !isEditingLeverage && (
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
                                <label className="text-xs text-gray-500 block">Investment (Margin) per side - Pos Size = ${leverage > 1 ? `Inv × ${leverage}` : 'Inv'}</label>
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

                        {/* Quick Margin Preview */}
                        {amount && Number(amount) > 0 && leverage > 1 && (
                            <div className="bg-blue-500/10 border border-blue-500/20 rounded px-2 py-1 text-[10px]">
                                <span className="text-gray-400">💡 With {leverage}x leverage: Your </span>
                                <span className="text-green-400 font-bold">${Number(amount).toFixed(2)}</span>
                                <span className="text-gray-400"> investment controls </span>
                                <span className="text-yellow-400 font-bold">${(Number(amount) * leverage).toFixed(2)}</span>
                                <span className="text-gray-400"> position per side</span>
                            </div>
                        )}

                        {/* Quantity Preview */}
                        {amount && Number(amount) > 0 && (
                            <div className="flex justify-between text-[10px] text-gray-500 font-mono px-2">
                                <span>
                                    Bybit: <span className="text-yellow-500 font-bold">≈ {((Number(amount) * leverage) / (markPrice || 1)).toFixed(3)} {symbol}</span>
                                </span>
                                <span>
                                    Binance: <span className="text-yellow-500 font-bold">≈ {((Number(amount) * leverage) / (markPrice || 1)).toFixed(3)} {symbol}</span>
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
                                {loading ? (
                                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                ) : (
                                    <ArrowRightLeft className="w-5 h-5 mr-2" />
                                )}
                                {loading ? "Executing..." : isTradeLocked ? "Trade Locked (0% Rate)" : "Execute Arbitrage Trade"}
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
                                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                                Auto Trade (Next Minute)
                            </Button>

                            {/* Individual Trades with Exchange Logos - Manual Mode */}
                            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/10 mt-2">
                                <div className="text-xs text-gray-500 col-span-2 text-center font-bold uppercase tracking-wider">Manual Trade</div>

                                {/* Binance Manual Controls */}
                                <div className="col-span-1 space-y-1">
                                    <div className="text-[10px] text-gray-400 text-center flex items-center justify-center gap-1">
                                        <img src={EXCHANGE_LOGOS.binance} className="w-3 h-3 rounded-full" alt="Binance" /> Binance
                                    </div>
                                    <div className="grid grid-cols-2 gap-1">
                                        <Button
                                            className={cn(
                                                "h-8 text-white font-bold text-xs rounded-md px-1",
                                                isTradeLocked ? "bg-gray-700 cursor-not-allowed opacity-50" : "bg-[#2ebd85] hover:bg-[#2ebd85]/90"
                                            )}
                                            onClick={() => handleExecuteClick("Long", "Binance")}
                                            disabled={loading || isTradeLocked}
                                        >
                                            Long
                                        </Button>
                                        <Button
                                            className={cn(
                                                "h-8 text-white font-bold text-xs rounded-md px-1",
                                                isTradeLocked ? "bg-gray-700 cursor-not-allowed opacity-50" : "bg-[#f6465d] hover:bg-[#f6465d]/90"
                                            )}
                                            onClick={() => handleExecuteClick("Short", "Binance")}
                                            disabled={loading || isTradeLocked}
                                        >
                                            Short
                                        </Button>
                                    </div>
                                </div>

                                {/* Bybit Manual Controls */}
                                <div className="col-span-1 space-y-1">
                                    <div className="text-[10px] text-gray-400 text-center flex items-center justify-center gap-1">
                                        <img src={EXCHANGE_LOGOS.bybit} className="w-3 h-3 rounded-full" alt="Bybit" /> Bybit
                                    </div>
                                    <div className="grid grid-cols-2 gap-1">
                                        <Button
                                            className={cn(
                                                "h-8 text-white font-bold text-xs rounded-md px-1",
                                                isTradeLocked ? "bg-gray-700 cursor-not-allowed opacity-50" : "bg-[#2ebd85] hover:bg-[#2ebd85]/90"
                                            )}
                                            onClick={() => handleExecuteClick("Long", "Bybit")}
                                            disabled={loading || isTradeLocked}
                                        >
                                            Long
                                        </Button>
                                        <Button
                                            className={cn(
                                                "h-8 text-white font-bold text-xs rounded-md px-1",
                                                isTradeLocked ? "bg-gray-700 cursor-not-allowed opacity-50" : "bg-[#f6465d] hover:bg-[#f6465d]/90"
                                            )}
                                            onClick={() => handleExecuteClick("Short", "Bybit")}
                                            disabled={loading || isTradeLocked}
                                        >
                                            Short
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="text-xs text-gray-500 flex items-center gap-1 cursor-pointer hover:text-white mt-1">
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

                        {/* Positions Display with Exchange Logos */}
                        <div className="space-y-2">
                            {positions.bybit ? (
                                <div className="bg-[#2b2b32] p-2 rounded border border-white/10 flex justify-between items-center text-xs">
                                    <div className="flex items-center gap-2">
                                        <img src={EXCHANGE_LOGOS.bybit} className="w-4 h-4 rounded-full" alt="Bybit" />
                                        <div>
                                            <div className="font-bold text-white">Bybit</div>
                                            <div className={cn("font-bold", positions.bybit.side === "Buy" ? "text-green-500" : "text-red-500")}>
                                                {positions.bybit.side.toUpperCase()} {positions.bybit.size}
                                            </div>
                                        </div>
                                    </div>
                                    <div className={cn("font-mono", positions.bybit.pnl >= 0 ? "text-green-500" : "text-red-500")}>
                                        {positions.bybit.pnl.toFixed(2)} USDT
                                    </div>
                                </div>
                            ) : <div className="text-xs text-gray-600 text-center py-1">No Bybit Position</div>}

                            {positions.binance ? (
                                <div className="bg-[#2b2b32] p-2 rounded border border-white/10 flex justify-between items-center text-xs">
                                    <div className="flex items-center gap-2">
                                        <img src={EXCHANGE_LOGOS.binance} className="w-4 h-4 rounded-full" alt="Binance" />
                                        <div>
                                            <div className="font-bold text-white">Binance</div>
                                            <div className={cn("font-bold", positions.binance.side === "Buy" ? "text-green-500" : "text-red-500")}>
                                                {positions.binance.side.toUpperCase()} {positions.binance.size}
                                            </div>
                                        </div>
                                    </div>
                                    <div className={cn("font-mono", positions.binance.pnl >= 0 ? "text-green-500" : "text-red-500")}>
                                        {positions.binance.pnl.toFixed(2)} USDT
                                    </div>
                                </div>
                            ) : <div className="text-xs text-gray-600 text-center py-1">No Binance Position</div>}
                        </div>

                        {/* Close Button - Opens Dialog */}
                        {(positions.bybit || positions.binance) && (
                            <Button
                                variant="destructive"
                                className="w-full font-bold h-9 text-xs"
                                onClick={() => setShowCloseDialog(true)}
                                disabled={closingPositions}
                            >
                                {closingPositions ? (
                                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Closing...</>
                                ) : (
                                    "Close All Positions"
                                )}
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
                            <span className="font-mono text-sm">{((Number(amount) * leverage) / (markPrice || 1)).toFixed(3)} {symbol}</span>
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

            {/* Close All Positions Confirmation Dialog */}
            <Dialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
                <DialogContent className="bg-[#1e1e24] text-white border-white/10">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-red-400">
                            <AlertTriangle className="w-5 h-5" />
                            Close All Positions
                        </DialogTitle>
                        <DialogDescription className="text-gray-400">
                            This will close all your open positions on both Binance and Bybit. This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-4">
                        {positions.bybit && (
                            <div className="flex items-center justify-between bg-[#2b2b32] rounded p-3">
                                <div className="flex items-center gap-2">
                                    <img src={EXCHANGE_LOGOS.bybit} className="w-5 h-5 rounded-full" alt="Bybit" />
                                    <span className="font-bold">Bybit</span>
                                </div>
                                <div>
                                    <span className={cn("font-bold mr-2", positions.bybit.side === "Buy" ? "text-green-500" : "text-red-500")}>
                                        {positions.bybit.side.toUpperCase()}
                                    </span>
                                    <span className="font-mono">{positions.bybit.size}</span>
                                </div>
                                <div className={cn("font-mono font-bold", positions.bybit.pnl >= 0 ? "text-green-500" : "text-red-500")}>
                                    {positions.bybit.pnl >= 0 ? "+" : ""}{positions.bybit.pnl.toFixed(2)} USDT
                                </div>
                            </div>
                        )}
                        {positions.binance && (
                            <div className="flex items-center justify-between bg-[#2b2b32] rounded p-3">
                                <div className="flex items-center gap-2">
                                    <img src={EXCHANGE_LOGOS.binance} className="w-5 h-5 rounded-full" alt="Binance" />
                                    <span className="font-bold">Binance</span>
                                </div>
                                <div>
                                    <span className={cn("font-bold mr-2", positions.binance.side === "Buy" ? "text-green-500" : "text-red-500")}>
                                        {positions.binance.side.toUpperCase()}
                                    </span>
                                    <span className="font-mono">{positions.binance.size}</span>
                                </div>
                                <div className={cn("font-mono font-bold", positions.binance.pnl >= 0 ? "text-green-500" : "text-red-500")}>
                                    {positions.binance.pnl >= 0 ? "+" : ""}{positions.binance.pnl.toFixed(2)} USDT
                                </div>
                            </div>
                        )}
                        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-3 text-xs text-yellow-400">
                            <strong>⚠️ Warning:</strong> Closing positions at market price may result in slippage.
                            Make sure you understand the current market conditions before proceeding.
                        </div>
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="ghost" onClick={() => setShowCloseDialog(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            className="bg-red-600 hover:bg-red-700"
                            disabled={closingPositions}
                            onClick={async () => {
                                setClosingPositions(true);
                                const backendUrl = localStorage.getItem("primary_backend_url") || "https://vats147-bianance-bot.hf.space";
                                try {
                                    await fetch(`${backendUrl}/api/close-all-positions`, {
                                        method: "POST",
                                        headers: {
                                            "X-User-Bybit-Key": localStorage.getItem("user_bybit_key"),
                                            "X-User-Bybit-Secret": localStorage.getItem("user_bybit_secret"),
                                            "X-User-Binance-Key": localStorage.getItem("user_binance_key"),
                                            "X-User-Binance-Secret": localStorage.getItem("user_binance_secret")
                                        }
                                    });
                                    toast.success("All positions closed successfully!");
                                    setShowCloseDialog(false);
                                    addLog("All positions closed", "success");
                                    fetchPositions();
                                } catch (e) {
                                    toast.error("Failed to close positions");
                                    addLog("Failed to close positions", "error");
                                } finally {
                                    setClosingPositions(false);
                                }
                            }}
                        >
                            {closingPositions ? (
                                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Closing...</>
                            ) : (
                                "Confirm Close All"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
