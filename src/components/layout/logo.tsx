import { cn } from "@/lib/cn";

export function LogoMark({
  className,
  inverted = false,
}: {
  className?: string;
  inverted?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={cn("size-7", className)}
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="13"
        y="7"
        width="22"
        height="14"
        rx="5"
        className={inverted ? "fill-white" : "fill-logo-top"}
      />
      <rect
        x="7"
        y="25"
        width="34"
        height="16"
        rx="5.5"
        className={inverted ? "fill-white/55" : "fill-logo-bottom"}
      />
    </svg>
  );
}

export function Logo({
  className,
  markClassName,
  inverted = false,
}: {
  className?: string;
  markClassName?: string;
  inverted?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className={markClassName} inverted={inverted} />
      <span
        className={cn(
          "text-[1.35rem] font-bold leading-none tracking-[-0.045em]",
          inverted ? "text-white" : "text-ink",
        )}
      >
        stocko
      </span>
    </span>
  );
}
