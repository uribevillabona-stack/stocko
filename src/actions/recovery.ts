"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { formValues, type ActionState } from "@/lib/action-state";
import { recordAudit } from "@/lib/audit";
import { verifyRecoveryToken } from "@/lib/desktop-recovery";
import { env } from "@/lib/env";
import { clearRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { resetPasswordWithToken } from "@/server/services/recovery";

const EXPIRED =
  "Este enlace ya no sirve (vence a los 15 minutos y se usa una sola vez). Vuelve a «¿Olvidaste tu contraseña?».";

const recoverySchema = z
  .object({
    userId: z.string().min(1, "Elige la cuenta"),
    password: z
      .string()
      .min(8, "La contraseña debe tener al menos 8 caracteres")
      .max(128, "La contraseña es demasiado larga"),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Las contraseñas no coinciden",
  });

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** Stocko para Windows: contraseña nueva con el enlace que abre Stocko (src/lib/desktop-recovery.ts). */
export async function recoverPasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (env.STOCKO_DESKTOP !== "1") return { error: "Esto solo está en Stocko para Windows." };

  const token = verifyRecoveryToken(text(formData, "token"), env.STOCKO_RECOVERY_KEY);
  if (!token) return { error: EXPIRED };

  const values = formValues(formData);
  const parsed = recoverySchema.safeParse({
    userId: text(formData, "userId"),
    password: text(formData, "password"),
    confirmPassword: text(formData, "confirmPassword"),
  });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };

  const result = await resetPasswordWithToken(token, parsed.data.userId, parsed.data.password);
  if (result.status === "used") return { error: EXPIRED };
  if (result.status === "missing") return { fieldErrors: { userId: ["Esa cuenta ya no existe"] }, values };

  // La contraseña ya cambió: de aquí en adelante nada debe mostrar un error.
  const ip = await clientIp();
  try {
    // Los intentos fallidos de antes no deben dejarla bloqueada con la contraseña nueva.
    await clearRateLimit(
      `action:login:fail:${result.email}`,
      `action:login:fail:${result.email}:${ip}`,
      `action:login:ip:${ip}`,
    );
  } catch {
    console.error("recuperar contraseña: no se pudieron limpiar los intentos fallidos");
  }
  if (!result.businessId) {
    // Sin negocio no hay Actividad donde anotarlo (cuenta que no terminó de crearse).
    console.warn("recuperar contraseña: cuenta sin negocio, sin registro en Actividad");
  } else {
    await recordAudit({
      businessId: result.businessId,
      userId: parsed.data.userId,
      action: "account.password_recovered",
      details: { email: result.email },
      ipAddress: ip,
    });
  }

  redirect("/login?recuperada=1");
}
