"use client";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/ui/confirm";
import { deleteCustomerDocument } from "@/server/actions/customer";

export function DeleteDocButton({ id, name }: { id: string; name: string }) {
  return (
    <ConfirmButton
      variant="ghost"
      size="icon"
      aria-label={`Retirer ${name}`}
      title="Retirer ce document ?"
      description={`« ${name} » sera retiré de votre espace. Cette action est possible tant que le document n'a pas été vérifié.`}
      confirmLabel="Retirer"
      onConfirm={async () => {
        const r = await deleteCustomerDocument(id);
        r.ok ? toast.success(r.message) : toast.error(r.message);
      }}
    >
      <Trash2 className="h-4 w-4" />
    </ConfirmButton>
  );
}
