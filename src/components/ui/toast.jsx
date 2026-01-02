import { useState, useEffect, createContext, useContext } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// Toast Context
const ToastContext = createContext(null);

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error("useToast must be used within a ToastProvider");
    }
    return context;
}

// Toast Types
const TOAST_TYPES = {
    success: "bg-green-600 border-green-500",
    error: "bg-red-600 border-red-500",
    warning: "bg-yellow-600 border-yellow-500",
    info: "bg-blue-600 border-blue-500"
};

// Single Toast Component
function Toast({ id, message, type = "info", duration = 5000, onClose }) {
    const [progress, setProgress] = useState(100);
    const [isPaused, setIsPaused] = useState(false);

    useEffect(() => {
        if (isPaused) return;

        const interval = setInterval(() => {
            setProgress(prev => {
                const newProgress = prev - (100 / (duration / 50));
                if (newProgress <= 0) {
                    onClose(id);
                    return 0;
                }
                return newProgress;
            });
        }, 50);

        return () => clearInterval(interval);
    }, [duration, id, onClose, isPaused]);

    return (
        <div
            className={cn(
                "relative flex items-center gap-3 min-w-[300px] max-w-[400px] p-3 rounded-lg shadow-xl border text-white animate-in slide-in-from-right-5 fade-in duration-300",
                TOAST_TYPES[type]
            )}
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
        >
            <div className="flex-1 text-sm font-medium pr-6">{message}</div>
            <button
                onClick={() => onClose(id)}
                className="absolute top-2 right-2 p-1 rounded-full hover:bg-white/20 transition-colors"
            >
                <X className="w-4 h-4" />
            </button>

            {/* Progress Bar */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20 rounded-b-lg overflow-hidden">
                <div
                    className="h-full bg-white/50 transition-all duration-50 ease-linear"
                    style={{ width: `${progress}%` }}
                />
            </div>
        </div>
    );
}

// Toast Container & Provider
export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);

    const addToast = (message, type = "info", duration = 5000) => {
        const id = Date.now() + Math.random();
        setToasts(prev => [...prev, { id, message, type, duration }]);
        return id;
    };

    const removeToast = (id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    };

    const toast = {
        success: (msg, duration) => addToast(msg, "success", duration),
        error: (msg, duration) => addToast(msg, "error", duration),
        warning: (msg, duration) => addToast(msg, "warning", duration),
        info: (msg, duration) => addToast(msg, "info", duration),
        remove: removeToast
    };

    return (
        <ToastContext.Provider value={toast}>
            {children}

            {/* Toast Container */}
            <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
                {toasts.map(t => (
                    <Toast
                        key={t.id}
                        id={t.id}
                        message={t.message}
                        type={t.type}
                        duration={t.duration}
                        onClose={removeToast}
                    />
                ))}
            </div>
        </ToastContext.Provider>
    );
}
