/**
 * Las cantidades se guardan en milésimas enteras (`qty_milli`): 1 unidad = 1000.
 * Así se admiten productos por peso o volumen (1,5 kg) sin errores de coma flotante.
 */
export const MILLI = 1000;

/** Tope de seguridad: la columna es `integer` (máx. 2.147.483.647 milésimas). */
export const MAX_QTY_MILLI = 2_000_000 * MILLI;

/**
 * Interpreta "3", "1,5", "1.5", "1.500", "2.500,25" o "2,500.25".
 * La coma es decimal. Un punto seguido de exactamente 3 dígitos es separador de
 * miles ("1.500" = 1500, como lo muestra la interfaz); en otro caso es decimal.
 * Devuelve null si el texto no es una cantidad válida o tiene más de 3 decimales.
 */
export function parseQuantityToMilli(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s/g, "");
  if (!cleaned || !/^[\d.,]+$/.test(cleaned)) return null;

  let normalized = cleaned;
  const dots = (cleaned.match(/\./g) ?? []).length;
  const commas = (cleaned.match(/,/g) ?? []).length;

  const groupedOk = (integerPart: string, separator: string) =>
    new RegExp(`^\\d{1,3}(\\${separator}\\d{3})+$`).test(integerPart);

  if (dots > 0 && commas > 0) {
    const decimal = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".") ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    if ((decimal === "," ? commas : dots) > 1) return null;
    const [integerPart = "", fractionPart = ""] = cleaned.split(decimal);
    if (!groupedOk(integerPart, thousands)) return null;
    normalized = `${integerPart.split(thousands).join("")}.${fractionPart}`;
  } else if (dots > 1 || commas > 1) {
    if (!groupedOk(cleaned, dots > 1 ? "." : ",")) return null;
    normalized = cleaned.replace(/[.,]/g, "");
  } else if (dots === 1 && /^[1-9]\d{0,2}\.\d{3}$/.test(cleaned)) {
    // "1.500" es mil quinientos: así se muestran las cantidades (es-CO) y así
    // se interpretan los precios. Para decimales se usa coma: "1,5".
    normalized = cleaned.replace(".", "");
  } else {
    normalized = cleaned.replace(",", ".");
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const [, fraction = ""] = normalized.split(".");
  if (fraction.length > 3) return null;

  const [whole = "0"] = normalized.split(".");
  const milli = Number(whole) * MILLI + Number(fraction.padEnd(3, "0") || "0");
  if (!Number.isSafeInteger(milli) || milli > MAX_QTY_MILLI) return null;
  return milli;
}

export function formatQuantity(milli: number, unit?: string | null): string {
  const value = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(
    milli / MILLI,
  );
  return unit ? `${value} ${unit}` : value;
}

/** Valor para rellenar un campo de formulario editable (sin separador de miles). */
export function quantityInputValue(milli: number): string {
  return String(milli / MILLI).replace(".", ",");
}
