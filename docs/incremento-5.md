# Incremento 5 (CAPRI): forma de pago, proveedores, fotos y devoluciones — contrato entre módulos

Pedido de Leo (29/10/2026, retroalimentación de los usuarios) y decisiones que tomó en el chat:

1. **Forma de pago por orden de compra.** "Crédito" = **crédito del proveedor** (se recibe el material antes de pagar; se paga
   por factura + días de crédito, como ya calcula Cuentas por pagar). Además se pueden elegir transferencia, tarjeta de crédito,
   tarjeta de débito en sitio (se paga en la tienda al recoger), efectivo y cheque.
2. **Base de proveedores** con datos y documentos (constancia de situación fiscal, carátula bancaria, comprobante de domicilio).
   Si faltan: **aviso** al emitir la orden; **no se registra un pago** hasta que el proveedor tenga CSF y carátula (se le paga a la
   CLABE de la carátula: control contra fraude). Un super admin puede saltarlo con motivo (≥ 10, a la bitácora), como las demás
   excepciones.
3. **Una foto por renglón** de material que llega, comprimida en el teléfono/navegador y guardada **en la nube (Google Drive)**,
   no en el servidor. En CAPRI **y hoy también en el centro de mando** (drogheda.helgen.online).
4. **Material equivocado o dañado:** quien recibe o quien pidió reporta un problema con comentario y foto → devolución
   `DEV-AAAA-NNNN` → correo a compras → compras resuelve.

Reglas de siempre (CLAUDE.md §7): español de México, el servidor revisa permisos, `textoCelda` en Sheets, archivos privados con
`privado_`, nunca montos a quien pide o recibe ni al centro de mando, nada de HTTP ni correos dentro de `conCandado_`, toda
función que escribe declara sus colecciones (`cambios` del módulo).

## Módulos y dueños

| Módulo | Code.js | Interfaz | Toca además |
|---|---|---|---|
| **F · Proveedores y forma de pago** | §6.F (`modProveedores_()`) | `<script id="mod-proveedores">`, subvista "Proveedores" en Compras, campo "Forma de pago" en la orden/propuesta, métodos del pago | `HOJAS_COMPRAS.Proveedores` y `OrdenesCompra` (columnas al final), `normalizarOrdenCompra`, `normalizarPropuesta`, `emitirOrdenCompra_`, PDF de la orden, `METODOS_PAGO`, `registrarPagoProveedor` (bloqueo), **reglas de "se puede recibir antes de pagar"** (`reqParaSolicitante_`, `vistaRequisicion_`, `cerrarRequisicion`, Pendientes) |
| **H · Recepción con fotos y devoluciones** | §6.H (`modRecepcion_()`) | `<script id="mod-recepcion">`, foto por renglón en "Registrar lo que llegó" / "Recibí el material" / "Lo recogí", "Reportar problema", lista y resolución de devoluciones en Compras | `registrarRecepcion`, `cerrarRequisicion` (foto y bloqueo con devolución abierta), `marcarEnCamino` (foto en "Lo recogí"), `traerRecepcionesPortal`/`aplicarRecepcionPortal_` (fotos y problemas del centro de mando), `avisarPortal_` + `cuerpoEventoPortal` (evento `oc.devolucion`), `EVENTOS_CORREO`/`destinatariosAviso`/`contenidoAviso` (eventos nuevos) |
| **I · Centro de mando** (repo `hbox-docs`, Flask + MkDocs) | `backend/compras.py` (+ lo mínimo de `app.py`) | `docs/tableros/compras.js/.md/.css` (y la "Recibir" del inventario si recibe envíos de compras) | `DESPLIEGUE.md`, `docs/inventario/flujo-compras-28oct.md`, pruebas `backend/tests-1029.sh` |

Base común: rama `incremento-5-base` = `99ab8e4` (lo publicado como API @13) + este archivo. Cada módulo de CAPRI en su rama
`incremento-5-<f|h>`; sus pruebas nuevas en `tests/proveedores.test.js` y `tests/recepcion.test.js` (arnés `tests/arnes.js`);
`bash tests/todas.sh` en verde al terminar. Notas para CLAUDE.md en `docs/incremento-5-<modulo>.md`.

