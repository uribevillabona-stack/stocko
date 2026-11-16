import type { Metadata } from "next";
import Link from "next/link";
import { NewProductForm } from "@/components/forms/product-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { requireMember } from "@/server/auth/context";
import { listCategoryNames } from "@/server/services/inventory";

export const metadata: Metadata = { title: "Nuevo producto" };

export default async function NewProductPage() {
  const context = await requireMember();
  const categories = await listCategoryNames(context.business.id);

  return (
    <>
      <Link href="/inventario" className="mb-3 inline-block text-sm text-muted hover:text-ink">
        ← Inventario
      </Link>
      <PageHeader
        title="Nuevo producto"
        description={`Los precios van en ${context.business.currency}.`}
      />
      <Card>
        <CardBody className="py-5">
          <NewProductForm categories={categories} isOwner={context.role === "owner"} />
        </CardBody>
      </Card>
    </>
  );
}
