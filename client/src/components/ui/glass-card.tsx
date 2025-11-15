import { HTMLAttributes, forwardRef } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  variant?: "default" | "primary" | "success" | "warning" | "danger";
  hover?: boolean;
  animated?: boolean;
}

// JdB Brand-aligned glassmorphism variants
const variantStyles = {
  default: "bg-white/90 dark:bg-jdb-panel/90 border-jdb-border/30 dark:border-jdb-border/20",
  primary: "bg-jdb-blue-light/80 dark:bg-jdb-blue-primary/10 border-jdb-blue-primary/30 dark:border-jdb-blue-primary/20",
  success: "bg-green-50/80 dark:bg-green-950/10 border-jdb-success/30 dark:border-jdb-success/20",
  warning: "bg-amber-50/80 dark:bg-amber-950/10 border-jdb-warning/30 dark:border-jdb-warning/20",
  danger: "bg-red-50/80 dark:bg-red-950/10 border-jdb-danger/30 dark:border-jdb-danger/20",
};

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ children, className, variant = "default", hover = false, animated = true, ...props }, ref) => {
    const CardComponent = (animated ? motion.div : "div") as any;

    return (
      <CardComponent
        ref={ref as any}
        className={cn(
          // Base styles with glassmorphism
          "rounded-xl border backdrop-blur-xl shadow-lg",
          "transition-all duration-300",
          variantStyles[variant],
          hover && "hover:shadow-xl hover:-translate-y-1 cursor-pointer",
          className
        )}
        {...(animated && {
          initial: { opacity: 0, y: 20 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.3 }
        })}
        {...props}
      >
        {children}
      </CardComponent>
    );
  }
);

GlassCard.displayName = "GlassCard";

interface GradientCardProps extends HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  gradient?: "primary" | "success" | "purple" | "orange";
  animated?: boolean;
}

// JdB Brand-aligned gradients (subtle, professional)
const gradientStyles = {
  primary: "bg-gradient-to-br from-jdb-blue-primary via-blue-600 to-indigo-700",
  success: "bg-gradient-to-br from-jdb-success via-green-600 to-emerald-700",
  purple: "bg-gradient-to-br from-purple-500 via-violet-600 to-indigo-700",
  orange: "bg-gradient-to-br from-jdb-gold via-amber-600 to-orange-700",
};

export const GradientCard = forwardRef<HTMLDivElement, GradientCardProps>(
  ({ children, className, gradient = "primary", animated = true, ...props }, ref) => {
    const CardComponent = (animated ? motion.div : "div") as any;

    return (
      <CardComponent
        ref={ref as any}
        className={cn(
          "rounded-xl shadow-2xl text-white overflow-hidden",
          "transition-all duration-300",
          "hover:shadow-3xl hover:scale-[1.02]",
          gradientStyles[gradient],
          className
        )}
        {...(animated && {
          initial: { opacity: 0, scale: 0.95 },
          animate: { opacity: 1, scale: 1 },
          transition: { duration: 0.3 }
        })}
        {...props}
      >
        <div className="relative z-10">{children}</div>
        {/* Animated gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
      </CardComponent>
    );
  }
);

GradientCard.displayName = "GradientCard";
