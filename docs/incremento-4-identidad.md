# Incremento 4 (CAPRI) · Módulo A — Identidad

Rama `incremento-4-identidad` (sobre `7756502`, base compartida). Spec: secciones "Sign-in" y "Roles, super admin,
permissions and delegation" de "CAPRI — increment 4 spec" (puntos 2 y 4 de aprobación). Contrato: `docs/incremento-4.md`.

Qué hace:

1. **Permisos** (Administración, solo super admin): lista, alta, edición y baja (desactivar) de usuarios.
2. **Delegaciones** (Administración): quien tiene Aprobaciones o Compras los entrega a otra persona por unas fechas.
3. **Excepción de super admin** a "nadie aprueba lo suyo", con motivo por escrito que queda en la bitácora.
4. **Entrar con código** para @helgen.services y **sesiones propias de CAPRI** (30 días, se renuevan solas).
5. **Pantalla de entrada CAPRI** y sesión que se mantiene (localStorage, entrada sin clics con Google).

## 1. Servidor (`Code.js` §6.A)

`modIdentidad_()` declara: `api` (las 7 funciones de abajo), `cambios` (`guardarUsuario`, `crearDelegacion`,
`cancelarDelegacion` → `['permisos']`), `solo` (las 3 de delegaciones: quien aprueba puede ser una cuenta de solo
requisiciones), `publicas` (`solicitarCodigo`, `verificarCodigo`), `bootstrap` y `sincronizar` (renuevan la sesión de CAPRI y
mandan las páginas abiertas de Administración) y `preparar` (crea `SESION_SECRETO`).

### Funciones de la API

| Función | Quién | Qué hace |
|---|---|---|
| `listarUsuarios()` | super admin | Página de Permisos: usuarios de la pestaña Permisos (+ el raíz aunque no esté en ella, `enLista: false`), roles con nombre (`NOMBRES_ROLES`), sitios con código, `libro` (falso antes de `prepararCapri`: se ve, no se edita). En caché por la versión `permisos`. |
| `guardarUsuario(p)` | super admin | Alta (`p.nuevo`) o edición: `{correo, nombre, roles, sitio, activo, notas}` con `normalizarUsuario` y `filaDeUsuario`. Sitio debe existir en Config → SITIOS. El raíz (`SUPER_ADMIN`) no se desactiva ni pierde Super admin; nadie se desactiva ni se quita Super admin a sí mismo. Bitácora (Alta / Cambiar / Desactivar / Reactivar usuario, con el detalle del cambio). El alta activa avisa con `notificar_('usuario.alta', {para, correo, nombre, metodo, sitio, roles})`. |
| `listarDelegaciones()` | super admin (todas); quien tiene hoy Aprobaciones o Compras (las que dio y las que recibió) | `{hoy, yo, superadmin, maxDias, delegaciones (con estado Vigente / Programada / Terminada / Cancelada y puedeCancelar), misRoles, roles, candidatos (activos @helgen.tech; solo = no recibe Compras), delegadores (solo super admin)}`. |
| `crearDelegacion(p)` | quien delega (o un super admin a nombre de otra persona con `p.de`) | Valida con `normalizarDelegacion`; folio `DEL-AAAA-NNNN`; bitácora "Delegar roles"; `notificar_('delegacion', {para: [a], id, de, a, deNombre, aNombre, desde, hasta, roles, creo})`. |
| `cancelarDelegacion(id, motivo)` | quien la dio, quien la recibe o un super admin | Solo Vigente o Programada; motivo ≥ 5; estado Cancelada + quién y motivo en la fila; bitácora "Cancelar delegación". |
| `solicitarCodigo(correo)` | pública | Código de 6 dígitos al correo (ver §3). Siempre responde `{mensaje: "Si el correo está dado de alta, te llegó un código."}`. |
| `verificarCodigo(correo, codigo)` | pública | `{token, correo, nombre}` con la sesión de CAPRI de 30 días. Bitácora "Entrada con código". |

### Internas

