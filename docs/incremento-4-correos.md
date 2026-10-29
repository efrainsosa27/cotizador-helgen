# Incremento 4 (CAPRI) · Módulo B: correos y proveedores

Rama `incremento-4-correos` (sobre la base `7756502`). Spec: secciones "Email notifications" y "Quote request to suppliers" de
"CAPRI — increment 4 spec". Este archivo es para integrar: al hacer el merge se pasa lo necesario a `CLAUDE.md` (§4, §5, §6, §9) y
al Manual (Compras, Administración, Tareas frecuentes, Historial, Pendientes).

## 1. Qué hace

1. **Un correo en cada relevo** de una requisición (y en los eventos de los otros módulos: alta, delegación, anulado, en camino).
   Sale de la cuenta que corre la API (efrain@) con el nombre **"CAPRI Helgen"** y **Reply-To = quien hizo el cambio**. Trae
   folio, proyecto, sitio, qué se necesita, quién lo hizo, una nota y un botón a `…/cotizador/#req=REQ-AAAA-NNNN` (el módulo D
   abre la requisición con esa liga). **Nunca montos, proveedores ni folio de orden de compra** (un correo se reenvía más fácil
   que una pantalla). Nadie recibe aviso de lo que él mismo hizo. Cada envío y cada falla quedan en la pestaña `Correos` del
   libro de Administración; una falla nunca deshace el cambio.
2. **Solicitud de cotización** (solo compras): PDF "Solicitud de cotización" con los renglones aprobados que compras elija (y
   puede reescribir), lugar y fecha de entrega y el contacto de compras; nunca cliente, proyecto, presupuesto ni precios. Se
   guarda privado junto a la requisición y queda en la Bitacora de compras; no cambia la requisición.
3. **Botones de correo** junto a "Descargar PDF": "Abrir en Gmail" (borrador en otra pestaña) y "Abrir en mi correo" (`mailto:`),
   con el correo del proveedor, asunto y una lista de partidas; la persona adjunta el PDF que descargó. Los mismos tres botones
   en una orden emitida ("Enviar orden al proveedor"): en el detalle de la requisición y con el botón "Enviar" de la lista
   "Órdenes por proyecto".
4. **Correos enviados** en Administración (solo super admin): los 200 más recientes, con búsqueda y filtro por estado.
5. **`preparar()`**: `prepararCapri()` manda un correo de prueba a la cuenta que corre el script (así Google pide el permiso de
   mandar correos antes de publicar).

## 2. Funciones (Code.js §6.B)

| Función | Qué hace |
|---|---|
| `modCorreos_()` | `api`: `solicitudCotizacion`, `pdfOrdenCompra`, `listarCorreos`; `cambios`: ninguno (ver decisiones); `preparar`: `prepararCorreos_` |
| `notificar_(tipo, datos)` *(base)* | Forma el aviso en `MEMO_.correos` con `actor` = correo de la sesión |
| `enviarCorreosPendientes_()` | Manda la cola (doPost la llama al terminar bien). Lee `MailApp.getRemainingDailyQuota()` una vez y descuenta por destinatario; si no alcanza, "Sin enviar". `MailApp.sendEmail({to, subject, htmlBody, body, name: 'CAPRI Helgen', replyTo})`. Nunca lanza error. Devuelve los registros |
| `registrarCorreos_(registros)` | Escribe en `Correos` (si existe el libro de Administración; si no, nada) |
| `correosDeAviso_`, `infoDeAviso_` | Arman los correos: releen la requisición (ya con el cambio), su proyecto y su orden; limpian la nota; filtran destinatarios |
| `solicitudCotizacion(reqFolio, opciones)` *(API)* | Ver §5 |
| `pdfOrdenCompra(folioOc)` *(API)* | Solo compras; Cancelada no. Devuelve `{folio, nombre, mime, datos (base64), correo}`. Solo lee |
| `listarCorreos(filtro)` *(API)* | Solo super admin (`exigirSuperAdmin_`). `filtro` = texto o `{texto, estado}`. `{correos (200, recientes primero), total, sinLibro?}` |
| `prepararCorreos_()` | Correo de prueba a `Session.getEffectiveUser()`; si falla lo dice en el registro y no detiene `prepararCapri` |
| `sitioDeSolicitud_(sitio)` | `{nombre, direccion}` de Config → SITIOS (tercer campo) |

