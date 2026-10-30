# Mise en production : Vercel + Supabase

## 1. Base de données (Supabase)

1. Créer un projet sur supabase.com. **Région : Paris (eu-west-3)** — la plus proche du Bénin,
   et la même que celle des fonctions Vercel (`cdg1`, réglée dans `vercel.json`).
   Si le projet est à Francfort (eu-central-1), mettre `"regions": ["fra1"]` dans `vercel.json`.
2. *Project Settings → Database → Connection string* :
   - **Transaction pooler** (port 6543) → `DATABASE_URL`
   - **Session pooler** (port 5432) → `DIRECT_URL`
3. Facultatif : *SSL Configuration → Download certificate* → `DATABASE_CA_CERT`
   (vérification complète du certificat ; sans elle, la connexion reste chiffrée).

## 2. Projet Vercel

1. Pousser le code sur GitHub, puis sur vercel.com : *Add New → Project → Import* le dépôt.
   Le framework (Next.js) et la commande de build (`npm run vercel-build`) sont détectés via `vercel.json`.
2. *Settings → Environment Variables* (Production **et** Preview) :

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | URL du *Transaction pooler* (6543) |
| `DIRECT_URL` | URL du *Session pooler* (5432) |
| `JWT_SECRET` | `openssl rand -base64 32` |
| `INSTALL_LINK_SECRET` | `openssl rand -base64 32` (une autre valeur) |
| `NEXT_PUBLIC_APP_URL` | `https://votre-domaine` (ou l'adresse `.vercel.app`) |
| `NEXT_PUBLIC_APP_NAME` | nom affiché, ex. `fishcore` |
| `DATABASE_CA_CERT` | facultatif, voir plus haut |
| `NEXT_PUBLIC_SUPPORT_CONTACT` | facultatif : contact de l'assistance affiché aux propriétaires (« Mot de passe oublié »), ex. `WhatsApp +229 01 00 00 00 00` |

   L'application refuse de démarrer en production sans `JWT_SECRET` et `INSTALL_LINK_SECRET`.
3. *Deploy*. Le build :
   1. génère le client Prisma ;
   2. applique les migrations (`prisma migrate deploy`, via `DIRECT_URL`) ;
   3. rejoue les garde-fous SQL (`scripts/apply-sql-guards.mjs`) ;
   4. compile l'application.
4. Vérifier : `https://votre-domaine/api/health` doit répondre `{"ok":true,"database":"ok",…}`.
   Cette adresse peut être surveillée (UptimeRobot, Better Stack…) : elle ne renvoie aucune donnée.
5. Créer l'entreprise sur `/register`, puis dans *Paramètres* : IFU, RCCM, adresse, mentions de bas de
   facture, préfixe et **prochain numéro de facture** (suite de l'ancien logiciel).

Chaque `git push` sur la branche principale redéploie. Les caisses se mettent à jour d'elles-mêmes
à leur prochaine connexion (le cache hors ligne est renouvelé à chaque version).

## 3. Postes de caisse (Windows + XP-80C)

0. **Installer le logiciel** : une fois connecté, menu de gauche → **💻 Installer le logiciel** (ou *Paramètres → Votre
   application*). L'application s'installe sous le nom de l'entreprise, avec son logo comme icône (bureau, menu Démarrer),
   et s'ouvre dans sa propre fenêtre, même sans Internet. Le logo se change dans *Paramètres*.

1. **Imprimante** : pilote XP-80C installé, définie comme **imprimante par défaut** de Windows ;
   *Propriétés → Options avancées → Format du papier* : **80(72.1) x 3276 mm**.
2. **Chrome** : ouvrir l'adresse de l'application, se connecter, puis *⋮ → Caster, enregistrer et partager →
   Installer la page en tant qu'application* (ou l'icône d'installation dans la barre d'adresse).
3. **Impression sans boîte de dialogue** (comme Sage) : créer un raccourci sur le bureau avec la cible
   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --app=https://votre-domaine/caisse
   ```
   Lors de la première impression manuelle, choisir la XP-80C et *Marges : Aucune* : Chrome retient ces réglages.
4. Ouvrir la caisse **avec connexion** : elle reçoit sa plage de numéros de facture, l'en-tête des tickets
   et le catalogue. Ensuite, elle se tient à jour toute seule (stock, prix, articles), rien à préparer.

## 4. Pendant une coupure d'Internet

- La caisse continue : ventes, **facture imprimée avec son numéro définitif**, monnaie rendue.
- Rien à préparer avant : la caisse vend avec le dernier stock reçu. Un article vendu au-delà du stock
  enregistré est signalé (« stock à vérifier ») et l'écart est régularisé et tracé à l'envoi.
- La caisse garde 150 à 250 numéros de facture d'avance, renouvelés à chaque synchronisation.
- Seul un devis ne s'encaisse pas hors ligne (son prix doit être vérifié sur le serveur).
- Au retour du réseau, les ventes partent aussitôt au serveur, avec leur heure réelle.
- La clôture de caisse se fait avec connexion (toutes les ventes doivent être envoyées).

## 5. Assistance

- **Employé qui a oublié son mot de passe** : son responsable ouvre *Utilisateurs* → **🔑 Mot de passe** et lui envoie le
  lien par WhatsApp/SMS (valable 24 h, une seule fois). Aucun e-mail n'est nécessaire.
- **Propriétaire qui a oublié son mot de passe** (et pas d'autre propriétaire) : après vérification de son identité,
  générer le lien depuis un poste qui a les variables de production :
  ```
  npm run reset-link -- adresse@email.bj
  ```
- **Suppression d'un compte** : le propriétaire le fait lui-même (*Paramètres → Supprimer le compte*, mot de passe + nom de
  l'entreprise recopié). Tout est effacé en une transaction ; l'e-mail peut resservir aussitôt.
- **Journal d'audit** : *Administration → Journal d'audit* (propriétaire), avec vérification de l'intégrité.

## 6. Sauvegardes

Les sauvegardes automatiques dépendent de l'offre Supabase (quotidiennes à partir de l'offre Pro ;
l'offre gratuite n'en garantit pas) : vérifier dans *Database → Backups*. En complément, faire une copie
régulière : `pg_dump "$DIRECT_URL" > sauvegarde-AAAA-MM-JJ.sql`, conservée hors de Supabase.