`vistaPermisos_`, `usuarioDeFilaAdmin_`, `puedeVerDelegaciones_` / `exigirDelegaciones_`, `ctxIdentidad_` (contexto de roles
leído fresco: en una escritura sale de la hoja), `vistaDelegaciones_`, `excepcionPosible_(motivo)` (super admin + motivo ≥ 10),
`textoExcepcion_()` (lo que se agrega al error para un super admin), `correoParaCodigo_`, `usuarioParaCodigo_`,
`secretoSesion_(crear)`, `firmaSesion_`, `emitirSesionCapri_`, `textoDeBase64Url_`, `verificarSesionCapri_` (implementa el
stub de la base), `renovarSesionCapri_`, `mismoTexto_` (comparación de tiempo constante), `huellaCorreo_`, `huellaCodigo_`,
`codigoAleatorio_` (de UUID aleatorios; `Math.random` no es seguro), `candadoCodigo_`.

### Lógica pura (en §6.A para no tocar §5 de la base; se prueba en Node)

`normalizarDelegacion(p, ctx)`, `estadoDelegacion(d, hoy)`, `diasDeDelegacion(desde, hasta)`, `cambioDeUsuario(antes,
despues)` (acción y detalle para la bitácora), `correoCodigo(nombre, codigo, para)` (el mensaje para `MailApp.sendEmail`).

### Cambios a funciones existentes (separación de funciones, punto 4 de aprobación)

- `aprobarRequisicion(folioReq, d, motivoExcepcion)`: argumento nuevo al final. Aprobar la propia requisición sigue negado
  (`PERMISO`) salvo un super admin con motivo ≥ 10. La excepción se registra (`excepcionSuperAdmin_`) **después** de las demás
  validaciones y **antes** de escribir: si otra regla falla, no queda una excepción falsa en la bitácora.
- `autorizarPropuesta(folioReq, version, idSolicitud, huella, motivoExcepcion)`: igual para "visto bueno a su propia
  requisición" y "a una propuesta que preparó" (una sola línea en la bitácora si son las dos).
- Para un super admin el error agrega: "Como super admin puedes hacerlo si escribes el motivo (mínimo 10 caracteres; queda en
  la bitácora)." El `codigo` sigue siendo `PERMISO` (las pruebas de antes no cambian).
- `vistaOperaciones_`: `puedeAprobar` / `puedeVisto` también son verdaderos para un super admin sobre lo propio o lo que
  preparó (para que vea el botón) y hay un campo nuevo `excepcionSuperAdmin`.
- Busqué otras reglas ("Nadie", "propia", "preparó", `solicitanteEmail === yo`): solo están esas dos. `autorizarRequisicion`
  (flujo sin operaciones) nunca tuvo esa regla y no se tocó.
- El delegado también cae en "nadie aprueba lo que pidió": la regla compara con el correo de quien llama (probado).

## 2. Interfaz (`web/cotizador/index.html`)

- **`#login`**: "CAPRI" + "Cotizaciones · Aprobaciones · Pagos · Requisiciones · Inventario"; panel Google (`#loginGoogle`,
  botón de siempre) y "Soy de @helgen.services" → panel `#loginCodigo` (correo → "Enviar código" → código → "Entrar";
  `#loginInfo` para el mensaje genérico, `#loginMsg` para errores). Sin estilos nuevos en `<head>` (son de D): estilos en línea.
- **`<script id="api-web">`** (reescrito):
  - La sesión vive en **localStorage**: `cotizadorHelgenSesion` (Google) o `capriSesion` (CAPRI); una a la vez. La de
    sessionStorage (versión anterior) se migra sola al abrir. `capriCorreoCodigo` recuerda el último correo con código.
  - Google vencido: **entrada sin clics** (One Tap con `auto_select`) antes de mostrar el login; si Google no puede (omitido,
    cerrado o 15 s sin respuesta), aparece el login. También al volver a la pestaña y, en segundo plano, cuando faltan
    menos de 5 min (sin mostrar el login si falla). Las llamadas esperan en la cola mientras tanto.
  - CAPRI vencida al abrir: panel de código con el correo ya escrito y "Tu sesión expiró…".
  - **Públicas** (`solicitarCodigo`, `verificarCodigo`): van sin token por otro camino y no esperan en la cola.
  - **`codigo: 'ACCESO'`**: mensaje en la pantalla de entrada (panel según el tipo de sesión), se olvida la sesión, se
    vacía la cola, `disableAutoSelect` (si no, Google volvería a entrar sola: ciclo); no reintenta. Si después alguien entra,
    la página se recarga (carga limpia). El error también llega a quien llamó con `err.codigo = 'ACCESO'`.
  - Si una respuesta trae `datos.sesionCapri`, se guarda (renovación sin pedir nada).
  - `cerrarSesion()` borra las dos. Encabezado con el nombre en los dos casos. Nuevos: `window.tipoSesion()`, `window.loginCapri`.
