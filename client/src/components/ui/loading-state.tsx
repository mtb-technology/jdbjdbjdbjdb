import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoadingStateProps {
  /**
   * Size variant of the loading indicator
   * @default "default"
   */
  size?: "sm" | "default" | "lg";

  /**
   * Optional message to display below the spinner
   */
  message?: string;

  /**
   * Variant of the loading state
   * - spinner: Just a spinning loader
   * - skeleton: Skeleton loading placeholders (for lists/cards)
   * - inline: Smaller inline version
   * @default "spinner"
   */
  variant?: "spinner" | "skeleton" | "inline";

  /**
   * Number of skeleton items to show (only for variant="skeleton")
   * @default 3
   */
  skeletonCount?: number;

  /**
   * Additional CSS classes
   */
  className?: string;

  /**
   * ARIA label for accessibility
   */
  ariaLabel?: string;
}

export function LoadingState({
  size = "default",
  message,
  variant = "spinner",
  skeletonCount = 3,
  className,
  ariaLabel = "Laden..."
}: LoadingStateProps) {
  const sizeClasses = {
    sm: "h-4 w-4",
    default: "h-8 w-8",
    lg: "h-12 w-12"
  };

  if (variant === "inline") {
    return (
      <span className={cn("inline-flex items-center gap-2", className)} role="status" aria-label={ariaLabel}>
        <Loader2 className={cn("animate-spin text-primary", sizeClasses.sm)} />
        {message && <span className="text-sm text-muted-foreground">{message}</span>}
      </span>
    );
  }

  if (variant === "skeleton") {
    return (
      <div className={cn("space-y-4", className)} role="status" aria-label={ariaLabel}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 bg-muted rounded-lg" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-muted rounded w-3/4" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </div>
            </div>
          </div>
        ))}
        <span className="sr-only">{message || ariaLabel}</span>
      </div>
    );
  }

  // Default spinner variant
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-3 py-8", className)}
      role="status"
      aria-label={ariaLabel}
    >
      <Loader2 className={cn("animate-spin text-primary", sizeClasses[size])} />
      {message && (
        <p className="text-sm text-muted-foreground animate-pulse">
          {message}
        </p>
      )}
      <span className="sr-only">{message || ariaLabel}</span>
    </div>
  );
}

// Convenience exports for common use cases
export const LoadingSpinner = (props: Omit<LoadingStateProps, "variant">) => (
  <LoadingState {...props} variant="spinner" />
);

export const LoadingSkeleton = (props: Omit<LoadingStateProps, "variant">) => (
  <LoadingState {...props} variant="skeleton" />
);

export const LoadingInline = (props: Omit<LoadingStateProps, "variant">) => (
  <LoadingState {...props} variant="inline" />
);
