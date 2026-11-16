import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/layout/logo";

export const metadata: Metadata = { title: "Sin conexión" };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <Logo />
      <h1 className="mt-8 text-2xl font-semibold tracking-tight text-ink">Sin conexión</h1>
      <p className="mt-2 text-sm leading-6 text-muted">
        No pudimos cargar esta página. Revisa tu conexión y vuelve a intentarlo. Los cambios que
        hayas guardado en el servidor siguen intactos.
      </p>
      <Link
        href="/"
        prefetch={false}
        className="mt-6 inline-flex h-10 w-fit items-center justify-center rounded-xl bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-strong"
      >
        Reintentar
      </Link>
    </main>
  );
}
