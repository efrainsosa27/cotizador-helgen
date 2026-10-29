# Incremento 5 (CAPRI) · Módulo F: proveedores y forma de pago

Rama `incremento-5-f` (sobre `incremento-5-base` = `4a433c3`). Contrato: `docs/incremento-5.md` §1 y §2. Este archivo es para
integrar: al hacer el merge se pasa lo necesario a `CLAUDE.md` (§4.5.3, §4.5.4, §4.6, §4.7, §4.8, §5, §6.12, §6.13, §7, §9) y al
Manual (Compras, Tareas frecuentes, Reglas de oro, Historial, Pendientes).

## 1. Qué hace

1. **Forma de pago por orden de compra** (`FORMAS_PAGO_OC`: Transferencia · Crédito del proveedor · Tarjeta de crédito · Tarjeta de
   débito (en sitio) · Efectivo · Cheque). Obligatoria en la orden (flujo de siempre) y en la propuesta (con aprobaciones);
   "Crédito del proveedor" exige días de crédito ≥ 1; las demás aceptan cualquier número de días (0 = contado). Va en el PDF de la
   orden ("Forma de pago", junto a las condiciones), en la vista de la requisición de compras, en la de aprobaciones (propuesta y
   orden) y en el detalle de Pendientes de compras. **Nunca a quien pide** (ni en `misRequisiciones` ni en sus Pendientes).
   Órdenes y propuestas de antes (sin forma de pago): `Transferencia` si `dias_credito` = 0 y `Crédito del proveedor` si > 0.
2. **Crédito del proveedor = se recibe antes de pagar**, también en el flujo de siempre: quien pidió ve "Recibí el material" con la
   orden Emitida (Autorizada o En camino) y la requisición pasa a **Recibida** (la orden sigue Emitida con su fecha de recepción y
   quién la recibió); el pago la cierra (Recibida → Cerrada, la orden Recibida: `pagarRecibida`, ya existía). Compras puede
   registrarlo en su lugar con motivo ("Registrar que llegó (queda Recibida)"). Una orden recibida sin pagar ya no se cancela.
   Pendientes sigue la misma regla. Con aprobaciones nada cambia (ya se recibía renglón por renglón antes o después del pago).
3. **Métodos del pago a proveedor** (`METODOS_PAGO`): Transferencia · Tarjeta de crédito · Tarjeta de débito · Efectivo · Cheque.
   Con tarjeta la referencia es el número de autorización o del ticket. **Nunca se guarda un número de tarjeta**: una referencia
   que lo parece se rechaza (ver decisiones). Los cobros a clientes (cobranza) siguen con Transferencia · Efectivo · Cheque.
4. **Base de proveedores** (Compras → "Proveedores →"): lista con búsqueda (razón social, RFC, contacto, banco o terminación de la
   CLABE), filtro (activos · les falta un documento · con avisos · inactivos · todos) y chips de documentos; ficha con datos,
   dirección, banco, CLABE (18 dígitos con dígito verificador; la interfaz la revisa al escribir y sugiere el banco), cuenta (o IBAN
   de un proveedor extranjero), titular, forma de pago y días de crédito habituales, notas, activo y los 3 documentos (constancia de
   situación fiscal, carátula bancaria, comprobante de domicilio) con su fecha y liga para abrirlos. Solo compras y super admin.
5. **Avisos** (no bloquean): falta algún documento; comprobante de domicilio con más de 3 meses; CSF con más de 12 meses. Al emitir
   una orden o mandar una propuesta la respuesta trae `avisoProveedor` y la interfaz lo muestra; al elegir el proveedor en el
   formulario también se avisa.
