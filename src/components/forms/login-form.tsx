"use client";

import { useActionState } from "react";
import { loginAction } from "@/actions/auth";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert } from "@/components/ui/alert";
import { Field, inputStyles } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { fieldValue, firstFieldError, initialActionState } from "@/lib/action-state";

/** `recoveryHref`: solo en Stocko para Windows (ahí no hay correo para recuperar la contraseña). */
export function LoginForm({ recoveryHref }: { recoveryHref?: string }) {
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
          defaultValue={fieldValue(state, "email")}
          className={inputStyles}
        />
      </Field>

      <Field label="Contraseña" htmlFor="password" error={firstFieldError(state, "password")}>
        <PasswordInput id="password" name="password" autoComplete="current-password" placeholder="••••••••" />
      </Field>

      {recoveryHref ? (
        <p className="text-right text-sm">
          <a href={recoveryHref} className="font-medium text-brand hover:underline">
            ¿Olvidaste tu contraseña?
          </a>
        </p>
      ) : null}

      <SubmitButton className="w-full" pendingLabel="Entrando…">
        Entrar
      </SubmitButton>
    </form>
  );
}
