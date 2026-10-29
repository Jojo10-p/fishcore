# fishcore

Gestion commerciale multi-métiers (Bénin) : poissonnerie, quincaillerie,
matériaux de construction, vente d'huile, supermarché, pharmacie, grossiste…
Multi-entreprises, multi-centres, caisses, stocks, ventes en ligne et hors connexion.

> Le nom affiché se règle avec `NEXT_PUBLIC_APP_NAME` (le nom commercial reste à définir).

Stack : Next.js 16 · React 19 · TypeScript · Prisma 7 (PostgreSQL / Supabase) · Dexie (hors ligne).

## Démarrage

```bash
npm install                 # génère aussi le client Prisma (postinstall)
cp .env.example .env.local  # puis remplir les valeurs
```

### Base de données — première fois

```bash
npx prisma migrate dev --name init --create-only
# Copier le contenu de prisma/sql/integrity-guards.sql à la fin de
# prisma/migrations/<horodatage>_init/migration.sql, puis :
npx prisma migrate dev
```

Les garde-fous SQL rendent le journal d'audit non modifiable, interdisent un
stock négatif, deux sessions ouvertes sur une même caisse, un paiement supérieur
à la facture ou un montant négatif. Le fichier peut être rejoué sans risque
après chaque évolution du schéma :

```bash
npx prisma migrate dev --name <evolution>
psql "$DIRECT_URL" -f prisma/sql/integrity-guards.sql
```

```bash
npm run dev        # http://localhost:3000
npm run typecheck  # vérification TypeScript
npm test           # tests d'intégration (TEST_DATABASE_URL requis)
```

> Tailwind CSS v4 est chargé par le loader Turbopack (`next.config.ts`) :
> `src/app/globals.css` doit commencer par `@import "tailwindcss";`.

## Un logiciel, plusieurs métiers

Le métier choisi à l'inscription (modifiable dans *Paramètres*) **pré-remplit** seulement
les unités, catégories et options ; tout reste réglable article par article
(`src/lib/business-profiles.ts`).

| Besoin | Comment |
|---|---|
| Vente au poids, au litre, au mètre | Unités « décimales » (kg, L, m, m², m³…) ; pièces, boîtes, sacs en quantités entières |
| Carton, boîte, pack, sac, rouleau | *Conditionnements* : 1 carton = 12 pièces, avec prix et code-barres propres |
| Supermarché | Caisse au code-barres (douchette), TVA incluse dans le prix, extraite sur le reçu |
| Pharmacie / alimentaire | Suivi par lot, péremption obligatoire à la réception, vente « premier périmé, premier sorti », lots périmés jamais vendus, lot imprimé sur le reçu |
| Caractéristiques libres | DCI, dosage, dimension, matière, espèce, contenance… |
| Vente à crédit | Client obligatoire, plafond de crédit facultatif par client |

## Finances

| Écran | Contenu |
|---|---|
| *Finances* | Chiffre d'affaires TTC/HT, TVA, coût des marchandises vendues, marge brute, dépenses, résultat estimé ; encaissements par moyen ; créances et dettes à date ; par centre, par caissier, meilleurs articles ; comparaison à la période précédente ; export CSV (Excel) |
| *Dépenses* | Par catégorie et par centre ; payées en espèces depuis une caisse ouverte (elles entrent dans sa clôture) ou hors caisse ; annulées avec motif, jamais supprimées |
| *Clients & créances* | Qui doit combien, relevé ligne à ligne, plafond de crédit, règlements (espèces dans la caisse, mobile money, virement) |
| *Fournisseurs & dettes* | Une facture est créée à la validation de chaque réception (marchandise + frais d'approche), échéance selon le délai du fournisseur ; paiements imputés sur la plus ancienne échéance |

Règles de calcul :

- **Coût de revient** = prix d'achat + frais d'approche (transport, glace, manutention…)
  répartis au prorata de la valeur ; **coût moyen pondéré** recalculé à chaque réception ;
  le coût est **figé sur chaque ligne de vente** : la marge d'hier ne change pas
  quand le prix d'achat change aujourd'hui.
- **Clôture de caisse** : fond + ventes espèces − remboursements espèces + entrées
  (règlements clients, apports) − sorties (dépenses, paiements fournisseurs, avances).
- **Dates** : les journées sont découpées dans le fuseau de l'entreprise (Africa/Porto-Novo par défaut).

## Fonctionnement hors connexion

- **Application installable (PWA)** : `public/sw.js` garde les pages et les fichiers
  de l'application ; la caisse s'ouvre même sans réseau après un redémarrage.
- **Réserve par caisse** : avant une coupure, chaque caisse réserve des quantités
  (bouton « Réserve hors ligne »). Hors ligne, elle ne vend que dans cette limite :
  deux caisses ne peuvent jamais vendre le même poisson. La réserve non vendue
  revient au stock à la clôture.
- **Synchronisation** : automatique (retour du réseau + toutes les 30 s), dans l'ordre,
  sans doublon. Une vente refusée (stock, prix, caisse clôturée) passe en « conflit »
  et reste visible dans *Synchronisation* pour décision d'un responsable.
- **Brouillons** : la saisie d'une réception est sauvegardée sur l'appareil au fil de
  l'eau et proposée à la réouverture (coupure de courant, fermeture du navigateur).

## Règles de sécurité du code serveur

Toute route API doit :

1. appeler `getCurrentUser(req)` puis `requirePermission(user, "...")` (`src/lib/auth.ts`) ;
2. prendre l'entreprise, l'utilisateur et les centres **de la session**, jamais du corps
   de la requête ni de l'URL (`requireCompany`, `requireCenterAccess`, `resolveCenterScope`) ;
3. écrire le journal d'audit **dans la transaction** de l'opération : `writeAuditLog(params, tx)`.

Les vérifications de stock se font dans la base (mise à jour conditionnelle),
jamais à partir de la quantité affichée à l'écran.
