import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export function AuthShell({ title, text, children, aside, footer }: { title: string; text?: string; children: React.ReactNode; aside?: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section className="container grid gap-10 py-10 lg:grid-cols-12 lg:py-16">
      <div className="lg:col-span-6 xl:col-span-5">
        <h1 className="text-4xl font-extrabold">{title}</h1>
        {text && <p className="mt-3 text-ink-soft">{text}</p>}
        <div className="mt-8">{children}</div>
        {footer && <div className="mt-8 text-sm text-ink-soft">{footer}</div>}
      </div>
      <aside className="relative hidden overflow-hidden rounded-[28px] bg-night p-10 text-white lg:col-span-6 lg:col-start-7 lg:flex lg:flex-col xl:col-span-6 xl:col-start-7">
        <div className="grain pointer-events-none absolute inset-0" aria-hidden />
        <svg className="pointer-events-none absolute -bottom-8 right-0 w-full opacity-60" viewBox="0 0 400 200" aria-hidden>
          <path d="M0 30 C 120 40, 220 120, 400 190" fill="none" stroke="#20B6A5" strokeWidth="2" />
          <path d="M0 70 C 120 80, 220 150, 400 200" fill="none" stroke="#C9A96E" strokeWidth="1" strokeOpacity=".6" />
        </svg>
        <Link href="/" className="relative"><Logo invert /></Link>
        <div className="relative mt-auto">{aside}</div>
      </aside>
    </section>
  );
}
