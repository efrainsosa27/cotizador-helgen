# Incremento 6 (CAPRI) · Módulo R: reportes de CxC y CxP

Rama `incremento-6-r` (sobre `incremento-6-base` = `incremento-5` + `docs/incremento-6.md`). Contrato: `docs/incremento-6.md` §1,
§3 y §4. Spec aprobado por Leo con sus valores por omisión: "CAPRI — what's missing: spec for increments 6–8", sección 2 y
decisiones 4 y 5. Este archivo es para integrar: al hacer el merge se pasa lo necesario a `CLAUDE.md` (§4.5.2, §4.6, §4.7, §4.8,
§5, §6.11, §7, §9) y al Manual (Cobranza, un apartado nuevo "Reportes", Reglas de oro, Historial, Pendientes).

## 0. Desviaciones y decisiones que hay que revisar (léelas primero)

1. **La antigüedad de CxP no llama a `antiguedadCxp`.** Es **por orden y por saldo** (como dice el spec: "open balance per supplier
   and order"): `porPagarProveedores` toma el saldo de cada orden vigente con `saldoOrdenCompra` (lo único que P publica para R,
   contrato §1) y le pone fecha con las mismas reglas de Cuentas por pagar (emisión + días de crédito, mismas claves de rangos que
   `RANGOS_CXP`). Hoy (con la función provisional) es lo que muestra Cuentas por pagar en "facturas abiertas" **más** lo que todavía
   no se factura de las órdenes sin pagar (que Cuentas por pagar solo lista como "falta factura", sin antigüedad). Por eso **los
   totales de CxP del reporte pueden ser mayores que los de Cuentas por pagar**. Razón: la función de hoy devuelve facturas y deja
   fuera toda orden con un pago; no puede expresar saldos, y sus cambios son de P. Así R no depende de cómo quede `antiguedadCxp`.
2. **Las órdenes de un proyecto Cancelado siguen en CxP y en el flujo** (marcadas con el estado del proyecto). Se le sigue debiendo
   al proveedor mientras la orden no se cancele; esconderlas haría ver menos deuda de la real. Cuentas por pagar ya hace lo mismo.
   En CxC, flujo (cobros) y margen los proyectos cancelados sí quedan fuera (igual que el resumen de cobranza).
3. **Fecha de lo que no tiene factura = la de Cuentas por pagar** (revisión 6b): **recepción** (o entrega, o la fecha de la orden) +
   días de crédito, con **una sola función** compartida con P: `venceSinFactura(o)` (la usan el "siguiente pago" de
   `saldoOrdenCompra` —vista de la orden y fila "Saldo" de Cuentas por pagar— y los reportes). Antes R usaba la entrega aunque la
   orden ya se hubiera recibido, y una orden a crédito recibida antes caía en otro rango y otra semana. Se marca "Sin factura" en
   pantalla y en el CSV. Sin esta fecha el flujo no tendría pagos de las órdenes de contado sin factura (la mayoría).
4. **Registros de prueba:** los resúmenes de hoy no los excluyen por folio (solo por proyecto cancelado). CLAUDE.md §5 pide sacarlos
   de los reportes por folio, así que R tiene la lista fija `FOLIOS_PRUEBA_REPORTES` (`HLG-2026-0005`, `HLG-2026-0006`,
   `PRY-2026-0001`) más la Script Property opcional **`FOLIOS_PRUEBA`** (folios separados por coma; se aplica sin publicar). Fuera:
   el proyecto con ese folio (también con su clave), un contrato cuya cotización aceptada es de prueba y las órdenes de ese proyecto.
5. **Contratos "Por firmar"** (aceptada sin firmar): no van en CxC ni en el flujo (todavía no se cobran: los pagos exigen contrato
   firmado); en el margen se muestran y **no suman**, como en el resumen de cobranza.
6. **Margen con un costo en otra moneda** (orden de compra en una moneda que no es la del contrato): el renglón dice "Revisar" y no
   suma; los totales de su línea suman solo los demás y dicen cuántos quedaron fuera. (El resumen de cobranza, en cambio, deja el
   margen total de esa moneda en blanco.)
