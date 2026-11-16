"use client";

import { useActionState } from "react";
import { createInvitationAction } from "@/actions/team";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert } from "@/components/ui/alert";
import { CopyField } from "@/components/ui/copy-field";
import { Field, inputStyles, selectStyles } from "@/components/ui/field";
import { firstFieldError, initialActionState } from "@/lib/action-state";

export function InviteForm({ desktop = false }: { desktop?: boolean }) {
  const [state, formAction] = useActionState(createInvitationAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      {state.inviteUrl ? (
        <div className="space-y-2">
          {desktop ? null : <CopyField value={state.inviteUrl} label="Enlace de invitación" />}
          <p className="text-xs leading-5 text-muted">
            {desktop
              ? "Esa persona usará este mismo PC: abre la invitación, cierra tu sesión y deja que cree su contraseña."
              : "Si esa persona usará este mismo equipo, abre la invitación aquí: tendrás que cerrar tu sesión."}{" "}
            <a href={state.inviteUrl} className="font-medium text-brand hover:underline">
              Abrir la invitación
            </a>
          </p>
          <p className="text-xs text-muted">
            {desktop ? "La invitación" : "Este enlace se muestra una sola vez y"} vence en 7 días. Si se
            pierde, revoca la invitación y crea otra.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Field
          label="Correo"
          htmlFor="invite-email"
          className="flex-1"
          error={firstFieldError(state, "email")}
        >
          <input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="off"
            placeholder="persona@correo.com"
            className={inputStyles}
          />
        </Field>

        <Field label="Rol" htmlFor="invite-role" className="sm:w-44">
          <select id="invite-role" name="role" defaultValue="employee" className={selectStyles}>
            <option value="employee">Empleado</option>
            <option value="owner">Dueño</option>
          </select>
        </Field>

        <div className="sm:pt-[26px]">
          <SubmitButton className="w-full sm:w-auto" pendingLabel="Creando…">
            Crear invitación
          </SubmitButton>
        </div>
      </div>

      <p className="text-xs leading-5 text-muted">
        El empleado puede ver inventario y clientes, pero no reportes de dinero ni configuración.
      </p>
    </form>
  );
}