- **`<script id="mod-identidad">`**: llena `#adminPermisos` (buscador, tabla, formulario con roles en casillas y reglas de
  interfaz: @helgen.services solo "Solo requisiciones", esta solo con Aprobaciones, raíz y uno mismo protegidos) y
  `#adminDelegaciones` (formulario con "Quién delega" solo para super admin, lista con Cancelar). Se registra con
  `registrarModulo` (`alPermisos`, `alVerTab`, `contexto` → `{admPermisos, admDelegaciones}`, `alSincronizar`); la
  sincronización repinta las tablas, nunca un formulario abierto. Expone `window.identidad`.
- **Operaciones**: `accionConExcepcion` (junto a `aprobarOps`): si el servidor niega con `PERMISO` y la persona es super admin,
  pide el motivo con `window.prompt` (≥ 10) y repite con el motivo como último argumento. Lo usan `aprobarOps` y
  `vistoBuenoOps`. `#opsAviso` dice que como super admin puede hacerlo con motivo.

## 3. Datos y propiedades

- **Script Property `SESION_SECRETO`**: secreto de las sesiones de CAPRI (HMAC-SHA256). Lo crea `prepararCapri()` (o el primer
  `solicitarCodigo`, si alguien entra antes). **Nunca se registra ni se copia a ningún lado.** Cambiarlo o borrarlo cierra
  todas las sesiones de @helgen.services (es la forma de "sacar a todos").
- Sesión de CAPRI: `capri.<base64url de {e: correo, x: vence (epoch s), n: nombre}>.<firma base64url>`, 30 días; si le quedan
  menos de 15, `bootstrap` y `sincronizar` mandan otra en `sesionCapri`. Solo vale para @helgen.services y solo si la cuenta
  sigue activa en Permisos (eso lo revisa `exigirAcceso_` en cada llamada).
- Código: 6 dígitos, 10 min, un solo uso; un código nuevo reemplaza al anterior. CacheService (claves por la huella del
  correo, nunca el correo ni el código): `CAPRI_COD_` (huella SHA-256 de secreto + correo + código y vencimiento),
  `CAPRI_PED_` (pedidos de la última hora: máx. 5, cuentan igual con o sin alta), `CAPRI_ERR_` (fallos de los últimos 15 min) y
  `CAPRI_BLQ_` (5 fallos = bloqueo de 15 min, también para correos sin alta). Correo: asunto "Tu código de CAPRI", remitente
  "CAPRI Helgen", sin ligas.
- Libro de Administración (de la base): **Permisos** (escribe `actualizo` y `actualizado` como texto), **Delegaciones**
  (`DEL-AAAA-NNNN`; `estado` Activa / Cancelada: Programada, Vigente y Terminada se calculan con la fecha; `cancelo` y
  `motivo_cancelacion`), **Bitacora** (Alta / Cambiar / Desactivar / Reactivar usuario, Delegar roles, Cancelar delegación,
  Entrada con código, Excepción de super admin: …). Ninguna columna nueva.

## 4. Decisiones que tomé

- Las reglas de Permisos que no venían en el brief: **nadie se desactiva ni se quita Super admin a sí mismo** desde la página
  (evita quedarse fuera a media sesión; otro super admin sí puede). El raíz se puede **agregar a la lista** (para ponerle nombre),
  siempre activo y con Super admin.
- El correo es la llave: no se cambia al editar (se da de alta el nuevo y se desactiva el viejo). Alta y edición se distinguen
  con `p.nuevo` para no pisar a alguien por error.
- Escribir en Permisos o Delegaciones exige el libro de Administración (si no, error "Falta preparar CAPRI"): crearlo sin migrar
  dejaría a todos sin roles.
- Delegación: máximo **90 días contando el primero y el último**; no se repite una activa igual (mismo de, a, rol y fechas
  que se cruzan); solo se delega lo **propio** (lo recibido no se vuelve a delegar); la puede cancelar también **quien la
  recibe** (devolverla solo quita permisos); el delegado debe estar dado de alta y activo en Permisos.
