"use client";

import { Minus, Plus, Search, ShoppingBag } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, buttonStyles } from "@/components/ui/button";
import { inputStyles } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { waLink } from "@/lib/whatsapp-link";

export type CatalogItem = {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  categoryName: string | null;
  photoUrl?: string | null;
  variants: Array<{ id: string; name: string | null; priceCents: number; available: boolean }>;
};

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function CatalogView({
  businessName,
  currency,
  whatsappNumber,
  items,
}: {
  businessName: string;
  currency: string;
  whatsappNumber: string | null;
  items: CatalogItem[];
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const money = (cents: number) => formatMoney(cents, currency);

  const categories = useMemo(
    () => [...new Set(items.map((item) => item.categoryName).filter((name): name is string => Boolean(name)))],
    [items],
  );

  const visible = items.filter((item) => {
    if (category && item.categoryName !== category) return false;
    const term = normalize(search.trim());
    return !term || normalize(`${item.name} ${item.description ?? ""}`).includes(term);
  });

  const variantIndex = useMemo(() => {
    const map = new Map<string, { item: CatalogItem; variant: CatalogItem["variants"][number] }>();
    for (const item of items) for (const variant of item.variants) map.set(variant.id, { item, variant });
    return map;
  }, [items]);

  const lines = Object.entries(cart)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ ...variantIndex.get(id)!, qty }))
    .filter((line) => line.item);
  const count = lines.reduce((sum, line) => sum + line.qty, 0);
  const total = lines.reduce((sum, line) => sum + line.qty * line.variant.priceCents, 0);

  const message = [
    `Hola ${businessName}, quiero pedir:`,
    ...lines.map(
      (line) =>
        `• ${line.qty} × ${line.item.name}${line.variant.name ? ` (${line.variant.name})` : ""} — ${money(line.qty * line.variant.priceCents)}`,
    ),
    `Total aproximado: ${money(total)}`,
  ].join("\n");

  function change(id: string, delta: number) {
    setCart((current) => ({ ...current, [id]: Math.max(0, (current[id] ?? 0) + delta) }));
  }

  return (
    <div className={cn(count > 0 && "pb-28")}>
      <div className="sticky top-0 z-10 -mx-4 bg-surface/95 px-4 pb-3 pt-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" strokeWidth={1.75} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar productos"
            aria-label="Buscar productos"
            className={cn(inputStyles, "pl-9")}
          />
        </div>
        {categories.length > 1 ? (
          <div className="mt-2 flex gap-1 overflow-x-auto" role="tablist" aria-label="Categorías">
            {[null, ...categories].map((name) => (
              <button
                key={name ?? "todas"}
                type="button"
                role="tab"
                aria-selected={category === name}
                onClick={() => setCategory(name)}
                className={buttonStyles({ variant: category === name ? "secondary" : "ghost", size: "sm", className: "shrink-0" })}
              >
                {name ?? "Todo"}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">No encontramos productos con ese nombre.</p>
      ) : (
        <ul className="mt-2 grid gap-3 sm:grid-cols-2">
          {visible.map((item) => (
            <li key={item.id} className="overflow-hidden rounded-2xl border border-border bg-card">
              {item.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.photoUrl} alt={item.name} loading="lazy" className="aspect-[4/3] w-full object-cover" />
              ) : null}
              <div className="px-4 py-3">
                <p className="text-sm font-semibold text-ink">{item.name}</p>
                {item.description ? <p className="mt-0.5 text-xs leading-5 text-muted">{item.description}</p> : null}
                <ul className="mt-2 space-y-2">
                  {item.variants.map((variant) => (
                    <li key={variant.id} className="flex items-center justify-between gap-3">
                      <span className="min-w-0">
                        {variant.name ? <span className="block truncate text-xs text-muted">{variant.name}</span> : null}
                        <span className="text-sm font-medium text-ink tnum">
                          {money(variant.priceCents)}
                          <span className="font-normal text-muted"> / {item.unit}</span>
                        </span>
                      </span>
                      {!variant.available ? (
                        <span className="shrink-0 text-xs text-muted">Agotado</span>
                      ) : whatsappNumber ? (
                        cart[variant.id] ? (
                          <span className="flex shrink-0 items-center gap-1">
                            <Button variant="secondary" size="sm" aria-label="Quitar uno" onClick={() => change(variant.id, -1)}>
                              <Minus className="size-4" strokeWidth={1.75} />
                            </Button>
                            <span className="w-6 text-center text-sm tnum">{cart[variant.id]}</span>
                            <Button variant="secondary" size="sm" aria-label="Agregar uno" onClick={() => change(variant.id, 1)}>
                              <Plus className="size-4" strokeWidth={1.75} />
                            </Button>
                          </span>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={() => change(variant.id, 1)}>
                            Agregar
                          </Button>
                        )
                      ) : (
                        <span className="shrink-0 text-xs text-success">Disponible</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      )}

      {count > 0 && whatsappNumber ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <p className="text-sm text-ink tnum">
              <ShoppingBag className="mr-1.5 inline size-4" strokeWidth={1.75} aria-hidden="true" />
              {count} {count === 1 ? "producto" : "productos"} · <span className="font-semibold">{money(total)}</span>
            </p>
            <a
              href={waLink(whatsappNumber, message)}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonStyles({ className: "shrink-0" })}
            >
              Pedir por WhatsApp
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
