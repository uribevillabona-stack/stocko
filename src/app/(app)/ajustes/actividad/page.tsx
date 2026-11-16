import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { AUDIT_LABELS, listAuditEvents, type AuditAction } from "@/lib/audit";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { requireOwner } from "@/server/auth/context";

export const metadata: Metadata = { title: "Actividad" };

function describe(
  action: string,
  details: Record<string, unknown> | null,
  money: (cents: number) => string,
): string | null {
  if (!details) return null;
  const d = details as Record<string, string | number | boolean | null>;
  switch (action) {
    case "variant.price_changed":
      return `${d.sku}: ${money(Number(d.fromCents))} → ${money(Number(d.toCents))}`;
    case "sale.created":
      return `Venta #${d.number} por ${money(Number(d.totalCents))}${Number(d.discountCents) > 0 ? ` · descuento ${money(Number(d.discountCents))}` : ""}${Number(d.priceOverrides) > 0 ? ` · ${d.priceOverrides} precio(s) cambiado(s)` : ""}`;
    case "sale.cancelled":
      return `Venta #${d.number} por ${money(Number(d.totalCents))}. Motivo: ${d.reason}`;
    case "payment.added":
      return `${money(Number(d.amountCents))}`;
    case "stock.adjusted":
      return `Diferencia ${Number(d.deltaMilli) / 1000 > 0 ? "+" : ""}${(Number(d.deltaMilli) / 1000).toLocaleString("es-CO")}`;
    case "team.invitation_created":
    case "team.invitation_revoked":
    case "team.employee_created":
      return String(d.email ?? "");
    case "product.created":
    case "product.updated":
    case "product.deactivated":
    case "product.reactivated":
      return String(d.name ?? "");
    case "catalog.updated":
      return d.enabled ? `Publicado en /catalogo/${d.slug}` : "Catálogo no publicado";
    case "whatsapp.settings_updated":
      return d.mode === "cloud" ? "Modo Cloud API" : "Modo básico";
    default:
      return null;
  }
}

export default async function ActivityPage() {
  const { business } = await requireOwner();
  const events = await listAuditEvents(business.id, { limit: 200 });
  const money = (cents: number) => formatMoney(cents, business.currency);

  return (
    <>
      <Link href="/ajustes" className="mb-3 inline-block text-sm text-muted hover:text-ink">
        ← Ajustes
      </Link>
      <PageHeader
        title="Actividad"
        description="Acciones sensibles de tu equipo: precios, anulaciones, abonos, ajustes y permisos. Últimas 200."
      />
      <Card>
        {events.length === 0 ? (
          <CardBody>
            <p className="text-sm text-muted">Todavía no hay actividad registrada.</p>
          </CardBody>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((event) => {
              const detail = describe(event.action, event.details, money);
              return (
                <li key={event.id} className="px-5 py-3">
                  <p className="text-sm text-ink">
                    <span className="font-medium">{event.userName ?? "Alguien"}</span>{" "}
                    {(AUDIT_LABELS[event.action as AuditAction] ?? event.action).toLowerCase()}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {[formatDateTime(event.createdAt, business.timezone), detail, event.ipAddress ? `IP ${event.ipAddress}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
