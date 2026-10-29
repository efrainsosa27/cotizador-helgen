# Incremento 4 (CAPRI) · Módulo C: centro de mando (drogheda.helgen.online)

Spec: sección "Inventory: drogheda.helgen.online, fed by CAPRI" y puntos de aprobación 7, 10 y 11. Decisiones de Leo del 27 y
28/10/2026: el centro de mando **es el inventario** (ítems, existencias por sitio, material en tránsito, kits, salidas y conteos);
CAPRI conserva el dinero, las aprobaciones y qué, cuánto y a qué sitio; el centro de mando **nunca recibe montos**; en los
proyectos ligados el material se recibe en el sitio, en el centro de mando, por su usuario asignado, renglón por renglón desde el
teléfono; CAPRI cierra sola la requisición cuando el centro de mando reporta que llegó todo. Solo los proyectos ligados hablan con
el centro de mando (hoy DROGHEDA = `PRY-2026-0002`). Quien recibe (`recibe_email`, lo elige compras en la propuesta) marca "Lo
recogí" desde su teléfono cuando recoge en tienda, y eso lo pone en tránsito en ese sitio.

**Interruptor:** sin `PORTAL_URL` (https) y `PORTAL_SECRETO` en Script Properties todo esto está apagado: nadie llama al centro
de mando, no se forman avisos, ningún proyecto cuenta como ligado y CAPRI funciona como antes (también el estado En camino, que
sirve para todos los proyectos).

## Script Properties

| Propiedad | Para qué |
|---|---|
| `PORTAL_URL` | `https://drogheda.helgen.online` (con https; la diagonal final se quita sola) |
| `PORTAL_SECRETO` | Secreto compartido (el mismo que `COTIZADOR_SECRETO` en el servidor). **Nunca** en el código, el registro ni el chat |
| `PORTAL_PROYECTOS` | JSON llave interna → proyecto del centro de mando: `{"PRY-2026-0002": "drogheda"}` (acepta también `PRY-2026-0002-DRO`) |
| `PORTAL_PRUEBA` | `1` = todos los avisos van con `"prueba": true` (ronda de prueba). Vacía o sin crear = avisos reales |
| `PORTAL_ULTIMA_CONSULTA` | La escribe CAPRI: el `hasta` que contestó el centro de mando en la última consulta de recepciones que salió bien |
| `PORTAL_ULTIMO_OK`, `PORTAL_ERROR_CONSULTA` | Las escribe CAPRI: cuándo salió bien la última consulta y el error de la última que falló (se borra al salir bien) |

## Hojas y columnas (libro de compras; se migran solas)

- `OrdenesCompra`: al final `paqueteria`, `guia`, `fecha_estimada`, `en_camino_en`, `en_camino_por` (columnas AK:AO; el código
  las busca por nombre con `colOc_`, así no depende de su posición si otro módulo agrega columnas).
- `RequisicionesRenglones`: al final `inventario_item` (H). Solo se escribe si el renglón tiene ítem (las filas sin ítem quedan
  como antes).
- `PortalPendientes` (nueva): `evento_id`, `cuerpo` (JSON en ASCII), `intentos`, `ultimo_error`, `creado`, `estado` (Pendiente /
  Enviado), `enviado`. Nunca se borran filas.
- Los renglones de la propuesta (JSON) y de la orden (`renglones (JSON)`) llevan `item` cuando lo tienen.
- `MovimientosInventario`: las recepciones que trae el centro de mando se copian como "Entrada por compra" con correo
  `centro de mando` (ver decisiones).

## Funciones (Code.js §6.C salvo que se diga otra cosa)

**API** (en `modCentroMando_`; `solo` = también cuentas de solo requisiciones):