- `solicitarCodigo` contesta con un error distinto solo en casos que no revelan quién existe: formato, @helgen.tech ("entran con
  Google"), límite por hora y bloqueo (los dos cuentan igual para correos sin alta).
- Una sesión de CAPRI nunca autentica una @helgen.tech (eso es de Google) aunque la firma sea buena.
- `excepcionSuperAdmin_` se llama después de validar todo y antes de escribir; el motivo no va al historial que ve quien pidió.
- Funciones puras del módulo en §6.A (no en §5) para no chocar con los demás módulos al integrar.

## 5. Pruebas

`tests/identidad.test.js` (arnés `tests/arnes.js`): Permisos (solo super admin, validaciones, raíz, uno mismo, super admin que
da de alta a otro, desactivar → `ACCESO` en el siguiente clic, versión, bitácora, aviso), código (respuesta genérica, sin correo
para quien no existe o está desactivado, límite por hora, bloqueo, un solo uso, reemplazo, vencimiento, desactivado entre pedir y
entrar), sesión de CAPRI (verificación, alterada, otro secreto, otro dominio, demasiado larga, vencida, renovada en bootstrap y
sincronizar), delegaciones (`normalizarDelegacion` con cada regla, efecto en los roles, programada, vencida, quién ve qué,
sincronizar, cancelar), excepción de super admin (sin motivo, motivo corto, otra regla que falla sin dejar bitácora, aprobar y
visto bueno con motivo, quien no es super admin) e interfaz (localStorage y migración, entrada sin clics, entrar con código sin
token, renovación, ACCESO sin ciclos, CAPRI vencida, Administración, motivo de la excepción). `bash tests/todas.sh`: todo pasa.

## 6. Publicar (Efrain)

1. Respaldo del libro de compras (como siempre). `npx clasp push --force`.
2. Desde el editor: `prepararCapri()` (de la base). Además de lo de la base, crea `SESION_SECRETO` y muestra cuántos correos
   quedan hoy. Google pide el permiso de **enviar correo** (MailApp) si no se autorizó antes: aceptarlo **antes** del deploy.
3. `npx clasp deploy --deploymentId AKfycbwBjF7…` y `npx --yes wrangler@4 deploy`.
4. Leo: Administración → Permisos: revisar roles, ponerle nombre a los migrados (los de Script Properties llegan sin nombre),
   dar de alta a las cuentas @helgen.services con su sitio y probar la entrada con código con una de ellas.
5. No hace falta agregar las @helgen.services a los usuarios de prueba de OAuth (no usan Google).

## 7. Pendiente o para otros módulos

- **B (correos)**: tipos `usuario.alta` (`datos.para = [correo nuevo]`, `metodo` dice si entra con Google o con código: el correo
  debe decir cómo entrar) y `delegacion` (`datos.para = [delegado]`). El correo del código lo manda este módulo directo con
  MailApp (no pasa por la cola ni por la pestaña Correos).
- **D (pantallas)**: mostrar la pestaña Administración también a quien tiene `permisos.operaciones` o `permisos.compras`;
  `mod-identidad` ya oculta Permisos a quien no es super admin.
- La renovación por `sincronizar` solo llega cuando cambió alguna colección (la base sale antes si no hubo cambios); la de
  `bootstrap` llega en cada carga. Con 15 días de margen sobra.
- Una delegación pasa de Programada a Vigente o Terminada con la fecha, sin cambiar versión: la lista abierta se pone al día al
  recargar o con el siguiente cambio de permisos (los roles efectivos sí se aplican en la siguiente consulta).
- Límites del código en CacheService: si Google vacía el caché antes de tiempo, los contadores se reinician (riesgo bajo: 10⁶
  combinaciones y 5 intentos por ventana). No hay límite por IP (Apps Script no la da). La respuesta para un correo con alta tarda
  un poco más (manda el correo): se puede medir la diferencia; no lo cubrí.
- Las sesiones de CAPRI no se pueden revocar una por una (no se guardan): desactivar a la persona la corta al instante; cambiar
  `SESION_SECRETO` las corta todas.
- No probado en el navegador real (One Tap con FedCM y `auto_select` se comporta distinto con varias cuentas de Google en el
  mismo navegador: ahí Google pide elegir y no es "sin clics").
- Para CLAUDE.md y el Manual (al integrar): §4.1 (sesión de CAPRI y públicas), §4.7 / §10.2 (login CAPRI, localStorage,
  ACCESO), §5 (`SESION_SECRETO`, Delegaciones), §6 (decisiones de arriba) y "Tareas frecuentes" del Manual (dar de alta,
  desactivar, delegar, sacar a todos los @helgen.services).
