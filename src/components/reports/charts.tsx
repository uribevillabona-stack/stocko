import { cn } from "@/lib/cn";

/**
 * Barras verticales de una sola serie (ventas por día). Un solo color de marca:
 * es magnitud, no identidad, así que no lleva leyenda; el título la nombra.
 * Cada barra tiene tooltip al pasar o enfocar, y debajo hay una tabla.
 */
export function DailyBars({
  data,
  formatValue,
  formatDay,
}: {
  data: Array<{ day: string; value: number; detail: string }>;
  formatValue: (value: number) => string;
  formatDay: (day: string) => string;
}) {
  const max = Math.max(...data.map((point) => point.value), 0);
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));

  if (max === 0) {
    return <p className="py-8 text-center text-sm text-muted">Sin ventas en este periodo.</p>;
  }

  return (
    <div>
      <div className="relative flex h-44 items-end gap-[2px] border-b border-border" role="list">
        {data.map((point) => {
          const height = point.value > 0 ? Math.max(2, (point.value / max) * 100) : 0;
          return (
            <div
              key={point.day}
              role="listitem"
              tabIndex={0}
              aria-label={`${formatDay(point.day)}: ${formatValue(point.value)}, ${point.detail}`}
              className="group relative flex h-full min-w-0 flex-1 items-end justify-center outline-none"
            >
              <div
                className="w-full max-w-6 rounded-t-[4px] bg-brand/85 transition-colors group-hover:bg-brand group-focus-visible:bg-brand"
                style={{ height: `${height}%` }}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-md group-hover:block group-focus-visible:block">
                <p className="text-muted">{formatDay(point.day)}</p>
                <p className="font-semibold text-ink tnum">{formatValue(point.value)}</p>
                <p className="text-muted">{point.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-[2px]" aria-hidden="true">
        {data.map((point, index) => (
          <div key={point.day} className="min-w-0 flex-1 text-center text-[10px] text-muted">
            {index % labelEvery === 0 ? formatDay(point.day) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Lista con barra horizontal de magnitud (desgloses: medios de pago, vendedores…). */
export function BarList({
  rows,
  formatValue,
  emptyLabel = "Sin datos en este periodo.",
}: {
  rows: Array<{ key: string; label: string; value: number; detail?: string }>;
  formatValue: (value: number) => string;
  emptyLabel?: string;
}) {
  const max = Math.max(...rows.map((row) => row.value), 0);
  if (rows.length === 0 || max === 0) return <p className="text-sm text-muted">{emptyLabel}</p>;

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink">{row.label}</span>
            <span className="shrink-0 font-medium text-ink tnum">{formatValue(row.value)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-surface">
              <div
                className={cn("h-1.5 rounded-full bg-brand/85")}
                style={{ width: `${Math.max(1, (row.value / max) * 100)}%` }}
              />
            </div>
            {row.detail ? <span className="shrink-0 text-xs text-muted">{row.detail}</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