Lógica pura (se prueba en Node): `folioReqDeDatos`, `folioDeAviso`, `limpiarTextoAviso(texto, proveedores)` (quita folios de
orden, montos —"$1,500", "1500 MXN", "300 dólares"— y los nombres de los proveedores de esa requisición), `destinatariosAviso(tipo,
datos, info, roles)`, `contenidoAviso(tipo, grupo, info)`, `construirHtmlAviso`, `textoAviso`, `fechaCorreo`,
`normalizarSolicitudCotizacion(opciones, aprobados)`, `construirHtmlSolicitudCotizacion(d, cfg, logo)`,
`textosSolicitudCotizacion`, `textosOrdenCompra`, `correoConLigas(para, asunto, partes, max)`. Constantes: `EVENTOS_CORREO` (base),
`URL_AVISOS_CAPRI`, `REMITENTE_AVISOS`, `MAX_LIGA_CORREO` (1800), `ESTADOS_SOLICITUD_COTIZACION`.

Llamadas a `notificar_` agregadas en §4.3/§4.4 (una línea cada una, al final del cambio, junto al `eventoReq_`):
`guardarRequisicion` (req.solicitada, nueva o reenviada), `cancelarRequisicion` (req.cancelada, con el estado anterior),
`cerrarReq_` (req.recibida: "Recibí el material" y cierre por compras), `autorizarRequisicion` y `autorizarPropuesta`
(req.autorizada), `revisarRequisicion_` (req.devuelta / req.rechazada), `aprobarRequisicion` (req.aprobada),
`cotizarRequisicion` (req.cotizada), `regresarACompras` (req.regresada), `registrarRecepcion` (req.recibida, completa o parcial),
`cancelarOrdenCompra` (oc.cancelada). No se tocaron las revisiones de separación de funciones (módulo A) ni `avisarPortal_` (C).

## 3. Evento → destinatarios

Aprobaciones y compras = `correosConRol_(rol)`: incluye delegaciones activas (delegado **y** quien delega) y a los super admin.
De cada lista se quitan: quien hizo el cambio, cuentas desactivadas en Permisos y correos que no son @helgen.tech /
@helgen.services. Nadie recibe dos correos del mismo aviso (gana el primer grupo: quien pidió antes que su rol).

| Evento | Recibe | Texto (asunto: `[CAPRI] REQ-… · <esto> · <proyecto> · <sitio>`) |
|---|---|---|
| req.solicitada | aprobaciones, menos quien pidió. **Sin el flujo de aprobaciones: compras** | Por aprobar / Corregida, por aprobar (compras: Por autorizar) |
| req.aprobada | compras | Aprobada, por cotizar (+ nota de aprobaciones, limpia) |
| req.devuelta | quien pidió | Devuelta para corregir (+ motivo) |
| req.rechazada | quien pidió | Rechazada (+ motivo) |
| req.cotizada | aprobaciones, menos quien pidió y quien preparó la propuesta | Propuesta por revisar (versión N) |
| req.regresada | compras | Propuesta regresada (+ motivo, limpio) |
| req.autorizada | quien pidió, quien recibe, compras | Autorizada (entrega esperada) / Material por recibir / Autorizada, enviar orden |
| req.encamino | quien pidió y quien recibe | En camino (llegada esperada, paquetería, guía) |
| req.recibida | compras; **si la registró otra persona (compras en su lugar), también quien pidió y quien recibe** | Recepción parcial / Material recibido ("Falta registrar el pago" o "quedó cerrada") / Recepción registrada |
| req.cancelada | si estaba Solicitada: aprobaciones (o compras sin el flujo); **si estaba Devuelta: quien la devolvió** (`reviso_email`) | Cancelada (+ motivo) |
| oc.cancelada | quien pidió (sin el motivo) y compras (con el motivo limpio); sin requisición: solo compras | Orden cancelada ("hay que cotizarla de nuevo" / "pendiente de autorizar") |
| delegacion | el delegado | `[CAPRI] Te delegaron Compras del dd/mm/aaaa al dd/mm/aaaa` |
| usuario.alta | la persona nueva | `[CAPRI] Ya tienes acceso a CAPRI` + liga + cómo entrar (Google en @helgen.tech; código por correo en @helgen.services) |
| anulado | los correos de `datos.para` | `[CAPRI] <folio> · Anulado` (una orden: "Orden de compra anulada" con el folio de la requisición) |

