# Incremento 6 (CAPRI) · Módulo R: reportes de CxC y CxP

Rama `incremento-6-r` (sobre `incremento-6-base` = `incremento-5` + `docs/incremento-6.md`). Contrato: `docs/incremento-6.md` §1,
§3 y §4. Spec aprobado por Leo con sus valores por omisión: "CAPRI — what's missing: spec for increments 6–8", sección 2 y
decisiones 4 y 5. Este archivo es para integrar: al hacer el merge se pasa lo necesario a `CLAUDE.md` (§4.5.2, §4.6, §4.7, §4.8,
§5, §6.11, §7, §9) y al Manual (Cobranza, un apartado nuevo "Reportes", Reglas de oro, Historial, Pendientes).

## 0. Desviaciones y decisiones que hay que revisar (léelas primero)

1. **Diferencias esperadas con Cuentas por pagar y con el resumen de cobranza** (revisión 6b: todas, con su dirección). R no
   llama a `antiguedadCxp` ni a `resumenGeneralCobranza` y **no cambia lo que hacen** `cuentasPorPagar` ni
   `resumenCobranzaGeneral`. La antigüedad de CxP es **por orden y por saldo** (spec: "open balance per supplier and order"): el
   saldo de `saldoOrdenCompra` (P) con las fechas de Cuentas por pagar (decisión 10: la misma `venceSinFactura`, las mismas claves
   de rangos que `RANGOS_CXP`). Al revisar después de publicar, estas son **todas** las diferencias que deben salir; cualquier otra
   es un error. `tests/revision6-reportes.test.js` §3 comprueba cada renglón contra las funciones de verdad.

   **Antigüedad de CxP (R) contra Cuentas por pagar**

   | Caso | Reporte de CxP (R) | Cuentas por pagar | Total de R |
   |---|---|---|---|
   | Orden de un proyecto de prueba (`FOLIOS_PRUEBA_REPORTES` + `FOLIOS_PRUEBA`, decisión 4) | fuera | cuenta | **menor** |
   | Una orden **sin facturas ni pagos** | en la antigüedad, con IVA: sin plan, en recepción/entrega + crédito; con plan, por etapa (decisión 10) | en "Falta factura", sin IVA, fuera de los totales | **mayor** |
   | Orden anterior sin pago registrado (decisión 11) | bloque aparte con cuántas son, fuera de los totales y del flujo | en "Falta factura", fuera de los totales | igual (ninguno la suma) |
   | Saldo sin factura de una orden sin ninguna fecha válida (solo editando la hoja a mano) | "Sin fecha" | vence hoy ("Por vencer") | mismo monto, otro rango |
   | Factura en otra moneda que su orden (solo a mano: `validarFacturaProveedor` lo rechaza) | se ignora: el saldo va en la moneda de la orden, "Sin factura" | la factura completa en su moneda **y** el saldo de la orden en la suya (nunca se resta una moneda de otra) | igual en la moneda de la orden |

   Iguales en los dos (desde la integración con la revisión de P, 29/10/2026): órdenes sin pagos con lo devuelto sin reponer (las dos
   descuentan), lo no facturado de una orden con facturas (fila "Saldo" por etapa del plan en las dos), plan con el
   anticipo pagado en parte (por etapa en las dos), órdenes con pagos parciales (facturas en orden de vencimiento con lo pagado + fila "Saldo" en la fecha del
   siguiente pago de P), plan de pagos con el anticipo ya pagado (el resto en recepción/entrega + crédito), retenciones, órdenes de proyectos Cancelados (cuentan, decisión 2), canceladas y anuladas
   (fuera), lo pagado dentro de la tolerancia (no se lista), el **saldo a favor** por orden (aparte en las dos, decisión 13; R sin
   los proyectos de prueba).

   **Antigüedad de CxC y flujo (R) contra el resumen de cobranza**

   | Caso | CxC y flujo (R) | Resumen de cobranza ("Por cobrar") | Total de R |
   |---|---|---|---|
   | Proyecto o cotización aceptada de prueba (decisión 4) | fuera | cuenta | **menor** |
   | Contrato desbloqueado con pagos (decisión 5) | cuenta, marcado "Desbloqueado" | "Por firmar": su saldo no entra a "Por cobrar" | **mayor** |
   | Pago de más dentro de la tolerancia (≤ 1.00) | la etapa que queda negativa no se lista (cuenta 0) | el saldo del proyecto queda negativo; desde la revisión del incremento 7 (dinero) ya no resta de "Por cobrar" (solo suma saldos positivos; un saldo a favor de más de 1.00 va aparte) | igual |
   | Etapa sin fecha esperada | CxC: "Sin fecha"; flujo: aparte, fuera del neto | (no usa fechas) | igual en CxC |

   Iguales en los dos: el saldo de cada proyecto (mismo `resumenCobranza`: la suma de sus etapas es su saldo), proyectos Cancelados
   y contratos por firmar sin pagos (fuera), Cerrados con saldo (cuentan), lo anulado (fuera).

   **Margen (R) contra la tarjeta de margen del proyecto y el resumen de cobranza:** por proyecto, la misma cifra que la tarjeta
   (`margenProyecto`; las órdenes anteriores sin pago también cuentan). En los totales por línea y moneda: los proyectos de prueba no
   entran (en el resumen sí: **menor**); con un costo en otra moneda, el reporte suma los demás y dice cuántos quedaron fuera (el
   resumen deja en blanco el margen de esa moneda; decisión 6). Desbloqueado: "Por firmar" y no suma en los dos.
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
   firmado); en el margen se muestran y **no suman**, como en el resumen de cobranza. **Desbloqueados** (revisión 6b): un contrato
   que se firmó, se desbloqueó (`desbloquearContrato` lo regresa a Aceptada y conserva los pagos) y tiene algún pago Vigente **sigue
   en CxC y en el flujo**, marcado **"Desbloqueado"** (chip en pantalla, columna "Contrato" en el CSV de CxC): se le sigue cobrando
   y antes desaparecía de los dos reportes. Se reconoce sin leer la Bitácora (`contratoDesbloqueado`: Aceptada + pago Vigente, que
   solo puede existir tras un desbloqueo porque `registrarPago` exige contrato firmado). Uno aceptado sin pagos sigue fuera aunque
   se haya desbloqueado (no hay nada cobrado; vuelve en cuanto se firme). **En el margen no cambia:** se muestra "Por firmar" y no
   suma, como en el resumen de cobranza (la revisión no lo pidió y el contrato de verdad no está firmado).
