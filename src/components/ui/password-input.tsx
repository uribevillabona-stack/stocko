"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { inputStyles } from "@/components/ui/field";

/**
 * Contraseña con botón para verla: así se nota un error al escribirla
 * (Bloq Mayús, otra distribución de teclado) antes de guardar la cuenta.
 */
export function PasswordInput({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      {/* Al mostrarla es un campo de texto: sin corrector (algunos envían el texto a la nube). */}
      <input
        {...props}
        type={visible ? "text" : "password"}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="none"
        className={cn(inputStyles, "pr-24", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-controls={props.id}
        className="absolute inset-y-1 right-1 inline-flex items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted transition-colors hover:bg-ink/5 hover:text-ink focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/15"
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        {visible ? "Ocultar" : "Mostrar"}
      </button>
    </div>
  );
}
