import Link from "next/link";
import { env } from "@/lib/env";

const linkStyles = "font-medium text-brand hover:underline";

/**
 * Aviso bajo el formulario de crear cuenta.
 * - En la web, quien administra el sitio guarda los datos: crear la cuenta es autorizarlo.
 * - En Windows nadie más recibe nada y la licencia no exige aceptar condiciones para
 *   usar el programa: solo se informa dónde están.
 */
export function LegalConsent() {
  const terms = (
    <Link href="/legal/terminos" target="_blank" className={linkStyles}>
      Términos de uso
    </Link>
  );
  const privacy = (
    <Link href="/legal/privacidad" target="_blank" className={linkStyles}>
      Política de privacidad
    </Link>
  );
  return (
    <p className="mt-4 text-xs leading-5 text-muted">
      {env.STOCKO_DESKTOP === "1" ? (
        <>
          Tus datos se guardan solo en este computador. Conoce los {terms} y la {privacy}.
        </>
      ) : (
        <>
          Al crear la cuenta autorizas a quien administra este sitio a guardar y usar tus datos como explica
          la {privacy}, y confirmas que conoces los {terms}.
        </>
      )}
    </p>
  );
}
