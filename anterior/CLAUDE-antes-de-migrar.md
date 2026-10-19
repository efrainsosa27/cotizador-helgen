# Cotizador Helgen — contexto para Claude Code

Léelo completo antes de cambiar algo. Resume el sistema, dónde viven los datos y las decisiones ya tomadas
(con su porqué) para no repetir errores. Textos de la interfaz y comentarios del código: **español de México**.

## 1. Qué es

App web interna de **Helgen Servicios Especializados** para hacer cotizaciones. Corre en **Google Apps Script**
(sin servidor propio), solo para cuentas `@helgen.tech`. Flujo:

1. El usuario llena el formulario (cliente, conceptos, notas, línea de negocio Helgen / Helgen Energy).
2. El servidor **recalcula** subtotal, IVA y total, asigna un **folio único** `HLG-AAAA-0001` y genera el **PDF**.
3. El PDF se guarda en Drive (carpeta por año) y la cotización queda como una fila en Google Sheets.

Además: historial con búsqueda, catálogo de productos con precios (Google Sheets aparte), clientes sugeridos con
autorrelleno, y claves SAT internas por producto para contabilidad (con sugerencias por palabras o con IA).

**Helgen Energy** es la submarca de paneles solares: mismo folio y diseño, pero sus propios Términos y Condiciones.

## 2. Datos clave (IDs y URLs)

| Qué | Valor |
|---|---|
| URL de la app (la usa el equipo) | `https://script.google.com/a/macros/helgen.tech/s/AKfycbxahS3PbizPrRrQIC1m2uz-2G8PoT64BqPdtGLu0Ms5t9RKs2ucxH_c3tpJXkj8uLE/exec` |
| Deployment publicado (siempre actualizar este) | `AKfycbxahS3PbizPrRrQIC1m2uz-2G8PoT64BqPdtGLu0Ms5t9RKs2ucxH_c3tpJXkj8uLE` (versión @9 al 19/10/2026) |
| Proyecto Apps Script (`scriptId` en `.clasp.json`) | `1X-qSKgvqKwuDj4iPZBhXlakR5udau9ibVMevhwvlLXgtSkjV4IoQxqwU` — "Cotizador Helgen (código de la app)" |
| Carpeta maestra en Drive "Cotizador Helgen" | `1lf3Z4d3e_oqFbYJse4QbyYkWowYT9HCo` |
| Base de datos "Cotizador Helgen — Base de datos" (`SPREADSHEET_ID`) | `1ozFsyt1OjSnSv-PVpRWZjgqeWt6voQREbjvOJAXPEaI` |
| Catálogo "Catálogo Helgen" (`CATALOGO_ID`) | `11Rr0G7ZHE8PqXWsw9OpPPfGLQx8Yz7g8h1wkjJY2ahQ` |
| Carpeta PDF "Cotizaciones Helgen (PDF)" (`FOLDER_ID`) | `1CDN1LyOlA1L6z5dvBp49tlqu0fDoxdX8` |
| "Catálogos SAT (CFDI 4.0)" (`SAT_ID`) | `1B2t9tXuEj1i9JO9ybqsuH4PN1K47CqMZgoEBzd-Dmc8` (subcarpeta "Catálogos SAT" `15OYcUp41onVJoW7--b3gnLZY8ymvYbUZ`) |
| Interfaz web en Cloudflare (PRUEBAS) | `https://cotizador-helgen.cotizador-helgen.workers.dev/cotizador/` (portada en `/`). IDs de PRUEBAS en §10 |
| Dueño de todo / cuenta de clasp | `efrain@helgen.tech` (la app se ejecuta como esta cuenta) |

Los IDs reales que usa el código están en **Script Properties** (ver §5). Esta tabla es solo referencia.

## 3. Archivos del proyecto (carpeta local `~/Downloads/cotizador-helgen`)

