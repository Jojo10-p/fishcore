"use client";
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Boîte de dialogue basée sur <dialog> natif (focus piégé, Échap, accessible). */
export function Dialog({ open, onClose, title, description, children, className }: { open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode; className?: string }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn("w-[min(92vw,520px)] rounded-2xl border-0 p-0 text-ink shadow-lift backdrop:bg-night/50 backdrop:backdrop-blur-[2px]", className)}
      aria-labelledby="dlg-title"
    >
      <div className="p-6 sm:p-7">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="dlg-title" className="text-lg font-bold">{title}</h2>
            {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-ink-faint hover:bg-mist hover:text-ink" aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
