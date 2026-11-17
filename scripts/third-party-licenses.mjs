// Genera los archivos de licencias que la app sirve en /legal:
//   public/legal/agpl-3.0.txt               → la licencia de Stocko (copia de LICENSE)
//   public/legal/licencias-de-terceros.txt  → componentes de terceros con su licencia y avisos
// Las licencias MIT, BSD, ISC, Apache y similares piden entregar su texto y su aviso de
// autoría junto con el programa; esos avisos no sobreviven al empaquetado, así que se
// reúnen aquí. Corre solo antes de `npm run dev`, `npm run build` y `npm run desktop:prepare`.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "legal");

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const clean = (text) => text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();

/** Busca un paquete como lo hace Node: node_modules de la carpeta y de las de arriba. */
function findPackage(name, fromDir, stopDir) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dir === stopDir || dirname(dir) === dir) return null;
  }
}

function licenseOf(pkg) {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((entry) => entry.type ?? entry).join(" OR ");
  return "(sin declarar)";
}

function repositoryOf(pkg) {
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const url = (repo ?? pkg.homepage ?? "").replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/\.git$/, "");
  return /^[\w.-]+\/[\w.-]+$/.test(url) ? `https://github.com/${url}` : url;
}

/** Texto de licencia del paquete (LICENSE, LICENCE, COPYING…) más su archivo NOTICE si lo trae. */
function licenseText(dir) {
  const names = readdirSync(dir).sort();
  const pick = (pattern) => names.filter((name) => pattern.test(name)).map((name) => clean(readFileSync(join(dir, name), "utf8")));
  return [...pick(/^(licen[sc]e|copying)(\.|-|$)/i), ...pick(/^notice(\.|$)/i)].filter(Boolean).join("\n\n");
}

/** Dependencias de producción (y las de ellas) realmente instaladas, a partir de un package.json. */
function collect(projectDir, found) {
  const queue = [projectDir];
  const seen = new Set();
  while (queue.length > 0) {
    const dir = queue.pop();
    if (seen.has(dir)) continue;
    seen.add(dir);
    const pkg = readJson(join(dir, "package.json"));
    if (dir !== projectDir) {
      found.set(`${pkg.name}@${pkg.version}`, {
        name: pkg.name,
        version: pkg.version,
        license: licenseOf(pkg),
        url: repositoryOf(pkg),
        text: licenseText(dir),
      });
    }
    // Las opcionales de otros sistemas operativos no están instaladas: se saltan solas.
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      const child = findPackage(name, dir, projectDir);
      if (child) queue.push(child);
    }
  }
}

const packages = new Map();
collect(root, packages);
const desktopDir = join(root, "desktop");
// En el servidor (Netlify) no se instala la carpeta desktop: se lista lo que haya.
if (existsSync(join(desktopDir, "node_modules"))) collect(desktopDir, packages);
const list = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
if (list.length < 20) throw new Error(`Solo se encontraron ${list.length} paquetes: ¿falta npm install?`);

const versionOf = (dir) => (existsSync(join(dir, "package.json")) ? readJson(join(dir, "package.json")).version : null);
const electron = versionOf(join(desktopDir, "node_modules", "electron"));
const postgres = versionOf(join(root, "node_modules", "@embedded-postgres", "windows-x64"));

const POSTGRES_LICENSE = `PostgreSQL Database Management System
(also known as Postgres, formerly known as Postgres95)

Portions Copyright (c) 1996-2025, PostgreSQL Global Development Group

Portions Copyright (c) 1994, The Regents of the University of California

Permission to use, copy, modify, and distribute this software and its
documentation for any purpose, without fee, and without a written agreement
is hereby granted, provided that the above copyright notice and this
paragraph and the following two paragraphs appear in all copies.

IN NO EVENT SHALL THE UNIVERSITY OF CALIFORNIA BE LIABLE TO ANY PARTY FOR
DIRECT, INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, INCLUDING
LOST PROFITS, ARISING OUT OF THE USE OF THIS SOFTWARE AND ITS
DOCUMENTATION, EVEN IF THE UNIVERSITY OF CALIFORNIA HAS BEEN ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.

THE UNIVERSITY OF CALIFORNIA SPECIFICALLY DISCLAIMS ANY WARRANTIES,
INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS FOR A PARTICULAR PURPOSE.  THE SOFTWARE PROVIDED HEREUNDER IS
ON AN "AS IS" BASIS, AND THE UNIVERSITY OF CALIFORNIA HAS NO OBLIGATIONS TO
PROVIDE MAINTENANCE, SUPPORT, UPDATES, ENHANCEMENTS, OR MODIFICATIONS.`;

