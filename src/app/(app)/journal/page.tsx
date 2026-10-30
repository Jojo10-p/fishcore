"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { PeriodPicker, presetPeriod, type Period } from "@/components/app/period-picker";
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { apiGet, errorMessage } from "@/lib/client/api";
import { AUDIT_LABELS } from "@/lib/audit-labels";

interface Entry {
  id: string;
  serverTimestamp: string;
  deviceTimestamp: string | null;
  eventType: string;
  result: string | null;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  oldValues: unknown;
  newValues: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  user: { id: string; firstName: string; lastName: string; role: string } | null;
  center: { id: string; name: string; code: string } | null;
}
interface Res {
  data: Entry[];
  nextCursor: string | null;
  users: Array<{ id: string; firstName: string; lastName: string }>;
}

const GROUPS = [...new Set(Object.values(AUDIT_LABELS).map((v) => v.group))];
const fmt = (d: string) => new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" });

/** Résumé lisible des valeurs enregistrées (numéro, montants, motif…). */
const MONEY_KEYS: Array<[string, string]> = [
  ["totalAmount", "montant"],
  ["amount", "montant"],
  ["value", "valeur"],
  ["receivedValue", "reçu"],
  ["gapValue", "écart"],
  ["missingValue", "manquant"],
];
function summary(e: Entry): string {
  const v = (e.newValues ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of ["number", "saleNumber"]) if (v[k]) parts.push(String(v[k]));
  for (const [k, label] of MONEY_KEYS) {
    const n = Number(v[k]);
    if (v[k] !== undefined && v[k] !== null && Number.isFinite(n) && (n !== 0 || k === "gapValue")) parts.push(`${label} ${n.toLocaleString("fr-FR")} F`);
  }
  if (v.for) parts.push(`pour ${String(v.for)}`);
  for (const k of ["email", "via", "logo"]) if (v[k]) parts.push(String(v[k]));
  return [...new Set(parts)].slice(0, 4).join(" · ");
}