| Archivo | Para qué |
|---|---|
| `Code.gs` | Todo el backend (ver §4). Se sube a Apps Script. |
| `Index.html` | Interfaz completa (HTML + CSS + JS en un archivo). Plantilla de HtmlService. Se sube. |
| `Logo.gs` | Logos en base64: `LOGO_HELGEN_AZUL` (PDF, fondo blanco, 700×200) y `LOGO_HELGEN_BLANCO` (encabezado azul de la app). Se sube. |
| `appsscript.json` | Manifiesto: zona `America/Mexico_City`, V8, web app `executeAs: USER_DEPLOYING`, `access: DOMAIN`. Se sube. |
| `.clasp.json` | Liga la carpeta al proyecto `1X-qSKgv…`. **No cambiar el scriptId.** |
| `.claspignore` | Lista blanca: solo se suben `Code.gs`, `Logo.gs`, `Index.html`, `appsscript.json`. |
| `tests/` | Pruebas en Node con servicios de Google simulados (ver §8). No se suben. `sesion.test.js` es de PRUEBAS (Fase 2, §10). |
| `herramientas/extraer-catalogos-sat.js` | Convierte el Excel oficial del SAT en los CSV que importa la app (ver §6.5). |
| `GUIA.md` | Guía para personas (instalación inicial). Partes desactualizadas: hoy se usa `npx clasp` y `setup()` corre solo. |
| `web/` | Portada con la marca (`index.html`, `logo-helgen-blanco.png` extraído de `Logo.gs`); su botón lleva a `web/cotizador/index.html`: la interfaz completa con una capa que imita `google.script.run` por `fetch` al `doPost` de PRUEBAS (`API_URL`). El código de pruebas (`Code.js` con `doPost`/`API_FUNCIONES`) vive solo en el proyecto de PRUEBAS, no en esta carpeta. `.assetsignore` excluye `Icon`/`.DS_Store`. No se sube a Apps Script. Ver §10. |
| `wrangler.jsonc` | Publica `web/` en Cloudflare como Worker solo de archivos estáticos (ver §10). |
| `package.json` | Solo `@google/clasp` como dependencia de desarrollo. |
| `Icon` | Archivo vacío de macOS; ignorarlo. |

No hay git inicializado en la carpeta.

## 4. Funciones de `Code.gs`

Convención: las que terminan en `_` son internas; las demás las llama la interfaz con `google.script.run`
o son lógica pura (sección 5 del archivo, sin servicios de Google, probables en Node).

### 4.1 Entrada e instalación
- `doGet()` — sirve `Index.html` como plantilla (`createTemplateFromFile(...).evaluate()`).
- `setup()` — crea la base de datos (pestañas `Cotizaciones` y `Config`) y la carpeta de PDF, y guarda sus IDs.
  **No hace falta correrla a mano:** `db_()` la ejecuta sola la primera vez (bajo candado).
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

### 4.3 Catálogos del SAT
- `libroSat_()` — abre "Catálogos SAT (CFDI 4.0)"; si no existe, `importarCatalogosSat_()`.
- `importarCatalogosSat_()` — busca en Drive `SAT_c_ClaveProdServ.csv` y `SAT_c_ClaveUnidad.csv`, crea el libro con pestañas
  `ClaveProdServ`, `ClaveUnidad` y `Fuente`, y lo deja en la carpeta de los CSV.
- `getUnidadesSat_()` — `[[clave, nombre], …]` de unidades.
- `sugerirClavesSat(texto)` *(UI)* — si el texto es una clave de 7–8 dígitos la busca exacta; si no, toma ~40 candidatos
  (`candidatosSat`) y, si existe `ANTHROPIC_API_KEY`, la IA elige las 5 mejores con razón (`ordenarConIaSat_`);
  si no hay key o falla, devuelve los 8 mejores por palabras.
- `ordenarConIaSat_(texto, candidatos)` — llama a la API de Claude (`UrlFetchApp`), guarda el resultado 6 h en caché; `null` si falla.
- `probarIaSat()` — correr desde el editor: autoriza `UrlFetchApp` y muestra en el registro sugerencias de ejemplo.
- `existeEnSat_(pestana, clave)` — valida una clave con `TextFinder` (celda completa).

