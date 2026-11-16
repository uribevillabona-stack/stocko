import { z } from "zod";
import { parseMoneyToCents } from "@/lib/money";
import { normalizePhone } from "@/lib/phone";
import { parseQuantityToMilli } from "@/lib/quantity";

const MAX_CENTS = 100_000_000_000;

export const PAYMENT_METHODS = ["cash", "transfer", "card", "other"] as const;

export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card: "Tarjeta",
  other: "Otro",
};

function money(message: string, options: { allowEmpty: boolean }) {
  return z
    .string()
    .trim()
    .transform((value, ctx): number => {
      if (!value) {
        if (options.allowEmpty) return 0;
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      const cents = parseMoneyToCents(value);
      if (cents === null || cents > MAX_CENTS) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return cents;
    });
}

export const customerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Escribe el nombre del cliente")
    .max(120, "El nombre es demasiado largo"),
  phone: z
    .string()
    .trim()
    .max(30)
    .superRefine((value, ctx) => {
      if (value && !normalizePhone(value)) {
        ctx.addIssue({ code: "custom", message: "Escribe un número válido, por ejemplo 300 123 4567" });
      }
    })
    .transform((value) => (value ? normalizePhone(value) : null)),
  email: z
    .string()
    .trim()
    .max(120)
    .refine((value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "Escribe un correo válido")
    .transform((value) => (value ? value.toLowerCase() : null)),
  notes: z
    .string()
    .trim()
    .max(500, "La nota es demasiado larga")
    .transform((value) => (value ? value : null)),
});

export const saleItemSchema = z.object({
  // En minúsculas: así un mismo id en mayúsculas no esquiva DUPLICATE_ITEM.
  variantId: z.uuid("Producto inválido").transform((value) => value.toLowerCase()),
  qty: z
    .string()
    .trim()
    .transform((value, ctx): number => {
      const milli = parseQuantityToMilli(value);
      if (milli === null || milli === 0) {
        ctx.addIssue({ code: "custom", message: "Revisa las cantidades: deben ser mayores que cero" });
        return z.NEVER;
      }
      return milli;
    }),
  price: money("Revisa los precios de los productos", { allowEmpty: false }),
});

export const saleSchema = z.object({
  customerId: z
    .string()
    .trim()
    .transform((value) => value || null)
    .pipe(z.uuid("Cliente inválido").nullable())
    .transform((value) => value?.toLowerCase() ?? null),
  items: z.array(saleItemSchema).min(1, "Agrega al menos un producto").max(200, "Demasiados productos"),
  discount: money("Escribe un descuento válido", { allowEmpty: true }),
  paid: money("Escribe un pago válido", { allowEmpty: true }),
  method: z.enum(PAYMENT_METHODS, "Elige cómo pagó"),
  note: z
    .string()
    .trim()
    .max(300, "La nota es demasiado larga")
    .transform((value) => (value ? value : null)),
});

export type SalePayload = z.input<typeof saleSchema>;

export const paymentSchema = z.object({
  amount: money("Escribe un valor válido, por ejemplo 20.000", { allowEmpty: false }).refine(
    (value) => value > 0,
    "El abono debe ser mayor que cero",
  ),
  method: z.enum(PAYMENT_METHODS, "Elige cómo pagó"),
  note: z
    .string()
    .trim()
    .max(200, "La nota es demasiado larga")
    .transform((value) => (value ? value : null)),
});

export const cancelSaleSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Escribe por qué se anula")
    .max(200, "El motivo es demasiado largo"),
});
