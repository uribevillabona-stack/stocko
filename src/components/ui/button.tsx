import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-[background-color,color,box-shadow,transform] duration-200 ease-(--ease-out-soft) active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-white hover:-translate-y-px hover:bg-accent-strong hover:shadow-(--shadow-brand)",
  secondary: "border border-border bg-card text-ink hover:border-ink/20 hover:bg-hover",
  ghost: "text-muted hover:bg-hover hover:text-ink",
  danger: "bg-danger text-white hover:-translate-y-px hover:opacity-90",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-12 rounded-[14px] px-6 text-[15px] font-semibold",
};

export function buttonStyles(input?: {
  variant?: Variant;
  size?: Size;
  className?: string;
}): string {
  return cn(
    base,
    variants[input?.variant ?? "primary"],
    sizes[input?.size ?? "md"],
    input?.className,
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonStyles({ variant, size, className })}
      {...props}
    />
  );
}

export function ButtonLink({
  href,
  variant,
  size,
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonStyles({ variant, size, className })}>
      {children}
    </Link>
  );
}
