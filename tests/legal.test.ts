import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { legalHref, parseLegalBlocks, parseLegalInline } from "@/lib/legal-markdown";

describe("documentos legales", () => {
  it("separa títulos, párrafos y listas", () => {
    const blocks = parseLegalBlocks("# Título\n\nUna línea\nque sigue.\n\n## Sección\n- uno\n- dos\nCierre.\r\n");
    expect(blocks).toEqual([
      { type: "h1", text: "Título" },
      { type: "p", text: "Una línea que sigue." },
      { type: "h2", text: "Sección" },
      { type: "ul", items: ["uno", "dos"] },
      { type: "p", text: "Cierre." },
    ]);
  });

  it("reconoce negrita, código, enlaces y direcciones sueltas", () => {
    expect(parseLegalInline("Ve a **Ayuda** y `C:\\Datos`, o lee [los términos](terminos.md) en https://ejemplo.co/a.")).toEqual([
      { type: "text", text: "Ve a " },
      { type: "bold", text: "Ayuda" },
      { type: "text", text: " y " },
      { type: "code", text: "C:\\Datos" },
      { type: "text", text: ", o lee " },
      { type: "link", text: "los términos", href: "terminos.md" },
      { type: "text", text: " en " },
      { type: "link", text: "https://ejemplo.co/a", href: "https://ejemplo.co/a" },
      { type: "text", text: "." },
    ]);
  });

  it("los enlaces entre documentos llevan a las páginas de la app", () => {
    expect(legalHref("terminos.md")).toBe("/legal/terminos");
    expect(legalHref("../LICENSE")).toBe("/legal/licencias");
    expect(legalHref("https://ejemplo.co")).toBe("https://ejemplo.co");
  });

  // Los documentos reales solo pueden usar lo que la app sabe mostrar.
  it.each(["privacidad.md", "terminos.md"])("%s se muestra completo y sin marcas sueltas", (file) => {
    const blocks = parseLegalBlocks(readFileSync(`legal/${file}`, "utf8"));
    expect(blocks[0]?.type).toBe("h1");
    expect(blocks.filter((block) => block.type === "h2").length).toBeGreaterThan(4);

    const texts = blocks.flatMap((block) => (block.type === "ul" ? block.items : [block.text]));
    for (const text of texts) {
      expect(text.startsWith("#"), text).toBe(false);
      for (const part of parseLegalInline(text)) {
        if (part.type === "link") {
          expect(legalHref(part.href), part.href).toMatch(/^(\/legal\/|https:\/\/)/);
        } else if (part.type === "text") {
          expect(part.text, text).not.toMatch(/\*\*|`|\]\(/);
        }
      }
    }
  });
});
