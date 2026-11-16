import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "brand" | "warn" | "danger" | "success";

const tones: Record<Tone, string> = {
  neutral: "bg-hover text-muted",
  brand: "bg-brand-soft text-brand",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  success: "bg-success-soft text-success",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
