# Incremento 6 (CAPRI) · Módulo P: pagos parciales a proveedores

Rama `incremento-6-p` (sobre `incremento-6-base`). Contrato: `docs/incremento-6.md` §1, §2 y §4. Spec aprobado por Leo con sus
valores por omisión ("CAPRI — what's missing: spec for increments 6–8", sección 1, decisiones 1–3). Este archivo es para integrar:
al hacer el merge se pasa lo necesario a `CLAUDE.md` (§1, §4.5.4, §4.6, §4.7, §4.9 o una §4.10 nueva, §5, §6.13, §6.17, §9) y al
Manual (Compras, Requisiciones, Tareas frecuentes, Historial, Pendientes).

## 1. Qué hace

1. **Varios pagos por orden** (`PGP-`) hasta que la orden queda completa. Cada pago guarda su **tipo**, que decide el servidor:
   **Anticipo** (todavía no se recibe nada), **Parcial** (ya se recibió algo) o **Liquidación** (el que la completa).
2. **Tope:** lo pagado (en la moneda de la orden) nunca pasa de lo esperado + `TOLERANCIA_PAGO` (1.00). Lo esperado es el total de
   la orden o, con material devuelto sin reponer, el total por pagar (`totalPorPagarOrden`, regla del incremento 5); si ya está
   facturada completa con retenciones, el total de sus facturas (`porFacturas`; revisión, §11). Es decir: un pago no pasa del saldo
   que se muestra (+1.00). Completa = saldo ≤ 1.00. Lo pagado de más (p. ej. tras devolver material ya pagado) es **saldo a favor**.
3. **Plan de pagos opcional** (decisión 3) en la orden: `[{concepto, porcentaje}]`, 1 a 10 etapas, suma exacta 100 %. Se captura
   al autorizar (flujo de siempre) o en la propuesta de compras (flujo con aprobaciones: aprobaciones lo ve y pasa a la orden con el
   visto bueno). Va en el PDF de la orden ("Plan de pagos: Anticipo 30% ($487.20) · Contra entrega 70% ($1,136.80)").
4. **Sin estado nuevo** de orden ni de requisición. La orden sigue **Emitida** hasta completarse; entonces pasa a **Pagada** (o
   **Recibida** si ya se había recibido todo). La requisición no cambia con un pago parcial; el que completa hace lo de siempre
   (Autorizada → Pagada, En camino sigue En camino, Recibida → Cerrada, o sigue Recibida si hay una devolución abierta). La interfaz
   muestra la etiqueta derivada **"Pagada parcial"** (orden Emitida con pagos que no la completan): compras, aprobaciones y quien
   pidió (este último **sin montos** ni pagos).
5. **Con cualquier pago Vigente se puede recibir** (decisión 1): `recibeAntesDePagar_` también es verdadero con un pago parcial.
   Se reutiliza el camino del crédito del proveedor: "Recibí el material" deja la requisición **Recibida** con la orden Emitida (con
   su fecha de recepción) y el pago que completa la orden la cierra.
6. **Centro de mando** (decisión 2): el primer pago Vigente forma `oc.pagada` (sin montos); los siguientes no avisan. Cancelar un
   pago no avisa nada (como hoy; si después de cancelar todos se vuelve a pagar, otra vez `oc.pagada`, como hoy).
