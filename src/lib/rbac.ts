import { UserRole } from "@prisma/client";

// ─────────────────────────────────────────────
// Matrice de permissions RBAC
// ─────────────────────────────────────────────

export type Permission =
  | "company:view"
  | "company:edit"
  | "center:view"
  | "center:create"
  | "center:edit"
  | "center:delete"
  | "user:view"
  | "user:create"
  | "user:edit"
  | "user:deactivate"
  | "product:view"
  | "product:create"
  | "product:edit"
  | "product:delete"
  | "product:price" // changer un prix de vente déjà fixé (historisé, signalé à la direction)
  | "product:import" // import en masse (Sage, Excel) : direction, gérant
  | "unit:manage" // réglages des unités (vente au détail, décimales) : direction, gérant
  | "stock:view"
  | "stock:receive"
  | "stock:adjust"
  | "stock:transfer"
  | "stock:loss"
  | "inventory:start"
  | "inventory:validate"
  | "sale:create"
  | "sale:view"
  | "sale:view_all"
  | "sale:cancel_request"
  | "sale:cancel_approve"
  | "sale:refund"
  | "sale:discount"
  | "sale:deliver"
  | "quote:view"
  | "quote:create"
  | "quote:cancel"
  | "cash:open_session"
  | "cash:close_session"
  | "cash:close_session_validate"
  | "cash:view_session"
  | "cash:view_all_sessions"
  | "cash:movement"
  | "cash:register_manage"
  | "supplier:view"
  | "supplier:create"
  | "supplier:edit"
  | "purchase:view"
  | "purchase:create"
  | "expense:view"
  | "expense:create"
  | "expense:cancel"
  | "customer:view"
  | "customer:edit"
  | "supplier:payment"
  | "document:create"
  | "document:export"
  | "dashboard:view" // tableau de bord (chacun ses chiffres ; tout pour qui a sale:view_all)
  | "report:view"
  | "report:export"
  | "audit:view"
  | "notification:view"
  | "notification:configure"
  | "install_link:generate"
  | "platform:admin";

// Permissions par rôle
const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  PLATFORM_ADMIN: ["platform:admin", "company:view", "audit:view"],

  COMPANY_OWNER: [
    "company:view", "company:edit",
    "center:view", "center:create", "center:edit", "center:delete",
    "user:view", "user:create", "user:edit", "user:deactivate",
    "product:view", "product:create", "product:edit", "product:delete", "product:price", "unit:manage", "product:import",
    "stock:view", "stock:receive", "stock:adjust", "stock:transfer", "stock:loss",
    "inventory:start", "inventory:validate",
    "sale:create", "sale:view", "sale:view_all",
    "sale:cancel_request", "sale:cancel_approve", "sale:refund", "sale:discount",
    "cash:open_session", "cash:close_session", "cash:close_session_validate",
    "cash:view_session", "cash:view_all_sessions", "cash:movement", "cash:register_manage",
    "supplier:view", "supplier:create", "supplier:edit",
    "purchase:view", "purchase:create",
    "expense:view", "expense:create", "expense:cancel",
    "customer:view", "customer:edit", "supplier:payment",
    "quote:view", "quote:create", "quote:cancel", "sale:deliver",
    "document:create", "document:export",
    "report:view", "report:export",
    "audit:view",
    "notification:view", "notification:configure",
    "install_link:generate",
    "dashboard:view",
  ],

  // Gérant : comme la direction pour la boutique, y compris ajouter des utilisateurs
  CENTER_MANAGER: [
    "center:view",
    "user:view", "user:create", "user:edit", "user:deactivate",
    "dashboard:view",
    "product:view", "product:create", "product:edit", "product:price", "unit:manage", "product:import",
    "stock:view", "stock:receive", "stock:adjust", "stock:transfer", "stock:loss",
    "inventory:start", "inventory:validate",
    "sale:view", "sale:view_all",
    "sale:cancel_approve", "sale:refund", "sale:discount",
    "cash:open_session", "cash:close_session", "cash:close_session_validate",
    "cash:view_session", "cash:view_all_sessions", "cash:movement", "cash:register_manage",
    "supplier:view", "supplier:create", "supplier:edit",
    "purchase:view", "purchase:create",
    "expense:view", "expense:create", "expense:cancel",
    "customer:view", "customer:edit", "supplier:payment",
    "quote:view", "quote:create", "quote:cancel", "sale:deliver",
    "document:create", "document:export",
    "report:view", "report:export",
    "audit:view",
    "notification:view",
    "install_link:generate",
  ],

  // Caissier et magasinier : vendent, ajoutent du stock, créent et changent les prix
  // (chaque ajout / changement est signalé à la direction et reste dans l'historique).
  // Ils ne peuvent pas : annuler une vente (seulement la demander), ajouter des
  // utilisateurs, effacer ou masquer quoi que ce soit, voir les historiques
  // (ventes des autres, bénéfices, prix, journal, clôtures des autres), ni les paramètres.
  CASHIER: [
    "dashboard:view",
    "product:view", "product:create", "product:edit", "product:price",
    "stock:view", "stock:receive",
    "sale:create", "sale:view",
    "sale:cancel_request",
    "cash:open_session", "cash:close_session", "cash:view_session",
    "expense:create", // dépense payée avec l'argent de sa caisse
    "supplier:view", "supplier:create",
    "purchase:view", "purchase:create",
    "customer:view", "customer:edit",
    "quote:view", "quote:create",
    "document:create",
    "notification:view",
  ],

  ACCOUNTANT: [
    "dashboard:view",
    "product:view",
    "stock:view",
    "sale:view", "sale:view_all",
    "cash:view_session", "cash:view_all_sessions",
    "supplier:view",
    "purchase:view",
    "expense:view",
    "customer:view",
    "quote:view",
    "document:export",
    "report:view", "report:export",
    "notification:view",
  ],

  STOCK_MANAGER: [
    "dashboard:view",
    "product:view", "product:create", "product:edit", "product:price",
    "stock:view", "stock:receive", "stock:adjust", "stock:transfer", "stock:loss",
    "inventory:start", "inventory:validate",
    "sale:create", "sale:view",
    "sale:cancel_request",
    "cash:open_session", "cash:close_session", "cash:view_session",
    "expense:create",
    "supplier:view", "supplier:create",
    "purchase:view", "purchase:create",
    "customer:view", "customer:edit",
    "sale:deliver", "quote:view", "quote:create",
    "document:create",
    "notification:view",
  ],

  SALES_EMPLOYEE: [
    "dashboard:view",
    "product:view",
    "stock:view",
    "sale:create", "sale:view",
    "sale:cancel_request",
    "customer:view", "customer:edit",
    "quote:view", "quote:create", "sale:deliver",
    "document:create",
    "notification:view",
  ],
};

/**
 * Vérifie si un rôle possède une permission donnée.
 * Cette vérification doit TOUJOURS être faite côté serveur.
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * Retourne toutes les permissions d'un rôle.
 */
export function getPermissions(role: UserRole): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/**
 * Vérifie si un utilisateur a au moins une des permissions listées.
 */
export function hasAnyPermission(
  role: UserRole,
  permissions: Permission[]
): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

/**
 * Étiquettes françaises pour les rôles
 */
export const ROLE_LABELS: Record<UserRole, string> = {
  PLATFORM_ADMIN: "Super administrateur plateforme",
  COMPANY_OWNER: "Propriétaire",
  CENTER_MANAGER: "Gérant de centre",
  CASHIER: "Caissier",
  ACCOUNTANT: "Comptable",
  STOCK_MANAGER: "Magasinier",
  SALES_EMPLOYEE: "Employé vendeur",
};
