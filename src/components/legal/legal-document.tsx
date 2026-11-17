import { readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { legalHref, parseLegalBlocks, parseLegalInline } from "@/lib/legal-markdown";

const linkStyles = "font-medium text-brand underline-offset-2 hover:underline break-words";

function Inline({ text }: { text: string }): ReactNode {
  return parseLegalInline(text).map((part, index) => {
    if (part.type === "bold") return <strong key={index} className="font-semibold text-ink">{part.text}</strong>;
    if (part.type === "code") {
      return (
        <code key={index} className="rounded-md bg-hover px-1.5 py-0.5 font-mono text-[0.85em] break-all">
          {part.text}
        </code>
      );
    }
    if (part.type === "link") {
      const href = legalHref(part.href);
      return href.startsWith("/") ? (
        <Link key={index} href={href} className={linkStyles}>
          {part.text}
        </Link>
      ) : (
        <a key={index} href={href} target="_blank" rel="noopener noreferrer" className={linkStyles}>
          {part.text}
        </a>
      );
    }
    return <Fragment key={index}>{part.text}</Fragment>;
  });
}

/**
 * Un documento de la carpeta legal/ (se lee al compilar: la página queda estática).
 * Es el mismo archivo que se publica en GitHub, para que el texto no exista dos veces.
 */
export function LegalDocument({ file }: { file: "privacidad.md" | "terminos.md" }) {
  const blocks = parseLegalBlocks(readFileSync(join(process.cwd(), "legal", file), "utf8"));
  return (
    <article className="text-[15px] leading-7 text-ink/85">
      {blocks.map((block, index) => {
        if (block.type === "h1") {
          return (
            <h1 key={index} className="text-[28px] font-bold leading-tight tracking-tight text-ink">
              {block.text}
            </h1>
          );
        }
        if (block.type === "h2") {
          return (
            <h2 key={index} className="mt-10 text-lg font-semibold tracking-tight text-ink">
              {block.text}
            </h2>
          );
        }
        if (block.type === "ul") {
          return (
            <ul key={index} className="mt-3 list-disc space-y-1.5 pl-5 marker:text-muted">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className="mt-3">
            <Inline text={block.text} />
          </p>
        );
      })}
    </article>
  );
}
