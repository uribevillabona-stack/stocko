// Carpetas de compilación de la versión de escritorio.
// Van fuera del proyecto (que vive en OneDrive) para no sincronizar cientos de MB.
const { join } = require("node:path");
const { homedir } = require("node:os");

const buildRoot =
  process.env.STOCKO_DESKTOP_BUILD_DIR ||
  join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "StockoBuild");

module.exports = {
  buildRoot,
  stageDir: join(buildRoot, "stage"),
  distDir: join(buildRoot, "dist"),
};