6. **Bloqueo del pago** (solo **transferencia**, decisión de integración; avisos corregidos en la revisión del 29/10/2026):
   `documentosParaPagar(rfc, metodo)` dice qué exige cada método (transferencia: carátula y, si el RFC es nacional, CSF; los demás,
   nada). `registrarPagoProveedor` responde `PERMISO` "Falta … de <proveedor>: no se registra un pago por transferencia hasta
   subirla(s)…" + `textoExcepcion_()`. Un super admin lo registra escribiendo el motivo (≥ 10, `excepcionSuperAdmin_` → Bitacora de
   Administración). La interfaz usa `accionConExcepcion` en "Registrar pago". Los avisos salen del mismo dato:
   `avisosProveedor(p).faltanPorMetodo` ({método: documentos que exige y no tiene}; también en `proveedorPago` y en los proveedores
   del formulario de la orden): el texto de bloqueo solo con Transferencia, con los demás métodos un aviso suave ("sí se registra el
   pago"), y a un proveedor extranjero nunca se le pide la CSF (antes la interfaz decía "no se registra el pago" con cualquier
   método y pedía la CSF también al extranjero).
7. **Pago con transferencia**: la vista del pago muestra banco, CLABE (con "Copiar CLABE"), titular y la liga a la carátula.
8. **Cambio de banco/CLABE/cuenta**: exige subir la carátula nueva en el mismo guardado; queda en la Bitácora de compras (solo
   terminaciones) y manda el correo `proveedor.banco` a compras (sin quien lo hizo): banco y últimos 4 dígitos (antes y después),
   quién y cuándo, y un botón a `…/cotizador/#proveedores`. La primera captura de datos bancarios también exige carátula pero no
   manda correo (no es un cambio).

## 2. Funciones

### Code.js §6.F (al final del archivo)
| Función | Qué hace |
|---|---|
| `modProveedores_()` | `api`: `listarProveedores`, `getProveedor`, `guardarProveedor`, `subirDocumentoProveedor`; `cambios`: las dos que escriben → `['oc']` (ver decisiones); `sincronizar`: con `ctx.comProveedores` y `algo('oc')` manda `r.comProveedores` (`listarProveedores(ctx.provFiltro)`), solo a compras |
| `recibeAntesDePagar_(orden)` | **La regla única**: ¿la forma de pago de la orden es Crédito del proveedor? (`formaPagoDeOrden(orden.formaPago, orden.diasCredito)`). La usan `recibirSinPagarPosible_` (→ `reqParaSolicitante_`, `vistaRequisicion_`, `cerrarReq_`) e `itemsPendientes` |
| `recibirSinPagarPosible_(req, orden)` | Orden Emitida sin recepción + requisición Autorizada o En camino + `recibeAntesDePagar_` |
| `recibirSinPagar_(libro, hoja, req, nota, motivo)` | Lo llama `cerrarReq_` al inicio: si aplica (y no hay flujo de aprobaciones), `recibir` → Recibida, fecha y correo en la orden (sigue Emitida), evento, `req.recibida` a compras ("Falta registrar el pago"), Bitácora; devuelve true. Si no aplica, false y `cerrarReq_` sigue igual |
| `proveedorPorId_`, `proveedorDeOrden_` | Proveedor por id; el de una orden por id, RFC o razón social |
| `proveedorParaOrden_(p)` | Para el formulario de la orden (`vistaRequisicion_.proveedores`): **sin datos bancarios**, con `formaPagoHabitual`, `faltan`, `avisos`, `activo` |
| `proveedorDePago_(libro, orden)` | Para el pago (`vistaRequisicion_.proveedorPago`): banco, CLABE, cuenta, titular, ligas, `faltanPago`, `avisos` |
| `avisoDeProveedor_(libro, id, razonSocial)` | Texto de `avisoProveedor` ('' si todo está bien; un proveedor nuevo no tiene documentos) |
| `exigirDocumentosParaPagar_(libro, orden, motivo)` | Bloqueo del pago o excepción de super admin (dentro del candado, después de validar el pago y antes de escribir) |
| `listarProveedores(filtro)` *(API)* | Solo compras/super admin. `filtro` = texto o `{texto, estado}`. `{proveedores (resumenProveedor, máx. 300), total, hoy, formasPago, documentos}`; sin la CLABE completa (`clabe4`, `cuenta4`) |
| `getProveedor(id)` *(API)* | Ficha completa (`fichaParaVista`), con CLABE, cuenta y ligas |
| `guardarProveedor(p)` *(API)* | Alta o edición (ver §1); idempotencia `PRV_<idSolicitud>`; devuelve `{proveedor, nuevo}` |
| `subirDocumentoProveedor(id, tipo, archivo)` *(API)* | `tipo` = `csf` · `caratula` · `domicilio`; `archivo` = `{nombre, datos, fecha}`. Devuelve `{proveedor}`. (La interfaz sube todo con `guardarProveedor`; esta queda para renovar un documento suelto.) |
| `documentosDelEnvio_`, `subirDocumentos_`, `carpetaProveedor_`, `nombreLibreEnCarpeta_`, `filaFichaProveedor_` | Validan (PDF/imagen ≤ 10 MB por contenido, fecha no futura), suben a Drive con `privado_` y escriben I:Z |
| Puras | `formaPagoDeOrden`, `normalizarFormaPago`, `formaPagoHabitualDe`, `pasaLuhn`, `pareceNumeroTarjeta`, `validarClabe`, `ultimos4`, `listaConY`, `sumarMeses`, `fechaDocDeCelda`, `fichaDeFila`, `normalizarFichaProveedor`, `cambioDeBanco`, `textoCambioBanco`, `camposCambiados`, `avisosProveedor`, `textoAvisoProveedor`, `resumenProveedor`, `fichaParaVista`, `filtrarProveedores`, `nombreCarpetaProveedor`, `nombreDocProveedor`, `datosAvisoBanco`, `contenidoAvisoBanco` |