## 1. Forma de pago (F)

- `FORMAS_PAGO_OC = ['Transferencia', 'Crédito del proveedor', 'Tarjeta de crédito', 'Tarjeta de débito (en sitio)', 'Efectivo', 'Cheque']`.
  Columna nueva `forma_pago` al final de `OrdenesCompra` (se busca por nombre, como `colOc_`). Obligatoria en orden y propuesta
  nuevas; las viejas se leen como `Transferencia` si `dias_credito` = 0 y `Crédito del proveedor` si > 0. Va en el PDF de la orden
  ("Forma de pago") y en las vistas de compras/aprobaciones (nunca a quien pide: no es un monto, pero se queda en compras).
- `Crédito del proveedor` exige días de crédito ≥ 1; las demás aceptan 0 (contado). `condiciones_pago` sigue como texto libre.
- **Crédito del proveedor = se puede recibir antes de pagar** también en el flujo de siempre: quien recibe confirma con la orden
  Emitida (Autorizada → Recibida, ya existe la transición `recibir`), y la requisición queda Recibida hasta que se pague
  (→ Cerrada). Pendientes y botones siguen esa regla (helper único `recibeAntesDePagar_(orden)` en §6.F; H lo usa).
- `METODOS_PAGO = ['Transferencia', 'Tarjeta de crédito', 'Tarjeta de débito', 'Efectivo', 'Cheque']` (registrar el pago real).
  Referencia: obligatoria salvo efectivo; con tarjeta es el número de autorización o del ticket. **Nunca** se pide ni se guarda el
  número de una tarjeta (si la referencia parece uno — 13 a 19 dígitos seguidos — se rechaza).

## 2. Proveedores (F)

- `Proveedores` (columnas nuevas al final; las de hoy no se mueven): `direccion`, `banco`, `clabe` (18 dígitos con dígito
  verificador), `cuenta`, `titular`, `forma_pago_habitual`, `dias_credito_habituales`, `csf_id`, `csf_url`, `csf_fecha`,
  `caratula_id`, `caratula_url`, `caratula_fecha`, `domicilio_id`, `domicilio_url`, `domicilio_fecha`, `notas`, `activo`,
  `actualizo`. Documentos (PDF o imagen, ≤ 10 MB) en `Compras/Proveedores/<RFC o SIN-RFC> — <razón social>/` (privado_), nombre
  `<RFC> — CSF.pdf`, `… — Carátula bancaria.pdf`, `… — Comprobante de domicilio.pdf` (con "(2)" si se reemplaza; el anterior se
  conserva).
- Solo compras (y super admin) ve y edita. API: `listarProveedores(filtro)`, `getProveedor(id)`, `guardarProveedor(p)`,
  `subirDocumentoProveedor(id, tipo, archivo)` (tipo `csf` · `caratula` · `domicilio`).
- **Cambiar banco/CLABE/cuenta** exige subir una carátula nueva en el mismo guardado; queda en la Bitácora de compras y manda el
  correo `proveedor.banco` a compras (sin la CLABE completa: últimos 4).
- Avisos (no bloquean): comprobante de domicilio con más de 3 meses; CSF con más de 12 meses; falta algún documento.
- Orden de compra / propuesta: si al proveedor le falta un documento, la respuesta trae `avisoProveedor` y la interfaz lo muestra.
- `registrarPagoProveedor`: sin CSF **y** carátula → error `PERMISO` "Falta …" + `textoExcepcion_()`; super admin con
  `motivoExcepcion` (último parámetro) → `excepcionSuperAdmin_('pagar a un proveedor sin documentos', …)`. Con transferencia, la
  vista del pago muestra banco y CLABE de la carátula para copiarla.

## 3. Fotos de recepción (H en CAPRI, I en el centro de mando)

