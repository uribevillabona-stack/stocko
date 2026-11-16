import { ChevronRight, Plus, Receipt, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { inputStyles } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { addDaysToKey, formatDateTime, localDateKey, localDayRange } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { requireMember } from "@/server/auth/context";
import { listSales, type SaleFilter } from "@/server/services/sales";

export const metadata: Metadata = { title: "Ventas" };

type View = "hoy" | "semana" | "todas" | "por-cobrar" | "anuladas";

const views: Array<{ value: View; label: string }> = [
  { value: "hoy", label: "Hoy" },
  { value: "semana", label: "7 días" },
  { value: "todas", label: "Todas" },
  { value: "por-cobrar", label: "Por cobrar" },
  { value: "anuladas", label: "Anuladas" },
];

function parseView(value: string | string[] | undefined): View {
  return views.some((view) => view.value === value) ? (value as View) : "hoy";
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string | string[]; q?: string | string[] }>;
}) {
  const { business } = await requireMember();
  const params = await searchParams;
  const view = parseView(params.vista);
  const q = typeof params.q === "string" ? params.q.trim() : "";

  const today = localDateKey(new Date(), business.timezone);
  const range =
    view === "hoy"
      ? localDayRange(today, today, business.timezone)
      : view === "semana"
        ? localDayRange(addDaysToKey(today, -6), today, business.timezone)
        : undefined;
  const filter: SaleFilter = view === "por-cobrar" ? "unpaid" : view === "anuladas" ? "cancelled" : "all";

  const rows = await listSales(business.id, { filter, from: range?.from, to: range?.to, q });
  const completed = rows.filter((row) => row.status === "completed");
  const total = completed.reduce((sum, row) => sum + row.totalCents, 0);
  const pending = completed.reduce((sum, row) => sum + (row.totalCents - row.paidCents), 0);
  const money = (cents: number) => formatMoney(cents, business.currency);

  return (
    <>
      <PageHeader
        title="Ventas"
        description={
          view === "anuladas"
            ? `${rows.length} ventas anuladas`
            : `${completed.length} ventas · ${money(total)}${pending > 0 ? ` · ${money(pending)} por cobrar` : ""}`
        }
        action={
          <ButtonLink href="/ventas/nueva">
            <Plus className="size-4" strokeWidth={2} />
            Nueva venta
          </ButtonLink>
        }
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <form action="/ventas" className="relative flex-1 lg:max-w-sm" role="search">
          <input type="hidden" name="vista" value={view} />
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Número de venta o cliente"
            aria-label="Buscar ventas"
            className={cn(inputStyles, "pl-9")}
          />
        </form>
        <nav aria-label="Vistas" className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {views.map((item) => (
            <Link
              key={item.value}
              href={`/ventas?vista=${item.value}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              aria-current={item.value === view ? "page" : undefined}
              className={buttonStyles({
                variant: item.value === view ? "secondary" : "ghost",
                size: "sm",
                className: "shrink-0",
              })}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      {rows.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <Receipt className="size-8 text-muted" strokeWidth={1.5} aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-ink">No hay ventas en esta vista</p>
            <ButtonLink href="/ventas/nueva" size="sm" className="mt-4">
              Registrar una venta
            </ButtonLink>
          </div>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {rows.map((row) => {
              const balance = row.status === "completed" ? row.totalCents - row.paidCents : 0;
              return (
                <li key={row.id}>
                  <Link
                    href={`/ventas/${row.id}`}
                    className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-ink">#{row.number}</p>
                        <p className="truncate text-sm text-ink">{row.customerName ?? "Mostrador"}</p>
                        {row.status === "cancelled" ? <Badge tone="danger">Anulada</Badge> : null}
                        {balance > 0 ? <Badge tone="warn">Debe {money(balance)}</Badge> : null}
                      </div>
                      <p className="mt-0.5 text-xs text-muted">
                        {formatDateTime(row.createdAt, business.timezone)} · {row.itemCount}{" "}
                        {row.itemCount === 1 ? "producto" : "productos"}
                      </p>
                    </div>
                    <p
                      className={cn(
                        "shrink-0 text-sm font-semibold tnum",
                        row.status === "cancelled" ? "text-muted line-through" : "text-ink",
                      )}
                    >
                      {money(row.totalCents)}
                    </p>
                    <ChevronRight className="size-4 shrink-0 text-muted" strokeWidth={1.75} aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