| Función | Quién | Qué hace |
|---|---|---|
| `marcarEnCamino(folio, {paqueteria, guia, fechaEstimada, traeProveedor, recogido, idSolicitud})` *(solo; cambia requisiciones y oc)* | Envío: compras o quien pidió. "Lo recogí" (`recogido: true`): quien recibe o quien pidió | Desde Autorizada, Pagada o En camino (otra vez = corregir). Guía obligatoria salvo "lo trae el proveedor"; fecha estimada no anterior a hoy. "Lo recogí": paquetería "Recogido por <nombre>", sin guía, fecha hoy. Guarda las 5 columnas en la orden, nota en el historial, Bitacora, aviso `oc.en_camino` y `notificar_('req.encamino', {folio, req, nota, sitio, paqueteria, guia, fechaEstimada, recogido, para: [quien pidió, quien recibe]})`. Candado e idempotencia (`ENC_<id>`) |
| `misArticulos()` *(solo)* | Requisiciones | Descripciones que la persona ya pidió, la más pedida primero, con su unidad y su último ítem (`[{descripcion, unidad, item, veces}]`, máx. 100). Caché por persona y versión de requisiciones |
| `itemsInventario()` *(solo)* | Requisiciones, compras o aprobaciones | `{activo, items: [{codigo, descripcion, unidad, categoria}], actualizado}` del centro de mando (GET firmado), en caché 6 h |
| `estadoCentroMando()` | Compras o super admin | Solo lee: encendido, servidor, proyectos ligados, avisos pendientes (el más antiguo y su error), enviados, última consulta buena, error de la última consulta, si el activador está instalado. Nunca el secreto |
| `consultarCentroMando()` *(cambia requisiciones y oc)* | Compras o super admin | "Consultar ahora": reintenta avisos y trae recepciones sin esperar al activador |

**Sin sesión / editor:** `cadaQuinceMinutos()` (activador), `traerRecepcionesPortal()`, `instalarActivadorPortal()`,
`probarCentroMando()` (prueba del enlace desde el editor), y `preparar()` del módulo (lo corre `prepararCapri`).

**Internas:** `configPortal_`, `proyectoLigado_(proyectoFolio)` (única definición de "proyecto ligado": su llave está en
`PORTAL_PROYECTOS` **y** la función está encendida; la usa también Pendientes, módulo D), `centroDeReq_`, `sitioConCodigo_`,
`exigirNoLigado_`, `firmaCentro_` (parte de la clave de caché de "mis requisiciones"), `isoConZona_`, `firmaPortal_`,
`llamarPortal_`, `enviarEventoPortal_`, `avisarPortal_(tipo, folioOc)` (la de la base, ya implementada), `conAvisoPortal_(resultado)`,
`enviarPendientesPortal_`, `aplicarRecepcionPortal_`, `comoCentroMando_`, `calentarCache_`, `itemsInventario_`,
`misArticulosDeHojas_`, `migrarSitiosConCodigo_`, `estadoCentroMando_`, `reqParaAviso_`, `anuladoCentro_`.

**Lógica pura (probada en Node):** `cuerpoEventoPortal`, `buscarMontos`, `hexDeBytes`, `jsonAscii`, `normalizarEnCamino`,
`textoEnCamino`, `esRecogido`, `itemInventario`, `normalizarItemsPortal`, `articulosFrecuentes`, `sitiosConCodigoTexto`,
`fechaCortaEs`.

