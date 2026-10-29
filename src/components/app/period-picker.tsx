"use client";

import { Input, Select } from "@/components/ui";

// Filtres temporels du cahier §15.2 : aujourd'hui, hier, semaine en cours,
// semaine précédente, mois en cours, mois précis, trimestre, année, période libre.

export type PresetKey = "today" | "yesterday" | "week" | "lastWeek" | "month" | "pickMonth" | "quarter" | "year" | "custom";

export interface Period {
  preset: PresetKey;
  from: string; // AAAA-MM-JJ
  to: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** AAAA-MM-JJ → JJ/MM/AAAA, sans passer par un fuseau horaire. */
export const frDate = (isoDate: string) => isoDate.split("-").reverse().join("/");
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Calcule les bornes d'un préréglage (semaine du lundi au dimanche). */
export function presetPeriod(preset: PresetKey, base = new Date(), month?: string): Period {
  const today = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  switch (preset) {
    case "today":
      return { preset, from: iso(today), to: iso(today) };
    case "yesterday": {
      const y = addDays(today, -1);
      return { preset, from: iso(y), to: iso(y) };
    }
    case "week":
      return { preset, from: iso(monday), to: iso(today) };
    case "lastWeek":
      return { preset, from: iso(addDays(monday, -7)), to: iso(addDays(monday, -1)) };
    case "month":
      return { preset, from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
    case "pickMonth": {
      const [y, m] = (month ?? iso(today).slice(0, 7)).split("-").map(Number);
      const last = new Date(y, m, 0);
      return { preset, from: `${y}-${pad(m)}-01`, to: iso(last < today ? last : today) };
    }
    case "quarter": {
      const q = Math.floor(today.getMonth() / 3) * 3;
      return { preset, from: iso(new Date(today.getFullYear(), q, 1)), to: iso(today) };
    }
    case "year":
      return { preset, from: `${today.getFullYear()}-01-01`, to: iso(today) };
    case "custom":
      return { preset, from: iso(addDays(today, -6)), to: iso(today) };
  }
}

const LABELS: Record<PresetKey, string> = {
  today: "Aujourd'hui",
  yesterday: "Hier",
  week: "Cette semaine",
  lastWeek: "Semaine précédente",
  month: "Ce mois",
  pickMonth: "Un mois précis",
  quarter: "Ce trimestre",
  year: "Cette année",
  custom: "Période personnalisée",
};

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Période" value={value.preset} onChange={(e) => onChange(presetPeriod(e.target.value as PresetKey))} className="w-auto">
        {(Object.keys(LABELS) as PresetKey[]).map((k) => (
          <option key={k} value={k}>
            {LABELS[k]}
          </option>
        ))}
      </Select>
      {value.preset === "pickMonth" && (
        <Input type="month" aria-label="Mois" value={value.from.slice(0, 7)} onChange={(e) => e.target.value && onChange(presetPeriod("pickMonth", new Date(), e.target.value))} className="w-auto" />
      )}
      {value.preset === "custom" && (
        <>
          <Input type="date" aria-label="Du" value={value.from} max={value.to} onChange={(e) => onChange({ ...value, from: e.target.value })} className="w-auto" />
          <Input type="date" aria-label="Au" value={value.to} min={value.from} onChange={(e) => onChange({ ...value, to: e.target.value })} className="w-auto" />
        </>
      )}
      {value.preset !== "custom" && value.preset !== "pickMonth" && (
        <span className="text-xs text-gray-500">
          {value.from === value.to ? frDate(value.from) : `du ${frDate(value.from)} au ${frDate(value.to)}`}
        </span>
      )}
    </div>
  );
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Espèces",
  MOBILE_MONEY: "Mobile money",
  CARD: "Carte",
  TRANSFER: "Virement",
  MIXED: "Mixte",
};