7. **Correos:** `req.pagada` solo cuando la orden queda completa (no en cada parcial). Nuevo **`req.pagoparcial`** ("Pagada parcial,
   por recibir", sin montos ni porcentaje) con el **primer** pago parcial, a quien recibe y a quien pidió, porque desde ahí ya puede
   confirmar que llegó. Mismas condiciones que `req.pagada` (flujo de siempre, proyecto no ligado, no recibida) y además no con
   crédito del proveedor (ya podía recibir antes de pagar).
8. **Cancelar un pago** (motivo) cancela ese pago y recalcula la orden sin él; no se puede con la requisición **Cerrada** (regla de
   hoy). Ver la tabla de §4.
9. **Cuentas por pagar** por saldo: toda orden con facturas o pagos sale por lo que le falta (la misma cifra que Reportes → CxP),
   con vencimiento por factura (fecha + días de crédito) o, lo que no tiene factura, por etapa del plan. Pendientes de compras dice
   el saldo y lo que sigue. El saldo a favor sale aparte (nunca se resta de lo que se debe).
10. Cada pago conserva **todas las reglas de siempre**: comprobante obligatorio (PDF/imagen, 10 MB, tipo por contenido), método,
    referencia sin número de tarjeta (`pareceNumeroTarjeta`), bloqueo de transferencia sin documentos del proveedor
    (`exigirDocumentosParaPagar_`, excepción de super admin con motivo), tipo de cambio si la moneda es otra, fecha no futura ni
    anterior a la orden, idempotencia por `idSolicitud` (`PGP_<id>`), candado, y nada de HTTP ni correos dentro del candado
    (`notificar_` y `avisarPortal_` solo forman; se mandan al soltarlo).

## 2. Hojas y columnas (libro de compras; se crean solas)

| Pestaña | Columna nueva | Contenido |
|---|---|---|
| `PagosProveedores` | **`tipo`** (V) | `Anticipo` · `Parcial` · `Liquidación`. Vacía en pagos de antes: se leen como `Liquidación` (eran el pago completo). Se corrige al cancelar o anular otro pago (§11, 8) |
| `PagosProveedores` | **`id_solicitud`**, **`huella_solicitud`** (W:X; revisión) | el `idSolicitud` del envío y la huella de su contenido: un reenvío no duplica el pago aunque se pierda el caché, y el mismo id con otros datos se rechaza (§11, 2). Vacías en pagos de antes |
| `OrdenesCompra` | **`plan_pago`** (AQ, después de `forma_pago`; se busca por nombre con `colOc_`) | JSON `[{concepto, porcentaje}]`; vacía = sin plan. Una celda que no se entiende (editada a mano) se ignora (`planDeCelda`) |
| `Requisiciones` | — | el plan de la propuesta va dentro de `propuesta (JSON)` (`planPago`), como `formaPago` en el incremento 5 |

`hojaDeArea_` reescribe los encabezados la primera vez que se lee cada pestaña; no hay que tocar la hoja. Nada se mueve.

## 3. Funciones

### Code.js §6.P (al final del archivo)
| Función | Qué hace |
|---|---|
| `saldoOrdenCompra(orden, pagos, movimientos)` *(pura; la usa R)* | Firma y forma del contrato §1: `{esperado, pagado, saldo, completo, vigentes: [{folio, fecha, montoAplicado, tipo}], siguiente: {concepto, monto, vence, etapa?, etapas?} \| null}` y además `moneda`, `etapas` (cada etapa del plan con `monto`, `cubierto`, `acumulado`, `completa` y, desde la revisión, `vence`), `porFacturas`, `cancelada` y `aFavor` (revisión). Ver decisiones 1–3 |
| `normalizarPlanPago(plan)` *(pura)* | Valida el plan (arreglo o JSON): null sin etapas; 1–10 etapas, concepto ≤ 60 sin repetir, % un número (o texto con un número) > 0 con 2 decimales, suma 100 % |
| `planDeCelda(v)`, `textoPlanPago(plan, total, moneda)`, `tipoDePagoProv(completo, recibido)` *(puras)* | Leer la celda, texto del PDF y bitácora, tipo del pago |
| `retiparPagosProv(pagos, completo, orden, movimientos)` *(pura; revisión)* | Tipos que cambian en los pagos que quedan al cancelar o anular otro (§11, 8) |
| `tramosSinFactura(saldo, restoCts)` *(pura; revisión)* | Lo que no tiene factura, por etapa del plan, cada parte con su vencimiento (§11, 7) |
| `pagosProvPorOc_(libro)`, `olvidarPagosProv_()` | Pagos del libro por orden, leídos una vez por petición (`MEMO_.pagosProv`, por id del libro); quien escribe pagos lo olvida (y también `olvidarFilas_`, al tomar el candado) |
| `esPagoParcial_(orden, saldo)`, `pagoParcialDe_(orden)`, `marcadorPagoParcial_(libro)` | "Pagada parcial" = Emitida, sin completar y con algo pagado: una sola regla para la vista de compras, las listas y lo que ve quien pidió (revisión) |
| `saldoDeOrden_(libro, orden, movs?, facturas?, pagos?)` | `saldoOrdenCompra` con lo del libro (facturas de la orden incluidas) |
| `aplicarPagoCompleto_(libro, hoja, req, hO, orden)` | Lo que hace el pago que completa una orden (estados de orden y requisición) |
| `completarSiCubierta_(libro, hoja, req, hO, orden, motivo)` | Lo ya pagado cubre la orden sin un pago nuevo (devolución, factura con retenciones o una orden que ya estaba así): la deja pagada (antes `completarPagoTrasDevolucion_`; revisión) |
| `huellaPagoProv_(d, bytes)`, `pagoYaRegistrado_(…)` | Idempotencia del pago por caché y por la hoja, con huella del contenido (revisión) |
| Constantes | `TIPO_PAGO_ANTICIPO/PARCIAL/LIQUIDACION`, `TIPOS_PAGO_PROV`, `ETIQUETA_PAGADA_PARCIAL`, `MAX_ETAPAS_PLAN`, `TIPO_CXP_SALDO` (en §5, junto a `antiguedadCxp`); `EVENTOS_CORREO.push('req.pagoparcial')` |

### Cambios fuera de §6.P (marcados con "P (incremento 6)")
- `HOJAS_COMPRAS` (dos columnas), `ordenDesdeFila_` (`planPago`), `pagoProvDesdeFila_` (`tipo`), `emitirOrdenCompra_` (escribe
  `plan_pago`; bitácora con el plan), `normalizarOrdenCompra` (`planPago`), `ordenDePropuesta` y `cotizarRequisicion` (el plan de la
  propuesta), `construirHtmlOrdenCompra` (fila "Plan de pagos").
- `registrarPagoProveedor` (reescrita: saldo, tipo, parcial o completo, avisos) y `cancelarPagoProveedor` (recalcula; ver §4);
  `normalizarPagoProveedor` (pagos parciales: `orden.pagado`; mensaje "pasa el saldo de la orden…").
- `TRANSICIONES_REQ.cancelarPagoRecibida` (Recibida → Recibida) y su verbo.
- `vistaRequisicion_` (`saldo`, `pagadaParcial`, `tiposPago`, `recibeAntesPor`, `puedePagar` con saldo, `puedeCancelarPago` para
  todo pago Vigente salvo con la requisición Cerrada), `reqParaSolicitante_` / `misRequisicionesDeHojas_` (`pagadaParcial`, sin
  montos), `listarRequisicionesDeHojas_` (`pagadaParcial` y filtro "Pagada parcial"), `vistaCompras_` (`pagado`, `saldo`,
  `pagadaParcial`, `siguiente` por orden), `vistaOperaciones_` (`orden.planPago`, `orden.pagadaParcial`; sin pagos).
- `cancelarOrdenCompra` (no con pagos Vigentes), `resolverDevolucion` y `registrarFacturaProveedor` (`completarSiCubierta_`),
  `planAnulacion_` (el efecto de anular un pago recalcula con los demás), `aplicarAnulacion_` (olvida los pagos leídos).
- `recibeAntesDePagar_` (§6.F: crédito **o** pago parcial) y `recibirSinPagar_` (textos y bitácora "Recibir antes de pagar todo
  (pago parcial)").
- `antiguedadCxp` (reescrita, ver §5) y `cuentasPorPagar` (le pasa los movimientos; la requisición de un saldo sin factura).
- `basePendientes_` (saldo de las órdenes Emitidas, con pagos o sin ellos —integración—; "pago parcial" solo con un pago
  Vigente; la clave del caché incluye `facturasProveedor`) e `itemsPendientes` (compras: "Pagada parcial, falta el saldo", saldo y lo
  que sigue; sin pagos, "por pagar X de Y" cuando lo devuelto sin reponer o las retenciones bajan lo que se debe; facturas por lo
  pendiente; filas "Saldo").
- Correos (6.B): `destinatariosAviso` y `contenidoAviso` (`req.pagoparcial`).
- `facturacionDeOrden` (solo el comentario). **No hay funciones nuevas en la API**: todo viaja por las de siempre
  (`autorizarRequisicion`, `cotizarRequisicion`, `registrarPagoProveedor`, `cancelarPagoProveedor`), que ya declaraban sus
  `cambios` (`pagosProveedores`, `requisiciones`, `oc`). `MODULOS_` no cambia; en `CAMBIOS_API` (revisión)
  `registrarFacturaProveedor` ahora también declara `requisiciones` y `oc` (una factura con retenciones puede dejar pagada la orden).

### Interfaz (`web/cotizador/index.html`, script principal)
- Pago a proveedor (`#rcFormPago`): caja `#ppSaldo` (`htmlSaldoPago`): esperado, pagado, saldo y lo que sigue (concepto, monto y
  vencimiento; rojo si ya venció), etapas del plan con lo cubierto y botones "Monto de <etapa>" / "Todo el saldo" (`montoPago`). El
  monto se precarga con lo que sigue. La nota explica el tope (y lo devuelto sin reponer o las facturas con retenciones). Tras un
  pago el formulario sigue abierto si queda saldo, con **otro `idSolicitud`** y sin comprobante ni referencia.
- Lista de pagos con columna **Tipo** y × para cancelar cada pago Vigente; `#rcSaldoResumen` ("Pagado $X de $Y · saldo $Z").
- La orden (`#rcOrden`): chip "Pagada parcial", pagado y saldo, plan; sin "¿Ya no va?" si tiene pagos.
- Plan de pagos en el formulario de la orden / propuesta (`#ocPlanCaja`): renglones concepto + % con su monto (vista previa sobre
  el total), "+ Agregar etapa", atajo "50% anticipo · 50% contra entrega", "Sin plan", suma (✓ o aviso) y revisión antes de mandar
  (`agregarEtapaPlan`, `planRapido`, `quitarPlanOc`, `leerPlanOc`, `pintarPlanOc`, `planOcValido`). En el teléfono los renglones
  caben en el ancho de la pantalla (`.plan-tabla`).
- Etiqueta `chipParcial`: Mis requisiciones, lista de compras (y filtro "Pagada parcial (con saldo)"), órdenes por proyecto (con
  pagado y saldo; sin × si tiene pagos) y aprobaciones (con el plan en la propuesta y en la orden: `textoPlan`).
- Cuentas por pagar: "Facturas y saldos por pagar", columna "Por pagar" (lo pendiente; "de $total · pagado $x"), filas **Saldo**
  ("<concepto> · sin factura"), "N facturas y M saldos sin factura", CSV con "Pagado" y "Por pagar", "Pagada parcial sin factura".
- Módulo de proveedores (`alVistaReqCom`): "Registrar que llegó" dice "Orden pagada en parte…" con un pago parcial.

## 4. Cancelar y recalcular: todas las combinaciones

`cancelarPagoProveedor` calcula la orden **sin ese pago y como si estuviera abierta** (`saldoOrdenCompra` con la orden Emitida).

| Antes (requisición · orden) | Después de cancelar | Resultado |
|---|---|---|
| Autorizada / En camino / Recibida · Emitida (parcial) | sigue parcial o sin pagos | nada cambia de estado; la etiqueta "Pagada parcial" se quita si ya no quedan pagos |
| Pagada · Pagada | ya no completa | Autorizada · Emitida (`cancelarPago`) |
| En camino · Pagada | ya no completa | En camino · Emitida (`cancelarPagoEnCamino`) |
| Recibida · Pagada (retenida por una devolución) | ya no completa | Recibida · Emitida (`cancelarPagoRecibida`, nueva): recibida, falta pagar; al pagar con la devolución abierta queda retenida otra vez y al resolverla se cierra |
| cualquiera · Pagada/Recibida | sigue completa (lo pagado sobra, p. ej. tras devolver material) | nada cambia |
| Cerrada | — | no se puede (regla de hoy) |

Otros caminos, comprobados con pruebas:
- **El único pago de una orden ya recibida** (con pago parcial "Recibí el material" ya la dejó Recibida): sigue Recibida con la
  orden Emitida y sin pagos; el pago completo la cierra.
- **Un pago de en medio**: la orden vuelve a Emitida y la requisición a Autorizada con el saldo de ese pago; se puede volver a
  completar (sin otro `oc.pagada`, porque nunca se quedó sin pagos Vigentes).
- **Después de una devolución** ("Devolver al proveedor" / "Cancelar renglón"): lo esperado es el total por pagar (neto de lo
  devuelto) antes y después de cancelar; el tope y el mensaje lo dicen.
- **La devolución deja lo pagado como completo** (decisión 5): la orden queda Pagada (o Recibida y la requisición Cerrada).
- **`cancelarRecepcion` / `accionCancelarRecepcion`** con un pago parcial: la orden está Emitida → la requisición vuelve a Autorizada
  (o En camino); la etiqueta sigue y quien pidió puede volver a confirmar.
- **Anular (módulo E)** un pago: igual que cancelar (recalcula con los demás; si lo siguen cubriendo, nada cambia; una Cerrada vuelve
  a Recibida, como hoy). Anular una orden o requisición con varios pagos los anula todos en cascada.
- **Cancelar la orden** con pagos Vigentes: no ("cancélalos primero").
- **Crédito del proveedor + pagos parciales:** se recibe antes de pagar (como siempre); el anticipo no manda `req.pagoparcial`.

## 5. Cuentas por pagar (`antiguedadCxp`)

`d = {facturas, ordenes, pagos, hoy, movimientos?}`. Salen las órdenes vigentes con facturas Vigentes o con pagos Vigentes (las que
no tienen ninguna de las dos solo salen en Reportes → CxP, su alcance). **Toda** orden se mide por su saldo (`saldoOrdenCompra`, con
o sin pagos; revisión: antes las órdenes sin pagos debían sus facturas completas aun con material devuelto): lo pagado cubre sus
facturas en orden de vencimiento; cada factura queda por lo que le falta (`pendiente`, `pagado`, `pagoParcial` si hay algo pagado) y
lo que no cubre ninguna factura son filas **`tipo: 'Saldo'`** (`folio` = la orden), **una por etapa del plan** (`serieFolio` = su
concepto, o "Saldo" sin plan; `tramosSinFactura`) con el vencimiento de su etapa (sin plan: recepción/entrega + días de crédito).
La suma por orden es exactamente la de Reportes → CxP y la del saldo de la vista. Una orden completa no debe nada. Totales por
moneda por lo pendiente (`facturas` y `saldos` cuentan renglones). `faltantes` gana `pagoParcial`. `repPendientes` igual (cualquier
pago Vigente). Revisión: **`aFavor`** = [{ocFolio, reqFolio, proyecto…, proveedor, moneda, aFavor, pagado, esperado}] (lo pagado de
más por orden) y `totalesAFavor` por moneda: aparte, nunca se restan de lo que se debe ni se compensan entre órdenes.

## 6. Decisiones (y por qué) — y desviaciones del contrato

1. **Facturas con retenciones** (desviación menor de §1): el contrato dice `saldo = esperado − pagado`. Desde el incremento 3 una
   orden facturada completa con retenciones se paga por el total de sus facturas (menor que el de la orden; decisión 7 de facturas).
   Para no romper esa regla, si `orden.facturas` viene y sus Vigentes ya cubren la orden con un total menor, el saldo se mide contra
   ese total (`porFacturas`). **Sin `orden.facturas` (como la llamaría R con la orden de `ordenDesdeFila_`) es exactamente la
   fórmula del contrato.**
2. **Una orden Pagada o Recibida con algún pago Vigente cuenta como completa** (saldo 0): el servidor ya lo decidió al registrar el
   pago que la completó (también por el total de sus facturas). Así R no ve saldo en órdenes pagadas con retenciones aunque no pase
   las facturas. Una **Cancelada o Anulada** no espera nada (`esperado: 0`, `completo: true`, `cancelada: true`).
3. **Vencimiento de `siguiente`** (el plan no tiene fechas: el spec pide concepto + %): la factura que sigue por pagar (FIFO por
   vencimiento) si hay facturas; si no, la **primera etapa de un plan de varias vence con la fecha de la orden** (anticipo) y lo
   demás **recepción (o entrega, o la orden) + días de crédito**. `siguiente.monto` es lo que falta de esa etapa (montos del plan
   sobre lo esperado; la última absorbe los centavos, como `montosDeEsquema`).
4. **El pago de una retenida sí se cancela** (antes el módulo H lo impedía porque no había transición): el contrato dice que solo una
   Cerrada lo impide. Queda Recibida con la orden Emitida (`cancelarPagoRecibida`). Se ajustó `tests/recepcion.test.js`.
5. **Devolución que liquida** (no estaba en el contrato): con pagos parciales, "Devolver al proveedor", "Cancelar renglón" o un
   faltante aceptado pueden dejar lo ya pagado ≥ lo esperado; sin hacer nada la requisición quedaba sin poder pagarse (el tope lo
   rechaza) ni cerrarse. `resolverDevolucion` la deja pagada (como el pago que la completa), con evento y bitácora "Orden pagada por
   devolución". Solo con algún pago Vigente.
6. **No se cancela una orden con pagos Vigentes** (antes una Emitida no tenía pagos): primero se cancelan sus pagos.
7. **`req.pagada` cada vez que la orden queda completa**: si se cancela el pago que la completó y se vuelve a completar, sale otra
   vez (es un hecho nuevo). `req.pagoparcial` solo con el primer pago Vigente.
8. **Sin `modPagosParciales_()`**: el contrato lo dejaba como opción ("o cambios en compras"). No hay funciones nuevas de API, así
   que no hay nada que declarar en `MODULOS_` ni en `CAMBIOS_API` (y no choca con `modReportes_()` de R).
9. **Historial:** el evento de un pago parcial se anota con la etiqueta "Pagada parcial" en la columna `estado` del historial (solo
   se muestra; el estado de la requisición no cambia). Quien pidió ve "Anticipo al proveedor; ya se puede recibir el material." —
   sin montos.
10. **La validación del monto cambió a propósito:** ya no "igual al total (o al total de sus facturas) ±1.00", sino "mayor a 0 y lo
    pagado no pasa de lo esperado + 1.00". Pruebas ajustadas: `requisiciones` (montos menores ya son parciales; mensaje nuevo),
    `compras` (pagar menos que el total ya no falla; se prueba el tope y que facturas a medias no completan), `revision5` (mensaje
    del tope con devoluciones), `facturas` (`saldos: 0` en los totales), `centro` y `proveedores` (`plan_pago` es ahora la última
    columna de `OrdenesCompra`).
11. **Tipo del pago**: "ya se recibió algo" = la orden tiene fecha de recepción o alguna entrada por compra Vigente ("Lo recogí" no
    cuenta: no es recepción).
12. **Aprobaciones** ve el plan y la etiqueta "Pagada parcial" de la orden (un sí/no, sin pagos ni montos pagados), porque el plan es
    parte de lo que aprueba.
13. ~~Cuentas por pagar de órdenes sin pagos no cambian~~ **Quitada en la revisión** (§11, 5): daba dos cifras distintas para la misma
    orden (Compras → Cuentas por pagar contra Reportes → CxP y la vista). Ahora toda orden se mide por su saldo.
14. **Plan de una sola etapa** se acepta (p. ej. "Contra entrega 100%": dice cuándo se paga); su vencimiento no es el de anticipo.

## 7. Pruebas

- **`tests/pagos.test.js` (nueva, 646 líneas, ~210 comprobaciones `assert`/`ok`/`falla`):** 0) lógica pura (plan de pagos, `saldoOrdenCompra` en todos sus casos,
  `antiguedadCxp` con facturas FIFO y saldos sin factura, Pendientes, correo sin montos); 1) flujo de siempre con plan (plan no válido
  sin gastar folio, plan en hoja/PDF/bitácora, anticipo, etiqueta para compras y para quien pidió, filtro, Pendientes de los dos,
  permisos de compras, `sincronizar` con sus `cambios`, segundo pago, idempotencia, tope, comprobante, tarjeta, tipo de cambio, fecha,
  recibir antes de pagar todo, liquidación en USD que cierra, cancelar una Cerrada); 2) cancelar el único pago de una recibida, uno de
  en medio, el único de una no recibida (otro `oc.pagada`), después de una devolución, devolución que liquida, retenida, recepción por
  renglón y `cancelarRecepcion` con aprobaciones (plan en la propuesta), cancelar orden con pagos, Anular (pago de en medio, pago
  parcial, orden con varios pagos, pago que los demás siguen cubriendo), crédito + parciales, "Registrar que llegó" de compras,
  documentos para transferencia en cada pago y excepción de super admin; 3) cuentas por pagar y órdenes por proyecto en el servidor;
  5) interfaz con DOM simulado conectada al servidor simulado (plan 30/70 con suma revisada, caja de saldo, dos pagos seguidos desde
  el mismo formulario, cancelar, lista, órdenes por proyecto, cuentas por pagar y CSV, aprobaciones y Mis requisiciones sin montos).
