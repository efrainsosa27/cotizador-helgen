# Incremento 5 (CAPRI) · Módulo H: recepción con fotos y devoluciones

Rama `incremento-5-h` (sobre `incremento-5-base` = `4a433c3`). Contrato: `docs/incremento-5.md` §3, §4 y §5. Este archivo es
para integrar: al hacer el merge se pasa lo necesario a `CLAUDE.md` (§4.8, §5, §6, §9) y al Manual (Compras, Requisiciones,
Tareas frecuentes, Historial, Pendientes).

## 1. Qué hace

1. **Una foto por renglón que llega** (cantidad > 0), obligatoria, en: "Registrar lo que llegó" (`registrarRecepcion`, con
   aprobaciones), "Recibí el material" (`cerrarRequisicion`, flujo de siempre: una por renglón pendiente de la orden), "Lo recogí"
   (`marcarEnCamino` con `recogido: true`: una por renglón por recibir) y la recepción de respaldo de compras (`registrarRecepcion`
   hecha por compras). El navegador la comprime (`comprimirFoto`: canvas, lado mayor 1600 px, JPEG 0.72; `<input type="file"
   accept="image/*" capture="environment">`). El servidor la valida (imagen JPG/PNG/HEIC por sus primeros bytes, ≤ 10 MB; un PDF
   no) y la guarda en `Compras/AAAA/<proyecto>/Recepciones/<REC-… o DEV-…> — r<n>.jpg` con `privado_`.
2. **Devoluciones `DEV-AAAA-NNNN`**: quien pidió, quien recibe o compras reporta un problema (Incorrecto · Dañado · Faltante ·
   Sobrante · Otro) con comentario y foto (salvo faltante), al recibir (opcional, por renglón) o después; compras (o super admin)
   lo resuelve: **Reponer**, **Devolver al proveedor**, **Cancelar renglón** o **Conservar**. Mientras haya una Abierta la
   requisición **no se cierra** (ningún camino: quien pidió, compras, el pago ni el centro de mando).
3. **Centro de mando**: sus recepciones traen `foto` y `problema` por renglón; CAPRI baja cada foto (GET firmado, fuera del
   candado), la guarda en Drive, la anota y avisa `foto-archivada`; crea la DEV de cada problema una sola vez. Al resolver una
   devolución de un proyecto ligado manda `oc.devolucion` (sin montos).
4. **Correos** `dev.reportada` y `dev.resuelta`; **Pendientes**: devoluciones abiertas para compras.
5. **Interfaz** (`<script id="mod-recepcion">`): foto y "Problema" por renglón en los formularios de recepción, "Recibí el
   material" y "Lo recogí" con fotos, "Reportar problema" en Mis requisiciones y en la requisición de Compras, "Ver foto",
   devoluciones de la requisición con su resolución y la lista **Devoluciones** en Compras.

## 2. Hojas y columnas (libro de compras; se migran solas con `hojaDeArea_`)

- `MovimientosInventario`: al final **`foto_id`, `foto_url`** (W:X; el código las busca por nombre con `colMov_`). Tipos nuevos
  de movimiento (columna `tipo`):
  - `Devolución` (folio = el DEV, cantidad **negativa**): "Reponer"; el renglón vuelve a "por recibir".
  - `Devolución sin reponer` (folio DEV, cantidad negativa): "Devolver al proveedor" o "Cancelar renglón"; además baja lo que se
    espera del renglón (faltante aceptado: `avanceRecepcion` lo devuelve como `faltante` y el renglón queda completo).
  - `Faltante aceptado` (folio DEV, cantidad **positiva**): un faltante reportado en el centro de mando que compras ya no espera
    ("Devolver al proveedor" o "Cancelar renglón"): solo baja lo que se espera; lo recibido no cambia (allá nunca se contó).
  - `Recogido en tienda` (folio REC): la foto de cada renglón de "Lo recogí". No cuenta como recepción.
  - `Entrada por compra` (como siempre). **"Recibí el material" y el cierre de compras ahora también dejan entradas** (folio REC)
    de lo pendiente de cada renglón: así el flujo de siempre tiene avance por renglón y se puede reportar un problema después.
  - foto_id `centro:<id>` = foto del centro de mando que todavía no llega a Drive (se reemplaza al archivarla).
