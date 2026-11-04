"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Permission } from "@/lib/rbac";
import { apiGet } from "@/lib/client/api";
import { getBusinessProfile, type BusinessProfile } from "@/lib/business-profiles";
import { applyBrand } from "@/lib/client/brand";

export interface SessionData {
  user: { id: string; email: string; firstName: string; lastName: string; role: string; avatarUrl?: string | null };
  company: {
    id: string;
    tradeName: string;
    appName?: string | null;
    logoUrl?: string | null;
    currency: string;
    timezone: string;
    businessType: string;
    vatEnabled: boolean;
    /** Le client se fait servir au magasin sur présentation de sa facture. */
    requiresPickup?: boolean;
    /** Facture imprimée à la caisse : ticket thermique 80 mm ou A4. */
    invoiceFormat?: "TICKET_80" | "A4";
  } | null;
  centers: Array<{ id: string; name: string; code: string; status: string }>;
  permissions: Permission[];
}

interface SessionContextValue {
  session: SessionData | null;
  /** Données issues du cache local (pas de réseau) : affichage seulement. */
  fromCache: boolean;
  loading: boolean;
  centerId: string | null;
  setCenterId: (id: string) => void;
  can: (permission: Permission) => boolean;
  currency: string;
  /** Réglages du métier de l'entreprise (libellés, unités, options par défaut). */
  profile: BusinessProfile;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);
const CACHE_KEY = "fishcore-session-cache";
const CENTER_KEY = "fishcore-selected-center";

function readCache(): SessionData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as SessionData) : null;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionData | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(true);
  const [centerId, setCenterIdState] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await apiGet<{ data: SessionData }>("/api/auth/me");
      setSession(data);
      setFromCache(false);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      } catch {
        /* stockage indisponible */
      }
      setCenterIdState((current) => {
        const saved = current ?? (typeof window !== "undefined" ? localStorage.getItem(CENTER_KEY) : null);
        return data.centers.some((c) => c.id === saved) ? saved : (data.centers[0]?.id ?? null);
      });
    } catch {
      // Hors connexion : on garde l'identité connue pour faire tourner la caisse
      const cached = readCache();
      if (cached) {
        setSession(cached);
        setFromCache(true);
        setCenterIdState((current) => current ?? localStorage.getItem(CENTER_KEY) ?? cached.centers[0]?.id ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [refresh]);

  // L'application porte le nom et le logo de l'entreprise connectée
  const company = session?.company;
  useEffect(() => {
    if (company) applyBrand({ companyId: company.id, name: company.appName || company.tradeName, logoUrl: company.logoUrl ?? null });
  }, [company]);

  const setCenterId = useCallback((id: string) => {
    setCenterIdState(id);
    try {
      localStorage.setItem(CENTER_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      fromCache,
      loading,
      centerId,
      setCenterId,
      can: (p) => session?.permissions.includes(p) ?? false,
      currency: session?.company?.currency ?? "XOF",
      profile: getBusinessProfile(session?.company?.businessType),
      refresh,
    }),
    [session, fromCache, loading, centerId, setCenterId, refresh]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession doit être utilisé dans <SessionProvider>");
  return ctx;
}

/** Efface l'identité mise en cache (à la déconnexion). */
export function clearSessionCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}