### 4.4 Datos para la interfaz
- `getDatosIniciales()` *(UI, al cargar)* — IVA, vigencia, marcas, catálogo, clientes, usuario.
- `getClientes()` *(UI)* — clientes que ya cotizaron, calculados desde la hoja `Cotizaciones` (`clientesDesdeFilas`).
- `listarCotizaciones(busqueda)` *(UI)* — últimas 100 cotizaciones, filtro por folio/cliente/empresa.

### 4.5 Guardar cotización
- `guardarCotizacion(payload)` *(UI)* — normaliza, agrega clave/unidad SAT a cada concepto que venga del catálogo (si falla,
  guarda igual), toma el candado, revisa idempotencia (`payload.idSolicitud` en `CacheService`, 6 h), asigna folio,
  genera PDF, lo guarda en la carpeta del año y agrega la fila. Devuelve `{folio, url, total}`.
- `siguienteFolio_(prefijo, hojaCot)` — `max(CONSECUTIVO_AAAA, mayor folio del año en la hoja) + 1`.
- `carpetaDelAnio_(anio)` — subcarpeta `2026`, `2027`… dentro de la carpeta de PDF (la busca **por nombre**).
- `logoDataUrl_(fileId)` — logo de Drive si `LOGO_FILE_ID` tiene valor; si no, `LOGO_HELGEN_AZUL`.

### 4.6 Lógica pura (sin Google; se prueba en Node)
- `redondear(n)`, `formatoMoneda(n)`, `escaparHtml(s)`, `importeConLetra(n)` ("MIL CIENTO SESENTA PESOS 02/100 M.N.").
- `normalizarCotizacion(p, ivaTasa)` — limpia cliente/conceptos, exige nombre y ≥1 concepto, calcula importes y totales, `marca`.
- `formatearFolio`, `maxConsecutivo(folios, prefijo, anio)`.
- `clientesDesdeFilas(filas)` — agrupa por nombre+empresa normalizados (sin acentos/mayúsculas/espacios), la fila más
  reciente manda, un dato vacío no borra uno anterior; `etiqueta` = nombre, o "nombre — empresa" si el nombre se repite.
- `normalizarProducto(p)`, `indiceDeClave(claves, clave)`.
- `terminosParaPdf(cfg, marca)` — renglones de T&C de la marca; agrega la línea de vigencia si falta.
- `textoCelda(s)` — antepone `'` a texto que empiece con `= + - @` para que Sheets no lo lea como fórmula.
- SAT: `palabrasSat`, `SINONIMOS_SAT`, `PALABRAS_SERVICIO_SAT`, `buscarClavesSat(consulta, filas, n)`, `candidatosSat`,
  `solicitudIaSat`, `leerRespuestaIaSat` (solo acepta claves que estaban entre los candidatos). Modelo: `MODELO_IA_SAT`.
- `construirHtmlPdf(d, cfg, logoUrl)` — HTML del PDF (ver reglas 3–4).

### 4.7 `Index.html` (interfaz)
Tres pestañas: **Nueva cotización**, **Historial**, **Catálogo**. Funciones principales: `agregarFila`, `leerItems`,
`recalcular` (vista previa; el servidor recalcula), `guardar`, `limpiar`, `cargarHistorial`, `recibirClientes`,
`autorrellenarCliente`, `pintarDatalists`, `cargarCatalogo`, `pintarCatalogo`, `editarProd`, `guardarProd`, `sugerirSat`, `verTab`.
Autocompletado con `<datalist>`: clientes (en "Nombre"), productos por descripción y por clave, unidades SAT.

## 5. Dónde se guardan los datos

**Todo en la carpeta maestra "Cotizador Helgen"** de Mi unidad:
```
📁 Cotizador Helgen
   ├─ 📊 Cotizador Helgen — Base de datos     (Cotizaciones, Config)
   ├─ 📊 Catálogo Helgen                       (Catalogo)
   ├─ 📁 Cotizaciones Helgen (PDF) / 📁 2026 / HLG-2026-0001 - Cliente.pdf
   ├─ 📁 Catálogos SAT / SAT_c_ClaveProdServ.csv, SAT_c_ClaveUnidad.csv, 📊 Catálogos SAT (CFDI 4.0)
   └─ 📜 Cotizador Helgen (código de la app)
```

