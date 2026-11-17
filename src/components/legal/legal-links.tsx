import Link from "next/link";
import { cn } from "@/lib/cn";
import { SOURCE_URL } from "@/lib/project";

const linkStyles = "hover:text-ink hover:underline underline-offset-2";

/** Enlaces legales para pies de página: privacidad, términos, licencias y código fuente. */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted", className)}>
      <Link href="/legal/privacidad" className={linkStyles}>
        Privacidad
      </Link>
      <Link href="/legal/terminos" className={linkStyles}>
        Términos
      </Link>
      <Link href="/legal/licencias" className={linkStyles}>
        Licencias
      </Link>
      <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className={linkStyles}>
        Código fuente
      </a>
    </nav>
  );
}
