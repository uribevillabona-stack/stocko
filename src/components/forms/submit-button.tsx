"use client";

import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

type SubmitButtonProps = Omit<ComponentProps<typeof Button>, "type"> & {
  pendingLabel?: string;
  /** Estado de envío explícito (formularios enviados con useFormAction). */
  pending?: boolean;
};

export function SubmitButton({
  children,
  pendingLabel = "Guardando…",
  disabled,
  pending: pendingProp,
  ...props
}: SubmitButtonProps) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;

  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={pending} {...props}>
      {pending ? <Loader2 className="size-4 animate-spin" strokeWidth={2} /> : null}
      {pending ? pendingLabel : children}
    </Button>
  );
}