**Cambios en §4 (base):** `HOJAS_COMPRAS`, `ordenDesdeFila_`, `renglonesDeReqs_` / `escribirRenglonesReq_` (ítem),
`reqParaSolicitante_` (+ `centroMando`, `enCamino`, `puedeEnCamino`, `puedeRecoger`; sin "Registrar lo que llegó" ni "Recibí el
material" en proyectos ligados), `misRequisiciones` (clave de caché), `guardarRequisicion` (sitio con código en ligados),
`cerrarRequisicion` (no en ligados), `cerrarReq_`, `vistaRequisicion_` (+ `centroMando`, `puedeEnCamino`; pago, cancelar pago,
cerrar y recibir también En camino), `autorizarRequisicion`, `cotizarRequisicion`, `autorizarPropuesta` (sitio con código y aviso),
`registrarPagoProveedor`, `cancelarPagoProveedor`, `cerrarRequisicionCompras`, `cancelarOrdenCompra(folio, motivo, confirmado)`,
`registrarRecepcion`, `cancelarRecepcion`, `vistaOperaciones_`, `TRANSICIONES_REQ`, `normalizarRequisicion`,
`renglonesAprobados`, `normalizarPropuesta`, `ordenDePropuesta`, `normalizarOrdenCompra` (ítem).

## El contrato (lo que espera el centro de mando)

- Firma de cada llamada: `X-Hbox-Tiempo: 2026-10-28T10:15:00-06:00` y `X-Hbox-Firma: sha256=<hex de HMAC-SHA256(secreto,
  tiempo + "\n" + cuerpo)>` (en los GET el cuerpo es vacío). Apps Script da bytes con signo: `hexDeBytes` los convierte. El cuerpo
  va en JSON **ASCII** (`jsonAscii`: acentos como `á`), así la firma no depende de cómo se codifique el envío. El servidor
  rechaza firmas de más de 5 minutos (401) y sin secreto contesta 503.
- `POST /api/integracion/cotizador/evento`: `{evento_id: "<folio OC>:<tipo>:<n>", tipo, cuando, quien, prueba, oc: {folio,
  req_folio, proyecto_folio (PRY-AAAA-NNNN), proyecto_clave (el proyecto del centro de mando, p. ej. "drogheda"), sitio (VER, ZLO,
  ESE, LZC o QRO), proveedor, fecha_entrega, paqueteria, guia, solicitante, autorizo, renglones: [{n, descripcion, unidad, cantidad,
  item|null}]}}`. Nunca montos (`buscarMontos` lo revisa antes de guardar el aviso). `n` = número de renglón de la orden (así
  regresan las recepciones); no van los renglones que no se reciben en sitio (adicionales como fletes). `fecha_entrega` = la fecha
  estimada del envío si ya hay, si no la de la orden. `solicitante` = correo de quien pidió; `autorizo` = correo del visto bueno
  (con operaciones) o de compras que autorizó (flujo de siempre). Descripciones de máximo 200 caracteres.
- `GET /api/integracion/inventario/items` → `{ok, items}` (firmado también).
- `GET /api/integracion/cotizador/recepciones?desde=<ISO>` → `{ok, hasta, recepciones: [{oc_folio, req_folio, sitio, completa,
  recibio, cuando, renglones: [{n, pedido, recibido}]}]}`.

## Avisos: cuándo, cómo y reintentos

| Aviso | Cuándo |
|---|---|
| `oc.autorizada` | `autorizarRequisicion` (flujo de siempre) y `autorizarPropuesta` (visto bueno de operaciones) |
| `oc.pagada` | `registrarPagoProveedor` |
| `oc.en_camino` | `marcarEnCamino` (envío, "Lo recogí" y cada corrección) |
| `oc.cancelada` | `cancelarOrdenCompra` (y el módulo de anular: llama `avisarPortal_('oc.cancelada', folioOc)`) |
| `req.cerrada` | `cerrarRequisicionCompras` en un proyecto ligado, y la recepción de respaldo completa de compras (`registrarRecepcion`) |

1. Dentro del candado, después de guardar, `avisarPortal_` forma el aviso con lo que hay en la hoja y lo escribe en
   `PortalPendientes` como **Pendiente** (bandeja de salida: aunque la petición se corte, no se pierde). `n` = cuántas filas de esa
   orden y tipo hay + 1, así cada evento tiene un `evento_id` estable y el reintento del mismo evento nunca duplica.
2. Ya fuera del candado, `conAvisoPortal_` lo manda (no se detiene a otros mientras el centro de mando contesta). Si contesta
   200 `{ok: true}` (o `repetido: true`) queda **Enviado**. Si no (500, 400, 401, sin respuesta), sigue Pendiente con `intentos` y
   `ultimo_error`, y lo que la persona hizo **ya quedó guardado**: el resultado lleva `avisoPortal = "Guardado. El centro de mando se
   actualizará en unos minutos."` (también dentro de `vista`) y la interfaz lo agrega al mensaje.
3. El activador de 15 minutos reintenta los Pendientes **en el orden en que se formaron** y, por orden de compra, se detiene en el
   primero que falle: el centro de mando nunca recibe un pago o un envío antes que su autorización. Hasta 60 envíos por corrida.
4. Quien llame `avisarPortal_` sin `conAvisoPortal_` (el módulo de anular, por ejemplo) no pierde nada: el activador lo manda en
   ≤ 15 min. Si quiere mandarlo en el momento: `return conAvisoPortal_(conCandado_(() => { …; avisarPortal_(…); … }))`.
5. Lo anulado (módulo E, `esAnulado_`) ya no se avisa, salvo el propio `oc.cancelada`; si `esAnulado_` no existe, nada cuenta
   como anulado.

## Estados (En camino)

`REQ_EN_CAMINO = 'En camino'` se guarda tal cual en la columna estado. Nuevas transiciones / ampliadas en `TRANSICIONES_REQ`:

| Acción | De | A |
|---|---|---|
| `enCamino` | Autorizada, Pagada, En camino (corregir) | En camino |
| `pagarEnCamino` | En camino | En camino (la orden queda Pagada) |
| `cancelarPagoEnCamino` | En camino | En camino (la orden vuelve a Emitida) |
| `recibir` | Autorizada, **En camino** (sin pagar) | Recibida (espera el pago; `pagarRecibida` la cierra) |
| `recibirPagada` | Pagada, **En camino** (pagada) | Cerrada (la orden queda Recibida) |
| `cerrarEnCamino` | En camino (solo con la orden pagada) | Cerrada ("Recibí el material" o cierre de compras) |
| `cancelarOc` / `cancelarOcAprobada` | Autorizada, **En camino** | Solicitada / Aprobada |
| `cancelarRecepcionEnCamino` | Recibida (si la orden ya iba en camino) | En camino |

Cancelar una orden **En camino** (sin pagar; pagada no se cancela, como siempre): motivo de al menos 10 caracteres y
confirmación (`cancelarOrdenCompra(folio, motivo, true)`; sin ella devuelve `{confirmar, mensaje}` y no cambia nada); avisa
`oc.cancelada` y el centro de mando quita lo que está en tránsito. Quien pidió ve en su historial "Enviado por DHL · guía 123 ·
llega aprox. el 02/11/2026" (o "Recogido por …"), nunca montos ni proveedor.

## Recepciones del centro de mando (`traerRecepcionesPortal`, cada 15 minutos)

- Consulta desde `PORTAL_ULTIMA_CONSULTA` (la primera vez, 30 días atrás); la propiedad solo avanza (al `hasta` del centro de
  mando) si **todo** salió bien; si algo falló, la siguiente corrida vuelve a pedir lo mismo (sin duplicar, ver abajo).
- **Completa** → cierra sola como el centro de mando: Cerrada y la orden Recibida si estaba pagada; si no, Recibida (la orden sigue
  Emitida con fecha y quién recibió) y el pago la cierra. Nota en el historial y en `notas_recepcion`: "Recibido en ZLO por jesush
  en el centro de mando, 30-oct-2026"; Bitacora "Recepción del centro de mando" con correo `centro de mando`; aviso
  `notificar_('req.recibida', {folio, req, nota, sitio, centroMando: true})` (el activador manda los correos al final).
- **Parcial** → nota "Recepción parcial en ZLO por jesush en el centro de mando, 30-oct-2026: 50 M Cable…" y el estado no cambia
  (p. ej. sigue En camino).
- **Ya cerrada, cancelada, anulada o repetida** → nada (queda en `ignoradas` del resultado).
- Sube la versión de requisiciones y órdenes para que los navegadores abiertos se enteren.

**Decisión: sí se escriben filas en `MovimientosInventario`** ("Entrada por compra", folio REC, correo `centro de mando`, nombre
"jesush (centro de mando)", sitio = el nombre del sitio del código). Es la bitácora de recepciones de CAPRI, **no** existencias
(CAPRI no lleva inventario, punto 7): sirve para que compras, operaciones y quien pidió vean el avance por renglón (pedido / llegó /
falta) y para que una orden con material recibido no se pueda cancelar sin cancelar antes la recepción. Se copia **solo la
diferencia** entre lo que el centro de mando dice que llegó (acumulado por renglón, tope = lo pedido) y lo que CAPRI ya tiene: una
recepción repetida no duplica nada y lo que compras registró como respaldo no se cuenta dos veces.

## Recepción en CAPRI para proyectos ligados (punto 7)

- Quien pide o recibe ya no ve "Registrar lo que llegó" ni "Recibí el material": ve "Se recibe en el centro de mando (ZLO ·
  Manzanillo (TIMSA))", el envío y los botones "Registrar envío (en camino)" / "Lo recogí". El servidor también lo rechaza.
