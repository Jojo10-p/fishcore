import { amortizationSchedule, simulate } from "@/lib/loan-math";
import type { PublicProduct } from "@/server/services/public";

/**
 * Élément signature du site : la courbe du capital restant dû.
 * Calculée à partir d'une offre réellement publiée ; à défaut, tracé illustratif sans chiffres.
 */
export function HeroVisual({ product, currency, numberLocale, months }: { product?: PublicProduct; currency: string; numberLocale: string; months: string }) {
  const W = 420;
  const H = 260;
  const amount = product ? Math.round(Math.min(product.maxAmount, Math.max(product.minAmount, (product.minAmount + product.maxAmount) / 4)) / 100) * 100 : 20000;
  const duration = product ? Math.round((product.minDurationMonths + product.maxDurationMonths) / 2) : 48;
  const rate = product?.annualRate ?? 6;
  const rows = amortizationSchedule(amount, rate, duration);
  const pts = [{ x: 0, y: amount }, ...rows.map((r) => ({ x: r.month, y: r.remaining }))];
  const sx = (m: number) => 24 + (m / duration) * (W - 48);
  const sy = (v: number) => 24 + (1 - v / amount) * (H - 64);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const area = `${line} L${sx(duration)},${H - 40} L${sx(0)},${H - 40} Z`;
  const mid = rows[Math.floor(rows.length / 2)];
  const sim = product ? simulate({ amount, durationMonths: duration, annualRate: rate, feesFixed: product.feesFixed, feesPercent: product.feesPercent, insuranceRate: product.insuranceRate }) : null;
  const money = (n: number, d = 0) => new Intl.NumberFormat(numberLocale, { style: "currency", currency, maximumFractionDigits: d, minimumFractionDigits: d }).format(n);

  return (
    <div className="relative overflow-hidden rounded-[28px] bg-night p-6 text-white shadow-lift sm:p-8">
      <div className="grain pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-white/55">{product ? product.name : "Capital restant dû"}</p>
          <p className="mt-1 font-display text-xl font-bold">{product ? `${money(amount)} · ${duration} ${months}` : "Illustration"}</p>
        </div>
        {sim && (
          <div className="rounded-2xl border border-white/10 bg-white/[.04] px-4 py-2.5 text-right">
            <p className="text-[11px] text-white/50">Mensualité</p>
            <p className="tabular font-display font-bold text-champagne">{money(sim.monthlyTotal, 2)}</p>
          </div>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="relative mt-4 w-full" role="img" aria-label="Évolution du capital restant dû au fil des mensualités">
        <defs>
          <linearGradient id="hv-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#20B6A5" stopOpacity=".28" />
            <stop offset="1" stopColor="#20B6A5" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={24} x2={W - 24} y1={sy(amount * f)} y2={sy(amount * f)} stroke="#fff" strokeOpacity=".06" />
        ))}
        <line x1={24} x2={W - 24} y1={H - 40} y2={H - 40} stroke="#C9A96E" strokeOpacity=".5" />
        <path d={area} fill="url(#hv-fill)" className="animate-[fadein_1.2s_.5s_both]" />
        <path d={line} fill="none" stroke="#20B6A5" strokeWidth="2.5" strokeLinecap="round" pathLength={1} className="hero-draw" />
        {mid && (
          <g className="animate-[fadein_.6s_1.4s_both]">
            <line x1={sx(mid.month)} x2={sx(mid.month)} y1={sy(mid.remaining)} y2={H - 40} stroke="#C9A96E" strokeDasharray="3 4" />
            <circle cx={sx(mid.month)} cy={sy(mid.remaining)} r="5" fill="#101C35" stroke="#C9A96E" strokeWidth="2" />
            {product && (
              <text x={sx(mid.month) + 10} y={sy(mid.remaining) - 10} fill="#fff" fontSize="12" fontFamily="var(--font-sans)">
                {`Mois ${mid.month} · reste ${money(mid.remaining)}`}
              </text>
            )}
          </g>
        )}
        <text x={24} y={H - 18} fill="#fff" fillOpacity=".45" fontSize="11">1</text>
        <text x={W - 24} y={H - 18} fill="#fff" fillOpacity=".45" fontSize="11" textAnchor="end">{`${duration} ${months}`}</text>
      </svg>
      {sim && (
        <div className="relative mt-2 grid grid-cols-3 gap-3 border-t border-white/10 pt-4 text-[13px]">
          <div><p className="text-white/45">Taux annuel</p><p className="tabular mt-0.5 font-semibold">{rate.toLocaleString(numberLocale)} %</p></div>
          <div><p className="text-white/45">Intérêts</p><p className="tabular mt-0.5 font-semibold">{money(sim.totalInterest)}</p></div>
          <div><p className="text-white/45">Coût total</p><p className="tabular mt-0.5 font-semibold">{money(sim.totalCost)}</p></div>
        </div>
      )}
    </div>
  );
}