- Ajustes intencionales en 7 pruebas existentes (decisión 10 y 4).
- **`tests/pagos-revision.test.js`** (revisión independiente, §11): una sección por hallazgo, cada una falla sin su arreglo; la de
  interfaz usa `tests/montar-interfaz.js` (el montaje de la interfaz como módulo, con lo que preguntan `confirm`/`prompt`).
- `tests/arnes.js`: el caché simulado, como el de Apps Script, rechaza valores de más de 100 KB y claves de más de 250 caracteres.
- `bash tests/todas.sh` (rama `incremento-6-fixp`, con R y la rapidez integrados): **25 pruebas ✔ + sintaxis de la interfaz**.

## 8. Publicación

- **Sin servicios nuevos de Google** (Sheets, Drive, MailApp y UrlFetch ya están autorizados): `clasp push`, versión nueva publicada
  por **facilities@** desde el editor y `CLOUDFLARE_ACCOUNT_ID=… npx --yes wrangler@4 deploy` (cambió la interfaz). Ver `CLAUDE.md` §9.
- Respaldar antes el libro de compras (columnas nuevas al primer uso: `PagosProveedores.tipo`, `id_solicitud` y `huella_solicitud`,
  y `OrdenesCompra.plan_pago`; nada se mueve). Opcional: `prepararCompras()` para escribir los encabezados de una vez.
