/**
 * Empty State Component
 *
 * Provides consistent empty state UI across the application
 * with icons, titles, descriptions, and optional actions
 */

import { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /**
   * Icon to display
   */
  icon: LucideIcon;

  /**
   * Main title
   */
  title: string;

  /**
   * Optional description/subtitle
   */
  description?: string;

  /**
   * Optional action button
   */
  action?: {
    label: string;
    onClick: () => void;
    variant?: "default" | "outline" | "secondary" | "ghost" | "link";
  };

  /**
   * Optional secondary action
   */
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };

  /**
   * Additional CSS classes
   */
  className?: string;

  /**
   * Icon color class
   * @default "text-muted-foreground"
   */
  iconColorClass?: string;

  /**
   * Size variant
   * @default "default"
   */
  size?: "sm" | "default" | "lg";
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  iconColorClass = "text-muted-foreground",
  size = "default"
}: EmptyStateProps) {
  const sizeClasses = {
    sm: {
      container: "py-6",
      icon: "h-8 w-8",
      title: "text-base",
      description: "text-xs",
    },
    default: {
      container: "py-12",
      icon: "h-12 w-12",
      title: "text-lg",
      description: "text-sm",
    },
    lg: {
      container: "py-16",
      icon: "h-16 w-16",
      title: "text-xl",
      description: "text-base",
    }
  }[size];

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        sizeClasses.container,
        className
      )}
    >
      <Icon className={cn(sizeClasses.icon, iconColorClass, "mb-4")} />

      <h3 className={cn("font-semibold text-foreground", sizeClasses.title)}>
        {title}
      </h3>

      {description && (
        <p className={cn("text-muted-foreground mt-2 max-w-md", sizeClasses.description)}>
          {description}
        </p>
      )}

      {(action || secondaryAction) && (
        <div className="flex gap-3 mt-6">
          {action && (
            <Button
              onClick={action.onClick}
              variant={action.variant || "default"}
            >
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              onClick={secondaryAction.onClick}
              variant="outline"
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Card-based empty state with border
 */
export function EmptyStateCard(props: EmptyStateProps) {
  return (
    <div className="border-2 border-dashed border-muted rounded-lg">
      <EmptyState {...props} />
    </div>
  );
}
