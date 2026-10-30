# Incremento 7 (CAPRI) · Módulo G: gastos por proyecto

Rama `incremento-7-gastos` (sobre `incremento-7-base`). Contrato: `docs/incremento-7.md` §0 (puntos compartidos), §1 (función pura para el
margen), §2 "G · Gastos" y §3. Spec aprobado por Leo ("CAPRI — what's missing: spec for increments 6–8", decisiones 8 y 11). Este archivo
es para integrar: al hacer el merge se pasa lo necesario a `CLAUDE.md` (§1, §4.11 nueva, §5, §6.18, §9) y al Manual (Compras,
Requisiciones, Tareas frecuentes, Reglas de oro, Historial, Pendientes).

## 1. Qué hace

1. **Capturar un gasto** (pestaña **Gastos**, en el grupo Compras junto a Requisiciones; pensada para el teléfono). Quien tiene
   Requisiciones —también `Solo requisiciones` y las cuentas `@helgen.services`— captura **sus** gastos: proyecto (Activo o Cerrado; no
   Cancelado ni anulado), fecha (no futura), categoría (`Viáticos · Combustible · Hospedaje · Casetas · Herramientas · Otros`), concepto,
   monto pagado, moneda MXN/USD (tipo de cambio obligatorio si no es la del proyecto), "¿el monto incluye IVA?" Sí/No, **foto o PDF del
   ticket obligatorio** (cámara del teléfono con `capture="environment"`, o un archivo; la foto se reduce con `comprimirFoto` de
   recepción) y, opcional, el **XML del CFDI**. Folio `GAS-AAAA-NNNN` (`CONSECUTIVO_GAS_AAAA`, bajo el candado).
2. **CFDI opcional** (`leerCfdi` sin cambios): con XML, **moneda, total, subtotal e IVA salen del CFDI** (lo capturado se ignora); el CFDI
   debe ser 4.0, de ingreso (tipo I), con UUID válido y **a nombre del RFC de Helgen** (`Config EMPRESA_RFC`); un UUID ya registrado en
   otro gasto vivo o en una factura de proveedor vigente se rechaza. La interfaz lee el XML para **prellenar** monto, moneda e IVA y
   mostrar emisor y UUID (el servidor lo vuelve a leer y valida).
3. **Estados:** `Enviado → Aprobado | Rechazado (motivo) → Reembolsado`; `Enviado → Cancelado` (quien lo capturó, con motivo); `Anulada`
   (Anular, módulo E). Aprueba o rechaza **Aprobaciones**, nunca lo suyo (un super admin sí, con motivo ≥ 10 → Bitacora de Administración,
   `excepcionSuperAdmin_`); reembolsa **Compras** con fecha, método (Transferencia · Efectivo · Cheque), referencia y **comprobante
   obligatorio**.
4. **Quién ve qué:** quien captura ve solo **"Mis gastos"** (con sus montos, motivo y reembolso); **"Gastos del equipo"** (todos, con filtro
   y totales por moneda) solo Aprobaciones, Compras y super admin. Los archivos se abren sin acceso a Drive (`archivoGasto`, como
   `archivoRequisicion`).
5. **Correos** (`notificar_`, sin montos, proveedor ni el concepto): `gasto.enviado` → Aprobaciones (menos quien lo capturó),
   `gasto.aprobado` y `gasto.rechazado` → quien lo capturó (el motivo solo como "Hay una nota"), `gasto.reembolsar` → Compras. Botón
   `…/cotizador/#gas=GAS-AAAA-NNNN`.
6. **Pendientes:** "Gasto por aprobar" (Aprobaciones; nunca los propios) y "Gasto por reembolsar" (Compras), con monto; abren Gastos
   (destino `gas`) con el filtro de lo que espera; número en la pestaña Gastos (`conteos.gas`).
7. **Anular:** `GAS-` es un folio anulable (solo o en cascada de su proyecto); queda `Anulada`, sus archivos con "ANULADA — " y sale de
   listas, totales, Pendientes y del costo del margen.
