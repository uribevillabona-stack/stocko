"use client";

import { useActionState } from "react";
import { recoverPasswordAction } from "@/actions/recovery";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert } from "@/components/ui/alert";
import { Field, selectStyles } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { fieldValue, firstFieldError, initialActionState } from "@/lib/action-state";

export type RecoveryOption = { id: string; label: string };

export function RecoveryForm({ token, accounts }: { token: string; accounts: RecoveryOption[] }) {
  const [state, formAction] = useActionState(recoverPasswordAction, initialActionState);
  const single = accounts.length === 1 ? (accounts[0]?.id ?? "") : "";

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />
      {state.error ? <Alert>{state.error}</Alert> : null}

      <Field label="Cuenta" htmlFor="userId" error={firstFieldError(state, "userId")}>
        <select
          id="userId"
          name="userId"
          defaultValue={fieldValue(state, "userId", single)}
          className={selectStyles}
        >
          {single ? null : <option value="">Elige la cuenta…</option>}
          {accounts.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Contraseña nueva"
        htmlFor="password"
        hint="Mínimo 8 caracteres."
        error={firstFieldError(state, "password")}
      >
        <PasswordInput id="password" name="password" autoComplete="new-password" autoFocus placeholder="••••••••" />
      </Field>

      <Field label="Repite la contraseña" htmlFor="confirmPassword" error={firstFieldError(state, "confirmPassword")}>
        <PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" placeholder="••••••••" />
      </Field>

      <SubmitButton className="w-full" pendingLabel="Guardando…">
        Guardar contraseña nueva
      </SubmitButton>
    </form>
  );
}
