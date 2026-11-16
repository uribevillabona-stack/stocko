"use client";

import { ArrowDownToLine, ArrowUpFromLine, Bookmark, ClipboardCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useActionState, useState } from "react";
import {
  addVariantAction,
  closeReservationAction,
  recordMovementAction,
  updateVariantAction,
} from "@/actions/inventory";
import { ConfirmSubmit } from "@/components/forms/confirm-submit";
import { VariantFields } from "@/components/forms/product-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert } from "@/components/ui/alert";
import { Field, inputStyles, selectStyles } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { fieldValue, firstFieldError, initialActionState } from "@/lib/action-state";
import { useFormAction } from "@/lib/use-form-action";
import { formatQuantity } from "@/lib/quantity";
import type { MovementKind } from "@/lib/validation/inventory";

/* -------------------------------------------------------------------------- */
/* Movimientos                                                                 */
/* -------------------------------------------------------------------------- */

export type MovementVariantOption = {
  id: string;
  label: string;
  qtyMilli: number;
  reservedMilli: number;
};

const kinds: Array<{
  value: MovementKind;
  label: string;
  icon: LucideIcon;
  qtyLabel: string;
  qtyHint: string;
  reasonLabel: string;
  reasonPlaceholder: string;
  submit: string;
}> = [
  {
    value: "entry",
    label: "Entrada",
    icon: ArrowDownToLine,
    qtyLabel: "Cantidad que entra",
    qtyHint: "Compras, devoluciones o producción.",
    reasonLabel: "Nota",
    reasonPlaceholder: "Proveedor, factura…",
    submit: "Registrar entrada",
  },
  {
    value: "exit",
    label: "Salida",
    icon: ArrowUpFromLine,
    qtyLabel: "Cantidad que sale",
    qtyHint: "Ventas de mostrador, consumo o daño.",
    reasonLabel: "Nota",
    reasonPlaceholder: "Venta, producto dañado…",
    submit: "Registrar salida",
  },
  {
    value: "adjustment",
    label: "Conteo",
    icon: ClipboardCheck,
    qtyLabel: "Cantidad contada",
    qtyHint: "Escribe cuánto hay realmente. Stocko calcula la diferencia.",
    reasonLabel: "Nota",
    reasonPlaceholder: "Conteo mensual…",
    submit: "Ajustar al conteo",
  },
  {
    value: "reserve",
    label: "Reserva",
    icon: Bookmark,
    qtyLabel: "Cantidad a apartar",
    qtyHint: "Aparta stock para un cliente. Vence según tus ajustes.",
    reasonLabel: "Para quién",
    reasonPlaceholder: "Doña Marta, pedido 12…",
    submit: "Crear reserva",
  },
];

