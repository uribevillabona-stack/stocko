import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { CatalogView } from "@/components/catalog/catalog-view";
import { Logo } from "@/components/layout/logo";
import { formatPhone } from "@/lib/phone";
import { getPublicCatalog } from "@/server/services/catalog";

const loadCatalog = cache((slug: string) => getPublicCatalog(slug));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const catalog = await loadCatalog(slug);
  if (!catalog) return { title: "Catálogo no encontrado" };
  return {
    title: `Catálogo de ${catalog.business.name}`,
    description: `Productos y precios de ${catalog.business.name}. Pide por WhatsApp.`,
  };
}

export default async function PublicCatalogPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const catalog = await loadCatalog(slug);
  if (!catalog) notFound();

  const { business, items } = catalog;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{business.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {business.whatsappNumber
            ? `Elige tus productos y envía el pedido por WhatsApp (${formatPhone(business.whatsappNumber)}).`
            : "Catálogo de productos."}{" "}
          Precios sujetos a cambios.
        </p>
      </header>

      {items.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">Este catálogo aún no tiene productos.</p>
      ) : (
        <CatalogView
          businessName={business.name}
          currency={business.currency}
          whatsappNumber={business.whatsappNumber}
          items={items}
        />
      )}

      <footer className="mt-10 flex items-center justify-center gap-2 text-xs text-muted">
        Hecho con <Logo markClassName="size-4" />
      </footer>
    </main>
  );
}