**Pestaña `Cotizaciones`** (16 columnas, 1 fila por cotización): Folio, Fecha, Cliente, Empresa, RFC, Correo, Teléfono,
Subtotal, IVA, Total, Elaboró, PDF (link), Conceptos (JSON: clave, descripcion, unidad, cantidad, precio, importe y, si vienen
del catálogo, claveSat/unidadSat), Notas, Marca (Helgen / Helgen Energy), Dirección. Las columnas Marca y Dirección se
agregaron después: `guardarCotizacion` reescribe la fila de encabezados si no coincide con `ENCABEZADOS_COTIZACIONES`.
En PRUEBAS la hoja tiene 19 columnas: además `vendedor_email`, `vendedor_nombre`, `vendedor_apellido` (Fase 2, §10.5).

**Pestaña `Config`** (Clave | Valor, columna B en formato texto): `EMPRESA_NOMBRE` (Helgen Servicios Especializados),
`EMPRESA_RFC` (HSE240304PC1), `EMPRESA_DIRECCION`, `EMPRESA_TELEFONO` (+52 442 644 5391), `EMPRESA_EMAIL`, `EMPRESA_WEB`,
`PREFIJO_FOLIO` (HLG), `IVA_TASA` (0.16), `VIGENCIA_DIAS` (15), `MONEDA`, `LOGO_FILE_ID` (vacío = logo de `Logo.gs`),
`TERMINOS_HELGEN`, `TERMINOS_ENERGY` (un término por renglón dentro de la celda).

**"Catálogo Helgen" / pestaña `Catalogo`**: Clave (única, mayúsculas), Descripción, Unidad, Precio unitario (sin IVA),
Actualizado, Actualizó, Clave SAT, Unidad SAT. A:C y G:H en formato texto.

**Script Properties** (Configuración del proyecto en el editor):
`SPREADSHEET_ID`, `FOLDER_ID`, `CATALOGO_ID`, `SAT_ID`, `CONSECUTIVO_AAAA` (p. ej. `CONSECUTIVO_2026`),
`ANTHROPIC_API_KEY` (opcional; activa la IA para claves SAT). Nunca poner la API key en el código.

## 6. Decisiones tomadas (y por qué)

### 6.1 Folios sin duplicados
- Todo el guardado va dentro de `LockService.getScriptLock()` con `tryLock(30000)` y mensaje en español si se agota.
- El folio sale del **mayor** entre el contador y el último folio de la hoja: si alguien borra o edita `CONSECUTIVO_AAAA`, no se repite.
- **Idempotencia:** el formulario manda `idSolicitud` (UUID por cotización, se renueva al limpiar); un doble clic o reenvío devuelve el mismo folio.
- Borrar una fila no hace retroceder el contador (intencional). El consecutivo reinicia cada año.

### 6.2 Instalación y migraciones automáticas
- La app se instala sola (`db_()` → `setup()`, `hojaCatalogo_()` → `crearCatalogo_()`, `libroSat_()` → `importarCatalogosSat_()`),
  porque correr `setup()` a mano falló la primera vez.
- Toda estructura nueva se migra sola al abrir la app (Config, columnas del catálogo, encabezados de Cotizaciones).
  Al agregar columnas o claves, seguir este patrón: **nunca pedir al usuario que edite la hoja a mano**.

### 6.3 PDF (lecciones del conversor HTML→PDF de Google)
- **No imprime colores de fondo** (`background`): con la banda azul, el logo blanco y el texto blanco desaparecieron.
  Por eso el PDF usa texto azul, líneas y bordes; `bgcolor` solo como extra opcional.
- No soporta flex/grid: solo tablas e inline CSS. Fuente del PDF: Arial (las web fonts no son confiables ahí).
- Logo azul en el PDF; el blanco solo sobre fondo azul.
- No hay forma local de ver el PDF real: para revisar, renderizar el HTML **quitando los fondos** (simula al conversor).

