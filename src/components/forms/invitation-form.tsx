"use client";

import { useActionState } from "react";
import { acceptInvitationAction } from "@/actions/team";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert } from "@/components/ui/alert";
import { Field, inputStyles } from "@/components/ui/field";
import { firstFieldError, initialActionState } from "@/lib/action-state";

export function InvitationForm({
  token,
  mode,
}: {
  token: string;
  mode: "signup" | "join";
}) {
  const [state, formAction] = useActionState(acceptInvitationAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />

      {state.error ? <Alert>{state.error}</Alert> : null}

      {mode === "signup" ? (
        <>
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
        </>
      ) : null}

      <SubmitButton
        className="w-full"
        pendingLabel={mode === "signup" ? "Creando cuenta…" : "Uniéndote…"}
      >
        {mode === "signup" ? "Crear cuenta y unirme" : "Unirme al equipo"}
      </SubmitButton>
    </form>
  );
}
