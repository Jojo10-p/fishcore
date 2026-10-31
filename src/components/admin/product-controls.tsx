"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { Archive, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { toggleProduct, archiveProduct, restoreProduct } from "@/server/actions/admin/products";

export function ProductToggle({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <span className="text-ink-soft">{active ? "Publiée" : "Masquée"}</span>
      <button
        type="button"
        role="switch"
        aria-checked={active}
        disabled={pending}
        onClick={() => start(async () => { const r = await toggleProduct(id, !active); toast.success(r.message); })}
        className={`relative h-6 w-11 rounded-full transition ${active ? "bg-teal" : "bg-mist"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${active ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

export function ArchiveProduct({ id, hasApplications }: { id: string; hasApplications: boolean }) {
  return (
    <ConfirmButton variant="outline" size="sm" title={hasApplications ? "Archiver cette offre ?" : "Supprimer cette offre ?"} description={hasApplications ? "L'offre est liée à des demandes : elle sera archivée (masquée) et les dossiers conservés." : "Aucune demande n'est liée à cette offre : elle sera supprimée définitivement."} confirmLabel={hasApplications ? "Archiver" : "Supprimer"} onConfirm={() => archiveProduct(id)}>
      <Archive className="h-4 w-4" />{hasApplications ? "Archiver" : "Supprimer"}
    </ConfirmButton>
  );
}

export function RestoreProduct({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return <Button variant="outline" size="sm" loading={pending} onClick={() => start(async () => { const r = await restoreProduct(id); toast.success(r.message); })}><RotateCcw className="h-4 w-4" />Restaurer</Button>;
}
