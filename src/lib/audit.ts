import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditEvents, user } from "@/lib/db/schema";

export type AuditAction =
  | "business.updated"
  | "team.invitation_created"
  | "team.invitation_revoked"
  | "team.member_removed"
  | "team.member_joined"
  | "team.employee_created"
  | "product.created"
  | "product.updated"
  | "product.deactivated"
  | "product.reactivated"
  | "variant.price_changed"
  | "variant.updated"
  | "stock.adjusted"
  | "sale.created"
  | "sale.cancelled"
  | "payment.added"
  | "whatsapp.settings_updated"
  | "catalog.updated"
  | "account.password_changed";

/**
 * Registra una acción sensible. Nunca debe romper la acción principal: si
 * falla, solo se informa en el log (sin datos personales).
 */
export async function recordAudit(input: {
  businessId: string;
  userId: string | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}) {
  try {
    await db.insert(auditEvents).values({
      businessId: input.businessId,
      userId: input.userId,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      details: input.details ?? null,
      ipAddress: input.ipAddress ?? null,
    });
  } catch (error) {
    console.error("No se pudo registrar auditoría", error instanceof Error ? error.message : "");
  }
}

export async function listAuditEvents(businessId: string, options: { before?: Date; limit?: number } = {}) {
  return db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      details: auditEvents.details,
      ipAddress: auditEvents.ipAddress,
      createdAt: auditEvents.createdAt,
      userName: user.name,
    })
    .from(auditEvents)
    .leftJoin(user, eq(user.id, auditEvents.userId))
    .where(
      and(
        eq(auditEvents.businessId, businessId),
        options.before ? lt(auditEvents.createdAt, options.before) : undefined,
      ),
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(options.limit ?? 100);
}

export const AUDIT_LABELS: Record<AuditAction, string> = {
  "business.updated": "Cambió los datos del negocio",
  "team.invitation_created": "Invitó a alguien al equipo",
  "team.invitation_revoked": "Revocó una invitación",
  "team.member_removed": "Quitó a alguien del equipo",
  "team.member_joined": "Se unió al equipo",
  "team.employee_created": "Creó la cuenta de un trabajador",
  "product.created": "Creó un producto",
  "product.updated": "Editó un producto",
  "product.deactivated": "Desactivó un producto",
  "product.reactivated": "Reactivó un producto",
  "variant.price_changed": "Cambió un precio",
  "variant.updated": "Editó una variante",
  "stock.adjusted": "Ajustó stock por conteo",
  "sale.created": "Vendió con descuento o con precio cambiado",
  "sale.cancelled": "Anuló una venta",
  "payment.added": "Registró un abono",
  "whatsapp.settings_updated": "Cambió la configuración de WhatsApp",
  "catalog.updated": "Cambió el catálogo en línea",
  "account.password_changed": "Cambió su contraseña",
};
