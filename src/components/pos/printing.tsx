"use client";

import { useCallback, useState } from "react";
import type { SaleSnapshot } from "@/components/pos/pos-interface";
import { TICKET_PRINT_CSS, Ticket80, type TicketData } from "@/components/documents/ticket-80";
import type { TicketHeader } from "@/lib/offline/db";

// ─────────────────────────────────────────────
// Impression à la caisse
// ─────────────────────────────────────────────
// La facture 80 mm est imprimée directement depuis la caisse, à partir des
// données de l'appareil : même ticket, même numéro définitif, avec ou sans
// connexion. Avec Chrome lancé en --kiosk-printing, elle part sur
// l'imprimante par défaut (XP-80C…) sans boîte de dialogue.
// Le format A4 (si l'entreprise l'a choisi) passe par la page facture du
// serveur quand la connexion est là ; sans connexion, le ticket 80 mm prend le relais.

const PREF_KEY = "fishcore-auto-print";

/** Nom proposé quand on enregistre la facture en PDF : « Fact. GJH-000003 ». */
export const invoiceFileName = (saleNumber: string) => `Fact. ${saleNumber}`;

/** Impression automatique après chaque vente : activée par défaut, réglable par appareil. */
export function useAutoPrint(): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PREF_KEY) !== "0";
    } catch {
      return true;
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

/** Imprime une page de l'application (facture A4) sans quitter la caisse. */
export function printInFrame(url: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.src = url.includes("?") ? `${url}&print=1` : `${url}?print=1`;
  document.body.appendChild(frame);
  // La page imprime d'elle-même une fois chargée ; on retire le cadre ensuite
  setTimeout(() => frame.remove(), 120_000);
}

/** Facture de la vente, prête à imprimer, à partir des données de la caisse. */
export function snapshotToTicket(sale: SaleSnapshot, header: TicketHeader): TicketData {
  return {
    saleNumber: sale.saleNumber,
    date: sale.date,
    company: header.company,
    center: header.center,
    customer: sale.customer,
    cashierFirstName: header.cashierFirstName,
    cashierRole: header.cashierRole,
    tendered: sale.tendered ?? null,
    change: sale.change || null,
    lines: sale.lines,
    discountAmount: sale.discountAmount,
    total: sale.total,
    tax: sale.tax,
    payments: sale.payments,
    pickupPending: header.company.requiresPickup,
  };
}

/** Invisible à l'écran ; seul élément imprimé quand la caisse appelle window.print(). */
export function PrintArea({ ticket }: { ticket: TicketData }) {
  return (
    <div className="hidden print:block" data-print-area>
      <style>{TICKET_PRINT_CSS}</style>
      <Ticket80 t={ticket} />
    </div>
  );
}
