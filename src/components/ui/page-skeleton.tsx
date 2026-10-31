import { Skeleton } from "./surface";

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-8 grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      <Skeleton className="mt-6 h-72 rounded-2xl" />
    </div>
  );
}
