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
/** Installée depuis cet onglet pendant la visite (la page, elle, reste un onglet). */
let justInstalled = false;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    justInstalled = true;
    listeners.forEach((l) => l());
  });
}

function isStandalone(): boolean {
  if (justInstalled) return true;
  return typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
}

/** État d'installation partagé : déjà installée ? installation en un clic possible ? */
function useInstall() {
  const [, force] = useState(0);
  const [help, setHelp] = useState(false);
  const [installed, setInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    const update = () => {
      force((n) => n + 1);
      if (!deferred) setInstalled(isStandalone());
    };
    listeners.add(update);
    const t = setTimeout(() => setInstalled(isStandalone()), 0);
    return () => {
      listeners.delete(update);
      clearTimeout(t);
    };
  }, []);

  const install = async (): Promise<boolean> => {
    if (!deferred) {
      setHelp(true);
      return false;
    }
    await deferred.prompt();
    const choice = await deferred.userChoice.catch(() => null);
    const ok = choice?.outcome === "accepted";
    if (ok) deferred = null;
    force((n) => n + 1);
    return ok;
  };

  return { installed, install, help, setHelp };
}

export function InstallAppButton({ appName, className }: { appName: string; className?: string }) {
  const { installed, install, help, setHelp } = useInstall();
  if (installed !== false) return null;

  return (
    <>
      <button
        onClick={() => void install()}
        className={className ?? "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"}
      >
        <span aria-hidden>💻</span> Installer {appName}
      </button>
      <InstallHelp appName={appName} open={help} onClose={() => setHelp(false)} />
    </>
  );
}

function InstallHelp({ appName, open, onClose }: { appName: string; open: boolean; onClose: () => void }) {
  return (
    <>
      <Modal open={open} title={`Installer ${appName}`} onClose={onClose} footer={<Button onClick={onClose}>Compris</Button>}>
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

const DISMISS_KEY = "fishcore-install-dismissed";

/**
 * Proposition d'installation, montrée APRÈS l'inscription de l'entreprise
 * (fin de la configuration, puis tableau de bord tant que ce n'est pas fait) :
 * le logiciel s'installe sous le nom et avec le logo de l'entreprise.
 */
export function InstallInvite({
  appName,
  logoUrl,
  variant = "banner",
  onDone,
}: {
  appName: string;
  logoUrl?: string | null;
  variant?: "banner" | "card";
  onDone?: () => void;
}) {
  const { installed, install, help, setHelp } = useInstall();
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
      } catch {
        setDismissed(false);
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const later = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
    onDone?.();
  };
  const go = async () => {
    if (await install()) onDone?.();
  };

  const icon = (
    // eslint-disable-next-line @next/next/no-img-element -- logo de l'entreprise (adresse dynamique)
    <img src={logoUrl || "/icons/icon-192.png"} alt="" className={variant === "card" ? "h-20 w-20 rounded-2xl border border-gray-200 bg-white object-contain shadow" : "h-12 w-12 shrink-0 rounded-xl border border-gray-200 bg-white object-contain"} />
  );

  if (variant === "card") {
    if (installed === null) return null;
    return (
      <div className="text-center">
        <div className="flex justify-center">{icon}</div>
        <p className="mt-2 text-sm font-semibold text-gray-900">{appName}</p>
        {installed ? (
          <p className="mt-3 text-sm text-green-700">✓ {appName} est installé sur cet appareil.</p>
        ) : (
          <>
            <p className="mt-3 text-sm text-gray-600">
              Installez <strong>{appName}</strong> sur cet ordinateur : une icône à votre nom sur le bureau, sa propre fenêtre, et la caisse qui
              continue de marcher sans Internet.
            </p>
            <button onClick={() => void go()} className="mt-4 w-full rounded-xl bg-blue-600 py-3 font-semibold text-white transition-colors hover:bg-blue-700">
              💻 Installer {appName}
            </button>
          </>
        )}
        <InstallHelp appName={appName} open={help} onClose={() => setHelp(false)} />
      </div>
    );
  }

  if (installed !== false || dismissed !== false) return null;
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-center">
      {icon}
      <div className="flex-1 text-sm">
        <p className="font-semibold text-gray-900">Installez {appName} sur cet appareil</p>
        <p className="text-gray-600">Une icône {appName} sur le bureau, sa propre fenêtre, et la caisse qui marche même sans Internet.</p>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={later}>
          Plus tard
        </Button>
        <Button onClick={() => void go()}>Installer</Button>
      </div>
      <InstallHelp appName={appName} open={help} onClose={() => setHelp(false)} />
    </div>
  );
}
