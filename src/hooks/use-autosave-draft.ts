"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getOfflineDB } from "@/lib/offline/db";

// ─────────────────────────────────────────────
// Sauvegarde automatique d'un formulaire (cahier §8.3, §11.1, §19)
// ─────────────────────────────────────────────
// Chaque modification est écrite dans IndexedDB après un court délai, et
// immédiatement quand la page passe en arrière-plan. Après une coupure de
// courant ou un redémarrage, le brouillon est proposé à la réouverture.

export type DraftStatus = "loading" | "idle" | "saving" | "saved" | "error";

interface Options {
  /** Délai avant écriture (ms). Court : une coupure peut survenir à tout moment. */
  delay?: number;
  /** Ne rien sauvegarder tant que faux (ex. formulaire vide). */
  enabled?: boolean;
}

export function useAutosaveDraft<T>(key: string, value: T, { delay = 400, enabled = true }: Options = {}) {
  const [status, setStatus] = useState<DraftStatus>("loading");
  const [restored, setRestored] = useState<{ data: T; updatedAt: string } | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const latest = useRef(value);
  const loaded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latest.current = value;
  }, [value]);

  // Tant qu'un brouillon retrouvé n'est ni repris ni écarté, on ne l'écrase pas
  const awaitingDecision = restored !== null;
  const awaitingRef = useRef(false);
  useEffect(() => {
    awaitingRef.current = awaitingDecision;
  }, [awaitingDecision]);

  const write = useCallback(async () => {
    if (!loaded.current || awaitingRef.current) return;
    try {
      setStatus("saving");
      const updatedAt = new Date().toISOString();
      await getOfflineDB().drafts.put({ key, data: latest.current, updatedAt });
      setSavedAt(new Date(updatedAt));
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }, [key]);

  // Chargement du brouillon existant
  useEffect(() => {
    let cancelled = false;
    getOfflineDB()
      .drafts.get(key)
      .then((draft) => {
        if (cancelled) return;
        if (draft) setRestored({ data: draft.data as T, updatedAt: draft.updatedAt });
        loaded.current = true;
        setStatus("idle");
      })
      .catch(() => {
        loaded.current = true;
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  // Écriture différée à chaque modification
  useEffect(() => {
    if (!enabled || !loaded.current || awaitingDecision) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void write(), delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, enabled, delay, write, awaitingDecision]);

  // Écriture immédiate quand l'onglet est masqué ou fermé
  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      if (document.visibilityState === "hidden") void write();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [enabled, write]);

  /** Supprime le brouillon (après validation réussie ou abandon volontaire). */
  const clear = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    await getOfflineDB().drafts.delete(key);
    setRestored(null);
    setSavedAt(null);
    setStatus("idle");
  }, [key]);

  /** Le brouillon proposé a été repris ou écarté. */
  const dismissRestored = useCallback(() => setRestored(null), []);

  return { status, savedAt, restored, dismissRestored, clear };
}
