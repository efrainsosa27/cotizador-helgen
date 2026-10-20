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

Además: **proyectos** (opcionales: folio `PRY-AAAA-0001` y carpeta propia en Drive; §6.9), historial con búsqueda, catálogo de productos con precios (Google Sheets aparte), clientes sugeridos con
autorrelleno, y claves SAT internas por producto para contabilidad (con sugerencias por palabras o con IA).

**Helgen Energy** es la submarca de paneles solares: mismo folio y diseño, pero sus propios Términos y Condiciones.

## 2. Datos clave (IDs y URLs)

| Qué | Valor |
|---|---|
| **Cotizador (lo usa el equipo)** | `https://cotizador-helgen.cotizador-helgen.workers.dev/cotizador/` (portada en `/`) |
| Proyecto Apps Script de la API (`scriptId` en `.clasp.json`) | `1GsH8DjaFEZ9dltqBUTUEFE_frblSYimRRCvPkqKdRB5UhmBwwYHLSwyS` (nombre anterior "Cotizador Helgen — PRUEBAS interfaz web"; ver §9) |
| Deployment de la API (siempre actualizar este; `API_URL` en `web/cotizador/index.html`) | `AKfycbwBjF7ra_4O8INsxBq0eh-4r-BlSsJ4LLxcJgVCPRpx1U1a-Pz1CUSdYtvj_Mh0S6y2` (@5 al 20/10/2026 = nombre del vendedor en Historial; @4 = Proyectos; @3 = 19/10/2026; `access: ANYONE_ANONYMOUS` + token) |
| Client ID de OAuth (`CLIENT_ID_GOOGLE` en `web/cotizador/index.html` y `Code.js`) | `884526916417-cn5fh45io0nnpvlad2439thkpius4063.apps.googleusercontent.com` (no es secreto) |
| Carpeta maestra en Drive "Cotizador Helgen" | `1lf3Z4d3e_oqFbYJse4QbyYkWowYT9HCo` |
| Base de datos "Cotizador Helgen — Base de datos" (`SPREADSHEET_ID`) | `1ozFsyt1OjSnSv-PVpRWZjgqeWt6voQREbjvOJAXPEaI` |
| Catálogo "Catálogo Helgen" (`CATALOGO_ID`) | `11Rr0G7ZHE8PqXWsw9OpPPfGLQx8Yz7g8h1wkjJY2ahQ` |
| Carpeta PDF "Cotizaciones Helgen (PDF)" (`FOLDER_ID`) | `1CDN1LyOlA1L6z5dvBp49tlqu0fDoxdX8` (subcarpeta `2026` = `1X6m0nexpc3TzJd9XWBmGOAeZuiJE3Pig`) |
| "Catálogos SAT (CFDI 4.0)" (`SAT_ID`) | `1B2t9tXuEj1i9JO9ybqsuH4PN1K47CqMZgoEBzd-Dmc8` (subcarpeta "Catálogos SAT" `15OYcUp41onVJoW7--b3gnLZY8ymvYbUZ`) |
| Respaldos de la migración | Carpeta "Respaldos 2026-10-19" `1hxx0tgh4cLZMqoyf-eT8l14UAde7Y-L1` (copias de base de datos y catálogo antes del cambio) |
| Respaldos antes de Proyectos | Carpeta "Respaldos 2026-10-20" `1rFGY_k_YRRo243p3xL2RpibQ9jkEo634`: Base de datos `1PBQvmwI412IMyJb74qBWN5ZcyhSuxK3xGU9cV5KPxTE`, Catálogo `1GxBpAvQxVNJyFJSLnaY9umA5L2qf4dqX36S4uehHUNc` (antes de la pestaña Proyectos y la columna T) |
| Worker de Cloudflare | `cotizador-helgen`, cuenta de efrain@helgen.tech `badd8bca60b008822a73ca24e983ff43` |
| Dueño de todo / cuenta de clasp | `efrain@helgen.tech` (la API se ejecuta como esta cuenta) |
| Proyecto de prueba "PRUEBAS — Cotizador Helgen (no usar)" (ARCHIVADO) | `1wp8_SQofXXUuMkUjmDyyUxYLxx-LdFv-20JaXE7q9entLfEvDKgYtnt0`; deployment `AKfycbwVu2q5…` retirado el 20/10/2026 (la URL da 404). Solo datos inventados (§10.5). **No es la API.** |
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
| `appsscript.json` | Manifiesto: zona `America/Mexico_City`, V8, web app `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`, servicio avanzado `People` (v1, directorio). Se sube. |
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
- `getCatalogo_(hoja?)` — lista `{clave, descripcion, unidad, precio, claveSat, unidadSat}`.
- `getCatalogo()` *(UI)* — productos + URL del archivo + unidades SAT para la lista de selección.
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
- `getDatosIniciales()` *(UI, al cargar)* — IVA, vigencia, marcas, catálogo, clientes, `usuario` (correo) y `vendedor` (`{email, nombre, apellido}`).
- `getClientes()` *(UI)* — clientes que ya cotizaron, calculados desde la hoja `Cotizaciones` (`clientesDesdeFilas`).
- `listarCotizaciones(busqueda)` *(UI)* — últimas 100 cotizaciones, filtro por folio/cliente/empresa/proyecto; `vendedor` =
  `vendedorDeFila`: nombre + apellido de la fila; en filas viejas (sin Q:S), el nombre que ese correo tiene en otras filas
  (`nombresDeVendedores`, gana la más reciente); si tampoco y es @helgen.tech, el nombre del **directorio de Google**
  (`completarNombresDirectorio_` → `nombreEnDirectorio_`, People API, caché 6 h `DIR_<correo>`, `-` = no encontrado; un error no
  se guarda en caché); si no, el correo (`vendedor_email` o "Elaboró"). No modifica la hoja.
