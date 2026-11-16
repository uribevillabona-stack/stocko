"use client";

import { useActionState } from "react";
import { completeOnboardingAction } from "@/actions/auth";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert } from "@/components/ui/alert";
import { Field, inputStyles } from "@/components/ui/field";
import { firstFieldError, initialActionState } from "@/lib/action-state";

export function OnboardingForm() {
  const [state, formAction] = useActionState(completeOnboardingAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}

      <Field
        label="Nombre del negocio"
        htmlFor="businessName"
        hint="Puedes cambiarlo después en Ajustes."
        error={firstFieldError(state, "businessName")}
      >
        <input
          id="businessName"
          name="businessName"
          type="text"
          autoComplete="organization"
          autoFocus
          placeholder="Tienda La Esquina"
          className={inputStyles}
        />
      </Field>

      <SubmitButton className="w-full" pendingLabel="Creando negocio…">
        Continuar
      </SubmitButton>
    </form>
  );
}