6. **Margen con un costo en otra moneda** (orden de compra en una moneda que no es la del contrato): el renglón dice "Revisar" y no
   suma; los totales de su línea suman solo los demás y dicen cuántos quedaron fuera. (El resumen de cobranza, en cambio, deja el
   margen total de esa moneda en blanco.)
7. **Semanas del flujo:** de lunes a domingo; la semana 1 es la de hoy y se llama **"Semana en curso"** (revisión 6b): si hoy no es
   lunes es **parcial** y dice cuántos días le quedan con hoy (un domingo, "solo queda hoy"), en pantalla, en las partidas ("En
   curso") y en el CSV ("Semana en curso (parcial: …)" en la columna Semana). **Siguen siendo 13 semanas** contando la en curso: un
   domingo el horizonte real es de 12 semanas y un día (no se recorre para no cambiar las semanas de lunes a domingo ni el número
   de columnas). Lo vencido (fecha anterior a hoy) cae en la semana en curso y se marca; **lo que vence hoy no está vencido**. Sin
   fecha y después de la semana 13 van aparte y no entran al neto. El acumulado empieza en cero (no conoce el saldo en bancos).
8. **Fecha esperada al reescribir el esquema:** se conserva **por el nombre de la etapa** (sin acentos ni mayúsculas). Una etapa
   nueva o renombrada queda sin fecha (nunca hereda la de otra). No se edita en proyectos Cancelados; sí en Cerrados.
9. **Pestaña:** "Reportes" es un grupo propio en la barra (entre Cobranza y Administración). La interfaz decide si se ve con
   `PERMISOS` (cobranza → CxC y margen; compras → CxP; super admin → flujo y todos), con la misma regla que `permisosReportes_`;
   el servidor revisa en cada llamada.
10. **Fechas de CxP** (revisión 6b; el reparto por etapa del plan, decisión final del coordinador): primero las **facturas**, en su
    vencimiento (lo pagado cubre primero la que vence antes), como Cuentas por pagar. Lo que ninguna factura cubre (más de 1.00:
    Cuentas por pagar tampoco lista un resto dentro de la tolerancia):
    - **Sin plan de pagos:** completo en una sola fecha, la del "siguiente" de P sin facturas = `venceSinFactura` (recepción, o
      entrega, o la orden + días de crédito), igual que la fila "Saldo" de Cuentas por pagar y el "Siguiente pago" de la orden.
    - **Con plan de pagos: por etapa.** Los pagos y las facturas cubren la orden desde el principio (la etapa 1 primero, como reparte
      P), así que lo que falta es el final de la orden y cada etapa pone su parte en su fecha: el **anticipo** (la etapa 1 de un plan
      de más de una) en la **fecha de la orden** y **las demás etapas en `venceSinFactura`** (un plan de una sola etapa no tiene
      anticipo: va en `venceSinFactura`). Son las fechas que P da como "Siguiente pago" en cada etapa. Ejemplo: orden de 1,000 con
      plan 30/70 y 15 días de crédito, sin pagos ni facturas → 300 en la fecha de la orden y 700 en entrega (o recepción) + 15; con el
      anticipo pagado, solo los 700; con una factura del anticipo sin pagar, la factura en su vencimiento y los 700 en su fecha.
      Las etapas salen de `s.etapas` (P) o, con la función provisional, de `montosDeEsquema` sobre el plan (`etapasDelPlan_`).
    - Por qué por etapa: el flujo de efectivo tiene que ser exacto. La primera versión de esta revisión ponía todo el saldo en la
      fecha del anticipo (una sola fecha, como la fila "Saldo"), y eso adelantaba el 70 % semanas antes de que se deba. Desde la
      integración con la revisión de P (29/10/2026), Cuentas por pagar parte igual lo no facturado por etapa (`tramosSinFactura`) y
      las dos pantallas dan las mismas fechas y montos.
11. **Órdenes anteriores sin pago registrado** (revisión 6b): una orden vigente **sin requisición, sin pago Vigente y sin factura
    Vigente** (las de la fase 3, de antes de las requisiciones: Recibidas, Emitidas y alguna Pagada sin renglón de pago) no es deuda
    que se pueda saldar desde CAPRI: `registrarPagoProveedor` exige requisición y una Recibida tampoco se puede cancelar (una Emitida
    sí, y al cancelarla sale del bloque). Antes R la sumaba completa como deuda vencida para siempre. Ahora **va aparte**: fuera de
    `porPagarProveedores`, de los totales de CxP y del flujo; la antigüedad de CxP la lista en su propio bloque
    **"Órdenes anteriores sin pago registrado (n)"** (orden, proveedor, proyecto, estado, fecha, total de la orden y total por
    moneda) y el flujo dice cuántas dejó fuera. **Su costo sigue en el margen** (igual que la tarjeta de margen). Con un pago
    Vigente, una factura Vigente o una requisición deja de ser "anterior" y vuelve a la antigüedad normal.
12. **Fecha esperada editada a mano en `Esquemas`** (revisión 6b): llega a la antigüedad de CxC y al flujo **en la misma ventana
    que las demás hojas editadas a mano** (Contratos: 10 min). `esquemasCache_` es una fuente con huella (`fuenteConHuella_`) de la
    pestaña Esquemas sobre la colección `contratos`: guarda solo un MD5 de las filas y, si cambió con la misma versión, sube
    `contratos`; con eso cambia la clave de caché de los reportes y `sincronizar` manda el reporte abierto (y la vista y el resumen
    de cobranza, que también dependen de `contratos`). Se revisa **solo desde `sincronizar`** (en segundo plano, con permiso de
    cobranza —el super admin lo tiene—), cada 10 min y después de cada escritura de contratos. **No está en `REVISAR_A_MANO_`** a
    propósito: ahí se leería la hoja Esquemas en peticiones normales (no en segundo plano) después de cada escritura de contratos,
    que es justo lo que la rapidez quitó. Consecuencia: si nadie con cobranza tiene la app abierta, una edición a mano se ve
    cuando el caché del reporte vence o al día siguiente (los reportes de CxC y flujo dependen del día), como pasa con las demás
    hojas.
13. **Saldo a favor con proveedores** (integración del incremento 6, con `saldoOrdenCompra(…).aFavor` de P): lo pagado de más en una
    orden (p. ej. se pagó completa y después se devolvió material sin reponer) es dinero que el proveedor le debe a Helgen, como
    nota de crédito o reembolso. La antigüedad de CxP lo muestra en su propio bloque, **"Saldo a favor (nota de crédito o
    reembolso)"**, por orden (orden, requisición, proveedor, proyecto, lo que se debía, pagado, a favor) y con el total por moneda;
    en el CSV va en su **propia sección**, después de una línea en blanco, con sus columnas. **Nunca se resta de lo que se debe** ni
    se compensa con otra orden (ni del mismo proveedor), las monedas nunca se juntan y **no entra al flujo de 13 semanas** (una
    orden con saldo a favor está completa, así que no tiene partidas). Mismas cifras por orden que Cuentas por pagar; como en todo
    R, sin los proyectos de prueba. Con la función provisional de saldo (sin `aFavor`) el bloque no sale.

