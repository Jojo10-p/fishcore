"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import POSInterface, { type SaleSnapshot } from "@/components/pos/pos-interface";
import { PrintArea, invoiceFileName, printInFrame, snapshotToTicket, useAutoPrint } from "@/components/pos/printing";
import type { TicketData } from "@/components/documents/ticket-80";
import type { TicketHeader } from "@/lib/offline/db";
import { getNumbering, refreshNumbering, remainingOf } from "@/lib/offline/numbering";
import { SessionProvider, clearSessionCache, useSession } from "@/components/app/session-provider";
import { CashJournal, PrintableJournal, printJournal, type CloseResult } from "@/components/pos/cash-journal";
import { NotificationBell } from "@/components/app/notification-bell";
import { ConnectionBadge, useOnline } from "@/components/app/connection-badge";
import { Alert, Badge, Button, Field, Input, Modal, Money, Select, Spinner } from "@/components/ui";
import { currencyLabel } from "@/lib/utils";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { getDeviceId, hasUnsyncedSales } from "@/lib/offline/sales";

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
  /** Montant compté à la dernière clôture : c'est le fond du matin. */
  lastClosing: { amount: string | null; closedAt: string | null } | null;
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
        const free = r.data.find((x) => !x.openSession);
        setRegisterId(free?.id ?? "");
        // Ouverture = clôture de la veille
        if (free?.lastClosing?.amount != null) setOpeningBalance(String(Math.round(Number(free.lastClosing.amount))));
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

        <Field
          label={`Fond de caisse (${currencyLabel(currency)})`}
          hint={
            registers?.find((r) => r.id === registerId)?.lastClosing?.closedAt
              ? `Repris de la clôture du ${new Date(registers.find((r) => r.id === registerId)!.lastClosing!.closedAt!).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}. Corrigez si le tiroir contient autre chose.`
              : "Montant en espèces présent dans le tiroir au début du service."
          }
        >
          <Input inputMode="numeric" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value.replace(/[^\d]/g, ""))} placeholder="0" />
        </Field>

        <Button className="w-full" onClick={open} loading={busy} disabled={!online || !registerId}>
          Ouvrir la session
        </Button>
        <p className="flex items-center justify-center gap-4 text-center">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:underline">
            Retour au tableau de bord
          </Link>
          <button type="button" onClick={() => void logoutNow()} className="text-sm text-red-600 hover:underline">
            Se déconnecter
          </button>
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
  const [lastSale, setLastSale] = useState<{ id: string; offline: boolean; snapshot: SaleSnapshot } | null>(null);
  const [autoPrint, setAutoPrint] = useAutoPrint();
  const [printJob, setPrintJob] = useState<{ ticket: TicketData; nonce: number } | null>(null);
  const [header, setHeader] = useState<TicketHeader | null>(null);
  const [numbersLeft, setNumbersLeft] = useState<number | null>(null);
  const { session } = useSession();
  // Le ticket 80 mm est le format par défaut ; A4 si l'entreprise l'a choisi
  const format = header?.company.invoiceFormat ?? session?.company?.invoiceFormat ?? "TICKET_80";

  // Numérotation et en-tête des tickets gardés sur l'appareil (impression sans connexion)
  const refreshNumbers = useCallback(async () => {
    const row = (await refreshNumbering(cashSession.id)) ?? (await getNumbering(cashSession.id));
    if (row?.header) setHeader(row.header);
    setNumbersLeft(row ? remainingOf(row) : 0);
  }, [cashSession.id]);

  useEffect(() => {
    const t = setTimeout(() => void refreshNumbers(), 0);
    const onOnline = () => void refreshNumbers();
    window.addEventListener("online", onOnline);
    return () => {
      clearTimeout(t);
      window.removeEventListener("online", onOnline);
    };
  }, [refreshNumbers]);

  // Ticket affiché dans la zone d'impression : on lance l'impression
  useEffect(() => {
    if (!printJob) return;
    // Nom du fichier quand on enregistre en PDF : « Fact. GJH-000003 »
    const before = document.title;
    const t = setTimeout(() => {
      document.title = invoiceFileName(printJob.ticket.saleNumber);
      window.print();
      document.title = before;
    }, 150);
    return () => {
      clearTimeout(t);
      document.title = before;
    };
  }, [printJob]);

  const printLast = useCallback(
    (sale = lastSale) => {
      if (!sale) return;
      if (format === "A4" && !sale.offline && navigator.onLine) {
        printInFrame(`/facture/${sale.id}`);
        return;
      }
      const h: TicketHeader = header ?? {
        // Secours si l'en-tête n'a jamais pu être chargé (première ouverture sans réseau)
        company: {
          tradeName: session?.company?.tradeName ?? "",
          legalName: null,
          phone: "",
          address: null,
          city: null,
          taxId: null,
          tradeRegNumber: null,
          currency,
          invoiceNotes: null,
          requiresPickup: !!session?.company?.requiresPickup,
          invoiceFormat: "TICKET_80",
        },
        center: { id: cashSession.centerId, name: session?.centers.find((c) => c.id === cashSession.centerId)?.name ?? "", address: null, city: null, phone: null },
        registerName: cashSession.registerName,
        cashierFirstName: session?.user.firstName ?? "",
        cashierRole: session?.user.role,
      };
      setPrintJob({ ticket: snapshotToTicket(sale.snapshot, h), nonce: Date.now() });
    },
    [lastSale, format, header, session, currency, cashSession]
  );

  const onSaleRecorded = useCallback(
    (sale: { id: string; offline: boolean; snapshot: SaleSnapshot }) => {
      setLastSale(sale);
      if (autoPrint) printLast(sale);
      void getNumbering(cashSession.id).then((row) => setNumbersLeft(row ? remainingOf(row) : 0));
    },
    [autoPrint, printLast, cashSession.id]
  );
  const [showClose, setShowClose] = useState(false);
  // « Se déconnecter » (ou arrivée depuis le menu avec ?deconnexion=1) : fermer sa caisse d'abord
  const [logoutMode, setLogoutMode] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("deconnexion"));
  const [showExpense, setShowExpense] = useState(false);
  const online = useOnline();

  // Après chaque synchro : catalogue rechargé, réserve de numéros complétée si besoin
  const onSyncComplete = useCallback(() => {
    setCatalogVersion((v) => v + 1);
    void refreshNumbers();
  }, [refreshNumbers]);
  const sync = useOfflineSync({ centerId: cashSession.centerId, sessionId: cashSession.id, onSyncComplete });

  const [menu, setMenu] = useState(false);
  const actions = (
    <>
      {lastSale && (
        <span className="flex items-center gap-2 text-sm">
          <Button className="px-3 py-1.5" onClick={() => printLast()}>
            🖨 Réimprimer {lastSale.snapshot.saleNumber}
          </Button>
          {!lastSale.offline && (
            <Link href={`/facture/${lastSale.id}`} target="_blank" className="text-blue-600 hover:underline">
              A4
            </Link>
          )}
        </span>
      )}
      <label className="flex items-center gap-1.5 text-xs text-gray-600" title="Imprimer la facture après chaque vente (réglage de cet appareil)">
        <input type="checkbox" checked={autoPrint} onChange={(e) => setAutoPrint(e.target.checked)} />
        Impression auto
      </label>
      <Button variant="secondary" className="px-3 py-1.5" onClick={() => setShowExpense(true)} disabled={!online}>
        💸 Dépense
      </Button>
      <Button variant="danger" className="px-3 py-1.5" onClick={() => setShowClose(true)}>
        Clôturer
      </Button>
      <Button variant="secondary" className="px-3 py-1.5 text-red-600" onClick={() => setLogoutMode(true)}>
        Se déconnecter
      </Button>
    </>
  );

  return (
    <>
    <div className="h-dvh flex flex-col print:hidden">
      <header className="relative flex items-center gap-2 sm:gap-3 bg-white border-b border-gray-200 px-3 sm:px-4 py-2">
        <Link href="/dashboard" className="text-lg text-gray-500 hover:text-gray-800" title="Tableau de bord" aria-label="Tableau de bord">
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
        {numbersLeft !== null && numbersLeft < 20 && (
          <Badge tone={numbersLeft < 10 ? "red" : "amber"}>
            {numbersLeft} facture(s) d&apos;avance — {numbersLeft === 0 ? "connectez la caisse" : "reconnectez bientôt"}
          </Badge>
        )}
        <NotificationBell />
        {/* Ordinateur : actions visibles ; téléphone : rangées dans « Menu » */}
        <div className="hidden lg:flex items-center gap-2">{actions}</div>
        <Button variant="secondary" className="px-3 py-1.5 lg:hidden" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
          ☰ Menu
        </Button>
        {menu && (
          <div className="absolute right-3 top-full z-40 mt-1 flex w-64 flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-3 shadow-xl lg:hidden" onClick={() => setMenu(false)}>
            {actions}
          </div>
        )}
      </header>

      <div className="flex-1 min-h-0">
        <POSInterface
          sessionId={cashSession.id}
          cashierId={userId}
          centerId={cashSession.centerId}
          companyId={companyId}
          currency={currency}
          catalogVersion={catalogVersion}
          onSaleRecorded={onSaleRecorded}
        />
      </div>

      {showExpense && (
        <ExpenseModal
          sessionId={cashSession.id}
          centerId={cashSession.centerId}
          currency={currency}
          onClose={() => setShowExpense(false)}
        />
      )}
      <CloseModal
        open={showClose}
        onClose={() => setShowClose(false)}
        sessionId={cashSession.id}
        currency={currency}
        syncNow={sync.syncNow}
        onClosed={onClosed}
      />
      {logoutMode && (
        <CloseModal
          open
          logoutAfter
          onClose={() => setLogoutMode(false)}
          sessionId={cashSession.id}
          currency={currency}
          syncNow={sync.syncNow}
          onClosed={onClosed}
        />
      )}
    </div>
    {printJob && <PrintArea key={printJob.nonce} ticket={printJob.ticket} />}
    </>
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
  logoutAfter = false,
}: {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  currency: string;
  syncNow: () => Promise<void>;
  onClosed: () => void;
  /** « Se déconnecter » : la caisse est fermée, le journal sort, puis la session se termine */
  logoutAfter?: boolean;
}) {
  const online = useOnline();
  const [declared, setDeclared] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CloseResult | null>(null);

  const close = async () => {
    setBusy(true);
    setError(null);
    try {
      // Toutes les ventes de l'appareil doivent être arrivées au serveur avant la clôture
      await syncNow();
      if (await hasUnsyncedSales(sessionId)) {
        throw new Error("Des ventes de cette caisse n'ont pas encore été envoyées au serveur. Réessayez quand la connexion est stable.");
      }
      const res = await apiSend<{ data: CloseResult }>(
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

  const finish = async () => {
    onClosed();
    if (logoutAfter) await logoutNow();
  };

  if (result) {
    return (
      <Modal
        open={open}
        onClose={() => void finish()}
        closeOnBackdrop={false}
        title="Caisse fermée — journal de caisse"
        footer={
          <>
            <Button variant="secondary" onClick={() => printJournal(result)}>
              🖨 Imprimer / enregistrer en PDF
            </Button>
            <Button onClick={() => void finish()}>{logoutAfter ? "Terminer et se déconnecter" : "Terminer"}</Button>
          </>
        }
      >
        <CashJournal r={result} currency={currency} />
        <p className="text-xs text-gray-500">
          Le journal est gardé : la direction peut le revoir à tout moment dans « Clôtures de caisse ». La clôture sera validée par un responsable.
        </p>
        <PrintableJournal r={result} currency={currency} />
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={logoutAfter ? "Fermer ma caisse et me déconnecter" : "Clôturer la caisse"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          {logoutAfter && !online && (
            <Button variant="secondary" onClick={() => void logoutNow()}>
              Me déconnecter sans fermer
            </Button>
          )}
          <Button variant="danger" onClick={close} loading={busy} disabled={!online || declared === ""}>
            {logoutAfter ? "Fermer la caisse" : "Clôturer"}
          </Button>
        </>
      }
    >
      {logoutAfter && (
        <p className="text-sm text-gray-600">
          Comptez l&apos;argent du tiroir : votre journal de caisse sortira, puis vous serez déconnecté pour laisser la place au caissier suivant.
        </p>
      )}
      {!online && <Alert tone="amber">La clôture nécessite une connexion au serveur.</Alert>}
      {error && <Alert>{error}</Alert>}
      <Field label={`Montant réellement compté en espèces (${currencyLabel(currency)})`} hint="Comptez le tiroir : le système calcule l'écart avec le solde théorique.">
        <Input inputMode="numeric" value={declared} onChange={(e) => setDeclared(e.target.value.replace(/[^\d]/g, ""))} autoFocus />
      </Field>
      <Field label="Remarque (facultatif)">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}

/** Fin de session : l'utilisateur est hors ligne pour la direction, la caisse est libre. */
async function logoutNow() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  clearSessionCache();
  window.location.replace("/login");
}

const EXPENSE_CATEGORIES = ["Transport", "Manutention", "Électricité", "Eau", "Repas", "Petit matériel", "Entretien", "Autre"];

/** Dépense payée avec l'argent de la caisse : sortie d'espèces enregistrée aussitôt. */
function ExpenseModal({ sessionId, centerId, currency, onClose }: { sessionId: string; centerId: string; currency: string; onClose: () => void }) {
  const [category, setCategory] = useState("Transport");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("/api/expenses", { centerId, sessionId, category, amount: Number(amount), description: description || undefined, method: "CASH" });
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Dépense payée avec la caisse"
      footer={
        done ? (
          <Button onClick={onClose}>Fermer</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Annuler
            </Button>
            <Button onClick={save} loading={busy} disabled={!(Number(amount) > 0) || !description.trim()}>
              Enregistrer la dépense
            </Button>
          </>
        )
      }
    >
      {error && <Alert>{error}</Alert>}
      {done ? (
        <Alert tone="green">
          Dépense de <Money value={Number(amount)} currency={currency} /> enregistrée : elle est retirée des espèces attendues à la clôture.
        </Alert>
      ) : (
        <>
          <Field label="Pour quoi ?">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label={`Montant (${currencyLabel(currency)})`}>
            <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} autoFocus />
          </Field>
          <Field label="Détail (à quoi ça a servi)">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="ex. Zémidjan pour livrer le garage Kpota" />
          </Field>
        </>
      )}
    </Modal>
  );
}