7. **Semanas del flujo:** de lunes a domingo; la semana 1 es la de hoy. Lo vencido (fecha anterior a hoy) cae en la semana 1 y se
   marca; **lo que vence hoy no está vencido**. Sin fecha y después de la semana 13 van aparte y no entran al neto. El acumulado
   empieza en cero (no conoce el saldo en bancos).
8. **Fecha esperada al reescribir el esquema:** se conserva **por el nombre de la etapa** (sin acentos ni mayúsculas). Una etapa
   nueva o renombrada queda sin fecha (nunca hereda la de otra). No se edita en proyectos Cancelados; sí en Cerrados.
9. **Pestaña:** "Reportes" es un grupo propio en la barra (entre Cobranza y Administración). La interfaz decide si se ve con
   `PERMISOS` (cobranza → CxC y margen; compras → CxP; super admin → flujo y todos), con la misma regla que `permisosReportes_`;
   el servidor revisa en cada llamada.
10. **Fechas de CxP con las reglas de Cuentas por pagar** (revisión 6b; antes: el pago del plan con su fecha y el resto aparte): primero
    las facturas (lo pagado cubre primero la que vence antes); lo que ninguna factura cubre va **completo en una sola fecha**: la del
    "siguiente" de P **sin facturas** (el pago del plan que sigue —el anticipo vence en la fecha de la orden— o recepción/entrega +
    crédito), igual que la fila "Saldo" de Cuentas por pagar y el "Siguiente pago" de la orden. Así el mismo saldo cae en el mismo
    rango y la misma semana en todas las pantallas. Con un plan cuyo anticipo no se ha pagado, todo el saldo queda en la fecha del
    anticipo (conservador para el flujo: el dinero sale antes, no después); en cuanto se paga, el resto pasa a recepción + crédito.
    Un resto dentro de la tolerancia (≤ 1.00) no se lista, como en Cuentas por pagar.
11. **Órdenes anteriores sin pago registrado** (revisión 6b): una orden vigente **sin requisición, sin pago Vigente y sin factura
    Vigente** (las de la fase 3, de antes de las requisiciones: Recibidas, Emitidas y alguna Pagada sin renglón de pago) no es deuda
    que se pueda saldar desde CAPRI: `registrarPagoProveedor` exige requisición y una Recibida tampoco se puede cancelar (una Emitida
    sí, y al cancelarla sale del bloque). Antes R la sumaba completa como deuda vencida para siempre. Ahora **va aparte**: fuera de
    `porPagarProveedores`, de los totales de CxP y del flujo; la antigüedad de CxP la lista en su propio bloque
    **"Órdenes anteriores sin pago registrado (n)"** (orden, proveedor, proyecto, estado, fecha, total de la orden y total por
    moneda) y el flujo dice cuántas dejó fuera. **Su costo sigue en el margen** (igual que la tarjeta de margen). Con un pago
    Vigente, una factura Vigente o una requisición deja de ser "anterior" y vuelve a la antigüedad normal.

## 1. Qué hace

1. **Fecha esperada por etapa de cobranza** (decisión 4). Columna nueva `fecha_esperada` en `Esquemas`. Opcional. La cambia el rol
   de cobranza (y super admin) **aunque el contrato esté firmado**, porque no cambia montos; cada cambio va a la Bitácora de cobranza
   ("Fechas esperadas de cobro", `Instalación: sin fecha → 2026-11-15`). Se ve y se edita en Cobranza → proyecto → "2 · Esquema de
   pagos" → bloque "Fechas esperadas de cobro" (etapa, saldo, fecha, estado: vencida hace N días · vence hoy · en N días · sin
   fecha · cobrada). La interfaz manda solo las etapas que cambiaron.
