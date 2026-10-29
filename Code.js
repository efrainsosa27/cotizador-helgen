/**
 * COTIZADOR HELGEN — Backend (Google Apps Script)
 * ------------------------------------------------
 * - API de la interfaz web (Cloudflare): doPost con sesión de Google verificada
 * - Asigna folios consecutivos sin duplicados (LockService)
 * - Recalcula subtotal / IVA / total en el servidor (no confía en el navegador)
 * - Genera el PDF, lo guarda en Drive y registra la cotización en una hoja
 *
 * La base de datos, el catálogo y la carpeta de PDF se toman de Script Properties (IDs).
 */

// ====== 1. ENTRADA DE LA APP WEB ======

/**
 * La interfaz vive en Cloudflare y todo pasa por doPost con sesión verificada.
 * doGet ya no sirve la app: una página de HtmlService permitiría llamar funciones con google.script.run
 * sin token (el despliegue es ANYONE_ANONYMOUS).
 */
function doGet() {
  return ContentService.createTextOutput('Cotizador Helgen: esta dirección es solo la API. ' +
    'Abre el cotizador en https://cotizador-helgen.cotizador-helgen.workers.dev/cotizador/');
}

// ====== 1.1 SESIÓN: Google Identity Services ======

/**
 * Client ID de OAuth (tipo "Aplicación web") del proyecto de Google Cloud. No es secreto: también va en la interfaz.
 * Debe ser el mismo valor que CLIENT_ID_GOOGLE en web/cotizador/index.html.
 */
const CLIENT_ID_GOOGLE = '884526916417-cn5fh45io0nnpvlad2439thkpius4063.apps.googleusercontent.com';
const DOMINIO_HELGEN = 'helgen.tech';

/** Vendedor de la petición actual, tomado del token verificado en doPost (cada ejecución empieza en null). */
let VENDEDOR_ = null;

/** Correo de quien usa la app: el del token verificado; si no hay (editor), el de la sesión de Google. */
function usuarioActual_() {
  return VENDEDOR_ ? VENDEDOR_.email : Session.getActiveUser().getEmail();
}

/** Error de sesión: la interfaz lo distingue (codigo "SESION") para pedir que se vuelva a iniciar sesión. */
function errorSesion_(mensaje) {
  const err = new Error(mensaje);
  err.sesion = true;
  return err;
}

/**
 * Verifica el ID token con Google (tokeninfo revisa firma y expiración) y luego aud, emisor y dominio.
 * Devuelve {email, nombre, apellido}. El resultado se guarda en caché hasta que el token expire (máx. 10 min)
 * para no consultar a Google en cada llamada.
 */
function verificarTokenGoogle_(idToken) {
  const token = String(idToken || '');
  if (!token) throw errorSesion_('Inicia sesión con tu cuenta @' + DOMINIO_HELGEN + '.');
  if (token.length > 4096) throw errorSesion_('Sesión inválida. Vuelve a iniciar sesión.');
  if (CLIENT_ID_GOOGLE.indexOf('PEGAR_AQUI') === 0) {
    throw new Error('Falta configurar CLIENT_ID_GOOGLE en el servidor.');
  }

  const cache = CacheService.getScriptCache();
  const huella = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  const claveCache = 'TOK_' + huella;
  const previo = cache.get(claveCache);
  if (previo) return JSON.parse(previo);

  const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw errorSesion_('Tu sesión expiró o no es válida. Vuelve a iniciar sesión.');
  let claims;
  try {
    claims = JSON.parse(r.getContentText());
  } catch (err) {
    throw errorSesion_('No se pudo verificar tu sesión. Intenta de nuevo.');
  }

  const ahora = Math.floor(Date.now() / 1000);
  const vendedor = validarClaimsToken(claims, CLIENT_ID_GOOGLE, DOMINIO_HELGEN, ahora);
  const segundos = Math.min(Number(claims.exp) - ahora - 30, 600);
  if (segundos > 0) cache.put(claveCache, JSON.stringify(vendedor), segundos);
  return vendedor;
}

/**
 * Incremento 4 (CAPRI): cada módulo declara en su función mod*_ lo que agrega a la API, sin tocar las listas de aquí:
 *   { nombre, api: {función: función}, cambios: {función: [colecciones]} (CAMBIOS_API), solo: [funciones que puede usar
 *     una cuenta de solo requisiciones], publicas: [funciones sin sesión], bootstrap(permisos, errores) → {campos extra},
 *     sincronizar(permisos, ctx, algo, r, errores) (agrega campos a r), preparar() (lo corre prepararCapri desde el editor) }
 * Las mod*_ son declaraciones de función: se pueden llamar aquí aunque estén más abajo. Dentro de `api` solo van
 * declaraciones de función (una const de más abajo todavía no existe al cargar el archivo).
 */
const MODULOS_ = [modIdentidad_(), modAnular_(), modCorreos_(), modCentroMando_(), modPantallas_()];
/** Une un campo de todos los módulos: objetos con Object.assign, listas con concat. */
function deModulos_(campo, inicial) {
  return MODULOS_.reduce((acc, m) => Array.isArray(inicial) ? acc.concat(m[campo] || []) : Object.assign(acc, m[campo] || {}), inicial);
}

/**
 * Funciones que la interfaz externa (Cloudflare) puede llamar por doPost.
 * Son las mismas que usa google.script.run; nada más (ni setup ni funciones internas con _).
 */
const API_FUNCIONES = Object.assign({
  bootstrap: bootstrap,
  sincronizar: sincronizar,
  getDatosIniciales: getDatosIniciales,
  getClientes: getClientes,
  listarCotizaciones: listarCotizaciones,
  getCatalogo: getCatalogo,
  guardarProducto: guardarProducto,
  guardarCotizacion: guardarCotizacion,
  sugerirClavesSat: sugerirClavesSat,
  listarProyectos: listarProyectos,
  crearProyecto: crearProyecto,
  // Cobranza (solo ROL_COBRANZA; cada función lo revisa)
  listarProyectosCobranza: listarProyectosCobranza,
  getCobranzaProyecto: getCobranzaProyecto,
  resumenCobranzaGeneral: resumenCobranzaGeneral,
  marcarAceptada: marcarAceptada,
  guardarEsquema: guardarEsquema,
  firmarContrato: firmarContrato,
  desbloquearContrato: desbloquearContrato,
  registrarPago: registrarPago,
  cancelarPago: cancelarPago,
  // Compras (solo ROL_COMPRAS; cada función lo revisa). Las órdenes salen de autorizarRequisicion.
  listarProyectosCompras: listarProyectosCompras,
  getComprasProyecto: getComprasProyecto,
  cancelarOrdenCompra: cancelarOrdenCompra,
  listarRequisiciones: listarRequisiciones,
  getRequisicion: getRequisicion,
  autorizarRequisicion: autorizarRequisicion,
  rechazarRequisicion: rechazarRequisicion,
  devolverRequisicion: devolverRequisicion,
  registrarPagoProveedor: registrarPagoProveedor,
  cancelarPagoProveedor: cancelarPagoProveedor,
  cerrarRequisicionCompras: cerrarRequisicionCompras,
  // Facturas de proveedor y cuentas por pagar (solo ROL_COMPRAS; 4.5)
  registrarFacturaProveedor: registrarFacturaProveedor,
  cancelarFacturaProveedor: cancelarFacturaProveedor,
  cambiarDiasCreditoFactura: cambiarDiasCreditoFactura,
  cuentasPorPagar: cuentasPorPagar,
  // Requisiciones del solicitante (ROL_REQUISICION o SOLO_REQUISICION; solo las suyas y las que recibe)
  listarProyectosRequisicion: listarProyectosRequisicion,
  misRequisiciones: misRequisiciones,
  guardarRequisicion: guardarRequisicion,
  cancelarRequisicion: cancelarRequisicion,
  cerrarRequisicion: cerrarRequisicion,
  registrarRecepcion: registrarRecepcion,
  archivoRequisicion: archivoRequisicion,
  // Operaciones (ROL_OPERACIONES; incremento 3): aprobar por renglón, visto bueno a la propuesta de compras
  listarOperaciones: listarOperaciones,
  getRequisicionOperaciones: getRequisicionOperaciones,
  aprobarRequisicion: aprobarRequisicion,
  autorizarPropuesta: autorizarPropuesta,
  regresarACompras: regresarACompras,
  // Compras con operaciones: propuesta, separar renglones y cancelar una recepción
  cotizarRequisicion: cotizarRequisicion,
  separarRequisicion: separarRequisicion,
  cancelarRecepcion: cancelarRecepcion,
}, deModulos_('api', {}));

/**
 * Funciones que se pueden llamar sin sesión (pedir y comprobar el código de acceso de @helgen.services). Cada una se
 * cuida sola (límites por correo); nunca devuelven datos de CAPRI.
 */
const FUNCIONES_PUBLICAS = deModulos_('publicas', []);

/**
 * Funciones de Ventas (cotizar, historial, catálogo, clientes y proyectos): solo con el rol ventas. Cualquier @helgen.tech que
 * no está en Permisos lo tiene, como antes (PERMISOS_SOLO_LISTADOS = '1' lo quita).
 */
const FUNCIONES_VENTAS = ['getClientes', 'listarCotizaciones', 'getCatalogo', 'guardarProducto', 'guardarCotizacion',
  'sugerirClavesSat', 'listarProyectos', 'crearProyecto'];

/**
 * API para la interfaz fuera de Apps Script. Cuerpo (text/plain para evitar la consulta CORS previa):
 * {"funcion": "listarCotizaciones", "args": ["HLG"], "token": "<ID token de Google>"}
 * Respuesta: {"ok": true, "datos": ...} o {"ok": false, "error": "mensaje en español", "codigo": "SESION"?}.
 * Sin un token válido de @helgen.tech no se ejecuta ninguna función.
 */
function doPost(e) {
  let respuesta;
  VENDEDOR_ = null; VERSIONES_ = null; SIN_CACHE_ = false; MEMO_ = {};
  try {
    let cuerpo;
    try {
      cuerpo = JSON.parse((e && e.postData && e.postData.contents) || '');
    } catch (err) {
      throw new Error('Solicitud inválida: el cuerpo debe ser JSON.');
    }
    if (!cuerpo || typeof cuerpo !== 'object') throw new Error('Solicitud inválida: el cuerpo debe ser JSON.');
    const nombre = String(cuerpo.funcion || '');
    // Las públicas (código de acceso) no llevan sesión; todas las demás exigen una sesión válida y una cuenta activa,
    // antes de buscar la función
    const publica = FUNCIONES_PUBLICAS.indexOf(nombre) !== -1;
    if (!publica) {
      VENDEDOR_ = verificarSesion_(cuerpo.token);
      exigirAcceso_();
    }
    if (!Object.prototype.hasOwnProperty.call(API_FUNCIONES, nombre)) {
      throw new Error('Función no permitida: ' + (nombre || '(vacía)') + '.');
    }
    if (!publica) {
      // Cuentas de SOLO_REQUISICION: solo su pestaña (nada de cotizaciones, historial, catálogo, clientes ni proyectos)
      if (FUNCIONES_SOLO_REQUISICION.indexOf(nombre) === -1 && esSoloRequisicion_()) {
        throw errorPermiso_('Tu cuenta solo tiene acceso a Requisiciones.');
      }
      if (FUNCIONES_VENTAS.indexOf(nombre) !== -1 && !tieneRol_('ventas')) {
        throw errorPermiso_('Tu cuenta no tiene acceso a cotizaciones.');
      }
    }
    const args = Array.isArray(cuerpo.args) ? cuerpo.args : [];
    const cambia = CAMBIOS_API[nombre];
    SIN_CACHE_ = !!cambia; // lo que devuelva una escritura sale de la hoja, no del caché
    respuesta = { ok: true, datos: API_FUNCIONES[nombre].apply(null, args) };
    // Sube la versión de lo que cambió: invalida su caché y los demás navegadores lo ven en su siguiente consulta
    if (cambia && !(respuesta.datos && respuesta.datos.confirmar)) subirVersiones_(cambia);
    // Los correos se mandan al final, ya guardado el cambio (si uno falla, el cambio sigue en pie: queda en Correos)
    if (MEMO_.correos && MEMO_.correos.length) {
      try { enviarCorreosPendientes_(); } catch (e) { console.warn('Correos sin mandar: ' + e.message); }
    }
  } catch (err) {
    respuesta = { ok: false, error: err && err.message ? err.message : String(err) };
    if (err && err.sesion) respuesta.codigo = 'SESION';
    // 'PROYECTO' (errorProyecto_), 'PERMISO' (errorPermiso_), 'ACCESO' (cuenta dada de baja o sin alta en Permisos)
    else if (err && err.codigo) respuesta.codigo = err.codigo;
  } finally {
    VENDEDOR_ = null; VERSIONES_ = null; SIN_CACHE_ = false; MEMO_ = {};
  }
  return ContentService.createTextOutput(JSON.stringify(respuesta)).setMimeType(ContentService.MimeType.JSON);
}

// ====== 1.2 USUARIOS, ROLES Y DELEGACIONES (CAPRI, incremento 4) ======
// Quién entra y qué puede hacer sale de la pestaña Permisos del libro "CAPRI — Administración" (privado, como compras).
// Mientras ese libro no exista (antes de correr prepararCapri), los roles salen de Script Properties como siempre
// (ROL_*, SOLO_REQUISICION, ADMIN_DESBLOQUEO): usuariosDesdePropiedades da exactamente los mismos permisos.
// SUPER_ADMIN (Script Properties) = super admin raíz: no se puede quitar desde la página y nunca queda fuera.
// Cada función sigue revisando su rol en el servidor; todo pasa por tieneRol_ (con super admin y delegaciones).

const DOMINIO_SERVICIOS = 'helgen.services';
const DOMINIOS_CAPRI = [DOMINIO_HELGEN, DOMINIO_SERVICIOS];
/** Prefijo de las sesiones propias de CAPRI (cuentas @helgen.services que entran con código por correo). */
const PREFIJO_SESION_CAPRI = 'capri.';

const NOMBRE_CARPETA_ADMIN = 'CAPRI — Administración';
const NOMBRE_LIBRO_ADMIN = 'CAPRI — Administración (datos)';
/** Libro de Administración: Permisos, Delegaciones, Correos (bitácora de avisos), Anulaciones y Bitacora. */
const HOJAS_ADMIN = {
  // roles = lista separada por coma (ROLES_CAPRI); metodo = google (@helgen.tech) o codigo (@helgen.services);
  // sitio = código del sitio de la persona (VER, ZLO…; opcional); activo = Sí / No
  Permisos: { enc: ['correo', 'nombre', 'metodo', 'roles', 'sitio', 'activo', 'notas', 'actualizo', 'actualizado'], numeros: [] },
  // de entrega a "a" sus roles delegables (Aprobaciones, Compras) del día desde al día hasta (AAAA-MM-DD); estado Activa / Cancelada
  Delegaciones: { enc: ['id', 'de', 'a', 'desde', 'hasta', 'roles', 'estado', 'creo', 'creado', 'cancelo', 'motivo_cancelacion'],
    numeros: [] },
  Correos: { enc: ['fecha', 'para', 'asunto', 'tipo', 'folio', 'estado', 'error', 'actor'], numeros: [] },
  Anulaciones: { enc: ['fecha', 'correo', 'tipo', 'folio', 'motivo', 'cascada (JSON)', 'antes (JSON)'], numeros: [] },
  Bitacora: { enc: ['fecha', 'correo', 'accion', 'proyecto_folio', 'detalle', 'motivo'], numeros: [] },
};
const AREA_ADMIN = { que: 'administración', propCarpeta: 'ADMIN_FOLDER_ID', propLibro: 'ADMIN_DB_ID',
  carpeta: NOMBRE_CARPETA_ADMIN, libro: NOMBRE_LIBRO_ADMIN, hojas: HOJAS_ADMIN };

function libroAdmin_() { return libroArea_(AREA_ADMIN); }
/** Libro de Administración si ya existe; null si todavía no (los roles salen entonces de Script Properties). */
function libroAdminSiExiste_() { return libroAreaSiExiste_(AREA_ADMIN); }
function hojaAdmin_(libro, nombre) { return hojaDeArea_(libro, HOJAS_ADMIN, nombre); }
/** Renglón en la Bitacora del libro de Administración. */
function bitacoraAdmin_(accion, folio, detalle, motivo) { bitacora_(libroAdmin_(), accion, folio, detalle, motivo, HOJAS_ADMIN); }

/** {correo: usuario} de Permisos (o de Script Properties si todavía no hay libro). Por petición y en caché por versión. */
function usuariosCapri_(revisar) {
  if (!propiedades_()[AREA_ADMIN.propLibro]) return usuariosDesdePropiedades(propiedades_());
  return fuenteConHuella_('usuarios', 'permisos', 300, () => {
    const libro = libroAdminSiExiste_();
    return usuariosDesdeFilas(filasDeArea_(hojaAdmin_(libro, 'Permisos'), HOJAS_ADMIN, 'Permisos'));
  }, revisar);
}

/** Delegaciones (todas; rolesEfectivos usa las activas de hoy). Sin libro de Administración: ninguna. */
function delegacionesCapri_(revisar) {
  if (!propiedades_()[AREA_ADMIN.propLibro]) return [];
  return fuenteConHuella_('delegaciones', 'permisos', 300, () => {
    const libro = libroAdminSiExiste_();
    return delegacionesDesdeFilas(filasDeArea_(hojaAdmin_(libro, 'Delegaciones'), HOJAS_ADMIN, 'Delegaciones'));
  }, revisar);
}

/** Todo lo que rolesEfectivos necesita, leído una vez por petición. */
function contextoRoles_() {
  if (!MEMO_.ctxRoles) {
    const p = propiedades_();
    MEMO_.ctxRoles = { usuarios: usuariosCapri_(), delegaciones: delegacionesCapri_(), hoy: hoyIso_(),
      superAdmins: correosCapri(p.SUPER_ADMIN), soloListados: String(p.PERMISOS_SOLO_LISTADOS || '') === '1' };
  }
  return MEMO_.ctxRoles;
}

/** {activo, listado, roles, superadmin, delegaciones} del usuario de la sesión (sin sesión: nada). */
function rolesYo_() {
  if (!VENDEDOR_) return { activo: false, listado: false, roles: [], superadmin: false, delegaciones: [] };
  if (!MEMO_.rolesYo || MEMO_.rolesYoDe !== VENDEDOR_.email) {
    MEMO_.rolesYo = rolesEfectivos(VENDEDOR_.email, contextoRoles_());
    MEMO_.rolesYoDe = VENDEDOR_.email;
  }
  return MEMO_.rolesYo;
}

/** ¿El usuario de la sesión tiene el rol hoy (propio, por ser super admin o por una delegación vigente)? */
function tieneRol_(rol) {
  return rolesYo_().roles.indexOf(rol) !== -1;
}

function esSuperAdmin_() { return tieneRol_('superadmin'); }

function exigirSuperAdmin_() {
  if (!VENDEDOR_) throw errorSesion_('Inicia sesión para continuar.');
  if (!esSuperAdmin_()) throw errorPermiso_('Solo un super admin puede hacer esto.');
}

/** Error de acceso: la cuenta no está dada de alta o está desactivada (codigo 'ACCESO'; la interfaz no reintenta). */
function errorAcceso_(mensaje) {
  const e = new Error(mensaje);
  e.codigo = 'ACCESO';
  return e;
}

/** Corta toda llamada de una cuenta sin acceso: desactivarla en Permisos surte efecto en su siguiente clic. */
function exigirAcceso_() {
  const r = rolesYo_();
  if (r.activo) return;
  throw errorAcceso_(r.listado ? 'Tu acceso a CAPRI está desactivado. Pide ayuda a un administrador.'
    : 'Tu cuenta no tiene acceso a CAPRI. Pide a un administrador que te dé de alta.');
}

/**
 * Sesión de la petición: un ID token de Google (@helgen.tech) o una sesión propia de CAPRI (@helgen.services, empieza con
 * PREFIJO_SESION_CAPRI; la verifica el módulo de identidad). Devuelve {email, nombre, apellido} o lanza errorSesion_.
 */
function verificarSesion_(token) {
  const t = String(token || '');
  if (t.indexOf(PREFIJO_SESION_CAPRI) === 0) return verificarSesionCapri_(t);
  return verificarTokenGoogle_(t);
}

/** Correos activos que hoy tienen el rol (con super admin y delegaciones): a quién avisar o quién puede recibir. */
function correosConRol_(rol) {
  const ctx = contextoRoles_();
  const candidatos = Object.keys(ctx.usuarios).concat(ctx.superAdmins, ctx.delegaciones.map(d => d.a));
  return candidatos.filter((c, i) => candidatos.indexOf(c) === i)
    .filter(c => rolesEfectivos(c, ctx).roles.indexOf(rol) !== -1).sort();
}

/** Usuario de Permisos por correo (null si no está). */
function usuarioCapri_(correo) {
  return contextoRoles_().usuarios[String(correo || '').trim().toLowerCase()] || null;
}

/** Nombre para mostrar de un correo (el de Permisos; si no, el correo). */
function nombreDeCorreo_(correo) {
  const u = usuarioCapri_(correo);
  return (u && u.nombre) || String(correo || '');
}

/**
 * Pasa por alto una regla de separación de funciones (aprobar lo propio, dar el visto bueno a lo que uno preparó) solo si
 * quien lo hace es super admin y escribe el motivo (≥ 10 caracteres); queda en la Bitacora de Administración. Devuelve true
 * si se permitió; false si no aplica (no es super admin o no dio motivo) y la función lanza su error de siempre.
 */
function excepcionSuperAdmin_(regla, folio, motivo) {
  const m = String(motivo == null ? '' : motivo).trim();
  if (!esSuperAdmin_() || m.length < 10) return false;
  if (libroAdminSiExiste_()) bitacoraAdmin_('Excepción de super admin: ' + regla, folio, '', m);
  return true;
}

/**
 * Correr una vez desde el editor (Efrain) antes de publicar el incremento 4: crea el libro de Administración (privado),
 * copia los roles de Script Properties a Permisos (si está vacía), pone SUPER_ADMIN = leo@helgen.tech si no hay y corre
 * lo que cada módulo necesita (autorizar el permiso de correo, activador de 15 minutos…). No comparte nada.
 */
function prepararCapri() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SUPER_ADMIN')) props.setProperty('SUPER_ADMIN', 'leo@helgen.tech');
  const libro = libroAdmin_();
  privado_(carpetaArea_(AREA_ADMIN));
  privado_(DriveApp.getFileById(libro.getId()));
  Object.keys(HOJAS_ADMIN).forEach(n => hojaAdmin_(libro, n));
  const migrados = migrarPermisos_(libro);
  console.log('Libro de Administración: ' + libro.getUrl());
  console.log('Usuarios copiados a Permisos: ' + migrados + ' · SUPER_ADMIN = ' + props.getProperty('SUPER_ADMIN'));
  MEMO_ = {};
  MODULOS_.forEach(m => { if (m.preparar) { console.log('— ' + (m.nombre || 'módulo')); m.preparar(); } });
  subirVersiones_(['permisos']);
}

/** Copia los roles de Script Properties a Permisos solo si la pestaña está vacía (no pisa lo que ya se editó). */
function migrarPermisos_(libro) {
  const hoja = hojaAdmin_(libro, 'Permisos');
  if (hoja.getLastRow() > 1) return 0;
  const usuarios = usuariosDesdePropiedades(PropertiesService.getScriptProperties().getProperties());
  const ahora = Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss');
  const filas = Object.keys(usuarios).sort().map(c => filaDeUsuario(usuarios[c], 'migración', ahora).map(textoCelda));
  if (filas.length) hoja.getRange(2, 1, filas.length, HOJAS_ADMIN.Permisos.enc.length).setValues(filas);
  return filas.length;
}

/** Sitios con código, nombre y dirección (Config → SITIOS). */
function sitiosDetalle_() {
  return sitiosDetalleDeTexto(configLigera_().sitios);
}

// ====== 1.1 CARGA INICIAL, CACHÉ Y SINCRONIZACIÓN ======
// bootstrap() es la única llamada al entrar: roles + listas según el rol. Las listas se guardan en CacheService con la
// versión de sus colecciones en la clave; cada escritura sube la versión (doPost, CAMBIOS_API) y así invalida su caché.
// sincronizar() recibe las versiones del navegador y devuelve solo lo que cambió, respetando los roles: la interfaz lo
// consulta cada 20 s con la pestaña visible, sin recargar. Los permisos se siguen revisando en cada función.

// permisos: Permisos y Delegaciones (incremento 4); anulaciones: lo que un super admin anuló (se esconde de listas y totales)
const COLECCIONES = ['proyectos', 'contratos', 'cotizaciones', 'catalogo', 'requisiciones', 'oc', 'pagosCobranza',
  'pagosProveedores', 'facturasProveedor', 'permisos', 'anulaciones'];

/** Colecciones que cambia cada función de la API: doPost sube su versión cuando termina bien. */
const CAMBIOS_API = Object.assign({
  guardarCotizacion: ['cotizaciones'], guardarProducto: ['catalogo'], crearProyecto: ['proyectos'],
  marcarAceptada: ['contratos'], guardarEsquema: ['contratos'], firmarContrato: ['contratos'],
  desbloquearContrato: ['contratos'], registrarPago: ['pagosCobranza'], cancelarPago: ['pagosCobranza'],
  cancelarOrdenCompra: ['oc', 'requisiciones'], guardarRequisicion: ['requisiciones'],
  cancelarRequisicion: ['requisiciones'], cerrarRequisicion: ['requisiciones', 'oc'],
  autorizarRequisicion: ['requisiciones', 'oc'], rechazarRequisicion: ['requisiciones'],
  devolverRequisicion: ['requisiciones'], registrarPagoProveedor: ['pagosProveedores', 'requisiciones', 'oc'],
  cancelarPagoProveedor: ['pagosProveedores', 'requisiciones', 'oc'], cerrarRequisicionCompras: ['requisiciones', 'oc'],
  registrarFacturaProveedor: ['facturasProveedor'], cancelarFacturaProveedor: ['facturasProveedor'],
  cambiarDiasCreditoFactura: ['facturasProveedor'],
  aprobarRequisicion: ['requisiciones'], cotizarRequisicion: ['requisiciones'], autorizarPropuesta: ['requisiciones', 'oc'],
  regresarACompras: ['requisiciones'], separarRequisicion: ['requisiciones'], registrarRecepcion: ['requisiciones', 'oc'],
  cancelarRecepcion: ['requisiciones', 'oc'],
}, deModulos_('cambios', {}));

let VERSIONES_ = null;   // versiones leídas en esta petición (doPost las limpia)
let SIN_CACHE_ = false;  // durante una escritura las listas se leen de la hoja (su versión todavía no sube)
let MEMO_ = {};          // lo ya leído en esta petición (Script Properties, hojas en caché); doPost lo limpia

/** Script Properties de esta petición (una sola lectura; roles y versiones salen de aquí). */
function propiedades_(releer) {
  if (!MEMO_.props || releer) MEMO_.props = PropertiesService.getScriptProperties().getProperties();
  return MEMO_.props;
}

/** {proyectos: 12, contratos: 3, …} desde Script Properties (VER_<colección>). */
function versiones_(releer) {
  if (!VERSIONES_ || releer) {
    const props = propiedades_(releer);
    VERSIONES_ = {};
    COLECCIONES.forEach(c => { VERSIONES_[c] = Number(props['VER_' + c]) || 0; });
  }
  return VERSIONES_;
}

/**
 * Sube la versión de las colecciones con el candado de script (nunca se pierde un aumento). Se llama después de escribir,
 * así quien lea la versión nueva ya encuentra los datos nuevos. No llamarla con el candado tomado.
 */
function subirVersiones_(colecciones) {
  if (!colecciones || !colecciones.length) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { console.warn('Sin candado: no subió la versión de ' + colecciones.join(', ')); return; }
  try {
    const props = PropertiesService.getScriptProperties();
    const nuevas = {};
    colecciones.forEach(c => { nuevas['VER_' + c] = String((Number(props.getProperty('VER_' + c)) || 0) + 1); });
    props.setProperties(nuevas);
  } finally {
    lock.releaseLock();
    VERSIONES_ = null; MEMO_.props = null;
  }
}

const TROZO_CACHE = 30000; // caracteres por entrada (CacheService admite 100 KB por valor; un acento ocupa 2 bytes)

/** Lee un valor JSON guardado en trozos por guardarCache_; undefined si no está o le falta un trozo. */
function leerCache_(clave) {
  const cache = CacheService.getScriptCache();
  const meta = cache.get(clave);
  if (!meta || !/^N:\d+$/.test(meta)) return undefined;
  const claves = [];
  for (let i = 0; i < Number(meta.slice(2)); i++) claves.push(clave + '#' + i);
  const trozos = cache.getAll(claves);
  if (claves.some(k => trozos[k] == null)) return undefined;
  try {
    return JSON.parse(claves.map(k => trozos[k]).join(''));
  } catch (e) {
    return undefined;
  }
}

function guardarCache_(clave, valor, ttl) {
  try {
    const texto = JSON.stringify(valor), datos = {};
    let n = 0;
    for (let i = 0; i < texto.length; i += TROZO_CACHE) datos[clave + '#' + (n++)] = texto.slice(i, i + TROZO_CACHE);
    if (n > 30) return; // demasiado grande: se seguirá leyendo de la hoja
    const cache = CacheService.getScriptCache();
    if (n) cache.putAll(datos, ttl);
    cache.put(clave, 'N:' + n, ttl); // al final: si la ve otra petición, los trozos ya están
  } catch (e) {
    console.warn('No se guardó en caché ' + clave + ': ' + e.message);
  }
}

/** Colecciones que también se editan a mano en la hoja: antes de usar su versión se revisa su huella (fuenteConHuella_). */
const REVISAR_A_MANO_ = { proyectos: () => proyectosCache_(), contratos: () => contratosCache_(),
  catalogo: () => catalogoCache_(), cotizaciones: () => clientesCache_() };

/** Clave de caché con las versiones de sus colecciones (si cambia una, es otra clave: la anterior ya no se usa). */
function claveCache_(base, colecciones) {
  colecciones.forEach(c => { if (REVISAR_A_MANO_[c]) REVISAR_A_MANO_[c](); }); // si alguien editó la hoja, sube su versión
  const v = versiones_();
  const clave = 'K_' + base + '_' + colecciones.map(c => v[c]).join('.');
  if (clave.length <= 200) return clave;
  return 'K_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, clave));
}

/** Valor en caché para estas versiones o, si no está, fn() (y se guarda). Sin fn: solo lee (undefined si no está). */
function enCache_(base, colecciones, ttl, fn) {
  if (SIN_CACHE_) return fn ? fn() : undefined;
  const clave = claveCache_(base, colecciones);
  const previo = leerCache_(clave);
  if (previo !== undefined || !fn) return previo;
  const valor = fn();
  guardarCache_(clave, valor, ttl);
  return valor;
}

const TTL_CACHE = 21600; // 6 h (lo máximo de CacheService): cada escritura sube la versión y cambia la clave

/**
 * Como enCache_, para hojas que también se editan a mano (Estado del proyecto, precios del catálogo, filas borradas).
 * El dato dura 6 h; con revisar (solo desde sincronizar, que corre en segundo plano y nadie lo espera), si pasaron más de
 * cadaSeg segundos desde la última revisión se vuelve a leer la hoja: si cambió sin que la app escribiera (misma versión,
 * otra huella), sube la versión para que los navegadores abiertos se enteren. Así la carga inicial nunca lee la hoja de más.
 */
function fuenteConHuella_(nombre, coleccion, cadaSeg, leer, revisar) {
  if (SIN_CACHE_) return leer();
  const memo = MEMO_['F_' + nombre];
  if (memo && (!revisar || memo.revisado)) return memo.valor;
  const cache = CacheService.getScriptCache();
  const v = versiones_()[coleccion];
  const previo = leerCache_('F_' + nombre + '_' + v);
  if (previo !== undefined && (!revisar || cache.get('R_' + nombre))) {
    MEMO_['F_' + nombre] = { valor: previo, revisado: !!revisar };
    return previo;
  }
  const valor = leer();
  const huella = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(valor)));
  const anterior = String(cache.get('H_' + nombre) || '').split('|');
  let version = v;
  if (anterior.length === 2 && Number(anterior[0]) === v && anterior[1] !== huella) {
    subirVersiones_([coleccion]); // alguien la editó directo en la hoja
    version = versiones_()[coleccion];
  }
  guardarCache_('F_' + nombre + '_' + version, valor, TTL_CACHE);
  cache.put('H_' + nombre, version + '|' + huella, TTL_CACHE);
  cache.put('R_' + nombre, '1', cadaSeg);
  MEMO_['F_' + nombre] = { valor: valor, revisado: true };
  return valor;
}

/** Todos los proyectos de la pestaña Proyectos (con carpetaId: solo para uso interno). */
function proyectosCache_(revisar) {
  return fuenteConHuella_('proyectos', 'proyectos', 300, () => {
    const hoja = hojaProyectos_();
    const filas = hoja.getLastRow() > 1
      ? hoja.getRange(2, 1, hoja.getLastRow() - 1, ENCABEZADOS_PROYECTOS.length).getValues() : [];
    return proyectosDesdeFilas(filas);
  }, revisar);
}

/** {folio: proyecto} con los proyectos en caché. */
function mapaProyectos_() {
  const mapa = {};
  proyectosCache_().forEach(p => { mapa[p.folio.toUpperCase()] = p; });
  return mapa;
}

/** Lo que la interfaz recibe de un proyecto (sin carpeta_id). */
function proyectoParaLista_(p) {
  return { folio: p.folio, clave: p.clave, folioVisible: p.folioVisible, nombre: p.nombre, cliente: p.cliente,
    clienteId: p.clienteId, ubicacion: p.ubicacion, estado: p.estado, fecha: p.fecha };
}

/** {folio: {estado, moneda, marca}} de todos los contratos (aceptados y firmados). Sin libro de cobranza: ninguno. */
function contratosCache_(revisar) {
  return fuenteConHuella_('contratos', 'contratos', 600, () => {
    const mapa = {}, todos = contratosDelLibro_();
    Object.keys(todos).forEach(f => { mapa[f] = { estado: todos[f].estado, moneda: todos[f].moneda, marca: todos[f].marca }; });
    return mapa;
  }, revisar);
}

/** Catálogo de productos con su tipo de cambio (los precios también se editan en la hoja). */
function catalogoCache_(revisar) {
  return fuenteConHuella_('catalogo', 'catalogo', 600, () => {
    const hoja = hojaCatalogo_();
    return { productos: getCatalogo_(hoja), tipoCambio: tipoCambioCatalogo_(hoja) };
  }, revisar);
}

/** Clientes sugeridos (salen de la hoja Cotizaciones). */
function clientesCache_(revisar) {
  return fuenteConHuella_('clientes', 'cotizaciones', 600, getClientes, revisar);
}

/** IVA y vigencia para la interfaz (la Config completa se sigue leyendo fresca al guardar). */
function configLigera_() {
  return enCache_('config2', [], 600, () => { // 10 min: la lista de sitios se edita a mano en Config
    const cfg = getConfig_();
    return { ivaTasa: cfg.IVA_TASA, vigenciaDias: cfg.VIGENCIA_DIAS, sitios: String(cfg.SITIOS == null ? '' : cfg.SITIOS) };
  });
}

/**
 * Permisos del usuario de la sesión (solo para mostrar pestañas: cada función los vuelve a revisar). Salen de rolesYo_()
 * (Permisos + super admin + delegaciones). operaciones = Aprobaciones (también con SOLO_REQUISICION); flujoOperaciones: qué
 * flujo de requisiciones ve la interfaz; ventas: Nueva cotización, Historial y Catálogo; superadmin: Administración.
 */
function permisosUsuario_() {
  const op = { operaciones: esOperaciones_(), flujoOperaciones: flujoOperaciones_() };
  const extra = { ventas: tieneRol_('ventas'), superadmin: esSuperAdmin_() };
  if (esSoloRequisicion_()) return Object.assign({ cobranza: false, desbloqueo: false, compras: false, requisicion: true }, op, extra);
  return Object.assign({ cobranza: esCobranza_(), desbloqueo: esAdminDesbloqueo_(), compras: esCompras_(), requisicion: esRequisicion_() }, op, extra);
}

/** Catálogo sin precios (para sugerir descripción y unidad en requisiciones). */
const catalogoSinPrecios_ = productos => productos.map(p => ({ clave: p.clave, descripcion: p.descripcion, unidad: p.unidad }));

/** Corre f() y, si falla, anota el error y devuelve null (una lista que falla no tumba toda la carga). */
function intentar_(errores, que, f) {
  try {
    return f();
  } catch (e) {
    errores.push(que + ': ' + e.message);
    return null;
  }
}

/**
 * Carga inicial en una sola llamada: roles y, según el rol, catálogo, clientes y proyectos (cotizar), proyectos y "mis
 * requisiciones" (requisiciones), proyectos, requisiciones y cuentas por pagar (compras), proyectos y resumen (cobranza);
 * las listas pesadas solo si ya están en caché.
 * Con SOLO_REQUISICION: solo lo de requisiciones y el catálogo sin precios.
 */
function bootstrap() {
  if (!VENDEDOR_) throw errorSesion_('Inicia sesión con tu cuenta @' + DOMINIO_HELGEN + '.');
  const permisos = permisosUsuario_(), solo = esSoloRequisicion_(), errores = [];
  const cfg = configLigera_(), cat = catalogoCache_();
  const conPrecios = !solo && (permisos.ventas || permisos.compras || permisos.cobranza);
  const d = {
    versiones: versiones_(), permisos: permisos, soloRequisicion: solo, usuario: usuarioActual_(), vendedor: VENDEDOR_,
    ivaTasa: cfg.ivaTasa, vigenciaDias: cfg.vigenciaDias, marcas: MARCAS, sitios: sitiosDeTexto(cfg.sitios),
    sitiosDetalle: sitiosDetalleDeTexto(cfg.sitios),
    catalogo: conPrecios ? cat.productos : catalogoSinPrecios_(cat.productos), tipoCambio: conPrecios ? cat.tipoCambio : null,
    clientes: [], proyectos: [], errores: errores,
  };
  if (!solo && permisos.ventas) {
    d.clientes = intentar_(errores, 'Clientes', clientesCache_) || [];
    d.proyectos = intentar_(errores, 'Proyectos', () => listarProyectos('', false)) || [];
  }
  // Las listas de requisiciones y el resumen de cobranza solo van si ya están en caché (lo normal): con el caché vacío
  // (nadie entró en horas) costarían varios segundos, y la interfaz los pide al abrir su pestaña
  if (permisos.requisicion) {
    d.req = { proyectos: intentar_(errores, 'Proyectos de requisiciones', () => listarProyectosRequisicion('')),
      mias: intentar_(errores, 'Mis requisiciones', () => misRequisiciones(true)) };
  }
  if (permisos.operaciones) {
    d.ops = { requisiciones: intentar_(errores, 'Requisiciones de operaciones', () => listarOperaciones(true)) };
  }
  if (permisos.compras) {
    d.com = { proyectos: intentar_(errores, 'Proyectos de compras', () => listarProyectosCompras('')),
      requisiciones: intentar_(errores, 'Requisiciones', () => listarRequisiciones('', '', true)),
      cxp: intentar_(errores, 'Cuentas por pagar', () => cuentasPorPagar(true)) };
  }
  if (permisos.cobranza) {
    d.cob = { proyectos: intentar_(errores, 'Proyectos de cobranza', () => listarProyectosCobranza('')),
      resumen: intentar_(errores, 'Resumen de cobranza', () => resumenCobranzaGeneral(true)) };
  }
  // Incremento 4: lo que agrega cada módulo (pendientes, ítems del centro de mando…); si uno falla, la carga sigue
  MODULOS_.forEach(m => {
    if (m.bootstrap) Object.assign(d, intentar_(errores, m.nombre || 'módulo', () => m.bootstrap(permisos, errores)) || {});
  });
  return d;
}

/** Nombre anterior de la carga inicial (por si un navegador tiene la interfaz vieja en caché). */
function getDatosIniciales() {
  return bootstrap();
}

/**
 * Consulta ligera de la interfaz (cada 20 s con la pestaña visible, al cambiar de pestaña y al abrir un buscador de
 * proyectos). vc = versiones que tiene el navegador; ctx = lo que está viendo {cobProyecto, cobResumen, comProyecto, req,
 * rcBuscar, rcEstado, cxp, opsReq}. Devuelve las versiones, los permisos y solo las listas o vistas que cambiaron y que su rol puede ver.
 */
function sincronizar(vc, ctx) {
  if (!VENDEDOR_) throw errorSesion_('Inicia sesión con tu cuenta @' + DOMINIO_HELGEN + '.');
  vc = vc || {}; ctx = ctx || {};
  const permisos = permisosUsuario_(), solo = esSoloRequisicion_(), errores = [];
  // Hojas que se editan a mano: cada pocos minutos (para todos) se releen y, si cambiaron, sube su versión
  intentar_(errores, 'Proyectos', () => proyectosCache_(true));
  intentar_(errores, 'Permisos', () => { usuariosCapri_(true); delegacionesCapri_(true); });
  if (permisos.cobranza || permisos.compras) intentar_(errores, 'Contratos', () => contratosCache_(true));
  intentar_(errores, 'Catálogo', () => catalogoCache_(true));
  if (!solo) intentar_(errores, 'Clientes', () => clientesCache_(true));
  const v = versiones_(true);
  const cambio = c => String(vc[c] == null ? '' : vc[c]) !== String(v[c]);
  const r = { versiones: v, permisos: permisos, soloRequisicion: solo, cambios: COLECCIONES.filter(cambio), errores: errores };
  if (permisos.requisicion || permisos.compras || permisos.operaciones) {
    r.sitios = intentar_(errores, 'Sitios', sitios_) || undefined;
    r.sitiosDetalle = intentar_(errores, 'Sitios', sitiosDetalle_) || undefined;
  }
  // Cuentas por pagar dependen también del día (días vencidos y rangos): se vuelven a mandar al cambiar la fecha
  const otroDiaCxp = !!(permisos.compras && ctx.cxp && ctx.cxpHoy && ctx.cxpHoy !== hoyIso_());
  if (!r.cambios.length && !otroDiaCxp) return r;
  const algo = (...cs) => cs.some(cambio);

  const conPrecios = !solo && (permisos.ventas || permisos.compras || permisos.cobranza);
  if (algo('catalogo')) {
    const cat = catalogoCache_();
    r.catalogo = conPrecios ? cat.productos : catalogoSinPrecios_(cat.productos);
    if (conPrecios) r.tipoCambio = cat.tipoCambio;
  }
  if (!solo && permisos.ventas) {
    if (algo('cotizaciones')) r.clientes = intentar_(errores, 'Clientes', clientesCache_);
    if (algo('proyectos', 'contratos')) r.proyectos = intentar_(errores, 'Proyectos', () => listarProyectos('', false));
  }
  if (permisos.requisicion) {
    if (algo('proyectos')) r.reqProyectos = intentar_(errores, 'Proyectos de requisiciones', () => listarProyectosRequisicion(''));
    if (algo('requisiciones', 'oc', 'pagosProveedores', 'proyectos')) r.misReq = intentar_(errores, 'Mis requisiciones', misRequisiciones);
  }
  if (permisos.operaciones) {
    if (algo('requisiciones', 'oc', 'proyectos')) r.opsRequisiciones = intentar_(errores, 'Requisiciones de operaciones', () => listarOperaciones());
    if (ctx.opsReq && algo('requisiciones', 'oc', 'proyectos')) {
      r.opsRequisicion = intentar_(errores, 'Requisición (operaciones)', () => getRequisicionOperaciones(ctx.opsReq));
    }
  }
  if (permisos.compras) {
    if (algo('proyectos', 'contratos')) r.comProyectos = intentar_(errores, 'Proyectos de compras', () => listarProyectosCompras(''));
    if (algo('requisiciones', 'oc', 'pagosProveedores', 'proyectos')) {
      r.comRequisiciones = intentar_(errores, 'Requisiciones', () => listarRequisiciones(ctx.rcBuscar || '', ctx.rcEstado || ''));
    }
    if (ctx.req && algo('requisiciones', 'oc', 'pagosProveedores', 'proyectos', 'facturasProveedor')) {
      r.requisicion = intentar_(errores, 'Requisición', () => getRequisicion(ctx.req));
    }
    if (ctx.comProyecto && algo('oc', 'contratos', 'proyectos', 'facturasProveedor', 'pagosProveedores')) {
      r.comprasProyecto = intentar_(errores, 'Órdenes del proyecto', () => getComprasProyecto(ctx.comProyecto));
    }
    if (ctx.cxp && (otroDiaCxp || algo('facturasProveedor', 'oc', 'pagosProveedores', 'proyectos'))) {
      r.cxp = intentar_(errores, 'Cuentas por pagar', () => cuentasPorPagar());
    }
  }
  if (permisos.cobranza) {
    if (algo('proyectos', 'contratos')) r.cobProyectos = intentar_(errores, 'Proyectos de cobranza', () => listarProyectosCobranza(''));
    if (ctx.cobProyecto && algo('proyectos', 'contratos', 'cotizaciones', 'pagosCobranza', 'oc')) {
      r.cobranzaProyecto = intentar_(errores, 'Cobranza del proyecto', () => getCobranzaProyecto(ctx.cobProyecto));
    }
    if (ctx.cobResumen && algo('proyectos', 'contratos', 'pagosCobranza', 'oc')) {
      r.resumen = intentar_(errores, 'Resumen de cobranza', () => resumenCobranzaGeneral());
    }
  }
  // Incremento 4: cada módulo agrega a r lo suyo que cambió (respetando los mismos roles que sus funciones)
  MODULOS_.forEach(m => {
    if (m.sincronizar) intentar_(errores, m.nombre || 'módulo', () => m.sincronizar(permisos, ctx, algo, r, errores));
  });
  return r;
}

// ====== 2. INSTALACIÓN (ejecutar 1 sola vez) ======

const TERMINO_VIGENCIA =
  'Precios vigentes por 15 días o hasta agotar existencias, sujetos a variaciones en costos de suministro de componentes.';

const TERMINOS_OC_INICIALES =
  'Favor de indicar el folio de esta orden en su factura.\n' +
  'Facturar a nombre de la razón social y RFC indicados arriba.\n' +
  'Precios fijos según esta orden; cualquier cambio requiere una nueva orden.\n' +
  'Entregar en el lugar y fecha indicados.';

/** Sitios donde se recibe material al empezar (Config → SITIOS; se editan en la hoja, uno por renglón). */
// Un sitio por renglón: código de 3 letras (el del centro de mando) | nombre | dirección opcional (para la solicitud de cotización)
const SITIOS_INICIALES = 'QRO | Querétaro\nZLO | Manzanillo (TIMSA)\nESE | Ensenada (EIT)\nLZC | Lázaro Cárdenas (LCT)\nVER | Veracruz (ICAVE)';

/** Líneas de negocio: Helgen (general) y Helgen Energy (submarca de paneles solares). */
const MARCAS = { helgen: 'Helgen', energy: 'Helgen Energy' };

const CONFIG_INICIAL = [
  ['EMPRESA_NOMBRE', 'Helgen Servicios Especializados'],
  ['EMPRESA_RFC', 'HSE240304PC1'],
  ['EMPRESA_DIRECCION', 'Sendero del Regocijo 32 int 1, Milenio III, Querétaro, Querétaro, 76060'],
  ['EMPRESA_TELEFONO', '+52 442 644 5391'],
  ['EMPRESA_EMAIL', 'contacto@helgen.tech'],
  ['EMPRESA_WEB', 'helgen.tech'],
  ['PREFIJO_FOLIO', 'HLG'],
  ['IVA_TASA', 0.16],
  ['VIGENCIA_DIAS', 15],
  ['MONEDA', 'MXN'],
  ['LOGO_FILE_ID', ''], // Opcional: ID de un logo en Drive (para fondo blanco) que reemplaza el de Logo.gs
  // Términos por línea de negocio (un renglón por término)
  ['TERMINOS_HELGEN', TERMINO_VIGENCIA],
  ['TERMINOS_ENERGY',
    'Metraje adicional: $300 MXN por metro después de 25 m.\n' +
    'Centro de carga: cambios o actualizaciones no incluidos (se cotizan por separado).\n' +
    'Obra civil: se cotiza por separado según las condiciones arquitectónicas del inmueble.\n' +
    TERMINO_VIGENCIA],
  // Términos al pie de las órdenes de compra (iguales en Helgen y Helgen Energy)
  ['TERMINOS_OC', TERMINOS_OC_INICIALES],
  // Sitios donde se recibe material de las requisiciones (uno por renglón dentro de la celda)
  ['SITIOS', SITIOS_INICIALES],
];

/** Valores de ejemplo de versiones anteriores: si siguen en Config, se cambian por los datos reales. */
const CONFIG_EJEMPLO_ANTERIOR = {
  EMPRESA_NOMBRE: 'Helgen Technologies',
  EMPRESA_RFC: 'XAXX010101000',
  EMPRESA_DIRECCION: 'Calle, número, colonia, municipio, estado, C.P.',
  EMPRESA_TELEFONO: '+52 000 000 0000',
};

const ENCABEZADOS_COTIZACIONES = [
  'Folio', 'Fecha', 'Cliente', 'Empresa', 'RFC', 'Correo', 'Teléfono',
  'Subtotal', 'IVA', 'Total', 'Elaboró', 'PDF', 'Conceptos (JSON)', 'Notas', 'Marca', 'Dirección',
  'vendedor_email', 'vendedor_nombre', 'vendedor_apellido', 'proyecto_folio', 'moneda', 'tipo_cambio'
];

function setup() {
  const props = PropertiesService.getScriptProperties();

  // Hoja de cálculo = base de datos
  let ss;
  if (props.getProperty('SPREADSHEET_ID')) {
    ss = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
  } else {
    ss = SpreadsheetApp.create('Cotizador Helgen — Base de datos');
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }

  const hCot = ss.getSheetByName('Cotizaciones') || ss.insertSheet('Cotizaciones');
  if (hCot.getLastRow() === 0) {
    hCot.appendRow(ENCABEZADOS_COTIZACIONES);
    hCot.setFrozenRows(1);
    hCot.getRange(1, 1, 1, ENCABEZADOS_COTIZACIONES.length)
      .setFontWeight('bold').setBackground('#2C3C5B').setFontColor('#FFFFFF');
  }

  // El catálogo vive en su propio archivo ("Catálogo Helgen"): ver hojaCatalogo_()

  const hCfg = ss.getSheetByName('Config') || ss.insertSheet('Config');
  if (hCfg.getLastRow() === 0) {
    hCfg.getRange('B:B').setNumberFormat('@'); // texto: evita que "+52 ..." se lea como fórmula
    hCfg.getRange(1, 1, CONFIG_INICIAL.length + 1, 2).setValues([['Clave', 'Valor']].concat(CONFIG_INICIAL));
    hCfg.setColumnWidth(2, 600);
  }

  const hoja1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (hoja1 && ss.getSheets().length > 1) ss.deleteSheet(hoja1);

  // Carpeta de Drive para los PDF
  if (!props.getProperty('FOLDER_ID')) {
    const carpeta = DriveApp.createFolder('Cotizaciones Helgen (PDF)');
    props.setProperty('FOLDER_ID', carpeta.getId());
  }

  Logger.log('Base de datos: ' + ss.getUrl());
  Logger.log('Carpeta PDF:  ' + DriveApp.getFolderById(props.getProperty('FOLDER_ID')).getUrl());
}

// ====== 3. LECTURA DE DATOS ======

function db_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SPREADSHEET_ID') || !props.getProperty('FOLDER_ID')) {
    // Primera vez: se instala sola (hoja + carpeta) en lugar de exigir correr setup() a mano.
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) throw new Error('Se está preparando el cotizador. Recarga la página en unos segundos.');
    try {
      if (!props.getProperty('SPREADSHEET_ID') || !props.getProperty('FOLDER_ID')) setup();
    } finally {
      lock.releaseLock();
    }
  }
  return SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
}

function getConfig_() {
  const hoja = db_().getSheetByName('Config');
  migrarConfig_(hoja);
  const filas = hoja.getDataRange().getValues().slice(1);
  const cfg = {};
  filas.forEach(([k, v]) => { if (k) cfg[String(k).trim()] = v; });
  cfg.IVA_TASA = Number(cfg.IVA_TASA) || 0.16;
  cfg.VIGENCIA_DIAS = Number(cfg.VIGENCIA_DIAS) || 15;
  return cfg;
}

/**
 * Actualiza una hoja Config creada con versiones anteriores:
 * - TERMINOS (único) -> TERMINOS_HELGEN + TERMINOS_ENERGY; agrega cualquier clave nueva que falte
 * - Valores de ejemplo (CONFIG_EJEMPLO_ANTERIOR) -> datos reales de Helgen
 * - Valores que Sheets leyó como fórmula con error (p. ej. "+52 ..." -> #ERROR!) se reponen como texto.
 */
function migrarConfig_(hoja) {
  const necesita = () => {
    const v = hoja.getDataRange().getValues();
    const claves = v.map(r => r[0]);
    return CONFIG_INICIAL.some(([k]) => claves.indexOf(k) === -1) ||
      v.some(r => /^#[A-Z/0!?]+/.test(String(r[1])) || CONFIG_EJEMPLO_ANTERIOR[r[0]] === String(r[1]));
  };
  if (!necesita()) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    if (!necesita()) return;
    const valores = hoja.getDataRange().getValues();
    const iniciales = {};
    CONFIG_INICIAL.forEach(([k, v]) => { iniciales[k] = v; });
    hoja.getRange('B:B').setNumberFormat('@');

    valores.forEach((r, i) => {
      const fila = i + 1;
      if (r[0] === 'TERMINOS') {
        hoja.getRange(fila, 1, 1, 2).setValues([['TERMINOS_ENERGY', iniciales.TERMINOS_ENERGY]]);
      } else if (i > 0 && r[0] in iniciales &&
          (/^#[A-Z/0!?]+/.test(String(r[1])) || CONFIG_EJEMPLO_ANTERIOR[r[0]] === String(r[1]))) {
        hoja.getRange(fila, 2).setValue(String(iniciales[r[0]]));
      }
    });
    const claves = hoja.getDataRange().getValues().map(r => r[0]);
    CONFIG_INICIAL.forEach(([k, v]) => {
      if (claves.indexOf(k) === -1) hoja.appendRow([k, v]);
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

// ====== CATÁLOGO: Google Sheets aparte ("Catálogo Helgen"), ligado por CATALOGO_ID ======

// Clave SAT y Unidad SAT son datos internos para contabilidad (facturación); no salen en el PDF
const ENCABEZADOS_CATALOGO = ['Clave', 'Descripción', 'Unidad', 'Precio unitario (sin IVA)', 'Actualizado', 'Actualizó',
  'Clave SAT', 'Unidad SAT'];

/** Hoja del catálogo. La primera vez crea el archivo y pasa ahí los productos de la pestaña anterior. */
function hojaCatalogo_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('CATALOGO_ID')) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) throw new Error('Se está preparando el catálogo. Recarga la página en unos segundos.');
    try {
      if (!props.getProperty('CATALOGO_ID')) crearCatalogo_();
    } finally {
      lock.releaseLock();
    }
  }
  const ss = SpreadsheetApp.openById(props.getProperty('CATALOGO_ID'));
  const hoja = ss.getSheetByName('Catalogo') || ss.getSheets()[0];
  asegurarColumnasSat_(hoja);
  // Precio en USD: dato extra; si falla, el catálogo funciona igual (en USD el precio se captura a mano)
  try { asegurarPrecioUsd_(hoja); } catch (e) { console.warn('Sin columna de precio USD: ' + e.message); }
  return hoja;
}

// ---- Precio en USD (columna I) y tipo de cambio del día (pestaña "Tipo de cambio" del catálogo) ----
// Fórmula por renglón (no ARRAYFORMULA: una fórmula que llena toda la columna haría que appendRow escriba al final
// de la hoja). Los renglones sin fórmula (p. ej. capturados a mano en Sheets) se reparan solos al abrir el catálogo.

const ENC_PRECIO_USD = 'Precio USD (sin IVA, automático)';
const COL_PRECIO_USD = 9; // I
const HOJA_TIPO_CAMBIO = 'Tipo de cambio';
const RANGO_TIPO_CAMBIO = 'TIPO_CAMBIO';
const formulaPrecioUsd_ = fila => '=IF(ISNUMBER(D' + fila + '),IFERROR(ROUND(D' + fila + '/' + RANGO_TIPO_CAMBIO + ',2),""),"")';

/**
 * Pestaña "Tipo de cambio": B2 = Google Finance (USD→MXN, automático), B3 = manual opcional (si tiene valor, manda),
 * B4 = en uso (rango con nombre TIPO_CAMBIO). Columna I del catálogo = precio en pesos ÷ TIPO_CAMBIO.
 */
function asegurarPrecioUsd_(hoja) {
  const ss = hoja.getParent();
  if (!ss.getSheetByName(HOJA_TIPO_CAMBIO)) {
    const tc = ss.insertSheet(HOJA_TIPO_CAMBIO);
    tc.getRange(1, 1, 5, 2).setValues([
      ['Concepto', 'Valor'],
      ['Automático: Google Finance (pesos por dólar)', ''],
      ['Manual (opcional): si escribes un valor aquí, se usa en lugar del automático', ''],
      ['Tipo de cambio en uso', ''],
      ['Nota', 'Los precios en USD del catálogo (columna I) se calculan solos con el tipo de cambio en uso. Google Finance ' +
        'se actualiza durante el día y puede tener unos minutos de retraso; no es el FIX de Banxico.'],
    ]);
    tc.getRange(2, 2).setFormula('=GOOGLEFINANCE("CURRENCY:USDMXN")');
    tc.getRange(4, 2).setFormula('=IF(ISNUMBER(B3),B3,IFERROR(ROUND(B2,4),""))');
    tc.getRange(2, 2, 3, 1).setNumberFormat('0.0000');
    tc.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#2C3C5B').setFontColor('#FFFFFF');
    tc.setColumnWidth(1, 470); tc.setColumnWidth(2, 160);
    ss.setNamedRange(RANGO_TIPO_CAMBIO, tc.getRange(4, 2));
    // GOOGLEFINANCE se recalcula cada hora aunque nadie abra el archivo
    ss.setRecalculationInterval(SpreadsheetApp.RecalculationInterval.HOUR);
  }
  if (hoja.getRange(1, COL_PRECIO_USD).getValue() !== ENC_PRECIO_USD) {
    hoja.getRange(1, COL_PRECIO_USD).setValue(ENC_PRECIO_USD)
      .setFontWeight('bold').setBackground('#2C3C5B').setFontColor('#FFFFFF');
    hoja.getRange('I:I').setNumberFormat('$#,##0.00');
    hoja.setColumnWidth(COL_PRECIO_USD, 210);
    hoja.getRange('I:I').protect().setDescription('Precio USD automático: no escribir aquí (cambia el precio en pesos ' +
      'o el tipo de cambio)').setWarningOnly(true);
  }
  // Renglones con producto y sin fórmula en I: se les pone (incluye los dados de alta a mano en Sheets)
  const n = hoja.getLastRow() - 1;
  if (n < 1) return;
  const claves = hoja.getRange(2, 1, n, 1).getValues();
  const formulas = hoja.getRange(2, COL_PRECIO_USD, n, 1).getFormulas();
  claves.forEach((r, i) => {
    if (String(r[0] || '').trim() && !formulas[i][0]) hoja.getRange(i + 2, COL_PRECIO_USD).setFormula(formulaPrecioUsd_(i + 2));
  });
}

/** Tipo de cambio en uso según la pestaña "Tipo de cambio" ({valor, fuente}); valor null si no hay uno válido. */
function tipoCambioCatalogo_(hoja) {
  try {
    const tc = hoja.getParent().getSheetByName(HOJA_TIPO_CAMBIO);
    if (!tc) return { valor: null, fuente: '' };
    const v = tc.getRange(2, 2, 2, 1).getValues();
    return tipoCambioDesdeValores(v[0][0], v[1][0]);
  } catch (e) {
    console.warn('Sin tipo de cambio: ' + e.message);
    return { valor: null, fuente: '' };
  }
}

/** Catálogos creados antes de las columnas SAT: agrega los encabezados G:H con formato texto. */
function asegurarColumnasSat_(hoja) {
  const n = ENCABEZADOS_CATALOGO.length;
  const enc = hoja.getRange(1, 7, 1, 2).getValues()[0];
  if (enc[0] === ENCABEZADOS_CATALOGO[6] && enc[1] === ENCABEZADOS_CATALOGO[7]) return;
  hoja.getRange('G:H').setNumberFormat('@'); // "01010101" no pierde el cero inicial
  hoja.getRange(1, 7, 1, 2).setValues([ENCABEZADOS_CATALOGO.slice(6, n)])
    .setFontWeight('bold').setBackground('#2C3C5B').setFontColor('#FFFFFF');
  hoja.setColumnWidth(7, 110); hoja.setColumnWidth(8, 100);
}

function crearCatalogo_() {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.create('Catálogo Helgen');
  const hoja = ss.getSheets()[0].setName('Catalogo');
  const n = ENCABEZADOS_CATALOGO.length;

  hoja.getRange(1, 1, 1, n).setValues([ENCABEZADOS_CATALOGO])
    .setFontWeight('bold').setBackground('#2C3C5B').setFontColor('#FFFFFF');
  hoja.setFrozenRows(1);
  hoja.getRange('A:C').setNumberFormat('@'); // texto: claves como "001" no pierden ceros
  hoja.getRange('G:H').setNumberFormat('@');
  hoja.getRange('D:D').setNumberFormat('$#,##0.00');
  hoja.getRange('E:E').setNumberFormat('dd/MM/yyyy HH:mm');
  hoja.setColumnWidth(1, 110); hoja.setColumnWidth(2, 420); hoja.setColumnWidth(4, 170); hoja.setColumnWidth(6, 200);

  // Validaciones al capturar directo en Sheets: clave única y precio >= 0
  hoja.getRange('A2:A').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=COUNTIF($A:$A,$A2)=1').setAllowInvalid(false)
    .setHelpText('La clave ya existe en el catálogo. Usa una clave distinta.').build());
  hoja.getRange('D2:D').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireNumberGreaterThanOrEqualTo(0).setAllowInvalid(false)
    .setHelpText('Precio unitario sin IVA (número mayor o igual a 0).').build());

  // Migra la pestaña "Catalogo" de la base de datos (versiones anteriores), sin el producto de ejemplo
  const db = db_();
  const vieja = db.getSheetByName('Catalogo');
  if (vieja) {
    const filas = vieja.getDataRange().getValues().slice(1)
      .filter(r => r[1] && String(r[0]) !== 'EJ-001')
      .map(r => [String(r[0]).trim().toUpperCase(), String(r[1]), String(r[2] || 'PZA'), Number(r[3]) || 0, '', 'Migrado', '', '']);
    if (filas.length) hoja.getRange(2, 1, filas.length, n).setValues(filas);
    if (db.getSheets().length > 1) db.deleteSheet(vieja); // los datos ya quedaron en el archivo nuevo
  }

  // Lo deja en la misma carpeta de Drive que la base de datos
  try {
    const padres = DriveApp.getFileById(db.getId()).getParents();
    if (padres.hasNext()) DriveApp.getFileById(ss.getId()).moveTo(padres.next());
  } catch (e) { /* si no se puede mover, queda en Mi unidad */ }

  props.setProperty('CATALOGO_ID', ss.getId());
}

function getCatalogo_(hoja) {
  const h = hoja || hojaCatalogo_();
  const filas = h.getDataRange().getValues().slice(1);
  // Precio en USD con el mismo cálculo que la columna I (no depende de que Sheets ya haya recalculado la fórmula)
  const tc = tipoCambioCatalogo_(h).valor;
  return filas
    .filter(r => r[0] && r[1])
    .map(r => ({ clave: String(r[0]), descripcion: String(r[1]), unidad: String(r[2] || 'PZA'), precio: Number(r[3]) || 0,
      claveSat: String(r[6] || ''), unidadSat: String(r[7] || ''), precioUsd: precioEnDolares(Number(r[3]) || 0, tc) }));
}

/** Datos para la pestaña Catálogo de la app (incluye las unidades del SAT para elegir). */
function getCatalogo() {
  const hoja = hojaCatalogo_();
  let unidadesSat = [];
  try { unidadesSat = getUnidadesSat_(); } catch (e) { /* sin catálogo SAT: la app sigue funcionando */ }
  return { productos: getCatalogo_(hoja), url: hoja.getParent().getUrl(), unidadesSat: unidadesSat,
    tipoCambio: tipoCambioCatalogo_(hoja) };
}

// ====== CATÁLOGOS DEL SAT (CFDI 4.0): Google Sheets "Catálogos SAT (CFDI 4.0)", ligado por SAT_ID ======
// Fuente: catCFDI_V_4_20261015.xls (Anexo 20, sat.gob.mx), solo claves vigentes. Se importa una vez desde
// los CSV SAT_c_ClaveProdServ.csv y SAT_c_ClaveUnidad.csv de la carpeta "Catálogos SAT".

const FUENTE_SAT = 'catCFDI_V_4_20261015.xls — Anexo 20 del SAT (CFDI 4.0), descargado el 15/10/2026. Solo claves vigentes.';

function libroSat_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SAT_ID')) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(60000)) throw new Error('Se está cargando el catálogo del SAT. Intenta en unos segundos.');
    try {
      if (!props.getProperty('SAT_ID')) importarCatalogosSat_();
    } finally {
      lock.releaseLock();
    }
  }
  return SpreadsheetApp.openById(props.getProperty('SAT_ID'));
}

function importarCatalogosSat_() {
  const archivo = nombre => {
    const it = DriveApp.getFilesByName(nombre);
    while (it.hasNext()) { const f = it.next(); if (!f.isTrashed()) return f; }
    throw new Error('No se encontró ' + nombre + ' en Drive (carpeta Cotizador Helgen / Catálogos SAT).');
  };
  const csvProd = archivo('SAT_c_ClaveProdServ.csv'), csvUni = archivo('SAT_c_ClaveUnidad.csv');
  const ss = SpreadsheetApp.create('Catálogos SAT (CFDI 4.0)');

  const cargar = (hoja, nombre, csv, anchos) => {
    const filas = Utilities.parseCsv(csv.getBlob().getDataAsString('UTF-8'));
    hoja.setName(nombre);
    if (hoja.getMaxRows() < filas.length) hoja.insertRowsAfter(hoja.getMaxRows(), filas.length - hoja.getMaxRows());
    hoja.getRange('A:A').setNumberFormat('@');
    hoja.getRange(1, 1, filas.length, filas[0].length).setValues(filas);
    hoja.getRange(1, 1, 1, filas[0].length).setFontWeight('bold').setBackground('#2C3C5B').setFontColor('#FFFFFF');
    hoja.setFrozenRows(1);
    anchos.forEach((w, i) => hoja.setColumnWidth(i + 1, w));
  };
  cargar(ss.getSheets()[0], 'ClaveProdServ', csvProd, [100, 600]);
  cargar(ss.insertSheet(), 'ClaveUnidad', csvUni, [100, 320, 90]);
  ss.insertSheet('Fuente').getRange(1, 1, 2, 1).setValues([[FUENTE_SAT],
    ['Uso interno de contabilidad. Para actualizar: reemplazar los CSV y borrar la propiedad SAT_ID del proyecto.']]);

  try { DriveApp.getFileById(ss.getId()).moveTo(csvProd.getParents().next()); } catch (e) { /* queda en Mi unidad */ }
  PropertiesService.getScriptProperties().setProperty('SAT_ID', ss.getId());
}

/** Unidades del SAT [[clave, nombre], ...] para la lista de selección. */
function getUnidadesSat_() {
  const hoja = libroSat_().getSheetByName('ClaveUnidad');
  return hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues().map(r => [String(r[0]), String(r[1])]);
}

/**
 * Sugerencias de clave SAT para una descripción (o la clave exacta si se escribe una de 8 dígitos).
 * Con la propiedad ANTHROPIC_API_KEY, la IA elige las 5 mejores de ~40 candidatos (con su razón);
 * sin ella, o si la llamada falla, quedan los resultados de la búsqueda por palabras.
 */
function sugerirClavesSat(texto) {
  const hoja = libroSat_().getSheetByName('ClaveProdServ');
  const filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues();
  const exacta = String(texto || '').replace(/\D/g, '');
  if (/^\d{7,8}$/.test(exacta)) {
    const f = filas.find(r => String(r[0]) === exacta.padStart(8, '0'));
    return f ? [{ clave: String(f[0]), descripcion: String(f[1]), puntaje: 1 }] : [];
  }
  const candidatos = candidatosSat(texto, filas, 40);
  return ordenarConIaSat_(texto, candidatos) || candidatos.slice(0, 8);
}

/**
 * Ejecutar una vez desde el editor tras agregar la IA: autoriza la conexión externa (UrlFetchApp) y muestra
 * en el registro qué sugiere para unos servicios de ejemplo. Sin ANTHROPIC_API_KEY, muestra la búsqueda por palabras.
 */
function probarIaSat() {
  ['Mantenimiento preventivo', 'Servicio de rastreo GPS vehicular', 'Limpieza de patios',
    'Instalación de paneles solares'].forEach(q => {
    console.log(q + '\n' + sugerirClavesSat(q).map(o => o.clave + '  ' + o.descripcion +
      (o.razon ? '  — ' + o.razon : '')).join('\n'));
  });
}

/** Pide a Claude que elija y ordene entre los candidatos. null si no hay API key o algo falla. */
function ordenarConIaSat_(texto, candidatos) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey || !candidatos.length) return null;
  const cache = CacheService.getScriptCache();
  const llave = 'satIA:' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5,
    palabrasSat(texto).join(' ') + '|' + candidatos.map(c => c.clave).join(','), Utilities.Charset.UTF_8));
  const guardada = cache.get(llave);
  if (guardada) return JSON.parse(guardada);
  try {
    const r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify(solicitudIaSat(texto, candidatos)),
    });
    if (r.getResponseCode() !== 200) {
      console.warn('IA claves SAT: HTTP ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 300));
      return null;
    }
    const lista = leerRespuestaIaSat(r.getContentText(), candidatos);
    cache.put(llave, JSON.stringify(lista), 21600); // 6 h: la misma búsqueda no se vuelve a cobrar
    return lista;
  } catch (e) {
    console.warn('IA claves SAT: ' + (e && e.message ? e.message : e));
    return null;
  }
}

/** true si la clave existe en esa pestaña del catálogo SAT (columna A, celda completa). */
function existeEnSat_(pestana, clave) {
  const hoja = libroSat_().getSheetByName(pestana);
  return !!hoja.getRange(1, 1, hoja.getLastRow(), 1).createTextFinder(clave).matchEntireCell(true).findNext();
}

/**
 * Alta o edición de un producto. p = {clave, descripcion, unidad, precio, claveOriginal?}
 * claveOriginal indica que se edita ese producto (permite cambiarle la clave).
 */
function guardarProducto(p) {
  const prod = normalizarProducto(p);
  const original = String((p && p.claveOriginal) || '').trim();
  if (prod.claveSat && !existeEnSat_('ClaveProdServ', prod.claveSat)) {
    throw new Error('La clave SAT ' + prod.claveSat + ' no existe en el catálogo vigente del SAT.');
  }
  if (prod.unidadSat && !existeEnSat_('ClaveUnidad', prod.unidadSat)) {
    throw new Error('La unidad SAT ' + prod.unidadSat + ' no existe en el catálogo vigente del SAT.');
  }
  const hoja = hojaCatalogo_(); // fuera del candado: la primera vez crea el archivo con su propio candado

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('El catálogo está ocupado. Intenta de nuevo en unos segundos.');
  try {
    const datos = hoja.getDataRange().getValues().slice(1);
    const claves = datos.map(r => r[0]);
    const iExiste = indiceDeClave(claves, prod.clave);
    const iOriginal = original ? indiceDeClave(claves, original) : -1;
    if (original && iOriginal === -1) throw new Error('El producto ' + original + ' ya no existe en el catálogo. Recarga la lista.');
    if (iExiste !== -1 && iExiste !== iOriginal) {
      throw new Error('La clave ' + prod.clave + ' ya existe: "' + datos[iExiste][1] + '". Usa otra clave o edita ese producto.');
    }

    // Columnas A:C tienen formato texto: lo capturado no se interpreta como fórmula
    const fila = [prod.clave, prod.descripcion, prod.unidad, prod.precio, new Date(), usuarioActual_(),
      prod.claveSat, prod.unidadSat];
    if (iOriginal !== -1) {
      hoja.getRange(iOriginal + 2, 1, 1, fila.length).setValues([fila]);
    } else {
      hoja.appendRow(fila);
    }
    try { asegurarPrecioUsd_(hoja); } catch (e) { console.warn('Sin columna de precio USD: ' + e.message); }
    SpreadsheetApp.flush();
    return { productos: getCatalogo_(hoja), url: hoja.getParent().getUrl(), clave: prod.clave,
      tipoCambio: tipoCambioCatalogo_(hoja) };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Clientes que ya cotizaron, tomados de la hoja Cotizaciones.
 * Si se borran sus filas de la base de datos, dejan de sugerirse.
 */
function getClientes() {
  const filas = db_().getSheetByName('Cotizaciones').getDataRange().getValues().slice(1)
    .map(r => {
      const f = r.slice();
      f[1] = f[1] instanceof Date ? Utilities.formatDate(f[1], 'America/Mexico_City', 'dd/MM/yyyy') : String(f[1] || '');
      return f;
    });
  return clientesDesdeFilas(filas);
}

/** Historial (últimas 100, con búsqueda opcional). */
function listarCotizaciones(busqueda) {
  const hoja = db_().getSheetByName('Cotizaciones');
  const filas = hoja.getDataRange().getDisplayValues().slice(1);
  // Correo → "Nombre Apellido" con todas las filas (antes de filtrar), para ponerle nombre a las filas viejas
  const nombres = nombresDeVendedores(filas);
  const datos = filas.reverse();
  const q = String(busqueda || '').toLowerCase().trim();
  // Folio del proyecto con su clave (PRY-AAAA-NNNN-XXX); si no se puede leer Proyectos, el de la hoja
  let proyectos = {};
  try { proyectos = mapaProyectos_(); } catch (e) { /* el historial carga igual */ }
  const proyectoDe = r => { const p = proyectos[String(r[19] || '').toUpperCase()]; return p ? p.folioVisible : r[19]; };
  return datos
    .filter(r => !q || (r[0] + ' ' + r[2] + ' ' + r[3] + ' ' + (proyectoDe(r) || '')).toLowerCase().includes(q))
    .slice(0, 100)
    .map(r => ({
      folio: r[0], fecha: r[1], cliente: r[2], empresa: r[3], total: r[9], elaboro: r[10], pdf: r[11],
      vendedor: vendedorDeFila(r, nombres),
      // Filas anteriores a Proyectos (o cotizadas sin proyecto)
      proyecto: proyectoDe(r) || 'Sin proyecto',
      moneda: r[20] || 'MXN', // filas anteriores a USD: pesos
    }));
}

// ====== 4. GUARDAR COTIZACIÓN + PDF ======

function guardarCotizacion(payload) {
  // El vendedor sale del token verificado en doPost, nunca de lo que mande el navegador
  const vendedor = VENDEDOR_;
  if (!vendedor) throw errorSesion_('Inicia sesión con tu cuenta @' + DOMINIO_HELGEN + ' para guardar.');
  const cfg = getConfig_();
  const datos = normalizarCotizacion(payload, cfg.IVA_TASA);
  // Para facturación: cada concepto que viene del catálogo guarda su clave y unidad SAT (no salen en el PDF)
  // Es un dato extra: si el catálogo falla, la cotización se guarda igual
  try {
    const catalogo = getCatalogo_();
    const claves = catalogo.map(c => c.clave);
    datos.items.forEach(it => {
      const p = it.clave && catalogo[indiceDeClave(claves, it.clave)];
      if (p && p.claveSat) { it.claveSat = p.claveSat; it.unidadSat = p.unidadSat; }
    });
  } catch (e) { console.warn('Sin datos SAT del catálogo: ' + e.message); }

  // Idempotencia: si el mismo formulario llega dos veces (doble clic, reintento), se devuelve el mismo folio.
  const idSolicitud = String((payload && payload.idSolicitud) || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const claveCache = idSolicitud ? 'REQ_' + idSolicitud : '';
  // Proyecto opcional: vacío = "Sin proyecto" (el PDF va a la carpeta del año, como antes)
  // Siempre la llave interna PRY-AAAA-NNNN en la columna T, aunque llegue el folio con clave
  const proyectoFolio = folioInterno(payload && payload.proyectoFolio);

  const lock = LockService.getScriptLock();
  // Evita folios duplicados si dos personas guardan a la vez
  if (!lock.tryLock(30000)) {
    throw new Error('El sistema está ocupado guardando otra cotización. Intenta de nuevo en unos segundos.');
  }
  try {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) return JSON.parse(previo);
    }

    // El proyecto se valida dentro del candado: que exista y siga Activo
    let carpetaPdf = null;
    if (proyectoFolio) {
      const proyecto = buscarProyecto_(hojaProyectos_(), proyectoFolio);
      if (!proyecto) throw errorProyecto_('No existe el proyecto ' + proyectoFolio + '. Elige otro o cotiza sin proyecto.');
      if (proyecto.estado !== 'Activo') {
        throw errorProyecto_('El proyecto ' + proyectoFolio + ' está ' + proyecto.estado.toLowerCase() +
          ': ya no se le pueden agregar cotizaciones.');
      }
      // Fase 2: con contrato firmado ya no se cotiza dentro del proyecto (se revisará con los adicionales)
      if (foliosConContratoFirmado_()[proyecto.folio.toUpperCase()]) {
        throw errorProyecto_('Proyecto con contrato firmado: no admite cotizaciones nuevas.');
      }
      carpetaPdf = subcarpetaProyecto_(proyecto, 'Cotizaciones');
    }

    const hojaCot = db_().getSheetByName('Cotizaciones');
    const folio = siguienteFolio_(cfg.PREFIJO_FOLIO || 'HLG', hojaCot);
    const ahora = new Date();
    datos.folio = folio;
    datos.fecha = Utilities.formatDate(ahora, 'America/Mexico_City', 'dd/MM/yyyy');
    datos.vigencia = Utilities.formatDate(
      new Date(ahora.getTime() + cfg.VIGENCIA_DIAS * 86400000), 'America/Mexico_City', 'dd/MM/yyyy');
    datos.elaboro = vendedor.email;

    // PDF
    const html = construirHtmlPdf(datos, cfg, logoDataUrl_(cfg.LOGO_FILE_ID));
    const nombre = folio + ' - ' + (datos.cliente.empresa || datos.cliente.nombre) + '.pdf';
    const pdf = Utilities.newBlob(html, 'text/html', folio + '.html').getAs('application/pdf').setName(nombre);
    const archivo = (carpetaPdf || carpetaDelAnio_(ahora.getFullYear())).createFile(pdf);

    // Registro (Marca, Dirección, vendedor_* y proyecto_folio se agregaron después: se reescribe solo la fila 1
    // de encabezados; las filas de datos no se mueven y las viejas quedan vacías en las columnas nuevas)
    const nCols = ENCABEZADOS_COTIZACIONES.length;
    const actuales = hojaCot.getRange(1, 1, 1, nCols).getValues()[0];
    if (ENCABEZADOS_COTIZACIONES.some((h, i) => actuales[i] !== h)) {
      hojaCot.getRange(1, 1, 1, nCols).setValues([ENCABEZADOS_COTIZACIONES])
        .setFontWeight('bold').setBackground('#2C3C5B').setFontColor('#FFFFFF');
    }
    const t = textoCelda;
    hojaCot.appendRow([
      folio, ahora, t(datos.cliente.nombre), t(datos.cliente.empresa), t(datos.cliente.rfc),
      t(datos.cliente.email), t(datos.cliente.telefono),
      datos.subtotal, datos.iva, datos.total, datos.elaboro, archivo.getUrl(),
      JSON.stringify(datos.items), t(datos.notas), MARCAS[datos.marca], t(datos.cliente.direccion),
      t(vendedor.email), t(vendedor.nombre), t(vendedor.apellido), proyectoFolio, datos.moneda, datos.tipoCambio,
    ]);
    SpreadsheetApp.flush();

    const resultado = { folio: folio, url: archivo.getUrl(), total: datos.total, moneda: datos.moneda,
      proyectoFolio: proyectoFolio };
    if (claveCache) cache.put(claveCache, JSON.stringify(resultado), 21600); // 6 h
    return resultado;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Folio: HLG-2026-0001 (reinicia cada año).
 * Toma el mayor entre el contador guardado y el último folio registrado en la hoja,
 * así no se repite aunque alguien borre o edite el contador en Script Properties.
 */
function siguienteFolio_(prefijo, hoja, baseContador) {
  const props = PropertiesService.getScriptProperties();
  const anio = Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy');
  // Cotizaciones: CONSECUTIVO_AAAA; proyectos: CONSECUTIVO_PROY_AAAA (cada tipo de folio lleva su contador)
  const clave = (baseContador || 'CONSECUTIVO_') + anio;
  const filas = hoja.getLastRow() > 1 ? hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues() : [];
  const enHoja = maxConsecutivo(filas.map(r => r[0]), prefijo, anio);
  const n = Math.max(Number(props.getProperty(clave) || 0), enHoja) + 1;
  props.setProperty(clave, String(n));
  return formatearFolio(prefijo, anio, n);
}

function carpetaDelAnio_(anio) {
  const raiz = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('FOLDER_ID'));
  const it = raiz.getFoldersByName(String(anio));
  return it.hasNext() ? it.next() : raiz.createFolder(String(anio));
}

/** Logo de Drive si se configuró LOGO_FILE_ID; si no, el logo azul incluido en Logo.gs. */
function logoDataUrl_(fileId) {
  if (!fileId) return LOGO_HELGEN_AZUL;
  try {
    const blob = DriveApp.getFileById(String(fileId).trim()).getBlob();
    return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (e) {
    return LOGO_HELGEN_AZUL;
  }
}

// ====== 4.1 PROYECTOS ======
// Pestaña "Proyectos" en la base de datos + carpeta "Cotizador Helgen/Proyectos/AAAA/<folio> — <cliente> — <nombre>/".
// Lo que se agregue después (OrdenesCompra, Pagos, Gastos) se liga por proyecto_folio (ver CLAUDE.md).

const ENCABEZADOS_PROYECTOS = [
  'Folio', 'Fecha', 'Nombre', 'Cliente', 'cliente_id', 'Ubicación', 'Estado', 'carpeta_id',
  'vendedor_email', 'vendedor_nombre', 'vendedor_apellido', 'clave'
];
const COL_ESTADO_PROYECTO = 7;   // G
const COL_CLAVE_PROYECTO = 12;   // L
const COL_CARPETA_PROYECTO = 8;  // H
const ESTADOS_PROYECTO = ['Activo', 'Cerrado', 'Cancelado'];
// Sin "Pagos" ni "Órdenes de compra": comprobantes y órdenes van en las carpetas de cobranza y compras (no visibles para
// todo el dominio). Los proyectos creados antes conservan las suyas, vacías; no se borran.
const SUBCARPETAS_PROYECTO = ['Cotizaciones'];
const PREFIJO_PROYECTO = 'PRY';

/**
 * Pestaña "Proyectos". La primera vez la crea (encabezados + lista desplegable de Estado);
 * si le faltan encabezados nuevos, reescribe solo la fila 1.
 */
function hojaProyectos_() {
  const ss = db_();
  let hoja = ss.getSheetByName('Proyectos');
  if (!hoja) {
    try {
      hoja = ss.insertSheet('Proyectos');
    } catch (e) {
      // Otra petición la acaba de crear
      hoja = ss.getSheetByName('Proyectos');
      if (!hoja) throw e;
    }
    hoja.setFrozenRows(1);
    hoja.getRange('A:H').setNumberFormat('@');
    hoja.getRange('B:B').setNumberFormat('dd/MM/yyyy HH:mm');
    hoja.getRange(2, COL_ESTADO_PROYECTO, hoja.getMaxRows() - 1, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(ESTADOS_PROYECTO, true).setAllowInvalid(false)
        .setHelpText('Estado del proyecto: Activo, Cerrado o Cancelado.').build());
    hoja.setColumnWidth(3, 260); hoja.setColumnWidth(4, 260); hoja.setColumnWidth(6, 220);
  }
  const n = ENCABEZADOS_PROYECTOS.length;
  const actuales = hoja.getRange(1, 1, 1, n).getValues()[0];
  if (ENCABEZADOS_PROYECTOS.some((h, i) => actuales[i] !== h)) {
    hoja.getRange(1, 1, 1, n).setValues([ENCABEZADOS_PROYECTOS])
      .setFontWeight('bold').setBackground('#2C3C5B').setFontColor('#FFFFFF');
    hoja.getRange(1, COL_CLAVE_PROYECTO, hoja.getMaxRows(), 1).setNumberFormat('@'); // la clave es texto (columna L, al final)
  }
  return hoja;
}

/** Proyectos con búsqueda por folio, clave, cliente o nombre. Por omisión solo los Activos; los más recientes primero. */
function listarProyectos(busqueda, incluirInactivos) {
  // El buscador de cotizaciones (solo activos) no muestra proyectos con contrato firmado
  const contratos = incluirInactivos ? {} : contratosCache_();
  return filtrarProyectos(proyectosCache_().filter(p => {
    const c = contratos[p.folio.toUpperCase()];
    return !(c && c.estado === ESTADO_FIRMADO);
  }), busqueda, incluirInactivos, 50).map(proyectoParaLista_);
}

/** Error de proyecto inexistente o no Activo: doPost lo manda con codigo 'PROYECTO' y la interfaz limpia el campo. */
function errorProyecto_(mensaje) {
  const e = new Error(mensaje);
  e.codigo = 'PROYECTO';
  return e;
}

/** Proyecto por folio (con su número de fila), o null. */
function buscarProyecto_(hoja, folio) {
  const buscado = folioInterno(folio);
  if (!buscado || hoja.getLastRow() < 2) return null;
  const filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, ENCABEZADOS_PROYECTOS.length).getValues();
  const lista = proyectosDesdeFilas(filas);
  for (let i = 0; i < lista.length; i++) {
    if (lista[i].folio.toUpperCase() === buscado) return Object.assign(lista[i], { hoja: hoja, fila: i + 2 });
  }
  return null;
}

/**
 * Alta de proyecto (desde "Nuevo proyecto" en la interfaz). p = {nombre, ubicacion, clave, cliente:{nombre, empresa, rfc},
 * idSolicitud}. Folio PRY-AAAA-NNNN bajo el mismo candado que las cotizaciones (la clave de 3 letras va en la columna L y
 * se muestra como PRY-AAAA-NNNN-XXX); primero crea la carpeta y luego la fila, para que no quede un proyecto registrado
 * sin carpeta.
 */
function crearProyecto(p) {
  const vendedor = VENDEDOR_;
  if (!vendedor) throw errorSesion_('Inicia sesión con tu cuenta @' + DOMINIO_HELGEN + ' para crear proyectos.');
  const datos = normalizarProyecto(p);

  const idSolicitud = String((p && p.idSolicitud) || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const claveCache = idSolicitud ? 'PRY_' + idSolicitud : '';

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('El sistema está ocupado guardando otro registro. Intenta de nuevo en unos segundos.');
  }
  try {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) return JSON.parse(previo);
    }

    const hoja = hojaProyectos_();
    const folio = siguienteFolio_(PREFIJO_PROYECTO, hoja, 'CONSECUTIVO_PROY_');
    const ahora = new Date();
    const carpeta = crearCarpetaProyecto_(folioVisible(folio, datos.clave), datos, ahora.getFullYear());

    const t = textoCelda;
    hoja.appendRow([
      folio, ahora, t(datos.nombre), t(datos.cliente), t(datos.clienteId), t(datos.ubicacion), 'Activo', carpeta.getId(),
      t(vendedor.email), t(vendedor.nombre), t(vendedor.apellido), datos.clave,
    ]);
    SpreadsheetApp.flush();

    const resultado = { folio: folio, clave: datos.clave, folioVisible: folioVisible(folio, datos.clave), nombre: datos.nombre,
      cliente: datos.cliente, clienteId: datos.clienteId, ubicacion: datos.ubicacion, estado: 'Activo',
      fecha: Utilities.formatDate(ahora, 'America/Mexico_City', 'dd/MM/yyyy'), url: carpeta.getUrl() };
    if (claveCache) cache.put(claveCache, JSON.stringify(resultado), 21600); // 6 h
    return resultado;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Correr desde el editor: clave para los proyectos que no tienen (la sugerida con su nombre) y su carpeta principal (por
 * carpeta_id) pasa de "PRY-AAAA-NNNN — …" a "PRY-AAAA-NNNN-XXX — …". Esta función solo muestra en el registro lo que haría;
 * asignarClavesProyectosAplicar() lo hace. Una carpeta renombrada a mano (que no empieza con su folio) no se toca. Las
 * carpetas de Cobranza y Compras se quedan con el folio corto: se buscan por nombre.
 */
function asignarClavesProyectos(aplicar) {
  const cambios = conCandado_(() => {
    const hoja = hojaProyectos_();
    const filas = hoja.getLastRow() > 1
      ? hoja.getRange(2, 1, hoja.getLastRow() - 1, ENCABEZADOS_PROYECTOS.length).getValues() : [];
    const lista = [];
    filas.forEach((r, i) => {
      const folio = String(r[0] || '').trim();
      if (!folio || String(r[11] || '').trim()) return; // ya tiene clave: no cambia
      const clave = claveSugerida(r[2]);
      const x = { fila: i + 2, folio: folio, nombre: String(r[2] || ''), clave: clave, carpeta: '(sin carpeta)' };
      try {
        const carpeta = DriveApp.getFolderById(String(r[7] || ''));
        const actual = carpeta.getName();
        if (actual === folio || actual.indexOf(folio + ' ') === 0) {
          x.carpeta = actual + '  →  ' + folioVisible(folio, clave) + actual.slice(folio.length);
          if (aplicar) carpeta.setName(folioVisible(folio, clave) + actual.slice(folio.length));
        } else {
          x.carpeta = actual + '  (renombrada a mano: no se toca)';
        }
      } catch (e) {
        x.carpeta = '(no se encontró la carpeta: ' + e.message + ')';
      }
      if (aplicar) hoja.getRange(i + 2, COL_CLAVE_PROYECTO).setNumberFormat('@').setValue(clave);
      lista.push(x);
    });
    if (aplicar) SpreadsheetApp.flush();
    return lista;
  });
  if (aplicar && cambios.length) subirVersiones_(['proyectos']);
  Logger.log((aplicar ? 'APLICADO' : 'VISTA PREVIA (no cambió nada; para aplicar corre asignarClavesProyectosAplicar)') +
    ' · ' + cambios.length + ' proyecto(s) sin clave');
  cambios.forEach(x => Logger.log(x.folio + ' "' + x.nombre + '" → ' + folioVisible(x.folio, x.clave) + ' · carpeta: ' + x.carpeta));
  return cambios;
}

function asignarClavesProyectosAplicar() {
  return asignarClavesProyectos(true);
}

/** Carpeta "Proyectos" junto a la base de datos (en la carpeta maestra). Se crea sola y se guarda en PROYECTOS_FOLDER_ID. */
function carpetaProyectos_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PROYECTOS_FOLDER_ID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* se borró: se vuelve a crear abajo */ }
  }
  const padres = DriveApp.getFileById(props.getProperty('SPREADSHEET_ID')).getParents();
  const maestra = padres.hasNext() ? padres.next() : DriveApp.getRootFolder();
  const carpeta = subcarpeta_(maestra, 'Proyectos');
  props.setProperty('PROYECTOS_FOLDER_ID', carpeta.getId());
  return carpeta;
}

/** Subcarpeta por nombre (ignora las que están en la Papelera); si no existe, la crea. */
function subcarpeta_(padre, nombre) {
  const it = padre.getFoldersByName(nombre);
  while (it.hasNext()) {
    const f = it.next();
    if (!f.isTrashed()) return f;
  }
  return padre.createFolder(nombre);
}

/** Proyectos/AAAA/<folio con clave> — <cliente> — <nombre>/ con sus subcarpetas. */
function crearCarpetaProyecto_(folio, datos, anio) {
  const carpetaAnio = subcarpeta_(carpetaProyectos_(), String(anio));
  const carpeta = carpetaAnio.createFolder(nombreCarpetaProyecto(folio, datos.cliente, datos.nombre));
  SUBCARPETAS_PROYECTO.forEach(s => carpeta.createFolder(s));
  return carpeta;
}

/**
 * Subcarpeta de un proyecto ("Cotizaciones"). Se busca por nombre: si alguien la
 * borró o la renombró, se crea una nueva. Si falta la carpeta del proyecto, se vuelve a crear y se actualiza
 * carpeta_id en la hoja.
 */
function subcarpetaProyecto_(proyecto, nombreSub) {
  let carpeta = null;
  try {
    carpeta = proyecto.carpetaId ? DriveApp.getFolderById(proyecto.carpetaId) : null;
    if (carpeta && carpeta.isTrashed()) carpeta = null;
  } catch (e) { carpeta = null; }
  if (!carpeta) {
    const anio = Number(String(proyecto.folio).split('-')[1]) || new Date().getFullYear();
    carpeta = crearCarpetaProyecto_(folioVisible(proyecto.folio, proyecto.clave), proyecto, anio);
    proyecto.carpetaId = carpeta.getId();
    if (proyecto.hoja && proyecto.fila) proyecto.hoja.getRange(proyecto.fila, COL_CARPETA_PROYECTO).setValue(carpeta.getId());
  }
  return subcarpeta_(carpeta, nombreSub);
}

// ====== 4.2 COBRANZA (Fase 2) ======
// Libro aparte "Cotizador Helgen — Cobranza (datos)" dentro de la carpeta "Cotizador Helgen — Cobranza" (fuera de
// la carpeta maestra, que todo el dominio puede leer). Solo el rol de cobranza (ROL_COBRANZA) ve o cambia estos datos;
// el servidor lo revisa en cada llamada. Comprobantes en Cobranza/AAAA/<folio del proyecto>/.

const NOMBRE_CARPETA_COBRANZA = 'Cotizador Helgen — Cobranza';
const NOMBRE_LIBRO_COBRANZA = 'Cotizador Helgen — Cobranza (datos)';
const PREFIJO_PAGO = 'PAG';

/** Estructura del libro. numeros = columnas (1 = A) con formato de importe; las demás van como texto. */
const HOJAS_COBRANZA = {
  Contratos: {
    enc: ['proyecto_folio', 'cotizacion_aceptada', 'marca', 'moneda', 'subtotal', 'iva', 'total', 'estado',
      'aceptada_por', 'fecha_aceptacion', 'fecha_firma', 'firmado_por', 'actualizado'],
    numeros: [5, 6, 7],
  },
  Esquemas: { enc: ['proyecto_folio', 'orden', 'etapa', 'porcentaje', 'monto'], numeros: [2, 4, 5] },
  Pagos: {
    enc: ['folio', 'fecha_pago', 'fecha_registro', 'proyecto_folio', 'monto', 'moneda_pago', 'tipo_cambio',
      'monto_aplicado', 'moneda_proyecto', 'metodo', 'referencia', 'etapa_orden', 'etapa', 'aplicacion (JSON)',
      'comprobante_id', 'comprobante_url', 'registro_email', 'registro_nombre', 'estado', 'cancelado_por',
      'fecha_cancelacion', 'motivo_cancelacion'],
    numeros: [5, 7, 8, 12],
  },
  Bitacora: { enc: ['fecha', 'correo', 'accion', 'proyecto_folio', 'detalle', 'motivo'], numeros: [] },
};
const ESTADO_ACEPTADA = 'Aceptada', ESTADO_FIRMADO = 'Firmado';

/** Error de permisos: doPost lo manda con codigo 'PERMISO'. */
function errorPermiso_(mensaje) {
  const e = new Error(mensaje);
  e.codigo = 'PERMISO';
  return e;
}

/** ¿Tiene el rol cobranza? (Permisos; antes ROL_COBRANZA) */
function esCobranza_() {
  return tieneRol_('cobranza');
}

/** ¿Puede desbloquear contratos firmados? (rol desbloqueo; antes ADMIN_DESBLOQUEO; sin nadie en la lista, nadie). */
function esAdminDesbloqueo_() {
  return tieneRol_('desbloqueo');
}

function exigirCobranza_() {
  if (!VENDEDOR_) throw errorSesion_('Inicia sesión con tu cuenta @' + DOMINIO_HELGEN + '.');
  if (!esCobranza_()) throw errorPermiso_('No tienes permiso de cobranza.');
}

/**
 * Deja un archivo o carpeta de cobranza en "Restringido": quita el acceso de todo el dominio o por enlace y conserva a
 * las personas agregadas una por una (tania@, leo@). Workspace comparte con todo helgen.tech lo que se crea (§6.11).
 * Usa la API de Drive con el token del script: DriveApp.setSharing da "Access denied: DriveApp." en helgen.tech
 * (20/10/2026). No pide permisos nuevos (el de Drive ya lo da DriveApp). Si no puede, lanza error: nada queda abierto.
 * Restringir siempre de arriba abajo: un permiso heredado de la carpeta no se puede quitar en el hijo (403).
 */
function privado_(item) {
  const url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(item.getId()) + '/permissions';
  const opciones = { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  const r = UrlFetchApp.fetch(url + '?supportsAllDrives=true&fields=permissions(id,type)', opciones);
  if (r.getResponseCode() !== 200) throw new Error('No se pudo revisar el acceso en Drive (' + r.getResponseCode() + '): ' + r.getContentText());
  (JSON.parse(r.getContentText()).permissions || [])
    .filter(p => p.type === 'domain' || p.type === 'anyone')
    .forEach(p => {
      const d = UrlFetchApp.fetch(url + '/' + encodeURIComponent(p.id) + '?supportsAllDrives=true',
        Object.assign({ method: 'delete' }, opciones));
      if (d.getResponseCode() >= 300) throw new Error('No se pudo restringir el acceso en Drive (' + d.getResponseCode() + '): ' + d.getContentText());
    });
  return item;
}

// Áreas privadas (cobranza, compras): carpeta en Mi unidad + libro dentro de ella, restringidos, con sus IDs en
// Script Properties. Se crean solos la primera vez; si después no se encuentran, error (no se crean otros a escondidas).
const AREA_COBRANZA = { que: 'cobranza', propCarpeta: 'COBRANZA_FOLDER_ID', propLibro: 'COBRANZA_DB_ID',
  carpeta: NOMBRE_CARPETA_COBRANZA, libro: NOMBRE_LIBRO_COBRANZA, hojas: HOJAS_COBRANZA };

/** Carpeta del área. Se crea sola en Mi unidad (restringida). Si se borró, error. */
function carpetaArea_(area) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(area.propCarpeta);
  if (!id) {
    const carpeta = privado_(DriveApp.createFolder(area.carpeta));
    props.setProperty(area.propCarpeta, carpeta.getId());
    return carpeta;
  }
  let carpeta = null;
  try { carpeta = DriveApp.getFolderById(id); } catch (e) { carpeta = null; }
  if (!carpeta || carpeta.isTrashed()) {
    throw new Error('No se encontró la carpeta de ' + area.que + ' (' + area.propCarpeta + '). Revisa la Papelera de Drive.');
  }
  return privado_(carpeta);
}

/** Libro del área; la primera vez lo crea dentro de su carpeta (bajo candado). */
function libroArea_(area) {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(area.propLibro)) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) throw new Error('Se está preparando ' + area.que + '. Intenta de nuevo en unos segundos.');
    try {
      if (!props.getProperty(area.propLibro)) crearLibroArea_(area);
    } finally {
      lock.releaseLock();
    }
  }
  return abrirLibroArea_(area, props.getProperty(area.propLibro));
}

/** Libro del área si ya existe; null si todavía no se crea. */
function libroAreaSiExiste_(area) {
  const id = PropertiesService.getScriptProperties().getProperty(area.propLibro);
  return id ? abrirLibroArea_(area, id) : null;
}

function abrirLibroArea_(area, id) {
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('No se pudo abrir el libro de ' + area.que + ' (' + area.propLibro + '). Revisa que no esté en la Papelera.');
  }
}

function crearLibroArea_(area) {
  const carpeta = carpetaArea_(area);
  const ss = SpreadsheetApp.create(area.libro);
  privado_(DriveApp.getFileById(ss.getId())).moveTo(carpeta);
  Object.keys(area.hojas).forEach(nombre => hojaDeArea_(ss, area.hojas, nombre));
  const sobrante = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (sobrante && ss.getSheets().length > 1) ss.deleteSheet(sobrante);
  PropertiesService.getScriptProperties().setProperty(area.propLibro, ss.getId());
}

function carpetaCobranza_() { return carpetaArea_(AREA_COBRANZA); }
function libroCobranza_() { return libroArea_(AREA_COBRANZA); }
/** Libro de cobranza si ya existe; null si todavía no se crea (las cotizaciones no lo crean). */
function libroCobranzaSiExiste_() { return libroAreaSiExiste_(AREA_COBRANZA); }

/** Pestaña del libro de cobranza; la crea o le repone los encabezados (patrón de hojaProyectos_). */
function hojaCobranza_(libro, nombre) {
  return hojaDeArea_(libro, HOJAS_COBRANZA, nombre);
}

/** Pestaña de un libro de área (estructura en `hojas`); la crea o le repone los encabezados. */
function hojaDeArea_(libro, hojas, nombre) {
  const def = hojas[nombre];
  let hoja = libro.getSheetByName(nombre);
  if (!hoja) {
    hoja = libro.insertSheet(nombre);
    hoja.setFrozenRows(1);
    hoja.getRange(1, 1, hoja.getMaxRows(), def.enc.length).setNumberFormat('@'); // texto: nada se lee como fórmula
    def.numeros.forEach(c => hoja.getRange(2, c, hoja.getMaxRows() - 1, 1).setNumberFormat('#,##0.00##'));
  }
  const actuales = hoja.getRange(1, 1, 1, def.enc.length).getValues()[0];
  if (def.enc.some((h, i) => actuales[i] !== h)) {
    hoja.getRange(1, 1, 1, def.enc.length).setValues([def.enc])
      .setFontWeight('bold').setBackground('#2C3C5B').setFontColor('#FFFFFF');
  }
  return hoja;
}

/** Filas de datos (sin encabezado) de una pestaña, con el ancho de sus encabezados. */
function filasCobranza_(hoja, nombre) {
  return filasDeArea_(hoja, HOJAS_COBRANZA, nombre);
}

function filasDeArea_(hoja, hojas, nombre) {
  const n = hojas[nombre].enc.length;
  return hoja.getLastRow() > 1 ? hoja.getRange(2, 1, hoja.getLastRow() - 1, n).getValues() : [];
}

const marcaDeTexto_ = t => (String(t || '').trim() === MARCAS.energy || t === 'energy') ? 'energy' : 'helgen';

function contratoDesdeFila_(r, fila) {
  return {
    proyectoFolio: String(r[0]), cotizacion: String(r[1]), marca: marcaDeTexto_(r[2]), moneda: String(r[3] || 'MXN'),
    subtotal: Number(r[4]) || 0, iva: Number(r[5]) || 0, total: Number(r[6]) || 0, estado: String(r[7] || ''),
    aceptadaPor: String(r[8] || ''), fechaAceptacion: fechaTexto_(r[9]), fechaFirma: fechaIso_(r[10]),
    firmadoPor: String(r[11] || ''), fila: fila,
  };
}

function pagoDesdeFila_(r, fila) {
  return {
    folio: String(r[0]), fecha: fechaIso_(r[1]), fechaRegistro: fechaTexto_(r[2]), proyectoFolio: String(r[3]),
    monto: Number(r[4]) || 0, monedaPago: String(r[5] || ''), tipoCambio: r[6] === '' ? '' : Number(r[6]),
    montoAplicado: Number(r[7]) || 0, monedaProyecto: String(r[8] || ''), metodo: String(r[9] || ''),
    referencia: String(r[10] || ''), etapaOrden: Number(r[11]) || 1, etapa: String(r[12] || ''),
    comprobanteUrl: String(r[15] || ''), registro: String(r[17] || r[16] || ''), estado: String(r[18] || 'Vigente'),
    canceladoPor: String(r[19] || ''), motivoCancelacion: String(r[21] || ''), fila: fila,
  };
}

function fechaTexto_(v) {
  return v instanceof Date ? Utilities.formatDate(v, 'America/Mexico_City', 'dd/MM/yyyy HH:mm') : String(v || '');
}

/**
 * Fecha sin hora (pago, firma) como "AAAA-MM-DD". Se escriben con apóstrofo (textoFecha_) para que Sheets no las
 * convierta en fecha (appendRow lo hace aunque la columna sea texto); las filas guardadas antes vienen como Date.
 */
function fechaIso_(v) {
  return v instanceof Date ? Utilities.formatDate(v, 'America/Mexico_City', 'yyyy-MM-dd') : String(v || '');
}
const textoFecha_ = iso => iso ? "'" + iso : '';

const hoyIso_ = () => Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd');

/** Todo lo de cobranza de un proyecto, leído del libro. */
function datosCobranza_(libro, folio) {
  const f = String(folio).toUpperCase();
  const hC = hojaCobranza_(libro, 'Contratos'), hE = hojaCobranza_(libro, 'Esquemas'), hP = hojaCobranza_(libro, 'Pagos');
  let contrato = null;
  filasCobranza_(hC, 'Contratos').forEach((r, i) => {
    if (String(r[0]).toUpperCase() === f) contrato = contratoDesdeFila_(r, i + 2);
  });
  const etapas = filasCobranza_(hE, 'Esquemas')
    .filter(r => String(r[0]).toUpperCase() === f)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map(r => ({ etapa: String(r[2]), porcentaje: Number(r[3]) }));
  const pagos = [];
  filasCobranza_(hP, 'Pagos').forEach((r, i) => {
    if (String(r[3]).toUpperCase() === f) pagos.push(pagoDesdeFila_(r, i + 2));
  });
  return { hojas: { contratos: hC, esquemas: hE, pagos: hP }, contrato: contrato, etapas: etapas, pagos: pagos };
}

/** {"PRY-2026-0001": <contrato>, …} de todos los contratos (aceptados y firmados), leídos de la hoja. Sin libro: ninguno. */
function contratosDelLibro_() {
  const libro = libroCobranzaSiExiste_();
  const mapa = {};
  if (!libro) return mapa;
  const hoja = libro.getSheetByName('Contratos');
  if (!hoja) return mapa;
  filasCobranza_(hoja, 'Contratos').forEach((r, i) => {
    if (String(r[0] || '').trim()) mapa[String(r[0]).toUpperCase()] = contratoDesdeFila_(r, i + 2);
  });
  return mapa;
}

/** {"PRY-2026-0001": <contrato>, …} de proyectos con contrato firmado. Sin libro de cobranza: ninguno. */
function contratosFirmados_() {
  const todos = contratosDelLibro_(), mapa = {};
  Object.keys(todos).forEach(f => { if (todos[f].estado === ESTADO_FIRMADO) mapa[f] = todos[f]; });
  return mapa;
}

/** {"PRY-2026-0001": <contrato>, …}: se usa como "¿tiene contrato firmado?". */
function foliosConContratoFirmado_() {
  return contratosFirmados_();
}

/** Cotizaciones ligadas a un proyecto (columna T), de la hoja Cotizaciones. */
function cotizacionesDeProyecto_(folio) {
  const f = String(folio).toUpperCase();
  const hoja = db_().getSheetByName('Cotizaciones');
  return hoja.getDataRange().getValues().slice(1)
    .filter(r => String(r[19] || '').toUpperCase() === f && String(r[0] || '').trim())
    .map(r => ({
      folio: String(r[0]), fecha: r[1] instanceof Date ? Utilities.formatDate(r[1], 'America/Mexico_City', 'dd/MM/yyyy') : String(r[1] || ''),
      cliente: String(r[2] || ''), subtotal: Number(r[7]) || 0, iva: Number(r[8]) || 0, total: Number(r[9]) || 0,
      pdf: String(r[11] || ''), marca: marcaDeTexto_(r[14]), moneda: String(r[20] || '') || 'MXN',
      vendedor: vendedorDeFila(r, {}),
    }));
}

/** Proyecto existente (o error). */
function proyectoParaCobranza_(folio) {
  const proyecto = buscarProyecto_(hojaProyectos_(), folio);
  if (!proyecto) throw new Error('No existe el proyecto ' + String(folio || '').toUpperCase() + '.');
  return proyecto;
}

/** Renglón en la Bitacora del libro (cobranza por omisión; compras pasa HOJAS_COMPRAS: mismas columnas). */
function bitacora_(libro, accion, folio, detalle, motivo, hojas) {
  const t = textoCelda;
  hojaDeArea_(libro, hojas || HOJAS_COBRANZA, 'Bitacora').appendRow([
    Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss'), t(VENDEDOR_ ? VENDEDOR_.email : ''),
    t(accion), t(folio), t(detalle || ''), t(motivo || ''),
  ]);
}

/** Reescribe las etapas del proyecto en "Esquemas" (borra las anteriores) con sus montos. */
function escribirEsquema_(hoja, folio, etapas, total) {
  const f = String(folio).toUpperCase();
  const filas = filasCobranza_(hoja, 'Esquemas');
  for (let i = filas.length - 1; i >= 0; i--) {
    if (String(filas[i][0]).toUpperCase() === f) hoja.deleteRow(i + 2);
  }
  montosDeEsquema(etapas, total).forEach((e, i) => hoja.appendRow([f, i + 1, textoCelda(e.etapa), e.porcentaje, e.monto]));
}

/** Respuesta para la pestaña Cobranza: proyecto, cotizaciones, contrato, esquema con avance y pagos. */
function vistaCobranza_(libro, proyecto) {
  const d = datosCobranza_(libro, proyecto.folio);
  const c = d.contrato;
  const resumen = c && d.etapas.length ? resumenCobranza(c, d.etapas, d.pagos) : null;
  return {
    proyecto: datosProyectoCompras_(proyecto),
    cotizaciones: cotizacionesDeProyecto_(proyecto.folio),
    contrato: c ? { cotizacion: c.cotizacion, marca: c.marca, moneda: c.moneda, subtotal: c.subtotal, iva: c.iva,
      total: c.total, estado: c.estado, aceptadaPor: c.aceptadaPor, fechaAceptacion: c.fechaAceptacion,
      fechaFirma: c.fechaFirma, firmadoPor: c.firmadoPor } : null,
    esquema: d.etapas,
    resumen: resumen,
    pagos: d.pagos.map(p => { const o = Object.assign({}, p); delete o.fila; return o; }).reverse(),
    esquemaEditable: !!c && c.estado !== ESTADO_FIRMADO && (c.marca !== 'energy' || esAdminDesbloqueo_()),
    esquemaPideMotivo: !!c && c.estado !== ESTADO_FIRMADO && c.marca === 'energy' && esAdminDesbloqueo_(),
    // Proyecto cancelado: no se acepta ni se firma (marcarAceptada y firmarContrato también lo rechazan)
    puedeAceptar: proyecto.estado !== 'Cancelado' && !(c && c.estado === ESTADO_FIRMADO),
    puedeFirmar: proyecto.estado !== 'Cancelado' && !!c && c.estado === ESTADO_ACEPTADA,
    puedePagar: !!c && c.estado === ESTADO_FIRMADO,
    puedeDesbloquear: !!c && c.estado === ESTADO_FIRMADO && esAdminDesbloqueo_(),
    // Solo llega al rol de cobranza (vistaCobranza_ se llama después de exigirCobranza_)
    margen: c ? margenDeContrato_(c) : margenSinContrato_(proyecto.folio),
    metodos: METODOS_PAGO,
    hoy: hoyIso_(),
  };
}

/**
 * Margen del proyecto: contratado sin IVA − costos (fase 3: órdenes de compra vigentes; fase 4: nómina y horas se
 * agregan a la lista de costos). Si algo no cuadra (p. ej. una orden en otra moneda), {error} y la vista carga igual.
 */
function margenDeContrato_(contrato) {
  try {
    const ordenes = ordenesDeProyecto_(libroComprasSiExiste_(), contrato.proyectoFolio).filter(o => o.estado !== OC_CANCELADA);
    return margenProyecto(contrato.subtotal, contrato.moneda, costosDeOrdenes(ordenes, contrato.moneda));
  } catch (e) {
    return { error: 'No se pudo calcular el margen: ' + e.message };
  }
}

/** Sin cotización aceptada no hay margen: solo el costo de las órdenes de compra vigentes, por moneda. null si no hay. */
function margenSinContrato_(proyectoFolio) {
  try {
    const ordenes = ordenesDeProyecto_(libroComprasSiExiste_(), proyectoFolio).filter(o => o.estado !== OC_CANCELADA);
    return ordenes.length ? { sinContrato: true, costos: costosDeOrdenes(ordenes, 'MXN') } : null;
  } catch (e) {
    return { error: 'No se pudo calcular el costo de las órdenes: ' + e.message };
  }
}

/** Candado de script (el mismo de folios) alrededor de una función. */
function conCandado_(f) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('El sistema está ocupado guardando otro registro. Intenta de nuevo en unos segundos.');
  try {
    return f();
  } finally {
    lock.releaseLock();
  }
}

/** Proyectos para el buscador de Cobranza (todos los estados), con el estado de su contrato. */
function listarProyectosCobranza(busqueda) {
  exigirCobranza_();
  // La primera vez que alguien de cobranza entra se crean la carpeta y el libro (después ya no se abre aquí)
  if (!PropertiesService.getScriptProperties().getProperty(AREA_COBRANZA.propLibro)) libroCobranza_();
  const contratos = contratosCache_();
  return listarProyectos(busqueda, true).map(p => Object.assign(p, { contrato: (contratos[p.folio.toUpperCase()] || {}).estado || '' }));
}

function getCobranzaProyecto(folio) {
  exigirCobranza_();
  const libro = libroCobranza_();
  return vistaCobranza_(libro, proyectoParaCobranza_(folio));
}

/**
 * Resumen de cobranza de todos los proyectos con contrato (solo rol de cobranza; solo lee). Lee una vez Contratos, Esquemas,
 * Pagos, Proyectos y las órdenes de compra, y calcula con resumenGeneralCobranza (las mismas cifras que la vista de cada proyecto).
 */
function resumenCobranzaGeneral(soloSiHay) {
  exigirCobranza_();
  // En caché por versiones (contratos, pagos, órdenes y proyectos); soloSiHay = no calcularlo si no está (carga inicial)
  return enCache_('resumenCob', ['proyectos', 'contratos', 'pagosCobranza', 'oc'], TTL_CACHE,
    soloSiHay ? null : resumenCobranzaDeHojas_) || null;
}

function resumenCobranzaDeHojas_() {
  const libro = libroCobranza_();
  const contratos = filasCobranza_(hojaCobranza_(libro, 'Contratos'), 'Contratos')
    .map((r, i) => contratoDesdeFila_(r, i + 2)).filter(c => c.proyectoFolio);
  const esquemas = filasCobranza_(hojaCobranza_(libro, 'Esquemas'), 'Esquemas')
    .map(r => ({ proyectoFolio: String(r[0]), orden: Number(r[1]), etapa: String(r[2]), porcentaje: Number(r[3]) }));
  const pagos = filasCobranza_(hojaCobranza_(libro, 'Pagos'), 'Pagos').map((r, i) => pagoDesdeFila_(r, i + 2));
  const proyectos = proyectosCache_();
  const libroCompras = libroComprasSiExiste_();
  const ordenes = libroCompras
    ? filasDeArea_(hojaCompras_(libroCompras, 'OrdenesCompra'), HOJAS_COMPRAS, 'OrdenesCompra')
      .filter(r => String(r[0] || '').trim()).map((r, i) => ordenDesdeFila_(r, i + 2))
    : [];
  return Object.assign(resumenGeneralCobranza({ contratos: contratos, esquemas: esquemas, pagos: pagos, proyectos: proyectos,
    ordenes: ordenes }), { hoy: hoyIso_() });
}

/**
 * Marca la cotización aceptada del proyecto (una sola; se puede cambiar hasta firmar). Copia sus montos, marca y
 * moneda al contrato. Si la nueva es de Helgen Energy y el esquema actual no es el 60/30/10, pide confirmar
 * (devuelve {confirmar, mensaje}) antes de reemplazarlo.
 */
function marcarAceptada(proyectoFolio, cotizacionFolio, confirmado) {
  exigirCobranza_();
  const libro = libroCobranza_();
  return conCandado_(() => {
    const proyecto = proyectoParaCobranza_(proyectoFolio);
    if (proyecto.estado === 'Cancelado') throw new Error('El proyecto ' + proyecto.folio + ' está cancelado.');
    const folioCot = String(cotizacionFolio || '').trim().toUpperCase();
    const cot = cotizacionesDeProyecto_(proyecto.folio).find(c => c.folio.toUpperCase() === folioCot);
    if (!cot) throw new Error('La cotización ' + folioCot + ' no pertenece al proyecto ' + proyecto.folio + '.');

    const d = datosCobranza_(libro, proyecto.folio);
    const c = d.contrato;
    if (c && c.estado === ESTADO_FIRMADO) throw new Error('Contrato firmado: la cotización aceptada ya no se puede cambiar.');
    if (c && c.cotizacion === cot.folio) return vistaCobranza_(libro, proyecto);
    const vigentes = d.pagos.filter(p => p.estado === 'Vigente');
    if (vigentes.length && vigentes[0].monedaProyecto && vigentes[0].monedaProyecto !== cot.moneda) {
      throw new Error('El proyecto ya tiene pagos en ' + vigentes[0].monedaProyecto + ': la cotización aceptada debe ser en ' +
        vigentes[0].monedaProyecto + '.');
    }
    // Lo mismo con las órdenes de compra vigentes: su costo está en la moneda del proyecto (el margen nunca mezcla monedas)
    const oc = ordenesDeProyecto_(libroComprasSiExiste_(), proyecto.folio)
      .find(o => o.estado !== OC_CANCELADA && o.monedaProyecto && o.monedaProyecto !== cot.moneda);
    if (oc) {
      throw new Error('El proyecto ya tiene órdenes de compra en ' + oc.monedaProyecto + ': la cotización aceptada debe ser en ' +
        oc.monedaProyecto + '.');
    }

    // Esquema: al pasar a Helgen Energy se pone el 60/30/10 (después solo el administrador lo cambia); entre cotizaciones
    // de la misma línea, o de Energy a Helgen, se conserva el que ya tenga
    const porOmision = esquemaPorOmision();
    const igualAlDeOmision = d.etapas.length === porOmision.length &&
      d.etapas.every((e, i) => e.etapa === porOmision[i].etapa && e.porcentaje === porOmision[i].porcentaje);
    const pasaAEnergy = cot.marca === 'energy' && (!c || c.marca !== 'energy');
    if (pasaAEnergy && d.etapas.length && !igualAlDeOmision && !confirmado) {
      return { confirmar: true, mensaje: 'La cotización ' + cot.folio + ' es de Helgen Energy: su esquema de pagos es ' +
        '60% Anticipo, 30% Instalación, 10% Encendido del sistema, y reemplazará el esquema actual. ¿Continuar?' };
    }
    const etapas = pasaAEnergy || !d.etapas.length ? porOmision : d.etapas;

    const t = textoCelda;
    const fila = [proyecto.folio, cot.folio, MARCAS[cot.marca], cot.moneda, cot.subtotal, cot.iva, cot.total, ESTADO_ACEPTADA,
      t(VENDEDOR_.email), Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm'), '', '',
      Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm')];
    if (c) d.hojas.contratos.getRange(c.fila, 1, 1, fila.length).setValues([fila]);
    else d.hojas.contratos.appendRow(fila);
    escribirEsquema_(d.hojas.esquemas, proyecto.folio, etapas, cot.total);
    bitacora_(libro, c ? 'Cambiar cotización aceptada' : 'Marcar cotización aceptada', proyecto.folio,
      cot.folio + ' · ' + MARCAS[cot.marca] + ' · total ' + formatoMoneda(cot.total) + ' ' + cot.moneda +
      (c ? ' (antes ' + c.cotizacion + ')' : ''));
    SpreadsheetApp.flush();
    return vistaCobranza_(libro, proyecto);
  });
}

/**
 * Guarda el esquema de pagos (solo antes de firmar). Helgen: rol de cobranza. Helgen Energy (60/30/10 por omisión): solo
 * ADMIN_DESBLOQUEO, con motivo que queda en la Bitacora.
 */
function guardarEsquema(proyectoFolio, etapas, motivo) {
  exigirCobranza_();
  const limpio = validarEsquema(etapas);
  const m = String(motivo || '').trim();
  const libro = libroCobranza_();
  return conCandado_(() => {
    const proyecto = proyectoParaCobranza_(proyectoFolio);
    const d = datosCobranza_(libro, proyecto.folio);
    const c = d.contrato;
    if (!c) throw new Error('Primero marca la cotización aceptada del proyecto.');
    if (c.estado === ESTADO_FIRMADO) throw new Error('Contrato firmado: el esquema de pagos ya no se puede cambiar.');
    if (c.marca === 'energy') {
      if (!esAdminDesbloqueo_()) throw errorPermiso_('El esquema de Helgen Energy solo lo puede cambiar el administrador.');
      if (m.length < 5) throw new Error('Escribe el motivo del cambio al esquema de Helgen Energy.');
      if (m.length > 500) throw new Error('El motivo debe tener máximo 500 caracteres.');
    }
    const antes = d.etapas.map(e => e.etapa + ' ' + e.porcentaje + '%').join(' · ');
    escribirEsquema_(d.hojas.esquemas, proyecto.folio, limpio, c.total);
    bitacora_(libro, c.marca === 'energy' ? 'Editar esquema de pagos (Helgen Energy)' : 'Editar esquema de pagos', proyecto.folio,
      limpio.map(e => e.etapa + ' ' + e.porcentaje + '%').join(' · ') + (antes ? ' (antes ' + antes + ')' : ''),
      c.marca === 'energy' ? m : '');
    SpreadsheetApp.flush();
    return vistaCobranza_(libro, proyecto);
  });
}

/** Contrato firmado (fecha AAAA-MM-DD): fija la aceptada, el monto contratado y el esquema. */
function firmarContrato(proyectoFolio, fecha) {
  exigirCobranza_();
  const libro = libroCobranza_();
  return conCandado_(() => {
    const proyecto = proyectoParaCobranza_(proyectoFolio);
    const fechaFirma = validarFechaIso(fecha, hoyIso_(), 'La fecha de firma');
    const d = datosCobranza_(libro, proyecto.folio);
    const c = d.contrato;
    if (!c) throw new Error('Primero marca la cotización aceptada del proyecto.');
    if (c.estado === ESTADO_FIRMADO) throw new Error('El contrato de ' + proyecto.folio + ' ya está firmado.');
    if (proyecto.estado === 'Cancelado') throw new Error('El proyecto ' + proyecto.folio + ' está cancelado.');
    const etapas = validarEsquema(d.etapas);
    // Tras un desbloqueo puede haber pagos: el nuevo monto no puede quedar por debajo de lo pagado
    const r = resumenCobranza(c, etapas, d.pagos);
    if (r.saldo < -TOLERANCIA_PAGO) {
      throw new Error('Lo pagado (' + formatoMoneda(r.pagado) + ' ' + c.moneda + ') supera el monto contratado (' +
        formatoMoneda(r.contratado) + ').');
    }
    escribirEsquema_(d.hojas.esquemas, proyecto.folio, etapas, c.total);
    d.hojas.contratos.getRange(c.fila, 8).setValue(ESTADO_FIRMADO);
    d.hojas.contratos.getRange(c.fila, 11, 1, 3).setValues([[textoFecha_(fechaFirma), textoCelda(VENDEDOR_.email),
      Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm')]]);
    bitacora_(libro, 'Contrato firmado', proyecto.folio, 'Fecha de firma ' + fechaFirma + ' · ' + c.cotizacion + ' · ' +
      formatoMoneda(c.total) + ' ' + c.moneda + ' · ' + etapas.map(e => e.etapa + ' ' + e.porcentaje + '%').join(' · '));
    SpreadsheetApp.flush();
    return vistaCobranza_(libro, proyecto);
  });
}

/** Desbloqueo por error: solo ADMIN_DESBLOQUEO, con motivo. El contrato vuelve a "Aceptada"; los pagos se conservan. */
function desbloquearContrato(proyectoFolio, motivo) {
  exigirCobranza_();
  if (!esAdminDesbloqueo_()) throw errorPermiso_('Solo el administrador puede desbloquear un contrato firmado.');
  const m = String(motivo || '').trim();
  if (m.length < 5) throw new Error('Escribe el motivo del desbloqueo.');
  if (m.length > 500) throw new Error('El motivo debe tener máximo 500 caracteres.');
  const libro = libroCobranza_();
  return conCandado_(() => {
    const proyecto = proyectoParaCobranza_(proyectoFolio);
    const d = datosCobranza_(libro, proyecto.folio);
    const c = d.contrato;
    if (!c || c.estado !== ESTADO_FIRMADO) throw new Error('El contrato de ' + proyecto.folio + ' no está firmado.');
    d.hojas.contratos.getRange(c.fila, 8).setValue(ESTADO_ACEPTADA);
    d.hojas.contratos.getRange(c.fila, 11, 1, 3).setValues([['', '',
      Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm')]]);
    bitacora_(libro, 'Desbloquear contrato', proyecto.folio,
      'Estaba firmado el ' + c.fechaFirma + ' por ' + c.firmadoPor + ' · ' + c.cotizacion, m);
    SpreadsheetApp.flush();
    return vistaCobranza_(libro, proyecto);
  });
}

/**
 * Registra un pago con su comprobante (obligatorio). p = {proyectoFolio, fecha, monto, monedaPago, tipoCambio, metodo,
 * referencia, etapaOrden, comprobante: {datos (base64)}, idSolicitud}. Solo con contrato firmado; si el pago excede su
 * etapa, el excedente pasa a la siguiente; si excede el saldo del proyecto (más la tolerancia), se rechaza.
 */
function registrarPago(p) {
  exigirCobranza_();
  const d0 = p || {};
  let bytes;
  try {
    bytes = d0.comprobante && d0.comprobante.datos ? Utilities.base64Decode(String(d0.comprobante.datos)) : null;
  } catch (e) {
    throw new Error('No se pudo leer el comprobante. Vuelve a adjuntarlo.');
  }
  const tipo = validarComprobante(bytes);
  const libro = libroCobranza_();

  const idSolicitud = String(d0.idSolicitud || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const claveCache = idSolicitud ? 'PAG_' + idSolicitud : '';

  return conCandado_(() => {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) return JSON.parse(previo);
    }
    const proyecto = proyectoParaCobranza_(d0.proyectoFolio);
    const d = datosCobranza_(libro, proyecto.folio);
    const c = d.contrato;
    if (!c || c.estado !== ESTADO_FIRMADO) throw new Error('Solo se registran pagos en proyectos con contrato firmado.');
    const pago = normalizarPago(d0, { moneda: c.moneda, etapas: d.etapas.length, hoy: hoyIso_() });

    const resumen = resumenCobranza(c, d.etapas, d.pagos);
    if (aCentavos(pago.montoAplicado) > aCentavos(resumen.saldo) + aCentavos(TOLERANCIA_PAGO)) {
      throw new Error('El pago (' + formatoMoneda(pago.montoAplicado) + ' ' + c.moneda + ') excede el saldo del proyecto (' +
        formatoMoneda(Math.max(resumen.saldo, 0)) + ' ' + c.moneda + ').');
    }
    const reparto = repartirPago(resumen.etapas, pago.etapaOrden - 1, pago.montoAplicado);
    if (reparto.sobranteCts) reparto.aplicacion.push({ orden: pago.etapaOrden, centavos: reparto.sobranteCts });
    const aplicacion = reparto.aplicacion.map(a => ({ etapa: d.etapas[a.orden - 1].etapa, orden: a.orden, monto: a.centavos / 100 }));

    const hojaPagos = d.hojas.pagos;
    const folio = siguienteFolio_(PREFIJO_PAGO, hojaPagos, 'CONSECUTIVO_PAG_');
    const anio = String(proyecto.folio).split('-')[1] || hoyIso_().slice(0, 4);
    const carpeta = privado_(subcarpeta_(privado_(subcarpeta_(carpetaCobranza_(), anio)), proyecto.folio));
    const archivo = privado_(carpeta.createFile(Utilities.newBlob(bytes, tipo.mime,
      nombreComprobante(folio, pago.metodo, pago.referencia, tipo.ext))));

    const t = textoCelda;
    hojaPagos.appendRow([
      folio, textoFecha_(pago.fecha), Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss'), proyecto.folio,
      pago.monto, pago.monedaPago, pago.tipoCambio, pago.montoAplicado, c.moneda, pago.metodo, t(pago.referencia),
      pago.etapaOrden, t(d.etapas[pago.etapaOrden - 1].etapa), JSON.stringify(aplicacion), archivo.getId(), archivo.getUrl(),
      t(VENDEDOR_.email), t([VENDEDOR_.nombre, VENDEDOR_.apellido].filter(Boolean).join(' ')), 'Vigente', '', '', '',
    ]);
    bitacora_(libro, 'Registrar pago', proyecto.folio, folio + ' · ' + formatoMoneda(pago.monto) + ' ' + pago.monedaPago +
      (pago.tipoCambio ? ' · TC ' + pago.tipoCambio + ' = ' + formatoMoneda(pago.montoAplicado) + ' ' + c.moneda : '') +
      ' · ' + pago.metodo + ' · ' + aplicacion.map(a => a.etapa + ' ' + formatoMoneda(a.monto)).join(' + '));
    SpreadsheetApp.flush();

    const resultado = { folio: folio, url: archivo.getUrl(), vista: vistaCobranza_(libro, proyecto) };
    if (claveCache) cache.put(claveCache, JSON.stringify(resultado), 21600); // 6 h
    return resultado;
  });
}

/** Cancela un pago (no se borra): rol de cobranza, con motivo; queda en la Bitácora. */
function cancelarPago(folioPago, motivo) {
  exigirCobranza_();
  const m = String(motivo || '').trim();
  if (m.length < 5) throw new Error('Escribe el motivo de la cancelación.');
  if (m.length > 500) throw new Error('El motivo debe tener máximo 500 caracteres.');
  const libro = libroCobranza_();
  return conCandado_(() => {
    const folio = String(folioPago || '').trim().toUpperCase();
    const hoja = hojaCobranza_(libro, 'Pagos');
    let pago = null;
    filasCobranza_(hoja, 'Pagos').forEach((r, i) => { if (String(r[0]).toUpperCase() === folio) pago = pagoDesdeFila_(r, i + 2); });
    if (!pago) throw new Error('No existe el pago ' + folio + '.');
    if (pago.estado !== 'Vigente') throw new Error('El pago ' + folio + ' ya está cancelado.');
    hoja.getRange(pago.fila, 19, 1, 4).setValues([['Cancelado', textoCelda(VENDEDOR_.email),
      Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss'), textoCelda(m)]]);
    bitacora_(libro, 'Cancelar pago', pago.proyectoFolio, folio + ' · ' + formatoMoneda(pago.monto) + ' ' + pago.monedaPago, m);
    SpreadsheetApp.flush();
    return vistaCobranza_(libro, proyectoParaCobranza_(pago.proyectoFolio));
  });
}

/**
 * Correr desde el editor: crea la carpeta "Cotizador Helgen — Cobranza" (en Mi unidad) y su libro, y deja los dos en
 * "Restringido" (también si ya existían). Sirve para autorizar permisos antes de publicar (§6.8). No comparte nada.
 */
function prepararCobranza() {
  const libro = libroCobranza_();
  const carpeta = carpetaCobranza_(); // primero la carpeta: el libro hereda su acceso y Drive no deja quitarlo en el hijo
  const archivoLibro = privado_(DriveApp.getFileById(libro.getId()));
  Logger.log('Carpeta de cobranza: ' + carpeta.getUrl() + ' (restringida)');
  Logger.log('Libro de cobranza:   ' + archivoLibro.getUrl() + ' (restringido)');
  Logger.log('ROL_COBRANZA: ' + (PropertiesService.getScriptProperties().getProperty('ROL_COBRANZA') || '(vacío: nadie tiene acceso)'));
}

// ====== 4.3 COMPRAS (Fase 3): órdenes de compra por proyecto ======
// Libro aparte "Cotizador Helgen — Compras (datos)" dentro de la carpeta "Cotizador Helgen — Compras" (fuera de la carpeta
// maestra y de la de cobranza). Solo el rol de compras (ROL_COMPRAS) ve, paga y cancela órdenes; el servidor lo revisa en
// cada llamada. Toda orden sale de una requisición autorizada (4.4). PDF en Compras/AAAA/<folio del proyecto>/.
// El margen (contratado − órdenes) solo lo ve cobranza.

const NOMBRE_CARPETA_COMPRAS = 'Cotizador Helgen — Compras';
const NOMBRE_LIBRO_COMPRAS = 'Cotizador Helgen — Compras (datos)';
const PREFIJO_OC = 'OC';
const OC_EMITIDA = 'Emitida', OC_PAGADA = 'Pagada', OC_RECIBIDA = 'Recibida', OC_CANCELADA = 'Cancelada';

/** Estructura del libro de compras (mismo formato que HOJAS_COBRANZA). */
const HOJAS_COMPRAS = {
  OrdenesCompra: {
    enc: ['folio', 'fecha', 'proyecto_folio', 'marca', 'proveedor_id', 'proveedor', 'rfc', 'contacto', 'correo', 'telefono',
      'fecha_entrega', 'lugar_entrega', 'condiciones_pago', 'moneda', 'iva_tasa', 'subtotal', 'iva', 'total', 'moneda_proyecto',
      'tipo_cambio', 'subtotal_proyecto', 'renglones (JSON)', 'notas', 'pdf_id', 'pdf_url', 'elaboro_email', 'elaboro_nombre',
      'fecha_registro', 'estado', 'fecha_recepcion', 'recibio', 'cancelado_por', 'fecha_cancelacion', 'motivo_cancelacion',
      'req_folio', 'dias_credito'],
    numeros: [15, 16, 17, 18, 20, 21],
  },
  // dias_credito (H): crédito habitual del proveedor; precarga las órdenes nuevas (la orden guarda el suyo en AJ)
  Proveedores: { enc: ['id', 'razon_social', 'rfc', 'contacto', 'correo', 'telefono', 'actualizado', 'dias_credito'], numeros: [] },
  // Facturas de proveedor (4.5): CFDI (con XML) o Extranjera (PDF + datos capturados); nunca se borran filas
  FacturasProveedor: {
    enc: ['folio', 'tipo', 'uuid', 'serie_folio', 'fecha_emision', 'fecha_registro', 'fecha_vencimiento', 'dias_credito',
      'oc_folio', 'req_folio', 'proyecto_folio', 'proveedor_id', 'rfc_emisor', 'nombre_emisor', 'moneda', 'subtotal',
      'descuento', 'iva_trasladado', 'retenciones', 'total', 'metodo_pago', 'forma_pago', 'uso_cfdi', 'xml_id', 'xml_url',
      'pdf_id', 'pdf_url', 'registro_email', 'registro_nombre', 'estado', 'cancelado_por', 'fecha_cancelacion',
      'motivo_cancelacion', 'notas'],
    numeros: [16, 17, 18, 19, 20],
  },
  // Requisiciones (4.4): sin costos; los renglones se versionan (al reenviar una devuelta se agrega la versión nueva)
  // Desde el incremento 3 (O:Y): sitio, fecha en que se necesita, prioridad, aprobación de operaciones por renglón (JSON),
  // propuesta de compras (JSON, con costos), visto bueno, quién recibe y requisición de origen (si salió de separar otra)
  Requisiciones: {
    enc: ['folio', 'fecha', 'proyecto_folio', 'solicitante_email', 'solicitante_nombre', 'estado', 'motivo',
      'cotizacion_pdf_id', 'cotizacion_pdf_url', 'oc_folio', 'reviso_email', 'fecha_revision', 'actualizado', 'notas_recepcion',
      'sitio', 'fecha_requerida', 'prioridad', 'aprobacion (JSON)', 'aprobo_email', 'fecha_aprobacion', 'propuesta (JSON)',
      'vobo_email', 'fecha_vobo', 'recibe_email', 'origen_folio'],
    numeros: [],
  },
  // Movimientos de inventario (incremento 3: solo "Entrada por compra" al recibir; un renglón por renglón de la orden). Folio
  // REC-AAAA-NNNN por recepción (varias filas comparten folio). Nunca se borran: una recepción equivocada se cancela.
  MovimientosInventario: {
    enc: ['folio', 'fecha', 'fecha_registro', 'tipo', 'sitio', 'proyecto_folio', 'req_folio', 'oc_folio', 'renglon', 'clave',
      'descripcion', 'unidad', 'cantidad', 'correo', 'nombre', 'notas', 'evidencia_id', 'evidencia_url', 'estado',
      'cancelado_por', 'fecha_cancelacion', 'motivo_cancelacion'],
    numeros: [9, 13],
  },
  RequisicionesRenglones: { enc: ['req_folio', 'version', 'renglon', 'descripcion', 'cantidad', 'unidad', 'notas'], numeros: [2, 3, 5] },
  // Historial que ve el solicitante (estado, quién y cuándo); sin montos
  RequisicionesEventos: { enc: ['req_folio', 'fecha', 'estado', 'correo', 'nombre', 'nota'], numeros: [] },
  PagosProveedores: {
    enc: ['folio', 'fecha_pago', 'fecha_registro', 'oc_folio', 'req_folio', 'proyecto_folio', 'monto', 'moneda_pago',
      'tipo_cambio', 'monto_aplicado', 'moneda_oc', 'metodo', 'referencia', 'comprobante_id', 'comprobante_url',
      'registro_email', 'registro_nombre', 'estado', 'cancelado_por', 'fecha_cancelacion', 'motivo_cancelacion'],
    numeros: [7, 9, 10],
  },
  Bitacora: { enc: ['fecha', 'correo', 'accion', 'proyecto_folio', 'detalle', 'motivo'], numeros: [] },
};
const COL_ESTADO_OC = 29; // AC: estado, recepción (AD:AE) y cancelación (AF:AH)

const AREA_COMPRAS = { que: 'compras', propCarpeta: 'COMPRAS_FOLDER_ID', propLibro: 'COMPRAS_DB_ID',
  carpeta: NOMBRE_CARPETA_COMPRAS, libro: NOMBRE_LIBRO_COMPRAS, hojas: HOJAS_COMPRAS };

function carpetaCompras_() { return carpetaArea_(AREA_COMPRAS); }
function libroCompras_() { return libroArea_(AREA_COMPRAS); }
/** Libro de compras si ya existe; null si todavía no se crea (cobranza no lo crea al calcular el margen). */
function libroComprasSiExiste_() { return libroAreaSiExiste_(AREA_COMPRAS); }
function hojaCompras_(libro, nombre) { return hojaDeArea_(libro, HOJAS_COMPRAS, nombre); }

/** ¿Tiene el rol compras? (propio o delegado; SOLO_REQUISICION manda sobre él: rolesEfectivos ya se lo quita) */
function esCompras_() {
  return tieneRol_('compras') && !esSoloRequisicion_();
}

function exigirCompras_() {
  if (!VENDEDOR_) throw errorSesion_('Inicia sesión con tu cuenta @' + DOMINIO_HELGEN + '.');
  if (!esCompras_()) throw errorPermiso_('No tienes permiso de compras.');
}

function ordenDesdeFila_(r, fila) {
  let renglones = [];
  try { renglones = JSON.parse(String(r[21] || '[]')); } catch (e) { renglones = []; }
  return {
    folio: String(r[0]), fecha: fechaIso_(r[1]), proyectoFolio: String(r[2]), marca: marcaDeTexto_(r[3]),
    proveedorId: String(r[4] || ''), proveedor: String(r[5] || ''), rfc: String(r[6] || ''), contacto: String(r[7] || ''),
    correo: String(r[8] || ''), telefono: String(r[9] || ''), fechaEntrega: fechaIso_(r[10]), lugarEntrega: String(r[11] || ''),
    condicionesPago: String(r[12] || ''), moneda: String(r[13] || 'MXN'), ivaTasa: Number(r[14]) || 0,
    subtotal: Number(r[15]) || 0, iva: Number(r[16]) || 0, total: Number(r[17]) || 0, monedaProyecto: String(r[18] || ''),
    tipoCambio: r[19] === '' ? '' : Number(r[19]), subtotalProyecto: Number(r[20]) || 0, renglones: renglones,
    notas: String(r[22] || ''), pdfUrl: String(r[24] || ''), elaboro: String(r[26] || r[25] || ''),
    estado: String(r[28] || OC_EMITIDA), fechaRecepcion: fechaIso_(r[29]), recibio: String(r[30] || ''),
    canceladoPor: String(r[31] || ''), motivoCancelacion: String(r[33] || ''), reqFolio: String(r[34] || ''),
    // Orden anterior a los días de crédito (AJ vacía): los de sus condiciones de pago ("Crédito 30 días"); si no dicen, contado
    diasCredito: r[35] === '' || r[35] == null ? diasCreditoDeCondiciones(r[12]) : diasCreditoGuardados(r[35]), fila: fila,
  };
}

/** Órdenes de un proyecto, en orden de registro. Sin libro de compras: ninguna. */
function ordenesDeProyecto_(libro, folio) {
  if (!libro) return [];
  const f = String(folio || '').toUpperCase();
  const lista = [];
  filasDeArea_(hojaCompras_(libro, 'OrdenesCompra'), HOJAS_COMPRAS, 'OrdenesCompra').forEach((r, i) => {
    if (String(r[2]).toUpperCase() === f && String(r[0] || '').trim()) lista.push(ordenDesdeFila_(r, i + 2));
  });
  return lista;
}

/** Proveedores de la pestaña Proveedores (con su fila). */
function proveedoresDelLibro_(libro) {
  return proveedoresDesdeFilas(filasDeArea_(hojaCompras_(libro, 'Proveedores'), HOJAS_COMPRAS, 'Proveedores'));
}

/**
 * Alta o actualización del proveedor al emitir una orden (se llena sola, como los clientes). Se busca por id (RFC o
 * SIN-RFC:razón social); si llega con RFC y solo existía sin RFC, esa fila toma el RFC. Un dato vacío no borra uno anterior.
 */
function guardarProveedor_(libro, prov) {
  const hoja = hojaCompras_(libro, 'Proveedores');
  const lista = proveedoresDelLibro_(libro);
  const id = proveedorId(prov);
  const existente = lista.find(p => p.id === id) ||
    (id.indexOf('SIN-RFC:') !== 0 ? lista.find(p => p.id === proveedorId({ razonSocial: prov.razonSocial })) : null);
  const t = textoCelda;
  const datos = fusionarProveedor(existente, prov);
  const fila = [t(id), t(datos.razonSocial), t(datos.rfc), t(datos.contacto), t(datos.correo), t(datos.telefono),
    Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm'),
    datos.diasCredito === '' ? '' : diasCreditoGuardados(datos.diasCredito)];
  if (existente) hoja.getRange(existente.fila, 1, 1, fila.length).setValues([fila]);
  else hoja.appendRow(fila);
  return Object.assign(datos, { id: id });
}

/** Proyecto existente (o error). */
function proyectoParaCompras_(folio) {
  const proyecto = buscarProyecto_(hojaProyectos_(), folio);
  if (!proyecto) throw new Error('No existe el proyecto ' + String(folio || '').toUpperCase() + '.');
  return proyecto;
}

/**
 * Moneda y línea de negocio de las órdenes de un proyecto: las de su cotización aceptada (firmada o no). Sin aceptada,
 * MXN y sin línea. marcarAceptada no deja aceptar otra moneda si ya hay órdenes vigentes (el margen nunca mezcla monedas).
 */
function monedaDeProyecto_(contrato) {
  return { moneda: contrato ? contrato.moneda : 'MXN', marca: contrato ? contrato.marca : '', sinContrato: !contrato,
    contrato: contrato ? contrato.estado : '' };
}

/** Datos del proyecto que ven compras y requisiciones (sin montos del contrato). */
function datosProyectoCompras_(p) {
  return { folio: p.folio, clave: p.clave || '', folioVisible: p.folioVisible || p.folio, nombre: p.nombre, cliente: p.cliente,
    estado: p.estado, ubicacion: p.ubicacion };
}

/**
 * Respuesta para "Órdenes por proyecto" en la pestaña Compras: proyecto, moneda y órdenes (cada una con sus facturas y
 * puedeFacturar). Sin montos del contrato ni margen.
 */
function vistaCompras_(libro, proyecto) {
  const m = monedaDeProyecto_(contratosDelLibro_()[proyecto.folio.toUpperCase()] || null);
  const facturas = facturasDelLibro_(libro);
  return {
    proyecto: datosProyectoCompras_(proyecto),
    moneda: m.moneda,
    marca: m.marca,
    sinContrato: m.sinContrato,
    ordenes: ordenesDeProyecto_(libro, proyecto.folio).map(o => Object.assign(sinFila_(o), {
      facturas: facturasDeOrden_(facturas, o.folio), puedeFacturar: o.estado !== OC_CANCELADA,
      totalFacturado: totalFacturadoDeOrden(facturas, o.folio),
    })).reverse(),
    hoy: hoyIso_(),
  };
}

/** Proyectos Activos y Cerrados (con o sin contrato; sin montos), con la moneda de sus órdenes, para ver sus órdenes. */
function listarProyectosCompras(busqueda) {
  exigirCompras_();
  const contratos = contratosCache_();
  return filtrarProyectos(proyectosCache_().filter(p => p.estado !== 'Cancelado'), busqueda, true, 50)
    .map(p => Object.assign(datosProyectoCompras_(p), { fecha: p.fecha }, monedaDeProyecto_(contratos[p.folio.toUpperCase()] || null)));
}

function getComprasProyecto(folio) {
  exigirCompras_();
  const libro = libroCompras_();
  return vistaCompras_(libro, proyectoParaCompras_(folio));
}

/**
 * Emite una orden de compra con su PDF (solo desde autorizarRequisicion, dentro del candado). d0 = {proveedor:
 * {razonSocial, rfc, contacto, correo, telefono}, fechaEntrega, lugarEntrega, condicionesPago, moneda, tipoCambio, ivaTasa,
 * renglones: [{clave, descripcion, unidad, cantidad, costo}], notas}. En proyectos Activos y Cerrados, con o sin contrato.
 * La moneda del proyecto y la línea de negocio salen de la cotización aceptada (sin aceptada: MXN y sin línea; nunca del
 * navegador); el costo es el capturado (nunca el precio de venta del catálogo).
 * firma (opcional, flujo con operaciones) = {email, nombre (quien preparó la propuesta: "Elaboró"), autorizo (texto del visto
 * bueno: sale en el PDF)}; sin firma, elaboró = quien emite.
 */
function emitirOrdenCompra_(libro, d0, proyecto, reqFolio, firma) {
  const cfg = getConfig_();
  if (proyecto.estado === 'Cancelado') {
    throw new Error('El proyecto ' + proyecto.folio + ' está cancelado: no admite órdenes de compra.');
  }
  const c = monedaDeProyecto_(contratosDelLibro_()[proyecto.folio.toUpperCase()] || null);
  const oc = normalizarOrdenCompra(d0, { moneda: c.moneda, ubicacion: proyecto.ubicacion, hoy: hoyIso_(), ivaTasa: cfg.IVA_TASA });

  const hoja = hojaCompras_(libro, 'OrdenesCompra');
  const folio = siguienteFolio_(PREFIJO_OC, hoja, 'CONSECUTIVO_OC_');
  const proveedor = guardarProveedor_(libro, Object.assign({}, oc.proveedor, { diasCredito: oc.diasCredito }));
  const ahora = new Date();
  const correoElaboro = firma && firma.email ? firma.email : VENDEDOR_.email;
  const elaboro = firma && firma.email ? (firma.nombre || firma.email)
    : [VENDEDOR_.nombre, VENDEDOR_.apellido].filter(Boolean).join(' ') || VENDEDOR_.email;

  // PDF (razón social y datos fiscales de Helgen, iguales en Helgen y Helgen Energy)
  const html = construirHtmlOrdenCompra(Object.assign({}, oc, {
    folio: folio, fecha: Utilities.formatDate(ahora, 'America/Mexico_City', 'dd/MM/yyyy'), proveedor: proveedor,
    proyectoFolio: folioVisible(proyecto.folio, proyecto.clave), reqFolio: reqFolio,
    elaboro: elaboro + (elaboro === correoElaboro ? '' : ' (' + correoElaboro + ')'), autorizo: firma ? firma.autorizo || '' : '',
  }), cfg, logoDataUrl_(cfg.LOGO_FILE_ID));
  const pdf = Utilities.newBlob(html, 'text/html', folio + '.html').getAs('application/pdf')
    .setName(nombreArchivoOc(folio, proveedor.razonSocial));
  const archivo = privado_(carpetaProyectoCompras_(proyecto.folio).createFile(pdf));

  const t = textoCelda;
  hoja.appendRow([
    folio, textoFecha_(hoyIso_()), proyecto.folio, MARCAS[c.marca] || '', t(proveedor.id), t(proveedor.razonSocial), t(proveedor.rfc),
    t(proveedor.contacto), t(proveedor.correo), t(proveedor.telefono), textoFecha_(oc.fechaEntrega), t(oc.lugarEntrega),
    t(oc.condicionesPago), oc.moneda, oc.ivaTasa, oc.subtotal, oc.iva, oc.total, oc.monedaProyecto, oc.tipoCambio,
    oc.subtotalProyecto, JSON.stringify(oc.renglones), t(oc.notas), archivo.getId(), archivo.getUrl(), t(correoElaboro),
    t(elaboro), Utilities.formatDate(ahora, 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss'), OC_EMITIDA, '', '', '', '', '',
    reqFolio || '', oc.diasCredito,
  ]);
  bitacora_(libro, 'Emitir orden de compra', proyecto.folio, folio + (reqFolio ? ' · ' + reqFolio : '') + ' · ' +
    proveedor.razonSocial + ' · ' + formatoMoneda(oc.total) + ' ' + oc.moneda + ' · ' +
    (oc.diasCredito ? 'crédito ' + oc.diasCredito + ' días' : 'contado') + (oc.tipoCambio ? ' · TC ' + oc.tipoCambio + ' = ' +
    formatoMoneda(oc.subtotalProyecto) + ' ' + oc.monedaProyecto + ' sin IVA' : '') + ' · ' + (MARCAS[c.marca] || 'sin contrato'), '', HOJAS_COMPRAS);
  return { folio: folio, url: archivo.getUrl(), total: oc.total, moneda: oc.moneda };
}

/** Compras/AAAA/<folio del proyecto>/ (restringidas de arriba abajo: un permiso heredado no se puede quitar en el hijo). */
function carpetaProyectoCompras_(proyectoFolio) {
  const anio = String(proyectoFolio).split('-')[1] || hoyIso_().slice(0, 4);
  return privado_(subcarpeta_(privado_(subcarpeta_(carpetaCompras_(), anio)), proyectoFolio));
}

/** Busca una orden por folio en el libro de compras (o error). */
function buscarOrden_(libro, folioOc) {
  const folio = String(folioOc || '').trim().toUpperCase();
  const hoja = hojaCompras_(libro, 'OrdenesCompra');
  let orden = null;
  filasDeArea_(hoja, HOJAS_COMPRAS, 'OrdenesCompra').forEach((r, i) => {
    if (String(r[0]).toUpperCase() === folio) orden = ordenDesdeFila_(r, i + 2);
  });
  if (!orden) throw new Error('No existe la orden de compra ' + folio + '.');
  return { hoja: hoja, orden: orden };
}

/**
 * Cancela una orden Emitida (no se borra), con motivo; queda en la Bitacora y deja de contar en el margen. Una pagada o
 * recibida ya no se cancela. Su requisición regresa a Solicitada (sin orden) para autorizarla de nuevo.
 */
function cancelarOrdenCompra(folioOc, motivo) {
  exigirCompras_();
  const m = motivoObligatorio_(motivo, 'Escribe el motivo de la cancelación.');
  const libro = libroCompras_();
  return conCandado_(() => {
    const { hoja, orden } = buscarOrden_(libro, folioOc);
    if (orden.estado === OC_CANCELADA) throw new Error('La orden ' + orden.folio + ' ya está cancelada.');
    if (orden.estado === OC_PAGADA) throw new Error('La orden ' + orden.folio + ' ya está pagada: no se puede cancelar.');
    if (orden.estado !== OC_EMITIDA) throw new Error('La orden ' + orden.folio + ' ya se recibió: no se puede cancelar.');
    const conFactura = facturasDelLibro_(libro).filter(f => f.estado === FPR_VIGENTE &&
      f.ocFolio.toUpperCase() === orden.folio.toUpperCase()).map(f => f.folio);
    if (conFactura.length) {
      throw new Error('La orden ' + orden.folio + ' tiene facturas vigentes (' + conFactura.join(', ') + '): cancélalas primero.');
    }
    const recibidas = (movimientosPorOc_(libro)[orden.folio.toUpperCase()] || []).filter(x => x.estado === 'Vigente');
    if (recibidas.length) {
      throw new Error('La orden ' + orden.folio + ' ya tiene material recibido (' + recepcionesDe_(recibidas).map(x => x.folio).join(', ') +
        '): cancela primero la recepción.');
    }
    hoja.getRange(orden.fila, COL_ESTADO_OC).setValue(OC_CANCELADA);
    hoja.getRange(orden.fila, COL_ESTADO_OC + 3, 1, 3).setValues([[textoCelda(VENDEDOR_.email),
      Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss'), textoCelda(m)]]);
    bitacora_(libro, 'Cancelar orden de compra', orden.proyectoFolio, orden.folio + ' · ' + orden.proveedor + ' · ' +
      formatoMoneda(orden.total) + ' ' + orden.moneda, m, HOJAS_COMPRAS);
    if (orden.reqFolio) {
      const { hoja: hR, req } = buscarReq_(libro, orden.reqFolio);
      if (req.estado === REQ_AUTORIZADA && req.ocFolio.toUpperCase() === orden.folio.toUpperCase()) {
        // Con aprobación de operaciones vuelve a Aprobada (compras propone otra vez); si no, a Solicitada (flujo de siempre)
        const conAprobacion = !!req.aprobacion;
        const nuevo = transicionReq(req.estado, conAprobacion ? 'cancelarOcAprobada' : 'cancelarOc');
        cambiarReq_(hR, req, nuevo, { ocFolio: '' });
        if (conAprobacion) camposReq_(hR, req, { voboEmail: '', fechaVobo: '' });
        eventoReq_(libro, req.folio, nuevo, conAprobacion ? 'Se canceló la orden de compra; compras la cotizará de nuevo.'
          : 'Se canceló la orden de compra; queda pendiente de autorizar de nuevo.');
        bitacora_(libro, 'Requisición a ' + nuevo, req.proyectoFolio, req.folio + ' · se canceló ' + orden.folio, m, HOJAS_COMPRAS);
      }
    }
    SpreadsheetApp.flush();
    return vistaCompras_(libro, proyectoParaCompras_(orden.proyectoFolio));
  });
}

/** Motivo obligatorio (5 a 500 caracteres). */
function motivoObligatorio_(motivo, mensaje) {
  const m = String(motivo || '').trim();
  if (m.length < 5) throw new Error(mensaje || 'Escribe el motivo.');
  if (m.length > 500) throw new Error('El motivo debe tener máximo 500 caracteres.');
  return m;
}

// ====== 4.4 REQUISICIONES DE MATERIALES Y PAGO A PROVEEDORES ======
// Un trabajador (ROL_REQUISICION) pide materiales para un proyecto, sin precios, con la cotización del proveedor adjunta.
// Compras (ROL_COMPRAS) la autoriza (genera la orden de compra), la rechaza o la devuelve; paga la orden (PGP) y el
// solicitante confirma que recibió el material (cierra la requisición y la orden queda Recibida). Todo en el libro de
// compras; archivos en Compras/AAAA/<folio del proyecto>/Requisiciones/. El solicitante solo ve SUS requisiciones (el
// servidor filtra por el correo del token) y nunca montos, cliente, margen, pagos ni órdenes.
// SOLO_REQUISICION: cuentas que solo usan esta pestaña (el servidor les niega cotizar, historial, catálogo y proyectos).

const PREFIJO_REQ = 'REQ', PREFIJO_PGP = 'PGP';
const SUBCARPETA_REQUISICIONES = 'Requisiciones';

/**
 * Funciones que puede llamar una cuenta de SOLO_REQUISICION (todo lo demás se le niega en doPost). Incluye las de operaciones
 * (cada una exige ROL_OPERACIONES) y las de recepción, porque quien aprueba o recibe puede ser una cuenta de solo requisiciones.
 */
const FUNCIONES_SOLO_REQUISICION = ['bootstrap', 'sincronizar', 'getDatosIniciales', 'listarProyectosRequisicion', 'misRequisiciones',
  'guardarRequisicion', 'cancelarRequisicion', 'cerrarRequisicion', 'registrarRecepcion', 'archivoRequisicion',
  'listarOperaciones', 'getRequisicionOperaciones', 'aprobarRequisicion', 'rechazarRequisicion', 'devolverRequisicion',
  'autorizarPropuesta', 'regresarACompras'].concat(deModulos_('solo', []));

const PREFIJO_REC = 'REC', TIPO_ENTRADA_COMPRA = 'Entrada por compra';

/** ¿Solo puede usar requisiciones? (rol solo_requisicion; manda sobre cualquier otro rol salvo super admin). */
function esSoloRequisicion_() {
  return tieneRol_('solo_requisicion');
}

/** ¿Aprueba requisiciones y da el visto bueno a las propuestas de compras? (rol aprobaciones; antes ROL_OPERACIONES) */
function esOperaciones_() {
  return tieneRol_('aprobaciones');
}

function exigirOperaciones_() {
  if (!VENDEDOR_) throw errorSesion_('Inicia sesión con tu cuenta @' + DOMINIO_HELGEN + '.');
  if (!esOperaciones_()) throw errorPermiso_('No tienes permiso de operaciones (aprobar requisiciones).');
}

/**
 * ¿Está activo el flujo con operaciones? Sí, en cuanto ROL_OPERACIONES tiene al menos un correo: desde ahí operaciones aprueba
 * y da el visto bueno, la cotización del proveedor es opcional, el sitio es obligatorio y se recibe renglón por renglón. Con
 * la propiedad vacía todo sigue como antes (se puede publicar el código sin cambiar el proceso).
 */
function flujoOperaciones_() {
  // Alguien activo con el rol aprobaciones propio (un super admin solo no lo enciende)
  const u = contextoRoles_().usuarios;
  return Object.keys(u).some(c => u[c].activo && u[c].roles.indexOf('aprobaciones') !== -1);
}

/** Sitios donde se recibe material (Config → SITIOS). */
function sitios_() {
  return sitiosDeTexto(configLigera_().sitios);
}

/** Correos que pueden recibir material (tienen la pestaña Requisiciones; también @helgen.services). */
function receptores_() {
  const u = contextoRoles_().usuarios;
  return Object.keys(u).filter(c => u[c].activo &&
    (u[c].roles.indexOf('requisicion') !== -1 || u[c].roles.indexOf('solo_requisicion') !== -1)).sort();
}

/** La propuesta de compras vigente (null si no hay o si se retiró al separar renglones o al reenviar la requisición). */
const propuestaVigente_ = req => req.propuesta && !req.propuesta.retirada ? req.propuesta : null;
/** Al retirar una propuesta se conservan su versión (el visto bueno siempre es sobre un número nuevo) y sus archivos. */
const propuestaRetirada_ = prop => prop ? { version: Number(prop.version) || 0, retirada: true, archivos: prop.archivos || [] } : null;
/** Huella del contenido de la propuesta: el visto bueno es sobre exactamente lo que operaciones vio. */
function huellaPropuesta_(prop) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(prop || null))
    .map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}
const yo_ = () => String(VENDEDOR_.email).toLowerCase();
const nombreYo_ = () => [VENDEDOR_.nombre, VENDEDOR_.apellido].filter(Boolean).join(' ') || VENDEDOR_.email;
const ahoraTexto_ = () => Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss');
const jsonCelda_ = v => { try { return v ? JSON.parse(String(v)) : null; } catch (e) { return null; } };

/** ¿Puede pedir materiales? (ROL_REQUISICION, o SOLO_REQUISICION, que lo incluye). */
function esRequisicion_() {
  return tieneRol_('requisicion') || esSoloRequisicion_();
}

function exigirRequisicion_() {
  if (!VENDEDOR_) throw errorSesion_('Inicia sesión con tu cuenta @' + DOMINIO_HELGEN + '.');
  if (!esRequisicion_()) throw errorPermiso_('No tienes permiso para hacer requisiciones.');
}

function hojaReq_(libro) { return hojaCompras_(libro, 'Requisiciones'); }

function reqDesdeFila_(r, fila) {
  return {
    folio: String(r[0]), fecha: fechaIso_(r[1]), proyectoFolio: String(r[2]), solicitanteEmail: String(r[3] || '').toLowerCase(),
    solicitante: String(r[4] || r[3] || ''), estado: String(r[5] || REQ_SOLICITADA), motivo: String(r[6] || ''),
    cotizacionId: String(r[7] || ''), cotizacionUrl: String(r[8] || ''), ocFolio: String(r[9] || ''),
    reviso: String(r[10] || ''), fechaRevision: fechaTexto_(r[11]), actualizado: fechaTexto_(r[12]),
    notasRecepcion: String(r[13] || ''),
    sitio: String(r[14] || ''), fechaRequerida: fechaIso_(r[15]), prioridad: String(r[16] || ''), aprobacion: jsonCelda_(r[17]),
    aproboEmail: String(r[18] || ''), fechaAprobacion: fechaTexto_(r[19]), propuesta: jsonCelda_(r[20]),
    voboEmail: String(r[21] || ''), fechaVobo: fechaTexto_(r[22]), recibeEmail: String(r[23] || '').toLowerCase(),
    origenFolio: String(r[24] || ''), fila: fila,
  };
}

/** Columnas (desde 1) de los campos del incremento 3 en la pestaña Requisiciones. */
const COLS_REQ = { sitio: 15, fechaRequerida: 16, prioridad: 17, aprobacion: 18, aproboEmail: 19, fechaAprobacion: 20,
  propuesta: 21, voboEmail: 22, fechaVobo: 23, recibeEmail: 24, origenFolio: 25 };

/** Escribe campos del incremento 3 de una requisición (objetos como JSON; null = vacío) y los copia en req. */
function camposReq_(hoja, req, campos) {
  Object.keys(campos).forEach(k => {
    const v = campos[k];
    let celda;
    if (k === 'aprobacion' || k === 'propuesta') celda = v ? JSON.stringify(v) : '';
    else if (k === 'fechaRequerida') celda = textoFecha_(v);
    else celda = textoCelda(String(v == null ? '' : v));
    hoja.getRange(req.fila, COLS_REQ[k]).setValue(celda);
    req[k] = v;
  });
}

/** Requisición por folio (o error). */
function buscarReq_(libro, folioReq) {
  const folio = String(folioReq || '').trim().toUpperCase();
  const hoja = hojaReq_(libro);
  let req = null;
  filasDeArea_(hoja, HOJAS_COMPRAS, 'Requisiciones').forEach((r, i) => {
    if (String(r[0]).toUpperCase() === folio) req = reqDesdeFila_(r, i + 2);
  });
  if (!req) throw new Error('No existe la requisición ' + folio + '.');
  return { hoja: hoja, req: req };
}

/** Cambia estado (y otros campos) de una requisición en su fila. extra = {motivo, ocFolio, revisar (bool), notasRecepcion}. */
function cambiarReq_(hoja, req, estado, extra) {
  const x = extra || {};
  const ahora = Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss');
  const t = textoCelda;
  hoja.getRange(req.fila, 6, 1, 2).setValues([[estado, t('motivo' in x ? x.motivo : req.motivo)]]);
  if ('ocFolio' in x) hoja.getRange(req.fila, 10).setValue(x.ocFolio);
  if (x.revisar) hoja.getRange(req.fila, 11, 1, 2).setValues([[t(VENDEDOR_.email), ahora]]);
  hoja.getRange(req.fila, 13).setValue(ahora);
  if ('notasRecepcion' in x) hoja.getRange(req.fila, 14).setValue(t(x.notasRecepcion));
  req.estado = estado;
}

/** Renglón del historial que ve el solicitante (sin montos). */
function eventoReq_(libro, folio, estado, nota) {
  const t = textoCelda;
  hojaCompras_(libro, 'RequisicionesEventos').appendRow([folio,
    Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss'), estado, t(VENDEDOR_.email),
    t([VENDEDOR_.nombre, VENDEDOR_.apellido].filter(Boolean).join(' ') || VENDEDOR_.email), t(nota || '')]);
}

/** {folio: {version, renglones}} con la versión vigente (la mayor) de los renglones de cada requisición. */
function renglonesDeReqs_(libro) {
  const mapa = {};
  filasDeArea_(hojaCompras_(libro, 'RequisicionesRenglones'), HOJAS_COMPRAS, 'RequisicionesRenglones').forEach(r => {
    const f = String(r[0]).toUpperCase();
    if (!f) return;
    const v = Number(r[1]) || 1;
    const x = mapa[f] || (mapa[f] = { version: 0, renglones: [] });
    if (v > x.version) { x.version = v; x.renglones = []; }
    if (v === x.version) {
      x.renglones.push({ renglon: Number(r[2]) || x.renglones.length + 1, descripcion: String(r[3] || ''), cantidad: Number(r[4]) || 0,
        unidad: String(r[5] || ''), notas: String(r[6] || '') });
    }
  });
  Object.keys(mapa).forEach(f => mapa[f].renglones.sort((a, b) => a.renglon - b.renglon));
  return mapa;
}

/** {folio: [eventos en orden]} del historial de requisiciones. */
function eventosDeReqs_(libro) {
  const mapa = {};
  filasDeArea_(hojaCompras_(libro, 'RequisicionesEventos'), HOJAS_COMPRAS, 'RequisicionesEventos').forEach(r => {
    const f = String(r[0]).toUpperCase();
    if (!f) return;
    (mapa[f] = mapa[f] || []).push({ fecha: fechaTexto_(r[1]), estado: String(r[2] || ''), correo: String(r[3] || ''),
      nombre: String(r[4] || r[3] || ''), nota: String(r[5] || '') });
  });
  return mapa;
}

/** Escribe los renglones de una versión (las versiones anteriores se quedan: nada se borra). */
function escribirRenglonesReq_(libro, folio, version, renglones) {
  const hoja = hojaCompras_(libro, 'RequisicionesRenglones');
  const t = textoCelda;
  renglones.forEach((r, i) => hoja.appendRow([folio, version, i + 1, t(r.descripcion), r.cantidad, t(r.unidad), t(r.notas)]));
}

/** {folio: proyecto} (para mostrar el nombre sin el cliente y el folio con clave). */
function nombresDeProyectos_() {
  return mapaProyectos_();
}

/** Bytes de un archivo adjunto ({nombre, datos base64}); null si no viene. */
function bytesDeAdjunto_(adjunto, mensaje) {
  try {
    return adjunto && adjunto.datos ? Utilities.base64Decode(String(adjunto.datos)) : null;
  } catch (e) {
    throw new Error(mensaje || 'No se pudo leer el archivo. Vuelve a adjuntarlo.');
  }
}

/** Compras/AAAA/<folio del proyecto>/Requisiciones/ (restringida). */
function carpetaRequisiciones_(proyectoFolio) {
  return privado_(subcarpeta_(carpetaProyectoCompras_(proyectoFolio), SUBCARPETA_REQUISICIONES));
}

/** Movimiento de inventario desde su fila. */
function movDesdeFila_(r, fila) {
  return {
    folio: String(r[0]), fecha: fechaIso_(r[1]), fechaRegistro: fechaTexto_(r[2]), tipo: String(r[3] || ''), sitio: String(r[4] || ''),
    proyectoFolio: String(r[5] || ''), reqFolio: String(r[6] || ''), ocFolio: String(r[7] || ''), renglon: Number(r[8]) || 0,
    clave: String(r[9] || ''), descripcion: String(r[10] || ''), unidad: String(r[11] || ''), cantidad: Number(r[12]) || 0,
    correo: String(r[13] || ''), nombre: String(r[14] || r[13] || ''), notas: String(r[15] || ''), evidenciaId: String(r[16] || ''),
    evidenciaUrl: String(r[17] || ''), estado: String(r[18] || 'Vigente'), canceladoPor: String(r[19] || ''),
    fechaCancelacion: fechaTexto_(r[20]), motivoCancelacion: String(r[21] || ''), fila: fila,
  };
}

/** {FOLIO DE LA ORDEN: [movimientos]} de las entradas por compra. Sin libro: ninguno. */
function movimientosPorOc_(libro) {
  const mapa = {};
  if (!libro) return mapa;
  filasDeArea_(hojaCompras_(libro, 'MovimientosInventario'), HOJAS_COMPRAS, 'MovimientosInventario').forEach((r, i) => {
    const m = movDesdeFila_(r, i + 2);
    if (!m.folio || m.tipo !== TIPO_ENTRADA_COMPRA) return;
    const f = m.ocFolio.toUpperCase();
    (mapa[f] = mapa[f] || []).push(m);
  });
  return mapa;
}

/** Recepciones (agrupadas por folio REC) de una lista de movimientos, en orden de registro. conEvidencia: incluye la liga. */
function recepcionesDe_(movs, conEvidencia) {
  const porFolio = {}, orden = [];
  (movs || []).forEach(m => {
    let x = porFolio[m.folio];
    if (!x) {
      x = porFolio[m.folio] = { folio: m.folio, fecha: m.fecha, registro: m.fechaRegistro, nombre: m.nombre, correo: m.correo,
        sitio: m.sitio, notas: m.notas, estado: m.estado, motivoCancelacion: m.motivoCancelacion, renglones: [] };
      if (conEvidencia) x.evidenciaUrl = m.evidenciaUrl;
      orden.push(x);
    }
    x.renglones.push({ renglon: m.renglon, descripcion: m.descripcion, unidad: m.unidad, cantidad: m.cantidad });
  });
  return orden;
}

/** {FOLIO: orden} de todas las órdenes del libro. */
function ordenesPorFolio_(libro) {
  const mapa = {};
  if (!libro) return mapa;
  filasDeArea_(hojaCompras_(libro, 'OrdenesCompra'), HOJAS_COMPRAS, 'OrdenesCompra').forEach((r, i) => {
    if (String(r[0] || '').trim()) mapa[String(r[0]).toUpperCase()] = ordenDesdeFila_(r, i + 2);
  });
  return mapa;
}

/** Renglones vigentes con la decisión de operaciones (decision Aprobado/Rechazado, cantidadAprobada, comentario). */
function renglonesConDecision_(renglones, aprobacion) {
  const dec = {};
  ((aprobacion && aprobacion.renglones) || []).forEach(a => { dec[a.renglon] = a; });
  return (renglones || []).map(r => {
    const a = dec[r.renglon];
    return a ? Object.assign({}, r, { decision: a.aprobado ? 'Aprobado' : 'Rechazado', cantidadAprobada: a.cantidad, comentario: a.comentario })
      : Object.assign({}, r);
  });
}

/** Lo que se compra (propuesta) sin costos ni proveedor: para el solicitante y quien recibe. */
const compraSinCostos_ = prop => prop ? (prop.renglones || []).map(r => ({ renglon: r.renglon, disponibilidad: r.disponibilidad,
  descripcion: r.descripcion, unidad: r.unidad, cantidad: r.cantidad, nota: r.nota, recibir: r.recibir !== false })) : null;

/**
 * Lo que ve el solicitante (o quien recibe) de una requisición: estado, renglones con la decisión de operaciones, lo que se
 * compra (después del visto bueno), avance de la recepción e historial. Sin montos, proveedor, cliente, folio de la orden ni
 * pagos. x = {flujo, yo, orden, movimientos}.
 */
function reqParaSolicitante_(req, ren, eventos, proyectos, x) {
  const p = proyectos[req.proyectoFolio.toUpperCase()];
  const o = x || {}, flujo = !!o.flujo, yo = o.yo || '';
  const orden = o.orden && o.orden.estado !== OC_CANCELADA &&
    [REQ_AUTORIZADA, REQ_PAGADA, REQ_RECIBIDA, REQ_CERRADA].indexOf(req.estado) !== -1 ? o.orden : null;
  const avance = orden ? avanceRecepcion(orden.renglones, o.movimientos, renglonesSinRecepcion(propuestaVigente_(req))) : null;
  const recibe = req.recibeEmail || req.solicitanteEmail;
  return {
    folio: req.folio, fecha: req.fecha, proyectoFolio: req.proyectoFolio, proyectoNombre: p ? p.nombre : '',
    proyectoVisible: p ? p.folioVisible : req.proyectoFolio, estado: req.estado, notasRecepcion: req.notasRecepcion,
    // El motivo solo cuando es para quien pidió (al regresar una propuesta a compras puede hablar de precios)
    motivo: [REQ_DEVUELTA, REQ_RECHAZADA, REQ_CANCELADA, REQ_CERRADA].indexOf(req.estado) !== -1 ? req.motivo : '',
    solicitante: req.solicitante, sitio: req.sitio, fechaRequerida: req.fechaRequerida, prioridad: req.prioridad,
    renglones: renglonesConDecision_((ren && ren.renglones) || [], req.aprobacion), eventos: eventos || [],
    compra: orden ? compraSinCostos_(propuestaVigente_(req)) : null,
    avance: avance ? avance.lineas : null, recepciones: orden ? recepcionesDe_(o.movimientos, false) : [],
    recibe: recibe, esReceptor: !!orden && yo !== req.solicitanteEmail && yo === recibe,
    puedeEditar: req.estado === REQ_DEVUELTA && yo === req.solicitanteEmail,
    puedeCancelar: (req.estado === REQ_SOLICITADA || req.estado === REQ_DEVUELTA) && yo === req.solicitanteEmail,
    puedeCerrar: !flujo && req.estado === REQ_PAGADA && yo === req.solicitanteEmail,
    // Con operaciones se recibe renglón por renglón (también las requisiciones de antes que ya tenían orden)
    puedeRecibir: flujo && !!avance && !avance.completo && (req.estado === REQ_AUTORIZADA || req.estado === REQ_PAGADA) &&
      (yo === req.solicitanteEmail || yo === recibe),
  };
}

/**
 * Proyectos donde se pueden pedir materiales: Activos y Cerrados, con o sin contrato (los Cancelados no). Solo folio, clave
 * y nombre (sin cliente ni montos); se busca por folio, clave y nombre.
 */
function listarProyectosRequisicion(busqueda) {
  exigirRequisicion_();
  const q = textoNormal(busqueda);
  return proyectosCache_().slice().reverse()
    .filter(p => p.estado !== 'Cancelado')
    .filter(p => !q || textoNormal([p.folioVisible, p.clave, p.nombre].join(' ')).includes(q))
    .slice(0, 50)
    .map(p => ({ folio: p.folio, clave: p.clave, folioVisible: p.folioVisible, nombre: p.nombre, estado: p.estado }));
}

/**
 * Requisiciones del usuario del token: las que pidió y las que debe recibir (nunca otras), más recientes primero. En caché por
 * usuario, flujo y versiones.
 */
function misRequisiciones(soloSiHay) {
  exigirRequisicion_();
  const yo = yo_(), flujo = flujoOperaciones_();
  return enCache_('misReq_' + (flujo ? 'op_' : '') + yo, ['requisiciones', 'oc', 'pagosProveedores', 'proyectos'], TTL_CACHE,
    soloSiHay ? null : () => misRequisicionesDeHojas_(yo, flujo)) || null;
}

function misRequisicionesDeHojas_(yo, flujo) {
  const libro = libroComprasSiExiste_(); // solo lee: el libro lo crea la primera requisición
  if (!libro) return [];
  const ren = renglonesDeReqs_(libro), ev = eventosDeReqs_(libro), proyectos = nombresDeProyectos_();
  const lista = [];
  let ordenes = null, movs = null;
  filasDeArea_(hojaReq_(libro), HOJAS_COMPRAS, 'Requisiciones').forEach((r, i) => {
    const req = reqDesdeFila_(r, i + 2);
    // Quien recibe la ve desde que hay orden de compra
    if (!req.folio || (req.solicitanteEmail !== yo && !(req.recibeEmail === yo && req.ocFolio))) return;
    const f = req.folio.toUpperCase();
    let orden = null, m = [];
    if (req.ocFolio) {
      if (!ordenes) { ordenes = ordenesPorFolio_(libro); movs = movimientosPorOc_(libro); }
      orden = ordenes[req.ocFolio.toUpperCase()] || null;
      m = movs[req.ocFolio.toUpperCase()] || [];
    }
    lista.push(reqParaSolicitante_(req, ren[f], ev[f], proyectos, { flujo: flujo, yo: yo, orden: orden, movimientos: m }));
  });
  return lista.reverse();
}

/**
 * Nueva requisición o reenvío de una devuelta. p = {folio? (reenvío), proyectoFolio, sitio, fechaRequerida, renglones:
 * [{descripcion, cantidad, unidad, notas}], cotizacion: {nombre, datos (base64)}, idSolicitud}. Nueva: proyecto no Cancelado;
 * cotización obligatoria en el flujo de siempre y opcional con operaciones (ahí el sitio es obligatorio). Reenvío: solo el
 * solicitante y solo si está Devuelta; mismo folio y proyecto; la cotización es opcional (si viene, se agrega otro archivo: el
 * anterior no se borra); la aprobación y la propuesta anteriores se borran (operaciones la vuelve a revisar). Queda en Solicitada.
 */
function guardarRequisicion(p) {
  exigirRequisicion_();
  const d0 = p || {};
  const renglones = normalizarRequisicion(d0);
  const bytes = bytesDeAdjunto_(d0.cotizacion, 'No se pudo leer la cotización. Vuelve a adjuntarla.');
  const reenvio = !!String(d0.folio || '').trim();
  const flujo = flujoOperaciones_();
  if (!reenvio && !bytes && !flujo) throw new Error('Adjunta la cotización del proveedor (PDF o imagen).');
  const tipo = bytes ? validarArchivo(bytes, 'la cotización del proveedor', 'La cotización') : null;
  const sitio = sitioDeLista(d0.sitio, sitios_(), flujo && !reenvio);
  const fechaRequerida = fechaRequeridaValida(d0.fechaRequerida, hoyIso_());
  const libro = libroCompras_();

  const idSolicitud = String(d0.idSolicitud || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const claveCache = idSolicitud ? 'REQ_' + idSolicitud : '';

  return conCandado_(() => {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) return JSON.parse(previo);
    }
    const yo = String(VENDEDOR_.email).toLowerCase();
    const t = textoCelda;
    let folio, version;
    if (reenvio) {
      const { hoja, req } = buscarReq_(libro, d0.folio);
      if (req.solicitanteEmail !== yo) throw errorPermiso_('Solo quien hizo la requisición ' + req.folio + ' puede corregirla.');
      const nuevo = transicionReq(req.estado, 'reenviar');
      folio = req.folio;
      version = ((renglonesDeReqs_(libro)[folio.toUpperCase()] || {}).version || 1) + 1;
      if (bytes) {
        const archivo = privado_(carpetaRequisiciones_(req.proyectoFolio).createFile(Utilities.newBlob(bytes, tipo.mime,
          nombreArchivoReq(folio, 'Cotización', tipo.ext, version))));
        hoja.getRange(req.fila, 8, 1, 2).setValues([[archivo.getId(), archivo.getUrl()]]);
      }
      escribirRenglonesReq_(libro, folio, version, renglones);
      cambiarReq_(hoja, req, nuevo, { motivo: '' });
      const campos = { aprobacion: null, aproboEmail: '', fechaAprobacion: '', propuesta: propuestaRetirada_(req.propuesta),
        recibeEmail: '', voboEmail: '', fechaVobo: '' };
      if (sitio) campos.sitio = sitio;
      if ('fechaRequerida' in d0) campos.fechaRequerida = fechaRequerida;
      camposReq_(hoja, req, campos);
      eventoReq_(libro, folio, nuevo, 'Corregida y reenviada' + (bytes ? ' con otra cotización.' : '.'));
      bitacora_(libro, 'Reenviar requisición', req.proyectoFolio, folio + ' · versión ' + version + ' · ' + renglones.length +
        ' renglón(es)' + (bytes ? ' · cotización nueva' : ''), '', HOJAS_COMPRAS);
    } else {
      const proyecto = proyectoParaCompras_(d0.proyectoFolio);
      if (proyecto.estado === 'Cancelado') throw new Error('El proyecto ' + proyecto.folio + ' está cancelado: no se piden materiales.');
      const hoja = hojaReq_(libro);
      folio = siguienteFolio_(PREFIJO_REQ, hoja, 'CONSECUTIVO_REQ_');
      version = 1;
      const archivo = bytes ? privado_(carpetaRequisiciones_(proyecto.folio).createFile(Utilities.newBlob(bytes, tipo.mime,
        nombreArchivoReq(folio, 'Cotización', tipo.ext, 1)))) : null;
      const ahora = Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss');
      hoja.appendRow([folio, textoFecha_(hoyIso_()), proyecto.folio, t(yo),
        t([VENDEDOR_.nombre, VENDEDOR_.apellido].filter(Boolean).join(' ') || yo), REQ_SOLICITADA, '', archivo ? archivo.getId() : '',
        archivo ? archivo.getUrl() : '', '', '', '', ahora, '', t(sitio), textoFecha_(fechaRequerida), '', '', '', '', '', '', '', '', '']);
      escribirRenglonesReq_(libro, folio, 1, renglones);
      eventoReq_(libro, folio, REQ_SOLICITADA, [sitio, fechaRequerida ? 'se necesita el ' + fechaRequerida : ''].filter(Boolean).join(' · '));
      bitacora_(libro, 'Solicitar requisición', proyecto.folio, folio + ' · ' + renglones.length + ' renglón(es)' +
        (sitio ? ' · ' + sitio : '') + (archivo ? '' : ' · sin cotización'), '', HOJAS_COMPRAS);
    }
    SpreadsheetApp.flush();
    const resultado = { folio: folio, requisiciones: misRequisiciones() };
    if (claveCache) cache.put(claveCache, JSON.stringify(resultado), 21600); // 6 h
    return resultado;
  });
}

/** El solicitante cancela su requisición (Solicitada o Devuelta), con motivo. No se borra. */
function cancelarRequisicion(folioReq, motivo) {
  exigirRequisicion_();
  const m = motivoObligatorio_(motivo, 'Escribe el motivo de la cancelación.');
  const libro = libroCompras_();
  return conCandado_(() => {
    const { hoja, req } = buscarReq_(libro, folioReq);
    if (req.solicitanteEmail !== String(VENDEDOR_.email).toLowerCase()) {
      throw errorPermiso_('Solo quien hizo la requisición ' + req.folio + ' puede cancelarla.');
    }
    cambiarReq_(hoja, req, transicionReq(req.estado, 'cancelar'), { motivo: m });
    eventoReq_(libro, req.folio, REQ_CANCELADA, m);
    bitacora_(libro, 'Cancelar requisición', req.proyectoFolio, req.folio, m, HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    return misRequisiciones();
  });
}

/** Cierre: la requisición pasa a Cerrada y su orden a Recibida (hoy, con el correo de quien cierra). */
function cerrarReq_(libro, hoja, req, nota, motivo) {
  const nuevo = transicionReq(req.estado, 'cerrar');
  const { hoja: hO, orden } = buscarOrden_(libro, req.ocFolio);
  if (orden.estado !== OC_PAGADA) throw new Error('La orden ' + orden.folio + ' no está pagada.');
  cambiarReq_(hoja, req, nuevo, { notasRecepcion: nota, motivo: motivo || req.motivo });
  hO.getRange(orden.fila, COL_ESTADO_OC, 1, 3).setValues([[OC_RECIBIDA, textoFecha_(hoyIso_()), textoCelda(VENDEDOR_.email)]]);
  eventoReq_(libro, req.folio, REQ_CERRADA, [motivo ? 'Cerrada por compras: ' + motivo : 'Material recibido', nota].filter(Boolean).join(' · '));
  bitacora_(libro, 'Cerrar requisición', req.proyectoFolio, req.folio + ' · ' + orden.folio + ' recibida el ' + hoyIso_() +
    (nota ? ' · ' + nota : ''), motivo || '', HOJAS_COMPRAS);
}

/** "Recibí el material": solo el solicitante y solo si está Pagada. notas opcionales (p. ej. "faltó 1 pieza"). */
function cerrarRequisicion(folioReq, notas) {
  exigirRequisicion_();
  if (flujoOperaciones_()) throw new Error('Confirma lo que recibiste renglón por renglón con "Registrar recepción".');
  const nota = notaOpcional_(notas);
  const libro = libroCompras_();
  return conCandado_(() => {
    const { hoja, req } = buscarReq_(libro, folioReq);
    if (req.solicitanteEmail !== String(VENDEDOR_.email).toLowerCase()) {
      throw errorPermiso_('Solo quien hizo la requisición ' + req.folio + ' puede confirmar que recibió el material.');
    }
    cerrarReq_(libro, hoja, req, nota, '');
    SpreadsheetApp.flush();
    return misRequisiciones();
  });
}

function notaOpcional_(notas) {
  const n = String(notas || '').trim();
  if (n.length > 500) throw new Error('Las notas deben tener máximo 500 caracteres.');
  return n;
}

// ---- Requisiciones: lado de compras ----

/** Todas las requisiciones (compras), más recientes primero. Filtro opcional por estado y por folio/proyecto/solicitante. */
function listarRequisiciones(busqueda, estado, soloSiHay) {
  exigirCompras_();
  const clave = 'reqs_' + String(estado || '') + '_' + textoNormal(busqueda);
  return enCache_(clave, ['requisiciones', 'oc', 'pagosProveedores', 'proyectos'], TTL_CACHE,
    soloSiHay ? null : () => listarRequisicionesDeHojas_(busqueda, estado)) || null;
}

function listarRequisicionesDeHojas_(busqueda, estado) {
  const libro = libroComprasSiExiste_();
  if (!libro) return [];
  const ren = renglonesDeReqs_(libro), proyectos = nombresDeProyectos_();
  const q = textoNormal(busqueda), e = String(estado || '').trim();
  const lista = [];
  filasDeArea_(hojaReq_(libro), HOJAS_COMPRAS, 'Requisiciones').forEach((r, i) => {
    const req = reqDesdeFila_(r, i + 2);
    if (!req.folio) return;
    const p = proyectos[req.proyectoFolio.toUpperCase()];
    const x = { folio: req.folio, fecha: req.fecha, proyectoFolio: req.proyectoFolio, proyectoNombre: p ? p.nombre : '',
      proyectoVisible: p ? p.folioVisible : req.proyectoFolio,
      solicitante: req.solicitante, solicitanteEmail: req.solicitanteEmail, estado: req.estado, ocFolio: req.ocFolio,
      actualizado: req.actualizado, renglones: ((ren[req.folio.toUpperCase()] || {}).renglones || []).length,
      sitio: req.sitio, prioridad: req.prioridad, fechaRequerida: req.fechaRequerida };
    if (e && x.estado !== e) return;
    if (q && !textoNormal([x.folio, x.proyectoVisible, x.proyectoNombre, x.solicitante, x.solicitanteEmail, x.ocFolio].join(' ')).includes(q)) return;
    lista.push(x);
  });
  return lista.reverse().slice(0, 200);
}

function pagoProvDesdeFila_(r, fila) {
  return {
    folio: String(r[0]), fecha: fechaIso_(r[1]), fechaRegistro: fechaTexto_(r[2]), ocFolio: String(r[3]), reqFolio: String(r[4] || ''),
    proyectoFolio: String(r[5] || ''), monto: Number(r[6]) || 0, monedaPago: String(r[7] || ''),
    tipoCambio: r[8] === '' ? '' : Number(r[8]), montoAplicado: Number(r[9]) || 0, monedaOc: String(r[10] || ''),
    metodo: String(r[11] || ''), referencia: String(r[12] || ''), comprobanteId: String(r[13] || ''),
    comprobanteUrl: String(r[14] || ''), registro: String(r[16] || r[15] || ''), estado: String(r[17] || 'Vigente'),
    canceladoPor: String(r[18] || ''), fechaCancelacion: fechaTexto_(r[19]), motivoCancelacion: String(r[20] || ''), fila: fila,
  };
}

/** Pagos de una orden (en orden de registro). */
function pagosDeOrden_(libro, folioOc) {
  const f = String(folioOc || '').toUpperCase();
  const lista = [];
  if (!f) return lista;
  filasDeArea_(hojaCompras_(libro, 'PagosProveedores'), HOJAS_COMPRAS, 'PagosProveedores').forEach((r, i) => {
    if (String(r[3]).toUpperCase() === f) lista.push(pagoProvDesdeFila_(r, i + 2));
  });
  return lista;
}

/**
 * Vista de una requisición para compras: renglones (con la decisión de operaciones), cotización, historial, proyecto (moneda
 * del contrato), propuesta, orden, recepciones y pagos. Con operaciones (flujoOperaciones_) compras propone y no autoriza.
 */
function vistaRequisicion_(libro, folioReq) {
  const { req } = buscarReq_(libro, folioReq);
  const f = req.folio.toUpperCase();
  const flujo = flujoOperaciones_();
  const proyecto = buscarProyecto_(hojaProyectos_(), req.proyectoFolio);
  const c = monedaDeProyecto_(contratosDelLibro_()[req.proyectoFolio.toUpperCase()] || null);
  let orden = null;
  if (req.ocFolio) { orden = buscarOrden_(libro, req.ocFolio).orden; delete orden.fila; }
  const pagos = req.ocFolio ? pagosDeOrden_(libro, req.ocFolio).map(x => { delete x.fila; return x; }) : [];
  const proyectoVigente = !!proyecto && proyecto.estado !== 'Cancelado'; // Activo o Cerrado, con o sin contrato
  const r = Object.assign({}, req, { propuesta: propuestaVigente_(req) }); delete r.fila;
  const todas = orden ? facturasDelLibro_(libro) : [];
  const vigente = renglonesDeReqs_(libro)[f] || { version: 1, renglones: [] };
  const renglones = vigente.renglones;
  const movs = orden ? (movimientosPorOc_(libro)[orden.folio.toUpperCase()] || []) : [];
  const avance = orden && orden.estado !== OC_CANCELADA ? avanceRecepcion(orden.renglones, movs, renglonesSinRecepcion(propuestaVigente_(req))) : null;
  const aprobados = renglonesAprobados(renglones, req.aprobacion);
  const porCotizar = req.estado === REQ_APROBADA || req.estado === REQ_COTIZADA;
  return {
    requisicion: r,
    flujoOperaciones: flujo,
    version: vigente.version, // versión de los renglones (separar la exige)
    renglones: renglonesConDecision_(renglones, req.aprobacion),
    aprobados: aprobados,
    eventos: eventosDeReqs_(libro)[f] || [],
    proyecto: proyecto ? datosProyectoCompras_(proyecto)
      : { folio: req.proyectoFolio, clave: '', folioVisible: req.proyectoFolio, nombre: '', cliente: '', estado: '', ubicacion: '' },
    moneda: c.moneda, marca: c.marca, sinContrato: c.sinContrato,
    orden: orden, pagos: pagos,
    // Facturas de la orden (4.5): se registran desde que la orden existe hasta que se cancela
    facturas: orden ? facturasDeOrden_(todas, orden.folio) : [],
    totalFacturado: orden ? totalFacturadoDeOrden(todas, orden.folio) : 0,
    facturaCompleta: !!orden && facturacionDeOrden(todas, orden).completa,
    puedeFacturar: !!orden && orden.estado !== OC_CANCELADA,
    proveedores: proveedoresDelLibro_(libro).map(p => { const x = Object.assign({}, p); delete x.fila; return x; }),
    ivaTasas: IVA_OC, metodos: METODOS_PAGO, hoy: hoyIso_(),
    sitios: sitios_(), receptores: receptores_(),
    avance: avance ? avance.lineas : null, recepcionCompleta: !!avance && avance.completo,
    recepciones: recepcionesDe_(movs, true),
    // Flujo de siempre: compras autoriza (emite la orden), devuelve o rechaza la Solicitada
    puedeAutorizar: !flujo && req.estado === REQ_SOLICITADA && proyectoVigente,
    puedeRevisar: !flujo && req.estado === REQ_SOLICITADA,
    // Con operaciones: compras propone sobre lo aprobado, puede pedir aclarar a quien pidió y separar renglones
    puedeCotizar: flujo && porCotizar && proyectoVigente,
    puedeDevolver: flujo && req.estado === REQ_APROBADA,
    puedeSeparar: flujo && porCotizar && aprobados.length > 1,
    puedePagar: (req.estado === REQ_AUTORIZADA || req.estado === REQ_RECIBIDA) && !!orden && orden.estado === OC_EMITIDA,
    puedeCancelarPago: req.estado === REQ_PAGADA,
    puedeCerrar: req.estado === REQ_PAGADA,
    puedeRecibir: flujo && !!avance && !avance.completo && (req.estado === REQ_AUTORIZADA || req.estado === REQ_PAGADA),
    puedeCancelarRecepcion: req.estado !== REQ_CERRADA && !!orden && orden.estado !== OC_CANCELADA,
  };
}

function getRequisicion(folioReq) {
  exigirCompras_();
  return vistaRequisicion_(libroCompras_(), folioReq);
}

/**
 * Autoriza una requisición Solicitada: emite su orden de compra (mismo flujo y PDF, con la línea "Requisición: REQ-…") y la
 * requisición pasa a Autorizada con su oc_folio. oc = datos de la orden (ver emitirOrdenCompra_) + idSolicitud.
 */
function autorizarRequisicion(folioReq, oc) {
  exigirCompras_();
  if (flujoOperaciones_()) {
    throw new Error('Con el flujo de operaciones la orden se emite con el visto bueno de operaciones: manda la propuesta de compra.');
  }
  const d0 = oc || {};
  const libro = libroCompras_();
  const idSolicitud = String(d0.idSolicitud || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const claveCache = idSolicitud ? 'OC_' + idSolicitud : '';

  return conCandado_(() => {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) return JSON.parse(previo);
    }
    const { hoja, req } = buscarReq_(libro, folioReq);
    const nuevo = transicionReq(req.estado, 'autorizar');
    const proyecto = proyectoParaCompras_(req.proyectoFolio);
    const r = emitirOrdenCompra_(libro, d0, proyecto, req.folio);
    cambiarReq_(hoja, req, nuevo, { motivo: '', ocFolio: r.folio, revisar: true });
    eventoReq_(libro, req.folio, nuevo, '');
    bitacora_(libro, 'Autorizar requisición', proyecto.folio, req.folio + ' · ' + r.folio, '', HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    const resultado = { folio: req.folio, ocFolio: r.folio, url: r.url, total: r.total, moneda: r.moneda,
      vista: vistaRequisicion_(libro, req.folio) };
    if (claveCache) cache.put(claveCache, JSON.stringify(resultado), 21600); // 6 h
    return resultado;
  });
}

/**
 * Rechazar (final) o devolver (quien la pidió la corrige) una requisición; motivo obligatorio (lo ve el solicitante).
 * Flujo de siempre: compras. Con operaciones: operaciones rechaza (hasta antes del visto bueno) y devuelve la Solicitada;
 * compras devuelve la Aprobada para pedir una aclaración. Devuelve la vista de quien lo hizo (operaciones o compras).
 */
function revisarRequisicion_(folioReq, motivo, accion) {
  if (!VENDEDOR_) throw errorSesion_('Inicia sesión con tu cuenta @' + DOMINIO_HELGEN + '.');
  const m = motivoObligatorio_(motivo, 'Escribe el motivo (lo verá quien hizo la requisición).');
  const flujo = flujoOperaciones_();
  if (!flujo) exigirCompras_();
  const libro = libroCompras_();
  return conCandado_(() => {
    const { hoja, req } = buscarReq_(libro, folioReq);
    const porCompras = !flujo || (accion === 'devolver' && req.estado === REQ_APROBADA);
    if (porCompras) exigirCompras_();
    else exigirOperaciones_();
    const nuevo = transicionReq(req.estado, accion);
    cambiarReq_(hoja, req, nuevo, { motivo: m, revisar: true });
    eventoReq_(libro, req.folio, nuevo, m);
    bitacora_(libro, (accion === 'rechazar' ? 'Rechazar' : 'Devolver') + ' requisición' + (flujo ? (porCompras ? ' (compras)' : ' (operaciones)') : ''),
      req.proyectoFolio, req.folio, m, HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    return porCompras ? vistaRequisicion_(libro, req.folio) : vistaOperaciones_(libro, req.folio);
  });
}
function rechazarRequisicion(folioReq, motivo) { return revisarRequisicion_(folioReq, motivo, 'rechazar'); }
function devolverRequisicion(folioReq, motivo) { return revisarRequisicion_(folioReq, motivo, 'devolver'); }

/**
 * Pago a proveedor (uno por orden): p = {reqFolio o ocFolio, fecha, monto, monedaPago, tipoCambio, metodo, referencia,
 * comprobante: {nombre, datos}, idSolicitud}. La requisición debe estar Autorizada y su orden Emitida; el monto (convertido a
 * la moneda de la orden) debe ser el total de la orden ±1.00. La orden y la requisición pasan a Pagada.
 */
function registrarPagoProveedor(p) {
  exigirCompras_();
  const d0 = p || {};
  const bytes = bytesDeAdjunto_(d0.comprobante, 'No se pudo leer el comprobante. Vuelve a adjuntarlo.');
  const tipo = validarComprobante(bytes);
  const libro = libroCompras_();

  const idSolicitud = String(d0.idSolicitud || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const claveCache = idSolicitud ? 'PGP_' + idSolicitud : '';

  return conCandado_(() => {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) return JSON.parse(previo);
    }
    let reqFolio = String(d0.reqFolio || '').trim();
    if (!reqFolio && d0.ocFolio) reqFolio = buscarOrden_(libro, d0.ocFolio).orden.reqFolio;
    if (!reqFolio) throw new Error('Esta orden no tiene requisición: no se puede registrar el pago.');
    const { hoja, req } = buscarReq_(libro, reqFolio);
    // Con todo ya recibido (Recibida), el pago la cierra y la orden queda Recibida
    const yaRecibida = req.estado === REQ_RECIBIDA;
    const nuevo = transicionReq(req.estado, yaRecibida ? 'pagarRecibida' : 'pagar');
    const { hoja: hO, orden } = buscarOrden_(libro, req.ocFolio);
    if (d0.ocFolio && String(d0.ocFolio).trim().toUpperCase() !== orden.folio.toUpperCase()) {
      throw new Error('La orden ' + String(d0.ocFolio).toUpperCase() + ' no es la de la requisición ' + req.folio + '.');
    }
    if (orden.estado !== OC_EMITIDA) throw new Error('La orden ' + orden.folio + ' está ' + orden.estado.toLowerCase() + ': no se puede pagar.');
    if (pagosDeOrden_(libro, orden.folio).some(x => x.estado === 'Vigente')) throw new Error('La orden ' + orden.folio + ' ya tiene un pago.');
    const fac = facturacionDeOrden(facturasDelLibro_(libro), orden);
    const pago = normalizarPagoProveedor(d0, { moneda: orden.moneda, total: orden.total, fechaOrden: orden.fecha, hoy: hoyIso_(),
      totalFacturado: fac.completa ? fac.total : 0, facturadoParcial: fac.completa ? 0 : fac.total });

    const hP = hojaCompras_(libro, 'PagosProveedores');
    const folio = siguienteFolio_(PREFIJO_PGP, hP, 'CONSECUTIVO_PGP_');
    const n = pagosDeOrden_(libro, orden.folio).length + 1;
    const archivo = privado_(carpetaRequisiciones_(req.proyectoFolio).createFile(Utilities.newBlob(bytes, tipo.mime,
      nombreArchivoReq(req.folio, 'Comprobante pago', tipo.ext, n))));
    const t = textoCelda;
    hP.appendRow([folio, textoFecha_(pago.fecha), Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss'),
      orden.folio, req.folio, req.proyectoFolio, pago.monto, pago.monedaPago, pago.tipoCambio, pago.montoAplicado, orden.moneda,
      pago.metodo, t(pago.referencia), archivo.getId(), archivo.getUrl(), t(VENDEDOR_.email),
      t([VENDEDOR_.nombre, VENDEDOR_.apellido].filter(Boolean).join(' ')), 'Vigente', '', '', '']);
    hO.getRange(orden.fila, COL_ESTADO_OC).setValue(yaRecibida ? OC_RECIBIDA : OC_PAGADA);
    cambiarReq_(hoja, req, nuevo, {});
    eventoReq_(libro, req.folio, nuevo, yaRecibida ? 'Pagada; el material ya estaba recibido.' : '');
    bitacora_(libro, 'Registrar pago a proveedor', req.proyectoFolio, folio + ' · ' + orden.folio + ' · ' + req.folio + ' · ' +
      formatoMoneda(pago.monto) + ' ' + pago.monedaPago + (pago.tipoCambio ? ' · TC ' + pago.tipoCambio + ' = ' +
      formatoMoneda(pago.montoAplicado) + ' ' + orden.moneda : '') + ' · ' + pago.metodo, '', HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    const resultado = { folio: folio, url: archivo.getUrl(), vista: vistaRequisicion_(libro, req.folio) };
    if (claveCache) cache.put(claveCache, JSON.stringify(resultado), 21600); // 6 h
    return resultado;
  });
}

/** Cancela un pago a proveedor (no se borra), con motivo: la orden vuelve a Emitida y la requisición a Autorizada. */
function cancelarPagoProveedor(folioPago, motivo) {
  exigirCompras_();
  const m = motivoObligatorio_(motivo, 'Escribe el motivo de la cancelación.');
  const libro = libroCompras_();
  return conCandado_(() => {
    const folio = String(folioPago || '').trim().toUpperCase();
    const hP = hojaCompras_(libro, 'PagosProveedores');
    let pago = null;
    filasDeArea_(hP, HOJAS_COMPRAS, 'PagosProveedores').forEach((r, i) => {
      if (String(r[0]).toUpperCase() === folio) pago = pagoProvDesdeFila_(r, i + 2);
    });
    if (!pago) throw new Error('No existe el pago ' + folio + '.');
    if (pago.estado !== 'Vigente') throw new Error('El pago ' + pago.folio + ' ya está cancelado.');
    const { hoja, req } = buscarReq_(libro, pago.reqFolio);
    if (req.estado === REQ_CERRADA) throw new Error('La requisición ' + req.folio + ' ya está cerrada (material recibido): el pago no se puede cancelar.');
    const nuevo = transicionReq(req.estado, 'cancelarPago');
    const { hoja: hO, orden } = buscarOrden_(libro, pago.ocFolio);
    hP.getRange(pago.fila, 18, 1, 4).setValues([['Cancelado', textoCelda(VENDEDOR_.email),
      Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss'), textoCelda(m)]]);
    if (orden.estado === OC_PAGADA) hO.getRange(orden.fila, COL_ESTADO_OC).setValue(OC_EMITIDA);
    cambiarReq_(hoja, req, nuevo, {});
    eventoReq_(libro, req.folio, nuevo, 'Se canceló el pago.');
    bitacora_(libro, 'Cancelar pago a proveedor', req.proyectoFolio, pago.folio + ' · ' + orden.folio + ' · ' + req.folio + ' · ' +
      formatoMoneda(pago.monto) + ' ' + pago.monedaPago, m, HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    return vistaRequisicion_(libro, req.folio);
  });
}

/** Compras cierra una requisición Pagada en lugar del solicitante (p. ej. ya no está en la obra), con motivo obligatorio. */
function cerrarRequisicionCompras(folioReq, motivo, notas) {
  exigirCompras_();
  const m = motivoObligatorio_(motivo, 'Escribe por qué cierras la requisición en lugar de quien la pidió.');
  const nota = notaOpcional_(notas);
  const libro = libroCompras_();
  return conCandado_(() => {
    const { hoja, req } = buscarReq_(libro, folioReq);
    cerrarReq_(libro, hoja, req, nota, m);
    SpreadsheetApp.flush();
    return vistaRequisicion_(libro, req.folio);
  });
}

// ---- Requisiciones con operaciones (incremento 3) ----
// Operaciones (ROL_OPERACIONES) aprueba renglón por renglón y da el visto bueno a la propuesta de compras (eso emite la orden);
// compras propone (disponibilidad por renglón, proveedor y costos), puede pedir una aclaración a quien pidió y separar renglones
// en otra requisición; quien recibe confirma renglón por renglón, antes o después del pago, y cada renglón recibido es una
// entrada de inventario en su sitio (MovimientosInventario). Nadie aprueba lo que pidió ni da el visto bueno a lo que preparó.

/** Guarda la respuesta para un reenvío con el mismo idSolicitud (6 h); si no cabe en el caché, no falla (la escritura ya se hizo). */
function guardarIdempotencia_(cache, clave, resultado) {
  if (!clave) return;
  try { cache.put(clave, JSON.stringify(resultado), 21600); } catch (e) { console.warn('Sin idempotencia para ' + clave + ': ' + e.message); }
}

/**
 * Lista para operaciones, más recientes primero (montos solo de la propuesta por revisar): todas las que esperan algo de
 * operaciones (Solicitada, Cotizada) y las 300 más recientes de las demás.
 */
function listarOperaciones(soloSiHay) {
  exigirOperaciones_();
  return enCache_('ops', ['requisiciones', 'oc', 'proyectos'], TTL_CACHE, soloSiHay ? null : listarOperacionesDeHojas_) || null;
}

function listarOperacionesDeHojas_() {
  const libro = libroComprasSiExiste_();
  if (!libro) return [];
  const ren = renglonesDeReqs_(libro), proyectos = nombresDeProyectos_();
  const lista = [];
  filasDeArea_(hojaReq_(libro), HOJAS_COMPRAS, 'Requisiciones').forEach((r, i) => {
    const req = reqDesdeFila_(r, i + 2);
    if (!req.folio) return;
    const p = proyectos[req.proyectoFolio.toUpperCase()];
    const prop = req.estado === REQ_COTIZADA ? propuestaVigente_(req) : null;
    lista.push({ folio: req.folio, fecha: req.fecha, proyectoFolio: req.proyectoFolio, proyectoNombre: p ? p.nombre : '',
      proyectoVisible: p ? p.folioVisible : req.proyectoFolio, solicitante: req.solicitante, solicitanteEmail: req.solicitanteEmail,
      estado: req.estado, sitio: req.sitio, fechaRequerida: req.fechaRequerida, prioridad: req.prioridad, actualizado: req.actualizado,
      renglones: ((ren[req.folio.toUpperCase()] || {}).renglones || []).length,
      elaboroPropuesta: prop ? String(prop.elaboroEmail || '').toLowerCase() : '',
      proveedor: prop && prop.proveedor ? prop.proveedor.razonSocial : '', total: prop ? prop.total : null, moneda: prop ? prop.moneda : '' });
  });
  let otras = 0;
  return lista.reverse().filter(x => x.estado === REQ_SOLICITADA || x.estado === REQ_COTIZADA || ++otras <= 300);
}

/**
 * Vista de una requisición para operaciones: renglones con su decisión, propuesta de compras (proveedor, costos y totales),
 * orden (sin PDF ni pagos), avance de la recepción e historial. Sin cliente, margen, pagos ni facturas.
 */
function vistaOperaciones_(libro, folioReq) {
  const { req } = buscarReq_(libro, folioReq);
  const f = req.folio.toUpperCase(), yo = yo_();
  const proyecto = buscarProyecto_(hojaProyectos_(), req.proyectoFolio);
  const vigente = renglonesDeReqs_(libro)[f] || { version: 1, renglones: [] };
  const renglones = vigente.renglones, actual = propuestaVigente_(req);
  let orden = null, avance = null, movs = [];
  if (req.ocFolio) {
    const o = buscarOrden_(libro, req.ocFolio).orden;
    orden = { folio: o.folio, fecha: o.fecha, estado: o.estado, proveedor: o.proveedor, total: o.total, moneda: o.moneda,
      fechaEntrega: o.fechaEntrega, lugarEntrega: o.lugarEntrega };
    movs = movimientosPorOc_(libro)[o.folio.toUpperCase()] || [];
    if (o.estado !== OC_CANCELADA) avance = avanceRecepcion(o.renglones, movs, renglonesSinRecepcion(actual));
  }
  const prop = actual ? Object.assign({}, actual, { huella: huellaPropuesta_(actual),
    archivos: (actual.archivos || []).map(a => ({ id: a.id, nombre: a.nombre || '' })) }) : null;
  const esPropia = req.solicitanteEmail === yo;
  const preparo = !!prop && String(prop.elaboroEmail || '').toLowerCase() === yo;
  return {
    requisicion: { folio: req.folio, fecha: req.fecha, proyectoFolio: req.proyectoFolio, solicitante: req.solicitante,
      solicitanteEmail: req.solicitanteEmail, estado: req.estado, motivo: req.motivo, sitio: req.sitio,
      fechaRequerida: req.fechaRequerida, prioridad: req.prioridad, aproboEmail: req.aproboEmail, fechaAprobacion: req.fechaAprobacion,
      voboEmail: req.voboEmail, fechaVobo: req.fechaVobo, recibe: req.recibeEmail || req.solicitanteEmail, origenFolio: req.origenFolio,
      cotizacionId: req.cotizacionId, actualizado: req.actualizado },
    proyecto: proyecto ? { folio: proyecto.folio, folioVisible: proyecto.folioVisible || proyecto.folio, nombre: proyecto.nombre,
      estado: proyecto.estado, ubicacion: proyecto.ubicacion } : { folio: req.proyectoFolio, folioVisible: req.proyectoFolio, nombre: '', estado: '', ubicacion: '' },
    version: vigente.version, // versión de los renglones: aprobar exige la que se vio
    renglones: renglonesConDecision_(renglones, req.aprobacion), aprobacion: req.aprobacion, propuesta: prop,
    eventos: eventosDeReqs_(libro)[f] || [], orden: orden, avance: avance ? avance.lineas : null,
    recepciones: recepcionesDe_(movs, false), hoy: hoyIso_(),
    esPropia: esPropia, preparoPropuesta: preparo,
    puedeAprobar: req.estado === REQ_SOLICITADA && !esPropia,
    puedeDevolver: req.estado === REQ_SOLICITADA,
    puedeRechazar: [REQ_SOLICITADA, REQ_APROBADA, REQ_COTIZADA].indexOf(req.estado) !== -1,
    puedeVisto: req.estado === REQ_COTIZADA && !!prop && !esPropia && !preparo,
    puedeRegresar: req.estado === REQ_COTIZADA,
  };
}

function getRequisicionOperaciones(folioReq) {
  exigirOperaciones_();
  return vistaOperaciones_(libroCompras_(), folioReq);
}

/**
 * Operaciones aprueba una requisición Solicitada renglón por renglón (ver normalizarAprobacion): puede bajar cantidades y
 * rechazar renglones con comentario; pone la prioridad. d.version = la versión de los renglones que vio (si quien pidió la
 * corrigió después, se rechaza). Queda Aprobada y pasa a compras. Nadie aprueba lo que pidió.
 */
function aprobarRequisicion(folioReq, d) {
  exigirOperaciones_();
  const libro = libroCompras_();
  return conCandado_(() => {
    const { hoja, req } = buscarReq_(libro, folioReq);
    if (req.solicitanteEmail === yo_()) {
      throw errorPermiso_('No puedes aprobar tu propia requisición: la aprueba otra persona de operaciones.');
    }
    const nuevo = transicionReq(req.estado, 'aprobar');
    const vigente = renglonesDeReqs_(libro)[req.folio.toUpperCase()] || { version: 1, renglones: [] };
    if (Number((d || {}).version) !== Number(vigente.version)) {
      throw new Error('La requisición ' + req.folio + ' cambió después de que la abriste (versión ' + vigente.version + '): vuelve a abrirla.');
    }
    const a = normalizarAprobacion(d, vigente.renglones);
    const ahora = ahoraTexto_();
    cambiarReq_(hoja, req, nuevo, { motivo: '', revisar: true });
    camposReq_(hoja, req, { prioridad: a.prioridad, aprobacion: { version: vigente.version, renglones: a.renglones, nota: a.nota,
      correo: yo_(), nombre: nombreYo_(), fecha: ahora }, aproboEmail: yo_(), fechaAprobacion: ahora });
    const pedida = {};
    vigente.renglones.forEach(r => { pedida[r.renglon] = r.cantidad; });
    const rech = a.renglones.filter(x => !x.aprobado);
    const bajas = a.renglones.filter(x => x.aprobado && x.cantidad < pedida[x.renglon]);
    const nota = (a.renglones.length - rech.length) + ' de ' + a.renglones.length + ' renglón(es) aprobado(s) · prioridad ' + a.prioridad +
      (bajas.length ? ' · cantidad ajustada: ' + bajas.map(x => x.renglon + ' (' + x.cantidad + ' de ' + pedida[x.renglon] + ')').join(', ') : '') +
      (rech.length ? ' · rechazado(s): ' + rech.map(x => x.renglon + ' (' + x.comentario + ')').join('; ') : '') + (a.nota ? ' · ' + a.nota : '');
    eventoReq_(libro, req.folio, nuevo, nota);
    bitacora_(libro, 'Aprobar requisición', req.proyectoFolio, req.folio + ' · ' + nota, '', HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    return vistaOperaciones_(libro, req.folio);
  });
}

/**
 * Compras manda (o corrige, mientras espera el visto bueno) su propuesta sobre los renglones aprobados: p = datos de la orden
 * (proveedor, moneda, IVA, tipo de cambio, entrega, días de crédito, condiciones, notas) + recibe + renglones con su
 * disponibilidad (ver normalizarPropuesta) + cotizacion opcional ({nombre, datos}: se agrega a las de la propuesta) +
 * idSolicitud. Cada envío es una versión nueva: el visto bueno debe ser sobre la última. Queda Cotizada.
 */
function cotizarRequisicion(folioReq, p) {
  exigirCompras_();
  if (!flujoOperaciones_()) throw new Error('Sin el flujo de operaciones, autoriza la requisición con la orden de compra.');
  const d0 = p || {};
  const bytes = bytesDeAdjunto_(d0.cotizacion, 'No se pudo leer la cotización. Vuelve a adjuntarla.');
  const tipo = bytes ? validarArchivo(bytes, 'la cotización del proveedor', 'La cotización') : null;
  const cfg = getConfig_();
  const receptores = receptores_();
  const libro = libroCompras_();
  const idSolicitud = String(d0.idSolicitud || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const claveCache = idSolicitud ? 'PROP_' + idSolicitud : '';

  return conCandado_(() => {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) return JSON.parse(previo);
    }
    const { hoja, req } = buscarReq_(libro, folioReq);
    const nuevo = transicionReq(req.estado, 'cotizar');
    const proyecto = proyectoParaCompras_(req.proyectoFolio);
    if (proyecto.estado === 'Cancelado') throw new Error('El proyecto ' + proyecto.folio + ' está cancelado: no admite órdenes de compra.');
    const c = monedaDeProyecto_(contratosDelLibro_()[proyecto.folio.toUpperCase()] || null);
    const vigente = renglonesDeReqs_(libro)[req.folio.toUpperCase()] || { renglones: [] };
    const prop = normalizarPropuesta(d0, { aprobados: renglonesAprobados(vigente.renglones, req.aprobacion), moneda: c.moneda,
      ubicacion: proyecto.ubicacion, hoy: hoyIso_(), ivaTasa: cfg.IVA_TASA, solicitante: req.solicitanteEmail, receptores: receptores });
    const anterior = req.propuesta || {};
    const version = (Number(anterior.version) || 0) + 1;
    const archivos = (anterior.archivos || []).slice();
    if (bytes) {
      const nombre = nombreArchivoReq(req.folio, 'Cotización de compras', tipo.ext, archivos.length + 1);
      const archivo = privado_(carpetaRequisiciones_(proyecto.folio).createFile(Utilities.newBlob(bytes, tipo.mime, nombre)));
      archivos.push({ id: archivo.getId(), url: archivo.getUrl(), nombre: nombre });
    }
    const ahora = ahoraTexto_();
    const guardada = { version: version, fecha: ahora, elaboroEmail: yo_(), elaboroNombre: nombreYo_(), recibe: prop.recibe,
      proveedor: prop.proveedor, moneda: prop.moneda, ivaTasa: prop.ivaTasa, tipoCambio: prop.tipoCambio,
      fechaEntrega: prop.fechaEntrega, lugarEntrega: prop.lugarEntrega, condicionesPago: prop.condicionesPago,
      diasCredito: prop.diasCredito, notas: prop.notas, renglones: prop.renglones, subtotal: prop.subtotal, iva: prop.iva,
      total: prop.total, monedaProyecto: prop.monedaProyecto, subtotalProyecto: prop.subtotalProyecto, archivos: archivos };
    if (JSON.stringify(guardada).length > 45000) {
      throw new Error('La propuesta es demasiado grande para guardarse: acorta descripciones y notas, o separa renglones.');
    }
    camposReq_(hoja, req, { propuesta: guardada, recibeEmail: prop.recibe }); // primero la propuesta, después el estado
    cambiarReq_(hoja, req, nuevo, { motivo: '' });
    const cuenta = d => prop.renglones.filter(r => r.disponibilidad === d).length;
    const resumen = [[DISP_EXACTO, 'exacto(s)'], [DISP_SUSTITUTO, 'sustituto(s)'], [DISP_NO, 'no disponible(s)'], [DISP_ADICIONAL, 'adicional(es)']]
      .filter(([d]) => cuenta(d)).map(([d, t]) => cuenta(d) + ' ' + t).join(', ');
    // El historial lo ve quien pidió: sin proveedor ni montos
    eventoReq_(libro, req.folio, nuevo, (version > 1 ? 'Propuesta corregida (versión ' + version + '): ' : 'Propuesta de compra: ') +
      resumen + '. Espera el visto bueno de operaciones.');
    bitacora_(libro, 'Propuesta de compra', proyecto.folio, req.folio + ' · v' + version + ' · ' + prop.proveedor.razonSocial + ' · ' +
      formatoMoneda(prop.total) + ' ' + prop.moneda + ' · ' + resumen + ' · recibe ' + prop.recibe, '', HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    const resultado = { folio: req.folio, version: version, vista: vistaRequisicion_(libro, req.folio) };
    guardarIdempotencia_(cache, claveCache, resultado);
    return resultado;
  });
}

/**
 * Visto bueno de operaciones a la propuesta (versión que vio: si compras la cambió después, se rechaza): emite la orden con
 * el PDF ("Elaboró" = quien preparó la propuesta; "Autorizó" = quien da el visto bueno) y la requisición queda Autorizada.
 * huella = la de la propuesta que vio (vistaOperaciones_): ata el visto bueno al contenido, no solo al número de versión.
 * No sobre una requisición propia ni sobre una propuesta que uno mismo preparó.
 */
function autorizarPropuesta(folioReq, version, idSolicitud, huella) {
  exigirOperaciones_();
  const libro = libroCompras_();
  const id = String(idSolicitud || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const claveCache = id ? 'VOBO_' + id : '';
  return conCandado_(() => {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) return JSON.parse(previo);
    }
    const { hoja, req } = buscarReq_(libro, folioReq);
    const nuevo = transicionReq(req.estado, 'visto');
    const prop = propuestaVigente_(req);
    if (!prop) throw new Error('La requisición ' + req.folio + ' no tiene propuesta de compra.');
    const yo = yo_();
    if (req.solicitanteEmail === yo) throw errorPermiso_('No puedes dar el visto bueno a tu propia requisición.');
    if (String(prop.elaboroEmail || '').toLowerCase() === yo) {
      throw errorPermiso_('No puedes dar el visto bueno a una propuesta que tú preparaste: lo da otra persona de operaciones.');
    }
    if (Number(version) !== Number(prop.version) || String(huella || '') !== huellaPropuesta_(prop)) {
      throw new Error('Compras cambió la propuesta (ahora es la versión ' + prop.version + ') después de que la abriste: revísala otra vez.');
    }
    if (prop.fechaEntrega < hoyIso_()) {
      throw new Error('La fecha de entrega de la propuesta (' + prop.fechaEntrega + ') ya pasó: regrésala a compras para actualizarla.');
    }
    const proyecto = proyectoParaCompras_(req.proyectoFolio);
    const r = emitirOrdenCompra_(libro, ordenDePropuesta(prop), proyecto, req.folio,
      { email: prop.elaboroEmail, nombre: prop.elaboroNombre, autorizo: nombreYo_() + (nombreYo_() === yo ? '' : ' (' + yo + ')') });
    cambiarReq_(hoja, req, nuevo, { motivo: '', ocFolio: r.folio, revisar: true });
    camposReq_(hoja, req, { voboEmail: yo, fechaVobo: ahoraTexto_() });
    eventoReq_(libro, req.folio, nuevo, 'Visto bueno de operaciones: se emitió la orden de compra.');
    bitacora_(libro, 'Visto bueno de operaciones', req.proyectoFolio, req.folio + ' · propuesta v' + prop.version + ' · ' + r.folio, '', HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    const resultado = { folio: req.folio, ocFolio: r.folio, vista: vistaOperaciones_(libro, req.folio) };
    guardarIdempotencia_(cache, claveCache, resultado);
    return resultado;
  });
}

/** Operaciones regresa la propuesta a compras (Cotizada → Aprobada) con el motivo, que ven compras y operaciones. */
function regresarACompras(folioReq, motivo) {
  exigirOperaciones_();
  const m = motivoObligatorio_(motivo, 'Escribe qué debe cambiar compras en la propuesta.');
  const libro = libroCompras_();
  return conCandado_(() => {
    const { hoja, req } = buscarReq_(libro, folioReq);
    cambiarReq_(hoja, req, transicionReq(req.estado, 'regresarACompras'), { motivo: m });
    eventoReq_(libro, req.folio, REQ_APROBADA, 'Operaciones regresó la propuesta a compras para ajustarla.');
    bitacora_(libro, 'Regresar propuesta a compras', req.proyectoFolio, req.folio, m, HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    return vistaOperaciones_(libro, req.folio);
  });
}

/**
 * Compras separa renglones aprobados en una requisición nueva (p. ej. otro proveedor): la nueva nace Aprobada con la misma
 * aprobación, solicitante, sitio y prioridad (origen_folio = la original); la original se queda con los demás renglones (versión
 * nueva) y, si ya tenía propuesta, vuelve a Aprobada. Debe quedar al menos un renglón aprobado en cada una.
 * opciones = {version (la de los renglones que vio quien separa), idSolicitud}: los renglones se identifican por número.
 */
function separarRequisicion(folioReq, renglonesSep, motivo, opciones) {
  exigirCompras_();
  if (!flujoOperaciones_()) throw new Error('Separar renglones es parte del flujo con operaciones.');
  const m = motivoObligatorio_(motivo, 'Escribe por qué separas los renglones (p. ej. otro proveedor).');
  const o = opciones || {};
  const libro = libroCompras_();
  const cache = CacheService.getScriptCache();
  const claveCache = o.idSolicitud ? 'SEP_' + String(o.idSolicitud).slice(0, 64) : '';
  return conCandado_(() => {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) return JSON.parse(previo);
    }
    const { hoja, req } = buscarReq_(libro, folioReq);
    if (req.estado !== REQ_APROBADA && req.estado !== REQ_COTIZADA) {
      throw new Error('Solo se separan renglones de una requisición aprobada que todavía no tiene orden de compra.');
    }
    const actual = renglonesDeReqs_(libro)[req.folio.toUpperCase()] || { version: 1, renglones: [] };
    if (Number(o.version) !== Number(actual.version)) {
      throw new Error('La requisición ' + req.folio + ' cambió después de que la abriste (versión ' + actual.version + '): vuelve a abrirla.');
    }
    const dec = {};
    ((req.aprobacion && req.aprobacion.renglones) || []).forEach(a => { dec[a.renglon] = a; });
    const quitar = (Array.isArray(renglonesSep) ? renglonesSep : []).map(Number).filter((n, i, a) => n > 0 && a.indexOf(n) === i);
    if (!quitar.length) throw new Error('Elige los renglones que van a la requisición nueva.');
    quitar.forEach(n => { if (!dec[n] || !dec[n].aprobado) throw new Error('El renglón ' + n + ' no está aprobado: no se puede separar.'); });
    const mover = actual.renglones.filter(r => quitar.indexOf(r.renglon) !== -1);
    const quedan = actual.renglones.filter(r => quitar.indexOf(r.renglon) === -1);
    if (!quedan.some(r => dec[r.renglon] && dec[r.renglon].aprobado)) {
      throw new Error('Deja al menos un renglón aprobado en ' + req.folio + '.');
    }
    const renumerar = lista => lista.map((r, i) => Object.assign({}, dec[r.renglon], { renglon: i + 1 }));
    const nuevaFolio = siguienteFolio_(PREFIJO_REQ, hoja, 'CONSECUTIVO_REQ_');
    const ahora = ahoraTexto_(), t = textoCelda;
    const aprobNueva = Object.assign({}, req.aprobacion, { renglones: renumerar(mover), separadaDe: req.folio });
    hoja.appendRow([nuevaFolio, textoFecha_(hoyIso_()), req.proyectoFolio, t(req.solicitanteEmail), t(req.solicitante), REQ_APROBADA, '',
      req.cotizacionId, req.cotizacionUrl, '', t(yo_()), ahora, ahora, '', t(req.sitio), textoFecha_(req.fechaRequerida), t(req.prioridad),
      JSON.stringify(aprobNueva), t(req.aproboEmail), (req.aprobacion && req.aprobacion.fecha) || ahora, '', '', '',
      t(req.recibeEmail), req.folio]);
    escribirRenglonesReq_(libro, nuevaFolio, 1, mover);
    escribirRenglonesReq_(libro, req.folio, actual.version + 1, quedan);
    const estado = req.estado === REQ_COTIZADA ? transicionReq(req.estado, 'regresarACompras') : req.estado;
    cambiarReq_(hoja, req, estado, {});
    camposReq_(hoja, req, { aprobacion: Object.assign({}, req.aprobacion, { version: actual.version + 1, renglones: renumerar(quedan) }),
      propuesta: propuestaRetirada_(req.propuesta) });
    const lista = mover.map(r => r.descripcion.slice(0, 40)).join('; ');
    eventoReq_(libro, req.folio, estado, 'Compras separó ' + mover.length + ' renglón(es) en ' + nuevaFolio + ' para comprarlos aparte: ' + lista + '.');
    eventoReq_(libro, nuevaFolio, REQ_APROBADA, 'Separada de ' + req.folio + ' por compras; conserva la aprobación de operaciones.');
    bitacora_(libro, 'Separar requisición', req.proyectoFolio, req.folio + ' → ' + nuevaFolio + ' · ' + lista, m, HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    const resultado = { folio: nuevaFolio, vista: vistaRequisicion_(libro, req.folio) };
    guardarIdempotencia_(cache, claveCache, resultado);
    return resultado;
  });
}

/**
 * Recepción renglón por renglón (con operaciones). p = {reqFolio, renglones: [{renglon (de la orden), cantidad}], sitio, notas,
 * final (ya no llegará más), evidencia: {nombre, datos} (foto de la remisión, opcional), idSolicitud}. La registra quien pidió o
 * quien recibe; compras también, en su lugar, con notas obligatorias. Requisición Autorizada o Pagada. Cada renglón recibido es
 * una "Entrada por compra" en el sitio (folio REC). Completa: Autorizada → Recibida (falta pagar) o Pagada → Cerrada (la orden
 * queda Recibida); parcial: el estado no cambia.
 */
function registrarRecepcion(p) {
  if (!VENDEDOR_) throw errorSesion_('Inicia sesión con tu cuenta @' + DOMINIO_HELGEN + '.');
  if (!flujoOperaciones_()) throw new Error('La recepción por renglón es parte del flujo con operaciones: usa "Recibí el material".');
  const compras = esCompras_(), requisicion = esRequisicion_();
  if (!compras && !requisicion) throw errorPermiso_('No tienes permiso para registrar recepciones.');
  const d0 = p || {};
  const bytes = bytesDeAdjunto_(d0.evidencia, 'No se pudo leer la foto. Vuelve a adjuntarla.');
  const tipo = bytes ? validarArchivo(bytes, 'la foto de la remisión', 'La foto') : null;
  const sitios = sitios_();
  const libro = libroCompras_();
  const idSolicitud = String(d0.idSolicitud || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const claveCache = idSolicitud ? 'REC_' + idSolicitud : '';

  return conCandado_(() => {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) return JSON.parse(previo);
    }
    const yo = yo_();
    const { hoja, req } = buscarReq_(libro, d0.reqFolio);
    const recibe = req.recibeEmail || req.solicitanteEmail;
    const propio = yo === req.solicitanteEmail || yo === recibe;
    if (!propio && !compras) {
      throw errorPermiso_('Solo quien pidió la requisición ' + req.folio + ' o quien la recibe puede registrar la recepción.');
    }
    if (req.estado !== REQ_AUTORIZADA && req.estado !== REQ_PAGADA) {
      throw new Error('La requisición ' + req.folio + ' está ' + req.estado.toLowerCase() + ': no tiene material por recibir.');
    }
    const { hoja: hO, orden } = buscarOrden_(libro, req.ocFolio);
    if (orden.estado === OC_CANCELADA) throw new Error('La orden ' + orden.folio + ' está cancelada.');
    const avance = avanceRecepcion(orden.renglones, movimientosPorOc_(libro)[orden.folio.toUpperCase()] || [],
      renglonesSinRecepcion(propuestaVigente_(req)));
    if (avance.completo) throw new Error('Todo lo de la orden ya se recibió.');
    const rec = normalizarRecepcion(d0, avance.lineas, sitios);
    if (!propio && rec.notas.length < 5) throw new Error('Registras la recepción en lugar de quien la recibe: escribe en las notas por qué.');
    const hM = hojaCompras_(libro, 'MovimientosInventario');
    const folio = siguienteFolio_(PREFIJO_REC, hM, 'CONSECUTIVO_REC_');
    const archivo = bytes ? privado_(carpetaRequisiciones_(req.proyectoFolio).createFile(Utilities.newBlob(bytes, tipo.mime,
      nombreArchivoReq(req.folio, 'Recepción ' + folio, tipo.ext, 1)))) : null;
    const ahora = ahoraTexto_(), t = textoCelda;
    rec.renglones.forEach(x => hM.appendRow([folio, textoFecha_(hoyIso_()), ahora, TIPO_ENTRADA_COMPRA, t(rec.sitio), req.proyectoFolio,
      req.folio, orden.folio, x.renglon, t(x.clave), t(x.descripcion), t(x.unidad), x.cantidad, t(yo), t(nombreYo_()), t(rec.notas),
      archivo ? archivo.getId() : '', archivo ? archivo.getUrl() : '', 'Vigente', '', '', '']));
    let nuevo = req.estado;
    if (rec.completo) {
      if (req.estado === REQ_PAGADA) {
        nuevo = transicionReq(req.estado, 'recibirPagada');
        hO.getRange(orden.fila, COL_ESTADO_OC, 1, 3).setValues([[OC_RECIBIDA, textoFecha_(hoyIso_()), t(yo)]]);
      } else {
        nuevo = transicionReq(req.estado, 'recibir'); // la orden sigue Emitida (sin pagar) con su fecha de recepción
        hO.getRange(orden.fila, COL_ESTADO_OC + 1, 1, 2).setValues([[textoFecha_(hoyIso_()), t(yo)]]);
      }
      cambiarReq_(hoja, req, nuevo, { notasRecepcion: rec.notas });
    } else {
      cambiarReq_(hoja, req, nuevo, {});
    }
    const faltante = rec.completo && avance.lineas.some(l => {
      const x = rec.renglones.find(y => y.renglon === l.renglon);
      return l.pendiente - (x ? x.cantidad : 0) > 1e-9;
    });
    const lista = rec.renglones.map(x => x.cantidad + ' ' + x.unidad + ' ' + String(x.descripcion).slice(0, 40)).join('; ');
    eventoReq_(libro, req.folio, nuevo, 'Recepción ' + folio + ' en ' + rec.sitio + ' (' +
      (rec.completo ? (faltante ? 'última, con faltante' : 'completa') : 'parcial') + '): ' + lista + (propio ? '' : ' · registrada por compras') +
      (rec.notas ? ' · ' + rec.notas : ''));
    bitacora_(libro, 'Registrar recepción', req.proyectoFolio, folio + ' · ' + req.folio + ' · ' + orden.folio + ' · ' + rec.sitio + ' · ' +
      lista + (rec.completo ? ' · ' + nuevo : ' · parcial'), propio ? '' : rec.notas, HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    const resultado = { folio: folio, completo: rec.completo, estado: nuevo,
      requisiciones: requisicion ? misRequisiciones() : null, vista: compras ? vistaRequisicion_(libro, req.folio) : null };
    guardarIdempotencia_(cache, claveCache, resultado);
    return resultado;
  });
}

/**
 * Compras cancela una recepción equivocada (sus movimientos quedan Cancelados, no se borran), con motivo. Si la requisición ya
 * estaba Recibida vuelve a Autorizada; una Cerrada (pagada y recibida) ya no se toca.
 */
function cancelarRecepcion(folioRec, motivo) {
  exigirCompras_();
  const m = motivoObligatorio_(motivo, 'Escribe el motivo de la cancelación.');
  const libro = libroCompras_();
  return conCandado_(() => {
    const folio = String(folioRec || '').trim().toUpperCase();
    const hM = hojaCompras_(libro, 'MovimientosInventario');
    const filas = [];
    filasDeArea_(hM, HOJAS_COMPRAS, 'MovimientosInventario').forEach((r, i) => {
      const x = movDesdeFila_(r, i + 2);
      if (x.folio.toUpperCase() === folio) filas.push(x);
    });
    if (!filas.length) throw new Error('No existe la recepción ' + folio + '.');
    if (!filas.some(x => x.estado === 'Vigente')) throw new Error('La recepción ' + folio + ' ya está cancelada.');
    const { hoja, req } = buscarReq_(libro, filas[0].reqFolio);
    if (req.estado === REQ_CERRADA) {
      throw new Error('La requisición ' + req.folio + ' ya está cerrada (pagada y recibida): la recepción no se puede cancelar.');
    }
    const { hoja: hO, orden } = buscarOrden_(libro, filas[0].ocFolio);
    const ahora = ahoraTexto_(), t = textoCelda;
    filas.forEach(x => hM.getRange(x.fila, 19, 1, 4).setValues([['Cancelado', t(yo_()), ahora, t(m)]]));
    let nuevo = req.estado;
    if (req.estado === REQ_RECIBIDA) {
      nuevo = transicionReq(req.estado, 'cancelarRecepcion');
      cambiarReq_(hoja, req, nuevo, { notasRecepcion: '' });
      hO.getRange(orden.fila, COL_ESTADO_OC + 1, 1, 2).setValues([['', '']]);
    } else {
      cambiarReq_(hoja, req, nuevo, {});
    }
    eventoReq_(libro, req.folio, nuevo, 'Se canceló la recepción ' + folio + '; hay que registrarla de nuevo.');
    bitacora_(libro, 'Cancelar recepción', req.proyectoFolio, folio + ' · ' + req.folio + ' · ' + orden.folio, m, HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    return vistaRequisicion_(libro, req.folio);
  });
}

/**
 * Archivo de una requisición para verlo sin acceso a la carpeta de compras en Drive: {nombre, mime, datos (base64)}. Solo la
 * cotización que adjuntó quien pidió o las de la propuesta de compras, y solo para compras u operaciones (quien pidió, la suya).
 */
function archivoRequisicion(folioReq, archivoId) {
  if (!VENDEDOR_) throw errorSesion_('Inicia sesión con tu cuenta @' + DOMINIO_HELGEN + '.');
  const libro = libroComprasSiExiste_();
  if (!libro) throw new Error('No hay requisiciones.');
  const { req } = buscarReq_(libro, folioReq);
  const id = String(archivoId || '').trim();
  const personal = esCompras_() || esOperaciones_();
  const delSolicitante = !!id && id === req.cotizacionId;
  const deCompras = !!id && ((req.propuesta && req.propuesta.archivos) || []).some(a => a.id === id);
  if (!((delSolicitante && (personal || yo_() === req.solicitanteEmail)) || (deCompras && personal))) {
    throw errorPermiso_('No tienes acceso a ese archivo.');
  }
  const blob = DriveApp.getFileById(id).getBlob();
  return { nombre: blob.getName(), mime: blob.getContentType(), datos: Utilities.base64Encode(blob.getBytes()) };
}

/**
 * Correr desde el editor: crea la carpeta "Cotizador Helgen — Compras" (en Mi unidad) y su libro (con todas sus pestañas,
 * también las de requisiciones), y deja los dos en "Restringido" (también si ya existían). No comparte nada: a quien deba abrir los PDF se le comparte la carpeta en Drive.
 */
function prepararCompras() {
  const libro = libroCompras_();
  const carpeta = carpetaCompras_(); // primero la carpeta: el libro hereda su acceso y Drive no deja quitarlo en el hijo
  const archivoLibro = privado_(DriveApp.getFileById(libro.getId()));
  Object.keys(HOJAS_COMPRAS).forEach(n => hojaCompras_(libro, n)); // pestañas nuevas (requisiciones, pagos) y encabezados
  getConfig_(); // agrega TERMINOS_OC a la pestaña Config si falta
  Logger.log('Carpeta de compras: ' + carpeta.getUrl() + ' (restringida)');
  Logger.log('Libro de compras:   ' + archivoLibro.getUrl() + ' (restringido)');
  const props = PropertiesService.getScriptProperties();
  Logger.log('ROL_COMPRAS: ' + (props.getProperty('ROL_COMPRAS') || '(vacío: nadie tiene acceso)'));
  Logger.log('ROL_REQUISICION: ' + (props.getProperty('ROL_REQUISICION') || '(vacío)'));
  Logger.log('SOLO_REQUISICION: ' + (props.getProperty('SOLO_REQUISICION') || '(vacío)'));
  Logger.log('ROL_OPERACIONES: ' + (props.getProperty('ROL_OPERACIONES') || '(vacío: flujo de siempre, sin aprobación de operaciones)'));
  Logger.log('Sitios (Config → SITIOS): ' + sitiosDeTexto(getConfig_().SITIOS).join(', '));
}

// ====== 4.5 FACTURAS DE PROVEEDOR Y CUENTAS POR PAGAR ======
// Compras (ROL_COMPRAS) registra las facturas de cada orden: CFDI 4.0 con su XML (el servidor lee todo de ahí; el PDF es
// opcional) o, para proveedores extranjeros sin CFDI, el PDF y los datos capturados. Vencimiento = emisión + días de crédito
// de la orden. Todo en el libro de compras (pestaña FacturasProveedor); archivos en Compras/AAAA/<folio del proyecto>/
// Facturas/ (restringida). Lógica pura en la sección 5: leerCfdi, validarFacturaProveedor, antiguedadCxp.

const SUBCARPETA_FACTURAS = 'Facturas';
const COL_VENCIMIENTO_FPR = 7; // G: fecha_vencimiento; H: dias_credito
const COL_ESTADO_FPR = 30;     // AD: estado; AE:AG cancelado_por, fecha_cancelacion, motivo_cancelacion

/** Copia de un registro sin su número de fila (lo que se manda a la interfaz). */
function sinFila_(o) {
  const x = Object.assign({}, o);
  delete x.fila;
  return x;
}

function facturaProvDesdeFila_(r, fila) {
  return {
    folio: String(r[0]), tipo: String(r[1] || FPR_CFDI), uuid: String(r[2] || ''), serieFolio: String(r[3] || ''),
    fechaEmision: fechaIso_(r[4]), fechaRegistro: fechaTexto_(r[5]), fechaVencimiento: fechaIso_(r[6]),
    diasCredito: diasCreditoGuardados(r[7]), ocFolio: String(r[8] || ''), reqFolio: String(r[9] || ''),
    proyectoFolio: String(r[10] || ''), proveedorId: String(r[11] || ''), rfcEmisor: String(r[12] || ''),
    nombreEmisor: String(r[13] || ''), moneda: String(r[14] || ''), subtotal: Number(r[15]) || 0, descuento: Number(r[16]) || 0,
    trasladados: Number(r[17]) || 0, retenidos: Number(r[18]) || 0, total: Number(r[19]) || 0,
    metodoPago: String(r[20] || ''), formaPago: String(r[21] || ''), usoCfdi: String(r[22] || ''),
    xmlUrl: String(r[24] || ''), pdfUrl: String(r[26] || ''), registro: String(r[28] || r[27] || ''),
    estado: String(r[29] || FPR_VIGENTE), canceladoPor: String(r[30] || ''), fechaCancelacion: fechaTexto_(r[31]),
    motivoCancelacion: String(r[32] || ''), notas: String(r[33] || ''), fila: fila,
  };
}

/** Todas las facturas del libro de compras (con su fila). Sin libro: ninguna. */
function facturasDelLibro_(libro) {
  if (!libro) return [];
  const lista = [];
  filasDeArea_(hojaCompras_(libro, 'FacturasProveedor'), HOJAS_COMPRAS, 'FacturasProveedor').forEach((r, i) => {
    if (String(r[0] || '').trim()) lista.push(facturaProvDesdeFila_(r, i + 2));
  });
  return lista;
}

/** Facturas de una orden para la interfaz (sin fila), en orden de registro. */
function facturasDeOrden_(facturas, ocFolio) {
  const f = String(ocFolio || '').toUpperCase();
  return facturas.filter(x => x.ocFolio.toUpperCase() === f).map(sinFila_);
}

function buscarFactura_(libro, folioFpr) {
  const folio = String(folioFpr || '').trim().toUpperCase();
  const factura = facturasDelLibro_(libro).find(x => x.folio.toUpperCase() === folio);
  if (!factura) throw new Error('No existe la factura ' + folio + '.');
  return { hoja: hojaCompras_(libro, 'FacturasProveedor'), factura: factura };
}

/** Compras/AAAA/<folio del proyecto>/Facturas/ (restringida). */
function carpetaFacturas_(proyectoFolio) {
  return privado_(subcarpeta_(carpetaProyectoCompras_(proyectoFolio), SUBCARPETA_FACTURAS));
}

/** Vista que la interfaz repinta tras un cambio: la requisición de la orden o, si se pidió o no tiene, las órdenes del proyecto. */
function vistaDeOrden_(libro, orden, desde) {
  if (orden.reqFolio && desde !== 'proyecto') return { desde: 'requisicion', vista: vistaRequisicion_(libro, orden.reqFolio) };
  return { desde: 'proyecto', vista: vistaCompras_(libro, proyectoParaCompras_(orden.proyectoFolio)) };
}

/**
 * Registra una factura de una orden. p = {ocFolio, tipo: 'CFDI' | 'Extranjera', xml: {datos (base64)} (CFDI),
 * pdf: {datos} (opcional en CFDI, obligatorio en extranjera), numero, fecha, moneda, subtotal, impuestos (extranjera),
 * notas, desde ('requisicion' | 'proyecto'), idSolicitud}. Idempotente por idSolicitud (FPR_<id>, 6 h).
 */
function registrarFacturaProveedor(p) {
  exigirCompras_();
  const d0 = p || {};
  const tipo = d0.tipo === FPR_EXTRANJERA ? FPR_EXTRANJERA : FPR_CFDI;
  // Leer y validar los archivos antes del candado (no dependen de nada guardado)
  let factura, xmlBytes = null, pdfBytes = null, pdfTipo = null;
  if (tipo === FPR_CFDI) {
    xmlBytes = bytesDeAdjunto_(d0.xml, 'No se pudo leer el XML. Vuelve a adjuntarlo.');
    validarXml(xmlBytes);
    factura = leerCfdi(textoUtf8(xmlBytes));
  } else {
    factura = normalizarFacturaExtranjera(d0, hoyIso_());
  }
  if (d0.pdf && d0.pdf.datos) {
    pdfBytes = bytesDeAdjunto_(d0.pdf, 'No se pudo leer el PDF de la factura. Vuelve a adjuntarlo.');
    pdfTipo = validarArchivo(pdfBytes, 'el PDF de la factura', 'El PDF de la factura');
  } else if (tipo === FPR_EXTRANJERA) {
    throw new Error('Adjunta el PDF de la factura del proveedor extranjero.');
  }
  const notas = String(d0.notas || '').trim();
  if (notas.length > 500) throw new Error('Las notas deben tener máximo 500 caracteres.');
  const libro = libroCompras_();
  const cfg = getConfig_();

  const idSolicitud = String(d0.idSolicitud || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const claveCache = idSolicitud ? 'FPR_' + idSolicitud : '';

  return conCandado_(() => {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) { // mismo envío: el mismo folio, con la vista de ahora
        const r = JSON.parse(previo);
        return Object.assign(r, vistaDeOrden_(libro, buscarOrden_(libro, r.ocFolio).orden, d0.desde));
      }
    }
    const { orden } = buscarOrden_(libro, d0.ocFolio);
    const hoy = hoyIso_();
    const v = validarFacturaProveedor(factura, orden, { rfcHelgen: cfg.EMPRESA_RFC, hoy: hoy, facturas: facturasDelLibro_(libro) });
    const hoja = hojaCompras_(libro, 'FacturasProveedor');
    const folio = siguienteFolio_(PREFIJO_FPR, hoja, 'CONSECUTIVO_FPR_');
    const dias = diasCreditoGuardados(orden.diasCredito);
    const vence = fechaVencimiento(factura.fecha, dias);
    const proveedor = orden.proveedor || factura.emisor.nombre;
    const carpeta = carpetaFacturas_(orden.proyectoFolio);
    const guardar = (bytes, mime, ext) => privado_(carpeta.createFile(Utilities.newBlob(bytes, mime,
      nombreArchivoFactura(folio, proveedor, factura.serieFolio, ext))));
    const xml = xmlBytes ? guardar(xmlBytes, 'application/xml', 'xml') : null;
    const pdf = pdfBytes ? guardar(pdfBytes, pdfTipo.mime, pdfTipo.ext) : null;

    const t = textoCelda;
    hoja.appendRow([
      folio, factura.tipo, factura.uuid, t(factura.serieFolio), textoFecha_(factura.fecha),
      Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss'), textoFecha_(vence), dias,
      orden.folio, orden.reqFolio, orden.proyectoFolio, t(orden.proveedorId), t(factura.emisor.rfc || orden.rfc),
      t(factura.emisor.nombre || orden.proveedor), factura.moneda, factura.subtotal, factura.descuento, factura.trasladados,
      factura.retenidos, factura.total, t(factura.metodoPago), t(factura.formaPago), t(factura.usoCfdi),
      xml ? xml.getId() : '', xml ? xml.getUrl() : '', pdf ? pdf.getId() : '', pdf ? pdf.getUrl() : '', t(VENDEDOR_.email),
      t([VENDEDOR_.nombre, VENDEDOR_.apellido].filter(Boolean).join(' ')), FPR_VIGENTE, '', '', '', t(notas),
    ]);
    if (v.actualizarRfc) guardarProveedor_(libro, { razonSocial: orden.proveedor, rfc: factura.emisor.rfc });
    bitacora_(libro, 'Registrar factura de proveedor', orden.proyectoFolio, folio + ' · ' + orden.folio + ' · ' +
      (factura.tipo === FPR_CFDI ? 'CFDI ' + factura.uuid : 'extranjera ' + factura.serieFolio) + ' · ' +
      formatoMoneda(factura.total) + ' ' + factura.moneda + ' · vence ' + vence, '', HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    const base = { folio: folio, fechaVencimiento: vence, ocFolio: orden.folio };
    if (claveCache) {
      try { cache.put(claveCache, JSON.stringify(base), 21600); } catch (e) { console.warn('Caché de idempotencia: ' + e.message); } // 6 h
    }
    return Object.assign(base, vistaDeOrden_(libro, orden, d0.desde));
  });
}

/** Cancela una factura Vigente (no se borra; sus archivos se quedan en Drive), con motivo. Deja de contar como por pagar. */
function cancelarFacturaProveedor(folioFpr, motivo, desde) {
  exigirCompras_();
  const m = motivoObligatorio_(motivo, 'Escribe el motivo de la cancelación.');
  const libro = libroCompras_();
  return conCandado_(() => {
    const { hoja, factura } = buscarFactura_(libro, folioFpr);
    if (factura.estado !== FPR_VIGENTE) throw new Error('La factura ' + factura.folio + ' ya está cancelada.');
    hoja.getRange(factura.fila, COL_ESTADO_FPR, 1, 4).setValues([[FPR_CANCELADA, textoCelda(VENDEDOR_.email),
      Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss'), textoCelda(m)]]);
    bitacora_(libro, 'Cancelar factura de proveedor', factura.proyectoFolio, factura.folio + ' · ' + factura.ocFolio + ' · ' +
      (factura.uuid || factura.serieFolio) + ' · ' + formatoMoneda(factura.total) + ' ' + factura.moneda, m, HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    return Object.assign({ folio: factura.folio }, vistaDeOrden_(libro, buscarOrden_(libro, factura.ocFolio).orden, desde));
  });
}

/** Cambia los días de crédito de una factura Vigente (condiciones renegociadas), con motivo; recalcula su vencimiento. */
function cambiarDiasCreditoFactura(folioFpr, dias, motivo, desde) {
  exigirCompras_();
  const n = normalizarDiasCredito(dias);
  const m = motivoObligatorio_(motivo, 'Escribe por qué cambian los días de crédito.');
  const libro = libroCompras_();
  return conCandado_(() => {
    const { hoja, factura } = buscarFactura_(libro, folioFpr);
    if (factura.estado !== FPR_VIGENTE) throw new Error('La factura ' + factura.folio + ' está cancelada.');
    const vence = fechaVencimiento(factura.fechaEmision, n);
    hoja.getRange(factura.fila, COL_VENCIMIENTO_FPR, 1, 2).setValues([[textoFecha_(vence), n]]);
    bitacora_(libro, 'Cambiar días de crédito de factura', factura.proyectoFolio, factura.folio + ' · ' + factura.diasCredito +
      ' → ' + n + ' días · vence ' + factura.fechaVencimiento + ' → ' + vence, m, HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    return Object.assign({ folio: factura.folio, fechaVencimiento: vence },
      vistaDeOrden_(libro, buscarOrden_(libro, factura.ocFolio).orden, desde));
  });
}

/**
 * Cuentas por pagar (solo lectura): totales por moneda y antigüedad, facturas abiertas, órdenes con factura faltante y PPD
 * pagadas sin REP (antiguedadCxp), con el folio visible y el nombre del proyecto y los enlaces de cada factura. En caché por
 * día y por versión de facturas, órdenes, pagos y proyectos. soloCache: devuelve null si no está en caché.
 */
function cuentasPorPagar(soloCache) {
  exigirCompras_();
  const hoy = hoyIso_();
  const calcular = () => {
    const libro = libroComprasSiExiste_();
    const ordenes = [], pagos = [];
    if (libro) {
      filasDeArea_(hojaCompras_(libro, 'OrdenesCompra'), HOJAS_COMPRAS, 'OrdenesCompra').forEach((r, i) => {
        if (String(r[0] || '').trim()) ordenes.push(ordenDesdeFila_(r, i + 2));
      });
      filasDeArea_(hojaCompras_(libro, 'PagosProveedores'), HOJAS_COMPRAS, 'PagosProveedores').forEach((r, i) => {
        if (String(r[0] || '').trim()) pagos.push(pagoProvDesdeFila_(r, i + 2));
      });
    }
    const facturas = facturasDelLibro_(libro);
    const r = antiguedadCxp({ hoy: hoy, facturas: facturas, ordenes: ordenes, pagos: pagos });
    const proyectos = mapaProyectos_(), porFolio = {}, reqDeOrden = {};
    facturas.forEach(f => { porFolio[f.folio] = f; });
    ordenes.forEach(o => { reqDeOrden[o.folio.toUpperCase()] = o.reqFolio || ''; });
    const proyecto = folio => {
      const p = proyectos[String(folio || '').toUpperCase()];
      return { proyectoVisible: p ? p.folioVisible : folio, proyectoNombre: p ? p.nombre : '' };
    };
    r.abiertas.forEach(a => {
      const f = porFolio[a.folio] || {};
      Object.assign(a, proyecto(a.proyectoFolio), { reqFolio: f.reqFolio || '', xmlUrl: f.xmlUrl || '', pdfUrl: f.pdfUrl || '' });
    });
    r.faltantes.forEach(x => Object.assign(x, proyecto(x.proyectoFolio), { reqFolio: reqDeOrden[x.folio.toUpperCase()] || '' }));
    return r;
  };
  const colecciones = ['facturasProveedor', 'oc', 'pagosProveedores', 'proyectos'];
  if (soloCache) return enCache_('CXP_' + hoy, colecciones, TTL_CACHE) || null;
  return enCache_('CXP_' + hoy, colecciones, TTL_CACHE, calcular);
}

// ====== 5. LÓGICA PURA (sin servicios de Google; se puede probar fuera) ======

function redondear(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function normalizarCotizacion(p, ivaTasa) {
  const c = (p && p.cliente) || {};
  const cliente = {
    nombre: String(c.nombre || '').trim(),
    empresa: String(c.empresa || '').trim(),
    rfc: String(c.rfc || '').trim().toUpperCase(),
    email: String(c.email || '').trim(),
    telefono: String(c.telefono || '').trim(),
    direccion: String(c.direccion || '').trim(),
  };
  if (!cliente.nombre) throw new Error('El nombre del cliente es obligatorio.');

  const items = ((p && p.items) || [])
    .map(it => ({
      clave: String(it.clave || '').trim(),
      descripcion: String(it.descripcion || '').trim(),
      unidad: String(it.unidad || 'PZA').trim(),
      cantidad: Number(it.cantidad) || 0,
      precio: redondear(it.precio),
    }))
    .filter(it => it.descripcion && it.cantidad > 0);
  if (!items.length) throw new Error('Agrega al menos un concepto con cantidad mayor a 0.');
  if (items.some(it => it.precio < 0)) throw new Error('Hay precios negativos.');

  items.forEach(it => { it.importe = redondear(it.cantidad * it.precio); });
  const subtotal = redondear(items.reduce((s, it) => s + it.importe, 0));
  const iva = redondear(subtotal * ivaTasa);
  const total = redondear(subtotal + iva);

  const datos = {
    cliente: cliente, items: items, subtotal: subtotal, iva: iva, total: total, ivaTasa: ivaTasa,
    notas: String((p && p.notas) || '').trim(),
    marca: p && p.marca === 'energy' ? 'energy' : 'helgen',
    moneda: monedaDeCotizacion(p && p.moneda),
  };
  // Tipo de cambio (pesos por dólar) con que la interfaz convirtió los precios del catálogo; solo en USD y solo si es válido
  datos.tipoCambio = datos.moneda === 'USD' ? (tipoCambioDesdeValores(Number(p && p.tipoCambio), '').valor || '') : '';
  return datos;
}

function formatearFolio(prefijo, anio, n) {
  return prefijo + '-' + anio + '-' + String(n).padStart(4, '0');
}

/** Mayor consecutivo ya usado para ese prefijo y año, p. ej. ['HLG-2026-0007', ...] -> 7. */
function maxConsecutivo(folios, prefijo, anio) {
  const base = String(prefijo) + '-' + String(anio) + '-';
  return (folios || []).reduce((max, f) => {
    const s = String(f || '').trim();
    if (s.indexOf(base) !== 0) return max;
    const n = Number(s.slice(base.length));
    return Number.isInteger(n) && n > max ? n : max;
  }, 0);
}

/**
 * Agrupa las filas de Cotizaciones en clientes únicos (mismo nombre + empresa, sin importar mayúsculas,
 * acentos ni espacios). La cotización más reciente manda; los datos vacíos no borran los anteriores.
 * Columnas: 0 Folio, 1 Fecha, 2 Cliente, 3 Empresa, 4 RFC, 5 Correo, 6 Teléfono, 15 Dirección.
 */
function clientesDesdeFilas(filas) {
  const normal = textoNormal;
  const mapa = {};
  (filas || []).forEach((r, i) => {
    const nombre = String(r[2] || '').trim();
    if (!nombre) return;
    const llave = normal(nombre) + '|' + normal(r[3]);
    const c = mapa[llave] || (mapa[llave] = { nombre: '', empresa: '', rfc: '', email: '', telefono: '', direccion: '',
      cotizaciones: 0, ultimaFecha: '', orden: 0 });
    const campos = { nombre: nombre, empresa: r[3], rfc: r[4], email: r[5], telefono: r[6], direccion: r[15] };
    Object.keys(campos).forEach(k => { const v = String(campos[k] || '').trim(); if (v) c[k] = v; });
    c.cotizaciones++;
    c.ultimaFecha = String(r[1] || '') || c.ultimaFecha;
    c.orden = i;
  });
  const lista = Object.keys(mapa).map(k => mapa[k]).sort((a, b) => b.orden - a.orden);

  // Etiqueta única para elegir en la lista: si hay dos clientes con el mismo nombre, se distingue por empresa
  const porNombre = {};
  lista.forEach(c => { const n = normal(c.nombre); porNombre[n] = (porNombre[n] || 0) + 1; });
  lista.forEach(c => {
    c.etiqueta = porNombre[normal(c.nombre)] > 1 && c.empresa ? c.nombre + ' — ' + c.empresa : c.nombre;
    c.id = idCliente(c);
    delete c.orden;
  });
  return lista;
}

/**
 * Correo (minúsculas) → "Nombre Apellido", tomado de las filas de Cotizaciones que sí tienen vendedor_nombre /
 * vendedor_apellido (columnas Q:S). Filas en orden de la hoja: si un correo aparece con nombres distintos, gana la más reciente.
 */
function nombresDeVendedores(filas) {
  const mapa = {};
  (filas || []).forEach(r => {
    const correo = String(r[16] || '').trim().toLowerCase();
    const nombre = [r[17], r[18]].map(x => String(x || '').trim()).filter(Boolean).join(' ');
    if (correo && nombre) mapa[correo] = nombre;
  });
  return mapa;
}

/**
 * Vendedor para el Historial: nombre y apellido de la fila; si no tiene (filas anteriores a la sesión con Google),
 * el nombre que ese correo tiene en otras filas; si no se conoce, el correo (vendedor_email o "Elaboró").
 */
function vendedorDeFila(r, nombres) {
  const propio = [r[17], r[18]].map(x => String(x || '').trim()).filter(Boolean).join(' ');
  if (propio) return propio;
  const correo = String(r[16] || r[10] || '').trim();
  return (nombres || {})[correo.toLowerCase()] || correo;
}

/** Texto sin acentos, en minúsculas y con espacios simples (para comparar nombres). */
function textoNormal(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// RFC genéricos del SAT (público en general / extranjeros): los comparten muchos clientes, no identifican a nadie
const RFC_GENERICOS = ['XAXX010101000', 'XEXX010101000'];

/**
 * Identificador de un cliente (no hay hoja de clientes: salen de Cotizaciones). El RFC si es válido y no genérico;
 * si no, "SIN-RFC:" + nombre|empresa normalizados (la misma llave con que clientesDesdeFilas agrupa).
 */
function idCliente(c) {
  const rfc = String((c && c.rfc) || '').replace(/[\s-]/g, '').toUpperCase();
  if (/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc) && RFC_GENERICOS.indexOf(rfc) === -1) return rfc;
  return 'SIN-RFC:' + textoNormal(c && c.nombre) + '|' + textoNormal(c && c.empresa);
}

/** Valida y limpia un proyecto nuevo. El cliente se guarda como "nombre — empresa" más su cliente_id; la clave (3 letras)
 * es la capturada o, si viene vacía, la sugerida con el nombre. */
function normalizarProyecto(p) {
  const nombre = String((p && p.nombre) || '').trim().replace(/\s+/g, ' ');
  const ubicacion = String((p && p.ubicacion) || '').trim();
  const c = (p && p.cliente) || {};
  const cli = { nombre: String(c.nombre || '').trim(), empresa: String(c.empresa || '').trim(),
    rfc: String(c.rfc || '').trim().toUpperCase() };
  if (!nombre) throw new Error('El nombre del proyecto es obligatorio.');
  if (nombre.length > 80) throw new Error('El nombre del proyecto debe tener máximo 80 caracteres.');
  if (ubicacion.length > 200) throw new Error('La ubicación debe tener máximo 200 caracteres.');
  if (!cli.nombre) throw new Error('Elige o escribe el cliente del proyecto (en "Datos del cliente").');
  return {
    nombre: nombre, ubicacion: ubicacion,
    cliente: cli.empresa && textoNormal(cli.empresa) !== textoNormal(cli.nombre) ? cli.nombre + ' — ' + cli.empresa : cli.nombre,
    clienteId: idCliente(cli),
    clave: validarClaveProyecto(p && p.clave, nombre),
  };
}

/** "PRY-2026-0001 — Cliente — Nombre", sin caracteres que Drive o Windows no acepten, máximo 150 caracteres. */
function nombreCarpetaProyecto(folio, cliente, nombre) {
  const limpio = s => String(s || '').replace(/[\/\\:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  const cli = limpio(cliente).slice(0, 60);
  return [limpio(folio), cli, limpio(nombre)].filter(Boolean).join(' — ').slice(0, 150).trim();
}

/** Filas de la pestaña Proyectos (sin encabezado) → objetos. Columnas en ENCABEZADOS_PROYECTOS. */
function proyectosDesdeFilas(filas) {
  return (filas || []).filter(r => String(r[0] || '').trim()).map(r => {
    const folio = String(r[0]).trim(), clave = String(r[11] || '').trim().toUpperCase();
    return {
      folio: folio,
      fecha: r[1] instanceof Date
        ? [r[1].getDate(), r[1].getMonth() + 1].map(x => String(x).padStart(2, '0')).join('/') + '/' + r[1].getFullYear()
        : String(r[1] || ''),
      nombre: String(r[2] || ''), cliente: String(r[3] || ''), clienteId: String(r[4] || ''),
      ubicacion: String(r[5] || ''),
      estado: String(r[6] || '').trim() || 'Activo',
      carpetaId: String(r[7] || ''),
      clave: clave, folioVisible: folioVisible(folio, clave),
    };
  });
}

/** Busca por folio (con o sin clave), clave, cliente o nombre (sin acentos ni mayúsculas); más recientes primero; máximo n. */
function filtrarProyectos(lista, busqueda, incluirInactivos, n) {
  const q = textoNormal(busqueda);
  return (lista || []).slice().reverse()
    .filter(p => incluirInactivos || p.estado === 'Activo')
    .filter(p => !q || textoNormal([p.folioVisible || p.folio, p.clave, p.cliente, p.nombre].join(' ')).includes(q))
    .slice(0, n || 50);
}

// ---- Clave de proyecto: folio visible PRY-AAAA-NNNN-XXX ----
// La llave interna sigue siendo PRY-AAAA-NNNN (proyecto_folio en Cotizaciones, Cobranza y Compras); la clave va aparte
// (columna L de Proyectos), se sugiere con el nombre, se puede editar al crear y después no cambia.

const PALABRAS_SIN_CLAVE = ['DE', 'DEL', 'LA', 'LAS', 'EL', 'LOS', 'Y', 'EN', 'PARA'];

/**
 * Clave sugerida con el nombre: mayúsculas sin acentos (Ñ → N), sin números ni símbolos y sin DE, DEL, LA, LAS, EL, LOS, Y,
 * EN, PARA. 1 palabra = sus 3 primeras letras; 2 = 2 letras de la primera + inicial de la segunda; 3 o más = iniciales de
 * las tres primeras. Si faltan letras se completa con X. "DROGHEDA" → DRO; "Casa del Lago" → CAL; "Planta de Agua Norte" → PAN.
 */
function claveSugerida(nombre) {
  const palabras = String(nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[^A-Z]+/g, ' ').trim().split(' ').filter(p => p && PALABRAS_SIN_CLAVE.indexOf(p) === -1);
  let c = '';
  if (palabras.length === 1) c = palabras[0].slice(0, 3);
  else if (palabras.length === 2) c = palabras[0].slice(0, 2) + palabras[1].charAt(0);
  else if (palabras.length > 2) c = palabras.slice(0, 3).map(p => p.charAt(0)).join('');
  return (c + 'XXX').slice(0, 3);
}

/** Clave capturada: exactamente 3 letras A–Z (se aceptan minúsculas); vacía = la sugerida con el nombre. */
function validarClaveProyecto(clave, nombre) {
  const c = String(clave == null ? '' : clave).trim().toUpperCase();
  if (!c) return claveSugerida(nombre);
  if (!/^[A-Z]{3}$/.test(c)) throw new Error('La clave del proyecto debe tener exactamente 3 letras (A–Z, sin acentos ni Ñ).');
  return c;
}

/** "PRY-2026-0002" + "DRO" → "PRY-2026-0002-DRO"; sin clave (proyectos sin asignar), el folio solo. */
function folioVisible(folio, clave) {
  const f = String(folio || '').trim().toUpperCase(), c = String(clave || '').trim().toUpperCase();
  return c ? f + '-' + c : f;
}

/** Llave interna a partir de lo que llegue: "PRY-2026-0002-DRO", "pry-2026-0002" o "PRY-2026-0002" → "PRY-2026-0002". */
function folioInterno(texto) {
  const s = String(texto || '').trim().toUpperCase();
  const m = s.match(/^(PRY-\d{4}-\d{4})(-[A-Z]{3})?$/);
  return m ? m[1] : s;
}

// ---- Monedas (MXN / USD) ----
// Cada cotización lleva su moneda (columna U); nunca se suman importes de monedas distintas.

const MONEDAS = ['MXN', 'USD'];

/** Moneda de una cotización nueva: vacía = MXN (como antes); otra que no sea MXN/USD es error. */
function monedaDeCotizacion(m) {
  const s = String(m == null ? '' : m).trim().toUpperCase();
  if (!s) return 'MXN';
  if (MONEDAS.indexOf(s) === -1) throw new Error('Moneda no válida: ' + s + '. Usa MXN o USD.');
  return s;
}

/**
 * Tipo de cambio en uso (pesos por dólar): el manual si es un número válido; si no, el automático (Google Finance).
 * Fuera de 1–1000 se descarta (p. ej. "#N/A" o "Cargando…" de GOOGLEFINANCE). Devuelve {valor, fuente}.
 */
function tipoCambioDesdeValores(automatico, manual) {
  const valido = v => typeof v === 'number' && isFinite(v) && v >= 1 && v <= 1000;
  if (valido(manual)) return { valor: Math.round(manual * 10000) / 10000, fuente: 'manual' };
  if (valido(automatico)) return { valor: Math.round(automatico * 10000) / 10000, fuente: 'Google Finance' };
  return { valor: null, fuente: '' };
}

/** Precio en pesos -> dólares con el tipo de cambio (2 decimales); null si no hay tipo de cambio. */
function precioEnDolares(precioMxn, tipoCambio) {
  return tipoCambio > 0 ? redondear(Number(precioMxn) / tipoCambio) : null;
}

// ---- Cobranza: esquema de pagos, reparto, comprobantes y roles ----

const ESQUEMA_POR_OMISION = [['Anticipo', 60], ['Instalación', 30], ['Encendido del sistema', 10]];
const MAX_ETAPAS = 10;
const METODOS_PAGO = ['Transferencia', 'Efectivo', 'Cheque'];
const TOLERANCIA_PAGO = 1.00;              // en la moneda del proyecto (diferencias de redondeo)
const MAX_COMPROBANTE = 10 * 1024 * 1024;  // 10 MB

/** Etapas por omisión: Helgen Energy 60/30/10 (fijo); Helgen, las mismas como sugerencia editable. */
function esquemaPorOmision() {
  return ESQUEMA_POR_OMISION.map(([etapa, porcentaje]) => ({ etapa: etapa, porcentaje: porcentaje }));
}

/** Pesos/dólares -> centavos enteros (evita errores de punto flotante al sumar). */
function aCentavos(n) {
  return Math.round(redondear(n) * 100);
}

/**
 * Valida un esquema [{etapa, porcentaje}]: de 1 a MAX_ETAPAS etapas, nombres únicos (máx. 40 caracteres),
 * porcentajes mayores a 0 con 2 decimales y suma exacta de 100%. Devuelve el esquema limpio.
 */
function validarEsquema(etapas) {
  if (!Array.isArray(etapas) || !etapas.length) throw new Error('El esquema de pagos necesita al menos una etapa.');
  if (etapas.length > MAX_ETAPAS) throw new Error('El esquema de pagos admite máximo ' + MAX_ETAPAS + ' etapas.');
  const vistos = {};
  const limpio = etapas.map((e, i) => {
    const etapa = String((e && e.etapa) || '').trim().replace(/\s+/g, ' ');
    const txt = e && e.porcentaje;
    const porcentaje = Number(txt);
    if (!etapa) throw new Error('La etapa ' + (i + 1) + ' no tiene nombre.');
    if (etapa.length > 40) throw new Error('El nombre de la etapa "' + etapa.slice(0, 20) + '…" debe tener máximo 40 caracteres.');
    const llave = textoNormal(etapa);
    if (vistos[llave]) throw new Error('La etapa "' + etapa + '" está repetida.');
    vistos[llave] = true;
    if (txt === '' || txt == null || !isFinite(porcentaje) || porcentaje <= 0) {
      throw new Error('El porcentaje de "' + etapa + '" debe ser mayor a 0.');
    }
    if (Math.abs(redondear(porcentaje) - porcentaje) > 1e-9) {
      throw new Error('El porcentaje de "' + etapa + '" admite máximo 2 decimales.');
    }
    return { etapa: etapa, porcentaje: redondear(porcentaje) };
  });
  const suma = limpio.reduce((s, e) => s + Math.round(e.porcentaje * 100), 0);
  if (suma !== 10000) {
    throw new Error('Los porcentajes deben sumar 100% (suman ' + redondear(suma / 100) + '%).');
  }
  return limpio;
}

/** Monto de cada etapa = total × %, redondeado; la última etapa se queda con la diferencia de centavos. */
function montosDeEsquema(etapas, total) {
  const totalCts = aCentavos(total);
  let acumulado = 0;
  return etapas.map((e, i) => {
    const cts = i === etapas.length - 1 ? totalCts - acumulado : Math.round(totalCts * e.porcentaje / 100);
    acumulado += cts;
    return { etapa: e.etapa, porcentaje: e.porcentaje, monto: cts / 100 };
  });
}

/**
 * Convierte el monto de un pago a la moneda del proyecto. Si las monedas son distintas, el tipo de cambio
 * (pesos por dólar) es obligatorio: MXN -> USD divide, USD -> MXN multiplica.
 */
function convertirMoneda(monto, monedaPago, monedaProyecto, tipoCambio) {
  if (monedaPago === monedaProyecto) return redondear(monto);
  const tc = Number(tipoCambio);
  if (!isFinite(tc) || tc <= 0) throw new Error('Captura el tipo de cambio del día (pesos por dólar).');
  if (monedaPago === 'MXN' && monedaProyecto === 'USD') return redondear(monto / tc);
  if (monedaPago === 'USD' && monedaProyecto === 'MXN') return redondear(monto * tc);
  throw new Error('Moneda no válida.');
}

/**
 * Reparte un monto entre las etapas: primero la elegida; el excedente pasa a la siguiente con saldo y, al llegar
 * a la última, a las anteriores en orden. etapas = [{monto, pagado}]. Devuelve {aplicacion: [{orden, centavos}],
 * sobranteCts} sin modificar las etapas.
 */
function repartirPago(etapas, indice, monto) {
  const n = etapas.length;
  let restante = aCentavos(monto);
  const aplicacion = [];
  for (let k = 0; k < n && restante > 0; k++) {
    const i = (indice + k) % n;
    const saldo = aCentavos(etapas[i].monto) - aCentavos(etapas[i].pagado || 0);
    if (saldo <= 0) continue;
    const toma = Math.min(saldo, restante);
    aplicacion.push({ orden: i + 1, centavos: toma });
    restante -= toma;
  }
  return { aplicacion: aplicacion, sobranteCts: restante };
}

/**
 * Resumen de cobranza de un proyecto. contrato = {total, subtotal, moneda}; etapas = [{etapa, porcentaje}];
 * pagos = [{estado, etapaOrden, montoAplicado}] en orden de registro (solo cuentan los Vigentes, se vuelven
 * a repartir en ese orden). Lo que no cabe en ninguna etapa (dentro de la tolerancia) se suma a la etapa elegida.
 */
function resumenCobranza(contrato, etapas, pagos) {
  const lista = montosDeEsquema(etapas, contrato.total).map(e => Object.assign(e, { pagado: 0 }));
  let pagadoCts = 0;
  (pagos || []).filter(p => p.estado === 'Vigente').forEach(p => {
    const indice = Math.min(Math.max((Number(p.etapaOrden) || 1) - 1, 0), lista.length - 1);
    const r = repartirPago(lista, indice, p.montoAplicado);
    r.aplicacion.forEach(a => { lista[a.orden - 1].pagado = (aCentavos(lista[a.orden - 1].pagado) + a.centavos) / 100; });
    if (r.sobranteCts) lista[indice].pagado = (aCentavos(lista[indice].pagado) + r.sobranteCts) / 100;
    pagadoCts += aCentavos(p.montoAplicado);
  });
  lista.forEach(e => {
    e.saldo = (aCentavos(e.monto) - aCentavos(e.pagado)) / 100;
    e.avance = e.monto > 0 ? Math.min(100, Math.round(e.pagado / e.monto * 1000) / 10) : 0;
  });
  const contratadoCts = aCentavos(contrato.total);
  return {
    moneda: contrato.moneda, contratado: contratadoCts / 100, subtotal: redondear(contrato.subtotal),
    pagado: pagadoCts / 100, saldo: (contratadoCts - pagadoCts) / 100,
    avance: contratadoCts > 0 ? Math.min(100, Math.round(pagadoCts / contratadoCts * 1000) / 10) : 0,
    etapas: lista,
  };
}

/** Fecha "AAAA-MM-DD" válida, no futura (hoy = "AAAA-MM-DD") y no anterior a 2020. */
function validarFechaIso(s, hoy, campo) {
  const v = String(s || '').trim();
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const nombre = campo || 'La fecha';
  if (!m) throw new Error(nombre + ' es obligatoria (AAAA-MM-DD).');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw new Error(nombre + ' no es válida.');
  }
  if (v < '2020-01-01') throw new Error(nombre + ' no es válida.');
  if (hoy && v > hoy) throw new Error(nombre + ' no puede ser futura.');
  return v;
}

/**
 * Valida y limpia un pago. proyecto = {moneda, etapas (número de etapas), hoy "AAAA-MM-DD"}.
 * Devuelve {fecha, monto, monedaPago, tipoCambio, montoAplicado, metodo, referencia, etapaOrden}.
 */
function normalizarPago(p, proyecto) {
  const d = p || {};
  const fecha = validarFechaIso(d.fecha, proyecto.hoy, 'La fecha del pago');
  const montoTxt = d.monto, monto = Number(montoTxt);
  if (montoTxt === '' || montoTxt == null || !isFinite(monto) || monto <= 0) throw new Error('El monto del pago debe ser mayor a 0.');
  if (Math.abs(redondear(monto) - monto) > 1e-9) throw new Error('El monto admite máximo 2 decimales.');
  if (monto > 1e10) throw new Error('El monto del pago no es válido.');
  const monedaPago = String(d.monedaPago || proyecto.moneda).trim().toUpperCase();
  if (MONEDAS.indexOf(monedaPago) === -1) throw new Error('Moneda del pago no válida. Usa MXN o USD.');
  const metodo = METODOS_PAGO.find(m => textoNormal(m) === textoNormal(d.metodo));
  if (!metodo) throw new Error('Elige el método de pago: ' + METODOS_PAGO.join(', ') + '.');
  const referencia = String(d.referencia || '').trim().replace(/\s+/g, ' ');
  if (!referencia && metodo !== 'Efectivo') {
    throw new Error('Captura la referencia (' + (metodo === 'Cheque' ? 'número de cheque' : 'clave de rastreo o folio') + ').');
  }
  if (referencia.length > 100) throw new Error('La referencia debe tener máximo 100 caracteres.');
  const etapaOrden = Number(d.etapaOrden);
  if (!Number.isInteger(etapaOrden) || etapaOrden < 1 || etapaOrden > proyecto.etapas) throw new Error('Elige la etapa del pago.');
  let tipoCambio = '';
  if (monedaPago !== proyecto.moneda) {
    tipoCambio = Number(d.tipoCambio);
    if (d.tipoCambio === '' || d.tipoCambio == null || !isFinite(tipoCambio) || tipoCambio <= 0 || tipoCambio > 1000) {
      throw new Error('El proyecto es en ' + proyecto.moneda + ' y el pago en ' + monedaPago +
        ': captura el tipo de cambio del día (pesos por dólar).');
    }
    tipoCambio = Math.round(tipoCambio * 10000) / 10000;
  }
  return { fecha: fecha, monto: redondear(monto), monedaPago: monedaPago, tipoCambio: tipoCambio,
    montoAplicado: convertirMoneda(monto, monedaPago, proyecto.moneda, tipoCambio),
    metodo: metodo, referencia: referencia, etapaOrden: etapaOrden };
}

/**
 * Tipo real de un comprobante por sus primeros bytes (no por la extensión). bytes = arreglo de enteros; en Apps
 * Script vienen con signo (-128…127). Acepta PDF, JPG, PNG y HEIC; máximo MAX_COMPROBANTE. Devuelve {mime, ext}.
 */
function validarComprobante(bytes) {
  return validarArchivo(bytes, 'el comprobante de pago', 'El comprobante');
}

/**
 * Igual que validarComprobante para otro archivo (p. ej. la cotización de una requisición). que = "la cotización del
 * proveedor" (para "Adjunta …"); sujeto = "La cotización" (para "… pesa más de 10 MB" y "… debe ser PDF o imagen").
 */
function validarArchivo(bytes, que, sujeto) {
  if (!bytes || !bytes.length) throw new Error('Adjunta ' + que + ' (PDF o imagen).');
  if (bytes.length > MAX_COMPROBANTE) throw new Error(sujeto + ' pesa más de 10 MB. Reduce la imagen o el PDF.');
  const b = i => (bytes[i] || 0) & 0xFF;
  const txt = (desde, n) => String.fromCharCode.apply(null, Array.from({ length: n }, (_, i) => b(desde + i)));
  if (txt(0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b(0) === 0x89 && txt(1, 3) === 'PNG') return { mime: 'image/png', ext: 'png' };
  if (txt(4, 4) === 'ftyp' && ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].indexOf(txt(8, 4)) !== -1) {
    return { mime: 'image/heic', ext: 'heic' };
  }
  throw new Error(sujeto + ' debe ser PDF o imagen (JPG, PNG o HEIC).');
}

/** Correos de una propiedad ("a@helgen.tech, b@helgen.tech"), en minúsculas; solo del dominio. */
function correosDeLista(texto, dominio) {
  return String(texto || '').split(/[\s,;]+/).map(s => s.trim().toLowerCase())
    .filter(s => s && s.endsWith('@' + dominio) && s.indexOf('@') > 0)
    .filter((s, i, a) => a.indexOf(s) === i);
}

/** Nombre del archivo del comprobante: "PAG-2026-0001 — <método> <referencia>.pdf", sin caracteres raros. */
function nombreComprobante(folio, metodo, referencia, ext) {
  const limpio = s => String(s || '').replace(/[\/\\:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (limpio(folio) + ' — ' + [limpio(metodo), limpio(referencia).slice(0, 60)].filter(Boolean).join(' ')).slice(0, 140) +
    '.' + ext;
}

// ---- Compras: órdenes de compra, proveedores y margen ----

const IVA_OC = [0.16, 0.08, 0];  // tasas de IVA que admite una orden (16% general, 8% frontera, 0% extranjero/exento)
const MAX_RENGLONES_OC = 100;
const RFC_VALIDO = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

/** Valida y limpia un proveedor {razonSocial, rfc, contacto, correo, telefono}. */
function normalizarProveedor(p) {
  const d = p || {};
  const limpio = s => String(s || '').trim().replace(/\s+/g, ' ');
  const prov = {
    razonSocial: limpio(d.razonSocial), rfc: String(d.rfc || '').replace(/[\s-]/g, '').toUpperCase(),
    contacto: limpio(d.contacto), correo: String(d.correo || '').trim().toLowerCase(), telefono: limpio(d.telefono),
  };
  if (!prov.razonSocial) throw new Error('Escribe la razón social del proveedor.');
  if (prov.razonSocial.length > 150) throw new Error('La razón social debe tener máximo 150 caracteres.');
  if (prov.rfc && !RFC_VALIDO.test(prov.rfc)) throw new Error('El RFC del proveedor no es válido.');
  if (prov.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prov.correo)) throw new Error('El correo del proveedor no es válido.');
  if (prov.contacto.length > 100 || prov.correo.length > 100 || prov.telefono.length > 40) {
    throw new Error('Contacto, correo y teléfono del proveedor son demasiado largos.');
  }
  return prov;
}

/** Identificador de un proveedor: su RFC si es válido y no genérico; si no, "SIN-RFC:" + razón social normalizada. */
function proveedorId(p) {
  const rfc = String((p && p.rfc) || '').replace(/[\s-]/g, '').toUpperCase();
  if (RFC_VALIDO.test(rfc) && RFC_GENERICOS.indexOf(rfc) === -1) return rfc;
  return 'SIN-RFC:' + textoNormal(p && p.razonSocial);
}

/**
 * Datos de un proveedor ya registrado + los nuevos: lo nuevo manda, pero un dato vacío no borra uno anterior.
 * diasCredito (texto; '' = sin dato) es el crédito habitual: lo actualiza la última orden emitida (0 = contado sí cuenta).
 */
function fusionarProveedor(anterior, nuevo) {
  const r = {};
  ['razonSocial', 'rfc', 'contacto', 'correo', 'telefono', 'diasCredito'].forEach(k => {
    const txt = o => (o && o[k] != null ? String(o[k]).trim() : '');
    r[k] = txt(nuevo) || txt(anterior);
  });
  return r;
}

/**
 * Filas de la pestaña Proveedores (sin encabezado) → [{id, razonSocial, rfc, contacto, correo, telefono, actualizado,
 * etiqueta, fila}], por razón social. etiqueta = razón social, o "razón social — RFC" si la razón social se repite.
 */
function proveedoresDesdeFilas(filas) {
  const lista = (filas || []).map((r, i) => ({
    id: String(r[0] || '').trim(), razonSocial: String(r[1] || '').trim(), rfc: String(r[2] || '').trim(),
    contacto: String(r[3] || '').trim(), correo: String(r[4] || '').trim(), telefono: String(r[5] || '').trim(),
    actualizado: r[6] instanceof Date ? r[6].toISOString().slice(0, 10) : String(r[6] || ''),
    diasCredito: r[7] === '' || r[7] == null ? '' : diasCreditoGuardados(r[7]), fila: i + 2,
  })).filter(p => p.razonSocial);
  const veces = {};
  lista.forEach(p => { const n = textoNormal(p.razonSocial); veces[n] = (veces[n] || 0) + 1; });
  lista.forEach(p => { p.etiqueta = veces[textoNormal(p.razonSocial)] > 1 && p.rfc ? p.razonSocial + ' — ' + p.rfc : p.razonSocial; });
  return lista.sort((a, b) => textoNormal(a.razonSocial) < textoNormal(b.razonSocial) ? -1 : 1);
}

/**
 * Valida y calcula una orden de compra. proyecto = {moneda, ubicacion, hoy "AAAA-MM-DD", ivaTasa (de Config)}.
 * El costo de cada renglón es el capturado (nunca el precio de venta). Si la orden es en otra moneda que el proyecto,
 * el tipo de cambio (pesos por dólar) es obligatorio y subtotalProyecto queda en la moneda del proyecto (para el margen).
 */
function normalizarOrdenCompra(p, proyecto) {
  const d = p || {};
  const limpio = s => String(s == null ? '' : s).trim();
  const proveedor = normalizarProveedor(d.proveedor);

  const fechaEntrega = validarFechaIso(d.fechaEntrega, null, 'La fecha de entrega');
  if (proyecto.hoy && fechaEntrega < proyecto.hoy) throw new Error('La fecha de entrega no puede ser anterior a hoy.');
  const lugarEntrega = limpio(d.lugarEntrega).replace(/\s+/g, ' ') || limpio(proyecto.ubicacion);
  if (!lugarEntrega) throw new Error('Escribe el lugar de entrega.');
  if (lugarEntrega.length > 200) throw new Error('El lugar de entrega debe tener máximo 200 caracteres.');
  const condicionesPago = limpio(d.condicionesPago).replace(/\s+/g, ' ');
  if (!condicionesPago) throw new Error('Escribe las condiciones de pago (p. ej. contado, crédito 30 días).');
  if (condicionesPago.length > 200) throw new Error('Las condiciones de pago deben tener máximo 200 caracteres.');
  const diasCredito = normalizarDiasCredito(d.diasCredito); // fija el vencimiento de las facturas de la orden (4.5)
  const notas = limpio(d.notas);
  if (notas.length > 1000) throw new Error('Las notas deben tener máximo 1000 caracteres.');

  const moneda = limpio(d.moneda) ? monedaDeCotizacion(d.moneda) : proyecto.moneda;
  const tasaTxt = d.ivaTasa;
  const ivaTasa = tasaTxt === '' || tasaTxt == null ? Number(proyecto.ivaTasa) : Number(tasaTxt);
  if (!IVA_OC.some(t => Math.abs(t - ivaTasa) < 1e-9)) throw new Error('Tasa de IVA no válida: usa 16%, 8% o 0%.');

  const renglones = (Array.isArray(d.renglones) ? d.renglones : [])
    .filter(r => limpio(r && r.descripcion))
    .map(r => {
      const descripcion = limpio(r.descripcion);
      const cantidad = Number(r.cantidad), costoTxt = r.costo, costo = Number(costoTxt);
      if (descripcion.length > 500) throw new Error('La descripción "' + descripcion.slice(0, 30) + '…" debe tener máximo 500 caracteres.');
      if (!isFinite(cantidad) || cantidad <= 0) throw new Error('La cantidad de "' + descripcion.slice(0, 40) + '" debe ser mayor a 0.');
      if (costoTxt === '' || costoTxt == null || !isFinite(costo)) throw new Error('Captura el costo unitario de "' + descripcion.slice(0, 40) + '".');
      if (costo < 0) throw new Error('El costo de "' + descripcion.slice(0, 40) + '" no puede ser negativo.');
      const c = redondear(costo);
      return { clave: limpio(r.clave).toUpperCase().slice(0, 30), descripcion: descripcion,
        unidad: limpio(r.unidad).toUpperCase().slice(0, 20) || 'PZA', cantidad: cantidad, costo: c, importe: redondear(cantidad * c) };
    });
  if (!renglones.length) throw new Error('Agrega al menos un renglón con descripción, cantidad y costo.');
  if (renglones.length > MAX_RENGLONES_OC) throw new Error('Una orden admite máximo ' + MAX_RENGLONES_OC + ' renglones.');

  const subtotal = redondear(renglones.reduce((s, r) => s + r.importe, 0));
  if (subtotal <= 0) throw new Error('El total de la orden debe ser mayor a 0.');
  const iva = redondear(subtotal * ivaTasa);

  let tipoCambio = '';
  if (moneda !== proyecto.moneda) {
    tipoCambio = Number(d.tipoCambio);
    if (d.tipoCambio === '' || d.tipoCambio == null || !isFinite(tipoCambio) || tipoCambio < 1 || tipoCambio > 1000) {
      throw new Error('El proyecto es en ' + proyecto.moneda + ' y la orden en ' + moneda +
        ': captura el tipo de cambio del día (pesos por dólar).');
    }
    tipoCambio = Math.round(tipoCambio * 10000) / 10000;
  }
  return {
    proveedor: proveedor, fechaEntrega: fechaEntrega, lugarEntrega: lugarEntrega, condicionesPago: condicionesPago,
    diasCredito: diasCredito, moneda: moneda, ivaTasa: ivaTasa, renglones: renglones, subtotal: subtotal, iva: iva, total: redondear(subtotal + iva),
    monedaProyecto: proyecto.moneda, tipoCambio: tipoCambio,
    subtotalProyecto: convertirMoneda(subtotal, moneda, proyecto.moneda, tipoCambio), notas: notas,
  };
}

/**
 * Margen de un proyecto: contratado (sin IVA) − costos (sin IVA), en la moneda del contrato. costos = [{concepto, monto,
 * moneda, cantidad?}] (fase 3: órdenes de compra; fase 4: nómina y horas). Un costo en otra moneda es error: nunca se
 * suman MXN y USD. Devuelve {moneda, contratado, costos, totalCostos, margen, porcentaje (sobre el contratado, 1 decimal)}.
 */
function margenProyecto(contratado, moneda, costos) {
  const lista = (costos || []).map(c => {
    if (c.moneda !== moneda) {
      throw new Error('hay costos en ' + c.moneda + ' y el contrato es en ' + moneda + ' (no se suman monedas distintas).');
    }
    return { concepto: c.concepto, moneda: c.moneda, monto: redondear(c.monto), cantidad: c.cantidad || 0 };
  });
  const contratadoCts = aCentavos(contratado);
  const costosCts = lista.reduce((s, c) => s + aCentavos(c.monto), 0);
  const margenCts = contratadoCts - costosCts;
  return {
    moneda: moneda, contratado: contratadoCts / 100, costos: lista, totalCostos: costosCts / 100, margen: margenCts / 100,
    porcentaje: contratadoCts > 0 ? Math.round(margenCts / contratadoCts * 1000) / 10 : 0,
  };
}

/**
 * Costos de órdenes de compra para margenProyecto: suma de subtotal_proyecto (sin IVA) de las órdenes recibidas (el que llama
 * quita las canceladas), agrupada por moneda del proyecto. Sin órdenes: un costo en 0 en la moneda del contrato.
 */
function costosDeOrdenes(ordenes, monedaContrato) {
  const porMoneda = {};
  (ordenes || []).forEach(o => {
    const m = o.monedaProyecto || monedaContrato;
    const x = porMoneda[m] || (porMoneda[m] = { concepto: 'Órdenes de compra', moneda: m, monto: 0, cantidad: 0 });
    x.monto = (aCentavos(x.monto) + aCentavos(o.subtotalProyecto)) / 100;
    x.cantidad++;
  });
  const costos = Object.keys(porMoneda).map(m => porMoneda[m]);
  return costos.length ? costos : [{ concepto: 'Órdenes de compra', moneda: monedaContrato, monto: 0, cantidad: 0 }];
}

/**
 * Resumen de cobranza de todos los proyectos. d = {contratos, esquemas: [{proyectoFolio, orden, etapa, porcentaje}], pagos,
 * proyectos, ordenes}. Los proyectos Cancelados no aparecen. Un renglón por contrato: "Firmado" o "Por firmar" (aceptada sin
 * firmar: se muestra pero no suma a los totales). Pagado y saldo salen de resumenCobranza (lo mismo que la vista del proyecto);
 * margen = contratado sin IVA − órdenes de compra no canceladas. Totales por moneda, solo de contratos firmados: nunca se suman
 * MXN y USD. Renglones: firmados primero (por moneda y del mayor saldo al menor); luego los por firmar.
 */
function resumenGeneralCobranza(d) {
  const may = s => String(s || '').trim().toUpperCase();
  const proyectos = {};
  (d.proyectos || []).forEach(p => { proyectos[may(p.folio)] = p; });
  const agrupar = (lista, campo) => {
    const m = {};
    (lista || []).forEach(x => { const k = may(x[campo]); (m[k] = m[k] || []).push(x); });
    return m;
  };
  const esquemas = agrupar(d.esquemas, 'proyectoFolio'), pagos = agrupar(d.pagos, 'proyectoFolio');
  const ordenes = agrupar(d.ordenes, 'proyectoFolio');

  const renglones = [];
  (d.contratos || []).forEach(c => {
    const folio = may(c.proyectoFolio);
    const p = proyectos[folio];
    if (!p || p.estado === 'Cancelado') return;
    let etapas = (esquemas[folio] || []).slice().sort((a, b) => a.orden - b.orden)
      .map(e => ({ etapa: e.etapa, porcentaje: e.porcentaje }));
    if (!etapas.length) etapas = [{ etapa: 'Total', porcentaje: 100 }];
    const pagosP = pagos[folio] || [];
    const r = resumenCobranza(c, etapas, pagosP);
    const siguiente = r.etapas.find(e => aCentavos(e.saldo) > 0);
    const ultimoPago = pagosP.filter(x => x.estado === 'Vigente').map(x => String(x.fecha || '')).sort().pop() || '';
    const ocs = (ordenes[folio] || []).filter(o => o.estado !== OC_CANCELADA);
    let margen = null, margenError = '';
    try {
      margen = margenProyecto(c.subtotal, c.moneda, costosDeOrdenes(ocs, c.moneda));
    } catch (e) {
      margenError = e.message;
    }
    renglones.push({
      folio: p.folio, folioVisible: p.folioVisible || p.folio, nombre: p.nombre, cliente: p.cliente, estadoProyecto: p.estado,
      marca: c.marca, moneda: c.moneda,
      estadoContrato: c.estado === ESTADO_FIRMADO ? 'Firmado' : 'Por firmar', cotizacion: c.cotizacion, fechaFirma: c.fechaFirma,
      contratado: r.contratado, subtotal: r.subtotal, pagado: r.pagado, saldo: r.saldo, avance: r.avance,
      siguienteEtapa: siguiente ? siguiente.etapa : '', siguienteSaldo: siguiente ? siguiente.saldo : 0, ultimoPago: ultimoPago,
      ordenes: ocs.length, costoOc: margen ? margen.totalCostos : null, margen: margen ? margen.margen : null,
      margenPorcentaje: margen ? margen.porcentaje : null, margenError: margenError,
    });
  });
  // Saldos de monedas distintas no se comparan entre sí: primero por moneda (MXN, USD), luego del mayor saldo al menor
  renglones.sort((a, b) => (a.estadoContrato === b.estadoContrato ? 0 : a.estadoContrato === 'Firmado' ? -1 : 1) ||
    (a.moneda === b.moneda ? 0 : a.moneda < b.moneda ? -1 : 1) || b.saldo - a.saldo || (a.folio < b.folio ? -1 : 1));

  // Totales por moneda (en centavos para no acumular errores de redondeo)
  const tot = {};
  renglones.forEach(x => {
    const t = tot[x.moneda] || (tot[x.moneda] = { moneda: x.moneda, proyectos: 0, conSaldo: 0, contratado: 0, cobrado: 0,
      porCobrar: 0, contratadoSinIva: 0, costoOc: 0, porFirmar: 0, montoPorFirmar: 0, margenError: false });
    if (x.estadoContrato !== 'Firmado') { t.porFirmar++; t.montoPorFirmar += aCentavos(x.contratado); return; }
    t.proyectos++;
    if (aCentavos(x.saldo) > 0) t.conSaldo++;
    t.contratado += aCentavos(x.contratado); t.cobrado += aCentavos(x.pagado); t.porCobrar += aCentavos(x.saldo);
    t.contratadoSinIva += aCentavos(x.subtotal);
    if (x.margenError) t.margenError = true; else t.costoOc += aCentavos(x.costoOc);
  });
  const totales = Object.keys(tot).sort().map(k => {
    const t = tot[k];
    const margenCts = t.contratadoSinIva - t.costoOc;
    return {
      moneda: t.moneda, proyectos: t.proyectos, conSaldo: t.conSaldo, contratado: t.contratado / 100, cobrado: t.cobrado / 100,
      porCobrar: t.porCobrar / 100, avance: t.contratado > 0 ? Math.min(100, Math.round(t.cobrado / t.contratado * 1000) / 10) : 0,
      contratadoSinIva: t.contratadoSinIva / 100, costoOc: t.costoOc / 100, margen: t.margenError ? null : margenCts / 100,
      margenPorcentaje: t.margenError || t.contratadoSinIva <= 0 ? null : Math.round(margenCts / t.contratadoSinIva * 1000) / 10,
      porFirmar: t.porFirmar, montoPorFirmar: t.montoPorFirmar / 100,
    };
  });
  return { totales: totales, proyectos: renglones };
}

/** Nombre del PDF de una orden: "OC-2026-0001 — <proveedor>.pdf", sin caracteres raros. */
function nombreArchivoOc(folio, proveedor) {
  const limpio = s => String(s || '').replace(/[\/\\:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (limpio(folio) + ' — ' + limpio(proveedor).slice(0, 80)).slice(0, 140) + '.pdf';
}

/** Renglones de los términos de las órdenes de compra (TERMINOS_OC de Config; si la celda está vacía, los iniciales). */
function terminosOcParaPdf(cfg) {
  const lineas = String((cfg && cfg.TERMINOS_OC) || '').split('\n').map(t => t.trim()).filter(Boolean);
  return lineas.length ? lineas : TERMINOS_OC_INICIALES.split('\n');
}

// ---- Requisiciones de materiales y pago a proveedores ----

const REQ_SOLICITADA = 'Solicitada', REQ_AUTORIZADA = 'Autorizada', REQ_PAGADA = 'Pagada', REQ_CERRADA = 'Cerrada',
  REQ_RECHAZADA = 'Rechazada', REQ_DEVUELTA = 'Devuelta', REQ_CANCELADA = 'Cancelada';
// Flujo con operaciones (incremento 3): Aprobada (por operaciones), Cotizada (propuesta de compras, espera el visto bueno) y
// Recibida (todo recibido, sin pagar)
const REQ_APROBADA = 'Aprobada', REQ_COTIZADA = 'Cotizada', REQ_RECIBIDA = 'Recibida';
/** Incremento 4: el proveedor ya lo mandó (o el receptor lo recogió); lo usa el centro de mando (módulo C). */
const REQ_EN_CAMINO = 'En camino';
const MAX_RENGLONES_REQ = 100;

/**
 * Cambios de estado válidos de una requisición: acción → {de: [estados], a: estado}.
 * Flujo de siempre: Solicitada → Autorizada (compras genera la orden) → Pagada → Cerrada; Solicitada → Rechazada (final) |
 * Devuelta → Solicitada; Solicitada/Devuelta → Cancelada (el solicitante). Cancelar el pago: Pagada → Autorizada; cancelar la
 * orden: Autorizada → Solicitada.
 * Con operaciones (ROL_OPERACIONES): Solicitada → Aprobada (operaciones, renglón por renglón) → Cotizada (propuesta de compras)
 * → Autorizada (visto bueno de operaciones: genera la orden); pago y recepción en cualquier orden: Autorizada → Pagada |
 * Recibida → Cerrada. Regresos: Aprobada → Devuelta (compras pide aclarar), Cotizada → Aprobada (operaciones la regresa a
 * compras), Autorizada → Aprobada (se canceló la orden), Recibida → Autorizada (se canceló una recepción). Operaciones puede
 * rechazar hasta antes del visto bueno.
 */
const TRANSICIONES_REQ = {
  autorizar: { de: [REQ_SOLICITADA], a: REQ_AUTORIZADA },
  rechazar: { de: [REQ_SOLICITADA, REQ_APROBADA, REQ_COTIZADA], a: REQ_RECHAZADA },
  devolver: { de: [REQ_SOLICITADA, REQ_APROBADA, REQ_COTIZADA], a: REQ_DEVUELTA },
  reenviar: { de: [REQ_DEVUELTA], a: REQ_SOLICITADA },
  cancelar: { de: [REQ_SOLICITADA, REQ_DEVUELTA], a: REQ_CANCELADA },
  pagar: { de: [REQ_AUTORIZADA], a: REQ_PAGADA },
  cancelarPago: { de: [REQ_PAGADA], a: REQ_AUTORIZADA },
  cerrar: { de: [REQ_PAGADA], a: REQ_CERRADA },
  cancelarOc: { de: [REQ_AUTORIZADA], a: REQ_SOLICITADA },
  // Con operaciones
  aprobar: { de: [REQ_SOLICITADA], a: REQ_APROBADA },
  cotizar: { de: [REQ_APROBADA, REQ_COTIZADA], a: REQ_COTIZADA },
  regresarACompras: { de: [REQ_COTIZADA], a: REQ_APROBADA },
  visto: { de: [REQ_COTIZADA], a: REQ_AUTORIZADA },
  recibir: { de: [REQ_AUTORIZADA], a: REQ_RECIBIDA },
  recibirPagada: { de: [REQ_PAGADA], a: REQ_CERRADA },
  pagarRecibida: { de: [REQ_RECIBIDA], a: REQ_CERRADA },
  cancelarOcAprobada: { de: [REQ_AUTORIZADA], a: REQ_APROBADA },
  cancelarRecepcion: { de: [REQ_RECIBIDA], a: REQ_AUTORIZADA },
};
const VERBOS_REQ = { autorizar: 'autorizar', rechazar: 'rechazar', devolver: 'devolver', reenviar: 'reenviar', cancelar: 'cancelar',
  pagar: 'pagar', cancelarPago: 'cancelar el pago de', cerrar: 'cerrar', cancelarOc: 'regresar a Solicitada', aprobar: 'aprobar',
  cotizar: 'mandar la propuesta de', regresarACompras: 'regresar a compras', visto: 'dar el visto bueno a', recibir: 'recibir',
  recibirPagada: 'recibir', pagarRecibida: 'pagar', cancelarOcAprobada: 'regresar a Aprobada',
  cancelarRecepcion: 'cancelar la recepción de' };

/** Estado nuevo de una requisición tras la acción; error si no se puede desde su estado actual. */
function transicionReq(estado, accion) {
  const t = TRANSICIONES_REQ[accion];
  if (!t) throw new Error('Acción no válida.');
  if (t.de.indexOf(estado) === -1) {
    throw new Error('La requisición está ' + String(estado || '').toLowerCase() + ': no se puede ' + VERBOS_REQ[accion] +
      ' (solo si está ' + t.de.map(e => e.toLowerCase()).join(' o ') + ').');
  }
  return t.a;
}

/**
 * Renglones de una requisición (sin costos): [{descripcion, cantidad, unidad, notas}]. Los renglones sin descripción se
 * ignoran; al menos uno; cantidad mayor a 0; unidad por omisión PZA.
 */
function normalizarRequisicion(p) {
  const limpio = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
  const renglones = ((p && Array.isArray(p.renglones)) ? p.renglones : [])
    .filter(r => limpio(r && r.descripcion))
    .map(r => {
      const descripcion = limpio(r.descripcion);
      const cantTxt = r.cantidad, cantidad = Number(cantTxt);
      if (descripcion.length > 500) throw new Error('La descripción "' + descripcion.slice(0, 30) + '…" debe tener máximo 500 caracteres.');
      if (cantTxt === '' || cantTxt == null || !isFinite(cantidad) || cantidad <= 0) {
        throw new Error('La cantidad de "' + descripcion.slice(0, 40) + '" debe ser mayor a 0.');
      }
      if (cantidad > 1e7) throw new Error('La cantidad de "' + descripcion.slice(0, 40) + '" no es válida.');
      const notas = limpio(r.notas);
      if (notas.length > 300) throw new Error('Las notas de "' + descripcion.slice(0, 30) + '…" deben tener máximo 300 caracteres.');
      return { descripcion: descripcion, cantidad: Math.round(cantidad * 10000) / 10000,
        unidad: limpio(r.unidad).toUpperCase().slice(0, 20) || 'PZA', notas: notas };
    });
  if (!renglones.length) throw new Error('Agrega al menos un renglón con descripción y cantidad.');
  if (renglones.length > MAX_RENGLONES_REQ) throw new Error('Una requisición admite máximo ' + MAX_RENGLONES_REQ + ' renglones.');
  return renglones;
}

/**
 * Valida un pago a proveedor. orden = {moneda, total, totalFacturado?, facturadoParcial?, fechaOrden, hoy}. Fecha no futura
 * ni anterior a la orden; método y referencia como en cobranza; si la moneda del pago es otra, tipo de cambio obligatorio
 * (pesos por dólar). El monto en la moneda de la orden debe ser su total o, si sus facturas ya la cubren (totalFacturado;
 * ver facturacionDeOrden), el total de ellas: un proveedor que retiene impuestos factura menos que el total de la orden
 * (decisión 7). Tolerancia TOLERANCIA_PAGO (1.00). facturadoParcial solo sirve para explicar el rechazo.
 */
function normalizarPagoProveedor(p, orden) {
  const d = p || {};
  const fecha = validarFechaIso(d.fecha, orden.hoy, 'La fecha del pago');
  if (orden.fechaOrden && fecha < orden.fechaOrden) throw new Error('La fecha del pago no puede ser anterior a la orden (' + orden.fechaOrden + ').');
  let pago;
  try {
    pago = normalizarPago(Object.assign({}, d, { fecha: fecha, etapaOrden: 1 }), { moneda: orden.moneda, etapas: 1, hoy: orden.hoy });
  } catch (e) {
    throw new Error(String(e.message).replace('El proyecto es en', 'La orden es en')); // aquí la moneda de referencia es la de la orden
  }
  const cuadra = t => Math.abs(aCentavos(pago.montoAplicado) - aCentavos(t)) <= aCentavos(TOLERANCIA_PAGO);
  const tope = aCentavos(orden.total) + aCentavos(TOLERANCIA_PAGO);
  const facturado = Number(orden.totalFacturado) > 0 && aCentavos(orden.totalFacturado) <= tope ? Number(orden.totalFacturado) : 0;
  if (!cuadra(orden.total) && !(facturado > 0 && cuadra(facturado))) {
    throw new Error('El pago (' + formatoMoneda(pago.montoAplicado) + ' ' + orden.moneda + ') debe ser igual al total de la orden (' +
      formatoMoneda(orden.total) + ' ' + orden.moneda + ')' + (facturado > 0 ? ' o al total de sus facturas (' +
      formatoMoneda(facturado) + ' ' + orden.moneda + ')' : '') + '.' + (Number(orden.facturadoParcial) > 0 ? ' Sus facturas vigentes (' +
      formatoMoneda(orden.facturadoParcial) + ' ' + orden.moneda + ') todavía no cubren la orden.' : ''));
  }
  return { fecha: pago.fecha, monto: pago.monto, monedaPago: pago.monedaPago, tipoCambio: pago.tipoCambio,
    montoAplicado: pago.montoAplicado, metodo: pago.metodo, referencia: pago.referencia };
}

/** "REQ-2026-0001 — Cotización.pdf"; el archivo n (n > 1) lleva " (n)": el anterior no se borra. */
function nombreArchivoReq(folio, que, ext, n) {
  return String(folio) + ' — ' + que + (n > 1 ? ' (' + n + ')' : '') + '.' + ext;
}

// ---- Requisiciones con operaciones (incremento 3): aprobación por renglón, propuesta de compras y recepción ----
// Solo aplica cuando ROL_OPERACIONES tiene correos (flujoOperaciones_): sin ella, el flujo es el de siempre (§6.13).

const PRIORIDADES_REQ = ['Urgente', 'Normal', 'Baja'];
const DISP_EXACTO = 'Exacto', DISP_SUSTITUTO = 'Sustituto', DISP_NO = 'No disponible', DISP_ADICIONAL = 'Adicional';
const DISPONIBILIDADES = [DISP_EXACTO, DISP_SUSTITUTO, DISP_NO, DISP_ADICIONAL];

/** Sitios de la celda SITIOS de Config (uno por renglón; también separados por coma o punto y coma), sin repetir. */
function sitiosDeTexto(texto) {
  if (String(texto == null ? '' : texto).indexOf('|') !== -1) return sitiosDetalleDeTexto(texto).map(s => s.nombre);
  const vistos = {};
  return String(texto == null ? '' : texto).split(/[\n,;]+/).map(s => s.trim().replace(/\s+/g, ' ')).filter(s => {
    const k = textoNormal(s);
    if (!s || vistos[k]) return false;
    vistos[k] = true;
    return true;
  });
}

/** El sitio tal como está en la lista (sin distinguir mayúsculas ni acentos); error si no está. */
function sitioDeLista(sitio, sitios, obligatorio) {
  const s = String(sitio == null ? '' : sitio).trim();
  if (!s) {
    if (obligatorio) throw new Error('Elige el sitio donde se necesita el material.');
    return '';
  }
  const x = (sitios || []).find(v => textoNormal(v) === textoNormal(s));
  if (!x) throw new Error('El sitio "' + s.slice(0, 60) + '" no está en la lista de sitios.');
  return x;
}

/** Fecha opcional en que se necesita el material: "" o AAAA-MM-DD no anterior a hoy. */
function fechaRequeridaValida(fecha, hoy) {
  const s = String(fecha == null ? '' : fecha).trim();
  if (!s) return '';
  const v = validarFechaIso(s, null, 'La fecha en que se necesita');
  if (hoy && v < hoy) throw new Error('La fecha en que se necesita no puede ser anterior a hoy.');
  return v;
}

/**
 * Aprobación de operaciones, renglón por renglón. d = {prioridad, nota, renglones: [{renglon, aprobado (true/false),
 * cantidad (≤ la pedida; vacío = la pedida), comentario (obligatorio si se rechaza)}]}; renglones = los vigentes de la
 * requisición. Todos deben decidirse y al menos uno aprobarse (si no, se rechaza la requisición completa).
 */
function normalizarAprobacion(d, renglones) {
  const x = d || {};
  const limpio = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
  const prioridad = PRIORIDADES_REQ.find(v => textoNormal(v) === textoNormal(x.prioridad || 'Normal'));
  if (!prioridad) throw new Error('Prioridad no válida: usa Urgente, Normal o Baja.');
  const nota = limpio(x.nota);
  if (nota.length > 500) throw new Error('La nota debe tener máximo 500 caracteres.');
  const porRenglon = {};
  (Array.isArray(x.renglones) ? x.renglones : []).forEach(r => { if (r) porRenglon[Number(r.renglon)] = r; });
  const lista = (renglones || []).map(r => {
    const dd = porRenglon[r.renglon];
    const nombre = 'el renglón ' + r.renglon + ' (' + String(r.descripcion).slice(0, 40) + ')';
    if (!dd || (dd.aprobado !== true && dd.aprobado !== false)) throw new Error('Aprueba o rechaza ' + nombre + '.');
    const comentario = limpio(dd.comentario);
    if (comentario.length > 300) throw new Error('El comentario de ' + nombre + ' debe tener máximo 300 caracteres.');
    if (!dd.aprobado) {
      if (comentario.length < 3) throw new Error('Escribe por qué rechazas ' + nombre + ' (lo verá quien lo pidió).');
      return { renglon: r.renglon, aprobado: false, cantidad: 0, comentario: comentario };
    }
    const cant = dd.cantidad === '' || dd.cantidad == null ? Number(r.cantidad) : Number(dd.cantidad);
    if (!isFinite(cant) || cant <= 0) throw new Error('La cantidad aprobada de ' + nombre + ' debe ser mayor a 0.');
    if (cant > Number(r.cantidad) + 1e-9) {
      throw new Error('La cantidad aprobada de ' + nombre + ' no puede ser mayor a la pedida (' + r.cantidad + ').');
    }
    return { renglon: r.renglon, aprobado: true, cantidad: Math.round(cant * 10000) / 10000, comentario: comentario };
  });
  if (!lista.some(a => a.aprobado)) throw new Error('No aprobaste ningún renglón: si no se compra nada, usa "Rechazar".');
  return { prioridad: prioridad, nota: nota, renglones: lista };
}

/** Renglones aprobados: [{renglon, descripcion, unidad, notas, cantidad (la aprobada), pedida}]. */
function renglonesAprobados(renglones, aprobacion) {
  const dec = {};
  ((aprobacion && aprobacion.renglones) || []).forEach(a => { dec[a.renglon] = a; });
  return (renglones || []).filter(r => dec[r.renglon] && dec[r.renglon].aprobado).map(r => ({
    renglon: r.renglon, descripcion: r.descripcion, unidad: r.unidad, notas: r.notas, cantidad: dec[r.renglon].cantidad,
    pedida: r.cantidad }));
}

/**
 * Propuesta de compras sobre los renglones aprobados. p = datos de una orden (ver normalizarOrdenCompra) + recibe (correo)
 * y renglones: [{renglon (el de la requisición; 0 = adicional), disponibilidad (Exacto | Sustituto | No disponible |
 * Adicional), clave, descripcion, unidad, cantidad, costo, nota}]. ctx = {aprobados (renglonesAprobados), moneda, ubicacion,
 * hoy, ivaTasa, solicitante, receptores (correos que pueden recibir)}. Cada aprobado aparece una vez; un sustituto dice qué se
 * compra; los no disponibles no llevan costo ni van a la orden; los adicionales son renglones nuevos. recibir = false marca un
 * adicional que no se recibe en sitio (flete, servicio): no se confirma ni entra al inventario; al menos uno se recibe.
 * Devuelve la orden calculada (normalizarOrdenCompra) con renglones [{renglon, disponibilidad, nota, recibir, clave,
 * descripcion, unidad, cantidad, costo, importe}] en el orden de la requisición (adicionales al final) y recibe.
 */
function normalizarPropuesta(p, ctx) {
  const d = p || {};
  const limpio = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
  const porRenglon = {}, adicionales = [];
  (Array.isArray(d.renglones) ? d.renglones : []).forEach(r => {
    if (!r) return;
    const n = Number(r.renglon) || 0;
    if (n > 0) {
      if (porRenglon[n]) throw new Error('El renglón ' + n + ' viene dos veces en la propuesta.');
      porRenglon[n] = r;
    } else if (limpio(r.descripcion)) {
      adicionales.push(r);
    }
  });
  const aprobados = ctx.aprobados || [];
  Object.keys(porRenglon).forEach(n => {
    if (!aprobados.some(a => a.renglon === Number(n))) throw new Error('El renglón ' + n + ' no está aprobado por operaciones: no se compra.');
  });
  const disp = (r, n) => {
    const x = DISPONIBILIDADES.find(v => textoNormal(v) === textoNormal(r.disponibilidad));
    if (!x || x === DISP_ADICIONAL) throw new Error('Marca el renglón ' + n + ' como exacto, sustituto o no disponible.');
    return x;
  };
  const nota = (r, n) => {
    const t = limpio(r.nota);
    if (t.length > 300) throw new Error('La nota del renglón ' + n + ' debe tener máximo 300 caracteres.');
    return t;
  };
  const todos = aprobados.map(a => {
    const r = porRenglon[a.renglon];
    if (!r) throw new Error('Falta la propuesta del renglón ' + a.renglon + ' (' + String(a.descripcion).slice(0, 40) + ').');
    const x = disp(r, a.renglon);
    const base = { renglon: a.renglon, disponibilidad: x, nota: nota(r, a.renglon), recibir: true };
    if (x === DISP_NO) return Object.assign(base, { clave: '', descripcion: a.descripcion, unidad: a.unidad, cantidad: 0, costo: 0, importe: 0 });
    if (x === DISP_SUSTITUTO && !limpio(r.descripcion)) throw new Error('Escribe qué se comprará en lugar del renglón ' + a.renglon + '.');
    return Object.assign(base, { comprar: true, clave: r.clave, descripcion: limpio(r.descripcion) || a.descripcion,
      unidad: limpio(r.unidad) || a.unidad, cantidad: r.cantidad === '' || r.cantidad == null ? a.cantidad : r.cantidad, costo: r.costo });
  }).concat(adicionales.map((r, i) => ({ renglon: 0, disponibilidad: DISP_ADICIONAL, nota: nota(r, 'adicional ' + (i + 1)),
    recibir: r.recibir !== false, comprar: true, clave: r.clave, descripcion: r.descripcion, unidad: r.unidad, cantidad: r.cantidad,
    costo: r.costo })));
  const comprar = todos.filter(r => r.comprar);
  if (!comprar.length) throw new Error('Ningún renglón se puede comprar: devuélvela a quien la pidió o pide a operaciones que la rechace.');
  if (!comprar.some(r => r.recibir)) throw new Error('Al menos un renglón debe recibirse en sitio (los demás son servicios o fletes).');
  const oc = normalizarOrdenCompra(Object.assign({}, d, { renglones: comprar }),
    { moneda: ctx.moneda, ubicacion: ctx.ubicacion, hoy: ctx.hoy, ivaTasa: ctx.ivaTasa });
  let i = 0;
  const renglones = todos.map(r => {
    if (!r.comprar) { delete r.comprar; return r; }
    return Object.assign({ renglon: r.renglon, disponibilidad: r.disponibilidad, nota: r.nota, recibir: r.recibir }, oc.renglones[i++]);
  });
  const recibe = String(d.recibe == null || d.recibe === '' ? ctx.solicitante || '' : d.recibe).trim().toLowerCase();
  if ((ctx.receptores || []).indexOf(recibe) === -1) {
    throw new Error('Quien recibe (' + (recibe || 'nadie') + ') debe tener acceso a Requisiciones para confirmar la recepción.');
  }
  return Object.assign({}, oc, { renglones: renglones, recibe: recibe });
}

/** Datos para emitir la orden a partir de una propuesta guardada (solo los renglones que se compran). */
function ordenDePropuesta(prop) {
  return {
    proveedor: prop.proveedor, fechaEntrega: prop.fechaEntrega, lugarEntrega: prop.lugarEntrega,
    condicionesPago: prop.condicionesPago, diasCredito: prop.diasCredito, moneda: prop.moneda, tipoCambio: prop.tipoCambio,
    ivaTasa: prop.ivaTasa, notas: prop.notas,
    renglones: (prop.renglones || []).filter(r => r.disponibilidad !== DISP_NO)
      .map(r => ({ clave: r.clave, descripcion: r.descripcion, unidad: r.unidad, cantidad: r.cantidad, costo: r.costo })),
  };
}

/** Renglones de la orden (desde 1) que no se reciben en sitio, según la propuesta (adicionales con recibir = false). */
function renglonesSinRecepcion(prop) {
  const lista = [];
  let i = 0;
  ((prop && prop.renglones) || []).forEach(r => {
    if (r.disponibilidad === DISP_NO) return;
    i++;
    if (r.recibir === false) lista.push(i);
  });
  return lista;
}

/**
 * Avance de la recepción de una orden: renglones = los de la orden; movimientos = entradas por compra de esa orden
 * [{renglon (de la orden, desde 1), cantidad, estado}] (solo cuentan las Vigentes); sinRecibir = renglones de la orden que no
 * se reciben (renglonesSinRecepcion). Devuelve {lineas: [{renglon, clave, descripcion, unidad, pedido, recibido, pendiente}],
 * completo, algo}.
 */
function avanceRecepcion(renglones, movimientos, sinRecibir) {
  const r4 = n => Math.round(n * 10000) / 10000;
  const recibido = {};
  (movimientos || []).forEach(m => {
    if (m.estado === 'Vigente') recibido[m.renglon] = r4((recibido[m.renglon] || 0) + (Number(m.cantidad) || 0));
  });
  const lineas = (renglones || []).map((r, i) => {
    const pedido = Number(r.cantidad) || 0, rec = recibido[i + 1] || 0;
    return { renglon: i + 1, clave: r.clave || '', descripcion: r.descripcion, unidad: r.unidad, pedido: pedido, recibido: rec,
      pendiente: Math.max(0, r4(pedido - rec)) };
  }).filter(l => (sinRecibir || []).indexOf(l.renglon) === -1);
  return { lineas: lineas, completo: lineas.length > 0 && lineas.every(l => l.pendiente <= 1e-9), algo: lineas.some(l => l.recibido > 0) };
}

/**
 * Recepción de material. p = {renglones: [{renglon (de la orden), cantidad}], sitio, notas, final}; lineas = avanceRecepcion;
 * sitios = lista válida. Cantidad ≥ 0 y no mayor a lo pendiente; al menos una mayor a 0. final = "ya no llegará más": cierra la
 * recepción aunque falte algo (con notas obligatorias). Devuelve {renglones (solo los recibidos), sitio, notas, completo}.
 */
function normalizarRecepcion(p, lineas, sitios) {
  const d = p || {};
  const sitio = sitioDeLista(d.sitio, sitios, true);
  const notas = String(d.notas == null ? '' : d.notas).trim().replace(/\s+/g, ' ');
  if (notas.length > 500) throw new Error('Las notas deben tener máximo 500 caracteres.');
  const pide = {};
  (Array.isArray(d.renglones) ? d.renglones : []).forEach(r => { if (r) pide[Number(r.renglon)] = r.cantidad; });
  const recibidos = [];
  Object.keys(pide).forEach(n => {
    const l = lineas.find(x => x.renglon === Number(n));
    if (!l) throw new Error('La orden no tiene el renglón ' + n + '.');
    const txt = pide[n], cant = txt === '' || txt == null ? 0 : Number(txt);
    if (!isFinite(cant) || cant < 0) throw new Error('La cantidad recibida de "' + String(l.descripcion).slice(0, 40) + '" no es válida.');
    if (cant > l.pendiente + 1e-9) {
      throw new Error('De "' + String(l.descripcion).slice(0, 40) + '" solo faltan ' + l.pendiente + ' ' + l.unidad + ' por recibir.');
    }
    if (cant > 0) recibidos.push({ renglon: l.renglon, clave: l.clave, descripcion: l.descripcion, unidad: l.unidad,
      cantidad: Math.round(cant * 10000) / 10000 });
  });
  if (!recibidos.length) throw new Error('Escribe la cantidad recibida de al menos un renglón.');
  const quedan = lineas.some(l => {
    const r = recibidos.find(x => x.renglon === l.renglon);
    return l.pendiente - (r ? r.cantidad : 0) > 1e-9;
  });
  if (d.final && quedan && notas.length < 5) throw new Error('Escribe en las notas qué faltó y por qué ya no llegará.');
  return { renglones: recibidos, sitio: sitio, notas: notas, completo: !quedan || !!d.final };
}

// ---- Facturas de proveedor (CFDI 4.0 o extranjeras) y cuentas por pagar ----
// Una orden puede tener una o varias facturas (entregas parciales). Las de proveedores mexicanos se registran con su XML:
// el servidor lee todo de ahí (nadie captura montos ni el UUID). Las de proveedores extranjeros (JLCPCB, Ardusimple, LCSC…)
// no traen CFDI: se registran con su PDF y los datos capturados. Vencimiento = fecha de emisión + días de crédito de la
// orden. Por pagar = factura Vigente cuya orden no está cancelada y no tiene un pago Vigente. Nunca se suman monedas distintas.

const PREFIJO_FPR = 'FPR';
const FPR_VIGENTE = 'Vigente', FPR_CANCELADA = 'Cancelada';
const FPR_CFDI = 'CFDI', FPR_EXTRANJERA = 'Extranjera';
const MAX_DIAS_CREDITO = 180;
const TOLERANCIA_FACTURA = 1.00;            // en la moneda de la orden (redondeos entre la orden y sus facturas)
const MAX_XML_CFDI = 2 * 1024 * 1024;       // un CFDI pesa unos KB; 2 MB sobra
const UUID_CFDI = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const NS_CFDI_40 = 'http://www.sat.gob.mx/cfd/4', NS_CFDI_33 = 'http://www.sat.gob.mx/cfd/3';
const TOLERANCIA_CFDI = 0.02; // redondeo aceptado entre el total del CFDI y la suma de sus partes
const METODOS_CFDI = ['PUE', 'PPD'];

/** Rangos de antigüedad de cuentas por pagar, por días vencidos (0 o menos = por vencer). */
const RANGOS_CXP = [
  { clave: 'porVencer', etiqueta: 'Por vencer', hasta: 0 },
  { clave: 'd1a30', etiqueta: 'Vencido 1–30', hasta: 30 },
  { clave: 'd31a60', etiqueta: 'Vencido 31–60', hasta: 60 },
  { clave: 'd61a90', etiqueta: 'Vencido 61–90', hasta: 90 },
  { clave: 'd90mas', etiqueta: 'Vencido +90', hasta: Infinity },
];

/** Días de crédito capturados en la orden: entero de 0 a MAX_DIAS_CREDITO (0 = contado). Obligatorio. */
function normalizarDiasCredito(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) throw new Error('Captura los días de crédito (0 = contado).');
  if (!/^\d{1,3}$/.test(s) || Number(s) > MAX_DIAS_CREDITO) {
    throw new Error('Los días de crédito deben ser un número entero de 0 a ' + MAX_DIAS_CREDITO + '.');
  }
  return Number(s);
}

/** Días de crédito ya guardados: las órdenes anteriores a este cambio no los tienen y cuentan como contado (0). */
function diasCreditoGuardados(v) {
  const n = Number(v);
  return v === '' || v == null || !isFinite(n) || n < 0 ? 0 : Math.floor(n);
}

/** Días de crédito escritos en las condiciones de pago de una orden anterior ("Crédito 30 días" → 30); si no los dicen, 0. */
function diasCreditoDeCondiciones(texto) {
  const m = String(texto || '').match(/(\d{1,3})\s*d[ií]as/i);
  return m && Number(m[1]) <= MAX_DIAS_CREDITO ? Number(m[1]) : 0;
}

/** "AAAA-MM-DD" + días naturales → "AAAA-MM-DD". En UTC, así no depende de la zona horaria. */
function sumarDias(fechaIso, dias) {
  const m = String(fechaIso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('Fecha no válida: ' + fechaIso);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + Number(dias || 0))).toISOString().slice(0, 10);
}

/** Días naturales de la fecha a a la fecha b ("AAAA-MM-DD"); positivo si b es posterior. */
function diasEntre(a, b) {
  const t = s => { const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/); return Date.UTC(+m[1], +m[2] - 1, +m[3]); };
  return Math.round((t(b) - t(a)) / 864e5);
}

/** Vencimiento de una factura: fecha de emisión + días de crédito. */
function fechaVencimiento(fechaEmision, diasCredito) {
  return sumarDias(fechaEmision, diasCreditoGuardados(diasCredito));
}

/** Atributos de una etiqueta XML ('Rfc="X" Nombre="Y &amp; Z"') → {Rfc: 'X', Nombre: 'Y & Z'}. */
function atributosXml(texto) {
  const r = {};
  const re = /([^\s=\/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(texto || ''))) {
    r[m[1]] = String(m[2] != null ? m[2] : m[3])
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  return r;
}

/**
 * Lee un CFDI 4.0 a partir del texto del XML, sin servicios de Google. Solo lee atributos: nunca sigue referencias del XML
 * (DTD, entidades, esquemas). Devuelve {tipo: 'CFDI', version, tipoComprobante, fecha, serie, folio, serieFolio, moneda,
 * subtotal, descuento, total, metodoPago, formaPago, usoCfdi, emisor: {rfc, nombre}, receptor: {rfc, nombre}, trasladados,
 * retenidos, uuid, fechaTimbrado}. Los impuestos son los del comprobante (no los de cada concepto).
 */
function leerCfdi(texto) {
  let s = String(texto == null ? '' : texto).replace(/^﻿/, '');
  if (!s.trim()) throw new Error('El XML está vacío.');
  if (/<!DOCTYPE|<!ENTITY/i.test(s)) throw new Error('El archivo no es un CFDI válido (trae declaraciones no permitidas).');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(\/?)(?:[A-Za-z_][\w.\-]*:)?([A-Za-z_][\w.\-]*)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const pila = [], nodos = {};
  let raiz = null, m;
  while ((m = re.exec(s))) {
    const nombre = m[2];
    if (m[1]) { const i = pila.lastIndexOf(nombre); if (i !== -1) pila.length = i; continue; }
    const padre = pila.length ? pila[pila.length - 1] : '';
    const attrs = atributosXml(m[3]);
    if (!raiz) raiz = { nombre: nombre, attrs: attrs };
    if (padre === 'Comprobante' && ['Emisor', 'Receptor', 'Impuestos'].indexOf(nombre) !== -1 && !nodos[nombre]) nodos[nombre] = attrs;
    if (nombre === 'TimbreFiscalDigital' && !nodos.Timbre) nodos.Timbre = attrs;
    if (nombre === 'ImpuestosLocales' && !nodos.Locales) nodos.Locales = attrs; // complemento implocal (p. ej. ISH, 5 al millar)
    if (!m[4]) pila.push(nombre);
  }
  if (!raiz || raiz.nombre !== 'Comprobante') throw new Error('El archivo no es un CFDI (factura electrónica del SAT).');
  const ns = Object.keys(raiz.attrs).filter(k => /^xmlns(:|$)/.test(k)).map(k => raiz.attrs[k]);
  if (ns.indexOf(NS_CFDI_40) === -1) {
    if (ns.indexOf(NS_CFDI_33) !== -1) throw new Error('Es un CFDI 3.3, que ya no es vigente: pide al proveedor la versión 4.0.');
    throw new Error('El archivo no es un CFDI 4.0.');
  }
  const c = raiz.attrs, em = nodos.Emisor, rc = nodos.Receptor, imp = nodos.Impuestos || {}, tfd = nodos.Timbre, loc = nodos.Locales || {};
  if (!em || !rc) throw new Error('El CFDI está incompleto: le falta el emisor o el receptor.');
  if (!tfd || !tfd.UUID) throw new Error('El CFDI no está timbrado por el SAT (no trae folio fiscal UUID).');
  const importe = (v, campo, obligatorio) => {
    if (v === undefined || v === '') {
      if (obligatorio) throw new Error('El CFDI no trae ' + campo + '.');
      return 0;
    }
    const n = Number(v);
    if (!isFinite(n) || n < 0) throw new Error('El ' + campo + ' del CFDI no es válido.');
    return redondear(n);
  };
  const fecha = String(c.Fecha || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('El CFDI no trae una fecha de emisión válida.');
  const serie = String(c.Serie || '').trim(), folio = String(c.Folio || '').trim();
  // Impuestos del comprobante más los locales (complemento implocal), que el SAT suma al total aparte
  const trasladados = redondear(importe(imp.TotalImpuestosTrasladados, 'total de impuestos trasladados', false) +
    importe(loc.TotaldeTraslados, 'total de impuestos locales trasladados', false));
  const retenidos = redondear(importe(imp.TotalImpuestosRetenidos, 'total de impuestos retenidos', false) +
    importe(loc.TotaldeRetenciones, 'total de impuestos locales retenidos', false));
  const subtotal = importe(c.SubTotal, 'subtotal', true), descuento = importe(c.Descuento, 'descuento', false);
  const total = importe(c.Total, 'total', true);
  if (descuento > subtotal) throw new Error('El CFDI no es válido: el descuento es mayor que el subtotal.');
  const esperado = redondear(subtotal - descuento + trasladados - retenidos);
  if (Math.abs(aCentavos(total) - aCentavos(esperado)) > aCentavos(TOLERANCIA_CFDI)) {
    throw new Error('El CFDI no cuadra: su total (' + formatoMoneda(total) + ') no es subtotal − descuento + impuestos trasladados − ' +
      'retenidos (' + formatoMoneda(esperado) + '). Pide al proveedor el XML correcto.');
  }
  return {
    tipo: FPR_CFDI, version: String(c.Version || ''), tipoComprobante: String(c.TipoDeComprobante || '').toUpperCase(),
    fecha: fecha, serie: serie, folio: folio, serieFolio: [serie, folio].filter(Boolean).join('-'),
    moneda: String(c.Moneda || '').toUpperCase(), subtotal: subtotal, descuento: descuento, total: total,
    metodoPago: String(c.MetodoPago || '').toUpperCase(), formaPago: String(c.FormaPago || ''),
    usoCfdi: String(rc.UsoCFDI || ''),
    emisor: { rfc: String(em.Rfc || '').toUpperCase().trim(), nombre: String(em.Nombre || '').trim() },
    receptor: { rfc: String(rc.Rfc || '').toUpperCase().trim(), nombre: String(rc.Nombre || '').trim() },
    trasladados: trasladados, retenidos: retenidos,
    uuid: String(tfd.UUID).toUpperCase().trim(), fechaTimbrado: String(tfd.FechaTimbrado || ''),
  };
}

/** ¿El archivo parece XML? Por sus primeros bytes (sin BOM ni espacios: "<"). Máximo MAX_XML_CFDI. */
function validarXml(bytes) {
  if (!bytes || !bytes.length) throw new Error('Adjunta el XML de la factura.');
  if (bytes.length > MAX_XML_CFDI) throw new Error('El XML pesa más de 2 MB: no parece un CFDI.');
  let i = 0;
  const b = k => (bytes[k] || 0) & 0xFF;
  if (b(0) === 0xEF && b(1) === 0xBB && b(2) === 0xBF) i = 3;
  while (i < bytes.length && [0x20, 0x09, 0x0A, 0x0D].indexOf(b(i)) !== -1) i++;
  if (b(i) !== 0x3C) throw new Error('El archivo no es un XML. Adjunta el XML del CFDI (no el PDF).');
  return true;
}

/** Bytes (con o sin signo, como los da Apps Script) → texto UTF-8. Un byte inválido queda como "�". */
function textoUtf8(bytes) {
  const n = bytes ? bytes.length : 0, b = k => (bytes[k] || 0) & 0xFF, sigue = k => (b(k) & 0xC0) === 0x80;
  const partes = [];
  let trozo = [], i = 0;
  while (i < n) {
    const c = b(i);
    let cp = 0xFFFD, largo = 1;
    if (c < 0x80) { cp = c; }
    else if (c >= 0xC2 && c < 0xE0 && i + 1 < n && sigue(i + 1)) { cp = ((c & 0x1F) << 6) | (b(i + 1) & 0x3F); largo = 2; }
    else if (c >= 0xE0 && c < 0xF0 && i + 2 < n && sigue(i + 1) && sigue(i + 2)) {
      cp = ((c & 0x0F) << 12) | ((b(i + 1) & 0x3F) << 6) | (b(i + 2) & 0x3F); largo = 3;
    } else if (c >= 0xF0 && c < 0xF5 && i + 3 < n && sigue(i + 1) && sigue(i + 2) && sigue(i + 3)) {
      cp = ((c & 0x07) << 18) | ((b(i + 1) & 0x3F) << 12) | ((b(i + 2) & 0x3F) << 6) | (b(i + 3) & 0x3F); largo = 4;
      if (cp > 0x10FFFF || cp < 0x10000) { cp = 0xFFFD; largo = 1; }
    }
    trozo.push(String.fromCodePoint(cp));
    if (trozo.length >= 8192) { partes.push(trozo.join('')); trozo = []; }
    i += largo;
  }
  partes.push(trozo.join(''));
  return partes.join('');
}

/** "FPR-2026-0001 — Proveedor — A-1234.xml", sin caracteres que Drive o los sistemas de archivos rechazan. */
function nombreArchivoFactura(folio, proveedor, serieFolio, ext) {
  const limpio = s => String(s || '').replace(/[\/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return [folio, limpio(proveedor).slice(0, 60), limpio(serieFolio).slice(0, 40)].filter(Boolean).join(' — ') + '.' + ext;
}

/**
 * Facturación de una orden: cuántas facturas vigentes, su total (con IVA y retenciones), su neto (sin IVA) y si ya la cubren
 * (neto ≥ subtotal − TOLERANCIA_FACTURA). Solo una orden facturada completa se puede pagar por el total de sus facturas: con
 * una entrega aún sin facturar, ese total es menor que lo que se debe (y cada orden tiene un solo pago).
 */
function facturacionDeOrden(facturas, orden) {
  const f = String((orden && orden.folio) || '').toUpperCase();
  const vig = (facturas || []).filter(x => x.estado === FPR_VIGENTE && String(x.ocFolio).toUpperCase() === f);
  const total = vig.reduce((s, x) => s + aCentavos(x.total), 0), neto = vig.reduce((s, x) => s + aCentavos(netoFactura(x)), 0);
  return { facturas: vig.length, total: total / 100, neto: neto / 100,
    completa: vig.length > 0 && neto >= aCentavos(orden && orden.subtotal) - aCentavos(TOLERANCIA_FACTURA) };
}

/** Suma (en la moneda de la orden) de los totales de las facturas Vigentes de una orden. */
function totalFacturadoDeOrden(facturas, ocFolio) {
  const f = String(ocFolio || '').toUpperCase();
  return (facturas || []).filter(x => x.estado === FPR_VIGENTE && String(x.ocFolio).toUpperCase() === f)
    .reduce((s, x) => s + aCentavos(x.total), 0) / 100;
}

/**
 * Factura de un proveedor extranjero (sin CFDI), capturada a mano: {numero, fecha, moneda, subtotal, impuestos}. El total
 * lo calcula el servidor (subtotal + impuestos). Devuelve la misma forma que leerCfdi, con tipo 'Extranjera' y sin UUID.
 */
function normalizarFacturaExtranjera(p, hoy) {
  const d = p || {};
  const numero = String(d.numero == null ? '' : d.numero).trim().replace(/\s+/g, ' ');
  if (!numero) throw new Error('Escribe el número de la factura del proveedor.');
  if (numero.length > 40) throw new Error('El número de la factura debe tener máximo 40 caracteres.');
  const fecha = validarFechaIso(d.fecha, hoy, 'La fecha de la factura');
  const monto = (v, campo, obligatorio) => {
    if (v === '' || v == null) {
      if (obligatorio) throw new Error('Captura ' + campo + ' de la factura.');
      return 0;
    }
    const n = Number(v);
    if (!isFinite(n) || n < 0) throw new Error('El valor de ' + campo + ' no es válido.');
    return redondear(n);
  };
  const subtotal = monto(d.subtotal, 'el subtotal', true);
  if (subtotal <= 0) throw new Error('El subtotal de la factura debe ser mayor a 0.');
  const impuestos = monto(d.impuestos, 'los impuestos', false);
  return {
    tipo: FPR_EXTRANJERA, version: '', tipoComprobante: '', fecha: fecha, serie: '', folio: numero, serieFolio: numero,
    moneda: String(d.moneda || '').trim().toUpperCase(), subtotal: subtotal, descuento: 0,
    total: redondear(subtotal + impuestos), metodoPago: '', formaPago: '', usoCfdi: '',
    emisor: { rfc: '', nombre: '' }, receptor: { rfc: '', nombre: '' }, trasladados: impuestos, retenidos: 0,
    uuid: '', fechaTimbrado: '',
  };
}

/** Subtotal neto de una factura (sin IVA, menos descuento): lo que se compara contra el subtotal de la orden. */
function netoFactura(f) {
  return Math.max(0, redondear((Number(f && f.subtotal) || 0) - (Number(f && f.descuento) || 0)));
}

/**
 * Revisa una factura (de leerCfdi o normalizarFacturaExtranjera) contra su orden antes de registrarla.
 * orden = {folio, estado, moneda, subtotal, total, rfc, proveedorId}; ctx = {rfcHelgen, hoy, facturas: todas las ya registradas
 * [{folio, tipo, uuid, serieFolio, rfcEmisor, proveedorId, ocFolio, estado, subtotal, descuento, total}]}. Lo facturado no
 * pasa ni el subtotal de la orden (sin IVA) ni su total (con impuestos), con tolerancia de TOLERANCIA_FACTURA.
 * Devuelve {neto, facturado (incluida esta), actualizarRfc (la orden no tenía RFC y el CFDI sí lo trae)}.
 */
function validarFacturaProveedor(f, orden, ctx) {
  const o = orden || {}, x = ctx || {};
  const vigentes = (x.facturas || []).filter(v => v.estado === FPR_VIGENTE);
  const rfcOrden = String(o.rfc || '').replace(/[\s-]/g, '').toUpperCase();
  const ordenConRfc = RFC_VALIDO.test(rfcOrden) && RFC_GENERICOS.indexOf(rfcOrden) === -1;
  // Sin RFC en la orden, el primer CFDI vigente de la orden fija el emisor: las siguientes facturas deben ser del mismo RFC
  const deLaOrden = vigentes.filter(v => String(v.ocFolio).toUpperCase() === String(o.folio).toUpperCase());
  const cfdiPrevio = ordenConRfc ? null : deLaOrden.find(v => v.tipo === FPR_CFDI && v.rfcEmisor);
  if (o.estado === OC_CANCELADA) throw new Error('La orden ' + o.folio + ' está cancelada: no admite facturas.');
  validarFechaIso(f.fecha, x.hoy, 'La fecha de emisión de la factura');
  if (!(f.subtotal > 0) || !(f.total > 0)) throw new Error('La factura debe tener subtotal y total mayores a 0.');
  if (f.moneda !== o.moneda) {
    throw new Error('La factura es en ' + (f.moneda || '(sin moneda)') + ' y la orden ' + o.folio + ' en ' + o.moneda +
      ': deben coincidir.');
  }
  let actualizarRfc = false;
  if (f.tipo === FPR_CFDI) {
    if (f.version !== '4.0') throw new Error('El CFDI debe ser versión 4.0.');
    if (f.tipoComprobante === 'E') throw new Error('Es una nota de crédito (CFDI tipo E): las notas de crédito llegan en una fase posterior.');
    if (f.tipoComprobante === 'P') throw new Error('Es un complemento de pago (REP, CFDI tipo P): se registrará en una fase posterior.');
    if (f.tipoComprobante !== 'I') throw new Error('El CFDI no es una factura de ingreso (tipo I).');
    if (METODOS_CFDI.indexOf(f.metodoPago) === -1) throw new Error('El método de pago del CFDI debe ser PUE o PPD.');
    if (!UUID_CFDI.test(f.uuid)) throw new Error('El folio fiscal (UUID) del CFDI no es válido.');
    const rfcHelgen = String(x.rfcHelgen || '').toUpperCase().trim();
    if (f.receptor.rfc !== rfcHelgen) {
      throw new Error('La factura está a nombre del RFC ' + f.receptor.rfc + ', no de Helgen (' + rfcHelgen + ').');
    }
    if (ordenConRfc && f.emisor.rfc !== rfcOrden) {
      throw new Error('La factura la emitió ' + (f.emisor.nombre || 'otro proveedor') + ' (' + f.emisor.rfc + '), pero la orden ' +
        o.folio + ' es de RFC ' + rfcOrden + '.');
    }
    if (cfdiPrevio && f.emisor.rfc !== String(cfdiPrevio.rfcEmisor).toUpperCase()) {
      throw new Error('La factura la emitió ' + (f.emisor.nombre || 'otro proveedor') + ' (' + f.emisor.rfc + '), pero la orden ' +
        o.folio + ' ya tiene facturas de RFC ' + String(cfdiPrevio.rfcEmisor).toUpperCase() + ' (' + cfdiPrevio.folio + ').');
    }
    actualizarRfc = !ordenConRfc && !cfdiPrevio && RFC_VALIDO.test(f.emisor.rfc);
    const repetida = vigentes.find(v => String(v.uuid).toUpperCase() === f.uuid);
    if (repetida) throw new Error('La factura con folio fiscal ' + f.uuid + ' ya está registrada (' + repetida.folio + ').');
  } else if (f.tipo === FPR_EXTRANJERA) {
    if (ordenConRfc) {
      throw new Error('El proveedor de la orden ' + o.folio + ' tiene RFC mexicano (' + rfcOrden + '): registra su factura con el XML (CFDI).');
    }
    if (cfdiPrevio) {
      throw new Error('La orden ' + o.folio + ' ya tiene facturas CFDI de RFC ' + String(cfdiPrevio.rfcEmisor).toUpperCase() + ' (' +
        cfdiPrevio.folio + '): registra esta también con el XML.');
    }
    const num = textoNormal(f.serieFolio);
    const repetida = vigentes.find(v => v.tipo === FPR_EXTRANJERA && v.proveedorId === o.proveedorId && textoNormal(v.serieFolio) === num);
    if (repetida) throw new Error('La factura ' + f.serieFolio + ' de este proveedor ya está registrada (' + repetida.folio + ').');
  } else {
    throw new Error('Tipo de factura no válido.');
  }
  const neto = netoFactura(f);
  const antes = deLaOrden
    .reduce((s, v) => s + aCentavos(netoFactura(v)), 0);
  const despues = antes + aCentavos(neto);
  if (despues > aCentavos(o.subtotal) + aCentavos(TOLERANCIA_FACTURA)) {
    throw new Error('Con esta factura, lo facturado de la orden ' + o.folio + ' (' + formatoMoneda(despues / 100) + ' ' + o.moneda +
      ' sin IVA) supera su subtotal (' + formatoMoneda(o.subtotal) + ' ' + o.moneda + ').');
  }
  // Con impuestos: el total facturado tampoco puede pasar el total de la orden (IVA distinto al de la orden, impuestos mal
  // capturados). Con retenciones queda abajo, que sí se acepta.
  const totalDespues = deLaOrden.reduce((s, v) => s + aCentavos(Number(v.total) || 0), 0) + aCentavos(f.total);
  if (totalDespues > aCentavos(Number(o.total) || 0) + aCentavos(TOLERANCIA_FACTURA)) {
    throw new Error('Con esta factura, el total facturado de la orden ' + o.folio + ' (' + formatoMoneda(totalDespues / 100) + ' ' +
      o.moneda + ') supera el total de la orden (' + formatoMoneda(o.total) + ' ' + o.moneda + '): revisa el IVA y los impuestos ' +
      'de la factura contra los de la orden.');
  }
  return { neto: neto, facturado: redondear(despues / 100), actualizarRfc: actualizarRfc };
}

/**
 * Cuentas por pagar. d = {facturas, ordenes, pagos, hoy}. facturas = [{folio, tipo, serieFolio, ocFolio, proyectoFolio,
 * moneda, subtotal, descuento, total, fechaEmision, fechaVencimiento, metodoPago, estado, nombreEmisor}], ordenes = [{folio,
 * fecha, proyectoFolio, proveedor, moneda, subtotal, estado}], pagos = [{ocFolio, estado}] (pagos a proveedores).
 * Devuelve {hoy, rangos, totales (uno por moneda; nunca suma monedas), abiertas (por vencimiento), faltantes (órdenes
 * vigentes con menos facturado que su subtotal; pagadas primero), repPendientes (PPD en órdenes pagadas: falta su REP)}.
 */
function antiguedadCxp(d) {
  const hoy = d.hoy;
  const may = s => String(s || '').toUpperCase();
  const ordenes = {};
  (d.ordenes || []).forEach(o => { ordenes[may(o.folio)] = o; });
  const pagadas = {};
  (d.pagos || []).forEach(p => { if (p.estado === 'Vigente') pagadas[may(p.ocFolio)] = true; });
  const vigentes = (d.facturas || []).filter(f => f.estado === FPR_VIGENTE);

  const abiertas = [], totales = {};
  vigentes.forEach(f => {
    const o = ordenes[may(f.ocFolio)];
    if (!o || o.estado === OC_CANCELADA || pagadas[may(f.ocFolio)]) return;
    const dias = diasEntre(f.fechaVencimiento, hoy);
    const rango = RANGOS_CXP.find(r => dias <= r.hasta);
    abiertas.push({ folio: f.folio, tipo: f.tipo, serieFolio: f.serieFolio, ocFolio: o.folio, proyectoFolio: o.proyectoFolio,
      proveedor: o.proveedor || f.nombreEmisor || '', fechaEmision: f.fechaEmision, fechaVencimiento: f.fechaVencimiento,
      dias: dias, rango: rango.clave, moneda: f.moneda, total: redondear(f.total) });
    const t = totales[f.moneda] || (totales[f.moneda] = { moneda: f.moneda, facturas: 0, centavos: {}, total: 0 });
    t.facturas++;
    t.centavos[rango.clave] = (t.centavos[rango.clave] || 0) + aCentavos(f.total);
  });
  const listaTotales = Object.keys(totales).sort((a, b) => (a === 'MXN' ? -1 : b === 'MXN' ? 1 : a < b ? -1 : 1)).map(m => {
    const t = totales[m], r = { moneda: m, facturas: t.facturas };
    let suma = 0, vencido = 0;
    RANGOS_CXP.forEach(g => {
      const c = t.centavos[g.clave] || 0;
      r[g.clave] = c / 100; suma += c;
      if (g.clave !== 'porVencer') vencido += c;
    });
    r.vencido = vencido / 100; r.total = suma / 100;
    return r;
  });
  abiertas.sort((a, b) => a.fechaVencimiento < b.fechaVencimiento ? -1 : a.fechaVencimiento > b.fechaVencimiento ? 1 :
    (a.folio < b.folio ? -1 : 1));

  const facturadoPorOrden = {};
  vigentes.forEach(f => { const k = may(f.ocFolio); facturadoPorOrden[k] = (facturadoPorOrden[k] || 0) + aCentavos(netoFactura(f)); });
  const faltantes = (d.ordenes || [])
    .filter(o => [OC_EMITIDA, OC_PAGADA, OC_RECIBIDA].indexOf(o.estado) !== -1)
    .map(o => {
      const facturado = facturadoPorOrden[may(o.folio)] || 0, falta = aCentavos(o.subtotal) - facturado;
      return { folio: o.folio, fecha: o.fecha, proyectoFolio: o.proyectoFolio, proveedor: o.proveedor, estado: o.estado,
        pagada: !!pagadas[may(o.folio)], moneda: o.moneda, subtotal: redondear(o.subtotal), facturado: facturado / 100,
        faltante: falta / 100, centavos: falta };
    })
    .filter(x => x.centavos > aCentavos(TOLERANCIA_FACTURA))
    .sort((a, b) => (a.pagada !== b.pagada ? (a.pagada ? -1 : 1) : String(a.fecha) < String(b.fecha) ? -1 : 1))
    .map(x => { delete x.centavos; return x; });

  const rep = vigentes.filter(f => f.tipo === FPR_CFDI && f.metodoPago === 'PPD' && pagadas[may(f.ocFolio)]).map(f => f.folio);
  return { hoy: hoy, rangos: RANGOS_CXP.map(r => ({ clave: r.clave, etiqueta: r.etiqueta })), totales: listaTotales,
    abiertas: abiertas, faltantes: faltantes, repPendientes: { n: rep.length, folios: rep } };
}

// ---- Búsqueda en catálogos del SAT (c_ClaveProdServ / c_ClaveUnidad) ----

const PALABRAS_VACIAS_SAT = ('de del la las el los y o u a al en con sin para por un una unos unas que se su sus ' +
  'tipo marca modelo incluye incluido kw w v a mm cm m mts pza pzas').split(' ');

/** Texto a palabras base: sin acentos, minúsculas, sin plurales simples, sin palabras vacías ni números. */
function palabrasSat(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ').split(' ')
    .filter(w => w.length > 1 && !/^\d+$/.test(w) && PALABRAS_VACIAS_SAT.indexOf(w) === -1)
    .map(w => w.length > 4 && /[^aeiou]es$/.test(w) ? w.slice(0, -2) : (w.length > 3 && /s$/.test(w) ? w.slice(0, -1) : w))
    .map(w => w.length > 5 && /[aeo]$/.test(w) ? w.slice(0, -1) : w); // eléctrica/eléctrico -> electric
}

/**
 * Términos de Helgen -> palabras que usa el catálogo del SAT (ya en forma base de palabrasSat).
 * Ampliar aquí cuando una búsqueda no encuentre lo esperado.
 */
const SINONIMOS_SAT = {
  panel: ['fotovoltaic', 'generador', 'kit'], solar: ['fotovoltaic', 'energia'], fotovoltaic: ['solar'],
  auto: ['vehicul', 'automovil'], carro: ['vehicul'], coche: ['vehicul'], automovil: ['vehicul'],
  cargador: ['carga', 'cargado'], gps: ['localizacion', 'navegacion', 'posicionamient', 'satelital'],
  rastreo: ['localizacion', 'navegacion', 'seguimient'], monitoreo: ['vigilancia', 'seguimient'],
  instalacion: ['montaje'], reparacion: ['mantenimient'], mantenimient: ['reparacion'],
  patio: ['exterior', 'terreno'],
};

/** Palabras que indican que se busca un servicio (claves del SAT de los segmentos 70 a 95). */
const PALABRAS_SERVICIO_SAT = ['servicio', 'instalacion', 'mantenimient', 'reparacion', 'limpieza', 'mano', 'obra',
  'renta', 'arrendamient', 'consultoria', 'capacitacion', 'monitoreo', 'rastreo', 'asesoria', 'diseño', 'proyecto'];

/** Sinónimos con la llave en forma base de palabrasSat ("rastreo" -> "rastre"), como llegan las consultas. */
function sinonimosSat_() {
  const r = {};
  Object.keys(SINONIMOS_SAT).forEach(k => {
    const b = palabrasSat(k)[0] || k;
    r[b] = (r[b] || []).concat(SINONIMOS_SAT[k]);
  });
  return r;
}

/** true si alguna palabra (ya en forma base) indica un servicio. */
function esServicioSat_(q) {
  const servicio = PALABRAS_SERVICIO_SAT.map(w => palabrasSat(w)[0] || w);
  return q.some(w => servicio.indexOf(w) !== -1);
}

/**
 * Claves del SAT que más se parecen a la descripción. filas = [[clave, descripción], ...].
 * Puntaje: palabras de la consulta presentes en la descripción, pesadas por lo poco comunes que son
 * (una palabra rara como "fotovoltaica" vale más que "servicio"), y prefiere descripciones cortas y que
 * cubren toda la consulta. Devuelve hasta n resultados [{clave, descripcion, puntaje}].
 */
function buscarClavesSat(consulta, filas, n) {
  const q = palabrasSat(consulta).filter((w, i, a) => a.indexOf(w) === i);
  if (!q.length) return [];
  // Coincide si la palabra del SAT empieza con la buscada ("cargador" ~ "cargadores"); al revés solo con
  // palabras largas, para no confundir "foto" con "fotovoltaica"
  const igual = (w, p) => p === w || (w.length >= 4 && p.indexOf(w) === 0) || (p.length >= 6 && w.indexOf(p) === 0);
  const sinonimos = sinonimosSat_();
  const opciones = q.map(w => [w].concat(sinonimos[w] || []));
  const esServicio = esServicioSat_(q);

  const candidatos = [];
  const df = q.map(() => 0);
  (filas || []).forEach(r => {
    const clave = String(r[0] || '').trim();
    if (!clave || clave === '01010101') return; // "No existe en el catálogo"
    const palabras = palabrasSat(r[1]);
    const hits = opciones.map(ops => palabras.some(p => ops.some(w => igual(w, p))));
    hits.forEach((h, i) => { if (h) df[i]++; });
    if (hits.some(Boolean)) candidatos.push({ clave: clave, descripcion: String(r[1]), hits: hits, largo: palabras.length });
  });

  const total = (filas || []).length || 1;
  const peso = df.map(d => Math.log(1 + total / (1 + d)));
  const pesoTotal = peso.reduce((a, b) => a + b, 0);
  return candidatos.map(c => {
    const cubre = c.hits.reduce((s, h, i) => s + (h ? peso[i] : 0), 0) / pesoTotal; // 0..1
    const todas = c.hits.every(Boolean) ? 0.15 : 0;
    const extra = Math.max(0, c.largo - c.hits.filter(Boolean).length);       // palabras que sobran
    const segmento = Number(c.clave.slice(0, 2));
    const tipo = esServicio ? (segmento >= 70 ? 1.25 : 0.85) : (segmento >= 70 ? 0.9 : 1); // servicio vs. producto
    return { clave: c.clave, descripcion: c.descripcion, puntaje: redondear(tipo * (cubre + todas) / (1 + 0.08 * extra)) };
  })
    .sort((a, b) => b.puntaje - a.puntaje || a.descripcion.length - b.descripcion.length)
    .slice(0, n || 5);
}

/**
 * Candidatos para que la IA elija (hasta n, sin repetir). Para servicios, además de la búsqueda completa toma
 * los mejores servicios (segmentos 70 a 95) por cada palabra, porque el SAT casi nunca repite la frase entera
 * ("Limpieza de patios" -> "Mantenimiento de terrenos exteriores").
 */
function candidatosSat(consulta, filas, n) {
  n = n || 40;
  const lista = [], vistos = {};
  const agregar = arr => arr.forEach(o => {
    if (!vistos[o.clave] && lista.length < n) { vistos[o.clave] = true; lista.push(o); }
  });
  const q = palabrasSat(consulta).filter((w, i, a) => a.indexOf(w) === i);
  if (!esServicioSat_(q)) return buscarClavesSat(consulta, filas, n);
  agregar(buscarClavesSat(consulta, filas, Math.ceil(n / 2)));
  const servicios = (filas || []).filter(r => Number(String(r[0]).slice(0, 2)) >= 70);
  const palabras = q.filter(w => ['servici', 'mano', 'obra'].indexOf(w) === -1);
  const porPalabra = Math.max(3, Math.ceil(n / 2 / Math.max(1, palabras.length)));
  palabras.forEach(w => agregar(buscarClavesSat(w, servicios, porPalabra)));
  agregar(buscarClavesSat(consulta, filas, n)); // rellena si faltan
  return lista;
}

const MODELO_IA_SAT = 'claude-haiku-5-5';

const INSTRUCCIONES_IA_SAT =
  'Ayudas a Helgen, empresa mexicana (energía solar, cargadores para autos eléctricos, rastreo GPS, instalación ' +
  'y mantenimiento, entre otros), a elegir la clave de producto o servicio del SAT (c_ClaveProdServ, CFDI 4.0) ' +
  'para un concepto de cotización. Elige solo de la lista de candidatos que se te da, hasta 5, de la más a la ' +
  'menos adecuada. Si el concepto es un servicio (instalación, mantenimiento, limpieza, renta, monitoreo, etc.) ' +
  'prefiere claves de servicios (empiezan con 70 a 95); si es un bien, claves de productos. Prefiere la clave ' +
  'más específica que describa bien el concepto. Para cada una da una razón breve (máximo 15 palabras, español ' +
  'de México). Si ninguna encaja bien, devuelve las más cercanas y dilo en la razón.';

/** Cuerpo de la petición a la API de Claude (Messages) para ordenar candidatos SAT. */
function solicitudIaSat(consulta, candidatos) {
  return {
    model: MODELO_IA_SAT,
    max_tokens: 4000,
    system: INSTRUCCIONES_IA_SAT,
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            opciones: {
              type: 'array',
              items: {
                type: 'object',
                properties: { clave: { type: 'string' }, razon: { type: 'string' } },
                required: ['clave', 'razon'], additionalProperties: false,
              },
            },
          },
          required: ['opciones'], additionalProperties: false,
        },
      },
    },
    messages: [{
      role: 'user',
      content: 'Concepto: ' + String(consulta || '').trim() + '\n\nCandidatos (clave | descripción):\n' +
        candidatos.map(c => c.clave + ' | ' + c.descripcion).join('\n'),
    }],
  };
}

/**
 * Lee la respuesta JSON de la API y devuelve [{clave, descripcion, razon, puntaje}] (máximo 5).
 * Solo acepta claves que estaban entre los candidatos; lanza error si la respuesta no sirve.
 */
function leerRespuestaIaSat(cuerpo, candidatos) {
  const r = typeof cuerpo === 'string' ? JSON.parse(cuerpo) : cuerpo;
  if (!r || r.stop_reason !== 'end_turn') throw new Error('Respuesta incompleta de la IA (' + (r && r.stop_reason) + ').');
  const texto = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const opciones = (JSON.parse(texto).opciones || []);
  const porClave = {};
  candidatos.forEach(c => { porClave[c.clave] = c; });
  const lista = [];
  opciones.forEach(o => {
    const clave = String((o && o.clave) || '').replace(/\D/g, '').padStart(8, '0');
    const c = porClave[clave];
    if (c && lista.length < 5 && !lista.some(x => x.clave === clave)) {
      lista.push({ clave: clave, descripcion: c.descripcion, razon: String(o.razon || '').trim().slice(0, 200),
        puntaje: c.puntaje });
    }
  });
  if (!lista.length) throw new Error('La IA no eligió ninguna clave de la lista.');
  return lista;
}

/** Valida y limpia un producto del catálogo. */
function normalizarProducto(p) {
  const clave = String((p && p.clave) || '').trim().toUpperCase();
  const descripcion = String((p && p.descripcion) || '').trim();
  const unidad = String((p && p.unidad) || '').trim().toUpperCase() || 'PZA';
  const precioTxt = p && p.precio;
  const precio = Number(precioTxt);
  if (!clave) throw new Error('La clave es obligatoria.');
  if (clave.length > 30) throw new Error('La clave debe tener máximo 30 caracteres.');
  if (!descripcion) throw new Error('La descripción es obligatoria.');
  if (precioTxt === '' || precioTxt == null || !isFinite(precio)) throw new Error('El precio unitario es obligatorio.');
  if (precio < 0) throw new Error('El precio unitario no puede ser negativo.');
  // SAT (opcionales): clave de 8 dígitos (se repone el cero inicial si Sheets lo quitó) y unidad
  const satTxt = String((p && p.claveSat) || '').replace(/\s/g, '');
  if (satTxt && !/^\d{7,8}$/.test(satTxt)) throw new Error('La clave SAT debe tener 8 dígitos.');
  const unidadSat = String((p && p.unidadSat) || '').trim().toUpperCase();
  if (unidadSat && !/^[A-Z0-9]{1,3}$/.test(unidadSat)) throw new Error('La unidad SAT debe ser una clave como H87, E48 o MTR.');
  return { clave: clave, descripcion: descripcion, unidad: unidad, precio: redondear(precio),
    claveSat: satTxt ? satTxt.padStart(8, '0') : '', unidadSat: unidadSat };
}

/** Posición de una clave en la lista (sin distinguir mayúsculas ni espacios); -1 si no está. */
function indiceDeClave(claves, clave) {
  const buscada = String(clave || '').trim().toUpperCase();
  if (!buscada) return -1;
  return (claves || []).findIndex(c => String(c || '').trim().toUpperCase() === buscada);
}

/** Renglones de Términos y Condiciones de la marca ('helgen' | 'energy'); siempre incluye la vigencia. */
function terminosParaPdf(cfg, marca) {
  const dias = Number(cfg.VIGENCIA_DIAS) || 15;
  const clave = marca === 'energy' ? 'TERMINOS_ENERGY' : 'TERMINOS_HELGEN';
  const lineas = String(cfg[clave] || '').split('\n').map(t => t.trim()).filter(Boolean);
  if (!lineas.some(t => /vigen/i.test(t))) {
    lineas.push(TERMINO_VIGENCIA.replace('15 días', dias + ' días'));
  }
  return lineas;
}

/** Evita que Sheets interprete texto del usuario como fórmula ("+52 ...", "=...", "-..."). */
function textoCelda(s) {
  const v = String(s == null ? '' : s);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

/**
 * Revisa los datos (claims) de un ID token de Google ya validado por firma: audiencia = nuestro Client ID,
 * emisor de Google, sin expirar, correo verificado y cuenta del dominio (hd). Devuelve {email, nombre, apellido}.
 */
function validarClaimsToken(claims, clientId, dominio, ahoraSeg) {
  const fallar = msg => { const err = new Error(msg); err.sesion = true; throw err; };
  const c = claims || {};
  if (c.aud !== clientId) fallar('La sesión no corresponde a esta aplicación. Vuelve a iniciar sesión.');
  if (c.iss !== 'accounts.google.com' && c.iss !== 'https://accounts.google.com') fallar('Sesión inválida. Vuelve a iniciar sesión.');
  if (!(Number(c.exp) > ahoraSeg)) fallar('Tu sesión expiró. Vuelve a iniciar sesión.');
  const email = String(c.email || '').toLowerCase();
  const verificado = c.email_verified === true || c.email_verified === 'true';
  // hd solo viene en cuentas de Google Workspace: una cuenta personal (@gmail.com) no lo trae
  if (c.hd !== dominio || !verificado || !email.endsWith('@' + dominio)) {
    fallar('Solo se permiten cuentas @' + dominio + '.');
  }
  let nombre = String(c.given_name || '').trim();
  let apellido = String(c.family_name || '').trim();
  if (!nombre && !apellido && c.name) {
    const partes = String(c.name).trim().split(/\s+/);
    nombre = partes.shift() || '';
    apellido = partes.join(' ');
  }
  return { email: email, nombre: nombre, apellido: apellido };
}

function formatoMoneda(n) {
  const [ent, dec] = redondear(n).toFixed(2).split('.');
  return '$' + ent.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + dec;
}

function escaparHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * 1234.5 -> "MIL DOSCIENTOS TREINTA Y CUATRO PESOS 50/100 M.N."
 * En USD: "MIL DOSCIENTOS TREINTA Y CUATRO DÓLARES 50/100 USD".
 */
function importeConLetra(n, moneda) {
  const UNI = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ',
    'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE',
    'VEINTIÚN', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
  const DEC = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const CEN = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS',
    'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

  function hasta999(x) {
    if (x === 0) return '';
    if (x === 100) return 'CIEN';
    const c = Math.floor(x / 100), r = x % 100;
    let s = CEN[c];
    if (r) {
      const t = r < 30 ? UNI[r] : DEC[Math.floor(r / 10)] + (r % 10 ? ' Y ' + UNI[r % 10] : '');
      s = (s ? s + ' ' : '') + t;
    }
    return s;
  }
  function entero(x) {
    if (x === 0) return 'CERO';
    const millones = Math.floor(x / 1e6), miles = Math.floor((x % 1e6) / 1000), resto = x % 1000;
    const partes = [];
    if (millones) partes.push(millones === 1 ? 'UN MILLÓN' : entero(millones) + ' MILLONES');
    if (miles) partes.push(miles === 1 ? 'MIL' : hasta999(miles) + ' MIL');
    if (resto) partes.push(hasta999(resto));
    return partes.join(' ');
  }

  const v = redondear(n);
  const ent = Math.floor(v);
  const cent = Math.round((v - ent) * 100);
  const base = entero(ent);
  const de = (ent >= 1e6 && ent % 1e6 === 0) ? ' DE' : '';
  const cts = String(cent).padStart(2, '0') + '/100';
  if (moneda === 'USD') return base + de + (ent === 1 ? ' DÓLAR ' : ' DÓLARES ') + cts + ' USD';
  return base + de + (ent === 1 ? ' PESO ' : ' PESOS ') + cts + ' M.N.';
}

/**
 * Arma el HTML que se convierte en PDF.
 * El conversor de Google NO soporta flex/grid y NO imprime colores de fondo (background):
 * todo se resuelve con texto azul, líneas y bordes; los fondos (bgcolor) son solo un extra opcional.
 */
function construirHtmlPdf(d, cfg, logoUrl) {
  const e = escaparHtml;
  // Brand Guidelines Helgen (Canva): primarios #2C3C5B / #51F3DA, secundario #0AC5A8
  const AZUL = '#2C3C5B', AQUA = '#51F3DA', TEAL = '#0AC5A8', CIELO = '#F2F4F7', GRIS = '#6B7280';

  const logo = logoUrl
    ? '<img src="' + logoUrl + '" style="height:44px;">'
    : '<div style="font-size:26px;font-weight:bold;color:' + AZUL + ';">Helgen</div>';

  const filas = d.items.map((it, i) =>
    '<tr' + (i % 2 ? ' bgcolor="' + CIELO + '"' : '') + '>' +
    '<td class="c">' + (i + 1) + '</td>' +
    '<td>' + e(it.clave) + '</td>' +
    '<td>' + e(it.descripcion).replace(/\n/g, '<br>') + '</td>' +
    '<td class="c">' + e(it.unidad) + '</td>' +
    '<td class="r">' + e(it.cantidad) + '</td>' +
    '<td class="r">' + formatoMoneda(it.precio) + '</td>' +
    '<td class="r">' + formatoMoneda(it.importe) + '</td></tr>').join('');

  const terminos = terminosParaPdf(cfg, d.marca).map(t => '<li>' + e(t) + '</li>').join('');

  const dato = (k, v) => v ? '<tr><td class="k">' + k + '</td><td>' + e(v) + '</td></tr>' : '';
  const docFila = (k, v, fuerte) =>
    '<tr><td style="padding:1px 10px 1px 0;color:' + GRIS + ';text-align:right;">' + k + '</td>' +
    '<td style="padding:1px 0;text-align:right;color:' + AZUL + ';' + (fuerte ? 'font-weight:bold;font-size:12px;' : '') + '">' + e(v) + '</td></tr>';

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#1F2937;margin:0;}' +
    'table{border-collapse:collapse;width:100%;}' +
    'td,th{padding:5px 6px;vertical-align:top;}' +
    '.c{text-align:center;}.r{text-align:right;white-space:nowrap;}' +
    '.k{color:' + GRIS + ';width:90px;}' +
    '.mod{font-size:11px;font-weight:bold;color:' + AZUL + ';border-bottom:2px solid ' + TEAL + ';padding:0 0 3px 0;margin:16px 0 6px 0;}' +
    '.conceptos th{color:' + AZUL + ';font-size:9px;text-transform:uppercase;text-align:left;' +
    'border-top:2px solid ' + AZUL + ';border-bottom:2px solid ' + AZUL + ';}' +
    '.conceptos td{border-bottom:1px solid #E5E7EB;}' +
    '.conceptos th.r{text-align:right;}.conceptos th.c{text-align:center;}' +
    '</style></head><body>' +

    // Encabezado: logo azul + datos del documento
    '<table><tr>' +
    '<td style="width:55%;padding:4px 0;vertical-align:middle;">' + logo + '</td>' +
    '<td style="width:45%;padding:0;text-align:right;vertical-align:middle;">' +
    '<table style="width:auto;margin-left:auto;">' +
    '<tr><td colspan="2" style="font-size:20px;font-weight:bold;letter-spacing:2px;color:' + AZUL + ';padding:0 0 3px;text-align:right;">COTIZACIÓN</td></tr>' +
    (d.marca === 'energy'
      ? '<tr><td colspan="2" style="padding:0 0 5px;text-align:right;">' +
        '<span style="color:' + AZUL + ';font-weight:bold;letter-spacing:1px;border:1.5px solid ' + TEAL + ';padding:2px 8px;">HELGEN ENERGY</span></td></tr>'
      : '') +
    docFila('Folio', d.folio, true) + docFila('Fecha', d.fecha) + docFila('Vigencia', d.vigencia) +
    (d.moneda === 'USD' ? docFila('Moneda', 'USD (dólares estadounidenses)', true) : '') +
    '</table></td></tr></table>' +
    '<div style="border-top:3px solid ' + AQUA + ';margin-top:8px;"></div>' +
    '<div style="padding:6px 0 0;color:#4B5563;line-height:1.5;">' +
    '<b style="color:' + AZUL + ';">' + e(cfg.EMPRESA_NOMBRE) + '</b> · RFC ' + e(cfg.EMPRESA_RFC) + '<br>' + e(cfg.EMPRESA_DIRECCION) + '<br>' +
    e(cfg.EMPRESA_TELEFONO) + ' · ' + e(cfg.EMPRESA_EMAIL) + ' · ' + e(cfg.EMPRESA_WEB) + '</div>' +

    // Módulo 1: Cliente
    '<div class="mod">1 · DATOS DEL CLIENTE</div>' +
    '<table><tr><td style="width:50%;padding:0;"><table>' +
    dato('Cliente', d.cliente.nombre) + dato('Empresa', d.cliente.empresa) + dato('RFC', d.cliente.rfc) +
    '</table></td><td style="width:50%;padding:0;"><table>' +
    dato('Correo', d.cliente.email) + dato('Teléfono', d.cliente.telefono) + dato('Dirección', d.cliente.direccion) +
    '</table></td></tr></table>' +

    // Módulo 2: Conceptos
    '<div class="mod">2 · CONCEPTOS</div>' +
    '<table class="conceptos"><tr>' +
    '<th class="c" style="width:22px;">#</th><th style="width:60px;">Clave</th><th>Descripción</th>' +
    '<th class="c" style="width:45px;">Unidad</th><th class="r" style="width:45px;">Cant.</th>' +
    (d.moneda === 'USD'
      ? '<th class="r" style="width:95px;">P. Unitario (USD)</th><th class="r" style="width:95px;">Importe (USD)</th></tr>'
      : '<th class="r" style="width:80px;">P. Unitario</th><th class="r" style="width:85px;">Importe</th></tr>') +
    filas + '</table>' +

    // Módulo 3: Totales
    '<div class="mod">3 · RESUMEN</div>' +
    '<table><tr>' +
    '<td style="width:58%;padding-left:0;">' +
    '<div style="color:' + GRIS + ';">Importe con letra</div>' +
    '<div style="font-weight:bold;color:' + AZUL + ';margin:2px 0 8px;">(' + importeConLetra(d.total, d.moneda) + ')</div>' +
    (d.notas ? '<div style="color:' + GRIS + ';">Notas</div><div>' + e(d.notas).replace(/\n/g, '<br>') + '</div>' : '') +
    '</td><td style="width:42%;padding-right:0;"><table>' +
    '<tr><td>Subtotal</td><td class="r">' + formatoMoneda(d.subtotal) + '</td></tr>' +
    '<tr><td>IVA (' + Math.round(d.ivaTasa * 100) + '%)</td><td class="r">' + formatoMoneda(d.iva) + '</td></tr>' +
    '<tr bgcolor="#E6FBF7" style="color:' + AZUL + ';font-weight:bold;font-size:14px;">' +
    '<td style="border-top:2px solid ' + AZUL + ';border-bottom:3px solid ' + AQUA + ';padding:7px 6px;">TOTAL ' + e(d.moneda || 'MXN') + '</td>' +
    '<td class="r" style="border-top:2px solid ' + AZUL + ';border-bottom:3px solid ' + AQUA + ';padding:7px 6px;">' + formatoMoneda(d.total) + '</td></tr>' +
    '</table></td></tr></table>' +

    // Términos
    '<table style="margin-top:18px;"><tr><td bgcolor="' + CIELO + '" style="border-left:3px solid ' + TEAL + ';padding:8px 10px;">' +
    '<div style="font-weight:bold;color:' + AZUL + ';margin-bottom:4px;">TÉRMINOS Y CONDICIONES</div>' +
    '<ul style="margin:0;padding-left:16px;line-height:1.5;">' + terminos + '</ul></td></tr></table>' +

    // Pie
    '<div style="margin-top:18px;border-top:1px solid #D1D5DB;padding:6px 0 0;color:' + GRIS + ';font-size:9px;">' +
    'Elaboró: ' + e(d.elaboro) + ' &nbsp;·&nbsp; ' + e(cfg.EMPRESA_EMAIL) + ' &nbsp;·&nbsp; ' + e(cfg.EMPRESA_TELEFONO) +
    '</div>' +
    '</body></html>';
}

/**
 * HTML del PDF de una orden de compra (mismas reglas que construirHtmlPdf: tablas, inline CSS, sin depender de fondos).
 * d = normalizarOrdenCompra(...) + {folio, fecha "dd/MM/yyyy", proveedor (con id), proyectoFolio, elaboro}.
 * Siempre con la razón social y los datos fiscales de Helgen (Config), también en proyectos de Helgen Energy.
 * El tipo de cambio y la línea de negocio son internos: no salen en el PDF.
 */
function construirHtmlOrdenCompra(d, cfg, logoUrl) {
  const e = escaparHtml;
  const AZUL = '#2C3C5B', AQUA = '#51F3DA', TEAL = '#0AC5A8', CIELO = '#F2F4F7', GRIS = '#6B7280';
  const usd = d.moneda === 'USD';

  const logo = logoUrl
    ? '<img src="' + logoUrl + '" style="height:44px;">'
    : '<div style="font-size:26px;font-weight:bold;color:' + AZUL + ';">Helgen</div>';

  const filas = d.renglones.map((it, i) =>
    '<tr' + (i % 2 ? ' bgcolor="' + CIELO + '"' : '') + '>' +
    '<td class="c">' + (i + 1) + '</td>' +
    '<td>' + e(it.clave) + '</td>' +
    '<td>' + e(it.descripcion).replace(/\n/g, '<br>') + '</td>' +
    '<td class="c">' + e(it.unidad) + '</td>' +
    '<td class="r">' + e(it.cantidad) + '</td>' +
    '<td class="r">' + formatoMoneda(it.costo) + '</td>' +
    '<td class="r">' + formatoMoneda(it.importe) + '</td></tr>').join('');

  const terminos = terminosOcParaPdf(cfg).map(t => '<li>' + e(t) + '</li>').join('');
  const p = d.proveedor || {};
  const dato = (k, v) => v ? '<tr><td class="k">' + k + '</td><td>' + e(v) + '</td></tr>' : '';
  const docFila = (k, v, fuerte) =>
    '<tr><td style="padding:1px 10px 1px 0;color:' + GRIS + ';text-align:right;">' + k + '</td>' +
    '<td style="padding:1px 0;text-align:right;color:' + AZUL + ';' + (fuerte ? 'font-weight:bold;font-size:12px;' : '') + '">' + e(v) + '</td></tr>';
  const fechaLarga = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso || ''); };

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#1F2937;margin:0;}' +
    'table{border-collapse:collapse;width:100%;}' +
    'td,th{padding:5px 6px;vertical-align:top;}' +
    '.c{text-align:center;}.r{text-align:right;white-space:nowrap;}' +
    '.k{color:' + GRIS + ';width:110px;}' +
    '.mod{font-size:11px;font-weight:bold;color:' + AZUL + ';border-bottom:2px solid ' + TEAL + ';padding:0 0 3px 0;margin:16px 0 6px 0;}' +
    '.conceptos th{color:' + AZUL + ';font-size:9px;text-transform:uppercase;text-align:left;' +
    'border-top:2px solid ' + AZUL + ';border-bottom:2px solid ' + AZUL + ';}' +
    '.conceptos td{border-bottom:1px solid #E5E7EB;}' +
    '.conceptos th.r{text-align:right;}.conceptos th.c{text-align:center;}' +
    '</style></head><body>' +

    // Encabezado: logo azul + datos del documento
    '<table><tr>' +
    '<td style="width:55%;padding:4px 0;vertical-align:middle;">' + logo + '</td>' +
    '<td style="width:45%;padding:0;text-align:right;vertical-align:middle;">' +
    '<table style="width:auto;margin-left:auto;">' +
    '<tr><td colspan="2" style="font-size:20px;font-weight:bold;letter-spacing:2px;color:' + AZUL + ';padding:0 0 3px;text-align:right;">ORDEN DE COMPRA</td></tr>' +
    docFila('Folio', d.folio, true) + docFila('Fecha', d.fecha) + docFila('Proyecto', d.proyectoFolio) +
    (d.reqFolio ? docFila('Requisición', d.reqFolio) : '') +
    (usd ? docFila('Moneda', 'USD (dólares estadounidenses)', true) : '') +
    '</table></td></tr></table>' +
    '<div style="border-top:3px solid ' + AQUA + ';margin-top:8px;"></div>' +
    '<div style="padding:6px 0 0;color:#4B5563;line-height:1.5;">' +
    '<b style="color:' + AZUL + ';">' + e(cfg.EMPRESA_NOMBRE) + '</b> · RFC ' + e(cfg.EMPRESA_RFC) + '<br>' + e(cfg.EMPRESA_DIRECCION) + '<br>' +
    e(cfg.EMPRESA_TELEFONO) + ' · ' + e(cfg.EMPRESA_EMAIL) + ' · ' + e(cfg.EMPRESA_WEB) + '</div>' +

    // Módulo 1: Proveedor y entrega
    '<div class="mod">1 · PROVEEDOR Y ENTREGA</div>' +
    '<table><tr><td style="width:50%;padding:0;"><table>' +
    dato('Proveedor', p.razonSocial) + dato('RFC', p.rfc) + dato('Contacto', p.contacto) + dato('Correo', p.correo) +
    dato('Teléfono', p.telefono) +
    '</table></td><td style="width:50%;padding:0;"><table>' +
    dato('Fecha de entrega', fechaLarga(d.fechaEntrega)) + dato('Lugar de entrega', d.lugarEntrega) +
    dato('Condiciones de pago', d.condicionesPago) +
    '</table></td></tr></table>' +

    // Módulo 2: Conceptos
    '<div class="mod">2 · CONCEPTOS</div>' +
    '<table class="conceptos"><tr>' +
    '<th class="c" style="width:22px;">#</th><th style="width:60px;">Clave</th><th>Descripción</th>' +
    '<th class="c" style="width:45px;">Unidad</th><th class="r" style="width:45px;">Cant.</th>' +
    (usd
      ? '<th class="r" style="width:95px;">Costo unit. (USD)</th><th class="r" style="width:95px;">Importe (USD)</th></tr>'
      : '<th class="r" style="width:85px;">Costo unit.</th><th class="r" style="width:85px;">Importe</th></tr>') +
    filas + '</table>' +

    // Módulo 3: Totales
    '<div class="mod">3 · RESUMEN</div>' +
    '<table><tr>' +
    '<td style="width:58%;padding-left:0;">' +
    '<div style="color:' + GRIS + ';">Importe con letra</div>' +
    '<div style="font-weight:bold;color:' + AZUL + ';margin:2px 0 8px;">(' + importeConLetra(d.total, d.moneda) + ')</div>' +
    (d.notas ? '<div style="color:' + GRIS + ';">Notas</div><div>' + e(d.notas).replace(/\n/g, '<br>') + '</div>' : '') +
    '</td><td style="width:42%;padding-right:0;"><table>' +
    '<tr><td>Subtotal</td><td class="r">' + formatoMoneda(d.subtotal) + '</td></tr>' +
    '<tr><td>IVA (' + Math.round(d.ivaTasa * 100) + '%)</td><td class="r">' + formatoMoneda(d.iva) + '</td></tr>' +
    '<tr bgcolor="#E6FBF7" style="color:' + AZUL + ';font-weight:bold;font-size:14px;">' +
    '<td style="border-top:2px solid ' + AZUL + ';border-bottom:3px solid ' + AQUA + ';padding:7px 6px;">TOTAL ' + e(d.moneda || 'MXN') + '</td>' +
    '<td class="r" style="border-top:2px solid ' + AZUL + ';border-bottom:3px solid ' + AQUA + ';padding:7px 6px;">' + formatoMoneda(d.total) + '</td></tr>' +
    '</table></td></tr></table>' +

    // Términos
    '<table style="margin-top:18px;"><tr><td bgcolor="' + CIELO + '" style="border-left:3px solid ' + TEAL + ';padding:8px 10px;">' +
    '<div style="font-weight:bold;color:' + AZUL + ';margin-bottom:4px;">TÉRMINOS</div>' +
    '<ul style="margin:0;padding-left:16px;line-height:1.5;">' + terminos + '</ul></td></tr></table>' +

    // Pie
    '<div style="margin-top:18px;border-top:1px solid #D1D5DB;padding:6px 0 0;color:' + GRIS + ';font-size:9px;">' +
    'Elaboró: ' + e(d.elaboro) + (d.autorizo ? ' &nbsp;·&nbsp; Autorizó: ' + e(d.autorizo) : '') +
    ' &nbsp;·&nbsp; ' + e(cfg.EMPRESA_EMAIL) + ' &nbsp;·&nbsp; ' + e(cfg.EMPRESA_TELEFONO) +
    '</div>' +
    '</body></html>';
}

// ---- Usuarios, roles y sitios (CAPRI, incremento 4; lógica pura) ----

/** Roles de CAPRI. superadmin = todos los demás (menos solo_requisicion) + Administración. */
const ROLES_CAPRI = ['ventas', 'requisicion', 'solo_requisicion', 'aprobaciones', 'compras', 'cobranza', 'desbloqueo', 'superadmin'];
const NOMBRES_ROLES = { ventas: 'Ventas', requisicion: 'Requisiciones', solo_requisicion: 'Solo requisiciones',
  aprobaciones: 'Aprobaciones', compras: 'Compras', cobranza: 'Cobranza', desbloqueo: 'Desbloqueo', superadmin: 'Super admin' };
/** Lo que un usuario puede entregar a otro por unas fechas (decisión de Leo, 28/10/2026). */
const ROLES_DELEGABLES = ['aprobaciones', 'compras'];
/** Roles de una cuenta @helgen.services (decisión de Leo, 28/10/2026: solo requisiciones por ahora). */
const ROLES_SERVICIOS = ['solo_requisicion'];
/** Con solo_requisicion solo quedan estos (Aprobaciones sí: quien aprueba puede ser una cuenta de solo requisiciones). */
const ROLES_CON_SOLO = ['solo_requisicion', 'requisicion', 'aprobaciones'];
/** Script Properties de antes → rol de CAPRI (mientras no exista el libro de Administración, y para migrar). */
const ROLES_DE_PROPIEDADES = { ROL_REQUISICION: 'requisicion', SOLO_REQUISICION: 'solo_requisicion', ROL_OPERACIONES: 'aprobaciones',
  ROL_COMPRAS: 'compras', ROL_COBRANZA: 'cobranza', ADMIN_DESBLOQUEO: 'desbloqueo' };

/** Correo de CAPRI en minúsculas (@helgen.tech o @helgen.services); '' si no lo es. */
function correoCapri(texto) {
  const c = String(texto == null ? '' : texto).trim().toLowerCase();
  const m = c.match(/^[a-z0-9._%+-]+@([a-z0-9.-]+)$/);
  return m && DOMINIOS_CAPRI.indexOf(m[1]) !== -1 ? c : '';
}

/** Correos de CAPRI de una lista ("a@helgen.tech, b@helgen.services"), sin repetir. */
function correosCapri(texto) {
  return String(texto || '').split(/[\s,;]+/).map(correoCapri).filter((c, i, a) => c && a.indexOf(c) === i);
}

const dominioDe = correo => String(correo || '').split('@')[1] || '';

const ordenarRoles_ = roles => ROLES_CAPRI.filter(r => roles.indexOf(r) !== -1);

/** Roles válidos de un texto o lista ("Compras, aprobaciones", ["compras"]); acepta la clave o el nombre, sin acentos. */
function rolesDeTexto(texto) {
  const partes = (Array.isArray(texto) ? texto : String(texto == null ? '' : texto).split(/[,;\n]+/)).map(s => textoNormal(s));
  return ordenarRoles_(ROLES_CAPRI.filter(r => partes.indexOf(textoNormal(r)) !== -1 ||
    partes.indexOf(textoNormal(r.replace('_', ' '))) !== -1 || partes.indexOf(textoNormal(NOMBRES_ROLES[r])) !== -1));
}

/**
 * Usuario para Permisos: correo de CAPRI, nombre, roles (≥ 1), sitio (código, opcional), activo, notas. @helgen.services:
 * solo Solo requisiciones y entra con código; Solo requisiciones solo se combina con Aprobaciones.
 */
function normalizarUsuario(p) {
  const x = p || {};
  const limpio = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
  const correo = correoCapri(x.correo);
  if (!correo) throw new Error('Escribe un correo @' + DOMINIO_HELGEN + ' o @' + DOMINIO_SERVICIOS + '.');
  const nombre = limpio(x.nombre).slice(0, 80);
  if (!nombre) throw new Error('Escribe el nombre de la persona.');
  const servicios = dominioDe(correo) === DOMINIO_SERVICIOS;
  let roles = rolesDeTexto(x.roles);
  if (servicios) {
    if (roles.some(r => ROLES_SERVICIOS.indexOf(r) === -1)) {
      throw new Error('Las cuentas @' + DOMINIO_SERVICIOS + ' por ahora solo pueden tener "Solo requisiciones".');
    }
    if (!roles.length) roles = ROLES_SERVICIOS.slice();
  }
  if (roles.indexOf('solo_requisicion') !== -1) {
    const fuera = roles.filter(r => ROLES_CON_SOLO.indexOf(r) === -1);
    if (fuera.length) throw new Error('"Solo requisiciones" no se combina con ' + fuera.map(r => NOMBRES_ROLES[r]).join(', ') + '.');
    roles = roles.filter(r => r !== 'requisicion'); // ya lo incluye
  }
  if (!roles.length) throw new Error('Elige al menos un rol.');
  const sitio = limpio(x.sitio).toUpperCase();
  if (sitio && !/^[A-Z]{3}$/.test(sitio)) throw new Error('El sitio es el código de 3 letras (VER, ZLO, ESE, LZC, QRO…).');
  const activo = !(x.activo === false || /^(no|false|0)$/i.test(String(x.activo == null ? '' : x.activo).trim()));
  return { correo: correo, nombre: nombre, metodo: servicios ? 'codigo' : 'google', roles: roles, sitio: sitio,
    activo: activo, notas: limpio(x.notas).slice(0, 200) };
}

/** Fila de Permisos (mismas columnas que HOJAS_ADMIN.Permisos). */
function filaDeUsuario(u, quien, cuando) {
  return [u.correo, u.nombre || '', u.metodo || (dominioDe(u.correo) === DOMINIO_SERVICIOS ? 'codigo' : 'google'),
    (u.roles || []).join(', '), u.sitio || '', u.activo === false ? 'No' : 'Sí', u.notas || '', quien || '', cuando || ''];
}

/** {correo: {correo, nombre, metodo, roles, sitio, activo, notas}} de las filas de Permisos (una vacía o inválida se ignora). */
function usuariosDesdeFilas(filas) {
  const m = {};
  (filas || []).forEach(r => {
    const correo = correoCapri(r[0]);
    if (!correo) return;
    m[correo] = { correo: correo, nombre: String(r[1] == null ? '' : r[1]).trim(),
      metodo: dominioDe(correo) === DOMINIO_SERVICIOS ? 'codigo' : 'google', roles: rolesDeTexto(r[3]),
      sitio: String(r[4] == null ? '' : r[4]).trim().toUpperCase(),
      activo: !/^(no|false|0|inactivo|baja)$/i.test(String(r[5] == null ? '' : r[5]).trim()),
      notas: String(r[6] == null ? '' : r[6]) };
  });
  return m;
}

/** Usuarios como los daban las Script Properties de antes (ROL_*): los mismos permisos que antes del incremento 4. */
function usuariosDesdePropiedades(props) {
  const m = {}, p = props || {};
  Object.keys(ROLES_DE_PROPIEDADES).forEach(prop => correosCapri(p[prop]).forEach(c => {
    m[c] = m[c] || { correo: c, nombre: '', metodo: dominioDe(c) === DOMINIO_SERVICIOS ? 'codigo' : 'google', roles: [],
      sitio: '', activo: true, notas: '' };
    m[c].roles.push(ROLES_DE_PROPIEDADES[prop]);
  }));
  Object.keys(m).forEach(c => {
    const u = m[c];
    if (u.roles.indexOf('solo_requisicion') !== -1) {
      u.roles = u.roles.filter(r => ROLES_CON_SOLO.indexOf(r) !== -1 && r !== 'requisicion');
    } else if (dominioDe(c) === DOMINIO_HELGEN) {
      u.roles.push('ventas'); // antes toda cuenta @helgen.tech cotizaba
    }
    u.roles = ordenarRoles_(u.roles);
  });
  return m;
}

/** Fecha AAAA-MM-DD de una celda (texto o Date de Sheets, con la fecha local). */
function fechaDeCelda(v) {
  if (v instanceof Date) {
    const p = n => String(n).padStart(2, '0');
    return v.getFullYear() + '-' + p(v.getMonth() + 1) + '-' + p(v.getDate());
  }
  return String(v == null ? '' : v).trim().replace(/^'/, '').slice(0, 10);
}

/** Delegaciones de las filas: [{id, de, a, desde, hasta, roles, estado, creo, creado, cancelo, motivo}]. */
function delegacionesDesdeFilas(filas) {
  return (filas || []).filter(r => r[0] && correoCapri(r[1]) && correoCapri(r[2])).map((r, i) => ({
    id: String(r[0]), de: correoCapri(r[1]), a: correoCapri(r[2]), desde: fechaDeCelda(r[3]), hasta: fechaDeCelda(r[4]),
    roles: rolesDeTexto(r[5]).filter(x => ROLES_DELEGABLES.indexOf(x) !== -1), estado: String(r[6] || '').trim() || 'Activa',
    creo: String(r[7] || ''), creado: String(r[8] || ''), cancelo: String(r[9] || ''), motivo: String(r[10] || ''), fila: i + 2,
  }));
}

/** Roles propios de un correo (sin delegaciones): {activo, listado, roles}. ctx como en rolesEfectivos. */
function rolesPropios_(correo, ctx) {
  const c = correoCapri(correo);
  if (!c) return { activo: false, listado: false, roles: [] };
  const todos = ROLES_CAPRI.filter(r => r !== 'solo_requisicion');
  if ((ctx.superAdmins || []).indexOf(c) !== -1) return { activo: true, listado: true, roles: todos };
  const u = (ctx.usuarios || {})[c];
  if (u) {
    if (!u.activo) return { activo: false, listado: true, roles: [] };
    return { activo: true, listado: true, roles: u.roles.indexOf('superadmin') !== -1 ? todos : u.roles.slice() };
  }
  if (dominioDe(c) === DOMINIO_HELGEN && !ctx.soloListados) return { activo: true, listado: false, roles: ['ventas'] };
  return { activo: false, listado: false, roles: [] };
}

/**
 * Roles que tiene hoy un correo. ctx = {usuarios (usuariosDesdeFilas o usuariosDesdePropiedades), delegaciones, hoy
 * (AAAA-MM-DD), superAdmins (correos raíz), soloListados}. Reglas: un @helgen.tech que no está en Permisos cotiza (ventas),
 * como antes, salvo soloListados; un @helgen.services que no está, no entra; desactivado = sin acceso (salvo super admin
 * raíz); super admin = todo menos solo_requisicion; se suman los roles delegables de las delegaciones activas de hoy (si quien
 * delega los tiene); solo_requisicion deja solo requisiciones y aprobaciones; @helgen.services solo sus roles permitidos.
 * Devuelve {activo, listado, roles, superadmin, delegaciones: [{de, roles, hasta}]}.
 */
function rolesEfectivos(correo, ctx) {
  const c = correoCapri(correo);
  const propios = rolesPropios_(c, ctx);
  if (!propios.activo) return { activo: false, listado: propios.listado, roles: [], superadmin: false, delegaciones: [] };
  let roles = propios.roles.slice();
  const recibidas = [];
  if (roles.indexOf('superadmin') === -1) {
    (ctx.delegaciones || []).forEach(d => {
      if (d.a !== c || d.estado !== 'Activa' || !(d.desde <= ctx.hoy && ctx.hoy <= d.hasta)) return;
      const suyos = rolesPropios_(d.de, ctx);
      if (!suyos.activo) return;
      const dados = d.roles.filter(r => ROLES_DELEGABLES.indexOf(r) !== -1 && suyos.roles.indexOf(r) !== -1);
      if (!dados.length) return;
      recibidas.push({ de: d.de, roles: dados, hasta: d.hasta });
      roles = roles.concat(dados);
    });
  }
  if (roles.indexOf('superadmin') !== -1) {
    roles = ROLES_CAPRI.filter(r => r !== 'solo_requisicion');
  } else {
    if (roles.indexOf('solo_requisicion') !== -1) roles = roles.filter(r => ROLES_CON_SOLO.indexOf(r) !== -1).concat(['requisicion']);
    if (dominioDe(c) === DOMINIO_SERVICIOS) {
      roles = roles.filter(r => ROLES_SERVICIOS.indexOf(r) !== -1 || (r === 'requisicion' && roles.indexOf('solo_requisicion') !== -1));
    }
  }
  roles = ordenarRoles_(roles.filter((r, i) => roles.indexOf(r) === i));
  return { activo: true, listado: propios.listado, roles: roles, superadmin: roles.indexOf('superadmin') !== -1,
    delegaciones: recibidas };
}

/** Códigos de 3 letras de los sitios conocidos (los del centro de mando, D-27-3) por palabras de su nombre. */
const CODIGOS_SITIO_CONOCIDOS = [['VER', ['veracruz', 'icave']], ['ZLO', ['manzanillo', 'timsa']], ['ESE', ['ensenada', 'eit']],
  ['LZC', ['lazaro cardenas', 'lct']], ['QRO', ['queretaro']]];

/** Código de un sitio por su nombre ("Manzanillo (TIMSA)" → ZLO); '' si no se conoce. */
function codigoSitioConocido(nombre) {
  const t = ' ' + textoNormal(nombre).replace(/[^a-z0-9]+/g, ' ') + ' ';
  const x = CODIGOS_SITIO_CONOCIDOS.find(([, palabras]) => palabras.some(p => t.indexOf(' ' + p + ' ') !== -1));
  return x ? x[0] : '';
}

/**
 * Sitios de la celda SITIOS con código, nombre y dirección. Formato nuevo: un sitio por renglón "VER | Veracruz (ICAVE) |
 * Dirección opcional". Formato de antes (solo nombres, por renglón, coma o punto y coma): el código se deduce del nombre.
 */
function sitiosDetalleDeTexto(texto) {
  const t = String(texto == null ? '' : texto);
  const vistos = {};
  const lista = t.indexOf('|') === -1
    ? sitiosDeTexto(t).map(n => ({ codigo: codigoSitioConocido(n), nombre: n, direccion: '' }))
    : t.split(/\n+/).map(l => l.trim()).filter(Boolean).map(l => {
      const partes = l.split('|').map(s => s.trim().replace(/\s+/g, ' '));
      if (partes.length === 1) return { codigo: codigoSitioConocido(partes[0]), nombre: partes[0], direccion: '' };
      const codigo = textoNormal(partes[0]).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
      return { codigo: codigo, nombre: partes[1] || codigo, direccion: partes.slice(2).join(' | ') };
    });
  return lista.filter(s => {
    const k = textoNormal(s.nombre);
    if (!s.nombre || vistos[k]) return false;
    vistos[k] = true;
    return true;
  });
}

/** Código de un sitio (por código o por nombre) en la lista de sitios con detalle; '' si no está. */
function codigoDeSitio(sitio, detalle) {
  const s = String(sitio == null ? '' : sitio).trim();
  if (!s) return '';
  const x = (detalle || []).find(d => d.codigo === s.toUpperCase() || textoNormal(d.nombre) === textoNormal(s));
  return x ? x.codigo : codigoSitioConocido(s);
}

// ====== 6. INCREMENTO 4 (CAPRI): MÓDULOS ======
// Cada módulo vive en su sección y se conecta a la API solo con su función mod*_ (ver MODULOS_ arriba de API_FUNCIONES).
// Lo compartido ya está en la base: roles (tieneRol_, esSuperAdmin_, correosConRol_, excepcionSuperAdmin_, rolesEfectivos),
// libro de Administración (libroAdmin_, hojaAdmin_, HOJAS_ADMIN), avisos (notificar_ → cola; los manda el módulo de correos),
// sitios con código (sitiosDetalle_, codigoDeSitio) y el estado REQ_EN_CAMINO.

// ---- 6.A Identidad: Permisos, delegaciones, entrar con código (@helgen.services) y sesiones de CAPRI ----

function modIdentidad_() {
  return { nombre: 'Identidad', api: {}, cambios: {}, solo: [], publicas: [] };
}

/** Sesión propia de CAPRI (token que empieza con PREFIJO_SESION_CAPRI). La implementa el módulo de identidad. */
function verificarSesionCapri_(token) {
  throw errorSesion_('Inicia sesión para continuar.');
}

// ---- 6.B Correos y proveedores: avisos en cada relevo, solicitud de cotización en PDF y botones de correo ----

function modCorreos_() {
  return { nombre: 'Correos', api: {}, cambios: {}, solo: [], publicas: [] };
}

/** Eventos de aviso (tipo de notificar_). Quién recibe cada uno lo decide el módulo de correos (tabla del spec, sección 5). */
const EVENTOS_CORREO = ['req.solicitada', 'req.aprobada', 'req.devuelta', 'req.rechazada', 'req.cotizada', 'req.regresada',
  'req.autorizada', 'req.encamino', 'req.recibida', 'req.cancelada', 'oc.cancelada', 'delegacion', 'usuario.alta', 'anulado'];

/**
 * Pide un aviso por correo. Solo lo forma en la cola de la petición (MEMO_.correos): doPost llama enviarCorreosPendientes_
 * cuando la función ya terminó bien (fuera del candado). Nunca lanza error. datos: {folio, req, oc, nota, para: [correos
 * extra], ...}; nunca montos ni proveedores para quien pide o recibe.
 */
function notificar_(tipo, datos) {
  try {
    (MEMO_.correos = MEMO_.correos || []).push({ tipo: tipo, datos: datos || {}, actor: VENDEDOR_ ? VENDEDOR_.email : '' });
  } catch (e) {
    console.warn('Aviso no formado: ' + e.message);
  }
}

/** Manda los avisos de la cola (módulo de correos). Sin implementar: se descartan. */
function enviarCorreosPendientes_() {
  MEMO_.correos = [];
}

// ---- 6.C Centro de mando (drogheda.helgen.online): sitios con código, ítems, En camino, avisos firmados, recepciones ----

function modCentroMando_() {
  return { nombre: 'Centro de mando', api: {}, cambios: {}, solo: [], publicas: [] };
}

/**
 * Avisa al centro de mando un cambio de una orden de compra (tipo del contrato: oc.autorizada, oc.pagada, oc.en_camino,
 * oc.cancelada, req.cerrada). Solo si el proyecto está ligado; sin montos; si no contesta, queda en PortalPendientes y se
 * reintenta. Nunca lanza error. La implementa el módulo del centro de mando; aquí no hace nada.
 */
function avisarPortal_(tipo, folioOc) {}

// ---- 6.D Pantallas: Pendientes (inicio), conteos y navegación por grupos ----
// Pendientes = lo que espera a cada quien, de lo más antiguo a lo más nuevo, con un botón que abre la pantalla donde se resuelve:
// Aprobaciones (aprobar y dar el visto bueno; nunca lo propio), Compras (autorizar o cotizar, pagar, marcar En camino en
// proyectos ligados al centro de mando, facturas que vencen en 7 días o ya vencieron) y quien pide o recibe (corregir lo devuelto,
// recibir el material). Un super admin puede ver además los de todos. Quien pide o recibe nunca ve montos, proveedor ni orden.
// Solo lee: la pestaña Requisiciones y OrdenesCompra una vez por versión (caché compartido entre usuarios) y las cuentas por
// pagar (caché por día). Va en la carga inicial y en la sincronización cuando cambia algo de lo que depende.

/** Estados en que una requisición todavía espera a alguien (Cerrada, Rechazada y Cancelada ya no). */
const ESTADOS_PENDIENTES = [REQ_SOLICITADA, REQ_DEVUELTA, REQ_APROBADA, REQ_COTIZADA, REQ_AUTORIZADA, REQ_PAGADA, REQ_RECIBIDA, REQ_EN_CAMINO];
/** Colecciones de las que dependen los pendientes (si cambia una, la sincronización los vuelve a mandar). */
const COLECCIONES_PENDIENTES = ['requisiciones', 'oc', 'pagosProveedores', 'facturasProveedor', 'permisos', 'proyectos', 'anulaciones'];
/** Una factura de proveedor sale en Pendientes desde 7 días antes de vencer. */
const DIAS_AVISO_FACTURA = 7;

function modPantallas_() {
  return { nombre: 'Pantallas', api: { pendientes: pendientes }, cambios: {}, solo: ['pendientes'], publicas: [],
    bootstrap(permisos, errores) { return { pendientes: pendientes(false) }; },
    sincronizar(permisos, ctx, algo, r, errores) {
      if (algo.apply(null, COLECCIONES_PENDIENTES)) r.pendientes = pendientes(!!(ctx && ctx.pendTodos) && esSuperAdmin_());
    } };
}

/**
 * Pendientes del usuario de la sesión. todos = true: los de todos (solo super admin; si no, PERMISO). Devuelve {hoy, todos, flujo,
 * items, conteos, avisos}: items de lo más antiguo a lo más nuevo (ver itemsPendientes); conteos = los del usuario (también con
 * todos), para los números de la navegación.
 */
function pendientes(todos) {
  if (!VENDEDOR_) throw errorSesion_('Inicia sesión para continuar.');
  const verTodos = todos === true;
  if (verTodos && !esSuperAdmin_()) throw errorPermiso_('Solo un super admin puede ver los pendientes de todos.');
  const hoy = hoyIso_(), avisos = [];
  const roles = { aprobaciones: esOperaciones_(), compras: esCompras_(), requisicion: esRequisicion_() };
  let cxp = [];
  if (roles.compras) {
    try { cxp = (cuentasPorPagar() || {}).abiertas || []; } catch (e) { avisos.push('Facturas de proveedor: ' + e.message); }
  }
  const usuarios = contextoRoles_().usuarios, nombres = {};
  Object.keys(usuarios).forEach(c => { if (usuarios[c].nombre) nombres[c] = usuarios[c].nombre; });
  const o = { yo: yo_(), roles: roles, flujo: flujoOperaciones_(), hoy: hoy, cxp: cxp, nombres: nombres, ligado: proyectoLigadoPend_ };
  const base = basePendientes_();
  const mios = itemsPendientes(base, o);
  return { hoy: hoy, todos: verTodos, flujo: o.flujo, items: verTodos ? itemsPendientes(base, Object.assign({}, o, { todos: true })) : mios,
    conteos: conteosPendientes(mios), avisos: avisos };
}

/**
 * Requisiciones que todavía esperan a alguien, con lo que Pendientes necesita (su orden y su propuesta vigente, con montos: se
 * filtran por rol en itemsPendientes). Una lectura de Requisiciones y otra de OrdenesCompra; en caché por versión para todos.
 */
function basePendientes_() {
  return enCache_('pendientes', ['requisiciones', 'oc', 'pagosProveedores', 'proyectos', 'anulaciones'], TTL_CACHE, () => {
    const libro = libroComprasSiExiste_(); // solo lee: el libro lo crea la primera requisición
    if (!libro) return [];
    const proyectos = mapaProyectos_(), abiertas = [];
    filasDeArea_(hojaReq_(libro), HOJAS_COMPRAS, 'Requisiciones').forEach((r, i) => {
      if (!String(r[0] || '').trim()) return;
      const q = reqDesdeFila_(r, i + 2);
      if (ESTADOS_PENDIENTES.indexOf(q.estado) !== -1) abiertas.push({ q: q, desde: marcaPendiente_(r[12], q.fecha) });
    });
    const ordenes = abiertas.some(x => x.q.ocFolio) ? ordenesPorFolio_(libro) : {};
    return abiertas.map(x => {
      const q = x.q, p = proyectos[q.proyectoFolio.toUpperCase()], prop = propuestaVigente_(q);
      const oc = q.ocFolio ? ordenes[q.ocFolio.toUpperCase()] || null : null;
      return { folio: q.folio, fecha: q.fecha, desde: x.desde, proyectoFolio: q.proyectoFolio,
        proyectoVisible: p ? p.folioVisible : q.proyectoFolio, proyectoNombre: p ? p.nombre : '',
        solicitanteEmail: q.solicitanteEmail, solicitante: q.solicitante, estado: q.estado, motivo: q.motivo, sitio: q.sitio,
        prioridad: q.prioridad, fechaRequerida: q.fechaRequerida, recibeEmail: q.recibeEmail,
        elaboroEmail: prop ? String(prop.elaboroEmail || '').toLowerCase() : '',
        propuesta: prop ? { proveedor: prop.proveedor ? prop.proveedor.razonSocial : '', total: prop.total, moneda: prop.moneda } : null,
        oc: oc ? { folio: oc.folio, estado: oc.estado, proveedor: oc.proveedor, total: oc.total, moneda: oc.moneda } : null };
    });
  });
}

/** Momento ordenable ("AAAA-MM-DD HH:mm") de la celda "actualizado" (Date de Sheets o texto); si falta, la fecha del registro. */
function marcaPendiente_(v, fecha) {
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Mexico_City', 'yyyy-MM-dd HH:mm');
  return marcaOrdenable(v) || marcaOrdenable(fecha);
}

/**
 * ¿El proyecto está ligado al centro de mando (drogheda.helgen.online)? Lo decide el módulo del centro de mando con su función
 * proyectoLigado_(folio); mientras no exista, ninguno (y no hay pendientes de "marcar En camino").
 */
function proyectoLigadoPend_(folio) {
  try {
    return typeof proyectoLigado_ === 'function' && !!proyectoLigado_(folio);
  } catch (e) {
    return false;
  }
}

// -- Lógica pura de Pendientes (se prueba en Node) --

/** "2026-10-28 14:05:09", "2026-10-28" o "28/10/2026 14:05" → "2026-10-28 14:05"; '' si no es una fecha. */
function marcaOrdenable(texto) {
  const t = String(texto == null ? '' : texto).trim().replace(/^'/, '');
  const d2 = s => String(s).padStart(2, '0');
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3] + ' ' + d2(m[4] || '0') + ':' + (m[5] || '00');
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2}))?/);
  if (m) return m[3] + '-' + d2(m[2]) + '-' + d2(m[1]) + ' ' + d2(m[4] || '0') + ':' + (m[5] || '00');
  return '';
}

/**
 * Pendientes a partir de las requisiciones abiertas (basePendientes_). o = {yo, roles: {aprobaciones, compras, requisicion}, flujo
 * (con aprobaciones), todos (los de todos, para el super admin), hoy (AAAA-MM-DD), cxp (facturas abiertas de cuentasPorPagar),
 * nombres ({correo: nombre}), ligado(proyectoFolio) → ¿ligado al centro de mando?}. Cada item: {tipo, seccion (aprobaciones,
 * compras, mias), folio, req (requisición que se abre), titulo, detalle, sitio, desde (AAAA-MM-DD), dias (que lleva esperando),
 * prioridad, urgente, accion (texto del botón), destino (ops = Aprobaciones, com = Compras, cxp = cuentas por pagar, req = mis
 * requisiciones), para (solo con todos: a quién espera)}; las facturas además {vence, diasVencida}. De lo más antiguo a lo más
 * nuevo. Reglas: nadie aprueba ni da el visto bueno a lo suyo (ni a la propuesta que preparó); quien pide o recibe nunca ve
 * montos, proveedor ni folio de la orden.
 */
function itemsPendientes(base, o) {
  const x = o || {}, roles = x.roles || {}, todos = !!x.todos, flujo = !!x.flujo, hoy = String(x.hoy || '');
  const yo = String(x.yo || '').toLowerCase();
  const ligado = typeof x.ligado === 'function' ? x.ligado : () => false;
  const nombre = c => (x.nombres || {})[c] || c;
  const dinero = (n, m) => formatoMoneda(n) + ' ' + (m || 'MXN');
  const fecha = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso || ''); };
  const esFecha = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const diasDesde = d => esFecha(d) && esFecha(hoy) ? Math.max(0, diasEntre(d, hoy)) : 0;
  const proyecto = q => [q.proyectoVisible, q.proyectoNombre].filter(Boolean).join(' · ');
  const items = [];
  const agregar = (q, seccion, it, para) => {
    const desde = String(q.desde || '').slice(0, 10);
    items.push(Object.assign({ folio: q.folio, req: q.folio, sitio: q.sitio || '', desde: desde, dias: diasDesde(desde),
      prioridad: q.prioridad || '', urgente: q.prioridad === 'Urgente', orden: q.desde || '' }, it, {
      seccion: seccion, detalle: (it.detalle || []).filter(Boolean).join(' · ') }, todos ? { para: para } : {}));
  };

  // Facturas abiertas que vencen en DIAS_AVISO_FACTURA días o ya vencieron, por orden: se anotan en el pendiente de pagar su orden
  const facturas = {}, anotadas = {};
  ((roles.compras || todos) ? (x.cxp || []) : []).filter(f => Number(f.dias) >= -DIAS_AVISO_FACTURA).forEach(f => {
    const k = String(f.ocFolio || '').toUpperCase();
    (facturas[k] = facturas[k] || []).push(f);
  });
  const textoVence = f => Number(f.dias) > 0 ? 'factura vencida hace ' + f.dias + ' día' + (f.dias === 1 ? '' : 's')
    : Number(f.dias) === 0 ? 'factura vence hoy' : 'factura vence el ' + fecha(f.fechaVencimiento);

  (base || []).forEach(q => {
    const suya = q.solicitanteEmail === yo, recibe = q.recibeEmail || q.solicitanteEmail;
    // Aprobaciones (solo con el flujo con aprobaciones): aprobar y visto bueno, nunca lo propio ni la propuesta que uno preparó
    if (flujo && (roles.aprobaciones || todos)) {
      if (q.estado === REQ_SOLICITADA && (todos || !suya)) {
        agregar(q, 'aprobaciones', { tipo: 'aprobar', titulo: 'Por aprobar', accion: 'Aprobar', destino: 'ops',
          detalle: [proyecto(q), 'pidió ' + q.solicitante, q.fechaRequerida ? 'se necesita el ' + fecha(q.fechaRequerida) : ''] }, 'Aprobaciones');
      }
      if (q.estado === REQ_COTIZADA && (todos || (!suya && q.elaboroEmail !== yo))) {
        const p = q.propuesta || {};
        agregar(q, 'aprobaciones', { tipo: 'visto', titulo: 'Propuesta por visto bueno', accion: 'Dar visto bueno', destino: 'ops',
          detalle: [proyecto(q), p.proveedor, p.total != null ? dinero(p.total, p.moneda) : ''] }, 'Aprobaciones');
      }
    }
    // Compras: autorizar (flujo de siempre) o cotizar (con aprobaciones), pagar, marcar En camino (proyectos ligados)
    if (roles.compras || todos) {
      if (!flujo && q.estado === REQ_SOLICITADA) {
        agregar(q, 'compras', { tipo: 'autorizar', titulo: 'Por autorizar', accion: 'Revisar', destino: 'com',
          detalle: [proyecto(q), 'pidió ' + q.solicitante] }, 'Compras');
      }
      if (flujo && q.estado === REQ_APROBADA) {
        const regresada = !!q.motivo;
        agregar(q, 'compras', { tipo: 'cotizar', titulo: regresada ? 'Propuesta regresada' : 'Por cotizar',
          accion: regresada ? 'Corregir propuesta' : 'Cotizar', destino: 'com',
          detalle: [proyecto(q), 'pidió ' + q.solicitante, regresada ? 'motivo: ' + q.motivo : ''] }, 'Compras');
      }
      const oc = q.oc;
      if (oc && oc.estado === OC_EMITIDA && [REQ_AUTORIZADA, REQ_EN_CAMINO, REQ_RECIBIDA].indexOf(q.estado) !== -1) {
        const fs = facturas[String(oc.folio).toUpperCase()] || [];
        fs.forEach(f => { anotadas[f.folio] = true; });
        const recibida = q.estado === REQ_RECIBIDA, encamino = q.estado === REQ_EN_CAMINO;
        agregar(q, 'compras', { tipo: recibida ? 'pagarRecibida' : 'pagar',
          titulo: recibida ? 'Recibida, falta pagar' : encamino ? 'En camino, falta pagar' : 'Orden por pagar',
          accion: recibida || encamino ? 'Pagar' : 'Enviar y pagar', destino: 'com',
          urgente: q.prioridad === 'Urgente' || fs.some(f => Number(f.dias) > 0),
          detalle: [proyecto(q), oc.folio, oc.proveedor, dinero(oc.total, oc.moneda)].concat(fs.map(textoVence)) }, 'Compras');
      }
      if (oc && q.estado === REQ_PAGADA && ligado(q.proyectoFolio)) {
        agregar(q, 'compras', { tipo: 'encamino', titulo: 'Por marcar En camino', accion: 'Marcar En camino', destino: 'com',
          detalle: [proyecto(q), oc.folio, oc.proveedor] }, 'Compras');
      }
    }
    // Quien pide o recibe: corregir lo devuelto, recibir el material (sin montos, proveedor ni orden)
    if (roles.requisicion || todos) {
      if (q.estado === REQ_DEVUELTA && (todos || suya)) {
        agregar(q, 'mias', { tipo: 'corregir', titulo: suya ? 'Te la devolvieron' : 'Devuelta', accion: 'Corregir y reenviar',
          destino: suya ? 'req' : 'com', detalle: [proyecto(q), q.motivo ? 'motivo: ' + q.motivo : ''] }, nombre(q.solicitanteEmail));
      }
      const porRecibir = flujo ? [REQ_AUTORIZADA, REQ_PAGADA, REQ_EN_CAMINO] : [REQ_PAGADA, REQ_EN_CAMINO];
      const mia = suya || recibe === yo;
      if (porRecibir.indexOf(q.estado) !== -1 && (todos || mia)) {
        const enCentro = ligado(q.proyectoFolio);
        agregar(q, 'mias', { tipo: 'recibir', titulo: q.estado === REQ_EN_CAMINO ? 'En camino' : 'Por recibir',
          accion: enCentro ? 'Recibir en el centro de mando' : flujo ? 'Registrar lo que llegó' : 'Confirmar que llegó',
          destino: mia ? 'req' : 'com', detalle: [proyecto(q), recibe === yo && !suya ? 'la pidió ' + q.solicitante
            : recibe !== q.solicitanteEmail ? 'recibe ' + nombre(recibe) : ''] }, nombre(recibe));
      }
    }
  });

  // Facturas que no se anotaron en una orden por pagar (órdenes de antes, sin requisición abierta)
  Object.keys(facturas).forEach(k => facturas[k].forEach(f => {
    if (anotadas[f.folio]) return;
    const vencida = Number(f.dias) > 0;
    items.push(Object.assign({ tipo: 'factura', seccion: 'compras', folio: f.folio, req: f.reqFolio || '',
      titulo: vencida ? 'Factura vencida' : 'Factura por vencer', sitio: '', desde: f.fechaVencimiento, dias: 0,
      vence: f.fechaVencimiento, diasVencida: Number(f.dias) || 0, prioridad: '', urgente: vencida,
      accion: f.reqFolio ? 'Abrir y pagar' : 'Ver cuentas por pagar', destino: f.reqFolio ? 'com' : 'cxp',
      detalle: [f.proveedor, f.serieFolio || '', dinero(f.total, f.moneda), f.ocFolio, f.proyectoVisible].filter(Boolean).join(' · '),
      orden: marcaOrdenable(f.fechaVencimiento) }, todos ? { para: 'Compras' } : {}));
  }));

  items.sort((a, b) => a.orden < b.orden ? -1 : a.orden > b.orden ? 1 : a.folio < b.folio ? -1 : a.folio > b.folio ? 1 : 0);
  return items.map(it => { const y = Object.assign({}, it); delete y.orden; return y; });
}

/** Cuántos pendientes hay por sección y por pestaña (ops = Aprobaciones, com = Compras con cuentas por pagar, req = Requisiciones). */
function conteosPendientes(items) {
  const c = { total: 0, aprobaciones: 0, compras: 0, mias: 0, ops: 0, com: 0, req: 0 };
  (items || []).forEach(it => {
    c.total++;
    if (c[it.seccion] != null) c[it.seccion]++;
    const tab = it.destino === 'cxp' ? 'com' : it.destino;
    if (tab === 'ops' || tab === 'com' || tab === 'req') c[tab]++;
  });
  return c;
}

// ---- 6.E Anular: un super admin anula cualquier registro con folio (con lo que depende de él) ----

function modAnular_() {
  return { nombre: 'Anular', api: {}, cambios: {}, solo: [], publicas: [] };
}
