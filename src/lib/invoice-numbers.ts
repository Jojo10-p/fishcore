import { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/auth";
import { generateSaleNumber } from "@/lib/utils";

// ─────────────────────────────────────────────
// Numérotation des factures, avec ou sans connexion
// ─────────────────────────────────────────────
// Chaque session de caisse reçoit d'avance une plage de numéros (ex. 2769 à
// 2818). La caisse attribue elle-même le numéro suivant à chaque vente : le
// ticket imprimé porte le numéro définitif, même pendant une coupure.
// Garanties :
//  - pas de doublon : un numéro n'appartient qu'à une plage, et la base refuse
//    deux ventes avec le même numéro (contrainte unique) ;
//  - pas de trou : à la clôture, les numéros non utilisés sont rendus ; ceux
//    en fin de numérotation font reculer le compteur, les autres sont
//    réattribués en priorité à la prochaine caisse qui en demande.
// Toute modification passe par le verrou de la ligne entreprise.

type Tx = Prisma.TransactionClient;

export const BLOCK_SIZE = 100;
/** Une session ne garde pas plus de numéros d'avance que ceci (non encore utilisés côté serveur). */
export const MAX_AHEAD = 250;

async function lockCompany(tx: Tx, companyId: string) {
  const [c] = await tx.$queryRaw<{ invoicePrefix: string; invoiceCounter: number }[]>`
    SELECT "invoicePrefix", "invoiceCounter" FROM "companies" WHERE "id" = ${companyId} FOR UPDATE`;
  if (!c) throw new ApiError(404, "Entreprise introuvable");
  return c;
}

/** Plages en cours d'une session (pour la caisse). */
export async function sessionBlocks(db: Tx | Prisma.DefaultPrismaClient, sessionId: string) {
  return db.invoiceNumberBlock.findMany({
    where: { sessionId, releasedAt: null },
    select: { id: true, prefix: true, first: true, last: true },
    orderBy: { first: "asc" },
  });
}

/**
 * Confie une nouvelle plage à la session : d'abord des numéros rendus par
 * une clôture (les plus anciens), sinon la suite du compteur.
 */
export async function allocateBlock(tx: Tx, params: { companyId: string; sessionId: string; size?: number }) {
  const company = await lockCompany(tx, params.companyId);
  const free = await tx.invoiceNumberBlock.findFirst({
    where: { companyId: params.companyId, sessionId: null, prefix: company.invoicePrefix },
    orderBy: { first: "asc" },
  });
  if (free) {
    return tx.invoiceNumberBlock.update({
      where: { id: free.id },
      data: { sessionId: params.sessionId },
      select: { id: true, prefix: true, first: true, last: true },
    });
  }
  const size = params.size ?? BLOCK_SIZE;
  const first = company.invoiceCounter;
  await tx.company.update({ where: { id: params.companyId }, data: { invoiceCounter: first + size } });
  return tx.invoiceNumberBlock.create({
    data: { companyId: params.companyId, sessionId: params.sessionId, prefix: company.invoicePrefix, first, last: first + size - 1 },
    select: { id: true, prefix: true, first: true, last: true },
  });
}

/** Le numéro proposé par la caisse appartient-il bien à une plage de sa session ? */
export async function resolveSessionNumber(tx: Tx, params: { sessionId: string; seq: number }) {
  const block = await tx.invoiceNumberBlock.findFirst({
    where: { sessionId: params.sessionId, releasedAt: null, first: { lte: params.seq }, last: { gte: params.seq } },
    select: { prefix: true },
  });
  if (!block) {
    throw new ApiError(409, `Le numéro de facture ${params.seq} n'est pas attribué à cette caisse`, "INVOICE_NUMBER_INVALID");
  }
  const taken = await tx.sale.findFirst({ where: { sessionId: params.sessionId, invoiceSeq: params.seq }, select: { saleNumber: true } });
  if (taken) throw new ApiError(409, `La facture ${taken.saleNumber} existe déjà`, "INVOICE_NUMBER_USED");
  return { seq: params.seq, saleNumber: generateSaleNumber(block.prefix, params.seq) };
}

/** Numérotation sans plage (appel direct de l'API) : suite du compteur. */
export async function nextCompanyNumber(tx: Tx, companyId: string) {
  const company = await lockCompany(tx, companyId);
  await tx.company.update({ where: { id: companyId }, data: { invoiceCounter: company.invoiceCounter + 1 } });
  return { seq: company.invoiceCounter, saleNumber: generateSaleNumber(company.invoicePrefix, company.invoiceCounter) };
}

/** Plages [a, b] des numéros d'une plage qui n'ont servi à aucune vente. */
export function unusedRanges(first: number, last: number, used: number[]): Array<[number, number]> {
  const set = new Set(used);
  const out: Array<[number, number]> = [];
  let start: number | null = null;
  for (let n = first; n <= last; n++) {
    if (!set.has(n)) start ??= n;
    else if (start !== null) {
      out.push([start, n - 1]);
      start = null;
    }
  }
  if (start !== null) out.push([start, last]);
  return out;
}

/**
 * Clôture : rend les numéros non utilisés de la session. Appelé dans la
 * transaction de clôture (la session est déjà figée : plus aucune vente).
 */
export async function releaseSessionNumbers(tx: Tx, params: { companyId: string; sessionId: string }) {
  const blocks = await tx.invoiceNumberBlock.findMany({ where: { sessionId: params.sessionId, releasedAt: null }, orderBy: { first: "asc" } });
  if (blocks.length === 0) return { returned: [] as Array<[number, number]>, used: 0 };
  const company = await lockCompany(tx, params.companyId);
  const sales = await tx.sale.findMany({ where: { sessionId: params.sessionId, invoiceSeq: { not: null } }, select: { invoiceSeq: true } });
  const used = sales.map((s) => s.invoiceSeq!);

  const ranges = blocks.flatMap((b) => unusedRanges(b.first, b.last, used).map((r) => ({ prefix: b.prefix, range: r })));
  let counter = company.invoiceCounter;
  // Du plus haut au plus bas : une plage collée au compteur le fait reculer
  for (const { prefix, range } of [...ranges].sort((a, b) => b.range[0] - a.range[0])) {
    if (range[1] === counter - 1 && prefix === company.invoicePrefix) {
      counter = range[0];
    } else {
      await tx.invoiceNumberBlock.create({ data: { companyId: params.companyId, prefix, first: range[0], last: range[1] } });
    }
  }
  // Des numéros rendus plus tôt peuvent maintenant toucher la fin : les absorber aussi
  for (;;) {
    const tail = await tx.invoiceNumberBlock.findFirst({
      where: { companyId: params.companyId, sessionId: null, prefix: company.invoicePrefix, last: counter - 1 },
    });
    if (!tail) break;
    await tx.invoiceNumberBlock.delete({ where: { id: tail.id } });
    counter = tail.first;
  }
  if (counter !== company.invoiceCounter) {
    await tx.company.update({ where: { id: params.companyId }, data: { invoiceCounter: counter } });
  }
  await tx.invoiceNumberBlock.updateMany({ where: { id: { in: blocks.map((b) => b.id) } }, data: { releasedAt: new Date() } });
  return { returned: ranges.map((r) => r.range), used: used.length };
}
