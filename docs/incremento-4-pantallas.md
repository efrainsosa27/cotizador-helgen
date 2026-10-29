# Incremento 4 (CAPRI) · Módulo D: Pantallas

Rama `incremento-4-pantallas` (sobre la base `7756502`). Dueño: §6.D de `Code.js`, `<script id="mod-pantallas">`, `#vistaPend`,
encabezado (`<title>`, `h1`, navegación), estilos, `aplicarPermisos` y `verTab` en `web/cotizador/index.html`.
Spec: "CAPRI — increment 4 spec", sección "CAPRI name and navigation" (aprobación 8).

## 1. Qué cambió en la interfaz

- **Nombre:** la pestaña del navegador dice "CAPRI — Helgen" y el encabezado "CAPRI" (al pasar el mouse: Cotizaciones · Aprobaciones ·
  Pagos · Requisiciones · Inventario). Los PDF de cotización y de orden de compra no cambian (membrete de Helgen Servicios
  Especializados). La caja de `#login` no se tocó (la llena el módulo A).
- **Navegación por grupos** en el encabezado: **Pendientes** (inicio) · **Ventas** · **Compras** · **Cobranza** · **Administración**, más la
  liga **"Inventario (centro de mando) ↗"** a `https://drogheda.helgen.online/` (otra pestaña; para quien pide, aprueba o compra).
  Las pantallas del grupo abierto van en una barra blanca debajo (`#subnav`), solo si el grupo tiene más de una:
  - Ventas: Nueva cotización · Historial · Catálogo (solo con `puedeVender()`: `PERMISOS.ventas`, o como antes si el servidor no lo manda).
  - Compras: Requisiciones (las mías) · **Aprobaciones** (antes "Operaciones") · Compras (por cotizar, órdenes, cuentas por pagar).
  - Cobranza: como antes (solo cobranza; nunca con solo requisiciones).
  - Administración: con super admin, Aprobaciones o Compras. Un bloque a la vez: Permisos · Delegaciones · Correos enviados · Anulados.
    Permisos, Correos y Anulados solo super admin; los demás solo ven Delegaciones (el contenido lo filtra el módulo A). Los bloques
    `#adminPermisos`, `#adminDelegaciones`, `#adminCorreos` y `#adminAnulados` siguen siendo de A, B y E: aquí solo se muestran u ocultan.
  - Un grupo abre la pantalla que se usó la última vez; si no, la primera con algo pendiente; si no, la primera que puede ver.
- **Los botones de siempre no cambian de id ni de `onclick`** (`tabNueva`, `tabHist`, `tabCat`, `tabReq`, `tabOps`, `tabCob`, `tabCom`,
  `tabPend`, `tabAdmin` con `verTab('…')`): ahora viven dentro de los grupos. Nuevos: `grpVentas`, `grpCompras`, `subnav`, `subVentas`,
  `subCompras`, `subAdmin`, `admTab*`, `lnkInventario`, `btnMenu`, `cabecera` (el `<header>`), y funciones `verGrupo(g)`, `verAdmin(b)`,
  `pintarNav()`, `pintarAdmin()`, `bloquesAdmin()`, `tabVisible(t)`, `grupoDe(t)`, `alternarMenu(abrir?)`.
- **Conteos:** un globo aqua con el número en Pendientes, en el grupo Compras, en Requisiciones (`cntReq`), Aprobaciones (`cntOps`) y
  Compras (`cntCom`), y en el botón Menú del teléfono. Salen de los pendientes del servidor (`CONTEOS_PEND`, siempre los propios); mientras
  no lleguen, de las listas cargadas, como antes (`cuentaTab`). Las etiquetas ya no llevan "(n)": el número va en su `<span>`.
- **Inicio = Pendientes para todos** (antes Nueva cotización, o Requisiciones con solo requisiciones). Si la pestaña abierta deja de estar
  permitida (cambio de rol sin recargar), la página vuelve a Pendientes.
- **Teléfono (≤ 640 px):** los grupos (y "Cerrar sesión") se pliegan en el botón **Menú**; elegir una pantalla lo cierra. La barra del grupo
  se desliza de lado dentro de sí misma. Rejillas a una columna, totales a lo ancho y cada tabla dentro de un recuadro que se desliza
  (`.tabla-desliza`, se envuelve al cargar; ancho mínimo 600 px en el teléfono): la página nunca se mueve de lado. Comprobado con
  Chromium sin ventana a 360 px y 1280 px en las 9 pantallas (`scrollWidth` = ancho de la ventana; sin errores de consola).
- Estilo: colores y tipografías de marca (azul, aqua, teal, neutro; League Spartan en títulos y navegación, Roboto Mono en texto). No se
  rediseñó ninguna otra pantalla.

## 2. Pendientes (servidor, `Code.js` §6.D)

