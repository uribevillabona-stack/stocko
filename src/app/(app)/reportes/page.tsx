import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BarList, DailyBars } from "@/components/reports/charts";
import { PageHeader } from "@/components/layout/page-header";
import { Button, buttonStyles } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { inputStyles } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { addDaysToKey, formatDate, isDateKey, localDateKey, localDayRange } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { formatQuantity } from "@/lib/quantity";
import { PAYMENT_METHOD_LABELS } from "@/lib/validation/sales";
import { requireOwner } from "@/server/auth/context";
import { getBalanceSnapshot, getMoneyReport } from "@/server/services/reports";

export const metadata: Metadata = { title: "Reportes" };

type Preset = "hoy" | "7d" | "30d" | "mes" | "mes-anterior" | "rango";

const presets: Array<{ value: Exclude<Preset, "rango">; label: string }> = [
  { value: "hoy", label: "Hoy" },
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
  { value: "mes", label: "Este mes" },
  { value: "mes-anterior", label: "Mes anterior" },
];

function resolveRange(
  params: { periodo?: string; desde?: string; hasta?: string },
  today: string,
): { preset: Preset; fromKey: string; toKey: string } {
  const monthStart = `${today.slice(0, 8)}01`;
  if (params.desde && params.hasta && isDateKey(params.desde) && isDateKey(params.hasta)) {
    const [fromKey, toKey] = params.desde <= params.hasta ? [params.desde, params.hasta] : [params.hasta, params.desde];
    // Máximo un año por consulta.
    const limited = fromKey < addDaysToKey(toKey, -366) ? addDaysToKey(toKey, -366) : fromKey;
    return { preset: "rango", fromKey: limited, toKey };
  }
  switch (params.periodo) {
    case "hoy":
      return { preset: "hoy", fromKey: today, toKey: today };
    case "30d":
      return { preset: "30d", fromKey: addDaysToKey(today, -29), toKey: today };
    case "mes":
      return { preset: "mes", fromKey: monthStart, toKey: today };
    case "mes-anterior": {
      const lastDay = addDaysToKey(monthStart, -1);
      return { preset: "mes-anterior", fromKey: `${lastDay.slice(0, 8)}01`, toKey: lastDay };
    }
    default:
      return { preset: "7d", fromKey: addDaysToKey(today, -6), toKey: today };
  }
}

