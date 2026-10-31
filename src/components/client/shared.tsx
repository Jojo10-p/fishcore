import Link from "next/link";
import { FileText, ImageIcon, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { APPLICATION_STATUS_META, DOCUMENT_STATUS_META, DOCUMENT_TYPES } from "@/lib/status";
import { formatBytes, formatDate } from "@/lib/utils";
import type { ApplicationStatus, DocumentStatus } from "@/generated/prisma/enums";

export function StatusBadge({ status, licensed = true }: { status: ApplicationStatus; licensed?: boolean }) {
  const m = APPLICATION_STATUS_META[status];
  // Tant que l'activité n'est pas autorisée, une « approbation » n'est présentée que comme un avis favorable.
  const label = !licensed && status === "APPROVED" ? "Avis favorable" : m.label;
  return <Badge tone={m.tone}>{label}</Badge>;
}

export function DocStatusBadge({ status }: { status: DocumentStatus }) {
  const m = DOCUMENT_STATUS_META[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function Timeline({ items, licensed = true }: { items: { id: string; toStatus: ApplicationStatus; publicComment: string | null; createdAt: Date }[]; licensed?: boolean }) {
  return (
    <ol className="relative space-y-6 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-night/10">
      {items.map((h, i) => (
        <li key={h.id} className="relative pl-8">
          <span className="absolute left-0 top-1 h-[15px] w-[15px] rounded-full border-[3px] border-paper" style={{ background: i === 0 ? APPLICATION_STATUS_META[h.toStatus].color : "#C7CFDB" }} aria-hidden />
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={h.toStatus} licensed={licensed} />
            <time className="text-xs text-ink-faint">{formatDate(h.createdAt, "fr-FR", true)}</time>
          </div>
          {h.publicComment && <p className="mt-2 whitespace-pre-line text-sm text-ink-soft">{h.publicComment}</p>}
        </li>
      ))}
    </ol>
  );
}

export function DocumentRow({ doc, actions }: { doc: { id: string; type: string; originalName: string; mimeType: string; size: number; status: DocumentStatus; createdAt: Date; reviewNote?: string | null }; actions?: React.ReactNode }) {
  const Icon = doc.mimeType === "application/pdf" ? FileText : ImageIcon;
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-mist text-slate2"><Icon className="h-5 w-5" strokeWidth={1.6} /></span>
        <div className="min-w-0">
          <a href={`/api/documents/${doc.id}`} target="_blank" rel="noopener" className="block truncate font-medium hover:text-teal-700">{doc.originalName}</a>
          <p className="text-xs text-ink-faint">{DOCUMENT_TYPES[doc.type] ?? doc.type} · {formatBytes(doc.size)} · {formatDate(doc.createdAt)}</p>
          {doc.status === "REJECTED" && doc.reviewNote && <p className="mt-1 text-xs text-[#B03030]">Motif : {doc.reviewNote}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 pl-[52px] sm:pl-0">
        <DocStatusBadge status={doc.status} />
        <a href={`/api/documents/${doc.id}?download=1`} className="rounded-lg p-2 text-ink-faint hover:bg-mist hover:text-ink" aria-label={`Télécharger ${doc.originalName}`}><Download className="h-4 w-4" /></a>
        {actions}
      </div>
    </li>
  );
}

export function KeyValue({ rows, cols = 2 }: { rows: [string, React.ReactNode][]; cols?: 2 | 3 }) {
  return (
    <dl className={`grid gap-x-8 gap-y-4 sm:grid-cols-2 ${cols === 3 ? "lg:grid-cols-3" : ""}`}>
      {rows.map(([k, v]) => (
        <div key={k}><dt className="text-[13px] text-ink-faint">{k}</dt><dd className="mt-0.5 break-words font-medium">{v || "—"}</dd></div>
      ))}
    </dl>
  );
}

export function Card({ title, action, children, className = "" }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-night/[.07] bg-white ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-4 border-b border-night/[.06] px-5 py-4 sm:px-6">
          <h2 className="font-display text-[17px] font-bold">{title}</h2>
          {action}
        </div>
      )}
      <div className="px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}

export function LinkMore({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="text-sm font-medium text-teal-700 hover:underline">{children}</Link>;
}
