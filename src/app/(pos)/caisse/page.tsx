"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import POSInterface from "@/components/pos/pos-interface";
import { SessionProvider, useSession } from "@/components/app/session-provider";
import { ConnectionBadge, useOnline } from "@/components/app/connection-badge";
import { Alert, Badge, Button, Field, Input, Modal, Money, Qty, Select, Spinner } from "@/components/ui";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { getOfflineDB } from "@/lib/offline/db";
import { getDeviceId, getOfflineAvailability, hasUnsyncedSales } from "@/lib/offline/sales";

// ─────────────────────────────────────────────
// Caisse (cahier §7, §9, §11) — fonctionne aussi sans réseau :
// la session ouverte et l'identité sont gardées sur l'appareil.
// ─────────────────────────────────────────────

interface OpenSession {
  id: string;
  cashRegisterId: string;
  registerName: string;
  centerId: string;
  openedAt: string;
}

interface Register {
  id: string;
  name: string;
  centerId: string;
  openSession: { id: string; cashierId: string; cashier: { firstName: string; lastName: string } } | null;
}

const SESSION_KEY = "fishcore-open-cash-session";

function readStoredSession(userId: string): OpenSession | null {
  try {
    const raw = localStorage.getItem(`${SESSION_KEY}:${userId}`);
    return raw ? (JSON.parse(raw) as OpenSession) : null;
  } catch {
    return null;
  }
}
function storeSession(userId: string, s: OpenSession | null) {
  try {
    if (s) localStorage.setItem(`${SESSION_KEY}:${userId}`, JSON.stringify(s));
    else localStorage.removeItem(`${SESSION_KEY}:${userId}`);
  } catch {
    /* ignore */
  }
}

export default function CaissePage() {
  return (
    <SessionProvider>
      <Caisse />
    </SessionProvider>
  );
}

