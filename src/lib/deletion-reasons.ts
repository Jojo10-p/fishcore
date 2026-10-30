/** Raisons proposées quand un propriétaire supprime son compte (plusieurs choix possibles). */
export const DELETION_REASONS = [
  { code: "too_complex", label: "L'application est trop compliquée à utiliser" },
  { code: "missing_features", label: "Il manque des fonctions dont j'ai besoin" },
  { code: "bugs", label: "Trop de problèmes ou de lenteurs" },
  { code: "other_software", label: "Je passe à un autre logiciel" },
  { code: "business_closed", label: "J'arrête ou je mets en pause mon activité" },
  { code: "test_account", label: "C'était un compte d'essai ou de test" },
  { code: "new_account", label: "Je veux recommencer avec un nouveau compte" },
  { code: "other", label: "Autre raison" },
] as const;

export type DeletionReasonCode = (typeof DELETION_REASONS)[number]["code"];
export const DELETION_REASON_CODES = DELETION_REASONS.map((r) => r.code) as [DeletionReasonCode, ...DeletionReasonCode[]];
export const deletionReasonLabel = (code: string) => DELETION_REASONS.find((r) => r.code === code)?.label ?? code;
