# Incremento 7 (CAPRI) · Módulo A: Adicionales

Rama `incremento-7-adicionales` (sobre `incremento-7-base` = `incremento-6-final` + `docs/incremento-7.md`). Contrato:
`docs/incremento-7.md` §0, §1 (`adicionalesPorProyecto`), §2 "A" y §3. Idea aprobada antes en CLAUDE.md §6.10 ("Adicionales después
de firmar"). Spec de Leo: "CAPRI — what's missing: spec for increments 6–8", sección 4. Este archivo es para integrar: al hacer el
merge se pasa lo necesario a `CLAUDE.md` (§1, §4.5, §4.5.2, §4.6, §4.7, §5, §6.9, §6.10, §6.11, §9) y al Manual (Cobranza, Nueva
cotización, Historial, Pendientes).

## 0. Decisiones que el contrato no fijó (léelas primero)

1. **El pago apunta a la etapa por su dueño, no por su posición.** Columna nueva `Pagos.etapa_adicional` (folio de la adicional;
   vacía = contrato) y `etapa_orden` es el orden **dentro de su esquema**. Un índice global (contrato + adicionales) se habría
   corrido al editar el esquema de una adicional o al cancelar otra, y los pagos ya registrados habrían cambiado de etapa. Las filas
   de antes (sin la columna) son del contrato y se reparten igual que siempre.
2. **Orden de cobro:** primero las etapas del contrato y luego las de cada adicional **en el orden en que se aceptó**. El reparto de
   siempre (`repartirPago`: la etapa elegida → las siguientes → al terminar, las anteriores) corre sobre esa lista, así que el
   excedente de la última etapa del contrato pasa a la primera adicional. Lo que no cabe en ninguna etapa (dentro de la tolerancia)
   se suma a la etapa elegida, como antes.
3. **Un pago dirigido a una adicional que ya no está** (anulada por un super admin) se reparte desde la primera etapa del contrato.
   Anular una adicional **no anula sus pagos** (un pago puede cubrir contrato y adicional a la vez): siguen vigentes y se vuelven a
   repartir; la vista previa de Anular lo dice. Anular el contrato o el proyecto sí anula los pagos, como siempre. Revisión del
   incremento 7 (dinero): si la adicional ya tiene algo cobrado, la vista previa agrega un renglón: "ya tiene $X cobrados: esos pagos se
   quedan (no se anulan)" y, si lo pagado pasa de lo que queda contratado, "quedará con un saldo a favor del cliente de $Y" (sale aparte
   en el resumen de cobranza; se registra como nota de crédito o reembolso).
4. **Mini-esquema por omisión:** una etapa "Pago único" de 100 %. Lo edita el rol de cobranza (1–10 etapas, suma 100 %,
   `validarEsquema`) **mientras la adicional no tenga pagos aplicados** (ni un pago Vigente dirigido a ella). Revisión del incremento 7
   (dinero): tampoco si el cambio renumera, renombra o quita una etapa con una factura de cliente Vigente ligada (el error la nombra;
   agregar etapas al final o cambiar porcentajes sí). Ver `docs/incremento-7-facturas.md` §0.1.
5. **Las reglas de Helgen Energy no aplican a las adicionales** (60/30/10 y "solo el administrador con motivo"): esas reglas protegen
   los términos comerciales del contrato de paneles solares que se firmó; una adicional es trabajo extra que se cotiza aparte
   (normalmente un solo pago) y su esquema lo negocia cobranza. El esquema del contrato Energy sigue igual (probado).
6. **Aceptar exige el contrato Firmado.** Con el contrato desbloqueado (vuelve a Aceptada) no se aceptan adicionales nuevas ni se
   cotizan (y las cotizaciones normales vuelven a admitirse, como antes); las ya aceptadas siguen, con su esquema y sus pagos, y se
   pueden editar o cancelar. Al desbloquear, cambiar la aceptada, reescribir el esquema del contrato o volver a firmar **no se tocan
   las adicionales** (`escribirEsquema_` solo reescribe las filas del contrato). Volver a firmar compara lo pagado contra contrato +
   adicionales.
7. **Solo una cotización marcada «Adicional» se acepta como adicional**, y una «Adicional» no se puede marcar como la aceptada del
   contrato (`marcarAceptada` la rechaza). Una cotización normal hecha antes de firmar no se convierte en adicional.
