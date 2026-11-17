"use client";

import { useActionState, useEffect, useRef } from "react";
import { createEmployeeAction } from "@/actions/team";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert } from "@/components/ui/alert";
import { Field, inputStyles } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { fieldValue, firstFieldError, initialActionState } from "@/lib/action-state";

/** El dueño crea la cuenta de un trabajador con correo y contraseña inicial. */
export function EmployeeForm() {
  const [state, formAction] = useActionState(createEmployeeAction, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nombre" htmlFor="employee-name" error={firstFieldError(state, "name")}>
          <input
            id="employee-name"
            name="name"
            autoComplete="off"
            placeholder="Nombre del trabajador"
            defaultValue={fieldValue(state, "name")}
            className={inputStyles}
          />
        </Field>
        <Field label="Correo (para entrar)" htmlFor="employee-email" error={firstFieldError(state, "email")}>
          <input
            id="employee-email"
            name="email"
            type="email"
            autoComplete="off"
            placeholder="trabajador@correo.com"
            defaultValue={fieldValue(state, "email")}
            className={inputStyles}
          />
        </Field>
        <Field
          label="Contraseña inicial"
          htmlFor="employee-password"
          hint="Mínimo 8 caracteres. Luego la puede cambiar en Mi cuenta."
          error={firstFieldError(state, "password")}
        >
          <PasswordInput id="employee-password" name="password" autoComplete="new-password" />
        </Field>
        <Field
          label="Repite la contraseña"
          htmlFor="employee-confirm-password"
          error={firstFieldError(state, "confirmPassword")}
        >
          <PasswordInput id="employee-confirm-password" name="confirmPassword" autoComplete="new-password" />
        </Field>
      </div>

      <SubmitButton className="w-full sm:w-auto" pendingLabel="Creando…">
        Crear trabajador
      </SubmitButton>
    </form>
  );
}