function Caisse() {
  const { session, loading, centerId, setCenterId, currency, can } = useSession();
  const online = useOnline();
  const [cashSession, setCashSession] = useState<OpenSession | null>(null);
  const [resolving, setResolving] = useState(true);

  // Retrouver la session ouverte : serveur si possible, sinon copie locale
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const run = async () => {
      const stored = readStoredSession(session.user.id);
      try {
        const res = await apiGet<{
          data: Array<{ id: string; cashierId: string; cashRegisterId: string; openedAt: string; cashRegister: { name: string } }>;
        }>("/api/cash/sessions?open=true");
        const mine = res.data.find((s) => s.cashierId === session.user.id);
        let next: OpenSession | null = null;
        if (mine) {
          const reg = await apiGet<{ data: Register[] }>("/api/cash/registers");
          const register = reg.data.find((r) => r.id === mine.cashRegisterId);
          next = {
            id: mine.id,
            cashRegisterId: mine.cashRegisterId,
            registerName: mine.cashRegister.name,
            centerId: register?.centerId ?? stored?.centerId ?? centerId ?? "",
            openedAt: mine.openedAt,
          };
        }
        storeSession(session.user.id, next);
        if (!cancelled) setCashSession(next);
      } catch {
        if (!cancelled) setCashSession(stored); // hors ligne
      } finally {
        if (!cancelled) setResolving(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [session, centerId]);

  if (loading || (session && resolving)) return <Spinner label="Préparation de la caisse…" />;
  if (!session) {
    return (
      <div className="p-8 text-center text-sm">
        Connexion requise. <Link href="/login?redirect=/caisse" className="text-blue-600 underline">Se connecter</Link>
      </div>
    );
  }
  if (!can("sale:create")) {
    return (
      <div className="p-8 text-center text-sm">
        Votre rôle ne permet pas d&apos;utiliser la caisse. <Link href="/dashboard" className="text-blue-600 underline">Retour</Link>
      </div>
    );
  }

  if (!cashSession) {
    return (
      <OpenSessionScreen
        online={online}
        centers={session.centers}
        centerId={centerId}
        onCenterChange={setCenterId}
        currency={currency}
        onOpened={(s) => {
          storeSession(session.user.id, s);
          setCashSession(s);
        }}
      />
    );
  }

  return (
    <ActiveRegister
      cashSession={cashSession}
      userId={session.user.id}
      companyId={session.company?.id ?? ""}
      currency={currency}
      onClosed={() => {
        storeSession(session.user.id, null);
        setCashSession(null);
      }}
    />
  );
}

// ── Ouverture de session ─────────────────────
function OpenSessionScreen({
  online,
  centers,
  centerId,
  onCenterChange,
  currency,
  onOpened,
}: {
  online: boolean;
  centers: Array<{ id: string; name: string; code: string }>;
  centerId: string | null;
  onCenterChange: (id: string) => void;
  currency: string;
  onOpened: (s: OpenSession) => void;
}) {
  const [registers, setRegisters] = useState<Register[] | null>(null);
  const [registerId, setRegisterId] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!centerId || !online) return;
    apiGet<{ data: Register[] }>(`/api/cash/registers?centerId=${centerId}`)
      .then((r) => {
        setRegisters(r.data);
        setRegisterId(r.data.find((x) => !x.openSession)?.id ?? "");
      })
      .catch((e) => setError(errorMessage(e)));
  }, [centerId, online]);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ data: { id: string; cashRegisterId: string; openedAt: string; cashRegister: { name: string; centerId: string } } }>(
        "/api/cash/sessions",
        { action: "open", cashRegisterId: registerId, openingBalance: Number(openingBalance || 0), deviceId: getDeviceId(), isOnline: true }
      );
      onOpened({
        id: res.data.id,
        cashRegisterId: res.data.cashRegisterId,
        registerName: res.data.cashRegister.name,
        centerId: res.data.cashRegister.centerId,
        openedAt: res.data.openedAt,
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Ouvrir ma caisse</h1>
          <ConnectionBadge compact />
        </div>
        {!online && (
          <Alert tone="amber">
            L&apos;ouverture d&apos;une caisse nécessite une connexion. Elle reste ensuite utilisable hors connexion.
          </Alert>
        )}
        {error && <Alert>{error}</Alert>}

        {centers.length > 1 && (
          <Field label="Centre">
            <Select value={centerId ?? ""} onChange={(e) => onCenterChange(e.target.value)}>
              {centers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Caisse">
          {registers === null ? (
            <p className="text-sm text-gray-500">{online ? "Chargement des caisses…" : "—"}</p>
          ) : (
            <Select value={registerId} onChange={(e) => setRegisterId(e.target.value)}>
              <option value="">Choisir une caisse</option>
              {registers.map((r) => (
                <option key={r.id} value={r.id} disabled={!!r.openSession}>
                  {r.name}
                  {r.openSession ? ` — occupée (${r.openSession.cashier.firstName})` : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={`Fond de caisse (${currency})`} hint="Montant en espèces présent dans le tiroir au début du service.">
          <Input inputMode="numeric" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value.replace(/[^\d]/g, ""))} placeholder="0" />
        </Field>

        <Button className="w-full" onClick={open} loading={busy} disabled={!online || !registerId}>
          Ouvrir la session
        </Button>
        <p className="text-center">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:underline">
            Retour à la gestion
          </Link>
        </p>
      </div>
    </div>
  );
}

// ── Caisse ouverte ───────────────────────────
function ActiveRegister({
  cashSession,
  userId,
  companyId,
  currency,
  onClosed,
}: {
  cashSession: OpenSession;
  userId: string;
  companyId: string;
  currency: string;
  onClosed: () => void;
}) {
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [lastSale, setLastSale] = useState<{ id: string; offline: boolean } | null>(null);
  const [showReserve, setShowReserve] = useState(false);
  const [showClose, setShowClose] = useState(false);

  const onSyncComplete = useCallback(() => setCatalogVersion((v) => v + 1), []);
  const sync = useOfflineSync({ centerId: cashSession.centerId, sessionId: cashSession.id, onSyncComplete });

  return (
    <div className="h-dvh flex flex-col">
      <header className="flex flex-wrap items-center gap-2 sm:gap-3 bg-white border-b border-gray-200 px-3 sm:px-4 py-2">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-800" title="Gestion">
          ←
        </Link>
        <div className="mr-auto min-w-0">
          <p className="font-semibold text-gray-900 text-sm truncate">{cashSession.registerName}</p>
          <p className="text-xs text-gray-500">
            Ouverte à {new Date(cashSession.openedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <ConnectionBadge compact />
        {sync.pendingCount > 0 && <Badge tone="amber">{sync.pendingCount} en attente</Badge>}
        {sync.conflictCount > 0 && (
          <Link href="/synchronisation">
            <Badge tone="red">{sync.conflictCount} conflit(s)</Badge>
          </Link>
        )}
        {sync.needsLogin && (
          <Link href="/login?redirect=/caisse">
            <Badge tone="red">Reconnexion requise</Badge>
          </Link>
        )}
        {lastSale && !lastSale.offline && (
          <Link href={`/recu/${lastSale.id}`} target="_blank" className="text-sm text-blue-600 hover:underline">
            Reçu
          </Link>
        )}
        <Button variant="secondary" className="px-3 py-1.5" onClick={() => setShowReserve(true)}>
          Réserve hors ligne
        </Button>
        <Button variant="danger" className="px-3 py-1.5" onClick={() => setShowClose(true)}>
          Clôturer
        </Button>
      </header>

      <div className="flex-1 min-h-0">
        <POSInterface
          sessionId={cashSession.id}
          cashierId={userId}
          centerId={cashSession.centerId}
          companyId={companyId}
          currency={currency}
          catalogVersion={catalogVersion}
          onSaleRecorded={setLastSale}
        />
      </div>

      <ReserveModal
        open={showReserve}
        onClose={() => setShowReserve(false)}
        sessionId={cashSession.id}
        centerId={cashSession.centerId}
        onSaved={async () => {
          await sync.syncNow();
          setCatalogVersion((v) => v + 1);
        }}
      />
      <CloseModal
        open={showClose}
        onClose={() => setShowClose(false)}
        sessionId={cashSession.id}
        currency={currency}
        syncNow={sync.syncNow}
        onClosed={onClosed}
      />
    </div>
  );
}

// ── Réserve hors ligne (cahier §9.4) ─────────
function ReserveModal({
  open,
  onClose,
  sessionId,
  centerId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  centerId: string;
  onSaved: () => Promise<void>;
}) {
  const online = useOnline();
  const [rows, setRows] = useState<Array<{ productId: string; name: string; unit: string; free: number; reserved: number; available: number }>>([]);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const load = async () => {
      const db = getOfflineDB();
      const [products, stocks, reservations, availability] = await Promise.all([
        db.products.toArray(),
        db.stocks.where("centerId").equals(centerId).toArray(),
        db.reservations.where("sessionId").equals(sessionId).toArray(),
        getOfflineAvailability(sessionId),
      ]);
      const stockBy = new Map(stocks.map((s) => [s.productId, s]));
      const resBy = new Map(reservations.map((r) => [r.productId, r.serverQuantity]));
      const list = products
        .filter((p) => p.isActive && stockBy.has(p.id))
        .map((p) => {
          const st = stockBy.get(p.id)!;
          const reserved = resBy.get(p.id) ?? 0;
          return {
            productId: p.id,
            name: p.name,
            unit: p.baseUnitSymbol,
            // Libre pour cette caisse = non réservé par personne + ce qu'elle détient déjà
            free: Math.max(0, st.quantity - st.reservedQty) + reserved,
            reserved,
            available: availability.get(p.id) ?? 0,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      setRows(list);
      setTargets(Object.fromEntries(list.map((r) => [r.productId, String(r.reserved)])));
    };
    void load();
  }, [open, centerId, sessionId]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const items = rows
        .map((r) => ({ productId: r.productId, quantity: Number(targets[r.productId] || 0) }))
        .filter((it, i) => it.quantity !== rows[i].reserved);
      if (items.length > 0) await apiSend("/api/stock/reservations", { sessionId, items });
      await onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Réserve hors ligne de cette caisse"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Fermer
          </Button>
          <Button onClick={save} loading={busy} disabled={!online}>
            Enregistrer la réserve
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-600">
        Hors connexion, cette caisse ne peut vendre que les quantités réservées ici. Réservez avant une coupure prévue ;
        ce qui n&apos;est pas vendu revient au stock à la clôture.
      </p>
      {!online && <Alert tone="amber">Modification impossible hors connexion.</Alert>}
      {error && <Alert>{error}</Alert>}
      <div className="divide-y divide-gray-100 -mx-1">
        {rows.length === 0 && <p className="text-sm text-gray-500 py-4">Aucun produit en stock dans ce centre.</p>}
        {rows.map((r) => (
          <div key={r.productId} className="flex items-center gap-3 py-2 px-1">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{r.name}</p>
              <p className="text-xs text-gray-500">
                Max <Qty value={r.free} unit={r.unit} /> · reste à vendre <Qty value={r.available} unit={r.unit} />
              </p>
            </div>
            <Input
              className="w-24 text-right"
              inputMode="decimal"
              aria-label={`Réserve ${r.name}`}
              value={targets[r.productId] ?? ""}
              onChange={(e) => setTargets((t) => ({ ...t, [r.productId]: e.target.value.replace(",", ".") }))}
              disabled={!online}
            />
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ── Clôture (cahier §7.5) ────────────────────
function CloseModal({
  open,
  onClose,
  sessionId,
  currency,
  syncNow,
  onClosed,
}: {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  currency: string;
  syncNow: () => Promise<void>;
  onClosed: () => void;
}) {
  const online = useOnline();
  const [declared, setDeclared] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ theoreticalBalance: string; declaredBalance: string; discrepancy: string; totalSales: string } | null>(null);

  const close = async () => {
    setBusy(true);
    setError(null);
    try {
      // Toutes les ventes de l'appareil doivent être arrivées au serveur avant la clôture
      await syncNow();
      if (await hasUnsyncedSales(sessionId)) {
        throw new Error("Des ventes de cette caisse n'ont pas encore été envoyées au serveur. Réessayez quand la connexion est stable.");
      }
      const res = await apiSend<{ data: { theoreticalBalance: string; declaredBalance: string; discrepancy: string; totalSales: string } }>(
        "/api/cash/sessions",
        { action: "close", sessionId, declaredBalance: Number(declared || 0), notes: notes || undefined }
      );
      setResult(res.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const gap = Number(result.discrepancy);
    return (
      <Modal open={open} onClose={onClosed} title="Caisse clôturée" footer={<Button onClick={onClosed}>Terminer</Button>}>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-gray-500">Encaissements</dt>
          <dd className="text-right"><Money value={result.totalSales} currency={currency} /></dd>
          <dt className="text-gray-500">Solde théorique</dt>
          <dd className="text-right"><Money value={result.theoreticalBalance} currency={currency} /></dd>
          <dt className="text-gray-500">Montant compté</dt>
          <dd className="text-right"><Money value={result.declaredBalance} currency={currency} /></dd>
          <dt className="font-semibold">Écart</dt>
          <dd className={`text-right font-semibold ${gap === 0 ? "text-green-700" : "text-red-700"}`}>
            <Money value={gap} currency={currency} />
          </dd>
        </dl>
        <p className="text-xs text-gray-500">La clôture sera validée par un responsable. Elle ne peut plus être modifiée.</p>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Clôturer la caisse"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="danger" onClick={close} loading={busy} disabled={!online || declared === ""}>
            Clôturer
          </Button>
        </>
      }
    >
      {!online && <Alert tone="amber">La clôture nécessite une connexion au serveur.</Alert>}
      {error && <Alert>{error}</Alert>}
      <Field label={`Montant réellement compté en espèces (${currency})`} hint="Comptez le tiroir : le système calcule l'écart avec le solde théorique.">
        <Input inputMode="numeric" value={declared} onChange={(e) => setDeclared(e.target.value.replace(/[^\d]/g, ""))} autoFocus />
      </Field>
      <Field label="Remarque (facultatif)">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}
