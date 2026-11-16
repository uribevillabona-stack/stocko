"use client";

import { BarChart3, LayoutDashboard, Package, Receipt, Settings, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import type { MemberRole } from "@/lib/db/schema";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  ownerOnly?: boolean;
};

const items: NavItem[] = [
  { href: "/", label: "Inicio", icon: LayoutDashboard },
  { href: "/ventas", label: "Ventas", icon: Receipt },
  { href: "/inventario", label: "Inventario", icon: Package },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/reportes", label: "Reportes", icon: BarChart3, ownerOnly: true },
  { href: "/ajustes", label: "Ajustes", icon: Settings, ownerOnly: true },
];

export function NavLinks({
  role,
  variant = "sidebar",
}: {
  role: MemberRole;
  variant?: "sidebar" | "bottom";
}) {
  const pathname = usePathname();
  const visible = items.filter((item) => !item.ownerOnly || role === "owner");

  return (
    <ul className={variant === "sidebar" ? "space-y-1" : "flex items-stretch"}>
      {visible.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;

        if (variant === "bottom") {
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 px-0.5 py-2 text-[11px] font-medium transition-colors duration-200",
                  active ? "text-brand" : "text-muted hover:text-ink",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-[background-color,transform] duration-300 ease-(--ease-spring)",
                    active ? "scale-100 bg-brand-soft" : "scale-90 bg-transparent",
                  )}
                >
                  <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
                </span>
                <span>{item.label}</span>
              </Link>
            </li>
          );
        }

        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-200",
                active ? "bg-card text-ink shadow-(--shadow-soft)" : "text-muted hover:bg-hover hover:text-ink",
              )}
            >
              <Icon
                className={cn("size-[18px] shrink-0 transition-colors", active ? "text-brand" : undefined)}
                strokeWidth={1.75}
              />
              <span className="flex-1">{item.label}</span>
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 rounded-full bg-brand transition-transform duration-300 ease-(--ease-spring)",
                  active ? "scale-100" : "scale-0",
                )}
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