### 6.4 Interfaz
- En la plantilla, imágenes `data:` se insertan con `<?!= ?>`: `<?= ?>` las bloquea por seguridad.
- Fuentes de Google (League Spartan, Roboto Mono) sí funcionan en la app.
- Máximo 3 módulos por vista. Mensajes de error en español.

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
- **Peligro:** la carpeta local `~/Downloads` (incluida esta carpeta del proyecto) se sincroniza a Drive en una carpeta
  "Downloads" (`1BBB4vyr9WW1TowC6Uemtd3K6V7_NitAh`). No mover ni borrar esas copias desde Drive: afectaría la carpeta local.
- Google Drive para escritorio está montado en `~/Library/CloudStorage/GoogleDrive-efrain@helgen.tech/Mi unidad/`:
  sirve para dejar archivos en Drive (así se subieron los CSV del SAT).

### 6.8 clasp
- clasp está instalado **local** en el proyecto (instalar global pedía permisos de administrador): usar siempre `npx clasp`.
- **No volver a correr `clasp create`**: crea otro proyecto y sobrescribe `appsscript.json` (pone zona de Nueva York y
  quita la configuración de web app). Ya pasó y hubo que borrar un proyecto duplicado.
- Publicar siempre sobre el mismo deployment (misma URL para el equipo). Nunca `clasp deploy` sin `--deploymentId`.
- Si se agrega un servicio nuevo de Google o `UrlFetchApp`, el dueño debe autorizar el permiso una vez desde el editor.

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

## 8. Cómo trabajar

```bash
# Pruebas (Node, servicios de Google simulados). Correr las tres antes de subir.
mkdir -p /tmp/salida-pdf && node tests/cotizacion.test.js Code.gs /tmp/salida-pdf   # folios, idempotencia, marcas, Config, clientes; deja helgen.html / energy.html
node tests/catalogo.test.js .                                  # catálogo: migración, alta, edición, duplicados
node tests/sat.test.js . "$HOME/Library/CloudStorage/GoogleDrive-efrain@helgen.tech/Mi unidad/Cotizador Helgen/Catálogos SAT"
node tests/probar-busqueda-sat.js Code.gs "<ruta>/SAT_c_ClaveProdServ.csv"   # ver qué sugiere la búsqueda por palabras
node tests/sesion.test.js <clon de PRUEBAS con Code.js y Logo.js>   # Fase 2: token en doPost, vendedor_* (ver §10)

# Subir y publicar (misma URL)
npx clasp push --force
npx clasp deploy --deploymentId AKfycbxahS3PbizPrRrQIC1m2uz-2G8PoT64BqPdtGLu0Ms5t9RKs2ucxH_c3tpJXkj8uLE -d "descripción del cambio"
npx clasp list-deployments

# Interfaz web en Cloudflare: ver §10
npx --yes wrangler@4 deploy
```

- Antes de `push`, confirmar que `.clasp.json` apunta a `1X-qSKgv…`.
- Revisar sintaxis del JS de la interfaz: extraer el `<script>` de `Index.html` y `node --check`.
- La app exige sesión @helgen.tech: no se puede probar la URL publicada desde un navegador sin sesión. Pedir al usuario
  que pruebe y mande captura; los errores del servidor se ven con `npx clasp logs` o en el editor (Ejecuciones).
- Al agregar funciones que llamen servicios de Google, extender los simulacros de `tests/`.

## 9. Pendientes e ideas
- **Fase 2 probada y funcionando en PRUEBAS (19/10/2026, confirmado por el usuario)** (§10.5). Siguiente: decidir si se lleva al proyecto real.
- La IA para claves SAT no se ha probado contra la API real; requiere `ANTHROPIC_API_KEY` y correr `probarIaSat()` en el editor.
- Existen archivos previos de Helgen Energy en Mi unidad (no movidos): "Catálogo Maestro de Precios - Helgen Energy" (Sheets),
  "Catálogo Helgen Energy - Soluciones 2026" (Slides), "COTIZADOR HELGEN ENERGY.html". Se ofreció importar esos precios al catálogo.
- Si Helgen Energy tiene logo/colores propios, aplicarlos solo a sus cotizaciones.
- Ideas mencionadas: enviar PDF por correo, duplicar cotización, estatus (Enviada/Aceptada/Rechazada), descuentos por renglón.