export default function JournalPage() {
  const { session } = useSession();
  const [period, setPeriod] = useState<Period>(() => presetPeriod("week"));
  const [group, setGroup] = useState("");
  const [userId, setUserId] = useState("");
  const [result, setResult] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [users, setUsers] = useState<Res["users"]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chain, setChain] = useState<{ isValid: boolean; totalChecked: number; corruptedAt?: string } | null | "loading">(null);

  const query = useMemo(() => {
    const p = new URLSearchParams({ from: period.from, to: period.to });
    if (group) p.set("eventType", Object.entries(AUDIT_LABELS).filter(([, v]) => v.group === group).map(([k]) => k).join(","));
    if (userId) p.set("userId", userId);
    if (result) p.set("result", result);
    if (q.trim()) p.set("q", q.trim());
    return p.toString();
  }, [period, group, userId, result, q]);

  const load = useCallback(
    async (after?: string) => {
      try {
        const res = await apiGet<Res>(`/api/audit?${query}${after ? `&cursor=${after}` : ""}`);
        setRows((cur) => (after && cur ? [...cur, ...res.data] : res.data));
        setCursor(res.nextCursor);
        setUsers(res.users);
        setError(null);
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [query]
  );

  useEffect(() => {
    const t = setTimeout(() => {
      setRows(null);
      void load();
    }, 250);
    return () => clearTimeout(t);
  }, [load]);

  const verify = async () => {
    setChain("loading");
    try {
      const res = await apiGet<{ data: { isValid: boolean; totalChecked: number; corruptedAt?: string } }>("/api/audit/verify");
      setChain(res.data);
    } catch (e) {
      setError(errorMessage(e));
      setChain(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Journal d'audit"
        description="Toutes les opérations sensibles, horodatées et signées : ventes, annulations, stock, caisse, droits. Rien ne peut y être modifié ni effacé."
        actions={
          <Button variant="secondary" onClick={verify} loading={chain === "loading"}>
            🔐 Vérifier l&apos;intégrité
          </Button>
        }
      />
      {error && <Alert>{error}</Alert>}
      {chain && chain !== "loading" && (
        <Alert tone={chain.isValid ? "green" : "red"}>
          {chain.isValid
            ? `Journal intact : ${chain.totalChecked.toLocaleString("fr-FR")} entrée(s) vérifiée(s), aucune modification détectée.`
            : `Altération détectée à l'entrée ${chain.corruptedAt} : contactez l'assistance.`}
        </Alert>
      )}

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <PeriodPicker value={period} onChange={setPeriod} />
          <Select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Domaine">
            <option value="">Tous les domaines</option>
            {GROUPS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
          <Select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Utilisateur">
            <option value="">Tous les utilisateurs</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.firstName} {u.lastName}
              </option>
            ))}
          </Select>
          <Select value={result} onChange={(e) => setResult(e.target.value)} aria-label="Résultat">
            <option value="">Tous résultats</option>
            <option value="SUCCESS">Réussi</option>
            <option value="FAILED">Échec</option>
            <option value="DENIED">Refusé</option>
          </Select>
          <Input placeholder="Motif, n° de référence, adresse IP…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </Card>

      <Card>
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState icon="🗂️" title="Aucune entrée sur cette période" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Événement</th>
                  <th className="px-4 py-3 font-medium">Par</th>
                  <th className="px-4 py-3 font-medium">Centre</th>
                  <th className="px-4 py-3 font-medium">Détail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((e) => {
                  const label = AUDIT_LABELS[e.eventType]?.label ?? e.eventType;
                  const failed = e.result === "FAILED" || e.result === "DENIED";
                  return (
                    <Fragment key={e.id}>
                      <tr className="cursor-pointer hover:bg-gray-50" onClick={() => setOpen(open === e.id ? null : e.id)}>
                        <td className="px-4 py-2 whitespace-nowrap text-gray-600">{fmt(e.serverTimestamp)}</td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <span className="font-medium text-gray-900">{label}</span>
                          {failed && (
                            <span className="ml-2">
                              <Badge tone="red">{e.result === "DENIED" ? "Refusé" : "Échec"}</Badge>
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">{e.user ? `${e.user.firstName} ${e.user.lastName}` : <span className="text-gray-400">—</span>}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{e.center?.name ?? <span className="text-gray-400">—</span>}</td>
                        <td className="px-4 py-2 text-gray-600">
                          {summary(e)}
                          {e.reason && <span className="block text-xs text-gray-500">« {e.reason} »</span>}
                        </td>
                      </tr>
                      {open === e.id && (
                        <tr className="bg-gray-50">
                          <td colSpan={5} className="px-4 py-3">
                            <div className="grid gap-3 text-xs md:grid-cols-2">
                              <div className="space-y-1 text-gray-600">
                                {e.referenceType && (
                                  <p>
                                    Référence : {e.referenceType} <span className="font-mono">{e.referenceId}</span>
                                  </p>
                                )}
                                {e.deviceTimestamp && <p>Heure de l&apos;appareil : {fmt(e.deviceTimestamp)}</p>}
                                {e.ipAddress && <p>Adresse IP : {e.ipAddress}</p>}
                                {e.userAgent && <p className="truncate">Appareil : {e.userAgent}</p>}
                              </div>
                              <div className="space-y-2">
                                {e.oldValues != null && (
                                  <pre className="max-h-48 overflow-auto rounded bg-white p-2 text-[11px] text-gray-700 border">Avant : {JSON.stringify(e.oldValues, null, 2)}</pre>
                                )}
                                {e.newValues != null && (
                                  <pre className="max-h-48 overflow-auto rounded bg-white p-2 text-[11px] text-gray-700 border">Après : {JSON.stringify(e.newValues, null, 2)}</pre>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {cursor && (
              <div className="p-4 text-center">
                <Button variant="secondary" onClick={() => void load(cursor)}>
                  Afficher plus
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
      {session && <p className="mt-3 text-xs text-gray-500">Heures affichées dans le fuseau de cet appareil.</p>}
    </>
  );
}
