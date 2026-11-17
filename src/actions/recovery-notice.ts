"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/server/auth/context";
import { dismissOwnerRecoveryNotice, ownerRecoveryNotice } from "@/server/services/recovery-notice";

/**
 * «Entendido» en el aviso de contraseña cambiada. Solo marca como visto lo que hay
 * ahora (lo calcula el servidor): un cambio posterior vuelve a mostrar el aviso.
 */
export async function dismissRecoveryNoticeAction(): Promise<void> {
  const context = await requireOwner();
  const notice = await ownerRecoveryNotice(context.business.id, context.user.id);
  const latest = notice[0];
  if (latest) await dismissOwnerRecoveryNotice(context.user.id, latest.at);
  revalidatePath("/", "layout");
}
