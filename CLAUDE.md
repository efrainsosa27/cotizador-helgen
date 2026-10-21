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

Además: **proyectos** (opcionales: folio `PRY-AAAA-0001` y carpeta propia en Drive; §6.9), **cobranza por proyecto**
(cotización aceptada, contrato firmado, esquema de pagos y pagos `PAG-AAAA-0001` con comprobante; solo rol de cobranza; §6.11),
**órdenes de compra por proyecto** (`OC-AAAA-0001` con PDF, proveedores y margen del proyecto; solo rol de compras; el margen solo
lo ve cobranza; §6.12), cotizaciones en **MXN o USD**, historial con búsqueda, catálogo de productos con precios (Google Sheets aparte), clientes sugeridos con
autorrelleno, y claves SAT internas por producto para contabilidad (con sugerencias por palabras o con IA).

**Helgen Energy** es la submarca de paneles solares: mismo folio y diseño, pero sus propios Términos y Condiciones.

## 2. Datos clave (IDs y URLs)

| Qué | Valor |
|---|---|
| **Cotizador (lo usa el equipo)** | `https://cotizador-helgen.cotizador-helgen.workers.dev/cotizador/` (portada en `/`) |
| Proyecto Apps Script de la API (`scriptId` en `.clasp.json`) | `1GsH8DjaFEZ9dltqBUTUEFE_frblSYimRRCvPkqKdRB5UhmBwwYHLSwyS` (nombre anterior "Cotizador Helgen — PRUEBAS interfaz web"; ver §9) |
| Deployment de la API (siempre actualizar este; `API_URL` en `web/cotizador/index.html`) | `AKfycbwBjF7ra_4O8INsxBq0eh-4r-BlSsJ4LLxcJgVCPRpx1U1a-Pz1CUSdYtvj_Mh0S6y2` (@9 al 21/10/2026 = resumen de cobranza; @8 = Compras: órdenes de compra, proveedores y margen; @7 = ocultar aceptar/firmar en proyectos cancelados; @6 = Cobranza y USD; @5 = nombre del vendedor en Historial; @4 = Proyectos; @3 = 19/10/2026; `access: ANYONE_ANONYMOUS` + token) |
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
| **Manual del Cotizador Helgen** (para personas) | Documento de Claude Docs `https://claude.ai/artifact/AN8w8T2SKmDXSTa1zpFt2C` (id `AN8w8T2SKmDXSTa1zpFt2C`; pestaña `1cdc8401-1062`, cuerpo `86e49b65-80a1`). Se actualiza **junto con este archivo** (regla 14 y §8) |
| Worker de Cloudflare | `cotizador-helgen`, cuenta de efrain@helgen.tech `badd8bca60b008822a73ca24e983ff43` |
| Dueño de todo / cuenta de clasp | `efrain@helgen.tech` (la API se ejecuta como esta cuenta) |
| Proyecto de prueba "PRUEBAS — Cotizador Helgen (no usar)" | `1wp8_SQofXXUuMkUjmDyyUxYLxx-LdFv-20JaXE7q9entLfEvDKgYtnt0`; deployment `AKfycbwVu2q5…` retirado el 20/10/2026 (404). Para Cobranza (20/10/2026): deployment `AKfycbz9naWOw4Jj0qlta0RjCNifgZLvvJqXpqRnrrsALewSnmn7ydnEIw_zYriIHZjbQ5ugQw`, **retirado** al publicar (404); su `Pruebas.js` crea "PRUEBAS — Cobranza" y tiene `pruebasRondaSinRol()` / `pruebasRondaConRol()`. Para Compras (20/10/2026): deployment `AKfycbxK3ldf…`, **retirado** al terminar (404); `Pruebas.js` con `configurarCompras()` y rondas C1–C3 (§10.7). Está en la carpeta `1w-T05ql…` (lo movió el usuario). Solo datos inventados (§10.5). **No es la API.** |
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
- `getDatosIniciales()` *(UI, al cargar)* — IVA, vigencia, marcas, catálogo, clientes, `usuario` (correo), `vendedor` (`{email, nombre, apellido}`)
  y `permisos` (`{cobranza, desbloqueo}`; solo para mostrar la pestaña Cobranza: cada función lo vuelve a revisar).
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
- `listarProyectos(busqueda, incluirInactivos)` *(UI)* — busca por folio, cliente o nombre; por omisión solo `Activo` y **sin
  contrato firmado** (el buscador de cotizaciones; `foliosConContratoFirmado_`); máx. 50, recientes primero. No devuelve `carpeta_id`.