function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  tone?: "warn" | "success";
}) {
  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-4">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tracking-tight tnum",
          tone === "warn" ? "text-warn" : tone === "success" ? "text-success" : "text-ink",
        )}
      >
        {value}
      </p>
      {detail ? <p className="mt-0.5 text-xs text-muted">{detail}</p> : null}
    </div>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { business } = await requireOwner();
  const raw = await searchParams;
  const params = {
    periodo: typeof raw.periodo === "string" ? raw.periodo : undefined,
    desde: typeof raw.desde === "string" ? raw.desde : undefined,
    hasta: typeof raw.hasta === "string" ? raw.hasta : undefined,
  };

  const tz = business.timezone;
  const today = localDateKey(new Date(), tz);
  const { preset, fromKey, toKey } = resolveRange(params, today);
  const range = localDayRange(fromKey, toKey, tz);

  const [report, snapshot] = await Promise.all([
    getMoneyReport(business.id, { from: range.from, to: range.to, timeZone: tz }),
    getBalanceSnapshot(business.id),
  ]);

  const money = (cents: number) => formatMoney(cents, business.currency);
  const percent = (ratio: number) =>
    new Intl.NumberFormat("es-CO", { style: "percent", maximumFractionDigits: 1 }).format(ratio);
  const dayLabel = (key: string) =>
    new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "UTC" }).format(
      new Date(`${key}T12:00:00Z`),
    );

  // Serie diaria completa (días sin ventas en cero).
  const byDay = new Map(report.byDay.map((row) => [row.day, row]));
  const series: Array<{ day: string; value: number; detail: string }> = [];
  for (let key = fromKey; key <= toKey; key = addDaysToKey(key, 1)) {
    const row = byDay.get(key);
    series.push({
      day: key,
      value: row?.revenueCents ?? 0,
      detail: `${row?.count ?? 0} ${row?.count === 1 ? "venta" : "ventas"}`,
    });
  }

  const periodLabel =
    fromKey === toKey
      ? formatDate(new Date(`${fromKey}T12:00:00Z`), "UTC")
      : `${formatDate(new Date(`${fromKey}T12:00:00Z`), "UTC")} – ${formatDate(new Date(`${toKey}T12:00:00Z`), "UTC")}`;

  return (
    <>
      <PageHeader title="Reportes" description={`Dinero y márgenes · ${periodLabel}`} />

      <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <nav aria-label="Periodo" className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {presets.map((item) => (
            <Link
              key={item.value}
              href={`/reportes?periodo=${item.value}`}
              aria-current={item.value === preset ? "page" : undefined}
              className={buttonStyles({
                variant: item.value === preset ? "secondary" : "ghost",
                size: "sm",
                className: "shrink-0",
              })}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <form action="/reportes" className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">
            Desde
            <input type="date" name="desde" defaultValue={fromKey} max={today} className={cn(inputStyles, "mt-1 h-9 w-40")} />
          </label>
          <label className="text-xs text-muted">
            Hasta
            <input type="date" name="hasta" defaultValue={toKey} max={today} className={cn(inputStyles, "mt-1 h-9 w-40")} />
          </label>
          <Button type="submit" variant={preset === "rango" ? "secondary" : "ghost"} size="sm">
            Ver rango
          </Button>
        </form>
      </div>

      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Ventas"
            value={money(report.revenueCents)}
            detail={`${report.count} ${report.count === 1 ? "venta" : "ventas"} · ticket promedio ${money(report.averageTicketCents)}`}
          />
          <Stat
            label="Ganancia bruta"
            value={money(report.grossProfitCents)}
            tone={report.grossProfitCents >= 0 ? "success" : "warn"}
            detail={
              report.marginRatio === null
                ? "Sin ventas"
                : `Margen ${percent(report.marginRatio)} · costo ${money(report.costCents)}`
            }
          />
          <Stat
            label="Dinero recibido"
            value={money(report.byMethod.reduce((sum, row) => sum + row.amountCents, 0))}
            detail="Pagos y abonos del periodo"
          />
          <Stat
            label="Quedó por cobrar"
            value={money(report.pendingCents)}
            tone={report.pendingCents > 0 ? "warn" : undefined}
            detail={report.discountCents > 0 ? `Descuentos dados: ${money(report.discountCents)}` : "De las ventas del periodo"}
          />
        </div>

        {report.costCoverage < 1 ? (
          <p className="rounded-xl border border-warn/25 bg-warn-soft px-4 py-3 text-sm text-warn">
            Solo el {percent(report.costCoverage)} de lo vendido tiene costo registrado, así que la ganancia
            real es menor que la mostrada. Agrega el costo en cada producto para que el margen sea exacto.
          </p>
        ) : null}

        <Card>
          <CardHeader title="Ventas por día" description="Total vendido cada día del periodo." />
          <CardBody>
            <DailyBars data={series} formatValue={money} formatDay={dayLabel} />
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-medium text-brand">Ver como tabla</summary>
              <table className="mt-2 w-full text-sm tnum">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-1 font-medium">Día</th>
                    <th className="py-1 text-right font-medium">Ventas</th>
                    <th className="py-1 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {series.filter((point) => point.value > 0).map((point) => (
                    <tr key={point.day}>
                      <td className="py-1.5">{dayLabel(point.day)}</td>
                      <td className="py-1.5 text-right">{point.detail}</td>
                      <td className="py-1.5 text-right">{money(point.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </CardBody>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Dinero recibido por medio" description="Por fecha de pago, incluye abonos." />
            <CardBody>
              <BarList
                rows={report.byMethod.map((row) => ({
                  key: row.method,
                  label: PAYMENT_METHOD_LABELS[row.method],
                  value: row.amountCents,
                  detail: `${row.count} ${row.count === 1 ? "pago" : "pagos"}`,
                }))}
                formatValue={money}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Ventas por persona" description="Quién registró cada venta." />
            <CardBody>
              <BarList
                rows={report.bySeller.map((row, index) => ({
                  key: `${row.name}-${index}`,
                  label: row.name,
                  value: row.revenueCents,
                  detail: `${row.count} ${row.count === 1 ? "venta" : "ventas"}`,
                }))}
                formatValue={money}
              />
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Productos más vendidos"
            description="Top 10 por valor vendido. La ganancia por producto es antes de los descuentos de cada venta."
          />
          {report.topProducts.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">Sin ventas en este periodo.</p>
            </CardBody>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm tnum">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-5 py-2 font-medium">Producto</th>
                    <th className="px-3 py-2 text-right font-medium">Cantidad</th>
                    <th className="px-3 py-2 text-right font-medium">Vendido</th>
                    <th className="px-5 py-2 text-right font-medium">Ganancia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.topProducts.map((row, index) => (
                    <tr key={row.productId ?? index}>
                      <td className="px-5 py-2.5">
                        {row.productId ? (
                          <Link href={`/inventario/${row.productId}`} className="text-ink hover:text-brand">
                            {row.name}
                          </Link>
                        ) : (
                          row.name
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-muted">{formatQuantity(row.qtyMilli, row.unit)}</td>
                      <td className="px-3 py-2.5 text-right">{money(row.revenueCents)}</td>
                      <td className="px-5 py-2.5 text-right">
                        {row.profitCents === null ? <span className="text-muted">Sin costo</span> : money(row.profitCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Mejores clientes" description="Por valor comprado en el periodo." />
            <CardBody>
              <BarList
                rows={report.topCustomers.map((row) => ({
                  key: row.customerId,
                  label: row.name,
                  value: row.revenueCents,
                  detail: `${row.count} ${row.count === 1 ? "compra" : "compras"}`,
                }))}
                formatValue={money}
                emptyLabel="Ninguna venta con cliente en este periodo."
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Cartera hoy"
              description={`${money(snapshot.receivableCents)} por cobrar en ${snapshot.receivableSales} ${snapshot.receivableSales === 1 ? "venta" : "ventas"}.`}
            />
            {snapshot.debtors.length === 0 ? (
              <CardBody>
                <p className="text-sm text-muted">Nadie te debe dinero.</p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-border">
                {snapshot.debtors.map((debtor) => (
                  <li key={debtor.customerId}>
                    <Link
                      href={`/clientes/${debtor.customerId}`}
                      className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-surface"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink">{debtor.name}</span>
                        <span className="block text-xs text-muted">
                          {debtor.phone ? `${formatPhone(debtor.phone)} · ` : ""}desde {formatDate(debtor.oldest, tz)}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-medium text-warn tnum">{money(debtor.cents)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader title="Inventario valorizado" description="Stock físico actual de productos activos." />
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted">A costo</dt>
                <dd className="mt-1 text-lg font-semibold text-ink tnum">{money(snapshot.inventoryCostCents)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">A precio de venta</dt>
                <dd className="mt-1 text-lg font-semibold text-ink tnum">{money(snapshot.inventoryPriceCents)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Ganancia potencial</dt>
                <dd className="mt-1 text-lg font-semibold text-ink tnum">
                  {money(snapshot.inventoryPriceCents - snapshot.inventoryCostCents)}
                </dd>
              </div>
            </dl>
            {snapshot.uncostedVariants > 0 ? (
              <p className="mt-3 text-xs text-warn">
                {snapshot.uncostedVariants} {snapshot.uncostedVariants === 1 ? "producto con stock no tiene" : "productos con stock no tienen"} costo: no
                suman al valor a costo.
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