- `pendientes(todos)` *(API; también para cuentas de solo requisiciones)* → `{hoy, todos, flujo, items, conteos, avisos}`. `todos = true`
  solo para super admin (si no, `PERMISO`). `conteos` = `{total, aprobaciones, compras, mias, ops, com, req}`, **siempre del usuario**
  (también con `todos`), para la navegación. `avisos`: lo que no se pudo leer (p. ej. facturas) sin tumbar la lista.
- `modPantallas_()`: `api {pendientes}`, `solo ['pendientes']`, sin `cambios` (solo lee). `bootstrap` agrega `pendientes`; `sincronizar`
  los vuelve a mandar si cambió alguna de `COLECCIONES_PENDIENTES` (requisiciones, oc, pagosProveedores, facturasProveedor, permisos,
  proyectos, anulaciones), con `ctx.pendTodos` (solo si es super admin).
- Lectura eficiente: `basePendientes_()` lee **una vez** la pestaña Requisiciones (solo las abiertas: `ESTADOS_PENDIENTES`) y, si alguna tiene
  orden, OrdenesCompra; en caché por versión (`enCache_('pendientes', …)`) y **compartido entre usuarios** (el filtro por rol es aparte).
  Las facturas salen de `cuentasPorPagar()` (ya en caché por día y versión). En frío, la carga inicial de compras lee además esas hojas.
- Lógica pura (se prueba en Node): `itemsPendientes(base, o)`, `conteosPendientes(items)`, `marcaOrdenable(texto)`.
- Cada item: `{tipo, seccion, folio, req, titulo, detalle, sitio, desde (AAAA-MM-DD), dias, prioridad, urgente, accion, destino, para?}`;
  las facturas además `{vence, diasVencida}`. `destino`: `ops` (Aprobaciones), `com` (requisición en Compras), `cxp` (cuentas por pagar),
  `req` (mis requisiciones). Orden: de lo más antiguo a lo más nuevo por la columna `actualizado` (último cambio de estado).

### Reglas por rol

| Sección | Rol | Pendiente (`tipo`) | Cuándo |
|---|---|---|---|
| Aprobaciones | aprobaciones (con el flujo con aprobaciones) | `aprobar` | Solicitada que **no pidió** quien aprueba |
| | | `visto` | Cotizada que no pidió ni preparó (ve proveedor y total de la propuesta) |
| Compras | compras | `autorizar` | Solicitada, **solo en el flujo de siempre** (sin aprobaciones) |
| | | `cotizar` | Aprobada (con motivo = "Propuesta regresada" por aprobaciones) |
| | | `pagar` / `pagarRecibida` | Autorizada, En camino o Recibida con su orden **Emitida** (sin pagar). Las facturas de esa orden que vencen en ≤ 7 días o ya vencieron se anotan aquí ("factura vencida hace N días") y la marcan urgente |
| | | `encamino` | Pagada en un proyecto **ligado al centro de mando** (ver §4) |
| | | `factura` | Factura abierta que vence en ≤ 7 días o ya venció de una orden sin requisición abierta (órdenes de antes) |
| Mis requisiciones | quien pidió | `corregir` | Devuelta (con el motivo) |
| | quien pidió o quien recibe (`recibe_email`) | `recibir` | Con aprobaciones: Autorizada, Pagada o En camino; flujo de siempre: Pagada o En camino. En proyecto ligado: "Recibir en el centro de mando" |
| Todas | super admin con `todos` | lo mismo para todas las personas, sin excluir lo propio, con `para` (a quién espera); lo de otros se abre en Compras | |

- Quien pide o recibe **nunca** ve montos, proveedor ni folio de la orden en sus pendientes (probado). Sin cliente en ningún pendiente.
- En el flujo de siempre (sin `aprobaciones`), Autorizada **no** es pendiente de quien pidió: "Recibí el material" solo se puede con Pagada.

## 3. Pendientes (interfaz, `<script id="mod-pantallas">`)

- `#vistaPend`: encabezado con "Actualizar" y, para super admin, el interruptor **"Ver los de todos"** (`#pendTodos`); secciones
  Aprobaciones · Compras · Mis requisiciones (con todos: "Quien pide o recibe") con su número; cada pendiente con folio, título, prioridad,
  detalle, sitio, "Desde el … (hace N días)" (facturas: "Vence el …"/"Vencida hace …"), "Espera a" (con todos) y **un botón** que abre la
  pantalla: `ops` → `verTab('ops')` + `abrirOps(folio)`; `com` → `verTab('com')` + `abrirReqCom(folio)`; `cxp` → `verCxp()`; `req` →
  Requisiciones con el formulario de corrección (`editarReq`) o de recepción (`abrirRecepcion`) ya abierto y la tarjeta señalada (si la
  lista no estaba cargada, se pide una vez).
