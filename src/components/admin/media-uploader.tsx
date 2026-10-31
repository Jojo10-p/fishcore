"use client";
import { submitWith } from "@/components/forms/use-submit";
import { useActionState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { uploadMedia, type MediaState } from "@/server/actions/admin/manage";

export function MediaUploader() {
  const [state, action, pending] = useActionState<MediaState, FormData>(uploadMedia, undefined);
  return (
    <form onSubmit={submitWith(action)} className="space-y-3">
      <Input type="file" name="file" accept="image/png,image/jpeg,image/webp" required className="py-2" />
      <Input name="alt" placeholder="Texte alternatif (accessibilité)" />
      <Button type="submit" size="sm" variant="outline" loading={pending}>Téléverser</Button>
      {state && !state.ok && <p className="text-sm text-[#B03030]">{state.message}</p>}
      {state?.url && (
        <div className="rounded-xl bg-paper p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={state.url} alt="" className="mb-2 max-h-28 rounded-lg" />
          <button type="button" onClick={() => { navigator.clipboard.writeText(state.url!); toast.success("Adresse copiée"); }} className="flex w-full items-center gap-2 text-left font-mono text-xs text-teal-700"><Copy className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{state.url}</span></button>
        </div>
      )}
    </form>
  );
}