- `crearProyecto(p)` *(UI)* — exige vendedor; `normalizarProyecto`; candado + idempotencia (`PRY_<idSolicitud>`, 6 h);
  folio `PRY-AAAA-NNNN`; **primero** crea la carpeta y **después** la fila (estado `Activo`). Devuelve `{folio, …, url}`.
- `buscarProyecto_(hoja, folio)`, `carpetaProyectos_()` (`PROYECTOS_FOLDER_ID`; si falta o está en la Papelera la crea en la
  carpeta maestra = padre de la base de datos), `subcarpeta_(padre, nombre)` (por nombre, ignora la Papelera, crea si falta),
  `crearCarpetaProyecto_`, `subcarpetaProyecto_(proyecto, nombreSub)` (ver §6.9).
- `getDatosIniciales()` incluye `proyectos` (activos; si falla, `[]` y la app carga igual).

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
- *(UI)* `listarProyectosCompras(busqueda)` (solo `Activo` con contrato firmado; con `moneda` y `marca`, **sin montos**),
  `getComprasProyecto(folio)` (`vistaCompras_`: proyecto, `moneda`, `marca`, `puedeEmitir`, órdenes, proveedores; sin contrato ni
  margen), `guardarOrdenCompra(p)` (candado + idempotencia `OC_<idSolicitud>`; revisa dentro del candado proyecto Activo y firmado;
  folio con `siguienteFolio_('OC', hoja, 'CONSECUTIVO_OC_')`; actualiza el proveedor; PDF; fila; Bitacora),
  `marcarOcRecibida(folio, 'AAAA-MM-DD')` (solo Emitida; fecha no futura ni anterior a la orden), `cancelarOrdenCompra(folio, motivo)`
  (solo Emitida; motivo ≥ 5).
- Internas: `carpetaCompras_`, `libroCompras_`, `libroComprasSiExiste_`, `hojaCompras_`, `ordenDesdeFila_`, `ordenesDeProyecto_`,
  `proveedoresDelLibro_`, `guardarProveedor_` (alta o actualización por id; si llega con RFC y existía sin RFC, esa fila toma el RFC),
  `buscarOrden_`, `bitacora_(…, HOJAS_COMPRAS)`.
- `prepararCompras()` — correr desde el editor: crea o repara carpeta y libro restringidos, agrega `TERMINOS_OC` a Config y
  muestra `ROL_COMPRAS`. No comparte nada.

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
  iniciales), `construirHtmlOrdenCompra(d, cfg, logoUrl)` (mismas reglas que el de cotización; sin tipo de cambio ni línea de negocio).

### 4.7 Interfaz (`web/cotizador/index.html`)
Pestañas: **Nueva cotización**, **Historial**, **Catálogo**, **Cobranza** (solo si `permisos.cobranza`; al entrar muestra el
**resumen** `#cobVistaResumen` — buscador `#resProyecto` para abrir **cualquier** proyecto (también sin aceptada), `verResumenCob`, `cargarResumenCob`, `filtrarResumenCob`, `pintarResumenCob`, `csvResumenCob`,
`descargarCsvCob` —; clic en un renglón → `abrirProyectoCob` muestra `#cobVistaProyecto` con "← Resumen"; tarjeta de margen
`#cobMargen`) y **Compras** (solo si `permisos.compras`): `cargarProyectosCom`, `pintarCompras(vista)` (al cambiar de proyecto
limpia el formulario), `recibirProveedores`/`autorrellenarProveedor`, `agregarRenglonOc` (el catálogo llena clave, descripción y
unidad; el costo queda vacío; listas `#ocCatalogo`/`#ocClaves` sin precio), `recalcularOc`, `pintarTcOc` (tipo de cambio si la
moneda no es la del proyecto), `limpiarOc`, `guardarOc`, `recibirOc` (fecha con `window.prompt`), `cancelarOc` (motivo). Moneda: selector
`#moneda`, `monedaActual`, `dinero(n, moneda)`, `cambiarMoneda` (en USD el catálogo llena clave/descripción/unidad pero **no**
el precio). Cobranza: `cargarProyectosCob`, `pintarCobranza(vista)`, `pintarEsquema`, `aceptarCot` (confirma con `window.confirm`
si el servidor lo pide), `guardarEsquemaCob`, `firmarCob`, `desbloquearCob`, `registrarPago` (lee el archivo con `FileReader`),
`cancelarPagoCob` (motivo con `window.prompt`). Funciones principales: `agregarFila`, `leerItems`,
`recalcular` (vista previa; el servidor recalcula), `guardar`, `limpiar`, `cargarHistorial`, `recibirClientes`,
`autorrellenarCliente`, `pintarDatalists`, `cargarCatalogo`, `pintarCatalogo`, `editarProd`, `guardarProd`, `sugerirSat`, `verTab`.
Proyectos (módulo "1 · Cliente y proyecto"): `recibirProyectos`, `proyectoElegido`, `alElegirProyecto` (si "Nombre" está vacío,
lo llena buscando el cliente por `cliente_id`), `abrirNuevoProyecto`, `crearProyecto` (usa el cliente de los campos de arriba).
Autocompletado con `<datalist>`: clientes (en "Nombre"), proyectos activos (`PRY-… — cliente — nombre`), productos por
descripción y por clave, unidades SAT.
Capa de sesión y `fetch` en `<script id="api-web">` (§10.2).

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

