# Cotizador Helgen

App web interna de **Helgen Servicios Especializados** (y su submarca **Helgen Energy**) para cotizar, llevar proyectos,
cobrar a clientes y comprar a proveedores. Solo entran cuentas `@helgen.tech`.

| | |
|---|---|
| **Usar la app** | https://cotizador-helgen.cotizador-helgen.workers.dev/cotizador/ |
| Portada | https://cotizador-helgen.cotizador-helgen.workers.dev/ |
| Manual para personas | "Manual del Cotizador Helgen" (documento de Claude Docs; enlace en `CLAUDE.md` §2) |
| Detalle técnico | [`CLAUDE.md`](CLAUDE.md): decisiones, datos, IDs y reglas. Léelo antes de cambiar algo. |

## Qué hace

**Ventas y cobranza (cuentas por cobrar)**

1. **Cotización** `HLG-AAAA-NNNN`: el servidor recalcula subtotal, IVA y total, asigna el folio, genera el PDF y lo guarda
   en Drive. MXN o USD; línea Helgen o Helgen Energy (cada una con sus términos).
2. **Proyecto** `PRY-AAAA-NNNN-XXX` (opcional): agrupa cotizaciones, compras y cobranza; tiene su carpeta en Drive.
3. **Cobranza** `PAG-AAAA-NNNN`: cotización aceptada → contrato firmado → esquema de pagos por etapas → pagos con
   comprobante. Resumen de todos los proyectos (contratado, cobrado, por cobrar, margen) con descarga CSV.

**Compras (cuentas por pagar)**

1. **Requisición** `REQ-AAAA-NNNN`: un trabajador pide material para un proyecto, sin precios, con la cotización del
   proveedor adjunta.
2. **Autorización y orden de compra** `OC-AAAA-NNNN`: compras revisa, autoriza y captura costos y días de crédito; se
   genera el PDF de la orden.
3. **Factura del proveedor** `FPR-AAAA-NNNN`: CFDI 4.0 con su XML (el servidor lee emisor, importes y folio fiscal), o
   factura de proveedor extranjero con su PDF. Vencimiento = fecha de emisión + días de crédito de la orden. Vista
   **Cuentas por pagar**: por moneda y antigüedad, órdenes sin factura completa y complementos de pago (REP) pendientes.
4. **Pago al proveedor** `PGP-AAAA-NNNN` con comprobante (el total de la orden, o el de sus facturas si ya la cubren y
   traen retenciones), y **recepción** del material por quien lo pidió.

Cada rol ve solo lo suyo: quien pide material no ve montos; compras no ve el contrato ni el margen; el margen solo lo ve
cobranza. Los permisos los revisa el servidor en cada llamada.

## Cómo está armado

| Parte | Tecnología | Dónde |
|---|---|---|
| Interfaz | Una página estática (`web/cotizador/index.html`) | Cloudflare Worker con archivos estáticos (`wrangler.jsonc`) |
| Sesión | Google Identity Services; el servidor verifica el token de Google en cada llamada | Cliente OAuth en Google Cloud |
| API y lógica | Google Apps Script (`Code.js`), llamada por `doPost` | Proyecto de Apps Script (se publica con `clasp`) |
| Datos | Google Sheets: base de datos (cotizaciones, proyectos, config), catálogo, libro de cobranza y libro de compras | Google Drive (los libros de cobranza y compras están restringidos) |
| Archivos | PDF de cotizaciones y órdenes, comprobantes, cotizaciones de proveedores, facturas | Google Drive |
| Pruebas | Node con los servicios de Google simulados | `tests/` |

No hay servidor propio ni base de datos SQL: todo vive en la cuenta de Google Workspace de Helgen.

## Trabajar en el código

Requisitos: Node 18 o más reciente y acceso al repositorio. `clasp` va como dependencia local (`npx clasp`).

```bash
git clone https://github.com/efrainsosa27/cotizador-helgen.git
cd cotizador-helgen
npm install          # instala clasp (solo hace falta para publicar)
```

