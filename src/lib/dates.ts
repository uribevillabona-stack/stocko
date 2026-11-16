export function formatDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeZone,
  }).format(date);
}

export function formatDateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("es-CO", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Días en la zona horaria del negocio                                         */
/* Las fechas se guardan en UTC; "hoy" depende de la zona del negocio.          */
/* -------------------------------------------------------------------------- */

/** "YYYY-MM-DD" de `date` en la zona `timeZone`. */
export function localDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function offsetMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Instante UTC en que empieza el día `key` ("YYYY-MM-DD") en `timeZone`. */
export function startOfLocalDay(key: string, timeZone: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  const guess = Date.UTC(year!, month! - 1, day!);
  let result = guess - offsetMs(new Date(guess), timeZone);
  // Segunda pasada por si el cambio de horario cae justo en ese día.
  const corrected = guess - offsetMs(new Date(result), timeZone);
  if (corrected !== result) result = corrected;
  // Si la medianoche no existe ese día (el reloj salta de 23:59 a 01:00, como en
  // Santiago), el día empieza en el primer instante cuya fecha local es `key`.
  for (let step = 0; step < 16 && localDateKey(new Date(result), timeZone) < key; step++) {
    result += 15 * 60 * 1000;
  }
  return new Date(result);
}

/** Suma días a una clave "YYYY-MM-DD" (calendario, sin zona). */
export function addDaysToKey(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

export function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  // Ida y vuelta: rechaza fechas imposibles como 2026-02-31 (V8 las corre a marzo).
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Rango [from, to) que cubre los días locales `fromKey`..`toKey` inclusive. */
export function localDayRange(fromKey: string, toKey: string, timeZone: string) {
  return {
    from: startOfLocalDay(fromKey, timeZone),
    to: startOfLocalDay(addDaysToKey(toKey, 1), timeZone),
  };
}