- **Una foto por renglón recibido** (cantidad > 0) en: "Registrar lo que llegó" (por renglón), "Recibí el material" (flujo de
  siempre: una por renglón de la orden), "Lo recogí" (una por renglón) y la recepción de respaldo de compras. Obligatoria.
- En el navegador: `comprimirFoto(file) → {nombre, datos (base64 sin prefijo), mime: 'image/jpeg'}`: lado mayor 1600 px,
  JPEG calidad 0.72 (canvas); HEIC del iPhone: el `<input accept="image/*" capture="environment">` ya entrega JPEG en Safari.
- CAPRI guarda en `Compras/AAAA/<proyecto>/Recepciones/<REC-folio o REQ-folio> — r<n>.jpg` con `privado_`. Columna/hoja:
  `MovimientosInventario` gana `foto_id`, `foto_url` (al final, por nombre). La vista de compras y la de quien pidió muestran
  "Ver foto" (liga de Drive; quien pidió puede abrirla si tiene acceso a la carpeta: si no, la vista de quien pidió no la muestra).
- **Centro de mando** (proyectos ligados): su "Recibir" exige foto por renglón, comprimida igual. La guarda **temporalmente** en
  el servidor y CAPRI se la lleva a Drive en la siguiente consulta; después el servidor la borra (ver §5).

## 4. Devoluciones `DEV-AAAA-NNNN` (H)

- Hoja nueva `Devoluciones` (libro de compras): `folio`, `fecha`, `req_folio`, `oc_folio`, `proyecto_folio`, `renglon`,
  `descripcion`, `cantidad`, `tipo` (Incorrecto · Dañado · Faltante · Sobrante · Otro), `comentario`, `foto_id`, `foto_url`,
  `origen` (CAPRI · Centro de mando), `reporto_email`, `estado` (Abierta · Resuelta), `resolucion`, `nota_resolucion`,
  `guia_devolucion`, `resolvio_email`, `fecha_resolucion`. Consecutivo `CONSECUTIVO_DEV_AAAA`.
- Quién reporta: quien pidió, quien recibe o compras; desde la recepción (al mismo tiempo) o después, sobre un renglón ya recibido
  (requisición Recibida o Cerrada hace ≤ 30 días). Comentario obligatorio; foto obligatoria salvo tipo Faltante.
- Quién resuelve: compras (o super admin). Resoluciones y efecto:
  - **Reponer** — el proveedor manda otra vez: se descuenta lo recibido de ese renglón (movimiento negativo "Devolución DEV-…" en
    `MovimientosInventario`) y el renglón vuelve a "por recibir"; la requisición regresa a Autorizada/Pagada/En camino según su
    orden.
  - **Devolver al proveedor** (con nota de crédito o reembolso: texto + guía opcional) — se descuenta lo recibido; el renglón queda
    cerrado con faltante aceptado.
  - **Cancelar renglón** — igual que devolver, sin trámite con el proveedor (p. ej. sobrante que se queda en tránsito).
  - **Conservar** — se acepta como llegó; nada cambia.
- Mientras haya una devolución Abierta, la requisición **no se cierra** (ni quien pidió ni compras ni el centro de mando).
- Correos: `dev.reportada` → compras (y quien pidió, si reportó otra persona); `dev.resuelta` → quien reportó, quien pidió y quien
  recibe. Sin montos ni proveedor ni folio de orden (reglas de B). Pendientes: devoluciones abiertas para compras.
- API (nombres fijos): `reportarProblema(reqFolio, d)` (d = {renglon, cantidad, tipo, comentario, foto, idSolicitud}),
  `listarDevoluciones(filtro)`, `resolverDevolucion(folio, d)` (d = {resolucion, nota, guia, idSolicitud}).

## 5. Contrato con el centro de mando (H del lado de CAPRI, I del lado del servidor)

Firmas como hoy: `X-Hbox-Tiempo` + `X-Hbox-Firma: sha256=hex(HMAC(secreto, tiempo + "\n" + cuerpo))`, ventana 5 min; GET con
cuerpo vacío. Sin secreto: 503 y todo sigue igual.