export function MovementForm({
  productId,
  unit,
  variants,
  allowOversell,
}: {
  productId: string;
  unit: string;
  variants: MovementVariantOption[];
  allowOversell: boolean;
}) {
  // Sin reinicio automático: el tipo y la variante son estado propio.
  const [state, onSubmit, isPending] = useFormAction(recordMovementAction, initialActionState);
  const [kind, setKind] = useState<MovementKind>("entry");
  const [formKey, setFormKey] = useState(0);
  const [handled, setHandled] = useState(state);
  // Tras un movimiento correcto se limpian cantidad y nota (y se conserva la variante).
  if (handled !== state) {
    setHandled(state);
    if (state.success) setFormKey((key) => key + 1);
  }
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const config = kinds.find((item) => item.value === kind) ?? kinds[0]!;
  const selected = variants.find((variant) => variant.id === variantId) ?? variants[0];

  if (variants.length === 0) {
    return (
      <p className="text-sm text-muted">
        No hay variantes activas. Activa una variante para registrar movimientos.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="kind" value={kind} />
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <div
        role="radiogroup"
        aria-label="Tipo de movimiento"
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {kinds.map((item) => {
          const Icon = item.icon;
          const active = item.value === kind;
          return (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setKind(item.value)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-brand bg-brand-soft/30 text-brand"
                  : "border-border bg-card text-muted hover:text-ink",
              )}
            >
              <Icon className="size-4" strokeWidth={1.75} />
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {variants.length > 1 ? (
          <Field label="Variante" htmlFor="movement-variant" error={firstFieldError(state, "variantId")}>
            <select
              id="movement-variant"
              name="variantId"
              value={selected?.id ?? ""}
              onChange={(event) => setVariantId(event.target.value)}
              className={selectStyles}
            >
              {variants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.label}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <input type="hidden" name="variantId" value={selected?.id ?? ""} />
        )}

        <Field
          label={`${config.qtyLabel} (${unit})`}
          htmlFor="movement-qty"
          hint={config.qtyHint}
          error={firstFieldError(state, "qty")}
          className={variants.length > 1 ? undefined : "sm:col-span-2"}
        >
          <input
            key={`qty-${formKey}`}
            id="movement-qty"
            name="qty"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={fieldValue(state, "qty")}
            placeholder="0"
            className={inputStyles}
          />
        </Field>
      </div>

      <Field
        label={config.reasonLabel}
        htmlFor="movement-reason"
        hint={kind === "reserve" ? undefined : "Opcional."}
        error={firstFieldError(state, "reason")}
      >
        <input
          key={`reason-${formKey}`}
          id="movement-reason"
          name="reason"
          type="text"
          autoComplete="off"
          defaultValue={fieldValue(state, "reason")}
          placeholder={config.reasonPlaceholder}
          className={inputStyles}
        />
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {selected ? (
          <p className="text-xs text-muted tnum">
            Físico {formatQuantity(selected.qtyMilli, unit)} · Reservado{" "}
            {formatQuantity(selected.reservedMilli, unit)} · Disponible{" "}
            <span className="font-medium text-ink">
              {formatQuantity(selected.qtyMilli - selected.reservedMilli, unit)}
            </span>
            {!allowOversell && (kind === "exit" || kind === "reserve")
              ? " · No se permite pasar del disponible"
              : null}
          </p>
        ) : (
          <span />
        )}
        <SubmitButton pendingLabel="Guardando…" pending={isPending}>
          {config.submit}
        </SubmitButton>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Reservas                                                                    */
/* -------------------------------------------------------------------------- */

export function ReservationActions({
  productId,
  reservationId,
  reference,
}: {
  productId: string;
  reservationId: string;
  reference: string;
}) {
  const [state, formAction] = useActionState(closeReservationAction, initialActionState);

  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="reservationId" value={reservationId} />
      <div className="flex gap-1">
        <ConfirmSubmit
          name="outcome"
          value="fulfilled"
          variant="secondary"
          size="sm"
          message={`¿Entregar la reserva de ${reference}? El stock saldrá del inventario.`}
        >
          Entregar
        </ConfirmSubmit>
        <ConfirmSubmit
          name="outcome"
          value="released"
          variant="ghost"
          size="sm"
          message={`¿Liberar la reserva de ${reference}? El stock vuelve a estar disponible.`}
        >
          Liberar
        </ConfirmSubmit>
      </div>
      {state.error ? (
        <p className="max-w-56 text-right text-xs text-danger" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Variantes                                                                   */
/* -------------------------------------------------------------------------- */

export function AddVariantForm({ productId, isOwner }: { productId: string; isOwner: boolean }) {
  const [state, formAction] = useActionState(addVariantAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="productId" value={productId} />
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <Field
        label="Nombre de la variante"
        htmlFor="new-variant-name"
        hint="Talla, color, tamaño o presentación."
        error={firstFieldError(state, "name")}
      >
        <input
          id="new-variant-name"
          name="name"
          type="text"
          autoComplete="off"
          defaultValue={fieldValue(state, "name")}
          placeholder="Talla M, Rojo, 1 kg…"
          className={inputStyles}
        />
      </Field>

      <VariantFields state={state} isOwner={isOwner} prefix="new-variant-" withInitialStock />

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Agregando…">Agregar variante</SubmitButton>
      </div>
    </form>
  );
}

export function EditVariantForm({
  productId,
  isOwner,
  variant,
}: {
  productId: string;
  isOwner: boolean;
  variant: {
    id: string;
    name: string | null;
    sku: string;
    isActive: boolean;
    isDefault: boolean;
    price: string;
    cost: string;
    minStock: string;
  };
}) {
  const [state, formAction] = useActionState(updateVariantAction, initialActionState);
  const prefix = `variant-${variant.id}-`;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="variantId" value={variant.id} />
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <Field
        label="Nombre"
        htmlFor={`${prefix}name`}
        hint={variant.isDefault ? "Vacío = «Única»." : undefined}
        error={firstFieldError(state, "name")}
      >
        <input
          id={`${prefix}name`}
          name="name"
          type="text"
          autoComplete="off"
          defaultValue={fieldValue(state, "name", variant.name ?? "")}
          className={inputStyles}
        />
      </Field>

      <VariantFields
        state={state}
        isOwner={isOwner}
        prefix={prefix}
        defaults={{
          sku: variant.sku,
          price: variant.price,
          cost: variant.cost,
          minStock: variant.minStock,
        }}
      />

      {isOwner ? (
        <label className="flex cursor-pointer items-center gap-3 text-sm text-ink">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={state.values ? state.values.isActive === "on" : variant.isActive}
            className="size-4 shrink-0 accent-[var(--color-accent)]"
          />
          Variante activa
        </label>
      ) : null}

      <div className="flex justify-end">
        <SubmitButton size="sm" pendingLabel="Guardando…">
          Guardar variante
        </SubmitButton>
      </div>
    </form>
  );
}
