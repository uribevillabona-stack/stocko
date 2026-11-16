import { z } from "zod";
import { parseMoneyToCents } from "@/lib/money";
import { parseQuantityToMilli } from "@/lib/quantity";

export const UNIT_OPTIONS = [
  { value: "und", label: "Unidad (und)" },
  { value: "kg", label: "Kilogramo (kg)" },
  { value: "g", label: "Gramo (g)" },
  { value: "lb", label: "Libra (lb)" },
  { value: "l", label: "Litro (l)" },
  { value: "ml", label: "Mililitro (ml)" },
  { value: "m", label: "Metro (m)" },
  { value: "caja", label: "Caja" },
  { value: "paquete", label: "Paquete" },
] as const;

const UNIT_VALUES = UNIT_OPTIONS.map((option) => option.value) as [string, ...string[]];

/** Máximo 100.000.000.000 centavos: cubre precios altos en COP con margen. */
const MAX_CENTS = 100_000_000_000;

function optionalText(max: number, message: string) {
  return z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => (value ? value : null));
}

const optionalMoneyField = z
  .string()
  .trim()
  .transform((value, ctx): number | null => {
    if (!value) return null;
    const cents = parseMoneyToCents(value);
    if (cents === null || cents > MAX_CENTS) {
      ctx.addIssue({ code: "custom", message: "Escribe un valor válido, por ejemplo 4.500" });
      return z.NEVER;
    }
    return cents;
  });

const requiredMoneyField = z
  .string()
  .trim()
  .min(1, "Escribe el precio")
  .pipe(optionalMoneyField)
  .transform((value) => value ?? 0);

function quantityField(options: { allowZero: boolean; emptyAsZero?: boolean }) {
  return z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (!value && options.emptyAsZero) return 0;
      const milli = parseQuantityToMilli(value);
      if (milli === null) {
        ctx.addIssue({
          code: "custom",
          message: "Escribe una cantidad válida (hasta 3 decimales), por ejemplo 2 o 1,5",
        });
        return z.NEVER;
      }
      if (!options.allowZero && milli === 0) {
        ctx.addIssue({ code: "custom", message: "La cantidad debe ser mayor que cero" });
        return z.NEVER;
      }
      return milli;
    });
}

const skuField = z
  .string()
  .trim()
  .max(40, "El código es demasiado largo")
  .refine((value) => !value || /^[\p{L}\p{N}._\-/]+$/u.test(value), {
    message: "Usa letras, números, guion, punto o barra, sin espacios",
  })
  .transform((value) => (value ? value.toUpperCase() : null));

export const productSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "El nombre debe tener al menos 2 caracteres")
    .max(120, "El nombre es demasiado largo"),
  description: optionalText(500, "La descripción es demasiado larga"),
  categoryName: optionalText(60, "La categoría es demasiado larga"),
  unit: z.enum(UNIT_VALUES, "Elige una unidad"),
});

export const variantFieldsSchema = z.object({
  sku: skuField,
  priceCents: requiredMoneyField,
  costCents: optionalMoneyField,
  minStockMilli: quantityField({ allowZero: true, emptyAsZero: true }),
});

export const newProductSchema = productSchema.extend({
  ...variantFieldsSchema.shape,
  initialStockMilli: quantityField({ allowZero: true, emptyAsZero: true }),
});

export const newVariantSchema = variantFieldsSchema.extend({
  name: z
    .string()
    .trim()
    .min(1, "Escribe el nombre de la variante")
    .max(60, "El nombre es demasiado largo"),
  initialStockMilli: quantityField({ allowZero: true, emptyAsZero: true }),
});

export const updateVariantSchema = variantFieldsSchema.extend({
  name: z.string().trim().max(60, "El nombre es demasiado largo"),
  isActive: z.boolean(),
});

export const MOVEMENT_KINDS = ["entry", "exit", "adjustment", "reserve"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const movementSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("entry"),
    variantId: z.uuid("Elige una variante"),
    qtyMilli: quantityField({ allowZero: false }),
    reason: optionalText(200, "La nota es demasiado larga"),
  }),
  z.object({
    kind: z.literal("exit"),
    variantId: z.uuid("Elige una variante"),
    qtyMilli: quantityField({ allowZero: false }),
    reason: optionalText(200, "La nota es demasiado larga"),
  }),
  z.object({
    kind: z.literal("adjustment"),
    variantId: z.uuid("Elige una variante"),
    qtyMilli: quantityField({ allowZero: true }),
    reason: optionalText(200, "La nota es demasiado larga"),
  }),
  z.object({
    kind: z.literal("reserve"),
    variantId: z.uuid("Elige una variante"),
    qtyMilli: quantityField({ allowZero: false }),
    reason: z
      .string()
      .trim()
      .min(2, "Escribe para quién es la reserva")
      .max(120, "La referencia es demasiado larga"),
  }),
]);

export type MovementInput = z.infer<typeof movementSchema>;