8. **Para el margen y los reportes (contrato §1):** `costoGastosPorProyecto(gastos, monedaDeProyecto)` (pura) y `gastosDelLibro_(libro)`.
   El integrador los conecta (ver §6).

## 2. Hojas y Drive (se crean solas)

| Dónde | Qué |
|---|---|
| Libro de compras, pestaña **`Gastos`** (nueva; `HOJAS_COMPRAS.Gastos`, se crea con el libro, con `prepararCompras()`/`prepararCapri()` o con el primer gasto) | `folio`, `fecha`, `fecha_registro`, `proyecto_folio`, `solicitante_email`, `solicitante_nombre`, `categoria`, `concepto`, `moneda`, `iva_incluido` (Sí/No), `subtotal`, `iva`, `total` (lo pagado = lo que se reembolsa), `tipo_cambio` (solo si la moneda no es la del proyecto), `moneda_proyecto` (al capturar), `ticket_id/url`, `xml_id/url`, `uuid`, `rfc_emisor`, `emisor`, `estado`, `motivo` (rechazo), `reviso_email`, `fecha_revision`, `reembolso_fecha/metodo/referencia/id/url/email/registro`, `cancelado_por`, `fecha_cancelacion`, `motivo_cancelacion` (también los usa Anular), `actualizado`, `id_solicitud`, `huella_solicitud`, `reembolso_id_solicitud`, `reembolso_huella`. Nunca se borran filas. Fechas como texto (`textoFecha_`); texto del usuario con `textoCelda`. Columnas leídas por nombre (`colGas_`) |
| Bitacora (compras) | "Registrar gasto", "Aprobar gasto" (motivo = la excepción de super admin, si la hubo), "Rechazar gasto", "Cancelar gasto", "Reembolsar gasto", "Anular gasto" |
| Bitacora (Administración) | "Excepción de super admin: aprobar su propio gasto" / "…rechazar su propio gasto" |
| Drive | `Compras/AAAA/<PRY-AAAA-NNNN>/Gastos/` con `GAS-… — Ticket.<ext>`, `GAS-… — CFDI.xml`, `GAS-… — Reembolso.<ext>` (la extensión real: pdf, jpg, png o heic); todo con `privado_` de arriba abajo |
| Script Properties | `CONSECUTIVO_GAS_AAAA` y `VER_gastos` (se crean solas) |

## 3. Funciones

