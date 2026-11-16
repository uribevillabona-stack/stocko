"use client";

import { useActionState } from "react";
import { updateBusinessAction } from "@/actions/business";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert } from "@/components/ui/alert";
import { Field, inputStyles, selectStyles } from "@/components/ui/field";
import { firstFieldError, initialActionState } from "@/lib/action-state";
import {
  CURRENCY_CODES,
  CURRENCY_LABELS,
  TIMEZONE_CODES,
  TIMEZONE_LABELS,
} from "@/lib/validation/settings";
import type { BusinessSummary } from "@/server/auth/context";

export function BusinessForm({ business }: { business: BusinessSummary }) {
  const [state, formAction] = useActionState(updateBusinessAction, initialActionState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <Field label="Nombre del negocio" htmlFor="name" error={firstFieldError(state, "name")}>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="organization"
          defaultValue={business.name}
          className={inputStyles}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Moneda" htmlFor="currency" error={firstFieldError(state, "currency")}>
          <select
            id="currency"
            name="currency"
            defaultValue={business.currency}
            className={selectStyles}
          >
            {CURRENCY_CODES.map((code) => (
              <option key={code} value={code}>
                {code} · {CURRENCY_LABELS[code]}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Zona horaria"
          htmlFor="timezone"
          error={firstFieldError(state, "timezone")}
        >
          <select
            id="timezone"
            name="timezone"
            defaultValue={business.timezone}
            className={selectStyles}
          >
            {TIMEZONE_CODES.map((code) => (
              <option key={code} value={code}>
                {TIMEZONE_LABELS[code]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="WhatsApp"
          htmlFor="whatsappNumber"
          hint="Opcional. Se usa para los enlaces de contacto."
          error={firstFieldError(state, "whatsappNumber")}
        >
          <input
            id="whatsappNumber"
            name="whatsappNumber"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            defaultValue={business.whatsappNumber ?? ""}
            placeholder="300 123 4567"
            className={inputStyles}
          />
        </Field>

        <Field
          label="Reservas"
          htmlFor="reservationTtlHours"
          hint="Horas que una reserva mantiene el stock apartado."
          error={firstFieldError(state, "reservationTtlHours")}
        >
          <input
            id="reservationTtlHours"
            name="reservationTtlHours"
            type="number"
            inputMode="numeric"
            min={1}
            max={168}
            step={1}
            defaultValue={business.reservationTtlHours}
            className={inputStyles}
          />
        </Field>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface px-3 py-3">
        <input
          type="checkbox"
          name="allowOversell"
          defaultChecked={business.allowOversell}
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
        />
        <span>
          <span className="block text-sm font-medium text-ink">
            Permitir vender sin existencias
          </span>
          <span className="mt-0.5 block text-xs leading-5 text-muted">
            Si está desactivado, una venta nunca puede dejar el inventario en negativo.
          </span>
        </span>
      </label>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Guardando…">Guardar cambios</SubmitButton>
      </div>
    </form>
  );
}
