"use client";

import { Input } from "@/components/ui";

/** Saisie de plusieurs numéros : le premier est le principal. */
export function PhonesInput({ value, onChange, max = 6 }: { value: string[]; onChange: (v: string[]) => void; max?: number }) {
  const list = value.length ? value : [""];
  const set = (i: number, v: string) => onChange(list.map((p, j) => (j === i ? v : p)));
  return (
    <div className="space-y-2">
      {list.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input type="tel" value={p} onChange={(e) => set(i, e.target.value)} placeholder={i === 0 ? "Numéro principal (+229 …)" : "Autre numéro"} />
          {list.length > 1 && (
            <button type="button" aria-label="Retirer ce numéro" className="shrink-0 rounded-lg px-2 py-1 text-gray-400 hover:bg-gray-100 hover:text-red-600" onClick={() => onChange(list.filter((_, j) => j !== i))}>
              ✕
            </button>
          )}
        </div>
      ))}
      {list.length < max && (
        <button type="button" className="text-sm font-medium text-blue-600 hover:underline" onClick={() => onChange([...list, ""])}>
          + Ajouter un numéro
        </button>
      )}
    </div>
  );
}

/** Pour l'API : { phone, otherPhones } à partir de la liste saisie. */
export function phonesPayload(list: string[]) {
  const clean = list.map((p) => p.trim()).filter(Boolean);
  return { phone: clean[0] ?? "", otherPhones: clean.slice(1) };
}
