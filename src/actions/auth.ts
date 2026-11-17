"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formValues, type ActionState } from "@/lib/action-state";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { memberships } from "@/lib/db/schema";
import { getAuthContext } from "@/server/auth/context";
import {
  RATE_LIMIT_MESSAGE,
  RATE_LIMITS,
  clearRateLimit,
  hitRateLimit,
  isRateLimited,
} from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { createBusinessForUser } from "@/server/services/business";

const emailField = z
  .string()
  .trim()
  .min(1, "Escribe tu correo")
  .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "Escribe un correo válido")
  .transform((value) => value.toLowerCase());

const registerSchema = z
  .object({
    name: z.string().trim().min(2, "Escribe tu nombre").max(80, "El nombre es demasiado largo"),
    email: emailField,
    password: z
      .string()
      .min(8, "La contraseña debe tener al menos 8 caracteres")
      .max(128, "La contraseña es demasiado larga"),
    confirmPassword: z.string(),
    businessName: z
      .string()
      .trim()
      .min(2, "Escribe el nombre de tu negocio")
      .max(80, "El nombre del negocio es demasiado largo"),
  })
  // Una contraseña mal escrita al crear la cuenta deja a la persona por fuera.
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Las contraseñas no coinciden",
  });

const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Escribe tu contraseña"),
});

const onboardingSchema = z.object({
  businessName: z
    .string()
    .trim()
    .min(2, "Escribe el nombre de tu negocio")
    .max(80, "El nombre del negocio es demasiado largo"),
});

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function authErrorMessage(error: unknown): string {
  const body = (error as { body?: { message?: string } }).body;
  const raw = body?.message ?? (error instanceof Error ? error.message : "");

  const messages: Record<string, string> = {
    "User already exists": "Ese correo ya tiene una cuenta. Inicia sesión.",
    "Invalid email or password": "Correo o contraseña incorrectos.",
    "Invalid password": "Correo o contraseña incorrectos.",
    "Password too short": "La contraseña debe tener al menos 8 caracteres.",
    "Email not verified": "Debes verificar tu correo antes de entrar.",
  };

  return messages[raw] ?? "No pudimos completar la operación. Inténtalo de nuevo.";
}

export async function registerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = registerSchema.safeParse({
    name: text(formData, "name"),
    email: text(formData, "email"),
    password: text(formData, "password"),
    confirmPassword: text(formData, "confirmPassword"),
    businessName: text(formData, "businessName"),
  });
  // Lo escrito vuelve al formulario si algo falla (sin las contraseñas).
  const values = formValues(formData);

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  const ip = await clientIp();
  if (!(await hitRateLimit(`action:register:ip:${ip}`, RATE_LIMITS.registerPerIp)).allowed) {
    return { error: RATE_LIMIT_MESSAGE, values };
  }

  let userId: string;
  try {
    const created = await auth.api.signUpEmail({
      body: {
        name: parsed.data.name,
        email: parsed.data.email,
        password: parsed.data.password,
      },
    });
    userId = created.user.id;
  } catch (error) {
    return { error: authErrorMessage(error), values };
  }

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(eq(memberships.userId, userId))
        .limit(1);

      if (!existing) {
        await createBusinessForUser(tx, {
          userId,
          name: parsed.data.businessName,
        });
      }
    });
  } catch {
    redirect("/onboarding");
  }

  redirect("/");
}

export async function loginAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: text(formData, "email"),
    password: text(formData, "password"),
  });
  const values = formValues(formData);

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  // Por IP cuenta todo intento; por correo solo los fallos (y se limpian al entrar).
  const ip = await clientIp();
  const emailIpKey = `action:login:fail:${parsed.data.email}:${ip}`;
  const emailKey = `action:login:fail:${parsed.data.email}`;
  const [byIp, emailIpBlocked, emailBlocked] = await Promise.all([
    hitRateLimit(`action:login:ip:${ip}`, RATE_LIMITS.loginPerIp),
    isRateLimited(emailIpKey, RATE_LIMITS.loginFailuresPerEmailIp),
    isRateLimited(emailKey, RATE_LIMITS.loginFailuresPerEmail),
  ]);
  if (!byIp.allowed || emailIpBlocked || emailBlocked) return { error: RATE_LIMIT_MESSAGE, values };

  try {
    await auth.api.signInEmail({
      body: {
        email: parsed.data.email,
        password: parsed.data.password,
        rememberMe: true,
      },
    });
  } catch (error) {
    await Promise.all([
      hitRateLimit(emailIpKey, RATE_LIMITS.loginFailuresPerEmailIp),
      hitRateLimit(emailKey, RATE_LIMITS.loginFailuresPerEmail),
    ]);
    return { error: authErrorMessage(error), values };
  }

  await clearRateLimit(emailIpKey, emailKey);

  redirect("/");
}

function safeRedirectTarget(formData?: FormData): string {
  const value = formData?.get("redirectTo");
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return "/login";
}

export async function logoutAction(formData?: FormData): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect(safeRedirectTarget(formData));
}

export async function completeOnboardingAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await getAuthContext();
  if (context.status === "anonymous") redirect("/login");
  if (context.status === "member") redirect("/");

  const parsed = onboardingSchema.safeParse({
    businessName: text(formData, "businessName"),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  await db.transaction(async (tx) => {
    await createBusinessForUser(tx, {
      userId: context.user.id,
      name: parsed.data.businessName,
    });
  });

  redirect("/");
}
