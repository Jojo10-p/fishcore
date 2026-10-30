// ─────────────────────────────────────────────
// Client de l'API e-MCF de la DGI (facture normalisée e-MECeF, Bénin)
// ─────────────────────────────────────────────
// Circuit : POST facture → la DGI calcule les taxes et renvoie un uid → on
// vérifie le total → PUT {uid}/confirm → éléments de sécurité (code MECeF/DGI,
// QR code, compteurs, NIM, date). Authentification : jeton JWT de l'e-MCF
// (un par contribuable), en « Bearer ».

export type EmecfMode = "test" | "production";

const BASE_URLS: Record<EmecfMode, string> = {
  production: "https://sygmef.impots.bj/emcf/api/invoice",
  test: "https://developper.impots.bj/sygmef-emcf/api/invoice",
};

/** Adresse de l'API de facturation (surchargeable pour les tests : EMECF_BASE_URL_TEST / _PRODUCTION). */
export function emecfBaseUrl(mode: EmecfMode): string {
  const override = mode === "production" ? process.env.EMECF_BASE_URL_PRODUCTION : process.env.EMECF_BASE_URL_TEST;
  return (override || BASE_URLS[mode]).replace(/\/$/, "");
}

export interface EmecfItem {
  code?: string;
  name: string;
  price: number;
  quantity: number;
  taxGroup: string;
  taxSpecific?: number;
  originalPrice?: number;
  priceModification?: string;
}

export interface EmecfInvoiceRequest {
  ifu: string;
  type: "FV" | "FA" | "EV" | "EA";
  aib?: "A" | "B";
  reference?: string;
  items: EmecfItem[];
  client?: { ifu?: string; name?: string; contact?: string; address?: string };
  operator: { id?: string; name: string };
  payment?: Array<{ name: string; amount: number }>;
}

export interface EmecfInvoiceResponse {
  uid?: string | null;
  ta?: number;
  tb?: number;
  tc?: number;
  td?: number;
  taa?: number;
  tab?: number;
  tac?: number;
  tad?: number;
  tae?: number;
  taf?: number;
  hab?: number;
  had?: number;
  vab?: number;
  vad?: number;
  aib?: number;
  ts?: number;
  total?: number;
  errorCode?: string | null;
  errorDesc?: string | null;
}

export interface EmecfSecurityElements {
  dateTime?: string;
  qrCode?: string;
  codeMECeFDGI?: string;
  counters?: string;
  nim?: string;
  errorCode?: string | null;
  errorDesc?: string | null;
}

export interface EmecfStatus {
  status?: boolean;
  version?: string;
  ifu?: string;
  nim?: string;
  tokenValid?: string;
  serverDateTime?: string;
  pendingRequestsCount?: number;
  pendingRequestsList?: Array<{ date: string; uid: string }>;
}

/**
 * Erreur e-MCF :
 *  - network  : DGI injoignable / délai dépassé → on réessaiera
 *  - auth     : jeton invalide ou expiré → à corriger dans les paramètres
 *  - rejected : données refusées par la DGI (errorCode) → à corriger
 *  - server   : erreur interne DGI (5xx) → on réessaiera
 */
export class EmecfError extends Error {
  constructor(
    public kind: "network" | "auth" | "rejected" | "server",
    message: string,
    public code?: string
  ) {
    super(message);
  }
  get retryable(): boolean {
    return this.kind === "network" || this.kind === "server";
  }
}

const TIMEOUT_MS = Number(process.env.EMECF_TIMEOUT_MS ?? 15_000);

async function request<T>(mode: EmecfMode, token: string, method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${emecfBaseUrl(mode)}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (e) {
    throw new EmecfError("network", controller.signal.aborted ? "La DGI ne répond pas (délai dépassé)" : `DGI injoignable : ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (res.status === 401 || res.status === 403) throw new EmecfError("auth", "Jeton e-MCF refusé par la DGI (invalide ou expiré)", String(res.status));
  if (res.status >= 500) throw new EmecfError("server", `Erreur du serveur DGI (${res.status})`, String(res.status));
  const err = data as { errorCode?: string | null; errorDesc?: string | null } | null;
  if (err?.errorCode && String(err.errorCode) !== "0") {
    throw new EmecfError("rejected", err.errorDesc || `Refus DGI (code ${err.errorCode})`, String(err.errorCode));
  }
  if (res.status >= 400) throw new EmecfError("rejected", err?.errorDesc || `Requête refusée par la DGI (${res.status})`, String(res.status));
  return { status: res.status, data: (data ?? {}) as T };
}

export function getStatus(mode: EmecfMode, token: string): Promise<EmecfStatus> {
  return request<EmecfStatus>(mode, token, "GET", "/").then((r) => r.data);
}

export function submitInvoice(mode: EmecfMode, token: string, body: EmecfInvoiceRequest): Promise<EmecfInvoiceResponse> {
  return request<EmecfInvoiceResponse>(mode, token, "POST", "/", body).then((r) => r.data);
}

/**
 * Confirme ou annule une facture en attente. Les versions de la spécification
 * nomment l'action « confirm/cancel » ou « confirmer/annuler » : si la première
 * forme n'existe pas sur le serveur (404/405, rien n'a été fait), on essaie l'autre.
 */
export async function finalizeInvoice(mode: EmecfMode, token: string, uid: string, action: "confirm" | "cancel"): Promise<EmecfSecurityElements> {
  const names = action === "confirm" ? ["confirm", "confirmer"] : ["cancel", "annuler"];
  let last: unknown;
  for (const name of names) {
    try {
      return (await request<EmecfSecurityElements>(mode, token, "PUT", `/${encodeURIComponent(uid)}/${name}`)).data;
    } catch (e) {
      last = e;
      if (!(e instanceof EmecfError && e.kind === "rejected" && (e.code === "404" || e.code === "405"))) throw e;
    }
  }
  throw last;
}
