import type { Metadata } from "next";
import Link from "next/link";
import { SaleForm } from "@/components/forms/sale-form";
import { PageHeader } from "@/components/layout/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { requireMember } from "@/server/auth/context";
import { listCustomerOptions } from "@/server/services/customers";
import { expireDueReservations } from "@/server/services/inventory";
import { listSellableVariants } from "@/server/services/sales";

export const metadata: Metadata = { title: "Nueva venta" };

export default async function NewSalePage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string | string[] }>;
}) {
  const { business } = await requireMember();
  const params = await searchParams;

  await expireDueReservations(business.id);
  const [variants, customers] = await Promise.all([
    listSellableVariants(business.id),
    listCustomerOptions(business.id),
  ]);

  const requested = typeof params.cliente === "string" ? params.cliente : undefined;
  const defaultCustomerId = customers.some((customer) => customer.id === requested) ? requested : undefined;

  return (
    <>
      <Link href="/ventas" className="mb-3 inline-block text-sm text-muted hover:text-ink">
        ← Ventas
      </Link>
      <PageHeader
        title="Nueva venta"
        description="El stock se descuenta al registrar la venta."
      />
      {variants.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center">
            <p className="text-sm text-ink">Primero necesitas productos activos en el inventario.</p>
            <ButtonLink href="/inventario/nuevo" size="sm" className="mt-4">
              Crear producto
            </ButtonLink>
          </CardBody>
        </Card>
      ) : (
        <SaleForm
          variants={variants}
          customers={customers}
          currency={business.currency}
          allowOversell={business.allowOversell}
          defaultCustomerId={defaultCustomerId}
        />
      )}
    </>
  );
}
