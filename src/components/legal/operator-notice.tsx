import { env } from "@/lib/env";

/**
 * A quién le aplica qué parte de la política: en Windows los datos no salen del PC;
 * en la web responde quien administra el sitio (LEGAL_OPERATOR y LEGAL_CONTACT).
 */
export function OperatorNotice() {
  const operator = env.LEGAL_OPERATOR?.trim();
  const contact = env.LEGAL_CONTACT?.trim();
  const isEmail = contact ? /^[^\s@]+@[^\s@]+$/.test(contact) : false;

  return (
    <aside className="mb-8 rounded-2xl border border-border bg-card px-5 py-4 text-sm leading-6 text-ink/85">
      {env.STOCKO_DESKTOP === "1" ? (
        <p>
          <strong className="font-semibold text-ink">Estás usando Stocko para Windows.</strong> Te aplica la
          sección 1: tus datos están solo en este computador.
        </p>
      ) : (
        <>
          <p>
            <strong className="font-semibold text-ink">Estás usando Stocko en la web.</strong> Te aplica la
            sección 2.{" "}
            {operator
              ? `Este sitio lo administra ${operator}, que es responsable de los datos guardados aquí.`
              : "Quien administra este sitio todavía no ha publicado aquí sus datos de contacto."}
          </p>
          {contact ? (
            <p className="mt-1">
              Contacto para consultas sobre tus datos:{" "}
              {isEmail ? (
                <a href={`mailto:${contact}`} className="font-medium text-brand hover:underline">
                  {contact}
                </a>
              ) : (
                contact
              )}
            </p>
          ) : null}
        </>
      )}
    </aside>
  );
}
