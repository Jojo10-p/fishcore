"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { Input, Select } from "@/components/ui/field";

export interface FilterDef { name: string; label: string; type: "select" | "date"; options?: { value: string; label: string }[] }

/** Barre de recherche instantanée + filtres synchronisés avec l'URL (partageable, compatible retour arrière). */
export function FilterBar({ filters, placeholder = "Rechercher…" }: { filters: FilterDef[]; placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [pending, start] = useTransition();

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  useEffect(() => {
    if (q === (sp.get("q") ?? "")) return;
    const t = setTimeout(() => update({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = filters.some((f) => sp.get(f.name)) || !!sp.get("q");
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-night/[.07] bg-white p-3 lg:flex-row lg:items-center">
      <div className="relative flex-1">
        {pending ? <Loader2 className="absolute left-3.5 top-3.5 h-4 w-4 animate-spin text-ink-faint" /> : <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-ink-faint" />}
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="pl-10" aria-label="Rechercher" type="search" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {filters.map((f) =>
          f.type === "select" ? (
            <Select key={f.name} aria-label={f.label} value={sp.get(f.name) ?? ""} onChange={(e) => update({ [f.name]: e.target.value })} className="sm:w-auto">
              <option value="">{f.label}</option>
              {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          ) : (
            <label key={f.name} className="flex items-center gap-2 text-sm text-ink-faint">
              <span className="sr-only sm:not-sr-only">{f.label}</span>
              <Input type="date" value={sp.get(f.name) ?? ""} onChange={(e) => update({ [f.name]: e.target.value })} className="sm:w-40" aria-label={f.label} />
            </label>
          ),
        )}
        {active && (
          <button type="button" onClick={() => { setQ(""); start(() => router.replace(pathname)); }} className="inline-flex h-11 items-center gap-1 rounded-xl px-3 text-sm text-ink-soft hover:bg-mist">
            <X className="h-4 w-4" />Réinitialiser
          </button>
        )}
      </div>
    </div>
  );
}