## 4. `datos` de cada evento (para A, C y E)

Todo lo que falte se lee de la hoja. `req` = `"REQ-AAAA-NNNN"` o el objeto de `buscarReq_` (también se acepta `folio:
"REQ-…"`). `nota` = texto libre (se limpia antes de mandarlo). `quien` = texto de quién actuó cuando no hay sesión.

```js
notificar_('req.encamino', { req, fechaEsperada: 'AAAA-MM-DD', paqueteria, guia, nota, quien });   // C
notificar_('req.recibida', { req, parcial: true|false, sitio, nota, quien });                       // C (centro de mando)
notificar_('oc.cancelada', { req, oc: 'OC-…', proyecto: 'PRY-…', nota });                            // E (anular una orden)
notificar_('delegacion', { a: 'delegado@…', de: 'quien@…', roles: ['compras'], desde: 'AAAA-MM-DD', hasta: 'AAAA-MM-DD' }); // A
notificar_('usuario.alta', { correo: 'jesus@helgen.services', nombre: 'Jesús Honorato' });          // A
notificar_('anulado', { para: ['a@helgen.tech', …] | 'a@…, b@…', folio, tipo: 'Requisición', req, proyecto, nota }); // E
```

- Dentro de una función de la API basta `notificar_`: doPost manda la cola al terminar bien.
- **Fuera de doPost** (el activador de 15 minutos del centro de mando): llamar `enviarCorreosPendientes_()` después de los
  `notificar_` (sin sesión no hay Reply-To; el correo dice "Lo hizo: <quien>").
- En `anulado`, un folio `OC-…` nunca sale en el correo: se muestra "la orden de compra de REQ-…" si viene `req`.

## 5. Solicitud de cotización

- `solicitudCotizacion(reqFolio, opciones)`, solo compras. Estados: Aprobada, Cotizada, Autorizada, En camino, Pagada y
  Recibida (`ESTADOS_SOLICITUD_COTIZACION`), con al menos un renglón aprobado (en el flujo de siempre no hay aprobación: no aplica).
- `opciones = {renglones: [{renglon, incluir, descripcion, notas}], proveedor: {nombre, correo}, notas}`. Sin `renglones` van
  todos los aprobados como están. Descripción vacía = la de la requisición; `notas: ""` quita la nota del renglón (para quitar
  datos internos). Un renglón no aprobado o ninguno marcado = error. Correo del proveedor opcional (cualquier dominio; validado).
- PDF: encabezado y datos fiscales de Helgen Servicios Especializados (Config), "SOLICITUD DE COTIZACIÓN", referencia REQ, fecha,
  "Se necesita", "Para:" (opcional), partidas (#, descripción, **cantidad aprobada**, unidad, notas), entrega (nombre y dirección
  del sitio; sin sitio, "Por confirmar"), contacto de compras (quien lo genera + `EMPRESA_EMAIL`/`EMPRESA_TELEFONO`), notas y el
  cierre que pide precio unitario, IVA, tiempo de entrega, vigencia y condiciones de pago. Tablas e inline CSS, texto escapado,
  sin depender de fondos (§6.3). Nunca cliente, proyecto (ni su folio con clave), presupuesto ni precios.
