"use client";

import { useActionState } from "react";
import { registerAction } from "@/actions/auth";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert } from "@/components/ui/alert";
import { Field, inputStyles } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { fieldValue, firstFieldError, initialActionState } from "@/lib/action-state";

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
          defaultValue={fieldValue(state, "name")}
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
          defaultValue={fieldValue(state, "businessName")}
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
          defaultValue={fieldValue(state, "email")}
          className={inputStyles}
        />
      </Field>

      <Field
        label="Contraseña"
        htmlFor="password"
        hint="Mínimo 8 caracteres."
        error={firstFieldError(state, "password")}
      >
        <PasswordInput id="password" name="password" autoComplete="new-password" placeholder="••••••••" />
      </Field>

      <Field
        label="Repite la contraseña"
        htmlFor="confirmPassword"
        error={firstFieldError(state, "confirmPassword")}
      >
        <PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" placeholder="••••••••" />
      </Field>

      <SubmitButton className="w-full" pendingLabel="Creando cuenta…">
        Crear cuenta
      </SubmitButton>
    </form>
  );
}
