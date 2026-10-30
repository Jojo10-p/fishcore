"use client";

// Appels API côté navigateur : erreurs lisibles, redirection vers /login si la session expire.

export class ClientApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    // Rechargement complet volontaire : la session a expiré, on repart d'un état propre
    window.location.replace(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
  }
  if (!res.ok || body.success === false) {
    throw new ClientApiError(body.error ?? `Erreur ${res.status}`, res.status, body.code);
  }
  return body as T;
}

export async function apiGet<T = unknown>(url: string): Promise<T> {
  return handle<T>(await fetch(url, { cache: "no-store" }));
}

export async function apiSend<T = unknown>(url: string, body: unknown, method: "POST" | "PATCH" | "DELETE" = "POST"): Promise<T> {
  return handle<T>(
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Une erreur est survenue";
}