### Cambios fuera de §6.F (todos marcados con "F (incremento 5)" en un comentario)
- `MODULOS_` (+ `modProveedores_()`); `HOJAS_COMPRAS.OrdenesCompra` (+ `forma_pago` al final) y `.Proveedores` (+ 18 columnas).
- `ordenDesdeFila_` (+ `formaPago`), `emitirOrdenCompra_` (escribe `forma_pago` por nombre; devuelve `avisoProveedor`),
  `normalizarOrdenCompra` (+ `formaPago` obligatoria), `ordenDePropuesta` (regla de lectura), `cotizarRequisicion` (guarda
  `formaPago` en la propuesta; devuelve `avisoProveedor`), `autorizarRequisicion` (devuelve `avisoProveedor`),
  `vistaOperaciones_` (`propuesta.formaPago`, `orden.formaPago`), `construirHtmlOrdenCompra` (fila "Forma de pago").
- `reqParaSolicitante_` (`puedeCerrar` con crédito), `cerrarReq_` (una línea al inicio: `recibirSinPagar_`), `vistaRequisicion_`
  (`puedeCerrar`/`recibeAntesDePagar` con crédito, `proveedores` sin banco, `proveedorPago`, `formasPago`),
  `cancelarOrdenCompra` (una orden recibida sin pagar no se cancela), `basePendientes_` (`oc.formaPago`, `diasCredito`,
  `recibida`), `itemsPendientes` (regla de crédito para quien recibe; forma de pago en el detalle de compras).
- `METODOS_PAGO` (5) + `METODOS_COBRO` (los 3 de siempre, cobranza), `normalizarPago` (`proyecto.metodos`, referencia con tarjeta,
  `pareceNumeroTarjeta`), `normalizarPagoProveedor` (pasa `METODOS_PAGO`), `vistaCobranza_` (`metodos: METODOS_COBRO`),
  `registrarPagoProveedor(p, motivoExcepcion)` (bloqueo).
- `proveedoresDesdeFilas` (+ `fichaDeFila`). `guardarProveedor_` (alta automática al emitir) **no cambió**: escribe A:H y no toca
  la ficha.
- Correos (6.B): `EVENTOS_CORREO.push('proveedor.banco')` (en §6.F, no en la lista), una línea en `destinatariosAviso`, una en
  `contenidoAviso` (→ `contenidoAvisoBanco`) y una en `infoDeAviso_` (→ `datosAvisoBanco`).

### Interfaz (`web/cotizador/index.html`)
- `<script id="mod-proveedores">` (al final): `verProveedores()` y `window.PROVEEDORES_F` (`cargar`, `abrir`, `nuevo`, `cerrar`,
  `guardar`, `copiar`, `clabeValida` — copia de `validarClabe`). Se engancha con `registrarModulo({alBootstrap (liga #proveedores),
  alPermisos, alVistaReqCom (forma de pago en la orden, banco/CLABE en el pago, métodos del servidor, textos del cierre con crédito,
  aviso del proveedor), contexto ({comProveedores, provFiltro} con la subvista abierta), alSincronizar})` y envuelve `verListaCom` /
  `verCxp` para esconder la subvista.