2. **Pestaña Reportes** con cuatro reportes, cada uno con "Actualizar" y "Descargar CSV" (UTF-8 con BOM; texto que empieza con
   `= + - @` con apóstrofo; números con 2 decimales), MXN y USD siempre aparte:
   - **Antigüedad de cuentas por cobrar** (cobranza, super admin): por cliente y proyecto, en No vencido · 1–30 · 31–60 · 61–90 ·
     Más de 90 días · Sin fecha, con el total vencido. Cada proyecto lista sus etapas por cobrar con su fecha.
   - **Antigüedad de cuentas por pagar** (compras, super admin): por proveedor y orden, mismos rangos; cada orden dice de dónde sale
     la fecha (factura, plan de pagos o sin factura). Abajo, aparte y fuera de los totales, las **órdenes anteriores sin pago
     registrado** (decisión 11) con cuántas son. Sin datos de contrato ni margen. En el CSV van al final con la columna "Nota".
   - **Flujo de efectivo · 13 semanas** (solo super admin): cobros esperados contra pagos esperados por semana, neto y acumulado; la
     semana 1 dice cuánto de lo suyo está vencido; aparte sin fecha y después de la semana 13; lista de partidas. Dice cuántas
     órdenes anteriores sin pago registrado no incluye.
   - **Margen por proyecto** (cobranza, super admin): contratado sin IVA − órdenes de compra no canceladas, una columna por concepto
     de costo (hoy solo "Órdenes de compra"), totales por línea de negocio (Helgen / Helgen Energy) y moneda.
3. **Permisos en el servidor en cada llamada** (decisión 5). Compras nunca recibe montos de contrato ni margen.
4. **Solo lectura** salvo `fecha_esperada`. Los reportes nunca crean libros ni pestañas (`filasSiHay_`).

## 2. Hojas y columnas

| Libro | Pestaña | Cambio |
|---|---|---|
| Cobranza (`COBRANZA_DB_ID`) | `Esquemas` | **`fecha_esperada`** (F): `AAAA-MM-DD` con apóstrofo (`textoFecha_`) o vacía. Se crea sola, por nombre (`hojaDeArea_` repone el encabezado la primera vez que se lee Esquemas); se lee con `colEsq_('fecha_esperada')`. Las filas de antes quedan sin fecha. |
| Cobranza | `Bitacora` | Acción nueva "Fechas esperadas de cobro" (detalle antes → después). |
| Script Properties | `FOLIOS_PRUEBA` | Opcional: folios de prueba extra que no van en los reportes. |

Nada en la Base de datos ni en el libro de compras. Caché (CacheService): `K_REP_<tipo>_<día>_<huella de pruebas>_<versiones>`.

## 3. Funciones

### Code.js §6.R (al final del archivo)
| Función | Qué hace |
|---|---|
| `modReportes_()` | `api`: `guardarFechasEsperadas`, `reporteCxc`, `reporteCxp`, `reporteFlujo`, `reporteMargen`; `cambios`: `guardarFechasEsperadas → ['contratos']`; `sincronizar`: con `ctx.reporte` (el abierto) y si cambió alguna de sus colecciones y la persona lo puede ver, manda `r.reporte = {tipo, datos}` |
| `permisosReportes_()` | `{cxc, cxp, flujo, margen}` del usuario de la sesión: `esCobranza_`, `esCompras_`, `esSuperAdmin_` |
| `exigirReporte_(tipo)` | Sesión + permiso, si no `codigo: 'PERMISO'` ("No tienes permiso para ver este reporte.") |
| `REPORTES_` | Por reporte: colecciones de su caché y sincronización, si depende del día y su función |
| `reporteEnCache_(tipo, calcular)` | `enCache_` con día (si aplica) y huella de `foliosPrueba_()`; TTL 6 h |
| `reporteCxc()` *(API)* | `antiguedadCxc(datosReportes_({cobranza}))` |
| `reporteCxp()` *(API)* | `antiguedadPorPagar(datosReportes_({compras}), saldoOrdenCompra_())` (con `anteriores`: decisión 11) |
| `reporteFlujo()` *(API)* | `flujoSemanal({hoy, semanas: 13, cobros: etapasPorCobrar, pagos: porPagarProveedores})` + `ordenesAnteriores` (cuántas quedaron fuera) |
| `reporteMargen()` *(API)* | `margenPorProyecto(datosReportes_({cobranza, compras}))` |
| `saldoOrdenCompra_()` | **Punto de integración con P** (ver §5) |
| `foliosPrueba_()` | `FOLIOS_PRUEBA_REPORTES` + Script Property `FOLIOS_PRUEBA` |
| `datosReportes_(que)` | Lee contratos, esquemas (con fecha), pagos de clientes; órdenes, pagos a proveedores, movimientos y facturas; proyectos visibles. Sin lo anulado (estado `Anulada` o `esAnulado_`). No crea nada |
| `guardarFechasEsperadas(proyecto, fechas)` *(API)* | Ver §1.1. `fechas = [{orden, etapa, fecha}]`; si la etapa en ese número ya no se llama igual (el esquema cambió), error y no escribe nada. Con candado; escribe solo la celda de cada etapa que cambió; devuelve `vistaCobranza_` |
| Puras | `fechaIsoValida`, `esFolioPrueba`, `normalizarFechasEsperadas`, `rangoAntiguedad`, `ordenMonedas`, `etapasPorCobrar`, `porPagarProveedores`, `tramosPorPagar`, `esOrdenAnteriorSinPago`, `ordenesAnterioresSinPago`, `saldoOrdenCompraProvisional`, `antiguedadEnGrupos`, `antiguedadCxc`, `antiguedadPorPagar`, `lunesDe`, `flujoSemanal`, `margenPorProyecto`; constantes `FOLIOS_PRUEBA_REPORTES`, `SEMANAS_FLUJO`, `RANGOS_REPORTE`, `RANGO_SIN_FECHA`, `FUENTES_VENCE` |