### Code.js §6.G (al final del archivo)
| Función | Qué hace |
|---|---|
| `modGastos_()` | `api`: `listarGastos`, `guardarGasto`, `cancelarGasto`, `aprobarGasto`, `rechazarGasto`, `reembolsarGasto`, `archivoGasto`. `cambios`: las 5 que escriben → `['gastos']`. `solo`: todas menos `reembolsarGasto` (Aprobaciones se combina con Solo requisiciones; Compras no). `bootstrap`: `gastos` solo si está en caché. `sincronizar`: con `ctx.gastos` y algo de `gastos/proyectos/contratos/anulaciones/permisos`, `r.gastos = listarGastos(ctx.gastosFiltro)`. `preparar`: crea la pestaña |
| `listarGastos(filtro, soloSiHay)` *(API)* | `{hoy, categorias, monedas, metodosReembolso, ivaTasa, puede: {enviar, aprobar, reembolsar, verTodos}, proyectos (para capturar, con su moneda), mios (máx. 200), equipo: {filtro, gastos (máx. 300), total, totales} \| null}`. `filtro = {estado: 'porAprobar' \| 'porReembolsar' \| 'pendientes' \| '' \| <estado>, buscar}`; por omisión, lo pendiente de su rol |
| `guardarGasto(p)` *(API)* | `p = {proyectoFolio, fecha, categoria, concepto, monto, moneda, tipoCambio, ivaIncluido, ticket: {nombre, datos}, xml?: {nombre, datos}, idSolicitud, filtro}` → `{folio, repetido, gasto, datos}`. Revisa todo antes del candado salvo proyecto, moneda del proyecto, UUID repetido e idempotencia |
| `cancelarGasto(folio, motivo, filtro)` *(API)* | Quien lo capturó, Enviado, motivo ≥ 5 |
| `aprobarGasto(folio, filtro, motivoExcepcion)` / `rechazarGasto(folio, motivo, filtro, motivoExcepcion)` *(API)* | Aprobaciones; lo propio solo super admin con motivo (la interfaz usa `accionConExcepcion`, que agrega el motivo al final) |
| `reembolsarGasto(p)` *(API)* | Compras; `p = {folio, fecha, metodo, referencia, comprobante, idSolicitud, filtro}` |
| `archivoGasto(folio, que)` *(API)* | `que` = `ticket` · `xml` · `reembolso` → `{nombre, mime, datos}`. Aprobaciones/Compras/super admin: todos; quien lo capturó: su ticket y su XML |
| `gastosDelLibro_(libro)` | **Para el integrador:** todos los gastos (cualquier estado) del libro |
| `gastosParaPendientes_()` | Enviados y Aprobados (sin anulados) para Pendientes |
| Internas | `baseGastos_` (caché por la versión de `gastos`), `buscarGasto_`, `gastoDesdeFila_`, `filaGasto_`, `actualizarGasto_` (columnas por nombre, juntas las seguidas), `gastoParaVista_` (sin ids de archivos ni idempotencia), `proyectosParaGasto_`, `rolGastos_`, `exigirGastos_`, `exigirAprobarGastos_`, `veGastos_`, `carpetaGastos_`, `huellaGasto_`, `md5Gasto_`, `uuidsUsados_`, `datosCorreoGasto_` |
| Puras | `transicionGasto`, `siNoGasto`, `normalizarGasto`, `validarCfdiGasto`, `normalizarReembolsoGasto`, **`costoGastosPorProyecto`**, `accionesGasto`, `filtrarGastos`, `totalesGastos`, `itemsGastoPendientes`, `datosAvisoGasto`, `destinatariosGasto`, `contenidoAvisoGasto` |
| Constantes | `PREFIJO_GAS`, `GAS_ENVIADO/APROBADO/RECHAZADO/REEMBOLSADO/CANCELADO`, `ESTADOS_GASTO`, `CATEGORIAS_GASTO`, `METODOS_REEMBOLSO`, `TRANSICIONES_GASTO`, `SUBCARPETA_GASTOS`, `MAX_GASTOS_LISTA`, `MAX_MIS_GASTOS`, `MAX_PROYECTOS_GASTO`, `colGas_` |

### Cambios a funciones compartidas (todos marcados "G (incremento 7)")
Desde §6.G, sin tocar la lista original (no chocan al integrar): `HOJAS_COMPRAS.Gastos = {…}`, `EVENTOS_CORREO.push('gasto.enviado',
'gasto.aprobado', 'gasto.rechazado', 'gasto.reembolsar')`, `COLECCIONES_PENDIENTES.push('gastos')`.

Ediciones directas (mínimas):
1. **`MODULOS_`**: + `modGastos_()` (una línea).
2. **`COLECCIONES`**: + `'gastos'` al final.
3. **§6.B correos**, una línea cada una: `infoDeAviso_` (`datosAvisoGasto`), `destinatariosAviso` (`destinatariosGasto`), `contenidoAviso`
   (`contenidoAvisoGasto`, junto a la de `proveedor.banco`).
4. **§6.D Pendientes**: `pendientes()` (+ `o.gastos = gastosParaPendientes_()` para Aprobaciones, Compras o super admin, con su aviso si
   falla), `itemsPendientes` (+ una línea: `itemsGastoPendientes(x.gastos, …)`), `conteosPendientes` (+ `gas` **solo si hay** gastos
   pendientes: así la forma de siempre no cambia).
