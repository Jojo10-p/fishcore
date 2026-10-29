"use client";

import { useCallback, useEffect, useState } from "react";
import { useOnline } from "@/components/app/connection-badge";
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Table, Td } from "@/components/ui";
import { getOfflineDB, type OfflineSale } from "@/lib/offline/db";
import { retryOperation, syncPendingOperations } from "@/lib/offline/sync";
import { formatCurrency } from "@/lib/utils";

const STATUS: Record<OfflineSale["syncStatus"], { label: string; tone: "amber" | "blue" | "green" | "red" | "gray" }> = {
  pending: { label: "En attente", tone: "amber" },
  syncing: { label: "Envoi…", tone: "blue" },
  synced: { label: "Confirmée", tone: "green" },
  failed: { label: "Nouvel essai prévu", tone: "amber" },
  conflict: { label: "Refusée — à traiter", tone: "red" },
};

/**
 * État des opérations enregistrées sur CET appareil (cahier §11.3) :
 * distingue ce qui est seulement local de ce qui est confirmé par le serveur.
 */
export default function SyncPage() {
  const online = useOnline();
  const [sales, setSales] = useState<OfflineSale[]>([]);
  const [opsBySale, setOpsBySale] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const db = getOfflineDB();
    const [all, ops] = await Promise.all([db.sales.orderBy("createdAt").reverse().limit(200).toArray(), db.syncQueue.toArray()]);
    setSales(all);
    setOpsBySale(Object.fromEntries(ops.map((o) => [o.referenceId, o.id])));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const syncAll = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await syncPendingOperations();
      setMessage(
        r.needsLogin
          ? "Session expirée : reconnectez-vous pour envoyer les ventes."
          : `${r.success} envoyée(s), ${r.conflicts} refusée(s), ${r.failed} en échec réseau.`
      );
    } finally {
      await load();
      setBusy(false);
    }
  };

  const unconfirmed = sales.filter((s) => s.syncStatus !== "synced");

  return (
    <>
      <PageHeader
        title="Synchronisation"
        description="Ventes enregistrées sur cet appareil et leur état côté serveur."
        actions={
          <Button onClick={syncAll} loading={busy} disabled={!online}>
            Envoyer maintenant
          </Button>
        }
      />
      <div className="space-y-4">
        {!online && <Alert tone="amber">Hors connexion : l&apos;envoi reprendra automatiquement au retour du réseau.</Alert>}
        {message && <Alert tone="blue">{message}</Alert>}
        {unconfirmed.some((s) => s.syncStatus === "conflict") && (
          <Alert>
            Certaines ventes ont été refusées par le serveur (stock, prix ou caisse déjà clôturée). Elles sont conservées ici : un responsable doit
            décider de leur traitement (régularisation de stock, nouvelle vente, etc.).
          </Alert>
        )}
        <Card>
          {sales.length === 0 ? (
            <EmptyState icon="🔄" title="Aucune vente hors connexion sur cet appareil" />
          ) : (
            <Table head={["Date", "Articles", "Montant", "État", "Détail", ""]}>
              {sales.map((s) => (
                <tr key={s.id}>
                  <Td>{new Date(s.createdAt).toLocaleString("fr-FR")}</Td>
                  <Td className="whitespace-normal">{s.lines.map((l) => `${l.productName} × ${l.quantity}`).join(", ")}</Td>
                  <Td>{formatCurrency(s.totalAmount)}</Td>
                  <Td>
                    <Badge tone={STATUS[s.syncStatus].tone}>{STATUS[s.syncStatus].label}</Badge>
                  </Td>
                  <Td className="whitespace-normal text-xs text-gray-600 max-w-xs">{s.syncError ?? ""}</Td>
                  <Td>
                    {(s.syncStatus === "conflict" || s.syncStatus === "failed") && opsBySale[s.id] && (
                      <button
                        className="text-sm text-blue-600 hover:underline"
                        onClick={async () => {
                          await retryOperation(opsBySale[s.id]);
                          await syncAll();
                        }}
                      >
                        Réessayer
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
