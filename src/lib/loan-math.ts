/**
 * Calculs de simulation — amortissement à mensualités constantes.
 * M = C × [i(1+i)^n] / [(1+i)^n − 1], avec i = taux annuel / 12.
 * Cas du taux nul : M = C / n.
 */
export interface SimulationInput {
  amount: number;
  durationMonths: number;
  annualRate: number; // en %
  feesFixed?: number;
  feesPercent?: number; // en % du capital
  insuranceRate?: number; // en % annuel du capital initial
}

export interface SimulationResult {
  capital: number;
  durationMonths: number;
  monthlyPayment: number; // hors assurance
  monthlyInsurance: number;
  monthlyTotal: number; // assurance comprise
  totalInterest: number;
  totalInsurance: number;
  fees: number;
  totalCost: number; // intérêts + assurance + frais
  totalRepaid: number; // capital + coût total
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function monthlyPayment(capital: number, annualRate: number, n: number): number {
  if (capital <= 0 || n <= 0) return 0;
  const i = annualRate / 100 / 12;
  if (i === 0) return capital / n;
  const f = Math.pow(1 + i, n);
  return (capital * (i * f)) / (f - 1);
}

export function simulate(input: SimulationInput): SimulationResult {
  const C = Math.max(0, input.amount);
  const n = Math.max(1, Math.round(input.durationMonths));
  const M = monthlyPayment(C, Math.max(0, input.annualRate), n);
  const monthlyInsurance = (C * Math.max(0, input.insuranceRate ?? 0)) / 100 / 12;
  const fees = Math.max(0, input.feesFixed ?? 0) + (C * Math.max(0, input.feesPercent ?? 0)) / 100;
  const totalInterest = M * n - C;
  const totalInsurance = monthlyInsurance * n;
  const totalCost = totalInterest + totalInsurance + fees;
  return {
    capital: round2(C),
    durationMonths: n,
    monthlyPayment: round2(M),
    monthlyInsurance: round2(monthlyInsurance),
    monthlyTotal: round2(M + monthlyInsurance),
    totalInterest: round2(totalInterest),
    totalInsurance: round2(totalInsurance),
    fees: round2(fees),
    totalCost: round2(totalCost),
    totalRepaid: round2(C + totalCost),
  };
}

/** Tableau d'amortissement (utilisé pour les graphiques du simulateur). */
export function amortizationSchedule(capital: number, annualRate: number, n: number) {
  const i = annualRate / 100 / 12;
  const M = monthlyPayment(capital, annualRate, n);
  let remaining = capital;
  const rows: { month: number; interest: number; principal: number; remaining: number }[] = [];
  for (let m = 1; m <= n; m++) {
    const interest = remaining * i;
    const principal = M - interest;
    remaining = Math.max(0, remaining - principal);
    rows.push({ month: m, interest: round2(interest), principal: round2(principal), remaining: round2(remaining) });
  }
  return rows;
}
