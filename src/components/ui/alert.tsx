import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Alert({
  tone = "danger",
  children,
}: {
  tone?: "danger" | "success" | "warn";
  children: ReactNode;
}) {
  const tones = {
    danger: "border-danger/25 bg-danger-soft text-danger",
    success: "border-success/25 bg-success-soft text-success",
    warn: "border-warn/25 bg-warn-soft text-warn",
  } as const;

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("animate-pop rounded-xl border px-3.5 py-2.5 text-sm font-medium", tones[tone])}
    >
      {children}
    </div>
  );
}
