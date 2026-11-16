import { describe, expect, it } from "vitest";
import { businessSettingsSchema } from "@/lib/validation/settings";

const base = {
  name: "Tienda La Esquina",
  currency: "COP",
  timezone: "America/Bogota",
  whatsappNumber: "300 123 4567",
  allowOversell: false,
  reservationTtlHours: 24,
};

describe("businessSettingsSchema", () => {
  it("acepta ajustes válidos y normaliza el teléfono", () => {
    const parsed = businessSettingsSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.whatsappNumber).toBe("+573001234567");
      expect(parsed.data.reservationTtlHours).toBe(24);
    }
  });

  it("convierte horas de texto a número", () => {
    const parsed = businessSettingsSchema.safeParse({ ...base, reservationTtlHours: "48" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.reservationTtlHours).toBe(48);
  });

  it("permite dejar WhatsApp vacío", () => {
    const parsed = businessSettingsSchema.safeParse({ ...base, whatsappNumber: "" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.whatsappNumber).toBeNull();
  });

  it("rechaza nombres cortos, monedas desconocidas y reservas fuera de rango", () => {
    expect(businessSettingsSchema.safeParse({ ...base, name: "A" }).success).toBe(false);
    expect(businessSettingsSchema.safeParse({ ...base, currency: "XXX" }).success).toBe(false);
    expect(
      businessSettingsSchema.safeParse({ ...base, timezone: "Marte/Olympus" }).success,
    ).toBe(false);
    expect(
      businessSettingsSchema.safeParse({ ...base, reservationTtlHours: 0 }).success,
    ).toBe(false);
    expect(
      businessSettingsSchema.safeParse({ ...base, reservationTtlHours: 200 }).success,
    ).toBe(false);
  });

  it("rechaza un teléfono inválido", () => {
    expect(
      businessSettingsSchema.safeParse({ ...base, whatsappNumber: "123" }).success,
    ).toBe(false);
  });
});
