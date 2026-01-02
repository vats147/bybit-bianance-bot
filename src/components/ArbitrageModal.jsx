import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { X, ExternalLink, Calculator } from "lucide-react";
import { DemoTradingModal } from "./DemoTradingModal";

export function ArbitrageModal({ isOpen, onClose, data }) {
    const [budget, setBudget] = useState(100);
    // Funding Countdown
    const [timeLeft, setTimeLeft] = useState("");
    const [showDemo, setShowDemo] = useState(false);

    useEffect(() => {
        if (!data || !data.nextFundingTime) return;

        const calculateTimeLeft = () => {
            const now = Date.now();
            const target = data.nextFundingTime; // Binance returns raw timestamp
            const diff = target - now;

            if (diff <= 0) return "Funding Imminent";

            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000); // Only update on ms change, but we poll nicely

            return `${hours}h ${minutes}m ${seconds}s`;
        };

        setTimeLeft(calculateTimeLeft());
        const timer = setInterval(() => {
            setTimeLeft(calculateTimeLeft());
        }, 1000);

        return () => clearInterval(timer);
    }, [data?.nextFundingTime]);

    if (!isOpen || !data) return null;

    const { symbol, binanceRate, bybitRate } = data;

    // Strategy: 50% Long / 50% Short to be delta neutral
    // We pay trading fees, but for estimation, we just split the capital.
    const halfBudget = budget / 2;

    // Decide direction:
    // If Binance Rate > Bybit Rate: Setup is Long Bybit (Recv Funding) + Short Binance (Pay Funding)? 
    // Wait. 
    // Funding Rate is paid by Longs to Shorts if positive.
    // If Binance Rate is High Positive (e.g. 0.1%): Shorts receive payments.
    // If Bybit Rate is Low/Negative (e.g. 0.01%): Longs pay little or receive payment.
    // PROFIT = (Receive High Funding) - (Pay Low Funding)

    // Logic:
    // 1. Identify which exchange pays more (or costs less) to hold the position.
    // Generally: Go SHORT on the exchange with HIGHER rate (Receives funding).
    //            Go LONG on the exchange with LOWER rate (Pays funding / Receives if negative).

    let longExchange = "";
    let shortExchange = "";
    let longRate = 0;
    let shortRate = 0;
    let longUrl = "";
    let shortUrl = "";
    let longColor = "text-green-600";
    let shortColor = "text-red-600"; // Shorting usually associated with red/selling, but here it's profitable side.

    // Binance Rate vs Bybit Rate
    // If Binance > Bybit: Short Binance, Long Bybit.
    // Spread = Binance - Bybit.

    if (binanceRate > bybitRate) {
        shortExchange = "Binance";
        shortRate = binanceRate;
        shortUrl = `https://www.binance.com/en/futures/${symbol}USDT`;

        longExchange = "Bybit";
        longRate = bybitRate;
        longUrl = `https://www.bybit.com/trade/usdt/${symbol}USDT`;
    } else {
        // Bybit > Binance: Short Bybit, Long Binance
        shortExchange = "Bybit";
        shortRate = bybitRate;
        shortUrl = `https://www.bybit.com/trade/usdt/${symbol}USDT`;

        longExchange = "Binance";
        longRate = binanceRate;
        longUrl = `https://www.binance.com/en/futures/${symbol}USDT`;
    }

    // Est. Daily Profit
    // (Short Rate - Long Rate) * 3 times a day * Position Size?
    // Actually funding is paid every 8h usually.
    // Net Rate per 8h = Short_Rate - Long_Rate (approx)
    // Daily % = (Short_Rate - Long_Rate) * 3

    const netRate = Math.abs(binanceRate - bybitRate);

    // Profit for ONE funding interval (e.g. 8h)
    // Formula: (Capital / 2) * (Spread / 100)
    const profitPerInterval = (halfBudget * (netRate / 100));

    // Profit for 24h (Dynamic)
    // Default to 8h interval (3 payments/day) if unknown
    // We favor the shorter interval for estimation if they differ? 
    // Usually they match. We use Bybit's as primary for calculations involving Bybit legs.
    const intervalHours = data.intervals?.bybit || data.intervals?.binance || 8;
    const paymentsPerDay = 24 / intervalHours;
    const dailyProfit = profitPerInterval * paymentsPerDay;


    // ... (existing code for calculation)

    const handleOpenBoth = () => {
        window.open(longUrl, "_blank");
        window.open(shortUrl, "_blank");
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in zoom-in-95 duration-200">
            <div className="relative w-full max-w-md mx-4">
                <Card className="shadow-2xl border-2 border-primary/20">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 bg-muted/40 rounded-t-lg">
                        <CardTitle className="text-xl font-bold flex items-center gap-2">
                            <Calculator className="h-5 w-5 text-primary" />
                            Arbitrage Calc: {symbol}
                        </CardTitle>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={onClose}>
                            <X className="h-4 w-4" />
                        </Button>
                    </CardHeader>

                    <CardContent className="space-y-6 pt-6">

                        {/* Funding Timer */}
                        {timeLeft && (
                            <div className="bg-blue-500/10 border border-blue-500/20 text-blue-600 rounded-md p-2 text-center text-sm font-medium">
                                Next Funding in: <span className="font-bold text-foreground">{timeLeft}</span>
                            </div>
                        )}

                        {/* Budget Input */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">Total Capital (USDT)</label>
                            <div className="relative">
                                <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                                <Input
                                    type="number"
                                    value={budget}
                                    onChange={(e) => setBudget(Number(e.target.value))}
                                    className="pl-7 text-lg font-bold"
                                />
                            </div>
                        </div>

                        {/* Strategy Display */}
                        <div className="grid grid-cols-2 gap-4">

                            {/* LONG LEG */}
                            <div className="space-y-2 p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                                <div className="text-xs font-bold text-green-600 uppercase tracking-wider mb-1">Buy / Long</div>
                                <div className="font-bold text-lg">{longExchange}</div>
                                <div className="text-sm text-muted-foreground">Rate: {longRate.toFixed(4)}%</div>
                                <div className="font-mono text-xl font-black mt-2">${halfBudget.toFixed(2)}</div>
                                <Button size="sm" variant="outline" className="w-full mt-2 border-green-500/30 hover:bg-green-500/20 text-green-700" asChild>
                                    <a href={longUrl} target="_blank" rel="noopener noreferrer">Open {longExchange}</a>
                                </Button>
                            </div>

                            {/* SHORT LEG */}
                            <div className="space-y-2 p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                                <div className="text-xs font-bold text-red-600 uppercase tracking-wider mb-1">Sell / Short</div>
                                <div className="font-bold text-lg">{shortExchange}</div>
                                <div className="text-sm text-muted-foreground">Rate: {shortRate.toFixed(4)}%</div>
                                <div className="font-mono text-xl font-black mt-2">${halfBudget.toFixed(2)}</div>
                                <Button size="sm" variant="outline" className="w-full mt-2 border-red-500/30 hover:bg-red-500/20 text-red-700" asChild>
                                    <a href={shortUrl} target="_blank" rel="noopener noreferrer">Open {shortExchange}</a>
                                </Button>
                            </div>

                        </div>

                        {/* Summary */}
                        <div className="bg-muted/30 p-4 rounded-lg space-y-3">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-muted-foreground">Spread</span>
                                <span className="font-mono font-bold">{netRate.toFixed(4)}%</span>
                            </div>

                            {/* Highlighted Profit Section */}
                            <div className="flex justify-between items-center bg-blue-100 dark:bg-blue-900/30 p-2 rounded border border-blue-200 dark:border-blue-800">
                                <span className="text-sm font-bold text-blue-700 dark:text-blue-300">Est. Profit (Next Funding)</span>
                                <span className="font-mono font-black text-lg text-blue-700 dark:text-blue-300">+${profitPerInterval.toFixed(4)}</span>
                            </div>

                            <div className="flex justify-between items-center text-emerald-600 border-t border-dashed pt-2 px-2">
                                <span className="text-sm font-medium">Est. 24h Income ({paymentsPerDay}x)</span>
                                <span className="font-mono font-bold">+${dailyProfit.toFixed(4)}</span>
                            </div>
                        </div>

                        {/* Main Action */}
                        <div className="grid grid-cols-2 gap-3">
                            <Button className="h-12 text-lg font-bold bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white shadow-lg" onClick={handleOpenBoth}>
                                <ExternalLink className="mr-2 h-5 w-5" /> Open Both
                            </Button>
                            <Button className="h-12 text-lg font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-lg" onClick={() => setShowDemo(true)}>
                                <Calculator className="mr-2 h-5 w-5" /> Demo Trade
                            </Button>
                        </div>

                        <p className="text-[10px] text-center text-muted-foreground mt-2 border-t pt-2">
                            *Approximate calculation. Funding rates vary dynamically. Prices exclude trading fees.
                        </p>

                    </CardContent>
                </Card>

                {/* Nested Demo Modal */}
                <DemoTradingModal
                    isOpen={showDemo}
                    onClose={() => setShowDemo(false)}
                    data={data}
                />
            </div>
        </div>
    );
}
