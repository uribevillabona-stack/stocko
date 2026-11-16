"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { db } from "@/lib/db/client";
import { businesses } from "@/lib/db/schema";
import { businessSettingsSchema } from "@/lib/validation/settings";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/request";
import { requireOwner } from "@/server/auth/context";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function updateBusinessAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireOwner();

  const parsed = businessSettingsSchema.safeParse({
    name: text(formData, "name"),
    currency: text(formData, "currency"),
    timezone: text(formData, "timezone"),
    whatsappNumber: text(formData, "whatsappNumber"),
    allowOversell: formData.get("allowOversell") === "on",
    reservationTtlHours: text(formData, "reservationTtlHours"),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  await db
    .update(businesses)
    .set({
      name: parsed.data.name,
      currency: parsed.data.currency,
      timezone: parsed.data.timezone,
      whatsappNumber: parsed.data.whatsappNumber,
      allowOversell: parsed.data.allowOversell,
      reservationTtlHours: parsed.data.reservationTtlHours,
      updatedAt: new Date(),
    })
    .where(and(eq(businesses.id, context.business.id)));

  await recordAudit({
    businessId: context.business.id,
    userId: context.user.id,
    action: "business.updated",
    entityType: "business",
    entityId: context.business.id,
    details: {
      name: parsed.data.name,
      currency: parsed.data.currency,
      timezone: parsed.data.timezone,
      allowOversell: parsed.data.allowOversell,
      reservationTtlHours: parsed.data.reservationTtlHours,
    },
    ipAddress: await clientIp(),
  });

  revalidatePath("/", "layout");

  return { success: "Cambios guardados." };
}
