// ─────────────────────────────────────────────
// Import d'articles depuis un autre logiciel (Sage Gestion Commerciale, Excel…)
// ─────────────────────────────────────────────
// Accepte un copier-coller depuis Excel ou la liste d'articles de Sage
// (colonnes séparées par des tabulations) ou un fichier CSV (« ; » ou « , »).
// Les colonnes sont reconnues d'après leur titre : « Référence », « Désignation »,
// « Stock réel », « Prix de vente », « Prix d'achat », « Unité », « Famille »…
// Partagé navigateur / serveur : aucun import de base de données ici.

export type ImportField = "reference" | "name" | "sellingPrice" | "purchasePrice" | "stock" | "unit" | "category" | "barcode";

export const FIELD_LABELS: Record<ImportField, string> = {
  reference: "Référence",
  name: "Désignation",
  sellingPrice: "Prix de vente",
  purchasePrice: "Prix d'achat",
  stock: "Stock",
  unit: "Unité",
  category: "Catégorie / famille",
  barcode: "Code-barres",
};

export interface ImportRow {
  line: number; // n° de ligne dans le texte d'origine (pour les messages)
  reference?: string;
  name: string;
  sellingPrice?: number;
  purchasePrice?: number;
  stock?: number;
  unit?: string;
  category?: string;
  barcode?: string;
}

export interface ParsedImport {
  columns: Array<{ header: string; field: ImportField | null }>;
  rows: ImportRow[];
  errors: Array<{ line: number; message: string }>;
}

/** Sans accents, minuscules, espaces simples : « Prix d'achat » → « prix d achat ». */
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const ALIASES: Array<[ImportField, RegExp]> = [
  ["reference", /^(ref|reference|reference article|code|code article|ar ref|sku)$/],
  ["barcode", /^(code barre|code barres|codebarre|gencod|ean|code ean)$/],
  ["name", /^(designation|libelle|nom|article|produit|intitule|ar design)$/],
  ["sellingPrice", /^(prix de vente|prix vente|pv|pv ttc|prix ttc|prix de vente ttc|prix unitaire|pu|pu ttc|prix)$/],
  ["purchasePrice", /^(prix d achat|prix achat|pa|cmup|cump|dernier prix d achat|prix de revient|cout)$/],
  ["stock", /^(stock|stock reel|qte|quantite|qte en stock|quantite en stock|stock disponible)$/],
  ["unit", /^(unite|unite de vente|u|unite vente)$/],
  ["category", /^(categorie|famille|rayon|groupe)$/],
];

export function guessField(header: string): ImportField | null {
  const h = norm(header);
  for (const [field, re] of ALIASES) if (re.test(h)) return field;
  return null;
}

/** Nombre au format français ou anglais : « 1 234,50 », « 52,15 », « 1234.5 », « 23 500 F ». */
export function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  let s = raw.replace(/[\s  ]/g, "").replace(/(fcfa|cfa|xof|f)$/i, "");
  if (!s) return undefined;
  if (s.includes(",") && s.includes(".")) {
    // Le dernier séparateur est le séparateur décimal
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Découpe le texte en lignes et cellules (guillemets CSV gérés). */
export function splitTable(text: string): string[][] {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const first = clean.split("\n").find((l) => l.trim()) ?? "";
  const sep = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

/**
 * Lit le tableau collé. La première ligne non vide doit contenir les titres.
 * `mapping` permet de corriger la colonne choisie pour un titre non reconnu.
 */
export function parseImport(text: string, mapping?: Array<ImportField | null>): ParsedImport {
  const table = splitTable(text);
  const headerIndex = table.findIndex((r) => r.some((c) => c));
  if (headerIndex < 0) return { columns: [], rows: [], errors: [] };
  const headers = table[headerIndex];
  const fields = headers.map((h, i) => (mapping && mapping[i] !== undefined ? mapping[i] : guessField(h)));
  const columns = headers.map((header, i) => ({ header, field: fields[i] }));
  const errors: ParsedImport["errors"] = [];
  const rows: ImportRow[] = [];
  const seenRefs = new Map<string, number>();

  if (!fields.includes("name")) {
    errors.push({ line: headerIndex + 1, message: "Colonne « Désignation » introuvable : indiquez quelle colonne contient le nom des articles." });
    return { columns, rows, errors };
  }

  table.slice(headerIndex + 1).forEach((cells, k) => {
    const line = headerIndex + 2 + k;
    if (!cells.some((c) => c)) return;
    const get = (f: ImportField) => {
      const i = fields.indexOf(f);
      return i >= 0 ? cells[i]?.trim() || undefined : undefined;
    };
    const name = get("name");
    const reference = get("reference");
    if (!name) {
      // Ligne de total, de sous-titre… : ignorée si elle n'a pas de référence non plus
      if (reference) errors.push({ line, message: `Référence ${reference} sans désignation` });
      return;
    }
    const nums = {
      sellingPrice: parseNumber(get("sellingPrice")),
      purchasePrice: parseNumber(get("purchasePrice")),
      stock: parseNumber(get("stock")),
    };
    const bad = (Object.entries(nums) as Array<[ImportField, number | undefined]>).filter(([, v]) => v !== undefined && (Number.isNaN(v) || v < 0));
    if (bad.length) {
      errors.push({ line, message: `« ${name} » : ${bad.map(([f]) => FIELD_LABELS[f].toLowerCase()).join(", ")} illisible ou négatif` });
      return;
    }
    if (reference) {
      const key = reference.toLowerCase();
      if (seenRefs.has(key)) {
        errors.push({ line, message: `Référence ${reference} en double (déjà ligne ${seenRefs.get(key)})` });
        return;
      }
      seenRefs.set(key, line);
    }
    rows.push({
      line,
      name: name.replace(/\s+/g, " "),
      reference,
      sellingPrice: nums.sellingPrice,
      purchasePrice: nums.purchasePrice,
      stock: nums.stock,
      unit: get("unit"),
      category: get("category"),
      barcode: get("barcode"),
    });
  });
  return { columns, rows, errors };
}
