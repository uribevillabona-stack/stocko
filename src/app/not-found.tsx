import type { Metadata } from "next";
import { Logo } from "@/components/layout/logo";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Página no encontrada" };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <Logo />
      <p className="mt-8 font-mono text-xs uppercase tracking-[0.18em] text-muted">Error 404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
        Esta página no existe
      </h1>
      <p className="mt-2 text-sm leading-6 text-muted">
        Puede que el enlace esté mal escrito o que la página ya no esté disponible.
      </p>
      <div className="mt-6">
        <ButtonLink href="/">Volver al inicio</ButtonLink>
      </div>
    </main>
  );
}