- `probarDirectorio()` — correr desde el editor: autoriza el permiso del directorio y muestra el nombre de quien lo ejecuta.

### 4.5 Guardar cotización
- `guardarCotizacion(payload)` *(UI)* — exige vendedor verificado (si no, error de sesión); normaliza, agrega clave/unidad SAT
  a cada concepto que venga del catálogo (si falla, guarda igual), toma el candado, revisa idempotencia (`payload.idSolicitud`
  en `CacheService`, 6 h), asigna folio, genera PDF, lo guarda en la carpeta del año, reescribe encabezados si no coinciden con
  `ENCABEZADOS_COTIZACIONES` y agrega la fila. Devuelve `{folio, url, total, proyectoFolio}`.
  Si viene `payload.proyectoFolio`, dentro del candado valida que el proyecto exista y esté `Activo` (si no, error y no se
  gasta folio) y guarda el PDF en `<carpeta del proyecto>/Cotizaciones` en lugar de la carpeta del año.
- `siguienteFolio_(prefijo, hoja, baseContador)` — `max(<baseContador>AAAA, mayor folio del año en la hoja) + 1`.
  `baseContador` = `CONSECUTIVO_` (cotizaciones, por omisión) o `CONSECUTIVO_PROY_` (proyectos).
- `carpetaDelAnio_(anio)` — subcarpeta `2026`, `2027`… dentro de la carpeta de PDF (la busca **por nombre**).
- `logoDataUrl_(fileId)` — logo de Drive si `LOGO_FILE_ID` tiene valor; si no, `LOGO_HELGEN_AZUL`.

### 4.5.1 Proyectos (sección 4.1 del archivo)
- `hojaProyectos_()` — pestaña `Proyectos` de la base de datos; la crea sola (lista desplegable de Estado en G) y reescribe
  solo la fila 1 si faltan encabezados (`ENCABEZADOS_PROYECTOS`).
- `listarProyectos(busqueda, incluirInactivos)` *(UI)* — busca por folio, cliente o nombre; por omisión solo `Activo`; máx. 50,
  recientes primero. No devuelve `carpeta_id`.