8. **Cancelar:** la fila queda `Cancelada` (con quién, cuándo y el motivo; nunca se borra) y sus etapas salen de `Esquemas` (copia en
   la Bitácora). La cotización sigue en el proyecto y **se puede volver a aceptar** (fila nueva). Revisión del incremento 7 (dinero): con
   una factura de cliente Vigente ligada a sus etapas no se cancela (primero se liga a otra etapa o se marca Cancelada).
9. **Monedas:** la adicional va en la moneda del contrato (se revisa al cotizar y al aceptar); con adicionales aceptadas, un contrato
   desbloqueado no puede cambiar a otra moneda (como con pagos y órdenes). Si alguien editara una a mano en otra moneda, la vista, el
   resumen y los reportes no la suman (nunca se mezclan); `adicionalesPorProyecto` la cuenta en `revisar`.
10. **Lista para cotizar:** `listarProyectos` no cambió (el buscador de siempre sigue sin los de contrato firmado). Ventas recibe aparte
    `proyectosFirmados` (bootstrap y sincronizar del módulo: Activos con contrato firmado, con `contratoFirmado: true` y la moneda del
    contrato, sin montos); la interfaz los junta en la lista marcados "Contrato firmado · solo cotización adicional".
11. **Proyecto Cerrado:** no se cotiza (regla de siempre: solo `Activo`); una adicional ya cotizada sí se puede aceptar (como
    `marcarAceptada`, solo `Cancelado` lo impide). En un proyecto Cancelado no se acepta, edita ni cancela nada.
12. **Resumen de cobranza:** "Por cobrar", "Cobrado" y el avance cuentan las adicionales; un contrato "Por firmar" (desbloqueado) con
    adicionales muestra contrato + adicionales en "por firmar" (no suman, como siempre). El margen sigue siendo del contrato.
    Revisión del incremento 7 (dinero): "Por cobrar" suma **solo saldos positivos**; un proyecto con saldo negativo de más de 1.00 (p. ej.
    se anuló una adicional ya pagada) va en "Saldo a favor de clientes" (`aFavor` y `conSaldoAFavor` por moneda, `aFavor: true` en el
    renglón), nunca restado de lo que deben otros proyectos (antes se netteaba y no cuadraba con CxC).
13. **CSV del resumen:** las dos columnas nuevas ("Adicionales con IVA", "Total contratado con IVA") van **al final**, para no mover las
    de antes.
14. **CxC y flujo:** las etapas de una adicional salen con `etapa` = "Pago único (adicional HLG-…)" (así el reporte de R se lee sin
    tocar su interfaz), más `adicional` y `etapaNombre`; las partidas del contrato no cambian de forma. Una adicional cuya cotización
    es folio de prueba no entra a los reportes (como un contrato de prueba).
15. **Fechas esperadas:** `guardarFechasEsperadas` acepta `adicional` en cada etapa; el orden se repite solo dentro del mismo esquema
    y el máximo de 10 es por esquema. Sin `adicional`, igual que antes (mismos mensajes, misma salida).
16. **Anular:** el registro de la adicional en la cascada es tipo **"Adicional"** con folio `ADICIONAL HLG-AAAA-NNNN` (no tiene folio
    propio, como los contratos: no entra a `foliosAnulados_`). Lo arrastran su cotización, el contrato y el proyecto; queda copia de
    su fila y su esquema en Anulaciones.
17. **Columna `tipo`:** se escribe en W (después de `tipo_cambio`, como las demás columnas que se agregaron) y se **lee por su
    encabezado** (`colTipoCotizacion_`). Valores: `Adicional` o vacío (normal y filas de antes).
18. **Margen:** no lo conecté (lo hace el integrador con `adicionalesPorProyecto`). Hoy la tarjeta de margen y el margen del resumen y
    de Reportes siguen con el contratado del contrato; lo que la vista sí cuenta bien es contratado + adicionales y el saldo.

## 1. Qué hace

