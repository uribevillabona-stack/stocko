import { formatMoney } from "@/lib/money";
import { formatQuantity } from "@/lib/quantity";

/**
 * Modo básico de WhatsApp: enlaces wa.me que abren la conversación con el texto
 * listo. No envía nada por sí mismo y no necesita la Cloud API.
 */
export function waLink(phoneE164: string | null | undefined, text: string): string {
  const digits = (phoneE164 ?? "").replace(/\D/g, "");
  const base = digits ? `https://wa.me/${digits}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}

export function saleReceiptText(input: {
  businessName: string;
  currency: string;
  number: number;
  customerName: string | null;
  items: Array<{ description: string; qtyMilli: number; unit: string | null; lineTotalCents: number }>;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  dateLabel: string;
}): string {
  const money = (cents: number) => formatMoney(cents, input.currency);
  const lines = [
    `*${input.businessName}*`,
    `Venta #${input.number} · ${input.dateLabel}`,
    input.customerName ? `Cliente: ${input.customerName}` : null,
    "",
    ...input.items.map(
      (item) =>
        `• ${formatQuantity(item.qtyMilli, item.unit)} ${item.description}: ${money(item.lineTotalCents)}`,
    ),
    "",
    input.discountCents > 0 ? `Descuento: −${money(input.discountCents)}` : null,
    `*Total: ${money(input.totalCents)}*`,
    `Pagado: ${money(input.paidCents)}`,
    input.totalCents > input.paidCents ? `Saldo pendiente: ${money(input.totalCents - input.paidCents)}` : null,
    "",
    "¡Gracias por tu compra!",
  ];
  return lines.filter((line) => line !== null).join("\n");
}

export function balanceReminderText(input: {
  businessName: string;
  currency: string;
  customerName: string;
  balanceCents: number;
}): string {
  return [
    `Hola ${input.customerName}, te saluda ${input.businessName}.`,
    `Te recordamos que tienes un saldo pendiente de ${formatMoney(input.balanceCents, input.currency)}.`,
    "¡Gracias!",
  ].join("\n");
}
