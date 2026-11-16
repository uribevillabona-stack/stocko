import { MessageCircle, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CustomerForm } from "@/components/forms/customer-form";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, buttonStyles } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { balanceReminderText, waLink } from "@/lib/whatsapp-link";
import { requireMember } from "@/server/auth/context";
import { getCustomerDetail } from "@/server/services/customers";
import { cloudSendStatus } from "@/server/services/whatsapp";
import { CloudSendButton } from "@/components/forms/whatsapp-forms";

export const metadata: Metadata = { title: "Cliente" };

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold tnum", tone === "warn" ? "text-warn" : "text-ink")}>{value}</p>
    </div>
  );
}

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const { business } = await requireMember();
  const detail = await getCustomerDetail(business.id, id);
  if (!detail) notFound();

  const { customer, balanceCents, purchasedCents, salesCount } = detail;
  const cloud = await cloudSendStatus(business.id, customer.phone);
  const money = (cents: number) => formatMoney(cents, business.currency);

  return (
    <>
      <Link href="/clientes" className="mb-3 inline-block text-sm text-muted hover:text-ink">
        ← Clientes
      </Link>
      <PageHeader
        title={customer.name}
        description={[customer.phone ? formatPhone(customer.phone) : null, customer.email].filter(Boolean).join(" · ") || undefined}
        action={
          customer.isActive ? (
            <ButtonLink href={`/ventas/nueva?cliente=${customer.id}`}>
              <Plus className="size-4" strokeWidth={2} />
              Venderle
            </ButtonLink>
          ) : (
            <Badge>Inactivo</Badge>
          )
        }
      />

      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Saldo por cobrar" value={money(balanceCents)} tone={balanceCents > 0 ? "warn" : undefined} />
          <Stat label="Total comprado" value={money(purchasedCents)} />
          <Stat label="Compras" value={String(salesCount)} />
        </div>

        {balanceCents > 0 && customer.phone ? (
          <div className="flex flex-wrap items-start gap-2">
            <a
              href={waLink(
                customer.phone,
                balanceReminderText({
                  businessName: business.name,
                  currency: business.currency,
                  customerName: customer.name,
                  balanceCents,
                }),
              )}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonStyles({ variant: "secondary" })}
            >
              <MessageCircle className="size-4" strokeWidth={1.75} />
              Recordar saldo por WhatsApp
            </a>
            {cloud.available ? (
              <CloudSendButton kind="reminder" id={customer.id} windowOpen={cloud.windowOpen} />
            ) : null}
          </div>
        ) : null}

        <Card>
          <CardHeader title="Compras" description="Últimas 50." />
          {detail.sales.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">Todavía no tiene compras.</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-border">
              {detail.sales.map((sale) => {
                const balance = sale.status === "completed" ? sale.totalCents - sale.paidCents : 0;
                return (
                  <li key={sale.id}>
                    <Link
                      href={`/ventas/${sale.id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface"
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-sm text-ink">
                          Venta #{sale.number}
                          {sale.status === "cancelled" ? <Badge tone="danger">Anulada</Badge> : null}
                          {balance > 0 ? <Badge tone="warn">Debe {money(balance)}</Badge> : null}
                        </span>
                        <span className="block text-xs text-muted">
                          {formatDateTime(sale.createdAt, business.timezone)}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-sm font-medium tnum",
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
        </Card>

        <Card>
          <CardHeader title="Datos del cliente" />
          <CardBody>
            <CustomerForm customer={customer} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
