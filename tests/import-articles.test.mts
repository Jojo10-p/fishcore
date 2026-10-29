import { test } from "node:test";
import assert from "node:assert/strict";
import { guessField, parseImport, parseNumber, splitTable } from "../src/lib/import-articles.ts";

test("nombres français et anglais", () => {
  assert.equal(parseNumber("52,15"), 52.15);
  assert.equal(parseNumber("1 234,50"), 1234.5);
  assert.equal(parseNumber("23 500 F"), 23500);
  assert.equal(parseNumber("1,234.5"), 1234.5);
  assert.equal(parseNumber("1.234,5"), 1234.5);
  assert.equal(parseNumber("800"), 800);
  assert.equal(parseNumber(""), undefined);
  assert.ok(Number.isNaN(parseNumber("abc")));
});

test("titres de colonnes reconnus (Sage, Excel)", () => {
  assert.equal(guessField("Référence"), "reference");
  assert.equal(guessField("Stock réel"), "stock");
  assert.equal(guessField("Désignation"), "name");
  assert.equal(guessField("Prix d'achat"), "purchasePrice");
  assert.equal(guessField("PV TTC"), "sellingPrice");
  assert.equal(guessField("Famille"), "category");
  assert.equal(guessField("Commentaire"), null);
});

test("copier-coller de la liste d'articles Sage (tabulations)", () => {
  const text = [
    "Type\tRéférence\tStock réel\tDésignation\tPrix de vente",
    "\tA01\t52,15\tAILERON\t2 500",
    "\tC01\t519,00\tCUBE\t25",
    "\tG04\t\tG T\t",
    "\tS08\t465,00\tSAUCISSE\t800",
    "\t\t\t\t", // ligne vide
  ].join("\r\n");
  const r = parseImport(text);
  assert.deepEqual(
    r.columns.map((c) => c.field),
    [null, "reference", "stock", "name", "sellingPrice"]
  );
  assert.equal(r.errors.length, 0);
  assert.deepEqual(
    r.rows.map((x) => [x.reference, x.name, x.stock, x.sellingPrice]),
    [
      ["A01", "AILERON", 52.15, 2500],
      ["C01", "CUBE", 519, 25],
      ["G04", "G T", undefined, undefined],
      ["S08", "SAUCISSE", 465, 800],
    ]
  );
});

test("CSV point-virgule avec guillemets, doublons et erreurs signalés", () => {
  const text = 'Référence;Désignation;Prix de vente\nP01;"POULET ; entier";3500\nP01;POULET bis;3000\nP02;POINTE;-5\n;;\n';
  const r = parseImport(text);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].name, "POULET ; entier");
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0].message, /double/);
  assert.match(r.errors[1].message, /négatif/);
});

test("colonne Désignation choisie à la main si le titre n'est pas reconnu", () => {
  const text = "Code\tLibellé article long\tPV\nX1\tHUILE 5L\t6500";
  assert.match(parseImport(text).errors[0]?.message ?? "", /Désignation/);
  const r = parseImport(text, ["reference", "name", "sellingPrice"]);
  assert.deepEqual(r.rows[0], { line: 2, reference: "X1", name: "HUILE 5L", sellingPrice: 6500, purchasePrice: undefined, stock: undefined, unit: undefined, category: undefined, barcode: undefined });
});

test("découpage CSV virgule", () => {
  assert.deepEqual(splitTable('a,b\n"x, y",2'), [["a", "b"], ["x, y", "2"]]);
});