- Estado vacío: **"Nada pendiente"** con atajos (Nueva cotización / Nueva requisición según el rol).
- Funciones: `recibirPendientes`, `actualizarPend`, `cambiarPendTodos`, `pintarPendientes`, `irPendiente(i)`, `abrirDestino`, `irAMiReq`,
  `leerLiga`, `seguirLiga`. Registro: `alBootstrap` (si la carga inicial no los trajo, los pide aparte), `alSincronizar`, `contexto()` →
  `{pendTodos}`, `alPermisos` (si deja de ser super admin, vuelve a los suyos), `alVerTab`. Si cambia el día con la página abierta,
  la siguiente consulta los pide otra vez (una vez).

## 4. Ligas directas

- `…/cotizador/#req=REQ-2026-0005` (las usan los correos del módulo B) y `#pend`. Se siguen **después de iniciar sesión** (al llegar el
  bootstrap) y se quitan de la dirección (`history.replaceState`; recargar no las repite). También con la página abierta (`hashchange`).
- `#req=…`: primero lo que ese folio espera de esta persona según Pendientes (su `destino`); si no espera nada, por rol: Aprobaciones si
  aprueba, Compras si compra, si no sus requisiciones (si no es suya: "No encontramos la requisición … entre las tuyas").

## 5. Para integrar con los demás módulos

- **C (centro de mando):** Pendientes pregunta si un proyecto está ligado con `proyectoLigado_(proyectoFolio)` (opcional; mientras no
  exista, ninguno lo está). Con eso aparecen "Por marcar En camino" (compras, Pagada) y "Recibir en el centro de mando". `REQ_EN_CAMINO`
  cuenta como "esperando al sitio" (quien pide o recibe) y, si su orden sigue Emitida, como "En camino, falta pagar" (compras). Si C
  agrega otros estados intermedios, sumarlos a `ESTADOS_PENDIENTES` y a las reglas de `itemsPendientes`.
- **E (anular):** `basePendientes_` ya usa la versión de `anulaciones` en su caché; E debe excluir ahí lo anulado (o dejarlo en un estado
  que no esté en `ESTADOS_PENDIENTES`).
- **A (identidad):** Administración se muestra a super admin y a quien tenga Aprobaciones o Compras (propias o delegadas): `#adminDelegaciones`
  debe filtrar a lo suyo. Si A agrega `PERMISOS` nuevos, `bloquesAdmin()` es el único lugar a ajustar.
- **B (correos):** la liga para los correos es `…/cotizador/#req=<folio>` (o `#pend`).

## 6. Pruebas

- Nuevo `tests/pantallas.test.js` (en `bash tests/todas.sh`): lógica pura; por `doPost` con el arnés y `ROL_OPERACIONES`: quien aprueba
  (sin lo propio, orden por antigüedad, visto bueno sin lo preparado), compras (cotizar, regresada, pagar con factura vencida anotada,
  En camino con proyecto ligado), quien pide y quien recibe (sin montos ni proveedor ni orden), super admin con `todos` (y `PERMISO`
  para los demás), carga inicial, sincronización (manda o no manda), flujo de siempre. Interfaz con DOM simulado y todos los bloques
  de módulos: grupos por rol (sin `ventas`, `ventas: false`, solo requisiciones con y sin aprobaciones, super admin), Administración
  con sus bloques, Pendientes y sus botones, conteos, interruptor de todos, sincronización, ligas `#req=` y `#pend`, falla y reintento,
  cambio de día.
- `tests/interfaz.test.js`, cambiado solo donde la conducta cambió: (1) cuenta de solo requisiciones: ahora abre en Pendientes y las
  listas de Requisiciones se piden al abrir esa pestaña; (2) `'Operaciones (2)'` → globo `cntOps` = 2 (y `cntCompras` = 2);
  (3) `'Requisiciones (1)'` → globo `cntReq` = 1.

## 7. Publicar

- `Code.js` cambió (API): `npx clasp push --force` y `npx clasp deploy --deploymentId AKfycbwBjF7…`. Sin servicios ni permisos de Google
  nuevos (solo lee hojas que ya se leen).
- `web/` cambió: `npx --yes wrangler@4 deploy`. Publicar la API primero: la interfaz nueva con la API vieja pide `pendientes` y muestra
  "No se pudieron cargar los pendientes" hasta que se publique la API (lo demás funciona).

## 8. Lo que no se hizo / pendiente

- Dentro de las pantallas siguen textos con "operaciones" (p. ej. "Operaciones la revisará", la columna "Operaciones" en Compras, "Nota
  de operaciones"): solo se cambió el nombre de la pestaña. Cambiarlos toca pruebas y zonas de B y C; mejor al integrar.
- Cobranza no tiene pendientes (el spec no los define).
- La recepción parcial se cuenta por estado (Autorizada o Pagada con aprobaciones = falta recibir), sin leer MovimientosInventario.
- No se probó en el navegador real ni en PRUEBAS (solo Node y Chromium sin ventana con servidor simulado).
- CLAUDE.md y el Manual no se tocaron (se actualizan al integrar): §4.7 (navegación, Pendientes, ligas), §4.1.1 (bootstrap y sincronizar
  con `pendientes`), §6.14 (lo que lee la carga inicial) y el Manual (Cómo está armado, Tareas frecuentes).
