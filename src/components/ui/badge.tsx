import { cn } from "@/lib/utils";

const tones = {
  info: "bg-[#EAF1FE] text-[#2459C9]",
  teal: "bg-teal-50 text-teal-700",
  amber: "bg-[#FDF3E2] text-[#9A6412]",
  slate: "bg-mist text-slate2",
  green: "bg-[#E7F6EC] text-[#167A3B]",
  red: "bg-[#FCEBEB] text-[#B03030]",
  muted: "bg-night/[.06] text-ink-soft",
  champagne: "bg-champagne-50 text-champagne-700",
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = "muted", children, className, dot = true }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium", tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />}
      {children}
    </span>
  );
}
