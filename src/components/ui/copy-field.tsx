"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { inputStyles } from "@/components/ui/field";
import { cn } from "@/lib/cn";

export function CopyField({ value, label = "Enlace" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Si el portapapeles no está disponible, el campo sigue siendo seleccionable.
    }
  }

  return (
    <div className="flex gap-2">
      <input
        readOnly
        value={value}
        aria-label={label}
        onFocus={(event) => event.currentTarget.select()}
        className={cn(inputStyles, "font-mono text-xs")}
      />
      <Button type="button" variant="secondary" onClick={copy} className="shrink-0">
        {copied ? (
          <Check className="size-4" strokeWidth={1.75} />
        ) : (
          <Copy className="size-4" strokeWidth={1.75} />
        )}
        {copied ? "Copiado" : "Copiar"}
      </Button>
    </div>
  );
}
