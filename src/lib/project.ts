// Datos públicos del proyecto que la app muestra en sus avisos legales.
import pkg from "../../package.json";

/**
 * Dónde está el código de Stocko. La licencia (AGPL-3.0, sección 13) pide ofrecerlo a
 * quien use la app por internet: si publicas una versión modificada, cambia esta
 * dirección por la de tu código. La misma está en desktop/lib/updates.cjs (Windows).
 */
export const SOURCE_URL = "https://github.com/uribevillabona-stack/stocko";

/** Cada versión publicada lleva la etiqueta v<versión> en ese repositorio. */
export const VERSION: string = pkg.version;

export const COPYRIGHT = "Copyright © 2026 uribevillabona-stack y quienes contribuyen a Stocko.";