- **`Devoluciones`** (nueva, en `HOJAS_COMPRAS`): `folio`, `fecha` (texto `'AAAA-MM-DD HH:mm:ss`), `req_folio`, `oc_folio`,
  `proyecto_folio`, `renglon` (de la orden), `descripcion`, `cantidad`, `tipo`, `comentario`, `foto_id`, `foto_url`, `origen`
  (CAPRI · Centro de mando), `reporto_email` (en el centro de mando: quien recibió, p. ej. `jesush`), `estado` (Abierta ·
  Resuelta), `resolucion`, `nota_resolucion`, `guia_devolucion`, `resolvio_email`, `fecha_resolucion` y **`origen_clave`** (ver
  desviaciones). Consecutivo `CONSECUTIVO_DEV_AAAA` (`siguienteFolio_`). Nunca se borran filas.
- Archivos: `Compras/AAAA/<folio del proyecto>/Recepciones/` (restringida de arriba abajo): `REC-… — r1.jpg` (recepción y "Lo
  recogí"), `DEV-… — r1.jpg` (foto del problema), fotos del centro de mando con el folio REC de su movimiento (o el de la
  requisición si no hay).

## 3. Funciones (Code.js)

**Módulo** `modRecepcion_()` (§6.H, en `MODULOS_`): `api` = `reportarProblema`, `listarDevoluciones`, `resolverDevolucion`;
`cambios` = las dos que escriben → `requisiciones`, `oc`; `solo` = `reportarProblema`, `listarDevoluciones`; `sincronizar` manda
`r.devoluciones` si la lista de Compras está abierta (`ctx.devoluciones = {estado}`) y cambió algo; `preparar` crea la pestaña y
las columnas.

| API | Quién | Qué hace |
|---|---|---|
| `reportarProblema(reqFolio, d)` | quien pidió, quien recibe o compras | `d = {renglon, cantidad, tipo, comentario, foto, idSolicitud}`. Mientras la recepción sigue (Autorizada/Pagada/En camino con algo recibido) o hasta **30 días** después de Recibida/Cerrada (fecha de recepción de la orden). Cantidad ≤ lo recibido del renglón menos lo que ya está en devoluciones abiertas. Crea la DEV Abierta, historial (sin el comentario), Bitacora, `dev.reportada`. Idempotencia `DEV_<id>`. Devuelve `{folio, requisiciones (quien pide), vista (compras)}` |
| `listarDevoluciones(filtro)` | compras/super admin: todas; quien pide: las de sus requisiciones | `filtro` = texto o `{texto, estado, req}`. Más recientes primero (300). Compras además ve `ocFolio`, `notaResolucion`, `puedeResolver`. Nunca montos |
| `resolverDevolucion(folio, d)` | compras o super admin | `d = {resolucion, nota, guia, idSolicitud}` (nota obligatoria al devolver o cancelar). Efectos en §4. Idempotencia `DVR_<id>`. Devuelve `{folio, estado, vista, devoluciones (abiertas)}` |

**Internas** (§6.H): `fotosDeRenglones_`, `fotoDeAdjunto_`, `carpetaRecepciones_`, `guardarFotosRecepcion_`, `conFotoMov_`,
`avanceDeReq_`, `validarFotosYProblemas_`, `crearDevolucionesDeRecepcion_`, `recibirTodoConFotos_`, `validarCierreConFotos_`,
`fotosRecogido_`, `devDesdeFila_`, `momentoTexto_`, `devolucionesDelLibro_` (memo por petición en `MEMO_.devs`),
`devolucionAbiertaDe_`, `ocupadoEnDevoluciones_`, `exigirSinDevolucionAbierta_`, `exigirSinDevoluciones_`, `fechaRecepcionReq_`,
`motivoSinReporte_`, `renglonesReportables_`, `crearDevolucion_`, `devolucionParaVista_`, `cerrarRetenida_`, `completarTrasDevolucion_`,
`recepcionParaSolicitante_`, `recepcionParaCompras_`, `fotosDeMovimientos_`, `accesoFotos_`, `devolucionesParaPendientes_`;
centro de mando: `fotosYProblemasPortal_`, `crearDevolucionPortal_`, `archivarFotosPortal_`, `descargarFotoPortal_`,
`anotarFotoPortal_`, `recepcionAntesDeReponer_`, `avisoPendiente_`.