**Pestaña `Proyectos`** (1 fila por proyecto): Folio (`PRY-AAAA-NNNN`), Fecha, Nombre, Cliente ("nombre — empresa"),
`cliente_id` (ver `idCliente`), Ubicación, Estado (Activo/Cerrado/Cancelado; **se cambia con la lista desplegable en la hoja**,
no hay pantalla), `carpeta_id`, `vendedor_email`, `vendedor_nombre`, `vendedor_apellido`.

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
  `elaboro_nombre`, `fecha_registro`, `estado` (Emitida / Recibida / Cancelada), `fecha_recepcion`, `recibio`, `cancelado_por`,
  `fecha_cancelacion`, `motivo_cancelacion`.
- `Proveedores`: `id` (RFC o `SIN-RFC:razón social`), `razon_social`, `rfc`, `contacto`, `correo`, `telefono`, `actualizado`.
- `Bitacora`: mismas columnas que la de cobranza (emitir, recibir y cancelar orden).

**Script Properties** del proyecto `1GsH8Dja…` (Configuración del proyecto en el editor):
`SPREADSHEET_ID`, `FOLDER_ID`, `CATALOGO_ID`, `SAT_ID`, `CONSECUTIVO_AAAA` (p. ej. `CONSECUTIVO_2026`),
`PROYECTOS_FOLDER_ID` y `CONSECUTIVO_PROY_AAAA` (se crean solos con el primer proyecto),
`ANTHROPIC_API_KEY` (opcional; activa la IA para claves SAT; el proyecto anterior no la tenía). Nunca poner la API key en el código.
Cobranza: `ROL_COBRANZA` (correos separados por coma: efrain@, tania@, leo@), `ADMIN_DESBLOQUEO` (efrain@), `COBRANZA_FOLDER_ID` y
`COBRANZA_DB_ID` (se crean solos), `CONSECUTIVO_PAG_AAAA`. **Sin `ROL_COBRANZA` nadie tiene cobranza** (se niega por omisión).
Compras: `ROL_COMPRAS` (correos separados por coma: efrain@, tania@, leo@; creada el 21/10/2026), `COMPRAS_FOLDER_ID` y
`COMPRAS_DB_ID` (se crean solos), `CONSECUTIVO_OC_AAAA`. **Sin `ROL_COMPRAS` nadie tiene compras.**

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
- La pestaña Cobranza aparece cuando responde `getDatosIniciales` (2–3 s en la prueba): antes la página no sabe si hay rol. Los
  permisos se leen al cargar: tras cambiar `ROL_COBRANZA` hay que recargar la página. Ideas si molesta (no hechas): recordar el
  permiso en `sessionStorage` o poner en caché partes de la carga inicial.
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
- **Permisos en el servidor:** `ROL_COMPRAS` crea, ve, recibe y cancela órdenes; los demás reciben `codigo: "PERMISO"` y
  `getDatosIniciales` solo les manda `permisos.compras` en falso. Compras **no** recibe montos del contrato ni margen (solo la moneda
  y la línea de negocio del proyecto). El **margen solo lo ve `ROL_COBRANZA`** (va en `vistaCobranza_`). Agregar a alguien a
  `ROL_COMPRAS` le da acceso en la app; para abrir los PDF también hay que compartirle la carpeta de compras en Drive (por persona).
