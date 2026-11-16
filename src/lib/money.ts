/**
 * El dinero se guarda siempre en centavos (enteros).
 * El formato de entrada acepta "4.500", "4,500.50" y "4500,50".
 */
export function parseMoneyToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;

  let normalized = cleaned;
  const hasDot = normalized.includes(".");
  const hasComma = normalized.includes(",");

  if (hasDot && hasComma) {
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (hasComma) {
    const parts = normalized.split(",");
    normalized =
      parts.length === 2 && (parts[1]?.length ?? 0) <= 2
        ? `${parts[0]}.${parts[1]}`
        : normalized.replace(/,/g, "");
  } else if (hasDot) {
    const parts = normalized.split(".");
    if (parts.length > 2) {
      normalized = parts.join("");
    } else if ((parts[1]?.length ?? 0) === 3) {
      normalized = parts.join("");
    }
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export function formatMoney(
  cents: number,
  currency: string,
  locale = "es-CO",
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function currencyFractionDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("es-CO", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** Valor para rellenar un campo de precio editable: 450000 → "4500", 450050 → "4500,5". */
export function moneyInputValue(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return String(cents / 100).replace(".", ",");
}