### Cambios fuera de §6.R (marcados "R (incremento 6)")
- `MODULOS_` (+ `modReportes_()`).
- `HOJAS_COBRANZA.Esquemas` (+ `fecha_esperada`) y `colEsq_`.
- `datosCobranza_`: cada etapa trae `fechaEsperada`.
- `escribirEsquema_`: conserva la fecha por nombre de etapa (lo usan `marcarAceptada`, `guardarEsquema` y `firmarContrato`).
- `vistaCobranza_`: `fechasEditables` (con aceptada o firmado, con etapas, proyecto no Cancelado); `esquema[i].fechaEsperada`.
- §6.P (revisión 6b): `venceSinFactura(o)` = recepción, o entrega, o la orden + días de crédito; `saldoOrdenCompra` la usa para el
  "siguiente" (antes tenía la regla escrita ahí; mismo resultado).

### Interfaz (`web/cotizador/index.html`)
- Botón `#tabRep` en `#navGrupos`, `<section id="vistaRep">`, `<div id="cobFechas">` dentro de `#cobModEsquema`.
- `pintarCobranza` termina con `avisarModulos('alCobranza', v)` (evento nuevo para módulos).
- `<script id="mod-reportes">`: registra el grupo `rep` en `GRUPOS`/`BOTON_TAB`/`BOTON_GRUPO`; `window.REPORTES = {ver, actualizar,
  descargar, csv, guardarFechas, permitidos}`; `registrarModulo` con `alPermisos` (pestaña y borra de memoria lo que ya no puede
  ver), `alVerTab`, `contexto` (`{reporte}` con la pestaña abierta), `alSincronizar` (recibe el reporte; si cambió el día lo vuelve
  a pedir, porque `sincronizar` no llega a los módulos cuando no cambió ninguna colección) y `alCobranza` (bloque de fechas).

## 4. Reglas de cálculo

- **CxC (`etapasPorCobrar`):** solo contratos **Firmados** de proyectos que existen, no Cancelados ni de prueba. Saldo de cada etapa
  = `resumenCobranza(contrato, etapas, pagos)` (el mismo reparto que la vista del proyecto: pagos Vigentes en orden de registro; el
  excedente pasa a la siguiente etapa; un pago en otra moneda cuenta por su `monto_aplicado` en la moneda del contrato; un pago
  cancelado o anulado no cuenta). Sin esquema guardado: una etapa "Total". Solo etapas con saldo > 0. Fecha = `fecha_esperada`
  (una fecha mal escrita a mano = sin fecha).
- **Rangos (`rangoAntiguedad`):** días de atraso = hoy − fecha. ≤ 0 No vencido (hoy incluido), 1–30, 31–60, 61–90, > 90; sin fecha
  aparte. Vencido = todo menos No vencido y Sin fecha.
- **CxP (`porPagarProveedores` / `tramosPorPagar`):** órdenes vigentes (`ocVigente`: ni Cancelada ni Anulada; tampoco `esAnulado_`),
  no de proyectos de prueba, **sin las órdenes anteriores sin pago registrado** (`esOrdenAnteriorSinPago`: sin `req_folio`, sin pago
  Vigente y sin factura Vigente; van en `anteriores`, decisión 11). Saldo con `saldoOrdenCompra` (P, con las facturas de la orden: retenciones); nada si `completo`.
  Fecha (decisión 10): (1) facturas Vigentes de la orden en su moneda, de la que vence antes a la última, y lo pagado cubre primero
  las que vencen antes; (2) lo que ninguna factura cubre (más de 1.00), completo en la fecha del "siguiente" de P sin facturas o, si
  no la da, `venceSinFactura` ('plan' si la orden tiene plan; si no, 'estimada' = "Sin factura"). Una orden puede quedar en varios
  rangos.