**Lógica pura** (Node): `cuentaEnRecepcion`, `validarFoto`, `nombreArchivoFoto`, `normalizarProblema`, `normalizarResolucion`,
`efectoResolucion`, `textoResolucionDev`, `textoRetenida`, `dentroDeVentanaDev`, `fotoPortal`, `claveProblemaPortal`; y, ya
existentes, `avanceRecepcion` (faltante aceptado), `cuerpoEventoPortal` (`oc.devolucion`), `destinatariosAviso` /
`contenidoAviso` (eventos nuevos), `itemsPendientes` (devoluciones).

**Cambios en funciones compartidas** (cada uno marcado con un comentario `H (incremento 5)`, pensado para el merge con F):
`HOJAS_COMPRAS` (columnas y pestaña), `MODULOS_`, `movDesdeFila_` (+`fotoId`, `fotoUrl`) y `colMov_`, `movimientosPorOc_`
(también devoluciones), `recepcionesDe_` (solo entradas; `fotoUrl` por renglón para compras), `misRequisicionesDeHojas_`
(+`recepcionParaSolicitante_`: `devoluciones`, `reportables`, `fotos`), `vistaRequisicion_` (+`recepcionParaCompras_`:
`devoluciones`, `reportables`, `fotosRecogido`, `tiposDev`, `resolucionesDev`), `cerrarRequisicion(folio, notas, d)` (tercer
parámetro), `cerrarRequisicionCompras` (bloqueo + entradas de lo pendiente), `registrarRecepcion` (fotos, problemas, retenida),
`registrarPagoProveedor` (retenida), `cancelarRecepcion` (solo entradas; bloqueo con devoluciones), `marcarEnCamino` (fotos de
"Lo recogí"), `TRANSICIONES_REQ` / `VERBOS_REQ`, `avanceRecepcion`, `EVENTOS_CORREO`, `destinatariosAviso`, `contenidoAviso`,
`infoDeAviso_` (`d.dev`), `TIPOS_EVENTO_PORTAL`, `avisarPortal_(tipo, folioOc, extra)`, `cuerpoEventoPortal`,
`traerRecepcionesPortal`, `aplicarRecepcionPortal_`, `pendientes` / `itemsPendientes`.

## 4. Estados y transiciones

| Acción nueva | De | A | Cuándo |
|---|---|---|---|
| `recibirRetenida` | Pagada, En camino (pagada) | Recibida | recepción completa (o "Recibí el material", o el centro de mando) con una devolución abierta: no se cierra; la orden sigue **Pagada** con su fecha de recepción |
| `pagarRetenida` | Recibida | Recibida | se paga una Recibida con una devolución abierta: la orden queda Pagada (no Recibida) |
| `cerrarRetenida` | Recibida | Cerrada | al resolver la última devolución abierta de una Recibida con la orden pagada y todo recibido (la orden queda Recibida) |
| `devolucionAutorizada` / `devolucionPagada` / `devolucionEnCamino` | Recibida, Cerrada | Autorizada / Pagada / En camino | "Reponer": el renglón vuelve a por recibir. **En camino** si la orden ya había ido en camino (`en_camino_en`), si no **Pagada** si la orden está pagada (una Recibida regresa a Pagada), si no **Autorizada**. Se borran la fecha y quién recibió de la orden |
| `cancelarRecepcionPagada` (revisión, 29/10) | Recibida | Pagada | se cancela (o se anula) una recepción de una retenida (la orden ya está Pagada): vuelve a Pagada, no a Autorizada. La regla completa es `accionCancelarRecepcion(orden)`: En camino si la orden ya iba en camino, si no Pagada si está pagada, si no Autorizada; la usan `cancelarRecepcion` y el efecto "recepción" de Anular |

Efecto de cada resolución (`efectoResolucion(resolucion, tipo, origen)`, la misma regla que el centro de mando: lo que nunca se
contó como recibido no se descuenta):