## 10. Interfaz web en Cloudflare (proyecto de PRUEBAS)

Objetivo: servir la interfaz desde Cloudflare (fuera de script.google.com) y que hable con Apps Script por `doPost`.
Se trabaja **solo contra un proyecto de PRUEBAS** con datos inventados; el proyecto real (`1X-qSKgv…`) no se tocó.

### 10.1 Estado (19/10/2026)
- **Fase 1: probada y funcionando** (confirmado por el usuario). Interfaz publicada en Cloudflare y conectada a la API de PRUEBAS.
- **Fase 2: probada y funcionando** (API @2 + Cloudflare, 19/10/2026). El usuario inició sesión, guardó una cotización y vio el vendedor (§10.5).

### 10.2 Direcciones y archivos
| Qué | Valor |
|---|---|
| Interfaz (para probar) | `https://cotizador-helgen.cotizador-helgen.workers.dev/cotizador/` |
| Portada (botón "Abrir el cotizador" → `cotizador/`) | `https://cotizador-helgen.cotizador-helgen.workers.dev` |
| Worker de Cloudflare | `cotizador-helgen` (solo archivos estáticos de `web/`), cuenta Cloudflare de efrain@helgen.tech `badd8bca60b008822a73ca24e983ff43`, subdominio `cotizador-helgen.workers.dev` |
| Carpeta en Drive "PRUEBAS — Cotizador web" | `1w-T05ql62SXxsm3z4u-xCpMjcdXc0b0p` (Mi unidad; contiene los 4 de abajo) |
| Proyecto Apps Script "Cotizador Helgen — PRUEBAS interfaz web" | `1GsH8DjaFEZ9dltqBUTUEFE_frblSYimRRCvPkqKdRB5UhmBwwYHLSwyS` |
| Deployment de la API (`API_URL` en `web/cotizador/index.html`) | `AKfycbwBjF7ra_4O8INsxBq0eh-4r-BlSsJ4LLxcJgVCPRpx1U1a-Pz1CUSdYtvj_Mh0S6y2` (@2 Fase 2, `access: ANYONE_ANONYMOUS`) |
| Client ID de OAuth (`CLIENT_ID_GOOGLE`, en `web/cotizador/index.html` y en el `Code.js` de PRUEBAS) | `884526916417-cn5fh45io0nnpvlad2439thkpius4063.apps.googleusercontent.com` (no es secreto) |
| "PRUEBAS — Cotizador Helgen — Base de datos" (`SPREADSHEET_ID`) | `10WLYHF2vB2TDmoTXwfAxnG8bp7gDOPPzoj9p6B0tUGY` |
| "PRUEBAS — Catálogo Helgen" (`CATALOGO_ID`) | `1GQBK0_WXSQRuCOeE-Pv8AA6PFA4tjZwCqae4L7WZsH0` |
| "PRUEBAS — Cotizaciones Helgen (PDF)" (`FOLDER_ID`) | `1iDk4faAM557SZh67EA122dj6eU4RJpsH` |

El usuario confirmó en las Script Properties del proyecto de PRUEBAS que todo apunta a estos archivos de prueba.
Como la app usa IDs (§6.7), moverlos a la carpeta "PRUEBAS — Cotizador web" no rompió nada.

### 10.3 Cómo funciona y cómo se publica
- `web/cotizador/index.html` es `Index.html` con el logo ya incrustado (sin etiquetas `<? ?>`) y un `<script id="api-web">`
  que, si no existe `google.script.run`, lo imita con `fetch(API_URL)` (POST `text/plain` para evitar la consulta CORS previa;
  cuerpo `{"funcion", "args", "token"}`, respuesta `{"ok", "datos" | "error", "codigo"?}`; `codigo: "SESION"` = falta sesión o no es válida).
- En el proyecto de PRUEBAS, `doPost` primero verifica el token (§10.5) y luego solo acepta las funciones de `API_FUNCIONES`
  (las mismas que usa la interfaz).
- Publicar (desde la carpeta del proyecto; usa `wrangler.jsonc`):
  ```bash
  npx --yes wrangler@4 deploy
  ```
  Si pide sesión: `npx --yes wrangler@4 login` (el usuario autoriza en su navegador). Wrangler se usa con `npx`, sin instalarlo.
