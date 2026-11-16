"use server";

import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { recordAudit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, hitRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { hashToken, randomToken } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { account, invitations, memberships, session, user } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getSessionUser, requireOwner } from "@/server/auth/context";
import { findInvitationByToken } from "@/server/services/invitations";

const emailField = z
  .string()
  .trim()
  .min(1, "Escribe el correo")
  .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "Escribe un correo válido")
  .transform((value) => value.toLowerCase());

const inviteSchema = z.object({
  email: emailField,
  role: z.enum(["owner", "employee"]),
});

const acceptSchema = z.object({
  token: z.string().min(1),
  name: z.string().trim().min(2, "Escribe tu nombre").max(80),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(128),
});

const employeeSchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre").max(80, "Máximo 80 caracteres"),
  email: emailField,
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
    .max(128, "Máximo 128 caracteres"),
});

const idSchema = z.uuid("Identificador inválido");

/** Postgres: violación de unicidad (p. ej. el correo ya existe). */
function isUniqueViolation(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ((current as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function createInvitationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireOwner();

  const parsed = inviteSchema.safeParse({
    email: text(formData, "email"),
    role: text(formData, "role") || "employee",
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const [existingMember] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(
      and(
        eq(memberships.businessId, context.business.id),
        eq(user.email, parsed.data.email),
      ),
    )
    .limit(1);

  if (existingMember) {
    return { error: "Esa persona ya hace parte de tu equipo." };
  }

  const [pending] = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(
        eq(invitations.businessId, context.business.id),
        eq(invitations.email, parsed.data.email),
        isNull(invitations.acceptedAt),
      ),
    )
    .limit(1);

  if (pending) {
    return { error: "Ya hay una invitación pendiente para ese correo." };
  }

  const token = randomToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.insert(invitations).values({
    businessId: context.business.id,
    email: parsed.data.email,
    role: parsed.data.role,
    tokenHash: hashToken(token),
    expiresAt,
    createdBy: context.user.id,
  });

  await recordAudit({
    businessId: context.business.id,
    userId: context.user.id,
    action: "team.invitation_created",
    entityType: "invitation",
    details: { email: parsed.data.email, role: parsed.data.role },
    ipAddress: await clientIp(),
  });

  const inviteUrl = new URL(`/invitacion/${token}`, env.NEXT_PUBLIC_APP_URL).toString();

  return {
    success: "Invitación creada. Comparte el enlace con esa persona.",
    inviteUrl,
  };
}

/**
 * El dueño crea la cuenta de un trabajador con una contraseña inicial (sirve sin
 * internet, p. ej. en la app de escritorio). No abre sesión: el dueño sigue en la suya.
 */
export async function createEmployeeAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireOwner();
  const ip = await clientIp();

  if (
    !(await hitRateLimit(`action:employee:user:${context.user.id}`, RATE_LIMITS.employeePerUser)).allowed ||
    !(await hitRateLimit(`action:employee:ip:${ip}`, RATE_LIMITS.employeePerUser)).allowed
  ) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const parsed = employeeSchema.safeParse({
    name: text(formData, "name"),
    email: text(formData, "email"),
    password: text(formData, "password"),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const duplicate = {
    fieldErrors: { email: ["Ese correo ya tiene una cuenta en Stocko. Usa otro o envíale una invitación."] },
  };

  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, parsed.data.email))
    .limit(1);

  if (existingUser) return duplicate;

  const userId = randomUUID();
  const passwordHash = await hashPassword(parsed.data.password);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(user).values({
        id: userId,
        name: parsed.data.name,
        email: parsed.data.email,
        emailVerified: false,
      });
      await tx.insert(account).values({
        id: randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: passwordHash,
      });
      await tx.insert(memberships).values({
        businessId: context.business.id,
        userId,
        role: "employee",
      });
      // Si había una invitación pendiente para ese correo, ya no hace falta.
      await tx
        .delete(invitations)
        .where(
          and(
            eq(invitations.businessId, context.business.id),
            eq(invitations.email, parsed.data.email),
            isNull(invitations.acceptedAt),
          ),
        );
    });
  } catch (error) {
    if (isUniqueViolation(error)) return duplicate;
    return { error: "No pudimos crear la cuenta. Inténtalo de nuevo." };
  }

  await recordAudit({
    businessId: context.business.id,
    userId: context.user.id,
    action: "team.employee_created",
    entityType: "user",
    entityId: userId,
    details: { email: parsed.data.email, role: "employee" },
    ipAddress: ip,
  });

  revalidatePath("/ajustes");

  return {
    success: `Listo. ${parsed.data.name} ya puede entrar con ${parsed.data.email} y la contraseña que escribiste.`,
  };
}

