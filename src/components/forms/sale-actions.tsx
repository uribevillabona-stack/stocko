"use client";

import { useActionState } from "react";
import { addPaymentAction, cancelSaleAction } from "@/actions/sales";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert } from "@/components/ui/alert";
import { Field, inputStyles, selectStyles } from "@/components/ui/field";
import { fieldValue, firstFieldError, initialActionState } from "@/lib/action-state";
import { moneyInputValue } from "@/lib/money";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/lib/validation/sales";

export function AddPaymentForm({
  saleId,
  customerId,
  balanceCents,
}: {
  saleId: string;
  customerId: string | null;
  balanceCents: number;
}) {
  const [state, formAction] = useActionState(addPaymentAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="saleId" value={saleId} />
      <input type="hidden" name="customerId" value={customerId ?? ""} />
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Valor" htmlFor="payment-amount" error={firstFieldError(state, "amount")}>
          <input
            id="payment-amount"
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={fieldValue(state, "amount", moneyInputValue(balanceCents))}
            className={inputStyles}
          />
        </Field>
        <Field label="Medio" htmlFor="payment-method" error={firstFieldError(state, "method")}>
          <select
            id="payment-method"
            name="method"
            defaultValue={fieldValue(state, "method", "cash")}
            className={selectStyles}
          >
            {PAYMENT_METHODS.map((value) => (
              <option key={value} value={value}>
                {PAYMENT_METHOD_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nota" htmlFor="payment-note" hint="Opcional." error={firstFieldError(state, "note")}>
          <input
            id="payment-note"
            name="note"
            autoComplete="off"
            defaultValue={fieldValue(state, "note")}
            className={inputStyles}
          />
        </Field>
      </div>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Guardando…">Registrar abono</SubmitButton>
      </div>
    </form>
  );
}

export function CancelSaleForm({ saleId, number }: { saleId: string; number: number }) {
  const [state, formAction] = useActionState(cancelSaleAction, initialActionState);

  return (
    <form
      action={formAction}
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        if (!window.confirm(`¿Anular la venta #${number}? El stock vuelve al inventario y sus pagos quedan anulados.`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="saleId" value={saleId} />
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <Field
        label="Motivo"
        htmlFor="cancel-reason"
        hint="Queda registrado en la venta."
        error={firstFieldError(state, "reason")}
      >
        <input
          id="cancel-reason"
          name="reason"
          autoComplete="off"
          defaultValue={fieldValue(state, "reason")}
          placeholder="Error al cobrar, devolución…"
          className={inputStyles}
        />
      </Field>

      <div className="flex justify-end">
        <SubmitButton variant="danger" pendingLabel="Anulando…">
          Anular venta
        </SubmitButton>
      </div>
    </form>
  );
}