- Wrangler 4 ya delega Cloudflare Pages "clásico" a Workers: se eligió **Worker con assets** (`wrangler.jsonc`), no `wrangler pages`.
- Probar local: `python3 -m http.server 8788 --bind 127.0.0.1` dentro de `web/`.
- Para comprobar la API con `curl`, usar `-d` sin `-X POST`: con `-X POST -L` curl repite el POST en la redirección
  de Google y sale "No se encontró la página" aunque la API funcione.

### 10.4 Riesgo aceptado y Fase 2
- **Riesgo aceptado por el usuario (19/10/2026, Fase 1):** la API de PRUEBAS no pedía identidad. Desde la Fase 2 (@2) exige token
  de @helgen.tech en cada llamada. Aun así, en PRUEBAS solo van **datos inventados**.
- **Nunca** apuntar `API_URL` al proyecto real (`1X-qSKgv…`) ni publicar ahí un `doPost` sin la Fase 2.
- **Fase 2 (hecha en PRUEBAS):** login con Google restringido a cuentas @helgen.tech, con el token verificado en `doPost`. Ver §10.5.

### 10.5 Fase 2: sesión con Google (solo en PRUEBAS)
Probada y funcionando (19/10/2026): el usuario inició sesión, guardó una cotización y vio su nombre en el historial.

**Google Cloud (cliente OAuth)**
- Client ID (tipo "Aplicación web"): `884526916417-cn5fh45io0nnpvlad2439thkpius4063.apps.googleusercontent.com`. No es secreto;
  está en dos lugares que deben coincidir: `CLIENT_ID_GOOGLE` en `web/cotizador/index.html` y en el `Code.js` de PRUEBAS.
  El secreto del cliente no se usa ni se guarda en ningún lado.
- Pantalla de consentimiento: **External en modo Testing, con usuarios de prueba agregados a mano** (decisión del usuario;
  no se usó "Interna"). Consecuencias:
  - Solo pueden entrar las cuentas de la lista de usuarios de prueba. **Para dar acceso a otro vendedor hay que agregarlo** en
    Google Cloud Console → Pantalla de consentimiento de OAuth (Google Auth Platform) → Público → Usuarios de prueba.
  - Con External, Google **no** limita por dominio: una cuenta @gmail en la lista podría obtener un token. Por eso el
    servidor exige `hd` y `email_verified` (y la prueba lo cubre). No quitar esas revisiones.
  - Antes de usarlo con todo el equipo: cambiar a "Interna" (requiere que el proyecto de Cloud esté en la organización helgen.tech).
- Orígenes autorizados de JavaScript: `https://cotizador-helgen.cotizador-helgen.workers.dev` y `http://127.0.0.1:8788`.
  Sin URIs de redireccionamiento. Un origen nuevo tarda de minutos a horas; mientras, el botón da `origin_mismatch`.

**Interfaz (`web/cotizador/index.html`, `<script id="api-web">`)**
- Carga Google Identity Services (`https://accounts.google.com/gsi/client`). La pantalla `#login` tapa la app hasta tener token;
  botón "Acceder con Google" + One Tap, con `hd: 'helgen.tech'` (solo filtra la lista de cuentas; quien decide es el servidor).
- El ID token va en **cada** llamada como `"token"`. Se guarda en `sessionStorage` y se reutiliza hasta 1 min antes de expirar
  (~1 h); las llamadas sin sesión vigente esperan en cola hasta que se inicia sesión.
- Si el servidor responde `codigo: "SESION"`, se borra el token, se muestra el login y la llamada se repite **una vez** al entrar
  (guardar es idempotente por `idSolicitud`: no duplica folio).
- Encabezado: nombre del vendedor (del token, solo para mostrar) + botón "Cerrar sesión" (`disableAutoSelect`).
- Tras publicar, el navegador puede mostrar la versión anterior en caché: recargar la página.