## 1. Qué hace

1. **Fecha esperada por etapa de cobranza** (decisión 4). Columna nueva `fecha_esperada` en `Esquemas`. Opcional. La cambia el rol
   de cobranza (y super admin) **aunque el contrato esté firmado**, porque no cambia montos; cada cambio va a la Bitácora de cobranza
   ("Fechas esperadas de cobro", `Instalación: sin fecha → 2026-11-15`). Se ve y se edita en Cobranza → proyecto → "2 · Esquema de
   pagos" → bloque "Fechas esperadas de cobro" (etapa, saldo, fecha, estado: vencida hace N días · vence hoy · en N días · sin
   fecha · cobrada). La interfaz manda solo las etapas que cambiaron.
2. **Pestaña Reportes** con cuatro reportes, cada uno con "Actualizar" y "Descargar CSV" (UTF-8 con BOM; texto que empieza con
   `= + - @`, tabulador o retorno de carro con apóstrofo —revisión 6b; los dos últimos solo llegan editando una hoja a mano, la app
   recorta lo que se captura—; números con 2 decimales), MXN y USD siempre aparte. Los CSV de fuera de R (resumen de cobranza y
   Cuentas por pagar) siguen con `= + - @`: no se tocaron en esta revisión.
   - **Antigüedad de cuentas por cobrar** (cobranza, super admin): por cliente y proyecto, en No vencido · 1–30 · 31–60 · 61–90 ·
     Más de 90 días · Sin fecha, con el total vencido. Cada proyecto lista sus etapas por cobrar con su fecha; un contrato
     desbloqueado con pagos va marcado "Desbloqueado" (decisión 5).
   - **Antigüedad de cuentas por pagar** (compras, super admin): por proveedor y orden, mismos rangos; cada orden dice de dónde sale
     la fecha (factura, plan de pagos o sin factura). Abajo, aparte y fuera de los totales, las **órdenes anteriores sin pago
     registrado** (decisión 11) con cuántas son, y el **saldo a favor** con proveedores (decisión 13). Sin datos de contrato ni
     margen. En el CSV, las anteriores van al final con la columna "Nota" y el saldo a favor en su propia sección.
   - **Flujo de efectivo · 13 semanas** (solo super admin): cobros esperados contra pagos esperados por semana, neto y acumulado; la
     semana 1 es la "Semana en curso" (parcial si hoy no es lunes) y dice cuánto de lo suyo está vencido; aparte sin fecha y después de la semana 13; lista de partidas. Dice cuántas
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

