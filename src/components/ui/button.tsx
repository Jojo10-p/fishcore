import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-[background,color,box-shadow,transform] duration-200 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px",
  {
    variants: {
      variant: {
        primary: "bg-night text-white hover:bg-night-700 shadow-[0_8px_20px_-10px_rgba(16,28,53,.6)]",
        teal: "bg-teal text-night hover:bg-teal-600 hover:text-white",
        outline: "border border-night/15 bg-white text-ink hover:border-night/40",
        ghost: "text-ink-soft hover:bg-mist hover:text-ink",
        light: "bg-white text-night hover:bg-paper",
        "outline-light": "border border-white/25 text-white hover:bg-white/10",
        danger: "bg-[#C93B3B] text-white hover:bg-[#B03030]",
        link: "rounded-none p-0 h-auto text-teal-700 underline-offset-4 hover:underline",
      },
      size: { sm: "h-9 px-4 text-sm", md: "h-11 px-5 text-[15px]", lg: "h-13 px-7 text-base py-3.5", icon: "h-9 w-9" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, children, disabled, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
    {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
    {children}
  </button>
));
Button.displayName = "Button";
