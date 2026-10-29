# Cotizador Helgen — contexto para Claude Code

Léelo completo antes de cambiar algo. Resume el sistema, dónde viven los datos y las decisiones ya tomadas
(con su porqué) para no repetir errores. Textos de la interfaz y comentarios del código: **español de México**.

## 1. Qué es

App web interna de **Helgen Servicios Especializados** para hacer cotizaciones, solo para cuentas `@helgen.tech`.
Desde el **19/10/2026** (§11) la interfaz se sirve desde **Cloudflare** y habla por `doPost` con una API en
**Google Apps Script** (sin servidor propio), con sesión de Google verificada en cada llamada. Flujo:

1. El usuario inicia sesión con Google y llena el formulario (cliente, conceptos, notas, línea de negocio Helgen / Helgen Energy).
2. El servidor **recalcula** subtotal, IVA y total, asigna un **folio único** `HLG-AAAA-0001` y genera el **PDF**.
3. El PDF se guarda en Drive (carpeta por año) y la cotización queda como una fila en Google Sheets, con el vendedor del token.

Además: **proyectos** (opcionales: folio `PRY-AAAA-0001-XXX` con clave de 3 letras y carpeta propia en Drive; §6.9), **cobranza por proyecto**
(cotización aceptada, contrato firmado, esquema de pagos y pagos `PAG-AAAA-0001` con comprobante; solo rol de cobranza; §6.11),
**carga rápida y sincronización sin recargar** (una llamada `bootstrap` al entrar, caché por versiones y consulta cada 20 s; §6.14),
**órdenes de compra por proyecto** (`OC-AAAA-0001` con PDF, proveedores y margen del proyecto; solo rol de compras; el margen solo
lo ve cobranza; §6.12), **requisiciones de materiales** (`REQ-AAAA-0001`: un trabajador pide sin precios y adjunta la cotización del
proveedor; compras la autoriza y genera la OC, la paga `PGP-AAAA-0001` y el trabajador confirma que recibió; §6.13), cotizaciones en **MXN o USD**, historial con búsqueda, catálogo de productos con precios (Google Sheets aparte), clientes sugeridos con
autorrelleno, y claves SAT internas por producto para contabilidad (con sugerencias por palabras o con IA).

**Helgen Energy** es la submarca de paneles solares: mismo folio y diseño, pero sus propios Términos y Condiciones.

**CAPRI — incremento 4 (construido el 28/10/2026; sin publicar: §9).** La app se llama ahora **CAPRI** (Cotizaciones ·
Aprobaciones · Pagos · Requisiciones · Inventario). Agrega: **permisos por persona** en un libro privado de Administración
(super admin raíz = leo@, página de Permisos, **delegación** de aprobaciones o compras por fechas); cuentas **`@helgen.services`**
que entran con un **código por correo** y solo ven Requisiciones; **sesión de 30 días**; **avisos por correo** en cada relevo
(desde facilities@, sin montos); **solicitud de cotización en PDF** y envío de la orden al proveedor; pantalla de **Pendientes**;
**anular** cualquier registro (super admin, con motivo y cascada); "lo que ya pediste" como sugerencias; y el **enlace con el
centro de mando de Drogheda** (`drogheda.helgen.online`): CAPRI le avisa las órdenes de proyectos ligados (firmado HMAC, sin
montos), quien recibe marca "En camino"/"Lo recogí", el material se recibe allá (entra al inventario del sitio) y CAPRI trae esas
recepciones cada 15 min para cerrar la requisición. Detalle en §4.8, §5 (Administración), §6.15 y `docs/incremento-4*.md`.

**CAPRI — incremento 5 (pedido de los usuarios el 29/10/2026; construido el mismo día, §9).** **Forma de pago por orden**
(Transferencia · Crédito del proveedor · Tarjeta de crédito · Tarjeta de débito en sitio · Efectivo · Cheque; con crédito del
proveedor el material se recibe antes de pagar); **base de proveedores** con datos bancarios y documentos (CSF, carátula bancaria,
comprobante de domicilio) que bloquea el pago **por transferencia** sin ellos; **una foto por renglón** al recibir (en CAPRI y en el
centro de mando; se guarda en Drive) y **devoluciones** `DEV-AAAA-NNNN` cuando llega material equivocado o dañado. Detalle en §4.9,
§5, §6.16 y `docs/incremento-5*.md`.

## 2. Datos clave (IDs y URLs)

| Qué | Valor |
|---|---|
| **Cotizador (lo usa el equipo)** | `https://cotizador-helgen.cotizador-helgen.workers.dev/cotizador/` (portada en `/`) |
| Proyecto Apps Script de la API (`scriptId` en `.clasp.json`) | `1GsH8DjaFEZ9dltqBUTUEFE_frblSYimRRCvPkqKdRB5UhmBwwYHLSwyS` (nombre anterior "Cotizador Helgen — PRUEBAS interfaz web"; ver §9) |
| Deployment de la API (siempre actualizar este; `API_URL` en `web/cotizador/index.html`) | `AKfycbwBjF7ra_4O8INsxBq0eh-4r-BlSsJ4LLxcJgVCPRpx1U1a-Pz1CUSdYtvj_Mh0S6y2` (**@13 al 29/10/2026 = CAPRI incremento 4, publicado por facilities@**; @12 al 28/10/2026 = facturas de proveedor y cuentas por pagar + requisiciones con operaciones (PR 2 y 3; el flujo con operaciones se activa al poner correos en `ROL_OPERACIONES`); @11 al 23/10/2026 = carga rápida, sincronización sin recargar, requisiciones en cualquier proyecto y clave de proyecto; @10 = requisiciones de materiales y pago a proveedores; @9 = resumen de cobranza; @8 = Compras: órdenes de compra, proveedores y margen; @7 = ocultar aceptar/firmar en proyectos cancelados; @6 = Cobranza y USD; @5 = nombre del vendedor en Historial; @4 = Proyectos; @3 = 19/10/2026; `access: ANYONE_ANONYMOUS` + token) |
| Client ID de OAuth (`CLIENT_ID_GOOGLE` en `web/cotizador/index.html` y `Code.js`) | `884526916417-cn5fh45io0nnpvlad2439thkpius4063.apps.googleusercontent.com` (no es secreto) |
| Carpeta maestra en Drive "Cotizador Helgen" | `1lf3Z4d3e_oqFbYJse4QbyYkWowYT9HCo` |
| Base de datos "Cotizador Helgen — Base de datos" (`SPREADSHEET_ID`) | `1ozFsyt1OjSnSv-PVpRWZjgqeWt6voQREbjvOJAXPEaI` |
| Catálogo "Catálogo Helgen" (`CATALOGO_ID`) | `11Rr0G7ZHE8PqXWsw9OpPPfGLQx8Yz7g8h1wkjJY2ahQ` |
| Carpeta PDF "Cotizaciones Helgen (PDF)" (`FOLDER_ID`) | `1CDN1LyOlA1L6z5dvBp49tlqu0fDoxdX8` (subcarpeta `2026` = `1X6m0nexpc3TzJd9XWBmGOAeZuiJE3Pig`) |
| "Catálogos SAT (CFDI 4.0)" (`SAT_ID`) | `1B2t9tXuEj1i9JO9ybqsuH4PN1K47CqMZgoEBzd-Dmc8` (subcarpeta "Catálogos SAT" `15OYcUp41onVJoW7--b3gnLZY8ymvYbUZ`) |
| Carpeta "Cotizador Helgen — Cobranza" (`COBRANZA_FOLDER_ID`) | `1A9uoRdhFdWOBacWCxx4Ktw1d9iQH7JRc` (creada el 20/10/2026 con `prepararCobranza()`; fuera de la carpeta maestra, en Mi unidad). Libro "Cotizador Helgen — Cobranza (datos)" (`COBRANZA_DB_ID`) `1uk9FNzTkQPjvWJw2R5wb8HXZl9c8ldYvyB64c8yjHL0`. Lectores: tania@ y leo@ (§6.11) |
| Carpeta "Cotizador Helgen — Compras" (`COMPRAS_FOLDER_ID`) | `16tsymb1cKlPUfXrkmu8XzBgyVAO5djCb` (creada el 21/10/2026 con `prepararCompras()`; raíz de Mi unidad, fuera de la carpeta maestra). Libro "Cotizador Helgen — Compras (datos)" (`COMPRAS_DB_ID`) `1cDK0Jgj9YPXsASMVkU7ctiP6Dtc4hN34jJ3MWhPgfDE`. Lectores: tania@ y leo@ (por persona; acceso general Restringido, comprobado) |
| Respaldos de la migración | Carpeta "Respaldos 2026-10-19" `1hxx0tgh4cLZMqoyf-eT8l14UAde7Y-L1` (copias de base de datos y catálogo antes del cambio) |
| Respaldos antes de Proyectos | Carpeta "Respaldos 2026-10-20" `1rFGY_k_YRRo243p3xL2RpibQ9jkEo634`: Base de datos `1PBQvmwI412IMyJb74qBWN5ZcyhSuxK3xGU9cV5KPxTE`, Catálogo `1GxBpAvQxVNJyFJSLnaY9umA5L2qf4dqX36S4uehHUNc` (antes de la pestaña Proyectos y la columna T) |
| Respaldos antes de Cobranza | Carpeta "Respaldos 2026-10-20 (antes de Cobranza)" `1C_yGbX0Gk_cZBwegdswPFvuzCVDdyTLF` (en la carpeta maestra): Base de datos `14C3d7w2ouaygtCGi0BP1QocGiqG4gf5Umh9O4KHgdow`, Catálogo `140_1sfwXF9u_aL1egDPYSbsE0rMwELGPZ5rkGVdzQnc` (antes de las columnas U:V, la columna I del catálogo y la pestaña "Tipo de cambio"). Verificadas contra los originales |
| Respaldos antes de Compras (20/10/2026) | Carpeta "Respaldos 2026-10-20 (antes de Compras)" `1QWHfc7K5w5lk5vU_jt1lCSrn4PY5YyKA` (en la carpeta maestra): Base de datos `1dCTVyMH50_55WzIfN-waUvoXaKYOliet_scZSCyKHYo`, Catálogo `1Y-Ho8kKfZsLd0lris8IIHOR5X_LExRcxThbje0Z5G9s`. Libro de cobranza: carpeta "Respaldo 2026-10-20 (antes de Compras)" `1H_BjW-VEdKbO-4LpF5aeKvFWwPiprKu2` **dentro de la carpeta de cobranza** (nunca en la maestra), copia `1KIhAfkEZhMWzzp81Y8jMFjSs6a2Ki6L7LcO13cvbFgU` (solo encabezados). Las tres verificadas pestaña por pestaña contra los originales. Copias hechas con el conector de Drive: Workspace les puso "helgen.tech: lector" (§6.11); el usuario dejó en Restringido la carpeta de respaldo de cobranza el 21/10/2026 (comprobado: carpeta y copia solo con efrain@, tania@ y leo@) |
| Respaldos antes de carga rápida y claves (23/10/2026) | Base de datos y Catálogo: carpeta "Respaldos 2026-10-23 (antes de carga y claves)" `18i8S6NsEdQqs1zd83ehP8g9bxL6e8Adc` (en la carpeta maestra), copias `19sW5zKbSSl_-avfJ131kM8UgnM6aOFIlXQKwKuGw07g` y `1ycjtw7b6TLYYYeMiRhfVakL0BsMXdrekSiaPw8TCEDI`. Libro de cobranza: carpeta "Respaldo 2026-10-23 (antes de carga y claves)" `1YvtmlKR_bDgYAvsTv2I7txD85zBM8SMO` **dentro de la carpeta de cobranza**, copia `1a7FpjNTYkOh7IiqnGbLIiLET1n3Nd5gDQcglafEAYN4`. Libro de compras: carpeta con el mismo nombre `1DRos9fjHh5SeZle49AjqTYXwStfbQemW` **dentro de la carpeta de compras**, copia `1P3thpiq6jhnWESE8PnfYLlem5cQ3NRW6OfO6lUcEMpY` (cobranza y compras solo encabezados). Las 4 verificadas pestaña por pestaña. Las privadas nacieron con "helgen.tech: lector" aunque se crearon con herencia desactivada; el usuario las dejó en Restringido el 23/10/2026 (comprobado: carpetas con efrain@, tania@ y leo@; copias solo efrain@) |
| Respaldos antes de Requisiciones (23/10/2026) | Base de datos: carpeta "Respaldos 2026-10-23 (antes de Requisiciones)" `1rUAEWtUV_z4uXJCS406NOPQLc4BK7YtK` (en la carpeta maestra), copia `1N3NZVURGWyHDQ6fXzUG7AtHbr6YhK7xHwi5YFNaZpro`. Libro de compras: carpeta "Respaldo 2026-10-23 (antes de Requisiciones)" `17Yn700vHeCNebrDj-4mXzeP5YxgXfW2G` **dentro de la carpeta de compras**, copia `1CiMuP7Z2oBh_Lrp4ma1LG7vSKFc69d1a_P46edfFDDE` (solo encabezados). Verificadas pestaña por pestaña. Nacieron con "helgen.tech: lector" (§6.11); el usuario dejó en Restringido la carpeta de compras el 23/10/2026 (comprobado: carpeta con efrain@, tania@ y leo@; copia solo efrain@) |
| Respaldos antes de Facturas y Operaciones (28/10/2026) | Base de datos: carpeta "Respaldos 2026-10-28 (antes de Facturas y Operaciones)" `1mC6VneuSGboLkYn0AYkDJ2uzaqdrnQP8` (en la carpeta maestra), copia `1hVYVdwwm1U5HttdJdQfpYwr-oKOVCHXuSctNEWZkDXc`. Libro de compras: carpeta "Respaldo 2026-10-28 (antes de Facturas y Operaciones)" `1MxtnxM4VX2bkmF5tlJ_9aNXCtpd0hrl5` **dentro de la carpeta de compras**, copia `1tRrVF44Z2JHEXTP2IRg3A-fV8A7q_BCaQ7Kjmn5zgqU` (solo encabezados). Verificadas pestaña por pestaña. Nacieron con "helgen.tech: lector" (§6.11): **pendiente que el usuario deje en Restringido la carpeta y la copia de compras** |
| **Manual del Cotizador Helgen** (para personas) | Documento de Claude Docs `https://claude.ai/artifact/AN8w8T2SKmDXSTa1zpFt2C` (id `AN8w8T2SKmDXSTa1zpFt2C`; pestaña `1cdc8401-1062`, cuerpo `86e49b65-80a1`). Se actualiza **junto con este archivo** (regla 14 y §8) |
| Worker de Cloudflare | `cotizador-helgen`, cuenta de efrain@helgen.tech `badd8bca60b008822a73ca24e983ff43` |
| Dueño de todo / cuenta de clasp | `efrain@helgen.tech` (dueño de los archivos). **Desde CAPRI (29/10/2026, decisión de Leo) la cuenta que publica y corre la API es `facilities@helgen.tech`** (editor de todos los libros y carpetas; la API se ejecuta como quien publica: `USER_DEPLOYING`). Publicar con otra cuenta cambia quién manda los correos y quién lee los libros |
| Proyecto de prueba "PRUEBAS — Cotizador Helgen (no usar)" | `1wp8_SQofXXUuMkUjmDyyUxYLxx-LdFv-20JaXE7q9entLfEvDKgYtnt0`; deployment `AKfycbwVu2q5…` retirado el 20/10/2026 (404). Para Cobranza (20/10/2026): deployment `AKfycbz9naWOw4Jj0qlta0RjCNifgZLvvJqXpqRnrrsALewSnmn7ydnEIw_zYriIHZjbQ5ugQw`, **retirado** al publicar (404); su `Pruebas.js` crea "PRUEBAS — Cobranza" y tiene `pruebasRondaSinRol()` / `pruebasRondaConRol()`. Para Compras (20/10/2026): deployment `AKfycbxK3ldf…`, **retirado** al terminar (404); `Pruebas.js` con `configurarCompras()` y rondas C1–C3 (§10.7). Para Requisiciones (23/10/2026): deployment `AKfycbybSSE0…`, **retirado** al publicar (404); `Pruebas.js` con `configurarRequisiciones()` y rondas R1–R3 (§10.8). Para carga rápida y claves (23/10/2026): deployment `AKfycbxnFS1f…`, **retirado** al publicar (404); quedó con el código de la API @11 y en la ronda R2 (§10.9). Está en la carpeta `1w-T05ql…` (lo movió el usuario). Solo datos inventados (§10.5). **No es la API.** |
| **Proyecto anterior (EN DESUSO)** | `1X-qSKgvqKwuDj4iPZBhXlakR5udau9ibVMevhwvlLXgtSkjV4IoQxqwU`; deployment `AKfycbxahS3…` en @10 = aviso "El cotizador se mudó". Código en `anterior/` (§11) |

Los IDs que usa el código están en **Script Properties** del proyecto `1GsH8Dja…` (ver §5). Esta tabla es solo referencia.

## 3. Archivos del proyecto (carpeta local oficial `~/Proyectos/cotizador-helgen`)

**Carpeta oficial desde el 19/10/2026: `~/Proyectos/cotizador-helgen`** (abrir aquí las sesiones de Claude Code).
Antes estaba en `~/Downloads/cotizador-helgen` (se mandó a la Papelera tras copiarla y verificarla).
`~/Proyectos/VIEJA-NO-USAR-cotizador-helgen-web` es una copia vieja (mañana del 19/10, antes de la sesión con token):
**no trabajar ahí**. Su `.clasp.json` (que apunta a `1GsH8Dja…`) se renombró a `.clasp.json.desactivado` el 19/10/2026
para que un `clasp push` desde ella no pise la API con código viejo; no volver a renombrarlo.

| Archivo | Para qué |
|---|---|
| `Code.js` | Todo el backend: API `doPost` con sesión + lógica (ver §4). Se sube a Apps Script. |
| `Logo.js` | Logos en base64: `LOGO_HELGEN_AZUL` (PDF, fondo blanco, 700×200) y `LOGO_HELGEN_BLANCO`. Se sube. |
| `Index.html` | Interfaz vieja de HtmlService. Se sube pero **no se usa** (`doGet` ya no la sirve; su `API_URL` es un marcador). La interfaz real es `web/cotizador/index.html`. |
| `appsscript.json` | Manifiesto: zona `America/Mexico_City`, V8, web app `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`. Se sube. |
| `.clasp.json` | Liga la carpeta al proyecto `1GsH8Dja…`. **No cambiar el scriptId.** |
| `.claspignore` | Lista blanca: solo se suben `Code.js`, `Logo.js`, `Index.html`, `appsscript.json` (excluye `anterior/`). |
| `web/` | Portada (`index.html`, `logo-helgen-blanco.png`) y la interfaz real `web/cotizador/index.html` (§10). No se sube a Apps Script. `.assetsignore` excluye `Icon`/`.DS_Store`. |
| `wrangler.jsonc` | Publica `web/` en Cloudflare como Worker solo de archivos estáticos. |
| `tests/` | Pruebas en Node con servicios de Google simulados (ver §8). No se suben. `cotizacion.test.js` acepta `Code.js` (actual) o `Code.gs` (anterior). |
| `anterior/` | Código del proyecto viejo (@9), su `.clasp.json` (`1X-qSKgv…`), `LEEME.md` con cómo regresar y el CLAUDE.md previo a la migración. No tocar salvo para regresar. |
| `herramientas/extraer-catalogos-sat.js` | Convierte el Excel oficial del SAT en los CSV que importa la app (ver §6.5). |
| `GUIA.md` | Guía para personas (instalación inicial). Desactualizada: describe el proyecto anterior. |
| `package.json` | Solo `@google/clasp` como dependencia de desarrollo. |
| `Icon` | Archivo vacío de macOS; ignorarlo. |

Git inicializado el 19/10/2026 (rama `main`; nombre y correo configurados solo en este repositorio). El `.gitignore`
excluye `node_modules/`, `.wrangler/`, `Icon`, `.DS_Store` y archivos de credenciales (`.env`, `.clasprc.json`, `*.pem`…).
Respaldo en el repositorio **privado** de GitHub `https://github.com/efrainsosa27/cotizador-helgen.git` (remoto `origin`).
Primer push hecho el 19/10/2026 con un token personal (llavero `osxkeychain`). Desde el 19/10/2026 git usa **GitHub CLI**:
`gh` v2.102.0 en `~/.local/bin/gh` (binario oficial de `cli/cli`, sin Homebrew porque pide administrador; `~/.zprofile`
agrega `~/.local/bin` al `PATH`), sesión `efrainsosa27` con `gh auth login --web` y `gh auth setup-git` (en `~/.gitconfig`,
solo para github.com). `git push` ya no pide token. Sin llave SSH. Si la sesión expira: `gh auth login --hostname github.com --git-protocol https --web`.
Si `git fetch` falla con `bad object refs/Icon`, macOS dejó archivos `Icon` vacíos dentro de `.git`; borrarlos con
`find .git -name $'Icon\r' -size 0 -delete`.

## 4. Funciones de `Code.js`

Convención: las que terminan en `_` son internas; las demás las llama la interfaz (por `doPost`, ver `API_FUNCIONES`)
o son lógica pura (sección 5 del archivo, sin servicios de Google, probables en Node).