export async function acceptInvitationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ip = await clientIp();
  if (!(await hitRateLimit(`action:invitation:ip:${ip}`, RATE_LIMITS.invitationPerIp)).allowed) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const token = text(formData, "token");
  const invitation = await findInvitationByToken(token);

  if (!invitation) {
    return { error: "La invitación no existe o ya venció. Pide una nueva." };
  }

  const sessionUser = await getSessionUser();
  let userId: string;

  if (sessionUser) {
    if (sessionUser.email.toLowerCase() !== invitation.email.toLowerCase()) {
      return {
        error:
          "Esta invitación es para otro correo. Cierra sesión y vuelve a abrir el enlace.",
      };
    }
    userId = sessionUser.id;
  } else {
    const parsed = acceptSchema.safeParse({
      token,
      name: text(formData, "name"),
      password: text(formData, "password"),
    });

    if (!parsed.success) {
      return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
    }

    const [existingUser] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, invitation.email))
      .limit(1);

    if (existingUser) {
      return {
        error: "Ese correo ya tiene cuenta. Inicia sesión y vuelve a abrir el enlace.",
      };
    }

    try {
      const created = await auth.api.signUpEmail({
        body: {
          name: parsed.data.name,
          email: invitation.email,
          password: parsed.data.password,
        },
      });
      userId = created.user.id;
    } catch {
      return { error: "No pudimos crear tu cuenta. Inténtalo de nuevo." };
    }
  }

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ businessId: memberships.businessId })
        .from(memberships)
        .where(eq(memberships.userId, userId))
        .limit(1);

      if (existing) {
        if (existing.businessId !== invitation.businessId) {
          throw new Error("ALREADY_IN_OTHER_BUSINESS");
        }
      } else {
        await tx.insert(memberships).values({
          businessId: invitation.businessId,
          userId,
          role: invitation.role,
        });
      }

      await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(eq(invitations.id, invitation.id));
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ALREADY_IN_OTHER_BUSINESS") {
      return {
        error: "Tu cuenta ya pertenece a otro negocio. Stocko admite un negocio por cuenta.",
      };
    }
    return { error: "No pudimos unirte al equipo. Inténtalo de nuevo." };
  }

  await recordAudit({
    businessId: invitation.businessId,
    userId,
    action: "team.member_joined",
    entityType: "user",
    entityId: userId,
    details: { role: invitation.role },
    ipAddress: ip,
  });

  redirect("/");
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const context = await requireOwner();
  const parsed = idSchema.safeParse(formData.get("id"));

  if (!parsed.success) return;

  const revoked = await db
    .delete(invitations)
    .where(
      and(
        eq(invitations.id, parsed.data),
        eq(invitations.businessId, context.business.id),
        isNull(invitations.acceptedAt),
      ),
    )
    .returning({ email: invitations.email });

  if (revoked[0]) {
    await recordAudit({
      businessId: context.business.id,
      userId: context.user.id,
      action: "team.invitation_revoked",
      entityType: "invitation",
      entityId: parsed.data,
      details: { email: revoked[0].email },
      ipAddress: await clientIp(),
    });
  }

  revalidatePath("/ajustes");
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const context = await requireOwner();
  const parsed = idSchema.safeParse(formData.get("id"));

  if (!parsed.success) return;

  const removed = await db
    .delete(memberships)
    .where(
      and(
        eq(memberships.id, parsed.data),
        eq(memberships.businessId, context.business.id),
        eq(memberships.role, "employee"),
      ),
    )
    .returning({ userId: memberships.userId });

  if (removed[0]) {
    // Cierra sus sesiones: deja de tener acceso de inmediato.
    await db.delete(session).where(eq(session.userId, removed[0].userId));
    await recordAudit({
      businessId: context.business.id,
      userId: context.user.id,
      action: "team.member_removed",
      entityType: "user",
      entityId: removed[0].userId,
      ipAddress: await clientIp(),
    });
  }

  revalidatePath("/ajustes");
}
