import { HTMLAttributes, forwardRef } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  variant?: "default" | "primary" | "success" | "warning" | "danger";
  hover?: boolean;
  animated?: boolean;
}

const variantStyles = {
  default: "bg-white/80 dark:bg-gray-900/80 border-white/20 dark:border-gray-800/50",
  primary: "bg-blue-50/80 dark:bg-blue-950/80 border-blue-200/50 dark:border-blue-800/50",
  success: "bg-green-50/80 dark:bg-green-950/80 border-green-200/50 dark:border-green-800/50",
  warning: "bg-amber-50/80 dark:bg-amber-950/80 border-amber-200/50 dark:border-amber-800/50",
  danger: "bg-red-50/80 dark:bg-red-950/80 border-red-200/50 dark:border-red-800/50",
};

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ children, className, variant = "default", hover = false, animated = true, ...props }, ref) => {
    const CardComponent = animated ? motion.div : "div";

    return (
      <CardComponent
        ref={ref}
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

const gradientStyles = {
  primary: "bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700",
  success: "bg-gradient-to-br from-green-500 via-emerald-600 to-teal-700",
  purple: "bg-gradient-to-br from-purple-500 via-violet-600 to-indigo-700",
  orange: "bg-gradient-to-br from-orange-500 via-amber-600 to-red-700",
};

export const GradientCard = forwardRef<HTMLDivElement, GradientCardProps>(
  ({ children, className, gradient = "primary", animated = true, ...props }, ref) => {
    const CardComponent = animated ? motion.div : "div";

    return (
      <CardComponent
        ref={ref}
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
