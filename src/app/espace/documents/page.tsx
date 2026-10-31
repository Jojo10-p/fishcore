import { FileText } from "lucide-react";
import { db } from "@/lib/db";
import { requireCustomer } from "@/server/auth/session";
import { PageHeader } from "@/components/client/app-shell";
import { Card, DocumentRow } from "@/components/client/shared";
import { UploadForm } from "@/components/client/upload-form";
import { DeleteDocButton } from "@/components/client/delete-doc-button";
import { EmptyState } from "@/components/ui/surface";
import Link from "next/link";

export default async function MyDocuments() {
  const user = await requireCustomer();
  const [docs, apps, requests] = await Promise.all([
    db.applicationDocument.findMany({ where: { customerId: user.customer.id, deletedAt: null }, include: { application: true }, orderBy: { createdAt: "desc" } }),
    db.loanApplication.findMany({ where: { customerId: user.customer.id, deletedAt: null, status: { not: "CLOSED" } }, select: { id: true, reference: true }, orderBy: { createdAt: "desc" } }),
    db.documentRequest.findMany({ where: { fulfilledAt: null, application: { customerId: user.customer.id, deletedAt: null, status: { notIn: ["CLOSED", "REJECTED"] } } }, include: { application: true } }),
  ]);
  return (
    <>
      <PageHeader title="Mes documents" text="Vos justificatifs, leur statut de vérification et les pièces demandées." />
      {requests.length > 0 && (
        <Card title="Pièces demandées" className="mb-6">
          <ul className="space-y-2 text-sm">
            {requests.map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-2"><span className="font-medium">{r.label}</span><Link href={`/espace/demandes/${r.applicationId}`} className="font-medium text-teal-700 hover:underline">Transmettre — {r.application.reference}</Link></li>)}
          </ul>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Téléverser un document" className="lg:order-2">
          <UploadForm applications={apps} />
          <p className="mt-4 text-xs leading-relaxed text-ink-faint">Le contenu des fichiers est vérifié à la réception. Ils sont conservés dans un espace privé, jamais exposés publiquement.</p>
        </Card>
        <Card title={`Documents (${docs.length})`} className="lg:col-span-2">
          {docs.length === 0 ? (
            <EmptyState icon={<FileText className="h-5 w-5" />} title="Aucun document" text="Les justificatifs transmis apparaîtront ici avec leur statut." />
          ) : (
            <ul className="-my-4 divide-y divide-night/[.06]">
              {docs.map((d) => (
                <DocumentRow key={d.id} doc={d} actions={d.status === "PENDING" ? <DeleteDocButton id={d.id} name={d.originalName} /> : undefined} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
