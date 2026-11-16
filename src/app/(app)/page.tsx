import type { Metadata } from "next";
import { ArrowRight, Check, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { StockBadge } from "@/components/inventory/stock-badge";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { localDateKey, localDayRange } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatQuantity } from "@/lib/quantity";
import { requireMember } from "@/server/auth/context";
import { expireDueReservations, getInventoryOverview } from "@/server/services/inventory";
import { getSalesSummary, listSales } from "@/server/services/sales";

export const metadata: Metadata = { title: "Inicio" };

function Stat({
  href,
  label,
  value,
  detail,
  tone = "muted",
}: {
  href: string;
  label: string;
  value: string;
  detail: string;
  tone?: "muted" | "brand" | "warn";
}) {
  return (
    <Link
      href={href}
      className="card-link group rounded-2xl border border-border bg-card px-5 py-5 hover:border-brand/30"
    >
      <p className="flex items-center justify-between text-sm text-muted">
        {label}
        <ArrowRight
          className="size-4 -translate-x-1 opacity-0 transition-[opacity,transform] duration-300 group-hover:translate-x-0 group-hover:opacity-100"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </p>
      <p className="mt-2 text-[30px] font-bold leading-none tracking-tight text-ink tnum">{value}</p>
      <p
        className={cn(
          "mt-2 text-sm font-medium",
          tone === "brand" ? "text-brand" : tone === "warn" ? "text-warn" : "text-muted",
        )}
      >
        {detail}
      </p>
    </Link>
  );
}

function Step({ done, title, detail, action }: { done: boolean; title: string; detail: string; action?: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
          done ? "bg-accent text-white" : "border border-border bg-surface text-muted",
        )}
        aria-hidden="true"
      >
        {done ? <Check className="size-3.5" strokeWidth={2.5} /> : <span className="size-1.5 rounded-full bg-current" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium", done ? "text-muted line-through decoration-border" : "text-ink")}>{title}</p>
        <p className="mt-0.5 text-sm leading-5 text-muted">{detail}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </li>
  );
}