| Resolución | Movimiento | Renglón | Requisición |
|---|---|---|---|
| Reponer | `Devolución` −cantidad | vuelve a "por recibir" | de Recibida/Cerrada se reabre (tabla de arriba); abierta: sigue igual y se recibe la reposición |
| Devolver al proveedor (nota obligatoria; guía opcional) | `Devolución sin reponer` −cantidad | cerrado con faltante aceptado | no cambia (una retenida se cierra si ya no hay otra abierta) |
| Cancelar renglón (nota obligatoria) | igual que devolver | igual | igual |
| Conservar | ninguno | igual | no cambia (una retenida se cierra) |
| **Sobrante** (cualquier resolución) | ninguno (no se recibe más de lo pedido: nunca se contó) | igual | igual que Conservar |
| **Faltante del centro de mando**: Reponer | ninguno (allá se recibió lo que llegó: el renglón ya está por recibir) | sigue por recibir | no cambia |
| **Faltante del centro de mando**: Devolver / Cancelar | `Faltante aceptado` +cantidad (hasta lo pendiente) | cerrado con faltante | si con eso ya no se espera nada, se completa como al recibir (`completarTrasDevolucion_`: pagada → Cerrada y la orden Recibida; sin pagar → Recibida) |

Un **Faltante reportado en CAPRI** es "se registró como recibido pero no llegó" (p. ej. "Recibí el material" registra todo lo
pendiente): ese sí se descuenta, como un dañado.
Por lo mismo, "Registrar lo que llegó" (donde se escribe cuánto llegó) no acepta un problema "Faltante": lo que no llegó no se
registra y queda por recibir (o "Ya no llegará lo que falta"); la interfaz no ofrece esa opción ahí.

Cierres bloqueados con una devolución Abierta: "Recibí el material" (queda Recibida), `cerrarRequisicionCompras` (error),
`registrarRecepcion` completa y pagada (queda Recibida), el pago de una Recibida (sigue Recibida), el centro de mando
(`traerRecepcionesPortal` con `completa`: queda Recibida). `cancelarRecepcion` no procede si el renglón tiene una devolución
abierta o una resuelta con movimiento; la de otro renglón de una retenida sí se cancela y la requisición vuelve a **Pagada** (antes
quedaba Autorizada con la orden Pagada y ya no había forma de pagarla ni cerrarla; revisión del 29/10, `tests/revision5.test.js`).
Con la requisición retenida, compras no puede cancelar el pago hasta resolver.

## 5. Centro de mando (contrato §5, lado de CAPRI)

- `aplicarRecepcionPortal_` (dentro del candado): copia la diferencia como siempre, pero (a) el tope es lo pedido menos el
  faltante aceptado; (b) **una recepción con `cuando` anterior o igual a la última "Reponer" de ese renglón ya está contada** (el
  centro de mando la vuelve a mandar cuando cambia su foto): no se copia ni cuenta su `completa`; (c) cada movimiento nuevo con
  foto no archivada lleva `foto_id = centro:<id>`; (d) `fotosYProblemasPortal_` anota en `res.fotos` cada foto no archivada
  (renglón y problema) y crea la DEV de cada problema una sola vez (`origen_clave` = OC:renglón:f:<id de la foto> o, sin foto,
  OC:renglón:c:<hash de tipo|cantidad|comentario>), con `origen` Centro de mando y `reporto_email` = `recibio` (la cantidad de un
  faltante o sobrante no se recorta a lo recibido). También para una requisición ya **Cerrada** (fotos por archivar y problemas
  reportados después) y, solo las fotos, para una orden **cancelada o anulada** (el centro de mando ofrece una foto sin archivar
  en cada consulta: si no se archivara, la alerta de "material en una orden cancelada" se repetiría cada 15 minutos). (e)
  Completa y pagada con una devolución abierta → Recibida (retenida). (f) Mientras el `oc.devolucion` de esa orden siga
  **Pendiente** (el centro de mando no lo ha recibido y su `recibido` todavía no baja), nada nuevo se copia en los renglones
  repuestos.
- `archivarFotosPortal_` (fuera del candado, hasta 40 por corrida): `GET /api/integracion/cotizador/foto?id=` firmado (cuerpo
  vacío) → Drive (`Recepciones`, privada) → anota `foto_id`/`foto_url` en el movimiento o la devolución con la marca (si no hay,
  la última entrada vigente sin foto de ese renglón; si tampoco, queda en la Bitacora "Foto del centro de mando sin renglón") →
  `POST /api/integracion/cotizador/foto-archivada` `{id, url}` firmado. Lo que falle va a `errores`: **no avanza
  `PORTAL_ULTIMA_CONSULTA`** (se vuelve a ofrecer) pero lo demás ya quedó aplicado (la requisición se cierra igual). Un 404 =
  ya no existe o ya se archivó: no es error (`fotosPerdidas`). Si la foto ya llegó a Drive pero falló el aviso, la liga queda en
  caché 6 h (`FOTOCM_<id>`) y la siguiente corrida solo vuelve a avisar.
