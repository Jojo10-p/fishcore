import { cn } from "@/lib/utils";

/** Monogramme original : arc de remboursement stylisé dans un carré arrondi. */
export function Logo({ name = "Aurane Finance", invert, className, logoUrl }: { name?: string; invert?: boolean; className?: string; logoUrl?: string }) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt={name} className={cn("h-9 w-auto", className)} />;
  }
  const [first, ...rest] = name.split(" ");
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden>
        <rect width="34" height="34" rx="10" fill={invert ? "#fff" : "#101C35"} />
        <path d="M8 24c3-9 7-14 9-14s4 5 9 14" fill="none" stroke="#20B6A5" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="17" cy="10" r="2.4" fill="#C9A96E" />
      </svg>
      <span className={cn("whitespace-nowrap font-display text-[17px] font-bold tracking-tight", invert ? "text-white" : "text-night")}>
        {first}
        {rest.length > 0 && <span className={cn("font-medium", invert ? "text-white/60" : "text-ink-soft")}> {rest.join(" ")}</span>}
      </span>
    </span>
  );
}