- HTML: subvista `#comVistaProv` (lista `#provLista`, ficha `#provFicha`), botón "Proveedores →" en el módulo 3 de Compras (ahora
  "3 · Cuentas por pagar y proveedores"), `#ocFormaPago` en el formulario de la orden/propuesta, `#prvAviso`, `#ppProveedor` en el
  pago, `#ppMetodo` con los 5 métodos (el servidor manda la lista: `vistaRequisicion_.metodos`).
- Script principal (cambios chicos): `extraProveedor(r)`, `precargarOc` / `autorrellenarProveedor` / `guardarOc` /
  `enviarPropuesta` (forma de pago), `registrarPagoProv` (→ `accionConExcepcion`), `recibiMaterial` y `cerrarReqCom` (mensaje
  "Recibida" con crédito), tile "¿Ya no va?" (no con la orden recibida), `pintarPropuestaOps` / `pintarOps` (forma de pago).

## 3. Hojas y Drive

- `OrdenesCompra`: columna **AP `forma_pago`** (después de `en_camino_por`; se busca por nombre con `colOc_`). Vacía en órdenes de antes.
- `Proveedores`: A:H como siempre (`dias_credito` sigue en H y ahora también es el de "días de crédito habituales" de la ficha);
  **I:Z** `direccion`, `banco`, `clabe`, `cuenta`, `titular`, `forma_pago_habitual`, `csf_id`, `csf_url`, `csf_fecha`,
  `caratula_id`, `caratula_url`, `caratula_fecha`, `domicilio_id`, `domicilio_url`, `domicilio_fecha`, `notas`, `activo` (Sí/No;
  vacía = Sí), `actualizo`. La CLABE y la cuenta se escriben con apóstrofo (las columnas nuevas no tienen formato de texto: Sheets
  las convertiría en número y perdería dígitos); las fechas con `textoFecha_`.
- Encabezados: `hojaDeArea_` los reescribe solo la primera vez que se lee cada pestaña (o con `prepararCompras()`); no hay que
  editar la hoja a mano.
- Drive: `Compras/Proveedores/<RFC o SIN-RFC> — <razón social>/` con `<RFC> — CSF.pdf`, `… — Carátula bancaria.pdf`,
  `… — Comprobante de domicilio.jpg` (la extensión real; " (2)", " (3)"… al reemplazar: el anterior se queda). Todo con `privado_`
  de arriba abajo. Para abrir los documentos desde la liga hay que tener acceso a la carpeta de compras (como los PDF de las órdenes).
- Bitácora de compras: "Alta de proveedor", "Editar proveedor" (campos que cambiaron), "Cambiar datos bancarios de proveedor"
  (terminaciones), "Subir documento de proveedor", "Recibir antes de pagar (crédito del proveedor)". Bitacora de Administración:
  "Excepción de super admin: pagar a un proveedor sin documentos (falta …)". Correos: tipo `proveedor.banco`, folio = id del proveedor.

## 4. Decisiones (y por qué)

1. **`dias_credito_habituales` no es una columna nueva**: `Proveedores` ya tenía `dias_credito` (H) con exactamente ese uso
   (precarga la orden siguiente y lo actualiza la última orden emitida). Una segunda columna serían dos fuentes para el mismo dato.
   **Desviación del contrato** (columna 7 de su lista); la ficha lo expone como `diasCredito`.
