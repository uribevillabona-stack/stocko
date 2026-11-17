import "server-only";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { account, businesses, memberships, session, user, verification } from "@/lib/db/schema";
import type { RecoveryToken } from "@/lib/desktop-recovery";

export type RecoverableAccount = { id: string; name: string; email: string; role: string | null; business: string | null };

/** Las cuentas de este PC, para elegir cuál recuperar (Stocko para Windows). */
export async function listRecoverableAccounts(): Promise<RecoverableAccount[]> {
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: memberships.role,
      business: businesses.name,
    })
    .from(user)
    .leftJoin(memberships, eq(memberships.userId, user.id))
    .leftJoin(businesses, eq(businesses.id, memberships.businessId))
    .orderBy(sql`coalesce(${memberships.role} = 'owner', false) desc`, asc(user.createdAt));
}

/** Si el enlace ya se usó (para no mostrar el formulario otra vez al volver atrás). */
export async function isRecoveryTokenUsed(token: RecoveryToken): Promise<boolean> {
  const [used] = await db
    .select({ id: verification.id })
    .from(verification)
    .where(eq(verification.identifier, `desktop-recovery:${token.nonce}`))
    .limit(1);
  return Boolean(used);
}

export type RecoveryResult =
  | { status: "done"; email: string; businessId: string | null }
  | { status: "used" }
  | { status: "missing" };

/**
 * Pone una contraseña nueva con un token de recuperación ya verificado. El token sirve
 * una sola vez: su nonce queda en `verification` (con candado, por si llegan dos envíos).
 * Cierra las sesiones abiertas de esa cuenta.
 */
export async function resetPasswordWithToken(
  token: RecoveryToken,
  userId: string,
  newPassword: string,
): Promise<RecoveryResult> {
  const passwordHash = await hashPassword(newPassword);
  const identifier = `desktop-recovery:${token.nonce}`;

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${identifier}))`);
    const [used] = await tx
      .select({ id: verification.id })
      .from(verification)
      .where(eq(verification.identifier, identifier))
      .limit(1);
    if (used) return { status: "used" } as const;

    const [target] = await tx
      .select({ id: user.id, email: user.email, businessId: memberships.businessId })
      .from(user)
      .leftJoin(memberships, eq(memberships.userId, user.id))
      .where(eq(user.id, userId))
      .limit(1);
    if (!target) return { status: "missing" } as const;

    await tx.insert(verification).values({
      id: randomUUID(),
      identifier,
      value: "usado",
      expiresAt: token.expiresAt,
    });

    const updated = await tx
      .update(account)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(and(eq(account.userId, target.id), eq(account.providerId, "credential")))
      .returning({ id: account.id });
    if (updated.length === 0) {
      await tx.insert(account).values({
        id: randomUUID(),
        accountId: target.id,
        providerId: "credential",
        userId: target.id,
        password: passwordHash,
      });
    }

    await tx.delete(session).where(eq(session.userId, target.id));
    return { status: "done", email: target.email, businessId: target.businessId } as const;
  });
}
