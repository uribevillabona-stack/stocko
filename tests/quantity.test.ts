import { describe, expect, it } from "vitest";
import { formatQuantity, parseQuantityToMilli, quantityInputValue } from "@/lib/quantity";
import { movementSchema, newProductSchema } from "@/lib/validation/inventory";
import { saleSchema } from "@/lib/validation/sales";

describe("parseQuantityToMilli", () => {
  it("interpreta enteros y decimales con coma o punto", () => {
    expect(parseQuantityToMilli("3")).toBe(3000);
    expect(parseQuantityToMilli("1,5")).toBe(1500);
    expect(parseQuantityToMilli("1.5")).toBe(1500);
    expect(parseQuantityToMilli("0,125")).toBe(125);
    expect(parseQuantityToMilli(" 12 ")).toBe(12000);
  });

  it("lee «1.500» como mil quinientos, igual que se muestra y que los precios", () => {
    expect(parseQuantityToMilli("1.500")).toBe(1500000);
    expect(parseQuantityToMilli("15.000")).toBe(15000000);
    expect(parseQuantityToMilli(formatQuantity(1500000))).toBe(1500000);
    expect(parseQuantityToMilli("0.125")).toBe(125);
    expect(parseQuantityToMilli("1.25")).toBe(1250);
  });

  it("admite separadores de miles", () => {
    expect(parseQuantityToMilli("2.500,25")).toBe(2500250);
    expect(parseQuantityToMilli("2,500.25")).toBe(2500250);
    expect(parseQuantityToMilli("1.000.000")).toBe(1000000000);
  });

  it("rechaza texto, negativos, más de 3 decimales y valores enormes", () => {
    expect(parseQuantityToMilli("")).toBeNull();
    expect(parseQuantityToMilli("abc")).toBeNull();
    expect(parseQuantityToMilli("-2")).toBeNull();
    expect(parseQuantityToMilli("1,2345")).toBeNull();
    expect(parseQuantityToMilli("1,2,3.4")).toBeNull();
    expect(parseQuantityToMilli("9999999")).toBeNull();
  });

  it("formatea para mostrar y para editar", () => {
    expect(formatQuantity(1500, "kg")).toBe("1,5 kg");
    expect(formatQuantity(-2000)).toBe("-2");
    expect(quantityInputValue(1250)).toBe("1,25");
  });
});

describe("validación de inventario", () => {
  const base = {
    name: "Arroz",
    description: "",
    categoryName: "",
    unit: "und",
    sku: "",
    priceCents: "4.500",
    costCents: "",
    minStockMilli: "",
    initialStockMilli: "",
  };

  it("acepta un producto mínimo y convierte valores", () => {
    const parsed = newProductSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toMatchObject({
        sku: null,
        categoryName: null,
        priceCents: 450000,
        costCents: null,
        minStockMilli: 0,
        initialStockMilli: 0,
      });
    }
  });

  it("exige precio y SKU sin espacios", () => {
    expect(newProductSchema.safeParse({ ...base, priceCents: "" }).success).toBe(false);
    expect(newProductSchema.safeParse({ ...base, sku: "con espacio" }).success).toBe(false);
    expect(newProductSchema.safeParse({ ...base, unit: "barril" }).success).toBe(false);
  });

  it("normaliza ids de venta a minúsculas (no se esquiva el chequeo de duplicados)", () => {
    const id = "4D6F7A3E-8B1C-4C2A-9F3E-2B1A0C9D8E7F";
    const parsed = saleSchema.parse({
      customerId: "",
      items: [{ variantId: id, qty: "1", price: "100" }],
      discount: "",
      paid: "100",
      method: "cash",
      note: "",
    });
    expect(parsed.items[0]?.variantId).toBe(id.toLowerCase());
    expect(parsed.customerId).toBeNull();
  });

  it("valida cada tipo de movimiento", () => {
    const variantId = "4d6f7a3e-8b1c-4c2a-9f3e-2b1a0c9d8e7f";
    expect(
      movementSchema.safeParse({ kind: "entry", variantId, qtyMilli: "0", reason: "" }).success,
    ).toBe(false);
    expect(
      movementSchema.safeParse({ kind: "adjustment", variantId, qtyMilli: "0", reason: "" })
        .success,
    ).toBe(true);
    expect(
      movementSchema.safeParse({ kind: "reserve", variantId, qtyMilli: "1", reason: "" }).success,
    ).toBe(false);
    expect(
      movementSchema.safeParse({ kind: "reserve", variantId, qtyMilli: "1", reason: "Ana" })
        .success,
    ).toBe(true);
    expect(
      movementSchema.safeParse({ kind: "robo", variantId, qtyMilli: "1", reason: "" }).success,
    ).toBe(false);
  });
});
