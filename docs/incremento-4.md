# Incremento 4 (CAPRI): contrato entre módulos

Spec aprobado por Leo el 28/10/2026: "CAPRI — increment 4 spec" (https://claude.ai/artifact/2kb6Dpz1MDVdZ5Y26oKjtA).
Este archivo dice **quién toca qué** para que cinco personas (agentes) trabajen a la vez sin pisarse. Las reglas de siempre
siguen en `CLAUDE.md` (§7): textos en español de México, el servidor revisa permisos en cada función, `textoCelda` para
Sheets, `escaparHtml` para PDF, archivos privados con `privado_`, nada de montos para quien pide o recibe.

## Lo que ya está en la base (no lo reescribas; úsalo)

**Roles (Code.js §1.2 y lógica pura al final de §5).**
- Permisos viven en la pestaña `Permisos` del libro privado "CAPRI — Administración" (`ADMIN_DB_ID`). Mientras no exista,
  los roles salen de Script Properties como siempre (`usuariosDesdePropiedades`).
- Roles (`ROLES_CAPRI`): `ventas`, `requisicion`, `solo_requisicion`, `aprobaciones` (antes ROL_OPERACIONES), `compras`,
  `cobranza`, `desbloqueo`, `superadmin`. `ROLES_DELEGABLES` = aprobaciones y compras. `@helgen.services` solo
  `solo_requisicion` (`ROLES_SERVICIOS`). Super admin raíz = Script Property `SUPER_ADMIN` (prepararCapri pone leo@).
- `rolesEfectivos(correo, ctx)` (pura) → `{activo, listado, roles, superadmin, delegaciones}`; `rolesYo_()`, `tieneRol_(rol)`,
  `esSuperAdmin_()`, `exigirSuperAdmin_()`, `correosConRol_(rol)` (con delegaciones: a quién avisar), `usuarioCapri_(correo)`,
  `nombreDeCorreo_(correo)`, `contextoRoles_()`, `usuariosCapri_()`, `delegacionesCapri_()`.
- `excepcionSuperAdmin_(regla, folio, motivo)`: un super admin se salta una regla de separación de funciones si escribe
  motivo ≥ 10; queda en la Bitacora de Administración.
- `doPost`: públicas (`FUNCIONES_PUBLICAS`) sin sesión; las demás: `verificarSesion_` (Google o sesión CAPRI con prefijo
  `capri.` → `verificarSesionCapri_`), `exigirAcceso_` (cuenta desactivada o sin alta → `codigo: 'ACCESO'`), solo
  requisiciones, y `FUNCIONES_VENTAS` exige el rol ventas.
- `permisos` de bootstrap/sincronizar ahora traen también `ventas` y `superadmin`.
- Libro de Administración: `libroAdmin_()`, `libroAdminSiExiste_()`, `hojaAdmin_(libro, nombre)`, `HOJAS_ADMIN` (Permisos,
  Delegaciones, Correos, Anulaciones, Bitacora), `bitacoraAdmin_(accion, folio, detalle, motivo)`.
- `prepararCapri()` (editor): crea el libro, migra roles, SUPER_ADMIN y corre `preparar()` de cada módulo.
- Colecciones nuevas: `permisos` (Permisos y Delegaciones) y `anulaciones`.

**Avisos.** `notificar_(tipo, datos)` solo forma el aviso en `MEMO_.correos`; `doPost` llama `enviarCorreosPendientes_()`
cuando la función terminó bien. Tipos en `EVENTOS_CORREO`.

**Sitios.** Config → `SITIOS`: un sitio por renglón `VER | Veracruz (ICAVE) | dirección opcional` (el formato viejo, solo
nombres, sigue sirviendo: el código se deduce). `sitiosDetalle_()`, `sitiosDetalleDeTexto`, `codigoDeSitio(sitio, detalle)`,
`codigoSitioConocido(nombre)`. `sitiosDeTexto` sigue devolviendo nombres. Bootstrap y sincronizar mandan `sitiosDetalle`.

**Estado nuevo.** `REQ_EN_CAMINO = 'En camino'` (lo usa el centro de mando; las pantallas lo cuentan en Pendientes).

**Centro de mando.** `avisarPortal_(tipo, folioOc)`: firma vacía en la base; la implementa C; la llaman C y E.

**Interfaz (web/cotizador/index.html).** `registrarModulo({nombre, alBootstrap(d), alSincronizar(r), contexto() → {campos
para el ctx de sincronizar}, alPermisos(permisos, solo), alVerTab(t)})`; `avisarModulos`; `puedeVender()`; `SITIOS_DET`.
Pestañas nuevas `tabPend` / `vistaPend` y `tabAdmin` / `vistaAdmin` con los bloques `#adminPermisos`,
`#adminDelegaciones`, `#adminCorreos`, `#adminAnulados`. Un bloque `<script id="mod-…">` por módulo al final.

**Pruebas.** `tests/arnes.js` (simulacro de Google con MailApp, ScriptApp, UrlFetch con rutas, `correr`, `como`),
`tests/permisos.test.js` (la base) y `bash tests/todas.sh` (todas las pruebas + sintaxis de la interfaz).

## Contrato de un módulo del servidor

Cada módulo llena su función `mod*_()` en `Code.js` §6 (no toca `API_FUNCIONES`, `CAMBIOS_API` ni las listas):

```js
function modCorreos_() {
  return { nombre: 'Correos',
    api: { solicitudCotizacion: solicitudCotizacion },        // solo declaraciones de función
    cambios: { solicitudCotizacion: ['requisiciones'] },       // regla 15: toda función que escribe
    solo: [],                                                  // las que puede usar una cuenta de solo requisiciones
    publicas: [],                                              // sin sesión (solo identidad)
    bootstrap(permisos, errores) { return {}; },               // campos extra de la carga inicial (opcional)
    sincronizar(permisos, ctx, algo, r, errores) {},           // agrega a r lo que cambió (opcional; algo('oc') = cambió)
    preparar() {} };                                           // lo corre prepararCapri (opcional)
}
```

## Quién es dueño de qué

| Módulo | Code.js | Interfaz | Puede tocar además (cambios chicos, con cuidado) |
|---|---|---|---|
| **A · Identidad** | §6.A | `mod-identidad`, `#adminPermisos`, `#adminDelegaciones`, la caja de `#login` y `<script id="api-web">` | `aprobarRequisicion`, `autorizarPropuesta` y cualquier otra regla de "nadie aprueba lo suyo" (excepción de super admin con motivo) |
| **B · Correos y proveedores** | §6.B | `mod-correos`, `#adminCorreos`; botones en la vista de requisición de Compras y en la orden | llamadas a `notificar_` en las funciones de requisiciones de §4.4 (al final de cada cambio) |
| **C · Centro de mando** | §6.C | `mod-centro`; selector de ítem por renglón, En camino / Lo recogí, recepción para proyectos ligados | `HOJAS_COMPRAS` (columnas nuevas, pestaña PortalPendientes), transiciones de requisición, `registrarRecepcion`/`cerrarRequisicion` (proyectos ligados), llamadas a `avisarPortal_` en §4.4 |
| **D · Pantallas** | §6.D (`pendientes`) | `mod-pantallas`, `#vistaPend`, encabezado (`<title>`, `h1`, `<nav>`), estilos, `aplicarPermisos`, `verTab` | nada más |
| **E · Anular** | §6.E | `mod-anular`, `#adminAnulados` | funciones que listan o suman (cotizaciones, cobranza, compras, requisiciones, facturas, cuentas por pagar, margen) para esconder lo anulado |

Si necesitas algo de otro módulo, usa su función o su evento; si no existe, déjalo anotado en tu
`docs/incremento-4-<modulo>.md` y sigue.

## Eventos de aviso (notificar_) y quién los manda

| Evento | Lo manda | Recibe (lo decide B) |
|---|---|---|
| req.solicitada (nueva o reenviada) | B (hook en guardarRequisicion) | aprobaciones |
| req.aprobada | B (aprobarRequisicion) | compras |
| req.devuelta, req.rechazada | B (devolver/rechazar) | quien pidió |
| req.cotizada | B (cotizarRequisicion) | aprobaciones |
| req.regresada | B (regresarACompras) | compras |
| req.autorizada | B (autorizarPropuesta / autorizarRequisicion) | compras, quien pidió y quien recibe |
| req.encamino | C (marcarEnCamino / Lo recogí) | quien pidió y quien recibe |
| req.recibida | B (registrarRecepcion/cerrarRequisicion) y C (recepción del centro de mando) | compras |
| req.cancelada | B (cancelarRequisicion) | aprobaciones si la esperaban |
| oc.cancelada | B (cancelarOrdenCompra) y E (anular) | compras y quien pidió |
| delegacion | A | el delegado |
| usuario.alta | A | la persona nueva |
| anulado | E | todos los involucrados |

Nunca montos, proveedores ni folio de orden en un correo (decisión del spec, sección 5).

## Notas para CLAUDE.md y el Manual

Cada módulo deja en `docs/incremento-4-<modulo>.md` (archivo propio): funciones nuevas, hojas y columnas, decisiones,
pasos de publicación y lo que no alcanzó. Al integrar se pasan a `CLAUDE.md` y al Manual.
