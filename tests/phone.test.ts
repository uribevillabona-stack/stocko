import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone } from "@/lib/phone";

describe("normalizePhone", () => {
  it("normaliza celulares colombianos de diez dígitos", () => {
    expect(normalizePhone("300 123 4567")).toBe("+573001234567");
    expect(normalizePhone("3001234567")).toBe("+573001234567");
    expect(normalizePhone("57 300 123 4567")).toBe("+573001234567");
  });

  it("respeta números internacionales", () => {
    expect(normalizePhone("+1 (555) 123-4567")).toBe("+15551234567");
    expect(normalizePhone("0057 3001234567")).toBe("+573001234567");
  });

  it("rechaza números incompletos", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
  });
});

describe("formatPhone", () => {
  it("agrupa el formato colombiano", () => {
    expect(formatPhone("+573001234567")).toBe("+57 300 123 4567");
    expect(formatPhone("+15551234567")).toBe("+15551234567");
  });
});
