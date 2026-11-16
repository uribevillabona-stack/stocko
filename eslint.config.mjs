import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [
      ".next/**",
      ".next-desktop/**",
      "desktop/node_modules/**",
      "node_modules/**",
      "drizzle/**",
      ".local/**",
      "coverage/**",
      "next-env.d.ts",
    ],
  },
  {
    // Versión de escritorio: el proceso principal de Electron es CommonJS.
    files: ["desktop/**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
];

export default config;
