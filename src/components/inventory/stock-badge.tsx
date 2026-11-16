import { Badge } from "@/components/ui/badge";
import type { StockStatus } from "@/server/services/inventory";

export function StockBadge({ status }: { status: StockStatus }) {
  if (status === "out") return <Badge tone="danger">Agotado</Badge>;
  if (status === "low") return <Badge tone="warn">Stock bajo</Badge>;
  return null;
}

export function variantLabel(variant: { name: string | null; isDefault: boolean; sku: string }) {
  return variant.name ?? variant.sku;
}
