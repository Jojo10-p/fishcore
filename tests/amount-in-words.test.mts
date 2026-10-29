import { test } from "node:test";
import assert from "node:assert/strict";
import { amountInWords, integerToFrenchWords as w } from "../src/lib/amount-in-words.ts";

test("nombres en lettres : règles du français", () => {
  const cases: Array<[number, string]> = [
    [0, "zéro"],
    [1, "un"],
    [16, "seize"],
    [17, "dix-sept"],
    [21, "vingt et un"],
    [22, "vingt-deux"],
    [70, "soixante-dix"],
    [71, "soixante et onze"],
    [77, "soixante-dix-sept"],
    [80, "quatre-vingts"],
    [81, "quatre-vingt-un"],
    [91, "quatre-vingt-onze"],
    [99, "quatre-vingt-dix-neuf"],
    [100, "cent"],
    [101, "cent un"],
    [200, "deux cents"],
    [280, "deux cent quatre-vingts"],
    [1000, "mille"],
    [1001, "mille un"],
    [2000, "deux mille"],
    [80000, "quatre-vingt mille"],
    [200000, "deux cent mille"],
    [232000, "deux cent trente-deux mille"],
    [1_000_000, "un million"],
    [2_500_000, "deux millions cinq cent mille"],
    [1_525_000, "un million cinq cent vingt-cinq mille"],
    [3_000_000_000, "trois milliards"],
  ];
  for (const [n, expected] of cases) assert.equal(w(n), expected, String(n));
});

test("montant avec devise", () => {
  assert.equal(amountInWords(868000, "XOF"), "Huit cent soixante-huit mille francs CFA");
  assert.equal(amountInWords(1, "XOF"), "Un franc CFA");
  assert.equal(amountInWords(1_000_000, "XOF"), "Un million de francs CFA");
  assert.equal(amountInWords(2_000_000, "EUR"), "Deux millions d'euros");
  assert.equal(amountInWords(12.5, "EUR"), "Douze euros et cinquante centimes");
});
