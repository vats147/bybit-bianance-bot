import { useState, useEffect, useRef } from "react";
import { X, Settings, Wallet, History, AlertCircle, CheckCircle2, Calculator, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export function TradeSidePanel({ isOpen, onClose, data, onExecute }) {
    const [activeTab, setActiveTab] = useState("market");
    const [marginMode, setMarginMode] = useState("Cross");
    const [leverage, setLeverage] = useState(10);
    const [amount, setAmount] = useState("");
    const [sliderValue, setSliderValue] = useState(0);
    const [logs, setLogs] = useState([]);

    // Derived from data
    const symbol = data?.symbol || "BTC";
    const markPrice = data?.markPrice || 0;
    const balance = 175.1054; // Mock balance matching image

    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setLogs([]); // Clear logs on open? Or keep history?
            // Add initial log
            addLog(`Opened trade panel for ${symbol}`);
        }
    }, [isOpen, symbol]);

    const addLog = (message, type = "info") => {
        const timestamp = new Date().toLocaleTimeString();
        setLogs(prev => [...prev, { message, type, timestamp }]);
    };

    const handleSliderChange = (e) => {
        const val = Number(e.target.value);
        setSliderValue(val);
        // Calulate amount based on balance * leverage * percent ? 
        // Or just balance * percent? Image shows "Value USDC". 
        // Usually Value = Margin * Leverage. 
        // Let's assume User invests Margin. 
        // If slider is 100%, it uses 100% of Available Balance as Margin.
        const margin = (balance * val) / 100;
        const totalValue = margin * leverage;
        setAmount(totalValue.toFixed(2));
    };

    const handleAmountChange = (e) => {
        setAmount(e.target.value);
        // Reverse calculate slider?
        // val = (Amount / Leverage) / Balance * 100
        const val = Number(e.target.value);
        if (val && leverage && balance) {
            const margin = val / leverage;
            const pct = (margin / balance) * 100;
            setSliderValue(Math.min(100, Math.max(0, pct)));
        }
    };

    const executeTrade = async (side) => {
        if (!amount || Number(amount) <= 0) {
            addLog("Invalid amount", "error");
            return;
        }

        setLoading(true);
        addLog(`Submitting ${side} order for ${amount} USDC...`, "info");

        // Simulate API call delay
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Mock success
        addLog(`Order Filled! ${side} ${symbol} x ${leverage} Lev.`, "success");
        setLoading(false);
    };

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop Removed as per request */}


            {/* Slide-in Panel */}
            <div className={cn(
                "fixed top-0 right-0 h-full w-[380px] bg-[#1e1e24] z-50 shadow-2xl transform transition-transform duration-300 ease-in-out border-l border-white/10 flex flex-col",
                isOpen ? "translate-x-0" : "translate-x-full"
            )}>
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-[#25252b]">
                    <div className="font-bold text-lg text-white">Trade</div>
                    <div className="flex items-center gap-3 text-gray-400">
                        <Wallet className="w-5 h-5 hover:text-white cursor-pointer" />
                        <Settings className="w-5 h-5 hover:text-white cursor-pointer" />
                        <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-white/10 rounded-full h-8 w-8 text-white">
                            <X className="w-5 h-5" />
                        </Button>
                    </div>
                </div>

                {/* Content - Scrollable */}
                <div className="flex-1 overflow-y-auto p-4 space-y-6 text-sm text-gray-300">

                    {/* Top Controls: Margin Mode & Leverage */}
                    <div className="flex gap-2">
                        <div className="flex-1 bg-[#2b2b32] rounded-md px-3 py-2 flex justify-between items-center cursor-pointer hover:bg-[#32323a]">
                            <span className="font-semibold text-white">{marginMode}</span>
                            <span className="text-xs text-gray-500">▼</span>
                        </div>
                        <div className="flex-1 bg-[#2b2b32] rounded-md px-3 py-2 flex justify-between items-center cursor-pointer hover:bg-[#32323a]">
                            <span className="font-semibold text-yellow-500">{leverage.toFixed(2)}x</span>
                            <span className="text-xs text-gray-500">▼</span>
                        </div>
                    </div>

                    {/* Order Type Tabs */}
                    <div className="flex gap-4 text-white/50 text-base font-medium pb-2">
                        <button
                            className={cn("hover:text-white transition-colors", activeTab === "limit" && "text-white font-bold")}
                            onClick={() => setActiveTab("limit")}
                        >
                            Limit
                        </button>
                        <button
                            className={cn("hover:text-white transition-colors", activeTab === "market" && "text-yellow-500 font-bold")}
                            onClick={() => setActiveTab("market")}
                        >
                            Market
                        </button>
                        <button
                            className={cn("hover:text-white transition-colors flex items-center gap-1", activeTab === "conditional" && "text-white font-bold")}
                            onClick={() => setActiveTab("conditional")}
                        >
                            Conditional <span className="text-[10px]">▼</span>
                        </button>
                    </div>

                    {/* Input Area */}
                    <div className="space-y-4">
                        <div className="bg-[#2b2b32] rounded-lg p-1 flex items-center border border-transparent focus-within:border-yellow-500/50 transition-colors">
                            <div className="flex-1 px-3 py-1">
                                <label className="text-xs text-gray-500 block">Value</label>
                                <input
                                    type="number"
                                    value={amount}
                                    onChange={handleAmountChange}
                                    placeholder="0.00"
                                    className="bg-transparent text-white font-bold text-lg w-full outline-none placeholder:text-gray-600"
                                />
                            </div>
                            <div className="px-3 border-l border-white/5 flex items-center gap-2 cursor-pointer">
                                <img src={`https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/usdc.png`} className="w-5 h-5 rounded-full" />
                                <span className="font-bold text-white">USDC</span>
                                <span className="text-[10px] text-gray-400">▼</span>
                            </div>
                        </div>

                        {/* Slider */}
                        <div className="pt-2 px-1">
                            {/* Custom Range Slider using pure CSS/HTML logic for simplicity or Tailwind */}
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={sliderValue}
                                onChange={handleSliderChange}
                                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                            />
                            <div className="flex justify-between text-xs text-gray-500 mt-1 font-mono">
                                <span>0</span>
                                <span className="text-yellow-500">{sliderValue.toFixed(0)}%</span>
                                <span>100%</span>
                            </div>
                        </div>

                        {/* Info Rows */}
                        <div className="space-y-1 bg-[#2b2b32]/50 p-2 rounded text-xs font-mono">
                            <div className="flex justify-between">
                                <span className="text-gray-500">Quantity</span>
                                <span className="text-white">-- / {symbol}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Cost</span>
                                <span className="text-white">-- / -- USDC</span>
                            </div>
                        </div>

                        {/* TPSL Checkbox */}
                        <div className="flex items-center gap-2">
                            <input type="checkbox" className="w-4 h-4 rounded border-gray-600 bg-transparent accent-yellow-500" />
                            <span className="text-sm text-gray-400">TP/SL</span>
                        </div>

                        {/* Buttons */}
                        <div className="grid grid-cols-2 gap-3 pt-2">
                            <Button
                                className="h-12 bg-[#2ebd85] hover:bg-[#2ebd85]/90 text-white font-bold text-base rounded-md"
                                onClick={() => executeTrade("Buy")}
                                disabled={loading}
                            >
                                <div className="flex flex-col items-center leading-tight">
                                    <span>Long</span>
                                    {loading && <span className="text-[10px] opacity-80">Processing...</span>}
                                </div>
                            </Button>
                            <Button
                                className="h-12 bg-[#f6465d] hover:bg-[#f6465d]/90 text-white font-bold text-base rounded-md"
                                onClick={() => executeTrade("Sell")}
                                disabled={loading}
                            >
                                <div className="flex flex-col items-center leading-tight">
                                    <span>Short</span>
                                    {loading && <span className="text-[10px] opacity-80">Processing...</span>}
                                </div>
                            </Button>
                        </div>

                        <div className="text-xs text-gray-500 flex items-center gap-1 cursor-pointer hover:text-white">
                            <Calculator className="w-3 h-3" /> Calculator
                        </div>
                    </div>

                    {/* Account Info - Styled like image */}
                    <div className="border-t border-white/10 pt-4 space-y-3">
                        <div className="flex items-center justify-between text-gray-400 cursor-pointer hover:text-white">
                            <span className="font-bold text-sm text-white flex items-center gap-2">
                                Unified Trading Account <CheckCircle2 className="w-3 h-3" />
                            </span>
                        </div>

                        <div className="flex justify-between text-xs">
                            <span className="text-gray-500">Margin Mode</span>
                            <span className="text-white flex items-center gap-1">Cross Margin <span className="text-[10px]">›</span></span>
                        </div>

                        <div className="space-y-1">
                            <div className="flex justify-between text-xs">
                                <span className="text-gray-500 pb-1 border-b border-dashed border-gray-600">Initial Margin</span>
                                <span className="text-[#2ebd85]">1.41%</span>
                            </div>
                            {/* Progress Bar Mock */}
                            <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                <div className="h-full w-[1.41%] bg-[#2ebd85]"></div>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <div className="flex justify-between text-xs">
                                <span className="text-gray-500 pb-1 border-b border-dashed border-gray-600">Maintenance Margin</span>
                                <span className="text-[#2ebd85]">0.18%</span>
                            </div>
                            <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                <div className="h-full w-[0.18%] bg-[#2ebd85]"></div>
                            </div>
                        </div>

                        <div className="pt-2 space-y-1 font-mono text-xs">
                            <div className="flex justify-between">
                                <span className="text-gray-500">Margin Balance</span>
                                <span className="text-white font-bold">177.6112 USDC</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Available Balance</span>
                                <span className="text-white font-bold">{balance.toFixed(4)} USDC</span>
                            </div>
                        </div>

                        <Button variant="secondary" className="w-full bg-[#2b2b32] hover:bg-[#32323a] text-white font-medium h-9 text-xs border border-white/10">
                            Request Demo Funds
                        </Button>
                    </div>

                    {/* Contract Details */}
                    <div className="border-t border-white/10 pt-4">
                        <h3 className="font-bold text-white mb-2">Contract Details {symbol}USDC</h3>
                        {/* Could add details here */}
                    </div>
                </div>

                {/* Logs Section (Bottom Fixed in panel, or just bottom of scroll?) */}
                {/* Let's make it fixed at bottom of panel to ensure visibility "at the end" */}
                <div className="bg-black/40 p-3 border-t border-white/10 h-32 overflow-y-auto text-xs font-mono">
                    <div className="text-gray-500 mb-1 sticky top-0 bg-transparent font-bold">Logs / Activity</div>
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
        </>
    );
}