5. **§6.E Anular**: `modAnular_().cambios.anular` (+ `'gastos'`), `TIPOS_ANULAR.gasto = 'Gasto'`, **`PREFIJOS_ANULAR.GAS = 'gasto'`**,
   mensaje de `folioParaAnular` (+ "GAS-"), `datosAnular_` (`d.gastos`), `planAnulacion_` (`gasto()`: anula el gasto y renombra ticket,
   XML y comprobante; proyecto → sus gastos; raíz `GAS-`; efecto informativo "los gastos y el margen se recalculan…; el reembolso ya pagado
   no se deshace"), `aplicarAnulacion_` (estado `Anulada` y `cancelado_por…` si no se había cancelado; Bitacora de compras),
   `registrarAnulacion_` (`antes.hoja = 'Gastos'`).

### Interfaz (`web/cotizador/index.html`)
- HTML: botón `#tabGas` (con `#cntGas`) en `#subCompras`, después de Requisiciones; `<section id="vistaGas">` con `#gasModForm`,
  `#gasModMios`, `#gasModEquipo` (máximo 3 módulos por vista); texto de Anular con "GAS-".
- `<script id="mod-gastos">` (al final): `GRUPOS.compras.push('gas')`, `BOTON_TAB.gas`; `window.GASTOS` (`cargar`, `enviar`, `cancelar`,
  `aprobar`, `rechazar`, `abrirReembolso`, `cerrarReembolso`, `reembolsar`, `filtrar`, `verArchivo`, `irA`, `leerCfdiTexto`, `datos`);
  `registrarModulo({alBootstrap, alPermisos, alVerTab, contexto ({gastos, gastosFiltro} con la pantalla cargada), alSincronizar})`.
  Envuelve `window.pintarConteos` (número de Gastos y del grupo Compras) y `window.abrirDestino` (destino `gas` de Pendientes), como
  mod-proveedores envuelve `verListaCom`/`verCxp`. Liga de los correos `#gas=GAS-…`.
- Formulario: tipo de cambio visible solo si la moneda no es la del proyecto; ticket obligatorio (cámara o archivo; foto reducida con
  `comprimirFoto`, PDF tal cual, 10 MB); XML que prellena; `idSolicitud` nuevo tras cada envío. Tarjetas `.pend-item` (en el teléfono el
  botón ocupa todo el ancho). Reembolso en un formulario aparte (`#gasReembolsoCaja`), que la sincronización no borra.

## 4. Decisiones que el contrato no fijaba (y por qué)

1. **"IVA incluido: No" = el gasto no lleva IVA** (subtotal = total), no "sumarle IVA": el monto es siempre **lo que se pagó** (lo que dice el
   ticket y lo que se reembolsa). Con "Sí", subtotal = total / (1 + `IVA_TASA` de Config, hoy 16 %). Un ticket con 8 % (frontera) sin XML
   queda con el subtotal un poco bajo; con el XML es exacto.
2. **Con XML el CFDI manda**: total, moneda y `subtotal = SubTotal − Descuento`; la columna `iva` guarda los impuestos trasladados del
   comprobante (incluye locales como el ISH de un hotel: así el costo sin IVA no los cuenta). La fecha del gasto es la capturada (la
   factura puede ser de días después). Solo tipo I; un CFDI en otra moneda que MXN/USD se rechaza.
3. **UUID repetido** = en un gasto Enviado, Aprobado o Reembolsado (uno Cancelado, Rechazado o Anulado libera su UUID para capturarlo bien)
   **o en una factura de proveedor vigente** (la misma factura no puede contar dos veces en el costo del proyecto).
4. **Rechazar lo propio** sigue la misma regla que aprobar (Aprobaciones nunca decide sobre lo suyo; super admin con motivo); para lo propio
   está "Cancelar".
5. **Compras puede reembolsar su propio gasto**: el control es la aprobación (otra persona); el reembolso solo registra el pago con su
   comprobante. Se reembolsa **el total del gasto en su moneda** (no se captura otro monto); la referencia es obligatoria salvo en efectivo
   y nunca un número de tarjeta; la fecha no es futura ni anterior al gasto. El reembolso y la cancelación **no mandan correo** (no están
   en el contrato).
6. **Quien capturó** abre su ticket y su XML, **no** el comprobante del reembolso (ve fecha, método y referencia). Aprobaciones y Compras
   abren todo.
7. **Moneda del proyecto para quien pide:** la lista de proyectos del formulario trae la moneda (la de la aceptada; sin aceptada, MXN) para
   saber si pide tipo de cambio. Es solo la moneda: nunca montos del contrato.
8. **`costoGastosPorProyecto`** devuelve también `cantidad` (número de gastos, como `costosDeOrdenes`). `monedaDeProyecto` puede ser
   función, mapa (`'MXN'` o `{moneda}`) o texto; un proyecto sin moneda conocida deja cada gasto en su moneda (nunca se inventa una
   conversión). El renglón de la moneda del proyecto va primero. Sumas en centavos.
9. **Anular un proyecto anula sus gastos** (como sus requisiciones y órdenes).
10. **Pestaña propia** en el grupo Compras (no dentro de Requisiciones): quien pide ahora ve la barra "Requisiciones · Gastos" (antes, con
    una sola pantalla, no había barra). Filtro por omisión de "Gastos del equipo": Aprobaciones → por aprobar; Compras → por reembolsar;
    los dos o super admin → pendientes.
11. **El concepto no va en los correos** (texto libre: puede traer montos o el nombre del comercio); sí la categoría, de una lista fija.
12. **Idempotencia solo en la hoja** (sin caché): se lee Gastos de todos modos dentro del candado (UUID, folio), así que no cuesta más y
    sobrevive a un caché vacío o al cambio de `VERSION_CODIGO_CACHE`. El mismo id con otro contenido se rechaza; con otra cuenta, también.
13. **Archivos dentro del candado**, como en el pago a proveedor: el nombre lleva el folio. `privado_` (permisos de Drive por su API) corre
    ahí, igual que en todo el código; no hay llamadas al centro de mando ni correos dentro.

## 5. Pruebas

- **`tests/gastos.test.js`** (nueva): lógica pura (transiciones, normalizarGasto con IVA/sin IVA/tasa/monedas/tipo de cambio/CFDI,
  validarCfdiGasto, reembolso, `costoGastosPorProyecto` en todos sus casos y conectado a `margenPorProyecto`, acciones, filtro, totales,
  Pendientes, correos) y por `doPost`: permisos por rol (ventas sin acceso, Requisiciones, Solo requisiciones, **@helgen.services con sesión
  CAPRI**, Aprobaciones con Solo requisiciones, Compras, super admin), cada quien solo ve lo suyo, validación sin gastar folio, fila,
  archivo privado de arriba abajo, bitácora y correo, **idempotencia con el caché vacío** y con otro contenido u otra cuenta, monedas y
  tipo de cambio (proyecto USD, Cerrado, Cancelado), cancelar, aprobar, rechazar, reembolsar y sus rechazos, separación de funciones y
  **excepción de super admin** (Bitacora de Administración), archivos por rol, CFDI (prellenado, UUID repetido en gastos y en facturas de
  proveedor, receptor ajeno, tipo E, no-XML, CFDI USD), Pendientes (por aprobar/por reembolsar/todos/conteos), bootstrap y sincronizar,
  costo para el margen, **Anular** (solo, con vista previa, archivos, versión, y en cascada del proyecto) y **ningún correo con montos**.
- **`tests/gastos-interfaz.test.js`** (nueva): la interfaz con DOM y fetch simulados contra el servidor simulado: pestaña en Compras,
  formulario (tipo de cambio según el proyecto, ticket obligatorio, XML que prellena, idSolicitud nuevo, cancelar), Aprobaciones (Pendientes
  → Gastos con su filtro, número de la pestaña, aprobar, rechazar con `prompt`), Compras (formulario y registro del reembolso), super
  admin (pide el motivo con `accionConExcepcion` y repite), ventas sin pestaña.
- Ajustes intencionales: `tests/compras.test.js` (el libro nuevo trae la pestaña `Gastos`), `tests/requisiciones.test.js` (las versiones
  traen `gastos`), `tests/pantallas.test.js` (quien pide ya tiene barra en Compras: Requisiciones · Gastos; la regla "una pantalla, sin
  barra" sigue probada con Administración).
- `bash tests/todas.sh`: **28 pruebas ✔ + sintaxis de la interfaz** (antes 26).
- Tiempos estimados con el perfil (pesos de `tests/perfil.js`): `guardarGasto` con foto ≈ 13 s (≈ 7 s con el candado: carpeta y archivo
  privados), `aprobarGasto` ≈ 8 s, `reembolsarGasto` ≈ 11 s, `listarGastos` ≈ 2 s con caché (4 s en frío), Pendientes de Aprobaciones ≈ 3 s.

## 6. Para el integrador

- **Margen** (contrato §1; los módulos no lo conectan):
  ```js
  const extra = costoGastosPorProyecto(gastosDelLibro_(libroComprasSiExiste_()),
    folio => monedaDeProyecto_(contratosCache_()[folio] || null).moneda); // {PRY-…: [{concepto: 'Gastos', moneda, monto, cantidad}]}
  // margenDeContrato_ / margenSinContrato_: costosDeOrdenes(…).concat(extra[folio] || [])  · reporteMargen: margenPorProyecto({…, costosExtra})
  ```
  El resumen de cobranza y la tarjeta de margen dependen entonces también de `gastos` (sus claves de caché y el `algo(…)` de
  `sincronizar` de cobranza/reportes).
- **Choques esperados**: `MODULOS_` (una línea), `COLECCIONES` (al final), `PREFIJOS_ANULAR`/`TIPOS_ANULAR` y `planAnulacion_` (A también
  toca la cascada de la cotización), `pendientes()`/`itemsPendientes`/`conteosPendientes` (C agrega sus pendientes), el `<nav id="subnav">`
  y el final de `index.html` (cada módulo agrega su `<script>`).
- **`VERSION_CODIGO_CACHE`**: cambia la forma de lo que va en caché/respuestas (bootstrap y sincronizar con `gastos`, conteos de
  Pendientes con `gas`): cambiarla al publicar (lo hace el integrador).

## 7. Publicar

- **Sin servicios nuevos de Google** (Drive, Sheets, UrlFetch y MailApp ya autorizados): `clasp push`, versión nueva por **facilities@**, y
  `wrangler deploy` (API e interfaz juntas: la interfaz vieja no tiene la pestaña; la API vieja no tiene las funciones).
- Respaldar el libro de compras (solo gana la pestaña `Gastos`; nada se mueve). Opcional: `prepararCompras()` o `prepararCapri()` para
  crearla de una vez.
- **Dar el rol Aprobaciones** a alguien en Permisos antes de anunciarlo: sin nadie con ese rol, `gasto.enviado` no le llega a nadie y solo
  un super admin puede aprobar.
- Avisar al equipo: "Gastos" en el grupo Compras (también en el teléfono y para @helgen.services), foto del ticket obligatoria, el XML
  opcional llena los montos y debe estar a nombre de Helgen; a Aprobaciones: aprobar o rechazar desde Pendientes; a Compras: registrar el
  reembolso con su comprobante.
- Manual del Cotizador (regla 14): sección nueva "Gastos", Pendientes, Anular (GAS-), Historial.

## 8. Pendiente / ideas

- Correo `gasto.reembolsado` a quien lo capturó (no está en el contrato).
- Tasa de IVA por gasto (16/8/0) sin XML, para tickets de la frontera.
- Probar en PRUEBAS o en el real con Claude in Chrome (regla 13), sobre todo la cámara del teléfono (Android/iOS) y una cuenta @helgen.services.
