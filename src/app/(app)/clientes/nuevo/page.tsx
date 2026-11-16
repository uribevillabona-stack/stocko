import type { Metadata } from "next";
import Link from "next/link";
import { CustomerForm } from "@/components/forms/customer-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { requireMember } from "@/server/auth/context";

export const metadata: Metadata = { title: "Nuevo cliente" };

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ volver?: string | string[] }>;
}) {
  await requireMember();
  const params = await searchParams;
  const fromSale = params.volver === "venta";

  return (
    <>
      <Link
        href={fromSale ? "/ventas/nueva" : "/clientes"}
        className="mb-3 inline-block text-sm text-muted hover:text-ink"
      >
        ← {fromSale ? "Nueva venta" : "Clientes"}
      </Link>
      <PageHeader
        title="Nuevo cliente"
        description={fromSale ? "Al guardarlo vuelves a la venta con este cliente elegido." : undefined}
      />
      <Card>
        <CardBody className="py-5">
          <CustomerForm returnTo={fromSale ? "venta" : undefined} />
        </CardBody>
      </Card>
    </>
  );
}
