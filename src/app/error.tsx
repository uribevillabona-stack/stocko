"use client";

import { Logo } from "@/components/layout/logo";
import { Button, ButtonLink } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <Logo />
      <h1 className="mt-8 text-2xl font-semibold tracking-tight text-ink">Algo salió mal</h1>
      <p className="mt-2 text-sm leading-6 text-muted">
        No pudimos completar la operación. Vuelve a intentarlo; si el problema sigue, revisa la
        conexión con la base de datos.
      </p>
      {error.digest ? (
        <p className="mt-3 font-mono text-xs text-muted">Código: {error.digest}</p>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={reset}>Reintentar</Button>
        <ButtonLink href="/" variant="secondary">
          Ir al inicio
        </ButtonLink>
      </div>
    </main>
  );
}
