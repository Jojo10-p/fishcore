import { cn } from "@/lib/utils";

export function Surface({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-night/[.07] bg-white", className)} {...p} />;
}

export function SectionHeading({ label, title, text, className, invert }: { label?: string; title: string; text?: string; className?: string; invert?: boolean }) {
  return (
    <div className={cn("max-w-2xl", className)}>
      {label && <p className={cn("mb-3 text-sm font-semibold", invert ? "text-champagne" : "text-teal-700")}>{label}</p>}
      <h2 className={cn("text-3xl font-bold leading-[1.1] sm:text-[2.6rem]", invert && "text-white")}>{title}</h2>
      {text && <p className={cn("mt-4 text-[17px] leading-relaxed", invert ? "text-white/70" : "text-ink-soft")}>{text}</p>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("relative overflow-hidden rounded-lg bg-mist before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-white/60 before:to-transparent", className)} />;
}

export function EmptyState({ icon, title, text, action }: { icon?: React.ReactNode; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-mist text-slate2">{icon}</div>}
      <p className="font-display text-lg font-semibold">{title}</p>
      {text && <p className="mt-1.5 max-w-sm text-sm text-ink-soft">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
