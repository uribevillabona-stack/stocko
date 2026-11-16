import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "@/components/layout/logo";

const points = [
  "Vende en segundos: toca el producto y cobra.",
  "El inventario se descuenta solo con cada venta.",
  "Accesos separados para dueño y empleados.",
];

/** Vista previa decorativa de la app (no es interactiva). */
function Preview() {
  return (
    <div aria-hidden="true" className="relative mt-12 h-56 w-full max-w-sm">
      <div className="absolute left-0 top-0 w-64 animate-float rounded-2xl border border-border bg-card p-5 shadow-(--shadow-lift)">
        <p className="text-sm text-muted">Ventas de hoy</p>
        <p className="mt-2 text-3xl font-bold tracking-tight text-ink">$ 86.500</p>
        <p className="mt-1 text-sm font-medium text-brand">7 ventas</p>
      </div>
      <div className="absolute bottom-0 right-0 flex w-64 animate-float items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 shadow-(--shadow-lift) [animation-delay:-3.5s]">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-white">
          <Check className="size-4" strokeWidth={2.5} />
        </span>
        <span className="text-sm font-medium text-ink">Venta registrada. El stock ya se actualizó.</span>
      </div>
    </div>
  );
}

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
      <section className="hidden flex-col justify-between bg-brand-soft p-10 lg:flex">
        <Logo />
        <div className="page-enter max-w-md">
          <h2 className="text-[34px] font-bold leading-tight tracking-tight text-ink">
            Tu tienda, en orden y sin complicaciones.
          </h2>
          <ul className="mt-6 space-y-3">
            {points.map((point) => (
              <li key={point} className="flex items-start gap-3 text-[15px] text-ink/80">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-white">
                  <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
          <Preview />
        </div>
        <p className="text-sm text-muted">Funciona en el computador, el celular y sin internet en Windows.</p>
      </section>

      <section className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="page-enter mx-auto w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-[28px] font-bold tracking-tight text-ink">{title}</h1>
          {description ? <p className="mt-2 text-[15px] leading-6 text-muted">{description}</p> : null}
          <div className="mt-8">{children}</div>
          {footer ? <div className="mt-6 text-sm text-muted">{footer}</div> : null}
        </div>
      </section>
    </main>
  );
}
