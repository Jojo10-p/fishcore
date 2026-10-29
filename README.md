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

### Base de données

Les migrations sont fournies (`prisma/migrations`). Elles s'appliquent avec les
garde-fous SQL (`prisma/sql/integrity-guards.sql` : journal d'audit non modifiable,
stock jamais négatif, une session ouverte par caisse, montants positifs…) :

```bash
npm run db:deploy                      # base neuve ou mise à jour
npm run db:migrate -- --name <evol>    # après une modification de schema.prisma
```

Les garde-fous sont rejoués à chaque déploiement (`npm run db:guards`) : ils remettent
en place un index ou une règle qu'une migration aurait retiré. Avant de valider une
nouvelle migration, vérifier qu'elle ne contient pas de `DROP INDEX` sur
`cash_sessions_one_open_per_register`, `cash_sessions_one_open_per_cashier` ou
`cancellations_one_pending_per_sale` (index propres aux garde-fous) ; si oui, retirer ces lignes.

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
| Dépôt de matériaux, gros | Le client paie à la caisse puis se fait servir au magasin sur présentation de sa facture, en une ou plusieurs fois |
| Paiement | Toujours comptant : espèces, mobile money, carte, virement, ou plusieurs à la fois. Pas de vente à crédit |

## Finances

| Écran | Contenu |
|---|---|
| *Finances* | Chiffre d'affaires TTC/HT, TVA, coût des marchandises vendues, marge brute, dépenses, résultat estimé ; encaissements par moyen ; dettes fournisseurs à date ; par centre, par caissier, meilleurs articles ; comparaison à la période précédente ; export CSV (Excel) |
| *Dépenses* | Par catégorie et par centre ; payées en espèces depuis une caisse ouverte (elles entrent dans sa clôture) ou hors caisse ; annulées avec motif, jamais supprimées |
| *Clients* | Fiche (téléphone, adresse, IFU) et historique des factures et devis du client |
| *Fournisseurs & dettes* | Une facture est créée à la validation de chaque réception (marchandise + frais d'approche), échéance selon le délai du fournisseur ; paiements imputés sur la plus ancienne échéance |

Règles de calcul :

- **Coût de revient** = prix d'achat + frais d'approche (transport, glace, manutention…)
  répartis au prorata de la valeur ; **coût moyen pondéré** recalculé à chaque réception ;
  le coût est **figé sur chaque ligne de vente** : la marge d'hier ne change pas
  quand le prix d'achat change aujourd'hui.
- **Clôture de caisse** : fond + ventes espèces − remboursements espèces + entrées
  (règlements clients, apports) − sorties (dépenses, paiements fournisseurs, avances).
- **Dates** : les journées sont découpées dans le fuseau de l'entreprise (Africa/Porto-Novo par défaut).

## Factures, devis et retrait au magasin

| Document | Comment |
|---|---|
| **Ticket de caisse** (80 mm) | Imprimé à chaque vente ; numéro en code-barres |
| **Facture A4** | Depuis la caisse (« Facture A4 » après la vente) ou *Ventes & factures*. En-tête légal (IFU, RCCM), client (avec son IFU), lignes, remises, TVA, règlement, montant en lettres, signatures, mentions de bas de page (*Paramètres*) |
| **Devis A4** | *Devis* → « Nouveau devis » : prix du jour, remise réservée aux responsables, validité réglable. Le client le présente à la caisse : on scanne son code-barres (ou on saisit son n°), ses lignes et ses prix sont repris tels quels. Un devis ne s'encaisse qu'une fois ; annulé ou expiré, il est refusé |
| **Bon pour retrait** | Si l'entreprise sert au magasin (*Paramètres*, activé d'office pour les matériaux de construction) : le client présente sa facture, le magasinier la scanne dans *Retraits magasin* et enregistre ce qu'il remet. Retraits partiels possibles ; une facture ne sert jamais deux fois ; rien n'est remis pour une facture annulée ou en cours d'annulation |

Impression : bouton « Imprimer » du navigateur (format A4, une page pour une facture courante).
Les factures normalisées e-MECeF (DGI Bénin) ne sont pas encore produites : voir *Étapes suivantes*.

## Passer de Sage (ou d'un autre logiciel) à fishcore

1. **Articles et stock** : *Articles → Importer (Sage, Excel)*. Dans Sage, *Structure → Articles*,
   Ctrl + A puis Ctrl + C, et coller. Les colonnes (Référence, Désignation, Stock réel, Prix de vente,
   Prix d'achat, Unité, Famille) sont reconnues ; « Vérifier » montre le résultat sans rien enregistrer.
   Le stock du magasin choisi est amené aux quantités importées (ajustement d'inventaire tracé).
2. **Numérotation** : *Paramètres → Factures* : préfixe (ex. `CPF26`) et prochain numéro (ex. 2769
   après la facture 2768 de Sage). La numérotation ne recule jamais.
3. **Références** : à la caisse, taper la référence (ex. `S08`) puis Entrée ajoute l'article.
4. **Quarts** : une unité « fractionnable » (*Articles → Unités*) se vend au ¼, ½, ¾ (boutons à la caisse).
   En poissonnerie, le carton l'est d'office.

## Imprimante ticket (XP-80C et équivalentes)

- La facture **ticket 80 mm** est le format par défaut (*Paramètres* : A4 possible).
- **Impression automatique** après chaque vente, activée par défaut (case « Impression auto » de la caisse,
  réglage propre à chaque poste) ; bouton « Réimprimer » pour la dernière facture.
- Propriétés de l'imprimante : papier **80(72.1) x 3276 mm** ; dans Chrome, marges **Aucune**.
- Sans boîte de dialogue (comme Sage) : XP-80C en imprimante par défaut de Windows, et Chrome lancé avec
  `--kiosk-printing` (voir DEPLOIEMENT.md).
- **Sans connexion, l'impression continue à l'identique** : chaque caisse garde d'avance une plage de
  numéros de facture (100) et l'en-tête des tickets (IFU, adresse…). Le ticket porte le numéro définitif ;
  la vente part au serveur au retour du réseau, avec son heure réelle. À la clôture, les numéros non utilisés
  sont rendus : pas de trou, pas de doublon.

## Mise en production (Vercel + Supabase)

Voir **DEPLOIEMENT.md** : base Supabase, variables, région, premier déploiement, postes de caisse.

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

## Étapes suivantes

- Factures normalisées **e-MECeF** (DGI) pour les entreprises assujetties : signature de chaque facture par l'API de la DGI, code et QR code MECeF imprimés.
- Envoi de la facture ou du devis en PDF par WhatsApp / e-mail.
- Inventaires physiques et transferts de stock entre centres.
