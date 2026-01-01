import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Save, Server, Shield } from "lucide-react";

export function SettingsPage() {
    const [config, setConfig] = useState({
        primaryBackendUrl: "https://a0ecbd4102e9.ngrok-free.app",
        backupBackendUrl: "",
        apiKey: "",
        apiSecret: ""
    });

    useEffect(() => {
        const savedPrimary = localStorage.getItem("primary_backend_url");
        const savedBackup = localStorage.getItem("backup_backend_url");
        const savedKey = localStorage.getItem("user_bybit_key");
        const savedSecret = localStorage.getItem("user_bybit_secret");

        setConfig({
            primaryBackendUrl: savedPrimary || "https://a0ecbd4102e9.ngrok-free.app",
            backupBackendUrl: savedBackup || "",
            apiKey: savedKey || "",
            apiSecret: savedSecret || ""
        });
    }, []);

    const handleSave = () => {
        localStorage.setItem("primary_backend_url", config.primaryBackendUrl);
        localStorage.setItem("backup_backend_url", config.backupBackendUrl);
        localStorage.setItem("user_bybit_key", config.apiKey);
        localStorage.setItem("user_bybit_secret", config.apiSecret);
        alert("Settings Saved!");
        window.location.reload(); // Reload to ensure app picks up new config
    };

    return (
        <div className="space-y-6 max-w-2xl mx-auto p-4">
            <h2 className="text-2xl font-bold tracking-tight">Configuration</h2>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Server className="h-5 w-5 text-blue-500" />
                        Backend Configuration
                    </CardTitle>
                    <CardDescription>
                        Set your API endpoints. The app will failover to the backup if the primary is unreachable.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Primary Backend URL</label>
                        <Input
                            value={config.primaryBackendUrl}
                            onChange={(e) => setConfig({ ...config, primaryBackendUrl: e.target.value })}
                            placeholder="http://127.0.0.1:8000"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Backup Backend URL (Optional)</label>
                        <Input
                            value={config.backupBackendUrl}
                            onChange={(e) => setConfig({ ...config, backupBackendUrl: e.target.value })}
                            placeholder="e.g., http://backup-server:8000"
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Shield className="h-5 w-5 text-amber-500" />
                        Bybit Demo Security
                    </CardTitle>
                    <CardDescription>
                        Override the backend's default keys with your own.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">API Key</label>
                        <Input
                            type="password"
                            value={config.apiKey}
                            onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                            placeholder="Enter your Demo API Key"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">API Secret</label>
                        <Input
                            type="password"
                            value={config.apiSecret}
                            onChange={(e) => setConfig({ ...config, apiSecret: e.target.value })}
                            placeholder="Enter your Demo API Secret"
                        />
                    </div>
                </CardContent>
            </Card>

            <Button onClick={handleSave} className="w-full h-12 text-lg font-bold bg-green-600 hover:bg-green-700">
                <Save className="mr-2 h-5 w-5" /> Save Configuration
            </Button>
        </div>
    );
}
