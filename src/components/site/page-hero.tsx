export function PageHero({ label, title, text, children }: { label?: string; title: string; text?: string; children?: React.ReactNode }) {
  return (
    <section className="container pb-10 pt-10 lg:pb-14 lg:pt-16">
      {label && <p className="label-sm mb-4">{label}</p>}
      <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.05] sm:text-[3.4rem]">{title}</h1>
      {text && <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-soft">{text}</p>}
      {children}
    </section>
  );
}