export default async function DashboardPage() {
  const context = await requireMember();
  const { user, business, role } = context;
  const isOwner = role === "owner";
  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;

  await expireDueReservations(business.id);
  const today = localDateKey(new Date(), business.timezone);
  const todayRange = localDayRange(today, today, business.timezone);
  const [overview, salesToday, recent, anySale] = await Promise.all([
    getInventoryOverview(business.id),
    getSalesSummary(business.id, todayRange.from, todayRange.to),
    listSales(business.id, { from: todayRange.from, to: todayRange.to, limit: 6 }),
    // "Primera venta" es de siempre, no solo de hoy.
    listSales(business.id, { limit: 1 }),
  ]);
  const money = (cents: number) => formatMoney(cents, business.currency);
  const time = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", timeZone: business.timezone });
  const longDate = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: business.timezone,
  }).format(new Date());

  const outCount = overview.alerts.filter((alert) => alert.status === "out").length;
  const lowCount = overview.alerts.filter((alert) => alert.status === "low").length;
  const stockDetail =
    overview.alertCount === 0
      ? "Todo en orden"
      : [outCount ? `${outCount} agotado${outCount === 1 ? "" : "s"}` : null, lowCount ? `${lowCount} bajo${lowCount === 1 ? "" : "s"}` : null]
          .filter(Boolean)
          .join(" · ") || `${overview.alertCount} por revisar`;

  const steps = [
    { done: true, title: "Cuenta y negocio creados", detail: `${business.name} quedó registrado.` },
    {
      done: overview.productCount > 0,
      title: "Primer producto",
      detail: "Crea tus productos con precio, stock inicial y stock mínimo.",
      action:
        overview.productCount > 0 ? undefined : (
          <ButtonLink href="/inventario/nuevo" variant="secondary" size="sm">
            Crear
          </ButtonLink>
        ),
    },
    {
      done: anySale.length > 0,
      title: "Primera venta",
      detail: "Registra ventas de contado o fiado; el stock se descuenta solo.",
    },
  ];
  const showSteps = steps.some((step) => !step.done);

  return (
    <>
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted first-letter:uppercase">{longDate}</p>
          <h1 className="mt-1 text-[32px] font-bold leading-tight tracking-tight text-ink">Hola, {firstName}</h1>
        </div>
        <ButtonLink href="/ventas/nueva" size="lg" className="w-full sm:w-auto">
          <Plus className="size-5" strokeWidth={2} />
          Nueva venta
        </ButtonLink>
      </header>

      <section aria-label="Resumen de hoy" className="stagger mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          href="/ventas?vista=hoy"
          label="Ventas de hoy"
          value={money(salesToday.totalCents)}
          detail={`${salesToday.count} ${salesToday.count === 1 ? "venta" : "ventas"}`}
          tone={salesToday.count > 0 ? "brand" : "muted"}
        />
        <Stat
          href="/ventas?vista=por-cobrar"
          label="Por cobrar"
          value={money(salesToday.receivableCents)}
          detail={
            salesToday.receivableCustomers === 0
              ? "Nadie te debe"
              : `${salesToday.receivableCustomers} ${salesToday.receivableCustomers === 1 ? "cliente con fiado" : "clientes con fiado"}`
          }
        />
        <Stat
          href={overview.alertCount > 0 ? "/inventario?filtro=alerts" : "/inventario"}
          label="Por reponer"
          value={String(overview.alertCount)}
          detail={stockDetail}
          tone={overview.alertCount > 0 ? "warn" : "brand"}
        />
      </section>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Ventas de hoy"
            description={recent.length ? "Las más recientes primero." : undefined}
            action={
              <ButtonLink href="/ventas?vista=hoy" variant="ghost" size="sm">
                Ver todas
              </ButtonLink>
            }
          />
          <CardBody>
            {recent.length === 0 ? (
              <div className="flex flex-col items-start gap-3 rounded-xl bg-surface px-4 py-5">
                <p className="text-sm text-muted">Todavía no hay ventas hoy.</p>
                <ButtonLink href="/ventas/nueva" variant="secondary" size="sm">
                  <Plus className="size-4" strokeWidth={2} />
                  Registrar la primera
                </ButtonLink>
              </div>
            ) : (
              <ul className="stagger -mx-2">
                {recent.map((sale) => {
                  const unpaid = sale.status === "completed" && sale.paidCents < sale.totalCents;
                  return (
                    <li key={sale.id}>
                      <Link
                        href={`/ventas/${sale.id}`}
                        className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-sm transition-colors hover:bg-hover"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-ink">
                          {sale.customerName ?? "Mostrador"}
                          <span className="font-normal text-muted"> · #{sale.number}</span>
                        </span>
                        {sale.status === "cancelled" ? <Badge tone="neutral">Anulada</Badge> : null}
                        {unpaid ? <Badge tone="warn">Fiado</Badge> : null}
                        <span className="text-muted tnum">{time.format(sale.createdAt)}</span>
                        <span
                          className={cn(
                            "w-24 text-right font-semibold tnum",
                            sale.status === "cancelled" ? "text-muted line-through" : "text-ink",
                          )}
                        >
                          {money(sale.totalCents)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Por reponer"
            description={`${overview.productCount} productos activos`}
            action={
              <ButtonLink href="/inventario" variant="ghost" size="sm">
                Inventario
              </ButtonLink>
            }
          />
          <CardBody>
            {overview.alertCount === 0 ? (
              <div className="flex items-center gap-3 rounded-xl bg-brand-soft px-4 py-4 text-sm text-brand">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-white">
                  <Check className="size-4" strokeWidth={2.5} aria-hidden="true" />
                </span>
                {overview.productCount === 0
                  ? "Aún no hay productos. Crea el primero para controlar tu stock."
                  : "Todo en orden: nada agotado ni bajo el mínimo."}
              </div>
            ) : (
              <>
                <ul className="stagger -mx-2">
                  {overview.alerts.map((alert, index) => (
                    <li key={`${alert.productId}-${index}`}>
                      <Link
                        href={`/inventario/${alert.productId}`}
                        className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-hover"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                          {alert.productName}
                          {alert.isDefault ? null : <span className="font-normal text-muted"> · {alert.variantName}</span>}
                        </span>
                        <span className="text-sm text-muted tnum">{formatQuantity(alert.availableMilli, alert.unit)}</span>
                        <StockBadge status={alert.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
                {overview.alertCount > overview.alerts.length ? (
                  <ButtonLink href="/inventario?filtro=alerts" variant="ghost" size="sm" className="mt-2">
                    Ver las {overview.alertCount} alertas
                  </ButtonLink>
                ) : null}
              </>
            )}
          </CardBody>
        </Card>

        {showSteps ? (
          <Card className="lg:col-span-5">
            <CardHeader title="Primeros pasos" description={isOwner ? "Tres pasos y tu negocio queda andando." : "Así empiezas a vender."} />
            <CardBody>
              <ol className="space-y-4">
                {steps.map((step) => (
                  <Step key={step.title} {...step} />
                ))}
              </ol>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