- **API e interfaz juntas, y que compras recargue la página:** una interfaz vieja en caché con la API nueva dejaría el formulario
  del pago abierto con el mismo `idSolicitud` después de un pago parcial (un segundo pago regresaría el primero); una interfaz nueva
  con la API vieja no manda el plan (se ignoraría) y vuelve a los textos de un solo pago.
- Cachés: listas, Pendientes y cuentas por pagar se guardan por versión; se corrigen solas con el primer pago (o en 6 h).
- **Avisar a compras:** ya se puede pagar en partes (anticipo, parciales y liquidación); con un pago parcial quien pidió ya puede
  confirmar que llegó; una orden con pagos no se cancela; el pago de una retenida ya se puede cancelar.
- Manual del Cotizador (regla 14): Compras (pagos parciales, plan, cuentas por pagar), Requisiciones ("Pagada parcial"), Historial.

## 9. Para R (reportes) e integración

- `saldoOrdenCompra(orden, pagos, movimientos)` tiene la firma del contrato. `orden` = `ordenDesdeFila_` (usa `total`, `estado`,
  `renglones`, `ivaTasa`, `moneda`, `fecha`, `fechaEntrega`, `fechaRecepcion`, `diasCredito`, `planPago`); `pagos` =
  `pagoProvDesdeFila_` de la orden (cualquier estado; solo cuentan los Vigentes); `movimientos` = `movimientosPorOc_(libro)[FOLIO]`.
  Para cifras idénticas a las de P en órdenes facturadas con retenciones, pasar `orden.facturas` (sus filas de `facturasDelLibro_`) o
  usar `saldoDeOrden_(libro, orden, movs, facturas, pagos)`. Lecturas baratas para todas las órdenes: `pagosProvPorOc_(libro)`,
  `movimientosPorOc_(libro)`, `facturasDelLibro_(libro)` (una vez cada una).
