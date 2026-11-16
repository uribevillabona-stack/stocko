import { describe, expect, it } from "vitest";
import { formatMoney, parseMoneyToCents } from "@/lib/money";

describe("parseMoneyToCents", () => {
  it("interpreta separadores de miles colombianos", () => {
    expect(parseMoneyToCents("4.500")).toBe(450_000);
    expect(parseMoneyToCents("$ 4.500,50")).toBe(450_050);
    expect(parseMoneyToCents("4500,50")).toBe(450_050);
  });

  it("acepta decimales con punto y valores enteros", () => {
    expect(parseMoneyToCents("12.34")).toBe(1_234);
    expect(parseMoneyToCents("0")).toBe(0);
    expect(parseMoneyToCents("1.234.567")).toBe(123_456_700);
  });

  it("rechaza entradas inválidas", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("-5")).toBeNull();
  });
});

describe("formatMoney", () => {
  it("formatea centavos como pesos", () => {
    expect(formatMoney(450_000, "COP", "es-CO")).toContain("4.500");
  });
});
