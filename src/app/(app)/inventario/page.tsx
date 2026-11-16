import { ChevronRight, PackageOpen, Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { StockBadge } from "@/components/inventory/stock-badge";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { inputStyles } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { formatQuantity } from "@/lib/quantity";
import { photoUrl } from "@/lib/storage";
import { requireMember } from "@/server/auth/context";
import {
  expireDueReservations,
  listInventory,
  type InventoryFilter,
} from "@/server/services/inventory";

export const metadata: Metadata = { title: "Inventario" };

const filters: Array<{ value: InventoryFilter; label: string }> = [
  { value: "active", label: "Todos" },
  { value: "alerts", label: "Con alerta" },
  { value: "inactive", label: "Inactivos" },
];

function parseFilter(value: string | string[] | undefined): InventoryFilter {
  return filters.some((filter) => filter.value === value) ? (value as InventoryFilter) : "active";
}

function filterHref(filter: InventoryFilter, q: string) {
  const params = new URLSearchParams();
  if (filter !== "active") params.set("filtro", filter);
  if (q) params.set("q", q);
  const query = params.toString();
  return query ? `/inventario?${query}` : "/inventario";
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; filtro?: string | string[] }>;
}) {
  const context = await requireMember();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const filter = parseFilter(params.filtro);

  await expireDueReservations(context.business.id);
  const items = await listInventory(context.business.id, { q, filter });

  return (
    <>
      <PageHeader
        title="Inventario"
        description="Disponible = físico − reservado."
        action={
          <ButtonLink href="/inventario/nuevo">
            <Plus className="size-4" strokeWidth={2} />
            Nuevo producto
          </ButtonLink>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form action="/inventario" className="relative flex-1 sm:max-w-sm" role="search">
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
            placeholder="Buscar por nombre, código o categoría"
            aria-label="Buscar productos"
            className={cn(inputStyles, "pl-9")}
          />
        </form>

        <nav aria-label="Filtros" className="flex gap-1">
          {filters.map((item) => (
            <Link
              key={item.value}
              href={filterHref(item.value, q)}
              aria-current={item.value === filter ? "page" : undefined}
              className={buttonStyles({
                variant: item.value === filter ? "secondary" : "ghost",
                size: "sm",
              })}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      {items.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <PackageOpen className="size-8 text-muted" strokeWidth={1.5} aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-ink">
              {q || filter !== "active" ? "No hay productos con ese criterio" : "Aún no tienes productos"}
            </p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-muted">
              {q || filter !== "active"
                ? "Prueba con otra búsqueda o cambia el filtro."
                : "Crea tu primer producto con su precio y el stock que tienes hoy."}
            </p>
            {q || filter !== "active" ? (
              <ButtonLink href="/inventario" variant="secondary" size="sm" className="mt-4">
                Ver todo
              </ButtonLink>
            ) : (
              <ButtonLink href="/inventario/nuevo" size="sm" className="mt-4">
                Crear producto
              </ButtonLink>
            )}
          </div>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {items.map((item) => {
              const activeVariants = item.variants.filter((variant) => variant.isActive);
              const single = activeVariants.length === 1 ? activeVariants[0] : undefined;
              const prices = activeVariants.map((variant) => variant.priceCents);
              const minPrice = prices.length ? Math.min(...prices) : 0;
              const maxPrice = prices.length ? Math.max(...prices) : 0;
              const worst = activeVariants.some((variant) => variant.status === "out")
                ? "out"
                : activeVariants.some((variant) => variant.status === "low")
                  ? "low"
                  : "ok";
              // Con varias variantes, la alerta puede ser solo de una: dilo así.
              const partialAlert =
                activeVariants.length > 1 && item.alertCount > 0 && item.alertCount < activeVariants.length;

              return (
                <li key={item.id}>
                  <Link
                    href={`/inventario/${item.id}`}
                    className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface"
                  >
                    {item.photoKey ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photoUrl(item.photoKey)!}
                        alt=""
                        loading="lazy"
                        className="size-11 shrink-0 rounded-lg border border-border object-cover"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-ink">{item.name}</p>
                        {item.isActive ? null : <Badge>Inactivo</Badge>}
                        {item.isActive && partialAlert ? (
                          <Badge tone={worst === "out" ? "danger" : "warn"}>
                            {item.alertCount === 1
                              ? "1 variante con alerta"
                              : `${item.alertCount} variantes con alerta`}
                          </Badge>
                        ) : null}
                        {item.isActive && !partialAlert ? <StockBadge status={worst} /> : null}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {[
                          item.categoryName,
                          single ? single.sku : `${activeVariants.length} variantes`,
                          minPrice === maxPrice
                            ? formatMoney(minPrice, context.business.currency)
                            : `${formatMoney(minPrice, context.business.currency)} – ${formatMoney(maxPrice, context.business.currency)}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="shrink-0 text-right tnum">
                      <p className="text-sm font-semibold text-ink">
                        {formatQuantity(item.totals.availableMilli, item.unit)}
                      </p>
                      <p className="text-xs text-muted">
                        {item.totals.reservedMilli > 0
                          ? `${formatQuantity(item.totals.reservedMilli)} reservado`
                          : "disponible"}
                      </p>
                    </div>
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
