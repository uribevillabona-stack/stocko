"use client";

import { useActionState } from "react";
import { createProductAction, updateProductAction } from "@/actions/inventory";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert } from "@/components/ui/alert";
import { Field, inputStyles, selectStyles, textareaStyles } from "@/components/ui/field";
import {
  fieldValue,
  firstFieldError,
  initialActionState,
  type ActionState,
} from "@/lib/action-state";
import { UNIT_OPTIONS } from "@/lib/validation/inventory";

function CategoryInput({
  state,
  categories,
  defaultValue,
}: {
  state: ActionState;
  categories: string[];
  defaultValue?: string | null;
}) {
  return (
    <Field
      label="Categoría"
      htmlFor="categoryName"
      hint="Opcional. Elige una o escribe una nueva."
      error={firstFieldError(state, "categoryName")}
    >
      <input
        id="categoryName"
        name="categoryName"
        type="text"
        list="category-options"
        autoComplete="off"
        defaultValue={fieldValue(state, "categoryName", defaultValue ?? "")}
        placeholder="Granos, Bebidas, Aseo…"
        className={inputStyles}
      />
      <datalist id="category-options">
        {categories.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </Field>
  );
}

function UnitSelect({ state, defaultValue }: { state: ActionState; defaultValue?: string }) {
  return (
    <Field label="Unidad" htmlFor="unit" hint="Cómo cuentas este producto.">
      <select
        id="unit"
        name="unit"
        defaultValue={fieldValue(state, "unit", defaultValue ?? "und")}
        className={selectStyles}
      >
        {UNIT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Campos de precio, costo, SKU y mínimo compartidos por producto y variante. */
export function VariantFields({
  state,
  isOwner,
  prefix = "",
  defaults,
  withInitialStock,
}: {
  state: ActionState;
  isOwner: boolean;
  prefix?: string;
  defaults?: { sku?: string; price?: string; cost?: string; minStock?: string };
  withInitialStock?: boolean;
}) {
  const id = (name: string) => `${prefix}${name}`;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        label="Precio de venta"
        htmlFor={id("price")}
        error={firstFieldError(state, "priceCents")}
      >
        <input
          id={id("price")}
          name="price"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={fieldValue(state, "price", defaults?.price)}
          placeholder="4.500"
          className={inputStyles}
        />
      </Field>

      {isOwner ? (
        <Field
          label="Costo"
          htmlFor={id("cost")}
          hint="Opcional. Solo lo ve el dueño."
          error={firstFieldError(state, "costCents")}
        >
          <input
            id={id("cost")}
            name="cost"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={fieldValue(state, "cost", defaults?.cost)}
            placeholder="3.800"
            className={inputStyles}
          />
        </Field>
      ) : null}

      <Field
        label="Código (SKU)"
        htmlFor={id("sku")}
        hint="Opcional. Si lo dejas vacío, Stocko crea uno."
        error={firstFieldError(state, "sku")}
      >
        <input
          id={id("sku")}
          name="sku"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          defaultValue={fieldValue(state, "sku", defaults?.sku)}
          placeholder="ARZ-500"
          className={inputStyles}
        />
      </Field>

      <Field
        label="Stock mínimo"
        htmlFor={id("minStock")}
        hint="Te avisamos cuando el disponible llegue a este número."
        error={firstFieldError(state, "minStockMilli")}
      >
        <input
          id={id("minStock")}
          name="minStock"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={fieldValue(state, "minStock", defaults?.minStock)}
          placeholder="0"
          className={inputStyles}
        />
      </Field>

      {withInitialStock ? (
        <Field
          label="Stock inicial"
          htmlFor={id("initialStock")}
          hint="Lo que tienes hoy. Queda como una entrada en el historial."
          error={firstFieldError(state, "initialStockMilli")}
        >
          <input
            id={id("initialStock")}
            name="initialStock"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={fieldValue(state, "initialStock")}
            placeholder="0"
            className={inputStyles}
          />
        </Field>
      ) : null}
    </div>
  );
}

export function NewProductForm({
  categories,
  isOwner,
}: {
  categories: string[];
  isOwner: boolean;
}) {
  const [state, formAction] = useActionState(createProductAction, initialActionState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}

      <Field label="Nombre" htmlFor="name" error={firstFieldError(state, "name")}>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="off"
          defaultValue={fieldValue(state, "name")}
          placeholder="Arroz Diana 500 g"
          className={inputStyles}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <CategoryInput state={state} categories={categories} />
        <UnitSelect state={state} />
      </div>

      <VariantFields state={state} isOwner={isOwner} withInitialStock />

      <Field
        label="Descripción"
        htmlFor="description"
        hint="Opcional."
        error={firstFieldError(state, "description")}
      >
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={fieldValue(state, "description")}
          className={textareaStyles}
        />
      </Field>

      <p className="text-xs leading-5 text-muted">
        Usa coma para decimales (1,5 kg). Si el producto tiene tallas, colores o tamaños, podrás
        agregar variantes después de crearlo.
      </p>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Creando…">Crear producto</SubmitButton>
      </div>
    </form>
  );
}

export function EditProductForm({
  product,
  categories,
  isOwner,
}: {
  product: {
    id: string;
    name: string;
    description: string | null;
    unit: string;
    isActive: boolean;
    categoryName: string | null;
  };
  categories: string[];
  isOwner: boolean;
}) {
  const [state, formAction] = useActionState(updateProductAction, initialActionState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="productId" value={product.id} />
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <Field label="Nombre" htmlFor="name" error={firstFieldError(state, "name")}>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="off"
          defaultValue={fieldValue(state, "name", product.name)}
          className={inputStyles}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <CategoryInput state={state} categories={categories} defaultValue={product.categoryName} />
        <UnitSelect state={state} defaultValue={product.unit} />
      </div>

      <Field
        label="Descripción"
        htmlFor="description"
        error={firstFieldError(state, "description")}
      >
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={fieldValue(state, "description", product.description ?? "")}
          className={textareaStyles}
        />
      </Field>

      {isOwner ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface px-3 py-3">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={state.values ? state.values.isActive === "on" : product.isActive}
            className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
          />
          <span>
            <span className="block text-sm font-medium text-ink">Producto activo</span>
            <span className="mt-0.5 block text-xs leading-5 text-muted">
              Si lo desactivas, deja de aparecer en el inventario y no admite movimientos. El
              historial se conserva.
            </span>
          </span>
        </label>
      ) : null}

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Guardando…">Guardar producto</SubmitButton>
      </div>
    </form>
  );
}