### 4.1 Entrada, sesión e instalación
- `doGet()` — solo responde un texto con la dirección del cotizador (no sirve la app; ver §10.3).
- `doPost(e)` — verifica el token (`verificarTokenGoogle_`) **antes** de buscar la función; solo ejecuta las de `API_FUNCIONES`.
  Pone el vendedor en `VENDEDOR_` durante la petición y lo limpia en `finally`. Detalle en §10.3.
- `verificarTokenGoogle_(token)`, `validarClaimsToken(...)` (pura), `usuarioActual_()` (reemplaza `Session.getActiveUser()`).
- `setup()` — crea la base de datos (pestañas `Cotizaciones` y `Config`) y la carpeta de PDF, y guarda sus IDs.
  `db_()` la ejecuta sola si faltan `SPREADSHEET_ID`/`FOLDER_ID` (bajo candado).
- `db_()` — abre la base de datos; si faltan `SPREADSHEET_ID`/`FOLDER_ID`, corre `setup()`.
- `getConfig_()` — lee `Config` como objeto; antes llama `migrarConfig_()`.
- `migrarConfig_(hoja)` — actualiza hojas `Config` viejas: `TERMINOS` → `TERMINOS_HELGEN` + `TERMINOS_ENERGY`, agrega claves
  nuevas de `CONFIG_INICIAL`, cambia valores de ejemplo (`CONFIG_EJEMPLO_ANTERIOR`) por los reales y repara celdas `#ERROR!`.

### 4.1.1 Carga inicial, caché y sincronización (sección 1.1 del archivo; ver §6.14)
- `bootstrap()` *(UI, al cargar)* — única llamada al entrar: `versiones`, `permisos` (`permisosUsuario_`), `soloRequisicion`, IVA,
  vigencia, catálogo (sin precios con `SOLO_REQUISICION`), clientes y proyectos (cotizar) y, según el rol, `req: {proyectos, mias}`,
  `com: {proyectos, requisiciones}`, `cob: {proyectos, resumen}`. Las listas pesadas (mis requisiciones, requisiciones de compras,
  resumen de cobranza) solo van si ya están en caché (si no, `null` y la interfaz las pide al abrir su pestaña). Cada pieza va en
  `intentar_`: si falla, `null` y su texto en `errores`. `getDatosIniciales()` = alias (interfaces viejas en caché del navegador).
- `sincronizar(versiones, ctx)` *(UI, cada 20 s)* — revisa las hojas que se editan a mano (`proyectosCache_(true)`…), compara versiones
  y devuelve `{versiones, permisos, soloRequisicion, cambios}` más **solo** las listas o vistas que cambiaron y que el rol puede ver:
  `catalogo`, `clientes`, `proyectos`, `reqProyectos`, `misReq`, `comProyectos`, `comRequisiciones` (con el filtro `ctx.rcBuscar/rcEstado`),
  `requisicion` (`ctx.req`), `comprasProyecto` (`ctx.comProyecto`), `cobProyectos`, `cobranzaProyecto` (`ctx.cobProyecto`), `resumen`
  (`ctx.cobResumen`). Con `SOLO_REQUISICION` nunca manda lo demás aunque el contexto lo pida.
- Versiones: `COLECCIONES` (proyectos, contratos, cotizaciones, catalogo, requisiciones, oc, pagosCobranza, pagosProveedores) en
  Script Properties `VER_<colección>`; `CAMBIOS_API` dice qué sube cada función; `doPost` llama `subirVersiones_` (con el candado de
  script) **después** de que la escritura terminó bien (no si devolvió `{confirmar}`). Durante una escritura `SIN_CACHE_` = lo que
  devuelve sale de la hoja. **Toda función nueva que escriba debe agregarse a `CAMBIOS_API`.**
- Caché: `enCache_(base, colecciones, ttl, fn)` (clave = base + versiones; sin `fn` solo lee), `leerCache_`/`guardarCache_` (JSON en trozos
  de 30 000 caracteres), `TTL_CACHE` = 6 h. `fuenteConHuella_(nombre, colección, cadaSeg, leer, revisar)` para hojas editables a mano:
  dato 6 h; con `revisar` (solo `sincronizar`) relee la hoja si pasaron `cadaSeg` (marca `R_<nombre>`) y si la huella MD5 cambió con la
  misma versión, sube la versión. Fuentes: `proyectosCache_` (5 min), `contratosCache_`, `catalogoCache_`, `clientesCache_` (10 min);
  `configLigera_`. `REVISAR_A_MANO_` asegura esas fuentes antes de armar una clave. `MEMO_` = lo leído en la petición (propiedades,
  fuentes); `doPost` lo limpia. Roles: `tieneRol_(rol)` (Permisos del libro de Administración, o Script Properties mientras no
  exista; §4.8).
- En caché por versión: `listarProyectos`, `listarProyectosCobranza/Compras/Requisicion`, `misRequisiciones` (por correo),
  `listarRequisiciones` (por filtro), `resumenCobranzaGeneral`, historial (folio con clave). Las vistas de detalle no.

### 4.2 Catálogo de productos
- `hojaCatalogo_()` — abre "Catálogo Helgen"; si no existe, `crearCatalogo_()` (bajo candado). Llama `asegurarColumnasSat_()`.
- `crearCatalogo_()` — crea el archivo con formato, validaciones (clave única con `COUNTIF`, precio ≥ 0), migra la pestaña
  `Catalogo` vieja de la base de datos (sin el ejemplo `EJ-001`, luego la borra) y lo mueve junto a la base de datos.
- `asegurarColumnasSat_(hoja)` — agrega encabezados `Clave SAT`/`Unidad SAT` (G:H, formato texto) a catálogos viejos.
- `asegurarPrecioUsd_(hoja)` — crea la pestaña "Tipo de cambio" (B2 `GOOGLEFINANCE("CURRENCY:USDMXN")`, B3 manual opcional,
  B4 en uso = rango con nombre `TIPO_CAMBIO`, recálculo cada hora), el encabezado de la columna I (protegida con advertencia) y la
  fórmula `=IF(ISNUMBER(Dn),IFERROR(ROUND(Dn/TIPO_CAMBIO,2),""),"")` en cada renglón con producto que no la tenga (se repara
  sola). **Fórmula por renglón, no `ARRAYFORMULA`**: una que llene toda la columna haría que `appendRow` escriba al final de la hoja.
  Si falla, el catálogo funciona igual. `tipoCambioCatalogo_(hoja)` → `{valor, fuente}`.
- `getCatalogo_(hoja?)` — lista `{clave, descripcion, unidad, precio, claveSat, unidadSat, precioUsd}`; `precioUsd` lo calcula el
  servidor con el tipo de cambio en uso (mismo cálculo que la columna I; no espera a que Sheets recalcule); `null` sin tipo de cambio.
- `getCatalogo()` *(UI)* — productos + URL del archivo + unidades SAT para la lista de selección + `tipoCambio`.
- `guardarProducto(p)` *(UI)* — alta o edición (`p.claveOriginal` = edición, permite cambiar la clave). Valida con
  `normalizarProducto`, rechaza claves duplicadas (sin distinguir mayúsculas) y claves/unidades SAT que no existan.
  "Actualizó" = `usuarioActual_()`.

### 4.3 Catálogos del SAT
- `libroSat_()` — abre "Catálogos SAT (CFDI 4.0)"; si no existe `SAT_ID`, `importarCatalogosSat_()`.
- `importarCatalogosSat_()` — busca en Drive `SAT_c_ClaveProdServ.csv` y `SAT_c_ClaveUnidad.csv`, crea el libro con pestañas
  `ClaveProdServ`, `ClaveUnidad` y `Fuente`, y lo deja en la carpeta de los CSV.
- `getUnidadesSat_()` — `[[clave, nombre], …]` de unidades.
- `sugerirClavesSat(texto)` *(UI)* — si el texto es una clave de 7–8 dígitos la busca exacta; si no, toma ~40 candidatos
  (`candidatosSat`) y, si existe `ANTHROPIC_API_KEY`, la IA elige las 5 mejores con razón (`ordenarConIaSat_`);
  si no hay key o falla, devuelve los 8 mejores por palabras.
- `ordenarConIaSat_(texto, candidatos)` — llama a la API de Claude (`UrlFetchApp`), guarda el resultado 6 h en caché; `null` si falla o no hay key.
- `probarIaSat()` — correr desde el editor: muestra en el registro sugerencias de ejemplo.
- `existeEnSat_(pestana, clave)` — valida una clave con `TextFinder` (celda completa).

### 4.4 Datos para la interfaz
- `getDatosIniciales()` — desde el 23/10/2026 es alias de `bootstrap()` (§4.1.1): IVA, vigencia, marcas, catálogo, clientes, `usuario`,
  `vendedor` y `permisos` (`{cobranza, desbloqueo, compras, requisicion}`; solo para mostrar pestañas: cada función lo vuelve a revisar).
  Con `SOLO_REQUISICION` devuelve `soloRequisicion: true`, catálogo sin precios y sin clientes ni proyectos (§4.5.4).
- `getClientes()` *(UI)* — clientes que ya cotizaron, calculados desde la hoja `Cotizaciones` (`clientesDesdeFilas`).
- `listarCotizaciones(busqueda)` *(UI)* — últimas 100 cotizaciones, filtro por folio/cliente/empresa/proyecto; `vendedor` =
  `vendedorDeFila`: nombre + apellido de la fila; en filas viejas (sin Q:S), el nombre que ese correo tiene en otras filas
  (`nombresDeVendedores`, gana la más reciente); si no se conoce, el correo (`vendedor_email` o "Elaboró"). No modifica la hoja.
  `moneda` = columna U (vacía = MXN).

