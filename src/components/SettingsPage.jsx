import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Save, Server, Shield, Send, Download, Upload, Activity, Eye, EyeOff, Check, X, Loader2 } from "lucide-react";

export function SettingsPage() {
    const DEFAULT_TG_TOKEN = "8464876289:AAHctVyJrkl0XZogsCVZg3wjP0MI0W_Ius8";
    const DEFAULT_TG_CHAT_ID = "@arbitagebianance";

    const [config, setConfig] = useState({
        primaryBackendUrl: "https://vats147-bianance-bot.hf.space",
        backupBackendUrl: "",
        // Bybit - Separate Demo and Live keys
        bybitDemoKey: "",
        bybitDemoSecret: "",
        bybitLiveKey: "",
        bybitLiveSecret: "",
        bybitUseLive: false, // Toggle: false = demo, true = live
        // Binance - Separate Testnet and Live keys
        binanceTestnetKey: "",
        binanceTestnetSecret: "",
        binanceLiveKey: "",
        binanceLiveSecret: "",
        binanceUseLive: false, // Toggle: false = testnet, true = live
        // Telegram
        telegramToken: DEFAULT_TG_TOKEN,
        telegramChatId: DEFAULT_TG_CHAT_ID,
        alertThreshold: "0.5",
        alertLeadTime: "10"
    });

    // Show/hide password states
    const [showBybitDemoKey, setShowBybitDemoKey] = useState(false);
    const [showBybitDemoSecret, setShowBybitDemoSecret] = useState(false);
    const [showBybitLiveKey, setShowBybitLiveKey] = useState(false);
    const [showBybitLiveSecret, setShowBybitLiveSecret] = useState(false);
    const [showBinanceTestnetKey, setShowBinanceTestnetKey] = useState(false);
    const [showBinanceTestnetSecret, setShowBinanceTestnetSecret] = useState(false);
    const [showBinanceLiveKey, setShowBinanceLiveKey] = useState(false);
    const [showBinanceLiveSecret, setShowBinanceLiveSecret] = useState(false);

    // Verification states
    const [bybitVerified, setBybitVerified] = useState(null); // null = not verified, true = success, false = failed
    const [binanceVerified, setBinanceVerified] = useState(null);
    const [verifyingBybit, setVerifyingBybit] = useState(false);
    const [verifyingBinance, setVerifyingBinance] = useState(false);

    const fileInputRef = useRef(null);

    useEffect(() => {
        // Load settings from localStorage
        const savedPrimary = localStorage.getItem("primary_backend_url");
        const savedBackup = localStorage.getItem("backup_backend_url");

        // Bybit keys (load both demo and live)
        const savedBybitDemoKey = localStorage.getItem("user_bybit_demo_key");
        const savedBybitDemoSecret = localStorage.getItem("user_bybit_demo_secret");
        const savedBybitLiveKey = localStorage.getItem("user_bybit_live_key");
        const savedBybitLiveSecret = localStorage.getItem("user_bybit_live_secret");
        const savedBybitUseLive = localStorage.getItem("user_bybit_use_live");

        // Binance keys (load both testnet and live)
        const savedBinanceTestnetKey = localStorage.getItem("user_binance_testnet_key");
        const savedBinanceTestnetSecret = localStorage.getItem("user_binance_testnet_secret");
        const savedBinanceLiveKey = localStorage.getItem("user_binance_live_key");
        const savedBinanceLiveSecret = localStorage.getItem("user_binance_live_secret");
        const savedBinanceUseLive = localStorage.getItem("user_binance_use_live");

        // Legacy migration: if old keys exist, migrate them
        const legacyBybitKey = localStorage.getItem("user_bybit_key");
        const legacyBybitSecret = localStorage.getItem("user_bybit_secret");
        const legacyBinanceKey = localStorage.getItem("user_binance_key");
        const legacyBinanceSecret = localStorage.getItem("user_binance_secret");

        const savedTelegramToken = localStorage.getItem("telegram_token");
        const savedTelegramChatId = localStorage.getItem("telegram_chat_id");
        const savedAlertThreshold = localStorage.getItem("alert_threshold");
        const savedAlertLeadTime = localStorage.getItem("alert_lead_time");

        setConfig({
            primaryBackendUrl: savedPrimary || "https://vats147-bianance-bot.hf.space",
            backupBackendUrl: savedBackup || "",
            // Bybit
            bybitDemoKey: savedBybitDemoKey || legacyBybitKey || "",
            bybitDemoSecret: savedBybitDemoSecret || legacyBybitSecret || "",
            bybitLiveKey: savedBybitLiveKey || "",
            bybitLiveSecret: savedBybitLiveSecret || "",
            bybitUseLive: savedBybitUseLive === "true",
            // Binance
            binanceTestnetKey: savedBinanceTestnetKey || legacyBinanceKey || "",
            binanceTestnetSecret: savedBinanceTestnetSecret || legacyBinanceSecret || "",
            binanceLiveKey: savedBinanceLiveKey || "",
            binanceLiveSecret: savedBinanceLiveSecret || "",
            binanceUseLive: savedBinanceUseLive === "true",
            // Telegram
            telegramToken: savedTelegramToken || DEFAULT_TG_TOKEN,
            telegramChatId: savedTelegramChatId || DEFAULT_TG_CHAT_ID,
            alertThreshold: savedAlertThreshold || "0.5",
            alertLeadTime: savedAlertLeadTime || "10"
        });
    }, []);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setConfig(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
        // Reset verification when keys or mode changes
        if (name.startsWith('bybit')) setBybitVerified(null);
        if (name.startsWith('binance')) setBinanceVerified(null);
    };

    // Get active Bybit keys based on mode
    const getActiveBybitKeys = () => {
        if (config.bybitUseLive) {
            return { key: config.bybitLiveKey, secret: config.bybitLiveSecret };
        }
        return { key: config.bybitDemoKey, secret: config.bybitDemoSecret };
    };

    // Get active Binance keys based on mode
    const getActiveBinanceKeys = () => {
        if (config.binanceUseLive) {
            return { key: config.binanceLiveKey, secret: config.binanceLiveSecret };
        }
        return { key: config.binanceTestnetKey, secret: config.binanceTestnetSecret };
    };

    const verifyBybitKeys = async () => {
        const { key, secret } = getActiveBybitKeys();
        if (!key || !secret) {
            alert(`Please enter both Bybit ${config.bybitUseLive ? 'Live' : 'Demo'} API Key and Secret`);
            return;
        }
        setVerifyingBybit(true);
        try {
            const res = await fetch(`${config.primaryBackendUrl || 'http://localhost:8000'}/api/verify-bybit-keys?is_live=${config.bybitUseLive}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-Bybit-Key': key,
                    'X-User-Bybit-Secret': secret
                }
            });
            const data = await res.json();
            if (data.valid) {
                setBybitVerified(true);
                // Auto-save on success
                if (config.bybitUseLive) {
                    localStorage.setItem("user_bybit_live_key", key);
                    localStorage.setItem("user_bybit_live_secret", secret);
                } else {
                    localStorage.setItem("user_bybit_demo_key", key);
                    localStorage.setItem("user_bybit_demo_secret", secret);
                }
                localStorage.setItem("user_bybit_use_live", config.bybitUseLive);

                // Update legacy active keys
                localStorage.setItem("user_bybit_key", key);
                localStorage.setItem("user_bybit_secret", secret);
                localStorage.setItem("user_bybit_live", config.bybitUseLive);

                alert(`✅ Bybit ${config.bybitUseLive ? 'LIVE' : 'DEMO'} API Keys are valid and saved!`);
            } else {
                setBybitVerified(false);
                alert("❌ Bybit API Keys are invalid: " + (data.error || "Unknown error"));
            }
        } catch (e) {
            setBybitVerified(false);
            alert("❌ Failed to verify Bybit keys: " + e.message);
        }
        setVerifyingBybit(false);
    };

    const verifyBinanceKeys = async () => {
        const { key, secret } = getActiveBinanceKeys();
        if (!key || !secret) {
            alert(`Please enter both Binance ${config.binanceUseLive ? 'Live' : 'Testnet'} API Key and Secret`);
            return;
        }
        setVerifyingBinance(true);
        try {
            const res = await fetch(`${config.primaryBackendUrl || 'http://localhost:8000'}/api/verify-binance-keys?is_testnet=${!config.binanceUseLive}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-Binance-Key': key,
                    'X-User-Binance-Secret': secret
                }
            });
            const data = await res.json();
            if (data.valid) {
                setBinanceVerified(true);
                // Auto-save on success
                if (config.binanceUseLive) {
                    localStorage.setItem("user_binance_live_key", key);
                    localStorage.setItem("user_binance_live_secret", secret);
                } else {
                    localStorage.setItem("user_binance_testnet_key", key);
                    localStorage.setItem("user_binance_testnet_secret", secret);
                }
                localStorage.setItem("user_binance_use_live", config.binanceUseLive);

                // Update legacy active keys
                localStorage.setItem("user_binance_key", key);
                localStorage.setItem("user_binance_secret", secret);
                localStorage.setItem("user_binance_testnet", !config.binanceUseLive);

                alert(`✅ Binance ${config.binanceUseLive ? 'LIVE' : 'Testnet'} API Keys are valid and saved!`);
            } else {
                setBinanceVerified(false);
                alert("❌ Binance API Keys are invalid: " + (data.error || "Unknown error"));
            }
        } catch (e) {
            setBinanceVerified(false);
            alert("❌ Failed to verify Binance keys: " + e.message);
        }
        setVerifyingBinance(false);
    };

    const handleSave = () => {
        localStorage.setItem("primary_backend_url", config.primaryBackendUrl);
        localStorage.setItem("backup_backend_url", config.backupBackendUrl);

        // Save Bybit keys (both demo and live)
        localStorage.setItem("user_bybit_demo_key", config.bybitDemoKey);
        localStorage.setItem("user_bybit_demo_secret", config.bybitDemoSecret);
        localStorage.setItem("user_bybit_live_key", config.bybitLiveKey);
        localStorage.setItem("user_bybit_live_secret", config.bybitLiveSecret);
        localStorage.setItem("user_bybit_use_live", config.bybitUseLive);

        // Save active Bybit keys for backward compatibility
        const activeBybit = getActiveBybitKeys();
        localStorage.setItem("user_bybit_key", activeBybit.key);
        localStorage.setItem("user_bybit_secret", activeBybit.secret);
        localStorage.setItem("user_bybit_live", config.bybitUseLive);

        // Save Binance keys (both testnet and live)
        localStorage.setItem("user_binance_testnet_key", config.binanceTestnetKey);
        localStorage.setItem("user_binance_testnet_secret", config.binanceTestnetSecret);
        localStorage.setItem("user_binance_live_key", config.binanceLiveKey);
        localStorage.setItem("user_binance_live_secret", config.binanceLiveSecret);
        localStorage.setItem("user_binance_use_live", config.binanceUseLive);

        // Save active Binance keys for backward compatibility
        const activeBinance = getActiveBinanceKeys();
        localStorage.setItem("user_binance_key", activeBinance.key);
        localStorage.setItem("user_binance_secret", activeBinance.secret);
        localStorage.setItem("user_binance_testnet", !config.binanceUseLive);

        // Telegram settings
        localStorage.setItem("telegram_token", config.telegramToken);
        localStorage.setItem("telegram_chat_id", config.telegramChatId);
        localStorage.setItem("alert_threshold", config.alertThreshold);
        localStorage.setItem("alert_lead_time", config.alertLeadTime);

        alert("Configuration Saved!");
        window.location.reload();
    };

    // --- CREDENTIAL EXPORT/IMPORT ---
    const handleExport = () => {
        const exportData = {
            bybit_demo_key: config.bybitDemoKey,
            bybit_demo_secret: config.bybitDemoSecret,
            bybit_live_key: config.bybitLiveKey,
            bybit_live_secret: config.bybitLiveSecret,
            bybit_use_live: config.bybitUseLive,
            binance_testnet_key: config.binanceTestnetKey,
            binance_testnet_secret: config.binanceTestnetSecret,
            binance_live_key: config.binanceLiveKey,
            binance_live_secret: config.binanceLiveSecret,
            binance_use_live: config.binanceUseLive,
            timestamp: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bot_credentials_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                // Support both old and new format
                setConfig(prev => ({
                    ...prev,
                    // New format
                    bybitDemoKey: data.bybit_demo_key || data.bybit_key || prev.bybitDemoKey,
                    bybitDemoSecret: data.bybit_demo_secret || data.bybit_secret || prev.bybitDemoSecret,
                    bybitLiveKey: data.bybit_live_key || prev.bybitLiveKey,
                    bybitLiveSecret: data.bybit_live_secret || prev.bybitLiveSecret,
                    bybitUseLive: data.bybit_use_live ?? prev.bybitUseLive,
                    binanceTestnetKey: data.binance_testnet_key || data.binance_key || prev.binanceTestnetKey,
                    binanceTestnetSecret: data.binance_testnet_secret || data.binance_secret || prev.binanceTestnetSecret,
                    binanceLiveKey: data.binance_live_key || prev.binanceLiveKey,
                    binanceLiveSecret: data.binance_live_secret || prev.binanceLiveSecret,
                    binanceUseLive: data.binance_use_live ?? prev.binanceUseLive
                }));
                alert("Credentials loaded! Please review and click 'Save Configuration'.");
            } catch (err) {
                alert("Failed to parse JSON file.");
            }
        };
        reader.readAsText(file);
        // Reset input
        e.target.value = null;
    };

    return (
        <div className="space-y-6 max-w-4xl mx-auto p-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                    <Shield className="h-8 w-8 text-primary" />
                    <h2 className="text-3xl font-bold tracking-tight">System Configuration</h2>
                </div>
                {/* Export/Import Buttons */}
                <div className="flex gap-2">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept=".json"
                        className="hidden"
                    />
                    <Button variant="outline" size="sm" onClick={handleImportClick} className="gap-2">
                        <Upload className="h-4 w-4" /> Import Keys
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
                        <Download className="h-4 w-4" /> Export Keys
                    </Button>
                </div>
            </div>


            <div className="grid gap-6 md:grid-cols-2">
                {/* BACKEND CONFIGURATION */}
                <Card className="md:col-span-2 shadow-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Server className="h-5 w-5 text-blue-500" />
                            Backend Connections
                        </CardTitle>
                        <CardDescription>Configure primary and backup API endpoints.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Primary Backend URL</label>
                            <Input
                                name="primaryBackendUrl"
                                value={config.primaryBackendUrl}
                                onChange={handleChange}
                                placeholder="http://127.0.0.1:8000"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Backup Backend URL (Optional)</label>
                            <Input
                                name="backupBackendUrl"
                                value={config.backupBackendUrl}
                                onChange={handleChange}
                                placeholder="https://your-ngrok-url.ngrok-free.app"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Used if the primary connection fails.
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* BYBIT API CONFIGURATION */}
                <Card className={`shadow-md ${bybitVerified === true ? 'border-green-500' : bybitVerified === false ? 'border-red-500' : ''}`}>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Shield className="h-5 w-5 text-purple-500" />
                            Bybit Credentials
                            {config.bybitUseLive && <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded font-bold animate-pulse">LIVE</span>}
                            {!config.bybitUseLive && <span className="text-xs bg-purple-500 text-white px-2 py-0.5 rounded font-bold">DEMO</span>}
                            {bybitVerified === true && <Check className="h-5 w-5 text-green-500" />}
                            {bybitVerified === false && <X className="h-5 w-5 text-red-500" />}
                        </CardTitle>
                        <CardDescription>Save both Demo and Live API keys. Toggle to switch between them.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Mode Toggle */}
                        <div className={`flex items-center justify-between border p-3 rounded-lg ${config.bybitUseLive ? 'bg-red-500/10 border-red-500/30' : 'bg-purple-500/10 border-purple-500/30'}`}>
                            <label className="text-sm font-medium flex items-center gap-2">
                                {config.bybitUseLive ? '🔴 Live Trading Active' : '🟣 Demo Trading Active'}
                                {config.bybitUseLive && <span className="text-[10px] text-red-500 font-bold">⚠️ REAL MONEY</span>}
                            </label>
                            <Switch
                                checked={config.bybitUseLive}
                                onCheckedChange={(checked) => {
                                    setConfig(prev => ({ ...prev, bybitUseLive: checked }));
                                    setBybitVerified(null);
                                }}
                            />
                        </div>

                        {/* Demo Keys Section */}
                        <div className={`space-y-3 p-3 rounded-lg border ${!config.bybitUseLive ? 'bg-purple-500/5 border-purple-500/30' : 'bg-muted/30 border-transparent opacity-60'}`}>
                            <div className="flex items-center gap-2 text-sm font-bold text-purple-600">
                                🟣 Demo API Keys
                                {!config.bybitUseLive && <span className="text-[10px] bg-purple-500 text-white px-1.5 py-0.5 rounded">ACTIVE</span>}
                            </div>
                            <div className="grid gap-2">
                                <div className="relative">
                                    <Input
                                        name="bybitDemoKey"
                                        type={showBybitDemoKey ? "text" : "password"}
                                        value={config.bybitDemoKey}
                                        onChange={handleChange}
                                        placeholder="Demo API Key"
                                        className="pr-10"
                                    />
                                    <Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0" onClick={() => setShowBybitDemoKey(!showBybitDemoKey)}>
                                        {showBybitDemoKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </Button>
                                </div>
                                <div className="relative">
                                    <Input
                                        name="bybitDemoSecret"
                                        type={showBybitDemoSecret ? "text" : "password"}
                                        value={config.bybitDemoSecret}
                                        onChange={handleChange}
                                        placeholder="Demo API Secret"
                                        className="pr-10"
                                    />
                                    <Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0" onClick={() => setShowBybitDemoSecret(!showBybitDemoSecret)}>
                                        {showBybitDemoSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* Live Keys Section */}
                        <div className={`space-y-3 p-3 rounded-lg border ${config.bybitUseLive ? 'bg-red-500/5 border-red-500/30' : 'bg-muted/30 border-transparent opacity-60'}`}>
                            <div className="flex items-center gap-2 text-sm font-bold text-red-600">
                                🔴 Live API Keys
                                {config.bybitUseLive && <span className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded animate-pulse">ACTIVE</span>}
                            </div>
                            <div className="grid gap-2">
                                <div className="relative">
                                    <Input
                                        name="bybitLiveKey"
                                        type={showBybitLiveKey ? "text" : "password"}
                                        value={config.bybitLiveKey}
                                        onChange={handleChange}
                                        placeholder="Live API Key (Real Money)"
                                        className="pr-10"
                                    />
                                    <Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0" onClick={() => setShowBybitLiveKey(!showBybitLiveKey)}>
                                        {showBybitLiveKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </Button>
                                </div>
                                <div className="relative">
                                    <Input
                                        name="bybitLiveSecret"
                                        type={showBybitLiveSecret ? "text" : "password"}
                                        value={config.bybitLiveSecret}
                                        onChange={handleChange}
                                        placeholder="Live API Secret (Real Money)"
                                        className="pr-10"
                                    />
                                    <Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0" onClick={() => setShowBybitLiveSecret(!showBybitLiveSecret)}>
                                        {showBybitLiveSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <Button
                            variant="outline"
                            className={`w-full ${bybitVerified === true ? 'border-green-500 text-green-600' : bybitVerified === false ? 'border-red-500 text-red-600' : config.bybitUseLive ? 'border-red-500 text-red-600' : 'border-purple-500 text-purple-600'}`}
                            onClick={verifyBybitKeys}
                            disabled={verifyingBybit || (config.bybitUseLive ? (!config.bybitLiveKey || !config.bybitLiveSecret) : (!config.bybitDemoKey || !config.bybitDemoSecret))}
                        >
                            {verifyingBybit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : bybitVerified === true ? <Check className="mr-2 h-4 w-4" /> : <Shield className="mr-2 h-4 w-4" />}
                            {verifyingBybit ? "Verifying..." : bybitVerified === true ? `Verified ✓ (${config.bybitUseLive ? 'LIVE' : 'DEMO'})` : bybitVerified === false ? "Verification Failed - Retry" : `Verify Bybit ${config.bybitUseLive ? 'Live' : 'Demo'} Keys`}
                        </Button>
                    </CardContent>
                </Card>

                {/* BINANCE API CONFIGURATION */}
                <Card className={`shadow-md ${binanceVerified === true ? 'border-green-500' : binanceVerified === false ? 'border-red-500' : ''}`}>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Shield className="h-5 w-5 text-yellow-500" />
                            Binance Futures Credentials
                            {config.binanceUseLive && <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded font-bold animate-pulse">LIVE</span>}
                            {!config.binanceUseLive && <span className="text-xs bg-yellow-500 text-black px-2 py-0.5 rounded font-bold">TESTNET</span>}
                            {binanceVerified === true && <Check className="h-5 w-5 text-green-500" />}
                            {binanceVerified === false && <X className="h-5 w-5 text-red-500" />}
                        </CardTitle>
                        <CardDescription>Save both Testnet and Live API keys. Toggle to switch between them.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Mode Toggle */}
                        <div className={`flex items-center justify-between border p-3 rounded-lg ${config.binanceUseLive ? 'bg-red-500/10 border-red-500/30' : 'bg-yellow-500/10 border-yellow-500/30'}`}>
                            <label className="text-sm font-medium flex items-center gap-2">
                                {config.binanceUseLive ? '🔴 Live Trading Active' : '🟡 Testnet Trading Active'}
                                {config.binanceUseLive && <span className="text-[10px] text-red-500 font-bold">⚠️ REAL MONEY</span>}
                            </label>
                            <Switch
                                checked={config.binanceUseLive}
                                onCheckedChange={(checked) => {
                                    setConfig(prev => ({ ...prev, binanceUseLive: checked }));
                                    setBinanceVerified(null);
                                }}
                            />
                        </div>

                        {/* Testnet Keys Section */}
                        <div className={`space-y-3 p-3 rounded-lg border ${!config.binanceUseLive ? 'bg-yellow-500/5 border-yellow-500/30' : 'bg-muted/30 border-transparent opacity-60'}`}>
                            <div className="flex items-center gap-2 text-sm font-bold text-yellow-600">
                                🟡 Testnet API Keys
                                {!config.binanceUseLive && <span className="text-[10px] bg-yellow-500 text-black px-1.5 py-0.5 rounded">ACTIVE</span>}
                            </div>
                            <div className="grid gap-2">
                                <div className="relative">
                                    <Input
                                        name="binanceTestnetKey"
                                        type={showBinanceTestnetKey ? "text" : "password"}
                                        value={config.binanceTestnetKey}
                                        onChange={handleChange}
                                        placeholder="Testnet API Key"
                                        className="pr-10"
                                    />
                                    <Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0" onClick={() => setShowBinanceTestnetKey(!showBinanceTestnetKey)}>
                                        {showBinanceTestnetKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </Button>
                                </div>
                                <div className="relative">
                                    <Input
                                        name="binanceTestnetSecret"
                                        type={showBinanceTestnetSecret ? "text" : "password"}
                                        value={config.binanceTestnetSecret}
                                        onChange={handleChange}
                                        placeholder="Testnet API Secret"
                                        className="pr-10"
                                    />
                                    <Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0" onClick={() => setShowBinanceTestnetSecret(!showBinanceTestnetSecret)}>
                                        {showBinanceTestnetSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* Live Keys Section */}
                        <div className={`space-y-3 p-3 rounded-lg border ${config.binanceUseLive ? 'bg-red-500/5 border-red-500/30' : 'bg-muted/30 border-transparent opacity-60'}`}>
                            <div className="flex items-center gap-2 text-sm font-bold text-red-600">
                                🔴 Live API Keys
                                {config.binanceUseLive && <span className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded animate-pulse">ACTIVE</span>}
                            </div>
                            <div className="grid gap-2">
                                <div className="relative">
                                    <Input
                                        name="binanceLiveKey"
                                        type={showBinanceLiveKey ? "text" : "password"}
                                        value={config.binanceLiveKey}
                                        onChange={handleChange}
                                        placeholder="Live API Key (Real Money)"
                                        className="pr-10"
                                    />
                                    <Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0" onClick={() => setShowBinanceLiveKey(!showBinanceLiveKey)}>
                                        {showBinanceLiveKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </Button>
                                </div>
                                <div className="relative">
                                    <Input
                                        name="binanceLiveSecret"
                                        type={showBinanceLiveSecret ? "text" : "password"}
                                        value={config.binanceLiveSecret}
                                        onChange={handleChange}
                                        placeholder="Live API Secret (Real Money)"
                                        className="pr-10"
                                    />
                                    <Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0" onClick={() => setShowBinanceLiveSecret(!showBinanceLiveSecret)}>
                                        {showBinanceLiveSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <Button
                            variant="outline"
                            className={`w-full ${binanceVerified === true ? 'border-green-500 text-green-600' : binanceVerified === false ? 'border-red-500 text-red-600' : config.binanceUseLive ? 'border-red-500 text-red-600' : 'border-yellow-500 text-yellow-600'}`}
                            onClick={verifyBinanceKeys}
                            disabled={verifyingBinance || (config.binanceUseLive ? (!config.binanceLiveKey || !config.binanceLiveSecret) : (!config.binanceTestnetKey || !config.binanceTestnetSecret))}
                        >
                            {verifyingBinance ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : binanceVerified === true ? <Check className="mr-2 h-4 w-4" /> : <Shield className="mr-2 h-4 w-4" />}
                            {verifyingBinance ? "Verifying..." : binanceVerified === true ? `Verified ✓ (${config.binanceUseLive ? 'LIVE' : 'TESTNET'})` : binanceVerified === false ? "Verification Failed - Retry" : `Verify Binance ${config.binanceUseLive ? 'Live' : 'Testnet'} Keys`}
                        </Button>
                    </CardContent>
                </Card>

                {/* TELEGRAM ALERTS CONFIGURATION */}
                <Card className="md:col-span-2 shadow-md border-blue-500/20 bg-blue-500/5">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Send className="h-5 w-5 text-blue-500" />
                            Telegram Alerts
                        </CardTitle>
                        <CardDescription>Configure Telegram bot for real-time alerts.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Bot Token</label>
                            <Input
                                name="telegramToken"
                                type="password"
                                value={config.telegramToken}
                                onChange={handleChange}
                                placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Chat ID</label>
                            <Input
                                name="telegramChatId"
                                value={config.telegramChatId}
                                onChange={handleChange}
                                placeholder="-100123456789 (Use @userinfobot to find)"
                            />
                        </div>
                        <div className="grid gap-4 md:grid-cols-2 mt-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Alert Threshold (Diff %)</label>
                                <Input
                                    name="alertThreshold"
                                    type="number"
                                    step="0.1"
                                    value={config.alertThreshold}
                                    onChange={handleChange}
                                    placeholder="0.5"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Lead Time (Minutes before Funding)</label>
                                <Input
                                    name="alertLeadTime"
                                    type="number"
                                    value={config.alertLeadTime}
                                    onChange={handleChange}
                                    placeholder="10"
                                />
                            </div>
                        </div>

                        <div className="pt-2 flex gap-2">
                            <Button
                                variant="outline"
                                className="w-1/2 border-blue-500 text-blue-500 hover:bg-blue-500/10"
                                onClick={async () => {
                                    if (!config.telegramToken || !config.telegramChatId) {
                                        alert("Please enter Bot Token and Chat ID first!");
                                        return;
                                    }
                                    try {
                                        const res = await fetch(`${config.primaryBackendUrl}/api/telegram/send`, {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({
                                                token: config.telegramToken,
                                                chatId: config.telegramChatId,
                                                message: "🔔 *Funding Arbitrage Test Alert*\n\nThis is a test notification from your bot. Your configuration is correct! ✅",
                                                buttonText: "Open Dashboard",
                                                buttonUrl: window.location.origin
                                            })
                                        });
                                        const data = await res.json();
                                        if (data.status === "success") {
                                            alert("Test alert sent successfully!");
                                        } else {
                                            alert("Failed to send test alert: " + data.message);
                                        }
                                    } catch (e) {
                                        alert("Error sending test alert: " + e.message);
                                    }
                                }}
                            >
                                <Send className="mr-2 h-4 w-4" /> Send Test Alert
                            </Button>

                            <Button
                                variant="outline"
                                className="w-1/2 border-green-500 text-green-600 hover:bg-green-500/10"
                                onClick={async () => {
                                    if (!config.telegramToken || !config.telegramChatId) {
                                        alert("Please enter Bot Token and Chat ID first!");
                                        return;
                                    }
                                    try {
                                        const res = await fetch(`${config.primaryBackendUrl}/api/telegram/send`, {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({
                                                token: config.telegramToken,
                                                chatId: config.telegramChatId,
                                                message: "📊 *Spread Rate Test Alert*\n\n" +
                                                    "🪙 *TEST-USDT*\n" +
                                                    "📉 Spread: 1.25%\n" +
                                                    "🔶 Binance: 0.0500%\n" +
                                                    "💠 Bybit: -1.2000%\n" +
                                                    "✅ Spread logic verified.",
                                                buttonText: "Check Dashboard",
                                                buttonUrl: window.location.origin
                                            })
                                        });
                                        const data = await res.json();
                                        if (data.status === "success") {
                                            alert("Spread Rate Test alert sent successfully!");
                                        } else {
                                            alert("Failed to send spread test: " + data.message);
                                        }
                                    } catch (e) {
                                        alert("Error sending spread test: " + e.message);
                                    }
                                }}
                            >
                                <Activity className="mr-2 h-4 w-4" /> Test Spread Alert
                            </Button>
                        </div>

                        <p className="text-xs text-muted-foreground mt-2">
                            Create a bot via @BotFather and get your chat ID from @userinfobot.
                            Alerts will be sent when funding difference exceeds {config.alertThreshold}% within {config.alertLeadTime} mins of funding.
                        </p>
                    </CardContent>
                </Card>
            </div >

            <Button className="w-full h-12 text-lg font-bold bg-green-600 hover:bg-green-700" onClick={handleSave}>
                <Save className="mr-2 h-5 w-5" /> Save Configuration & Reload
            </Button>
        </div >
    );
}
