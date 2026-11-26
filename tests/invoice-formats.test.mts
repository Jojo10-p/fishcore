/**
 * Formats de facture et mention du vendeur (Prototype).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sellerLabel, sellerMeta } from "@/components/documents/ticket-80";
import { INVOICE_FORMAT_VALUES, asTicketFormat, isTicketFormat, ticketPrintCss } from "@/lib/invoice-formats";

test("vendeur : « Direction » et « Gérant » sans nom, caissier avec son prénom", () => {
  assert.equal(sellerLabel("COMPANY_OWNER", "John"), "Direction");
  assert.equal(sellerLabel("CENTER_MANAGER", "Eustache"), "Gérant");
  assert.equal(sellerLabel("CASHIER", "Samson"), "Caissier : Samson");
  assert.equal(sellerLabel("STOCK_MANAGER", "Rita"), "Magasinier : Rita");
  assert.equal(sellerLabel(undefined, "Ama"), "Caissier : Ama");
  assert.deepEqual(sellerMeta("COMPANY_OWNER", "John"), ["Vendu par", "Direction"]);
  assert.deepEqual(sellerMeta("CENTER_MANAGER", "Eustache"), ["Vendu par", "Gérant"]);
  assert.deepEqual(sellerMeta("CASHIER", "Samson"), ["Caissier", "Samson"]);
});

test("formats : 7 au choix, tickets reconnus, longueur de page fixe pour 210 et 297 mm", () => {
  assert.deepEqual(INVOICE_FORMAT_VALUES, ["TICKET_80", "TICKET_80_COMPACT", "TICKET_80_210", "TICKET_80_297", "TICKET_58", "A5", "A4"]);
  assert.ok(isTicketFormat("TICKET_58") && !isTicketFormat("A4"));
  assert.equal(asTicketFormat("A4"), "TICKET_80");
  assert.equal(asTicketFormat("n'importe quoi"), "TICKET_80");
  assert.equal(asTicketFormat("TICKET_80_COMPACT"), "TICKET_80_COMPACT");
  assert.match(ticketPrintCss("TICKET_80_210"), /size: 80mm 210mm/);
  assert.match(ticketPrintCss("TICKET_80_297"), /size: 80mm 297mm/);
  assert.doesNotMatch(ticketPrintCss("TICKET_80"), /size:/);
});