- `oc.devolucion` (`avisarPortal_('oc.devolucion', oc, {devolucion})` dentro del candado de `resolverDevolucion`; lo manda
  `conAvisoPortal_`): el cuerpo de siempre (sin montos) + `devolucion: {folio, renglon, cantidad, tipo, resolucion, nota}`; la nota
  pasa por `limpiarTextoAviso` (sin montos ni folios de orden). Solo proyectos ligados; `buscarMontos` lo revisa.

## 6. Correos (6.B)

| Evento | Recibe | Texto |
|---|---|---|
| `dev.reportada` | compras; y quien pidió si reportó otra persona (o el centro de mando) | "Problema con material": folio DEV, material (cantidad, unidad, descripción limpia), problema, origen; "Hay una nota" en vez del comentario |
| `dev.resuelta` | quien reportó, quien pidió y quien recibe (sin repetir; nunca quien lo resolvió) | "Devolución resuelta": la resolución explicada; la nota de compras nunca va |

Sin montos, proveedor ni folio de orden (reglas de B). Fuera de doPost (activador) los manda `cadaQuinceMinutos` al final.

## 7. Interfaz (`<script id="mod-recepcion">`)

- `comprimirFoto(file)` (también `window.comprimirFoto` y `RECEPCION.comprimirFoto`): `{nombre, datos (base64 sin prefijo),
  mime: 'image/jpeg'}`; si el navegador no puede dibujar la imagen (HEIC fuera de Safari) la manda como está (≤ 10 MB).
- Reemplaza (sin editar el script principal) `htmlFormRecepcion` / `enviarRecepcion` (modos `registrar`, `cerrar`, `recoger`:
  foto por renglón, fila "Problema" con tipo, cantidad, comentario y foto), `recibiMaterial` ("Recibí el material" abre el
  formulario de fotos bajo la requisición; sin renglones por recibir, como antes) y `centroRecogi` ("Lo recogí" con fotos).
- Mis requisiciones (`alMisReq`, caja `devCaja-<folio>`): problemas reportados y su estado, "Ver foto" (si el servidor las
  manda) y "Reportar problema" (renglones `reportables`).
- Compras (`alVistaReqCom`, caja `#rcDevoluciones`): "Fotos de lo que llegó" (recepciones y "Lo recogí"), tabla de devoluciones
  con "Resolver" (resolución, nota, guía; confirma), "Reportar problema". Lista **Devoluciones** (`#comModDevoluciones`, filtro
  Abiertas/Resueltas/Todas) con "Resolver" y liga a la requisición; se mantiene al día con la sincronización (`contexto`).
- Cambios en el script principal: solo la caja `devCaja-<folio>` en `pintarMisReq` y el markup de `#rcDevoluciones` y
  `#comModDevoluciones`.

## 8. Decisiones tomadas aquí (revisar al integrar)

1. **"Ver foto" para quien pidió solo si tiene acceso a la carpeta de compras en Drive** (`accesoFotos_`: editores, lectores
   o dueño de `Cotizador Helgen — Compras`, en caché 1 h). Si Drive no contesta, no se muestra (contrato §3).
2. **"Recibí el material" y el cierre de compras escriben entradas por compra** (antes el flujo de siempre no dejaba
   movimientos). Sin eso no hay avance por renglón ni nada que devolver. El cierre de compras no exige fotos (cierra en lugar
   de otra persona).
3. **Reportar con la recepción en curso**: además de Recibida/Cerrada (≤ 30 días), se puede reportar sobre un renglón ya
   recibido mientras la requisición sigue Autorizada/Pagada/En camino (recepción parcial). La ventana cuenta desde la fecha de
   recepción de la orden (o la última actualización de la requisición si falta).
