# Stocko

Inventario, ventas y clientes para negocios pequeños. Una sola aplicación web, un negocio por cuenta, roles separados para dueño y empleados. También como programa para Windows que funciona sin internet.

## Descargar para Windows

En [Releases](../../releases/latest):
- **`Stocko-Instalador-x.y.z.exe`**: instalador con accesos directos y desinstalación.
- **`Stocko-x.y.z-portable.zip`**: sin instalar. Se descomprime en cualquier carpeta y se abre `Stocko.exe`.

Los archivos todavía no tienen firma digital, así que Windows avisa la primera vez:
- **SmartScreen** ("Windows protegió su PC"): **Más información → Ejecutar de todas formas**.
- Con **Smart App Control** activo, Windows puede bloquear el instalador sin dar la opción de ejecutarlo. En ese caso usa la versión **portable**.

Todo queda en tu PC. Ver [Versión de escritorio](#versión-de-escritorio-windows-sin-internet) para los datos y las copias de seguridad.

## Licencia

Código libre bajo la [GNU AGPL-3.0](LICENSE): puedes usarlo, estudiarlo, modificarlo y compartirlo. Si distribuyes una versión modificada, o la ofreces como servicio web, debes publicar su código con la misma licencia.

**Estado:** Fases 1 a 7 terminadas: base, inventario, ventas y fiado, reportes, WhatsApp y catálogo, fotos y PWA, y endurecimiento. Falta solo el despliegue en tu cuenta de Netlify + Neon (ver [Producción](#producción-netlify-free--neon-free)).

## Stack

- Next.js 16 (App Router) y React 19 con TypeScript estricto.
- PostgreSQL 17/18 con Drizzle ORM y migraciones versionadas.
- Better Auth 1.7 con correo y contraseña.
- Tailwind CSS 4 con tokens propios, modo claro/oscuro e Inter.
- Zod para validar toda entrada.
- sharp para fotos y `@aws-sdk/client-s3` para Neon Object Storage (opcional).
- Vitest para pruebas unitarias y de integración.
- PWA instalable con manifest, íconos, atajos y service worker propio.

## Requisitos

- Node.js 20.9 o superior.
- npm.
- Docker es opcional: el proyecto incluye un PostgreSQL embebido para desarrollo.

## Puesta en marcha

```powershell
npm install
Copy-Item .env.example .env.local
```

Genera los dos secretos y pégalos en `.env.local`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

El primero es `BETTER_AUTH_SECRET`; el segundo, `ENCRYPTION_KEY`. Después:

```powershell
# Terminal A: deja PostgreSQL local corriendo en el puerto 5433
npm run db:local

# Terminal B
npm run db:migrate
npm run db:seed
npm run dev
```

Abre <http://localhost:3000>.

### Datos demo

| Rol | Correo | Contraseña |
| --- | --- | --- |
| Dueña | `duena@stocko.local` | `stocko1234` |
| Empleado | `empleado@stocko.local` | `stocko1234` |

El seed crea el negocio «Tienda La Esquina», 4 productos (uno por kilo y uno con tallas), una reserva, 2 clientes y 2 ventas (una fiada con abono). Cada parte solo se crea si todavía no existe. Se niega a ejecutarse con `NODE_ENV=production`.

### PostgreSQL con Docker

`docker-compose.yml` levanta PostgreSQL 17 en el puerto 5432. En ese caso cambia las URLs de `.env.local` a `postgres://stocko:stocko@localhost:5432/stocko` y `.../stocko_test`.

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo. |
| `npm run build` | Compila para producción. |
| `npm start` | Sirve la compilación de producción. |
| `npm run typecheck` | TypeScript sin emitir archivos. |
| `npm run lint` | ESLint con las reglas de Next. |
| `npm test` | Vitest (unitarias + integración). |
| `npm run db:local` | PostgreSQL embebido en `localhost:5433`. |
| `npm run db:generate` | Genera una migración desde el esquema. |
| `npm run db:migrate` | Aplica las migraciones pendientes. |
| `npm run db:seed` | Crea el negocio y los datos demo. |
| `npm run db:studio` | Abre Drizzle Studio. |
| `npx tsx scripts/generate-icons.ts` | Regenera los íconos PNG de la PWA. |
| `npm run desktop:dist` | Genera el instalador de Windows (ver "Versión de escritorio"). |

## Qué hace la aplicación

| Sección | Quién | Para qué |
| --- | --- | --- |
| Inicio | Todos | Ventas de hoy, cartera por cobrar, alertas de stock y primeros pasos. |
| Ventas | Todos | Vender con buscador (Enter agrega), cantidades decimales, descuento, cambio en efectivo y fiado. Abonos, recibo por WhatsApp e impresión. Solo el dueño anula. |
| Inventario | Todos | Productos con variantes, foto, precio y stock mínimo. Movimientos: entrada, salida, conteo y reserva. Historial con saldo. |
| Clientes | Todos | Datos, compras, saldo pendiente y recordatorio por WhatsApp. |
| Reportes | Dueño | Ventas, ganancia bruta y margen, dinero recibido por medio, ventas por día y por persona, más vendidos, mejores clientes, cartera e inventario valorizado. |
| Ajustes | Dueño | Negocio, WhatsApp (básico o Cloud API), catálogo en línea, equipo (crear trabajadores con contraseña inicial o invitarlos con un enlace), y registro de actividad. |
| Mi cuenta | Todos | Nombre, contraseña e instalar la app. |
| `/catalogo/<dirección>` | Público | Catálogo con fotos, precios y disponibilidad; el cliente arma su pedido y lo envía por WhatsApp. |

## Estructura

```text
src/
  app/
    (auth)/                 login, registro, onboarding
    (app)/                  layout con sesión
      ventas/ inventario/ clientes/ reportes/ cuenta/
      ajustes/ y ajustes/actividad/
    catalogo/[slug]/        catálogo público (sin sesión)
    invitacion/[token]/     aceptar una invitación
    api/auth/[...all]/      endpoints de Better Auth
    api/whatsapp/webhook/[businessId]/  webhook de la Cloud API
    api/fotos/[...key]/     fotos de producto
    api/health/             salud de la base de datos
    offline/                respaldo de la PWA
  actions/                  server actions (validan con Zod y sacan el negocio de la sesión)
  components/               UI, formularios, reportes, catálogo y PWA
  lib/                      env, DB, auth, dinero, cantidades, fechas, almacenamiento,
                            límite de intentos, auditoría
  server/
    auth/context.ts         sesión, negocio y guardas de rol
    services/               inventario, ventas, clientes, reportes, WhatsApp, catálogo
drizzle/                    migraciones SQL versionadas (0000–0007)
tests/                      Vitest
scripts/                    PostgreSQL embebido e íconos
```

## Modelo de datos

- **Negocio y equipo:** `businesses` (moneda, zona horaria, WhatsApp, sobreventa, horas de reserva, dirección del catálogo), `memberships` (un negocio por cuenta, rol `owner` o `employee`), `invitations` (hash SHA-256 del token, vence a los 7 días) y las tablas de Better Auth.
- **Inventario:** `product_categories`, `products` (unidad y foto), `product_variants` (SKU único por negocio, precio y costo en centavos, `qty_milli` físico, `reserved_milli`, `min_stock_milli`), `stock_reservations` y `inventory_movements` (cambio con signo y saldo resultante).
- **Ventas:** `customers` (teléfono único por negocio), `sales` (número consecutivo por negocio, total, pagado, anulación), `sale_items` (copia de nombre, precio y costo al vender) y `payments` (medio de pago y anulación).
- **WhatsApp:** `whatsapp_config` (secretos cifrados, tope mensual) y `whatsapp_messages` (entrantes para la ventana de 24 h y salientes con estado).
- **Seguridad:** `rate_limit` (intentos) y `audit_events` (actividad sensible).

### Reglas de negocio

- El dinero se guarda en centavos enteros (`bigint`); las cantidades, en milésimas enteras (1,5 kg = 1500).
- Al escribir cantidades, la coma es decimal y «1.500» significa mil quinientos, igual que se muestra en pantalla.
- El stock solo cambia por movimientos (`entry`, `exit`, `adjustment`, `reserve`, `release`), dentro de una transacción con `SELECT ... FOR UPDATE` sobre la variante. Las ventas bloquean el negocio (para numerar) y luego las variantes en orden de id.
- Disponible = físico − reservado. Sin sobreventa, ninguna salida, reserva, venta ni conteo deja el disponible en negativo.
- Las reservas vencen solas según las horas configuradas. Se pueden entregar (salen del físico) o liberar.
- Anular una venta devuelve el stock y anula sus pagos. El dinero recibido se devuelve por fuera.
- Margen = ventas − costo de lo vendido, con el costo copiado al momento de vender. El reporte avisa qué parte de lo vendido no tiene costo.
- Las fechas se guardan en UTC. «Hoy» y los rangos de los reportes se calculan en la zona horaria del negocio.

## Seguridad

- El `businessId` sale siempre de la sesión, nunca del cliente. Todas las consultas filtran por negocio, y hay pruebas de aislamiento en cada módulo.
- `requireMember()` exige sesión y negocio. `requireOwner()` además exige el rol dueño (reportes, ajustes, actividad, anular ventas, activar o desactivar productos y variantes).
- El empleado nunca recibe costos ni márgenes: el servidor no los envía, no solo no los muestra.
- El catálogo público expone solo nombre, descripción, foto, precio y si hay disponible.
- Contraseñas con scrypt (Better Auth). Cambiar la contraseña cierra las otras sesiones. Quitar a un empleado cierra sus sesiones.
- Límite de intentos en Postgres (sirve con varias instancias), con ventana fija:
  - Login: 8 fallos por correo e IP cada 15 min, 50 fallos por correo cada hora y 30 intentos por IP cada 15 min. Entrar bien limpia el contador.
  - Registro, aceptar invitación y cambio de contraseña.
- Los endpoints HTTP de Better Auth para entrar, registrarse y cambiar la contraseña están cerrados (la app usa server actions con sus propios límites). El resto de `/api/auth` usa el limitador de Better Auth sobre la misma tabla.
- La IP sale del encabezado de la plataforma (`x-nf-client-connection-ip` en Netlify). Si sirves Stocko detrás de tu propio proxy, define `TRUSTED_IP_HEADER`.
- Los bloqueos de fila usan `FOR NO KEY UPDATE`: serializan las operaciones de stock sin chocar con los chequeos de claves foráneas (sin interbloqueos entre ventas, anulaciones y movimientos).
- Cabeceras: CSP estricta (`frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`), `X-Frame-Options`, `nosniff`, `Referrer-Policy` y `Permissions-Policy`; HSTS cuando la app corre con https.
- WhatsApp: token y app secret cifrados con AES-256-GCM; webhook verificado con `X-Hub-Signature-256` y solo para el número configurado.
- Fotos validadas por contenido; se reducen, se convierten a WebP y se les quitan los metadatos (incluida la ubicación). Las claves son UUID aleatorios.
- Registro de actividad para el dueño: precios, anulaciones, abonos, conteos, permisos, WhatsApp y catálogo, con usuario, fecha e IP. Nunca guarda secretos.
- Ni secretos ni datos personales en los logs.

## WhatsApp

- **Básico (por defecto):** Stocko arma el recibo o el recordatorio y abre `wa.me` con el texto listo. Gratis y sin configurar nada.
- **Cloud API (opcional):** en Ajustes → WhatsApp pon el ID del número, el token permanente y el app secret de tu app de Meta. Luego configura en Meta el webhook con la URL y el token de verificación que muestra Stocko, suscrito al campo `messages`.
  - Solo envía mensajes de servicio, y solo si el cliente te escribió en las últimas 24 horas. No usa plantillas de marketing.
  - Tope mensual configurable (900 por defecto). Los envíos fallidos no cuentan.
  - Si no se puede enviar, el enlace `wa.me` sigue disponible.
  - La versión de la Graph API se cambia con `WHATSAPP_GRAPH_VERSION` (por defecto `v23.0`).
- **Catálogo en línea:** en Ajustes → Catálogo elige una dirección y publícalo. El cliente arma su pedido y lo envía al WhatsApp del negocio. No sincroniza con el catálogo de Meta Commerce.

## Fotos de producto

- **Producción:** variables `NEON_STORAGE_*` (Neon Object Storage es compatible con S3).
- **Desarrollo o servidor propio con disco:** `LOCAL_UPLOADS_DIR=.local/uploads`. En Netlify no sirve, porque su disco es efímero.
- Si no hay ninguno de los dos, el campo de foto no aparece.

## Pruebas

`npm test` usa `DATABASE_URL_TEST`, migra el esquema solo y vacía las tablas antes de cada prueba de integración. **No apuntes esa variable a la base de datos de desarrollo.** Con el PostgreSQL embebido ya existe `stocko_test`.

88 pruebas en 14 archivos. Cubren:

- Dinero, cantidades, teléfonos, cifrado, fechas por zona horaria (incluido el cambio de horario) y validaciones.
- Inventario: movimientos, sobreventa, salidas simultáneas sin stock negativo, reservas (entregar, liberar, vencer), alertas y aislamiento.
- Ventas: numeración y descuento de stock atómicos, ventas simultáneas, fiado y abonos, anulación, sobreventa y aislamiento.
- Reportes: ventas, costo, margen, cobertura de costo, medios de pago, cartera e inventario valorizado.
- WhatsApp: firma del webhook, verificación, reintentos sin duplicar, ventana de 24 h, tope mensual, fallos de la API y aislamiento.
- Concurrencia: ventas, anulaciones, entradas, cambios de precio y vencimientos al mismo tiempo, sin interbloqueos y con el libro de movimientos cuadrado.
- Catálogo, fotos, límite de intentos y auditoría.

## Versión de escritorio (Windows, sin internet)

Stocko también se instala como un programa de Windows que funciona **sin internet**: todo corre y se guarda en ese PC.

**Cómo funciona.** El instalador (`Stocko-Instalador-x.y.z.exe`) incluye Electron, el servidor de Next, su propio PostgreSQL 18 y el runtime de Visual C++ que este necesita. Al abrir Stocko:
1. Arranca la base de datos en `%LOCALAPPDATA%\Stocko\pgdata`. Solo escucha en `127.0.0.1` y usa una contraseña aleatoria propia de esa instalación.
2. Aplica las migraciones. Las versiones nuevas del programa actualizan la base solas.
3. Arranca el servidor en `http://127.0.0.1:47821`, o en otro puerto libre, y lo muestra en una ventana.

La primera vez se crea la cuenta en "Crea una". No trae datos demo. Para que un empleado use el mismo PC: Ajustes → Equipo → **Crear un trabajador** (nombre, correo y contraseña inicial; el dueño sigue en su sesión y el trabajador entra con esos datos). También sirve la invitación: **Abrir la invitación** → "Cerrar sesión y continuar", y esa persona crea su contraseña.

**Datos y copias de seguridad.**
- `%LOCALAPPDATA%\Stocko` guarda:
  - `pgdata`: la base de datos.
  - `fotos`
  - `config.json`: las claves.
  - `copias`
  - `logs`
- **Copias automáticas** en `copias\auto-AAAA-MM-DD`:
  - Se hacen al abrir y se rehacen al cerrar con lo trabajado ese día.
  - Se conservan 7 diarias y 4 semanales.
  - Solo se copia una base que abrió bien la vez anterior, para que una base dañada nunca reemplace las copias buenas.
- **Antes de actualizar** a una versión nueva se guarda `copias\antes-de-actualizar-…`.
- **Archivo → Hacer copia de seguridad…** guarda una copia completa en la carpeta que elijas. Mejor en una memoria USB u otro disco: las automáticas están en el mismo disco. La copia incluye las claves de la instalación, así que guárdala en un lugar seguro.
- **Archivo → Restaurar una copia…** reemplaza los datos actuales:
  1. Primero copia aparte, sin tocar los datos actuales.
  2. Después intercambia las carpetas de forma instantánea.
  3. Los datos anteriores quedan en `copias\antes-de-restaurar-…`, que también se puede restaurar.
  - Si la copia está dañada o no abre, vuelven solos los datos anteriores.
  - Si se va la luz a mitad de una restauración, el siguiente arranque deshace el cambio.
  - Rechaza copias incompletas, la carpeta de datos actual y copias de otra versión de PostgreSQL.
- Si Stocko no puede abrir, la ventana muestra el motivo con botones (y el menú Archivo) para **Reintentar abrir**, **Restaurar una copia…** y **Abrir la carpeta de datos**. Nunca crea una base vacía en silencio si ya hubo una o si hay copias.
- Si falta la base pero hay copias (reinstalación, carpeta borrada), ofrece **Restaurar una copia…** o **Empezar con datos nuevos** (pide confirmación; las copias no se borran y las fotos anteriores se apartan en `fotos-anteriores-…`).
- La copia necesita `config.json`, porque guarda la contraseña de la base y la clave que cifra los secretos de WhatsApp. No copies solo `pgdata`.
- Desinstalar el programa **no** borra los datos.

**Qué no funciona sin internet.**
- Envío por WhatsApp: el botón abre WhatsApp con el mensaje listo, pero necesita conexión en ese momento. La Cloud API solo está en la versión web.
- Catálogo público para clientes.

Todo lo demás funciona: ventas, inventario, clientes, reportes, fotos, equipo e impresión. El programa es para un solo PC: sus datos no se sincronizan con la versión web.

**Compilar el instalador** (en Windows):
```powershell
npm install                      # en la raíz
npm --prefix desktop install     # Electron y electron-builder
npm run desktop:dist             # build de Next + empaquetado
npm run desktop:test             # pruebas de copias y restauración
```
- En `%LOCALAPPDATA%\StockoBuild\dist` quedan dos archivos:
  - `Stocko-Instalador-x.y.z.exe`: el instalador, con accesos directos, desinstalación y actualizaciones.
  - `Stocko-x.y.z-portable.zip`: la versión portable. Se descomprime en cualquier carpeta y se abre `Stocko.exe`. El acceso directo se crea desde el menú Archivo → **Crear acceso directo en el Escritorio**. Para actualizar, se reemplaza la carpeta. Los datos son los mismos que con el instalador (`%LOCALAPPDATA%\Stocko`).
- La compilación y el empaquetado se hacen fuera de OneDrive para no sincronizar cientos de MB. `STOCKO_DESKTOP_BUILD_DIR` cambia esa carpeta.
- Para probar sin instalar: `npm run desktop:prepare` y luego `npm run desktop:dev`.
- `STOCKO_DATA_DIR` usa otra carpeta de datos, útil para pruebas.

**Firma digital y Smart App Control.** El instalador no está firmado, y eso tiene consecuencias:
- SmartScreen muestra "Windows protegió su PC" → **Más información → Ejecutar de todas formas**.
- En PCs con **Smart App Control** activado (Windows 11), Windows puede bloquear programas sin firma y no ofrece "ejecutar de todas formas". A veces basta con volver a intentarlo.
- Para reducir los bloqueos:
  - `desktop/scripts/build-installer.cjs` genera el desinstalador sin ejecutar el instalador intermedio.
  - `desktop/build/installer.nsh` actualiza sin ejecutar el desinstalador anterior desde TEMP. Ese paso es el que Smart App Control bloquea.
- Smart App Control bloquea los ejecutables sin firma que no conoce. Por eso `Stocko.exe` es el `electron.exe` original **sin modificar**, un archivo que Windows ya conoce:
  - `win.signAndEditExecutable: false` y `disableAsarIntegrity: true` en `desktop/electron-builder.config.cjs`.
  - El build falla si el ejecutable no queda idéntico al original.
  - El ícono de Stocko va en los accesos directos (`resources/stocko.ico`), no en el `.exe`. En el Administrador de tareas el proceso aparece como "Electron".
- Antes de este cambio, un `Stocko.exe` con ícono propio era "nuevo" en cada compilación y Windows lo bloqueaba de forma impredecible, incluso después de instalado.
- El instalador sí cambia en cada compilación y puede ser bloqueado. Si no abre, usa la versión portable.
- **Microsoft Store (camino elegido):** la Store firma el paquete, así que desaparecen los avisos y los bloqueos. Además da actualizaciones automáticas.
  - Generar el paquete: `npm run desktop:store`. Crea `Stocko-x.y.z-store.appx` en `%LOCALAPPDATA%\StockoBuild\dist`.
  - Los logos salen de `desktop/scripts/store-assets.mjs`.
  - Identidad: en Partner Center → Stocko → Identidad del producto. Se pasa con `STOCKO_STORE_IDENTITY`, `STOCKO_STORE_PUBLISHER` y `STOCKO_STORE_PUBLISHER_NAME` (y `STOCKO_STORE_DISPLAY_NAME` si el nombre reservado no es "Stocko"). Sin ellas, el paquete es solo de prueba; con `npm --prefix desktop run dist:store -- --release` faltar alguna es un error.
  - Datos: la carpeta real del paquete, `%LOCALAPPDATA%\Packages\<familia>\LocalState\Stocko` (Postgres no ve la ruta virtualizada de AppData).
  - Windows borra esos datos al desinstalar. Por eso las copias automáticas van a **Documentos\Stocko\Copias\<nombre del PC>**, que se conserva. Una carpeta por PC: si Documentos está en OneDrive, las copias de un PC no borran ni reemplazan las de otro. Ojo: con OneDrive las copias (incluido `config.json` con las claves) se suben a la nube de esa cuenta.
  - Al restaurar, los datos de antes se apartan primero en `LocalState\Stocko\copias-locales` (mismo disco, intercambio instantáneo) y, si la copia abre bien, pasan a Documentos.
  - Al reinstalar, Stocko no crea una base vacía si hay copias de ese PC: ofrece restaurar o empezar con datos nuevos.
- La alternativa a la Store es firmar el instalador con un certificado de firma de código, por ejemplo Azure Trusted Signing o un certificado OV/EV. Así desaparecen ambos avisos.

## Producción: Netlify Free + Neon Free

1. Crea un proyecto en Neon (plan gratuito) y copia la cadena de conexión **pooled**.
2. En Netlify, importa el repositorio. `netlify.toml` ya define el build (`npm run build`, Node 22) y Netlify usa su adaptador oficial de Next.js.
3. Define las variables de entorno:
   - `DATABASE_URL`
   - `BETTER_AUTH_SECRET` (aleatorio; la app no arranca en producción con el de ejemplo)
   - `BETTER_AUTH_URL` y `NEXT_PUBLIC_APP_URL`: el mismo dominio final con `https://`
   - `ENCRYPTION_KEY`
   - Opcionales: `NEON_STORAGE_*` para fotos, `WHATSAPP_GRAPH_VERSION` y `TRUSTED_IP_HEADER` (solo fuera de Netlify).
4. Aplica las migraciones contra Neon desde tu máquina **antes** de publicar:
   ```powershell
   $env:DATABASE_URL='postgres://...'; npx drizzle-kit migrate
   ```
5. Publica. Comprueba `https://tu-dominio/api/health`, crea tu cuenta en `/registro` e instala la app desde el navegador del teléfono.
6. Netlify Free incluye 300 créditos al mes y cada deploy de producción consume 15. Usa deploys de preview durante el desarrollo y publica solo versiones cerradas.

El driver es `pg` (node-postgres), no el driver HTTP de Neon, porque las transacciones interactivas y `SELECT ... FOR UPDATE` son obligatorias para el inventario y las ventas.

**Respaldos:** Neon guarda historial para restaurar a un punto en el tiempo (en el plan gratuito, una ventana corta). Para respaldos propios: `pg_dump "$DATABASE_URL" > stocko.sql`.
