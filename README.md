# Aurane Finance — plateforme de demandes de financement

Application web complète (site public, espace client, back-office) pour une structure de financement :
présentation des offres, simulateur, dépôt de dossier en ligne avec justificatifs, suivi, assistance,
et instruction des demandes par une équipe aux rôles distincts.

> « Aurane Finance » est un nom provisoire : nom, logo, coordonnées, textes, devise et langues se modifient
> depuis le back-office (Paramètres, Contenus du site) sans toucher au code.

---

## 1. Stack

| Couche | Choix |
|---|---|
| Framework | Next.js 15 (App Router, Server Components, Server Actions), React 19, TypeScript strict |
| UI | Tailwind CSS 3, composants maison inspirés de shadcn/ui, Lucide, Framer Motion (transitions ciblées), Recharts |
| Polices | Manrope (titres) + Inter (texte), auto-hébergées via `@fontsource` (aucun appel à Google Fonts) |
| Données | PostgreSQL + Prisma 7 (client sans moteur binaire, adaptateur `@prisma/adapter-pg`) |
| Validation | Zod, côté serveur systématiquement (et côté client pour le confort) |
| Auth | Maison : bcrypt (coût 12), JWT HS256 signé (`jose`) en cookie `httpOnly`, sessions révocables en base |
| Emails | Resend, SMTP (Nodemailer) ou console (dev) — modèles éditables en base |
| Tests | Vitest (moteur de calcul du simulateur) |

## 2. Arborescence

```
prisma/
  schema.prisma          Schéma complet (UUID, timestamps, index, soft-delete, historique)
  seed.ts                Rôles, permissions, super-admin, modèles d'emails, FAQ (+ démo optionnelle)
src/
  app/
    (public)/            Site public : accueil, solutions, simulateur, demande, à propos, FAQ, contact,
                         pages légales, connexion / inscription / mot de passe
    espace/              Espace client (protégé) : tableau de bord, demandes, documents, assistance,
                         notifications, profil
    admin/connexion      Connexion back-office
    admin/(app)/         Back-office (protégé + permissions) : dashboard, demandes, clients, offres,
                         assistance, messages, contenus, FAQ, témoignages, emails, administrateurs,
                         paramètres, audit
    api/documents/[id]   Accès contrôlé aux justificatifs (jamais servis publiquement)
    api/admin/...        Exports CSV / JSON
    media/[key]          Images publiques téléversées depuis le back-office
  components/            ui/ (design system), site/, client/, admin/, forms/
  lib/                   loan-math (simulateur), permissions, statuts, i18n, validation, utilitaires
  server/                auth, actions (Server Actions), services, stockage, emails, audit, rate-limit
  middleware.ts          Premier filtre d'accès (signature de session) sur /espace et /admin
storage/private/         Justificatifs (hors du dossier public, à placer sur un volume persistant)
tests/                   Tests unitaires
```

## 3. Installation locale

Prérequis : Node.js 20+, PostgreSQL 14+.

```bash
npm install
cp .env.example .env            # puis renseigner DATABASE_URL, SESSION_SECRET, SEED_ADMIN_*
npx prisma migrate dev --name init   # crée les tables et génère le client
npm run db:seed                 # rôles, permissions, super-admin, emails, FAQ
# optionnel, en développement uniquement :
npm run db:seed:demo            # 3 offres [DÉMO] + 8 clients/demandes fictifs marqués « démo »
npm run dev
```

- Site : http://localhost:3000
- Back-office : http://localhost:3000/admin (identifiants `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`)
- Clients de démonstration : `demo.<prenom>@example.com` / `Demo-Client-2026`

Avec `MAIL_PROVIDER=console`, les emails (bienvenue, confirmation, réinitialisation…) s'affichent dans le terminal.

### Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` / `npm start` | Build et serveur de production |
| `npm run typecheck` | Vérification TypeScript |
| `npm test` | Tests unitaires |
| `npm run db:migrate` | Nouvelle migration (dev) |
| `npm run db:deploy` | Appliquer les migrations (production) |
| `npm run db:seed` | Seed de base (idempotent) |
| `npm run db:studio` | Explorateur de données Prisma |

## 4. Premiers pas après installation

1. **Paramètres › Structure** : nom, raison sociale, coordonnées, réseaux sociaux, logo.
2. **Paramètres › Langues & devise** : devise (EUR, XOF, CAD…) et format des nombres.
3. **Offres › Nouvelle offre** : saisir vos conditions **réelles** (montants, durées, taux, frais, assurance,
   éligibilité, pièces requises), puis publier. Aucune offre n'est créée automatiquement en production.
4. **Paramètres › Conformité** : mentions légales, politique de confidentialité, conditions générales
   (textes à faire valider par un juriste).
5. **Administrateurs** : créer les comptes de l'équipe avec le rôle adapté.
6. Supprimer ou désactiver les offres `[DÉMO]` si le seed de démonstration a été utilisé.

## 5. Garde-fous métier et conformité

- **Mode pré-agrément (par défaut)** : tant que l'agrément n'est pas renseigné (Paramètres › Conformité,
  réservé au super-administrateur), un bandeau public indique qu'aucune offre de crédit n'est émise, les
  statuts « Approuvé » / « Refusé » sont **verrouillés** dans le back-office et un éventuel « Approuvé »
  s'affiche « Avis favorable » côté client. L'activation exige autorité de tutelle + numéro d'agrément.
- **Aucun paramètre commercial codé en dur** : taux, montants, durées, frais, assurance viennent des offres
  en base. Chaque demande conserve un instantané des conditions au moment du dépôt.
