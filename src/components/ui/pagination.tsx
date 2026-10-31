import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Pagination({ page, pageCount, total, buildHref }: { page: number; pageCount: number; total: number; buildHref: (p: number) => string }) {
  if (pageCount <= 1) return <p className="px-1 pt-4 text-sm text-ink-faint">{total} résultat{total > 1 ? "s" : ""}</p>;
  const btn = "inline-flex h-9 items-center gap-1 rounded-full border border-night/10 bg-white px-3 text-sm hover:border-night/30";
  return (
    <nav className="flex items-center justify-between gap-3 pt-4" aria-label="Pagination">
      <p className="text-sm text-ink-faint">{total} résultats · page {page} sur {pageCount}</p>
      <div className="flex gap-2">
        {page > 1 ? <Link className={btn} href={buildHref(page - 1)}><ChevronLeft className="h-4 w-4" /> Précédent</Link> : <span className={cn(btn, "opacity-40")}><ChevronLeft className="h-4 w-4" /> Précédent</span>}
        {page < pageCount ? <Link className={btn} href={buildHref(page + 1)}>Suivant <ChevronRight className="h-4 w-4" /></Link> : <span className={cn(btn, "opacity-40")}>Suivant <ChevronRight className="h-4 w-4" /></span>}
      </div>
    </nav>
  );
}