- `crearProyecto(p)` *(UI)* — exige vendedor; `normalizarProyecto`; candado + idempotencia (`PRY_<idSolicitud>`, 6 h);
  folio `PRY-AAAA-NNNN`; **primero** crea la carpeta y **después** la fila (estado `Activo`). Devuelve `{folio, …, url}`.
- `buscarProyecto_(hoja, folio)`, `carpetaProyectos_()` (`PROYECTOS_FOLDER_ID`; si falta o está en la Papelera la crea en la
  carpeta maestra = padre de la base de datos), `subcarpeta_(padre, nombre)` (por nombre, ignora la Papelera, crea si falta),
  `crearCarpetaProyecto_`, `subcarpetaProyecto_(proyecto, nombreSub)` (ver §6.9).
- `getDatosIniciales()` incluye `proyectos` (activos; si falla, `[]` y la app carga igual).

### 4.6 Lógica pura (sin Google; se prueba en Node)
- `redondear(n)`, `formatoMoneda(n)`, `escaparHtml(s)`, `importeConLetra(n)` ("MIL CIENTO SESENTA PESOS 02/100 M.N.").
- `normalizarCotizacion(p, ivaTasa)` — limpia cliente/conceptos, exige nombre y ≥1 concepto, calcula importes y totales, `marca`.
- `formatearFolio`, `maxConsecutivo(folios, prefijo, anio)`.
- `clientesDesdeFilas(filas)` — agrupa por nombre+empresa normalizados (`textoNormal`), la fila más
  reciente manda, un dato vacío no borra uno anterior; `etiqueta` = nombre, o "nombre — empresa" si el nombre se repite;
  `id` = `idCliente`.
- `idCliente(c)` — RFC válido y no genérico (`RFC_GENERICOS`: XAXX010101000, XEXX010101000); si no, `SIN-RFC:nombre|empresa`
  normalizados. `normalizarProyecto(p)`, `nombreCarpetaProyecto(folio, cliente, nombre)` (quita `/ \ : * ? " < > |`),
  `proyectosDesdeFilas`, `filtrarProyectos`.
- `normalizarProducto(p)`, `indiceDeClave(claves, clave)`.
- `nombresDeVendedores(filas)` (correo en minúsculas → "Nombre Apellido"), `vendedorDeFila(r, nombres)`,
  `nombreDePersonaDirectorio(personas, correo)` (solo la persona con el correo exacto; nombre + apellido o `displayName`).
- `terminosParaPdf(cfg, marca)` — renglones de T&C de la marca; agrega la línea de vigencia si falta.
- `textoCelda(s)` — antepone `'` a texto que empiece con `= + - @` para que Sheets no lo lea como fórmula.
- `validarClaimsToken(claims, clientId, dominio, ahora)` — ver §10.3.
- SAT: `palabrasSat`, `SINONIMOS_SAT`, `PALABRAS_SERVICIO_SAT`, `buscarClavesSat(consulta, filas, n)`, `candidatosSat`,
  `solicitudIaSat`, `leerRespuestaIaSat` (solo acepta claves que estaban entre los candidatos). Modelo: `MODELO_IA_SAT`.
- `construirHtmlPdf(d, cfg, logoUrl)` — HTML del PDF (ver reglas 3–4).

### 4.7 Interfaz (`web/cotizador/index.html`)
Tres pestañas: **Nueva cotización**, **Historial**, **Catálogo**. Funciones principales: `agregarFila`, `leerItems`,
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
   ├─ 📁 Proyectos / 📁 2026 / 📁 PRY-2026-0001 — Cliente — Nombre / Cotizaciones, Órdenes de compra, Pagos
   ├─ 📁 Catálogos SAT / SAT_c_ClaveProdServ.csv, SAT_c_ClaveUnidad.csv, 📊 Catálogos SAT (CFDI 4.0)
   ├─ 📁 Respaldos 2026-10-19                  (copias antes de la migración)
   └─ 📜 Cotizador Helgen (código de la app)   ← proyecto ANTERIOR, en desuso