Nada en la Base de datos ni en el libro de compras. Caché (CacheService): `K_REP_<tipo>_<día>_<huella de pruebas>_<versiones>`; huella de
Esquemas: `F_esquemas_<versión de contratos>`, `H_esquemas`, `R_esquemas` (decisión 12).

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
| `reporteCxp()` *(API)* | `antiguedadPorPagar(datosReportes_({compras}), saldoOrdenCompra_())` (con `anteriores`: decisión 11, y `aFavor`: decisión 13) |
| `reporteFlujo()` *(API)* | `flujoSemanal({hoy, semanas: 13, cobros: etapasPorCobrar, pagos: porPagarProveedores})` + `ordenesAnteriores` (cuántas quedaron fuera) |
| `reporteMargen()` *(API)* | `margenPorProyecto(datosReportes_({cobranza, compras}))` |
| `saldoOrdenCompra_()` | **Punto de integración con P** (ver §5) |
| `foliosPrueba_()` | `FOLIOS_PRUEBA_REPORTES` + Script Property `FOLIOS_PRUEBA` |
| `datosReportes_(que)` | Lee contratos, esquemas (con fecha), pagos de clientes; órdenes, pagos a proveedores, movimientos y facturas; proyectos visibles. Sin lo anulado (estado `Anulada` o `esAnulado_`). No crea nada |
| `guardarFechasEsperadas(proyecto, fechas)` *(API)* | Ver §1.1. `fechas = [{orden, etapa, fecha}]`; si la etapa en ese número ya no se llama igual (el esquema cambió), error y no escribe nada. Con candado; escribe solo la celda de cada etapa que cambió; devuelve `vistaCobranza_` |
| Puras | `fechaIsoValida`, `esFolioPrueba`, `normalizarFechasEsperadas`, `rangoAntiguedad`, `ordenMonedas`, `contratoDesbloqueado`, `etapasPorCobrar`, `porPagarProveedores`, `tramosPorPagar`, `esOrdenAnteriorSinPago`, `ordenesAnterioresSinPago`, `saldosAFavor`, `saldoOrdenCompraProvisional`, `antiguedadEnGrupos`, `antiguedadCxc`, `antiguedadPorPagar`, `lunesDe`, `flujoSemanal`, `margenPorProyecto`; constantes `FOLIOS_PRUEBA_REPORTES`, `SEMANAS_FLUJO`, `RANGOS_REPORTE`, `RANGO_SIN_FECHA`, `FUENTES_VENCE` |

