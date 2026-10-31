import { describe, expect, it } from "vitest";
import { monthlyPayment, simulate, amortizationSchedule } from "../src/lib/loan-math";

describe("monthlyPayment", () => {
  it("applique la formule à mensualités constantes", () => {
    // 10 000 à 6 % sur 36 mois → 304,22 (valeur de référence)
    expect(monthlyPayment(10000, 6, 36)).toBeCloseTo(304.22, 2);
  });
  it("gère le taux nul", () => {
    expect(monthlyPayment(12000, 0, 24)).toBe(500);
  });
  it("renvoie 0 pour un capital nul", () => {
    expect(monthlyPayment(0, 5, 12)).toBe(0);
  });
});

describe("simulate", () => {
  it("intègre frais et assurance dans le coût total", () => {
    const r = simulate({ amount: 10000, durationMonths: 36, annualRate: 6, feesFixed: 100, feesPercent: 1, insuranceRate: 0.3 });
    expect(r.fees).toBe(200);
    expect(r.monthlyInsurance).toBe(2.5);
    expect(r.totalInsurance).toBe(90);
    expect(r.totalInterest).toBeCloseTo(951.90, 1);
    expect(r.totalCost).toBeCloseTo(r.totalInterest + 90 + 200, 2);
    expect(r.totalRepaid).toBeCloseTo(10000 + r.totalCost, 2);
  });
  it("taux nul : aucun intérêt", () => {
    const r = simulate({ amount: 6000, durationMonths: 12, annualRate: 0 });
    expect(r.totalInterest).toBe(0);
    expect(r.monthlyTotal).toBe(500);
  });
});

describe("amortizationSchedule", () => {
  it("rembourse intégralement le capital", () => {
    const rows = amortizationSchedule(20000, 5, 48);
    expect(rows).toHaveLength(48);
    expect(rows.at(-1)!.remaining).toBeCloseTo(0, 0);
    const principal = rows.reduce((s, r) => s + r.principal, 0);
    expect(principal).toBeCloseTo(20000, 0);
  });
});
