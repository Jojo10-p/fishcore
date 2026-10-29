"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";

export interface PickedCustomer {
  id: string;
  name: string;
  phone: string | null;
}

/**
 * Recherche d'un client (nom, téléphone, IFU) avec création rapide.
 * Utilisé à la caisse (facture au nom du client) et pour les devis.
 */
export function CustomerPicker({
  customer,
  setCustomer,
  placeholder = "Client (nom ou téléphone)",
}: {
  customer: PickedCustomer | null;
  setCustomer: (c: PickedCustomer | null) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedCustomer[]>([]);
  const [creating, setCreating] = useState(false);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (customer) return;
    const t = setTimeout(() => {
      apiGet<{ data: PickedCustomer[] }>(`/api/customers?search=${encodeURIComponent(query)}`)
        .then((r) => setResults(r.data))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query, customer]);

  if (customer) {
    return (
      <div className="flex items-center justify-between rounded-lg bg-blue-50 px-3 py-2 text-sm">
        <span>
          Client : <strong>{customer.name}</strong> {customer.phone && <span className="text-gray-500">({customer.phone})</span>}
        </span>
        <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => setCustomer(null)}>
          Changer
        </button>
      </div>
    );
  }

  const create = async () => {
    setError(null);
    try {
      const r = await apiSend<{ data: PickedCustomer }>("/api/customers", { name: query.trim(), phone: phone || undefined });
      setCustomer(r.data);
      setCreating(false);
      setPhone("");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 p-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        aria-label="Rechercher un client"
        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
      />
      {results.length > 0 && (
        <ul className="max-h-32 overflow-y-auto text-sm">
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-gray-100" onClick={() => setCustomer(c)}>
                {c.name} {c.phone && <span className="text-gray-500">· {c.phone}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim().length >= 2 &&
        (creating ? (
          <div className="flex gap-2">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Téléphone"
              aria-label="Téléphone du nouveau client"
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
            <button type="button" onClick={create} className="rounded-lg bg-blue-600 px-3 text-sm text-white">
              Créer
            </button>
          </div>
        ) : (
          <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setCreating(true)}>
            + Nouveau client « {query.trim()} »
          </button>
        ))}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