### 4.5 Guardar cotización
- `guardarCotizacion(payload)` *(UI)* — exige vendedor verificado (si no, error de sesión); normaliza, agrega clave/unidad SAT
  a cada concepto que venga del catálogo (si falla, guarda igual), toma el candado, revisa idempotencia (`payload.idSolicitud`
  en `CacheService`, 6 h), asigna folio, genera PDF, lo guarda en la carpeta del año, reescribe encabezados si no coinciden con
  `ENCABEZADOS_COTIZACIONES` y agrega la fila. Devuelve `{folio, url, total, moneda, proyectoFolio}`.
  Si viene `payload.proyectoFolio`, dentro del candado valida que el proyecto exista, esté `Activo` y **no tenga contrato
  firmado** (si no, error `codigo: "PROYECTO"` y no se gasta folio; el de contrato dice "Proyecto con contrato firmado: no admite
  cotizaciones nuevas.") y guarda el PDF en `<carpeta del proyecto>/Cotizaciones` en lugar de la carpeta del año.
- `siguienteFolio_(prefijo, hoja, baseContador)` — `max(<baseContador>AAAA, mayor folio del año en la hoja) + 1`.
  `baseContador` = `CONSECUTIVO_` (cotizaciones, por omisión), `CONSECUTIVO_PROY_` (proyectos) o `CONSECUTIVO_PAG_` (pagos).
- `carpetaDelAnio_(anio)` — subcarpeta `2026`, `2027`… dentro de la carpeta de PDF (la busca **por nombre**).
- `logoDataUrl_(fileId)` — logo de Drive si `LOGO_FILE_ID` tiene valor; si no, `LOGO_HELGEN_AZUL`.

### 4.5.1 Proyectos (sección 4.1 del archivo)
- `hojaProyectos_()` — pestaña `Proyectos` de la base de datos; la crea sola (lista desplegable de Estado en G) y reescribe
  solo la fila 1 si faltan encabezados (`ENCABEZADOS_PROYECTOS`).
- `listarProyectos(busqueda, incluirInactivos)` *(UI)* — busca por folio (con o sin clave), clave, cliente o nombre; por omisión solo
  `Activo` y **sin contrato firmado** (el buscador de cotizaciones; `contratosCache_`); máx. 50, recientes primero; `proyectoParaLista_`
  (con `clave` y `folioVisible`; sin `carpeta_id`).
- `crearProyecto(p)` *(UI)* — exige vendedor; `normalizarProyecto` (incluye `clave`: la capturada o `claveSugerida`); candado +
  idempotencia (`PRY_<idSolicitud>`, 6 h); folio `PRY-AAAA-NNNN` + clave en la columna L; **primero** crea la carpeta
  ("PRY-AAAA-NNNN-XXX — Cliente — Nombre") y **después** la fila (estado `Activo`). Devuelve `{folio, clave, folioVisible, …, url}`.
- `buscarProyecto_` acepta el folio con o sin clave (`folioInterno`). `guardarCotizacion` guarda siempre la llave interna en la columna T.
- `asignarClavesProyectos()` (editor; vista previa en el registro) y `asignarClavesProyectosAplicar()` — clave sugerida a los proyectos
  sin clave y su carpeta principal (por `carpeta_id`) pasa a "PRY-AAAA-NNNN-XXX — …"; una carpeta que no empieza con su folio
  (renombrada a mano) no se toca; los que ya tienen clave no cambian; sube la versión de proyectos.
- `buscarProyecto_(hoja, folio)`, `carpetaProyectos_()` (`PROYECTOS_FOLDER_ID`; si falta o está en la Papelera la crea en la
  carpeta maestra = padre de la base de datos), `subcarpeta_(padre, nombre)` (por nombre, ignora la Papelera, crea si falta),
  `crearCarpetaProyecto_`, `subcarpetaProyecto_(proyecto, nombreSub)` (ver §6.9).
- `bootstrap()` incluye `proyectos` (activos sin contrato firmado; si falla, `[]` y la app carga igual).

### 4.5.2 Cobranza (sección 4.2 del archivo; ver §6.11)
- Todas empiezan con `exigirCobranza_()` (token + correo en `ROL_COBRANZA`; si no, `errorPermiso_` → `codigo: "PERMISO"`).
- *(UI)* `listarProyectosCobranza(busqueda)` (todos los estados + estado del contrato), `getCobranzaProyecto(folio)`,
  `resumenCobranzaGeneral()` (resumen de todos los proyectos; solo lee: una lectura de Contratos, Esquemas, Pagos, Proyectos y
  órdenes de compra; calcula con `resumenGeneralCobranza`),
  `marcarAceptada(proyecto, cotizacion, confirmado)` (al pasar de Helgen a Energy pone el 60/30/10; si eso reemplaza un esquema
  distinto devuelve `{confirmar, mensaje}` sin cambiar nada; entre cotizaciones de la misma línea conserva el esquema),
  `guardarEsquema(proyecto, etapas, motivo)` (Energy: solo `ADMIN_DESBLOQUEO` y motivo obligatorio en la Bitacora), `firmarContrato(proyecto, 'AAAA-MM-DD')`,
  `desbloquearContrato(proyecto, motivo)` (además `esAdminDesbloqueo_`), `registrarPago(p)` (con `comprobante.datos` en base64
  e idempotencia `PAG_<idSolicitud>`), `cancelarPago(folio, motivo)`. Las que cambian algo usan `conCandado_` y devuelven la vista
  (`vistaCobranza_`: además de los datos, `puedeAceptar`, `puedeFirmar` —falsos si el proyecto está `Cancelado`—, `puedePagar`,
  `puedeDesbloquear`, `esquemaEditable`, `esquemaPideMotivo`; la interfaz muestra los botones según estos campos).
- Internas: `carpetaCobranza_` y `libroCobranza_` (se crean solas la primera vez; si el ID existe pero no se encuentra, **error**:
  no se crea otra a escondidas), `libroCobranzaSiExiste_` (las cotizaciones no crean el libro), `hojaCobranza_(libro, nombre)`
  (encabezados que se migran solos, `HOJAS_COBRANZA`), `datosCobranza_`, `escribirEsquema_`, `bitacora_`, `cotizacionesDeProyecto_`.
- `privado_(item)` — deja un archivo o carpeta en "Restringido" borrando los permisos `domain`/`anyone` con la API REST de Drive
  (§6.11); se aplica a la carpeta, el libro, las subcarpetas de año y proyecto y cada comprobante, **siempre de arriba abajo**
  (un permiso heredado no se puede quitar en el hijo: 403 `cannotDeletePermission`). Si falla, lanza error.
- `prepararCobranza()` — correr desde el editor: crea carpeta y libro (o los repara si ya existen), restringe primero la
  carpeta y luego el libro, y registra `ROL_COBRANZA`. Sirve para autorizar permisos. No comparte nada.
- Cobranza y compras comparten la mecánica de "área privada": `AREA_COBRANZA` / `AREA_COMPRAS` + `carpetaArea_`, `libroArea_`,
  `libroAreaSiExiste_`, `hojaDeArea_(libro, hojas, nombre)`, `filasDeArea_`; roles con `enRol_(propiedad)`.
  `contratosFirmados_()` = mapa folio → contrato firmado (lo usan el buscador de cotizaciones y compras).
- `vistaCobranza_` incluye `margen` (`margenDeContrato_`: contratado sin IVA − órdenes de compra no canceladas; si algo falla,
  `{error}` y la vista carga igual). `marcarAceptada` rechaza una aceptada de otra moneda si hay órdenes vigentes (como con pagos).

### 4.5.3 Compras (sección 4.3 del archivo; ver §6.12)
- Todas empiezan con `exigirCompras_()` (token + correo en `ROL_COMPRAS`; si no, `codigo: "PERMISO"`).
- *(UI)* `listarProyectosCompras(busqueda)` (`Activo` y `Cerrado`, con o sin contrato; `monedaDeProyecto_`: `moneda`, `marca`, `sinContrato`, `contrato`; **sin montos**),
  `getComprasProyecto(folio)` (`vistaCompras_`: proyecto, `moneda`, `marca`, órdenes con su `reqFolio`; sin contrato ni margen;
  solo consulta), `cancelarOrdenCompra(folio, motivo)` (solo Emitida: una Pagada o Recibida no se cancela; motivo ≥ 5; si la orden
  viene de una requisición Autorizada, la requisición regresa a Solicitada sin `oc_folio`).
- **Desde el 23/10/2026 no hay emisión directa ni "Recibida" desde compras**: `guardarOrdenCompra` y `marcarOcRecibida` ya no existen.
  La orden la emite `emitirOrdenCompra_(libro, datos, proyecto, reqFolio)` (dentro del candado de `autorizarRequisicion`: proyecto no
  `Cancelado`, con o sin contrato; moneda y línea de `monedaDeProyecto_(contratosDelLibro_()…)`: la aceptada o MXN y sin línea; el PDF
  lleva el folio con clave; folio `siguienteFolio_('OC', hoja, 'CONSECUTIVO_OC_')`; proveedor; PDF con la línea "Requisición: REQ-…";
  fila con `req_folio`; Bitacora) y queda Recibida al cerrar su requisición (§4.5.4).
- Internas: `carpetaCompras_`, `libroCompras_`, `libroComprasSiExiste_`, `hojaCompras_`, `ordenDesdeFila_`, `ordenesDeProyecto_`,
  `proveedoresDelLibro_`, `guardarProveedor_` (alta o actualización por id; si llega con RFC y existía sin RFC, esa fila toma el RFC),
  `buscarOrden_`, `carpetaProyectoCompras_` (Compras/AAAA/<folio>, restringidas de arriba abajo), `motivoObligatorio_`,
  `bitacora_(…, HOJAS_COMPRAS)`.
- `prepararCompras()` — correr desde el editor: crea o repara carpeta y libro restringidos, crea todas las pestañas de
  `HOJAS_COMPRAS` (también las de requisiciones y la columna `req_folio`), agrega `TERMINOS_OC` a Config y muestra `ROL_COMPRAS`,
  `ROL_REQUISICION` y `SOLO_REQUISICION`. No comparte nada.

### 4.5.4 Requisiciones y pago a proveedores (sección 4.4 del archivo; ver §6.13)
- Permisos: `esRequisicion_()` = `ROL_REQUISICION` **o** `SOLO_REQUISICION`; `exigirRequisicion_()`. `esSoloRequisicion_()`: en
  `doPost`, toda función fuera de `FUNCIONES_SOLO_REQUISICION` se niega con `PERMISO` ("Tu cuenta solo tiene acceso a
  Requisiciones."), antes de ejecutarla; `getDatosIniciales` les manda `soloRequisicion: true`, catálogo **sin precios** y nada de
  clientes, proyectos ni tipo de cambio.
- *(UI, solicitante)* `listarProyectosRequisicion(busqueda)` (`Activo` y `Cerrado`, con o sin contrato; solo `{folio, clave, folioVisible,
  nombre, estado}`; busca por folio, clave y nombre, no por cliente), `misRequisiciones()` (**filtra por el correo del token**; `reqParaSolicitante_`: estado, motivo, renglones,
  eventos, `puedeEditar`/`puedeCancelar`/`puedeCerrar`; nunca orden, montos, cliente ni pagos), `guardarRequisicion(p)` (nueva o
  reenvío de una Devuelta con `p.folio`; idempotencia `REQ_<idSolicitud>`; cotización obligatoria al crear, opcional al reenviar),
  `cancelarRequisicion(folio, motivo)` (Solicitada o Devuelta), `cerrarRequisicion(folio, notas)` ("Recibí el material": solo el
  solicitante y solo Pagada).
- *(UI, compras)* `listarRequisiciones(busqueda, estado)` (todas, máx. 200), `getRequisicion(folio)` (`vistaRequisicion_`: renglones,
  eventos, cotización, proyecto con cliente y moneda del contrato, orden, pagos, proveedores y `puedeAutorizar`/`puedeRevisar`/
  `puedePagar`/`puedeCancelarPago`/`puedeCerrar`), `autorizarRequisicion(folio, datosOc)` (idempotencia `OC_<idSolicitud>`),
  `rechazarRequisicion` / `devolverRequisicion(folio, motivo)` (`revisarRequisicion_`), `registrarPagoProveedor(p)` (`reqFolio` u
  `ocFolio`; idempotencia `PGP_<idSolicitud>`; folio `siguienteFolio_('PGP', hoja, 'CONSECUTIVO_PGP_')`), `cancelarPagoProveedor(folio,
  motivo)`, `cerrarRequisicionCompras(folio, motivo, notas)`.
- Internas: `hojaReq_`, `reqDesdeFila_`, `buscarReq_`, `cambiarReq_` (estado, motivo, oc_folio, revisó, actualizado, notas),
  `eventoReq_` (historial sin montos), `renglonesDeReqs_` (versión vigente = la mayor), `eventosDeReqs_`, `escribirRenglonesReq_`,
  `nombresDeProyectos_`, `bytesDeAdjunto_`, `carpetaRequisiciones_` (Compras/AAAA/<folio>/Requisiciones, restringida),
  `pagoProvDesdeFila_`, `pagosDeOrden_`, `cerrarReq_`, `notaOpcional_`.

### 4.6 Lógica pura (sin Google; se prueba en Node)
- `redondear(n)`, `formatoMoneda(n)`, `escaparHtml(s)`, `importeConLetra(n, moneda)` ("MIL CIENTO SESENTA PESOS 02/100 M.N.";
  en USD "MIL CIENTO SESENTA DÓLARES 02/100 USD").
- `normalizarCotizacion(p, ivaTasa)` — limpia cliente/conceptos, exige nombre y ≥1 concepto, calcula importes y totales, `marca`,
  `moneda` (`monedaDeCotizacion`: vacía = MXN; solo MXN/USD) y `tipoCambio` (solo USD, validado con `tipoCambioDesdeValores`).
- Cobranza: `esquemaPorOmision`, `validarEsquema` (1–10 etapas, nombres únicos, % > 0 con 2 decimales, suma exacta 100),
  `montosDeEsquema` (la última etapa absorbe los centavos), `convertirMoneda`, `repartirPago` (etapa elegida → siguientes →
  anteriores; en centavos), `resumenCobranza` (vuelve a repartir los pagos Vigentes en orden de registro), `validarFechaIso`,
  `normalizarPago`, `validarComprobante` (tipo por los primeros bytes: PDF, JPG, PNG, HEIC; máx. 10 MB), `correosDeLista`,
  `nombreComprobante`.
- `formatearFolio`, `maxConsecutivo(folios, prefijo, anio)`.
- `clientesDesdeFilas(filas)` — agrupa por nombre+empresa normalizados (`textoNormal`), la fila más
  reciente manda, un dato vacío no borra uno anterior; `etiqueta` = nombre, o "nombre — empresa" si el nombre se repite;
  `id` = `idCliente`.
- `idCliente(c)` — RFC válido y no genérico (`RFC_GENERICOS`: XAXX010101000, XEXX010101000); si no, `SIN-RFC:nombre|empresa`
  normalizados. `normalizarProyecto(p)`, `nombreCarpetaProyecto(folio, cliente, nombre)` (quita `/ \ : * ? " < > |`),
  `proyectosDesdeFilas`, `filtrarProyectos`.
- `normalizarProducto(p)`, `indiceDeClave(claves, clave)`.
- Clave de proyecto: `PALABRAS_SIN_CLAVE`, `claveSugerida(nombre)` (regla en §6.9), `validarClaveProyecto(clave, nombre)` (exactamente
  3 letras A–Z; vacía = sugerida), `folioVisible(folio, clave)`, `folioInterno(texto)` ("PRY-2026-0002-DRO" → "PRY-2026-0002").
  `proyectosDesdeFilas` agrega `clave` (columna L) y `folioVisible`; `filtrarProyectos` busca también por ellos.
- `nombresDeVendedores(filas)` (correo en minúsculas → "Nombre Apellido"), `vendedorDeFila(r, nombres)`.
- `terminosParaPdf(cfg, marca)` — renglones de T&C de la marca; agrega la línea de vigencia si falta.
- `textoCelda(s)` — antepone `'` a texto que empiece con `= + - @` para que Sheets no lo lea como fórmula.
- `validarClaimsToken(claims, clientId, dominio, ahora)` — ver §10.3.
- SAT: `palabrasSat`, `SINONIMOS_SAT`, `PALABRAS_SERVICIO_SAT`, `buscarClavesSat(consulta, filas, n)`, `candidatosSat`,
  `solicitudIaSat`, `leerRespuestaIaSat` (solo acepta claves que estaban entre los candidatos). Modelo: `MODELO_IA_SAT`.
- `construirHtmlPdf(d, cfg, logoUrl)` — HTML del PDF (ver reglas 3–4).
- Resumen de cobranza: `resumenGeneralCobranza({contratos, esquemas, pagos, proyectos, ordenes})` → `{totales (por moneda), proyectos}`
  (ver §6.11 "Resumen de cobranza"); usa `resumenCobranza` por proyecto, así las cifras son las mismas que en su vista.
- Compras: `normalizarProveedor`, `proveedorId` (RFC válido no genérico o `SIN-RFC:razón social`), `fusionarProveedor` (un dato
  vacío no borra uno anterior), `proveedoresDesdeFilas` (con `etiqueta` y `fila`), `normalizarOrdenCompra(p, {moneda, ubicacion, hoy,
  ivaTasa})` (entrega obligatoria y no anterior a hoy; lugar = ubicación del proyecto si viene vacío; condiciones obligatorias; IVA
  16/8/0 % (`IVA_OC`); renglones con costo capturado; tipo de cambio obligatorio si la moneda no es la del proyecto;
  `subtotalProyecto` sin IVA en la moneda del proyecto), `costosDeOrdenes(ordenes, monedaContrato)` (suma `subtotal_proyecto`
  por moneda; la usan el margen de la vista y el resumen), `margenProyecto(contratado, moneda, costos)` (lanza error si un costo
  está en otra moneda; `porcentaje` con 1 decimal), `nombreArchivoOc`, `terminosOcParaPdf(cfg)` (si la celda está vacía, los
  iniciales), `construirHtmlOrdenCompra(d, cfg, logoUrl)` (mismas reglas que el de cotización; sin tipo de cambio ni línea de negocio;
  con `d.reqFolio` agrega la fila "Requisición").
- Requisiciones: `REQ_*` (estados), `TRANSICIONES_REQ` + `transicionReq(estado, accion)` (lanza error si no se puede),
  `normalizarRequisicion(p)` (≥1 renglón con descripción; cantidad > 0; unidad por omisión PZA; sin costo), `normalizarPagoProveedor(p,
  {moneda, total, fechaOrden, hoy})` (usa `normalizarPago`; fecha no futura ni anterior a la orden; monto convertido = total ±
  `TOLERANCIA_PAGO`), `nombreArchivoReq(folio, que, ext, n)` ("(n)" desde el segundo archivo), `validarArchivo(bytes, que, sujeto)`
  (`validarComprobante` la usa con los textos de siempre).

### 4.7 Interfaz (`web/cotizador/index.html`)
Pestañas: **Nueva cotización**, **Historial**, **Catálogo**, **Cobranza** (solo si `permisos.cobranza`; al entrar muestra el
**resumen** `#cobVistaResumen` — buscador `#resProyecto` para abrir **cualquier** proyecto (también sin aceptada), `verResumenCob`, `cargarResumenCob`, `filtrarResumenCob`, `pintarResumenCob`, `csvResumenCob`,
`descargarCsvCob` —; clic en un renglón → `abrirProyectoCob` muestra `#cobVistaProyecto` con "← Resumen"; tarjeta de margen
`#cobMargen`), **Requisiciones** (solo si `permisos.requisicion`; con `soloRequisicion` es la única pestaña): `cargarProyectosReq`,
`agregarRenglonReq`, `leerRenglonesReq`, `limpiarReq`, `enviarRequisicion` (nueva o corrección), `pintarMisReq`, `editarReq`,
`cancelarReq`, `recibiMaterial` (notas con `window.prompt`), `pintarCatalogoReq` (`#reqCatalogo`, sin precios) y **Compras** (solo si
`permisos.compras`): vista de lista `#comVistaLista` (requisiciones con filtro: `cargarRequisicionesCom`, `pintarListaReqCom`; y
"Órdenes por proyecto": `cargarProyectosCom`, `pintarCompras`, `cancelarOc`) y detalle `#comVistaReq` (`abrirReqCom`, `pintarReqCom`:
renglones y la cotización en `#rcCotVisor` (vista previa de Drive) lado a lado; `revisarReqCom`; formulario de la orden precargado
con `precargarOc` (notas en la descripción, costo vacío), `recibirProveedores`/`autorrellenarProveedor`, `agregarRenglonOc`,
`recalcularOc`, `pintarTcOc`, `guardarOc` → `autorizarRequisicion`; pago `pintarTcPago`, `registrarPagoProv`, `cancelarPagoProv`;
`cerrarReqCom`, `cancelarOcDesdeReq`). `.oculto` lleva `!important` (si no, `.acciones`/`.tiles` le ganan). Moneda: selector
`#moneda`, `monedaActual`, `dinero(n, moneda)`, `cambiarMoneda` (en USD el catálogo llena clave/descripción/unidad pero **no**
el precio). Cobranza: `cargarProyectosCob`, `pintarCobranza(vista)`, `pintarEsquema`, `aceptarCot` (confirma con `window.confirm`
si el servidor lo pide), `guardarEsquemaCob`, `firmarCob`, `desbloquearCob`, `registrarPago` (lee el archivo con `FileReader`),
`cancelarPagoCob` (motivo con `window.prompt`). Funciones principales: `agregarFila`, `leerItems`,
`recalcular` (vista previa; el servidor recalcula), `guardar`, `limpiar`, `cargarHistorial`, `recibirClientes`,
`autorrellenarCliente`, `pintarDatalists`, `cargarCatalogo`, `pintarCatalogo`, `editarProd`, `guardarProd`, `sugerirSat`, `verTab`.
Proyectos (módulo "1 · Cliente y proyecto"): `recibirProyectos`, `proyectoElegido`, `alElegirProyecto` (si "Nombre" está vacío,
lo llena buscando el cliente por `cliente_id`), `abrirNuevoProyecto`, `crearProyecto` (usa el cliente de los campos de arriba; manda
`clave`). Clave: `#npClave` (se llena con `claveSugerida`, copia de la de `Code.js`, mientras no se edite a mano: `CLAVE_A_MANO`),
`#npFolio`, `pintarFolioNuevo`. `folioVis(p)` muestra `PRY-AAAA-NNNN-XXX` en todas las listas; `p.folio` (interno) es lo que se manda.
Arranque y sincronización (§6.14): `aplicarPermisos`, `leerRolesGuardados`/`guardarRoles` (localStorage `cotizadorHelgenRoles:<correo>`),
`rolesDeUltimaSesion` (evento `sesion-lista` de la capa de sesión), `recibirBootstrap`, `CARGADO` (qué listas llegaron), `VERS`,
`sincronizarAhora`, `contextoSync`, `aplicarSync`, `iniciarSincronizacion` (`setInterval` 20 s si `document.visibilityState` es
visible, `visibilitychange`, foco en los buscadores `proyecto`/`resProyecto`/`cobProyecto`/`comProyecto`/`reqProyecto`),
`sinInterrumpir`/`listoVista` (si hay captura en `cobVistaProyecto`, `comVistaReq` o `comModOrdenes`, aviso "Otra persona cambió…
Actualizar" en vez de repintar), `recibirProyectosReq/Com/Cob`, `COM_FILTRO`. `verTab(t, recienCargado)` ya no vuelve a pedir lo
que trajo el bootstrap. La capa de sesión expone `window.sesionVigente()` y `window.correoSesion()`.
Autocompletado con `<datalist>`: clientes (en "Nombre"), proyectos activos (`PRY-…-XXX — cliente — nombre`), productos por
descripción y por clave, unidades SAT.
Capa de sesión y `fetch` en `<script id="api-web">` (§10.2).

### 4.8 CAPRI — incremento 4 (`Code.js` §1.2 y §6; interfaz `<script id="mod-…">`)
Detalle completo, por módulo, en `docs/incremento-4.md` (contrato entre módulos) y `docs/incremento-4-<módulo>.md`.
- **Módulos.** `MODULOS_ = [modIdentidad_(), modAnular_(), modCorreos_(), modCentroMando_(), modPantallas_()]`; cada uno devuelve
  `{nombre, api, cambios, solo, publicas, bootstrap, sincronizar, preparar}` y `deModulos_` los suma a `API_FUNCIONES`, `CAMBIOS_API`,
  `FUNCIONES_SOLO_REQUISICION` y `FUNCIONES_PUBLICAS`. **Una función nueva de un módulo se declara en su `mod*_()`, no en las listas.**
  En la interfaz: `registrarModulo({nombre, alBootstrap, alSincronizar, contexto, alPermisos, alVerTab})` y `avisarModulos(evento, x)`.
- **Roles (base, §1.2).** `ROLES_CAPRI` = ventas, requisicion, solo_requisicion, aprobaciones (antes `ROL_OPERACIONES`), compras,
  cobranza, desbloqueo, superadmin. `rolesEfectivos(correo, ctx)` (pura: propios + delegados vigentes), `tieneRol_`, `esSuperAdmin_`,
  `exigirSuperAdmin_`, `correosConRol_(rol)` (a quién avisar: rol en su fila o por delegación; el super admin **no** entra solo por
  serlo), `excepcionSuperAdmin_(regla, folio, motivo)` (motivo ≥ 10, a la Bitacora de Administración). `doPost`: públicas sin
  sesión → `verificarSesion_` (Google o sesión CAPRI `capri.…`) → `exigirAcceso_` (desactivada o sin alta = `codigo: 'ACCESO'`) →
  solo requisiciones → `FUNCIONES_VENTAS` exige ventas. Una @helgen.tech sin fila en Permisos conserva ventas
  (`PERMISOS_SOLO_LISTADOS = '1'` lo quita). `prepararCapri()` (editor): libro de Administración, `SUPER_ADMIN`, migra roles de
  Script Properties a Permisos y corre `preparar()` de cada módulo (secreto de sesión, correo de prueba, sitios con código,
  `PortalPendientes`, activador).
- **A · Identidad.** `listarUsuarios`, `guardarUsuario` (raíz protegido; nadie se desactiva ni se quita super admin a sí mismo),
  `listarDelegaciones`, `crearDelegacion`, `cancelarDelegacion` (`DEL-AAAA-NNNN`, ≤ 90 días, solo roles propios delegables, la
  puede cancelar quien la recibe). Públicas `solicitarCodigo` / `verificarCodigo` (6 dígitos, 10 min, un uso; 5 pedidos por hora;
  5 fallos = bloqueo 15 min) → sesión `capri.<datos>.<firma HMAC con SESION_SECRETO>` de 30 días, renovada en bootstrap/sincronizar
  (`sesionCapri`). `aprobarRequisicion` y `autorizarPropuesta` aceptan `motivoExcepcion` (super admin que aprueba lo suyo).
- **B · Correos y proveedores.** `notificar_(tipo, datos)` forma el aviso; `doPost` (o el activador) llama
  `enviarCorreosPendientes_()` al terminar bien; `EVENTOS_CORREO`, `destinatariosAviso` (pura), `infoDeAviso_`, `contenidoAviso`
  (nunca montos, proveedores ni folio de orden; `limpiarTextoAviso`), bitácora en la pestaña `Correos`. Para el proveedor:
  `solicitudCotizacion(reqFolio, opciones)` (PDF sin precios ni cliente + liga `mailto:`) y `pdfOrdenCompra(folioOc)`.
  `listarCorreos(filtro)` solo super admin.
- **C · Centro de mando.** `avisarPortal_(tipo, folioOc)` forma el aviso (oc.autorizada, oc.pagada, oc.en_camino, oc.cancelada,
  req.cerrada; `evento_id` = `<OC>:<tipo>:<n>`) en `PortalPendientes` dentro del candado; `conAvisoPortal_(resultado)` lo manda al
  soltarlo (si falla: "Guardado. El centro de mando se actualizará en unos minutos."). `proyectoLigado_(folio)` (única revisión;
  exige `PORTAL_URL` + `PORTAL_SECRETO` + `PORTAL_PROYECTOS`). `marcarEnCamino` (envío o "Lo recogí"), `misArticulos` (lo que ya
  pidió, más usado primero), `itemsInventario` (caché 6 h), `traerRecepcionesPortal` (cierra completas, anota parciales, ignora
  cerradas/canceladas/anuladas; copia a `MovimientosInventario` solo la diferencia), `estadoCentroMando` / `consultarCentroMando`,
  `cadaQuinceMinutos` (activador: reintenta avisos, trae recepciones, calienta caché y manda correos), `probarCentroMando()` (editor).
  En proyectos ligados el sitio con código es obligatorio y quien pide ya no registra la recepción en CAPRI (compras sí, como
  respaldo con motivo, que no llega al inventario del sitio).
- **D · Pantallas.** Nombre CAPRI, navegación por grupos (Pendientes, Ventas, Compras, Cobranza, Administración + liga a
  Inventario), contadores, menú de teléfono (≤ 640 px). `pendientes(todos)` (`itemsPendientes`, `conteosPendientes` puras); la
  carga abre **Pendientes**. Ligas `#req=REQ-…` y `#pend`.
- **E · Anular.** `previsualizarAnulacion(folio)`, `anular(folio, motivo, idSolicitud)` (super admin; cascada completa; estado
  `Anulada`; archivos renombrados "ANULADO — …"; avisos a los involucrados y `oc.cancelada` al centro de mando), `listarAnulados`.
  `esAnulado_` / `foliosAnulados_` / `ocVigente`: listas, totales y pendientes saltan lo anulado; `buscarReq_` y `buscarOrden_`
  lo rechazan (tercer parámetro `conAnuladas` solo para avisar la cancelación). Contratos: `CONTRATO PRY-AAAA-NNNN`.

### 4.9 CAPRI — incremento 5 (`Code.js` §6.F y §6.H; interfaz `mod-proveedores`, `mod-recepcion`)
Contrato entre módulos y con el centro de mando: `docs/incremento-5.md`; detalle: `docs/incremento-5-proveedores.md` y
`docs/incremento-5-recepcion.md`.
- **F · Proveedores y forma de pago.** `FORMAS_PAGO_OC`, columna `forma_pago` de la orden (obligatoria; las viejas se leen con
  `formaPagoDeOrden`), `recibeAntesDePagar_(orden)` (crédito del proveedor: se recibe con la orden sin pagar → Recibida; el pago la
  cierra), `METODOS_PAGO` (5; cobranza usa `METODOS_COBRO`), referencias con forma de número de tarjeta rechazadas (`pareceNumeroTarjeta`: una regla para todo método; 13–19 dígitos sin
  cortes o agrupados como tarjeta, que empiezan con 3–6 y pasan Luhn; nunca una CLABE válida ni 20 dígitos o más).
  `listarProveedores`, `getProveedor`, `guardarProveedor` (CLABE con dígito verificador; cambio bancario exige carátula nueva, va a
  la bitácora y manda `proveedor.banco` a compras), `subirDocumentoProveedor`; `avisoProveedor` al emitir orden o propuesta;
  `exigirDocumentosParaPagar_` + `documentosParaPagar(rfc, metodo)` (pura): solo **Transferencia** exige carátula y, si el RFC es
  nacional, CSF; super admin con motivo.
- **H · Recepción con fotos y devoluciones.** Foto obligatoria por renglón en `registrarRecepcion`, `cerrarRequisicion(folio, notas,
  d)`, `marcarEnCamino` (Lo recogí); compras sin foto obligatoria en su respaldo. `reportarProblema`, `listarDevoluciones`,
  `resolverDevolucion` (Reponer · Devolver al proveedor · Cancelar renglón · Conservar); transiciones `recibirRetenida`,
  `pagarRetenida`, `cerrarRetenida`, `devolucion*`: con una devolución abierta la requisición se queda Recibida. Cancelar o anular
  una recepción de una Recibida la regresa con `accionCancelarRecepcion(orden)` (En camino · Pagada si la orden ya está pagada,
  `cancelarRecepcionPagada` · Autorizada). Anular una orden o requisición anula también sus devoluciones (tipo "Devolución" en
  Anulaciones); `devolucionAbiertaDe_(libro, req)` solo mira la orden vigente; una recepción con devoluciones no se anula sola. Centro de mando:
  `traerRecepcionesPortal` baja las fotos (fuera del candado), las guarda en Drive y avisa `foto-archivada`; un problema del sitio crea
  una DEV (`origen_clave`); al resolver, aviso `oc.devolucion`. Correos `dev.reportada`, `dev.resuelta`, `req.pagada`.

## 5. Dónde se guardan los datos

**Todo en la carpeta maestra "Cotizador Helgen"** de Mi unidad:
```
📁 Cotizador Helgen
   ├─ 📊 Cotizador Helgen — Base de datos     (Cotizaciones, Config)
   ├─ 📊 Catálogo Helgen                       (Catalogo)
   ├─ 📁 Cotizaciones Helgen (PDF) / 📁 2026 / HLG-2026-0001 - Cliente.pdf      (cotizaciones "Sin proyecto")
   ├─ 📁 Proyectos / 📁 2026 / 📁 PRY-2026-0001 — Cliente — Nombre / Cotizaciones
   │                (los creados antes de Compras tienen además "Órdenes de compra", vacía, y antes de Cobranza "Pagos", vacía)
   ├─ 📁 Catálogos SAT / SAT_c_ClaveProdServ.csv, SAT_c_ClaveUnidad.csv, 📊 Catálogos SAT (CFDI 4.0)
   ├─ 📁 Respaldos 2026-10-19                  (copias antes de la migración)
   └─ 📜 Cotizador Helgen (código de la app)   ← proyecto ANTERIOR, en desuso
```
**Aparte, fuera de "Cotizador Helgen"** (todo el dominio puede leer la carpeta maestra; esta no):
```
📁 Cotizador Helgen — Cobranza                (COBRANZA_FOLDER_ID; lectores tania@ y leo@)
   ├─ 📊 Cotizador Helgen — Cobranza (datos)  (COBRANZA_DB_ID: Contratos, Esquemas, Pagos, Bitacora)
   └─ 📁 2026 / 📁 PRY-2026-0002 / PAG-2026-0001 — Transferencia SPEI 123.pdf
📁 Cotizador Helgen — Compras                 (COMPRAS_FOLDER_ID; se comparte por persona con quien deba abrir los PDF)
   ├─ 📊 Cotizador Helgen — Compras (datos)   (COMPRAS_DB_ID: OrdenesCompra, Proveedores, Bitacora)
   └─ 📁 2026 / 📁 PRY-2026-0003 / OC-2026-0001 — Proveedor.pdf
```
El proyecto de la API (`1GsH8Dja…`) está en la carpeta `1w-T05ql62SXxsm3z4u-xCpMjcdXc0b0p` (antes "PRUEBAS — Cotizador web"),
junto con los archivos de prueba que ya no se usan (§9).

**Pestaña `Cotizaciones`** (22 columnas, 1 fila por cotización): Folio, Fecha, Cliente, Empresa, RFC, Correo, Teléfono,
Subtotal, IVA, Total, Elaboró, PDF (link), Conceptos (JSON: clave, descripcion, unidad, cantidad, precio, importe y, si vienen
del catálogo, claveSat/unidadSat), Notas, Marca (Helgen / Helgen Energy), Dirección, `vendedor_email`, `vendedor_nombre`,
`vendedor_apellido`, `proyecto_folio` (T; vacío = "Sin proyecto"), `moneda` (U: MXN o USD; vacía en filas viejas = MXN), `tipo_cambio` (V: pesos por dólar con que la interfaz convirtió los
precios del catálogo, 4 decimales; solo en USD; vacío en MXN, en filas viejas o si los precios se capturaron sin tipo de cambio). Las columnas P:S se agregaron el 19/10/2026 (§11); las
filas 0001–0004 no las tienen llenas. La T se agregó con Proyectos (10/2026): las filas anteriores quedan vacías y no se mueven.
`guardarCotizacion` reescribe la fila de encabezados si no coincide con `ENCABEZADOS_COTIZACIONES`.

**Registros de prueba en la hoja real (excluir de reportes y totales; identificarlos por folio, no por texto):**
- `HLG-2026-0005` — cliente "PRUEBA - CANCELADA" (prueba de la migración, 19/10/2026).
- `HLG-2026-0006` — prueba del primer proyecto (20/10/2026). Cliente original "Angel Sosa"; cambiado a "PRUEBA - CANCELADA"
  (guion corto, igual que la 0005) en `Cotizaciones!C7` el 20/10/2026.
- `PRY-2026-0001` — "Proyecto de Prueba oficial" (20/10/2026); marcado `Cancelado` en `Proyectos!G2` el 20/10/2026. Su carpeta en
  `Proyectos/2026` es de prueba.
- Las filas HLG-2026-0001 a 0004 son anteriores a la sesión con Google y también parecen pruebas, pero no se marcaron.

**Pestaña `Config`** (Clave | Valor, columna B en formato texto): `EMPRESA_NOMBRE` (Helgen Servicios Especializados),
`EMPRESA_RFC` (HSE240304PC1), `EMPRESA_DIRECCION`, `EMPRESA_TELEFONO` (+52 442 644 5391), `EMPRESA_EMAIL`, `EMPRESA_WEB`,
`PREFIJO_FOLIO` (HLG), `IVA_TASA` (0.16), `VIGENCIA_DIAS` (15), `MONEDA`, `LOGO_FILE_ID` (vacío = logo de `Logo.js`),
`TERMINOS_HELGEN`, `TERMINOS_ENERGY`, `TERMINOS_OC` (pie de las órdenes de compra; se agrega sola) (un término por renglón
dentro de la celda).

**Pestaña `Proyectos`** (1 fila por proyecto): Folio (`PRY-AAAA-NNNN`: la llave interna), Fecha, Nombre, Cliente ("nombre — empresa"),
`cliente_id` (ver `idCliente`), Ubicación, Estado (Activo/Cerrado/Cancelado; **se cambia con la lista desplegable en la hoja**,
no hay pantalla), `carpeta_id`, `vendedor_email`, `vendedor_nombre`, `vendedor_apellido`, `clave` (L, desde el 23/10/2026: 3 letras;
se muestra como `PRY-AAAA-NNNN-XXX`; ya asignada a todos los proyectos el 23/10/2026; no cambia).

**"Catálogo Helgen" / pestaña `Catalogo`**: Clave (única, mayúsculas), Descripción, Unidad, Precio unitario (sin IVA, MXN),
Actualizado, Actualizó, Clave SAT, Unidad SAT, Precio USD (sin IVA, automático; columna I con fórmula, no escribir ahí).
A:C y G:H en formato texto. Pestaña **`Tipo de cambio`**: B2 Google Finance, B3 manual opcional (si tiene valor, manda), B4 en
uso (`TIPO_CAMBIO`). Se crean solas (§6.2).

**Libro de cobranza** (`COBRANZA_DB_ID`; columnas en `HOJAS_COBRANZA`; texto salvo importes):
- `Contratos` (1 fila por proyecto): `proyecto_folio`, `cotizacion_aceptada`, `marca`, `moneda`, `subtotal`, `iva`, `total`
  (= monto contratado, con IVA), `estado` (Aceptada / Firmado), `aceptada_por`, `fecha_aceptacion`, `fecha_firma`, `firmado_por`, `actualizado`.
- `Esquemas`: `proyecto_folio`, `orden`, `etapa`, `porcentaje`, `monto` (se reescriben las filas del proyecto al cambiar).
- `Pagos`: `folio` PAG, `fecha_pago` (AAAA-MM-DD), `fecha_registro`, `proyecto_folio`, `monto`, `moneda_pago`, `tipo_cambio`,
  `monto_aplicado` (en la moneda del proyecto), `moneda_proyecto`, `metodo`, `referencia`, `etapa_orden`, `etapa`,
  `aplicacion (JSON)` (reparto por etapa al registrar), `comprobante_id`, `comprobante_url`, `registro_email`, `registro_nombre`,
  `estado` (Vigente / Cancelado), `cancelado_por`, `fecha_cancelacion`, `motivo_cancelacion`. Nunca se borran filas.
- `Bitacora`: `fecha`, `correo`, `accion`, `proyecto_folio`, `detalle`, `motivo` (aceptar, cambiar aceptada, editar esquema,
  firmar, desbloquear, registrar y cancelar pago).

**Libro de compras** (`COMPRAS_DB_ID`; columnas en `HOJAS_COMPRAS`; texto salvo importes):
- `OrdenesCompra` (1 fila por orden; nunca se borran): `folio` OC, `fecha` (AAAA-MM-DD), `proyecto_folio`, `marca` (línea de
  negocio del contrato al emitir; no cambia después), `proveedor_id`, `proveedor`, `rfc`, `contacto`, `correo`, `telefono`,
  `fecha_entrega`, `lugar_entrega`, `condiciones_pago`, `moneda`, `iva_tasa`, `subtotal`, `iva`, `total`, `moneda_proyecto`,
  `tipo_cambio` (solo si la moneda es otra), `subtotal_proyecto` (sin IVA, en la moneda del proyecto: lo usa el margen),
  `renglones (JSON)` (clave, descripcion, unidad, cantidad, costo, importe), `notas`, `pdf_id`, `pdf_url`, `elaboro_email`,
  `elaboro_nombre`, `fecha_registro`, `estado` (Emitida / Pagada / Recibida / Cancelada), `fecha_recepcion`, `recibio`, `cancelado_por`,
  `fecha_cancelacion`, `motivo_cancelacion`, `req_folio` (AI; desde el 23/10/2026; vacío en órdenes anteriores).
- `Proveedores`: `id` (RFC o `SIN-RFC:razón social`), `razon_social`, `rfc`, `contacto`, `correo`, `telefono`, `actualizado`.
- `Requisiciones` (1 fila por requisición; nunca se borran): `folio` REQ, `fecha`, `proyecto_folio`, `solicitante_email`,
  `solicitante_nombre`, `estado` (Solicitada / Autorizada / Pagada / Cerrada / Rechazada / Devuelta / Cancelada), `motivo` (el último:
  rechazo, devolución, cancelación o cierre por compras), `cotizacion_pdf_id`, `cotizacion_pdf_url` (la vigente), `oc_folio`,
  `reviso_email`, `fecha_revision`, `actualizado`, `notas_recepcion`.
- `RequisicionesRenglones` (sin costo): `req_folio`, `version` (1, 2…: al reenviar una devuelta se agrega la versión nueva; la vigente es la
  mayor), `renglon`, `descripcion`, `cantidad`, `unidad`, `notas`.
- `RequisicionesEventos` (historial que ve el solicitante; sin montos): `req_folio`, `fecha`, `estado`, `correo`, `nombre`, `nota`.
- `PagosProveedores` (nunca se borran): `folio` PGP, `fecha_pago`, `fecha_registro`, `oc_folio`, `req_folio`, `proyecto_folio`, `monto`,
  `moneda_pago`, `tipo_cambio`, `monto_aplicado` (en la moneda de la orden), `moneda_oc`, `metodo`, `referencia`, `comprobante_id`,
  `comprobante_url`, `registro_email`, `registro_nombre`, `estado` (Vigente / Cancelado), `cancelado_por`, `fecha_cancelacion`,
  `motivo_cancelacion`.
- `Bitacora`: mismas columnas que la de cobranza (emitir y cancelar orden; solicitar, reenviar, devolver, rechazar, cancelar,
  autorizar y cerrar requisición; registrar y cancelar pago a proveedor).
- Archivos de requisiciones: `Compras/AAAA/<folio del proyecto>/Requisiciones/REQ-AAAA-NNNN — Cotización.<ext>` y
  `… — Comprobante pago.<ext>` (con " (2)", " (3)"… si hay otro; la extensión es la real: pdf, jpg, png o heic).

**Script Properties** del proyecto `1GsH8Dja…` (Configuración del proyecto en el editor):
`SPREADSHEET_ID`, `FOLDER_ID`, `CATALOGO_ID`, `SAT_ID`, `CONSECUTIVO_AAAA` (p. ej. `CONSECUTIVO_2026`),
`PROYECTOS_FOLDER_ID` y `CONSECUTIVO_PROY_AAAA` (se crean solos con el primer proyecto),
`ANTHROPIC_API_KEY` (opcional; activa la IA para claves SAT; el proyecto anterior no la tenía). Nunca poner la API key en el código.
Cobranza: `ROL_COBRANZA` (correos separados por coma: efrain@, tania@, leo@), `ADMIN_DESBLOQUEO` (efrain@), `COBRANZA_FOLDER_ID` y
`COBRANZA_DB_ID` (se crean solos), `CONSECUTIVO_PAG_AAAA`. **Sin `ROL_COBRANZA` nadie tiene cobranza** (se niega por omisión).
Compras: `ROL_COMPRAS` (correos separados por coma: efrain@, tania@, leo@; creada el 21/10/2026), `COMPRAS_FOLDER_ID` y
`COMPRAS_DB_ID` (se crean solos), `CONSECUTIVO_OC_AAAA`. **Sin `ROL_COMPRAS` nadie tiene compras.**
Requisiciones (23/10/2026): `ROL_REQUISICION` (efrain@, tania@, leo@: piden materiales y usan el resto del cotizador),
`SOLO_REQUISICION` (adriana@, miguel@, paola@, jesus@ y, desde el 28/10/2026, alan@ (Alan Basurto) y daniel@ (Daniel Martinez): **solo** la pestaña Requisiciones; ya incluye el permiso de pedir y manda
sobre cualquier otro rol), `CONSECUTIVO_REQ_AAAA`, `CONSECUTIVO_PGP_AAAA`. Las cuentas de `SOLO_REQUISICION` también deben estar
en los usuarios de prueba de OAuth (§10.1; agregadas por el usuario el 23/10/2026; alan@ y daniel@ el 28/10/2026).
**Dar de alta a alguien en un rol no requiere correr código ni publicar:** basta con agregar el correo a la propiedad (separados
por coma, nombre exacto sin acento: `SOLO_REQUISICION`, no `SOLO_REQUISICIÓN`) y a los usuarios de prueba de OAuth. El servidor
relee las propiedades en cada llamada (comprobado el 28/10/2026 al agregar a alan@ y daniel@).
Versiones (23/10/2026, §6.14): `VER_proyectos`, `VER_contratos`, `VER_cotizaciones`, `VER_catalogo`, `VER_requisiciones`, `VER_oc`,
`VER_pagosCobranza`, `VER_pagosProveedores` (se crean y suben solas; no editarlas: si se borran, solo se recalcula el caché).
**Un cambio de rol (`ROL_*`, `SOLO_REQUISICION`) se aplica sin recargar la página** en la siguiente consulta (≤ 20 s).

**CAPRI (incremento 4; aún sin publicar).** Libro privado **"CAPRI — Administración"** (`ADMIN_DB_ID`, carpeta `ADMIN_FOLDER_ID`;
lo crea `prepararCapri()`, restringido como los de cobranza y compras) con `Permisos` (correo, nombre, roles, activo, sitio…;
**desde que existe, los roles salen de aquí y ya no de las propiedades `ROL_*`**), `Delegaciones`, `Correos` (cada aviso enviado
o fallido), `Anulaciones` (una fila por registro anulado, con su copia en JSON) y `Bitacora`. En el libro de compras: pestaña
`PortalPendientes` (avisos al centro de mando: Pendiente / Enviado), columnas `paqueteria`, `guia`, `fecha_estimada`,
`en_camino_en`, `en_camino_por` en `OrdenesCompra`, `inventario_item` en `RequisicionesRenglones` y estado de requisición
`En camino`; estado `Anulada` en las hojas que lo admiten. Config `SITIOS`: `VER | Veracruz (ICAVE) | dirección` (el formato
viejo, solo nombres, sigue sirviendo; `preparar()` lo convierte). Script Properties nuevas: `SUPER_ADMIN` (leo@), `ADMIN_DB_ID`,
`ADMIN_FOLDER_ID`, `SESION_SECRETO` (lo crea `prepararCapri`; cambiarlo cierra todas las sesiones @helgen.services),
`PERMISOS_SOLO_LISTADOS` (opcional), `PORTAL_URL`, `PORTAL_SECRETO` (= `COTIZADOR_SECRETO` del centro de mando; **nunca** en el
código ni en el chat), `PORTAL_PROYECTOS` (`{"PRY-2026-0002": "drogheda"}`), `PORTAL_PRUEBA` (`1` = avisos de prueba) y las que
escribe CAPRI (`PORTAL_ULTIMA_CONSULTA`, `PORTAL_ULTIMO_OK`, `PORTAL_ERROR_CONSULTA`, `PORTAL_ALERTA` (material que llegó a una
orden cancelada o anulada), `VER_permisos`, `VER_anulaciones`, `SESION_DESDE_<huella>` (sesiones de CAPRI cerradas)).
Sin `PORTAL_SECRETO` el enlace está apagado y todo funciona como antes.

**Incremento 5 (libro de compras; columnas y pestañas se crean solas, por nombre).** `OrdenesCompra.forma_pago` (AP);
`Proveedores` I:Z (`direccion`, `banco`, `clabe` y `cuenta` con apóstrofo, `titular`, `forma_pago_habitual`, `csf_*`,
`caratula_*`, `domicilio_*` (id, url, fecha), `notas`, `activo`, `actualizo`; `dias_credito` H sigue siendo los días habituales);
`MovimientosInventario.foto_id`/`foto_url` (W:X) y tipos nuevos (`Devolución`, `Devolución sin reponer`, `Faltante aceptado`,
`Recogido en tienda`; "Recibí el material" y el cierre de compras ahora dejan `Entrada por compra`); pestaña **`Devoluciones`**
(`DEV-AAAA-NNNN`, `CONSECUTIVO_DEV_AAAA`, con `origen_clave`). Drive: `Compras/Proveedores/<RFC> — <razón social>/` y
`Compras/AAAA/<proyecto>/Recepciones/` (fotos `REC-… — r<n>.jpg`, `DEV-… — r<n>.jpg`), todo con `privado_`.

## 6. Decisiones tomadas (y por qué)

### 6.1 Folios sin duplicados
- Todo el guardado va dentro de `LockService.getScriptLock()` con `tryLock(30000)` y mensaje en español si se agota.
- El folio sale del **mayor** entre el contador y el último folio de la hoja: si alguien borra o edita `CONSECUTIVO_AAAA`, no se repite.
- **Idempotencia:** el formulario manda `idSolicitud` (UUID por cotización, se renueva al limpiar); un doble clic o reenvío devuelve el mismo folio.
- Borrar una fila no hace retroceder el contador (intencional). El consecutivo reinicia cada año.
- **El candado es por proyecto:** nunca dejar dos proyectos de Apps Script guardando en la misma hoja (por eso el anterior
  lanza error al guardar; §11).

### 6.2 Instalación y migraciones automáticas
- La app se instala sola (`db_()` → `setup()`, `hojaCatalogo_()` → `crearCatalogo_()`, `libroSat_()` → `importarCatalogosSat_()`),
  porque correr `setup()` a mano falló la primera vez.
- Toda estructura nueva se migra sola (Config, columnas del catálogo, encabezados de Cotizaciones).
  Al agregar columnas o claves, seguir este patrón: **nunca pedir al usuario que edite la hoja a mano**.
- **Sheets convierte texto que parece fecha** ("2026-10-20", "2026-10-20 17:30") en un valor de fecha con `appendRow`/`setValues`,
  **aunque la columna tenga formato de texto**; al leerlo, `getValues` da un `Date` y `String(Date)` sale como
  "Tue Oct 20 2026 00:00:00 GMT-0600…" (pasó en la prueba de Cobranza, 20/10/2026). Fechas sin hora que deben quedar exactas:
  escribirlas con apóstrofo (`textoFecha_`) y leerlas con `fechaIso_`/`fechaTexto_`, que aceptan `Date` o texto. Las simulaciones
  de `tests/cobranza.test.js` (`comoSheets`) reproducen esa conversión.

### 6.3 PDF (lecciones del conversor HTML→PDF de Google)
- **No imprime colores de fondo** (`background`): con la banda azul, el logo blanco y el texto blanco desaparecieron.
  Por eso el PDF usa texto azul, líneas y bordes; `bgcolor` solo como extra opcional.
- No soporta flex/grid: solo tablas e inline CSS. Fuente del PDF: Arial (las web fonts no son confiables ahí).
- Logo azul en el PDF; el blanco solo sobre fondo azul.
- No hay forma local de ver el PDF real: para revisar, renderizar el HTML **quitando los fondos** (simula al conversor).

### 6.4 Interfaz
- Fuentes de Google (League Spartan, Roboto Mono) sí funcionan.
- Máximo 3 módulos por vista. Mensajes de error en español.
- (Solo aplicaba a `Index.html` con HtmlService: imágenes `data:` con `<?!= ?>`, porque `<?= ?>` las bloquea.)

### 6.5 Catálogo y SAT
- El catálogo es un **archivo aparte** para poder compartirlo con quien mantiene precios sin exponer el historial.
- La **clave SAT no reemplaza la clave interna**: muchas claves internas comparten una clave SAT. Es dato interno de
  contabilidad: **no sale en el PDF**; se valida contra el catálogo vigente y viaja en el JSON de conceptos.
- Catálogo SAT: `catCFDI_V_4_20261015.xls` del Anexo 20 (`http://omawww.sat.gob.mx/tramitesyservicios/Paginas/anexo_20.htm`;
  el sitio rechaza HTTPS desde aquí, usar HTTP con `curl`). 52,513 claves de producto/servicio y 2,418 unidades vigentes.
- **Actualizar el catálogo SAT:** descargar el `.xls` nuevo, correr
  `node herramientas/extraer-catalogos-sat.js <archivo.xls> <carpeta-salida>` (requiere `npm i xlsx@0.18.5` en una carpeta
  temporal), reemplazar los CSV en la subcarpeta "Catálogos SAT", **borrar la propiedad `SAT_ID`** y abrir la pestaña Catálogo.
- La búsqueda por palabras funciona bien para productos (panel solar → 26111607 / 32111701 / 60104702; inversor → 32121705;
  cargador VE → 25175002) y mal para servicios genéricos; para eso existe la IA opcional. Ampliar `SINONIMOS_SAT` si una búsqueda falla.
- **No inventar claves SAT de memoria:** una vez se afirmó que 26111604 era "Paneles solares" y es "Generadores a gas".
  Verificar siempre contra el CSV/hoja. Contabilidad debe validar toda clave sugerida.

### 6.6 Clientes sugeridos
- No hay lista de clientes aparte: se calcula cada vez desde `Cotizaciones`. Si se borran sus filas, el cliente deja de sugerirse (lo pidió el usuario).

### 6.7 Drive
- La app usa **IDs, no rutas**: se pueden mover o renombrar archivos. Rompe: copiar-y-borrar (cambia el ID), borrar, renombrar
  las pestañas `Cotizaciones`/`Config`, sacar o renombrar las subcarpetas de año, perder acceso de edición de efrain@helgen.tech.
- La carpeta local `~/Downloads` se sincroniza a Drive en una carpeta "Downloads" (`1BBB4vyr9WW1TowC6Uemtd3K6V7_NitAh`).
  Por eso el proyecto se sacó de ahí a `~/Proyectos/cotizador-helgen` (§3). No volver a guardar el proyecto en `~/Downloads`.
- Google Drive para escritorio está montado en `~/Library/CloudStorage/GoogleDrive-efrain@helgen.tech/Mi unidad/`:
  sirve para dejar archivos en Drive (así se subieron los CSV del SAT).

### 6.8 clasp
- clasp está instalado **local** en el proyecto (instalar global pedía permisos de administrador): usar siempre `npx clasp`.
- **No volver a correr `clasp create`**: crea otro proyecto y sobrescribe `appsscript.json` (pone zona de Nueva York y
  quita la configuración de web app). Ya pasó y hubo que borrar un proyecto duplicado.
- Publicar siempre sobre el mismo deployment (misma `API_URL`). Nunca `clasp deploy` sin `--deploymentId`.
- Si se agrega un servicio nuevo de Google, el dueño debe autorizar el permiso una vez desde el editor (`UrlFetchApp` ya está autorizado).
- **Si un cambio requiere un permiso nuevo de Google: 1) `clasp push`, 2) autorizar ejecutando una función desde el editor,
  3) `clasp deploy`. Nunca deploy antes de autorizar** (la web app corre como el dueño: sin el permiso, fallan todas las llamadas).

