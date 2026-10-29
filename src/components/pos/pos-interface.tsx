"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { getOfflineDB, type OfflineProduct } from "@/lib/offline/db";
import { createOfflineSale } from "@/lib/offline/sales";
import { generateIdempotencyKey, formatCurrency } from "@/lib/utils";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface CartItem {
  productId: string;
  productName: string;
  quantity: number;
  unitId?: string;
  unitPrice: number;
  discount: number;
  lineTotal: number;
}

interface PaymentEntry {
  method: "CASH" | "MOBILE_MONEY" | "CARD" | "TRANSFER" | "CREDIT";
  amount: number;
  reference?: string;
}

interface POSContextProps {
  sessionId: string;
  cashierId: string;
  centerId: string;
  companyId: string;
  currency: string;
  /** Appelé après chaque vente (id serveur, ou clé locale si hors ligne). */
  onSaleRecorded?: (sale: { id: string; offline: boolean }) => void;
  /** Change après chaque rafraîchissement du catalogue local : recharge les produits. */
  catalogVersion?: number;
}

// ─────────────────────────────────────────────
// Composant principal Point de Vente
// ─────────────────────────────────────────────

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
  // Une clé d'idempotence par vente (et non par clic) : si la connexion coupe
  // après l'enregistrement côté serveur, le nouvel essai ne crée pas de doublon.
  const saleKeyRef = useRef<string | null>(null);
  const [search, setSearch] = useState("");
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [showPayment, setShowPayment] = useState(false);
  const [payments, setPayments] = useState<PaymentEntry[]>([
    { method: "CASH", amount: 0 },
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSaleId, setLastSaleId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Charger produits depuis IndexedDB
  useEffect(() => {
    const db = getOfflineDB();
    // Les booléens ne sont pas indexables dans IndexedDB : filtre en mémoire
    db.products
      .filter((p) => p.isActive)
      .toArray()
      .then(setProducts);
  }, [catalogVersion]);

  // Connectivité
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Filtrer produits
  const filteredProducts = useMemo(() => {
    const q = search.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.internalCode?.toLowerCase().includes(q) ||
        p.barcode?.includes(q) ||
        p.species?.toLowerCase().includes(q)
    );
  }, [products, search]);

  // Totaux panier
  const cartTotals = useMemo(() => {
    const subtotal = cart.reduce((s, i) => s + i.lineTotal, 0);
    const discount = cart.reduce((s, i) => s + i.discount * i.quantity, 0);
    return { subtotal, discount, total: subtotal - discount };
  }, [cart]);

  // Ajouter au panier
  const addToCart = useCallback((product: OfflineProduct) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) {
        return prev.map((i) =>
          i.productId === product.id
            ? { ...i, quantity: i.quantity + 1, lineTotal: (i.quantity + 1) * i.unitPrice - i.discount * (i.quantity + 1) }
            : i
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          productName: product.name,
          quantity: 1,
          unitId: product.baseUnitId,
          unitPrice: product.sellingPrice,
          discount: 0,
          lineTotal: product.sellingPrice,
        },
      ];
    });
  }, []);

  // Modifier quantité
  const updateQuantity = useCallback((productId: string, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((i) => i.productId !== productId));
      return;
    }
    setCart((prev) =>
      prev.map((i) =>
        i.productId === productId
          ? { ...i, quantity: qty, lineTotal: qty * i.unitPrice - i.discount * qty }
          : i
      )
    );
  }, []);

  // Supprimer du panier
  const removeFromCart = useCallback((productId: string) => {
    setCart((prev) => prev.filter((i) => i.productId !== productId));
  }, []);

  // Valider la vente
  const handleValidateSale = async () => {
    if (cart.length === 0) return;
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
    if (totalPaid < cartTotals.total) {
      setNotification({ type: "error", message: "Montant payé insuffisant" });
      return;
    }

    setIsProcessing(true);
    try {
      let saleId: string;
      let recordedOffline = !isOnline;
      // Même clé en ligne et en repli hors ligne : si la requête est arrivée au
      // serveur avant la coupure, la synchronisation ne créera pas de doublon.
      const idempotencyKey = (saleKeyRef.current ??= generateIdempotencyKey("sale"));

      const saveOffline = async () => {
        const result = await createOfflineSale({
          sessionId,
          cashierId,
          centerId,
          companyId,
          lines: cart,
          payments,
          idempotencyKey,
        });
        if (!result.success) throw new Error(result.error);
        return result.saleId!;
      };

      if (isOnline) {
        let res: Response | null = null;
        try {
          res = await fetch("/api/sales", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, lines: cart, payments, idempotencyKey, createdOffline: false }),
          });
        } catch {
          res = null; // réseau injoignable alors que le navigateur se croit en ligne
        }
        if (res === null || res.status >= 502) {
          saleId = await saveOffline();
          recordedOffline = true;
        } else {
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error ?? "Erreur serveur");
          saleId = data.data.id;
        }
      } else {
        saleId = await saveOffline();
      }

      setLastSaleId(saleId);
      onSaleRecorded?.({ id: saleId, offline: recordedOffline });
      saleKeyRef.current = null;
      setCart([]);
      setPayments([{ method: "CASH", amount: 0 }]);
      setShowPayment(false);
      setNotification({
        type: "success",
        message: recordedOffline
          ? "Vente enregistrée sur cet appareil — en attente d'envoi au serveur"
          : "Vente enregistrée",
      });
    } catch (err) {
      setNotification({
        type: "error",
        message: err instanceof Error ? err.message : "Erreur lors de la vente",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Auto-dismiss notification
  useEffect(() => {
    if (notification) {
      const t = setTimeout(() => setNotification(null), 4000);
      return () => clearTimeout(t);
    }
  }, [notification]);

  return (
    <div className="flex h-full min-h-0 bg-gray-50 overflow-hidden">
      {/* NOTIFICATION */}
      {notification && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium transition-all ${
            notification.type === "success" ? "bg-green-600" : "bg-red-600"
          }`}
        >
          {notification.message}
        </div>
      )}

      {/* ── GAUCHE : Catalogue produits ── */}
      <div className="flex-1 flex flex-col border-r border-gray-200">
        {/* Barre de recherche */}
        <div className="p-4 bg-white border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder="Rechercher un produit (nom, code, espèce)..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                🔍
              </span>
            </div>
            {/* Indicateur connexion */}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
              isOnline ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
            }`}>
              <span className={`w-2 h-2 rounded-full ${isOnline ? "bg-green-500" : "bg-red-500"}`} />
              {isOnline ? "En ligne" : "Hors ligne"}
            </div>
          </div>
        </div>

        {/* Grille produits */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredProducts.length === 0 ? (
            <div className="text-center text-gray-400 py-16">
              <div className="text-4xl mb-2">🐟</div>
              <p className="text-sm">
                {search ? "Aucun produit trouvé" : "Aucun produit disponible"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {filteredProducts.map((product) => (
                <button
                  key={product.id}
                  onClick={() => addToCart(product)}
                  className="bg-white border border-gray-200 rounded-xl p-3 text-left hover:border-blue-400 hover:shadow-md transition-all active:scale-95"
                >
                  <div className="text-2xl mb-1">
                    {product.type === "FRESH" ? "🐟" :
                     product.type === "FROZEN" ? "🧊" :
                     product.type === "SMOKED" ? "🔥" : "🐠"}
                  </div>
                  <p className="font-medium text-gray-900 text-sm leading-tight">{product.name}</p>
                  {product.species && (
                    <p className="text-xs text-gray-500 mt-0.5">{product.species}</p>
                  )}
                  <p className="text-blue-600 font-bold text-sm mt-1">
                    {formatCurrency(product.sellingPrice, currency)}
                    <span className="text-gray-400 font-normal">/{product.baseUnitSymbol}</span>
                  </p>
                  {product.internalCode && (
                    <p className="text-xs text-gray-400 mt-0.5">{product.internalCode}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── DROITE : Panier ── */}
      <div className="w-96 flex flex-col bg-white">
        {/* En-tête panier */}
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="font-semibold text-gray-900">
            Panier
            {cart.length > 0 && (
              <span className="ml-2 bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">
                {cart.length}
              </span>
            )}
          </h2>
        </div>

        {/* Lignes panier */}
        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="text-center text-gray-400 py-12">
              <div className="text-3xl mb-2">🛒</div>
              <p className="text-sm">Panier vide</p>
              <p className="text-xs mt-1">Cliquez sur un produit pour l&apos;ajouter</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {cart.map((item) => (
                <div key={item.productId} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">{item.productName}</p>
                      <p className="text-xs text-gray-500">
                        {formatCurrency(item.unitPrice, currency)} / unité
                      </p>
                    </div>
                    <button
                      onClick={() => removeFromCart(item.productId)}
                      className="text-red-400 hover:text-red-600 text-xs"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    {/* Contrôle quantité */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => updateQuantity(item.productId, item.quantity - 0.5)}
                        className="w-7 h-7 bg-gray-100 rounded-lg text-gray-600 hover:bg-gray-200 text-sm"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) =>
                          updateQuantity(item.productId, parseFloat(e.target.value) || 0)
                        }
                        className="w-14 text-center border border-gray-200 rounded-lg py-1 text-sm"
                        step="0.5"
                        min="0"
                      />
                      <button
                        onClick={() => updateQuantity(item.productId, item.quantity + 0.5)}
                        className="w-7 h-7 bg-gray-100 rounded-lg text-gray-600 hover:bg-gray-200 text-sm"
                      >
                        +
                      </button>
                    </div>
                    <span className="font-bold text-gray-900 text-sm">
                      {formatCurrency(item.lineTotal, currency)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Totaux et actions */}
        <div className="border-t border-gray-200 p-4 space-y-3">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Sous-total</span>
              <span>{formatCurrency(cartTotals.subtotal, currency)}</span>
            </div>
            {cartTotals.discount > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Remise</span>
                <span>−{formatCurrency(cartTotals.discount, currency)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base text-gray-900 pt-1 border-t border-gray-100">
              <span>TOTAL</span>
              <span className="text-blue-600">{formatCurrency(cartTotals.total, currency)}</span>
            </div>
          </div>

          {/* Paiement rapide */}
          {!showPayment ? (
            <div className="space-y-2">
              <button
                onClick={() => {
                  setPayments([{ method: "CASH", amount: cartTotals.total }]);
                  setShowPayment(true);
                }}
                disabled={cart.length === 0}
                className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Encaisser {cart.length > 0 && formatCurrency(cartTotals.total, currency)}
              </button>
              <button
                onClick={() => setCart([])}
                disabled={cart.length === 0}
                className="w-full py-2 text-red-500 text-sm hover:text-red-700 disabled:opacity-40"
              >
                Vider le panier
              </button>
            </div>
          ) : (
            /* Mode paiement */
            <div className="space-y-3">
              <h3 className="font-semibold text-sm text-gray-700">Mode de paiement</h3>
              {payments.map((payment, idx) => (
                <div key={idx} className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={payment.method}
                      onChange={(e) => {
                        const updated = [...payments];
                        updated[idx].method = e.target.value as PaymentEntry["method"];
                        setPayments(updated);
                      }}
                      className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                    >
                      <option value="CASH">Espèces</option>
                      <option value="MOBILE_MONEY">Mobile Money</option>
                      <option value="CARD">Carte</option>
                      <option value="TRANSFER">Virement</option>
                      <option value="CREDIT">Crédit</option>
                    </select>
                    <input
                      type="number"
                      value={payment.amount}
                      onChange={(e) => {
                        const updated = [...payments];
                        updated[idx].amount = parseFloat(e.target.value) || 0;
                        setPayments(updated);
                      }}
                      className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                      placeholder="Montant"
                    />
                  </div>
                </div>
              ))}

              {/* Monnaie */}
              {payments[0]?.method === "CASH" && (
                <div className="bg-gray-50 rounded-lg p-2 text-xs text-gray-600">
                  Monnaie à rendre :{" "}
                  <span className="font-bold text-gray-900">
                    {formatCurrency(
                      Math.max(0, payments.reduce((s, p) => s + p.amount, 0) - cartTotals.total),
                      currency
                    )}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setShowPayment(false)}
                  className="py-2.5 border border-gray-300 text-gray-700 rounded-xl text-sm hover:bg-gray-50"
                >
                  Retour
                </button>
                <button
                  onClick={handleValidateSale}
                  disabled={isProcessing}
                  className="py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-40"
                >
                  {isProcessing ? "..." : "Valider"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