```
El proyecto de la API (`1GsH8Dja…`) está en la carpeta `1w-T05ql62SXxsm3z4u-xCpMjcdXc0b0p` (antes "PRUEBAS — Cotizador web"),
junto con los archivos de prueba que ya no se usan (§9).

**Pestaña `Cotizaciones`** (20 columnas, 1 fila por cotización): Folio, Fecha, Cliente, Empresa, RFC, Correo, Teléfono,
Subtotal, IVA, Total, Elaboró, PDF (link), Conceptos (JSON: clave, descripcion, unidad, cantidad, precio, importe y, si vienen
del catálogo, claveSat/unidadSat), Notas, Marca (Helgen / Helgen Energy), Dirección, `vendedor_email`, `vendedor_nombre`,
`vendedor_apellido`, `proyecto_folio` (T; vacío = "Sin proyecto"). Las columnas P:S se agregaron el 19/10/2026 (§11); las
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
`TERMINOS_HELGEN`, `TERMINOS_ENERGY` (un término por renglón dentro de la celda).

**Pestaña `Proyectos`** (1 fila por proyecto): Folio (`PRY-AAAA-NNNN`), Fecha, Nombre, Cliente ("nombre — empresa"),
`cliente_id` (ver `idCliente`), Ubicación, Estado (Activo/Cerrado/Cancelado; **se cambia con la lista desplegable en la hoja**,
no hay pantalla), `carpeta_id`, `vendedor_email`, `vendedor_nombre`, `vendedor_apellido`.

**"Catálogo Helgen" / pestaña `Catalogo`**: Clave (única, mayúsculas), Descripción, Unidad, Precio unitario (sin IVA),
Actualizado, Actualizó, Clave SAT, Unidad SAT. A:C y G:H en formato texto.

**Script Properties** del proyecto `1GsH8Dja…` (Configuración del proyecto en el editor):
`SPREADSHEET_ID`, `FOLDER_ID`, `CATALOGO_ID`, `SAT_ID`, `CONSECUTIVO_AAAA` (p. ej. `CONSECUTIVO_2026`),
`PROYECTOS_FOLDER_ID` y `CONSECUTIVO_PROY_AAAA` (se crean solos con el primer proyecto),
`ANTHROPIC_API_KEY` (opcional; activa la IA para claves SAT; el proyecto anterior no la tenía). Nunca poner la API key en el código.

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
  **Orden obligatorio:** `clasp push` → el dueño corre una función en el editor y acepta el permiso → recién entonces `clasp deploy`.
  Si se publica antes de autorizar, la web app (que corre como el dueño) falla en **todas** las llamadas hasta que se autorice.
  People (directorio) se agregó el 20/10/2026; se autoriza con `probarDirectorio()`.

### 6.9 Proyectos
- **Opcionales al cotizar** ("Sin proyecto" por omisión). Solo se pueden elegir proyectos `Activo`; el servidor lo vuelve a revisar.
- **No hay hoja de clientes**: el cliente del proyecto es el de "Datos del cliente" (mismo datalist y autorrelleno; uno nuevo se
  escribe ahí, como siempre). Se guarda como texto + `cliente_id` (RFC o `SIN-RFC:nombre|empresa`, ver `idCliente`). Si después
  se le agrega RFC al cliente, su `id` cambia a ese RFC y los proyectos viejos conservan el `SIN-RFC:…`.
- Folio propio con contador `CONSECUTIVO_PROY_AAAA` bajo el **mismo** candado de script que las cotizaciones.
- **Subcarpetas que se reparan solas:** las subcarpetas de un proyecto se buscan **por nombre**. Si alguien borra (Papelera) o
  renombra `Cotizaciones`, `Órdenes de compra` o `Pagos`, la próxima vez que se necesite el sistema **crea una nueva** con el
  nombre correcto (la renombrada se queda como está, con sus archivos). Si se borra la carpeta completa del proyecto, se
  vuelve a crear (con sus 3 subcarpetas) y se actualiza `carpeta_id` en la hoja. Igual con `Proyectos` y su carpeta de año.
  Renombrar la carpeta **del proyecto** sí se puede (se usa por ID).
- Las cotizaciones viejas no se mueven ni se ligan a proyectos.

### 6.10 Modelo futuro (fase 2; NO construido)
- Pestañas `OrdenesCompra`, `Pagos` y `Gastos` en la base de datos, cada una con su folio (`OC-`, `PAG-`, `GAS-AAAA-NNNN`),
  contador `CONSECUTIVO_<TIPO>_AAAA` (usar `siguienteFolio_(prefijo, hoja, 'CONSECUTIVO_OC_')`), columna **`proyecto_folio`**
  y `vendedor_*` del token. Crear las pestañas con el patrón de `hojaProyectos_()` (encabezados que se migran solos).
- Archivos en `subcarpetaProyecto_(proyecto, 'Órdenes de compra' | 'Pagos')`. Gastos aún no tiene subcarpeta: agregarla a
  `SUBCARPETAS_PROYECTO` cuando se construya (los proyectos viejos la obtienen sola por §6.9).
- **Monto contratado:** la fase 2 necesitará marcar una cotización como **"Aceptada"** (columna de estatus en `Cotizaciones`)
  para definir el monto contratado del proyecto, contra el que se comparan órdenes de compra, pagos y gastos.

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

## 8. Cómo trabajar

```bash
# Pruebas (Node, servicios de Google simulados). Correr las seis antes de subir.
mkdir -p /tmp/salida-pdf && node tests/cotizacion.test.js Code.js /tmp/salida-pdf   # folios, idempotencia, marcas, Config, clientes; deja helgen.html / energy.html
node tests/catalogo.test.js .                                  # catálogo: migración, alta, edición, duplicados
node tests/sat.test.js . "$HOME/Library/CloudStorage/GoogleDrive-efrain@helgen.tech/Mi unidad/Cotizador Helgen/Catálogos SAT"
node tests/sesion.test.js .                                    # token en doPost, vendedor_* (vendedor falso se ignora)
node tests/proyectos.test.js .                                 # folio PRY, carpetas, proyecto_folio, subcarpetas que se reparan
node tests/interfaz.test.js .                                  # interfaz con DOM y fetch simulados: proyecto rechazado se limpia
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
- El flujo completo exige sesión @helgen.tech: pedir al usuario que pruebe y mande captura; los errores del servidor se ven
  con `npx clasp logs` o en el editor (Ejecuciones). Los datos se pueden revisar en solo lectura con el conector de Drive.
- Al agregar funciones que llamen servicios de Google, extender los simulacros de `tests/`. Si la interfaz necesita una
  función nueva, agregarla a `API_FUNCIONES`.

### Regla de trabajo: guardar y publicar
Al terminar **cualquier** cambio:
1. `git commit` con una descripción clara (en español) de qué cambió y por qué, y `git push` a GitHub (`origin main`).
2. Si se modificó el código de Apps Script (`Code.js`, `Logo.js`, `Index.html`, `appsscript.json`), **recordarle al usuario**
   publicar la API: `npx clasp push --force` y `npx clasp deploy --deploymentId AKfycbwBjF7…` (comandos completos arriba).
3. Si se modificó algo en `web/`, **recordarle al usuario** publicar la interfaz: `npx --yes wrangler@4 deploy`.
El commit y el push no publican nada: el equipo sigue usando la versión anterior hasta publicar con clasp o wrangler.

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
- Proyectos fase 2: órdenes de compra, pagos, gastos y cotización "Aceptada" (§6.10).
- Mover el proyecto de prueba (ya sin deployment, §10.5) a la carpeta `1w-T05ql…` junto a los "ARCHIVO PRUEBAS" (lo hace el usuario).

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