### 6.9 Proyectos
- **Opcionales al cotizar** ("Sin proyecto" por omisión). Solo se pueden elegir proyectos `Activo`; el servidor lo vuelve a revisar.
- **No hay hoja de clientes**: el cliente del proyecto es el de "Datos del cliente" (mismo datalist y autorrelleno; uno nuevo se
  escribe ahí, como siempre). Se guarda como texto + `cliente_id` (RFC o `SIN-RFC:nombre|empresa`, ver `idCliente`). Si después
  se le agrega RFC al cliente, su `id` cambia a ese RFC y los proyectos viejos conservan el `SIN-RFC:…`.
- Folio propio con contador `CONSECUTIVO_PROY_AAAA` bajo el **mismo** candado de script que las cotizaciones.
- **Subcarpetas que se reparan solas:** las subcarpetas de un proyecto se buscan **por nombre**. Si alguien borra (Papelera) o
  renombra `Cotizaciones`, la próxima vez que se necesite el sistema **crea una nueva** con el
  nombre correcto (la renombrada se queda como está, con sus archivos). Si se borra la carpeta completa del proyecto, se
  vuelve a crear (con sus subcarpetas) y se actualiza `carpeta_id` en la hoja. Igual con `Proyectos` y su carpeta de año.
  Renombrar la carpeta **del proyecto** sí se puede (se usa por ID).
