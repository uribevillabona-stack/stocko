import type { Transaction } from "@/lib/db/client";
import { businesses, memberships, whatsappConfig } from "@/lib/db/schema";
import type { Business } from "@/lib/db/schema";

/**
 * Crea negocio, pertenencia de dueño y configuración de WhatsApp en una sola
 * transacción. Si algo falla, no queda un negocio huérfano.
 */
export async function createBusinessForUser(
  tx: Transaction,
  input: { userId: string; name: string },
): Promise<Business> {
  const [business] = await tx
    .insert(businesses)
    .values({ name: input.name })
    .returning();

  if (!business) {
    throw new Error("No se pudo crear el negocio");
  }

  await tx.insert(memberships).values({
    businessId: business.id,
    userId: input.userId,
    role: "owner",
  });

  await tx.insert(whatsappConfig).values({ businessId: business.id });

  return business;
}
