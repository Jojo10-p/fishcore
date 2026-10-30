"use client";

import { useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";

// « Installer le logiciel » : l'application s'installe comme un logiciel
// (ordinateur Windows/Mac, tablette, téléphone) avec le nom et le logo de
// l'entreprise, et s'ouvre dans sa propre fenêtre, même sans Internet.

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

function isStandalone(): boolean {
  return typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
}

export function InstallAppButton({ appName, className }: { appName: string; className?: string }) {
  const [, force] = useState(0);
  const [help, setHelp] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const update = () => force((n) => n + 1);
    listeners.add(update);
    const t = setTimeout(() => setInstalled(isStandalone()), 0);
    return () => {
      listeners.delete(update);
      clearTimeout(t);
    };
  }, []);

  if (installed) return null;

  const install = async () => {
    if (!deferred) {
      setHelp(true);
      return;
    }
    await deferred.prompt();
    const choice = await deferred.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") deferred = null;
    force((n) => n + 1);
  };

  return (
    <>
      <button
        onClick={install}
        className={className ?? "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"}
      >
        <span aria-hidden>💻</span> Installer le logiciel
      </button>
      <Modal open={help} title={`Installer ${appName}`} onClose={() => setHelp(false)} footer={<Button onClick={() => setHelp(false)}>Compris</Button>}>
        <p className="text-sm text-gray-700">
          {appName} s&apos;installe comme un logiciel : une icône sur le bureau et dans le menu Démarrer, sa propre fenêtre, et la caisse continue de
          fonctionner sans Internet.
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-700">
          <li>
            <strong>Ordinateur (Chrome ou Edge)</strong> : cliquez sur l&apos;icône d&apos;installation à droite de la barre d&apos;adresse (un écran avec une flèche),
            ou menu <strong>⋮</strong> → <em>Caster, enregistrer et partager</em> → <em>Installer la page en tant qu&apos;application</em>.
          </li>
          <li>
            <strong>Téléphone Android</strong> : menu <strong>⋮</strong> de Chrome → <em>Ajouter à l&apos;écran d&apos;accueil</em> → <em>Installer</em>.
          </li>
          <li>
            <strong>iPhone / iPad</strong> : dans Safari, bouton <em>Partager</em> → <em>Sur l&apos;écran d&apos;accueil</em>.
          </li>
        </ol>
        <p className="text-xs text-gray-500">Si l&apos;option n&apos;apparaît pas, l&apos;application est peut-être déjà installée sur cet appareil.</p>
      </Modal>
    </>
  );
}