- Las cotizaciones viejas no se mueven ni se ligan a proyectos.
- Desde Compras, `SUBCARPETAS_PROYECTO` = solo `Cotizaciones` (sin `Pagos` desde Cobranza ni `Órdenes de compra` desde Compras;
  solo para proyectos nuevos: los viejos conservan las suyas, vacías; **no se borran** a escondidas — si el usuario lo pide, revisar
  antes que estén vacías). Un proyecto con contrato firmado **no admite cotizaciones nuevas** y sale del buscador de
  cotizaciones (se revisará con los adicionales).
- **Clave de proyecto** (23/10/2026, decisión A del usuario): folio visible `PRY-AAAA-NNNN-XXX` (ej. `PRY-2026-0002-DRO`), pero la
  **llave interna sigue siendo `PRY-AAAA-NNNN`** en `proyecto_folio` de Cotizaciones, Cobranza y Compras (nada se migró). Regla:
  nombre en mayúsculas sin acentos (Ñ → N), sin números ni símbolos y sin DE, DEL, LA, LAS, EL, LOS, Y, EN, PARA; 1 palabra = sus 3
  primeras letras (DROGHEDA → DRO); 2 = 2 letras de la primera + inicial de la segunda (Casa del Lago → CAL); 3 o más = iniciales
  de las tres primeras (Planta de Agua Norte → PAN); se completa con X (Y → XXX, Yo → YOX). Se sugiere al crear y se puede editar
  (exactamente 3 letras A–Z, validado en el servidor); después no cambia. Puede repetirse entre proyectos (el número los distingue).
- Al crear, la carpeta del proyecto se llama "PRY-AAAA-NNNN-XXX — Cliente — Nombre". Las carpetas privadas de Cobranza y Compras
  (`Cobranza/AAAA/PRY-AAAA-NNNN`, `Compras/AAAA/PRY-AAAA-NNNN`) **se quedan con el folio corto**: se buscan por nombre y renombrarlas
  haría que el sistema creara otras.

### 6.10 Modelo futuro (fase 4 y después; NO construido)
- Gastos, nómina y horas por proyecto: folio (`GAS-AAAA-NNNN`), contador `CONSECUTIVO_<TIPO>_AAAA`, columna **`proyecto_folio`**.
  Antes de elegir dónde van, decidir quién debe verlos: la Base de datos la lee todo el dominio (§6.11).
- **Margen preparado:** `margenDeContrato_` arma una lista `costos` (`{concepto, moneda, monto, cantidad}`) que pasa a
  `margenProyecto`; nómina y horas se agregan como otros elementos de esa lista, siempre en la moneda del contrato.
- **Adicionales después de firmar** (propuesta aprobada para después): función de adicionales **dentro del mismo proyecto**:
  una cotización del proyecto se marca "Adicional", con su propio mini-esquema (por omisión 100% en una etapa), misma moneda que
  el proyecto, y se suma al contratado como línea aparte sin tocar el contrato original. Al construirla, revisar la regla de
  "contrato firmado no admite cotizaciones nuevas".

### 6.11 Cobranza (construida 10/2026)
- **Datos en un libro aparte** dentro de la carpeta "Cotizador Helgen — Cobranza", fuera de la carpeta maestra: la Base de
  datos y la carpeta maestra están compartidas como **lector con todo el dominio helgen.tech** (revisado el 20/10/2026), así
  que una pestaña Pagos ahí la vería cualquier vendedor. **Nunca poner datos de cobranza en la Base de datos.**
- **Workspace comparte con todo helgen.tech lo que se crea** (pasó el 20/10/2026: la carpeta y el libro de cobranza nacieron
  con "helgen.tech: lector" aunque el código no compartía nada). Por eso todo lo de cobranza (carpeta, libro, subcarpetas de
  año y proyecto, comprobantes) pasa por `privado_()`, que lo deja en "Restringido" y conserva a las personas agregadas una por
  una. `prepararCobranza()` repara carpeta y libro si alguien los vuelve a compartir. Si se crean archivos en otra área privada,
  hacer lo mismo. **`DriveApp.setSharing` no sirve aquí** (da "Access denied: DriveApp." aun siendo dueño, con `Permission.NONE`
  o `VIEW`): `privado_()` borra los permisos `domain`/`anyone` con la API REST de Drive (`UrlFetchApp` + `ScriptApp.getOAuthToken()`,
  sin permisos nuevos).
- **Lo mismo pasa con lo que se crea fuera del código** (20/10/2026: la carpeta y la copia del respaldo de cobranza hechas con el
  conector de Drive nacieron con "helgen.tech: lector"; el conector no puede quitarlo, lo hizo el usuario). Después de crear
  algo en un área privada, revisar sus permisos con `get_file_permissions`. Y **dentro de una carpeta que lee el dominio**
  ("ARCHIVO PRUEBAS…", la carpeta maestra) el acceso es heredado: `privado_()` falla con 403 `cannotDeletePermission` (a propósito:
  no deja nada abierto). Por eso las áreas privadas se crean en la raíz de Mi unidad.
- **Permisos en el servidor:** `ROL_COBRANZA` (Script Properties, no en el código) para ver y cambiar todo lo de cobranza;
  `ADMIN_DESBLOQUEO` solo para desbloquear. Los demás reciben `codigo: "PERMISO"` y `getDatosIniciales` no les manda nada de
  cobranza (solo `permisos` en falso para ocultar la pestaña).
- Desde el 23/10/2026 las pestañas se dibujan al instante con los roles de la última sesión (localStorage) y se corrigen con el
  bootstrap; un cambio de `ROL_COBRANZA` se aplica sin recargar en la siguiente consulta (§6.14). Es solo interfaz: el servidor
  revisa el rol en cada llamada.
- **Aceptada:** una por proyecto; se puede cambiar hasta firmar. Monto contratado = total **con IVA**; subtotal de referencia.
  **Línea de negocio y moneda del proyecto salen de la aceptada.** Si ya hay pagos (tras un desbloqueo), la nueva aceptada debe
  tener la misma moneda.
- **Esquema:** Helgen Energy: 60% Anticipo / 30% Instalación / 10% Encendido del sistema; **solo `ADMIN_DESBLOQUEO` lo edita**,
  con motivo obligatorio que queda en la Bitacora (con el esquema anterior). Helgen: mismas etapas como sugerencia, editables por
  el rol de cobranza (nombres, % y número de etapas, 1–10). En ambos casos solo antes de firmar y con suma exacta de 100%.
- **Contrato firmado** (fecha, no futura): bloquea aceptada, monto y esquema. No se puede firmar si lo pagado supera el nuevo
  monto. **Desbloqueo:** solo `ADMIN_DESBLOQUEO`, motivo obligatorio; vuelve a "Aceptada", conserva los pagos y queda en Bitacora.
- **Pagos:** solo con contrato firmado; comprobante **obligatorio** (PDF/JPG/PNG/HEIC, máx. 10 MB, tipo revisado por contenido) en
  el mismo envío, guardado en `Cobranza/<año del folio del proyecto>/<folio del proyecto>/` con el folio PAG en el nombre.
  Referencia obligatoria salvo en efectivo. El excedente de una etapa pasa a la siguiente. Un pago que excede el saldo del
  proyecto por más de **1.00** (moneda del proyecto) se rechaza. Si la moneda del pago es otra, tipo de cambio del día
  obligatorio (pesos por dólar) y se guarda el monto aplicado en la moneda del proyecto: **nunca se suman MXN y USD**.
- **Cancelar pago:** rol de cobranza, con motivo; el pago queda como Cancelado (nunca se borra) y deja de contar.
- **Resumen de cobranza** (construido y publicado 21/10/2026; decisiones del usuario): pantalla inicial de la pestaña Cobranza, con un buscador para
  abrir cualquier proyecto (también sin aceptada). Totales por
  moneda (nunca MXN + USD): contratado con IVA, cobrado, por cobrar, avance, proyectos con saldo y margen sin IVA. Tabla por
  proyecto: contratado, cobrado, saldo, avance, siguiente etapa por cobrar, último pago, costo de órdenes y margen; firmados por
  moneda (MXN, USD) y del mayor saldo al menor (nunca se comparan saldos de monedas distintas) y luego los **"Por firmar"** (aceptada sin firmar: se muestran pero **no suman** a los totales). Los
  proyectos **Cancelados no aparecen** (no deberían tener contrato; si lo tienen, se excluyen). Filtros (búsqueda, moneda,
  línea, solo con saldo) solo para la tabla; los totales son de todos. **Descargar CSV** de la tabla filtrada (UTF-8 con BOM
  para Excel; texto que empiece con `= + - @` con apóstrofo). Solo lee: no escribe en ningún libro.
- **USD en cotizaciones:** el catálogo guarda el precio en pesos y la columna I lo convierte a dólares con el tipo de cambio del
  día (Google Finance, o el manual de la pestaña "Tipo de cambio"; **no es el FIX de Banxico**). En USD la interfaz pone el precio en
  dólares al elegir un producto; al cambiar de moneda convierte los renglones del catálogo cuyo precio no se tocó (los capturados a
  mano no se convierten y se avisa). Sin tipo de cambio válido, el precio se captura a mano. El precio se puede ajustar antes de guardar. El PDF dice "Moneda: USD (dólares estadounidenses)", columnas "P. Unitario (USD)" e
  "Importe (USD)", "TOTAL USD" e importe con letra en dólares. **Términos y condiciones: el mismo bloque que en MXN, sin cambios**
  (incluido "$300 MXN por metro" en Energy; decisión del usuario, 20/10/2026).

### 6.12 Compras: órdenes de compra (construida 20/10/2026; publicada 21/10/2026, §9)
- **Datos y PDF en un libro y carpeta aparte** ("Cotizador Helgen — Compras"), ni en la Base de datos ni en la carpeta del
  proyecto (las lee todo el dominio) ni en el libro de cobranza (`ROL_COMPRAS` y `ROL_COBRANZA` son listas distintas: quien compra
  no debe ver pagos). Todo pasa por `privado_()` de arriba abajo, como cobranza. **Nunca poner datos de compras en la Base de datos.**
- **Permisos en el servidor:** `ROL_COMPRAS` autoriza requisiciones (emite órdenes), ve, paga y cancela órdenes; los demás reciben `codigo: "PERMISO"` y
  `getDatosIniciales` solo les manda `permisos.compras` en falso. Compras **no** recibe montos del contrato ni margen (solo la moneda
  y la línea de negocio del proyecto). El **margen solo lo ve `ROL_COBRANZA`** (va en `vistaCobranza_`). Agregar a alguien a
  `ROL_COMPRAS` le da acceso en la app; para abrir los PDF también hay que compartirle la carpeta de compras en Drive (por persona).
- **Proyectos `Activo` y `Cerrado`, con o sin contrato** (decisión del usuario, 23/10/2026; antes solo `Activo` con contrato
  firmado). Los `Cancelado` no. Moneda y línea de negocio de la orden: las de la cotización aceptada (firmada o no); sin aceptada,
  **MXN y sin línea** (decisión C). Con órdenes vigentes en una moneda no se puede aceptar una cotización de otra (`marcarAceptada`).
- **Datos de la orden:** proveedor (de la lista o nuevo), fecha de entrega (obligatoria, no anterior a hoy), lugar de entrega (por
  omisión la ubicación del proyecto), condiciones de pago (obligatorias), moneda (por omisión la del proyecto), IVA 16 / 8 / 0 %
  (por omisión `IVA_TASA`), notas. Renglones del catálogo (llena clave, descripción y unidad) o a mano; **el costo siempre se
  captura: nunca se usa el precio de venta** (las listas del catálogo de Compras ni siquiera lo muestran).
- **Línea de negocio:** cada orden guarda la del contrato al emitirse (para separar reportes Helgen / Helgen Energy). El PDF
  **siempre** es de Helgen Servicios Especializados con los datos fiscales de Config, también en Energy, y lleva `TERMINOS_OC`
  (los 4 términos del usuario, 20/10/2026). El tipo de cambio y la línea de negocio no salen en el PDF. No se envía por correo.
- **Toda orden sale de una requisición autorizada** (decisión del usuario, 23/10/2026; §6.13): se quitaron el formulario de orden
  directa y el botón "Recibida". Las órdenes anteriores (sin requisición) se conservan.
- **Estados:** Emitida → Pagada (pago a proveedor) → Recibida (al cerrar su requisición, con fecha y correo de quien cierra), o
  Cancelada (con motivo, solo si está Emitida). Nunca se borran filas. No hay recepciones parciales (las notas del cierre dicen si
  faltó algo).
- **Proveedores:** pestaña propia que se llena sola al emitir (por RFC, o por razón social si no trae RFC; un dato vacío no borra
  uno anterior; si un proveedor sin RFC llega después con RFC, su fila toma el RFC).
- **Sin cotización aceptada** la vista de Cobranza muestra el costo de las órdenes vigentes por moneda y "Margen: Sin contrato"
  (`margenSinContrato_`); con aceptada sin firmar, el margen se calcula contra la aceptada (como antes). El resumen de cobranza
  sigue listando solo proyectos con aceptada.
- **Margen** = contratado sin IVA (`Contratos.subtotal`) − suma de `subtotal_proyecto` de las órdenes no canceladas (Emitidas, Pagadas y Recibidas), en
  monto y porcentaje. Una orden en otra moneda que el proyecto exige tipo de cambio al crearla y guarda su costo convertido;
  **nunca se suman MXN y USD**: con órdenes vigentes, la aceptada no puede cambiar de moneda (igual que con pagos).

### 6.13 Requisiciones de materiales y pago a proveedores (construidas y publicadas el 23/10/2026; API @10)
- **Qué es:** un trabajador pide materiales para un proyecto, **sin precios**, con la cotización del proveedor adjunta; compras la
  revisa y la autoriza capturando los montos, y eso emite la orden de compra con el flujo de siempre (folio OC, PDF, términos, margen).
- **Datos solo en el libro y la carpeta de compras** (§5); nada en la Base de datos ni en cobranza. Los archivos los sube el
  servidor: el trabajador no necesita permisos de Drive. Todo pasa por `privado_()`.
- **Permisos:** `ROL_REQUISICION` (separado de `ROL_COMPRAS` y `ROL_COBRANZA`) ve la pestaña Requisiciones y **solo sus**
  requisiciones (el servidor filtra por el correo del token). El trabajador nunca ve montos del contrato, cliente, margen, pagos ni
  órdenes: solo estados con fecha y quién. `ROL_COMPRAS` ve todas y autoriza, rechaza, devuelve, paga y puede cerrar.
- **`SOLO_REQUISICION`** (decisión D1 del usuario): cuentas que solo usan Requisiciones; el servidor les niega cotizar, historial,
  catálogo, clientes, proyectos, compras y cobranza aunque estén en otro rol (cualquier cuenta @helgen.tech de la lista de OAuth
  vería si no todo el cotizador, con clientes y totales).
- **Estados:** Solicitada → Autorizada (genera la OC) → Pagada → Cerrada; Solicitada → Rechazada (motivo, final) | Devuelta (motivo;
  el trabajador corrige renglones, puede reemplazar la cotización y reenvía: vuelve a Solicitada con el mismo folio) ; Solicitada o
  Devuelta → Cancelada (el trabajador, con motivo). Nada se borra: los renglones anteriores quedan como versión anterior y la
  cotización anterior se queda en Drive. Proyecto `Activo` o `Cerrado`, con o sin contrato, para pedir, autorizar y pagar (desde
  el 23/10/2026; antes solo Activo con contrato firmado); `Cancelado` no. **Los pagos de clientes siguen exigiendo contrato firmado.**
- **Autorizar:** vista lado a lado (renglones y la cotización). El formulario de la orden viene precargado con los renglones (las
  notas se agregan a la descripción; compras puede ajustar cantidades y renglones); proveedor con autollenado, costo por renglón,
  moneda, IVA 16/8/0, tipo de cambio si aplica, entrega y condiciones. La OC guarda `req_folio` y su PDF solo agrega "Requisición: REQ-…".
- **Cancelar la OC** de una requisición Autorizada (decisión D3): la requisición regresa a Solicitada sin orden, para autorizarla otra vez.
- **Pago a proveedor** (`PGP-AAAA-NNNN`, nunca `PAG-`; hoja `PagosProveedores`): desde la requisición o su OC (mismo registro); un pago
  por OC; comprobante obligatorio (PDF/JPG/PNG/HEIC, 10 MB, tipo por contenido); referencia opcional solo en efectivo; monto = total
  de la OC (con IVA) ± 1.00; si la moneda del pago es otra, tipo de cambio obligatorio. Requisición y OC a Pagada; una OC Pagada ya no
  se cancela. **Cancelar el pago** (motivo): requisición a Autorizada, OC a Emitida; **no se puede si ya está Cerrada** (decisión D5).
  El solicitante ve "Pagada" y la fecha; nunca el comprobante, el monto ni el motivo de un pago cancelado.
- **Cierre:** "Recibí el material" (solo el solicitante, solo si está Pagada; notas opcionales) → Cerrada y la OC Recibida con la fecha
  y el correo del trabajador. Compras puede cerrar en su lugar con motivo obligatorio.
- **Fuera de alcance por ahora:** notificaciones por correo, pagos parciales o varios pagos por orden.

### 6.14 Carga rápida y sincronización sin recargar (construida y publicada el 23/10/2026; API @11)
- **Antes:** una llamada `getDatosIniciales` de 5.1 s (servidor 3.2–3.9 s: Config 0.8–1.7, catálogo 0.9–1.4, proyectos 0.7–1.0,
  clientes 0.3) y las pestañas con rol aparecían al responder; al abrir cada pestaña, 2 llamadas más de 2.6–4.6 s.
- **Ahora (medido en PRUEBAS y en el real):** pestañas a los 0.04 s (roles de la última sesión), todo utilizable a 1.8–2.1 s con caché;
  consulta sin cambios 1.6–1.8 s (servidor 0.4–0.6 s). Con el caché vacío (nadie entró en 6 h, o justo después de publicar) el
  bootstrap tarda ~5 s (9 s la primera ejecución de una versión nueva) y las requisiciones se piden al abrir su pestaña (~4 s).
  **~1.7 s de cada llamada son el viaje fijo de Apps Script** (redirección de Google): no se pueden quitar.
