"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getOfflineDB, type OfflinePackaging, type OfflineProduct } from "@/lib/offline/db";
import { applySaleToLocalStock, createOfflineSale } from "@/lib/offline/sales";
import { commitNumber, peekNextNumber, refreshNumbering } from "@/lib/offline/numbering";
import { cn, formatCurrency, generateIdempotencyKey } from "@/lib/utils";
import { CustomerPicker } from "@/components/app/customer-picker";

// ─────────────────────────────────────────────
// Caisse — tous métiers (cahier §9.1)
// ─────────────────────────────────────────────
// - Douchette : un code-barres suivi de « Entrée » ajoute l'article (ou son
//   conditionnement : carton, pack, boîte…) au panier.
// - Vente à l'unité de base (kg, L, m, pièce…) ou par conditionnement à prix propre.
// - Quantités décimales uniquement pour les unités qui s'y prêtent.
// - Devis : scanner son code-barres (ou saisir son numéro) charge ses lignes et
//   ses prix, figés ; le serveur les reprend du devis, pas de l'écran.
// Le serveur recalcule tout (prix, stock, TVA) : l'écran n'est jamais la référence.

type PaymentMethod = "CASH" | "MOBILE_MONEY" | "CARD" | "TRANSFER";

interface CartItem {
  key: string; // produit + unité vendue
  productId: string;
  productName: string;
  unitId: string;
  unitSymbol: string;
  factor: number; // unités de base par unité vendue
  allowsDecimal: boolean;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  requiresPrescription: boolean;
}

interface PaymentEntry {
  method: PaymentMethod;
  amount: number;
  reference?: string;
}

interface Customer {
  id: string;
  name: string;
  phone: string | null;
}

interface LoadedQuote {
  id: string;
  number: string;
  customerName: string;
  total: number;
  tax: number;
  lines: Array<{ id: string; name: string; ref: string | null; quantity: number; unitSymbol: string; unitPrice: number; discount: number; lineTotal: number }>;
}

/**
 * Ce qui a été vendu, tel qu'imprimé sur la facture : la caisse imprime à partir
 * de ces données, avec ou sans connexion (numéro définitif compris).
 */
export interface SaleSnapshot {
  saleNumber: string;
  date: string;
  customer: { name: string; phone?: string | null } | null;
  lines: Array<{ key: string; name: string; ref?: string | null; quantity: number; unitSymbol: string; unitPrice: number; discount: number; lineTotal: number }>;
  discountAmount: number;
  total: number;
  tax: number;
  payments: Array<{ method: string; amount: number; reference?: string | null; notes?: string | null }>;
  change: number;
}

/** Même règle que le serveur : la monnaie rendue est déduite des espèces. */
function settleLocally(payments: PaymentEntry[], total: number) {
  let change = Math.max(0, round2(payments.reduce((s, p) => s + p.amount, 0) - total));
  return payments
    .map((p) => {
      if (p.method !== "CASH" || change <= 0) return { method: p.method, amount: p.amount, reference: p.reference ?? null, notes: null };
      const deducted = Math.min(change, p.amount);
      change = round2(change - deducted);
      return { method: p.method, amount: round2(p.amount - deducted), reference: null, notes: `Reçu ${p.amount}, rendu ${deducted}` };
    })
    .filter((p) => p.amount > 0);
}

const taxOf = (amount: number, rate: number) => (rate > 0 ? Math.round(((amount * rate) / (100 + rate)) * 100) / 100 : 0);

interface POSContextProps {
  sessionId: string;
  cashierId: string;
  centerId: string;
  companyId: string;
  currency: string;
  /** Appelé après chaque vente (id serveur, ou clé locale si hors ligne). */
  onSaleRecorded?: (sale: { id: string; offline: boolean; snapshot: SaleSnapshot }) => void;
  /** Change après chaque rafraîchissement du catalogue local : recharge les produits. */
  catalogVersion?: number;
}

