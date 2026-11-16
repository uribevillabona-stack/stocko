// Arranque del servidor de Next dentro de Stocko para Windows.
// Si la ventana de Stocko muere de golpe (sin cerrar bien), este proceso se
// cierra solo en vez de quedar huérfano ocupando memoria y el puerto.
const parent = Number(process.env.STOCKO_PARENT_PID);
if (parent) {
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      process.exit(0);
    }
  }, 2000).unref();
}

await import("./server.js");