1. **Cotizar (ventas).** En "1 · Cliente y proyecto" los proyectos con contrato firmado salen marcados; al elegir uno aparece la
   casilla **«Adicional»** (solo con contrato firmado) y la cotización pasa a la moneda del contrato. Sin la casilla no se guarda.
   El servidor: con contrato firmado solo admite una adicional, en la moneda del contrato (si no, error y no se gasta folio); una
   adicional solo va en un proyecto con contrato firmado. Folio HLG, PDF (con el renglón "Cotización adicional al proyecto
   PRY-…-XXX · Nombre") en la carpeta del proyecto y todo lo demás igual.
2. **Aceptar (cobranza).** Cobranza → proyecto → "2 · Esquema de pagos" → bloque **Adicionales**: las por aceptar con su botón; al
   aceptar, fila en `Adicionales` y su mini-esquema en `Esquemas`. Bitácora "Aceptar adicional".
3. **Esquema y fechas.** Cada adicional aceptada muestra su esquema (monto, pagado, saldo y fecha esperada por etapa); mientras no
   tenga pagos se edita ahí ("Guardar esquema", Bitácora "Editar esquema de adicional"). Las fechas esperadas se guardan siempre
   (Bitácora "Fechas esperadas de cobro", con la etapa marcada "(adicional HLG-…)").
4. **Cobrar.** En "3 · Pagos" la lista de etapas incluye las de las adicionales ("Adicional HLG-… · 1 · Pago único"); el saldo del
   proyecto es contrato + adicionales − pagado y la tolerancia de 1.00 se mide contra ese total. Arriba: **Contratado**,
   **Adicionales** y **Total contratado** en renglones aparte (también en "1 · Proyecto y contrato").
5. **Resumen de cobranza.** Totales por moneda con "Adicionales (con IVA)" y "Total contratado"; en la tabla, bajo el contratado,
   "+ adicionales" y "= total"; CSV con las dos columnas al final.
6. **Cancelar** (cobranza, motivo de 5 a 500 caracteres) solo sin pagos aplicados. **Anular** (super admin) desde su cotización, el
   contrato o el proyecto.

## 2. Hojas y columnas (se crean solas, por nombre)

| Libro | Pestaña | Cambio |
|---|---|---|
| Base de datos | `Cotizaciones` | **`tipo`** (W): `Adicional` o vacío. `guardarCotizacion` reescribe la fila 1 (como siempre) |
| Cobranza | **`Adicionales`** (nueva) | `proyecto_folio`, `cotizacion`, `marca`, `moneda`, `subtotal`, `iva`, `total` (montos de la cotización), `estado` (Aceptada / Cancelada / Anulada), `aceptada_por`, `fecha_aceptacion`, `actualizado`, `cancelado_por`, `fecha_cancelacion`, `motivo`. Una fila por aceptación; nunca se borran. La crea la primera aceptación (o el libro nuevo) |
| Cobranza | `Esquemas` | **`adicional`** (G): folio de la adicional dueña de la etapa; vacío = contrato (filas de antes) |
| Cobranza | `Pagos` | **`etapa_adicional`** (W): folio de la adicional de la etapa elegida; vacío = contrato (filas de antes) |
| Cobranza | `Bitacora` | Acciones nuevas: Aceptar adicional, Editar esquema de adicional, Cancelar adicional, Anular adicional |
| Administración | `Anulaciones` | Tipo nuevo "Adicional" (folio `ADICIONAL HLG-…`, copia de su fila y su esquema) |

Script Properties: `VER_adicionales` (sola). Nada nuevo en compras. Sin permisos nuevos de Google.

## 3. Funciones

### Code.js §6.A (incremento 7), al final del archivo
| Función | Qué hace |
|---|---|
| `modAdicionales_()` | `api`: `aceptarAdicional`, `guardarEsquemaAdicional`, `cancelarAdicional`; `cambios`: las tres → `['adicionales', 'contratos']`; `bootstrap`/`sincronizar`: `proyectosFirmados` para ventas (no con solo requisiciones) |
| `aceptarAdicional(proyecto, cotizacion)` *(API)* | Cobranza; candado; idempotente (ya aceptada → la vista); `validarAceptarAdicional`; fila + esquema por omisión; Bitácora; `vistaCobranza_` |
| `guardarEsquemaAdicional(proyecto, cotizacion, etapas)` *(API)* | Cobranza; `validarEsquema`; sin pagos aplicados; conserva fechas por nombre; Bitácora |
| `cancelarAdicional(proyecto, cotizacion, motivo)` *(API)* | Cobranza; motivo 5–500; sin pagos aplicados; Cancelada + borra su esquema; Bitácora |
| Internas | `listarProyectosFirmados_`, `colTipoCotizacion_`, `adicionalDesdeFila_`, `adicionalesDelLibro_` (Aceptadas, sin crear la pestaña), `escribirEsquemaAdicional_`, `vistaAdicionales_`, `adicionalDe_`, `adicionalConPagos_` |
| Puras | `tipoCotizacion`, `esPedidoAdicional`, `reglaCotizacionAdicional`, `esquemaAdicionalPorOmision`, `validarAceptarAdicional`, `claveEtapaCobranza` (`CONTRATO#2`, `HLG-…#1`: para C), `etiquetaEtapaCobranza`, `indiceEtapaCobranza`, `adicionalesConEtapas`, **`adicionalesPorProyecto`** (contrato §1); constantes `TIPO_ADICIONAL`, `ADIC_ACEPTADA`, `ADIC_CANCELADA` |

`vistaCobranza_` agrega `adicionales` ([{cotizacion, fecha, pdf, marca, moneda, subtotal, iva, total, estado, aceptadaPor,
fechaAceptacion, etapas: [{orden, clave, etapa, porcentaje, fechaEsperada, monto, pagado, saldo, avance}], pagado, saldo, conPagos,
esquemaEditable, puedeCancelar, fechasEditables}]), `adicionalesPorAceptar` ([{folio, fecha, cliente, marca, moneda, subtotal, iva,
total, pdf, otraMoneda}]) y `puedeAceptarAdicional`; `cotizaciones[i].tipo`; `resumen` trae `adicionales`, `adicionalesSubtotal`,
`nAdicionales`, `total` y las etapas de las adicionales (con `adicional` y `orden` de su esquema) después de las del contrato.

### Cambios compartidos (fuera de §6.A, marcados "A (incremento 7)")
- `MODULOS_` (+ `modAdicionales_()`), `COLECCIONES` (+ `adicionales` al final), `modAnular_().cambios.anular` (+ `adicionales`).
- `ENCABEZADOS_COTIZACIONES` (+ `tipo`); **`guardarCotizacion`** (`esPedidoAdicional`, `reglaCotizacionAdicional` en lugar del error
  fijo; mismo mensaje de siempre más "Si es trabajo extra, márcala como «Adicional»."; escribe `tipo`; devuelve `tipo`);
  `construirHtmlPdf` (renglón opcional `d.adicional`); `cotizacionesDeProyecto_` (+ `tipo`).
- `HOJAS_COBRANZA` (`Esquemas.adicional`, `Pagos.etapa_adicional`, pestaña `Adicionales`) y junto a `colEsq_`: `colAdic_`,
  `COL_PAGO_ADICIONAL_`, `esquemaDeAdicional_`; `pagoDesdeFila_` (+ `etapaAdicional`).
- `datosCobranza_` (etapas del contrato sin las de adicionales; + `adicionales` con sus etapas y `hojas.adicionales`),
  `escribirEsquema_` (solo filas del contrato), `vistaCobranza_`, `marcarAceptada` (rechaza una Adicional; moneda de las
  adicionales), `firmarContrato` (lo pagado contra contrato + adicionales).
- **`registrarPago`**: `p.etapaAdicional` opcional; valida `etapaOrden` contra el esquema de esa adicional; saldo y tolerancia con
  adicionales; `indiceEtapaCobranza`; `aplicacion (JSON)` con `adicional` en las etapas de adicionales; columna `etapa` = etiqueta.
- **`resumenCobranza(contrato, etapas, pagos, adicionales)`**: cuarto argumento opcional. Sin él, el mismo objeto y las mismas
  cifras que antes (probado). Con él (aunque sea `[]`): etapas con `adicional`/`orden`, saldo y avance contra el total, campos nuevos.
- `resumenCobranzaDeHojas_` (+ `adicionales`), `resumenGeneralCobranza` (`d.adicionales` opcional: renglón y totales con
  `adicionales` y `total`; `siguienteEtapa` con etiqueta).
- `datosReportes_` (+ `esquemas[].adicional`, `adicionales`), **`etapasPorCobrar`** (`d.adicionales` opcional; misma firma),
  `guardarFechasEsperadas` y `normalizarFechasEsperadas` (`adicional` por etapa).
- Anular: `TIPOS_ANULAR.adicional`, `anuladosDeHoja_`, `datosAnular_` (+ `adicionales`, `esquemas[].adicional`), `planAnulacion_`
  (cotización / contrato / proyecto → `adicional`; efecto informativo), `aplicarAnulacion_` (Anulada + su esquema; el contrato borra
  solo sus filas; filas sin repetir), `registrarAnulacion_`.

### Interfaz (`web/cotizador/index.html`)
- HTML: `#cotAdicionalCaja` / `#cotAdicional` (después de `#proyInfo`), `#cobAdicionales` (dentro de `#cobModEsquema`, después de
  `#cobFechas`: sin un cuarto módulo en la vista, §6.4), nota del resumen.
- Script principal: `PROYECTOS_FIRMADOS` + `proyectosCotizar()` (los usan `recibirProyectos`, `proyectoElegido` y el aviso de
  `guardar`); `pintarProyInfo` (casilla y texto); `guardar` (`payload.adicional`, sin casilla o en otra moneda no llama al servidor);
  `pintarCobranza` (chips "Adicional"/"Adicional aceptada" sin "Marcar aceptada", renglones de adicionales y total en el contrato y
  en `#cobResumen`, etapas de adicionales en `#pgEtapa` con valor `HLG-…#orden`); `registrarPago` (`etapaAdicional`);
  `pintarResumenCob` y `csvResumenCob` (columnas al final).
- `<script id="mod-adicionales">`: `alMarcarAdicional`, `window.ADICIONALES = {aceptar, cancelar, editarEtapa, agregarEtapa,
  quitarEtapa, guardarEsquema, guardarFechas}`; `registrarModulo` con `alBootstrap`/`alSincronizar` (`proyectosFirmados`),
  `alPermisos` (sin ventas se vacía) y `alCobranza` (bloque).

## 4. Para el integrador

1. **Margen:** `adicionalesPorProyecto(adicionales)` (pura; con `adicionalesDelLibro_(libro)`) → sumar `subtotal` al contratado sin IVA
   en `margenDeContrato_`, el resumen de cobranza y `reporteMargen` (misma moneda que el contrato; `revisar` = adicionales en otra
   moneda que no se sumaron). La vista ya trae `resumen.adicionalesSubtotal`.
2. **Facturas de clientes (C):** clave de etapa `claveEtapaCobranza(adicional, orden)` (`CONTRATO#n` / `HLG-…#n`); la vista trae `clave`
   en las etapas de las adicionales. Si C usa otra clave, unificar aquí.
3. **`VERSION_CODIGO_CACHE`:** cambia la forma de lo que va en caché (renglones y totales de `resumenCobranzaGeneral`, partidas de CxC y
   flujo de las adicionales): hay que cambiarlo al publicar.
4. **Choques probables:** `MODULOS_`, `COLECCIONES`, `HOJAS_COBRANZA` (C agrega `FacturasClientes`), `modAnular_().cambios` (G agrega
   `gastos`), `TIPOS_ANULAR`, y en pruebas las listas de pestañas de cobranza (`cobranza`, `compras`, `requisiciones`), la de
   colecciones (`requisiciones`) y los encabezados de `Cotizaciones` (`sesion`, `cotizacion`, `proyectos`).
5. Opcional, no hecho: mostrar "Adicional" en el Historial de cotizaciones.

## 5. Pruebas

`tests/adicionales.test.js` (en `bash tests/todas.sh`):
- **Regresión:** `tests/adicionales-regresion.js` corre un escenario sin adicionales (funciones puras con datos fijos y un flujo de
  cobranza por doPost: aceptar, esquema, firmar, fechas, pagos con excedente y tipo de cambio, cancelar, desbloquear y volver a
  firmar, resumen y CxC). `tests/adicionales-regresion.json` es la salida del **código de antes** (commit `e6d8b2b`); la prueba exige
  la misma salida con el de ahora. Volver a generarlo solo si cambia el escenario.
- Lógica pura, servidor (regla del contrato firmado en los dos sentidos, moneda, PDF, columna tipo, lista para ventas, permisos,
  aceptar / esquema / fechas / cancelar, pagos entre contrato y adicionales, tolerancia, desbloqueo, resumen, CxC, flujo, Anular
  desde la cotización, el contrato y el proyecto) e interfaz (casilla, guardar, bloque de cobranza, pago a una etapa de adicional,
  fechas, cancelar, resumen y CSV).
- Pruebas de antes que cambiaron solo por la estructura nueva (pestaña `Adicionales`, columnas `tipo` y `adicional`, colección
  `adicionales`, dos columnas al final del CSV del resumen): `cobranza`, `compras`, `requisiciones`, `sesion`, `cotizacion`,
  `proyectos`, `reportes`, `interfaz`.

## 6. Publicación

Sin permisos nuevos de Google ni funciones que correr: la columna `tipo`, la pestaña `Adicionales` y las columnas `adicional` y
`etapa_adicional` se crean solas. Publicar API e interfaz juntas: la interfaz manda `adicional` y `etapaAdicional` (con una interfaz
vieja no se pueden cotizar adicionales y, en un proyecto con adicionales aceptadas, pagar a una de sus etapas se rechaza con "Elige la
etapa del pago"). Cambiar `VERSION_CODIGO_CACHE`. Avisar a ventas (casilla «Adicional»
en proyectos con contrato firmado) y a cobranza (aceptar, esquema, cobro y cancelación de adicionales).