- Saltar órdenes con `cancelada: true` o `completo: true`. Para el flujo de 13 semanas: `siguiente.monto` vence en `siguiente.vence`;
  el resto del saldo (`saldo − siguiente.monto`) son las etapas siguientes; desde la revisión cada una trae su `vence`
  (`etapas[].vence`) y `tramosSinFactura(saldo, restoCts)` reparte un resto por etapa (R puede usarlos para partir su "Resto del plan").
- `aFavor` (revisión): lo pagado de más de esa orden (solo arriba de la tolerancia). No es saldo por pagar; si R lo muestra, aparte y
  sin compensarlo con otra orden.
- `antiguedadCxp` ahora recibe `movimientos` y cada renglón trae `pendiente` (lo que se debe), `pagado` y `pagoParcial`; los saldos
  sin factura son `tipo: 'Saldo'` (`folio` = la orden). Los totales suman lo pendiente y traen `saldos`. Para "la de P, misma
  presentación": usar `cuentasPorPagar()` (solo compras) o `antiguedadCxp` con `pendiente`.
- Posibles choques al integrar: `web/cotizador/index.html` (sección de cuentas por pagar de Compras y `pintarCxp`/`csvCxp`; P no
  agrega `<script>` nuevo) y `antiguedadCxp` en `Code.js` si R la toca. P no toca `MODULOS_`, `CAMBIOS_API`, `COLECCIONES` ni
  `Esquemas`.