- **Agrupar (`antiguedadEnGrupos`):** cliente (por `cliente_id`) → proyecto; proveedor (por id) → orden. Un grupo es de una moneda:
  un cliente con proyectos en MXN y USD sale dos veces. Grupos del más vencido al menos; totales por moneda (MXN primero).
- **Flujo (`flujoSemanal`):** ver decisión 7. Cobros = partidas de CxC; pagos = partidas de CxP. Neto = cobros − pagos de la semana;
  acumulado = suma de netos desde la semana 1. Por moneda.
- **Margen (`margenPorProyecto`):** contratos Aceptados o Firmados de proyectos no Cancelados ni de prueba. Contratado = `subtotal` (sin
  IVA). Costos = `costosDeOrdenes(órdenes vigentes)` + `costosExtra[folio]`. Margen con `margenProyecto` (el mismo cálculo de la
  tarjeta de margen del proyecto). Totales por línea y moneda solo de Firmados sin error. **Incremento 7:** gastos y nómina se
  agregan pasando `d.costosExtra = {folio: [{concepto: 'Gastos', moneda, monto, cantidad}, {concepto: 'Nómina', …}]}` (en la moneda
  del contrato) desde `reporteMargen`; la interfaz y el CSV ya hacen una columna por concepto (`conceptos`).

## 5. Integración con el módulo P (puntos exactos)

1. **`saldoOrdenCompra_()`** (§6.R): devuelve `saldoOrdenCompra` en cuanto exista (la de P) y si no `saldoOrdenCompraProvisional`. Al
   integrar **no hay que tocar nada**; después se puede borrar `saldoOrdenCompraProvisional` (y la rama del `typeof`). Las pruebas
   de R lo aceptan así (`tests/reportes.test.js`) y se comprobó que el mismo archivo pasa con una `saldoOrdenCompra` de P presente
   (sin plan, con `vence` lleno: las cifras no cambian).
2. **Forma que R usa del resultado:** `saldo`, `completo`, `esperado`, `pagado` y `siguiente {concepto, monto, vence}` (`vigentes` no
   se usa). Si `vence` no es `AAAA-MM-DD`, se ignora.
3. **Pagos que R le pasa:** las filas de `PagosProveedores` de esa orden en cualquier estado (sin las anuladas), con `pagoProvDesdeFila_`;
   si P agrega `tipo`, `pagoProvDesdeFila_` debe leerlo (R no lo necesita). Movimientos: `movimientosPorOc_(libro)[OC]`.
4. **Colecciones:** el caché de CxP y del flujo depende de `oc`, `pagosProveedores`, `facturasProveedor`, `requisiciones`, `proyectos`
   y `anulaciones`. Si P guarda el plan de pagos en otra colección, agregarla a `REPORTES_.cxp` y `REPORTES_.flujo`.
5. **Sin conflicto con `antiguedadCxp`:** R no la llama ni la cambia. Tampoco toca §4.3/§4.4/§4.5 ni `registrarPagoProveedor`.
6. Si P deja una orden "Pagada parcial" con su saldo, R ya la muestra por su saldo (probado con un `saldoFn` de pagos parciales).

## 6. Pruebas

