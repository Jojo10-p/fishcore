import { PageHero } from "./page-hero";

export function LegalPage({ title, content, fallback }: { title: string; content: string; fallback: string }) {
  const body = content.trim();
  return (
    <>
      <PageHero title={title} />
      <div className="container">
        <div className="prose-legal max-w-3xl">
          {body ? (
            body.split(/\n{2,}/).map((block, i) =>
              block.startsWith("## ") ? <h2 key={i}>{block.slice(3)}</h2> : <p key={i} className="whitespace-pre-line">{block}</p>,
            )
          ) : (
            <p className="rounded-2xl border border-dashed border-night/15 p-8">{fallback}</p>
          )}
        </div>
      </div>
    </>
  );
}