2. **Número de tarjeta** (regla corregida en la revisión del 29/10/2026; `tests/revision5.test.js` §3): **una sola regla para todo
   método**. Candidatos: cada corrida de dígitos sin cortes y cada tramo de grupos separados por espacios, puntos, guiones,
   diagonales o guiones bajos (uno o varios: "4111.1111.1111.1111", "4111  1111…", "4111/1111…", "5555_5555…"; revisión 5b) con
   forma exacta de tarjeta: 4-4-4-(1…4), 4-4-4-4-(1…3), American Express 4-6-5 o Diners 4-6-4; nunca se juntan grupos de otra forma
   (en "SPEI 29-10-2026 1234567" y "30/10/2026" la fecha y el folio quedan separados). Se rechaza si un candidato tiene de 13 a 19 dígitos, **empieza con 3, 4, 5 o 6** y pasa la
   prueba de Luhn. Una CLABE válida de 18 dígitos nunca es tarjeta (las de STP empiezan con 646) y una corrida de 20 dígitos o más
   (clave de rastreo, ticket de tienda) se permite. El mensaje pide el número de autorización o los últimos 4 dígitos. Antes: con
   tarjeta bastaba el largo (≥ 13, sin tope: se rechazaban los tickets de 20 dígitos que la interfaz pide) y con los demás métodos
   bastaba Luhn: la nota decía "≈ 1 de cada 10 lo haría sin Luhn", pero era al revés: **con** Luhn todavía se rechazaba ≈ 1 de cada
   10 claves numéricas de 13 a 19 dígitos (sin Luhn, todas), y además se juntaban fecha y folio. Ahora el prefijo deja ≈ 4 de cada
   100 de esas claves (las que empiezan con 3–6 y pasan Luhn; ninguna CLABE). La regla aplica también a los cobros de clientes
   (`normalizarPago` es la misma) y a la "cuenta" de la ficha (un número de tarjeta de débito no se guarda: se usa la CLABE).
3. **Cobranza no cambia de métodos**: `METODOS_PAGO` (el nombre del contrato) es el del pago a proveedor; cobranza usa
   `METODOS_COBRO` (los 3 de siempre). Si Leo quiere tarjetas también en cobros de clientes, es cambiar `vistaCobranza_` y el
   default de `normalizarPago`.
4. **El correo `proveedor.banco` no lleva el nombre del proveedor** (regla 17: un aviso nunca lleva proveedores; se reenvía fácil):
   lleva banco y terminaciones; para encontrarlo, la lista busca por la terminación de la CLABE y el botón abre `#proveedores`. Va
   solo a compras (`correosConRol_('compras')`, sin quien hizo el cambio); el super admin no lo recibe por serlo. Si el único de
   compras hace el cambio, nadie recibe el correo (queda "Sin destinatarios" en Correos, y en la Bitácora).
5. **Cambiar datos bancarios exige carátula aunque antes no hubiera** (primera captura): se le paga a la CLABE de la carátula.
   Quitarlos (dejar banco, CLABE y cuenta vacíos) no pide carátula. El banco se compara sin mayúsculas ni acentos.
6. **La edición reemplaza la ficha** (un campo vacío se borra), a diferencia de la alta automática al emitir (`guardarProveedor_`,
   donde un dato vacío no borra). El id se conserva; si un proveedor sin RFC recibe uno, su id pasa a ser el RFC (como
   `guardarProveedor_`); un RFC o una razón social sin RFC repetidos se rechazan ("ábrelo y edítalo").
7. **Colección**: guardar un proveedor sube `oc` (los proveedores viven en el libro de compras y la vista de una requisición abierta
   lleva sus documentos y CLABE); no se agregó una colección nueva a `COLECCIONES`.
8. **Bloqueo del pago solo con transferencia** (decisión de integración del 29/10/2026; corregido aquí en la revisión 5b: antes
   decía "para todo método"). Se le paga a la CLABE de la carátula: con **Transferencia** se exige la carátula y, si el RFC es
   nacional, la CSF (`documentosParaPagar`); con tarjeta (compra en tienda), efectivo o cheque solo queda el aviso. Un proveedor
   extranjero (sin RFC o `XEXX010101000`: JLCPCB, Ardusimple…) solo necesita la carátula para una transferencia; sin ella, la
   excepción de super admin.
9. **Crédito en el flujo de siempre**: la confirmación la hace quien pidió (`cerrarRequisicion`, como hoy: no hay "quien recibe" sin
   aprobaciones) o compras en su lugar con motivo (`cerrarRequisicionCompras`). Con el flujo de aprobaciones `recibirSinPagar_` no
   aplica (allá se recibe renglón por renglón). Una orden de antes con días de crédito > 0 se trata como crédito desde que se publique.
