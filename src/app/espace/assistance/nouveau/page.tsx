import { db } from "@/lib/db";
import { requireCustomer } from "@/server/auth/session";
import { PageHeader } from "@/components/client/app-shell";
import { Card } from "@/components/client/shared";
import { ActionForm } from "@/components/forms/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { createTicket } from "@/server/actions/customer";

export default async function NewTicket({ searchParams }: { searchParams: Promise<{ dossier?: string }> }) {
  const { dossier } = await searchParams;
  const user = await requireCustomer();
  const apps = await db.loanApplication.findMany({ where: { customerId: user.customer.id, deletedAt: null }, select: { id: true, reference: true }, orderBy: { createdAt: "desc" } });
  return (
    <>
      <PageHeader title="Contacter un conseiller" text="Réponse dans votre espace, avec notification par email." />
      <Card className="max-w-2xl">
        <ActionForm action={createTicket} submitLabel="Envoyer" fieldLabels={{ subject: "Sujet", message: "Message" }}>
          <Field label="Dossier concerné" htmlFor="applicationId">
            <Select id="applicationId" name="applicationId" defaultValue={dossier ?? ""}>
              <option value="">Question générale</option>
              {apps.map((a) => <option key={a.id} value={a.id}>{a.reference}</option>)}
            </Select>
          </Field>
          <Field label="Sujet" htmlFor="subject"><Input id="subject" name="subject" required /></Field>
          <Field label="Message" htmlFor="message"><Textarea id="message" name="message" rows={7} required /></Field>
        </ActionForm>
      </Card>
    </>
  );
}
