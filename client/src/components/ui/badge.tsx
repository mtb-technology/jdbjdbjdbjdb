import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        // Primary: Koningsblauw
        default:
          "border-transparent bg-primary text-primary-foreground shadow-sm hover:bg-jdb-blue-hover",
        // Secondary: Lichtgrijs
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-muted",
        // Destructive/Danger: Rood
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        // Success: Groen
        success:
          "border-transparent bg-jdb-success text-white shadow-sm hover:bg-jdb-success/90",
        // Warning: Amber/Goud
        warning:
          "border-transparent bg-jdb-warning text-white shadow-sm hover:bg-jdb-warning/90",
        // Outline: Border only
        outline: "text-foreground border-border hover:bg-muted",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