- **Simulation** : formule à mensualités constantes, cas du taux nul, frais et assurance inclus,
  mention « indicative, ne constitue pas une offre de crédit » partout.
- **Témoignages** : publiables uniquement si le consentement de l'auteur est coché **et daté**.
- **Statistiques publiques** : désactivées par défaut ; calculées en temps réel sur les données réelles
  (hors démo) et affichées seulement au-delà d'un seuil de dossiers.
- **Aucune demande de paiement** : la plateforme n'intègre aucun encaissement de frais préalable ; les emails
  rappellent qu'aucun paiement ne sera demandé.
- **Remboursements** : non implémentés volontairement (activité réglementée à cadrer avant tout développement).

## 6. Sécurité

| Mesure | Mise en œuvre |
|---|---|
| Mots de passe | bcrypt coût 12 ; politique 10 car. + majuscule + minuscule + chiffre |
| Sessions | JWT signé en cookie `httpOnly`, `SameSite=Lax`, `Secure` en prod ; table `sessions` pour révocation (déconnexion, changement de mot de passe, suspension) ; back-office ≤ 24 h |
| Protection des routes | `middleware.ts` (signature + type de compte) **puis** contrôle complet en base dans chaque layout et chaque Server Action |
| RBAC | 20 permissions granulaires, 5 rôles par défaut, matrice modifiable (super-admin) |
| Force brute | Limitation par IP et par email (table `rate_limits`, multi-instance) + verrouillage temporaire du compte |
| CSRF | Server Actions protégées nativement par Next.js (contrôle d'origine) ; cookies `SameSite=Lax` ; aucune route API en écriture |
| XSS | Échappement React ; variables d'emails échappées ; aucun HTML utilisateur rendu |
| Injections SQL | Prisma (requêtes paramétrées), y compris les requêtes brutes (`$queryRaw` tagué) |
| Fichiers | Taille ≤ 8 Mo, **vérification de la signature binaire** (PDF/JPG/PNG/WEBP), nom aléatoire, stockage hors `public/`, permissions 600, empreinte SHA-256 |
| Accès aux documents | Route dédiée : propriétaire ou permission `documents.view` ; 404 sinon ; en-têtes `no-store`, `nosniff`, CSP sandbox ; consultation journalisée |
| Exports | CSV protégé contre l'injection de formules ; exports journalisés |
| Journalisation | `audit_logs` : connexions, échecs, décisions, consultations de documents, modifications d'offres et de paramètres |
| En-têtes | HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy ; `noindex` sur /admin et /espace |
| Énumération de comptes | Messages de connexion et de réinitialisation neutres, hash factice pour égaliser les temps |

## 7. Déploiement

### Option A — VPS / serveur dédié (recommandé pour le stockage des justificatifs)

```bash
git clone … && cd aurane
npm ci
cp .env.example .env    # valeurs de production
npx prisma migrate deploy
npm run db:seed
npm run build
npm start               # ou pm2 start npm --name aurane -- start
```

- Placer `STORAGE_DIR` sur un disque persistant **sauvegardé** et non exposé par le serveur web.
- Reverse proxy Nginx/Caddy en HTTPS devant le port 3000.

### Option B — Vercel / plateformes serverless

Le système de fichiers y est éphémère : remplacer l'implémentation de `src/server/storage.ts`
(fonctions `storePrivate`, `readPrivate`, `storeMedia`, `readMedia`) par un stockage objet privé
(S3, Cloudflare R2, Supabase Storage). Le reste de l'application est inchangé.

### Cloudflare

- Proxy DNS activé, SSL « Full (strict) », WAF et règle de limitation sur `/connexion`, `/admin/connexion`, `/demande`.
- L'IP client est lue via `CF-Connecting-IP` (limitation de débit et audit).
- Ne pas mettre en cache `/espace/*`, `/admin/*`, `/api/*` (déjà `no-store`).

### Sauvegardes

- Base : `pg_dump` quotidien chiffré, rétention 30 jours minimum, test de restauration régulier
  (ou sauvegardes managées Neon / Supabase / RDS avec PITR).
- Justificatifs : synchronisation chiffrée du dossier `STORAGE_DIR` (ou versioning du bucket).

```bash
# exemple de tâche cron quotidienne
pg_dump "$DATABASE_URL" -Fc | gpg --encrypt -r ops@votre-domaine.com > backup-$(date +%F).dump.gpg
```

## 8. Variables d'environnement

Voir `.env.example` (commenté). Obligatoires : `DATABASE_URL`, `SESSION_SECRET` (≥ 32 caractères),
`APP_URL`. Pour l'envoi réel d'emails : `MAIL_PROVIDER` + `RESEND_API_KEY` ou `SMTP_*`.

## 9. Personnalisation

- **Textes du site** : Back-office › Contenus du site (FR / EN). Un champ vide = texte par défaut.
- **Ajouter une langue** : ajouter le code dans `LOCALES` et un dictionnaire dans `src/lib/i18n/dictionaries.ts`.
- **Statuts, types de documents, catégories** : `src/lib/status.ts`.
- **Permissions** : `src/lib/permissions.ts` puis `npm run db:seed` (les nouvelles permissions sont ajoutées
  et attribuées au super-admin).
- **Design system** : jetons dans `tailwind.config.ts` (palette bleu nuit / ardoise / turquoise / champagne).

## 10. Limites connues et évolutions conseillées

- Interface client et back-office en français ; le site public est bilingue FR/EN.
- Pas de double authentification pour le back-office : recommandée avant mise en production (TOTP).
- Pas d'antivirus sur les fichiers : envisager ClamAV ou un service d'analyse si le volume le justifie.
- Politique de conservation / purge des données personnelles à définir avec votre DPO, puis à automatiser.