## 10. Pendiente / ideas

- **Registrar la nota de crédito o el reembolso** de un saldo a favor: hoy no hay cómo, así que el pendiente "Saldo a favor con el
  proveedor" se queda mientras exista (idea: un movimiento de reembolso en `PagosProveedores` que reste a lo pagado).
- ~~Pendientes de compras de una orden sin pagos con material devuelto muestra el total de la orden~~ **Resuelto en la integración**:
  dice "por pagar X de Y" con el saldo de la orden, lo mismo que la vista del pago (`tests/pagos-revision.test.js` §11).

- Probar en PRUEBAS o en el real con Claude in Chrome (regla 13): anticipo, recibir antes de pagar todo, liquidación, cancelar uno
  de en medio, plan en el PDF, cuentas por pagar; y en el teléfono el formulario del pago y el plan.
- Fechas por etapa del plan (hoy se deducen; decisión 3) si compras las pide.
- Complementos de pago (REP) por cada pago parcial de una factura PPD: hoy `repPendientes` sigue marcando la factura mientras la
  orden tenga algún pago.
- Pasar a `CLAUDE.md` y al Manual al integrar.

## 11. Revisión independiente (29/10/2026, rama `incremento-6-fixp`)

Hallazgos de la revisión y su arreglo (un commit y una prueba de regresión por cada uno, en `tests/pagos-revision.test.js`; los
fuzzers de la revisión ya no encuentran nada).

