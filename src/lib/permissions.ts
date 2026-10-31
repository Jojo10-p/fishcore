export const PERMISSIONS = {
  "dashboard.view": { label: "Voir le tableau de bord", group: "Général" },
  "applications.view": { label: "Consulter les demandes", group: "Demandes" },
  "applications.update": { label: "Traiter les demandes (statut, notes, pièces)", group: "Demandes" },
  "applications.decide": { label: "Approuver / refuser une demande", group: "Demandes" },
  "applications.export": { label: "Exporter un dossier", group: "Demandes" },
  "documents.view": { label: "Consulter les documents", group: "Documents" },
  "documents.review": { label: "Valider / rejeter les documents", group: "Documents" },
  "customers.view": { label: "Consulter les clients", group: "Clients" },
  "customers.manage": { label: "Gérer les comptes clients", group: "Clients" },
  "products.view": { label: "Consulter les offres", group: "Offres" },
  "products.manage": { label: "Gérer les offres", group: "Offres" },
  "content.manage": { label: "Modifier les contenus du site", group: "Contenus" },
  "testimonials.manage": { label: "Gérer les témoignages", group: "Contenus" },
  "faq.manage": { label: "Gérer la FAQ", group: "Contenus" },
  "messages.manage": { label: "Messages de contact & assistance", group: "Relation client" },
  "notifications.manage": { label: "Modèles d'emails & historique", group: "Notifications" },
  "users.manage": { label: "Gérer les administrateurs", group: "Administration" },
  "roles.manage": { label: "Gérer les rôles et permissions", group: "Administration" },
  "settings.manage": { label: "Paramètres généraux", group: "Administration" },
  "audit.view": { label: "Journal d'audit", group: "Administration" },
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

export const DEFAULT_ROLES: { key: string; name: string; description: string; permissions: PermissionKey[] }[] = [
  { key: "super_admin", name: "Super administrateur", description: "Accès complet, y compris rôles et conformité.", permissions: ALL_PERMISSIONS },
  {
    key: "admin",
    name: "Administrateur",
    description: "Gestion complète de l'activité, hors rôles.",
    permissions: ALL_PERMISSIONS.filter((p) => p !== "roles.manage"),
  },
  {
    key: "financial_agent",
    name: "Agent financier",
    description: "Instruction des dossiers de financement.",
    permissions: ["dashboard.view", "applications.view", "applications.update", "applications.decide", "applications.export", "documents.view", "documents.review", "customers.view", "products.view", "messages.manage"],
  },
  {
    key: "customer_manager",
    name: "Responsable clientèle",
    description: "Relation client, comptes et assistance.",
    permissions: ["dashboard.view", "applications.view", "documents.view", "customers.view", "customers.manage", "messages.manage", "products.view"],
  },
  {
    key: "content_editor",
    name: "Éditeur de contenu",
    description: "Textes, FAQ, témoignages et SEO.",
    permissions: ["dashboard.view", "content.manage", "testimonials.manage", "faq.manage", "products.view"],
  },
];
