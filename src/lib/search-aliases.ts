// ─────────────────────────────────────────────
// Abréviations utilisées à la boutique GJH (liste donnée par le client)
// ─────────────────────────────────────────────
// Taper « SH » trouve « SHELL », « PR » trouve « NATIONAL PETROLINE »,
// « S.S.PON » trouve « SUPER SONIC PONT »… et le nom complet marche toujours.

const ALIASES: Record<string, string> = {
  ch: "champion",
  na: "national",
  nat: "national",
  pr: "national petroline",
  sh: "shell",
  adv: "advance",
  rim: "rimula",
  or: "oryx",
  orix: "oryx",
  sof: "sofwane",
  yam: "yamalube",
  max: "maxwel",
  morov: "morever",
  ulti: "ultima",
  hyd: "hydro",
  "s.s.pon": "super sonic pont",
  sspon: "super sonic pont",
  pon: "pont",
  esse: "essence",
  dies: "diesel",
};

const clean = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Vrai si `text` correspond à la recherche, abréviations comprises (chaque mot tapé doit se retrouver). */
export function matchesSearch(text: string | null | undefined, query: string): boolean {
  if (!text) return false;
  const t = clean(text);
  const q = clean(query);
  if (!q) return true;
  if (t.includes(q)) return true;
  return q.split(" ").every((w) => t.includes(w) || (ALIASES[w] !== undefined && t.includes(ALIASES[w])));
}
