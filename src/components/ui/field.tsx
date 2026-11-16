import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const inputStyles =
  "h-11 w-full rounded-xl border border-border bg-card px-3.5 text-sm text-ink transition-[border-color,box-shadow] duration-200 placeholder:text-muted/70 hover:border-ink/20 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 disabled:opacity-60";

export const selectStyles =
  "h-11 w-full rounded-xl border border-border bg-card px-3.5 text-sm text-ink transition-[border-color,box-shadow] duration-200 hover:border-ink/20 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15";

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-muted">{hint}</p> : null}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const textareaStyles =
  "min-h-20 w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm text-ink transition-[border-color,box-shadow] duration-200 placeholder:text-muted/70 hover:border-ink/20 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 disabled:opacity-60";