Antes de proponer un cambio, corre las pruebas (no tocan Google; usan simulacros):

```bash
mkdir -p /tmp/salida-pdf && node tests/cotizacion.test.js Code.js /tmp/salida-pdf
for t in catalogo sesion proyectos interfaz cobranza compras requisiciones facturas; do node tests/$t.test.js . || break; done
# La de claves SAT necesita la carpeta "Catálogos SAT" de Drive:
node tests/sat.test.js . "<ruta a Mi unidad>/Cotizador Helgen/Catálogos SAT"
```

Reglas que no se rompen (lista completa en `CLAUDE.md` §7):

- Los totales siempre los calcula el servidor; el navegador solo muestra una vista previa.
- Nunca se suman importes de monedas distintas.
- Los datos de cobranza solo van en su libro; los de compras, en el suyo. Nunca en la base de datos general (la lee todo el dominio).
- Toda función nueva que escriba datos va en `CAMBIOS_API`; toda función que llame la interfaz, en `API_FUNCIONES`.
- Textos de la interfaz, comentarios y mensajes de commit en español de México.
- Nunca subir secretos (API keys, tokens, `.clasprc.json`).

## Ramas y repositorio

- **GitHub** (`efrainsosa27/cotizador-helgen`) es el repositorio principal. Los cambios entran por *pull request* a `main`.
- **git.helgen.online** (`leo/cotizador-helgen`) es una réplica de solo lectura que se sincroniza desde GitHub.
- Un *merge* a `main` **no publica nada**: el equipo sigue usando la versión anterior hasta que se publica (abajo).

## Publicar

Lo hace quien tiene acceso a la cuenta dueña del proyecto de Apps Script y del Worker de Cloudflare (hoy, Efrain).
Pasos completos y precauciones en `CLAUDE.md` §8.

1. **Probar primero en PRUEBAS**, el proyecto de Apps Script de prueba con datos inventados (`CLAUDE.md` §10.5). Nunca se prueba sobre los datos reales.
2. **Respaldar** los libros que cambian de estructura.
3. **API** (mismo deployment, así la dirección no cambia):
   ```bash
   npx clasp push --force
   npx clasp deploy --deploymentId <ID del deployment de CLAUDE.md §2> -d "qué cambió"
   ```
   Si el cambio usa un servicio nuevo de Google: `clasp push`, autorizar corriendo una función desde el editor, y hasta
   entonces `clasp deploy`.
4. **Interfaz** (si cambió algo en `web/`):
   ```bash
   npx --yes wrangler@4 deploy
   ```
5. Actualizar `CLAUDE.md` y el Manual del Cotizador en el mismo cambio.

## Archivos

| Archivo | Para qué |
|---|---|
| `Code.js` | Todo el servidor: API, permisos, Sheets, Drive, PDF y la lógica pura (sección 5, probada en Node) |
| `Logo.js` | Logos en base64 para los PDF |
| `appsscript.json` | Manifiesto de Apps Script (zona horaria, web app) |
| `web/` | Portada e interfaz (`web/cotizador/index.html`) |
| `tests/` | Pruebas en Node con Google simulado |
| `herramientas/` | Conversión de los catálogos del SAT a CSV |
| `anterior/` | Proyecto viejo (en desuso; solo para regresar) |
| `Index.html`, `GUIA.md` | Interfaz y guía del proyecto anterior (desactualizadas) |
| `CLAUDE.md` | Contexto técnico completo para quien mantiene la app |

## Acceso para personas nuevas

- La pantalla de consentimiento de Google está en modo de prueba: cada cuenta nueva se agrega a mano en Google Cloud
  (`CLAUDE.md` §10.1).
- Los roles (cobranza, compras, requisiciones) se dan en las Script Properties del proyecto de Apps Script (`CLAUDE.md` §5).
  Para abrir los PDF de compras o cobranza, además hay que compartir esa carpeta en Drive con la persona.