- Compras conserva la recepción por renglón (con operaciones) y el cierre (flujo de siempre) como **respaldo** cuando el centro de
  mando no funciona: motivo/notas obligatorios, rotulado así en la pantalla, y "no llega al inventario del sitio" (el sitio lo
  registra allá a mano). Al completarse manda `req.cerrada`.
- Proyectos sin ligar: todo como antes (también pueden ir En camino).

## Sitios con código e ítems

- Config → `SITIOS` en el formato `VER | Veracruz (ICAVE) | dirección`. `preparar()` convierte un `SITIOS` de solo nombres si
  todos tienen código conocido (si no, no toca nada y lo dice en el registro). Las requisiciones siguen guardando el **nombre**;
  los avisos llevan el código (`codigoDeSitio` con `sitiosDetalle_()`). Las listas muestran "ZLO · Manzanillo (TIMSA)".
- Proyecto ligado: sitio **obligatorio y con código** al pedir, al reenviar, al cotizar y al autorizar (un sitio sin código —p. ej.
  "Monterrey" sin `MTY |`— se rechaza con un mensaje para corregir Config). Sin ligar, como antes (opcional en el flujo de siempre).
- Ítem por renglón (opcional; sin ítem el centro de mando lo muestra "por ligar"): código sin espacios ni comillas, máximo 40. Lo
  elige quien pide (lista del centro de mando o "lo que ya pediste") y compras en la propuesta o la orden; el exacto conserva el de
  quien pidió, el sustituto lleva el que elija compras; separar renglones lo conserva.

