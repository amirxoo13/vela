import type { ReactNode } from "react";
import { APP_VERSION } from "@/lib/version";

export function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-ink text-paper">
      <article className="mx-auto w-full max-w-2xl px-5 py-8 pb-16">
        <a href="/" className="text-sm font-extrabold tracking-[0.2em] text-paper/80">
          MELOBI
        </a>
        <h1 className="mt-4 font-display text-5xl leading-none">{title}</h1>
        <div className="mt-6 flex flex-col gap-4 text-[15px] leading-relaxed text-paper/90">{children}</div>
        <nav className="mt-10 flex flex-wrap gap-4 text-sm font-bold text-paper/75" aria-label="Melobi pages">
          <a href="/">Home</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/about">About</a>
        </nav>
        <p className="mt-4 text-xs font-bold text-paper/50">Melobi {APP_VERSION}</p>
      </article>
    </div>
  );
}
