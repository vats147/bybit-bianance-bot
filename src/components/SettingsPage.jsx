import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Save, Server, Shield, Send } from "lucide-react";

export function SettingsPage() {
    const [config, setConfig] = useState({
        primaryBackendUrl: "https://vats147-bianance-bot.hf.space",
        backupBackendUrl: "",
        apiKey: "", // Bybit
        apiSecret: "", // Bybit
        binanceKey: "",
        binanceSecret: "",
        binanceTestnet: true,
        telegramToken: "",
        telegramChatId: "",
        alertThreshold: "0.5",
        alertLeadTime: "10"
    });

    useEffect(() => {
        // Load settings from localStorage
        const savedPrimary = localStorage.getItem("primary_backend_url");
        const savedBackup = localStorage.getItem("backup_backend_url");
        const savedKey = localStorage.getItem("user_bybit_key");
        const savedSecret = localStorage.getItem("user_bybit_secret");

        const savedBinanceKey = localStorage.getItem("user_binance_key");
        const savedBinanceSecret = localStorage.getItem("user_binance_secret");
        const savedBinanceTestnet = localStorage.getItem("user_binance_testnet");
        const savedTelegramToken = localStorage.getItem("telegram_token");
        const savedTelegramChatId = localStorage.getItem("telegram_chat_id");
        const savedAlertThreshold = localStorage.getItem("alert_threshold");
        const savedAlertLeadTime = localStorage.getItem("alert_lead_time");

        setConfig({
            primaryBackendUrl: savedPrimary || "https://vats147-bianance-bot.hf.space",
            backupBackendUrl: savedBackup || "",
            apiKey: savedKey || "",
            apiSecret: savedSecret || "",
            binanceKey: savedBinanceKey || "",
            binanceSecret: savedBinanceSecret || "",
            binanceTestnet: savedBinanceTestnet === "false" ? false : true,
            telegramToken: savedTelegramToken || "",
            telegramChatId: savedTelegramChatId || "",
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
    };

    const handleSave = () => {
        localStorage.setItem("primary_backend_url", config.primaryBackendUrl);
        localStorage.setItem("backup_backend_url", config.backupBackendUrl);
        localStorage.setItem("user_bybit_key", config.apiKey);
        localStorage.setItem("user_bybit_secret", config.apiSecret);

        localStorage.setItem("user_binance_key", config.binanceKey);
        localStorage.setItem("user_binance_secret", config.binanceSecret);
        localStorage.setItem("user_binance_testnet", config.binanceTestnet);
        localStorage.setItem("telegram_token", config.telegramToken);
        localStorage.setItem("telegram_chat_id", config.telegramChatId);
        localStorage.setItem("alert_threshold", config.alertThreshold);
        localStorage.setItem("alert_lead_time", config.alertLeadTime);

        alert("Configuration Saved!");
        window.location.reload();
    };

    return (
        <div className="space-y-6 max-w-4xl mx-auto p-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center gap-2 mb-6">
                <Shield className="h-8 w-8 text-primary" />
                <h2 className="text-3xl font-bold tracking-tight">System Configuration</h2>
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
                <Card className="shadow-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Shield className="h-5 w-5 text-purple-500" />
                            Bybit Demo Credentials
                        </CardTitle>
                        <CardDescription>API Keys for Bybit Demo Trading.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">API Key (Demo)</label>
                            <Input
                                name="apiKey"
                                type="password"
                                value={config.apiKey}
                                onChange={handleChange}
                                placeholder="Bybit Demo API Key"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">API Secret (Demo)</label>
                            <Input
                                name="apiSecret"
                                type="password"
                                value={config.apiSecret}
                                onChange={handleChange}
                                placeholder="Bybit Demo Secret"
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* BINANCE API CONFIGURATION */}
                <Card className="shadow-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Shield className="h-5 w-5 text-yellow-500" />
                            Binance Futures Credentials
                        </CardTitle>
                        <CardDescription>Keys for Binance Futures (Testnet/Real).</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between border p-2 rounded bg-muted/30">
                            <label className="text-sm font-medium">Use Testnet</label>
                            <Switch
                                checked={config.binanceTestnet}
                                onCheckedChange={(checked) => setConfig(prev => ({ ...prev, binanceTestnet: checked }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">API Key</label>
                            <Input
                                name="binanceKey"
                                type="password"
                                value={config.binanceKey}
                                onChange={handleChange}
                                placeholder={config.binanceTestnet ? "Binance Testnet Key" : "Binance Real Key"}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">API Secret</label>
                            <Input
                                name="binanceSecret"
                                type="password"
                                value={config.binanceSecret}
                                onChange={handleChange}
                                placeholder="Binance Secret"
                            />
                        </div>
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

                        <div className="pt-2">
                            <Button
                                variant="outline"
                                className="w-full border-blue-500 text-blue-500 hover:bg-blue-500/10"
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
                        </div>

                        <p className="text-xs text-muted-foreground mt-2">
                            Create a bot via @BotFather and get your chat ID from @userinfobot.
                            Alerts will be sent when funding difference exceeds {config.alertThreshold}% within {config.alertLeadTime} mins of funding.
                        </p>
                    </CardContent>
                </Card>
            </div>

            <Button className="w-full h-12 text-lg font-bold bg-green-600 hover:bg-green-700" onClick={handleSave}>
                <Save className="mr-2 h-5 w-5" /> Save Configuration & Reload
            </Button>
        </div>
    );
}