- localStorage solo guarda los roles por correo (nunca datos: clientes ni montos), para dibujar pestañas; el servidor manda.
- Los cambios hechos **desde la app** se ven en los demás navegadores en ≤ 20 s; los hechos **a mano en las hojas** (Estado del
  proyecto, precios del catálogo, filas borradas) en ≤ ~5–10 min + 20 s (medido: 85 s), porque la consulta de fondo relee esas hojas
  cada pocos minutos y compara su huella. El tipo de cambio de Google Finance también cambia la huella del catálogo (se vuelve a
  mandar el catálogo; es pequeño).
- Una vista con captura en curso no se repinta sola: aparece "Otra persona cambió esta información. Actualizar".
- La consulta corre como el dueño (cuota de efrain@): ~3 llamadas por minuto por navegador visible. La verificación del token sigue
  en caché (10 min).
- Idea no hecha: un activador diario (p. ej. 7:00) que llene el caché para que la primera carga del día no sea en frío (requiere
  autorizar un permiso nuevo de Google, `script.scriptapp`). **Hecho en CAPRI** con `cadaQuinceMinutos` (§4.8, §6.15).

### 6.15 CAPRI — incremento 4 (spec aprobado por Leo el 28/10/2026; construido con 5 módulos en paralelo e integrado)
Spec: "CAPRI — increment 4 spec" (Claude Docs `https://claude.ai/artifact/2kb6Dpz1MDVdZ5Y26oKjtA`). Decisiones de Leo:
- `@helgen.services` solo Requisiciones (por ahora); entran con código por correo (no Google): así no hay que darlos de alta en
  OAuth. Una sesión CAPRI nunca autentica una @helgen.tech.
- Super admin: aprueba y autoriza lo suyo **solo con motivo** (queda en la Bitacora de Administración); anula "todo" (ventas,
  cobranza y compras), con motivo, vista previa de la cascada y **una página central** (Administración → Anular), no un botón en
  cada pantalla. Lo anulado se esconde de listas, totales y pendientes y queda en la página de anulados; restaurar no existe.
- Correos desde la cuenta que corre la API (`facilities@helgen.tech` desde el 29/10/2026; antes efrain@), nombre "CAPRI Helgen", Reply-To = quien hizo el cambio; nadie recibe aviso de
  lo que él mismo hizo; un correo por grupo de destinatarios. El super admin **no** recibe los avisos de aprobaciones y compras
  solo por serlo (integración: si no, le llegaría todo).
- Delegación por rango de fechas (≤ 90 días), solo aprobaciones y compras.
- Separación de funciones en todo el flujo: nadie aprueba, da el visto bueno ni **autoriza** (flujo de siempre, decisión del
  29/10/2026) lo que pidió o preparó; solo un super admin, con motivo en la bitácora.
- Sugerencias: solo lo que **la misma persona** ya pidió (no lo de otros).
- **El centro de mando es el sistema del inventario; CAPRI lo alimenta.** El receptor asignado marca "Lo recogí"/En camino en
  CAPRI; el usuario del sitio recibe en `drogheda.helgen.online` (entra al inventario del sitio) y CAPRI trae esa recepción para
  cerrar. Receptores por sitio: Alán (VER), Jesús Honorato (ZLO), Miguel (ESE), Antonio (LZC), Jesús Romero (QRO).
- Avisos al centro de mando: se guardan siempre (Pendiente → Enviado) dentro del candado y se mandan al soltarlo (una llamada HTTP
  nunca retiene el candado); un aviso que falla bloquea los siguientes de la misma orden (orden garantizado) y se reintenta cada 15
  min sin límite (no hay botón de descartar: cambiar su `estado` a mano). Nunca montos (se revisa antes de guardar).
- Revisión independiente (28/10/2026): las **notas no van en los correos** (solo "Hay una nota: ábrela en CAPRI"; ningún
  filtro detecta montos o proveedores escritos a mano); el flujo de aprobaciones depende de que **alguien tenga el rol** (aunque
  esté desactivado), no de quién está activo; "Cerrar sesión" y reactivar a alguien **invalidan** sus sesiones de CAPRI; antes de
  cancelar o anular se **traen las recepciones** del centro de mando (nunca impide cancelar; lo que llegue después a una orden
  muerta queda como alerta); avisos que el centro de mando **rechaza 4 veces** (4xx) quedan "Rechazado" y no detienen los demás;
  en proyectos ligados solo se aceptan sus cinco sitios.
- Por qué es lento (explicado a Leo el 28/10/2026): ~1.7 s fijos por llamada de Apps Script, 385 KB de código cargados en cada
  llamada (9 s la primera tras publicar), lecturas de Sheets de 0.3–1.7 s por pestaña con caché que se invalida con cualquier
  cambio, PDF ~15 s, un solo candado para todas las escrituras y la consulta cada 20 s como efrain@. Plan de mudanza en dos
  etapas (servidor propio con Sheets/Drive, luego PostgreSQL con Drive para archivos): documento "CAPRI — server deployment plan"
  (`https://claude.ai/artifact/RQt4VfJF4Q1xqozM81sAA2`).

### 6.16 CAPRI — incremento 5 (29/10/2026)
- Decisiones de Leo: "Crédito" = **crédito del proveedor** (recibir antes de pagar) y además tarjeta de crédito, tarjeta de débito en
  sitio y transferencia; fotos **en la nube** (Drive), también en el centro de mando "hoy"; proceso de devolución completo; documentos
  faltantes: aviso en la orden y bloqueo del pago.
- Integración: el bloqueo del pago es **solo para transferencias** (lo que se manda a la CLABE de la carátula; con tarjeta en tienda,
  efectivo o cheque solo avisa) y un proveedor extranjero (sin RFC o `XEXX010101000`) solo necesita la carátula.
- Nunca se guarda ni se pide un número de tarjeta; la referencia con tarjeta es la autorización o el ticket.
- El centro de mando guarda la foto solo hasta que CAPRI la baja (cada 15 min) y la borra al recibir `foto-archivada`.

## 7. Reglas del proyecto (no romper)
1. Los totales SIEMPRE se recalculan en el servidor (`normalizarCotizacion`). El navegador solo muestra una vista previa.
2. Redondeo a 2 decimales por renglón (`redondear`). IVA = subtotal × tasa.
3. PDF con **tablas e inline CSS**, sin flex/grid y **sin depender de colores de fondo** (§6.3).
4. Todo texto del usuario que va al PDF pasa por `escaparHtml`.
5. Colores de marca (Brand Guidelines de Helgen en Canva): azul `#2C3C5B` y aqua `#51F3DA` (primarios), teal `#0AC5A8`
   (secundario), negro/blanco; fondo neutro `#F2F4F7`. Tipografías: League Spartan Bold (títulos), Roboto Mono (texto).
   No usar los colores viejos `#0B1C3F` / `#4CAF50`.
6. Toda cotización imprime Términos y Condiciones según la línea de negocio:
   - **Helgen** (`TERMINOS_HELGEN`): solo "Precios vigentes por 15 días o hasta agotar existencias, sujetos a variaciones en costos de suministro de componentes."
   - **Helgen Energy** (`TERMINOS_ENERGY`): metraje adicional, centro de carga, obra civil + vigencia.
   No agregar términos por cuenta propia (se quitó uno de "fuera de alcance" que el usuario no quería).
7. Texto del usuario que va a Sheets pasa por `textoCelda` (un "+52…" se leería como fórmula → `#ERROR!`).
8. Textos de la interfaz en español de México.
9. Las claves SAT son internas: nunca en el PDF.
10. Toda llamada a la API exige token válido de @helgen.tech (`hd`, `email_verified`, `aud`); el vendedor sale **siempre**
    del token, nunca de lo que mande el navegador. No quitar esas revisiones.
11. **Responder siempre en español** (de México) al usuario, en el chat y en los mensajes de commit.
12. Datos de cobranza (contratos, esquemas, pagos, comprobantes) **solo** en el libro y la carpeta de cobranza, y cada función
    de cobranza revisa `ROL_COBRANZA` en el servidor (§6.11). Lo mismo con compras (órdenes, proveedores, PDF): solo en su libro y
    carpeta, con `ROL_COMPRAS`; el margen solo para `ROL_COBRANZA` (§6.12). Requisiciones y pagos a proveedores: solo en el libro y
    la carpeta de compras; el solicitante solo ve las suyas y nunca montos (§6.13). Nunca sumar importes de monedas distintas.
13. **Las pruebas en el navegador las hace Claude, no el usuario** (pedido del usuario, 20/10/2026): en el Chrome del usuario con
    Claude in Chrome, donde ya tiene su sesión de @helgen.tech. Detalle en §8 "Pruebas en el navegador".
14. **Cada vez que se actualice este CLAUDE.md, se actualiza en el mismo turno el Manual del Cotizador Helgen** (pedido del usuario,
    21/10/2026; §2 y §8 "Manual del Cotizador"). Los dos deben contar lo mismo; si no se pudo actualizar el manual, decirlo.
15. Toda función nueva que escriba datos va en `CAMBIOS_API` con las colecciones que cambia (si no, los demás navegadores no se
    enteran y su caché queda viejo hasta 6 h). Lo que la interfaz recibe de `sincronizar` respeta los mismos roles que las funciones.
    En un módulo de CAPRI (§4.8) eso se declara en su `cambios`.
16. (CAPRI) Desde que existe el libro de Administración, la regla 10 se lee así: cuenta @helgen.tech con token de Google **o**
    @helgen.services con sesión CAPRI firmada; además la cuenta debe estar activa en Permisos (`exigirAcceso_`). Los roles salen
    de Permisos, nunca del navegador.
17. (CAPRI) Un correo de aviso nunca lleva montos, proveedores ni folio de orden de compra; un aviso al centro de mando nunca lleva
    montos. Ninguna llamada HTTP (centro de mando) ni envío de correo dentro de `conCandado_`: se forman dentro y se mandan al
    terminar (`conAvisoPortal_`, `enviarCorreosPendientes_`).

## 8. Cómo trabajar

```bash
# Pruebas (Node, servicios de Google simulados). Antes de subir: todas (menos SAT) + sintaxis de la interfaz:
bash tests/todas.sh
# Una por una (CAPRI agrega permisos, identidad, correos, centro, pantallas y anular, con el arnés tests/arnes.js):
mkdir -p /tmp/salida-pdf && node tests/cotizacion.test.js Code.js /tmp/salida-pdf   # folios, idempotencia, marcas, Config, clientes, USD; deja helgen.html / energy.html / usd.html / oc.html
node tests/catalogo.test.js .                                  # catálogo: migración, alta, edición, duplicados
node tests/sat.test.js . "$HOME/Library/CloudStorage/GoogleDrive-efrain@helgen.tech/Mi unidad/Cotizador Helgen/Catálogos SAT"
node tests/sesion.test.js .                                    # token en doPost, vendedor_* (vendedor falso se ignora)
node tests/proyectos.test.js .                                 # folio PRY, clave (sugerida, validada, folio visible), carpetas, asignarClavesProyectos, subcarpetas que se reparan
node tests/interfaz.test.js .                                  # interfaz con DOM y fetch simulados: proyecto rechazado, USD, Cobranza (con margen), Compras (requisición → OC → pago → cierre), Requisiciones y SOLO_REQUISICION
node tests/cobranza.test.js .                                  # cobranza por doPost: permisos, aceptada, esquema, firma, desbloqueo, pagos, monedas, resumen
node tests/compras.test.js .                                   # compras por doPost: ROL_COMPRAS, órdenes (desde requisiciones), PDF, proveedores, pagar/recibir/cancelar, margen, monedas
node tests/requisiciones.test.js .                             # requisiciones por doPost: permisos (solo las suyas, SOLO_REQUISICION), estados, folios REQ/PGP, OC, pago, cierre; bootstrap y sincronizar por rol, caché por versiones, cambio a mano en la hoja
node tests/probar-busqueda-sat.js Code.js "<ruta>/SAT_c_ClaveProdServ.csv"   # ver qué sugiere la búsqueda por palabras

# Subir y publicar la API (misma API_URL)
npx clasp push --force
npx clasp deploy --deploymentId AKfycbwBjF7ra_4O8INsxBq0eh-4r-BlSsJ4LLxcJgVCPRpx1U1a-Pz1CUSdYtvj_Mh0S6y2 -d "descripción del cambio"
npx clasp list-deployments

# Interfaz en Cloudflare (desde esta carpeta; usa wrangler.jsonc)
npx --yes wrangler@4 deploy
```

- Antes de `push`, confirmar que `.clasp.json` apunta a `1GsH8Dja…` y que nadie cambió el proyecto en el editor
  (clonar en una carpeta temporal y comparar).
- Las pruebas de cotización y SAT simulan un vendedor (`VENDEDOR_`), porque `guardarCotizacion` exige sesión.
- Revisar sintaxis del JS de la interfaz: extraer los `<script>` de `web/cotizador/index.html` y `node --check`.
- Comprobar la API con `curl` usando `-d` sin `-X POST` (con `-X POST -L` curl repite el POST en la redirección de Google y
  sale "No se encontró la página"). Sin token → `{"ok":false,"error":"Inicia sesión con tu cuenta @helgen.tech.","codigo":"SESION"}`.
