import * as React from "react"
import { cn } from "@/lib/utils"

const Tooltip = ({ children, content, side = "top" }) => {
    const [isVisible, setIsVisible] = React.useState(false)

    const positionClasses = {
        top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
        bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
        left: "right-full top-1/2 -translate-y-1/2 mr-2",
        right: "left-full top-1/2 -translate-y-1/2 ml-2"
    }

    return (
        <div
            className="relative inline-block"
            onMouseEnter={() => setIsVisible(true)}
            onMouseLeave={() => setIsVisible(false)}
        >
            {children}
            {isVisible && (
                <div className={cn(
                    "absolute z-50 px-2 py-1 text-xs font-medium text-white bg-gray-900 rounded shadow-lg whitespace-nowrap pointer-events-none animate-in fade-in-0 zoom-in-95 duration-100",
                    positionClasses[side]
                )}>
                    {content}
                    <div className={cn(
                        "absolute w-2 h-2 bg-gray-900 rotate-45",
                        side === "top" && "top-full left-1/2 -translate-x-1/2 -mt-1",
                        side === "bottom" && "bottom-full left-1/2 -translate-x-1/2 -mb-1",
                        side === "left" && "left-full top-1/2 -translate-y-1/2 -ml-1",
                        side === "right" && "right-full top-1/2 -translate-y-1/2 -mr-1"
                    )} />
                </div>
            )}
        </div>
    )
}

export { Tooltip }
