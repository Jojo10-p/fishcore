"use client";

import { useEffect, useState } from "react";
import { boutiqueIcon } from "@/lib/boutiques";

/**
 * Étape 1 avant le code : « Huile de moteur » ou « Huile d'arachide ».
 * Avec une seule boutique, rien à choisir (elle est retenue d'office).
 */
export function BoutiquePicker({ value, onChange, onLoaded }: { value: string | null; onChange: (id: string, name: string) => void; onLoaded?: (count: number) => void }) {
  const [list, setList] = useState<Array<{ id: string; name: string }> | null>(null);
  useEffect(() => {
    fetch("/api/public/boutiques", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const l = (j.data ?? []) as Array<{ id: string; name: string }>;
        setList(l);
        onLoaded?.(l.length);
        if (l.length === 1) onChange(l[0].id, l[0].name);
      })
      .catch(() => {
        setList([]);
        onLoaded?.(0);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chargé une fois
  }, []);
  if (!list || list.length <= 1) return null;
  return (
    <div className="mb-6">
      <p className="mb-2 text-center text-sm font-medium text-gray-700">Dans quelle boutique travaillez-vous ?</p>
      <div className="grid grid-cols-2 gap-3">
        {list.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onChange(b.id, b.name)}
            className={`flex flex-col items-center gap-1 rounded-2xl border-2 px-3 py-4 text-sm font-semibold transition ${
              value === b.id ? "border-blue-600 bg-blue-50 text-blue-900" : "border-gray-200 text-gray-700 hover:border-gray-300"
            }`}
          >
            <span className="text-3xl" aria-hidden>
              {boutiqueIcon(b.name)}
            </span>
            {b.name}
          </button>
        ))}
      </div>
    </div>
  );
}
