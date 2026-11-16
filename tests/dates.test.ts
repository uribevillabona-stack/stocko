import { describe, expect, it } from "vitest";
import { addDaysToKey, isDateKey, localDateKey, localDayRange, startOfLocalDay } from "@/lib/dates";

describe("días en la zona del negocio", () => {
  it("Bogotá (UTC−5): el día empieza a las 05:00 UTC", () => {
    expect(startOfLocalDay("2026-11-07", "America/Bogota").toISOString()).toBe("2026-11-07T05:00:00.000Z");
    // 23:30 en Bogotá ya es el día siguiente en UTC, pero sigue siendo el 7 local.
    expect(localDateKey(new Date("2026-11-08T04:30:00Z"), "America/Bogota")).toBe("2026-11-07");
  });

  it("Madrid respeta el cambio de horario", () => {
    expect(startOfLocalDay("2026-07-01", "Europe/Madrid").toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(startOfLocalDay("2026-12-01", "Europe/Madrid").toISOString()).toBe("2026-11-30T23:00:00.000Z");
    // Día del cambio (29 de marzo de 2026): empieza a medianoche CET.
    expect(startOfLocalDay("2026-03-29", "Europe/Madrid").toISOString()).toBe("2026-03-28T23:00:00.000Z");
  });

  it("día sin medianoche (Santiago adelanta el reloj a las 00:00)", () => {
    // 6 de septiembre de 2026: 00:00 no existe; el día empieza a la 01:00 (UTC−3).
    const start = startOfLocalDay("2026-09-06", "America/Santiago");
    expect(start.toISOString()).toBe("2026-09-06T04:00:00.000Z");
    expect(localDateKey(new Date(start.getTime() - 1), "America/Santiago")).toBe("2026-09-05");
  });

  it("rechaza fechas imposibles", () => {
    expect(isDateKey("2026-02-28")).toBe(true);
    expect(isDateKey("2028-02-29")).toBe(true);
    expect(isDateKey("2026-02-31")).toBe(false);
    expect(isDateKey("2026-13-01")).toBe(false);
    expect(isDateKey("26-1-1")).toBe(false);
  });

  it("rango inclusivo de días y suma de días", () => {
    const range = localDayRange("2026-11-01", "2026-11-07", "America/Bogota");
    expect(range.from.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-11-08T05:00:00.000Z");
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToKey("2026-03-01", -1)).toBe("2026-02-28");
  });
});
