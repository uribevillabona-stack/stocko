import { ChevronRight, Plus, Search, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { inputStyles } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { requireMember } from "@/server/auth/context";
import { listCustomers, type CustomerFilter } from "@/server/services/customers";

export const metadata: Metadata = { title: "Clientes" };

const filters: Array<{ value: CustomerFilter; label: string }> = [
  { value: "active", label: "Todos" },
  { value: "debt", label: "Con saldo" },
  { value: "inactive", label: "Inactivos" },
];

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; filtro?: string | string[] }>;
}) {
  const { business } = await requireMember();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const filter: CustomerFilter = filters.some((item) => item.value === params.filtro)
    ? (params.filtro as CustomerFilter)
    : "active";

  const rows = await listCustomers(business.id, { q, filter });
  const debt = rows.reduce((sum, row) => sum + Math.max(0, row.balanceCents), 0);

  return (
    <>
      <PageHeader
        title="Clientes"
        description={`${rows.length} clientes${debt > 0 ? ` · ${formatMoney(debt, business.currency)} por cobrar` : ""}`}
        action={
          <ButtonLink href="/clientes/nuevo">
            <Plus className="size-4" strokeWidth={2} />
            Nuevo cliente
          </ButtonLink>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form action="/clientes" className="relative flex-1 sm:max-w-sm" role="search">
          {filter !== "active" ? <input type="hidden" name="filtro" value={filter} /> : null}
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Nombre, teléfono o correo"
            aria-label="Buscar clientes"
            className={cn(inputStyles, "pl-9")}
          />
        </form>
        <nav aria-label="Filtros" className="flex gap-1">
          {filters.map((item) => (
            <Link
              key={item.value}
              href={`/clientes${item.value === "active" ? "" : `?filtro=${item.value}`}`}
              aria-current={item.value === filter ? "page" : undefined}
              className={buttonStyles({ variant: item.value === filter ? "secondary" : "ghost", size: "sm" })}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      {rows.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <Users className="size-8 text-muted" strokeWidth={1.5} aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-ink">
              {q || filter !== "active" ? "No hay clientes con ese criterio" : "Aún no tienes clientes"}
            </p>
            <ButtonLink href="/clientes/nuevo" size="sm" className="mt-4">
              Crear cliente
            </ButtonLink>
          </div>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/clientes/${row.id}`}
                  className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface"
                >
                  <Avatar name={row.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{row.name}</p>
                    <p className="truncate text-xs text-muted">
                      {[
                        row.phone ? formatPhone(row.phone) : null,
                        `${row.salesCount} ${row.salesCount === 1 ? "compra" : "compras"}`,
                        row.lastSaleAt ? `última ${formatDate(row.lastSaleAt, business.timezone)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  {row.balanceCents > 0 ? (
                    <Badge tone="warn">Debe {formatMoney(row.balanceCents, business.currency)}</Badge>
                  ) : null}
                  <ChevronRight className="size-4 shrink-0 text-muted" strokeWidth={1.75} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
