"use client";

import { Minus, Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { createSaleAction } from "@/actions/sales";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, inputStyles, selectStyles } from "@/components/ui/field";
import { initialActionState } from "@/lib/action-state";
import { useFormAction } from "@/lib/use-form-action";
import { cn } from "@/lib/cn";
import { formatMoney, moneyInputValue, parseMoneyToCents } from "@/lib/money";
import { formatQuantity, MILLI, parseQuantityToMilli, quantityInputValue } from "@/lib/quantity";
import { computeLineTotal } from "@/lib/sale-math";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/lib/validation/sales";

export type SaleFormVariant = {
  variantId: string;
  label: string;
  sku: string;
  unit: string;
  priceCents: number;
  availableMilli: number;
};

type Row = { variantId: string; qty: string; price: string };

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function SaleForm({
  variants,
  customers,
  currency,
  allowOversell,
  defaultCustomerId,
}: {
  variants: SaleFormVariant[];
  customers: Array<{ id: string; name: string; phone: string | null }>;
  currency: string;
  allowOversell: boolean;
  defaultCustomerId?: string;
}) {
  const [state, onSubmit, isPending] = useFormAction(createSaleAction, initialActionState);
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? "");
  const [discount, setDiscount] = useState("");
  const [paid, setPaid] = useState<string | null>(null);
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>("cash");
  const [note, setNote] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(variants.map((variant) => [variant.variantId, variant])), [variants]);
  const money = (cents: number) => formatMoney(cents, currency);

  const matches = useMemo(() => {
    const term = normalize(search.trim());
    if (!term) return [];
    return variants
      .filter((variant) => normalize(`${variant.label} ${variant.sku}`).includes(term))
      .slice(0, 8);
  }, [search, variants]);

  function addVariant(variantId: string) {
    const variant = byId.get(variantId);
    if (!variant) return;
    setRows((current) => {
      const existing = current.find((row) => row.variantId === variantId);
      if (existing) {
        return current.map((row) => {
          if (row.variantId !== variantId) return row;
          const qty = (parseQuantityToMilli(row.qty) ?? 0) + MILLI;
          return { ...row, qty: quantityInputValue(qty) };
        });
      }
      return [...current, { variantId, qty: "1", price: moneyInputValue(variant.priceCents) }];
    });
    setSearch("");
    searchRef.current?.focus();
  }

  function updateRow(variantId: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.variantId === variantId ? { ...row, ...patch } : row)));
  }

  function stepQty(variantId: string, direction: 1 | -1) {
    const row = rows.find((item) => item.variantId === variantId);
    if (!row) return;
    const next = Math.max(MILLI, (parseQuantityToMilli(row.qty) ?? 0) + direction * MILLI);
    updateRow(variantId, { qty: quantityInputValue(next) });
  }

  const lines = rows.map((row) => {
    const variant = byId.get(row.variantId);
    const qtyMilli = parseQuantityToMilli(row.qty);
    const priceCents = parseMoneyToCents(row.price);
    const total = qtyMilli && priceCents !== null ? computeLineTotal(qtyMilli, priceCents) : null;
    const short =
      !allowOversell && variant && qtyMilli !== null && qtyMilli > variant.availableMilli;
    return { row, variant, qtyMilli, priceCents, total, short };
  });

  const subtotal = lines.reduce((sum, line) => sum + (line.total ?? 0), 0);
  const discountCents = parseMoneyToCents(discount) ?? 0;
  const total = Math.max(0, subtotal - discountCents);
  const paidCents = paid === null ? total : (parseMoneyToCents(paid) ?? 0);
  const change = method === "cash" && paidCents > total ? paidCents - total : 0;
  const recorded = Math.min(paidCents, total);
  const pending = total - recorded;
  const invalid = lines.some((line) => line.total === null);

  const payload = JSON.stringify({
    customerId,
    items: rows.map((row) => ({ variantId: row.variantId, qty: row.qty, price: row.price })),
    discount,
    paid: moneyInputValue(recorded),
    method,
    note,
  });

  const qtyInCart = new Map(lines.map((line) => [line.row.variantId, line.qtyMilli ?? 0]));
  const quickPicks = variants
    .filter((variant) => allowOversell || variant.availableMilli > 0)
    .slice(0, 8);

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]"
      noValidate
    >
      <input type="hidden" name="payload" value={payload} />
      {state.error ? (
        <div className="lg:col-span-2">
          <Alert>{state.error}</Alert>
        </div>
      ) : null}

      <section className="min-w-0 rounded-2xl border border-border bg-card">
        <div className="px-5 pb-4 pt-5">
          <label htmlFor="sale-search" className="text-[15px] font-semibold text-ink">
            Productos
          </label>
          <div className="relative mt-3">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              id="sale-search"
              type="search"
              autoComplete="off"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (matches[0]) addVariant(matches[0].variantId);
                }
              }}
              placeholder="Busca por nombre o código"
              className={cn(inputStyles, "pl-10")}
            />
            {matches.length > 0 ? (
              <ul
                role="listbox"
                className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-72 animate-pop overflow-auto rounded-xl border border-border bg-card p-1 shadow-(--shadow-lift)"
              >
                {matches.map((variant) => (
                  <li key={variant.variantId}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => addVariant(variant.variantId)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-hover"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{variant.label}</span>
                        <span className="block text-xs text-muted">
                          {variant.sku} · disp. {formatQuantity(variant.availableMilli, variant.unit)}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-ink tnum">
                        {money(variant.priceCents)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : search.trim() ? (
              <p className="mt-2 text-sm text-muted">No hay productos con ese nombre o código.</p>
            ) : null}
          </div>

          {!search.trim() && quickPicks.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-sm text-muted">Toca un producto para sumarlo</p>
              <div className="stagger grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {quickPicks.map((variant) => {
                  const inCart = qtyInCart.get(variant.variantId) ?? 0;
                  return (
                    <button
                      key={variant.variantId}
                      type="button"
                      onClick={() => addVariant(variant.variantId)}
                      aria-label={`Agregar ${variant.label}`}
                      className={cn(
                        "relative flex min-h-20 flex-col items-start gap-1 rounded-2xl border bg-card p-3.5 text-left transition-[border-color,background-color,transform] duration-200 ease-(--ease-out-soft) active:scale-[0.96]",
                        inCart > 0
                          ? "border-brand bg-brand-soft/60"
                          : "border-border hover:border-brand/50 hover:bg-brand-soft/40",
                      )}
                    >
                      <span className="line-clamp-2 pr-6 text-sm font-semibold leading-snug text-ink">
                        {variant.label}
                      </span>
                      <span className="mt-auto text-sm text-muted tnum">{money(variant.priceCents)}</span>
                      {inCart > 0 ? (
                        <span
                          key={inCart}
                          className="absolute right-2.5 top-2.5 flex h-6 min-w-6 animate-pop items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold text-white tnum"
                        >
                          {formatQuantity(inCart)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div className="border-t border-dashed border-border">
          {rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">
              La venta está vacía. Busca o toca un producto.
            </p>
          ) : (
            <ul>
              {lines.map(({ row, variant, total: lineTotal, short }) => (
                <li key={row.variantId} className="animate-slide-in border-b border-border px-5 py-3.5 last:border-b-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{variant?.label}</p>
                      <p className={cn("text-xs", short ? "font-medium text-danger" : "text-muted")}>
                        {short ? "Supera el disponible: " : "Disponible: "}
                        {variant ? formatQuantity(variant.availableMilli, variant.unit) : "—"}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Quitar ${variant?.label ?? "producto"}`}
                      onClick={() => setRows((current) => current.filter((item) => item.variantId !== row.variantId))}
                    >
                      <Trash2 className="size-4" strokeWidth={1.75} />
                    </Button>
                  </div>
                  <div className="mt-2 grid grid-cols-[1fr_1fr] gap-2 sm:grid-cols-[minmax(0,170px)_minmax(0,150px)_1fr] sm:items-center">
                    <div className="flex items-center gap-1">
                      <Button variant="secondary" size="sm" aria-label="Menos" onClick={() => stepQty(row.variantId, -1)}>
                        <Minus className="size-4" strokeWidth={1.75} />
                      </Button>
                      <input
                        aria-label={`Cantidad (${variant?.unit ?? "und"})`}
                        inputMode="decimal"
                        value={row.qty}
                        onChange={(event) => updateRow(row.variantId, { qty: event.target.value })}
                        className={cn(inputStyles, "h-9 min-w-0 px-2 text-center tnum")}
                      />
                      <Button variant="secondary" size="sm" aria-label="Más" onClick={() => stepQty(row.variantId, 1)}>
                        <Plus className="size-4" strokeWidth={1.75} />
                      </Button>
                    </div>
                    <input
                      aria-label="Precio unitario"
                      inputMode="decimal"
                      value={row.price}
                      onChange={(event) => updateRow(row.variantId, { price: event.target.value })}
                      className={cn(inputStyles, "h-9 text-right tnum")}
                    />
                    <p className="col-span-2 text-right text-[15px] font-semibold text-ink tnum sm:col-span-1">
                      {lineTotal === null ? <span className="text-danger">Revisa</span> : money(lineTotal)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <aside className="space-y-4 rounded-2xl border border-border bg-card px-5 py-5 lg:sticky lg:top-6">
        <Field label="Cliente" htmlFor="sale-customer" hint="Opcional, salvo que quede saldo pendiente.">
          <select
            id="sale-customer"
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
            className={selectStyles}
          >
            <option value="">Cliente de mostrador</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
          <Link href="/clientes/nuevo?volver=venta" className="inline-block text-sm font-medium text-brand hover:underline">
            + Nuevo cliente
          </Link>
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink">Medio de pago</legend>
          {/* Radios nativos: flechas del teclado, una sola parada de Tab y nombre del grupo. */}
          <div className="grid grid-cols-2 gap-2">
            {PAYMENT_METHODS.map((value) => (
              <label key={value} className="relative">
                <input
                  type="radio"
                  name="sale-method"
                  value={value}
                  checked={method === value}
                  onChange={() => setMethod(value)}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    "flex h-10 cursor-pointer items-center justify-center rounded-xl border text-sm font-medium transition-[background-color,border-color,color,transform] duration-200 active:scale-[0.97] peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-card",
                    method === value
                      ? "border-brand bg-brand-soft text-brand"
                      : "border-border text-muted hover:border-ink/20 hover:text-ink",
                  )}
                >
                  {PAYMENT_METHOD_LABELS[value]}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <Field
          label={method === "cash" ? "Paga con" : "Monto pagado"}
          htmlFor="sale-paid"
          hint="Escribe 0 si queda todo pendiente (fiado)."
        >
          <input
            id="sale-paid"
            inputMode="decimal"
            value={paid ?? moneyInputValue(total)}
            onChange={(event) => setPaid(event.target.value)}
            className={cn(inputStyles, "h-12 text-lg font-semibold tnum")}
          />
        </Field>

        {/* Sin "open" controlado: si no, se cerraría al borrar lo escrito. */}
        <details className="group rounded-xl border border-border px-3.5 py-2.5 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-muted transition-colors hover:text-ink">
            Descuento o nota
            <Plus
              className="size-4 transition-transform duration-300 group-open:rotate-45"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </summary>
          <div className="mt-3 space-y-3">
            <Field label="Descuento" htmlFor="sale-discount" hint="En dinero.">
              <input
                id="sale-discount"
                inputMode="decimal"
                value={discount}
                onChange={(event) => setDiscount(event.target.value)}
                placeholder="0"
                className={cn(inputStyles, "tnum")}
              />
            </Field>
            <Field label="Nota" htmlFor="sale-note">
              <input
                id="sale-note"
                value={note}
                maxLength={300}
                onChange={(event) => setNote(event.target.value)}
                className={inputStyles}
              />
            </Field>
          </div>
        </details>

        <dl className="space-y-1.5 border-t border-dashed border-border pt-4 text-sm tnum">
          <div className="flex justify-between">
            <dt className="text-muted">Subtotal</dt>
            <dd className="text-ink">{money(subtotal)}</dd>
          </div>
          {discountCents > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted">Descuento</dt>
              <dd className="text-ink">−{money(discountCents)}</dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between pt-1">
            <dt className="font-medium text-ink">Total</dt>
            <dd key={total} className="animate-pop text-[28px] font-bold leading-none tracking-tight text-ink">
              {money(total)}
            </dd>
          </div>
          {change > 0 ? (
            <div className="flex animate-pop justify-between rounded-xl bg-success-soft px-3 py-2 text-success">
              <dt>Cambio</dt>
              <dd className="font-semibold">{money(change)}</dd>
            </div>
          ) : null}
          {pending > 0 ? (
            <div className="flex animate-pop justify-between rounded-xl bg-warn-soft px-3 py-2 text-warn">
              <dt>Queda pendiente (fiado)</dt>
              <dd className="font-semibold">{money(pending)}</dd>
            </div>
          ) : null}
        </dl>
        {pending > 0 && !customerId ? (
          <p className="text-sm text-warn">Elige un cliente para dejar saldo pendiente.</p>
        ) : null}
        <SubmitButton
          size="lg"
          className="w-full"
          pendingLabel="Registrando…"
          pending={isPending}
          disabled={rows.length === 0 || invalid || (pending > 0 && !customerId)}
        >
          Registrar venta · {money(total)}
        </SubmitButton>
      </aside>
    </form>
  );
}