**Verificación del token en `doPost` (`Code.js` de PRUEBAS)**
1. `doPost` lee el cuerpo y, **antes de buscar la función**, llama `verificarTokenGoogle_(cuerpo.token)`.
   Sin token o con token inválido no se ejecuta nada: responde `{"ok": false, "error": "…", "codigo": "SESION"}`.
2. `verificarTokenGoogle_()`: busca en `CacheService` por la huella SHA-256 del token (`TOK_…`). Si no está, consulta
   `https://oauth2.googleapis.com/tokeninfo?id_token=…` con `UrlFetchApp`: Google revisa **firma y expiración**; si no
   responde 200, es sesión inválida.
3. `validarClaimsToken(claims, clientId, dominio, ahora)` (lógica pura, en la sección 5, probada en Node) exige:
   `aud === CLIENT_ID_GOOGLE`, `iss` = `accounts.google.com` o `https://accounts.google.com`, `exp` en el futuro,
   `hd === 'helgen.tech'`, `email_verified` verdadero y correo terminado en `@helgen.tech`. Devuelve
   `{email, nombre, apellido}` (de `given_name`/`family_name`; si faltan, se parte `name`). Todo error lleva `sesion = true`.
4. El resultado se guarda en caché hasta que el token expire (máx. 10 min) para no consultar a Google en cada clic.
5. El vendedor queda en la variable global `VENDEDOR_` **solo durante esa petición** (se limpia en `finally`).
   `usuarioActual_()` reemplaza a `Session.getActiveUser()`, que con `ANYONE_ANONYMOUS` viene vacío.
- `UrlFetchApp` ya tenía permiso en PRUEBAS (comprobado). Si se cambia de proyecto, el dueño debe autorizarlo una vez desde el editor.
- **`doGet` ya no sirve la app** en PRUEBAS: con `ANYONE_ANONYMOUS`, una página de HtmlService permitiría llamar funciones con
  `google.script.run` sin token. Ahora solo responde un texto. (`Index.html` sigue en el proyecto pero no se usa.)

**Columnas de vendedor (hoja `Cotizaciones` de PRUEBAS, 19 columnas)**
- Se agregaron al final (Q:S) `vendedor_email`, `vendedor_nombre`, `vendedor_apellido`. Se llenan con el token verificado,
  **nunca** con lo que mande el navegador (la prueba manda un vendedor falso y comprueba que se ignora). Pasan por `textoCelda`.
- Se migran solas: `guardarCotizacion` reescribe los encabezados si no coinciden con `ENCABEZADOS_COTIZACIONES`.
- "Elaboró" (columna K y el PDF) = correo del token. `guardarCotizacion` sin vendedor verificado lanza error de sesión.
- "Actualizó" del catálogo (`guardarProducto`) también usa `usuarioActual_()`.
- Historial: la columna se llama **"Vendedor"**: `listarCotizaciones` devuelve `vendedor` = nombre + apellido; si la fila es vieja
  (sin esas columnas), el correo de `vendedor_email` o de "Elaboró".
- `getDatosIniciales` devuelve `usuario` (correo) y `vendedor` (`{email, nombre, apellido}`).

**Trabajar con el código de PRUEBAS** (no vive en esta carpeta)
```bash
npx clasp clone 1GsH8DjaFEZ9dltqBUTUEFE_frblSYimRRCvPkqKdRB5UhmBwwYHLSwyS   # en una carpeta temporal (no aquí)
node <ruta>/cotizador-helgen/tests/sesion.test.js <esa carpeta>
npx clasp push --force                                                        # desde esa carpeta
npx clasp deploy --deploymentId AKfycbwBjF7ra_4O8INsxBq0eh-4r-BlSsJ4LLxcJgVCPRpx1U1a-Pz1CUSdYtvj_Mh0S6y2 -d "descripción"
```
- Antes de `push`, confirmar que el `.clasp.json` de esa carpeta apunta a `1GsH8Dja…` y que nadie cambió el proyecto
  (volver a clonar en otra carpeta y comparar).
- Comprobar con `curl` (ver §10.3): sin token → `{"ok":false,"error":"Inicia sesión con tu cuenta @helgen.tech.","codigo":"SESION"}`;
  token falso → `"Tu sesión expiró o no es válida…"`.