## Activador y caché caliente

`cadaQuinceMinutos()` (sin sesión; limpia `MEMO_`, `VERSIONES_` y `VENDEDOR_` al empezar): 1) reintenta avisos, 2) trae
recepciones, 3) `calentarCache_`: fuentes (Config, proyectos, catálogo, clientes, contratos), ítems (los vuelve a pedir si tienen
más de 1 h), y las listas pesadas que la carga inicial solo manda si ya están en caché — `listarRequisiciones('', '')` y
`cuentasPorPagar()` (como la primera persona con compras), `listarOperaciones()` (aprobaciones), `resumenCobranzaGeneral()`
(cobranza), `listarProyectos` (ventas) y, por cada persona con requisiciones, `misRequisiciones()` y `misArticulos()`. Se corre
"como" esa persona solo para que pasen los mismos permisos de siempre; solo lee, lo ya en caché no se vuelve a armar y se detiene a
los 2 minutos. 4) Manda los correos que quedaron en la cola (`enviarCorreosPendientes_`).

`instalarActivadorPortal()` crea el activador una sola vez (`everyMinutes(15)`) y quita repetidos; lo corre `preparar()` desde
`prepararCapri()`, que también autoriza el permiso nuevo (`script.scriptapp`; el manifiesto no declara scopes, Apps Script lo
detecta solo).

## Interfaz (`web/cotizador/index.html`)

