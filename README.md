# fishcore

Plateforme de gestion intégrée des poissonneries (Bénin) : multi-entreprises,
multi-centres, caisses, stocks, ventes en ligne et hors connexion.

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
stock négatif et deux sessions ouvertes sur une même caisse.

```bash
npm run dev        # http://localhost:3000
npm run typecheck  # vérification TypeScript
npm test           # tests d'intégration (TEST_DATABASE_URL requis)
```

> Tailwind CSS v4 est chargé par le loader Turbopack (`next.config.ts`) :
> `src/app/globals.css` doit commencer par `@import "tailwindcss";`.

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
