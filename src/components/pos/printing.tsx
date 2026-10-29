"use client";

import { useCallback, useState } from "react";
import type { SaleSnapshot } from "@/components/pos/pos-interface";

// ─────────────────────────────────────────────
// Impression à la caisse
// ─────────────────────────────────────────────
// - La facture est imprimée dans un cadre invisible : pas de nouvel onglet,
//   pas de blocage « fenêtre surgissante ». Avec Chrome lancé en
//   --kiosk-printing, elle part directement sur l'imprimante par défaut
//   (XP-80C…), sans boîte de dialogue — comme dans Sage.
// - Hors connexion, la facture définitive (numéro) n'existe pas encore :
//   on imprime un reçu provisoire à partir de ce qui vient d'être vendu.

const PREF_KEY = "fishcore-auto-print";

/** Impression automatique après chaque vente : réglage propre à cet appareil. */
export function useAutoPrint(): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PREF_KEY) === "1";
    } catch {
      return false;
    }
  });
  const set = useCallback((v: boolean) => {
    setValue(v);
    try {
      localStorage.setItem(PREF_KEY, v ? "1" : "0");
    } catch {
      // stockage indisponible (navigation privée) : réglage gardé pour la session
    }
  }, []);
  return [value, set];
}

/** Imprime une page de l'application (facture) sans quitter la caisse. */
export function printInFrame(url: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.src = url.includes("?") ? `${url}&print=1` : `${url}?print=1`;
  document.body.appendChild(frame);
  // La page imprime d'elle-même une fois chargée ; on retire le cadre ensuite
  setTimeout(() => frame.remove(), 120_000);
}

export function invoiceUrl(saleId: string, format: "TICKET_80" | "A4" | undefined) {
  return format === "A4" ? `/facture/${saleId}` : `/recu/${saleId}`;
}

const METHODS: Record<string, string> = { CASH: "Espèces", MOBILE_MONEY: "Mobile money", CARD: "Carte", TRANSFER: "Virement" };
const n = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 2 }).replace(/[  ]/g, " ");
const q = (v: number) => v.toLocaleString("fr-FR", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 3 });

/**
 * Reçu provisoire 80 mm (vente hors connexion). Invisible à l'écran,
 * seul élément imprimé quand la caisse appelle window.print().
 */
export function ProvisionalTicket({
  sale,
  companyName,
  centerName,
  cashierName,
}: {
  sale: SaleSnapshot;
  companyName: string;
  centerName: string;
  cashierName: string;
}) {
  const at = new Date(sale.at);
  return (
    <div className="hidden print:block">
      <style>{`@page { margin: 0; } @media print { html, body { background: #fff; width: 80mm; } }`}</style>
      <div className="w-[72mm] px-[2mm] py-3 font-sans text-[11.5px] leading-tight text-black">
        <p className="text-center text-[17px] font-black uppercase">{companyName}</p>
        <div className="mt-2 border-y border-black py-1.5">
          <p className="text-[13px] font-black">REÇU PROVISOIRE</p>
          <p>
            Date : {at.toLocaleDateString("fr-FR")} à {at.toLocaleTimeString("fr-FR")}
          </p>
          <p>Livraison : {centerName.toUpperCase()}</p>
          <p>Client : {sale.customerName ?? "Clients divers"}</p>
          {sale.quoteNumber && <p>Devis : {sale.quoteNumber}</p>}
        </div>
        <table className="mt-1.5 w-full border-collapse border border-black text-[11px]">
          <thead>
            <tr className="border-b border-black">
              <th className="border-r border-black px-1 text-left">Article</th>
              <th className="border-r border-black px-1 text-right">Qté</th>
              <th className="border-r border-black px-1 text-right">P.U.</th>
              <th className="px-1 text-right">Montant</th>
            </tr>
          </thead>
          <tbody>
            {sale.lines.map((l, i) => (
              <tr key={i} className="border-b border-black align-top">
                <td className="border-r border-black px-1 font-semibold uppercase">
                  {l.name}
                  {l.ref && <span className="block text-[9.5px] font-normal normal-case">Réf. {l.ref}</span>}
                </td>
                <td className="border-r border-black px-1 text-right whitespace-nowrap">
                  {q(l.quantity)} <span className="text-[9.5px]">{l.unitSymbol}</span>
                </td>
                <td className="border-r border-black px-1 text-right whitespace-nowrap">{n(l.unitPrice)}</td>
                <td className="px-1 text-right whitespace-nowrap">{n(l.lineTotal)}</td>
              </tr>
            ))}
            <tr className="text-[14px]">
              <td colSpan={3} className="border-r border-black px-1 py-1 font-black">
                Total dû
              </td>
              <td className="px-1 py-1 text-right font-black">{n(sale.total)}</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-1.5">
          {sale.payments.map((p, i) => (
            <div key={i} className="flex justify-between">
              <span>Payé — {METHODS[p.method] ?? p.method}</span>
              <span>{n(p.amount)}</span>
            </div>
          ))}
          {sale.change > 0 && (
            <div className="flex justify-between font-semibold">
              <span>Monnaie rendue</span>
              <span>{n(sale.change)}</span>
            </div>
          )}
        </div>
        <p className="mt-2 border border-black p-1 text-center text-[10px]">
          Vente enregistrée hors connexion. Le numéro de facture sera attribué au retour du réseau ; la facture pourra alors être réimprimée.
        </p>
        <p className="mt-2 text-center">Merci de votre visite</p>
        <p className="mt-1.5">{cashierName}</p>
      </div>
    </div>
  );
}
