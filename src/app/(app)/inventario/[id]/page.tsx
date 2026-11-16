import { ChevronDown } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";
import { ProductPhotoForm } from "@/components/forms/photo-form";
import { EditProductForm } from "@/components/forms/product-form";
import {
  AddVariantForm,
  EditVariantForm,
  MovementForm,
  ReservationActions,
} from "@/components/forms/stock-forms";
import { StockBadge, variantLabel } from "@/components/inventory/stock-badge";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { MovementType } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/dates";
import { formatMoney, moneyInputValue } from "@/lib/money";
import { formatQuantity, quantityInputValue } from "@/lib/quantity";
import { photosEnabled, photoUrl } from "@/lib/storage";
import { requireMember } from "@/server/auth/context";
import {
  expireDueReservations,
  getProductDetail,
  listCategoryNames,
} from "@/server/services/inventory";

export const metadata: Metadata = { title: "Producto" };

const movementLabels: Record<MovementType, { label: string; tone: "success" | "danger" | "neutral" | "brand" | "warn" }> = {
  entry: { label: "Entrada", tone: "success" },
  exit: { label: "Salida", tone: "danger" },
  adjustment: { label: "Ajuste", tone: "warn" },
  reserve: { label: "Reserva", tone: "brand" },
  release: { label: "Liberación", tone: "neutral" },
};

