"use client";

import { useActionState } from "react";
import { registerAction } from "@/actions/auth";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert } from "@/components/ui/alert";
import { Field, inputStyles } from "@/components/ui/field";
import { firstFieldError, initialActionState } from "@/lib/action-state";

export function RegisterForm() {
  const [state, formAction] = useActionState(registerAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}

      <Field label="Tu nombre" htmlFor="name" error={firstFieldError(state, "name")}>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          autoFocus
          placeholder="Ana Pérez"
          className={inputStyles}
        />
      </Field>

      <Field
        label="Nombre del negocio"
        htmlFor="businessName"
        error={firstFieldError(state, "businessName")}
      >
        <input
          id="businessName"
          name="businessName"
          type="text"
          autoComplete="organization"
          placeholder="Tienda La Esquina"
          className={inputStyles}
        />
      </Field>

      <Field label="Correo" htmlFor="email" error={firstFieldError(state, "email")}>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="tu@correo.com"
          className={inputStyles}
        />
      </Field>

      <Field
        label="Contraseña"
        htmlFor="password"
        hint="Mínimo 8 caracteres."
        error={firstFieldError(state, "password")}
      >
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          className={inputStyles}
        />
      </Field>

      <SubmitButton className="w-full" pendingLabel="Creando cuenta…">
        Crear cuenta
      </SubmitButton>
    </form>
  );
}
