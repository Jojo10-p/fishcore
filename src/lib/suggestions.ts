import type { Prisma } from "@prisma/client";
import { familyOf } from "@/lib/product-name";

// Suggestions d'articles (ajout de stock) masquées ou remises selon la boutique

const norm = (s: string) => familyOf(s).trim().toLowerCase().replace(/\s+/g, " ");

async function matching(tx: Prisma.TransactionClient, productName: string, centerId: string) {
  const fam = norm(productName);
  const list = await tx.productSuggestion.findMany({ where: { OR: [{ centerId: null }, { centerId }] }, select: { id: true, name: true, hiddenCenterIds: true } });
  return list.filter((s) => norm(s.name) === fam);
}

/** Dernier format d'une famille supprimé de la boutique : sa suggestion disparaît de l'ajout de stock. */
export async function hideSuggestion(tx: Prisma.TransactionClient, productName: string, centerId: string) {
  for (const s of await matching(tx, productName, centerId)) {
    if (!s.hiddenCenterIds.includes(centerId)) await tx.productSuggestion.update({ where: { id: s.id }, data: { hiddenCenterIds: { push: centerId } } });
  }
}

/**
 * Nouvel article enregistré : son nom rejoint la liste des suggestions (pour toutes
 * les boutiques), sans rien retirer aux autres ; s'il avait été masqué ici, il revient.
 */
export async function showSuggestion(tx: Prisma.TransactionClient, productName: string, centerId: string) {
  const found = await matching(tx, productName, centerId);
  if (!found.length) {
    const name = familyOf(productName).trim();
    if (name.length >= 2) await tx.productSuggestion.createMany({ data: [{ name }], skipDuplicates: true });
    return;
  }
  for (const s of found) {
    if (s.hiddenCenterIds.includes(centerId)) await tx.productSuggestion.update({ where: { id: s.id }, data: { hiddenCenterIds: s.hiddenCenterIds.filter((c) => c !== centerId) } });
  }
}