function Collapsible({ summary, children, open }: { summary: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="group rounded-xl border border-border" open={open}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        {summary}
        <ChevronDown
          className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </summary>
      <div className="border-t border-border px-4 py-4">{children}</div>
    </details>
  );
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const context = await requireMember();
  const { business } = context;
  const isOwner = context.role === "owner";

  await expireDueReservations(business.id);
  const [detail, categories] = await Promise.all([
    getProductDetail(business.id, id, { includeCost: isOwner }),
    listCategoryNames(business.id),
  ]);

  if (!detail) notFound();

  const { product, variants, reservations, movements } = detail;
  const unit = product.unit;
  const activeVariants = variants.filter((variant) => variant.isActive);
  const showVariantNames = variants.length > 1;

  return (
    <>
      <Link href="/inventario" className="mb-3 inline-block text-sm text-muted hover:text-ink">
        ← Inventario
      </Link>
      <PageHeader
        title={product.name}
        description={[product.categoryName ?? "Sin categoría", `Se cuenta en ${unit}`].join(" · ")}
        action={product.isActive ? undefined : <Badge>Inactivo</Badge>}
      />

      <div className="space-y-4">
        <Card>
          <CardHeader title="Existencias" description="Disponible = físico − reservado." />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-5 py-2 font-medium">{showVariantNames ? "Variante" : "Código"}</th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Físico</th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Reservado</th>
                  <th className="px-3 py-2 text-right font-medium">Disponible</th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Mínimo</th>
                  <th className="px-5 py-2 text-right font-medium">Precio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tnum">
                {variants.map((variant) => (
                  <tr key={variant.id} className={cn(!variant.isActive && "opacity-60")}>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">
                          {showVariantNames ? variantLabel(variant) : variant.sku}
                        </span>
                        {variant.isActive ? <StockBadge status={variant.status} /> : <Badge>Inactiva</Badge>}
                      </div>
                      {showVariantNames ? <p className="text-xs text-muted">{variant.sku}</p> : null}
                    </td>
                    <td className="hidden px-3 py-3 text-right sm:table-cell">{formatQuantity(variant.qtyMilli)}</td>
                    <td className="hidden px-3 py-3 text-right sm:table-cell">{formatQuantity(variant.reservedMilli)}</td>
                    <td className="px-3 py-3 text-right font-semibold text-ink">
                      {formatQuantity(variant.availableMilli)}
                      {variant.reservedMilli > 0 ? (
                        <p className="text-xs font-normal text-muted sm:hidden">
                          {formatQuantity(variant.reservedMilli)} reservado
                        </p>
                      ) : null}
                    </td>
                    <td className="hidden px-3 py-3 text-right text-muted sm:table-cell">
                      {variant.minStockMilli > 0 ? formatQuantity(variant.minStockMilli) : "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {formatMoney(variant.priceCents, business.currency)}
                      {isOwner && variant.costCents !== null ? (
                        <p className="text-xs text-muted">
                          Costo {formatMoney(variant.costCents, business.currency)}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {product.isActive ? (
          <Card>
            <CardHeader
              title="Registrar movimiento"
              description="El stock solo cambia con movimientos. Cada uno queda en el historial."
            />
            <CardBody>
              <MovementForm
                productId={product.id}
                unit={unit}
                allowOversell={business.allowOversell}
                variants={activeVariants.map((variant) => ({
                  id: variant.id,
                  label: `${variantLabel(variant)} · disp. ${formatQuantity(variant.availableMilli)}`,
                  qtyMilli: variant.qtyMilli,
                  reservedMilli: variant.reservedMilli,
                }))}
              />
            </CardBody>
          </Card>
        ) : null}

        {reservations.length > 0 ? (
          <Card>
            <CardHeader
              title="Reservas activas"
              description={`Vencen solas a las ${business.reservationTtlHours} horas y el stock vuelve a estar disponible.`}
            />
            <ul className="divide-y divide-border">
              {reservations.map((reservation) => (
                <li key={reservation.id} className="flex items-start justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{reservation.reference}</p>
                    <p className="text-xs text-muted tnum">
                      {formatQuantity(reservation.qtyMilli, unit)}
                      {showVariantNames && reservation.variantName ? ` · ${reservation.variantName}` : ""}
                      {reservation.expiresAt
                        ? ` · vence ${formatDateTime(reservation.expiresAt, business.timezone)}`
                        : ""}
                      {reservation.createdByName ? ` · ${reservation.createdByName}` : ""}
                    </p>
                  </div>
                  <ReservationActions
                    productId={product.id}
                    reservationId={reservation.id}
                    reference={reservation.reference}
                  />
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Historial" description="Últimos 50 movimientos." />
          {movements.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">Todavía no hay movimientos.</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-border">
              {movements.map((movement) => {
                const meta = movementLabels[movement.type];
                const sign = movement.qtyMilli > 0 ? "+" : "";
                return (
                  <li key={movement.id} className="flex items-start justify-between gap-4 px-5 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        {showVariantNames && movement.variantName ? (
                          <span className="text-xs text-muted">{movement.variantName}</span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-xs text-muted">
                        {[
                          formatDateTime(movement.createdAt, business.timezone),
                          movement.createdByName ?? "Automático",
                          movement.reason,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="shrink-0 text-right tnum">
                      <p className="text-sm font-semibold text-ink">
                        {sign}
                        {formatQuantity(movement.qtyMilli, unit)}
                      </p>
                      {movement.balanceAfterMilli !== null &&
                      (movement.type === "entry" || movement.type === "exit" || movement.type === "adjustment") ? (
                        <p className="text-xs text-muted">Queda {formatQuantity(movement.balanceAfterMilli)}</p>
                      ) : (
                        <p className="text-xs text-muted">sobre lo reservado</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Variantes"
            description="Tallas, colores o presentaciones. Cada una tiene su propio stock y precio."
          />
          <CardBody className="space-y-2">
            {variants.map((variant) => (
              <Collapsible
                key={variant.id}
                summary={
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">
                      {variantLabel(variant)}
                      {variant.isActive ? null : <span className="font-normal text-muted"> (inactiva)</span>}
                    </span>
                    <span className="block text-xs text-muted">
                      {variant.sku} · {formatMoney(variant.priceCents, business.currency)}
                    </span>
                  </span>
                }
              >
                <EditVariantForm
                  productId={product.id}
                  isOwner={isOwner}
                  variant={{
                    id: variant.id,
                    name: variant.name,
                    sku: variant.sku,
                    isActive: variant.isActive,
                    isDefault: variant.isDefault,
                    price: moneyInputValue(variant.priceCents),
                    cost: isOwner ? moneyInputValue(variant.costCents) : "",
                    minStock: variant.minStockMilli > 0 ? quantityInputValue(variant.minStockMilli) : "",
                  }}
                />
              </Collapsible>
            ))}
            <Collapsible summary={<span className="text-sm font-medium text-brand">+ Agregar variante</span>}>
              <AddVariantForm productId={product.id} isOwner={isOwner} />
            </Collapsible>
          </CardBody>
        </Card>

        {photosEnabled() ? (
          <Card>
            <CardHeader title="Foto" description="Se muestra en el inventario y en el catálogo en línea." />
            <CardBody>
              <ProductPhotoForm
                productId={product.id}
                productName={product.name}
                photoUrl={photoUrl(product.photoKey)}
              />
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Datos del producto" />
          <CardBody>
            <EditProductForm product={product} categories={categories} isOwner={isOwner} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
