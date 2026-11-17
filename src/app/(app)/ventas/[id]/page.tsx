import { MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AddPaymentForm, CancelSaleForm } from "@/components/forms/sale-actions";
import { PageHeader } from "@/components/layout/page-header";
import { PrintButton } from "@/components/ui/print-button";
import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatQuantity } from "@/lib/quantity";
import { PAYMENT_METHOD_LABELS } from "@/lib/validation/sales";
import { saleReceiptText, waLink } from "@/lib/whatsapp-link";
import { requireMember } from "@/server/auth/context";
import { getSaleDetail } from "@/server/services/sales";
import { cloudSendStatus } from "@/server/services/whatsapp";
import { CloudSendButton } from "@/components/forms/whatsapp-forms";

export const metadata: Metadata = { title: "Venta" };

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const context = await requireMember();
  const { business } = context;
  const isOwner = context.role === "owner";
  const detail = await getSaleDetail(business.id, id, { includeCost: isOwner });
  if (!detail) notFound();

  const { sale, items, payments, balanceCents } = detail;
  const cloud = await cloudSendStatus(business.id, detail.customerPhone);
  const money = (cents: number) => formatMoney(cents, business.currency);
  const cancelled = sale.status === "cancelled";
  const costKnown = items.every((item) => item.unitCostCents !== null);
  const costCents = items.reduce(
    (sum, item) => sum + Math.round(((item.unitCostCents ?? 0) * item.qtyMilli) / 1000),
    0,
  );

  const receipt = saleReceiptText({
    businessName: business.name,
    currency: business.currency,
    number: sale.number,
    customerName: detail.customerName,
    items: items.map((item) => ({
      description: item.description,
      qtyMilli: item.qtyMilli,
      unit: item.unit,
      lineTotalCents: item.lineTotalCents,
    })),
    discountCents: sale.discountCents,
    totalCents: sale.totalCents,
    paidCents: sale.paidCents,
    dateLabel: formatDateTime(sale.createdAt, business.timezone),
  });

  return (
    <>
      <Link href="/ventas" className="mb-3 inline-block text-sm text-muted hover:text-ink print:hidden">
        ← Ventas
      </Link>
      <PageHeader
        title={`Venta #${sale.number}`}
        description={`${formatDateTime(sale.createdAt, business.timezone)}${detail.createdByName ? ` · ${detail.createdByName}` : ""}`}
        action={
          cancelled ? (
            <Badge tone="danger">Anulada</Badge>
          ) : balanceCents > 0 ? (
            <Badge tone="warn">Debe {money(balanceCents)}</Badge>
          ) : (
            <Badge tone="success">Pagada</Badge>
          )
        }
      />

      <div className="space-y-4">
        {cancelled ? (
          <div className="rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">
            Anulada el {formatDateTime(sale.cancelledAt!, business.timezone)}. Motivo: {sale.cancelReason}
          </div>
        ) : null}

        <Card>
          <CardHeader
            title={detail.customerName ?? "Cliente de mostrador"}
            description={sale.note ?? undefined}
            action={
              sale.customerId ? (
                <Link href={`/clientes/${sale.customerId}`} className="text-xs font-medium text-brand hover:underline print:hidden">
                  Ver cliente
                </Link>
              ) : undefined
            }
          />
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  {item.productId ? (
                    <Link href={`/inventario/${item.productId}`} className="text-sm text-ink hover:text-brand">
                      {item.description}
                    </Link>
                  ) : (
                    <p className="text-sm text-ink">{item.description}</p>
                  )}
                  <p className="text-xs text-muted tnum">
                    {formatQuantity(item.qtyMilli, item.unit)} × {money(item.unitPriceCents)}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-medium text-ink tnum">{money(item.lineTotalCents)}</p>
              </li>
            ))}
          </ul>
          <CardBody className="border-t border-border">
            <dl className="space-y-1.5 text-sm tnum">
              {sale.discountCents > 0 ? (
                <>
                  <div className="flex justify-between">
                    <dt className="text-muted">Subtotal</dt>
                    <dd>{money(sale.subtotalCents)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Descuento</dt>
                    <dd>−{money(sale.discountCents)}</dd>
                  </div>
                </>
              ) : null}
              <div className="flex justify-between text-base font-semibold">
                <dt>Total</dt>
                <dd className={cn(cancelled && "line-through")}>{money(sale.totalCents)}</dd>
              </div>
              {!cancelled ? (
                <div className="flex justify-between">
                  <dt className="text-muted">Pagado</dt>
                  <dd>{money(sale.paidCents)}</dd>
                </div>
              ) : null}
              {balanceCents > 0 ? (
                <div className="flex justify-between font-semibold text-warn">
                  <dt>Saldo pendiente</dt>
                  <dd>{money(balanceCents)}</dd>
                </div>
              ) : null}
              {isOwner && !cancelled ? (
                <div className="flex justify-between border-t border-border pt-2 text-xs text-muted print:hidden">
                  <dt>Margen{costKnown ? "" : " (hay productos sin costo)"}</dt>
                  <dd>
                    {money(sale.totalCents - costCents)} sobre costo {money(costCents)}
                  </dd>
                </div>
              ) : null}
            </dl>
          </CardBody>
        </Card>

        <p className="hidden text-center text-xs text-muted print:block">
          Comprobante de venta de {business.name}. No es factura electrónica de venta ni documento equivalente.
        </p>

        <div className="flex flex-wrap items-start gap-2 print:hidden">
          <a
            href={waLink(detail.customerPhone, receipt)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonStyles({ variant: "secondary" })}
          >
            <MessageCircle className="size-4" strokeWidth={1.75} />
            Enviar recibo por WhatsApp
          </a>
          <PrintButton />
          {cloud.available && !cancelled ? (
            <CloudSendButton kind="receipt" id={sale.id} windowOpen={cloud.windowOpen} />
          ) : null}
        </div>

        <Card className="print:hidden">
          <CardHeader title="Pagos" />
          {payments.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">Sin pagos registrados.</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-border">
              {payments.map((payment) => (
                <li key={payment.id} className="flex items-start justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-ink">{PAYMENT_METHOD_LABELS[payment.method]}</p>
                      {payment.voidedAt ? <Badge tone="danger">Anulado</Badge> : null}
                    </div>
                    <p className="text-xs text-muted">
                      {[formatDateTime(payment.createdAt, business.timezone), payment.createdByName, payment.note]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <p className={cn("shrink-0 text-sm font-medium tnum", payment.voidedAt ? "text-muted line-through" : "text-ink")}>
                    {money(payment.amountCents)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {!cancelled && balanceCents > 0 ? (
            <CardBody className="border-t border-border">
              <h3 className="mb-3 text-sm font-semibold text-ink">Registrar abono</h3>
              <AddPaymentForm saleId={sale.id} customerId={sale.customerId} balanceCents={balanceCents} />
            </CardBody>
          ) : null}
        </Card>

        {isOwner && !cancelled ? (
          <Card className="print:hidden">
            <CardHeader
              title="Anular venta"
              description="Devuelve el stock al inventario y anula los pagos. Si recibiste dinero, devuélvelo por fuera."
            />
            <CardBody>
              <CancelSaleForm saleId={sale.id} number={sale.number} />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