1. **(Alta) Factura con retenciones después de pagos parciales:** la orden quedaba Emitida "completa" y la requisición atorada (sin
   saldo que pagar ni forma de cerrar). `completarSiCubierta_` (antes `completarPagoTrasDevolucion_`) la deja pagada también desde
   `registrarFacturaProveedor`; un pago a una orden que ya estaba cubierta la cierra en lugar de fallar (`sinPago`, sin registrar
   otro pago); "Pagada parcial" es una sola regla (`esPagoParcial_`) para compras y para quien pidió.
2. **(Alta) Idempotencia:** el caché guardaba la vista con todos los proveedores; con ~165 pasaba de 100 KB, `cache.put` lanzaba
   después de escribir y el reintento duplicaba el pago. Ahora el envío se busca también en la hoja (`id_solicitud` + huella), el
   caché guarda poco y nunca lanza, y el mismo id con otros datos se rechaza con un mensaje claro. Lo mismo al autorizar una
   requisición (el reintento emitía otra orden) y los demás cachés de idempotencia usan `guardarIdempotencia_`.
3. **(Media) Tope con facturas con retenciones:** se medía contra el total de la orden; ahora contra el saldo que se muestra
   (`porFacturas` o lo esperado).
4. **(Media) Pagos en otra moneda (interfaz):** al precargar un monto la moneda del pago vuelve a la de la orden; "= $X aplicados" en
   vivo; un pago en otra moneda que no completa la orden pide confirmación.