- El flujo completo exige sesión @helgen.tech: Claude lo prueba en el Chrome del usuario (ver "Pruebas en el navegador");
  los errores del servidor se ven con `npx clasp logs` o en el editor (Ejecuciones). Los datos se pueden revisar en solo lectura con el conector de Drive
  (permisos con `get_file_permissions`, hojas con el conector de Sheets). **El conector de Drive no puede compartir** ("The caller
  does not have permission", 20/10/2026): compartir lo hace el usuario desde Drive y Claude lo verifica después.
- `clasp push` solo cambia el código del editor (`@HEAD`); el equipo sigue en la versión del deployment hasta `clasp deploy`. Por eso
  se puede subir, correr una función desde el editor para probarla o autorizarla, corregir y volver a subir antes de publicar
  (así se corrigió `privado_()` el 20/10/2026). Tras cada push, comprobar con un `clasp clone` en carpeta temporal que el editor
  quedó igual al repositorio. Si el editor ya estaba abierto, recargarlo antes de correr la función.
- Al agregar funciones que llamen servicios de Google, extender los simulacros de `tests/`. Si la interfaz necesita una
  función nueva, agregarla a `API_FUNCIONES`.

### Pruebas en el navegador (las hace Claude; regla 13)
- Herramienta: **Claude in Chrome** (el Chrome real del usuario, con su sesión). Abrir una pestaña propia, cerrarla al terminar.
- **Dónde:** por omisión solo en el entorno de prueba: proyecto PRUEBAS (§10.5–10.6) + interfaz local `http://127.0.0.1:8788/cotizador/`
  (copia de `web/` con `API_URL` del deployment de prueba). En el cotizador real (`workers.dev` / API `AKfycbwBjF7…`) solo con
  confirmación explícita del usuario para esa prueba, y lo que se cree ahí se marca como prueba (cliente "PRUEBA - CANCELADA",
  proyecto `Cancelado`) y se anota en §5.
- **Cómo:** acciones clave con clics reales (marcar, firmar, registrar con `file_upload` para comprobantes); los diálogos
  `confirm`/`prompt` se responden reemplazándolos desde la página (si no, bloquean la automatización); casos de error también
  directo al servidor con `google.script.run` para comprobar que el servidor rechaza (no solo la interfaz). Revisar después en
  solo lectura el libro/hoja y Drive con los conectores.
- **Llamadas largas** (guardar con PDF tarda ~15 s): si la conexión con Chrome se corta, la llamada puede terminar igual. No
  repetirla: primero leer el estado. Para varias llamadas seguidas, correrlas en segundo plano guardando el resultado en `window`
  y leerlo aparte (pasó el 20/10/2026: un reenvío con otro `idSolicitud` creó `OC-2026-0003` duplicada, que se canceló).
- **Lo que Claude no hace (se le pide al usuario):** iniciar sesión o escribir contraseñas, aceptar permisos de Google, correr
  funciones desde el editor de Apps Script (`configurarPruebas`, `pruebasRondaConRol`, `prepararCobranza`…), y probar con la cuenta de
  otra persona (p. ej. Tania): eso queda como pendiente o lo hace esa persona.
- Al terminar: tabla de resultados por caso (✅/❌), errores encontrados con su arreglo y prueba automática, y los folios de prueba
  creados (anotarlos en §10.6 o §5).

### Regla de trabajo: guardar y publicar
Al terminar **cualquier** cambio:
1. `git commit` con una descripción clara (en español) de qué cambió y por qué, y `git push` a GitHub (`origin main`).
2. Si se modificó el código de Apps Script (`Code.js`, `Logo.js`, `Index.html`, `appsscript.json`), **recordarle al usuario**
   publicar la API: `npx clasp push --force` y `npx clasp deploy --deploymentId AKfycbwBjF7…` (comandos completos arriba).
3. Si se modificó algo en `web/`, **recordarle al usuario** publicar la interfaz: `npx --yes wrangler@4 deploy`.
4. **Actualizar el Manual del Cotizador Helgen** si se cambió este CLAUDE.md (regla 14; cómo, abajo).
El commit y el push no publican nada: el equipo sigue usando la versión anterior hasta publicar con clasp o wrangler.

### Manual del Cotizador (regla 14)
Documento de Claude Docs para personas: "Manual del Cotizador Helgen" (`https://claude.ai/artifact/AN8w8T2SKmDXSTa1zpFt2C`, §2).
CLAUDE.md es para Claude (detalle técnico); el manual explica lo mismo para quien usa y mantiene el cotizador.
- **Cuándo:** en el mismo turno en que se edite CLAUDE.md, antes de la respuesta final. No hace falta tocar el manual por cambios
  de CLAUDE.md que solo son internos para Claude (p. ej. una nota sobre cómo usar una herramienta), pero sí por todo lo que cambia
  qué hace el cotizador, cómo se usa, dónde están los datos, quién tiene acceso, qué se publicó o qué queda pendiente.
- **Qué secciones:** las que toque el cambio. Hoy son: Cómo está armado · Direcciones · Archivos · Proyectos · Cobranza · Compras ·
  Tareas frecuentes · Reglas de oro · Si algo falla · Historial (tabla de versiones y "Cómo se probó") · Pendientes. Una función
  nueva → su sección (o una nueva) + Historial + Pendientes. Al final, la fecha del renglón bajo el título (chip de fecha) = hoy.
- **Cómo:** solo con el conector de Claude Docs (nunca web fetch ni el Artifact tool para editarlo; nunca recrearlo). Cargar la
  skill `anthropic-skills:docs` (o `guide` → `topic.index`), leer el esquema de la pestaña (`read` con `projection: outline`, o
  `kind: view` + `sinceRev` desde la última lectura) y cambiar **solo** lo necesario (`update` con `find`/`replace` o
  `insert` junto a un bloque; `topic.editing` antes de borrar o mover). Lo que el usuario escribió en el manual se respeta.
- **Estilo:** español de México, frases cortas, sin nombres de funciones internas salvo que hagan falta para operar
  (`clasp`, `wrangler`, propiedades de Script). Nunca secretos (API keys, tokens). Los datos de cobranza y compras no se
  copian al manual (solo cómo funciona y dónde viven).
- **Al terminar:** decirle al usuario en la respuesta qué secciones del manual cambiaron. Si el conector no está disponible o
  rechaza el cambio, decirlo y anotarlo en §9 como pendiente.

## 9. Pendientes e ideas
- **CAPRI — incremento 5: construido e integrado el 29/10/2026 (rama `incremento-5`), SIN PUBLICAR.** Módulos F (proveedores y
  forma de pago) y H (fotos y devoluciones) + centro de mando (repo `hbox-docs`, rama `fotos-devoluciones`). Publicar: respaldo del
  libro de compras; `clasp push`; como facilities@: `prepararCapri()` y nueva versión del deployment; `CLOUDFLARE_ACCOUNT_ID=… wrangler
  deploy`; centro de mando: parches + `./scripts/deploy.sh` + `sudo systemctl restart actas-hbox` (antes o junto con CAPRI); nginx
  bloqueaba `/api/integracion/` (`"sesion":false`, confirmado por Leo el 29/10): el arreglo va en `hbox-docs`
  (`backend/nginx/drogheda.helgen.online.conf`, `location ^~ /api/integracion/` sin sesión; lo instala `cambiar-entrada.sh aplicar`). Avisar a compras: transferencias bloqueadas sin CSF y
  carátula; órdenes con días de crédito se reciben antes de pagar; recibir pide foto por renglón.
- **CAPRI — incremento 4: PUBLICADO el 29/10/2026 ~11:55** (API **@13** publicada por `facilities@helgen.tech` sobre el mismo
  deployment `AKfycbwBjF7…`, "Ejecutar como: facilities@"; interfaz con `CLOUDFLARE_ACCOUNT_ID=badd8bca… npx wrangler@4 deploy`,
  versión `5f66244c`). Hechos: Leo compartió el proyecto con facilities@ (Editor); facilities@ corrió `prepararCapri()` (libro de
  Administración `1bI6gx3xRAl6qe9Zg4Cn_yR8vyynm7PPMDLBHhRQ_PU0` en su Drive, 12 usuarios migrados, `SESION_SECRETO`, SITIOS con
  código, activador `cadaQuinceMinutos`, correo de prueba recibido). Revisado en el real como leo@ (Claude in Chrome): entrada
  CAPRI, Pendientes (REQ-2026-0003 por cotizar), Permisos (12), Compras (REQ-0001..0004) y Cobranza cargan, sin errores de
  consola. Sin respaldo previo de los libros (los cambios de `prepararCapri` solo agregan; historial de versiones de Sheets).
  Ojo: `wrangler` con la sesión de leo@ elige su cuenta propia; siempre con `CLOUDFLARE_ACCOUNT_ID` de la cuenta de efrain@.
  Antes: construido e integrado el 28/10/2026 (rama `incremento-4`; 5 módulos A–E + integración;
  `bash tests/todas.sh` en verde: 17 revisiones). **Revisión independiente** (dos agentes: seguridad y flujos/centro de mando)
  hecha el 28/10/2026; sus hallazgos se arreglaron con prueba (commit "Revisión independiente…", `tests/revision.test.js` y
  casos nuevos en identidad, correos, pantallas y centro). No se probó en PRUEBAS ni en el navegador real. **Pasos para publicar (Efrain, con Leo):**
  1. Revisar y hacer merge del PR a `main`. Respaldar la base de datos, el libro de compras y el de cobranza (como siempre, §2).
  2. Recomendado: probar antes en PRUEBAS (anular toca todos los libros; el enlace con el centro de mando con `PORTAL_PRUEBA=1`).
  3. `npx clasp push --force` y comparar el editor con `clasp clone`.
  4. **Como `facilities@helgen.tech`** (cuenta de la API desde el 29/10/2026; Leo compartió con ella el proyecto de Apps Script
     como Editor): en el editor, `prepararCapri()` **antes** del deploy. Pide los permisos nuevos (mandar correo, activadores);
     crea el libro de Administración (en el Drive de facilities@), migra los roles de Script Properties a Permisos, `SUPER_ADMIN` =
     leo@, `SESION_SECRETO`, convierte `SITIOS` a códigos, crea `PortalPendientes`, instala `cadaQuinceMinutos` (corre como
     facilities@) y manda "[CAPRI] Correo de prueba" a facilities@. Si el registro dice que no se pudo mandar la prueba, **no
     publicar** (§6.8). Compartir el libro de Administración con leo@ y comprobar que no lo lee el dominio.
  5. Como facilities@: Implementar → Administrar implementaciones → la existente (`AKfycbwBjF7…`) → Nueva versión, con "Ejecutar
     como: yo (facilities@helgen.tech)" (API primero). Si no deja editar esa implementación, crear una nueva y cambiar `API_URL` en
     `web/cotizador/index.html`. Luego `npx --yes wrangler@4 deploy`.
  6. Leo, en Administración → Permisos: revisar los roles migrados, ponerles nombre, dar el rol **Aprobaciones** (antes
     `ROL_OPERACIONES`), dar de alta las cuentas @helgen.services con su sitio (Alán en VER en lugar de Paola) y probar la entrada
     con código. Revisar los códigos en Config `SITIOS` (VER, ZLO, ESE, LZC, QRO).
  7. Enlace con el centro de mando (apagado hasta este paso): Leo genera el secreto con `openssl rand -hex 32` y lo pone en
     `PORTAL_SECRETO` (CAPRI) y `COTIZADOR_SECRETO` (drogheda.helgen.online), más `PORTAL_URL = https://drogheda.helgen.online` y
     `PORTAL_PROYECTOS = {"PRY-2026-0002": "drogheda"}`. Correr `probarCentroMando()` desde el editor; ronda con `PORTAL_PRUEBA=1`
     (requisición de DROGHEDA hasta la orden, "Lo recogí", recepción en el centro de mando, cierre solo); borrar `PORTAL_PRUEBA`.
  8. OAuth: con @helgen.services entrando por código ya no hace falta agregarlas a usuarios de prueba; pasar la pantalla de
     consentimiento a "En producción" o "Interna" sigue pendiente (§10.1).
  - **Mientras no se publique:** el material que llegue para DROGHEDA se registra a mano en `drogheda.helgen.online` (CAPRI no
    avisa todavía al centro de mando).
  - Preguntas abiertas con el centro de mando: ¿`recibido` por renglón es acumulado (lo supone CAPRI) o por recepción?;
    `proyecto_clave` va como "drogheda" (valor de `PORTAL_PROYECTOS`), no "DRO"; `solicitante`/`autorizo` van como correo; un aviso
    rechazado (p. ej. 400 por sitio desconocido) se reintenta sin límite y detiene los siguientes de esa orden; cancelar un pago a
    proveedor no avisa (el contrato no tiene ese tipo).
  - **Decidido por Leo (29/10/2026):** también en el flujo de siempre nadie autoriza la requisición que pidió; solo un super admin,
    con motivo (≥ 10 caracteres) que queda en la bitácora de Administración (`autorizarRequisicion`, tercer parámetro).
  - Queda de la revisión (riesgo bajo, anotado): en el flujo de siempre no hay campo para asignar quién recibe (recibe quien
    pidió); un aviso del centro de mando que falla por red (no 4xx) sigue deteniendo los siguientes de su orden hasta que pase.
  - Textos que todavía dicen "operaciones" dentro de Requisiciones y Compras (la pestaña ya dice Aprobaciones).
  - **Manual del Cotizador sin actualizar** (regla 14): el documento no está compartido con la cuenta de Leo en Claude Docs; lo
    actualiza quien lo tenga (Efrain) con §4.8, §5 y este punto.
  - Ideas que quedaron fuera: restaurar lo anulado, botones de anular en cada pantalla, resumen diario por correo, mandar la orden
    desde CAPRI con el PDF adjunto, existencias por sitio desde el centro de mando.
- **Facturas de proveedor y requisiciones con operaciones: publicadas el 28/10/2026** (API @12 + interfaz; PR 2 y 3, merge `56a923e`).
  Hechos: las 11 pruebas en Node pasaron (incluye `tests/facturas.test.js` y `tests/operaciones.test.js`), editor real comparado antes
  (= `d56dd38`, @11) y después (= repo) con `clasp clone`, respaldos (§2), `clasp push`, `clasp deploy` @12, `wrangler deploy`. Sin
  servicios de Google nuevos. **No se probó en PRUEBAS** (decisión del usuario: respaldar y publicar). Revisión en el real (Claude in
  Chrome, sin crear nada): sesión sin errores de consola, 6 pestañas, Compras con filtro de estados nuevo y "3 · Cuentas por pagar"
  ("No hay facturas por pagar"). El libro de compras real creó solo la pestaña `FacturasProveedor` y sigue restringido (efrain@,
  tania@, leo@); `MovimientosInventario` y `SITIOS` en Config se crean al usarse.
  - `ROL_OPERACIONES` vacío = flujo de requisiciones de siempre. Para activar el flujo con operaciones (HBOX), agregar los correos a
    esa propiedad. Días de crédito ya son obligatorios al autorizar.
  - Falta documentar en este archivo (§4, §5, §6) las funciones, hojas y decisiones de facturas y operaciones (vienen en los mensajes
    de commit `a607c96`, `6cced2f`, `844b26a`, `cb2bb92` y en `README.md`).
  - Pendiente del usuario: dejar en Restringido la carpeta de respaldo de compras `1MxtnxM4…` y su copia.
- **Carga rápida, sincronización, requisiciones en cualquier proyecto y clave: publicados el 23/10/2026** (API @11 + interfaz;
  commits `d56dd38` y `a971f2b`). Hechos: medición antes (§6.14), respaldos (§2, verificados y restringidos), prueba en PRUEBAS (§10.9),
  editor real comparado antes (= `070b45d`) y después (= repo) con `clasp clone`, `clasp push`, `clasp deploy` @11, `wrangler deploy`,
  deployment de prueba retirado (404) y servidor local apagado. **Revisión en el cotizador real (Claude in Chrome, sin crear nada):**
  una sola llamada al entrar (9.2 s la primera, en frío; 2.0 s al recargar), 6 pestañas, roles guardados, DROGHEDA en Requisiciones y
  en Compras ("MXN · sin contrato"), resumen de cobranza y vista de DROGHEDA sin margen (no tiene órdenes). La columna L de la hoja
  real se crea sola la primera vez que se lee Proyectos.
  - **Claves asignadas el 23/10/2026** (el usuario corrió `asignarClavesProyectos` y `asignarClavesProyectosAplicar`, primero en
    PRUEBAS y luego en el real; comprobado con los conectores): `PRY-2026-0001-PPO` (carpeta "PRY-2026-0001-PPO — Angel Sosa — Helgen —
    Proyecto de Prueba oficial") y `PRY-2026-0002-DRO` (carpeta "PRY-2026-0002-DRO — Helgen — DROGHEDA"). En PRUEBAS: 0001 TSP,
    0002 PNP, 0003 PCA, 0004 PCB (la primera vez no escribió nada porque el editor no estaba recargado).
  - No probado con cuentas reales de otras personas (Tania, Leo, `SOLO_REQUISICION`): lo cubren las pruebas en Node.
  - Idea: activador diario para llenar el caché temprano (§6.14).
- **Renombrar en Drive / Apps Script (lo hace el usuario):** proyecto `1GsH8Dja…` → "Cotizador Helgen (código de la app)";
  carpeta `1w-T05ql…` → "Cotizador Helgen — API web"; proyecto anterior → "Cotizador Helgen (EN DESUSO — no usar)";
  los archivos de prueba sin uso → "ARCHIVO PRUEBAS — …" (§10.4).
- **OAuth en External/Testing:** solo entran las cuentas de la lista de usuarios de prueba (4 agregadas el 19/10/2026).
  Para un vendedor nuevo hay que agregarlo (§10.1). Ideal: cambiar a "Interna".
- La IA para claves SAT no se ha probado contra la API real; requiere `ANTHROPIC_API_KEY` y correr `probarIaSat()` en el editor.
- Existen archivos previos de Helgen Energy en Mi unidad (no movidos): "Catálogo Maestro de Precios - Helgen Energy" (Sheets),
  "Catálogo Helgen Energy - Soluciones 2026" (Slides), "COTIZADOR HELGEN ENERGY.html". Se ofreció importar esos precios al catálogo.
- Si Helgen Energy tiene logo/colores propios, aplicarlos solo a sus cotizaciones.
- `GUIA.md` describe el proyecto anterior; actualizarla si se va a usar.
- Ideas mencionadas: enviar PDF por correo, duplicar cotización, estatus (Enviada/Aceptada/Rechazada), descuentos por renglón.
- Proyectos: gastos, nómina, horas (fase 4) y adicionales (§6.10). Cobranza (§6.11), órdenes de compra (§6.12) y requisiciones (§6.13) ya construidas.
- **Requisiciones y pago a proveedores: publicados el 23/10/2026** (API @10 + interfaz). Hechos, en orden: prueba en PRUEBAS (§10.8,
  todo pasó; se corrigieron `.oculto` y el texto del tipo de cambio del pago), respaldos (§2, verificados), `clasp push` (editor
  comparado antes = `b99630b` y después = repo con `clasp clone`), el usuario agregó `ROL_REQUISICION` y `SOLO_REQUISICION` y corrió
  `prepararCompras()` (libro real con las 4 pestañas nuevas y `req_folio`; sigue restringido: efrain@, tania@, leo@), `clasp deploy`
  @10, `wrangler deploy`. **Revisión en el cotizador real (Claude in Chrome, sin crear nada):** las 6 pestañas para efrain@,
  Requisiciones y Compras vacías (no hay contratos firmados en la hoja real). Deployment de prueba `AKfycbybSSE0…` retirado (404) y
  servidor local apagado.
  - Carpeta de respaldo de compras `17Yn700v…`: nació con "helgen.tech: lector"; el usuario la dejó en Restringido el 23/10/2026
    (comprobado con `get_file_permissions`: carpeta efrain@, tania@, leo@; copia solo efrain@).
  - No probado con cuentas reales de otras personas: tania@/leo@ (requisiciones y compras) y adriana@, miguel@, paola@, jesus@,
    alan@, daniel@ (`SOLO_REQUISICION`). La primera requisición real será también la primera prueba de archivos en la carpeta real.
  - Para ver la cotización lado a lado, la persona de compras necesita acceso a la carpeta de compras en Drive (tania@ y leo@ lo tienen).
  - Ideas no hechas: notificar por correo, varios pagos o pagos parciales por orden.
- **Compras (fase 3): publicada el 21/10/2026** (API @8 + interfaz en Cloudflare). Hechos, en orden: respaldos (§2; la carpeta de
  respaldo dentro de cobranza nació con acceso del dominio y el usuario la dejó en Restringido, comprobado), prueba en PRUEBAS
  (§10.7, todo pasó), `ROL_COMPRAS`, `clasp push` (editor comparado antes y después con `clasp clone`: antes = `985df1f`, después =
  repo), `prepararCompras()` (carpeta y libro restringidos, `TERMINOS_OC` en Config), carpeta compartida como lector con tania@ y
  leo@ (comprobado: sin acceso del dominio), `clasp deploy` @8 y `wrangler deploy`.
  **Revisión en el cotizador real (21/10/2026, Claude in Chrome, sin crear nada):** sesión sin errores, pestañas Cobranza y
  Compras visibles con los dos roles, Compras sin proyectos ("No hay proyectos activos con contrato firmado": en la hoja real
  ningún contrato está firmado), vista de cobranza de `PRY-2026-0001` (Cancelado) carga con `margen: null`. Libro de compras vacío.
- **Resumen de cobranza: publicado el 21/10/2026** (API @9 + interfaz). Editor comparado antes (= `a591174`) y después (= repo)
  con `clasp clone`. **Revisión en el cotizador real (Claude in Chrome, sin crear nada):** resumen vacío con "Todavía no hay
  proyectos con cotización aceptada" (primera carga ~15 s). Ahí se encontró un error que PRUEBAS no mostró (allí todos los
  proyectos tenían contrato): el detalle solo se abría desde un renglón del resumen, que solo lista proyectos con contrato, así
  que **un proyecto nuevo no se podía abrir para marcar su primera aceptada**. Corregido el mismo día con el buscador "Abrir un
  proyecto" (`#resProyecto`, todos los proyectos; prueba en `interfaz.test.js`; commit `06ef824`, solo `wrangler deploy`) y
  comprobado en el real abriendo `PRY-2026-0001` (sin aceptada). Lección: al cambiar la navegación, probar también con un proyecto
  **sin** cotización aceptada.
  Antes, probado en PRUEBAS el 21/10/2026 (Claude in Chrome, sesión del
  usuario; deployment de prueba `AKfycbz3DZuN…`, ya **retirado**, 404). R1 (con cobranza): totales MXN 11,600 / 8,000 / 3,600 (69 %),
  margen 5,150 (51.5 %); USD 5,800 / 1,100 / 4,700 (19 %), margen 4,900 (98 %); cada renglón igual a la vista de su proyecto; pago
  cancelado excluido; clic en renglón, "← Resumen", filtros y texto del CSV correctos. Se encontró y corrigió el orden (comparaba
  saldos de MXN y USD; prueba en `cobranza.test.js`). El botón "Descargar CSV" no lo usó Claude (descargar pide permiso del
  usuario). R2 (`pruebasComprasSinCobranza()`, efrain@ sin cobranza): sin pestaña y `resumenCobranzaGeneral` → `PERMISO`.
  PRUEBAS quedó en la ronda C2 (efrain@ con compras, sin cobranza). Solo lee: no requirió respaldo ni permisos nuevos de Google.
- Al probar con Claude in Chrome, un clic por `ref` en la pestaña Cobranza no se aplicó (la página siguió en Nueva cotización);
  por coordenadas sí. Si una acción "no responde", revisar primero qué pestaña está visible antes de buscar un error en el código.
- Tania y Leo (rol de compras) no se han probado con sus cuentas reales; la primera orden real será también la primera prueba de
  PDF en la carpeta real.
- Subcarpetas "Órdenes de compra" de los proyectos viejos: quedan vacías y sin uso. Si el usuario lo pide, comprobar con el
  conector de Drive que estén vacías y que él las mande a la Papelera.
- **Cobranza: publicada el 20/10/2026** (API @6 + interfaz en Cloudflare). Hechos: respaldos, `clasp push`, `prepararCobranza()`
  (carpeta y libro creados y restringidos, §2 y §6.11), `ROL_COBRANZA` = efrain@, tania@, leo@ y `ADMIN_DESBLOQUEO` = efrain@,
  `clasp deploy`, `wrangler deploy` y carpeta compartida como lector con tania@ y leo@ (por persona, acceso general Restringido;
  comprobado el 20/10/2026: carpeta y libro sin acceso del dominio). Entorno de prueba retirado el mismo día: deployment
  `AKfycbz9naWO…` eliminado (404) y servidor local `127.0.0.1:8788` apagado.
  Al publicar se encontró y corrigió que Workspace comparte con el dominio lo que se crea (§6.11; commits `7685545` a `c75e754`).
  **Revisión en el cotizador real (20/10/2026, Claude in Chrome, sin crear nada):** sesión sin errores, selector MXN/USD, pestaña
  Cobranza (aparece a los ~3 s), lista con `PRY-2026-0001` y su vista (Cancelado, `HLG-2026-0006`, sin aceptada; no se marcó nada),
  catálogo con precio USD ($1,000 ÷ 18.4250 = $54.27, Google Finance). En la hoja: columna I y pestaña "Tipo de cambio" creadas
  solas (B4 = 18.4250); libro de cobranza con encabezados y sin datos.
- Catálogo real: solo tiene el renglón `HSE-EJ` "EJEMPLO" ($1,000, sin "Actualizado"). Parece de ejemplo: borrarlo o cargar los
  productos reales (ver la idea de importar el "Catálogo Maestro de Precios - Helgen Energy").
- Proyectos `Cancelado` en Cobranza (20/10/2026, commit de este cambio): la vista trae `puedeAceptar` y `puedeFirmar` en falso y
  la interfaz oculta "Marcar aceptada" y "Contrato firmado" con un aviso (reactivar = Estado Activo en la hoja). El servidor ya lo
  rechazaba. Publicado el 20/10/2026 (API @7 y luego la interfaz: la interfaz nueva con una API sin esos campos ocultaría los
  botones en todos los proyectos). Revisado en el cotizador real con Claude in Chrome, sin crear nada: `PRY-2026-0001` (Cancelado)
  sin botones y con el aviso.
- Rol de cobranza **sin** desbloqueo (Tania) solo se probó con las pruebas automáticas, no con su cuenta real.
- Precio USD del catálogo (20/10/2026): el tipo de cambio usado se guarda en `Cotizaciones!V` (no sale en el PDF). Leer
  `GOOGLEFINANCE` desde Apps Script **sí funciona** (comprobado en PRUEBAS: 18.4248); si un día falla, usar el valor manual (B3).
- **Acceso del dominio a la Base de datos y a la carpeta maestra** (lector para todo helgen.tech): se queda por ahora; revisarlo
  junto con la idea "cada vendedor ve solo sus cotizaciones" (quitarlo impide abrir los PDF desde el Historial).
- Tania y Leo eran **editores** de la Base de datos (20/10/2026); el usuario los baja a lector.
- ~~Mover el proyecto de prueba a la carpeta `1w-T05ql…`~~ hecho por el usuario (comprobado el 20/10/2026).
- PRUEBAS, limpieza opcional (lo hace el usuario): carpeta vacía "PRUEBAS — Compras" `1hlqlrwwq_olMttqvYtoXid4vS7a6NRXb` dentro de
  "ARCHIVO PRUEBAS — Cotizaciones Helgen (PDF)" (sin uso, a la Papelera). "PRUEBAS — Cobranza" la lee todo el dominio porque
  hereda el acceso de esa carpeta: solo tiene datos inventados; si se vuelve a probar un pago ahí, `privado_` fallará (moverla a
  la raíz de Mi unidad, como la de compras).

## 10. Interfaz web y sesión con Google

### 10.1 Google Cloud (cliente OAuth)
- Client ID (tipo "Aplicación web"): `884526916417-cn5fh45io0nnpvlad2439thkpius4063.apps.googleusercontent.com`. No es secreto;
  debe coincidir en `CLIENT_ID_GOOGLE` de `web/cotizador/index.html` y de `Code.js`. El secreto del cliente no se usa ni se guarda.
- Pantalla de consentimiento: **External en modo Testing, con usuarios de prueba agregados a mano** (decisión del usuario).
  - Solo entran las cuentas de la lista. **Para dar acceso a otro vendedor:** Google Cloud Console → Pantalla de consentimiento
    de OAuth (Google Auth Platform) → Público → Usuarios de prueba.
  - Con External, Google **no** limita por dominio: una cuenta @gmail en la lista podría obtener un token. Por eso el
    servidor exige `hd` y `email_verified` (y la prueba lo cubre).
  - Lo ideal: cambiar a "Interna" (requiere que el proyecto de Cloud esté en la organización helgen.tech).
- Orígenes autorizados de JavaScript: `https://cotizador-helgen.cotizador-helgen.workers.dev` y `http://127.0.0.1:8788`.
  Sin URIs de redireccionamiento. Un origen nuevo tarda de minutos a horas; mientras, el botón da `origin_mismatch`.

### 10.2 Interfaz (`web/cotizador/index.html`, `<script id="api-web">`)
- Es la interfaz completa con el logo incrustado y una capa que imita `google.script.run` con `fetch(API_URL)`
  (POST `text/plain` para evitar la consulta CORS previa; cuerpo `{"funcion", "args", "token"}`, respuesta
  `{"ok", "datos" | "error", "codigo"?}`; `codigo: "SESION"` = falta sesión o no es válida).
- Carga Google Identity Services (`https://accounts.google.com/gsi/client`). La pantalla `#login` tapa la app hasta tener token;
  botón "Acceder con Google" + One Tap, con `hd: 'helgen.tech'` (solo filtra la lista de cuentas; quien decide es el servidor).
- El ID token va en **cada** llamada. Se guarda en `sessionStorage` y se reutiliza hasta 1 min antes de expirar
  (~1 h); las llamadas sin sesión vigente esperan en cola hasta que se inicia sesión.
- Si el servidor responde `codigo: "SESION"`, se borra el token, se muestra el login y la llamada se repite **una vez** al entrar
  (guardar es idempotente por `idSolicitud`: no duplica folio).
- Otros códigos llegan a la interfaz en `err.codigo`. `codigo: "PROYECTO"` (proyecto cancelado, cerrado o inexistente al guardar,
  `errorProyecto_`): `errorAlGuardar` limpia el campo Proyecto, refresca la lista y muestra el aviso.
  `codigo: "PERMISO"` (sin rol de cobranza o de desbloqueo, `errorPermiso_`): se muestra el error.
- Encabezado: nombre del vendedor (del token, solo para mostrar) + botón "Cerrar sesión" (`disableAutoSelect`).
- Tras publicar, el navegador puede mostrar la versión anterior en caché: recargar la página.
- Wrangler 4 delega Cloudflare Pages "clásico" a Workers: se eligió **Worker con assets** (`wrangler.jsonc`), no `wrangler pages`.
  Si pide sesión: `npx --yes wrangler@4 login`. Probar local: `python3 -m http.server 8788 --bind 127.0.0.1` dentro de `web/`.

### 10.3 Verificación del token en `doPost` (`Code.js`)
1. `doPost` lee el cuerpo y, **antes de buscar la función**, llama `verificarTokenGoogle_(cuerpo.token)`.
   Sin token o con token inválido no se ejecuta nada: responde `{"ok": false, "error": "…", "codigo": "SESION"}`.
2. `verificarTokenGoogle_()`: busca en `CacheService` por la huella SHA-256 del token (`TOK_…`). Si no está, consulta
   `https://oauth2.googleapis.com/tokeninfo?id_token=…` con `UrlFetchApp`: Google revisa **firma y expiración**; si no
   responde 200, es sesión inválida.
3. `validarClaimsToken` exige `aud === CLIENT_ID_GOOGLE`, `iss` = `accounts.google.com` o `https://accounts.google.com`,
   `exp` en el futuro, `hd === 'helgen.tech'`, `email_verified` verdadero y correo terminado en `@helgen.tech`. Devuelve
   `{email, nombre, apellido}` (de `given_name`/`family_name`; si faltan, se parte `name`). Todo error lleva `sesion = true`.
4. El resultado se guarda en caché hasta que el token expire (máx. 10 min) para no consultar a Google en cada clic.
5. `VENDEDOR_` vale el vendedor **solo durante esa petición** (se limpia en `finally`). `Session.getActiveUser()` viene vacío con
   `ANYONE_ANONYMOUS`; por eso existe `usuarioActual_()`.
- **`doGet` no sirve la app:** con `ANYONE_ANONYMOUS`, una página de HtmlService permitiría llamar funciones con
  `google.script.run` sin token.
- Columnas `vendedor_*` y "Elaboró" (columna K y el PDF) = datos del token; pasan por `textoCelda`.

### 10.4 Archivos de prueba que quedaron sin uso
Se usaron para probar la interfaz web con datos inventados (Fases 1 y 2, 19/10/2026). Ya **no** los usa el código; no apuntar
ninguna propiedad a ellos. Están en la carpeta `1w-T05ql62SXxsm3z4u-xCpMjcdXc0b0p`:
- "PRUEBAS — Cotizador Helgen — Base de datos" `10WLYHF2vB2TDmoTXwfAxnG8bp7gDOPPzoj9p6B0tUGY`
- "PRUEBAS — Catálogo Helgen" `1GQBK0_WXSQRuCOeE-Pv8AA6PFA4tjZwCqae4L7WZsH0`
- "PRUEBAS — Cotizaciones Helgen (PDF)" `1iDk4faAM557SZh67EA122dj6eU4RJpsH`

### 10.5 Proyecto de prueba de punta a punta (20/10/2026)
Para probar Proyectos con la sesión real **sin tocar la hoja real** se creó un proyecto de Apps Script aparte:
"PRUEBAS — Cotizador Helgen (no usar)" (`1wp8_SQ…`, en la raíz de Mi unidad), deployment `AKfycbwVu2q5…`.
- Código = `Code.js`/`Logo.js`/`appsscript.json` oficiales + `Pruebas.js` con `configurarPruebas()`, que apunta sus Script
  Properties a los archivos "ARCHIVO PRUEBAS — …" (§10.4) y a la carpeta "PRUEBAS — Proyectos" (`1hGyzqb08ePBi-EIhKg0ztiE9yWxqm-DE`,
  dentro de "ARCHIVO PRUEBAS — Cotizaciones Helgen (PDF)"). **`Pruebas.js` no existe en este repositorio** y nunca debe subirse
  al proyecto oficial.
- Como el candado es por proyecto, solo puede escribir en los archivos PRUEBAS (§6.1). Usa el mismo Client ID de OAuth.
- La interfaz se probó desde una **copia** de `web/` fuera del repositorio, servida en `http://127.0.0.1:8788`, con `API_URL`
  apuntando al deployment de prueba. El `API_URL` del repositorio nunca cambia.
- Un proyecto creado con `clasp create` responde **403 "Acceso denegado"** hasta que el dueño corre una función desde el editor
  y acepta los permisos.
- **Para volver a usarlo:** clonar en una carpeta temporal (`clasp clone 1wp8_SQ…`), copiar ahí `Code.js`/`Logo.js`/`appsscript.json`
  de este repositorio (sin tocar el `.clasp.json` de aquí), `clasp push --force` y `clasp deploy` (o `redeploy` del mismo id).
  Al terminar, borrar la carpeta temporal.
- **Archivado (20/10/2026):** `clasp undeploy AKfycbwVu2q5…` desde una carpeta temporal ligada a `1wp8_SQ…`; la URL responde 404
  (`clasp list-deployments` puede seguir mostrándolo un rato). El usuario lo mueve en Drive a la carpeta `1w-T05ql…` junto a los
  "ARCHIVO PRUEBAS". No borrarlo: sirve para la fase 2 (para reusarlo, `clasp deploy` crea un deployment nuevo con otra URL).

### 10.6 Prueba de Cobranza y USD en PRUEBAS (20/10/2026)
- Deployment del proyecto PRUEBAS (**retirado** el 20/10/2026 tras publicar Cobranza; para reusarlo, `clasp deploy` da otra URL): `AKfycbz9naWOw4Jj0qlta0RjCNifgZLvvJqXpqRnrrsALewSnmn7ydnEIw_zYriIHZjbQ5ugQw` (@5 al cierre;
  se actualiza con `clasp deploy --deploymentId` desde la carpeta temporal, nunca desde el repo). Interfaz: copia de `web/` en una
  carpeta temporal, servida en `http://127.0.0.1:8788/cotizador/` (título "PRUEBAS — Cotizador Helgen").
- `Pruebas.js` (solo en PRUEBAS) ahora también: crea "PRUEBAS — Cobranza" (`1kdxWCCmi0lcdexqjmqgO89gKphCvxTKJ`, dentro de
  "ARCHIVO PRUEBAS — Cotizaciones Helgen (PDF)", sin compartir) y su libro "PRUEBAS — Cobranza (datos)"
  (`1fqtyRXiztJlQ8V2dCg0QZXKbb5LzmR73Yq55ezabMNo`); `pruebasRondaSinRol()` (ROL_COBRANZA = tania@) y `pruebasRondaConRol()`
  (efrain@, tania@, leo@); `diagnosticoCobranza()` (solo lee: propiedades y permisos que ve el servidor para efrain@ y tania@).
- **Ronda 1 (sin rol):** sin pestaña Cobranza; cotizaciones normales y USD correctas (el usuario).
- **Ronda 2 (con rol):** 22 casos en el Chrome del usuario (Claude in Chrome, con su sesión): aceptada, esquema Helgen y Energy
  (con motivo), firma, regla de cotizaciones nuevas, pagos con PDF y foto, excedente, tolerancia, cancelar, desbloquear, firma
  con lo pagado mayor al monto, proyecto USD pagado en MXN con tipo de cambio. Todos pasaron. Se encontró y corrigió el error de
  fechas (§6.2). Datos de prueba (solo en archivos PRUEBAS): `PRY-2026-0003` (A, MXN: `HLG-2026-0008` aceptada y firmada,
  `0009`, `0010` Energy) y `PRY-2026-0004` (B, USD: `HLG-2026-0011`); pagos `PAG-2026-0001` a `0004` (`0002` cancelado).
- Comprobantes de prueba generados en el scratchpad de la sesión (un PDF mínimo y un JPG); no están en el repositorio.

### 10.7 Prueba de Compras en PRUEBAS (hecha el 20/10/2026)
- PRUEBAS (`1wp8_SQ…`) tiene el `Code.js`/`Logo.js`/`appsscript.json` del commit de Compras (`1a02e2d`), comprobado con `clasp clone`.
  Deployment de prueba: `AKfycbxK3ldf4zuqhZdBuDP6V_1VMy1T3ygk3RvEL8AYjvrGTQqL2DAtrFOt07cESOQFWFaesQ` (@6), **retirado** al
  terminar (`clasp undeploy` desde una carpeta temporal ligada a `1wp8_SQ…`; para reusarlo, `clasp deploy` da otra URL). Interfaz: copia de `web/` en el scratchpad con ese
  `API_URL` y título "PRUEBAS — Cotizador Helgen", servida en `http://127.0.0.1:8788/cotizador/` (el `API_URL` del repo no cambia).
- `Pruebas.js` (solo en PRUEBAS) ahora además tiene: `configurarCompras()` (crea "PRUEBAS — Compras (no usar)" **en la raíz de Mi
  unidad** y su libro, los restringe con `privado_`. Primero se intentó dentro de "ARCHIVO PRUEBAS — Cotizaciones Helgen (PDF)",
  pero esa carpeta (y "PRUEBAS — Cobranza") la lee todo el dominio y `privado_` dio 403 `cannotDeletePermission`: quedó ahí una
  carpeta vacía "PRUEBAS — Compras" `1hlqlrwwq_olMttqvYtoXid4vS7a6NRXb`, sin uso; agrega `TERMINOS_OC` al Config de PRUEBAS y deja la ronda C1),
  `pruebasComprasSinRol()` (C1: efrain@ sin compras, con cobranza), `pruebasComprasSinCobranza()` (C2: efrain@ con compras, sin
  cobranza), `pruebasComprasCompleta()` (C3: los dos) y `diagnosticoCompras()` (solo lee). Proyectos firmados para probar:
  `PRY-2026-0003` (MXN) y `PRY-2026-0004` (USD).
- Carpeta "PRUEBAS — Compras (no usar)" `14fqJMc8UEgZBo2IdL-M8jc03HarsbD-U` (raíz de Mi unidad) y libro "PRUEBAS — Compras (datos)"
  `1ILvHcwRvDcEQv3XDwZW2M9inHUMxl9zI2_52RlSvQNs`, solo efrain@ (comprobado). Al terminar quedó la ronda C3 (los dos roles).
- **Resultado (20/10/2026, Claude in Chrome con la sesión del usuario): todos los casos pasaron.** C1 (sin `ROL_COMPRAS`): sin
  pestaña Compras, las 5 funciones → `PERMISO`, `getDatosIniciales` sin datos de órdenes, margen con 0 órdenes en Cobranza.
  C2 (compras sin cobranza): sin pestaña Cobranza (`getCobranzaProyecto` → `PERMISO`), lista solo con proyectos firmados y sin
  montos; con clics: catálogo sin costo (no usa el precio de venta), rechazo sin costo sin gastar folio, emitir, autorrelleno del
  proveedor y RFC que actualiza la misma fila, USD en proyecto MXN (rechazo sin TC, luego con TC), Recibida y Cancelar con motivo;
  directo al servidor: recibir dos veces, cancelar recibida, fecha futura, proyecto cancelado, proyecto USD con orden en MXN,
  idempotencia y `marca` del navegador ignorada. C3: margen `PRY-2026-0003` = 10,000 − (3,000 + 1,850) = 5,150 MXN (51.5 %);
  `PRY-2026-0004` = 5,000 − 100 = 4,900 USD (98 %). Libro, bitácora, PDF (texto y permisos: solo efrain@) revisados en solo lectura.
  Datos de prueba: `OC-2026-0001` (Emitida), `0002` (USD, Recibida), `0003` (Cancelada: duplicado porque se cortó la conexión con
  Chrome a media llamada y se reenvió con otro id), `0004` (PRY-0004). No probado: proyecto **activo** sin contrato firmado (no hay
  uno en PRUEBAS; lo cubre `tests/compras.test.js`) ni cambiar la aceptada de moneda con órdenes vigentes (no hay cotización de otra
  moneda en esos proyectos; también en Node). `permisos.desbloqueo` sale `true` sin cobranza (viene de `ADMIN_DESBLOQUEO`; no abre
  nada porque desbloquear exige cobranza).
- Entorno retirado el mismo día: deployment `AKfycbxK3ldf…` eliminado (404) y servidor local apagado.

### 10.8 Prueba de Requisiciones y pago a proveedores en PRUEBAS (23/10/2026)
- PRUEBAS (`1wp8_SQ…`) con el `Code.js` del repo + `Pruebas.js` (solo ahí) con `configurarRequisiciones()` (pestañas nuevas en
  "PRUEBAS — Compras (datos)" y una requisición sembrada de `otra.prueba@helgen.tech`), `pruebasReqTrabajador()` (R1: efrain@ en
  `SOLO_REQUISICION`), `pruebasReqCompras()` (R2: requisición + compras + cobranza), `pruebasReqSinRol()` (R3) y
  `diagnosticoRequisiciones()` (solo lee). Deployment `AKfycbybSSE0HYXBV9RFcbD97XyqI6RrUEy0F8ouSQURlidAyJuoy2O2tGvYfPj1ory8iMZbHQ`
  (@9–@10), **retirado** al publicar (404). Interfaz: copia de `web/` en el scratchpad servida en `http://127.0.0.1:8788/cotizador/`.
  Quedó en la ronda R3.
- **Resultado (Claude in Chrome con la sesión del usuario): todo pasó.** R1: solo la pestaña Requisiciones; el servidor niega lo
  demás con `PERMISO`; proyectos solo con folio y nombre; sin cotización o con un .txt renombrado se rechaza; con clics se creó
  `REQ-2026-0002` (PDF, 2 renglones); `0003` con PNG (proyecto USD); cantidad 0 y sin renglones rechazadas; la ajena (`0001`) no se ve
  y cancelarla, cerrarla o corregirla da `PERMISO`; `0004` cancelada con el botón. R2: devolver con clic → corregir y reenviar (mismo
  folio, versión 2); autorizar con clics → `OC-2026-0005` $1,856 MXN; rechazos del pago (sin comprobante, monto distinto, USD sin TC,
  sin referencia, fecha futura); pago con clics → `PGP-2026-0001`; OC pagada no se cancela ni se paga dos veces; el trabajador no ve
  montos; cancelar pago (×) → Autorizada/Emitida; pago en USD `PGP-0002` (100.32 × 18.5 = 1,855.92); "Recibí el material" → Cerrada y
  OC Recibida; D5 (cancelar pago de cerrada) rechazado; `0003`: `OC-0006` cancelada → Solicitada → `OC-0007` → `PGP-0003` → cerrada
  por compras con motivo; `0001` rechazada; margen `PRY-2026-0003` 10,000 − 6,450 = 3,550 (35.5 %), `PRY-2026-0004` 5,000 − 580 =
  4,420 USD (88.4 %). R3: sin pestaña y `PERMISO`. Libro y Drive revisados en solo lectura (archivos solo efrain@).
- Errores encontrados y corregidos (commit `5dd33f2`): `.oculto` perdía contra `.acciones`/`.tiles` (botones Devolver/Rechazar
  visibles después de devolver) → `!important` + prueba; el aviso del pago decía "El proyecto es en…" → "La orden es en…" + prueba.
- Lección: tras recargar la página se pierden las funciones auxiliares definidas desde la consola (`llamar`): volver a definirlas
  antes de lanzar llamadas en segundo plano (si no, el `async` falla en silencio).

### 10.9 Prueba de carga rápida, sincronización, requisiciones sin contrato y clave en PRUEBAS (23/10/2026)
- PRUEBAS (`1wp8_SQ…`) con el `Code.js` del repo + (solo ahí, mientras se midió) tiempos `_t` en `doPost` y una función `pruebasEnfriar`
  que subía todas las versiones (= caché vacío); al terminar quedó con el código limpio de @11. Deployment `AKfycbxnFS1f…` (@11–@14),
  **retirado** (404). Interfaz: copia de `web/` en el scratchpad con marcas `performance.mark` (solo ahí). Ronda R2 (los tres roles).
- **Resultado (Claude in Chrome con la sesión del usuario): todo pasó.** Medición en §6.14. Un proyecto creado por fuera
  (`PRY-2026-0005-BOS`) apareció en 5 s en las 4 listas sin recargar; con clics: "Casa del Lago" sugirió CAL, editada a "cdl" →
  `PRY-2026-0006-CDL` (columna L y carpeta "PRY-2026-0006-CDL — …"); el servidor rechazó "C1", "ABCD" y "ÑAN"; búsqueda por clave y por
  folio completo; `REQ-2026-0005` en el proyecto sin contrato → `OC-2026-0008` (MXN, "sin contrato") → `PGP-2026-0004`; Cobranza:
  "Costo de órdenes $1,000.00 MXN · Margen: Sin contrato"; pago de cliente sin contrato rechazado; carpeta privada de compras con folio
  corto y solo efrain@; `PRY-2026-0006` puesto en Cerrado a mano en la hoja → la página lo mostró "Cerrado" a los 85 s.
- Errores encontrados y corregidos antes de publicar (con prueba en Node): el resumen podía salir del caché antes de detectar un
  cambio a mano (`REVISAR_A_MANO_`); al recibir un rol nuevo una lista llegaba y otra vieja la pisaba (cargas al final de
  `aplicarSync`); una consulta de más tras el bootstrap; caché frío de 12 s → TTL de 6 h por versión, revisión de hojas solo en la
  consulta de fondo, memoria por petición y listas pesadas solo si están en caché.
- Datos de prueba: `PRY-2026-0005-BOS`, `PRY-2026-0006-CDL` (Cerrado), `REQ-2026-0005` (Pagada), `OC-2026-0008`, `PGP-2026-0004`.

## 11. Migración al proyecto nuevo (19/10/2026)

El proyecto que se usaba para pruebas (`1GsH8Dja…`) pasó a ser el oficial, en este orden (cada paso confirmado por el usuario):
1. **Respaldos:** copias de la base de datos y del catálogo en "Respaldos 2026-10-19".
2. **Retiro del proyecto anterior** (`1X-qSKgv…`): deployment `AKfycbxahS3…` en **@10** = página "El cotizador se mudó" con
   botón a Cloudflare; `guardarCotizacion` y `guardarProducto` lanzan error (para que solo un proyecto escriba en la hoja).
   No se borró nada. Se hizo justo antes del paso 3 para no tener dos proyectos guardando a la vez.
3. **Propiedades del proyecto nuevo** → IDs reales (`SPREADSHEET_ID`, `FOLDER_ID`, `CATALOGO_ID`, `SAT_ID`) y
   `CONSECUTIVO_2026 = 4` (último folio real: HLG-2026-0004; el contador del anterior también era 4).
4. **Columnas P:S** en la hoja real: una función temporal escribió solo P1:S1 (comprobando antes que las filas no cambiaran)
   y se quitó después. Las filas 0001–0004 quedaron intactas.
5. **Prueba real:** HLG-2026-0005 ("PRUEBA - CANCELADA") con vendedor, PDF en `2026` y catálogo real. Comprobado en Drive.
6. **Textos sin "PRUEBAS"** en `Code.js` (API @3), portada y título de la interfaz (Cloudflare). La carpeta local pasó a
   ser el código del proyecto nuevo; el anterior quedó en `anterior/`.

**Regresar (solo si hace falta):** primero apuntar `SPREADSHEET_ID`, `FOLDER_ID` y `CATALOGO_ID` del proyecto nuevo a los IDs
de prueba (§10.4) para que deje de escribir en la hoja real (**no** borrarlas: `db_()` correría `setup()` y crearía otra base
de datos), y luego, desde `anterior/`:
`npx clasp deploy --deploymentId AKfycbxahS3PbizPrRrQIC1m2uz-2G8PoT64BqPdtGLu0Ms5t9RKs2ucxH_c3tpJXkj8uLE -V 9 -d "regreso a @9"`.
Nunca tener los dos proyectos guardando a la vez (§6.1).
