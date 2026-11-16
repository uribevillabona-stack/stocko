"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formValues, type ActionState } from "@/lib/action-state";
import { auth } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { RATE_LIMIT_MESSAGE, RATE_LIMITS, hitRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { requireMember } from "@/server/auth/context";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

const nameSchema = z.object({
  name: z.string().trim().min(2, "Escribe tu nombre").max(80, "El nombre es demasiado largo"),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Escribe tu contraseña actual"),
    newPassword: z
      .string()
      .min(8, "La nueva contraseña debe tener al menos 8 caracteres")
      .max(128, "La contraseña es demasiado larga"),
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Las contraseñas no coinciden",
  });

export async function updateProfileAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireMember();
  const parsed = nameSchema.safeParse({ name: text(formData, "name") });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  try {
    await auth.api.updateUser({ body: { name: parsed.data.name }, headers: await headers() });
  } catch {
    return { error: "No pudimos guardar tu nombre. Inténtalo de nuevo.", values: formValues(formData) };
  }
  revalidatePath("/", "layout");
  return { success: "Nombre actualizado." };
}

export async function changePasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireMember();
  const parsed = passwordSchema.safeParse({
    currentPassword: text(formData, "currentPassword"),
    newPassword: text(formData, "newPassword"),
    confirmPassword: text(formData, "confirmPassword"),
  });
  // Nunca se devuelven contraseñas al formulario.
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  if (!(await hitRateLimit(`action:password:user:${context.user.id}`, RATE_LIMITS.passwordPerUser)).allowed) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  try {
    await auth.api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: true,
      },
      headers: await headers(),
    });
  } catch (error) {
    const message = (error as { body?: { message?: string } }).body?.message ?? "";
    if (/invalid password/i.test(message)) {
      return { fieldErrors: { currentPassword: ["La contraseña actual no es correcta"] } };
    }
    return { error: "No pudimos cambiar la contraseña. Inténtalo de nuevo." };
  }
  await recordAudit({
    businessId: context.business.id,
    userId: context.user.id,
    action: "account.password_changed",
    ipAddress: await clientIp(),
  });
  return { success: "Contraseña cambiada. Cerramos tus otras sesiones abiertas." };
}