10. **Propuesta**: `formaPago` va dentro del JSON de la propuesta (`propuesta (JSON)`), no en otra columna; `vistaOperaciones_` y
    `ordenDePropuesta` aplican la regla de lectura a las propuestas de antes (una propuesta Cotizada al publicar no se rompe).
11. **`avisoProveedor` de un proveedor nuevo** (propuesta: el proveedor se agrega al emitir la orden) dice que le falta todo.
12. **Pago neto de lo devuelto sin reponer** (revisión del 29/10/2026; `tests/revision5.test.js` §4). Con crédito del proveedor se
    recibe, se reporta y se devuelve antes de pagar; antes el pago exigía el total completo de la orden y la requisición se quedaba
    "Recibida, falta pagar" para siempre (o se registraba un pago que no ocurrió). Ahora `registrarPagoProveedor` espera
    `totalPorPagarOrden(orden, devueltoSinReponer(movimientos))`: el total recalculado **igual que `normalizarOrdenCompra`** (importe
    por renglón = redondear(cantidad × costo), subtotal redondeado, IVA = redondear(subtotal × tasa de la orden), total redondeado)
    con la cantidad de cada renglón menos lo devuelto sin reponer (movimientos `Devolución sin reponer` de "Devolver al proveedor" o
    "Cancelar renglón" y `Faltante aceptado`, el faltante del centro de mando resuelto igual), ±1.00 como siempre. Solo en órdenes
    con esos movimientos; si el total guardado no se reproduce con sus renglones (orden editada a mano) no se descuenta nada. La
    vista trae `porPagar` ({total, subtotal, iva, descontado, totalOrden, renglones}) y el formulario del pago lo precarga y lo
    explica; la Bitácora del pago anota el total por pagar. Facturas: una factura completa por la orden entera ya no cuadra con el
    total por pagar (se paga lo neto; la nota de crédito del proveedor cubre la diferencia).

## 5. Pruebas

- `tests/proveedores.test.js` (nuevo): lógica pura (formas de pago, regla de lectura, `recibeAntesDePagar_`, PDF, métodos y
  tarjetas, CLABE, ficha, avisos, Pendientes con crédito, correo), flujos por `doPost` (orden con forma de pago y PDF, permisos, pago
  bloqueado y excepción con bitácora, ficha con documentos privados y "(2)/(3)", cambio de banco con correo y bitácora, alta manual
  y RFC, alta automática que no borra la ficha, CLABE en la vista del pago, crédito: recibir antes de pagar, Pendientes, cancelar
  bloqueado, pago que cierra, cierre por compras, `sincronizar`, propuesta con aprobaciones y propuesta de antes) y el módulo de la
  interfaz con un DOM simulado.
- Pruebas existentes (cambio intencional): `formaPago: 'Transferencia'` en las órdenes y propuestas que emiten (anular, centro,
  compras, correos, identidad, operaciones, pantallas, requisiciones, revision; `cotizacion` con crédito); en las que pagan
  (anular, centro, compras, correos, operaciones, pantallas, requisiciones) `P.exigirDocumentosParaPagar_ = function () {}` (no
  son pruebas de documentos); `centro.test.js`: `forma_pago` es la última columna de `OrdenesCompra`. `tests/arnes.js`:
  `getFilesByName` en las carpetas simuladas.
- `bash tests/todas.sh`: 19 ✔. Además se corrió (fuera del repo) una prueba de humo con jsdom + el servidor simulado: subvista,
  alta, CLABE, orden con crédito y aviso, pago bloqueado, ficha desde el pago con documentos y pago registrado, sin errores de consola.

## 6. Publicar