### Cambios fuera de §6.R (marcados "R (incremento 6)")
- `MODULOS_` (+ `modReportes_()`).
- `HOJAS_COBRANZA.Esquemas` (+ `fecha_esperada`) y `colEsq_`.
- `datosCobranza_`: cada etapa trae `fechaEsperada`.
- `escribirEsquema_`: conserva la fecha por nombre de etapa (lo usan `marcarAceptada`, `guardarEsquema` y `firmarContrato`).
- `vistaCobranza_`: `fechasEditables` (con aceptada o firmado, con etapas, proyecto no Cancelado); `esquema[i].fechaEsperada`.
- `esquemasCache_` (junto a `contratosCache_`) y una línea en `sincronizar` (revisión 6b, decisión 12): huella de la hoja Esquemas.
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

- **CxC (`etapasPorCobrar`):** solo contratos **Firmados** (y los desbloqueados con algún pago Vigente, `desbloqueado: true`, decisión 5) de proyectos que existen, no Cancelados ni de prueba. Saldo de cada etapa
  = `resumenCobranza(contrato, etapas, pagos)` (el mismo reparto que la vista del proyecto: pagos Vigentes en orden de registro; el
  excedente pasa a la siguiente etapa; un pago en otra moneda cuenta por su `monto_aplicado` en la moneda del contrato; un pago
  cancelado o anulado no cuenta). Sin esquema guardado: una etapa "Total". Solo etapas con saldo > 0. Fecha = `fecha_esperada`
  (una fecha mal escrita a mano = sin fecha).