- **Solo en proyectos `Activo` con contrato firmado** (decisión del usuario, 20/10/2026): así la moneda y el contratado ya están
  fijos. Si después se desbloquea el contrato, el proyecto sale de la lista y no admite órdenes nuevas; las que tiene se conservan.
- **Datos de la orden:** proveedor (de la lista o nuevo), fecha de entrega (obligatoria, no anterior a hoy), lugar de entrega (por
  omisión la ubicación del proyecto), condiciones de pago (obligatorias), moneda (por omisión la del proyecto), IVA 16 / 8 / 0 %
  (por omisión `IVA_TASA`), notas. Renglones del catálogo (llena clave, descripción y unidad) o a mano; **el costo siempre se
  captura: nunca se usa el precio de venta** (las listas del catálogo de Compras ni siquiera lo muestran).
- **Línea de negocio:** cada orden guarda la del contrato al emitirse (para separar reportes Helgen / Helgen Energy). El PDF
  **siempre** es de Helgen Servicios Especializados con los datos fiscales de Config, también en Energy, y lleva `TERMINOS_OC`
  (los 4 términos del usuario, 20/10/2026). El tipo de cambio y la línea de negocio no salen en el PDF. No se envía por correo.
- **Estados:** Emitida → Recibida (completa, con fecha) o Cancelada (con motivo, solo si está Emitida). Nunca se borran filas.
  No hay recepciones parciales.
- **Proveedores:** pestaña propia que se llena sola al emitir (por RFC, o por razón social si no trae RFC; un dato vacío no borra
  uno anterior; si un proveedor sin RFC llega después con RFC, su fila toma el RFC).
- **Margen** = contratado sin IVA (`Contratos.subtotal`) − suma de `subtotal_proyecto` de las órdenes Emitidas y Recibidas, en
  monto y porcentaje. Una orden en otra moneda que el proyecto exige tipo de cambio al crearla y guarda su costo convertido;
  **nunca se suman MXN y USD**: con órdenes vigentes, la aceptada no puede cambiar de moneda (igual que con pagos).

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
    carpeta, con `ROL_COMPRAS`; el margen solo para `ROL_COBRANZA` (§6.12). Nunca sumar importes de monedas distintas.
13. **Las pruebas en el navegador las hace Claude, no el usuario** (pedido del usuario, 20/10/2026): en el Chrome del usuario con
    Claude in Chrome, donde ya tiene su sesión de @helgen.tech. Detalle en §8 "Pruebas en el navegador".
14. **Cada vez que se actualice este CLAUDE.md, se actualiza en el mismo turno el Manual del Cotizador Helgen** (pedido del usuario,
    21/10/2026; §2 y §8 "Manual del Cotizador"). Los dos deben contar lo mismo; si no se pudo actualizar el manual, decirlo.

## 8. Cómo trabajar

```bash
# Pruebas (Node, servicios de Google simulados). Correr las ocho antes de subir.
mkdir -p /tmp/salida-pdf && node tests/cotizacion.test.js Code.js /tmp/salida-pdf   # folios, idempotencia, marcas, Config, clientes, USD; deja helgen.html / energy.html / usd.html / oc.html
node tests/catalogo.test.js .                                  # catálogo: migración, alta, edición, duplicados
node tests/sat.test.js . "$HOME/Library/CloudStorage/GoogleDrive-efrain@helgen.tech/Mi unidad/Cotizador Helgen/Catálogos SAT"
node tests/sesion.test.js .                                    # token en doPost, vendedor_* (vendedor falso se ignora)
node tests/proyectos.test.js .                                 # folio PRY, carpetas, proyecto_folio, subcarpetas que se reparan
node tests/interfaz.test.js .                                  # interfaz con DOM y fetch simulados: proyecto rechazado, USD, pestañas Cobranza (con margen) y Compras
node tests/cobranza.test.js .                                  # cobranza por doPost: permisos, aceptada, esquema, firma, desbloqueo, pagos, monedas, resumen
node tests/compras.test.js .                                   # compras por doPost: ROL_COMPRAS, órdenes, PDF, proveedores, recibir/cancelar, margen, monedas
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
- Proyectos: gastos, nómina, horas (fase 4) y adicionales (§6.10). Cobranza (§6.11) y órdenes de compra (§6.12) ya construidas.
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