- Sin servicios de Google nuevos (Drive, Sheets, UrlFetch y MailApp ya están autorizados): `clasp push` + `clasp deploy` + `wrangler deploy`.
- Respaldar antes el libro de compras (las pestañas `OrdenesCompra` y `Proveedores` ganan columnas al primer uso; nada se mueve).
- Opcional: correr `prepararCompras()` desde el editor para escribir los encabezados nuevos de una vez.
- **Avisar a compras el día que se publique**: desde ese momento **ningún pago por transferencia se registra sin la carátula y,
  si el proveedor es nacional, la CSF** (los proveedores de hoy no tienen documentos; con tarjeta, efectivo o cheque solo se avisa):
  suban primero los de los proveedores con órdenes por pagar (Compras → Proveedores), o el super admin registra el pago con motivo. Y las órdenes Emitidas con días de crédito > 0 ya se pueden recibir antes de pagar.
- Interfaz y API van juntas: la interfaz nueva manda `formaPago` (la API vieja la ignora) pero la API nueva la exige (una interfaz en
  caché sin el campo verá "Elige la forma de pago": recargar).
- Cachés: "mis requisiciones" y la base de Pendientes se guardan por versión; hasta el primer cambio en compras después de publicar
  (o 6 h) pueden no mostrar "Recibí el material" en órdenes de antes con días de crédito. No hace falta nada: se corrige solo.

## 7. Integración con H (recepción con fotos y devoluciones)

- **`cerrarRequisicion` / `cerrarReq_`**: F agregó **una línea al inicio de `cerrarReq_`** (`if (recibirSinPagar_(…)) return;`) y
  amplió el comentario de `cerrarRequisicion`. Si H cambia `cerrarReq_` (fotos, bloqueo con devolución abierta), la línea de F va
  **después** de las revisiones de H que deban valer también para el crédito (bloqueo por devolución abierta, foto obligatoria) y
  `recibirSinPagar_` debe recibir lo que H necesite guardar (p. ej. las fotos): hoy su firma es `(libro, hoja, req, nota, motivo)`.
  Con crédito la requisición queda **Recibida**, no Cerrada: las devoluciones de H ("Recibida o Cerrada hace ≤ 30 días") ya la cubren;
  si H regresa la requisición a "Autorizada/Pagada/En camino según su orden" al reponer, una con crédito sin pagar vuelve a Autorizada
  o En camino (orden Emitida) y quien pidió puede volver a confirmar (`recibirSinPagarPosible_` pide orden sin `fechaRecepcion`: al
  reponer, H debe limpiar `fecha_recepcion`/`recibio` de la orden como hace `cancelarRecepcion`).
- **`registrarRecepcion`**: F no lo tocó.
- **`recibiMaterial`** (interfaz): F solo cambió el mensaje de éxito ("recibida: compras pagará al proveedor" si queda Recibida). Si
  H lo reemplaza por un formulario con foto por renglón, conservar ese mensaje y abrir el formulario también cuando `puedeCerrar`
  venga por crédito (estado Autorizada o En camino).
- **Correos**: F no editó la lista `EVENTOS_CORREO` (hace `push` en §6.F) y agregó una línea antes del `switch` en
  `destinatariosAviso` y `contenidoAviso`, y una en `infoDeAviso_` después del bloque de `usuario.alta`: los `case` de H no chocan.
- **Pruebas de H que emitan órdenes o paguen**: necesitan `formaPago` en la orden/propuesta y CSF + carátula del proveedor (o
  `P.exigirDocumentosParaPagar_ = function () {}` si no prueban documentos). `tests/arnes.js`: F agregó `getFilesByName` en las carpetas.
- `HOJAS_COMPRAS`: F tocó `OrdenesCompra` (última línea de `enc`) y `Proveedores`; H toca `MovimientosInventario` y agrega
  `Devoluciones` (sin traslape).

## 8. Pendiente / ideas

- Proveedores extranjeros: marca "extranjero" que pida factura/W-8 en lugar de CSF y cuenta/IBAN en lugar de CLABE (hoy se
  reconocen por no tener RFC nacional: para transferir solo se les pide la carátula).
- Deshacer "Recibí el material" de una orden a crédito (en el flujo de siempre no hay movimientos de inventario que cancelar).
- La lista "Órdenes por proyecto" no muestra la forma de pago (sí la trae en los datos).
- Documentar en `CLAUDE.md` y en el Manual (regla 14) al integrar; probar en PRUEBAS o en el real con Claude in Chrome (regla 13).