5. **(Media) Dos cifras de cuentas por pagar:** se quitó la decisión 13 (§6): toda orden por su saldo, igual que Reportes → CxP.
6. **(Media) Lo pagado de más no quedaba en ningún lado:** `aFavor` en `saldoOrdenCompra`, en la requisición, órdenes por proyecto,
   cuentas por pagar (aparte) y como pendiente de compras.
7. **(Baja) La fila «Saldo» fechaba todo con la etapa que sigue:** una fila por etapa del plan (`tramosSinFactura`,
   `etapas[].vence`). No se comparte con `tramosPorPagar` de R: R pone el plan por encima de las facturas (siguiente + resto) y en
   Cuentas por pagar las facturas ya tienen su fila; R puede usar `etapas[].vence`/`tramosSinFactura`.
8. **(Baja) El tipo no se recalculaba:** al cancelar o anular un pago, un "Liquidación" que ya no liquida pasa a Anticipo o Parcial
   (`retiparPagosProv`, según si ya se había recibido algo cuando se registró). Se guarda en la hoja en ese momento (el tipo lo leen
   la vista, la hoja, la bitácora y R; no se deduce al leer).
9. **(Baja) `normalizarPlanPago` aceptaba no números** (`true` = 1 %, `[50]` = 50 %): solo un número o un texto con un número.
10. **(De antes) El correo "Anulado" de un pago a proveedor** le llegaba a quien pidió con el folio PGP en el asunto: ya solo a quien
    lo registró.

Publicación: además de lo de §8, las columnas `id_solicitud` y `huella_solicitud` de `PagosProveedores` se crean solas; sin
servicios nuevos de Google. Pruebas intencionalmente ajustadas: `requisiciones` (el mismo id con otros datos se rechaza), `compras`
(tope contra las facturas), `facturas` (las órdenes de la prueba pura llevan total y OC-2 debe también lo que falta facturar).
