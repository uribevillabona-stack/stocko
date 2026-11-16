import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { businesses, productCategories, products, productVariants } from "@/lib/db/schema";
import { photoUrl } from "@/lib/storage";
import { DEFAULT_VARIANT_NAME } from "@/server/services/inventory";

/** Slug: minúsculas, números y guiones; 3 a 40 caracteres. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/**
 * Catálogo público. Solo datos pensados para clientes: nombre, descripción,
 * precio y si hay disponible. Nunca costo, cantidades exactas ni datos internos.
 */
export async function getPublicCatalog(slug: string) {
  if (!SLUG_PATTERN.test(slug)) return null;

  const [business] = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      currency: businesses.currency,
      whatsappNumber: businesses.whatsappNumber,
    })
    .from(businesses)
    .where(and(eq(businesses.slug, slug), eq(businesses.catalogEnabled, true)))
    .limit(1);
  if (!business) return null;

  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      description: products.description,
      unit: products.unit,
      photoKey: products.photoKey,
      categoryName: productCategories.name,
    })
    .from(products)
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .where(and(eq(products.businessId, business.id), eq(products.isActive, true)))
    .orderBy(asc(productCategories.sortOrder), asc(productCategories.name), asc(products.name))
    .limit(1000);

  const variantRows = productRows.length
    ? await db
        .select({
          id: productVariants.id,
          productId: productVariants.productId,
          name: productVariants.name,
          isDefault: productVariants.isDefault,
          priceCents: productVariants.priceCents,
          qtyMilli: productVariants.qty_milli,
          reservedMilli: productVariants.reservedMilli,
        })
        .from(productVariants)
        .where(
          and(
            eq(productVariants.businessId, business.id),
            eq(productVariants.isActive, true),
            inArray(
              productVariants.productId,
              productRows.map((row) => row.id),
            ),
          ),
        )
        .orderBy(desc(productVariants.isDefault), asc(productVariants.createdAt))
    : [];

  const byProduct = new Map<string, typeof variantRows>();
  for (const row of variantRows) {
    byProduct.set(row.productId, [...(byProduct.get(row.productId) ?? []), row]);
  }

  const items = productRows
    .map((product) => {
      const variants = byProduct.get(product.id) ?? [];
      return {
        id: product.id,
        name: product.name,
        description: product.description,
        unit: product.unit,
        categoryName: product.categoryName,
        photoUrl: photoUrl(product.photoKey),
        variants: variants.map((variant) => ({
          id: variant.id,
          name:
            variants.length === 1 && (variant.isDefault || variant.name === DEFAULT_VARIANT_NAME)
              ? null
              : (variant.name ?? null),
          priceCents: variant.priceCents,
          available: variant.qtyMilli - variant.reservedMilli > 0,
        })),
      };
    })
    .filter((item) => item.variants.length > 0);

  return {
    business: {
      name: business.name,
      currency: business.currency,
      whatsappNumber: business.whatsappNumber,
    },
    items,
  };
}

export type PublicCatalog = NonNullable<Awaited<ReturnType<typeof getPublicCatalog>>>;