- **Rangos (`rangoAntiguedad`):** días de atraso = hoy − fecha. ≤ 0 No vencido (hoy incluido), 1–30, 31–60, 61–90, > 90; sin fecha
  aparte. Vencido = todo menos No vencido y Sin fecha.
- **CxP (`porPagarProveedores` / `tramosPorPagar`):** órdenes vigentes (`ocVigente`: ni Cancelada ni Anulada; tampoco `esAnulado_`),
  no de proyectos de prueba, **sin las órdenes anteriores sin pago registrado** (`esOrdenAnteriorSinPago`: sin `req_folio`, sin pago
  Vigente y sin factura Vigente; van en `anteriores`, decisión 11). Lo pagado de más (`aFavor` de P) va aparte en `aFavor`
  (`saldosAFavor`, decisión 13), nunca contra lo que se debe. Saldo con `saldoOrdenCompra` (P, con las facturas de la orden: retenciones); nada si `completo`.
  Fecha (decisión 10): (1) facturas Vigentes de la orden en su moneda, de la que vence antes a la última, y lo pagado cubre primero
  las que vencen antes; (2) lo que ninguna factura cubre (más de 1.00): sin plan, completo en la fecha del "siguiente" de P sin
  facturas o, si no la da, `venceSinFactura` ('estimada' = "Sin factura"); con plan, el final de la orden partido en sus etapas, el
  anticipo en la fecha de la orden y las demás en `venceSinFactura` ('plan', con el nombre de la etapa). Una orden puede quedar en
  varios rangos.
- **Agrupar (`antiguedadEnGrupos`):** cliente (por `cliente_id`) → proyecto; proveedor (por id) → orden. Un grupo es de una moneda:
  un cliente con proyectos en MXN y USD sale dos veces. Grupos del más vencido al menos; totales por moneda (MXN primero).
- **Flujo (`flujoSemanal`):** ver decisión 7 (semana 1: `etiqueta` "Semana en curso", `parcial`, `diasRestantes` con hoy). Cobros = partidas de CxC; pagos = partidas de CxP. Neto = cobros − pagos de la semana;
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
2. **Forma que R usa del resultado:** `saldo`, `completo`, `esperado`, `pagado`, `siguiente {concepto, monto, vence}` (sin plan) y
   `etapas [{concepto, monto, acumulado}]` (con plan; sin ellas, R las arma del plan) (`vigentes` no se usa). Si `vence` no es
   `AAAA-MM-DD`, se ignora.
3. **Pagos que R le pasa:** las filas de `PagosProveedores` de esa orden en cualquier estado (sin las anuladas), con `pagoProvDesdeFila_`;
   si P agrega `tipo`, `pagoProvDesdeFila_` debe leerlo (R no lo necesita). Movimientos: `movimientosPorOc_(libro)[OC]`.
4. **Colecciones:** el caché de CxP y del flujo depende de `oc`, `pagosProveedores`, `facturasProveedor`, `requisiciones`, `proyectos`
   y `anulaciones`. Si P guarda el plan de pagos en otra colección, agregarla a `REPORTES_.cxp` y `REPORTES_.flujo`.
5. **Sin conflicto con `antiguedadCxp`:** R no la llama ni la cambia. Tampoco toca §4.3/§4.4/§4.5 ni `registrarPagoProveedor`.
6. Si P deja una orden "Pagada parcial" con su saldo, R ya la muestra por su saldo (probado con un `saldoFn` de pagos parciales).

## 6. Pruebas

`tests/reportes.test.js` (176 aserciones; corre en `bash tests/todas.sh`):
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

