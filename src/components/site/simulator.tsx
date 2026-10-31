"use client";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { simulate, amortizationSchedule } from "@/lib/loan-math";
import type { PublicProduct } from "@/server/services/public";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SimulatorLabels {
  product: string;
  amount: string;
  duration: string;
  rate: string;
  monthly: string;
  monthlyWithInsurance: string;
  capital: string;
  interest: string;
  fees: string;
  insuranceTotal: string;
  totalCost: string;
  totalRepaid: string;
  continue: string;
  disclaimer: string;
  breakdown: string;
  months: string;
}

interface Props {
  products: PublicProduct[];
  currency: string;
  numberLocale: string;
  labels: SimulatorLabels;
  initial?: { slug?: string; amount?: number; duration?: number };
  variant?: "full" | "compact";
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function stepFor(max: number) {
  if (max <= 20000) return 100;
  if (max <= 100000) return 500;
  if (max <= 500000) return 1000;
  return 5000;
}

export function Simulator({ products, currency, numberLocale, labels, initial, variant = "full" }: Props) {
  const uid = useId();
  const start = products.find((p) => p.slug === initial?.slug) ?? products[0];
  const [productId, setProductId] = useState(start.id);
  const product = products.find((p) => p.id === productId) ?? start;
  const [amount, setAmount] = useState(() => clamp(initial?.amount ?? (Math.round((start.minAmount + start.maxAmount) / 4 / 100) * 100 || start.minAmount), start.minAmount, start.maxAmount));
  const [duration, setDuration] = useState(() => clamp(initial?.duration ?? Math.round((start.minDurationMonths + start.maxDurationMonths) / 2), start.minDurationMonths, start.maxDurationMonths));

  const money = (n: number, d = 0) => new Intl.NumberFormat(numberLocale, { style: "currency", currency, maximumFractionDigits: d, minimumFractionDigits: d }).format(n);

  const selectProduct = (id: string) => {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    setProductId(id);
    setAmount((a) => clamp(a, p.minAmount, p.maxAmount));
    setDuration((d) => clamp(d, p.minDurationMonths, p.maxDurationMonths));
  };

  const r = useMemo(
    () => simulate({ amount, durationMonths: duration, annualRate: product.annualRate, feesFixed: product.feesFixed, feesPercent: product.feesPercent, insuranceRate: product.insuranceRate }),
    [amount, duration, product],
  );
  const schedule = useMemo(() => (variant === "full" ? amortizationSchedule(amount, product.annualRate, duration) : []), [amount, duration, product, variant]);

  const pctAmount = ((amount - product.minAmount) / Math.max(1, product.maxAmount - product.minAmount)) * 100;
  const pctDuration = ((duration - product.minDurationMonths) / Math.max(1, product.maxDurationMonths - product.minDurationMonths)) * 100;
  const parts = [
    { label: labels.capital, value: r.capital, color: "#101C35" },
    { label: labels.interest, value: Math.max(0, r.totalInterest), color: "#20B6A5" },
    { label: labels.insuranceTotal, value: r.totalInsurance, color: "#C9A96E" },
    { label: labels.fees, value: r.fees, color: "#8592A8" },
  ].filter((p) => p.value > 0);
  const href = `/demande?produit=${encodeURIComponent(product.slug)}&montant=${amount}&duree=${duration}`;

  return (
    <div className="grid overflow-hidden rounded-[28px] border border-night/[.07] bg-white shadow-soft lg:grid-cols-[1.1fr_.9fr]">
      {/* Paramètres */}
      <div className="p-6 sm:p-9">
        <fieldset>
          <legend className="mb-3 text-sm font-medium">{labels.product}</legend>
          <div className="flex flex-wrap gap-2">
            {products.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => selectProduct(p.id)}
                aria-pressed={p.id === productId}
                className={cn("rounded-full border px-4 py-2 text-sm transition", p.id === productId ? "border-night bg-night text-white" : "border-night/12 text-ink-soft hover:border-night/40 hover:text-ink")}
              >
                {p.name}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-9">
          <div className="flex items-end justify-between gap-4">
            <label htmlFor={`${uid}-amount`} className="text-sm font-medium">{labels.amount}</label>
            <div className="flex items-center rounded-xl border border-night/12 px-3 focus-within:border-teal focus-within:ring-4 focus-within:ring-teal/15">
              <input
                type="number"
                inputMode="numeric"
                aria-label={labels.amount}
                className="tabular w-28 bg-transparent py-2 text-right font-display text-lg font-bold outline-none"
                value={amount}
                min={product.minAmount}
                max={product.maxAmount}
                step={stepFor(product.maxAmount)}
                onChange={(e) => setAmount(Number(e.target.value) || 0)}
                onBlur={() => setAmount((a) => clamp(a, product.minAmount, product.maxAmount))}
              />
              <span className="ml-1 text-sm text-ink-faint">{currency}</span>
            </div>
          </div>
          <input
            id={`${uid}-amount`}
            type="range"
            className="range mt-4"
            style={{ ["--pct" as string]: `${pctAmount}%` }}
            min={product.minAmount}
            max={product.maxAmount}
            step={stepFor(product.maxAmount)}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            aria-valuetext={money(amount)}
          />
          <div className="mt-2 flex justify-between text-xs text-ink-faint tabular"><span>{money(product.minAmount)}</span><span>{money(product.maxAmount)}</span></div>
        </div>

        <div className="mt-8">
          <div className="flex items-end justify-between gap-4">
            <label htmlFor={`${uid}-duration`} className="text-sm font-medium">{labels.duration}</label>
            <div className="flex items-center rounded-xl border border-night/12 px-3 focus-within:border-teal focus-within:ring-4 focus-within:ring-teal/15">
              <input
                type="number"
                inputMode="numeric"
                aria-label={labels.duration}
                className="tabular w-16 bg-transparent py-2 text-right font-display text-lg font-bold outline-none"
                value={duration}
                min={product.minDurationMonths}
                max={product.maxDurationMonths}
                onChange={(e) => setDuration(Number(e.target.value) || 0)}
                onBlur={() => setDuration((d) => clamp(d, product.minDurationMonths, product.maxDurationMonths))}
              />
              <span className="ml-1 text-sm text-ink-faint">{labels.months}</span>
            </div>
          </div>
          <input
            id={`${uid}-duration`}
            type="range"
            className="range mt-4"
            style={{ ["--pct" as string]: `${pctDuration}%` }}
            min={product.minDurationMonths}
            max={product.maxDurationMonths}
            step={1}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            aria-valuetext={`${duration} ${labels.months}`}
          />
          <div className="mt-2 flex justify-between text-xs text-ink-faint tabular"><span>{product.minDurationMonths} {labels.months}</span><span>{product.maxDurationMonths} {labels.months}</span></div>
        </div>

        <div className="mt-8 flex items-center justify-between rounded-2xl bg-paper px-4 py-3.5 text-sm">
          <span className="text-ink-soft">{labels.rate}</span>
          <span className="tabular font-display font-bold">{product.annualRate.toLocaleString(numberLocale, { maximumFractionDigits: 3 })} %</span>
        </div>

        {variant === "full" && schedule.length > 0 && <ScheduleChart schedule={schedule} money={money} months={labels.months} />}
      </div>

      {/* Résultat */}
      <div className="relative flex flex-col bg-night p-6 text-white sm:p-9">
        <div className="grain pointer-events-none absolute inset-0 opacity-70" aria-hidden />
        <div className="relative">
          <p className="text-sm text-white/60">{labels.monthly}</p>
          <p className="tabular mt-2 font-display text-[2.75rem] font-extrabold leading-none sm:text-5xl" aria-live="polite">{money(r.monthlyTotal, 2)}</p>
          {r.monthlyInsurance > 0 && <p className="mt-2 text-sm text-white/55">{labels.monthlyWithInsurance} {money(r.monthlyInsurance, 2)}</p>}

          <div className="rule-champagne my-7" />
          <dl className="space-y-3.5 text-[15px]">
            {[
              [labels.capital, money(r.capital)],
              [labels.interest, money(r.totalInterest, 2)],
              ...(r.totalInsurance > 0 ? [[labels.insuranceTotal, money(r.totalInsurance, 2)]] : []),
              ...(r.fees > 0 ? [[labels.fees, money(r.fees, 2)]] : []),
              [labels.totalCost, money(r.totalCost, 2)],
              [labels.duration, `${r.durationMonths} ${labels.months}`],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4">
                <dt className="text-white/60">{k}</dt>
                <dd className="tabular font-semibold">{v}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-4 border-t border-white/10 pt-3.5">
              <dt className="text-white/80">{labels.totalRepaid}</dt>
              <dd className="tabular font-display text-lg font-bold text-champagne">{money(r.totalRepaid, 2)}</dd>
            </div>
          </dl>

          <div className="mt-7">
            <p className="mb-2 text-xs text-white/50">{labels.breakdown}</p>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-white/10" role="img" aria-label={parts.map((p) => `${p.label} ${money(p.value)}`).join(", ")}>
              {parts.map((p) => (
                <span key={p.label} style={{ width: `${(p.value / r.totalRepaid) * 100}%`, background: p.color === "#101C35" ? "#F7F8FA" : p.color }} className="transition-[width] duration-500" />
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-white/60">
              {parts.map((p) => (
                <li key={p.label} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: p.color === "#101C35" ? "#F7F8FA" : p.color }} />
                  {p.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="relative mt-auto pt-8">
          <Link href={href} className={buttonVariants({ variant: "teal", size: "lg", className: "w-full" })}>{labels.continue}</Link>
          <p className="mt-4 flex gap-2 text-xs leading-relaxed text-white/50"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{labels.disclaimer}</p>
        </div>
      </div>
    </div>
  );
}

function ScheduleChart({ schedule, money, months }: { schedule: { month: number; interest: number; principal: number; remaining: number }[]; money: (n: number) => string; months: string }) {
  const W = 560;
  const H = 150;
  const max = Math.max(...schedule.map((s) => s.principal + s.interest));
  const n = schedule.length;
  const bw = W / n;
  return (
    <figure className="mt-8">
      <figcaption className="mb-3 flex items-center justify-between text-xs text-ink-faint">
        <span>Composition de chaque mensualité</span>
        <span className="flex gap-3">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-night" />Capital</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-teal" />Intérêts</span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full" preserveAspectRatio="none" role="img" aria-label={`Échéancier sur ${n} ${months}`}>
        {schedule.map((s, i) => {
          const hp = (s.principal / max) * (H - 6);
          const hi = (s.interest / max) * (H - 6);
          return (
            <g key={s.month}>
              <title>{`Mois ${s.month} — capital ${money(s.principal)}, intérêts ${money(s.interest)}`}</title>
              <rect x={i * bw + bw * 0.15} y={H - hp} width={bw * 0.7} height={hp} fill="#101C35" />
              <rect x={i * bw + bw * 0.15} y={H - hp - hi} width={bw * 0.7} height={hi} fill="#20B6A5" />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-ink-faint"><span>1</span><span>{n} {months}</span></div>
    </figure>
  );
}
