/**
 * Tope de una venta en centavos: 10 billones de unidades de moneda. Está por
 * debajo de Number.MAX_SAFE_INTEGER (≈ 9e15), así que los montos que llegan
 * a JS como number nunca pierden precisión.
 */
export const MAX_SALE_CENTS = 1_000_000_000_000_000; // 1e15

/**
 * Total de una línea: cantidad (milésimas) × precio (centavos), redondeado al
 * centavo. Se usa en el formulario y en el servidor para que siempre coincidan.
 * Devuelve null si el resultado supera el tope.
 */
export function computeLineTotal(qtyMilli: number, unitPriceCents: number): number | null {
  const cents = (BigInt(qtyMilli) * BigInt(unitPriceCents) + 500n) / 1000n;
  return cents > BigInt(MAX_SALE_CENTS) ? null : Number(cents);
}