`tests/revision6-reportes.test.js` (revisión 6b, 117 aserciones): cada hallazgo de la revisión con el escenario que fallaba antes del arreglo —
fecha de lo que no tiene factura igual a Cuentas por pagar (sección 2), órdenes anteriores sin pago registrado (sección 1: pura,
sembradas por la API como las de la fase 3, interfaz y CSV), cada diferencia de §0.1 con su dirección contra `antiguedadCxp`,
`resumenGeneralCobranza` y el margen (sección 3; también revisa que el doc la liste), contratos desbloqueados con pagos (sección 4: pura, firmado → pago →
desbloqueo por la API, CxC, flujo, chip y CSV; por firmar sin pagos sigue fuera), semana en curso del flujo (sección 5: domingo,
lunes y jueves; pantalla y CSV), apóstrofo con tabulador y CR al inicio (sección 6: cliente y proyecto editados a mano en la
hoja), fecha esperada editada a mano en Esquemas (sección 7: antes de la revisión nada; vencida la marca, sube `contratos`, manda el
reporte abierto, CxC y flujo con la fecha nueva, una sola vez), plan de pagos por etapa (sección 8: la orden OC-B de la revisión,
recibida antes, anticipo pagado en parte, anticipo facturado, factura por más que el anticipo, tres etapas, plan de una etapa,
función provisional, suma = saldo de P y flujo), saldo a favor con proveedores (sección 9: pura —no baja lo que se debe ni se
compensa, monedas aparte, sin proyectos de prueba, fuera del flujo, igual a Cuentas por pagar— y por la API: pagada completa,
material dañado devuelto al proveedor, bloque en pantalla y sección propia del CSV)—.

`bash tests/todas.sh`: 26 archivos + sintaxis de la interfaz, todo en verde.

## 7. Publicación

- **Sin permisos nuevos de Google** (solo Sheets, Cache y Properties que ya se usan). No hay que correr nada en el editor: la columna
  `fecha_esperada` se crea sola la primera vez que alguien de cobranza abre un proyecto o el resumen.
- Orden: (P y R integrados en `incremento-6`) → `bash tests/todas.sh` → respaldo del libro de cobranza (cambia el encabezado de
  `Esquemas`) → `npx clasp push --force` → nueva versión del deployment como **facilities@** → `CLOUDFLARE_ACCOUNT_ID=… npx --yes
  wrangler@4 deploy` (la interfaz nueva con la API vieja: la pestaña Reportes aparece y sus llamadas responden "Función no permitida";
  por eso API primero).
- Si alguien captura fechas esperadas directo en la hoja Esquemas, los reportes las toman en la siguiente revisión (≤ 10 min con la
  app abierta por alguien de cobranza; decisión 12).
- Después de publicar: abrir Reportes como leo@ (super admin) y revisar contra el resumen de cobranza y Cuentas por pagar (las
  diferencias esperadas están en §0.1). Capturar las fechas esperadas de los contratos firmados (sin ellas todo cae en "Sin fecha").
- Avisar a cobranza: dónde se capturan las fechas; a compras: el reporte de CxP incluye lo que falta facturar, en su fecha
  (recepción o entrega + días de crédito; con plan de pagos, el anticipo en la fecha de la orden y cada etapa siguiente en
  recepción o entrega + días de crédito), y que las órdenes de antes de las requisiciones que nunca se
  pagaron en CAPRI salen aparte (no se pueden pagar; si ya se pagaron fuera, basta saberlo; si no, decidir qué hacer con ellas), y
  que lo pagado de más sale como "Saldo a favor" para pedir la nota de crédito o el reembolso (no baja lo que se debe).
- Al integrar: pasar a `CLAUDE.md` §4.5.2 (fecha esperada), §4.6 (puras), §4.7 (pestaña Reportes), §4.8 (módulo R), §5 (columna y
  `FOLIOS_PRUEBA`), §6 (decisiones de §0), §7 (regla: reportes solo lectura, monedas aparte) y §9; y el Manual (regla 14).