`tests/reportes.test.js` (174 aserciones; corre en `bash tests/todas.sh`):
- **Lógica pura:** fechas y lunes de la semana; folios de prueba (con clave, lista extra); rangos en sus bordes (hoy, 1, 30, 31, 60,
  61, 90, 91; sin fecha; fecha que no existe); validación de lo que manda la interfaz. CxC: cobro parcial, excedente que pasa a la
  siguiente etapa, pago cancelado, proyecto USD pagado en MXN, etapa sin fecha, etapa que vence hoy, proyecto cancelado, por firmar,
  de prueba (y cotización de prueba), cerrado con saldo, sin esquema, mismo cliente en MXN y USD, suma = saldo del proyecto. CxP:
  sin factura (estimada), facturas en orden con lo pagado (una orden en dos rangos), factura cancelada o de otra moneda ignorada,
  orden cancelada, anulada, pagada, con pago cancelado, de proyecto de prueba, de proyecto cancelado (sí cuenta), plan de pagos de P,
  "siguiente" sin plan, pagos parciales de P, completo de P, devuelto sin reponer, forma exacta de la provisional. Flujo: semanas,
  vencidos a la semana 1, hoy no vencido, sin fecha, después de 13 semanas, neto y acumulado, MXN y USD aparte. Margen: canceladas
  y anuladas fuera, por línea y moneda, por firmar no suma, costo en otra moneda, costos del incremento 7.
- **doPost:** fecha esperada (columna creada sola; antes y después de firmar; se conserva al cambiar la aceptada, al editar el
  esquema (por nombre) y al firmar; esquema cambiado = error sin escribir; fecha no válida; borrar; Bitácora y sin renglón si nada
  cambió; texto, no fecha de Sheets; versión de contratos; permisos de compras, ventas, solo requisiciones y super admin; sin
  contrato). Permisos de los cuatro reportes para cobranza, compras, super admin, ventas, solo requisiciones y quien pide. Cifras
  sembradas por la API e iguales a la vista del proyecto y a la tarjeta de margen; pago anulado; compras sin montos de contrato;
  caché (otra consulta no lee; una escritura de su colección sí; otra colección no); `FOLIOS_PRUEBA`; sincronizar por rol.
- **Interfaz** (mod-reportes conectado al servidor simulado, estilo `tests/recepcion.test.js` / `interfaz.test.js`): pestaña por
  rol (cobranza, compras, super admin, ventas), cada reporte pintado, CSV (BOM, encabezados, apóstrofo, USD en su renglón), contexto
  de sincronización, bloque de fechas en Cobranza (valores, estado, solo manda lo que cambió, sin cambios no llama, sin contrato no
  se ve).

`tests/revision6-reportes.test.js` (revisión 6b): cada hallazgo de la revisión con el escenario que fallaba antes del arreglo —
fecha de lo que no tiene factura igual a Cuentas por pagar (sección 2), órdenes anteriores sin pago registrado (sección 1: pura,
sembradas por la API como las de la fase 3, interfaz y CSV)—.

`bash tests/todas.sh`: 25 archivos + sintaxis de la interfaz, todo en verde.

## 7. Publicación

- **Sin permisos nuevos de Google** (solo Sheets, Cache y Properties que ya se usan). No hay que correr nada en el editor: la columna
  `fecha_esperada` se crea sola la primera vez que alguien de cobranza abre un proyecto o el resumen.
- Orden: (P y R integrados en `incremento-6`) → `bash tests/todas.sh` → respaldo del libro de cobranza (cambia el encabezado de
  `Esquemas`) → `npx clasp push --force` → nueva versión del deployment como **facilities@** → `CLOUDFLARE_ACCOUNT_ID=… npx --yes
  wrangler@4 deploy` (la interfaz nueva con la API vieja: la pestaña Reportes aparece y sus llamadas responden "Función no permitida";
  por eso API primero).
- Después de publicar: abrir Reportes como leo@ (super admin) y revisar contra el resumen de cobranza y Cuentas por pagar (las
  diferencias esperadas están en §0.1). Capturar las fechas esperadas de los contratos firmados (sin ellas todo cae en "Sin fecha").
- Avisar a cobranza: dónde se capturan las fechas; a compras: el reporte de CxP incluye lo que falta facturar, en la fecha de su
  siguiente pago (recepción o entrega + días de crédito, o el plan), y que las órdenes de antes de las requisiciones que nunca se
  pagaron en CAPRI salen aparte (no se pueden pagar; si ya se pagaron fuera, basta saberlo; si no, decidir qué hacer con ellas).
- Al integrar: pasar a `CLAUDE.md` §4.5.2 (fecha esperada), §4.6 (puras), §4.7 (pestaña Reportes), §4.8 (módulo R), §5 (columna y
  `FOLIOS_PRUEBA`), §6 (decisiones de §0), §7 (regla: reportes solo lectura, monedas aparte) y §9; y el Manual (regla 14).
