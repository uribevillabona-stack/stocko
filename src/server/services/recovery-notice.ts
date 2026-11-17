import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditEvents, memberships, user, verification } from "@/lib/db/schema";

/** Cuánto tiempo se recuerdan los cambios en el aviso. */
export const NOTICE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type OwnerRecovery = { at: Date; email: string };

const seenKey = (userId: string) => `recovery-notice:${userId}`;

/**
 * Aviso para el dueño cuando la contraseña de una cuenta de dueño se cambió con
 * «Olvidé mi contraseña» (Stocko para Windows).
 *
 * Un trabajador que use el mismo PC podría hacerlo, entrar como dueño y cerrar el
 * aviso. Por eso, si hay un cambio que esta persona no ha visto, se muestran TODOS
 * los de los últimos 30 días, también los ya vistos: cuando el dueño real vuelva a
 * entrar (tendrá que recuperar su contraseña, porque la suya dejó de servir) verá
 * también el cambio que hizo el otro.
 */
export async function ownerRecoveryNotice(
  businessId: string,
  viewerId: string,
  now = new Date(),
): Promise<OwnerRecovery[]> {
  const since = new Date(now.getTime() - NOTICE_WINDOW_MS);
  const rows = await db
    .select({ at: auditEvents.createdAt, email: user.email })
    .from(auditEvents)
    .innerJoin(
      memberships,
      and(eq(memberships.userId, auditEvents.userId), eq(memberships.businessId, businessId)),
    )
    .innerJoin(user, eq(user.id, auditEvents.userId))
    .where(
      and(
        eq(auditEvents.businessId, businessId),
        eq(auditEvents.action, "account.password_recovered"),
        eq(memberships.role, "owner"),
        gt(auditEvents.createdAt, since),
      ),
    )
    .orderBy(desc(auditEvents.createdAt));
  if (rows.length === 0) return [];

  const [seen] = await db
    .select({ value: verification.value })
    .from(verification)
    .where(eq(verification.identifier, seenKey(viewerId)))
    .limit(1);
  const seenUntil = seen ? Number(seen.value) : 0;
  return rows.some((row) => row.at.getTime() > seenUntil) ? rows : [];
}

/** «Entendido»: oculta el aviso hasta que haya un cambio nuevo. */
export async function dismissOwnerRecoveryNotice(viewerId: string, until: Date, now = new Date()) {
  const identifier = seenKey(viewerId);
  const expiresAt = new Date(now.getTime() + NOTICE_WINDOW_MS);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${identifier}))`);
    await tx.delete(verification).where(eq(verification.identifier, identifier));
    await tx.insert(verification).values({ id: randomUUID(), identifier, value: String(until.getTime()), expiresAt });
  });
}
