import type { Metadata } from "next";
import { COPYRIGHT, SOURCE_URL, VERSION } from "@/lib/project";

export const metadata: Metadata = { title: "Licencias" };

const linkStyles = "font-medium text-brand underline-offset-2 hover:underline break-words";

export default function LicensesPage() {
  return (
    <article className="text-[15px] leading-7 text-ink/85">
      <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Licencias</h1>

      <h2 className="mt-10 text-lg font-semibold tracking-tight text-ink">Stocko es software libre</h2>
      <p className="mt-3">{COPYRIGHT}</p>
      <p className="mt-3">
        Este programa es software libre: puedes redistribuirlo y modificarlo bajo los términos de la Licencia
        Pública General Affero de GNU, versión 3 (AGPL-3.0), publicada por la Free Software Foundation.
      </p>
      <p className="mt-3">
        Se distribuye con la esperanza de que sea útil, pero <strong className="font-semibold text-ink">sin
        ninguna garantía</strong>; ni siquiera la garantía implícita de comerciabilidad o de adecuación a un
        propósito particular. Los detalles están en la licencia.
      </p>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 marker:text-muted">
        <li>
          <a href="/legal/agpl-3.0.txt" className={linkStyles}>
            Texto completo de la licencia AGPL-3.0
          </a>{" "}
          (en inglés, que es la versión con validez legal).
        </li>
        <li>
          Código fuente:{" "}
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className={linkStyles}>
            {SOURCE_URL}
          </a>
          . Esta es la versión {VERSION}; su código exacto está en la etiqueta{" "}
          <a href={`${SOURCE_URL}/tree/v${VERSION}`} target="_blank" rel="noopener noreferrer" className={linkStyles}>
            v{VERSION}
          </a>
          .
        </li>
      </ul>

      <h2 className="mt-10 text-lg font-semibold tracking-tight text-ink">Programas de terceros</h2>
      <p className="mt-3">
        Stocko incluye o usa programas libres de otras personas y organizaciones (por ejemplo Next.js, React,
        PostgreSQL y Electron). Cada uno conserva su propia licencia y sus avisos de autoría.
      </p>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 marker:text-muted">
        <li>
          <a href="/legal/licencias-de-terceros.txt" className={linkStyles}>
            Lista de componentes de terceros y sus licencias
          </a>
        </li>
      </ul>
    </article>
  );
}
