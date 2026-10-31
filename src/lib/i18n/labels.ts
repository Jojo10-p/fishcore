import type { DictKey } from "./dictionaries";
import type { SimulatorLabels } from "@/components/site/simulator";

export function simulatorLabels(t: (k: DictKey) => string): SimulatorLabels {
  return {
    product: t("simulator.product"),
    amount: t("simulator.amount"),
    duration: t("simulator.duration"),
    rate: t("simulator.rate"),
    monthly: t("simulator.monthly"),
    monthlyWithInsurance: t("simulator.monthlyWithInsurance"),
    capital: t("simulator.capital"),
    interest: t("simulator.interest"),
    fees: t("simulator.fees"),
    insuranceTotal: t("simulator.insuranceTotal"),
    totalCost: t("simulator.totalCost"),
    totalRepaid: t("simulator.totalRepaid"),
    continue: t("simulator.continue"),
    disclaimer: t("simulator.disclaimer"),
    breakdown: t("simulator.breakdown"),
    months: t("common.month"),
  };
}
