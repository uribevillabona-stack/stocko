import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { businesses, invitations } from "@/lib/db/schema";
import { hashToken } from "@/lib/crypto";

export async function findInvitationByToken(token: string) {
  if (!token) return null;
  const tokenHash = hashToken(token);

  const [row] = await db
    .select({
      id: invitations.id,
      businessId: invitations.businessId,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
      businessName: businesses.name,
    })
    .from(invitations)
    .innerJoin(businesses, eq(businesses.id, invitations.businessId))
    .where(
      and(
        eq(invitations.tokenHash, tokenHash),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return row ?? null;
}