const METHODS: Record<PaymentMethod, string> = {
  CASH: "Espèces",
  MOBILE_MONEY: "Mobile money",
  CARD: "Carte",
  TRANSFER: "Virement",
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const lineTotal = (i: CartItem) => round2(i.quantity * i.unitPrice - i.discount * i.quantity);
const fmtQty = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });

export default function POSInterface({
  sessionId,
  cashierId,
  centerId,
  companyId,
  currency,
  onSaleRecorded,
  catalogVersion = 0,
}: POSContextProps) {
  const [products, setProducts] = useState<OfflineProduct[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [showPayment, setShowPayment] = useState(false);
  const [showCartMobile, setShowCartMobile] = useState(false);
  const [payments, setPayments] = useState<PaymentEntry[]>([{ method: "CASH", amount: 0 }]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [quote, setQuote] = useState<LoadedQuote | null>(null);
  const [quoteInput, setQuoteInput] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Une clé d'idempotence par vente (et non par clic) : si la connexion coupe
  // après l'enregistrement côté serveur, le nouvel essai ne crée pas de doublon.
  const saleKeyRef = useRef<string | null>(null);

  const fmt = useCallback((n: number) => formatCurrency(n, currency), [currency]);

  useEffect(() => {
    getOfflineDB()
      .products.filter((p) => p.isActive) // les booléens ne sont pas indexables dans IndexedDB
      .toArray()
      .then((list) => setProducts(list.sort((a, b) => a.name.localeCompare(b.name))));
  }, [catalogVersion]);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (!notification) return;
    const t = setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(t);
  }, [notification]);

  // Index code-barres → (produit, conditionnement)
  const barcodeIndex = useMemo(() => {
    const map = new Map<string, { product: OfflineProduct; packaging?: OfflinePackaging }>();
    for (const p of products) {
      if (p.barcode) map.set(p.barcode, { product: p });
      for (const pk of p.packagings ?? []) if (pk.barcode) map.set(pk.barcode, { product: p, packaging: pk });
    }
    return map;
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.internalCode?.toLowerCase().includes(q) ||
        p.barcode?.includes(q) ||
        p.brand?.toLowerCase().includes(q) ||
        p.categoryName?.toLowerCase().includes(q) ||
        Object.values(p.attributes ?? {}).some((v) => v.toLowerCase().includes(q))
    );
  }, [products, search]);

  const totals = useMemo(() => {
    const total = round2(cart.reduce((s, i) => s + lineTotal(i), 0));
    const discount = round2(cart.reduce((s, i) => s + i.discount * i.quantity, 0));
    const tax = round2(cart.reduce((s, i) => s + (i.taxRate > 0 ? (lineTotal(i) * i.taxRate) / (100 + i.taxRate) : 0), 0));
    return { subtotal: round2(total + discount), discount, total, tax };
  }, [cart]);

  const addToCart = useCallback((product: OfflineProduct, packaging?: OfflinePackaging, qty = 1) => {
    const unitId = packaging?.unitId ?? product.baseUnitId;
    const key = `${product.id}:${unitId}`;
    setCart((prev) => {
      const existing = prev.find((i) => i.key === key);
      if (existing) return prev.map((i) => (i.key === key ? { ...i, quantity: round2(i.quantity + qty) } : i));
      return [
        ...prev,
        {
          key,
          productId: product.id,
          productName: product.name,
          unitId,
          unitSymbol: packaging?.symbol ?? product.baseUnitSymbol,
          factor: packaging?.factor ?? 1,
          allowsDecimal: packaging ? false : product.allowsDecimal,
          quantity: qty,
          unitPrice: packaging?.sellingPrice ?? product.sellingPrice,
          discount: 0,
          taxRate: product.taxRate ?? 0,
          requiresPrescription: product.requiresPrescription,
        },
      ];
    });
  }, []);

  const setQuantity = useCallback((key: string, qty: number) => {
    setCart((prev) =>
      qty <= 0
        ? prev.filter((i) => i.key !== key)
        : prev.map((i) => (i.key === key ? { ...i, quantity: i.allowsDecimal ? round2(qty) : Math.round(qty) } : i))
    );
  }, []);

  // Devis : chargé depuis le serveur (connexion requise), lignes et prix figés
  const loadQuote = useCallback(
    async (number: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/quotes?number=${encodeURIComponent(number.trim())}`);
        const list = await res.json();
        if (!res.ok) throw new Error(list.error ?? "Devis inaccessible");
        const found = list.data?.[0];
        if (!found) return false;
        if (found.status === "CONVERTED") throw new Error(`Le devis ${found.number} a déjà été encaissé (${found.sale?.saleNumber ?? ""})`);
        if (found.status === "CANCELLED") throw new Error(`Le devis ${found.number} est annulé`);
        if (found.expired) throw new Error(`Le devis ${found.number} a expiré : faites établir un nouveau devis`);
        const detail = await fetch(`/api/quotes/${found.id}`).then((r) => r.json());
        if (!detail.success) throw new Error(detail.error ?? "Devis inaccessible");
        const q = detail.data;
        setQuote({
          id: q.id,
          number: q.number,
          customerName: q.customer.name,
          total: Number(q.totalAmount),
          tax: Number(q.taxAmount),
          lines: q.lines.map(
            (l: { id: string; product: { name: string; internalCode: string | null }; quantity: string; unitSymbol: string; unitPrice: string; discount: string; lineTotal: string }) => ({
              id: l.id,
              name: l.product.name,
              ref: l.product.internalCode,
              quantity: Number(l.quantity),
              unitSymbol: l.unitSymbol,
              unitPrice: Number(l.unitPrice),
              discount: Number(l.discount),
              lineTotal: Number(l.lineTotal),
            })
          ),
        });
        setCart([]);
        setCustomer(null);
        setShowPayment(false);
        setQuoteInput(null);
        saleKeyRef.current = null;
        setNotification({ type: "success", message: `Devis ${q.number} chargé — ${q.customer.name}` });
        return true;
      } catch (err) {
        setNotification({ type: "error", message: err instanceof Error ? err.message : "Devis inaccessible" });
        return true; // trouvé mais refusé : ne pas afficher « aucun article »
      }
    },
    []
  );

  // Douchette / saisie : « Entrée » sur un code exact ajoute directement l'article
  const onSearchKey = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const code = search.trim();
    if (!code) return;
    const hit = barcodeIndex.get(code);
    if (hit) {
      addToCart(hit.product, hit.packaging);
      setSearch("");
      return;
    }
    // Référence article saisie au clavier (ex. « S08 »), comme dans Sage
    const byRef = products.find((p) => p.internalCode && p.internalCode.toLowerCase() === code.toLowerCase());
    if (byRef && !quote) {
      addToCart(byRef);
      setSearch("");
      return;
    }
    if (filteredProducts.length === 1 && !quote) {
      addToCart(filteredProducts[0]);
      setSearch("");
      return;
    }
    // Code-barres d'un devis (ex. DEV-000012)
    if (isOnline && /^[A-Za-z0-9]+-\d+$/.test(code) && (await loadQuote(code))) {
      setSearch("");
      return;
    }
    setNotification({ type: "error", message: `Aucun article pour « ${code} »` });
  };

  // Montant à encaisser : celui du devis s'il y en a un, sinon celui du panier
  const payTotal = quote ? quote.total : totals.total;
  const hasItems = quote ? true : cart.length > 0;
  const paid = round2(payments.reduce((s, p) => s + (p.amount || 0), 0));
  const change = Math.max(0, round2(paid - payTotal));
  const cashPaid = payments.filter((p) => p.method === "CASH").reduce((s, p) => s + p.amount, 0);
  const paymentError =
    quote && !isOnline
      ? "L'encaissement d'un devis nécessite une connexion"
      : paid < payTotal
      ? `Il manque ${fmt(payTotal - paid)}`
      : change > cashPaid
        ? "Le rendu de monnaie n'est possible que sur les espèces"
        : null;

  const resetSale = () => {
    saleKeyRef.current = null;
    setCart([]);
    setQuote(null);
    setPayments([{ method: "CASH", amount: 0 }]);
    setCustomer(null);
    setShowPayment(false);
    setShowCartMobile(false);
    searchRef.current?.focus();
  };

  const handleValidateSale = async () => {
    if (!hasItems || paymentError) return;
    setIsProcessing(true);
    const idempotencyKey = (saleKeyRef.current ??= generateIdempotencyKey("sale"));
    const lines = cart.map((i) => ({
      productId: i.productId,
      productName: i.productName,
      quantity: i.quantity,
      baseQuantity: round2(i.quantity * i.factor * 1000) / 1000,
      unitId: i.unitId,
      unitSymbol: i.unitSymbol,
      unitPrice: i.unitPrice,
      discount: i.discount,
      lineTotal: lineTotal(i),
    }));
    const cleanPayments = payments.filter((p) => p.amount > 0);

    try {
      let saleId: string;
      let recordedOffline = !isOnline;

      // Numéro de facture : pris dans la plage de cette caisse, connu avant même
      // l'envoi — le ticket porte le numéro définitif, avec ou sans connexion.
      let invoice = await peekNextNumber(sessionId);
      if (!invoice && isOnline) {
        await refreshNumbering(sessionId);
        invoice = await peekNextNumber(sessionId);
      }
      if (!invoice && !isOnline) {
        throw new Error("Plus de numéro de facture disponible sur cette caisse : reconnectez-la au réseau quelques secondes.");
      }
      let saleNumber = invoice?.saleNumber ?? "";
      let shortfalls: string[] = [];

      const saveOffline = async () => {
        if (!invoice) throw new Error("Connexion perdue et aucun numéro de facture disponible : réessayez.");
        const result = await createOfflineSale({
          sessionId,
          cashierId,
          centerId,
          companyId,
          customerId: customer?.id,
          lines,
          payments: cleanPayments,
          idempotencyKey,
          invoice: { seq: invoice.seq, saleNumber: invoice.saleNumber },
        });
        if (!result.success) throw new Error(result.error);
        shortfalls = result.shortfalls ?? [];
        return result.saleId!;
      };

      if (isOnline) {
        let res: Response | null = null;
        try {
          res = await fetch("/api/sales", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              quote
                ? { sessionId, quoteId: quote.id, lines: [], payments: cleanPayments, idempotencyKey, invoiceSeq: invoice?.seq, createdOffline: false }
                : { sessionId, lines, payments: cleanPayments, customerId: customer?.id, idempotencyKey, invoiceSeq: invoice?.seq, createdOffline: false }
            ),
          });
        } catch {
          res = null; // réseau injoignable alors que le navigateur se croit en ligne
        }
        if (res === null || res.status >= 502) {
          if (quote) throw new Error("Connexion perdue : le devis n'a pas été encaissé, réessayez");
          saleId = await saveOffline();
          recordedOffline = true;
        } else {
          const data = await res.json();
          if (data.code === "INVOICE_NUMBER_INVALID") {
            // Plages de la caisse périmées (clôture faite ailleurs…) : on les recharge
            await refreshNumbering(sessionId);
            throw new Error("Numérotation des factures mise à jour : validez à nouveau la vente.");
          }
          if (!res.ok || !data.success) throw new Error(data.error ?? "Erreur serveur");
          saleId = data.data.id;
          saleNumber = data.data.saleNumber;
          if (invoice) await commitNumber(sessionId, invoice.seq);
          if (!quote) await applySaleToLocalStock(centerId, lines);
        }
      } else {
        saleId = await saveOffline();
      }
      // Réserve de numéros : complétée en arrière-plan dès que le réseau le permet
      if (navigator.onLine) void refreshNumbering(sessionId);

      const refOf = new Map(products.map((p) => [p.id, p.internalCode]));
      const snapshot: SaleSnapshot = {
        saleNumber,
        date: new Date().toISOString(),
        customer: quote ? { name: quote.customerName } : customer ? { name: customer.name, phone: customer.phone } : null,
        lines: quote
          ? quote.lines.map((l) => ({ key: l.id, name: l.name, ref: l.ref, quantity: l.quantity, unitSymbol: l.unitSymbol, unitPrice: l.unitPrice, discount: l.discount, lineTotal: l.lineTotal }))
          : cart.map((i) => ({
              key: i.key,
              name: i.productName,
              ref: refOf.get(i.productId) ?? null,
              quantity: i.quantity,
              unitSymbol: i.unitSymbol,
              unitPrice: i.unitPrice,
              discount: i.discount,
              lineTotal: lineTotal(i),
            })),
        discountAmount: quote ? round2(quote.lines.reduce((s, l) => s + l.discount * l.quantity, 0)) : totals.discount,
        total: payTotal,
        tax: quote ? quote.tax : round2(cart.reduce((s, i) => s + taxOf(lineTotal(i), i.taxRate), 0)),
        payments: settleLocally(cleanPayments, payTotal),
        change,
      };
      onSaleRecorded?.({ id: saleId, offline: recordedOffline, snapshot });
      setNotification({
        type: "success",
        message:
          `Facture ${saleNumber} enregistrée${change > 0 ? ` — rendre ${fmt(change)}` : ""}` +
          (shortfalls.length ? ` · Stock à vérifier : ${shortfalls.join(", ")}` : ""),
      });
      resetSale();
    } catch (err) {
      setNotification({ type: "error", message: err instanceof Error ? err.message : "Erreur lors de la vente" });
    } finally {
      setIsProcessing(false);
    }
  };

  const cartCount = cart.length;

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row bg-gray-50 overflow-hidden">
      {notification && (
        <div
          role="status"
          className={cn(
            "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium",
            notification.type === "success" ? "bg-green-600" : "bg-red-600"
          )}
        >
          {notification.message}
        </div>
      )}

      {/* ── Catalogue ── */}
      <section className="flex-1 min-h-0 flex flex-col md:border-r border-gray-200">
        <div className="p-3 sm:p-4 bg-white border-b border-gray-200">
          <div className="relative">
            <input
              ref={searchRef}
              autoFocus
              type="search"
              inputMode="search"
              placeholder="Scanner un code-barres ou rechercher (nom, référence, marque…)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKey}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden>
              ⌕
            </span>
          </div>
          <p className={cn("mt-2 text-xs", isOnline ? "text-gray-400" : "text-red-600 font-medium")}>
            {isOnline ? "Connecté — ventes envoyées immédiatement" : "Hors connexion — les ventes continuent et partiront au retour du réseau"}
          </p>
        </div>

        {/* Un devis chargé fige le panier : le catalogue est grisé */}
        <div className={cn("flex-1 overflow-y-auto p-3 sm:p-4", quote && "pointer-events-none opacity-40")} aria-disabled={!!quote}>
          {filteredProducts.length === 0 ? (
            <div className="text-center text-gray-400 py-16 text-sm">
              {search ? "Aucun article trouvé" : "Aucun article. Le catalogue se charge à la première connexion."}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3">
              {filteredProducts.map((p) => (
                <div key={p.id} className="bg-white border border-gray-200 rounded-xl p-3 flex flex-col">
                  <button onClick={() => addToCart(p)} className="text-left flex-1 active:scale-[0.98] transition-transform">
                    <p className="font-medium text-gray-900 text-sm leading-tight">
                      {p.internalCode && <span className="mr-1 font-mono text-xs text-gray-400">{p.internalCode}</span>}
                      {p.name}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      {[p.brand, p.categoryName, ...Object.values(p.attributes ?? {}).slice(0, 2)].filter(Boolean).join(" · ") || " "}
                    </p>
                    <p className="text-blue-700 font-bold text-sm mt-1">
                      {fmt(p.sellingPrice)}
                      <span className="text-gray-400 font-normal"> / {p.baseUnitSymbol}</span>
                    </p>
                    {p.requiresPrescription && <p className="text-[11px] text-amber-700 mt-0.5">Sur ordonnance</p>}
                  </button>
                  {(p.packagings ?? []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {p.packagings.map((pk) => (
                        <button
                          key={pk.unitId}
                          onClick={() => addToCart(p, pk)}
                          className="text-[11px] rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-blue-800 hover:bg-blue-100"
                          title={`1 ${pk.name} = ${fmtQty(pk.factor)} ${p.baseUnitSymbol}`}
                        >
                          {pk.symbol} ×{fmtQty(pk.factor)} · {fmt(pk.sellingPrice)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Barre panier (téléphone) */}
      <button
        onClick={() => setShowCartMobile((v) => !v)}
        className="md:hidden flex items-center justify-between bg-blue-600 text-white px-4 py-3 text-sm font-semibold"
      >
        <span>{quote ? `Devis ${quote.number}` : `Panier (${cartCount})`}</span>
        <span>{fmt(payTotal)}</span>
      </button>

      {/* ── Panier ── */}
      <aside
        className={cn(
          "bg-white flex-col md:w-96 md:flex md:static",
          showCartMobile ? "flex fixed inset-x-0 bottom-0 top-24 z-40 shadow-2xl rounded-t-2xl" : "hidden"
        )}
      >
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">
            {quote ? `Devis ${quote.number}` : "Panier"}
            {!quote && cartCount > 0 && <span className="ml-2 bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">{cartCount}</span>}
          </h2>
          {isOnline && !quote && cart.length === 0 && quoteInput === null && (
            <button className="ml-auto mr-2 text-xs text-blue-600 hover:underline" onClick={() => setQuoteInput("")}>
              Encaisser un devis
            </button>
          )}
          <button className="md:hidden text-gray-500 text-xl leading-none" onClick={() => setShowCartMobile(false)} aria-label="Fermer le panier">
            ×
          </button>
        </div>

        {quoteInput !== null && !quote && (
          <form
            className="flex gap-2 border-b border-gray-200 p-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (quoteInput.trim() && !(await loadQuote(quoteInput))) {
                setNotification({ type: "error", message: `Aucun devis n° « ${quoteInput.trim()} »` });
              }
            }}
          >
            <input
              autoFocus
              value={quoteInput}
              onChange={(e) => setQuoteInput(e.target.value)}
              placeholder="N° du devis (ex. DEV-000012)"
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              aria-label="Numéro du devis"
            />
            <button className="rounded-lg bg-blue-600 px-3 text-sm text-white">Charger</button>
            <button type="button" className="text-sm text-gray-500" onClick={() => setQuoteInput(null)}>
              ✕
            </button>
          </form>
        )}

        <div className="flex-1 overflow-y-auto">
          {quote ? (
            <div>
              <div className="flex items-center justify-between bg-blue-50 px-4 py-2 text-sm">
                <span>
                  Client : <strong>{quote.customerName}</strong>
                </span>
                <button className="text-xs text-red-600 hover:underline" onClick={resetSale}>
                  Retirer le devis
                </button>
              </div>
              <ul className="divide-y divide-gray-100">
                {quote.lines.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-2 px-4 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-gray-900">{l.name}</span>
                      <span className="text-xs text-gray-500">
                        {fmtQty(l.quantity)} {l.unitSymbol}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">{fmt(l.lineTotal)}</span>
                  </li>
                ))}
              </ul>
              <p className="px-4 py-2 text-xs text-gray-500">Prix du devis, non modifiables. Le stock est vérifié à l&apos;encaissement.</p>
            </div>
          ) : cart.length === 0 ? (
            <div className="text-center text-gray-400 py-12 text-sm">
              <p>Panier vide</p>
              <p className="text-xs mt-1">Scannez ou touchez un article</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {cart.map((item) => (
                <li key={item.key} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">{item.productName}</p>
                      <p className="text-xs text-gray-500">
                        {fmt(item.unitPrice)} / {item.unitSymbol}
                        {item.factor !== 1 && ` (${fmtQty(item.factor)} unités)`}
                      </p>
                      {item.requiresPrescription && <p className="text-[11px] text-amber-700">Vérifier l&apos;ordonnance</p>}
                    </div>
                    <button onClick={() => setQuantity(item.key, 0)} className="text-red-400 hover:text-red-600 text-xs" aria-label="Retirer">
                      ✕
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setQuantity(item.key, item.quantity - 1)}
                        className="w-8 h-8 bg-gray-100 rounded-lg text-gray-700 hover:bg-gray-200"
                        aria-label="Moins"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        inputMode={item.allowsDecimal ? "decimal" : "numeric"}
                        step={item.allowsDecimal ? "0.001" : "1"}
                        min="0"
                        value={item.quantity}
                        onChange={(e) => setQuantity(item.key, parseFloat(e.target.value.replace(",", ".")) || 0)}
                        className="w-20 text-center border border-gray-200 rounded-lg py-1 text-sm"
                        aria-label={`Quantité (${item.unitSymbol})`}
                      />
                      <button
                        onClick={() => setQuantity(item.key, item.quantity + 1)}
                        className="w-8 h-8 bg-gray-100 rounded-lg text-gray-700 hover:bg-gray-200"
                        aria-label="Plus"
                      >
                        +
                      </button>
                      <span className="text-xs text-gray-500 ml-1">{item.unitSymbol}</span>
                    </div>
                    <span className="font-bold text-gray-900 text-sm tabular-nums">{fmt(lineTotal(item))}</span>
                  </div>
                  {/* Quarts : ¼, ½, ¾ de carton / de kg… (unités fractionnables) */}
                  {item.allowsDecimal && (
                    <div className="mt-1.5 flex gap-1">
                      {[
                        [0.25, "¼"],
                        [0.5, "½"],
                        [0.75, "¾"],
                      ].map(([v, label]) => (
                        <button
                          key={label}
                          onClick={() => setQuantity(item.key, v as number)}
                          className={cn(
                            "rounded-md border px-2 py-0.5 text-xs",
                            item.quantity === v ? "border-blue-600 bg-blue-50 text-blue-800" : "border-gray-300 text-gray-700 hover:bg-gray-50"
                          )}
                          aria-label={`Quantité ${label} ${item.unitSymbol}`}
                        >
                          {label}
                        </button>
                      ))}
                      <button
                        onClick={() => setQuantity(item.key, round2(item.quantity + 0.25))}
                        className="rounded-md border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        +¼
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-gray-200 p-4 space-y-3">
          <div className="space-y-1 text-sm">
            {totals.discount > 0 && (
              <div className="flex justify-between text-green-700">
                <span>Remise</span>
                <span>−{fmt(totals.discount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base text-gray-900">
              <span>TOTAL</span>
              <span className="text-blue-700 tabular-nums">{fmt(payTotal)}</span>
            </div>
            {(quote ? quote.tax : totals.tax) > 0 && (
              <div className="flex justify-between text-xs text-gray-500">
                <span>dont TVA</span>
                <span>{fmt(quote ? quote.tax : totals.tax)}</span>
              </div>
            )}
          </div>

          {!showPayment ? (
            <div className="space-y-2">
              <button
                onClick={() => {
                  setPayments([{ method: "CASH", amount: payTotal }]);
                  setShowPayment(true);
                }}
                disabled={!hasItems}
                className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Encaisser {hasItems && fmt(payTotal)}
              </button>
              {!quote && (
                <button onClick={() => setCart([])} disabled={cart.length === 0} className="w-full py-2 text-red-500 text-sm hover:text-red-700 disabled:opacity-40">
                  Vider le panier
                </button>
              )}
            </div>
          ) : (
            <PaymentPanel
              payments={payments}
              setPayments={setPayments}
              total={payTotal}
              change={change}
              fmt={fmt}
              online={isOnline && !quote}
              customer={customer}
              setCustomer={setCustomer}
              error={paymentError}
              processing={isProcessing}
              onBack={() => setShowPayment(false)}
              onValidate={handleValidateSale}
            />
          )}
        </div>
      </aside>
    </div>
  );
}

function PaymentPanel({
  payments,
  setPayments,
  total,
  change,
  fmt,
  online,
  customer,
  setCustomer,
  error,
  processing,
  onBack,
  onValidate,
}: {
  payments: PaymentEntry[];
  setPayments: (p: PaymentEntry[]) => void;
  total: number;
  change: number;
  fmt: (n: number) => string;
  online: boolean;
  customer: Customer | null;
  setCustomer: (c: Customer | null) => void;
  error: string | null;
  processing: boolean;
  onBack: () => void;
  onValidate: () => void;
}) {
  const update = (idx: number, patch: Partial<PaymentEntry>) => setPayments(payments.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  const quickCash = [...new Set([total, Math.ceil(total / 500) * 500, Math.ceil(total / 1000) * 1000, Math.ceil(total / 5000) * 5000])].filter((v) => v > 0).slice(0, 4);

  return (
    <div className="space-y-3">
      {payments.map((p, idx) => (
        <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
          <select
            value={p.method}
            onChange={(e) => update(idx, { method: e.target.value as PaymentMethod })}
            className="min-w-0 w-full border border-gray-300 rounded-lg px-2 py-2 text-sm"
            aria-label="Mode de paiement"
          >
            {(Object.keys(METHODS) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {METHODS[m]}
              </option>
            ))}
          </select>
          <input
            type="number"
            inputMode="numeric"
            value={p.amount || ""}
            onChange={(e) => update(idx, { amount: parseFloat(e.target.value) || 0 })}
            className="min-w-0 w-full border border-gray-300 rounded-lg px-2 py-2 text-sm"
            placeholder="Montant"
            aria-label="Montant"
          />
          {payments.length > 1 ? (
            <button onClick={() => setPayments(payments.filter((_, i) => i !== idx))} className="text-gray-400 hover:text-red-600 px-1" aria-label="Retirer ce paiement">
              ✕
            </button>
          ) : (
            <span />
          )}
          {(p.method === "MOBILE_MONEY" || p.method === "TRANSFER" || p.method === "CARD") && (
            <input
              value={p.reference ?? ""}
              onChange={(e) => update(idx, { reference: e.target.value })}
              placeholder="Référence de transaction"
              className="col-span-3 border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
            />
          )}
        </div>
      ))}

      {payments.length === 1 && payments[0].method === "CASH" && (
        <div className="flex flex-wrap gap-1">
          {quickCash.map((v) => (
            <button key={v} onClick={() => update(0, { amount: v })} className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">
              {fmt(v)}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={() => setPayments([...payments, { method: "MOBILE_MONEY", amount: Math.max(0, total - payments.reduce((s, x) => s + x.amount, 0)) }])}
        className="text-xs text-blue-600 hover:underline"
      >
        + Paiement mixte (ajouter un mode)
      </button>

      {/* Client facultatif : la facture est alors établie à son nom (nécessite le réseau) */}
      {online && <InvoiceCustomer customer={customer} setCustomer={setCustomer} />}

      {change > 0 && (
        <div className="bg-green-50 rounded-lg p-2 text-sm text-green-900">
          Monnaie à rendre : <strong>{fmt(change)}</strong>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="grid grid-cols-2 gap-2">
        <button onClick={onBack} className="py-2.5 border border-gray-300 text-gray-700 rounded-xl text-sm hover:bg-gray-50">
          Retour
        </button>
        <button
          onClick={onValidate}
          disabled={processing || !!error}
          className="py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-40"
        >
          {processing ? "…" : "Valider la vente"}
        </button>
      </div>
    </div>
  );
}

function InvoiceCustomer({ customer, setCustomer }: { customer: Customer | null; setCustomer: (c: Customer | null) => void }) {
  const [open, setOpen] = useState(false);
  if (!customer && !open) {
    return (
      <button className="text-xs text-blue-600 hover:underline block" onClick={() => setOpen(true)}>
        + Facture au nom d&apos;un client (facultatif)
      </button>
    );
  }
  return <CustomerPicker customer={customer} setCustomer={setCustomer} />;
}
