# Incremento 4 (CAPRI) · módulo E: Anular

Aprobado por Leo: "Void and hide" y "void reaches everything, sales and collections included" (spec, sección "Void instead of
delete", punto 5 de la aprobación). Rama `incremento-4-anular`, sobre la base `7756502`.

**Qué hace.** Un super admin anula cualquier registro con folio y todo lo que depende de él. Anular **no es borrar**: las
filas se quedan (los folios nunca se vuelven a usar), el registro pasa a `Anulada` (los proyectos a `Cancelado`) y desaparece de
todas las listas y totales. Antes de confirmar se ve exactamente lo que se va a anular, lo que cambia en lo que sigue en pie y a
quién se avisa. Restaurar **no** es parte de este incremento.

## 1. Funciones (Code.js §6.E)

**API** (las tres exigen `exigirSuperAdmin_`; se conectan con `modAnular_()`):

| Función | Qué hace |
|---|---|
| `previsualizarAnulacion(folio)` | Solo lee. Devuelve `{folio, tipo, descripcion, registros: [{tipo, folio, descripcion, estado}], efectos: [texto], avisos: [texto], archivos (cuántos se renombran), carpeta (nombre actual de la carpeta del proyecto), para (correos que se avisan)}`. |
| `anular(folio, motivo, idSolicitud)` | Motivo de 10 a 500 caracteres; candado de script (`conCandado_`) e idempotencia (`ANU_<idSolicitud>`, 6 h). Recalcula el plan dentro del candado, lo aplica y devuelve lo mismo que la vista previa más `fallas` (lo que no se pudo renombrar en Drive) y `anulados` (la lista nueva). |
| `listarAnulados(filtro)` | Lista de Administración (solo lectura): una entrada por anulación, las más recientes primero (máx. 200), con `fecha, correo, nombre, tipo, folio, motivo, descripcion, registros, efectos, archivos, carpeta`. `filtro` = texto (o `{buscar}`): busca en folio, tipo, motivo, correo, descripción y en los folios de la cascada. En caché por la versión de `anulaciones`. |

`modAnular_()` → `cambios: { anular: [anulaciones, proyectos, contratos, cotizaciones, requisiciones, oc, pagosCobranza,
pagosProveedores, facturasProveedor] }` (una anulación puede tocar cualquier colección y es rara: se suben todas y los
navegadores vuelven a pedir sus listas). `sincronizar`: si el contexto trae `anulados: true` y cambió `anulaciones`, manda
`r.anulados` (solo super admin; con `ctx.anuladosBuscar`).

**Lógica pura** (en §6.E, probada en Node): `folioParaAnular(texto)` → `{clave, folio}` (el tipo sale del prefijo: `PRY`,
`PAG`, `REQ`, `OC`, `PGP`, `FPR`, `REC`; cualquier otro prefijo `XX-AAAA-NNNN` es una cotización, así sirve también si cambia
`PREFIJO_FOLIO`; `PRY-AAAA-NNNN-XXX` se guarda con la llave corta; `CONTRATO PRY-…` para contratos), `idDeUrlDrive(url)`,
`jsonCelda(valor)` (JSON que cabe en una celda: recorta textos largos), `ocVigente(orden)` (ni Cancelada ni Anulada).

**Para todos los módulos** (una sola definición, en §6.E; ver §4): `esAnulado_(folio)` → booleano (mayúsculas o minúsculas;
un proyecto también con su clave) y `foliosAnulados_()` → `{FOLIO: true}`.

**Internas:** `proyectosVisibles_()`,
`anuladosDeHoja_()`, `datosAnular_()` (lee todo lo que una anulación puede tocar, también lo ya anulado o cancelado; no crea
pestañas: `filasSiHay_`), `planAnulacion_(datos, objetivo)` (la cascada; no cambia nada), `resumenPlan_`, `nombreCarpetaPlan_`,
`motivoAnular_`, `libroAnulaciones_()` (exige el libro de Administración), `aplicarAnulacion_` (hojas, efectos, Bitacoras de
área, Drive), `registrarAnulacion_` (Anulaciones + Bitacora de Administración), `listarAnuladosDeHoja_`, `reqDeDatos_`.
Constantes: `ESTADO_ANULADA = 'Anulada'`, `PREFIJO_ARCHIVO_ANULADO = 'ANULADA — '`, `PREFIJO_CARPETA_ANULADA = 'ANULADO — '`,
`TIPOS_ANULAR`, `PREFIJOS_ANULAR`, `MOTIVO_ANULAR_MIN/MAX`.

## 2. Cascada

| Se anula | Arrastra (queda Anulado) | Cambia en lo que sigue en pie |
|---|---|---|
| **Proyecto** `PRY` | sus cotizaciones, su contrato (aceptado o firmado), sus pagos de cliente, sus requisiciones y sus órdenes (cada una con su cascada) | su carpeta principal en Drive pasa a «ANULADO — …» (por `carpeta_id`; las privadas `Cobranza/AAAA/PRY-…` y `Compras/AAAA/PRY-…` **no** se renombran: se buscan por nombre) |
| **Cotización** `HLG` | si es la aceptada del proyecto: el contrato (aceptado o firmado) y sus pagos | el proyecto queda sin aceptada (y, sin contrato firmado, vuelve al buscador de cotizaciones) |
| **Contrato** `CONTRATO PRY-…` | sus pagos de cliente; su esquema de pagos se borra (copia en Anulaciones) | la cotización sigue en el proyecto, sin aceptar; se puede aceptar otra (o la misma) y queda en otra fila |
| **Pago de cliente** `PAG` | — | cobrado, saldo y avance por etapa se recalculan solos (`resumenCobranza` solo cuenta Vigentes) |
| **Requisición** `REQ` | todas sus órdenes (también las canceladas, para que no se vean) con su cascada | — |
| **Orden de compra** `OC` | sus pagos a proveedor, facturas y recepciones (REC) | su requisición, si su orden vigente era esta: **con aprobación de operaciones → Aprobada**, sin orden, sin visto bueno y con la propuesta retirada (`propuestaRetirada_`: conserva el número de versión y los archivos; compras la cotiza de nuevo como versión siguiente); **sin aprobación (flujo de siempre) → Solicitada** sin orden (como `cancelarOrdenCompra`) |
| **Pago a proveedor** `PGP` | — | si estaba Vigente, la orden queda por pagar otra vez: orden Pagada/Recibida → Emitida; requisición Pagada → Autorizada, Cerrada → Recibida (el material ya estaba; al pagar otra vez queda Cerrada) |
| **Factura de proveedor** `FPR` | — | lo facturado y las cuentas por pagar de la orden se recalculan |
| **Recepción** `REC` (todas sus filas) | — | si tenía filas Vigentes, la orden espera el material otra vez: requisición Recibida → Autorizada (como `cancelarRecepcion`), Cerrada → Pagada y la orden Recibida → Pagada; se borra la fecha y quién recibió en la orden |

Lo que ya estaba anulado no se repite. La vista previa y `anular` usan el mismo `planAnulacion_` (la prueba compara las dos).

**Avisos.** `notificar_('anulado', {folio, tipo, motivo, cascada: [{tipo, folio}], para})` con los involucrados de cada registro:
quien lo registró (vendedor, quien aceptó y firmó, quien registró el pago, quien elaboró la orden, quien registró la factura o la
recepción) y, de las requisiciones, quien pidió y quien recibe. Sin montos ni descripciones. Por cada orden anulada que no estaba
ya Cancelada: `avisarPortal_('oc.cancelada', folioOc)`. La vista previa avisa que **el material que el centro de mando ya recibió
se queda ahí**.

## 3. Qué se escribe

| Registro | Hoja (libro) | Cambio |
|---|---|---|
| Proyecto | `Proyectos` (Base de datos) | Estado (G) = `Cancelado` (la lista desplegable solo admite Activo/Cerrado/Cancelado); se esconde por el registro de Anulaciones |
| Cotización | `Cotizaciones` | nada (no tiene estado): la esconde el registro de Anulaciones |
| Contrato | `Contratos` (cobranza) | `estado` (H) = `Anulada`, `actualizado`; filas de `Esquemas` del proyecto borradas |
| Pago de cliente | `Pagos` | `estado` = `Anulada` |
| Requisición | `Requisiciones` (compras) | `estado` = `Anulada`, `motivo` = "Anulada: …", `actualizado`; evento en `RequisicionesEventos` |
| Orden | `OrdenesCompra` | `estado` (AC) = `Anulada` |
| Pago a proveedor | `PagosProveedores` | `estado` = `Anulada` |
| Factura | `FacturasProveedor` | `estado` (AD) = `Anulada` |
| Recepción | `MovimientosInventario` | `estado` = `Anulada` en cada fila del folio REC |

En pagos, órdenes, facturas y recepciones, las columnas de cancelación (quién, cuándo, motivo "Anulada: …") se llenan **solo si
estaban vacías**: una cancelación anterior se conserva (y la copia completa queda en Anulaciones).

**Anulaciones** (libro de Administración, columnas de `HOJAS_ADMIN.Anulaciones`): **una fila por registro anulado**. La raíz
lleva en `cascada (JSON)` `{raiz: true, descripcion, registros, efectos, archivos, carpeta}`; las demás `{de: <folio raíz>,
tipoRaiz}`. `antes (JSON)` = `{hoja, fila, valores}` con la fila tal como estaba (recepción: `{hoja, filas: [...]}`; contrato:
además `esquema`). Recorte con `jsonCelda` si no cabe en la celda. Además: un renglón en la **Bitacora del área** por registro
(cobranza: contrato y pagos; compras: requisición, orden, pago, factura, recepción y cada efecto) y uno en la **Bitacora de
Administración** por anulación.

**Drive.** Los archivos se quedan donde están con «ANULADA — » al inicio: PDF de la cotización (su id sale de la liga de la
columna L), comprobantes de pagos de cliente y a proveedor, PDF de la orden, XML y PDF de facturas, foto de la recepción,
cotización del solicitante y archivos de la propuesta. Un archivo que no se pueda renombrar no detiene la anulación: se
reporta en `fallas`.

## 4. Cómo se esconde (y qué funciones se tocaron)

- **Por estado** (`Anulada`) lo que tiene columna de estado; **por el registro de Anulaciones** cotizaciones y proyectos.
- **`foliosAnulados_()`** = `{FOLIO: true}` de la pestaña Anulaciones (todos los tipos con folio; sin contratos: esos los
  esconde su estado), en caché por la versión de `anulaciones` (`claveCache_`) y una vez por petición; sirve también durante
  una escritura (solo `anular` cambia esa hoja y `anular` lee la hoja directo). Sin libro de Administración: vacío.
  **`esAnulado_(folio)`** la consulta (barato). Es lo que deben usar los demás módulos para saltar lo anulado: **lo anulado no
  cuenta como pendiente para nadie**. El registro manda: una requisición u orden anulada sigue escondida aunque alguien regrese
  su estado a mano en la hoja (las listas de requisiciones y los lectores de órdenes revisan el estado y `esAnulado_`).
- Lectores que ahora quitan lo anulado (la idea: filtrar en el lector, no en cada pantalla):
  - Cotizaciones: `getClientes` (clientes sugeridos), `listarCotizaciones` (historial), `cotizacionesDeProyecto_` (vista de
    cobranza y `marcarAceptada`: una anulada no se puede aceptar).
  - Proyectos: `proyectosVisibles_()` en `listarProyectos` (cotizar y cobranza), `listarProyectosCompras`,
    `listarProyectosRequisicion` y el resumen de cobranza (por `esAnulado_`); `proyectoParaCobranza_` y `proyectoParaCompras_` dan error "está
    anulado" (vista de cobranza, órdenes por proyecto, pedir, autorizar…). `mapaProyectos_` (folio visible) no se filtra.
  - Cobranza: `datosCobranza_` (contrato y pagos), `contratosDelLibro_` (y con él `contratosCache_`, `contratosFirmados_`,
    moneda de compras), `resumenCobranzaDeHojas_` (contratos, pagos, órdenes y proyectos); `cancelarPago` dice "está anulado".
  - Compras: `ordenesDeProyecto_` y `ordenesPorFolio_` sin anuladas; `buscarOrden_` da error "está anulada";
    `pagosDeOrden_(libro, oc, conAnulados)`; `facturasDelLibro_(libro, conAnuladas)` y `buscarFactura_` (error "está anulada");
    `movimientosPorOc_` (avance y lista de recepciones); `cuentasPorPagar` (órdenes y pagos); `cancelarPagoProveedor` y
    `cancelarRecepcion` con su mensaje.
  - Requisiciones: `buscarReq_` da error "está anulada" (así ninguna acción ni vista de detalle la toca), y
    `misRequisicionesDeHojas_`, `listarRequisicionesDeHojas_` y `listarOperacionesDeHojas_` la saltan.
- **Sumas que contaban por estado** (excluían Cancelada pero habrían contado Anulada): ahora usan `ocVigente` —
  `margenDeContrato_`, `margenSinContrato_`, la moneda de `marcarAceptada`, `reqParaSolicitante_`, `resumenGeneralCobranza` y
  `antiguedadCxp` (facturas abiertas). El resto ya contaba solo `Vigente` (pagos, recepciones, facturas) o solo
  Emitida/Pagada/Recibida (órdenes con factura faltante).
- `registrarPagoProveedor` cuenta también los pagos anulados para el "(n)" del nombre del comprobante (para no repetir nombre).

## 5. Interfaz (`web/cotizador/index.html`)

`<script id="mod-anular">` dibuja todo dentro de `#adminAnulados` (no toca otro HTML ni los estilos): buscador de folio →
"Ver qué arrastra" (vista previa: tabla de registros, lo que cambia, avisos, carpeta y a quién se avisa) → motivo (el botón se
habilita con 10 caracteres) → confirmación (`window.confirm`) → resultado en el aviso; abajo, **Registros anulados** (solo
lectura: fecha, folio y tipo, quién, motivo y, en un `<details>`, lo que arrastró, efectos y carpeta) con búsqueda en el
servidor. Se registra con `registrarModulo`: `alVerTab('admin')` monta y carga la lista, `alPermisos` la vacía sin super admin,
`contexto()` pide la lista en la sincronización y `alSincronizar` la repinta. Un `idSolicitud` por vista previa (un doble clic
no anula dos veces); si al confirmar el servidor anuló algo distinto de la vista previa (otra persona cambió algo), se avisa.

## 6. Decisiones

1. **Contratos sin folio**: se anulan con el pseudo-folio `CONTRATO PRY-AAAA-NNNN` (también con la clave del proyecto), o en la
   cascada de su cotización aceptada o de su proyecto. En Anulaciones quedan con ese "folio"; no entran al conjunto de anulados
   (si después se acepta otra cotización, el contrato nuevo es otra fila y debe verse).
2. **Una página central** (Administración → Anular) en lugar de un botón en cada pantalla: un solo lugar, solo super admin, con
   la vista previa de la cascada completa. Botones en cada pantalla pueden venir después llamando las mismas funciones.
3. **Orden sin aprobación de operaciones** (flujo de siempre): su requisición vuelve a **Solicitada** (no a Aprobada, que en ese
   flujo no existe), igual que `cancelarOrdenCompra`.
4. Anular un **pago a proveedor de una requisición Cerrada** o una **recepción de una Cerrada** sí se puede (las cancelaciones
   normales lo impiden): es la corrección del super admin. Cerrada → Recibida (pago) o → Pagada (recepción).
5. A una orden que ya estaba **Cancelada** no se le vuelve a mandar `oc.cancelada` al centro de mando (ya se le avisó al cancelarla).
6. **El libro de Administración es obligatorio** (`prepararCapri`): anular no lo crea solo, porque en cuanto existe los roles
   salen de su pestaña Permisos (si naciera vacía, todos perderían sus roles).
7. Las requisiciones separadas de otra (`origen_folio`) son independientes: anular la original no las arrastra.
8. El conjunto de anulados se invalida solo con `anular` (versión de `anulaciones`). Si alguien borra una fila de Anulaciones a
   mano para "restaurar", tarda hasta 6 h en notarse; restaurar no es parte de este incremento.

## 7. Pruebas

`tests/anular.test.js` (arnés compartido, datos sembrados por `doPost`): lógica pura; sin libro de Administración no se anula;
solo super admin (y `SOLO_REQUISICION` nunca); motivo; folios inválidos o inexistentes; idempotencia y "ya está anulado"; vista
previa = efecto en cada caso; pago de cliente; pago a proveedor de una Cerrada (y se vuelve a pagar con "(2)"); factura; orden con
factura (requisición a Solicitada, se autoriza otra con folio nuevo); contrato con clave (esquema borrado con copia, cotización
sin aceptar, aceptar de nuevo en otra fila); cotización aceptada y firmada (contrato y pagos; cliente fuera de sugerencias y del
bootstrap; folio nuevo); con operaciones: recepción de una Cerrada (→ Pagada, se recibe otra vez), recepción completa sin pagar
(→ Autorizada), orden pagada y recibida (→ Aprobada sin propuesta; nueva propuesta versión 2); requisición (fuera de las listas de
compras, solicitante y operaciones; vistas con error); proyecto (todo, carpeta «ANULADO — …», privadas intactas, fuera de las
listas de todas las pestañas, folio nuevo); cotización sin proyecto; proyecto con aceptada sin firmar. Totales antes y después:
resumen de cobranza (MXN y USD por separado), margen de la vista y del resumen, cuentas por pagar (abiertas, totales por moneda y
faltantes). `notificar_` con los involucrados y sin montos; `avisarPortal_` por orden; archivos renombrados; filas en
Anulaciones (JSON válido, una por registro) y Bitacoras; `listarAnulados` (búsqueda en cascada) y `sincronizar` (solo super
admin, solo si cambió). Interfaz: `mod-anular` con un DOM mínimo (montar, lista escapada, vista previa, motivo, un solo envío
con `idSolicitud`, resultado, error, sincronización, búsqueda y sin permiso). `bash tests/todas.sh` en verde.

## 8. Publicación

Sin servicios de Google nuevos (DriveApp y SpreadsheetApp ya autorizados). Requiere la base del incremento 4 publicada y
`prepararCapri()` corrido (libro de Administración con la pestaña Anulaciones). Pasos de siempre: respaldos, `clasp push`,
`clasp deploy` sobre el mismo deployment y `wrangler deploy`. Probar primero en PRUEBAS con datos inventados (anular toca todos
los libros).

## 9. Para los otros módulos y lo que no alcanzó

- **D (Pantallas / Pendientes)**: los conteos deben salir de las funciones de lista (ya sin lo anulado) o, si leen hojas,
  saltar los folios con `esAnulado_(folio)` (o `foliosAnulados_()` para una lista); lo anulado no es pendiente de nadie.
- **B (Correos)**: el evento `anulado` trae `cascada` con folios de orden; a quien pidió o recibe no se le deben poner folios de
  orden ni montos (regla del spec).
- **C (Centro de mando)**: recibe `oc.cancelada` también por anulación; el material ya recibido se queda.
- Restaurar lo anulado; botones de anular en cada pantalla; anular por lote.
- `CLAUDE.md` y el Manual se actualizan al integrar (no se tocaron aquí).