- Archivo: `Compras/AAAA/<folio del proyecto>/Requisiciones/REQ-… — Solicitud de cotización.pdf` (`(2)`, `(3)`… según las
  anteriores en la Bitacora), pasa por `privado_`. Bitacora de compras: "Solicitud de cotización", detalle `REQ-… · N renglón(es)
  · para <proveedor> · <archivo>`. El conteo y la escritura van bajo el candado; el PDF se convierte antes (es lo lento).
- Devuelve `{folio, nombre, mime, datos (base64: "Descargar PDF" sin acceso a Drive), url, renglones, correo: {para, asunto, cuerpo,
  gmail, mailto, recortado, partes: {asunto, inicio, lista, fin}}}`.
- Correo: asunto `Solicitud de cotización · Helgen Servicios Especializados · REQ-…`; saludo (con el proveedor), una línea por
  partida (`1. 80 M · Cable THW 10`), lo que debe incluir la cotización, entrega y fecha, firma de compras. `correoConLigas` corta
  partidas del final si la liga más larga (Gmail o mailto) pasa de 1,800 caracteres: "… y N partida(s) más: ver el PDF adjunto."
  (si ni así cabe, corta el texto y termina en "… ver el PDF adjunto."). La interfaz tiene una copia idéntica para rehacer las
  ligas al cambiar el correo; la prueba compara el código de las dos.

## 6. Interfaz (`<script id="mod-correos">`)

- Markup agregado: `#rcSolicitud` (primer módulo del detalle de la requisición, debajo de los botones de revisión),
  `#rcEnviarOc` (módulo 3, debajo de los mosaicos de la orden) y `#ocEnviarCaja` (debajo de la tabla de "Órdenes por proyecto").
- Sin editar funciones de Compras: el módulo **envuelve** `pintarReqCom` y `pintarCompras` (llama la original y luego pinta sus
  cajas; si algo falla, solo lo escribe en la consola). En la lista agrega el botón "Enviar" a cada orden vigente; si la tabla
  cambia de forma, no agrega nada.
- Solicitud: "Preparar solicitud de cotización" → renglones aprobados con casilla, descripción y notas editables, proveedor (lista
  de Proveedores: llena el correo), correo, notas → "Generar PDF" → "Descargar PDF" · "Abrir en Gmail" · "Abrir en mi correo" y la
  nota "Descarga el PDF y adjúntalo…". Lo capturado se conserva si la sincronización repinta la misma requisición.
- Orden: "Preparar PDF y correo" → los mismos tres botones. Solo con `permisos.compras`; Cancelada no.
- Administración → `#adminCorreos` (solo `permisos.superadmin`; `alPermisos` lo oculta y lo vacía si no): "Correos enviados" con
  búsqueda, filtro de estado y tabla (fecha, para, asunto, aviso, folio, estado + error, quién). Se carga con `alVerTab('admin')`.
- Lo que usan los `onclick` va en `window.CORREOS` (sin nombres globales sueltos que choquen con otros módulos).

## 7. Bitácora `Correos` (libro de Administración)

Columnas de `HOJAS_ADMIN.Correos`: `fecha` (texto `AAAA-MM-DD HH:mm:ss`), `para` (separados por ", "), `asunto`, `tipo`
(evento o `prueba`), `folio` (la requisición; si no hay, el folio que traiga el aviso, también el de una orden: esta hoja es
privada), `estado` (`Enviado`, `Error`, `Sin enviar` = cuota agotada, `Sin destinatarios` = solo quien lo hizo debía recibirlo),
`error`, `actor`. Un renglón por correo (cada grupo de destinatarios es un correo). Sin libro (antes de `prepararCapri`) los
correos salen igual y no se registran.

## 8. Decisiones tomadas aquí (revisar al integrar)

1. **Super admin recibe los avisos de aprobaciones y compras** porque `correosConRol_` lo incluye (así lo dejó la base). Si Leo
   no los quiere, cambiar `correosConRol_` (o filtrar en `correosDeAviso_`) para contar solo el rol propio o delegado.
