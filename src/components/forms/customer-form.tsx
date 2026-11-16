"use client";

import { useActionState } from "react";
import { createCustomerAction, updateCustomerAction } from "@/actions/sales";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert } from "@/components/ui/alert";
import { Field, inputStyles, textareaStyles } from "@/components/ui/field";
import { fieldValue, firstFieldError, initialActionState } from "@/lib/action-state";
import { formatPhone } from "@/lib/phone";

type CustomerDefaults = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
};

export function CustomerForm({
  customer,
  returnTo,
}: {
  customer?: CustomerDefaults;
  returnTo?: "venta";
}) {
  const [state, formAction] = useActionState(
    customer ? updateCustomerAction : createCustomerAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {customer ? <input type="hidden" name="customerId" value={customer.id} /> : null}
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <Field label="Nombre" htmlFor="customer-name" error={firstFieldError(state, "name")}>
        <input
          id="customer-name"
          name="name"
          autoComplete="off"
          defaultValue={fieldValue(state, "name", customer?.name)}
          placeholder="Doña Marta"
          className={inputStyles}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="WhatsApp o teléfono"
          htmlFor="customer-phone"
          hint="Opcional. Para enviar recibos y recordatorios."
          error={firstFieldError(state, "phone")}
        >
          <input
            id="customer-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            defaultValue={fieldValue(state, "phone", customer?.phone ? formatPhone(customer.phone) : "")}
            placeholder="300 123 4567"
            className={inputStyles}
          />
        </Field>
        <Field label="Correo" htmlFor="customer-email" hint="Opcional." error={firstFieldError(state, "email")}>
          <input
            id="customer-email"
            name="email"
            type="email"
            autoComplete="off"
            defaultValue={fieldValue(state, "email", customer?.email ?? "")}
            className={inputStyles}
          />
        </Field>
      </div>

      <Field label="Notas" htmlFor="customer-notes" hint="Opcional." error={firstFieldError(state, "notes")}>
        <textarea
          id="customer-notes"
          name="notes"
          rows={3}
          defaultValue={fieldValue(state, "notes", customer?.notes ?? "")}
          className={textareaStyles}
        />
      </Field>

      {customer ? (
        <label className="flex cursor-pointer items-center gap-3 text-sm text-ink">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={state.values ? state.values.isActive === "on" : customer.isActive}
            className="size-4 shrink-0 accent-[var(--color-accent)]"
          />
          Cliente activo
        </label>
      ) : null}

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Guardando…">
          {customer ? "Guardar cliente" : "Crear cliente"}
        </SubmitButton>
      </div>
    </form>
  );
}
