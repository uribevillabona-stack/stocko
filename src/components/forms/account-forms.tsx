"use client";

import { useActionState } from "react";
import { changePasswordAction, updateProfileAction } from "@/actions/account";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert } from "@/components/ui/alert";
import { Field, inputStyles } from "@/components/ui/field";
import { fieldValue, firstFieldError, initialActionState } from "@/lib/action-state";

export function ProfileForm({ name }: { name: string }) {
  const [state, formAction] = useActionState(updateProfileAction, initialActionState);
  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      <Field label="Tu nombre" htmlFor="profile-name" error={firstFieldError(state, "name")}>
        <input
          id="profile-name"
          name="name"
          autoComplete="name"
          defaultValue={fieldValue(state, "name", name)}
          className={inputStyles}
        />
      </Field>
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Guardando…">Guardar nombre</SubmitButton>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, initialActionState);
  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      <Field label="Contraseña actual" htmlFor="current-password" error={firstFieldError(state, "currentPassword")}>
        <input id="current-password" name="currentPassword" type="password" autoComplete="current-password" className={inputStyles} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nueva contraseña" htmlFor="new-password" hint="Mínimo 8 caracteres." error={firstFieldError(state, "newPassword")}>
          <input id="new-password" name="newPassword" type="password" autoComplete="new-password" className={inputStyles} />
        </Field>
        <Field label="Repite la nueva" htmlFor="confirm-password" error={firstFieldError(state, "confirmPassword")}>
          <input id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" className={inputStyles} />
        </Field>
      </div>
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Cambiando…">Cambiar contraseña</SubmitButton>
      </div>
    </form>
  );
}