2. Sin el flujo de aprobaciones (nadie con el rol), req.solicitada va a **compras** ("Por autorizar"): ahí compras es quien sigue.
3. req.recibida registrada en lugar de otra persona avisa también a quien pidió y a quien recibe.
4. req.cancelada desde Devuelta avisa a quien la devolvió (`reviso_email`), que era quien esperaba la corrección.
5. Las notas se mandan solo a quien ya las ve en la app (el motivo de cancelar una orden no va a quien pidió) y siempre limpias:
   sin montos, folios de orden ni el nombre de los proveedores de esa requisición. Otro texto libre (p. ej. el nombre de otro
   proveedor) no se puede detectar.
6. El correo a un proveedor (solicitud y orden) sí lleva su folio de orden: la regla de "nunca folio de orden" es para los avisos.
   Tampoco lleva montos: van en el PDF.
7. `solicitudCotizacion` no está en `CAMBIOS_API`: guarda un PDF y una línea de Bitacora, pero no cambia nada que vea la interfaz
   (no hace falta subir versiones). `pdfOrdenCompra` y `listarCorreos` solo leen.
8. Un correo por grupo de destinatarios (no uno por persona): menos envíos y la cuota se descuenta por destinatario.
9. Cuentas desactivadas en Permisos no reciben avisos (salvo `usuario.alta`).

## 9. Pruebas

`tests/correos.test.js` (usa `tests/arnes.js`; MailApp en `A.correos`, `A.fallarCorreo`): lógica pura (destinatarios, limpieza,
contenido, ligas con tope y acentos, copia de la interfaz = Code.js); cada evento con sus destinatarios (delegación tania → ana,
super admin, sin quien lo hizo, sin cuentas de fuera); ningún correo con montos, proveedor, folio de orden ni cliente (se revisan
todos los mandados); falla registrada y cambio guardado; cuota agotada (0 y 1 para 2 destinatarios); eventos de A, C y E y sin
sesión; flujo de siempre (sin libro de Administración); solicitud de cotización (rol, estados, renglones, sin cliente/proyecto/
precios, dirección del sitio, archivo privado, `(2)`, Bitacora, sin subir versiones); PDF de la orden (rol, cancelada);
`listarCorreos` solo super admin (filtros, 200); `preparar`; interfaz con DOM simulado conectada al servidor simulado (caja de
solicitud, ligas, cambiar el correo, descargar, enviar la orden, botón en la lista, sin compras, Administración). Además se revisó
a ojo el PDF (HTML sin fondos) y las cajas en Chromium con respuestas del arnés.

`bash tests/todas.sh`: todas pasan.

## 10. Publicación

1. Merge (con los demás módulos).
2. Efrain: respaldo del libro de compras y `npx clasp push --force`.
3. **Efrain corre `prepararCapri()` desde el editor antes de `clasp deploy`**: Google pide el permiso nuevo de **mandar correo**
   (`script.send_mail`, se detecta solo por `MailApp`; el manifiesto no lista permisos) y llega el "[CAPRI] Correo de prueba" a
   efrain@. Si el registro dice "NO se pudo mandar la prueba", no publicar: la API corre como efrain@ y, con un permiso nuevo sin
   autorizar, **fallan todas las llamadas** (CLAUDE.md §6.8).
4. `npx clasp deploy --deploymentId AKfycbwBjF7…` y `npx --yes wrangler@4 deploy` (la interfaz cambió).
5. Probar: una requisición de prueba en el flujo con aprobaciones y revisar Administración → Correos enviados.

## 11. Pendiente / fuera de alcance

- La liga `#req=` la abre el módulo D (si no está, abre CAPRI en su pantalla de inicio).
- "Enviar desde CAPRI" con el PDF adjunto (mismo permiso; saldría de efrain@): idea del spec para después.
- Resumen diario, recordatorios y avisos de facturas por vencer: necesitan un activador (spec: fuera de este incremento).
- La hoja `Correos` crece sin límite (un renglón por correo); `listarCorreos` la lee completa. Si llega a decenas de miles de
  renglones, archivar los viejos.
- Sin prueba en el navegador real con cuentas reales (regla 13): la hace Claude con el entorno de PRUEBAS al integrar.
