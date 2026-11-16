import { z } from "zod";
import { normalizePhone } from "@/lib/phone";

export const CURRENCY_CODES = [
  "COP",
  "MXN",
  "PEN",
  "CLP",
  "ARS",
  "USD",
  "EUR",
  "BRL",
  "BOB",
  "PYG",
  "UYU",
  "GTQ",
  "CRC",
  "DOP",
  "PAB",
  "VES",
] as const;

export const CURRENCY_LABELS: Record<(typeof CURRENCY_CODES)[number], string> = {
  COP: "Peso colombiano",
  MXN: "Peso mexicano",
  PEN: "Sol peruano",
  CLP: "Peso chileno",
  ARS: "Peso argentino",
  USD: "Dólar estadounidense",
  EUR: "Euro",
  BRL: "Real brasileño",
  BOB: "Boliviano",
  PYG: "Guaraní",
  UYU: "Peso uruguayo",
  GTQ: "Quetzal",
  CRC: "Colón costarricense",
  DOP: "Peso dominicano",
  PAB: "Balboa",
  VES: "Bolívar",
};

export const TIMEZONE_CODES = [
  "America/Bogota",
  "America/Mexico_City",
  "America/Lima",
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
  "America/Caracas",
  "America/Guayaquil",
  "America/Panama",
  "America/Santo_Domingo",
  "America/La_Paz",
  "America/Montevideo",
  "America/Sao_Paulo",
  "America/New_York",
  "Europe/Madrid",
] as const;

export const TIMEZONE_LABELS: Record<(typeof TIMEZONE_CODES)[number], string> = {
  "America/Bogota": "Bogotá",
  "America/Mexico_City": "Ciudad de México",
  "America/Lima": "Lima",
  "America/Santiago": "Santiago",
  "America/Argentina/Buenos_Aires": "Buenos Aires",
  "America/Caracas": "Caracas",
  "America/Guayaquil": "Guayaquil",
  "America/Panama": "Panamá",
  "America/Santo_Domingo": "Santo Domingo",
  "America/La_Paz": "La Paz",
  "America/Montevideo": "Montevideo",
  "America/Sao_Paulo": "São Paulo",
  "America/New_York": "Nueva York",
  "Europe/Madrid": "Madrid",
};

export const currencySchema = z.enum(CURRENCY_CODES);
export const timezoneSchema = z.enum(TIMEZONE_CODES);

export function currencyLabel(code: string): string {
  return CURRENCY_LABELS[code as keyof typeof CURRENCY_LABELS] ?? code;
}

export function timezoneLabel(code: string): string {
  return TIMEZONE_LABELS[code as keyof typeof TIMEZONE_LABELS] ?? code;
}

export const businessSettingsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "El nombre del negocio debe tener al menos 2 caracteres")
    .max(80, "El nombre del negocio es demasiado largo"),
  currency: currencySchema,
  timezone: timezoneSchema,
  whatsappNumber: z
    .string()
    .trim()
    .max(30)
    .optional()
    .superRefine((value, ctx) => {
      if (value && !normalizePhone(value)) {
        ctx.addIssue({
          code: "custom",
          message: "Escribe un número válido, por ejemplo 300 123 4567",
        });
      }
    })
    .transform((value) => (value ? normalizePhone(value) : null)),
  allowOversell: z.boolean(),
  reservationTtlHours: z.coerce
    .number()
    .int("Debe ser un número entero")
    .min(1, "El mínimo es 1 hora")
    .max(168, "El máximo es 168 horas"),
});

export type BusinessSettingsInput = z.infer<typeof businessSettingsSchema>;
