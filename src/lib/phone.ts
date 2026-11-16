/**
 * Normaliza teléfonos a E.164. Para Colombia asume +57 cuando llegan 10 dígitos.
 */
export function normalizePhone(raw: string, defaultCountry = "57"): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  if (digits.startsWith("00") && digits.length > 4) {
    const withoutPrefix = digits.slice(2);
    return withoutPrefix.length >= 8 && withoutPrefix.length <= 15
      ? `+${withoutPrefix}`
      : null;
  }

  if (defaultCountry === "57") {
    if (digits.length === 10 && digits.startsWith("3")) return `+57${digits}`;
    if (digits.length === 12 && digits.startsWith("57")) return `+${digits}`;
  }

  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function formatPhone(phone: string): string {
  if (phone.startsWith("+57") && phone.length === 13) {
    return `+57 ${phone.slice(3, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}`;
  }
  return phone;
}

export function waLink(phone: string, message: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}
