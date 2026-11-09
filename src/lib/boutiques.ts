// Les deux boutiques GJH, juste en face l'une de l'autre :
// « Huile de moteur » et « Huile d'arachide ». Une icône simple pour chacune.
export function boutiqueIcon(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("arachide")) return "🥜";
  if (n.includes("moteur") || n.includes("lubrifiant")) return "🛢️";
  return "🏪";
}
