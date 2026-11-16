"use client";

import { useActionState } from "react";
import { loginAction } from "@/actions/auth";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert } from "@/components/ui/alert";
import { Field, inputStyles } from "@/components/ui/field";
import { firstFieldError, initialActionState } from "@/lib/action-state";

export function LoginForm() {
  const [state, formAction] = useActionState(loginAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}

      <Field label="Correo" htmlFor="email" error={firstFieldError(state, "email")}>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          placeholder="tu@correo.com"
          className={inputStyles}
        />
      </Field>

      <Field label="Contraseña" htmlFor="password" error={firstFieldError(state, "password")}>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          className={inputStyles}
        />
      </Field>

      <SubmitButton className="w-full" pendingLabel="Entrando…">
        Entrar
      </SubmitButton>
    </form>
  );
}