- `<script id="mod-centro">`: ítems (`#centroItems`), columna de ítem (`.col-item`, oculta con `.sin-item` salvo en proyectos
  ligados), nota `#reqCentro`, "lo que ya pediste" en `#reqCatalogo`, tarjeta `#cmCaja-<folio>` en Mis requisiciones (dónde se
  recibe, envío, "Registrar envío" con formulario y "Lo recogí"), `#rcCentro` en la requisición de Compras (proyecto ligado, envío,
  aviso de respaldo, "Registrar envío"), rótulos de respaldo en `#rcCierreTitulo` / `#rcCierreNota` y en el botón de recepción,
  mosaico En camino en Aprobaciones y el estado del enlace en `#comCentro` con "Consultar ahora".
- Cambios chicos en el script principal: `MIS_ARTICULOS`, `REQ_LIGADO`, `ITEMS_REQ`, `ITEMS_OC`, `etiquetaSitio`, `extraPortal`,
  estado "En camino" (chip y filtro de Compras), sitio obligatorio en ligados, ítem en renglones de requisición y de la orden, y los
  eventos genéricos `alFormReq`, `alReqEnviada`, `alMisReq`, `alVistaReqCom`, `alVistaOps` (cualquier módulo puede usarlos).
  Cancelar una orden en camino pide confirmar (`window.confirm`) y vuelve a llamar con `true`.

## Publicación (Efrain y Leo)

1. Respaldos del libro de compras (como siempre). `clasp push`.
2. Efrain corre `prepararCapri()` desde el editor: pide el permiso del activador; `preparar()` de este módulo convierte `SITIOS`,
   crea `PortalPendientes` e instala `cadaQuinceMinutos`. **Antes de `clasp deploy`.**
3. `clasp deploy` y `wrangler deploy` (como dice el spec). Hasta aquí la función sigue **apagada** (sin secreto).
4. Leo genera el secreto: `openssl rand -hex 32`. Lo pone en los dos lados: `PORTAL_SECRETO` (Script Properties de CAPRI) y
   `COTIZADOR_SECRETO` (servidor del centro de mando). Agrega `PORTAL_URL = https://drogheda.helgen.online` y
   `PORTAL_PROYECTOS = {"PRY-2026-0002": "drogheda"}`. No se pega en el chat ni en el repositorio.
5. Prueba del enlace: correr `probarCentroMando()` desde el editor (lee ítems y recepciones y manda un aviso inventado con
   `"prueba": true`; muestra lo que contestó, nunca el secreto).
6. Ronda de prueba: `PORTAL_PRUEBA = 1`, una requisición de prueba en DROGHEDA hasta la orden, envío, "Lo recogí" y recepción en el
   centro de mando; revisar en Compras el estado del enlace y en la requisición que se cerró sola. Al terminar, borrar
   `PORTAL_PRUEBA` y marcar los folios de prueba (§5 de CLAUDE.md). Si hace falta apagar todo: borrar `PORTAL_SECRETO`.

## Pendiente / preguntas

- Se supone que `recibido` de cada renglón en las recepciones es **acumulado** (lo que ha llegado de ese renglón hasta ese
  momento). Si el centro de mando manda solo lo de esa recepción, el cierre sigue funcionando (usa `completa`), pero el avance que
  muestra CAPRI se quedaría corto: confirmar con el código del servidor.
- `proyecto_clave` se manda con el valor de `PORTAL_PROYECTOS` ("drogheda"), no con la clave de 3 letras de CAPRI ("DRO"):
  confirmar que es lo que espera el centro de mando.
- `solicitante` y `autorizo` van como correo (no nombre).
- Avisos con error que no se arregla solo (p. ej. 400 por un sitio que el centro de mando no conoce) se reintentan cada 15 minutos
  sin límite y bloquean los siguientes de esa misma orden; se ven en el estado de Compras. No hay botón para descartarlos: si hace
  falta, cambiar su `estado` a mano en `PortalPendientes`.
- `cancelarPagoProveedor` no avisa al centro de mando (el contrato no tiene ese tipo; al centro de mando no le importa el dinero).
- No hay existencias por sitio en CAPRI ("En almacén ZLO: 12 PZA" queda para cuando el centro de mando las mande en su lista de
  ítems).
- Pasar a CLAUDE.md (§4, §5, §6, §9) y al Manual al integrar.