// Lo que Stocko para Windows lleva además de los paquetes de npm.
const windowsComponents = [
  ["Electron" + (electron ? ` ${electron}` : ""), "MIT", "https://github.com/electron/electron", "Su licencia va junto a Stocko.exe (LICENSE.electron.txt)."],
  ["Chromium, Node.js y sus componentes (dentro de Electron)", "BSD-3-Clause, MIT y otras", "https://www.chromium.org", "Sus avisos van junto a Stocko.exe (LICENSES.chromium.html)."],
  ["FFmpeg (ffmpeg.dll, dentro de Electron)", "LGPL-2.1-or-later", "https://ffmpeg.org", "Biblioteca aparte, sin modificar; se puede reemplazar."],
  ["PostgreSQL" + (postgres ? ` (paquete ${postgres})` : ""), "PostgreSQL", "https://www.postgresql.org", "Texto de la licencia más abajo."],
  ["OpenSSL (libcrypto, libssl)", "Apache-2.0", "https://www.openssl.org", ""],
  ["ICU (icu*.dll)", "Unicode-3.0", "https://icu.unicode.org", ""],
  ["zlib", "Zlib", "https://zlib.net", ""],
  ["libxml2 y libxslt", "MIT", "https://gitlab.gnome.org/GNOME/libxml2", ""],
  ["LZ4", "BSD-2-Clause", "https://github.com/lz4/lz4", ""],
  ["Zstandard", "BSD-3-Clause", "https://github.com/facebook/zstd", ""],
  ["curl (libcurl)", "curl", "https://curl.se", ""],
  ["GNU gettext (libintl) y GNU libiconv", "LGPL-2.1-or-later", "https://www.gnu.org/software/gettext/", "Bibliotecas aparte, sin modificar; se pueden reemplazar."],
  ["winpthreads (mingw-w64)", "MIT y BSD-3-Clause", "https://www.mingw-w64.org", ""],
  ["wxWidgets (wx*.dll, parte de la distribución de PostgreSQL)", "wxWindows Library Licence 3.1", "https://www.wxwidgets.org", ""],
  ["libvips y sus dependencias (dentro de sharp)", "LGPL-3.0-or-later", "https://github.com/lovell/sharp-libvips", "Bibliotecas aparte, sin modificar; se pueden reemplazar."],
  [
    "Microsoft Visual C++ Runtime (vcruntime140.dll, vcruntime140_1.dll, msvcp140.dll)",
    "Licencia de Microsoft (código distribuible de Visual Studio)",
    "https://learn.microsoft.com/cpp/windows/redistributing-visual-cpp-files",
    "© Microsoft Corporation. Se entrega sin modificar junto a PostgreSQL, que lo necesita.",
  ],
];

const fontLicense = clean(readFileSync(join(root, "legal", "terceros", "Inter-OFL-1.1.txt"), "utf8"));

// Los textos idénticos (el MIT de un mismo autor, Apache-2.0…) se escriben una sola vez.
const texts = new Map();
const missing = [];
for (const item of list) {
  if (!item.text) {
    missing.push(item);
    continue;
  }
  const key = createHash("sha256").update(item.text).digest("hex");
  if (!texts.has(key)) texts.set(key, { text: item.text, users: [] });
  texts.get(key).users.push(`${item.name}@${item.version}`);
}

const rule = "=".repeat(78);
const thin = "-".repeat(78);
const row = (name, license, url, note) => `- ${name} — ${license}${url ? ` — ${url}` : ""}${note ? `\n  ${note}` : ""}`;
const stocko = readJson(join(root, "package.json")).version;

const out = [
  `STOCKO ${stocko} — COMPONENTES DE TERCEROS Y SUS LICENCIAS`,
  "",
  "Stocko es software libre bajo la licencia GNU AGPL versión 3 (ver agpl-3.0.txt).",
  "Incluye o usa los programas de terceros de esta lista. Cada uno conserva su licencia",
  "y sus avisos de autoría, que se reproducen abajo. Código de Stocko:",
  "https://github.com/uribevillabona-stack/stocko",
  "",
  rule,
  "1. TIPO DE LETRA",
  rule,
  "",
  row("Inter", "OFL-1.1", "https://github.com/rsms/inter", "Texto de la licencia más abajo."),
  "",
  rule,
  `2. PAQUETES DE NPM (${list.length})`,
  rule,
  "",
  ...list.map((item) => row(`${item.name} ${item.version}`, item.license, item.url, "")),
  "",
  rule,
  "3. STOCKO PARA WINDOWS: COMPONENTES ADICIONALES",
  rule,
  "",
  ...windowsComponents.map((item) => row(...item)),
  "",
  rule,
  "4. TEXTOS DE LAS LICENCIAS",
  rule,
  "",
  thin,
  "Inter (tipo de letra)",
  thin,
  "",
  fontLicense,
  "",
  thin,
  "PostgreSQL",
  thin,
  "",
  POSTGRES_LICENSE,
  "",
  ...[...texts.values()].flatMap(({ text, users }) => [thin, users.join(", "), thin, "", text, ""]),
  ...(missing.length > 0
    ? [
        thin,
        "Paquetes que no traen archivo de licencia (aplica la licencia indicada en la lista):",
        thin,
        "",
        ...missing.map((item) => `- ${item.name} ${item.version} — ${item.license}`),
        "",
      ]
    : []),
].join("\n");

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "licencias-de-terceros.txt"), out);
writeFileSync(join(outDir, "agpl-3.0.txt"), clean(readFileSync(join(root, "LICENSE"), "utf8")) + "\n");
console.log(`Licencias de terceros: ${list.length} paquetes, ${texts.size} textos distintos → public/legal/`);
