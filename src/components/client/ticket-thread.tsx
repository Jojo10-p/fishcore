import { cn, formatDate, initials } from "@/lib/utils";

export function TicketThread({ messages, viewer }: { messages: { id: string; body: string; isStaff: boolean; createdAt: Date; author: { firstName: string; lastName: string } }[]; viewer: "client" | "staff" }) {
  return (
    <ol className="space-y-5">
      {messages.map((m) => {
        const mine = viewer === "staff" ? m.isStaff : !m.isStaff;
        return (
          <li key={m.id} className={cn("flex gap-3", mine && "flex-row-reverse")}>
            <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold", m.isStaff ? "bg-night text-white" : "bg-champagne-100 text-champagne-700")}>{initials(m.author.firstName, m.author.lastName)}</span>
            <div className={cn("max-w-[80%] rounded-2xl px-4 py-3", mine ? "rounded-tr-sm bg-night text-white" : "rounded-tl-sm bg-paper")}>
              <p className={cn("text-xs", mine ? "text-white/55" : "text-ink-faint")}>{m.isStaff ? (viewer === "client" ? "Conseiller" : `${m.author.firstName} ${m.author.lastName}`) : `${m.author.firstName} ${m.author.lastName}`} · {formatDate(m.createdAt, "fr-FR", true)}</p>
              <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed">{m.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