4. **Requisiciones cerradas antes de este incremento en el flujo de siempre** no tienen entradas: no se les puede reportar un
   problema desde CAPRI ("no hay material recibido para reportar"). Compras puede registrarlo a mano si hace falta.
5. **"Lo recogí"** deja movimientos `Recogido en tienda` con folio REC (no REQ: un folio REQ en MovimientosInventario
   confundiría a Anular, que agrupa movimientos por folio).
6. El comentario del problema **no** va al historial que ve todo el equipo de la requisición (solo "Problema reportado (DEV-…):
   tipo · cantidad de descripción"); sí en la DEV (lo ven quien pidió, quien recibe y compras) y en la Bitacora de compras.
7. Una devolución del centro de mando se crea aunque la cantidad reportada pase de lo recibido (se recorta a lo recibido) o sea
   de una requisición cerrada hace más de 30 días: lo reportó el sitio.
8. Las fotos del centro de mando de órdenes canceladas o anuladas se archivan (sin DEV); la recepción se ignora como hasta hoy.
9. Las fotos se guardan dentro del candado (como la cotización y el comprobante de siempre: Drive, no el centro de mando).

## 9. Desviaciones del contrato

- **Columna extra `origen_clave`** al final de `Devoluciones` (el contrato no la lista): guarda la llave (OC, renglón, foto o
  comentario) para no crear dos veces la DEV de un problema del centro de mando. El centro de mando no lee esta hoja.
- `cerrarRequisicion` recibe un **tercer parámetro** `d = {renglones: [{renglon, foto, problema}], idSolicitud}` y
  `marcarEnCamino` acepta `d.renglones` (fotos) con `recogido: true`; `registrarRecepcion` acepta `foto` y `problema` en cada
  renglón. El contrato pide las fotos pero no fijaba la forma.
- `listarDevoluciones` también la puede usar quien pide (solo las suyas) — el contrato no decía quién.

## 10. Para el integrador (merge con F y con el centro de mando)

- **`MODULOS_`**: F agrega `modProveedores_()` en la misma línea → conflicto trivial (quedan los dos).
- **`cerrarRequisicion`**: aquí la recepción con fotos (`recibirTodoConFotos_`) va **antes** de `cerrarReq_`; ya revisa con
  `validarCierreConFotos_` que se pueda cerrar y, si existe `recibeAntesDePagar_(orden)` (F), acepta la orden Emitida (`recibir`).
  La rama de crédito de F debe reemplazar solo la llamada a `cerrarReq_` (con crédito: Autorizada → Recibida sin pagar).
- **`registrarPagoProveedor`**: dos líneas de H (`retenida`, `pagarRetenida`, la orden queda Pagada); F agrega su bloqueo de
  documentos al principio: no se tocan.
- **`reqParaSolicitante_` / `vistaRequisicion_`**: H no cambia `puedeCerrar` ni `puedeRecibir`; solo agrega campos al final.
- **arnés** (`tests/arnes.js`): exporta `FOTO`, `conFotos`, `FOTOS` y las respuestas con `Buffer` dan `getContent()`. Si F tiene
  pruebas que reciben material, necesitan foto (`conFotos(renglones)` o `FOTOS` en `cerrarRequisicion`).
- **Merge de prueba con F** (`incremento-5-f` = `f7aab98`, del bundle de F; hecho en una rama temporal y descartado): conflictos
  solo en `MODULOS_` (quedan los dos), el comentario y la firma de `cerrarRequisicion` (queda `cerrarRequisicion(folioReq, notas,
  d)` con los dos comentarios; el cuerpo es el de H y `cerrarReq_` ya trae la rama de crédito de F), el `return` de
  `vistaRequisicion_` (las dos líneas de F + `return Object.assign({`), las secciones nuevas al final de `Code.js` (§6.H y luego
  §6.F, completas) y los dos `<script>` nuevos al final de la interfaz. Con eso **todas las pruebas pasan** (20 + sintaxis) si en
  `tests/proveedores.test.js` (de F): `cerrarRequisicion(r3, 'Llegó completo', FOTOS)` (foto obligatoria) y el `falla` de
  `cancelarOrdenCompra` acepta también `/ya tiene material recibido/` ("Recibí el material" ahora deja entradas y esa revisión
  va primero). `tests/recepcion.test.js` ya manda `formaPago` y salta el bloqueo de documentos (`P.exigirDocumentosParaPagar_`).
- **Centro de mando (módulo I)**: revisado contra `backend/compras.py` de la rama `fotos-devoluciones` (`3be3a1d`): `recibido` =
  acumulado y neto de devoluciones; tras `oc.devolucion` "Reponer" baja `recibido` y borra `recibido_en` del renglón; un
  Faltante o Sobrante no mueve existencias allá (por eso aquí tampoco se descuentan, ver §4); una foto sin archivar se vuelve a
  ofrecer en cada consulta; `oc.devolucion` lee `devolucion.{folio, renglon, cantidad, tipo, resolucion, nota}`. Coincide con
  este lado.

## 11. Pruebas

`tests/recepcion.test.js` (arnés, centro de mando simulado con HMAC): lógica pura; "Recibí el material" (fotos obligatorias, PDF
rechazado, nada a medias, archivos privados en Recepciones, columnas); permisos; reportar (renglón, cantidad, foto, idempotencia,
lo ya reportado); correos (destinatarios, sin comentario ni montos); listas y Pendientes; Reponer (movimiento, reabre, la orden
Recibida → Pagada, la reposición cierra), Devolver al proveedor (faltante aceptado), Conservar; ventana de 30 días (día 30 sí, 31
no); problema al recibir → Recibida retenida → se cierra al resolver; compras no cierra con una abierta; con aprobaciones: "Lo
recogí" con fotos, recepción con foto y problema, pagar una retenida, cancelar recepción bloqueada, Cancelar renglón; centro de
mando: fotos bajadas y archivadas (firmas), DEV del sitio una vez, retenida, `oc.devolucion` sin montos, recepción vieja tras
Reponer no se duplica, reposición nueva se copia y cierra, falla de foto no avanza la última consulta y se recupera, aviso de
archivada que falla no vuelve a bajar la foto, 404 no es error, faltante del sitio (no se descuenta; "Devolver" lo acepta y
completa la requisición), fotos de una orden cancelada, "Reponer" con el aviso pendiente, proyecto sin ligar no avisa; sincronizar; y la interfaz con DOM
simulado conectada al servidor simulado ("Recibí el material", reportar, "Lo recogí", Compras: lista, caja y resolver).
Pruebas existentes actualizadas solo donde el comportamiento cambió a propósito (las recepciones llevan foto; la pestaña
Devoluciones existe; centro: los movimientos de "Lo recogí"). `bash tests/todas.sh`: todas pasan.

## 12. Publicación

1. Merge (con F). `bash tests/todas.sh`.
2. Respaldo del libro de compras. `npx clasp push --force`.
3. **Efrain corre `prepararCapri()`** (crea `Devoluciones` y las columnas `foto_id`/`foto_url`; también se crean solas al
   primer uso). No hay permisos nuevos de Google (Drive, UrlFetch y MailApp ya estaban).
4. `npx clasp deploy --deploymentId AKfycbwBjF7…` y `npx --yes wrangler@4 deploy` (cambió la interfaz).
5. Centro de mando: publicar el módulo I (rutas `foto`, `foto-archivada`, recepciones con `foto`/`problema`, `oc.devolucion`)
   **antes o junto** con CAPRI. Si el centro de mando todavía no manda `foto`/`problema`, CAPRI sigue igual que hoy.
6. Prueba en el navegador (regla 13, entorno de PRUEBAS): recibir con fotos desde el teléfono (Safari y Chrome), reportar un
   problema, resolver cada caso, y una ronda con el centro de mando (`PORTAL_PRUEBA = 1`).

## 13. Pendiente / fuera de alcance

- Sin prueba en el navegador real ni con un teléfono (regla 13): la compresión y `capture="environment"` solo se probaron con
  DOM simulado.
- No hay foto de evidencia de la devolución física (guía) más allá del texto `guia_devolucion`.
- Reportar un problema no avisa al centro de mando (el contrato solo tiene `oc.devolucion` al resolver).
- Anular una requisición esconde sus devoluciones (por `esAnulado_` de la requisición), pero no les cambia el estado en la hoja.
- `recepcionesAntesDeCancelar_` (cancelar una orden ligada) puede tardar más si hay fotos por bajar en ese momento.
- Pasar a `CLAUDE.md` y al Manual al integrar.
