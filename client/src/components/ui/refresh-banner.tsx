/**
 * Refresh Banner Component
 *
 * Non-intrusive banner that appears when new data is available
 * Replaces auto-refresh pattern with user-controlled refresh
 */

import { Button } from "@/components/ui/button";
import { RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface RefreshBannerProps {
  /**
   * Message to display
   * @default "Er is een nieuwe versie beschikbaar"
   */
  message?: string;

  /**
   * Callback when refresh button is clicked
   */
  onRefresh: () => void;

  /**
   * Callback when dismiss button is clicked
   */
  onDismiss?: () => void;

  /**
   * Whether the banner is visible
   */
  visible: boolean;

  /**
   * Additional CSS classes
   */
  className?: string;

  /**
   * Position of the banner
   * @default "top"
   */
  position?: "top" | "bottom";

  /**
   * Variant style
   * @default "default"
   */
  variant?: "default" | "info" | "success";
}

export function RefreshBanner({
  message = "Er is een nieuwe versie beschikbaar",
  onRefresh,
  onDismiss,
  visible,
  className,
  position = "top",
  variant = "default"
}: RefreshBannerProps) {
  if (!visible) return null;

  const variantClasses = {
    default: "bg-primary/10 border-primary/20 text-primary-foreground",
    info: "bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100",
    success: "bg-green-50 dark:bg-green-950/50 border-green-200 dark:border-green-800 text-green-900 dark:text-green-100"
  };

  const positionClasses = {
    top: "top-0 rounded-b-lg",
    bottom: "bottom-0 rounded-t-lg"
  };

  return (
    <div
      className={cn(
        "fixed left-1/2 -translate-x-1/2 z-50",
        "border shadow-lg",
        "animate-in slide-in-from-top-2 fade-in-0",
        "max-w-md w-full mx-4",
        variantClasses[variant],
        positionClasses[position],
        className
      )}
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3 flex-1">
          <RefreshCw className="h-4 w-4 flex-shrink-0" />
          <p className="text-sm font-medium">{message}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={onRefresh}
            className="h-8 px-3"
            variant={variant === "default" ? "default" : "outline"}
          >
            Vernieuwen
          </Button>

          {onDismiss && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onDismiss}
              className="h-8 w-8 p-0"
              aria-label="Sluiten"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Hook to manage refresh banner state
 */
export function useRefreshBanner(options?: {
  /**
   * Auto-dismiss after this many milliseconds
   */
  autoDismissMs?: number;
}) {
  const [isVisible, setIsVisible] = React.useState(false);
  const timeoutRef = React.useRef<NodeJS.Timeout>();

  const show = React.useCallback(() => {
    setIsVisible(true);

    if (options?.autoDismissMs) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        setIsVisible(false);
      }, options.autoDismissMs);
    }
  }, [options?.autoDismissMs]);

  const dismiss = React.useCallback(() => {
    setIsVisible(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  }, []);

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    isVisible,
    show,
    dismiss
  };
}

// Import React for the hook
import * as React from "react";
