import Link from "next/link";
import type { ReactNode } from "react";
import { LegalLinks } from "@/components/legal/legal-links";
import { Logo } from "@/components/layout/logo";

/** Páginas legales: públicas (sin sesión) y estáticas, para que también abran sin internet en Windows. */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 py-8 sm:py-12">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 print:hidden">
        <Link href="/" aria-label="Stocko: ir al inicio">
          <Logo />
        </Link>
        <LegalLinks className="text-sm" />
      </header>
      <main className="page-enter mt-10 flex-1">{children}</main>
      <footer className="mt-12 border-t border-border pt-5 text-xs text-muted print:hidden">
        <Link href="/" className="hover:text-ink hover:underline">
          ← Volver a Stocko
        </Link>
      </footer>
    </div>
  );
}