**a) Recepciones con foto y problema.** `GET /api/integracion/cotizador/recepciones?desde=` agrega en cada renglón:

```json
{"n": 1, "pedido": 80, "recibido": 80,
 "foto": {"id": "OC-2026-0012-r1-20261029T1131", "archivada": false, "url": ""},
 "problema": {"tipo": "Dañado", "comentario": "Rollo aplastado", "cantidad": 10, "por": "miguel",
              "foto": {"id": "OC-2026-0012-r1-p-20261029T1132", "archivada": false, "url": ""}}}
```

`problema.por` (agregado en la revisión 5b, 29/10/2026): el usuario del sitio que reportó el problema (opcional).

`foto` y `problema` son opcionales (`null` si no hay). `id` solo usa `[A-Za-z0-9._-]`, ≤ 80. Una recepción con un renglón cuya
foto cambió (otra recepción del mismo renglón, o se archivó) vuelve a aparecer en la consulta aunque `recibido_en` sea anterior a
`desde` (el servidor usa `actualizado_en` del renglón).

**b) Llevarse la foto a la nube.**
- `GET /api/integracion/cotizador/foto?id=<id>` (firmado) → `200` con los bytes (`Content-Type: image/jpeg`), `404` si no existe
  o ya se archivó.
- `POST /api/integracion/cotizador/foto-archivada` (firmado) cuerpo `{"id": "...", "url": "https://drive.google.com/…"}` → el
  servidor guarda la `url`, marca `archivada: true` y **borra el archivo local**. Idempotente.
- CAPRI (en `traerRecepcionesPortal`, fuera del candado): por cada foto no archivada la baja, la guarda en Drive (misma carpeta de
  §3) con `privado_`, anota `foto_id`/`foto_url` en su movimiento o devolución y manda el aviso de archivada. Si algo falla, se
  reintenta en la siguiente consulta (no bloquea el cierre de la requisición ni avanza mal `PORTAL_ULTIMA_CONSULTA`: la foto se
  vuelve a ofrecer hasta archivarse).

**c) Problema reportado en el sitio.** Un renglón con `problema` → CAPRI crea su `DEV` con `origen = Centro de mando`,
`reporto_email` = `problema.por` (revisión 5b; si no viene, `recibio`, o `centro de mando`) — una sola vez por (OC, renglón, foto
del problema o comentario: `por` no cuenta para la llave).

**d) Aviso nuevo CAPRI → centro de mando: `oc.devolucion`** (al resolver una devolución de un proyecto ligado; `evento_id`
`<OC>:oc.devolucion:<n>` como los demás):

```json
{"evento_id": "OC-2026-0012:oc.devolucion:1", "tipo": "oc.devolucion", "oc": {"folio": "OC-2026-0012", "...": "lo de siempre, sin montos"},
 "devolucion": {"folio": "DEV-2026-0003", "renglon": 1, "cantidad": 10, "tipo": "Dañado",
                "resolucion": "Reponer|Devolver al proveedor|Cancelar renglón|Conservar", "nota": "…", "origen": "centro|capri"}}
```

`devolucion.origen` (agregado en la revisión 5b, 29/10/2026): `"centro"` si la devolución nació de un problema reportado en el sitio
(la DEV tiene `origen_clave`), `"capri"` si se reportó en CAPRI. Sin `origen` = `"centro"` (lo de antes). El servidor trata un
**Faltante con origen `"capri"`** como material que **sale** del stock del sitio (se contó como recibido, como un Dañado); un
Faltante del sitio no mueve existencias (allá nunca entró).

Efecto en el centro de mando: `Reponer` → sale del stock del sitio lo devuelto (movimiento `devolucion`) y el renglón vuelve a
"en camino" por esa cantidad (pendiente de la OC reabierto); `Devolver al proveedor` / `Cancelar renglón` → sale del stock y el
renglón queda cerrado con faltante; `Conservar` → nada. Idempotente por `evento_id`. Nunca montos.
