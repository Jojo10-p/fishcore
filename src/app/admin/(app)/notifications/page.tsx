import Link from "next/link";
import { Pencil } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaff } from "@/server/auth/session";
import { PageHeader } from "@/components/client/app-shell";
import { Card } from "@/components/client/shared";
import { FormDialog } from "@/components/admin/form-dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { saveEmailTemplate } from "@/server/actions/admin/manage";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Emails & notifications" };
const PER = 30;

export default async function AdminNotifications({ searchParams }: { searchParams: Promise<{ page?: string; canal?: string }> }) {
  const sp = await searchParams;
  await requireStaff("notifications.manage");
  const page = Math.max(1, Number(sp.page) || 1);
  const where = sp.canal === "IN_APP" || sp.canal === "EMAIL" ? { channel: sp.canal as "IN_APP" | "EMAIL" } : {};
  const [templates, total, history, failed] = await Promise.all([
    db.emailTemplate.findMany({ orderBy: { name: "asc" } }),
    db.notification.count({ where }),
    db.notification.findMany({ where, include: { user: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER, take: PER }),
    db.notification.count({ where: { channel: "EMAIL", status: "FAILED" } }),
  ]);
  return (
    <>
      <PageHeader title="Emails & notifications" text={`Fournisseur d'envoi : ${process.env.MAIL_PROVIDER ?? "console"}${failed ? ` · ${failed} échec(s) d'envoi` : ""}`} />
      <Card title="Modèles d'emails" className="mb-6">
        <p className="mb-4 text-sm text-ink-soft">Variables disponibles entre doubles accolades, ex. <code className="rounded bg-mist px-1">{"{{firstName}}"}</code>. Les valeurs sont échappées automatiquement.</p>
        <ul className="-my-3 divide-y divide-night/[.06]">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1"><p className="font-medium">{t.name}</p><p className="truncate text-sm text-ink-faint">{t.subject}</p></div>
              <span className="hidden text-xs text-ink-faint md:inline">{t.variables.map((v) => `{{${v}}}`).join(" ")}</span>
              <FormDialog trigger={<><Pencil className="h-4 w-4" />Modifier</>} triggerProps={{ variant: "outline", size: "sm" }} title={t.name} description={`Variables : ${t.variables.map((v) => `{{${v}}}`).join(", ")}, {{orgName}}, {{appUrl}}`} action={saveEmailTemplate} wide>
                <input type="hidden" name="id" value={t.id} />
                <Field label="Objet" htmlFor="subject"><Input id="subject" name="subject" defaultValue={t.subject} required /></Field>
                <Field label="Contenu" htmlFor="body" hint="Une ligne vide sépare les paragraphes."><Textarea id="body" name="body" rows={12} defaultValue={t.body} required className="font-mono text-sm" /></Field>
              </FormDialog>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Historique des notifications" action={<div className="flex gap-3 text-sm">{[["", "Toutes"], ["EMAIL", "Emails"], ["IN_APP", "Internes"]].map(([v, l]) => <Link key={v} href={v ? `?canal=${v}` : "?"} className={(sp.canal ?? "") === v ? "font-semibold text-ink" : "text-ink-faint hover:text-ink"}>{l}</Link>)}</div>}>
        <div className="-mx-5 overflow-x-auto sm:-mx-6">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="text-[13px] text-ink-faint"><tr><th className="px-6 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Canal</th><th className="px-4 py-2 font-medium">Destinataire</th><th className="px-4 py-2 font-medium">Titre</th><th className="px-4 py-2 font-medium">État</th></tr></thead>
            <tbody className="divide-y divide-night/[.06]">
              {history.map((n) => (
                <tr key={n.id}>
                  <td className="tabular whitespace-nowrap px-6 py-3 text-ink-soft">{formatDate(n.createdAt, "fr-FR", true)}</td>
                  <td className="px-4 py-3">{n.channel === "EMAIL" ? "Email" : "Interne"}</td>
                  <td className="px-4 py-3 text-ink-soft">{n.recipientEmail ?? (n.user ? `${n.user.firstName} ${n.user.lastName}` : "—")}</td>
                  <td className="max-w-xs truncate px-4 py-3">{n.title}</td>
                  <td className="px-4 py-3">{n.status === "FAILED" ? <Badge tone="red">{`Échec${n.error ? ` : ${n.error.slice(0, 40)}` : ""}`}</Badge> : n.channel === "IN_APP" ? (n.readAt ? <Badge tone="muted">Lue</Badge> : <Badge tone="info">Non lue</Badge>) : <Badge tone="green">Envoyé</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageCount={Math.ceil(total / PER)} total={total} buildHref={(p) => `/admin/notifications?${new URLSearchParams({ ...(sp.canal ? { canal: sp.canal } : {}), page: String(p) })}`} />
      </Card>
    </>
  );
}
