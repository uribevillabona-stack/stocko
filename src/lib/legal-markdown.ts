// Lector mínimo de los documentos de legal/*.md (privacidad y términos).
// Esos archivos son la única fuente del texto: GitHub los muestra tal cual y la app
// los convierte en página. Solo se admite lo que esos documentos usan:
// títulos (# y ##), párrafos, listas con "- ", **negrita**, `código` y enlaces.

export type LegalBlock =
  | { type: "h1" | "h2" | "p"; text: string }
  | { type: "ul"; items: string[] };

export type LegalInline =
  | { type: "text" | "bold" | "code"; text: string }
  | { type: "link"; text: string; href: string };

export function parseLegalBlocks(source: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: "p", text: paragraph.join(" ") });
    if (items.length > 0) blocks.push({ type: "ul", items });
    paragraph = [];
    items = [];
  };
  for (const raw of source.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line === "") flush();
    else if (line.startsWith("## ")) {
      flush();
      blocks.push({ type: "h2", text: line.slice(3) });
    } else if (line.startsWith("# ")) {
      flush();
      blocks.push({ type: "h1", text: line.slice(2) });
    } else if (line.startsWith("- ")) {
      if (paragraph.length > 0) flush();
      items.push(line.slice(2));
    } else {
      if (items.length > 0) flush();
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)]+)/g;

export function parseLegalInline(text: string): LegalInline[] {
  const parts: LegalInline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parts.push({ type: "text", text: text.slice(last, match.index) });
    last = match.index + match[0].length;
    const [, bold, code, label, href, bare] = match;
    if (bold !== undefined) parts.push({ type: "bold", text: bold });
    else if (code !== undefined) parts.push({ type: "code", text: code });
    else if (label !== undefined && href !== undefined) parts.push({ type: "link", text: label, href });
    else if (bare !== undefined) {
      // Dirección suelta: el punto o la coma final son de la frase, no del enlace.
      const url = bare.replace(/[.,;:]+$/, "");
      parts.push({ type: "link", text: url, href: url });
      last -= bare.length - url.length;
    }
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
}

/** Los documentos se enlazan entre sí como archivos (así funcionan en GitHub); en la app son páginas. */
const IN_APP: Record<string, string> = {
  "privacidad.md": "/legal/privacidad",
  "terminos.md": "/legal/terminos",
  "../LICENSE": "/legal/licencias",
};

export function legalHref(href: string): string {
  return IN_APP[href] ?? href;
}
