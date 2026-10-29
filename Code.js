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
const MODULOS_ = [modIdentidad_(), modAnular_(), modCorreos_(), modCentroMando_(), modPantallas_(),
  modProveedores_(), // incremento 5: F · Proveedores y forma de pago (§6.F)
  modRecepcion_(), // incremento 5: H · recepción con fotos y devoluciones (§6.H)
  modReportes_()]; // incremento 6: R · reportes de CxC y CxP, flujo y margen; fecha esperada por etapa (§6.R)
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

/**
 * Correos activos a quienes avisar de algo de un rol: lo tienen hoy y es suyo en Permisos o por una delegación vigente. Un
 * super admin que no tiene el rol en su fila no recibe esos avisos (si no, le llegaría todo: puede verlo en Pendientes).
 */
function correosConRol_(rol) {
  const ctx = contextoRoles_();
  const candidatos = Object.keys(ctx.usuarios).concat(ctx.superAdmins, ctx.delegaciones.map(d => d.a));
  return candidatos.filter((c, i) => candidatos.indexOf(c) === i).filter(c => {
    const r = rolesEfectivos(c, ctx), u = ctx.usuarios[c];
    if (r.roles.indexOf(rol) === -1) return false;
    return (u && u.roles.indexOf(rol) !== -1) || r.delegaciones.some(d => d.roles.indexOf(rol) !== -1);
  }).sort();
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
  // Nombres: los que cada correo tiene como vendedor en Cotizaciones (si cotizó); los demás se escriben en la página
  try {
    const nombres = nombresDeVendedores(db_().getSheetByName('Cotizaciones').getDataRange().getValues().slice(1));
    Object.keys(usuarios).forEach(c => { if (!usuarios[c].nombre && nombres[c]) usuarios[c].nombre = nombres[c]; });
  } catch (e) {
    console.warn('Sin nombres de Cotizaciones: ' + e.message);
  }
  const ahora = Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss');
  const filas = Object.keys(usuarios).sort().map(c => filaDeUsuario(usuarios[c], 'migración', ahora).map(textoCelda));
  if (filas.length) escribe_(hoja).getRange(2, 1, filas.length, HOJAS_ADMIN.Permisos.enc.length).setValues(filas);
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

/**
 * Rapidez (30/10/2026): ID guardado en Script Properties (SPREADSHEET_ID, CATALOGO_ID, COMPRAS_DB_ID, carpetas…) tomado de la
 * lectura de esta petición (propiedades_) en lugar de una lectura por cada uso (0.05 s cada una). Si no está, se lee directo:
 * quien lo crea (bajo candado) lo guarda y la siguiente lectura ya lo ve. Solo para IDs, que no cambian una vez creados;
 * los contadores de folio (CONSECUTIVO_…) y las versiones se siguen leyendo frescos.
 */
function idGuardado_(clave) {
  return propiedades_()[clave] || PropertiesService.getScriptProperties().getProperty(clave);
}

/** Rapidez: un libro de Sheets se abre una vez por petición (openById tarda) y se reusa lo abierto. */
function abrirLibro_(id) {
  const abiertos = MEMO_.libros || (MEMO_.libros = {});
  return abiertos[id] || (abiertos[id] = SpreadsheetApp.openById(id));
}

/** Filas 2…última (n columnas) de una pestaña, con una sola llamada a getLastRow (cada llamada es un viaje a Sheets). */
function filasDatos_(hoja, n) {
  const ultima = hoja.getLastRow();
  return ultima > 1 ? hoja.getRange(2, 1, ultima - 1, n).getValues() : [];
}

// ---- Rapidez (30/10/2026): filas leídas en esta petición ----
// Una pestaña se leía completa varias veces en la misma llamada (p. ej. Requisiciones 4 veces al sincronizar compras: mis
// requisiciones, la lista, la requisición abierta y Pendientes). filasEnPeticion_ guarda lo leído en MEMO_.filas (clave que
// termina en "/<pestaña>/<id de la pestaña>") y lo reparte en copias. Nunca devuelve algo viejo:
//  - toda escritura pasa por escribe_(hoja) (lo exige tests/rapidez.test.js), que olvida lo leído de esa pestaña (y Config
//    ya leída, si es Config); una escritura al libro (crear o borrar una pestaña) o a algo que no es una pestaña olvida todo;
//  - al tomar y al soltar el candado (candado_) se olvida todo: adentro se relee lo que otra persona pudo cambiar mientras
//    se esperaba;
//  - cada vez que se leen las versiones (versiones_) se olvida todo: una lista que se guarda en caché con una versión se arma
//    con filas leídas después de esa versión, nunca antes.
// Las pestañas que se guardan (compras, cobranza, administración y Proyectos) no tienen fórmulas que dependan de otras.
function filasEnPeticion_(clave, leer) {
  const memo = MEMO_.filas || (MEMO_.filas = {});
  if (!memo[clave]) memo[clave] = leer();
  return memo[clave].map(r => r.slice()); // copias: quien las recibe puede cambiarlas sin tocar las de los demás
}

function olvidarFilas_() {
  MEMO_.filas = null;
  MEMO_.cfgLigera = null; // Config ya leída en la petición (configLigera_)
}

/** Sufijo de las claves de MEMO_.filas de una pestaña ("/Requisiciones/123"); '' si no se sabe. */
function sufijoFilas_(hoja) {
  if (!hoja || typeof hoja.getSheetId !== 'function' || typeof hoja.getName !== 'function') return '';
  return '/' + hoja.getName() + '/' + hoja.getSheetId();
}

/**
 * Toda escritura a una hoja va así: escribe_(hoja).getRange(…).setValues(…) / escribe_(hoja).appendRow(…). Olvida lo leído
 * de esa pestaña en la petición; si no es una pestaña (el libro: insertSheet, deleteSheet), todo.
 */
function escribe_(hoja) {
  const sufijo = sufijoFilas_(hoja);
  if (!sufijo) { olvidarFilas_(); return hoja; }
  // Encabezados confiados sin leer (confiarEncabezados_): antes de la primera escritura, si la pestaña está vacía, se reponen
  const confiados = MEMO_.encConfiado && MEMO_.encConfiado[sufijo];
  if (confiados) {
    delete MEMO_.encConfiado[sufijo];
    (MEMO_.encVacia = MEMO_.encVacia || {})[sufijo] = true;
    if (hoja.getLastRow() === 0) Object.keys(confiados).forEach(k => confiados[k]());
  }
  const memo = MEMO_.filas || {};
  Object.keys(memo).forEach(k => { if (k.slice(-sufijo.length) === sufijo) delete memo[k]; });
  if (/^\/Config\//.test(sufijo)) MEMO_.cfgLigera = null;
  return hoja;
}

/** El candado de script. Al tomarlo o soltarlo se olvidan las filas leídas en la petición (filasEnPeticion_). */
function candado_() {
  const lock = LockService.getScriptLock();
  return {
    tryLock: ms => { const ok = lock.tryLock(ms); if (ok) olvidarFilas_(); return ok; },
    releaseLock: () => { lock.releaseLock(); olvidarFilas_(); },
  };
}

/** {proyectos: 12, contratos: 3, …} desde Script Properties (VER_<colección>). */
function versiones_(releer) {
  if (!VERSIONES_ || releer) {
    olvidarFilas_(); // rapidez: lo que se arme con estas versiones se lee después de ellas (filasEnPeticion_)
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
  const lock = candado_();
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

/**
 * Lee un valor JSON guardado por guardarCache_; undefined si no está o le falta un trozo. Rapidez (30/10/2026): un valor que
 * cabe en un trozo va en la misma entrada ("V:<json>", una lectura); uno más grande, en trozos ("N:<n>" + <clave>#0…).
 */
function leerCache_(clave) {
  const cache = CacheService.getScriptCache();
  const meta = cache.get(clave);
  if (meta && meta.slice(0, 2) === 'V:') {
    try { return JSON.parse(meta.slice(2)); } catch (e) { return undefined; }
  }
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
    // Rapidez: lo que cabe en un trozo va en la misma entrada (al leerlo, un viaje a CacheService en lugar de dos)
    if (texto.length <= TROZO_CACHE) { CacheService.getScriptCache().put(clave, 'V:' + texto, ttl); return; }
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
  const v = versiones_()[coleccion];
  // Lo ya leído en la petición sirve solo con la misma versión (30/10/2026): si la versión cambió (otra petición escribió y
  // esta volvió a leer las versiones), una lista que se guarda con la versión nueva no se arma con el valor de antes
  if (memo && memo.version === v && (!revisar || memo.revisado)) return memo.valor;
  const cache = CacheService.getScriptCache();
  // Rapidez: ya está en la petición con esta versión (p. ej. Permisos, que se leen para los roles): para revisarla basta
  // saber si ya toca releer la hoja (marca R_); no se vuelve a traer el valor del caché
  if (memo && memo.version === v && cache.get('R_' + nombre)) {
    memo.revisado = true;
    return memo.valor;
  }
  const previo = leerCache_('F_' + nombre + '_' + v);
  if (previo !== undefined && (!revisar || cache.get('R_' + nombre))) {
    MEMO_['F_' + nombre] = { valor: previo, revisado: !!revisar, version: v };
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
  MEMO_['F_' + nombre] = { valor: valor, revisado: true, version: version };
  return valor;
}

/** Todos los proyectos de la pestaña Proyectos (con carpetaId: solo para uso interno). */
function proyectosCache_(revisar) {
  return fuenteConHuella_('proyectos', 'proyectos', 300, () => proyectosDesdeFilas(filasProyectos_()), revisar);
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
  // Rapidez: una vez por petición (también en las escrituras, donde no se usa el caché y se leía Config en cada uso)
  if (!MEMO_.cfgLigera) {
    MEMO_.cfgLigera = enCache_('config2', [], 600, () => { // 10 min: la lista de sitios se edita a mano en Config
      const cfg = getConfig_();
      return { ivaTasa: cfg.IVA_TASA, vigenciaDias: cfg.VIGENCIA_DIAS, sitios: String(cfg.SITIOS == null ? '' : cfg.SITIOS) };
    });
  }
  return MEMO_.cfgLigera;
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

  const hCot = ss.getSheetByName('Cotizaciones') || escribe_(ss).insertSheet('Cotizaciones');
  if (hCot.getLastRow() === 0) {
    escribe_(hCot).appendRow(ENCABEZADOS_COTIZACIONES);
    hCot.setFrozenRows(1);
    hCot.getRange(1, 1, 1, ENCABEZADOS_COTIZACIONES.length)
      .setFontWeight('bold').setBackground('#2C3C5B').setFontColor('#FFFFFF');
  }

  // El catálogo vive en su propio archivo ("Catálogo Helgen"): ver hojaCatalogo_()

  const hCfg = ss.getSheetByName('Config') || escribe_(ss).insertSheet('Config');
  if (hCfg.getLastRow() === 0) {
    hCfg.getRange('B:B').setNumberFormat('@'); // texto: evita que "+52 ..." se lea como fórmula
    escribe_(hCfg).getRange(1, 1, CONFIG_INICIAL.length + 1, 2).setValues([['Clave', 'Valor']].concat(CONFIG_INICIAL));
    hCfg.setColumnWidth(2, 600);
  }

  const hoja1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (hoja1 && ss.getSheets().length > 1) escribe_(ss).deleteSheet(hoja1);

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
  // Rapidez: los IDs salen de la lectura de propiedades de la petición y el libro se abre una vez (idGuardado_, abrirLibro_)
  if (!idGuardado_('SPREADSHEET_ID') || !idGuardado_('FOLDER_ID')) {
    const props = PropertiesService.getScriptProperties();
    // Primera vez: se instala sola (hoja + carpeta) en lugar de exigir correr setup() a mano.
    const lock = candado_();
    if (!lock.tryLock(30000)) throw new Error('Se está preparando el cotizador. Recarga la página en unos segundos.');
    try {
      if (!props.getProperty('SPREADSHEET_ID') || !props.getProperty('FOLDER_ID')) setup();
    } finally {
      lock.releaseLock();
    }
  }
  return abrirLibro_(idGuardado_('SPREADSHEET_ID'));
}

function getConfig_() {
  const hoja = db_().getSheetByName('Config');
  // Rapidez: una sola lectura (migrarConfig_ revisa sobre ella); si hubo que migrar (o esperar a quien migraba), se relee
  let valores = hoja.getDataRange().getValues();
  if (migrarConfig_(hoja, valores)) valores = hoja.getDataRange().getValues();
  const filas = valores.slice(1);
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
function migrarConfig_(hoja, leidos) {
  // leidos = lo que quien llama ya leyó de Config (rapidez: no se vuelve a leer para saber si hay algo que migrar).
  // Devuelve true si pasó de la primera revisión (migró, otra petición migraba o no hubo candado): quien llama relee.
  const necesita = v => {
    const claves = v.map(r => r[0]);
    return CONFIG_INICIAL.some(([k]) => claves.indexOf(k) === -1) ||
      v.some(r => /^#[A-Z/0!?]+/.test(String(r[1])) || CONFIG_EJEMPLO_ANTERIOR[r[0]] === String(r[1]));
  };
  if (!necesita(leidos || hoja.getDataRange().getValues())) return false;

  const lock = candado_();
  if (!lock.tryLock(30000)) return true;
  try {
    if (!necesita(hoja.getDataRange().getValues())) return true;
    const valores = hoja.getDataRange().getValues();
    const iniciales = {};
    CONFIG_INICIAL.forEach(([k, v]) => { iniciales[k] = v; });
    hoja.getRange('B:B').setNumberFormat('@');

    valores.forEach((r, i) => {
      const fila = i + 1;
      if (r[0] === 'TERMINOS') {
        escribe_(hoja).getRange(fila, 1, 1, 2).setValues([['TERMINOS_ENERGY', iniciales.TERMINOS_ENERGY]]);
      } else if (i > 0 && r[0] in iniciales &&
          (/^#[A-Z/0!?]+/.test(String(r[1])) || CONFIG_EJEMPLO_ANTERIOR[r[0]] === String(r[1]))) {
        escribe_(hoja).getRange(fila, 2).setValue(String(iniciales[r[0]]));
      }
    });
    const claves = hoja.getDataRange().getValues().map(r => r[0]);
    CONFIG_INICIAL.forEach(([k, v]) => {
      if (claves.indexOf(k) === -1) escribe_(hoja).appendRow([k, v]);
    });
    SpreadsheetApp.flush();
    return true;
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
  if (!idGuardado_('CATALOGO_ID')) {
    const lock = candado_();
    if (!lock.tryLock(30000)) throw new Error('Se está preparando el catálogo. Recarga la página en unos segundos.');
    try {
      if (!props.getProperty('CATALOGO_ID')) crearCatalogo_();
    } finally {
      lock.releaseLock();
    }
  }
  const ss = abrirLibro_(idGuardado_('CATALOGO_ID'));
  const hoja = ss.getSheetByName('Catalogo') || ss.getSheets()[0];
  asegurarColumnasSat_(hoja, ss);
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
    const tc = escribe_(ss).insertSheet(HOJA_TIPO_CAMBIO);
    escribe_(tc).getRange(1, 1, 5, 2).setValues([
      ['Concepto', 'Valor'],
      ['Automático: Google Finance (pesos por dólar)', ''],
      ['Manual (opcional): si escribes un valor aquí, se usa en lugar del automático', ''],
      ['Tipo de cambio en uso', ''],
      ['Nota', 'Los precios en USD del catálogo (columna I) se calculan solos con el tipo de cambio en uso. Google Finance ' +
        'se actualiza durante el día y puede tener unos minutos de retraso; no es el FIX de Banxico.'],
    ]);
    escribe_(tc).getRange(2, 2).setFormula('=GOOGLEFINANCE("CURRENCY:USDMXN")');
    escribe_(tc).getRange(4, 2).setFormula('=IF(ISNUMBER(B3),B3,IFERROR(ROUND(B2,4),""))');
    tc.getRange(2, 2, 3, 1).setNumberFormat('0.0000');
    tc.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#2C3C5B').setFontColor('#FFFFFF');
    tc.setColumnWidth(1, 470); tc.setColumnWidth(2, 160);
    ss.setNamedRange(RANGO_TIPO_CAMBIO, tc.getRange(4, 2));
    // GOOGLEFINANCE se recalcula cada hora aunque nadie abra el archivo
    ss.setRecalculationInterval(SpreadsheetApp.RecalculationInterval.HOUR);
  }
  // Rapidez: el encabezado de la columna I se lee solo si no se revisó hace poco (encabezadosRevisados_)
  const claveUsd = claveEncabezados_(ss, hoja, 'Catalogo/USD', [ENC_PRECIO_USD]);
  const revisarUsd = () => {
    if (hoja.getRange(1, COL_PRECIO_USD).getValue() !== ENC_PRECIO_USD) {
      escribe_(hoja).getRange(1, COL_PRECIO_USD).setValue(ENC_PRECIO_USD)
        .setFontWeight('bold').setBackground('#2C3C5B').setFontColor('#FFFFFF');
      hoja.getRange('I:I').setNumberFormat('$#,##0.00');
      hoja.setColumnWidth(COL_PRECIO_USD, 210);
      hoja.getRange('I:I').protect().setDescription('Precio USD automático: no escribir aquí (cambia el precio en pesos ' +
        'o el tipo de cambio)').setWarningOnly(true);
    }
    anotarEncabezados_(claveUsd);
  };
  if (!encabezadosRevisados_(claveUsd)) revisarUsd();
  else confiarEncabezados_(hoja, claveUsd, revisarUsd);
  // Renglones con producto y sin fórmula en I: se les pone (incluye los dados de alta a mano en Sheets)
  const n = hoja.getLastRow() - 1;
  if (n < 1) return;
  const claves = hoja.getRange(2, 1, n, 1).getValues();
  const formulas = hoja.getRange(2, COL_PRECIO_USD, n, 1).getFormulas();
  claves.forEach((r, i) => {
    if (String(r[0] || '').trim() && !formulas[i][0]) escribe_(hoja).getRange(i + 2, COL_PRECIO_USD).setFormula(formulaPrecioUsd_(i + 2));
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
function asegurarColumnasSat_(hoja, ss) {
  const n = ENCABEZADOS_CATALOGO.length;
  // Rapidez: G1:H1 se leen solo si no se revisaron hace poco (encabezadosRevisados_; ss = el libro del catálogo)
  const clave = ss ? claveEncabezados_(ss, hoja, 'Catalogo/SAT', ENCABEZADOS_CATALOGO.slice(6, n)) : '';
  const revisar = () => {
    const enc = hoja.getRange(1, 7, 1, 2).getValues()[0];
    if (!(enc[0] === ENCABEZADOS_CATALOGO[6] && enc[1] === ENCABEZADOS_CATALOGO[7])) {
      hoja.getRange('G:H').setNumberFormat('@'); // "01010101" no pierde el cero inicial
      escribe_(hoja).getRange(1, 7, 1, 2).setValues([ENCABEZADOS_CATALOGO.slice(6, n)])
        .setFontWeight('bold').setBackground('#2C3C5B').setFontColor('#FFFFFF');
      hoja.setColumnWidth(7, 110); hoja.setColumnWidth(8, 100);
    }
    if (clave) anotarEncabezados_(clave);
  };
  if (clave && encabezadosRevisados_(clave)) confiarEncabezados_(hoja, clave, revisar);
  else revisar();
}

function crearCatalogo_() {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.create('Catálogo Helgen');
  const hoja = ss.getSheets()[0].setName('Catalogo');
  const n = ENCABEZADOS_CATALOGO.length;

  escribe_(hoja).getRange(1, 1, 1, n).setValues([ENCABEZADOS_CATALOGO])
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
    if (filas.length) escribe_(hoja).getRange(2, 1, filas.length, n).setValues(filas);
    if (db.getSheets().length > 1) escribe_(db).deleteSheet(vieja); // los datos ya quedaron en el archivo nuevo
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
  if (!idGuardado_('SAT_ID')) {
    const lock = candado_();
    if (!lock.tryLock(60000)) throw new Error('Se está cargando el catálogo del SAT. Intenta en unos segundos.');
    try {
      if (!props.getProperty('SAT_ID')) importarCatalogosSat_();
    } finally {
      lock.releaseLock();
    }
  }
  return abrirLibro_(idGuardado_('SAT_ID'));
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
    if (hoja.getMaxRows() < filas.length) escribe_(hoja).insertRowsAfter(hoja.getMaxRows(), filas.length - hoja.getMaxRows());
    hoja.getRange('A:A').setNumberFormat('@');
    escribe_(hoja).getRange(1, 1, filas.length, filas[0].length).setValues(filas);
    hoja.getRange(1, 1, 1, filas[0].length).setFontWeight('bold').setBackground('#2C3C5B').setFontColor('#FFFFFF');
    hoja.setFrozenRows(1);
    anchos.forEach((w, i) => hoja.setColumnWidth(i + 1, w));
  };
  cargar(ss.getSheets()[0], 'ClaveProdServ', csvProd, [100, 600]);
  cargar(escribe_(ss).insertSheet(), 'ClaveUnidad', csvUni, [100, 320, 90]);
  escribe_(ss).insertSheet('Fuente').getRange(1, 1, 2, 1).setValues([[FUENTE_SAT],
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

  const lock = candado_();
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
      escribe_(hoja).getRange(iOriginal + 2, 1, 1, fila.length).setValues([fila]);
    } else {
      escribe_(hoja).appendRow(fila);
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
  // Una cotización anulada no sugiere a su cliente (§6.E)
  const filas = db_().getSheetByName('Cotizaciones').getDataRange().getValues().slice(1)
    .filter(r => !esAnulado_(r[0]))
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
  const datos = filas.filter(r => !esAnulado_(r[0])).reverse(); // las anuladas no salen en el historial (§6.E)
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

  const lock = candado_();
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
    // Rapidez: la fila 1 se lee solo si no se revisó hace poco (encabezadosRevisados_)
    const claveEnc = claveEncabezados_(db_(), hojaCot, 'Cotizaciones', ENCABEZADOS_COTIZACIONES);
    const revisarEnc = () => {
      const actuales = hojaCot.getRange(1, 1, 1, nCols).getValues()[0];
      if (ENCABEZADOS_COTIZACIONES.some((h, i) => actuales[i] !== h)) {
        escribe_(hojaCot).getRange(1, 1, 1, nCols).setValues([ENCABEZADOS_COTIZACIONES])
          .setFontWeight('bold').setBackground('#2C3C5B').setFontColor('#FFFFFF');
      }
      anotarEncabezados_(claveEnc);
    };
    if (!encabezadosRevisados_(claveEnc)) revisarEnc();
    else confiarEncabezados_(hojaCot, claveEnc, revisarEnc);
    const t = textoCelda;
    escribe_(hojaCot).appendRow([
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
  const filas = filasDatos_(hoja, 1);
  const enHoja = maxConsecutivo(filas.map(r => r[0]), prefijo, anio);
  const n = Math.max(Number(props.getProperty(clave) || 0), enHoja) + 1;
  props.setProperty(clave, String(n));
  return formatearFolio(prefijo, anio, n);
}

function carpetaDelAnio_(anio) {
  const raiz = DriveApp.getFolderById(idGuardado_('FOLDER_ID'));
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
  let hoja = ss.getSheetByName('Proyectos'), creada = false;
  if (!hoja) {
    creada = true;
    try {
      hoja = escribe_(ss).insertSheet('Proyectos');
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
  // Rapidez: la fila 1 se lee solo si no se revisó hace poco (encabezadosRevisados_, como en hojaDeArea_)
  const clave = claveEncabezados_(ss, hoja, 'Proyectos', ENCABEZADOS_PROYECTOS);
  const revisar = () => {
    const actuales = hoja.getRange(1, 1, 1, n).getValues()[0];
    if (ENCABEZADOS_PROYECTOS.some((h, i) => actuales[i] !== h)) {
      escribe_(hoja).getRange(1, 1, 1, n).setValues([ENCABEZADOS_PROYECTOS])
        .setFontWeight('bold').setBackground('#2C3C5B').setFontColor('#FFFFFF');
      hoja.getRange(1, COL_CLAVE_PROYECTO, hoja.getMaxRows(), 1).setNumberFormat('@'); // la clave es texto (columna L, al final)
    }
    anotarEncabezados_(clave);
  };
  if (creada || !encabezadosRevisados_(clave)) revisar();
  else confiarEncabezados_(hoja, clave, revisar);
  return hoja;
}

/** Proyectos con búsqueda por folio, clave, cliente o nombre. Por omisión solo los Activos; los más recientes primero. */
function listarProyectos(busqueda, incluirInactivos) {
  // El buscador de cotizaciones (solo activos) no muestra proyectos con contrato firmado
  const contratos = incluirInactivos ? {} : contratosCache_();
  return filtrarProyectos(proyectosVisibles_().filter(p => {
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

/** Filas de la pestaña Proyectos, leídas una vez por petición (filasEnPeticion_). */
function filasProyectos_(hoja) {
  const h = hoja || hojaProyectos_(), sufijo = sufijoFilas_(h);
  const leer = () => filasDatos_(h, ENCABEZADOS_PROYECTOS.length);
  return sufijo ? filasEnPeticion_('base' + sufijo, leer) : leer();
}

/** Proyecto por folio (con su número de fila), o null. */
function buscarProyecto_(hoja, folio) {
  const buscado = folioInterno(folio);
  if (!buscado) return null;
  const filas = filasProyectos_(hoja);
  if (!filas.length) return null;
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

  const lock = candado_();
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
    escribe_(hoja).appendRow([
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
    const filas = filasDatos_(hoja, ENCABEZADOS_PROYECTOS.length);
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
      if (aplicar) escribe_(hoja).getRange(i + 2, COL_CLAVE_PROYECTO).setNumberFormat('@').setValue(clave);
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
  const id = idGuardado_('PROYECTOS_FOLDER_ID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* se borró: se vuelve a crear abajo */ }
  }
  const padres = DriveApp.getFileById(idGuardado_('SPREADSHEET_ID')).getParents();
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
    if (proyecto.hoja && proyecto.fila) escribe_(proyecto.hoja).getRange(proyecto.fila, COL_CARPETA_PROYECTO).setValue(carpeta.getId());
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
  // R (incremento 6): fecha_esperada = fecha en que se espera cobrar la etapa (AAAA-MM-DD, opcional; la cambia cobranza aun con
  // el contrato firmado porque no cambia montos: guardarFechasEsperadas, §6.R). Se lee por nombre (colEsq_) y escribirEsquema_
  // la conserva por el nombre de la etapa al reescribir el esquema.
  Esquemas: { enc: ['proyecto_folio', 'orden', 'etapa', 'porcentaje', 'monto', 'fecha_esperada'], numeros: [2, 4, 5] },
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
/** Columna (desde 1) de un encabezado de Esquemas (R, incremento 6: fecha_esperada se busca por nombre). */
const colEsq_ = nombre => HOJAS_COBRANZA.Esquemas.enc.indexOf(nombre) + 1;

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
  // Rapidez: una vez por petición (buscarla y revisar que siga restringida cuesta dos viajes; varias funciones la piden)
  const yaVista = (MEMO_.carpetasArea || {})[area.propCarpeta];
  if (yaVista) return yaVista;
  const props = PropertiesService.getScriptProperties();
  const id = idGuardado_(area.propCarpeta);
  let carpeta = null;
  if (!id) {
    carpeta = privado_(DriveApp.createFolder(area.carpeta));
    props.setProperty(area.propCarpeta, carpeta.getId());
  } else {
    try { carpeta = DriveApp.getFolderById(id); } catch (e) { carpeta = null; }
    if (!carpeta || carpeta.isTrashed()) {
      throw new Error('No se encontró la carpeta de ' + area.que + ' (' + area.propCarpeta + '). Revisa la Papelera de Drive.');
    }
    privado_(carpeta);
  }
  (MEMO_.carpetasArea = MEMO_.carpetasArea || {})[area.propCarpeta] = carpeta;
  return carpeta;
}

/** Libro del área; la primera vez lo crea dentro de su carpeta (bajo candado). */
function libroArea_(area) {
  const props = PropertiesService.getScriptProperties();
  if (!idGuardado_(area.propLibro)) {
    const lock = candado_();
    if (!lock.tryLock(30000)) throw new Error('Se está preparando ' + area.que + '. Intenta de nuevo en unos segundos.');
    try {
      if (!props.getProperty(area.propLibro)) crearLibroArea_(area);
    } finally {
      lock.releaseLock();
    }
  }
  return abrirLibroArea_(area, idGuardado_(area.propLibro));
}

/** Libro del área si ya existe; null si todavía no se crea. */
function libroAreaSiExiste_(area) {
  const id = idGuardado_(area.propLibro);
  return id ? abrirLibroArea_(area, id) : null;
}

function abrirLibroArea_(area, id) {
  try {
    return abrirLibro_(id);
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
  if (sobrante && ss.getSheets().length > 1) escribe_(ss).deleteSheet(sobrante);
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
  let hoja = libro.getSheetByName(nombre), creada = false;
  if (!hoja) {
    hoja = escribe_(libro).insertSheet(nombre);
    creada = true;
    hoja.setFrozenRows(1);
    hoja.getRange(1, 1, hoja.getMaxRows(), def.enc.length).setNumberFormat('@'); // texto: nada se lee como fórmula
    def.numeros.forEach(c => hoja.getRange(2, c, hoja.getMaxRows() - 1, 1).setNumberFormat('#,##0.00##'));
  }
  // Rapidez: la fila 1 se lee solo si esta pestaña no se revisó hace poco (encabezadosRevisados_)
  const clave = claveEncabezados_(libro, hoja, nombre, def.enc);
  const revisar = () => {
    const actuales = hoja.getRange(1, 1, 1, def.enc.length).getValues()[0];
    if (def.enc.some((h, i) => actuales[i] !== h)) {
      escribe_(hoja).getRange(1, 1, 1, def.enc.length).setValues([def.enc])
        .setFontWeight('bold').setBackground('#2C3C5B').setFontColor('#FFFFFF');
    }
    anotarEncabezados_(clave);
  };
  if (creada || !encabezadosRevisados_(clave)) revisar();
  else confiarEncabezados_(hoja, clave, revisar);
  return hoja;
}

// ---- Rapidez (30/10/2026): encabezados ya revisados ----
// Revisar los encabezados de una pestaña cuesta leer su fila 1 (un viaje a Sheets) y se hacía en cada uso de la pestaña, varias
// veces por llamada. Una pestaña revisada (o reparada) queda anotada en la petición (MEMO_.enc) y en CacheService
// (ENCABEZADOS_OK) por máximo 6 h, con la firma de los encabezados que espera el código y el id de la pestaña: si una versión
// nueva agrega columnas, o alguien borra la pestaña y la vuelve a crear, se revisa otra vez; una pestaña recién creada por el
// código siempre se revisa. Solo se deja de leer la fila 1: los datos se siguen leyendo de la hoja. Lo único distinto: si
// alguien cambia o borra a mano la fila de encabezados de una pestaña que ya existe, se repara a más tardar 6 h después (antes,
// en la siguiente llamada que la usara). Las filas se leen por posición, así que eso no cambia lo que se lee.
const CACHE_ENCABEZADOS = 'ENCABEZADOS_OK';

/** Firma corta de un texto (djb2): cambia si cambia un encabezado esperado. */
function firmaTexto_(t) {
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Libro, pestaña (nombre e id) y encabezados esperados. */
function claveEncabezados_(libro, hoja, nombre, enc) {
  const idHoja = typeof hoja.getSheetId === 'function' ? hoja.getSheetId() : '';
  return libro.getId() + '/' + nombre + '/' + idHoja + '/' + enc.length + '.' + firmaTexto_(enc.join('\u0001'));
}

/** {clave: momento en que se revisó (ms)} de esta petición; se lee de CacheService una vez. */
function encabezadosOk_() {
  if (!MEMO_.enc) {
    let previo = {};
    try { previo = JSON.parse(CacheService.getScriptCache().get(CACHE_ENCABEZADOS) || '{}') || {}; } catch (e) { previo = {}; }
    MEMO_.enc = previo;
  }
  return MEMO_.enc;
}

function encabezadosRevisados_(clave) {
  const t = Number(encabezadosOk_()[clave]) || 0;
  return t > 0 && Date.now() - t < TTL_CACHE * 1000;
}

function anotarEncabezados_(clave) {
  const ok = encabezadosOk_(), ahora = Date.now();
  ok[clave] = ahora;
  // Solo las revisiones vigentes (cada una vence 6 h después de hecha, aunque el mapa se vuelva a guardar)
  Object.keys(ok).forEach(k => { if (!(ahora - Number(ok[k]) < TTL_CACHE * 1000)) delete ok[k]; });
  try { CacheService.getScriptCache().put(CACHE_ENCABEZADOS, JSON.stringify(ok), TTL_CACHE); } catch (e) { /* solo se pierde el ahorro */ }
}

/**
 * La fila 1 se dio por buena sin leerla (anotada en las últimas 6 h). La primera escritura de la petición en esa pestaña
 * (escribe_) revisa con getLastRow que no esté vacía: si alguien la vació a mano, corre `revisar` (repone los encabezados)
 * antes de escribir, como antes; así un renglón nuevo nunca cae en la fila 1. Sin forma de reconocer la pestaña después
 * (simulacros sin getSheetId/getName), se revisa ya.
 */
function confiarEncabezados_(hoja, clave, revisar) {
  const sufijo = sufijoFilas_(hoja);
  if (!sufijo) { revisar(); return; }
  if ((MEMO_.encVacia || {})[sufijo]) return; // ya se vio en esta petición que no está vacía
  const m = MEMO_.encConfiado || (MEMO_.encConfiado = {});
  (m[sufijo] = m[sufijo] || {})[clave] = revisar;
}

/** Filas de datos (sin encabezado) de una pestaña, con el ancho de sus encabezados. */
function filasCobranza_(hoja, nombre) {
  return filasDeArea_(hoja, HOJAS_COBRANZA, nombre);
}

function filasDeArea_(hoja, hojas, nombre) {
  const leer = () => filasDatos_(hoja, hojas[nombre].enc.length);
  // Rapidez: una vez por petición (filasEnPeticion_); el área fija el libro (compras, cobranza o administración)
  const area = hojas === HOJAS_COMPRAS ? 'compras' : hojas === HOJAS_COBRANZA ? 'cobranza' : hojas === HOJAS_ADMIN ? 'admin' : '';
  if (!area) return leer();
  const sufijo = sufijoFilas_(hoja);
  return sufijo ? filasEnPeticion_(area + sufijo, leer) : leer();
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
  // Un contrato anulado no cuenta: el proyecto queda sin aceptada y la siguiente se agrega en otra fila (§6.E)
  filasCobranza_(hC, 'Contratos').forEach((r, i) => {
    if (String(r[0]).toUpperCase() === f && String(r[7] || '') !== ESTADO_ANULADA) contrato = contratoDesdeFila_(r, i + 2);
  });
  const cF = colEsq_('fecha_esperada') - 1; // R (incremento 6)
  const etapas = filasCobranza_(hE, 'Esquemas')
    .filter(r => String(r[0]).toUpperCase() === f)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map(r => ({ etapa: String(r[2]), porcentaje: Number(r[3]), fechaEsperada: fechaIso_(r[cF]) }));
  const pagos = [];
  filasCobranza_(hP, 'Pagos').forEach((r, i) => {
    if (String(r[3]).toUpperCase() === f && String(r[18] || '') !== ESTADO_ANULADA) pagos.push(pagoDesdeFila_(r, i + 2));
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
    if (String(r[0] || '').trim() && String(r[7] || '') !== ESTADO_ANULADA) mapa[String(r[0]).toUpperCase()] = contratoDesdeFila_(r, i + 2);
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
  // Una anulada ni se muestra ni se puede aceptar (§6.E)
  return hoja.getDataRange().getValues().slice(1)
    .filter(r => String(r[19] || '').toUpperCase() === f && String(r[0] || '').trim() && !esAnulado_(r[0]))
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
  if (esAnulado_(proyecto.folio)) throw new Error('El proyecto ' + proyecto.folioVisible + ' está anulado.');
  return proyecto;
}

/** Renglón en la Bitacora del libro (cobranza por omisión; compras pasa HOJAS_COMPRAS: mismas columnas). */
function bitacora_(libro, accion, folio, detalle, motivo, hojas) {
  const t = textoCelda;
  escribe_(hojaDeArea_(libro, hojas || HOJAS_COBRANZA, 'Bitacora')).appendRow([
    Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss'), t(VENDEDOR_ ? VENDEDOR_.email : ''),
    t(accion), t(folio), t(detalle || ''), t(motivo || ''),
  ]);
}

/**
 * Reescribe las etapas del proyecto en "Esquemas" (borra las anteriores) con sus montos. R (incremento 6): conserva la fecha
 * esperada de cada etapa por su nombre (sin acentos ni mayúsculas); una etapa nueva o renombrada queda sin fecha (nunca se
 * le pasa la fecha de otra etapa).
 */
function escribirEsquema_(hoja, folio, etapas, total) {
  const f = String(folio).toUpperCase();
  const filas = filasCobranza_(hoja, 'Esquemas');
  const cF = colEsq_('fecha_esperada') - 1, fechas = {};
  for (let i = filas.length - 1; i >= 0; i--) {
    if (String(filas[i][0]).toUpperCase() === f) {
      const fecha = fechaIso_(filas[i][cF]);
      if (fecha) fechas[textoNormal(filas[i][2])] = fecha;
      escribe_(hoja).deleteRow(i + 2);
    }
  }
  montosDeEsquema(etapas, total).forEach((e, i) => escribe_(hoja).appendRow([f, i + 1, textoCelda(e.etapa), e.porcentaje, e.monto,
    textoFecha_(fechas[textoNormal(e.etapa)] || '')]));
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
    // R (incremento 6): fechas esperadas de cobro (esquema[i].fechaEsperada): con aceptada o firmado, no en un proyecto cancelado
    fechasEditables: !!c && d.etapas.length > 0 && proyecto.estado !== 'Cancelado',
    // Solo llega al rol de cobranza (vistaCobranza_ se llama después de exigirCobranza_)
    margen: c ? margenDeContrato_(c) : margenSinContrato_(proyecto.folio),
    metodos: METODOS_COBRO,
    hoy: hoyIso_(),
  };
}

/**
 * Margen del proyecto: contratado sin IVA − costos (fase 3: órdenes de compra vigentes; fase 4: nómina y horas se
 * agregan a la lista de costos). Si algo no cuadra (p. ej. una orden en otra moneda), {error} y la vista carga igual.
 */
function margenDeContrato_(contrato) {
  try {
    const ordenes = ordenesDeProyecto_(libroComprasSiExiste_(), contrato.proyectoFolio).filter(ocVigente);
    return margenProyecto(contrato.subtotal, contrato.moneda, costosDeOrdenes(ordenes, contrato.moneda));
  } catch (e) {
    return { error: 'No se pudo calcular el margen: ' + e.message };
  }
}

/** Sin cotización aceptada no hay margen: solo el costo de las órdenes de compra vigentes, por moneda. null si no hay. */
function margenSinContrato_(proyectoFolio) {
  try {
    const ordenes = ordenesDeProyecto_(libroComprasSiExiste_(), proyectoFolio).filter(ocVigente);
    return ordenes.length ? { sinContrato: true, costos: costosDeOrdenes(ordenes, 'MXN') } : null;
  } catch (e) {
    return { error: 'No se pudo calcular el costo de las órdenes: ' + e.message };
  }
}

/** Candado de script (el mismo de folios) alrededor de una función. */
function conCandado_(f) {
  const lock = candado_();
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
  if (!idGuardado_(AREA_COBRANZA.propLibro)) libroCobranza_();
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
  // Lo anulado no cuenta (§6.E): contratos, pagos y órdenes por su estado; proyectos por el registro de Anulaciones
  const contratos = filasCobranza_(hojaCobranza_(libro, 'Contratos'), 'Contratos')
    .map((r, i) => contratoDesdeFila_(r, i + 2)).filter(c => c.proyectoFolio && c.estado !== ESTADO_ANULADA);
  const esquemas = filasCobranza_(hojaCobranza_(libro, 'Esquemas'), 'Esquemas')
    .map(r => ({ proyectoFolio: String(r[0]), orden: Number(r[1]), etapa: String(r[2]), porcentaje: Number(r[3]) }));
  const pagos = filasCobranza_(hojaCobranza_(libro, 'Pagos'), 'Pagos').map((r, i) => pagoDesdeFila_(r, i + 2))
    .filter(p => p.estado !== ESTADO_ANULADA);
  const proyectos = proyectosVisibles_();
  const libroCompras = libroComprasSiExiste_();
  const ordenes = libroCompras
    ? filasDeArea_(hojaCompras_(libroCompras, 'OrdenesCompra'), HOJAS_COMPRAS, 'OrdenesCompra')
      .map((r, i) => String(r[0] || '').trim() ? ordenDesdeFila_(r, i + 2) : null).filter(o => o && o.estado !== ESTADO_ANULADA)
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
      .find(o => ocVigente(o) && o.monedaProyecto && o.monedaProyecto !== cot.moneda);
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
    if (c) escribe_(d.hojas.contratos).getRange(c.fila, 1, 1, fila.length).setValues([fila]);
    else escribe_(d.hojas.contratos).appendRow(fila);
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
    escribe_(d.hojas.contratos).getRange(c.fila, 8).setValue(ESTADO_FIRMADO);
    escribe_(d.hojas.contratos).getRange(c.fila, 11, 1, 3).setValues([[textoFecha_(fechaFirma), textoCelda(VENDEDOR_.email),
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
    escribe_(d.hojas.contratos).getRange(c.fila, 8).setValue(ESTADO_ACEPTADA);
    escribe_(d.hojas.contratos).getRange(c.fila, 11, 1, 3).setValues([['', '',
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
    escribe_(hojaPagos).appendRow([
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
    if (pago.estado === ESTADO_ANULADA) throw new Error('El pago ' + folio + ' está anulado.');
    if (pago.estado !== 'Vigente') throw new Error('El pago ' + folio + ' ya está cancelado.');
    escribe_(hoja).getRange(pago.fila, 19, 1, 4).setValues([['Cancelado', textoCelda(VENDEDOR_.email),
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
      'req_folio', 'dias_credito',
      // Incremento 4 (centro de mando): En camino (paquetería, guía, fecha estimada, cuándo y quién lo marcó)
      'paqueteria', 'guia', 'fecha_estimada', 'en_camino_en', 'en_camino_por',
      // Incremento 5 (F): forma de pago de la orden (FORMAS_PAGO_OC; se busca por nombre; vacía en órdenes de antes)
      'forma_pago',
      // Incremento 6 (P): plan de pagos opcional (JSON [{concepto, porcentaje}], suma 100; se busca por nombre; vacío = sin plan)
      'plan_pago'],
    numeros: [15, 16, 17, 18, 20, 21],
  },
  // dias_credito (H): crédito habitual del proveedor; precarga las órdenes nuevas (la orden guarda el suyo en AJ). Desde el
  // incremento 5 (F) también es el "días de crédito habituales" de la ficha. Las columnas I:Z son la ficha del proveedor (6.F):
  // datos bancarios, forma de pago habitual y documentos (CSF, carátula bancaria, comprobante de domicilio) con su fecha
  Proveedores: { enc: ['id', 'razon_social', 'rfc', 'contacto', 'correo', 'telefono', 'actualizado', 'dias_credito',
    'direccion', 'banco', 'clabe', 'cuenta', 'titular', 'forma_pago_habitual', 'csf_id', 'csf_url', 'csf_fecha', 'caratula_id',
    'caratula_url', 'caratula_fecha', 'domicilio_id', 'domicilio_url', 'domicilio_fecha', 'notas', 'activo', 'actualizo'], numeros: [] },
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
      'cancelado_por', 'fecha_cancelacion', 'motivo_cancelacion',
      // Incremento 5 (módulo H): foto del renglón en Drive (se buscan por nombre con colMov_)
      'foto_id', 'foto_url'],
    numeros: [9, 13],
  },
  // inventario_item (incremento 4): código del ítem en el centro de mando (opcional; sin ítem = "por ligar" allá)
  RequisicionesRenglones: { enc: ['req_folio', 'version', 'renglon', 'descripcion', 'cantidad', 'unidad', 'notas', 'inventario_item'],
    numeros: [2, 3, 5] },
  // Historial que ve el solicitante (estado, quién y cuándo); sin montos
  RequisicionesEventos: { enc: ['req_folio', 'fecha', 'estado', 'correo', 'nombre', 'nota'], numeros: [] },
  PagosProveedores: {
    enc: ['folio', 'fecha_pago', 'fecha_registro', 'oc_folio', 'req_folio', 'proyecto_folio', 'monto', 'moneda_pago',
      'tipo_cambio', 'monto_aplicado', 'moneda_oc', 'metodo', 'referencia', 'comprobante_id', 'comprobante_url',
      'registro_email', 'registro_nombre', 'estado', 'cancelado_por', 'fecha_cancelacion', 'motivo_cancelacion',
      // Incremento 6 (P): Anticipo · Parcial · Liquidación (vacía en pagos de antes: eran el pago completo de la orden)
      'tipo'],
    numeros: [7, 9, 10],
  },
  Bitacora: { enc: ['fecha', 'correo', 'accion', 'proyecto_folio', 'detalle', 'motivo'], numeros: [] },
  // Avisos al centro de mando (incremento 4, 6.C): cada aviso se escribe aquí antes de mandarse (Pendiente) y queda Enviado
  // cuando el centro de mando lo acepta; el activador de 15 minutos reintenta los pendientes. Nunca se borran filas.
  PortalPendientes: { enc: ['evento_id', 'cuerpo', 'intentos', 'ultimo_error', 'creado', 'estado', 'enviado'], numeros: [] },
  // Devoluciones DEV-AAAA-NNNN (incremento 5, módulo H): material equivocado o dañado; compras resuelve. Nunca se borran filas.
  // origen_clave: (OC, renglón, foto o comentario) de un problema reportado en el centro de mando (no se crea dos veces)
  Devoluciones: {
    enc: ['folio', 'fecha', 'req_folio', 'oc_folio', 'proyecto_folio', 'renglon', 'descripcion', 'cantidad', 'tipo', 'comentario',
      'foto_id', 'foto_url', 'origen', 'reporto_email', 'estado', 'resolucion', 'nota_resolucion', 'guia_devolucion',
      'resolvio_email', 'fecha_resolucion', 'origen_clave'],
    numeros: [6, 8],
  },
};
const COL_ESTADO_OC = 29; // AC: estado, recepción (AD:AE) y cancelación (AF:AH)
/** Columna (desde 1) de un encabezado de OrdenesCompra (las del centro de mando se buscan por nombre). */
const colOc_ = nombre => HOJAS_COMPRAS.OrdenesCompra.enc.indexOf(nombre) + 1;

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
  const dias = r[35] === '' || r[35] == null ? diasCreditoDeCondiciones(r[12]) : diasCreditoGuardados(r[35]);
  return {
    // Forma de pago (F, incremento 5): la guardada o, en órdenes de antes, la que dicen sus días de crédito (formaPagoDeOrden)
    formaPago: formaPagoDeOrden(r[colOc_('forma_pago') - 1], dias),
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
    diasCredito: dias, fila: fila,
    // En camino (centro de mando): paquetería, guía, fecha estimada, cuándo y quién
    paqueteria: String(r[colOc_('paqueteria') - 1] || ''), guia: String(r[colOc_('guia') - 1] || ''),
    fechaEstimada: fechaIso_(r[colOc_('fecha_estimada') - 1]), enCaminoEn: fechaTexto_(r[colOc_('en_camino_en') - 1]),
    enCaminoPor: String(r[colOc_('en_camino_por') - 1] || ''),
    // P (incremento 6): plan de pagos (null = sin plan; una celda que no se entiende se ignora)
    planPago: planDeCelda(r[colOc_('plan_pago') - 1]),
  };
}

/** Órdenes de un proyecto, en orden de registro (sin las anuladas: no se ven ni cuentan). Sin libro de compras: ninguna. */
function ordenesDeProyecto_(libro, folio) {
  if (!libro) return [];
  const f = String(folio || '').toUpperCase();
  const lista = [];
  filasDeArea_(hojaCompras_(libro, 'OrdenesCompra'), HOJAS_COMPRAS, 'OrdenesCompra').forEach((r, i) => {
    if (String(r[2]).toUpperCase() === f && String(r[0] || '').trim() && String(r[28] || '') !== ESTADO_ANULADA && !esAnulado_(r[0])) {
      lista.push(ordenDesdeFila_(r, i + 2));
    }
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
  if (existente) escribe_(hoja).getRange(existente.fila, 1, 1, fila.length).setValues([fila]);
  else escribe_(hoja).appendRow(fila);
  return Object.assign(datos, { id: id });
}

/** Proyecto existente (o error). */
function proyectoParaCompras_(folio) {
  const proyecto = buscarProyecto_(hojaProyectos_(), folio);
  if (!proyecto) throw new Error('No existe el proyecto ' + String(folio || '').toUpperCase() + '.');
  if (esAnulado_(proyecto.folio)) throw new Error('El proyecto ' + proyecto.folioVisible + ' está anulado.');
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
  // Rapidez: moneda y línea del caché de contratos (como listarProyectosCompras; en una escritura se lee de la hoja)
  const m = monedaDeProyecto_(contratosCache_()[proyecto.folio.toUpperCase()] || null);
  const facturas = facturasDelLibro_(libro);
  const ordenes = ordenesDeProyecto_(libro, proyecto.folio);
  // P (incremento 6): lo pagado y el saldo de cada orden (varios pagos; compras sí ve montos)
  const pagos = ordenes.length ? pagosProvPorOc_(libro) : {}, movs = ordenes.length ? movimientosPorOc_(libro) : {};
  return {
    proyecto: datosProyectoCompras_(proyecto),
    moneda: m.moneda,
    marca: m.marca,
    sinContrato: m.sinContrato,
    ordenes: ordenes.map(o => {
      const s = saldoDeOrden_(libro, o, movs[o.folio.toUpperCase()] || [], facturas, pagos[o.folio.toUpperCase()] || []);
      return Object.assign(sinFila_(o), {
        facturas: facturasDeOrden_(facturas, o.folio), puedeFacturar: o.estado !== OC_CANCELADA,
        totalFacturado: totalFacturadoDeOrden(facturas, o.folio),
        pagado: s.pagado, saldo: s.saldo, pagadaParcial: o.estado === OC_EMITIDA && !s.completo && s.pagado > 0, siguiente: s.siguiente,
      });
    }).reverse(),
    hoy: hoyIso_(),
  };
}

/** Proyectos Activos y Cerrados (con o sin contrato; sin montos), con la moneda de sus órdenes, para ver sus órdenes. */
function listarProyectosCompras(busqueda) {
  exigirCompras_();
  const contratos = contratosCache_();
  return filtrarProyectos(proyectosVisibles_().filter(p => p.estado !== 'Cancelado'), busqueda, true, 50)
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
  const filaOc = [
    folio, textoFecha_(hoyIso_()), proyecto.folio, MARCAS[c.marca] || '', t(proveedor.id), t(proveedor.razonSocial), t(proveedor.rfc),
    t(proveedor.contacto), t(proveedor.correo), t(proveedor.telefono), textoFecha_(oc.fechaEntrega), t(oc.lugarEntrega),
    t(oc.condicionesPago), oc.moneda, oc.ivaTasa, oc.subtotal, oc.iva, oc.total, oc.monedaProyecto, oc.tipoCambio,
    oc.subtotalProyecto, JSON.stringify(oc.renglones), t(oc.notas), archivo.getId(), archivo.getUrl(), t(correoElaboro),
    t(elaboro), Utilities.formatDate(ahora, 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss'), OC_EMITIDA, '', '', '', '', '',
    reqFolio || '', oc.diasCredito,
  ];
  // F (incremento 5): forma de pago en su columna (por nombre, al final; las del centro de mando quedan vacías)
  while (filaOc.length < colOc_('plan_pago')) filaOc.push('');
  filaOc[colOc_('forma_pago') - 1] = oc.formaPago;
  filaOc[colOc_('plan_pago') - 1] = oc.planPago ? JSON.stringify(oc.planPago) : ''; // P (incremento 6): plan de pagos opcional
  escribe_(hoja).appendRow(filaOc);
  bitacora_(libro, 'Emitir orden de compra', proyecto.folio, folio + (reqFolio ? ' · ' + reqFolio : '') + ' · ' +
    proveedor.razonSocial + ' · ' + formatoMoneda(oc.total) + ' ' + oc.moneda + ' · ' + oc.formaPago + ' · ' +
    (oc.planPago ? 'plan: ' + textoPlanPago(oc.planPago) + ' · ' : '') +
    (oc.diasCredito ? 'crédito ' + oc.diasCredito + ' días' : 'contado') + (oc.tipoCambio ? ' · TC ' + oc.tipoCambio + ' = ' +
    formatoMoneda(oc.subtotalProyecto) + ' ' + oc.monedaProyecto + ' sin IVA' : '') + ' · ' + (MARCAS[c.marca] || 'sin contrato'), '', HOJAS_COMPRAS);
  // avisoProveedor (F): documentos que le faltan al proveedor (no bloquea la orden; sin CSF y carátula no se le podrá pagar)
  return { folio: folio, url: archivo.getUrl(), total: oc.total, moneda: oc.moneda,
    avisoProveedor: avisoDeProveedor_(libro, proveedor.id, proveedor.razonSocial) };
}

/** Compras/AAAA/<folio del proyecto>/ (restringidas de arriba abajo: un permiso heredado no se puede quitar en el hijo). */
function carpetaProyectoCompras_(proyectoFolio) {
  const anio = String(proyectoFolio).split('-')[1] || hoyIso_().slice(0, 4);
  return privado_(subcarpeta_(privado_(subcarpeta_(carpetaCompras_(), anio)), proyectoFolio));
}

/** Busca una orden por folio en el libro de compras (o error). */
function buscarOrden_(libro, folioOc, conAnuladas) {
  const folio = String(folioOc || '').trim().toUpperCase();
  const hoja = hojaCompras_(libro, 'OrdenesCompra');
  let orden = null;
  filasDeArea_(hoja, HOJAS_COMPRAS, 'OrdenesCompra').forEach((r, i) => {
    if (String(r[0]).toUpperCase() === folio) orden = ordenDesdeFila_(r, i + 2);
  });
  if (!orden) throw new Error('No existe la orden de compra ' + folio + '.');
  if (orden.estado === ESTADO_ANULADA && !conAnuladas) throw new Error('La orden de compra ' + orden.folio + ' está anulada.');
  return { hoja: hoja, orden: orden };
}

/**
 * Cancela una orden Emitida (no se borra), con motivo; queda en la Bitacora y deja de contar en el margen. Una pagada o
 * recibida ya no se cancela. Su requisición regresa a Solicitada (sin orden) para autorizarla de nuevo.
 * Incremento 4: si su requisición va En camino, el motivo debe explicarlo (≥ 10 caracteres) y hay que confirmarlo
 * (confirmado = true; sin él devuelve {confirmar, mensaje} sin cambiar nada). Avisa oc.cancelada al centro de mando.
 */
function cancelarOrdenCompra(folioOc, motivo, confirmado) {
  exigirCompras_();
  const m = motivoObligatorio_(motivo, 'Escribe el motivo de la cancelación.');
  const libro = libroCompras_();
  const sinRevisar = recepcionesAntesDeCancelar_(folioOc); // lo que ya se recibió en el sitio cuenta (y frena la cancelación)
  return conAvisoPortal_(conCandado_(() => {
    const { hoja, orden } = buscarOrden_(libro, folioOc);
    if (orden.estado === OC_CANCELADA) throw new Error('La orden ' + orden.folio + ' ya está cancelada.');
    if (orden.estado === OC_PAGADA) throw new Error('La orden ' + orden.folio + ' ya está pagada: no se puede cancelar.');
    if (orden.estado !== OC_EMITIDA) throw new Error('La orden ' + orden.folio + ' ya se recibió: no se puede cancelar.');
    // P (incremento 6): una orden Emitida con pagos parciales tampoco (primero se cancelan sus pagos)
    const pagadas = pagosDeOrden_(libro, orden.folio).filter(p => p.estado === 'Vigente').map(p => p.folio);
    if (pagadas.length) {
      throw new Error('La orden ' + orden.folio + ' tiene pagos registrados (' + pagadas.join(', ') + '): cancélalos primero.');
    }
    const reqDeOrden = orden.reqFolio ? buscarReq_(libro, orden.reqFolio).req : null;
    if (reqDeOrden && reqDeOrden.estado === REQ_EN_CAMINO && reqDeOrden.ocFolio.toUpperCase() === orden.folio.toUpperCase()) {
      if (m.length < 10) {
        throw new Error('El material de la orden ' + orden.folio + ' ya va en camino: escribe un motivo que explique la cancelación (mínimo 10 caracteres).');
      }
      if (confirmado !== true) {
        return { confirmar: true, mensaje: 'El material de la orden ' + orden.folio + ' ya va en camino (' + textoEnCamino(orden) +
          '). Si la cancelas, el centro de mando quita lo que está en tránsito.' + (sinRevisar ? ' Ojo: no se pudo revisar si ya ' +
          'llegó algo al sitio (' + sinRevisar + '); si llegó, aparecerá como alerta en el estado del centro de mando.' : '') +
          ' ¿Cancelar la orden?' };
      }
    }
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
    // F (incremento 5): con crédito del proveedor una orden Emitida (sin pagar) ya puede estar recibida (flujo de siempre)
    if (orden.fechaRecepcion) throw new Error('La orden ' + orden.folio + ' ya se recibió (falta pagarla): no se puede cancelar.');
    escribe_(hoja).getRange(orden.fila, COL_ESTADO_OC).setValue(OC_CANCELADA);
    escribe_(hoja).getRange(orden.fila, COL_ESTADO_OC + 3, 1, 3).setValues([[textoCelda(VENDEDOR_.email),
      Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss'), textoCelda(m)]]);
    bitacora_(libro, 'Cancelar orden de compra', orden.proyectoFolio, orden.folio + ' · ' + orden.proveedor + ' · ' +
      formatoMoneda(orden.total) + ' ' + orden.moneda, m, HOJAS_COMPRAS);
    notificar_('oc.cancelada', { req: orden.reqFolio, oc: orden.folio, proyecto: orden.proyectoFolio, nota: m }); // correo (6.B)
    if (orden.reqFolio) {
      const { hoja: hR, req } = buscarReq_(libro, orden.reqFolio);
      if ((req.estado === REQ_AUTORIZADA || req.estado === REQ_EN_CAMINO) && req.ocFolio.toUpperCase() === orden.folio.toUpperCase()) {
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
    avisarPortal_('oc.cancelada', orden.folio);
    SpreadsheetApp.flush();
    return vistaCompras_(libro, proyectoParaCompras_(orden.proyectoFolio));
  }));
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
  // Alguien en Permisos con el rol aprobaciones propio (un super admin solo no lo enciende). Cuenta también a quien está
  // desactivado: desactivar al único que aprueba no debe apagar el flujo sin avisar (revisión de seguridad, 28/10/2026); para
  // apagarlo hay que quitar el rol en Permisos a propósito.
  const u = contextoRoles_().usuarios;
  return Object.keys(u).some(c => u[c].roles.indexOf('aprobaciones') !== -1);
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
    escribe_(hoja).getRange(req.fila, COLS_REQ[k]).setValue(celda);
    req[k] = v;
  });
}

/** Requisición por folio (o error). */
function buscarReq_(libro, folioReq, conAnuladas) {
  const folio = String(folioReq || '').trim().toUpperCase();
  const hoja = hojaReq_(libro);
  let req = null;
  filasDeArea_(hoja, HOJAS_COMPRAS, 'Requisiciones').forEach((r, i) => {
    if (String(r[0]).toUpperCase() === folio) req = reqDesdeFila_(r, i + 2);
  });
  if (!req) throw new Error('No existe la requisición ' + folio + '.');
  if (req.estado === ESTADO_ANULADA && !conAnuladas) throw new Error('La requisición ' + req.folio + ' está anulada.');
  return { hoja: hoja, req: req };
}

/** Cambia estado (y otros campos) de una requisición en su fila. extra = {motivo, ocFolio, revisar (bool), notasRecepcion}. */
function cambiarReq_(hoja, req, estado, extra) {
  const x = extra || {};
  const ahora = Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss');
  const t = textoCelda;
  escribe_(hoja).getRange(req.fila, 6, 1, 2).setValues([[estado, t('motivo' in x ? x.motivo : req.motivo)]]);
  if ('ocFolio' in x) escribe_(hoja).getRange(req.fila, 10).setValue(x.ocFolio);
  if (x.revisar) escribe_(hoja).getRange(req.fila, 11, 1, 2).setValues([[t(VENDEDOR_.email), ahora]]);
  escribe_(hoja).getRange(req.fila, 13).setValue(ahora);
  if ('notasRecepcion' in x) escribe_(hoja).getRange(req.fila, 14).setValue(t(x.notasRecepcion));
  req.estado = estado;
}

/** Renglón del historial que ve el solicitante (sin montos). */
function eventoReq_(libro, folio, estado, nota) {
  const t = textoCelda;
  escribe_(hojaCompras_(libro, 'RequisicionesEventos')).appendRow([folio,
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
      const ren = { renglon: Number(r[2]) || x.renglones.length + 1, descripcion: String(r[3] || ''), cantidad: Number(r[4]) || 0,
        unidad: String(r[5] || ''), notas: String(r[6] || '') };
      if (String(r[7] || '').trim()) ren.item = String(r[7]).trim(); // ítem del centro de mando (solo si tiene)
      x.renglones.push(ren);
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
  // inventario_item (H) solo si el renglón tiene ítem del centro de mando
  renglones.forEach((r, i) => escribe_(hoja).appendRow([folio, version, i + 1, t(r.descripcion), r.cantidad, t(r.unidad), t(r.notas)]
    .concat(r.item ? [t(r.item)] : [])));
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
    // Incremento 5 (H): foto del renglón (un id "centro:…" = foto del centro de mando que todavía no llega a Drive)
    fotoId: String(r[colMov_('foto_id') - 1] || ''), fotoUrl: String(r[colMov_('foto_url') - 1] || ''),
  };
}
/** Columna (desde 1) de un encabezado de MovimientosInventario (las de la foto se buscan por nombre). */
const colMov_ = nombre => HOJAS_COMPRAS.MovimientosInventario.enc.indexOf(nombre) + 1;

/**
 * {FOLIO DE LA ORDEN: [movimientos]} de las entradas por compra y, desde el incremento 5, de las devoluciones (cantidad
 * negativa: avanceRecepcion las descuenta). Sin libro: ninguno.
 */
function movimientosPorOc_(libro) {
  const mapa = {};
  if (!libro) return mapa;
  filasDeArea_(hojaCompras_(libro, 'MovimientosInventario'), HOJAS_COMPRAS, 'MovimientosInventario').forEach((r, i) => {
    const m = movDesdeFila_(r, i + 2);
    if (!m.folio || !cuentaEnRecepcion(m.tipo) || m.estado === ESTADO_ANULADA) return; // anuladas: ni se ven ni cuentan
    const f = m.ocFolio.toUpperCase();
    (mapa[f] = mapa[f] || []).push(m);
  });
  return mapa;
}

/** Recepciones (agrupadas por folio REC) de una lista de movimientos, en orden de registro. conEvidencia: incluye la liga. */
function recepcionesDe_(movs, conEvidencia) {
  const porFolio = {}, orden = [];
  (movs || []).forEach(m => {
    if (m.tipo && m.tipo !== TIPO_ENTRADA_COMPRA) return; // H: las devoluciones se ven en su lista (DEV-…), no como recepción
    let x = porFolio[m.folio];
    if (!x) {
      x = porFolio[m.folio] = { folio: m.folio, fecha: m.fecha, registro: m.fechaRegistro, nombre: m.nombre, correo: m.correo,
        sitio: m.sitio, notas: m.notas, estado: m.estado, motivoCancelacion: m.motivoCancelacion, renglones: [] };
      if (conEvidencia) x.evidenciaUrl = m.evidenciaUrl;
      orden.push(x);
    }
    x.renglones.push(Object.assign({ renglon: m.renglon, descripcion: m.descripcion, unidad: m.unidad, cantidad: m.cantidad },
      conEvidencia && /^https?:/.test(m.fotoUrl || '') ? { fotoUrl: m.fotoUrl } : {})); // H: "Ver foto" (compras)
  });
  return orden;
}

/** {FOLIO: orden} de todas las órdenes del libro. */
function ordenesPorFolio_(libro) {
  const mapa = {};
  if (!libro) return mapa;
  filasDeArea_(hojaCompras_(libro, 'OrdenesCompra'), HOJAS_COMPRAS, 'OrdenesCompra').forEach((r, i) => {
    if (String(r[0] || '').trim() && String(r[28] || '') !== ESTADO_ANULADA && !esAnulado_(r[0])) mapa[String(r[0]).toUpperCase()] = ordenDesdeFila_(r, i + 2);
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
 * pagos. x = {flujo, yo, orden, movimientos, centro (centroDeReq_: proyecto ligado al centro de mando, o null)}.
 * Proyecto ligado: el material se recibe en el centro de mando (aquí no hay "Registrar lo que llegó" ni "Recibí el material");
 * quien pidió puede registrar el envío (En camino) y quien recibe o quien pidió, "Lo recogí".
 */
function reqParaSolicitante_(req, ren, eventos, proyectos, x) {
  const p = proyectos[req.proyectoFolio.toUpperCase()];
  const o = x || {}, flujo = !!o.flujo, yo = o.yo || '', centro = o.centro || null;
  const orden = ocVigente(o.orden) &&
    [REQ_AUTORIZADA, REQ_PAGADA, REQ_EN_CAMINO, REQ_RECIBIDA, REQ_CERRADA].indexOf(req.estado) !== -1 ? o.orden : null;
  const avance = orden ? avanceRecepcion(orden.renglones, o.movimientos, renglonesSinRecepcion(propuestaVigente_(req))) : null;
  const recibe = req.recibeEmail || req.solicitanteEmail;
  const ocPagada = !!orden && orden.estado === OC_PAGADA;
  const porEnviar = !!orden && [REQ_AUTORIZADA, REQ_PAGADA, REQ_EN_CAMINO].indexOf(req.estado) !== -1;
  // F (incremento 5): con crédito del proveedor se confirma que llegó con la orden sin pagar (queda Recibida; el pago la cierra)
  const antesDePagar = recibirSinPagarPosible_(req, orden);
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
    // En camino y ya pagada también se cierra; un proyecto ligado se recibe en el centro de mando
    puedeCerrar: !flujo && !centro && (req.estado === REQ_PAGADA || (req.estado === REQ_EN_CAMINO && ocPagada) || antesDePagar) &&
      yo === req.solicitanteEmail,
    // Con operaciones se recibe renglón por renglón (también las requisiciones de antes que ya tenían orden)
    puedeRecibir: flujo && !centro && !!avance && !avance.completo &&
      [REQ_AUTORIZADA, REQ_PAGADA, REQ_EN_CAMINO].indexOf(req.estado) !== -1 && (yo === req.solicitanteEmail || yo === recibe),
    // Centro de mando (incremento 4): dónde se recibe y el envío (sin montos ni proveedor)
    centroMando: centro ? { sitio: centro.sitio, sitioCodigo: centro.sitioCodigo } : null,
    // P (incremento 6): etiqueta "Pagada parcial" (la orden tiene pagos que no la completan); nunca montos ni pagos
    pagadaParcial: !!orden && pagoParcialDe_(orden),
    enCamino: orden && orden.enCaminoEn ? { paqueteria: orden.paqueteria, guia: orden.guia, fechaEstimada: orden.fechaEstimada,
      en: orden.enCaminoEn, recogido: esRecogido(orden.paqueteria) } : null,
    puedeEnCamino: porEnviar && yo === req.solicitanteEmail,
    puedeRecoger: porEnviar && (yo === recibe || yo === req.solicitanteEmail),
  };
}

/**
 * Proyectos donde se pueden pedir materiales: Activos y Cerrados, con o sin contrato (los Cancelados no). Solo folio, clave
 * y nombre (sin cliente ni montos); se busca por folio, clave y nombre.
 */
function listarProyectosRequisicion(busqueda) {
  exigirRequisicion_();
  const q = textoNormal(busqueda);
  return proyectosVisibles_().slice().reverse()
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
  // La clave lleva los proyectos ligados al centro de mando (cambian lo que se puede hacer en cada requisición)
  return enCache_('misReq_' + (flujo ? 'op_' : '') + firmaCentro_() + yo, ['requisiciones', 'oc', 'pagosProveedores', 'proyectos'],
    TTL_CACHE, soloSiHay ? null : () => misRequisicionesDeHojas_(yo, flujo)) || null;
}

function misRequisicionesDeHojas_(yo, flujo) {
  const libro = libroComprasSiExiste_(); // solo lee: el libro lo crea la primera requisición
  if (!libro) return [];
  const ren = renglonesDeReqs_(libro), ev = eventosDeReqs_(libro), proyectos = nombresDeProyectos_();
  const cfg = configPortal_(), det = cfg.activo ? sitiosDetalle_() : [];
  const lista = [];
  let ordenes = null, movs = null;
  filasDeArea_(hojaReq_(libro), HOJAS_COMPRAS, 'Requisiciones').forEach((r, i) => {
    const req = reqDesdeFila_(r, i + 2);
    // Quien recibe la ve desde que hay orden de compra; las anuladas no se ven
    if (!req.folio || req.estado === ESTADO_ANULADA || esAnulado_(req.folio) || (req.solicitanteEmail !== yo && !(req.recibeEmail === yo && req.ocFolio))) return;
    const f = req.folio.toUpperCase();
    let orden = null, m = [];
    if (req.ocFolio) {
      if (!ordenes) { ordenes = ordenesPorFolio_(libro); movs = movimientosPorOc_(libro); pagosProvPorOc_(libro); }
      orden = ordenes[req.ocFolio.toUpperCase()] || null;
      m = movs[req.ocFolio.toUpperCase()] || [];
      if (orden) orden.pagoParcial = pagoParcialDe_(orden); // P: con un pago parcial también se recibe (recibeAntesDePagar_)
    }
    lista.push(Object.assign(reqParaSolicitante_(req, ren[f], ev[f], proyectos, { flujo: flujo, yo: yo, orden: orden, movimientos: m,
      centro: centroDeReq_(req, cfg, det) }), recepcionParaSolicitante_(libro, req, orden, m, yo))); // H: devoluciones y fotos
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
  // Proyecto ligado al centro de mando: el sitio es obligatorio y con código (VER, ZLO…), porque allá se recibe el material
  const ligadoNuevo = !reenvio && proyectoLigado_(d0.proyectoFolio);
  const sitio = sitioDeLista(d0.sitio, sitios_(), flujo && !reenvio);
  if (ligadoNuevo) sitioConCodigo_(sitio);
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
      if (proyectoLigado_(req.proyectoFolio)) sitioConCodigo_(sitio || req.sitio);
      folio = req.folio;
      version = ((renglonesDeReqs_(libro)[folio.toUpperCase()] || {}).version || 1) + 1;
      if (bytes) {
        const archivo = privado_(carpetaRequisiciones_(req.proyectoFolio).createFile(Utilities.newBlob(bytes, tipo.mime,
          nombreArchivoReq(folio, 'Cotización', tipo.ext, version))));
        escribe_(hoja).getRange(req.fila, 8, 1, 2).setValues([[archivo.getId(), archivo.getUrl()]]);
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
      escribe_(hoja).appendRow([folio, textoFecha_(hoyIso_()), proyecto.folio, t(yo),
        t([VENDEDOR_.nombre, VENDEDOR_.apellido].filter(Boolean).join(' ') || yo), REQ_SOLICITADA, '', archivo ? archivo.getId() : '',
        archivo ? archivo.getUrl() : '', '', '', '', ahora, '', t(sitio), textoFecha_(fechaRequerida), '', '', '', '', '', '', '', '', '']);
      escribirRenglonesReq_(libro, folio, 1, renglones);
      eventoReq_(libro, folio, REQ_SOLICITADA, [sitio, fechaRequerida ? 'se necesita el ' + fechaRequerida : ''].filter(Boolean).join(' · '));
      bitacora_(libro, 'Solicitar requisición', proyecto.folio, folio + ' · ' + renglones.length + ' renglón(es)' +
        (sitio ? ' · ' + sitio : '') + (archivo ? '' : ' · sin cotización'), '', HOJAS_COMPRAS);
    }
    notificar_('req.solicitada', { req: folio, reenviada: reenvio }); // correo a quien la revisa (6.B)
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
    const antes = req.estado;
    cambiarReq_(hoja, req, transicionReq(req.estado, 'cancelar'), { motivo: m });
    eventoReq_(libro, req.folio, REQ_CANCELADA, m);
    notificar_('req.cancelada', { req: req.folio, antes: antes, nota: m }); // correo a quien la esperaba (6.B)
    bitacora_(libro, 'Cancelar requisición', req.proyectoFolio, req.folio, m, HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    return misRequisiciones();
  });
}

/** Cierre: la requisición pasa a Cerrada y su orden a Recibida (hoy, con el correo de quien cierra). */
function cerrarReq_(libro, hoja, req, nota, motivo) {
  // F (incremento 5): con crédito del proveedor y la orden sin pagar, queda Recibida (el pago la cierra); ver recibirSinPagar_
  if (recibirSinPagar_(libro, hoja, req, nota, motivo)) return;
  const nuevo = transicionReq(req.estado, req.estado === REQ_EN_CAMINO ? 'cerrarEnCamino' : 'cerrar');
  const { hoja: hO, orden } = buscarOrden_(libro, req.ocFolio);
  if (orden.estado !== OC_PAGADA) throw new Error('La orden ' + orden.folio + ' no está pagada.');
  cambiarReq_(hoja, req, nuevo, { notasRecepcion: nota, motivo: motivo || req.motivo });
  escribe_(hO).getRange(orden.fila, COL_ESTADO_OC, 1, 3).setValues([[OC_RECIBIDA, textoFecha_(hoyIso_()), textoCelda(VENDEDOR_.email)]]);
  eventoReq_(libro, req.folio, REQ_CERRADA, [motivo ? 'Cerrada por compras: ' + motivo : 'Material recibido', nota].filter(Boolean).join(' · '));
  notificar_('req.recibida', { req: req.folio, nota: nota }); // correo a compras (6.B)
  bitacora_(libro, 'Cerrar requisición', req.proyectoFolio, req.folio + ' · ' + orden.folio + ' recibida el ' + hoyIso_() +
    (nota ? ' · ' + nota : ''), motivo || '', HOJAS_COMPRAS);
}

/**
 * "Recibí el material": solo el solicitante y solo si está Pagada (o, con crédito del proveedor, Autorizada o En camino con la
 * orden sin pagar: queda Recibida; F, incremento 5). notas opcionales (p. ej. "faltó 1 pieza").
 * Incremento 5 (H): d = {renglones: [{renglon (de la orden), foto: {nombre, datos, mime}, problema?: {tipo, cantidad,
 * comentario, foto}}], idSolicitud}: una foto por renglón pendiente de la orden (cada uno queda como entrada por compra, folio
 * REC). Si se reporta un problema (o hay una devolución abierta), la requisición queda Recibida y no se cierra hasta resolverla.
 */
function cerrarRequisicion(folioReq, notas, d) {
  exigirRequisicion_();
  if (flujoOperaciones_()) throw new Error('Confirma lo que recibiste renglón por renglón con "Registrar recepción".');
  const nota = notaOpcional_(notas);
  const fotos = fotosDeRenglones_((d || {}).renglones); // H: se leen antes del candado
  const libro = libroCompras_();
  return conCandado_(() => {
    const { hoja, req } = buscarReq_(libro, folioReq);
    if (req.solicitanteEmail !== String(VENDEDOR_.email).toLowerCase()) {
      throw errorPermiso_('Solo quien hizo la requisición ' + req.folio + ' puede confirmar que recibió el material.');
    }
    exigirNoLigado_(req);
    // H: entrada por compra de lo pendiente con su foto (y problemas); con una devolución abierta queda Recibida (retenida)
    if (recibirTodoConFotos_(libro, hoja, req, fotos, nota, true)) { SpreadsheetApp.flush(); return misRequisiciones(); }
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
  let ordenes = null; // P (incremento 6): solo si alguna tiene orden
  filasDeArea_(hojaReq_(libro), HOJAS_COMPRAS, 'Requisiciones').forEach((r, i) => {
    const req = reqDesdeFila_(r, i + 2);
    if (!req.folio || req.estado === ESTADO_ANULADA || esAnulado_(req.folio)) return;
    if (req.ocFolio && !ordenes) { ordenes = ordenesPorFolio_(libro); pagosProvPorOc_(libro); }
    const orden = req.ocFolio ? ordenes[req.ocFolio.toUpperCase()] : null;
    const p = proyectos[req.proyectoFolio.toUpperCase()];
    const x = { folio: req.folio, fecha: req.fecha, proyectoFolio: req.proyectoFolio, proyectoNombre: p ? p.nombre : '',
      proyectoVisible: p ? p.folioVisible : req.proyectoFolio,
      solicitante: req.solicitante, solicitanteEmail: req.solicitanteEmail, estado: req.estado, ocFolio: req.ocFolio,
      actualizado: req.actualizado, renglones: ((ren[req.folio.toUpperCase()] || {}).renglones || []).length,
      sitio: req.sitio, prioridad: req.prioridad, fechaRequerida: req.fechaRequerida,
      pagadaParcial: !!orden && pagoParcialDe_(orden) }; // P (incremento 6): etiqueta derivada, no un estado
    if (e && (e === ETIQUETA_PAGADA_PARCIAL ? !x.pagadaParcial : x.estado !== e)) return;
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
    tipo: String(r[21] || ''), // P (incremento 6): Anticipo · Parcial · Liquidación ('' en pagos de antes)
  };
}

/** Pagos de una orden (en orden de registro), sin los anulados salvo conAnulados. */
function pagosDeOrden_(libro, folioOc, conAnulados) {
  const f = String(folioOc || '').toUpperCase();
  const lista = [];
  if (!f) return lista;
  filasDeArea_(hojaCompras_(libro, 'PagosProveedores'), HOJAS_COMPRAS, 'PagosProveedores').forEach((r, i) => {
    if (String(r[3]).toUpperCase() === f && (conAnulados || String(r[17] || '') !== ESTADO_ANULADA)) lista.push(pagoProvDesdeFila_(r, i + 2));
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
  // Rapidez: moneda y línea del caché de contratos por versión (en una escritura, contratosCache_ lee la hoja)
  const c = monedaDeProyecto_(contratosCache_()[req.proyectoFolio.toUpperCase()] || null);
  let orden = null;
  if (req.ocFolio) { orden = buscarOrden_(libro, req.ocFolio).orden; delete orden.fila; }
  const pagos = req.ocFolio ? pagosDeOrden_(libro, req.ocFolio).map(x => { delete x.fila; return x; }) : [];
  const proyectoVigente = !!proyecto && proyecto.estado !== 'Cancelado'; // Activo o Cerrado, con o sin contrato
  const r = Object.assign({}, req, { propuesta: propuestaVigente_(req) }); delete r.fila;
  const todas = orden ? facturasDelLibro_(libro) : [];
  const vigente = renglonesDeReqs_(libro)[f] || { version: 1, renglones: [] };
  const renglones = vigente.renglones;
  const movs = orden ? (movimientosPorOc_(libro)[orden.folio.toUpperCase()] || []) : [];
  // P (incremento 6): lo esperado, lo pagado (varios pagos), el saldo y lo que sigue según el plan de pagos
  const saldo = orden ? saldoDeOrden_(libro, orden, movs, todas, pagos) : null;
  if (orden) orden.pagoParcial = orden.estado === OC_EMITIDA && !saldo.completo && saldo.pagado > 0;
  const avance = orden && orden.estado !== OC_CANCELADA ? avanceRecepcion(orden.renglones, movs, renglonesSinRecepcion(propuestaVigente_(req))) : null;
  const aprobados = renglonesAprobados(renglones, req.aprobacion);
  const porCotizar = req.estado === REQ_APROBADA || req.estado === REQ_COTIZADA;
  const ocPagada = !!orden && orden.estado === OC_PAGADA;
  const conOrden = [REQ_AUTORIZADA, REQ_PAGADA, REQ_EN_CAMINO].indexOf(req.estado) !== -1;
  // F (incremento 5): crédito del proveedor en el flujo de siempre: compras registra que llegó con la orden sin pagar
  const antesDePagar = !flujo && recibirSinPagarPosible_(req, orden);
  return Object.assign({ // H (incremento 5): devoluciones, fotos y "Reportar problema" al final (recepcionParaCompras_)
    requisicion: r,
    flujoOperaciones: flujo,
    version: vigente.version, // versión de los renglones (separar la exige)
    renglones: renglonesConDecision_(renglones, req.aprobacion),
    aprobados: aprobados,
    // Lo que va en una solicitud de cotización al proveedor: lo aprobado o, en el flujo de siempre (sin aprobación), lo pedido
    paraCotizar: renglonesParaCotizar(renglones, req.aprobacion),
    eventos: eventosDeReqs_(libro)[f] || [],
    proyecto: proyecto ? datosProyectoCompras_(proyecto)
      : { folio: req.proyectoFolio, clave: '', folioVisible: req.proyectoFolio, nombre: '', cliente: '', estado: '', ubicacion: '' },
    moneda: c.moneda, marca: c.marca, sinContrato: c.sinContrato,
    orden: orden, pagos: pagos,
    // P (incremento 6): saldo de la orden (esperado, pagado, saldo, siguiente según el plan), etiqueta "Pagada parcial" y tipos de pago
    saldo: saldo, pagadaParcial: !!orden && orden.pagoParcial, tiposPago: TIPOS_PAGO_PROV,
    // Facturas de la orden (4.5): se registran desde que la orden existe hasta que se cancela
    facturas: orden ? facturasDeOrden_(todas, orden.folio) : [],
    totalFacturado: orden ? totalFacturadoDeOrden(todas, orden.folio) : 0,
    // Revisión (incremento 5): total por pagar con material devuelto sin reponer (null = el total de la orden)
    porPagar: orden ? totalPorPagarOrden(orden, devueltoSinReponer(movs)) : null,
    facturaCompleta: !!orden && facturacionDeOrden(todas, orden).completa,
    puedeFacturar: !!orden && orden.estado !== OC_CANCELADA,
    // F (incremento 5): para la orden, sin datos bancarios (con forma de pago habitual y documentos que faltan); para el pago,
    // banco, CLABE y documentos del proveedor de la orden (formasPago: las de la orden; metodos: las del pago real)
    proveedores: proveedoresDelLibro_(libro).map(proveedorParaOrden_), proveedorPago: orden ? proveedorDePago_(libro, orden) : null,
    formasPago: FORMAS_PAGO_OC, ivaTasas: IVA_OC, metodos: METODOS_PAGO, hoy: hoyIso_(),
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
    // P (incremento 6): varios pagos mientras la orden tenga saldo; cualquier pago Vigente se cancela salvo con la requisición Cerrada
    puedePagar: (req.estado === REQ_AUTORIZADA || req.estado === REQ_RECIBIDA || req.estado === REQ_EN_CAMINO) && !!orden &&
      orden.estado === OC_EMITIDA && !saldo.completo,
    puedeCancelarPago: !!orden && orden.estado !== OC_CANCELADA && req.estado !== REQ_CERRADA && pagos.some(x => x.estado === 'Vigente'),
    // Revisión: con una devolución abierta compras no cierra (cerrarRequisicionCompras lo rechaza): no se ofrece el botón
    puedeCerrar: (req.estado === REQ_PAGADA || (req.estado === REQ_EN_CAMINO && ocPagada) || antesDePagar) && !devolucionAbiertaDe_(libro, req),
    recibeAntesDePagar: antesDePagar, // F: "Registrar que llegó" en vez de "Cerrar" (la requisición queda Recibida)
    // P (incremento 6): por qué se recibe antes de pagar todo: crédito del proveedor o un pago parcial
    recibeAntesPor: !antesDePagar ? '' : formaPagoDeOrden(orden.formaPago, orden.diasCredito) === FORMA_PAGO_CREDITO ? 'credito' : 'parcial',
    puedeRecibir: flujo && !!avance && !avance.completo && conOrden,
    puedeCancelarRecepcion: req.estado !== REQ_CERRADA && !!orden && orden.estado !== OC_CANCELADA,
    // Centro de mando (incremento 4): proyecto ligado (recibir o cerrar aquí es el respaldo de compras) y registrar el envío
    centroMando: centroDeReq_(req),
    puedeEnCamino: conOrden && !!orden && orden.estado !== OC_CANCELADA,
  }, recepcionParaCompras_(libro, req, orden, movs, avance));
}

function getRequisicion(folioReq) {
  exigirCompras_();
  return vistaRequisicion_(libroCompras_(), folioReq);
}

/**
 * Autoriza una requisición Solicitada: emite su orden de compra (mismo flujo y PDF, con la línea "Requisición: REQ-…") y la
 * requisición pasa a Autorizada con su oc_folio. oc = datos de la orden (ver emitirOrdenCompra_) + idSolicitud.
 */
function autorizarRequisicion(folioReq, oc, motivoExcepcion) {
  exigirCompras_();
  if (flujoOperaciones_()) {
    throw new Error('Con el flujo de operaciones la orden se emite con el visto bueno de operaciones: manda la propuesta de compra.');
  }
  const d0 = oc || {};
  const libro = libroCompras_();
  const idSolicitud = String(d0.idSolicitud || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const claveCache = idSolicitud ? 'OC_' + idSolicitud : '';

  return conAvisoPortal_(conCandado_(() => {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) return JSON.parse(previo);
    }
    const { hoja, req } = buscarReq_(libro, folioReq);
    // Separación de funciones también en el flujo de siempre (decisión de Leo, 29/10/2026): nadie autoriza lo que pidió; solo
    // un super admin, con motivo que queda en la bitácora de Administración (la interfaz lo pide)
    const propia = req.solicitanteEmail === yo_();
    if (propia && !excepcionPosible_(motivoExcepcion)) {
      throw errorPermiso_('No puedes autorizar tu propia requisición: la autoriza otra persona de compras.' + textoExcepcion_());
    }
    const nuevo = transicionReq(req.estado, 'autorizar');
    if (proyectoLigado_(req.proyectoFolio)) sitioConCodigo_(req.sitio, req.folio);
    const proyecto = proyectoParaCompras_(req.proyectoFolio);
    if (propia) excepcionSuperAdmin_('autorizar su propia requisición', req.folio, motivoExcepcion); // ya validado: antes de escribir
    const r = emitirOrdenCompra_(libro, d0, proyecto, req.folio);
    cambiarReq_(hoja, req, nuevo, { motivo: '', ocFolio: r.folio, revisar: true });
    eventoReq_(libro, req.folio, nuevo, '');
    notificar_('req.autorizada', { req: req.folio }); // correo a quien pidió, quien recibe y compras (6.B)
    bitacora_(libro, 'Autorizar requisición', proyecto.folio, req.folio + ' · ' + r.folio, '', HOJAS_COMPRAS);
    avisarPortal_('oc.autorizada', r.folio);
    SpreadsheetApp.flush();
    const resultado = { folio: req.folio, ocFolio: r.folio, url: r.url, total: r.total, moneda: r.moneda,
      avisoProveedor: r.avisoProveedor, vista: vistaRequisicion_(libro, req.folio) };
    if (claveCache) cache.put(claveCache, JSON.stringify(resultado), 21600); // 6 h
    return resultado;
  }));
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
    notificar_(accion === 'rechazar' ? 'req.rechazada' : 'req.devuelta', { req: req.folio, nota: m }); // correo a quien pidió (6.B)
    bitacora_(libro, (accion === 'rechazar' ? 'Rechazar' : 'Devolver') + ' requisición' + (flujo ? (porCompras ? ' (compras)' : ' (operaciones)') : ''),
      req.proyectoFolio, req.folio, m, HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    return porCompras ? vistaRequisicion_(libro, req.folio) : vistaOperaciones_(libro, req.folio);
  });
}
function rechazarRequisicion(folioReq, motivo) { return revisarRequisicion_(folioReq, motivo, 'rechazar'); }
function devolverRequisicion(folioReq, motivo) { return revisarRequisicion_(folioReq, motivo, 'devolver'); }

/**
 * Pago a proveedor: p = {reqFolio o ocFolio, fecha, monto, monedaPago, tipoCambio, metodo, referencia, comprobante: {nombre, datos},
 * idSolicitud}. La requisición debe estar Autorizada, En camino o Recibida y su orden Emitida (con saldo).
 * P (incremento 6): una orden acepta varios pagos hasta quedar completa (saldoOrdenCompra). Cada pago se valida igual que siempre
 * (comprobante, método, referencia sin número de tarjeta, tipo de cambio si la moneda es otra) y no puede dejar lo pagado arriba de
 * lo esperado (total de la orden, o el total por pagar con material devuelto sin reponer) + TOLERANCIA_PAGO. Su tipo lo decide el
 * servidor: Liquidación si la completa; si no, Parcial (ya se recibió algo) o Anticipo. Un pago que no la completa no cambia estados
 * (la orden sigue Emitida: "Pagada parcial"); el que la completa hace lo de siempre (orden y requisición a Pagada; una Recibida se
 * cierra). oc.pagada al centro de mando solo con el primer pago Vigente; req.pagada (correo) solo al completar; con el primer pago
 * parcial, req.pagoparcial (sin montos) a quien recibe, porque desde ahí ya puede confirmar que llegó (decisión 1).
 * F (incremento 5): un pago por transferencia sin CSF y carátula bancaria del proveedor no se registra (control contra fraude: se
 * le paga a la CLABE de la carátula), salvo un super admin con motivoExcepcion ≥ 10 caracteres (Bitacora de Administración).
 */
function registrarPagoProveedor(p, motivoExcepcion) {
  exigirCompras_();
  const d0 = p || {};
  const bytes = bytesDeAdjunto_(d0.comprobante, 'No se pudo leer el comprobante. Vuelve a adjuntarlo.');
  const tipo = validarComprobante(bytes);
  const libro = libroCompras_();

  const idSolicitud = String(d0.idSolicitud || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const claveCache = idSolicitud ? 'PGP_' + idSolicitud : '';

  return conAvisoPortal_(conCandado_(() => {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) return JSON.parse(previo);
    }
    let reqFolio = String(d0.reqFolio || '').trim();
    if (!reqFolio && d0.ocFolio) reqFolio = buscarOrden_(libro, d0.ocFolio).orden.reqFolio;
    if (!reqFolio) throw new Error('Esta orden no tiene requisición: no se puede registrar el pago.');
    const { hoja, req } = buscarReq_(libro, reqFolio);
    // Estados que admiten un pago (el que completa la orden los cambia como siempre; uno parcial no)
    const yaRecibida = req.estado === REQ_RECIBIDA, enCamino = req.estado === REQ_EN_CAMINO;
    transicionReq(req.estado, yaRecibida ? 'pagarRecibida' : enCamino ? 'pagarEnCamino' : 'pagar');
    const { hoja: hO, orden } = buscarOrden_(libro, req.ocFolio);
    if (d0.ocFolio && String(d0.ocFolio).trim().toUpperCase() !== orden.folio.toUpperCase()) {
      throw new Error('La orden ' + String(d0.ocFolio).toUpperCase() + ' no es la de la requisición ' + req.folio + '.');
    }
    if (orden.estado !== OC_EMITIDA) throw new Error('La orden ' + orden.folio + ' está ' + orden.estado.toLowerCase() + ': no se puede pagar.');
    const F = orden.folio.toUpperCase();
    const movs = movimientosPorOc_(libro)[F] || [];
    const pagos = pagosDeOrden_(libro, orden.folio);
    const facturas = facturasDelLibro_(libro);
    const antes = saldoDeOrden_(libro, orden, movs, facturas, pagos);
    if (antes.completo) throw new Error('La orden ' + orden.folio + ' ya está pagada por completo: no tiene saldo por pagar.');
    // Revisión (incremento 5): lo devuelto sin reponer no se paga (p. ej. crédito del proveedor: se recibió y se devolvió antes de pagar)
    const porPagar = totalPorPagarOrden(orden, devueltoSinReponer(movs));
    const pago = normalizarPagoProveedor(d0, { moneda: orden.moneda, total: antes.esperado, pagado: antes.pagado, fechaOrden: orden.fecha,
      hoy: hoyIso_(), totalOrden: orden.total, descontado: porPagar ? porPagar.descontado : 0 });
    // F (incremento 5): documentos del proveedor (CSF y carátula) o excepción de super admin con motivo (antes de escribir)
    exigirDocumentosParaPagar_(libro, orden, motivoExcepcion, pago.metodo);

    const despues = saldoDeOrden_(libro, orden, movs, facturas, pagos.concat([{ folio: '', estado: 'Vigente', montoAplicado: pago.montoAplicado }]));
    const completo = despues.completo;
    const primero = !pagos.some(x => x.estado === 'Vigente');
    const recibido = !!orden.fechaRecepcion || movs.some(m => m.tipo === TIPO_ENTRADA_COMPRA && m.estado === 'Vigente');
    const tipoPago = tipoDePagoProv(completo, recibido);
    const hP = hojaCompras_(libro, 'PagosProveedores');
    const folio = siguienteFolio_(PREFIJO_PGP, hP, 'CONSECUTIVO_PGP_');
    const n = pagosDeOrden_(libro, orden.folio, true).length + 1; // "(n)" del archivo: también cuentan los anulados
    const archivo = privado_(carpetaRequisiciones_(req.proyectoFolio).createFile(Utilities.newBlob(bytes, tipo.mime,
      nombreArchivoReq(req.folio, 'Comprobante pago', tipo.ext, n))));
    const t = textoCelda;
    escribe_(hP).appendRow([folio, textoFecha_(pago.fecha), Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss'),
      orden.folio, req.folio, req.proyectoFolio, pago.monto, pago.monedaPago, pago.tipoCambio, pago.montoAplicado, orden.moneda,
      pago.metodo, t(pago.referencia), archivo.getId(), archivo.getUrl(), t(VENDEDOR_.email),
      t([VENDEDOR_.nombre, VENDEDOR_.apellido].filter(Boolean).join(' ')), 'Vigente', '', '', '', tipoPago]);
    olvidarPagosProv_();
    let nuevo = req.estado, retenida = '';
    if (completo) {
      const r = aplicarPagoCompleto_(libro, hoja, req, hO, orden);
      nuevo = r.nuevo; retenida = r.retenida;
      eventoReq_(libro, req.folio, nuevo, (primero ? '' : 'Liquidación al proveedor. ') + (retenida ? 'Pagada; ' + textoRetenida(retenida) : // H
        yaRecibida ? 'Pagada; el material ya estaba recibido.' : enCamino ? 'Pagada; el material va en camino.' : ''));
    } else {
      cambiarReq_(hoja, req, req.estado, {}); // el estado no cambia (la orden sigue Emitida): solo "actualizado"
      // El historial lo ve quien pidió: sin montos (con el primer pago, desde aquí ya se puede confirmar que llegó)
      eventoReq_(libro, req.folio, ETIQUETA_PAGADA_PARCIAL, (tipoPago === TIPO_PAGO_ANTICIPO ? 'Anticipo' : 'Pago parcial') + ' al proveedor' +
        (yaRecibida ? '; falta el resto del pago.' : enCamino ? '; el material va en camino.' : primero ? '; ya se puede recibir el material.' : '.'));
    }
    bitacora_(libro, 'Registrar pago a proveedor', req.proyectoFolio, folio + ' · ' + orden.folio + ' · ' + req.folio + ' · ' + tipoPago + ' · ' +
      formatoMoneda(pago.monto) + ' ' + pago.monedaPago + (pago.tipoCambio ? ' · TC ' + pago.tipoCambio + ' = ' +
      formatoMoneda(pago.montoAplicado) + ' ' + orden.moneda : '') + ' · ' + pago.metodo + (porPagar ? ' · total por pagar ' +
      formatoMoneda(porPagar.total) + ' (orden ' + formatoMoneda(orden.total) + ' − ' + formatoMoneda(porPagar.descontado) + ' devuelto sin reponer)' : '') +
      ' · pagado ' + formatoMoneda(despues.pagado) + ' de ' + formatoMoneda(despues.esperado) + ' ' + orden.moneda +
      (completo ? '' : ' · saldo ' + formatoMoneda(despues.saldo) + ' ' + orden.moneda), '', HOJAS_COMPRAS);
    // Centro de mando (decisión 2): oc.pagada ("el material puede salir") con el primer pago Vigente; los siguientes no avisan nada
    if (primero) avisarPortal_('oc.pagada', orden.folio);
    // Flujo de siempre: el pago abre la confirmación de quien recibe (con aprobaciones ya se le avisó al autorizar; en un
    // proyecto ligado se recibe en el centro de mando). req.pagada una sola vez, al completar; con el primer pago parcial,
    // req.pagoparcial (sin montos), salvo con crédito del proveedor (ya podía recibir antes de pagar)
    const avisaRecibe = !yaRecibida && !flujoOperaciones_() && !proyectoLigado_(req.proyectoFolio);
    if (avisaRecibe && completo) notificar_('req.pagada', { req: req.folio });
    else if (avisaRecibe && primero && formaPagoDeOrden(orden.formaPago, orden.diasCredito) !== FORMA_PAGO_CREDITO) {
      notificar_('req.pagoparcial', { req: req.folio });
    }
    SpreadsheetApp.flush();
    const resultado = { folio: folio, tipo: tipoPago, completo: completo, url: archivo.getUrl(), vista: vistaRequisicion_(libro, req.folio) };
    if (claveCache) cache.put(claveCache, JSON.stringify(resultado), 21600); // 6 h
    return resultado;
  }));
}

/**
 * Cancela un pago a proveedor (no se borra), con motivo; no si la requisición ya está Cerrada. P (incremento 6): se recalcula la
 * orden sin ese pago. Si estaba completa (Pagada o Recibida) y ya no lo está, vuelve a Emitida y la requisición a como estaba antes
 * del pago que la completó (Pagada → Autorizada; En camino sigue En camino; Recibida sigue Recibida, ahora con el pago pendiente).
 * Si sigue completa (p. ej. con material devuelto sin reponer lo pagado sobra) o era un pago parcial, los estados no cambian. Al
 * centro de mando no se le avisa nada (como hoy).
 */
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
    if (pago.estado === ESTADO_ANULADA) throw new Error('El pago ' + pago.folio + ' está anulado.');
    if (pago.estado !== 'Vigente') throw new Error('El pago ' + pago.folio + ' ya está cancelado.');
    const { hoja, req } = buscarReq_(libro, pago.reqFolio);
    if (req.estado === REQ_CERRADA) throw new Error('La requisición ' + req.folio + ' ya está cerrada (material recibido): el pago no se puede cancelar.');
    const { hoja: hO, orden } = buscarOrden_(libro, pago.ocFolio);
    const restantes = pagosDeOrden_(libro, orden.folio).filter(x => x.folio.toUpperCase() !== folio);
    // La orden sin este pago, como si siguiera abierta (Emitida): ¿lo que queda la sigue cubriendo?
    const despues = saldoDeOrden_(libro, Object.assign({}, orden, { estado: OC_EMITIDA }), null, null, restantes);
    const completa = orden.estado === OC_PAGADA || orden.estado === OC_RECIBIDA;
    let nuevo = req.estado;
    if (completa && !despues.completo) {
      nuevo = transicionReq(req.estado, req.estado === REQ_EN_CAMINO ? 'cancelarPagoEnCamino' : req.estado === REQ_RECIBIDA
        ? 'cancelarPagoRecibida' : 'cancelarPago');
    }
    escribe_(hP).getRange(pago.fila, 18, 1, 4).setValues([['Cancelado', textoCelda(VENDEDOR_.email),
      Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss'), textoCelda(m)]]);
    olvidarPagosProv_();
    if (completa && !despues.completo) escribe_(hO).getRange(orden.fila, COL_ESTADO_OC).setValue(OC_EMITIDA);
    cambiarReq_(hoja, req, nuevo, {});
    // El historial lo ve quien pidió: sin montos ni el motivo
    const quedan = despues.pagado > 0;
    eventoReq_(libro, req.folio, !despues.completo && quedan ? ETIQUETA_PAGADA_PARCIAL : nuevo, !quedan ? 'Se canceló el pago.' :
      despues.completo ? 'Se canceló un pago; la orden sigue pagada.' : 'Se canceló un pago; la orden queda pagada en parte.');
    bitacora_(libro, 'Cancelar pago a proveedor', req.proyectoFolio, pago.folio + ' · ' + orden.folio + ' · ' + req.folio + ' · ' +
      formatoMoneda(pago.monto) + ' ' + pago.monedaPago + (pago.tipo ? ' · ' + pago.tipo : '') + ' · pagado ' + formatoMoneda(despues.pagado) +
      ' de ' + formatoMoneda(despues.esperado) + ' ' + orden.moneda + (completa && !despues.completo ? ' · ' + orden.folio + ' vuelve a Emitida' : ''),
      m, HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    return vistaRequisicion_(libro, req.folio);
  });
}

/**
 * Compras cierra una requisición Pagada (o En camino y pagada) en lugar del solicitante (p. ej. ya no está en la obra), con
 * motivo obligatorio. En un proyecto ligado es el respaldo cuando el centro de mando no funciona (no llega al inventario del
 * sitio) y avisa req.cerrada al centro de mando.
 */
function cerrarRequisicionCompras(folioReq, motivo, notas) {
  exigirCompras_();
  const m = motivoObligatorio_(motivo, 'Escribe por qué cierras la requisición en lugar de quien la pidió.');
  const nota = notaOpcional_(notas);
  const libro = libroCompras_();
  return conAvisoPortal_(conCandado_(() => {
    const { hoja, req } = buscarReq_(libro, folioReq);
    const ligado = proyectoLigado_(req.proyectoFolio);
    // H (incremento 5): con una devolución abierta no se cierra; lo pendiente queda como entrada por compra (sin foto obligatoria).
    // Todo se revisa antes de escribir (recibirTodoConFotos_ → validarCierreConFotos_, lo mismo que cerrarReq_)
    exigirSinDevolucionAbierta_(libro, req);
    recibirTodoConFotos_(libro, hoja, req, {}, nota, false);
    cerrarReq_(libro, hoja, req, nota, m + (ligado ? ' (respaldo: no llega al inventario del sitio)' : ''));
    if (ligado) avisarPortal_('req.cerrada', req.ocFolio);
    SpreadsheetApp.flush();
    return vistaRequisicion_(libro, req.folio);
  }));
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
    if (!req.folio || req.estado === ESTADO_ANULADA || esAnulado_(req.folio)) return;
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
      formaPago: o.formaPago, diasCredito: o.diasCredito, // F (incremento 5): forma de pago (aprobaciones sí la ve)
      planPago: o.planPago, pagadaParcial: pagoParcialDe_(o), // P (incremento 6): el plan y la etiqueta (sin pagos ni montos pagados)
      fechaEntrega: o.fechaEntrega, lugarEntrega: o.lugarEntrega, paqueteria: o.paqueteria, guia: o.guia,
      fechaEstimada: o.fechaEstimada, enCaminoEn: o.enCaminoEn };
    movs = movimientosPorOc_(libro)[o.folio.toUpperCase()] || [];
    if (o.estado !== OC_CANCELADA) avance = avanceRecepcion(o.renglones, movs, renglonesSinRecepcion(actual));
  }
  const prop = actual ? Object.assign({}, actual, { huella: huellaPropuesta_(actual),
    formaPago: formaPagoDeOrden(actual.formaPago, actual.diasCredito), // F: las propuestas de antes no la traen
    archivos: (actual.archivos || []).map(a => ({ id: a.id, nombre: a.nombre || '' })) }) : null;
  const esPropia = req.solicitanteEmail === yo;
  const preparo = !!prop && String(prop.elaboroEmail || '').toLowerCase() === yo;
  const sa = esSuperAdmin_(); // un super admin puede, con motivo por escrito (la interfaz lo pide al responder el servidor)
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
    esPropia: esPropia, preparoPropuesta: preparo, excepcionSuperAdmin: sa && (esPropia || preparo),
    puedeAprobar: req.estado === REQ_SOLICITADA && (!esPropia || sa),
    puedeDevolver: req.estado === REQ_SOLICITADA,
    puedeRechazar: [REQ_SOLICITADA, REQ_APROBADA, REQ_COTIZADA].indexOf(req.estado) !== -1,
    puedeVisto: req.estado === REQ_COTIZADA && !!prop && ((!esPropia && !preparo) || sa),
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
 * corrigió después, se rechaza). Queda Aprobada y pasa a compras. Nadie aprueba lo que pidió (también vale para un delegado),
 * salvo un super admin con motivoExcepcion ≥ 10 caracteres (incremento 4; queda en la Bitacora de Administración).
 */
function aprobarRequisicion(folioReq, d, motivoExcepcion) {
  exigirOperaciones_();
  const libro = libroCompras_();
  return conCandado_(() => {
    const { hoja, req } = buscarReq_(libro, folioReq);
    const propia = req.solicitanteEmail === yo_();
    if (propia && !excepcionPosible_(motivoExcepcion)) {
      throw errorPermiso_('No puedes aprobar tu propia requisición: la aprueba otra persona de operaciones.' + textoExcepcion_());
    }
    const nuevo = transicionReq(req.estado, 'aprobar');
    const vigente = renglonesDeReqs_(libro)[req.folio.toUpperCase()] || { version: 1, renglones: [] };
    if (Number((d || {}).version) !== Number(vigente.version)) {
      throw new Error('La requisición ' + req.folio + ' cambió después de que la abriste (versión ' + vigente.version + '): vuelve a abrirla.');
    }
    const a = normalizarAprobacion(d, vigente.renglones);
    if (propia) excepcionSuperAdmin_('aprobar su propia requisición', req.folio, motivoExcepcion); // ya validado: se registra antes de escribir
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
    notificar_('req.aprobada', { req: req.folio }); // correo a compras (6.B)
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
    if (proyectoLigado_(req.proyectoFolio)) sitioConCodigo_(req.sitio, req.folio);
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
      diasCredito: prop.diasCredito, formaPago: prop.formaPago, planPago: prop.planPago || null, notas: prop.notas, renglones: prop.renglones, subtotal: prop.subtotal, iva: prop.iva,
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
    notificar_('req.cotizada', { req: req.folio, version: version }); // correo a aprobaciones (6.B)
    bitacora_(libro, 'Propuesta de compra', proyecto.folio, req.folio + ' · v' + version + ' · ' + prop.proveedor.razonSocial + ' · ' +
      formatoMoneda(prop.total) + ' ' + prop.moneda + ' · ' + resumen + ' · recibe ' + prop.recibe, '', HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    const resultado = { folio: req.folio, version: version, vista: vistaRequisicion_(libro, req.folio),
      avisoProveedor: avisoDeProveedor_(libro, proveedorId(prop.proveedor), prop.proveedor.razonSocial) }; // F: documentos que le faltan
    guardarIdempotencia_(cache, claveCache, resultado);
    return resultado;
  });
}

/**
 * Visto bueno de operaciones a la propuesta (versión que vio: si compras la cambió después, se rechaza): emite la orden con
 * el PDF ("Elaboró" = quien preparó la propuesta; "Autorizó" = quien da el visto bueno) y la requisición queda Autorizada.
 * huella = la de la propuesta que vio (vistaOperaciones_): ata el visto bueno al contenido, no solo al número de versión.
 * No sobre una requisición propia ni sobre una propuesta que uno mismo preparó, salvo un super admin con motivoExcepcion ≥ 10
 * caracteres (incremento 4; queda en la Bitacora de Administración).
 */
function autorizarPropuesta(folioReq, version, idSolicitud, huella, motivoExcepcion) {
  exigirOperaciones_();
  const libro = libroCompras_();
  const id = String(idSolicitud || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const claveCache = id ? 'VOBO_' + id : '';
  return conAvisoPortal_(conCandado_(() => {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) return JSON.parse(previo);
    }
    const { hoja, req } = buscarReq_(libro, folioReq);
    const nuevo = transicionReq(req.estado, 'visto');
    if (proyectoLigado_(req.proyectoFolio)) sitioConCodigo_(req.sitio, req.folio);
    const prop = propuestaVigente_(req);
    if (!prop) throw new Error('La requisición ' + req.folio + ' no tiene propuesta de compra.');
    const yo = yo_();
    const propia = req.solicitanteEmail === yo, preparo = String(prop.elaboroEmail || '').toLowerCase() === yo;
    const excepcion = (propia || preparo) && excepcionPosible_(motivoExcepcion);
    if (propia && !excepcion) throw errorPermiso_('No puedes dar el visto bueno a tu propia requisición.' + textoExcepcion_());
    if (preparo && !excepcion) {
      throw errorPermiso_('No puedes dar el visto bueno a una propuesta que tú preparaste: lo da otra persona de operaciones.' + textoExcepcion_());
    }
    if (Number(version) !== Number(prop.version) || String(huella || '') !== huellaPropuesta_(prop)) {
      throw new Error('Compras cambió la propuesta (ahora es la versión ' + prop.version + ') después de que la abriste: revísala otra vez.');
    }
    if (prop.fechaEntrega < hoyIso_()) {
      throw new Error('La fecha de entrega de la propuesta (' + prop.fechaEntrega + ') ya pasó: regrésala a compras para actualizarla.');
    }
    const proyecto = proyectoParaCompras_(req.proyectoFolio);
    if (excepcion) {
      excepcionSuperAdmin_('visto bueno a ' + [propia ? 'su propia requisición' : '', preparo ? 'una propuesta que preparó' : '']
        .filter(Boolean).join(' y '), req.folio, motivoExcepcion); // ya validado: se registra antes de emitir la orden
    }
    const r = emitirOrdenCompra_(libro, ordenDePropuesta(prop), proyecto, req.folio,
      { email: prop.elaboroEmail, nombre: prop.elaboroNombre, autorizo: nombreYo_() + (nombreYo_() === yo ? '' : ' (' + yo + ')') });
    cambiarReq_(hoja, req, nuevo, { motivo: '', ocFolio: r.folio, revisar: true });
    camposReq_(hoja, req, { voboEmail: yo, fechaVobo: ahoraTexto_() });
    eventoReq_(libro, req.folio, nuevo, 'Visto bueno de operaciones: se emitió la orden de compra.');
    notificar_('req.autorizada', { req: req.folio }); // correo a quien pidió, quien recibe y compras (6.B)
    bitacora_(libro, 'Visto bueno de operaciones', req.proyectoFolio, req.folio + ' · propuesta v' + prop.version + ' · ' + r.folio, '', HOJAS_COMPRAS);
    avisarPortal_('oc.autorizada', r.folio);
    SpreadsheetApp.flush();
    const resultado = { folio: req.folio, ocFolio: r.folio, vista: vistaOperaciones_(libro, req.folio) };
    guardarIdempotencia_(cache, claveCache, resultado);
    return resultado;
  }));
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
    notificar_('req.regresada', { req: req.folio, nota: m }); // correo a compras (6.B)
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
    escribe_(hoja).appendRow([nuevaFolio, textoFecha_(hoyIso_()), req.proyectoFolio, t(req.solicitanteEmail), t(req.solicitante), REQ_APROBADA, '',
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
  const fotos = fotosDeRenglones_(d0.renglones); // H (incremento 5): foto y problema por renglón, leídos antes del candado
  const sitios = sitios_();
  const libro = libroCompras_();
  const idSolicitud = String(d0.idSolicitud || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const claveCache = idSolicitud ? 'REC_' + idSolicitud : '';

  return conAvisoPortal_(conCandado_(() => {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) return JSON.parse(previo);
    }
    const yo = yo_();
    const { hoja, req } = buscarReq_(libro, d0.reqFolio);
    const recibe = req.recibeEmail || req.solicitanteEmail;
    // Proyecto ligado al centro de mando: se recibe allá; aquí solo compras, como respaldo y con motivo
    const centro = centroDeReq_(req);
    if (centro && !compras) {
      throw new Error('El material de ' + req.folio + ' se recibe en el centro de mando (' + centro.sitio + '), no en CAPRI.');
    }
    const propio = !centro && (yo === req.solicitanteEmail || yo === recibe);
    if (!propio && !compras) {
      throw errorPermiso_('Solo quien pidió la requisición ' + req.folio + ' o quien la recibe puede registrar la recepción.');
    }
    if ([REQ_AUTORIZADA, REQ_PAGADA, REQ_EN_CAMINO].indexOf(req.estado) === -1) {
      throw new Error('La requisición ' + req.folio + ' está ' + req.estado.toLowerCase() + ': no tiene material por recibir.');
    }
    const { hoja: hO, orden } = buscarOrden_(libro, req.ocFolio);
    if (orden.estado === OC_CANCELADA) throw new Error('La orden ' + orden.folio + ' está cancelada.');
    const avance = avanceRecepcion(orden.renglones, movimientosPorOc_(libro)[orden.folio.toUpperCase()] || [],
      renglonesSinRecepcion(propuestaVigente_(req)));
    if (avance.completo) throw new Error('Todo lo de la orden ya se recibió.');
    const rec = normalizarRecepcion(d0, avance.lineas, sitios);
    if (centro && rec.notas.length < 5) {
      throw new Error('Recepción de respaldo (el proyecto se recibe en el centro de mando): escribe en las notas por qué la registras aquí.');
    }
    if (!propio && rec.notas.length < 5) throw new Error('Registras la recepción en lugar de quien la recibe: escribe en las notas por qué.');
    // H (incremento 5): una foto por renglón recibido y, si se reporta un problema al recibir, se revisa antes de escribir nada
    const problemas = validarFotosYProblemas_(rec.renglones, fotos, avance.lineas, ocupadoEnDevoluciones_(libro, orden.folio), true, true);
    const hM = hojaCompras_(libro, 'MovimientosInventario');
    const folio = siguienteFolio_(PREFIJO_REC, hM, 'CONSECUTIVO_REC_');
    const archivo = bytes ? privado_(carpetaRequisiciones_(req.proyectoFolio).createFile(Utilities.newBlob(bytes, tipo.mime,
      nombreArchivoReq(req.folio, 'Recepción ' + folio, tipo.ext, 1)))) : null;
    const guardadas = guardarFotosRecepcion_(req.proyectoFolio, folio, fotos, rec.renglones); // H: Drive, privado_
    const ahora = ahoraTexto_(), t = textoCelda;
    rec.renglones.forEach(x => escribe_(hM).appendRow(conFotoMov_([folio, textoFecha_(hoyIso_()), ahora, TIPO_ENTRADA_COMPRA, t(rec.sitio), req.proyectoFolio,
      req.folio, orden.folio, x.renglon, t(x.clave), t(x.descripcion), t(x.unidad), x.cantidad, t(yo), t(nombreYo_()), t(rec.notas),
      archivo ? archivo.getId() : '', archivo ? archivo.getUrl() : '', 'Vigente', '', '', ''], guardadas[x.renglon])));
    crearDevolucionesDeRecepcion_(libro, req, orden, problemas, fotos); // H: problema reportado al recibir → DEV-…
    let nuevo = req.estado, retenida = '';
    if (rec.completo) {
      // H: con una devolución abierta no se cierra: queda Recibida (la orden sigue Pagada) hasta que compras la resuelva
      retenida = (req.estado === REQ_PAGADA || (req.estado === REQ_EN_CAMINO && orden.estado === OC_PAGADA)) ?
        devolucionAbiertaDe_(libro, req) : '';
      if (retenida) {
        nuevo = transicionReq(req.estado, 'recibirRetenida');
        escribe_(hO).getRange(orden.fila, COL_ESTADO_OC + 1, 1, 2).setValues([[textoFecha_(hoyIso_()), t(yo)]]);
      } else if (req.estado === REQ_PAGADA || (req.estado === REQ_EN_CAMINO && orden.estado === OC_PAGADA)) {
        nuevo = transicionReq(req.estado, 'recibirPagada');
        escribe_(hO).getRange(orden.fila, COL_ESTADO_OC, 1, 3).setValues([[OC_RECIBIDA, textoFecha_(hoyIso_()), t(yo)]]);
      } else {
        nuevo = transicionReq(req.estado, 'recibir'); // la orden sigue Emitida (sin pagar) con su fecha de recepción
        escribe_(hO).getRange(orden.fila, COL_ESTADO_OC + 1, 1, 2).setValues([[textoFecha_(hoyIso_()), t(yo)]]);
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
      (rec.completo ? (faltante ? 'última, con faltante' : 'completa') : 'parcial') + '): ' + lista +
      (centro ? ' · respaldo de compras (no llega al inventario del sitio en el centro de mando)' : propio ? '' : ' · registrada por compras') +
      (rec.notas ? ' · ' + rec.notas : '') + (retenida ? ' · ' + textoRetenida(retenida) : ''));
    notificar_('req.recibida', { req: req.folio, parcial: !rec.completo, sitio: rec.sitio, nota: rec.notas }); // correo a compras (6.B)
    bitacora_(libro, centro ? 'Registrar recepción (respaldo del centro de mando)' : 'Registrar recepción', req.proyectoFolio,
      folio + ' · ' + req.folio + ' · ' + orden.folio + ' · ' + rec.sitio + ' · ' + lista + (rec.completo ? ' · ' + nuevo : ' · parcial'),
      propio ? '' : rec.notas, HOJAS_COMPRAS);
    // Respaldo completo: el centro de mando deja de esperar el material (allá se registra a mano)
    if (centro && rec.completo) avisarPortal_('req.cerrada', orden.folio);
    SpreadsheetApp.flush();
    const resultado = { folio: folio, completo: rec.completo, estado: nuevo,
      requisiciones: requisicion ? misRequisiciones() : null, vista: compras ? vistaRequisicion_(libro, req.folio) : null };
    guardarIdempotencia_(cache, claveCache, resultado);
    return resultado;
  }));
}

/**
 * Compras cancela una recepción equivocada (sus movimientos quedan Cancelados, no se borran), con motivo. Si la requisición ya
 * estaba Recibida vuelve a En camino, Pagada o Autorizada según su orden (accionCancelarRecepcion); una Cerrada (pagada y
 * recibida) ya no se toca.
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
      // H (incremento 5): solo entradas por compra (una devolución o "Lo recogí" no se cancelan aquí)
      if (x.folio.toUpperCase() === folio && x.tipo === TIPO_ENTRADA_COMPRA) filas.push(x);
    });
    if (!filas.length) throw new Error('No existe la recepción ' + folio + '.');
    if (filas.every(x => x.estado === ESTADO_ANULADA)) throw new Error('La recepción ' + folio + ' está anulada.');
    if (!filas.some(x => x.estado === 'Vigente')) throw new Error('La recepción ' + folio + ' ya está cancelada.');
    const { hoja, req } = buscarReq_(libro, filas[0].reqFolio);
    if (req.estado === REQ_CERRADA) {
      throw new Error('La requisición ' + req.folio + ' ya está cerrada (pagada y recibida): la recepción no se puede cancelar.');
    }
    exigirSinDevoluciones_(libro, req, filas); // H: con una devolución de esos renglones, primero se resuelve
    const { hoja: hO, orden } = buscarOrden_(libro, filas[0].ocFolio);
    const ahora = ahoraTexto_(), t = textoCelda;
    filas.forEach(x => escribe_(hM).getRange(x.fila, 19, 1, 4).setValues([['Cancelado', t(yo_()), ahora, t(m)]]));
    let nuevo = req.estado;
    if (req.estado === REQ_RECIBIDA) {
      // Si ya iba en camino (centro de mando), vuelve a En camino; si no, a Pagada (orden pagada: estaba retenida por una
      // devolución) o a Autorizada (accionCancelarRecepcion)
      nuevo = transicionReq(req.estado, accionCancelarRecepcion(orden));
      cambiarReq_(hoja, req, nuevo, { notasRecepcion: '' });
      escribe_(hO).getRange(orden.fila, COL_ESTADO_OC + 1, 1, 2).setValues([['', '']]);
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

/** Facturas del libro de compras (con su fila), sin las anuladas salvo conAnuladas (no se ven ni cuentan). Sin libro: ninguna. */
function facturasDelLibro_(libro, conAnuladas) {
  if (!libro) return [];
  const lista = [];
  filasDeArea_(hojaCompras_(libro, 'FacturasProveedor'), HOJAS_COMPRAS, 'FacturasProveedor').forEach((r, i) => {
    if (String(r[0] || '').trim() && (conAnuladas || String(r[29] || '') !== ESTADO_ANULADA)) lista.push(facturaProvDesdeFila_(r, i + 2));
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
  const factura = facturasDelLibro_(libro, true).find(x => x.folio.toUpperCase() === folio);
  if (!factura) throw new Error('No existe la factura ' + folio + '.');
  if (factura.estado === ESTADO_ANULADA) throw new Error('La factura ' + factura.folio + ' está anulada.');
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
    escribe_(hoja).appendRow([
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
    escribe_(hoja).getRange(factura.fila, COL_ESTADO_FPR, 1, 4).setValues([[FPR_CANCELADA, textoCelda(VENDEDOR_.email),
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
    escribe_(hoja).getRange(factura.fila, COL_VENCIMIENTO_FPR, 1, 2).setValues([[textoFecha_(vence), n]]);
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
    let movimientos = {};
    if (libro) { // lo anulado no se debe ni cuenta (§6.E); las facturas anuladas las quita facturasDelLibro_
      movimientos = movimientosPorOc_(libro); // P (incremento 6): el saldo de una orden con pagos parciales descuenta lo devuelto
      filasDeArea_(hojaCompras_(libro, 'OrdenesCompra'), HOJAS_COMPRAS, 'OrdenesCompra').forEach((r, i) => {
        if (String(r[0] || '').trim() && String(r[28] || '') !== ESTADO_ANULADA) ordenes.push(ordenDesdeFila_(r, i + 2));
      });
      filasDeArea_(hojaCompras_(libro, 'PagosProveedores'), HOJAS_COMPRAS, 'PagosProveedores').forEach((r, i) => {
        if (String(r[0] || '').trim() && String(r[17] || '') !== ESTADO_ANULADA) pagos.push(pagoProvDesdeFila_(r, i + 2));
      });
    }
    const facturas = facturasDelLibro_(libro);
    const r = antiguedadCxp({ hoy: hoy, facturas: facturas, ordenes: ordenes, pagos: pagos, movimientos: movimientos });
    const proyectos = mapaProyectos_(), porFolio = {}, reqDeOrden = {};
    facturas.forEach(f => { porFolio[f.folio] = f; });
    ordenes.forEach(o => { reqDeOrden[o.folio.toUpperCase()] = o.reqFolio || ''; });
    const proyecto = folio => {
      const p = proyectos[String(folio || '').toUpperCase()];
      return { proyectoVisible: p ? p.folioVisible : folio, proyectoNombre: p ? p.nombre : '' };
    };
    r.abiertas.forEach(a => {
      const f = a.tipo === TIPO_CXP_SALDO ? {} : porFolio[a.folio] || {}; // P: un saldo sin factura lleva el folio de su orden
      Object.assign(a, proyecto(a.proyectoFolio), { reqFolio: f.reqFolio || reqDeOrden[String(a.ocFolio).toUpperCase()] || '',
        xmlUrl: f.xmlUrl || '', pdfUrl: f.pdfUrl || '' });
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
// Métodos del pago real a un proveedor (F, incremento 5; con tarjeta la referencia es la autorización o el ticket, nunca el
// número de la tarjeta). Los cobros a clientes (cobranza) siguen con METODOS_COBRO.
const METODOS_PAGO = ['Transferencia', 'Tarjeta de crédito', 'Tarjeta de débito', 'Efectivo', 'Cheque'];
const METODOS_COBRO = ['Transferencia', 'Efectivo', 'Cheque'];
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
 * Valida y limpia un pago. proyecto = {moneda, etapas (número de etapas), hoy "AAAA-MM-DD", metodos (opcional: los que se
 * aceptan; por omisión los de cobranza, METODOS_COBRO)}.
 * Devuelve {fecha, monto, monedaPago, tipoCambio, montoAplicado, metodo, referencia, etapaOrden}.
 * Nunca guarda el número de una tarjeta: una referencia que parece uno se rechaza (pareceNumeroTarjeta, F).
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
  const metodos = proyecto.metodos || METODOS_COBRO;
  const metodo = metodos.find(m => textoNormal(m) === textoNormal(d.metodo));
  if (!metodo) throw new Error('Elige el método de pago: ' + metodos.join(', ') + '.');
  const referencia = String(d.referencia || '').trim().replace(/\s+/g, ' ');
  const conTarjeta = /^tarjeta/i.test(metodo);
  if (!referencia && metodo !== 'Efectivo') {
    throw new Error('Captura la referencia (' + (metodo === 'Cheque' ? 'número de cheque' : conTarjeta
      ? 'número de autorización o del ticket; nunca el número de la tarjeta' : 'clave de rastreo o folio') + ').');
  }
  if (referencia.length > 100) throw new Error('La referencia debe tener máximo 100 caracteres.');
  if (pareceNumeroTarjeta(referencia)) {
    throw new Error('La referencia parece un número de tarjeta: nunca lo captures. Escribe el número de autorización o solo los ' +
      'últimos 4 dígitos de la tarjeta' + (conTarjeta ? '.' : ' (o la clave de rastreo o el folio, sin el número de la tarjeta).'));
  }
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
  const lista = (filas || []).map((r, i) => Object.assign({
    id: String(r[0] || '').trim(), razonSocial: String(r[1] || '').trim(), rfc: String(r[2] || '').trim(),
    contacto: String(r[3] || '').trim(), correo: String(r[4] || '').trim(), telefono: String(r[5] || '').trim(),
    actualizado: r[6] instanceof Date ? r[6].toISOString().slice(0, 10) : String(r[6] || ''),
    diasCredito: r[7] === '' || r[7] == null ? '' : diasCreditoGuardados(r[7]), fila: i + 2,
  }, fichaDeFila(r))).filter(p => p.razonSocial); // ficha (columnas I:Z): F, incremento 5
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
  const formaPago = normalizarFormaPago(d.formaPago, diasCredito); // F (incremento 5): obligatoria; crédito exige días ≥ 1
  const planPago = normalizarPlanPago(d.planPago); // P (incremento 6): opcional; si viene, suma 100%
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
      const x = { clave: limpio(r.clave).toUpperCase().slice(0, 30), descripcion: descripcion,
        unidad: limpio(r.unidad).toUpperCase().slice(0, 20) || 'PZA', cantidad: cantidad, costo: c, importe: redondear(cantidad * c) };
      const item = itemInventario(r.item, descripcion); // ítem del centro de mando (incremento 4; solo si tiene)
      if (item) x.item = item;
      return x;
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
    diasCredito: diasCredito, formaPago: formaPago, planPago: planPago, moneda: moneda, ivaTasa: ivaTasa, renglones: renglones, subtotal: subtotal, iva: iva, total: redondear(subtotal + iva),
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
    const ocs = (ordenes[folio] || []).filter(ocVigente); // ni canceladas ni anuladas
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
// Incremento 4 (centro de mando): En camino entre la orden (Autorizada) o el pago (Pagada) y la recepción. Pagar en camino la
// deja En camino (la orden queda Pagada); recibir todo la cierra (Cerrada si la orden está pagada; si no, Recibida). Cancelar la
// orden (sin pagar) la regresa como desde Autorizada; cancelar el pago la deja En camino; cancelar la recepción de una que iba en
// camino la regresa a En camino. Quien llama elige la acción según el estado de la orden (pagada o no).
const TRANSICIONES_REQ = {
  autorizar: { de: [REQ_SOLICITADA], a: REQ_AUTORIZADA },
  rechazar: { de: [REQ_SOLICITADA, REQ_APROBADA, REQ_COTIZADA], a: REQ_RECHAZADA },
  devolver: { de: [REQ_SOLICITADA, REQ_APROBADA, REQ_COTIZADA], a: REQ_DEVUELTA },
  reenviar: { de: [REQ_DEVUELTA], a: REQ_SOLICITADA },
  cancelar: { de: [REQ_SOLICITADA, REQ_DEVUELTA], a: REQ_CANCELADA },
  pagar: { de: [REQ_AUTORIZADA], a: REQ_PAGADA },
  cancelarPago: { de: [REQ_PAGADA], a: REQ_AUTORIZADA },
  cerrar: { de: [REQ_PAGADA], a: REQ_CERRADA },
  cancelarOc: { de: [REQ_AUTORIZADA, REQ_EN_CAMINO], a: REQ_SOLICITADA },
  // Con operaciones
  aprobar: { de: [REQ_SOLICITADA], a: REQ_APROBADA },
  cotizar: { de: [REQ_APROBADA, REQ_COTIZADA], a: REQ_COTIZADA },
  regresarACompras: { de: [REQ_COTIZADA], a: REQ_APROBADA },
  visto: { de: [REQ_COTIZADA], a: REQ_AUTORIZADA },
  recibir: { de: [REQ_AUTORIZADA, REQ_EN_CAMINO], a: REQ_RECIBIDA }, // En camino sin pagar
  recibirPagada: { de: [REQ_PAGADA, REQ_EN_CAMINO], a: REQ_CERRADA }, // En camino ya pagada
  pagarRecibida: { de: [REQ_RECIBIDA], a: REQ_CERRADA },
  cancelarOcAprobada: { de: [REQ_AUTORIZADA, REQ_EN_CAMINO], a: REQ_APROBADA },
  cancelarRecepcion: { de: [REQ_RECIBIDA], a: REQ_AUTORIZADA },
  // Centro de mando (incremento 4)
  enCamino: { de: [REQ_AUTORIZADA, REQ_PAGADA, REQ_EN_CAMINO], a: REQ_EN_CAMINO }, // otra vez en camino = corregir el envío
  cerrarEnCamino: { de: [REQ_EN_CAMINO], a: REQ_CERRADA }, // solo con la orden pagada (cerrarReq_)
  pagarEnCamino: { de: [REQ_EN_CAMINO], a: REQ_EN_CAMINO },
  cancelarPagoEnCamino: { de: [REQ_EN_CAMINO], a: REQ_EN_CAMINO },
  cancelarRecepcionEnCamino: { de: [REQ_RECIBIDA], a: REQ_EN_CAMINO },
  // Incremento 5 (revisión): una Recibida con la orden ya pagada (retenida por una devolución) vuelve a Pagada, no a Autorizada
  cancelarRecepcionPagada: { de: [REQ_RECIBIDA], a: REQ_PAGADA },
  // Devoluciones (incremento 5, módulo H). Con una devolución Abierta la requisición no se cierra: lo que la cerraría (recibir
  // todo con la orden pagada, o pagar la ya recibida) la deja Recibida hasta que compras la resuelva (cerrarRetenida la cierra).
  // "Reponer" regresa el renglón a por recibir: la requisición vuelve a Autorizada, Pagada o En camino según su orden.
  recibirRetenida: { de: [REQ_PAGADA, REQ_EN_CAMINO], a: REQ_RECIBIDA },
  pagarRetenida: { de: [REQ_RECIBIDA], a: REQ_RECIBIDA },
  cerrarRetenida: { de: [REQ_RECIBIDA], a: REQ_CERRADA },
  devolucionAutorizada: { de: [REQ_RECIBIDA, REQ_CERRADA], a: REQ_AUTORIZADA },
  devolucionPagada: { de: [REQ_RECIBIDA, REQ_CERRADA], a: REQ_PAGADA },
  devolucionEnCamino: { de: [REQ_RECIBIDA, REQ_CERRADA], a: REQ_EN_CAMINO },
  // Pagos parciales (incremento 6, P): cancelar el pago que completó una orden ya recibida (p. ej. retenida por una devolución) la
  // deja Recibida con el pago pendiente (la orden vuelve a Emitida, como con crédito del proveedor)
  cancelarPagoRecibida: { de: [REQ_RECIBIDA], a: REQ_RECIBIDA },
};
const VERBOS_REQ = { autorizar: 'autorizar', rechazar: 'rechazar', devolver: 'devolver', reenviar: 'reenviar', cancelar: 'cancelar',
  pagar: 'pagar', cancelarPago: 'cancelar el pago de', cerrar: 'cerrar', cancelarOc: 'regresar a Solicitada', aprobar: 'aprobar',
  cotizar: 'mandar la propuesta de', regresarACompras: 'regresar a compras', visto: 'dar el visto bueno a', recibir: 'recibir',
  recibirPagada: 'recibir', pagarRecibida: 'pagar', cancelarOcAprobada: 'regresar a Aprobada',
  cancelarRecepcion: 'cancelar la recepción de', enCamino: 'marcar en camino', pagarEnCamino: 'pagar',
  cancelarPagoEnCamino: 'cancelar el pago de', cancelarRecepcionEnCamino: 'cancelar la recepción de', cancelarRecepcionPagada: 'cancelar la recepción de', cerrarEnCamino: 'cerrar',
  recibirRetenida: 'recibir', pagarRetenida: 'pagar', cerrarRetenida: 'cerrar', devolucionAutorizada: 'reabrir por una devolución',
  devolucionPagada: 'reabrir por una devolución', devolucionEnCamino: 'reabrir por una devolución',
  cancelarPagoRecibida: 'cancelar el pago de' };

/**
 * Acción para regresar una requisición Recibida cuando se cancela o se anula una de sus recepciones (la orden espera material
 * otra vez): En camino si la orden ya había ido en camino; si no, Pagada si la orden está pagada (retenida por una devolución,
 * incremento 5) o Autorizada (sin pagar). La usan cancelarRecepcion y Anular.
 */
function accionCancelarRecepcion(orden) {
  const o = orden || {};
  return o.enCaminoEn ? 'cancelarRecepcionEnCamino' : o.estado === OC_PAGADA ? 'cancelarRecepcionPagada' : 'cancelarRecepcion';
}

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
      const x = { descripcion: descripcion, cantidad: Math.round(cantidad * 10000) / 10000,
        unidad: limpio(r.unidad).toUpperCase().slice(0, 20) || 'PZA', notas: notas };
      const item = itemInventario(r.item, descripcion); // ítem del centro de mando (opcional; incremento 4)
      if (item) x.item = item;
      return x;
    });
  if (!renglones.length) throw new Error('Agrega al menos un renglón con descripción y cantidad.');
  if (renglones.length > MAX_RENGLONES_REQ) throw new Error('Una requisición admite máximo ' + MAX_RENGLONES_REQ + ' renglones.');
  return renglones;
}

/**
 * Valida un pago a proveedor. orden = {moneda, total (lo esperado: el total de la orden o, con material devuelto sin reponer, el
 * total por pagar), pagado (lo que ya suman sus pagos Vigentes; 0 si no hay), fechaOrden, hoy, totalOrden?, descontado?}. Fecha no
 * futura ni anterior a la orden; método y referencia como en cobranza (nunca un número de tarjeta); si la moneda del pago es otra,
 * tipo de cambio obligatorio (pesos por dólar). P (incremento 6): el pago puede ser parcial (cualquier monto mayor a 0), pero lo
 * pagado más este pago no pasa de lo esperado + TOLERANCIA_PAGO (1.00). Si la orden ya está facturada con retenciones, el pago que
 * llega al total de sus facturas la completa (saldoOrdenCompra con orden.facturas; decisión 7 de facturas).
 */
function normalizarPagoProveedor(p, orden) {
  const d = p || {};
  const fecha = validarFechaIso(d.fecha, orden.hoy, 'La fecha del pago');
  if (orden.fechaOrden && fecha < orden.fechaOrden) throw new Error('La fecha del pago no puede ser anterior a la orden (' + orden.fechaOrden + ').');
  let pago;
  try {
    pago = normalizarPago(Object.assign({}, d, { fecha: fecha, etapaOrden: 1 }), { moneda: orden.moneda, etapas: 1, hoy: orden.hoy,
      metodos: METODOS_PAGO });
  } catch (e) {
    throw new Error(String(e.message).replace('El proyecto es en', 'La orden es en')); // aquí la moneda de referencia es la de la orden
  }
  const esperadoCts = aCentavos(orden.total), pagadoCts = aCentavos(Number(orden.pagado) || 0);
  if (pagadoCts + aCentavos(pago.montoAplicado) > esperadoCts + aCentavos(TOLERANCIA_PAGO)) {
    // Revisión (incremento 5): con material devuelto sin reponer, orden.total es el total por pagar (totalPorPagarOrden)
    const m = orden.moneda, neto = Number(orden.descontado) > 0;
    throw new Error('El pago (' + formatoMoneda(pago.montoAplicado) + ' ' + m + ') pasa el saldo de la orden: faltan ' +
      formatoMoneda(Math.max(0, esperadoCts - pagadoCts) / 100) + ' ' + m + ' por pagar (' + (neto
        ? 'total por pagar ' + formatoMoneda(orden.total) + ' ' + m + ': la orden de ' + formatoMoneda(orden.totalOrden) + ' menos ' +
          formatoMoneda(orden.descontado) + ' de material devuelto sin reponer'
        : 'total de la orden ' + formatoMoneda(orden.total) + ' ' + m) +
      (pagadoCts > 0 ? '; ya se pagaron ' + formatoMoneda(pagadoCts / 100) + ' ' + m : '') + '; tolerancia ±1.00).');
  }
  return { fecha: pago.fecha, monto: pago.monto, monedaPago: pago.monedaPago, tipoCambio: pago.tipoCambio,
    montoAplicado: pago.montoAplicado, metodo: pago.metodo, referencia: pago.referencia };
}

/**
 * (Lógica pura) Lo que ya no se le paga al proveedor, por renglón de la orden ({renglon: cantidad}): lo devuelto sin reponer
 * ("Devolver al proveedor" o "Cancelar renglón": movimientos Devolución sin reponer, cantidad negativa) y el faltante del centro de
 * mando que compras ya no espera (Faltante aceptado, cantidad positiva; misma resolución). Solo movimientos Vigentes.
 */
function devueltoSinReponer(movimientos) {
  const r4 = n => Math.round(n * 10000) / 10000, x = {};
  (movimientos || []).forEach(m => {
    if (m.estado !== 'Vigente') return;
    const c = Number(m.cantidad) || 0;
    if (m.tipo === TIPO_DEVOLUCION_CIERRA) x[m.renglon] = r4((x[m.renglon] || 0) - c);
    else if (m.tipo === TIPO_FALTANTE_ACEPTADO) x[m.renglon] = r4((x[m.renglon] || 0) + c);
  });
  Object.keys(x).forEach(k => { if (!(x[k] > 1e-9)) delete x[k]; });
  return x;
}

/**
 * (Lógica pura) Total por pagar de una orden a la que se le devolvió material sin reponer (revisión del 29/10/2026: con crédito
 * del proveedor se recibe y se devuelve antes de pagar). Se calcula exactamente como normalizarOrdenCompra calcula el total
 * (importe = redondear(cantidad × costo) por renglón, subtotal = redondear(suma), IVA = redondear(subtotal × tasa), total =
 * redondear(subtotal + IVA)) con la cantidad de cada renglón menos lo devuelto (devueltoSinReponer). orden = {renglones [{cantidad,
 * costo}], ivaTasa, total}. Devuelve null (se paga el total de siempre) si no hay nada que descontar o si el total guardado no se
 * reproduce con sus renglones (orden editada a mano o de otro cálculo: no se adivina); si no, {total, subtotal, iva, descontado
 * (total de la orden − total por pagar), totalOrden, renglones: [{renglon, cantidad, devuelto}]}.
 */
function totalPorPagarOrden(orden, devuelto) {
  const o = orden || {}, dv = devuelto || {};
  if (!Object.keys(dv).length) return null;
  const tasa = Number(o.ivaTasa) || 0, rs = Array.isArray(o.renglones) ? o.renglones : [];
  if (!rs.length) return null;
  const calcular = cantidades => {
    const subtotal = redondear(rs.reduce((suma, r, i) => suma + redondear(cantidades[i] * redondear(Number(r.costo) || 0)), 0));
    const iva = redondear(subtotal * tasa);
    return { subtotal: subtotal, iva: iva, total: redondear(subtotal + iva) };
  };
  const completo = calcular(rs.map(r => Number(r.cantidad) || 0));
  if (Math.abs(completo.total - (Number(o.total) || 0)) > 0.005) return null; // no se reproduce: no se adivina
  const cantidades = rs.map((r, i) => Math.max(0, Math.round(((Number(r.cantidad) || 0) - (Number(dv[i + 1]) || 0)) * 10000) / 10000));
  const neto = calcular(cantidades);
  if (Math.abs(neto.total - completo.total) < 0.005) return null;
  return { total: neto.total, subtotal: neto.subtotal, iva: neto.iva, totalOrden: completo.total,
    descontado: redondear(completo.total - neto.total),
    renglones: rs.map((r, i) => ({ renglon: i + 1, cantidad: cantidades[i], devuelto: Number(dv[i + 1]) || 0 })).filter(x => x.devuelto > 0) };
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

/** Para cotizar: los aprobados si hubo aprobación; si no (flujo de siempre), todos con la cantidad pedida (pura). */
function renglonesParaCotizar(renglones, aprobacion) {
  if (aprobacion && aprobacion.renglones) return renglonesAprobados(renglones, aprobacion);
  return (renglones || []).map(r => {
    const x = { renglon: r.renglon, descripcion: r.descripcion, unidad: r.unidad, notas: r.notas, cantidad: r.cantidad, pedida: r.cantidad };
    if (r.item) x.item = r.item;
    return x;
  });
}

/** Renglones aprobados: [{renglon, descripcion, unidad, notas, cantidad (la aprobada), pedida}]. */
function renglonesAprobados(renglones, aprobacion) {
  const dec = {};
  ((aprobacion && aprobacion.renglones) || []).forEach(a => { dec[a.renglon] = a; });
  return (renglones || []).filter(r => dec[r.renglon] && dec[r.renglon].aprobado).map(r => {
    const x = { renglon: r.renglon, descripcion: r.descripcion, unidad: r.unidad, notas: r.notas, cantidad: dec[r.renglon].cantidad,
      pedida: r.cantidad };
    if (r.item) x.item = r.item; // ítem del centro de mando que eligió quien pidió
    return x;
  });
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
    // Ítem del centro de mando: el que mande compras; si no manda nada, el exacto conserva el de quien pidió
    const item = r.item != null ? r.item : x === DISP_EXACTO ? a.item : '';
    return Object.assign(base, { comprar: true, clave: r.clave, descripcion: limpio(r.descripcion) || a.descripcion,
      unidad: limpio(r.unidad) || a.unidad, cantidad: r.cantidad === '' || r.cantidad == null ? a.cantidad : r.cantidad, costo: r.costo,
      item: item });
  }).concat(adicionales.map((r, i) => ({ renglon: 0, disponibilidad: DISP_ADICIONAL, nota: nota(r, 'adicional ' + (i + 1)),
    recibir: r.recibir !== false, comprar: true, clave: r.clave, descripcion: r.descripcion, unidad: r.unidad, cantidad: r.cantidad,
    costo: r.costo, item: r.item })));
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
    formaPago: formaPagoDeOrden(prop.formaPago, prop.diasCredito), // F: las propuestas de antes no la traen (regla de lectura)
    planPago: prop.planPago || null, // P (incremento 6): el plan que vio aprobaciones (las propuestas de antes no lo traen)
    ivaTasa: prop.ivaTasa, notas: prop.notas,
    renglones: (prop.renglones || []).filter(r => r.disponibilidad !== DISP_NO).map(r => {
      const x = { clave: r.clave, descripcion: r.descripcion, unidad: r.unidad, cantidad: r.cantidad, costo: r.costo };
      if (r.item) x.item = r.item; // la orden conserva el ítem del centro de mando
      return x;
    }),
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
  const recibido = {}, faltante = {};
  (movimientos || []).forEach(m => {
    if (m.estado !== 'Vigente') return;
    // Incremento 5 (H): devuelto sin reponer (devolver al proveedor o cancelar el renglón) = faltante aceptado: ya no se espera.
    // "Faltante aceptado" (cantidad positiva) solo baja lo que se espera: lo que nunca llegó no se había contado como recibido
    if (m.tipo === TIPO_FALTANTE_ACEPTADO) { faltante[m.renglon] = r4((faltante[m.renglon] || 0) + (Number(m.cantidad) || 0)); return; }
    recibido[m.renglon] = r4((recibido[m.renglon] || 0) + (Number(m.cantidad) || 0));
    if (m.tipo === TIPO_DEVOLUCION_CIERRA) faltante[m.renglon] = r4((faltante[m.renglon] || 0) - (Number(m.cantidad) || 0));
  });
  const lineas = (renglones || []).map((r, i) => {
    const pedido = Number(r.cantidad) || 0, rec = recibido[i + 1] || 0, falta = faltante[i + 1] || 0;
    return Object.assign({ renglon: i + 1, clave: r.clave || '', descripcion: r.descripcion, unidad: r.unidad, pedido: pedido, recibido: rec,
      pendiente: Math.max(0, r4(pedido - falta - rec)) }, falta ? { faltante: falta } : {});
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
 * (neto ≥ subtotal − TOLERANCIA_FACTURA). Solo una orden facturada completa se liquida con el total de sus facturas: con una
 * entrega aún sin facturar, ese total es menor que lo que se debe (desde el incremento 6 hay varios pagos: saldoOrdenCompra).
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
 * Cuentas por pagar. d = {facturas, ordenes, pagos, hoy, movimientos?}. facturas = [{folio, tipo, serieFolio, ocFolio, proyectoFolio,
 * moneda, subtotal, descuento, total, fechaEmision, fechaVencimiento, metodoPago, estado, nombreEmisor}], ordenes = [{folio,
 * fecha, proyectoFolio, proveedor, moneda, subtotal, total, estado, …} (ordenDesdeFila_)], pagos = pagos a proveedores [{ocFolio,
 * estado, montoAplicado}], movimientos = {FOLIO DE LA ORDEN: [movimientos]} (lo devuelto sin reponer; opcional).
 * Una orden sin pagos debe sus facturas Vigentes completas (como siempre). P (incremento 6): una orden con pagos que todavía no la
 * completan sigue en cuentas por pagar por su saldo (saldoOrdenCompra): lo pagado cubre sus facturas en orden de vencimiento y
 * cada factura queda por lo que le falta (pendiente); lo que no cubre ninguna factura es una fila "Saldo" (tipo Saldo, folio = la
 * orden) que vence con lo que sigue del plan de pagos (o recepción/entrega + días de crédito). Una orden completa no debe nada.
 * Devuelve {hoy, rangos, totales (uno por moneda, por lo pendiente; nunca suma monedas), abiertas (por vencimiento; cada una con
 * total, pendiente, pagado y pagoParcial), faltantes (órdenes vigentes con menos facturado que su subtotal; pagadas primero),
 * repPendientes (PPD en órdenes con pagos: falta su REP)}.
 */
function antiguedadCxp(d) {
  const hoy = d.hoy;
  const may = s => String(s || '').toUpperCase();
  const tol = aCentavos(TOLERANCIA_PAGO);
  const ordenes = {};
  (d.ordenes || []).forEach(o => { ordenes[may(o.folio)] = o; });
  const pagadas = {}, pagosPorOc = {};
  (d.pagos || []).forEach(p => {
    const f = may(p.ocFolio);
    (pagosPorOc[f] = pagosPorOc[f] || []).push(p);
    if (p.estado === 'Vigente') pagadas[f] = true;
  });
  const movs = d.movimientos || {};
  const vigentes = (d.facturas || []).filter(f => f.estado === FPR_VIGENTE);
  const facturasPorOc = {};
  vigentes.forEach(f => { const k = may(f.ocFolio); (facturasPorOc[k] = facturasPorOc[k] || []).push(f); });
  const porVencimiento = (a, b) => a.fechaVencimiento < b.fechaVencimiento ? -1 : a.fechaVencimiento > b.fechaVencimiento ? 1 :
    (a.folio < b.folio ? -1 : 1);

  const abiertas = [], totales = {}, completas = {};
  const agregar = (x, factura) => {
    const dias = diasEntre(x.fechaVencimiento, hoy);
    const rango = RANGOS_CXP.find(r => dias <= r.hasta);
    abiertas.push(Object.assign(x, { dias: dias, rango: rango.clave }));
    const t = totales[x.moneda] || (totales[x.moneda] = { moneda: x.moneda, facturas: 0, saldos: 0, centavos: {}, total: 0 });
    if (factura) t.facturas++; else t.saldos++;
    t.centavos[rango.clave] = (t.centavos[rango.clave] || 0) + aCentavos(x.pendiente);
  };
  const filaFactura = (f, o, pendienteCts, cubiertoCts, parcial) => ({ folio: f.folio, tipo: f.tipo, serieFolio: f.serieFolio, ocFolio: o.folio,
    proyectoFolio: o.proyectoFolio, proveedor: o.proveedor || f.nombreEmisor || '', fechaEmision: f.fechaEmision,
    fechaVencimiento: f.fechaVencimiento, moneda: f.moneda, total: redondear(f.total), pendiente: pendienteCts / 100,
    pagado: cubiertoCts / 100, pagoParcial: parcial });
  const folios = Object.keys(facturasPorOc).concat(Object.keys(pagadas).filter(k => !facturasPorOc[k]));
  folios.forEach(k => {
    const o = ordenes[k];
    if (!ocVigente(o)) return; // sin orden, cancelada o anulada: no se debe
    const fs = (facturasPorOc[k] || []).slice().sort(porVencimiento);
    if (!pagadas[k]) { fs.forEach(f => agregar(filaFactura(f, o, aCentavos(f.total), 0, false), true)); return; }
    const s = saldoOrdenCompra(Object.assign({}, o, { facturas: fs }), pagosPorOc[k], Array.isArray(movs) ?
      movs.filter(m => may(m.ocFolio) === k) : movs[k] || []);
    if (s.completo) { completas[k] = true; return; }
    let pagado = aCentavos(s.pagado), resto = aCentavos(s.saldo);
    fs.forEach(f => {
      const total = aCentavos(f.total), cubre = Math.min(total, pagado), pendiente = Math.min(total - cubre, resto);
      pagado -= cubre; resto -= pendiente;
      if (pendiente > 0) agregar(filaFactura(f, o, pendiente, cubre, true), true);
    });
    if (resto > tol) {
      // Lo que no cubre ninguna factura vence por el plan o la entrega (no por las facturas: esas ya tienen su fila)
      const sig = saldoOrdenCompra(Object.assign({}, o, { facturas: null }), pagosPorOc[k], Array.isArray(movs) ?
        movs.filter(m => may(m.ocFolio) === k) : movs[k] || []).siguiente || s.siguiente || {};
      agregar({ folio: o.folio, tipo: TIPO_CXP_SALDO, serieFolio: sig.concepto || 'Saldo', ocFolio: o.folio, proyectoFolio: o.proyectoFolio,
        proveedor: o.proveedor || '', fechaEmision: o.fecha || '', fechaVencimiento: sig.vence || o.fecha || hoy, moneda: o.moneda,
        total: resto / 100, pendiente: resto / 100, pagado: s.pagado, pagoParcial: true }, false);
    }
  });
  const listaTotales = Object.keys(totales).sort((a, b) => (a === 'MXN' ? -1 : b === 'MXN' ? 1 : a < b ? -1 : 1)).map(m => {
    const t = totales[m], r = { moneda: m, facturas: t.facturas, saldos: t.saldos };
    let suma = 0, vencido = 0;
    RANGOS_CXP.forEach(g => {
      const c = t.centavos[g.clave] || 0;
      r[g.clave] = c / 100; suma += c;
      if (g.clave !== 'porVencer') vencido += c;
    });
    r.vencido = vencido / 100; r.total = suma / 100;
    return r;
  });
  abiertas.sort(porVencimiento);

  const facturadoPorOrden = {};
  vigentes.forEach(f => { const k = may(f.ocFolio); facturadoPorOrden[k] = (facturadoPorOrden[k] || 0) + aCentavos(netoFactura(f)); });
  const faltantes = (d.ordenes || [])
    .filter(o => [OC_EMITIDA, OC_PAGADA, OC_RECIBIDA].indexOf(o.estado) !== -1)
    .map(o => {
      const facturado = facturadoPorOrden[may(o.folio)] || 0, falta = aCentavos(o.subtotal) - facturado;
      return { folio: o.folio, fecha: o.fecha, proyectoFolio: o.proyectoFolio, proveedor: o.proveedor, estado: o.estado,
        pagada: !!pagadas[may(o.folio)], pagoParcial: !!pagadas[may(o.folio)] && o.estado === OC_EMITIDA && !completas[may(o.folio)],
        moneda: o.moneda, subtotal: redondear(o.subtotal), facturado: facturado / 100, faltante: falta / 100, centavos: falta };
    })
    .filter(x => x.centavos > aCentavos(TOLERANCIA_FACTURA))
    .sort((a, b) => (a.pagada !== b.pagada ? (a.pagada ? -1 : 1) : String(a.fecha) < String(b.fecha) ? -1 : 1))
    .map(x => { delete x.centavos; return x; });

  const rep = vigentes.filter(f => f.tipo === FPR_CFDI && f.metodoPago === 'PPD' && pagadas[may(f.ocFolio)]).map(f => f.folio);
  return { hoy: hoy, rangos: RANGOS_CXP.map(r => ({ clave: r.clave, etiqueta: r.etiqueta })), totales: listaTotales,
    abiertas: abiertas, faltantes: faltantes, repPendientes: { n: rep.length, folios: rep } };
}
/** Tipo de la fila de cuentas por pagar de un saldo sin factura (P, incremento 6; folio = la orden de compra). */
const TIPO_CXP_SALDO = 'Saldo';

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
    dato('Forma de pago', d.formaPago) + dato('Condiciones de pago', d.condicionesPago) + // forma de pago: F, incremento 5
    dato('Plan de pagos', textoPlanPago(d.planPago, d.total, usd ? 'USD' : '')) + // P (incremento 6): opcional
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
  // Super admin solo para @helgen.tech (entra con Google): una cuenta de código nunca, aunque la hoja o SUPER_ADMIN lo digan
  const tech = dominioDe(c) === DOMINIO_HELGEN;
  if (tech && (ctx.superAdmins || []).indexOf(c) !== -1) return { activo: true, listado: true, roles: todos };
  const u = (ctx.usuarios || {})[c];
  if (u) {
    if (!u.activo) return { activo: false, listado: true, roles: [] };
    const propios = u.roles.filter(r => tech || r !== 'superadmin');
    return { activo: true, listado: true, roles: propios.indexOf('superadmin') !== -1 ? todos : propios };
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
// Permisos: un super admin da de alta, edita y desactiva usuarios (pestaña Permisos del libro de Administración); el super
// admin raíz (SUPER_ADMIN) no se desactiva ni pierde Super admin desde la página. Delegaciones: quien tiene Aprobaciones o
// Compras los entrega a otra persona activa por unas fechas (máx. 90 días); los dos pueden actuar; termina sola. Entrar con
// código: las cuentas @helgen.services piden un código de 6 dígitos por correo y reciben una sesión de CAPRI firmada
// (capri.<datos>.<firma>, HMAC-SHA256 con SESION_SECRETO) que dura 30 días y se renueva sola mientras se usa.

function modIdentidad_() {
  // Solo declaraciones de función y literales: las const de esta sección todavía no existen cuando se llama (arriba)
  return { nombre: 'Identidad',
    api: { listarUsuarios: listarUsuarios, guardarUsuario: guardarUsuario, listarDelegaciones: listarDelegaciones,
      crearDelegacion: crearDelegacion, cancelarDelegacion: cancelarDelegacion, solicitarCodigo: solicitarCodigo,
      verificarCodigo: verificarCodigo, cerrarSesionCapri: cerrarSesionCapri },
    cambios: { guardarUsuario: ['permisos'], crearDelegacion: ['permisos'], cancelarDelegacion: ['permisos'] },
    // Quien aprueba puede ser una cuenta de solo requisiciones: también delega (cada función revisa sus reglas)
    solo: ['listarDelegaciones', 'crearDelegacion', 'cancelarDelegacion', 'cerrarSesionCapri'],
    publicas: ['solicitarCodigo', 'verificarCodigo'],
    bootstrap: function () {
      const s = renovarSesionCapri_();
      return s ? { sesionCapri: s } : {};
    },
    sincronizar: function (permisos, ctx, algo, r, errores) {
      const s = renovarSesionCapri_();
      if (s) r.sesionCapri = s;
      if (!algo('permisos')) return;
      if (ctx.admPermisos && permisos.superadmin) r.admPermisos = intentar_(errores, 'Permisos', listarUsuarios);
      if (ctx.admDelegaciones && puedeVerDelegaciones_()) r.admDelegaciones = intentar_(errores, 'Delegaciones', listarDelegaciones);
    },
    preparar: function () {
      secretoSesion_(true);
      console.log('SESION_SECRETO listo (no se muestra). Correos que quedan hoy: ' + MailApp.getRemainingDailyQuota());
    } };
}

const DIAS_SESION_CAPRI = 30;        // la sesión de CAPRI dura 30 días (pedido de Leo, 28/10/2026: "que no se cierre")
const DIAS_RENOVAR_SESION_CAPRI = 15; // si le quedan menos, bootstrap / sincronizar mandan una nueva (sesionCapri)
const MAX_DIAS_ANTICIPO_DELEGACION = 30; // y empieza a más tardar en 30 días
const MAX_DIAS_DELEGACION = 90;       // una delegación dura como máximo 90 días (contando el primero y el último)
const CODIGO_VIGENCIA_MS = 10 * 60000, CODIGO_MAX_POR_HORA = 5, CODIGO_MAX_ERRORES = 5, CODIGO_BLOQUEO_MS = 15 * 60000;
const MENSAJE_CODIGO_ENVIADO = 'Si el correo está dado de alta, te llegó un código.';
const CLAVE_SESION_DESDE = 'SESION_DESDE_';
// Límites globales (todas las cuentas juntas; revisión de seguridad 28/10/2026): códigos por hora, intentos fallidos por hora,
// correos que se guardan para los avisos del día y tiempo mínimo de respuesta (no deja medir si el correo existe)
const CODIGO_MAX_GLOBAL_HORA = 30, CODIGO_MAX_ERRORES_GLOBAL_HORA = 60, CODIGO_RESERVA_CUOTA = 40, CODIGO_RESPUESTA_MIN_MS = 1500;
const MENSAJE_CODIGO_GLOBAL = 'Se pidieron muchos códigos en la última hora. Espera un rato y vuelve a intentarlo.';
const MENSAJE_CODIGO_BLOQUEO = 'Demasiados intentos con este correo. Espera 15 minutos y pide un código nuevo.';

// ---- Permisos (solo super admin) ----

/**
 * Página de Permisos: usuarios de la pestaña Permisos (más el super admin raíz aunque no esté en ella), roles con su nombre y
 * sitios con código. Sin libro de Administración (antes de prepararCapri): los de Script Properties y libro: false (no se edita).
 */
function listarUsuarios() {
  exigirSuperAdmin_();
  return vistaPermisos_();
}

function vistaPermisos_() {
  const p = propiedades_();
  const raiz = correosCapri(p.SUPER_ADMIN);
  const hayLibro = !!p[AREA_ADMIN.propLibro];
  let usuarios;
  if (hayLibro) {
    usuarios = enCache_('admPermisos', ['permisos'], TTL_CACHE, () =>
      filasDeArea_(hojaAdmin_(libroAdmin_(), 'Permisos'), HOJAS_ADMIN, 'Permisos').map(usuarioDeFilaAdmin_).filter(Boolean));
  } else {
    const m = usuariosDesdePropiedades(p);
    usuarios = Object.keys(m).map(c => Object.assign({}, m[c], { actualizo: '', actualizado: '' }));
  }
  usuarios = usuarios.map(u => Object.assign({}, u, { raiz: raiz.indexOf(u.correo) !== -1, enLista: true }));
  raiz.forEach(c => {
    if (!usuarios.some(u => u.correo === c)) {
      usuarios.push({ correo: c, nombre: '', metodo: 'google', roles: ['superadmin'], sitio: '', activo: true, notas: '',
        actualizo: '', actualizado: '', raiz: true, enLista: false });
    }
  });
  usuarios.sort((a, b) => (b.activo ? 1 : 0) - (a.activo ? 1 : 0) ||
    String(a.nombre || a.correo).localeCompare(String(b.nombre || b.correo), 'es'));
  let sitios = [];
  try { sitios = sitiosDetalle_(); } catch (e) { sitios = []; }
  return { libro: hayLibro, usuarios: usuarios, raiz: raiz, yo: VENDEDOR_ ? yo_() : '',
    roles: ROLES_CAPRI.map(r => ({ clave: r, nombre: NOMBRES_ROLES[r] })), rolesServicios: ROLES_SERVICIOS,
    rolesConSolo: ROLES_CON_SOLO, dominioServicios: DOMINIO_SERVICIOS, sitios: sitios };
}

/** Usuario de una fila de Permisos con quién y cuándo se cambió (null si la fila no tiene un correo de CAPRI). */
function usuarioDeFilaAdmin_(r) {
  const correo = correoCapri(r[0]);
  if (!correo) return null;
  return Object.assign({}, usuariosDesdeFilas([r])[correo], { actualizo: String(r[7] || ''), actualizado: fechaTexto_(r[8]) });
}

/**
 * Alta (p.nuevo) o edición de un usuario: p = {correo, nombre, roles, sitio, activo, notas, nuevo}. Valida con
 * normalizarUsuario; @helgen.services solo "Solo requisiciones" (entra con código). El super admin raíz no se desactiva ni
 * pierde Super admin; nadie se desactiva ni se quita Super admin a sí mismo. Queda en la Bitacora de Administración; el alta
 * avisa a la persona (usuario.alta). Devuelve la página de Permisos.
 */
function guardarUsuario(p) {
  exigirSuperAdmin_();
  const x = p || {};
  const u = normalizarUsuario(x);
  if (!propiedades_()[AREA_ADMIN.propLibro]) {
    throw new Error('Falta preparar CAPRI: Efrain debe correr prepararCapri() desde el editor de Apps Script. Mientras, los roles ' +
      'siguen en Script Properties.');
  }
  const libro = libroAdmin_();
  if (u.sitio) {
    const codigos = sitiosDetalle_().map(s => s.codigo).filter(Boolean);
    if (codigos.length && codigos.indexOf(u.sitio) === -1) {
      throw new Error('El sitio ' + u.sitio + ' no está en la lista de sitios (Config → SITIOS): ' + codigos.join(', ') + '.');
    }
  }
  const yo = yo_(), raiz = correosCapri(propiedades_().SUPER_ADMIN);
  const esSuper = u.roles.indexOf('superadmin') !== -1;
  if (raiz.indexOf(u.correo) !== -1) {
    if (!u.activo) throw new Error(u.correo + ' es el super admin raíz (SUPER_ADMIN): no se puede desactivar desde aquí.');
    if (!esSuper) throw new Error(u.correo + ' es el super admin raíz (SUPER_ADMIN): no se le puede quitar "Super admin".');
  }
  return conCandado_(() => {
    const hoja = hojaAdmin_(libro, 'Permisos');
    const filas = filasDeArea_(hoja, HOJAS_ADMIN, 'Permisos');
    const i = filas.findIndex(r => correoCapri(r[0]) === u.correo);
    if (x.nuevo && i !== -1) throw new Error(u.correo + ' ya está dado de alta: búscalo en la lista para editarlo.');
    if (!x.nuevo && i === -1) throw new Error(u.correo + ' no está en Permisos: usa "Agregar usuario".');
    const antes = i === -1 ? null : usuariosDesdeFilas([filas[i]])[u.correo];
    if (u.correo === yo && antes && antes.activo && !u.activo) {
      throw new Error('No puedes desactivar tu propia cuenta: pídeselo a otro super admin.');
    }
    if (u.correo === yo && antes && antes.roles.indexOf('superadmin') !== -1 && !esSuper && raiz.indexOf(yo) === -1) {
      throw new Error('No puedes quitarte "Super admin" a ti mismo: pídeselo a otro super admin.');
    }
    const ahora = ahoraTexto_();
    const fila = filaDeUsuario(u, yo, ahora).map(textoCelda);
    fila[8] = "'" + ahora; // texto: Sheets no lo convierte en fecha
    if (i === -1) escribe_(hoja).appendRow(fila);
    else escribe_(hoja).getRange(i + 2, 1, 1, fila.length).setValues([fila]);
    const cambio = cambioDeUsuario(antes, u);
    // Mientras está desactivado, exigirAcceso_ lo frena (ACCESO). Al reactivarlo, sus sesiones viejas ya no valen: entra con
    // un código nuevo (una sesión robada antes de desactivarlo no revive)
    if (antes && !antes.activo && u.activo && dominioDe(u.correo) === DOMINIO_SERVICIOS) revocarSesionesCapri_(u.correo);
    bitacoraAdmin_(cambio.accion, u.correo, cambio.detalle, '');
    if (!antes && u.activo) {
      notificar_('usuario.alta', { para: [u.correo], correo: u.correo, nombre: u.nombre, metodo: u.metodo, sitio: u.sitio,
        roles: u.roles.map(r => NOMBRES_ROLES[r]) });
    }
    SpreadsheetApp.flush();
    return vistaPermisos_();
  });
}

// ---- Delegaciones ----

/** ¿Puede usar Delegaciones? Super admin (todas) o quien tiene hoy Aprobaciones o Compras (solo las suyas). */
function puedeVerDelegaciones_() {
  return !!VENDEDOR_ && (esSuperAdmin_() || tieneRol_('aprobaciones') || tieneRol_('compras'));
}

function exigirDelegaciones_() {
  if (!VENDEDOR_) throw errorSesion_('Inicia sesión para continuar.');
  if (!puedeVerDelegaciones_()) throw errorPermiso_('Las delegaciones son para quien tiene Aprobaciones o Compras.');
}

/** Lo que normalizarDelegacion y las vistas necesitan, leído fresco (en una escritura, de la hoja; si no, del caché). */
function ctxIdentidad_() {
  const p = propiedades_();
  return { usuarios: usuariosCapri_(), delegaciones: delegacionesCapri_(), hoy: hoyIso_(),
    superAdmins: correosCapri(p.SUPER_ADMIN), soloListados: String(p.PERMISOS_SOLO_LISTADOS || '') === '1' };
}

/** Delegaciones que ve el usuario (super admin: todas; los demás: las que dio y las que recibió). */
function listarDelegaciones() {
  exigirDelegaciones_();
  return vistaDelegaciones_();
}

function vistaDelegaciones_() {
  const ctx = ctxIdentidad_(), yo = yo_(), sa = esSuperAdmin_();
  const nombre = c => (ctx.usuarios[c] && ctx.usuarios[c].nombre) || c;
  const delegables = c => rolesPropios_(c, ctx).roles.filter(r => ROLES_DELEGABLES.indexOf(r) !== -1);
  const lista = ctx.delegaciones.filter(d => sa || d.de === yo || d.a === yo).map(d => {
    const estado = estadoDelegacion(d, ctx.hoy);
    return { id: d.id, de: d.de, deNombre: nombre(d.de), a: d.a, aNombre: nombre(d.a), desde: d.desde, hasta: d.hasta,
      roles: d.roles, rolesNombres: d.roles.map(r => NOMBRES_ROLES[r]), estado: estado, creo: d.creo, creado: d.creado,
      cancelo: d.cancelo, motivo: d.motivo,
      puedeCancelar: (estado === 'Vigente' || estado === 'Programada') && (sa || d.de === yo || d.a === yo) };
  }).reverse();
  const activos = Object.keys(ctx.usuarios).map(c => ctx.usuarios[c]).filter(u => u.activo);
  const r = { hoy: ctx.hoy, yo: yo, superadmin: sa, maxDias: MAX_DIAS_DELEGACION, delegaciones: lista, misRoles: delegables(yo),
    roles: ROLES_DELEGABLES.map(x => ({ clave: x, nombre: NOMBRES_ROLES[x] })),
    // A quién se puede delegar: activos de Permisos con @helgen.tech (solo = no recibe Compras)
    candidatos: activos.filter(u => dominioDe(u.correo) === DOMINIO_HELGEN)
      .map(u => ({ correo: u.correo, nombre: u.nombre || u.correo, solo: u.roles.indexOf('solo_requisicion') !== -1 }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')) };
  if (sa) {
    const todos = activos.map(u => u.correo).concat(ctx.superAdmins).filter((c, i, a) => a.indexOf(c) === i);
    r.delegadores = todos.map(c => ({ correo: c, nombre: nombre(c), roles: delegables(c) })).filter(x => x.roles.length)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }
  return r;
}

/**
 * Nueva delegación: p = {de (solo un super admin puede poner a otra persona; si no, es quien llama), a, roles, desde, hasta}.
 * Reglas en normalizarDelegacion. Queda en la Bitacora de Administración y avisa al delegado (delegacion).
 */
function crearDelegacion(p) {
  exigirDelegaciones_();
  const x = p || {}, yo = yo_(), sa = esSuperAdmin_();
  const de = correoCapri(x.de) || yo;
  if (de !== yo && !sa) throw errorPermiso_('Solo un super admin puede crear una delegación a nombre de otra persona.');
  if (!propiedades_()[AREA_ADMIN.propLibro]) {
    throw new Error('Falta preparar CAPRI: Efrain debe correr prepararCapri() desde el editor de Apps Script.');
  }
  const libro = libroAdmin_();
  return conCandado_(() => {
    const ctx = ctxIdentidad_(); // en una escritura se lee de la hoja (incluye lo que otro guardó hace un momento)
    const d = normalizarDelegacion(Object.assign({}, x, { de: de }), ctx);
    const hoja = hojaAdmin_(libro, 'Delegaciones');
    const anio = ctx.hoy.slice(0, 4);
    const ids = filasDeArea_(hoja, HOJAS_ADMIN, 'Delegaciones').map(r => r[0]);
    const id = formatearFolio('DEL', anio, maxConsecutivo(ids, 'DEL', anio) + 1);
    const t = textoCelda, ahora = ahoraTexto_();
    escribe_(hoja).appendRow([id, t(d.de), t(d.a), textoFecha_(d.desde), textoFecha_(d.hasta), d.roles.join(', '), 'Activa', t(yo),
      "'" + ahora, '', '']);
    const nombres = d.roles.map(r => NOMBRES_ROLES[r]);
    bitacoraAdmin_('Delegar roles', id, d.de + ' → ' + d.a + ' · ' + nombres.join(', ') + ' · del ' + d.desde + ' al ' + d.hasta, '');
    notificar_('delegacion', { para: [d.a], id: id, de: d.de, a: d.a, deNombre: nombreDeCorreo_(d.de),
      aNombre: nombreDeCorreo_(d.a), desde: d.desde, hasta: d.hasta, roles: nombres, creo: yo });
    SpreadsheetApp.flush();
    return vistaDelegaciones_();
  });
}

/** Cancela una delegación vigente o programada (quien la dio, quien la recibe o un super admin), con motivo. */
function cancelarDelegacion(id, motivo) {
  exigirDelegaciones_();
  const m = motivoObligatorio_(motivo, 'Escribe por qué cancelas la delegación (mínimo 5 caracteres).');
  if (!propiedades_()[AREA_ADMIN.propLibro]) throw new Error('No hay delegaciones: falta preparar CAPRI (prepararCapri).');
  const libro = libroAdmin_(), yo = yo_(), sa = esSuperAdmin_();
  return conCandado_(() => {
    const hoja = hojaAdmin_(libro, 'Delegaciones');
    const filas = filasDeArea_(hoja, HOJAS_ADMIN, 'Delegaciones');
    const i = filas.findIndex(r => String(r[0]).trim().toUpperCase() === String(id || '').trim().toUpperCase());
    if (i === -1) throw new Error('No existe la delegación ' + String(id || '') + '.');
    const d = delegacionesDesdeFilas([filas[i]])[0];
    if (!d) throw new Error('La delegación ' + String(id) + ' está incompleta en la hoja.');
    if (!sa && d.de !== yo && d.a !== yo) throw errorPermiso_('Solo quien la dio, quien la recibe o un super admin la cancela.');
    const estado = estadoDelegacion(d, hoyIso_());
    if (estado === 'Cancelada') throw new Error('La delegación ' + d.id + ' ya estaba cancelada.');
    if (estado === 'Terminada') throw new Error('La delegación ' + d.id + ' ya terminó: no hace falta cancelarla.');
    escribe_(hoja).getRange(i + 2, 7).setValue('Cancelada');
    escribe_(hoja).getRange(i + 2, 10, 1, 2).setValues([[textoCelda(yo), textoCelda(m)]]);
    bitacoraAdmin_('Cancelar delegación', d.id, d.de + ' → ' + d.a, m);
    SpreadsheetApp.flush();
    return vistaDelegaciones_();
  });
}

// ---- Excepción de super admin a la separación de funciones (aprobar lo propio, visto bueno a lo que uno preparó) ----

/** ¿Se puede pasar por alto la regla? Super admin con motivo ≥ 10 caracteres (excepcionSuperAdmin_ lo deja en la Bitacora). */
function excepcionPosible_(motivo) {
  return esSuperAdmin_() && String(motivo == null ? '' : motivo).trim().length >= 10;
}

/** Lo que se agrega al error de separación de funciones cuando quien lo intenta es super admin (la interfaz pide el motivo). */
function textoExcepcion_() {
  return esSuperAdmin_() ? ' Como super admin puedes hacerlo si escribes el motivo (mínimo 10 caracteres; queda en la bitácora).' : '';
}

// ---- Entrar con código (@helgen.services) y sesiones de CAPRI ----

/** Correo para el código: un @helgen.services válido (las @helgen.tech entran con Google). */
function correoParaCodigo_(texto) {
  const c = correoCapri(texto);
  if (!c) {
    throw new Error(String(texto == null ? '' : texto).trim() ? 'Escribe un correo @' + DOMINIO_SERVICIOS + ' válido.'
      : 'Escribe tu correo @' + DOMINIO_SERVICIOS + '.');
  }
  if (dominioDe(c) !== DOMINIO_SERVICIOS) throw new Error('Las cuentas @' + DOMINIO_HELGEN + ' entran con el botón de Google.');
  return c;
}

/** Usuario activo de Permisos con @helgen.services al que se le puede mandar código (null si no). */
function usuarioParaCodigo_(correo) {
  if (dominioDe(correo) !== DOMINIO_SERVICIOS) return null;
  const u = usuarioCapri_(correo);
  return u && u.activo && rolesEfectivos(correo, contextoRoles_()).activo ? u : null;
}

/** Secreto de las sesiones de CAPRI (Script Property SESION_SECRETO). crear: si falta, lo crea al azar. Nunca se registra. */
function secretoSesion_(crear) {
  const actual = propiedades_().SESION_SECRETO;
  if (actual || !crear) return actual || '';
  const lock = candado_();
  if (!lock.tryLock(10000)) throw new Error('El sistema está ocupado. Intenta de nuevo en unos segundos.');
  try {
    const props = PropertiesService.getScriptProperties();
    let s = props.getProperty('SESION_SECRETO');
    if (!s) {
      const azar = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
        Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid() + Date.now());
      s = Utilities.base64EncodeWebSafe(azar).replace(/=+$/, '');
      props.setProperty('SESION_SECRETO', s);
    }
    return s;
  } finally {
    lock.releaseLock();
    MEMO_.props = null;
  }
}

/** Firma (base64url sin relleno) de los datos de una sesión de CAPRI. */
function firmaSesion_(datos, secreto) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(datos, secreto)).replace(/=+$/, '');
}

/** Sesión de CAPRI: capri.<base64url de {e: correo, x: vence (epoch s), n: nombre}>.<firma>. */
function emitirSesionCapri_(correo, nombre) {
  const secreto = secretoSesion_(true);
  // i = cuándo se emitió (ms): una sesión emitida antes de SESION_DESDE_<huella> ya no vale (cerrar sesión, desactivar)
  const datos = { e: correo, x: Math.floor(Date.now() / 1000) + DIAS_SESION_CAPRI * 86400, n: String(nombre || '').slice(0, 80),
    i: Date.now() };
  const carga = Utilities.base64EncodeWebSafe(JSON.stringify(datos), Utilities.Charset.UTF_8).replace(/=+$/, '');
  return PREFIJO_SESION_CAPRI + carga + '.' + firmaSesion_(carga, secreto);
}

/** Texto UTF-8 de un base64url (con o sin relleno). */
function textoDeBase64Url_(s) {
  const bytes = Utilities.base64DecodeWebSafe(s + '==='.slice((s.length + 3) % 4));
  return decodeURIComponent(bytes.map(b => '%' + ((b + 256) % 256).toString(16).padStart(2, '0')).join(''));
}

/**
 * Verifica una sesión de CAPRI: firma (comparación de tiempo constante), vencimiento y que el correo siga siendo @helgen.services.
 * Devuelve {email, nombre, apellido: ''}. Si la cuenta se desactivó, exigirAcceso_ la corta enseguida (en doPost).
 */
function verificarSesionCapri_(token) {
  const t = String(token || '');
  const invalida = () => errorSesion_('Tu sesión no es válida. Inicia sesión otra vez.');
  if (t.length > 2048 || t.indexOf(PREFIJO_SESION_CAPRI) !== 0) throw invalida();
  const partes = t.slice(PREFIJO_SESION_CAPRI.length).split('.');
  if (partes.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(partes[0]) || !/^[A-Za-z0-9_-]+$/.test(partes[1])) throw invalida();
  const secreto = secretoSesion_(false);
  if (!secreto || !mismoTexto_(firmaSesion_(partes[0], secreto), partes[1])) throw invalida();
  let d;
  try { d = JSON.parse(textoDeBase64Url_(partes[0])); } catch (e) { throw invalida(); }
  const correo = correoCapri(d && d.e);
  const ahora = Math.floor(Date.now() / 1000), vence = Number(d && d.x);
  if (!correo || dominioDe(correo) !== DOMINIO_SERVICIOS || !Number.isFinite(vence)) throw invalida();
  if (vence > ahora + (DIAS_SESION_CAPRI + 1) * 86400) throw invalida();
  if (vence <= ahora) throw errorSesion_('Tu sesión expiró. Pide un código nuevo para entrar.');
  const desde = Number(propiedades_()[CLAVE_SESION_DESDE + huellaCorreo_(correo)]) || 0;
  if (desde && (Number(d.i) || 0) <= desde) throw errorSesion_('Tu sesión se cerró. Pide un código nuevo para entrar.');
  MEMO_.sesionCapri = { email: correo, x: vence };
  return { email: correo, nombre: String(d.n || '') || correo, apellido: '' };
}

/**
 * Cierra todas las sesiones de CAPRI de un correo emitidas hasta ahora (Script Property SESION_DESDE_<huella del correo>, en ms).
 * Lo usan "Cerrar sesión" y desactivar a alguien en Permisos (al reactivarlo, su sesión vieja ya no sirve).
 */
function revocarSesionesCapri_(correo) {
  PropertiesService.getScriptProperties().setProperty(CLAVE_SESION_DESDE + huellaCorreo_(correo), String(Date.now()));
  MEMO_.props = null;
}

/** API: "Cerrar sesión" de una cuenta @helgen.services: la sesión deja de valer también en el servidor. Con Google, nada. */
function cerrarSesionCapri() {
  if (MEMO_.sesionCapri && VENDEDOR_ && MEMO_.sesionCapri.email === VENDEDOR_.email) revocarSesionesCapri_(VENDEDOR_.email);
  return { cerrada: true };
}

/** Sesión nueva si a la de esta petición (CAPRI) le quedan menos de 15 días; null si no hace falta o si es de Google. */
function renovarSesionCapri_() {
  const s = MEMO_.sesionCapri;
  if (!s || !VENDEDOR_ || s.email !== VENDEDOR_.email) return null;
  if (s.x - Math.floor(Date.now() / 1000) >= DIAS_RENOVAR_SESION_CAPRI * 86400) return null;
  return emitirSesionCapri_(s.email, nombreDeCorreo_(s.email));
}

/** Compara dos textos sin salir antes (no deja medir cuántos caracteres coinciden). */
function mismoTexto_(a, b) {
  const x = String(a), y = String(b);
  let dif = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) dif |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return dif === 0;
}

const huellaCorreo_ = c => Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'capri-correo|' + c))
  .replace(/=+$/, '');
const huellaCodigo_ = (secreto, c, codigo) => Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
  secreto + '|' + c + '|' + codigo));
const jsonCache_ = v => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
/** Marcas de tiempo (ms) posteriores a desde, de una lista guardada en el caché. */
const recientes_ = (v, desde) => (jsonCache_(v) || []).filter(t => Number(t) > desde);

/** Código de 6 dígitos al azar (de UUID aleatorios: Math.random no es seguro). */
function codigoAleatorio_() {
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid());
  const n = (((b[0] & 255) << 24) >>> 0) + ((b[1] & 255) << 16) + ((b[2] & 255) << 8) + (b[3] & 255);
  return String(n % 1000000).padStart(6, '0');
}

/** Candado corto para los contadores del código (dos pestañas no se saltan los límites). */
function candadoCodigo_(f) {
  const lock = candado_();
  if (!lock.tryLock(15000)) throw new Error('El sistema está ocupado. Intenta de nuevo en unos segundos.');
  try { return f(); } finally { lock.releaseLock(); }
}

/**
 * Pública (sin sesión): manda un código de 6 dígitos a un @helgen.services activo en Permisos. Responde lo mismo esté o no
 * dado de alta (no deja averiguar quién existe). Vale 10 minutos, una vez; máx. 5 por correo por hora; tras 5 intentos
 * fallidos el correo se bloquea 15 minutos. En el caché solo queda la huella del código (con SESION_SECRETO).
 */
function solicitarCodigo(correo) {
  const c = correoParaCodigo_(correo);
  const secreto = secretoSesion_(true);
  const h = huellaCorreo_(c), cache = CacheService.getScriptCache(), ahora = Date.now();
  const envio = candadoCodigo_(() => {
    const bloqueo = jsonCache_(cache.get('CAPRI_BLQ_' + h));
    if (bloqueo && bloqueo.hasta > ahora) throw new Error(MENSAJE_CODIGO_BLOQUEO);
    // Tope de todas las cuentas juntas: nadie agota la cuota de correo del día pidiendo códigos (los avisos van primero)
    const todos = recientes_(cache.get('CAPRI_PED_TODOS'), ahora - 3600000);
    if (todos.length >= CODIGO_MAX_GLOBAL_HORA) throw new Error(MENSAJE_CODIGO_GLOBAL);
    todos.push(ahora);
    cache.put('CAPRI_PED_TODOS', JSON.stringify(todos), 3600);
    // Se cuentan todos los pedidos (con o sin alta): el límite no revela quién existe
    const pedidos = recientes_(cache.get('CAPRI_PED_' + h), ahora - 3600000);
    if (pedidos.length >= CODIGO_MAX_POR_HORA) {
      throw new Error('Ya se pidieron ' + CODIGO_MAX_POR_HORA + ' códigos para este correo en la última hora. Espera un rato y vuelve a intentarlo.');
    }
    pedidos.push(ahora);
    cache.put('CAPRI_PED_' + h, JSON.stringify(pedidos), 3600);
    const u = usuarioParaCodigo_(c);
    if (!u) return null;
    const codigo = codigoAleatorio_(); // el nuevo reemplaza al anterior
    cache.put('CAPRI_COD_' + h, JSON.stringify({ h: huellaCodigo_(secreto, c, codigo), x: ahora + CODIGO_VIGENCIA_MS }), 600);
    return { u: u, codigo: codigo };
  });
  if (envio) {
    try {
      if (Number(MailApp.getRemainingDailyQuota()) <= CODIGO_RESERVA_CUOTA) throw new Error('cuota de correo reservada para los avisos');
      MailApp.sendEmail(correoCodigo(envio.u.nombre, envio.codigo, c));
    } catch (e) {
      console.warn('No se mandó el código de CAPRI: ' + e.message); // la respuesta es la misma (no revela si existe)
    }
  }
  // Mismo tiempo de respuesta exista o no la cuenta (mandar el correo tarda): no se puede medir quién está dado de alta
  const falta = CODIGO_RESPUESTA_MIN_MS - (Date.now() - ahora);
  if (falta > 0) Utilities.sleep(falta);
  return { mensaje: MENSAJE_CODIGO_ENVIADO };
}

/**
 * Pública (sin sesión): comprueba el código y devuelve {token, correo, nombre} con una sesión de CAPRI de 30 días. Un código
 * equivocado o vencido cuenta como intento fallido (5 = bloqueo de 15 minutos); el bueno se borra (sirve una sola vez).
 */
function verificarCodigo(correo, codigo) {
  const c = correoParaCodigo_(correo);
  const cod = String(codigo == null ? '' : codigo).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cod)) throw new Error('El código son 6 números.');
  const secreto = secretoSesion_(false);
  const h = huellaCorreo_(c), cache = CacheService.getScriptCache(), ahora = Date.now();
  candadoCodigo_(() => {
    const bloqueo = jsonCache_(cache.get('CAPRI_BLQ_' + h));
    if (bloqueo && bloqueo.hasta > ahora) throw new Error(MENSAJE_CODIGO_BLOQUEO);
    // Intentos fallidos de todas las cuentas juntas: un intento repartido entre muchos correos también se frena
    const fallosTodos = recientes_(cache.get('CAPRI_ERR_TODOS'), ahora - 3600000);
    if (fallosTodos.length >= CODIGO_MAX_ERRORES_GLOBAL_HORA) throw new Error(MENSAJE_CODIGO_GLOBAL);
    const guardado = jsonCache_(cache.get('CAPRI_COD_' + h));
    const bueno = !!secreto && !!guardado && Number(guardado.x) > ahora && mismoTexto_(guardado.h, huellaCodigo_(secreto, c, cod));
    if (!bueno) {
      fallosTodos.push(ahora);
      cache.put('CAPRI_ERR_TODOS', JSON.stringify(fallosTodos), 3600);
      const errores = recientes_(cache.get('CAPRI_ERR_' + h), ahora - CODIGO_BLOQUEO_MS);
      errores.push(ahora);
      if (errores.length >= CODIGO_MAX_ERRORES) {
        cache.put('CAPRI_BLQ_' + h, JSON.stringify({ hasta: ahora + CODIGO_BLOQUEO_MS }), CODIGO_BLOQUEO_MS / 1000);
        cache.remove('CAPRI_COD_' + h);
        cache.remove('CAPRI_ERR_' + h);
        throw new Error(MENSAJE_CODIGO_BLOQUEO);
      }
      cache.put('CAPRI_ERR_' + h, JSON.stringify(errores), CODIGO_BLOQUEO_MS / 1000);
      throw new Error('Código incorrecto o vencido. Revísalo o pide uno nuevo.');
    }
    cache.remove('CAPRI_COD_' + h);
    cache.remove('CAPRI_ERR_' + h);
  });
  // Entre el pedido y la entrada pudieron desactivarlo
  const u = usuarioParaCodigo_(c);
  if (!u) throw errorAcceso_('Tu acceso a CAPRI está desactivado. Pide ayuda a un administrador.');
  const nombre = u.nombre || c;
  try {
    if (propiedades_()[AREA_ADMIN.propLibro]) bitacoraAdmin_('Entrada con código', '', c, '');
  } catch (e) {
    console.warn('Entrada con código sin bitácora: ' + e.message);
  }
  return { token: emitirSesionCapri_(c, nombre), correo: c, nombre: nombre };
}

// ---- Identidad: lógica pura (sin servicios de Google; se prueba en Node) ----

/** Estado de una delegación hoy: Cancelada, Programada (empieza después), Vigente o Terminada (ya pasó "hasta"). */
function estadoDelegacion(d, hoy) {
  if (d.estado && d.estado !== 'Activa') return d.estado;
  if (hoy < d.desde) return 'Programada';
  if (hoy > d.hasta) return 'Terminada';
  return 'Vigente';
}

/** Días de "desde" a "hasta" contando los dos (AAAA-MM-DD válidas). */
function diasDeDelegacion(desde, hasta) {
  const utc = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((utc(hasta) - utc(desde)) / 86400000) + 1;
}

/**
 * Valida una delegación. p = {de, a, roles, desde, hasta}; ctx = {hoy, usuarios, superAdmins, soloListados, delegaciones}
 * (como rolesEfectivos). Reglas: solo Aprobaciones y Compras, y solo los que "de" tiene como propios (no lo que a su vez le
 * delegaron); no a uno mismo; "a" activo y dado de alta en Permisos, nunca @helgen.services; Compras no a una cuenta de solo
 * requisiciones; desde ≥ hoy, hasta ≥ desde, máx. 90 días; sin otra delegación activa igual en esas fechas.
 * Devuelve {de, a, roles, desde, hasta}.
 */
function normalizarDelegacion(p, ctx) {
  const x = p || {}, c = ctx || {};
  const usuarios = c.usuarios || {};
  const nombre = correo => (usuarios[correo] && usuarios[correo].nombre) || correo;
  const de = correoCapri(x.de), a = correoCapri(x.a);
  if (!de) throw new Error('Falta quién delega.');
  if (!a) throw new Error('Elige a quién le delegas.');
  if (de === a) throw new Error('No se puede delegar a uno mismo: elige a otra persona.');
  const pedidos = (Array.isArray(x.roles) ? x.roles : String(x.roles == null ? '' : x.roles).split(/[,;\n]+/))
    .map(s => String(s == null ? '' : s).trim()).filter(Boolean);
  let roles = [];
  pedidos.forEach(s => {
    const r = rolesDeTexto([s]);
    if (r.length !== 1 || ROLES_DELEGABLES.indexOf(r[0]) === -1) {
      throw new Error('Solo se delegan ' + ROLES_DELEGABLES.map(k => NOMBRES_ROLES[k]).join(' y ') + '.');
    }
    if (roles.indexOf(r[0]) === -1) roles.push(r[0]);
  });
  roles = ordenarRoles_(roles);
  if (!roles.length) throw new Error('Elige qué delegas: ' + ROLES_DELEGABLES.map(r => NOMBRES_ROLES[r]).join(' o ') + '.');
  const desde = String(x.desde == null ? '' : x.desde).trim(), hasta = String(x.hasta == null ? '' : x.hasta).trim();
  validarFechaIso(desde, null, 'La fecha de inicio');
  validarFechaIso(hasta, null, 'La fecha de fin');
  if (desde < c.hoy) throw new Error('La fecha de inicio no puede ser anterior a hoy.');
  if (desde > sumarDias(c.hoy, MAX_DIAS_ANTICIPO_DELEGACION)) {
    throw new Error('Una delegación empieza a más tardar en ' + MAX_DIAS_ANTICIPO_DELEGACION + ' días.');
  }
  if (hasta < desde) throw new Error('La fecha de fin no puede ser anterior a la de inicio.');
  if (diasDeDelegacion(desde, hasta) > MAX_DIAS_DELEGACION) {
    throw new Error('Una delegación dura como máximo ' + MAX_DIAS_DELEGACION + ' días.');
  }
  const suyos = rolesPropios_(de, c);
  if (!suyos.activo) throw new Error(nombre(de) + ' no está activo en CAPRI.');
  const faltan = roles.filter(r => suyos.roles.indexOf(r) === -1);
  if (faltan.length) {
    throw new Error(nombre(de) + ' no tiene ' + faltan.map(r => '"' + NOMBRES_ROLES[r] + '"').join(' ni ') +
      ': solo se delega lo que uno tiene.');
  }
  if (dominioDe(a) === DOMINIO_SERVICIOS) throw new Error('No se delega a cuentas @' + DOMINIO_SERVICIOS + '.');
  const u = usuarios[a];
  if (!u) throw new Error(a + ' no está dado de alta en Permisos.');
  if (!u.activo) throw new Error(nombre(a) + ' está desactivado en CAPRI.');
  if (roles.indexOf('compras') !== -1 && u.roles.indexOf('solo_requisicion') !== -1) {
    throw new Error(nombre(a) + ' tiene "Solo requisiciones": no puede recibir Compras.');
  }
  // Una a la vez por persona y rol (vigente o programada): encadenar varias de 90 días haría una delegación sin fin
  const choca = (c.delegaciones || []).find(d => d.estado === 'Activa' && d.de === de && d.a === a && d.hasta >= c.hoy &&
    d.roles.some(r => roles.indexOf(r) !== -1));
  if (choca) {
    throw new Error('Ya hay una delegación de ' + nombre(de) + ' a ' + nombre(a) + ' vigente o programada (' + choca.id + ', hasta el ' +
      choca.hasta + '). Cancélala o espera a que termine.');
  }
  return { de: de, a: a, roles: roles, desde: desde, hasta: hasta };
}

/** Acción y detalle para la Bitacora al guardar un usuario (antes = null si es alta). */
function cambioDeUsuario(antes, despues) {
  const roles = u => (u.roles || []).map(r => NOMBRES_ROLES[r] || r).join(', ');
  if (!antes) {
    return { accion: 'Alta de usuario', detalle: despues.nombre + ' · ' + roles(despues) + (despues.sitio ? ' · sitio ' + despues.sitio : '') +
      (despues.activo ? '' : ' · desactivado') };
  }
  const cambios = [];
  if (antes.nombre !== despues.nombre) cambios.push('nombre: ' + (antes.nombre || '—') + ' → ' + despues.nombre);
  if (roles(antes) !== roles(despues)) cambios.push('roles: ' + (roles(antes) || '—') + ' → ' + roles(despues));
  if ((antes.sitio || '') !== (despues.sitio || '')) cambios.push('sitio: ' + (antes.sitio || '—') + ' → ' + (despues.sitio || '—'));
  if (String(antes.notas || '') !== String(despues.notas || '')) cambios.push('notas');
  const accion = antes.activo && !despues.activo ? 'Desactivar usuario' : !antes.activo && despues.activo ? 'Reactivar usuario'
    : 'Cambiar usuario';
  return { accion: accion, detalle: cambios.join(' · ') || 'sin cambios' };
}

/** Correo con el código de entrada (MailApp.sendEmail): sin ligas que inicien sesión solas. */
function correoCodigo(nombre, codigo, para) {
  const hola = 'Hola' + (nombre ? ', ' + nombre : '') + ':';
  return {
    to: para, subject: 'Tu código de CAPRI', name: 'CAPRI Helgen',
    body: hola + '\n\nTu código para entrar a CAPRI es: ' + codigo + '\n\nVence en 10 minutos y sirve una sola vez. ' +
      'Escríbelo en la pantalla donde lo pediste.\n\nSi no lo pediste tú, ignora este correo: sin el código nadie puede entrar.\n\n' +
      'CAPRI · Helgen Servicios Especializados',
    htmlBody: '<div style="font-family:Arial,sans-serif;color:#1F2937;font-size:14px;line-height:1.5">' +
      '<p>' + escaparHtml(hola) + '</p><p>Tu código para entrar a <b>CAPRI</b> es:</p>' +
      '<p style="font-size:28px;font-weight:bold;letter-spacing:6px;color:#2C3C5B;margin:8px 0">' + escaparHtml(codigo) + '</p>' +
      '<p>Vence en 10 minutos y sirve una sola vez. Escríbelo en la pantalla donde lo pediste.</p>' +
      '<p style="color:#6B7280">Si no lo pediste tú, ignora este correo: sin el código nadie puede entrar.</p>' +
      '<p style="color:#6B7280;font-size:12px">CAPRI · Helgen Servicios Especializados</p></div>',
  };
}

// ---- 6.B Correos y proveedores: avisos en cada relevo, solicitud de cotización en PDF y botones de correo ----
// Avisos: cada cambio de estado llama notificar_(tipo, datos) al terminar; doPost llama enviarCorreosPendientes_ cuando la
// función terminó bien (fuera del candado). Un aviso nunca lleva montos, proveedores ni folio de orden de compra (un correo se
// reenvía más fácil que una pantalla): folio de la requisición, proyecto, sitio, qué se necesita, quién lo hizo y una nota
// (limpia: sin montos, folios de orden ni el nombre del proveedor). Salen de la cuenta que corre la API (efrain@) con el nombre
// "CAPRI Helgen" y Reply-To = quien hizo el cambio. Nadie recibe aviso de lo que él mismo hizo. Cada envío (y cada falla, con su
// error) queda en la pestaña Correos del libro de Administración; una falla nunca deshace el cambio.
//
// datos que espera cada evento (lo que no venga se lee de la hoja). req = "REQ-AAAA-NNNN" o el objeto de buscarReq_ (también se
// acepta folio = "REQ-…"); nota = texto opcional; quien = quién actuó cuando no hay sesión (p. ej. el centro de mando).
//   req.solicitada {req, reenviada?}                 → aprobaciones, menos quien pidió (sin el flujo de aprobaciones: compras)
//   req.aprobada   {req}                             → compras (con la nota de aprobaciones)
//   req.devuelta   {req, nota}                       → quien pidió
//   req.rechazada  {req, nota}                       → quien pidió
//   req.cotizada   {req, version?}                   → aprobaciones, menos quien pidió y quien preparó la propuesta
//   req.regresada  {req, nota}                       → compras
//   req.autorizada {req}                             → quien pidió, quien recibe (con la entrega esperada) y compras
//   req.encamino   {req, fechaEsperada?, paqueteria?, guia?, nota?, quien?}  → quien pidió y quien recibe
//   req.recibida   {req, parcial?, sitio?, nota?, quien?}  → compras; si la registró otra persona, también quien pidió y quien recibe
//   req.cancelada  {req, antes (estado previo), nota}  → quien la esperaba: Solicitada → aprobaciones (o compras); Devuelta →
//                                                      quien la devolvió
//   oc.cancelada   {req?, oc?, proyecto?, nota?}     → quien pidió (sin el motivo) y compras (con el motivo); el folio de la
//                                                      orden solo va a la bitácora de correos, nunca al correo
//   delegacion     {a, de, roles, desde, hasta}      → el delegado (a)
//   usuario.alta   {correo, nombre?}                 → la persona nueva (liga y cómo entrar)
//   anulado        {para: [correos] | "a@…, b@…", folio, tipo?, req?, nota?}  → los correos de para (un folio de orden se
//                                                      cambia por "la orden de compra de REQ-…")
// Fuera de doPost (p. ej. un activador) se llama enviarCorreosPendientes_() después de notificar_.

function modCorreos_() {
  return { nombre: 'Correos',
    api: { solicitudCotizacion: solicitudCotizacion, pdfOrdenCompra: pdfOrdenCompra, listarCorreos: listarCorreos },
    // solicitudCotizacion guarda un PDF y una línea de Bitacora, pero no cambia ninguna colección que vea la interfaz
    cambios: {}, solo: [], publicas: [], preparar: prepararCorreos_ };
}

/** Eventos de aviso (tipo de notificar_). Quién recibe cada uno lo decide el módulo de correos (tabla del spec, sección 5). */
const EVENTOS_CORREO = ['req.solicitada', 'req.aprobada', 'req.devuelta', 'req.rechazada', 'req.cotizada', 'req.regresada',
  'req.autorizada', 'req.encamino', 'req.pagada', 'req.recibida', 'req.cancelada', 'oc.cancelada', 'delegacion', 'usuario.alta',
  'anulado',
  // Incremento 5 (H): devoluciones. datos = {req, dev: {folio, renglon, descripcion, cantidad, unidad, tipo, resolucion, reporto},
  // nota (el comentario o la nota de la resolución: nunca va en el correo), quien?}
  'dev.reportada', 'dev.resuelta'];

/** Dirección de CAPRI (la liga de cada aviso abre la requisición con #req=REQ-…). */
const URL_AVISOS_CAPRI = 'https://cotizador-helgen.cotizador-helgen.workers.dev/cotizador/';
const REMITENTE_AVISOS = 'CAPRI Helgen';
/** Largo máximo de la liga de Gmail o mailto: con el cuerpo del correo (más largo, algunos navegadores la cortan). */
const MAX_LIGA_CORREO = 1800;
/** Estados en que compras puede pedir cotización a proveedores (desde Aprobada, mientras haya renglones aprobados). */
const ESTADOS_SOLICITUD_COTIZACION = [REQ_APROBADA, REQ_COTIZADA, REQ_AUTORIZADA, REQ_EN_CAMINO, REQ_PAGADA, REQ_RECIBIDA];

/**
 * Pide un aviso por correo. Solo lo forma en la cola de la petición (MEMO_.correos): doPost llama enviarCorreosPendientes_
 * cuando la función ya terminó bien (fuera del candado). Nunca lanza error. datos: ver la tabla de arriba.
 */
function notificar_(tipo, datos) {
  try {
    (MEMO_.correos = MEMO_.correos || []).push({ tipo: tipo, datos: datos || {}, actor: VENDEDOR_ ? VENDEDOR_.email : '' });
  } catch (e) {
    console.warn('Aviso no formado: ' + e.message);
  }
}

/**
 * Manda los avisos de la cola: arma cada correo (por grupo de destinatarios), lo manda con MailApp si alcanza la cuota del día
 * y registra cada envío o falla en Correos (libro de Administración, si ya existe). Nunca lanza error: el cambio ya se guardó.
 * Devuelve los registros (para pruebas).
 */
function enviarCorreosPendientes_() {
  const cola = (MEMO_ && MEMO_.correos) || [];
  MEMO_.correos = [];
  const registros = [];
  if (!cola.length) return registros;
  let cuota = null;
  try { cuota = Number(MailApp.getRemainingDailyQuota()); } catch (e) { cuota = null; }
  const memo = {};
  cola.forEach(aviso => {
    const d = aviso.datos || {}, actor = String(aviso.actor || '').toLowerCase();
    let correos;
    try {
      correos = correosDeAviso_(aviso, memo);
    } catch (e) {
      registros.push({ para: '', asunto: '', tipo: aviso.tipo, folio: folioDeAviso(d), estado: 'Error', error: e.message, actor: actor });
      return;
    }
    if (!correos.length) {
      registros.push({ para: '', asunto: '', tipo: aviso.tipo, folio: folioDeAviso(d), estado: 'Sin destinatarios',
        error: 'Nadie más debía recibirlo (quien lo hizo no recibe aviso).', actor: actor });
    }
    correos.forEach(c => {
      const r = { para: c.para.join(', '), asunto: c.asunto, tipo: aviso.tipo, folio: c.folio, estado: 'Enviado', error: '', actor: actor };
      if (cuota !== null && !(cuota >= c.para.length)) {
        r.estado = 'Sin enviar';
        r.error = 'Se acabó la cuota diaria de correos de Google (quedan ' + (isFinite(cuota) ? cuota : 0) + ').';
      } else {
        try {
          const m = { to: c.para.join(','), subject: c.asunto, htmlBody: c.html, body: c.texto, name: REMITENTE_AVISOS };
          if (correoCapri(actor)) m.replyTo = actor;
          MailApp.sendEmail(m);
          if (cuota !== null) cuota -= c.para.length;
        } catch (e) {
          r.estado = 'Error';
          r.error = e && e.message ? e.message : String(e);
        }
      }
      registros.push(r);
    });
  });
  registrarCorreos_(registros);
  return registros;
}

/** Escribe los envíos en Correos (libro de Administración). Sin libro (antes de prepararCapri) no hace nada. Nunca lanza error. */
function registrarCorreos_(registros) {
  if (!registros || !registros.length) return;
  try {
    const libro = libroAdminSiExiste_();
    if (!libro) return;
    const hoja = hojaAdmin_(libro, 'Correos'), t = textoCelda, fecha = "'" + ahoraTexto_();
    registros.forEach(r => escribe_(hoja).appendRow([fecha, t(r.para), t(r.asunto), t(r.tipo), t(r.folio || ''), t(r.estado),
      t(String(r.error || '').slice(0, 500)), t(r.actor || '')]));
  } catch (e) {
    console.warn('No se registraron los correos: ' + e.message);
  }
}

/**
 * Correos de un aviso: [{para: [correos], asunto, html, texto, folio}], uno por grupo de destinatarios (cada grupo recibe su
 * propio texto). Solo cuentas de CAPRI, sin quien hizo el cambio, sin cuentas desactivadas y sin repetir a nadie (gana el
 * primer grupo: quien pidió antes que su rol).
 */
function correosDeAviso_(aviso, memo) {
  const tipo = aviso.tipo, d = aviso.datos || {}, actor = String(aviso.actor || '').toLowerCase();
  if (EVENTOS_CORREO.indexOf(tipo) === -1) throw new Error('Tipo de aviso desconocido: ' + tipo + '.');
  const info = infoDeAviso_(tipo, d, actor, memo);
  const roles = {};
  ['aprobaciones', 'compras'].forEach(r => { roles[r] = correosConRol_(r); });
  const vistos = {};
  if (actor) vistos[actor] = true;
  const activo = c => {
    if (tipo === 'usuario.alta') return true; // recién dada de alta: puede no estar todavía en lo leído en esta petición
    const u = usuarioCapri_(c);
    return !(u && u.activo === false);
  };
  return destinatariosAviso(tipo, d, info, roles).map(g => {
    const para = [];
    (g.para || []).forEach(x => {
      const c = correoCapri(x);
      if (!c || vistos[c] || !activo(c)) return;
      vistos[c] = true;
      para.push(c);
    });
    return { quien: g.quien, para: para };
  }).filter(g => g.para.length).map(g => {
    const x = contenidoAviso(tipo, g.quien, info);
    return { para: g.para, asunto: x.asunto, html: construirHtmlAviso(x), texto: textoAviso(x), folio: info.folio || folioDeAviso(d) };
  });
}

/**
 * Lo que dice un aviso: la requisición (releída de la hoja: ya con el cambio), su proyecto, quién actuó y la nota limpia.
 * memo = lecturas ya hechas en esta tanda (libro de compras, requisiciones).
 */
function infoDeAviso_(tipo, d, actor, memo) {
  const yo = VENDEDOR_ && String(VENDEDOR_.email).toLowerCase() === actor;
  const info = { tipo: tipo, actorCorreo: actor, actorNombre: actor ? (yo ? nombreYo_() : nombreDeCorreo_(actor)) : '',
    quien: String(d.quien || '').trim(), fecha: ahoraTexto_(), flujo: flujoOperaciones_(), nota: '' };
  const proveedores = [];
  const folioReq = folioReqDeDatos(d);
  let req = null;
  if (folioReq) {
    try {
      if (memo.libro === undefined) memo.libro = libroComprasSiExiste_();
      if (!memo.libro) throw new Error('No existe el libro de compras.');
      req = buscarReq_(memo.libro, folioReq).req;
    } catch (e) {
      if (tipo !== 'anulado') throw e; // sin la requisición no se sabe a quién avisar; un anulado trae sus destinatarios
      info.folio = folioReq;
    }
  }
  if (req) {
    const p = mapaProyectos_()[String(req.proyectoFolio).toUpperCase()];
    const prop = req.propuesta || {};
    if (prop.proveedor && prop.proveedor.razonSocial) proveedores.push(prop.proveedor.razonSocial);
    let orden = null;
    const folioOc = req.ocFolio || (/^OC-/i.test(String(d.oc || '')) ? String(d.oc) : '');
    if (folioOc) {
      try { orden = buscarOrden_(memo.libro, folioOc).orden; } catch (e) { orden = null; }
      if (orden && orden.proveedor) proveedores.push(orden.proveedor);
    }
    Object.assign(info, {
      folio: req.folio, estado: req.estado, proyectoNombre: p ? p.nombre : '', proyectoVisible: p ? p.folioVisible : req.proyectoFolio,
      sitio: req.sitio, fechaRequerida: req.fechaRequerida, prioridad: req.prioridad, solicitante: req.solicitante,
      solicitanteEmail: req.solicitanteEmail, recibeEmail: req.recibeEmail || req.solicitanteEmail,
      revisoEmail: String(req.reviso || '').toLowerCase(), elaboroPropuesta: String(prop.elaboroEmail || '').toLowerCase(),
      notaAprobacion: req.aprobacion && req.aprobacion.nota ? req.aprobacion.nota : '',
      entrega: orden && orden.estado !== OC_CANCELADA ? orden.fechaEntrega : (prop.fechaEntrega || ''),
    });
    info.recibeNombre = info.recibeEmail === info.solicitanteEmail ? info.solicitante : nombreDeCorreo_(info.recibeEmail);
  } else if (d.proyecto) {
    const p = mapaProyectos_()[folioInterno(d.proyecto)];
    Object.assign(info, { proyectoNombre: p ? p.nombre : '', proyectoVisible: p ? p.folioVisible : String(d.proyecto) });
  }
  const limpiar = t => limpiarTextoAviso(t, proveedores);
  info.nota = limpiar(d.nota);
  info.notaAprobacion = limpiar(info.notaAprobacion);
  ['reenviada', 'parcial', 'centroMando'].forEach(k => { info[k] = !!d[k]; });
  info.version = Number(d.version) || 0;
  info.antes = String(d.antes || '');
  info.sitioRecepcion = String(d.sitio || '');
  info.fechaEsperada = String(d.fechaEsperada || d.fechaEstimada || ''); // marcarEnCamino (6.C) manda fechaEstimada
  // Proyecto ligado al centro de mando (6.C): el material se recibe allá, no en CAPRI
  info.centro = !!(req && typeof proyectoLigado_ === 'function' && proyectoLigado_(req.proyectoFolio));
  info.paqueteria = limpiar(d.paqueteria);
  info.guia = limpiar(d.guia);
  // Incremento 5 (H): la devolución (sin montos ni proveedor: la descripción también se limpia)
  if (d.dev && typeof d.dev === 'object') {
    const dv = d.dev;
    info.dev = { folio: String(dv.folio || ''), renglon: Number(dv.renglon) || '', descripcion: limpiar(String(dv.descripcion || '').slice(0, 120)),
      cantidad: Number(dv.cantidad) || '', unidad: String(dv.unidad || ''), tipo: String(dv.tipo || ''),
      resolucion: String(dv.resolucion || ''), origen: String(dv.origen || '') };
    info.devReporto = String(dv.reporto || '').toLowerCase();
  }
  if (tipo === 'delegacion') {
    Object.assign(info, { delegado: correoCapri(d.a), de: correoCapri(d.de), deNombre: nombreDeCorreo_(d.de),
      roles: rolesDeTexto(d.roles).map(r => NOMBRES_ROLES[r]), desde: String(d.desde || ''), hasta: String(d.hasta || '') });
  }
  if (tipo === 'usuario.alta') {
    Object.assign(info, { nuevo: correoCapri(d.correo), nuevoNombre: String(d.nombre || '').trim() || nombreDeCorreo_(d.correo) });
  }
  if (tipo === 'proveedor.banco') Object.assign(info, datosAvisoBanco(d)); // F (incremento 5): solo banco y últimos 4 dígitos
  if (tipo === 'anulado') {
    const folio = String(d.folio || d.oc || '').trim(); // el folio de una orden nunca va en el correo
    info.anuladoFolio = /^OC-/i.test(folio) ? '' : folio;
    info.anuladoTipo = String(d.tipo || '').trim();
    info.anuladoOc = /^OC-/i.test(folio) || /orden/i.test(info.anuladoTipo);
  }
  return info;
}

// ---- Solicitud de cotización (PDF para el proveedor) y orden de compra para mandar al proveedor ----

/**
 * Solicitud de cotización de una requisición (solo compras), desde que está aprobada: PDF con los renglones aprobados que elija
 * compras (cantidad aprobada, unidad, descripción —la de compras si la cambió— y notas), lugar y fecha de entrega y el contacto
 * de compras; nunca el cliente, el proyecto, un presupuesto ni precios. Se guarda (privado) en la carpeta de requisiciones del
 * proyecto y queda en la Bitacora de compras; no cambia la requisición.
 * opciones = {renglones: [{renglon, incluir, descripcion, notas?}], proveedor: {nombre, correo} (opcional), notas}.
 * Devuelve {folio, nombre, mime, datos (PDF en base64, para "Descargar PDF" sin acceso a Drive), url, renglones,
 * correo: {para, asunto, cuerpo, gmail, mailto, recortado, partes}}.
 */
function solicitudCotizacion(reqFolio, opciones) {
  exigirCompras_();
  const libro = libroComprasSiExiste_();
  if (!libro) throw new Error('Todavía no hay requisiciones.');
  const { req } = buscarReq_(libro, reqFolio);
  // Flujo de siempre (sin aprobaciones): también desde Solicitada, con lo pedido (revisión 28/10/2026)
  const sinAprobacion = !req.aprobacion && !flujoOperaciones_();
  if (ESTADOS_SOLICITUD_COTIZACION.indexOf(req.estado) === -1 && !(sinAprobacion && req.estado === REQ_SOLICITADA)) {
    throw new Error('La requisición ' + req.folio + ' está ' + String(req.estado).toLowerCase() +
      ': la solicitud de cotización se hace desde que está ' + (sinAprobacion ? 'solicitada.' : 'aprobada.'));
  }
  const vigente = renglonesDeReqs_(libro)[req.folio.toUpperCase()] || { renglones: [] };
  const aprobados = renglonesParaCotizar(vigente.renglones, req.aprobacion);
  if (!aprobados.length) throw new Error('La requisición ' + req.folio + ' no tiene renglones aprobados.');
  const sol = normalizarSolicitudCotizacion(opciones, aprobados);
  const cfg = getConfig_();
  const d = { folio: req.folio, fecha: Utilities.formatDate(new Date(), 'America/Mexico_City', 'dd/MM/yyyy'), proveedor: sol.proveedor,
    renglones: sol.renglones, notas: sol.notas, sitio: sitioDeSolicitud_(req.sitio), fechaRequerida: req.fechaRequerida,
    contacto: { nombre: nombreYo_(), correo: yo_() } };
  const crudo = Utilities.newBlob(construirHtmlSolicitudCotizacion(d, cfg, logoDataUrl_(cfg.LOGO_FILE_ID)), 'text/html',
    req.folio + '.html').getAs('application/pdf');
  const r = conCandado_(() => {
    const previas = filasDeArea_(hojaCompras_(libro, 'Bitacora'), HOJAS_COMPRAS, 'Bitacora')
      .filter(x => String(x[2]) === 'Solicitud de cotización' && String(x[4]).indexOf(req.folio + ' ') === 0).length;
    const nombre = nombreArchivoReq(req.folio, 'Solicitud de cotización', 'pdf', previas + 1);
    const pdf = crudo.setName(nombre);
    const archivo = privado_(carpetaRequisiciones_(req.proyectoFolio).createFile(pdf));
    bitacora_(libro, 'Solicitud de cotización', req.proyectoFolio, req.folio + ' · ' + sol.renglones.length + ' renglón(es)' +
      (sol.proveedor.nombre ? ' · para ' + sol.proveedor.nombre : '') + ' · ' + nombre, '', HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    return { pdf: pdf, archivo: archivo, nombre: nombre };
  });
  const partes = textosSolicitudCotizacion(d, cfg);
  return { folio: req.folio, nombre: r.nombre, mime: 'application/pdf', datos: Utilities.base64Encode(r.pdf.getBytes()),
    url: r.archivo.getUrl(), renglones: sol.renglones.length,
    correo: Object.assign(correoConLigas(sol.proveedor.correo, partes.asunto, partes), { partes: partes }) };
}

/** {nombre, direccion} del sitio de la requisición (Config → SITIOS; la dirección es el tercer campo, opcional). */
function sitioDeSolicitud_(sitio) {
  const s = String(sitio || '').trim();
  if (!s) return { nombre: '', direccion: '' };
  const det = sitiosDetalle_();
  const codigo = codigoDeSitio(s, det);
  const x = det.find(v => textoNormal(v.nombre) === textoNormal(s)) || (codigo && det.find(v => v.codigo === codigo));
  return { nombre: x ? x.nombre : s, direccion: x ? x.direccion : '' };
}

/**
 * PDF de una orden de compra para mandarla al proveedor (solo compras; Cancelada no): {folio, nombre, mime, datos (base64),
 * correo: {para (el correo del proveedor de la orden), asunto, cuerpo, gmail, mailto, recortado, partes}}. Solo lee.
 */
function pdfOrdenCompra(folioOc) {
  exigirCompras_();
  const libro = libroComprasSiExiste_();
  if (!libro) throw new Error('Todavía no hay órdenes de compra.');
  const { hoja, orden } = buscarOrden_(libro, folioOc);
  if (orden.estado === OC_CANCELADA) throw new Error('La orden ' + orden.folio + ' está cancelada: no se manda al proveedor.');
  const id = String(hoja.getRange(orden.fila, 24).getValue() || '').trim(); // pdf_id
  if (!id) throw new Error('La orden ' + orden.folio + ' no tiene PDF.');
  const blob = DriveApp.getFileById(id).getBlob();
  const cfg = getConfig_();
  const partes = textosOrdenCompra({ folio: orden.folio, proveedor: { nombre: orden.proveedor, contacto: orden.contacto },
    renglones: orden.renglones, fechaEntrega: orden.fechaEntrega, lugarEntrega: orden.lugarEntrega,
    contacto: { nombre: nombreYo_(), correo: yo_() } }, cfg);
  return { folio: orden.folio, nombre: blob.getName() || nombreArchivoOc(orden.folio, orden.proveedor), mime: 'application/pdf',
    datos: Utilities.base64Encode(blob.getBytes()),
    correo: Object.assign(correoConLigas(orden.correo, partes.asunto, partes), { partes: partes }) };
}

/**
 * Bitácora de correos para Administración (solo super admin): los 200 más recientes primero. filtro = texto (busca en para,
 * asunto, tipo, folio, estado, error y quién) o {texto, estado}. Devuelve {correos: [...], total (con el filtro), sinLibro?}.
 */
function listarCorreos(filtro) {
  exigirSuperAdmin_();
  const libro = libroAdminSiExiste_();
  if (!libro) return { correos: [], total: 0, sinLibro: true };
  const f = filtro && typeof filtro === 'object' ? filtro : { texto: filtro };
  const q = textoNormal(f.texto), estado = String(f.estado || '').trim();
  const fecha = v => v instanceof Date ? Utilities.formatDate(v, 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss') : String(v || '');
  const lista = filasDeArea_(hojaAdmin_(libro, 'Correos'), HOJAS_ADMIN, 'Correos')
    .filter(r => String(r[0] || '').trim() || String(r[1] || '').trim() || String(r[3] || '').trim())
    .map(r => ({ fecha: fecha(r[0]), para: String(r[1] || ''), asunto: String(r[2] || ''), tipo: String(r[3] || ''),
      folio: String(r[4] || ''), estado: String(r[5] || ''), error: String(r[6] || ''), actor: String(r[7] || '') }))
    .reverse()
    .filter(c => (!estado || c.estado === estado) &&
      (!q || textoNormal([c.para, c.asunto, c.tipo, c.folio, c.estado, c.error, c.actor].join(' ')).includes(q)));
  return { correos: lista.slice(0, 200), total: lista.length };
}

/**
 * prepararCapri lo corre desde el editor: manda un correo de prueba a la cuenta que corre el script, para que Google pida el
 * permiso de mandar correos antes de publicar (sin ese permiso cada aviso fallaría). Si falla, lo dice en el registro.
 */
function prepararCorreos_() {
  let yo = '';
  try { yo = Session.getEffectiveUser ? String(Session.getEffectiveUser().getEmail() || '') : ''; } catch (e) { yo = ''; }
  if (!yo) { console.log('Correos: no se pudo saber la cuenta que corre el script; no se mandó la prueba.'); return; }
  const x = { asunto: '[CAPRI] Correo de prueba', titulo: 'Los avisos de CAPRI ya pueden salir', que: 'Este correo confirma ' +
    'que CAPRI tiene permiso para mandar avisos desde ' + yo + '. No hay que hacer nada.', filas: [], nota: '',
    boton: { texto: 'Abrir CAPRI', url: URL_AVISOS_CAPRI }, pie: 'Aviso automático de CAPRI (Helgen).' };
  try {
    MailApp.sendEmail({ to: yo, subject: x.asunto, htmlBody: construirHtmlAviso(x), body: textoAviso(x), name: REMITENTE_AVISOS });
    registrarCorreos_([{ para: yo, asunto: x.asunto, tipo: 'prueba', folio: '', estado: 'Enviado', error: '', actor: yo }]);
    console.log('Correos: prueba enviada a ' + yo + ' (quedan ' + MailApp.getRemainingDailyQuota() + ' destinatarios en la cuota de hoy).');
  } catch (e) {
    console.error('Correos: NO se pudo mandar la prueba a ' + yo + ': ' + e.message + '. Sin este permiso los avisos no salen.');
  }
}

// ---- Correos: lógica pura (sin servicios de Google; se prueba en Node) ----

/** Folio de la requisición de un aviso ("REQ-…"), de datos.req (texto u objeto) o datos.folio; '' si no hay. */
function folioReqDeDatos(d) {
  const x = d || {};
  const cand = [x.req && typeof x.req === 'object' ? x.req.folio : x.req, x.folio];
  const f = cand.map(v => String(v == null ? '' : v).trim().toUpperCase()).find(v => /^REQ-\d{4}-\d+$/.test(v));
  return f || '';
}

/** Folio para la bitácora de correos (la requisición o, si no hay, el folio que traiga el aviso, también el de la orden). */
function folioDeAviso(d) {
  const x = d || {};
  return folioReqDeDatos(x) || String(x.oc || x.folio || '').trim();
}

/**
 * Quita de una nota lo que no debe ir en un correo: folios de orden de compra, montos ("$1,500", "1500 MXN", "300 dólares") y
 * los nombres de los proveedores de esa requisición. Máximo 500 caracteres.
 */
function limpiarTextoAviso(texto, proveedores) {
  let t = String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = t.replace(/\bOC-\d{4}-\d+\b/gi, 'la orden de compra')
    .replace(/(?:US\$|MX\$|\$)\s*\d[\d.,]*(?:\s*(?:MXN|USD|M\.N\.|pesos|d[oó]lares))?/gi, '[monto]')
    .replace(/\b\d[\d.,]*\s*(?:MXN|USD|pesos|d[oó]lares)(?![a-z])/gi, '[monto]');
  (proveedores || []).forEach(p => {
    const n = String(p || '').replace(/\s+/g, ' ').trim();
    if (n.length >= 3) t = t.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[proveedor]');
  });
  return t.slice(0, 500);
}

/**
 * A quién va cada aviso, por grupos (cada grupo recibe su propio texto; el primero gana si alguien está en dos): [{quien,
 * para: [correos]}]. info = infoDeAviso_ (solicitanteEmail, recibeEmail, revisoEmail, elaboroPropuesta, actorCorreo, flujo,
 * antes…); roles = {aprobaciones: [...], compras: [...]} (correosConRol_: con super admin y delegaciones).
 */
function destinatariosAviso(tipo, d, info, roles) {
  const x = d || {}, i = info || {}, r = roles || {};
  const sol = i.solicitanteEmail || '', rec = i.recibeEmail || sol, ap = r.aprobaciones || [], co = r.compras || [];
  const sinSol = l => l.filter(c => c !== sol);
  const revisan = i.flujo ? { quien: 'aprobaciones', para: sinSol(ap) } : { quien: 'compras', para: sinSol(co) };
  if (tipo === 'proveedor.banco') return [{ quien: 'compras', para: co }]; // F (incremento 5): cambio de banco de un proveedor
  switch (tipo) {
    case 'req.solicitada': return [revisan];
    case 'req.aprobada': return [{ quien: 'compras', para: co }];
    case 'req.devuelta': case 'req.rechazada': return [{ quien: 'solicitante', para: [sol] }];
    case 'req.cotizada': return [{ quien: 'aprobaciones', para: sinSol(ap).filter(c => c !== i.elaboroPropuesta) }];
    case 'req.regresada': return [{ quien: 'compras', para: co }];
    case 'req.autorizada': return [{ quien: 'solicitante', para: [sol] }, { quien: 'recibe', para: [rec] }, { quien: 'compras', para: co }];
    case 'req.encamino': return [{ quien: 'solicitante', para: [sol] }, { quien: 'recibe', para: [rec] }];
    // Flujo de siempre: con la orden pagada, quien recibe ya puede confirmar que llegó (revisión 28/10/2026)
    case 'req.pagada': return [{ quien: 'recibe', para: [rec] }].concat(rec !== sol ? [{ quien: 'solicitante', para: [sol] }] : []);
    // P (incremento 6): el primer pago parcial (anticipo) también abre "Recibí el material"; mismos destinatarios, sin montos
    case 'req.pagoparcial': return [{ quien: 'recibe', para: [rec] }].concat(rec !== sol ? [{ quien: 'solicitante', para: [sol] }] : []);
    case 'req.recibida': {
      // Recibido en el sitio (centro de mando): compras y, con su propio texto, quien pidió y quien recibe
      if (i.centroMando) return [{ quien: 'compras', para: co }, { quien: 'sitio', para: [sol, rec] }];
      const enSuLugar = !!i.actorCorreo && i.actorCorreo !== sol && i.actorCorreo !== rec;
      return [{ quien: 'compras', para: co }].concat(enSuLugar
        ? [{ quien: 'solicitante', para: [sol] }, { quien: 'recibe', para: [rec] }] : []);
    }
    case 'req.cancelada':
      if (String(x.antes || i.antes || '') === REQ_DEVUELTA) return [{ quien: 'revisor', para: [i.revisoEmail] }];
      return [{ quien: 'revisor', para: revisan.para }];
    case 'oc.cancelada': return (sol ? [{ quien: 'solicitante', para: [sol] }] : []).concat([{ quien: 'compras', para: co }]);
    case 'delegacion': return [{ quien: 'delegado', para: [x.a] }];
    case 'usuario.alta': return [{ quien: 'nuevo', para: [x.correo] }];
    case 'anulado': {
      const lista = Array.isArray(x.para) ? x.para : String(x.para || '').split(/[\s,;]+/);
      return [{ quien: 'involucrado', para: lista }];
    }
    // Incremento 5 (H): problema reportado → compras (y quien pidió, si lo reportó otra persona); resuelto → quien reportó,
    // quien pidió y quien recibe
    case 'dev.reportada': return [{ quien: 'compras', para: co }].concat(i.actorCorreo !== sol ? [{ quien: 'solicitante', para: [sol] }] : []);
    case 'dev.resuelta': {
      const reporto = String((x.dev && x.dev.reporto) || i.devReporto || '').toLowerCase();
      return [{ quien: 'reporto', para: [reporto] }, { quien: 'solicitante', para: [sol] }, { quien: 'recibe', para: [rec] }];
    }
  }
  return [];
}

/** "2026-11-05" → "05/11/2026" (otros textos, igual). */
function fechaCorreo(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] + m[4].slice(0, 6) : String(iso || '');
}

/**
 * Texto de un aviso para un grupo: {asunto, titulo, que (lo que se necesita), filas: [[etiqueta, valor]], nota, boton: {texto,
 * url}, pie}. Asunto "[CAPRI] REQ-2026-0005 · Por aprobar · DROGHEDA · Manzanillo (TIMSA)". Nunca montos, proveedores ni folio
 * de orden: info solo trae lo que puede ir (ver infoDeAviso_).
 */
function contenidoAviso(tipo, quien, info) {
  const i = info || {};
  const enCapri = i.folio ? URL_AVISOS_CAPRI + '#req=' + encodeURIComponent(i.folio) : URL_AVISOS_CAPRI;
  const quienHizo = i.actorNombre ? i.actorNombre + (i.actorCorreo && i.actorNombre !== i.actorCorreo ? ' (' + i.actorCorreo + ')' : '')
    : (i.quien || '');
  const filasReq = () => [
    ['Proyecto', [i.proyectoVisible, i.proyectoNombre].filter(Boolean).join(' · ')],
    ['Sitio', i.sitio], ['Se necesita', fechaCorreo(i.fechaRequerida)], ['Prioridad', i.prioridad], ['Pidió', i.solicitante],
    ['Lo hizo', i.actorCorreo && i.actorCorreo === i.solicitanteEmail ? '' : quienHizo], ['Cuándo', fechaCorreo(i.fecha)]];
  const x = { asunto: '', titulo: '', que: '', filas: [], nota: '', boton: { texto: i.folio ? 'Abrir ' + i.folio + ' en CAPRI' : 'Abrir CAPRI', url: enCapri },
    pie: 'Aviso automático de CAPRI (Helgen). ' + (i.actorNombre ? 'Si respondes, tu respuesta le llega a ' + i.actorNombre + '. ' : '') +
      'No reenvíes este correo fuera de Helgen.' };
  const req = (etiqueta, que, nota) => {
    x.asunto = '[CAPRI] ' + [i.folio, etiqueta, i.proyectoNombre, i.sitio].filter(Boolean).join(' · ');
    x.titulo = [i.folio, etiqueta].filter(Boolean).join(' · ');
    x.que = que; x.filas = filasReq(); x.nota = nota || '';
  };
  const recibeEsSol = !i.recibeEmail || i.recibeEmail === i.solicitanteEmail;
  const entrega = i.entrega ? ' Entrega esperada: ' + fechaCorreo(i.entrega) + '.' : '';
  const registrar = i.centro ? ' Cuando llegue, se recibe en el centro de mando (inventario del sitio).' : ' Cuando llegue, regístralo en CAPRI.';
  if (tipo === 'proveedor.banco') return contenidoAvisoBanco(x, i, quienHizo); // F (incremento 5): sin nombre del proveedor
  switch (tipo) {
    case 'req.solicitada':
      if (quien === 'compras') req(i.reenviada ? 'Corregida, por autorizar' : 'Por autorizar', 'Revisa la requisición y la cotización ' +
        'del proveedor para autorizarla (emitir la orden de compra), devolverla o rechazarla.');
      else req(i.reenviada ? 'Corregida, por aprobar' : 'Por aprobar', (i.reenviada ? 'Quien la pidió la corrigió y la volvió a enviar. ' : '') +
        'Revisa la requisición y aprueba o rechaza cada renglón.');
      break;
    case 'req.aprobada':
      req('Aprobada, por cotizar', 'Aprobaciones aprobó la requisición. Pide cotización a los proveedores y manda la propuesta de compra.',
        i.notaAprobacion);
      break;
    case 'req.devuelta':
      req('Devuelta para corregir', 'Te regresaron la requisición: corrígela con lo que dice la nota y vuelve a enviarla.', i.nota);
      break;
    case 'req.rechazada':
      req('Rechazada', 'Tu requisición no se va a comprar. El motivo está en la nota.', i.nota);
      break;
    case 'req.cotizada':
      req('Propuesta por revisar', 'Compras mandó la propuesta de compra' + (i.version > 1 ? ' (versión ' + i.version + ')' : '') +
        '. Revísala en CAPRI y dale el visto bueno o regrésala a compras.');
      break;
    case 'req.regresada':
      req('Propuesta regresada', 'Aprobaciones regresó la propuesta para ajustarla. Corrígela y vuelve a mandarla.', i.nota);
      break;
    case 'req.autorizada':
      if (quien === 'compras') req('Autorizada, enviar orden', 'Ya hay orden de compra: mándala al proveedor desde la requisición ' +
        'en CAPRI ("Enviar orden al proveedor") y registra su factura y su pago.' + entrega);
      else if (quien === 'recibe') req('Material por recibir', 'Se autorizó la compra. Tú recibes el material' +
        (i.sitio ? ' en ' + i.sitio : '') + '.' + entrega + registrar);
      else req('Autorizada', 'Se autorizó la compra de tu requisición.' + entrega + (recibeEsSol ? registrar
        : ' Lo recibe ' + (i.recibeNombre || i.recibeEmail) + '.'));
      break;
    case 'req.encamino':
      req('En camino', 'El material de esta requisición ya va en camino' + (i.fechaEsperada ? '; llegada esperada el ' +
        fechaCorreo(i.fechaEsperada) : '') + '.' + (quien === 'recibe' || recibeEsSol ? registrar : ''), i.nota);
      x.filas.splice(2, 0, ['Paquetería', i.paqueteria], ['Guía', i.guia]);
      break;
    case 'req.pagada':
      req('Pagada, por recibir', 'Compras pagó al proveedor. ' + (quien === 'recibe' ? 'Cuando llegue el material, confirma en CAPRI ' +
        'que lo recibiste.' : 'Lo recibe ' + (i.recibeNombre || i.recibeEmail) + '; cuando llegue, lo confirma en CAPRI.'));
      break;
    case 'req.pagoparcial': // P (incremento 6): nunca el monto ni el porcentaje
      req('Pagada parcial, por recibir', 'Compras registró un pago parcial al proveedor: el material ya se puede recibir. ' +
        (quien === 'recibe' ? 'Cuando llegue, confirma en CAPRI que lo recibiste.' : 'Lo recibe ' + (i.recibeNombre || i.recibeEmail) +
        '; cuando llegue, lo confirma en CAPRI.'));
      break;
    case 'req.recibida': {
      const donde = i.sitioRecepcion || i.sitio;
      if (quien === 'sitio') {
        req('Recibido en el sitio', 'El material se recibió' + (donde ? ' en ' + donde : '') + ' en el centro de mando y ya está en ' +
          'el inventario del sitio. No tienes que hacer nada.');
      } else if (quien === 'compras') {
        req(i.parcial ? 'Recepción parcial' : 'Material recibido', 'Se registró la recepción ' + (i.parcial ? 'parcial' : 'completa') +
          ' del material' + (donde ? ' en ' + donde : '') + '.' + (i.estado === REQ_RECIBIDA ? ' Falta registrar el pago.' :
          i.estado === REQ_CERRADA ? ' La requisición quedó cerrada.' : ''), i.nota);
      } else {
        req('Recepción registrada', 'Se registró en tu lugar la recepción ' + (i.parcial ? 'parcial' : 'completa') + ' del material' +
          (donde ? ' en ' + donde : '') + '. Revisa en CAPRI que sea correcta.', i.nota);
      }
      break;
    }
    case 'req.cancelada':
      req('Cancelada', 'Quien la pidió canceló la requisición: ya no necesitas revisarla.', i.nota);
      break;
    case 'oc.cancelada':
      if (i.folio) {
        if (quien === 'solicitante') req('Orden cancelada', 'Se canceló la orden de compra de tu requisición; compras la va a ' +
          'comprar de nuevo. No tienes que hacer nada.');
        else req('Orden cancelada', 'Se canceló la orden de compra de esta requisición' + (i.estado === REQ_APROBADA ? '; hay que ' +
          'cotizarla de nuevo.' : i.estado === REQ_SOLICITADA ? '; queda pendiente de autorizar de nuevo.' : '.'), i.nota);
      } else {
        x.asunto = '[CAPRI] Orden de compra cancelada' + (i.proyectoNombre ? ' · ' + i.proyectoNombre : '');
        x.titulo = 'Orden de compra cancelada';
        x.que = 'Se canceló una orden de compra' + (i.proyectoVisible ? ' del proyecto ' + i.proyectoVisible : '') + '. El detalle está en CAPRI.';
        x.filas = [['Proyecto', [i.proyectoVisible, i.proyectoNombre].filter(Boolean).join(' · ')], ['Lo hizo', quienHizo],
          ['Cuándo', fechaCorreo(i.fecha)]];
        x.nota = i.nota;
      }
      break;
    case 'delegacion': {
      const roles = (i.roles || []).join(' y ') || 'sus funciones';
      x.asunto = '[CAPRI] Te delegaron ' + roles + ' del ' + fechaCorreo(i.desde) + ' al ' + fechaCorreo(i.hasta);
      x.titulo = 'Te delegaron ' + roles;
      x.que = (i.deNombre || i.de || 'Alguien') + ' te dejó ' + roles + ' del ' + fechaCorreo(i.desde) + ' al ' + fechaCorreo(i.hasta) +
        '. En esas fechas verás sus pendientes en CAPRI y recibirás sus avisos.';
      x.filas = [['De', i.deNombre && i.de && i.deNombre !== i.de ? i.deNombre + ' (' + i.de + ')' : i.de], ['Lo registró', quienHizo]];
      break;
    }
    case 'usuario.alta': {
      const servicios = dominioDe(i.nuevo) === DOMINIO_SERVICIOS;
      x.asunto = '[CAPRI] Ya tienes acceso a CAPRI';
      x.titulo = (i.nuevoNombre && i.nuevoNombre !== i.nuevo ? i.nuevoNombre + ', te' : 'Te') + ' damos la bienvenida a CAPRI';
      x.que = 'Ya tienes acceso a CAPRI, la herramienta interna de Helgen para requisiciones, compras y cotizaciones.';
      x.filas = [['Tu cuenta', i.nuevo], ['Cómo entrar', servicios
        ? 'Abre la liga, escribe tu correo @' + DOMINIO_SERVICIOS + ' y te llegará un código por correo para entrar.'
        : 'Abre la liga y entra con "Acceder con Google" usando tu cuenta @' + DOMINIO_HELGEN + '.'], ['Te dio de alta', quienHizo]];
      x.boton = { texto: 'Abrir CAPRI', url: URL_AVISOS_CAPRI };
      break;
    }
    case 'anulado': {
      const que = i.anuladoOc ? 'la orden de compra' + (i.folio ? ' de ' + i.folio : '') : (i.anuladoTipo ? i.anuladoTipo + ' ' : 'el registro ') +
        (i.anuladoFolio || i.folio || '');
      x.asunto = '[CAPRI] ' + [i.anuladoOc ? (i.folio ? i.folio + ' · Orden de compra anulada' : 'Orden de compra anulada')
        : (i.anuladoFolio || i.folio || 'Registro') + ' · Anulado', i.proyectoNombre].filter(Boolean).join(' · ');
      x.titulo = 'Se anuló ' + que.trim();
      x.que = 'Un super admin anuló ' + que.trim() + '. Ya no cuenta en listas ni totales de CAPRI.';
      x.filas = [['Proyecto', [i.proyectoVisible, i.proyectoNombre].filter(Boolean).join(' · ')], ['Lo hizo', quienHizo],
        ['Cuándo', fechaCorreo(i.fecha)]];
      x.nota = i.nota;
      break;
    }
    // Incremento 5 (H): devoluciones (sin montos, proveedor ni folio de orden; el comentario solo como "hay una nota")
    case 'dev.reportada': case 'dev.resuelta': {
      const dv = i.dev || {};
      const material = [dv.cantidad, dv.unidad].filter(v => v !== '' && v != null).join(' ') + (dv.descripcion ? ' de "' + dv.descripcion + '"' : '');
      if (tipo === 'dev.reportada') {
        req('Problema con material', quien === 'compras'
          ? 'Se reportó un problema con material recibido (' + (dv.folio || 'devolución') + '). Revísalo en CAPRI y resuélvelo: reponer, ' +
            'devolver al proveedor, cancelar el renglón o conservar. Mientras esté abierta, la requisición no se cierra.'
          : 'Se reportó un problema con el material de tu requisición (' + (dv.folio || 'devolución') + '). Compras lo va a resolver.', i.nota);
      } else {
        req('Devolución resuelta', 'Compras resolvió la devolución ' + (dv.folio || '') + ': ' + textoResolucionDev(dv.resolucion) +
          (quien === 'reporto' ? ' Gracias por reportarlo.' : ''), i.nota);
      }
      x.filas.splice(1, 0, ['Devolución', dv.folio], ['Material', material], ['Problema', dv.tipo],
        ['Origen', dv.origen === ORIGEN_DEV_CENTRO ? 'Reportado en el centro de mando' + (i.quien ? ' por ' + i.quien : '') : '']);
      if (tipo === 'dev.resuelta') x.filas.splice(4, 0, ['Resolución', dv.resolucion]);
      break;
    }
  }
  x.filas = x.filas.filter(f => f && f[1]);
  // El texto libre de una nota nunca va en el correo (puede traer montos, proveedores o folios que ningún filtro detecta):
  // solo se avisa que hay una y se lee en CAPRI. Lo anulado solo lo ve el super admin: ahí no se menciona.
  x.nota = x.nota && tipo !== 'anulado' ? NOTA_EN_CAPRI : '';
  return x;
}

const NOTA_EN_CAPRI = 'Hay una nota: ábrela en CAPRI para leerla (los correos no llevan el texto de las notas).';

/** HTML del aviso (tablas e inline CSS, como el PDF; el botón también tiene borde por si el correo quita el fondo). */
function construirHtmlAviso(x) {
  const e = escaparHtml, AZUL = '#2C3C5B', AQUA = '#51F3DA', TEAL = '#0AC5A8', GRIS = '#6B7280';
  const filas = (x.filas || []).filter(f => f && f[1]).map(f =>
    '<tr><td style="padding:3px 14px 3px 0;color:' + GRIS + ';white-space:nowrap;vertical-align:top;">' + e(f[0]) + '</td>' +
    '<td style="padding:3px 0;vertical-align:top;">' + e(f[1]) + '</td></tr>').join('');
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1F2937;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:580px;border-collapse:collapse;">' +
    '<tr><td style="padding:0 0 8px;border-bottom:3px solid ' + AQUA + ';font-weight:bold;letter-spacing:2px;color:' + AZUL + ';">CAPRI · HELGEN</td></tr>' +
    '<tr><td style="padding:16px 0 6px;font-size:18px;font-weight:bold;color:' + AZUL + ';">' + e(x.titulo) + '</td></tr>' +
    '<tr><td style="padding:0 0 12px;line-height:1.5;">' + e(x.que) + '</td></tr>' +
    (filas ? '<tr><td><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">' + filas + '</table></td></tr>' : '') +
    (x.nota ? '<tr><td style="padding:12px 0 0;"><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>' +
      '<td style="border-left:3px solid ' + TEAL + ';padding:6px 10px;line-height:1.5;"><b>Nota:</b> ' + e(x.nota) + '</td></tr></table></td></tr>' : '') +
    (x.boton ? '<tr><td style="padding:20px 0;"><a href="' + e(x.boton.url) + '" style="display:inline-block;padding:10px 18px;' +
      'background:' + TEAL + ';border:2px solid ' + AZUL + ';border-radius:6px;color:' + AZUL + ';font-weight:bold;text-decoration:none;">' +
      e(x.boton.texto) + '</a></td></tr>' : '') +
    '<tr><td style="padding:12px 0 0;border-top:1px solid #E5E7EB;color:' + GRIS + ';font-size:12px;line-height:1.5;">' + e(x.pie) + '</td></tr>' +
    '</table></body></html>';
}

/** El mismo aviso en texto plano (para quien no ve HTML). */
function textoAviso(x) {
  return [x.titulo, '', x.que, ''].concat((x.filas || []).filter(f => f && f[1]).map(f => f[0] + ': ' + f[1]))
    .concat(x.nota ? ['', 'Nota: ' + x.nota] : [], x.boton ? ['', x.boton.texto + ': ' + x.boton.url] : [], ['', x.pie]).join('\n');
}

/**
 * Lo que compras escoge para la solicitud de cotización, sobre los renglones aprobados (renglonesAprobados). o = {renglones:
 * [{renglon, incluir, descripcion, notas}], proveedor: {nombre, correo}, notas}. Sin renglones en o, van todos como están.
 * Descripción y notas que compras cambió (vacías = las de la requisición; notas: "" las quita); al menos un renglón.
 * Devuelve {renglones: [{renglon, descripcion, cantidad (la aprobada), unidad, notas}], proveedor: {nombre, correo}, notas}.
 */
function normalizarSolicitudCotizacion(o, aprobados) {
  const x = o || {};
  const limpio = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
  const porRenglon = {};
  (Array.isArray(x.renglones) ? x.renglones : []).forEach(r => {
    if (!r) return;
    const n = Number(r.renglon);
    if (!(aprobados || []).some(a => a.renglon === n)) throw new Error('El renglón ' + r.renglon + ' no está aprobado: no va en la solicitud.');
    porRenglon[n] = r;
  });
  const renglones = (aprobados || []).filter(a => !porRenglon[a.renglon] || porRenglon[a.renglon].incluir !== false).map(a => {
    const r = porRenglon[a.renglon] || {};
    const descripcion = limpio(r.descripcion) || a.descripcion;
    if (descripcion.length > 500) throw new Error('La descripción del renglón ' + a.renglon + ' debe tener máximo 500 caracteres.');
    const notas = r.notas == null ? limpio(a.notas) : limpio(r.notas);
    if (notas.length > 300) throw new Error('Las notas del renglón ' + a.renglon + ' deben tener máximo 300 caracteres.');
    return { renglon: a.renglon, descripcion: descripcion, cantidad: a.cantidad, unidad: a.unidad, notas: notas };
  });
  if (!renglones.length) throw new Error('Elige al menos un renglón para la solicitud de cotización.');
  const p = x.proveedor || {};
  const nombre = limpio(p.nombre || p.razonSocial).slice(0, 150);
  const correo = limpio(p.correo).toLowerCase();
  if (correo && !/^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i.test(correo)) throw new Error('El correo del proveedor no es válido.');
  const notas = String(x.notas == null ? '' : x.notas).trim();
  if (notas.length > 1000) throw new Error('Las notas para el proveedor deben tener máximo 1000 caracteres.');
  return { renglones: renglones, proveedor: { nombre: nombre, correo: correo }, notas: notas };
}

/**
 * HTML del PDF "Solicitud de cotización" (mismas reglas que el de la orden: tablas, inline CSS, sin depender de fondos, todo
 * texto escapado). d = {folio, fecha "dd/MM/yyyy", proveedor: {nombre, correo}, renglones (normalizarSolicitudCotizacion),
 * notas, sitio: {nombre, direccion}, fechaRequerida, contacto: {nombre, correo}}. Datos fiscales de Helgen (Config). Nunca
 * cliente, proyecto, presupuesto ni precios.
 */
function construirHtmlSolicitudCotizacion(d, cfg, logoUrl) {
  const e = escaparHtml, c = cfg || {};
  const AZUL = '#2C3C5B', AQUA = '#51F3DA', TEAL = '#0AC5A8', GRIS = '#6B7280';
  const logo = logoUrl ? '<img src="' + logoUrl + '" style="height:44px;">'
    : '<div style="font-size:26px;font-weight:bold;color:' + AZUL + ';">Helgen</div>';
  const docFila = (k, v, fuerte) => v ? '<tr><td style="padding:1px 10px 1px 0;color:' + GRIS + ';text-align:right;">' + k + '</td>' +
    '<td style="padding:1px 0;text-align:right;color:' + AZUL + ';' + (fuerte ? 'font-weight:bold;font-size:12px;' : '') + '">' + e(v) + '</td></tr>' : '';
  const dato = (k, v) => v ? '<tr><td class="k">' + k + '</td><td>' + e(v).replace(/\n/g, '<br>') + '</td></tr>' : '';
  const p = d.proveedor || {}, s = d.sitio || {}, ct = d.contacto || {};
  const filas = (d.renglones || []).map((r, i) => '<tr><td class="c">' + (i + 1) + '</td><td>' + e(r.descripcion) + '</td>' +
    '<td class="r">' + e(r.cantidad) + '</td><td class="c">' + e(r.unidad) + '</td><td>' + e(r.notas) + '</td></tr>').join('');
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#1F2937;margin:0;}' +
    'table{border-collapse:collapse;width:100%;}td,th{padding:5px 6px;vertical-align:top;}' +
    '.c{text-align:center;}.r{text-align:right;white-space:nowrap;}.k{color:' + GRIS + ';width:120px;}' +
    '.mod{font-size:11px;font-weight:bold;color:' + AZUL + ';border-bottom:2px solid ' + TEAL + ';padding:0 0 3px 0;margin:16px 0 6px 0;}' +
    '.partidas th{color:' + AZUL + ';font-size:9px;text-transform:uppercase;text-align:left;border-top:2px solid ' + AZUL + ';' +
    'border-bottom:2px solid ' + AZUL + ';}.partidas td{border-bottom:1px solid #E5E7EB;}.partidas th.r{text-align:right;}.partidas th.c{text-align:center;}' +
    '</style></head><body>' +
    '<table><tr><td style="width:55%;padding:4px 0;vertical-align:middle;">' + logo + '</td>' +
    '<td style="width:45%;padding:0;text-align:right;vertical-align:middle;"><table style="width:auto;margin-left:auto;">' +
    '<tr><td colspan="2" style="font-size:18px;font-weight:bold;letter-spacing:1px;color:' + AZUL + ';padding:0 0 3px;text-align:right;">SOLICITUD DE COTIZACIÓN</td></tr>' +
    docFila('Referencia', d.folio, true) + docFila('Fecha', d.fecha) + docFila('Se necesita', fechaCorreo(d.fechaRequerida)) +
    '</table></td></tr></table>' +
    '<div style="border-top:3px solid ' + AQUA + ';margin-top:8px;"></div>' +
    '<div style="padding:6px 0 0;color:#4B5563;line-height:1.5;"><b style="color:' + AZUL + ';">' + e(c.EMPRESA_NOMBRE) + '</b> · RFC ' +
    e(c.EMPRESA_RFC) + '<br>' + e(c.EMPRESA_DIRECCION) + '<br>' + e(c.EMPRESA_TELEFONO) + ' · ' + e(c.EMPRESA_EMAIL) + ' · ' + e(c.EMPRESA_WEB) + '</div>' +
    (p.nombre || p.correo ? '<div style="margin-top:12px;"><span style="color:' + GRIS + ';">Para:</span> <b style="color:' + AZUL + ';">' +
      e(p.nombre) + '</b>' + (p.correo ? ' · ' + e(p.correo) : '') + '</div>' : '') +
    '<div style="margin-top:12px;line-height:1.5;">Le solicitamos su cotización de las partidas siguientes.</div>' +
    '<div class="mod">1 · PARTIDAS</div>' +
    '<table class="partidas"><tr><th class="c" style="width:22px;">#</th><th>Descripción</th><th class="r" style="width:55px;">Cantidad</th>' +
    '<th class="c" style="width:55px;">Unidad</th><th style="width:170px;">Notas</th></tr>' + filas + '</table>' +
    '<div class="mod">2 · ENTREGA</div><table>' +
    dato('Lugar de entrega', [s.nombre, s.direccion].filter(Boolean).join('\n') || 'Por confirmar') +
    dato('Se necesita', fechaCorreo(d.fechaRequerida)) + '</table>' +
    '<div class="mod">3 · CONTACTO DE COMPRAS</div><table>' +
    dato('Nombre', ct.nombre) + dato('Correo', ct.correo) + dato('Empresa', [c.EMPRESA_EMAIL, c.EMPRESA_TELEFONO].filter(Boolean).join(' · ')) +
    '</table>' +
    (d.notas ? '<div class="mod">NOTAS</div><div style="line-height:1.5;">' + e(d.notas).replace(/\n/g, '<br>') + '</div>' : '') +
    '<table style="margin-top:18px;"><tr><td style="border-left:3px solid ' + TEAL + ';padding:8px 10px;line-height:1.5;">' +
    '<b style="color:' + AZUL + ';">Le pedimos incluir en su cotización:</b> precio unitario de cada partida, IVA, tiempo de entrega, ' +
    'vigencia de la cotización y condiciones de pago. Por favor indique la referencia ' + e(d.folio) + '.</td></tr></table>' +
    '<div style="margin-top:18px;border-top:1px solid #D1D5DB;padding:6px 0 0;color:' + GRIS + ';font-size:9px;">' +
    e(c.EMPRESA_NOMBRE) + ' &nbsp;·&nbsp; ' + e(c.EMPRESA_EMAIL) + ' &nbsp;·&nbsp; ' + e(c.EMPRESA_TELEFONO) + '</div>' +
    '</body></html>';
}

/** Termina una oración con punto (si ya termina en punto, no agrega otro). */
const conPuntoCorreo = t => /[.!?]$/.test(String(t)) ? String(t) : String(t) + '.';

/** Firma de compras para los correos a proveedores. */
function firmaCompras_(ct, cfg) {
  const c = cfg || {}, x = ct || {};
  return ['', 'Saludos,', x.nombre || '', 'Compras · ' + (c.EMPRESA_NOMBRE || 'Helgen Servicios Especializados'),
    [c.EMPRESA_TELEFONO, x.correo || c.EMPRESA_EMAIL].filter(Boolean).join(' · ')].filter((l, i) => i < 2 || l);
}

/** Asunto y partes del cuerpo del correo de la solicitud de cotización (lista = una línea por partida; ver correoConLigas). */
function textosSolicitudCotizacion(d, cfg) {
  const c = cfg || {}, p = d.proveedor || {}, s = d.sitio || {};
  const empresa = c.EMPRESA_NOMBRE || 'Helgen Servicios Especializados';
  return {
    asunto: 'Solicitud de cotización · ' + empresa + ' · ' + d.folio,
    inicio: ['Buenos días' + (p.nombre ? ', ' + p.nombre : '') + ':', '', 'Les solicitamos cotización de las partidas siguientes ' +
      '(detalle en el PDF adjunto, referencia ' + d.folio + '):', ''],
    lista: (d.renglones || []).map((r, i) => (i + 1) + '. ' + r.cantidad + ' ' + r.unidad + ' · ' + r.descripcion),
    fin: ['', 'Por favor incluyan precio unitario, IVA, tiempo de entrega, vigencia de la cotización y condiciones de pago.']
      .concat(s.nombre ? [conPuntoCorreo('Entrega en ' + s.nombre + (s.direccion ? ': ' + s.direccion : ''))] : [])
      .concat(d.fechaRequerida ? ['Se necesita para el ' + fechaCorreo(d.fechaRequerida) + '.'] : [])
      .concat(firmaCompras_(d.contacto, c)),
  };
}

/** Asunto y partes del cuerpo del correo con una orden de compra para el proveedor (sin montos: van en el PDF). */
function textosOrdenCompra(d, cfg) {
  const c = cfg || {}, p = d.proveedor || {};
  const empresa = c.EMPRESA_NOMBRE || 'Helgen Servicios Especializados';
  return {
    asunto: 'Orden de compra ' + d.folio + ' · ' + empresa,
    inicio: ['Buenos días' + (p.contacto ? ', ' + p.contacto : p.nombre ? ', ' + p.nombre : '') + ':', '',
      'Les enviamos la orden de compra ' + d.folio + ' (PDF adjunto). Partidas:', ''],
    lista: (d.renglones || []).map((r, i) => (i + 1) + '. ' + r.cantidad + ' ' + r.unidad + ' · ' + r.descripcion),
    fin: ['', conPuntoCorreo('Entrega: ' + [fechaCorreo(d.fechaEntrega), d.lugarEntrega].filter(Boolean).join(' en ')),
      'Por favor confirmen de recibido y la fecha de entrega, e indiquen el folio ' + d.folio + ' en su factura.']
      .concat(firmaCompras_(d.contacto, c)),
  };
}

/**
 * Correo a un proveedor listo para "Abrir en Gmail" y "Abrir en mi correo" (mailto:). partes = {inicio, lista, fin} (líneas).
 * Si la liga más larga pasa de max (MAX_LIGA_CORREO), se quitan partidas del final y se agrega "… y N partida(s) más: ver el
 * PDF adjunto."; si aun así no cabe, se corta el texto y termina en "… ver el PDF adjunto.". La interfaz tiene una copia
 * idéntica (ligasCorreo en mod-correos) para rehacer las ligas si se cambia el correo; la prueba compara las dos.
 * Devuelve {para, asunto, cuerpo, gmail, mailto, recortado}.
 */
function correoConLigas(para, asunto, partes, max) {
  const tope = max || MAX_LIGA_CORREO, p = partes || {};
  const inicio = p.inicio || [], lista = p.lista || [], fin = p.fin || [];
  const to = String(para == null ? '' : para).trim(), su = String(asunto == null ? '' : asunto);
  const gmail = b => 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(to) + '&su=' + encodeURIComponent(su) +
    '&body=' + encodeURIComponent(b);
  const mailto = b => 'mailto:' + encodeURIComponent(to).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(su) +
    '&body=' + encodeURIComponent(b).replace(/%0A/g, '%0D%0A');
  const largo = b => Math.max(gmail(b).length, mailto(b).length);
  const armar = n => inicio.concat(lista.slice(0, n), n < lista.length ? ['… y ' + (lista.length - n) +
    ' partida(s) más: ver el PDF adjunto.'] : [], fin).join('\n');
  let n = lista.length, cuerpo = armar(n);
  while (n > 0 && largo(cuerpo) > tope) cuerpo = armar(--n);
  let recortado = n < lista.length;
  if (largo(cuerpo) > tope) {
    const marca = '\n… ver el PDF adjunto.';
    let t = cuerpo;
    while (t && largo(t + marca) > tope) t = t.slice(0, Math.max(0, t.length - 40));
    cuerpo = t + marca;
    recortado = true;
  }
  return { para: to, asunto: su, cuerpo: cuerpo, gmail: gmail(cuerpo), mailto: mailto(cuerpo), recortado: recortado };
}

// ---- 6.C Centro de mando (drogheda.helgen.online): sitios con código, ítems, En camino, avisos firmados, recepciones ----
// El centro de mando es el inventario (ítems, existencias por sitio, material en tránsito, kits, salidas y conteos). CAPRI
// conserva el dinero, las aprobaciones y qué, cuánto y a qué sitio; el centro de mando nunca recibe montos. Solo los proyectos
// ligados (Script Property PORTAL_PROYECTOS) hablan con él. Sin PORTAL_URL y PORTAL_SECRETO todo esto está apagado y CAPRI
// funciona como antes. Detalle en docs/incremento-4-centro.md.
//   Avisos: cada cambio guardado (orden autorizada, pagada, en camino, cancelada; requisición cerrada) se escribe en la pestaña
//   PortalPendientes (dentro del candado) y, ya fuera del candado, se manda firmado (conAvisoPortal_). Si no contesta, queda
//   Pendiente y el activador de 15 minutos lo reintenta; la acción de la persona nunca falla por eso.
//   Recepciones: el activador lee lo que se recibió en los sitios (traerRecepcionesPortal) y cierra solo las requisiciones.

function modCentroMando_() {
  return {
    nombre: 'Centro de mando',
    api: { marcarEnCamino: marcarEnCamino, misArticulos: misArticulos, itemsInventario: itemsInventario,
      estadoCentroMando: estadoCentroMando, consultarCentroMando: consultarCentroMando },
    cambios: { marcarEnCamino: ['requisiciones', 'oc'], consultarCentroMando: ['requisiciones', 'oc'] },
    // Quien pide y quien recibe suelen ser cuentas de solo requisiciones
    solo: ['marcarEnCamino', 'misArticulos', 'itemsInventario'],
    publicas: [],
    bootstrap(permisos) {
      if (!(permisos.requisicion || permisos.compras || permisos.operaciones)) return {};
      const cfg = configPortal_();
      const c = { activo: cfg.activo, ligados: cfg.activo ? Object.keys(cfg.proyectos) : [], items: null, misArticulos: null };
      if (cfg.activo) { const it = itemsInventario_(true); c.items = it ? it.items : null; } // solo si ya está en caché
      if (permisos.requisicion) c.misArticulos = misArticulos(true); // ídem (si no, la interfaz los pide)
      return { centro: c };
    },
    sincronizar(permisos, ctx, algo, r) {
      if (!(permisos.requisicion || permisos.compras || permisos.operaciones)) return;
      const cfg = configPortal_();
      r.centro = { activo: cfg.activo, ligados: cfg.activo ? Object.keys(cfg.proyectos) : [] };
    },
    preparar() {
      migrarSitiosConCodigo_();
      const libro = libroComprasSiExiste_();
      if (libro) hojaCompras_(libro, 'PortalPendientes');
      instalarActivadorPortal();
      const cfg = configPortal_();
      console.log('Centro de mando: ' + (cfg.activo ? 'activo (' + cfg.url + ')' + (cfg.prueba ? ' · avisos de PRUEBA' : '')
        : 'apagado (faltan PORTAL_URL con https:// y PORTAL_SECRETO)') + ' · proyectos ligados: ' + JSON.stringify(cfg.proyectos) +
        ' · activador cadaQuinceMinutos instalado.');
    },
  };
}

const TIPOS_EVENTO_PORTAL = ['oc.autorizada', 'oc.pagada', 'oc.en_camino', 'oc.cancelada', 'req.cerrada',
  'oc.devolucion']; // incremento 5 (H): se resolvió una devolución de un proyecto ligado
const MENSAJE_PORTAL_PENDIENTE = 'Guardado. El centro de mando se actualizará en unos minutos.';
/** Quién aparece en el historial y la Bitacora cuando el cambio lo trae el centro de mando. */
const CORREO_CENTRO_MANDO = 'centro de mando';
const RUTA_PORTAL_EVENTO = '/api/integracion/cotizador/evento';
const RUTA_PORTAL_RECEPCIONES = '/api/integracion/cotizador/recepciones';
const RUTA_PORTAL_ITEMS = '/api/integracion/inventario/items';
const PAQ_PROVEEDOR = 'Lo trae el proveedor';
const MAX_ENVIOS_PORTAL = 60; // por corrida (el activador sigue en la siguiente)

/**
 * Configuración del centro de mando (Script Properties; nunca sale a la interfaz ni al registro): PORTAL_URL (https://…),
 * PORTAL_SECRETO (secreto compartido), PORTAL_PROYECTOS (JSON {"PRY-2026-0002": "drogheda"}: llave interna → proyecto del
 * centro de mando) y PORTAL_PRUEBA ('1' = los avisos van con "prueba": true). activo = hay URL https y secreto.
 */
function configPortal_() {
  if (MEMO_.cfgPortal) return MEMO_.cfgPortal;
  const p = propiedades_();
  const url = String(p.PORTAL_URL || '').trim().replace(/\/+$/, '');
  const secreto = String(p.PORTAL_SECRETO || '').trim();
  const proyectos = {};
  try {
    const j = JSON.parse(String(p.PORTAL_PROYECTOS || '').trim() || '{}');
    Object.keys(j || {}).forEach(k => {
      const f = folioInterno(k), v = String(j[k] == null ? '' : j[k]).trim();
      if (/^PRY-\d{4}-\d{4}$/.test(f) && v) proyectos[f] = v;
    });
  } catch (e) {
    console.warn('PORTAL_PROYECTOS no es un JSON válido: ningún proyecto queda ligado.');
  }
  MEMO_.cfgPortal = { activo: /^https:\/\/[^\s/]+/i.test(url) && !!secreto, url: url, secreto: secreto, proyectos: proyectos,
    prueba: String(p.PORTAL_PRUEBA || '').trim() === '1' };
  return MEMO_.cfgPortal;
}

/** Parte de las claves de caché que depende de los proyectos ligados (si cambian, las listas se arman de nuevo). */
function firmaCentro_() {
  const cfg = configPortal_();
  return cfg.activo ? 'cm' + Object.keys(cfg.proyectos).sort().join('.') + '_' : '';
}

/**
 * ¿El proyecto habla con el centro de mando? Su llave interna (PRY-AAAA-NNNN; acepta también el folio con clave) está en
 * PORTAL_PROYECTOS y la función está encendida (PORTAL_URL y PORTAL_SECRETO). Única definición: la usan este módulo y
 * Pendientes (módulo D).
 */
function proyectoLigado_(proyectoFolio) {
  const cfg = configPortal_();
  return cfg.activo && !!cfg.proyectos[folioInterno(proyectoFolio)];
}

/** Centro de mando de una requisición: null si su proyecto no está ligado; si no, {proyecto, sitioCodigo, sitio (etiqueta)}. */
function centroDeReq_(req, cfg, det) {
  const c = cfg || configPortal_();
  if (!proyectoLigado_(req.proyectoFolio)) return null;
  const clave = c.proyectos[folioInterno(req.proyectoFolio)];
  const d = det || sitiosDetalle_();
  const codigo = codigoDeSitio(req.sitio, d);
  const s = d.find(x => x.codigo === codigo);
  return { proyecto: clave, sitioCodigo: codigo, sitio: codigo ? codigo + ' · ' + (s ? s.nombre : req.sitio) : (req.sitio || 'sin sitio') };
}

/** Sitio obligatorio y con código del centro de mando (proyecto ligado); devuelve el código o lanza el error para la persona. */
function sitioConCodigo_(sitio, folioReq) {
  const s = String(sitio == null ? '' : sitio).trim();
  const de = folioReq ? 'La requisición ' + folioReq + ' es de un proyecto ligado al centro de mando: '
    : 'El proyecto está ligado al centro de mando: ';
  if (!s) throw new Error(de + 'elige el sitio donde se recibe el material' + (folioReq ? ' (devuélvela para que lo elijan).' : '.'));
  const codigo = codigoDeSitio(s, sitiosDetalle_());
  // Solo los sitios que conoce el centro de mando (D-27-3): otro código lo rechazaría (400) y detendría los avisos de la orden
  const conocidos = CODIGOS_SITIO_CONOCIDOS.map(x => x[0]);
  if (!codigo || conocidos.indexOf(codigo) === -1) {
    throw new Error(de + 'el sitio "' + s.slice(0, 60) + '"' + (codigo ? ' (' + codigo + ')' : '') + ' no es un sitio del centro de mando (' +
      conocidos.join(', ') + '). Elige uno de esos o corrige Config → SITIOS.');
  }
  return codigo;
}

/** Quien pidió no cierra aquí una requisición de un proyecto ligado: se recibe en el centro de mando. */
function exigirNoLigado_(req) {
  const c = centroDeReq_(req);
  if (c) throw new Error('El material de ' + req.folio + ' se recibe en el centro de mando (' + c.sitio + '): allá lo registra quien recibe en el sitio.');
}

/** ¿Lo anuló un super admin? (esAnulado_ es del módulo de anular; si todavía no está, nada está anulado). */
function anuladoCentro_(folio) {
  try {
    return !!folio && typeof esAnulado_ === 'function' && !!esAnulado_(folio);
  } catch (e) {
    return false;
  }
}

/** Lo que un aviso por correo puede llevar de una requisición (sin propuesta, montos ni proveedor). */
function reqParaAviso_(req) {
  return { folio: req.folio, proyectoFolio: req.proyectoFolio, solicitanteEmail: req.solicitanteEmail, solicitante: req.solicitante,
    recibeEmail: req.recibeEmail || req.solicitanteEmail, sitio: req.sitio, estado: req.estado };
}

/** Fecha y hora con zona ("2026-10-28T10:15:00-06:00"), como la pide el centro de mando para firmar. */
function isoConZona_(d) {
  const f = Utilities.formatDate(d, 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss');
  const m = f.match(/^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)$/);
  const off = Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  const a = Math.abs(off), p = n => String(n).padStart(2, '0');
  return f.replace(' ', 'T') + (off < 0 ? '-' : '+') + p(Math.floor(a / 60)) + ':' + p(a % 60);
}

/** Firma del contrato: hex de HMAC-SHA256(secreto, tiempo + "\n" + cuerpo) (Apps Script da bytes con signo). */
function firmaPortal_(secreto, tiempo, cuerpo) {
  return hexDeBytes(Utilities.computeHmacSha256Signature(tiempo + '\n' + cuerpo, secreto, Utilities.Charset.UTF_8));
}

/**
 * Llamada firmada al centro de mando (cabeceras X-Hbox-Tiempo y X-Hbox-Firma). Nunca lanza error ni pone el secreto en el
 * mensaje: {ok, codigo, datos, error}. ok = respondió 200 con {ok: true}.
 */
function llamarPortal_(cfg, metodo, url, cuerpo) {
  const tiempo = isoConZona_(new Date());
  const op = { method: metodo, muteHttpExceptions: true, followRedirects: false,
    headers: { 'X-Hbox-Tiempo': tiempo, 'X-Hbox-Firma': 'sha256=' + firmaPortal_(cfg.secreto, tiempo, cuerpo || '') } };
  if (metodo === 'post') { op.contentType = 'application/json; charset=utf-8'; op.payload = cuerpo; }
  let r;
  try {
    r = UrlFetchApp.fetch(url, op);
  } catch (e) {
    return { ok: false, codigo: 0, error: 'Sin respuesta del centro de mando: ' + String(e && e.message || e).slice(0, 200) };
  }
  const codigo = r.getResponseCode();
  let datos = null;
  try { datos = JSON.parse(r.getContentText()); } catch (e) { datos = null; }
  if (codigo === 200 && datos && datos.ok === true) return { ok: true, codigo: codigo, datos: datos };
  return { ok: false, codigo: codigo, datos: datos,
    error: 'El centro de mando respondió ' + codigo + (datos && datos.error ? ': ' + String(datos.error).slice(0, 200) : '') };
}

/** Manda un aviso ya formado (texto JSON). {ok, repetido, datos, error}. */
function enviarEventoPortal_(cfg, texto) {
  const r = llamarPortal_(cfg, 'post', cfg.url + RUTA_PORTAL_EVENTO, texto);
  return r.ok ? { ok: true, repetido: !!r.datos.repetido, datos: r.datos } : r;
}

/**
 * Avisa al centro de mando un cambio de una orden de compra (tipo: oc.autorizada, oc.pagada, oc.en_camino, oc.cancelada,
 * req.cerrada). Se llama dentro del candado, después de guardar el cambio: forma el aviso con lo que hay en la hoja (sin
 * montos), lo escribe en PortalPendientes (Pendiente) y lo deja en la cola de la petición; conAvisoPortal_ lo manda al salir
 * del candado y, si nadie lo manda (p. ej. el módulo de anular), lo manda el activador de 15 minutos. evento_id =
 * "<folio OC>:<tipo>:<n>" (n = cuántas veces se ha formado ese tipo para esa orden): un reintento nunca duplica.
 * Solo proyectos ligados y con la función encendida. Nunca lanza error. Devuelve el evento_id ('' si no aplica).
 */
function avisarPortal_(tipo, folioOc, extra) { // extra (H, incremento 5): {devolucion} para oc.devolucion
  try {
    const cfg = configPortal_();
    if (!cfg.activo || TIPOS_EVENTO_PORTAL.indexOf(tipo) === -1) return '';
    const libro = libroComprasSiExiste_();
    if (!libro) return '';
    const cancelacion = tipo === 'oc.cancelada'; // también de una orden recién anulada (módulo de anular)
    const orden = buscarOrden_(libro, folioOc, cancelacion).orden;
    const clave = cfg.proyectos[folioInterno(orden.proyectoFolio)];
    if (!clave) return '';
    // Lo anulado ya no se avisa, salvo el propio aviso de cancelación que manda el módulo de anular
    if (tipo !== 'oc.cancelada' && (anuladoCentro_(orden.folio) || anuladoCentro_(orden.reqFolio))) return '';
    // Una orden que ya iba en curso cuando se ligó el proyecto: el centro de mando nunca recibió su oc.autorizada. Se forma
    // primero (así nunca ve un pago o un envío antes de la autorización); si lo que se avisa es la cancelación, no hay nada que
    // cancelar allá.
    if (tipo !== 'oc.autorizada' && !avisoPortalExiste_(libro, orden.folio + ':oc.autorizada:')) {
      if (tipo === 'oc.cancelada') return '';
      if (orden.estado !== OC_CANCELADA && orden.estado !== ESTADO_ANULADA) avisarPortal_('oc.autorizada', orden.folio);
    }
    const req = orden.reqFolio ? buscarReq_(libro, orden.reqFolio, cancelacion).req : null;
    const hoja = hojaCompras_(libro, 'PortalPendientes');
    const prefijo = (orden.folio + ':' + tipo + ':').toUpperCase();
    const previos = filasDeArea_(hoja, HOJAS_COMPRAS, 'PortalPendientes')
      .filter(r => String(r[0] || '').toUpperCase().indexOf(prefijo) === 0).length;
    const datos = { cuando: isoConZona_(new Date()), quien: VENDEDOR_ ? VENDEDOR_.email : '', prueba: cfg.prueba, orden: orden, req: req,
      proyectoFolio: folioInterno(orden.proyectoFolio), proyectoClave: clave,
      sitioCodigo: req ? codigoDeSitio(req.sitio, sitiosDetalle_()) : '',
      sinRecibir: renglonesSinRecepcion(req ? propuestaVigente_(req) : null),
      devolucion: extra && extra.devolucion ? extra.devolucion : null }; // H: oc.devolucion
    let cuerpo = cuerpoEventoPortal(tipo, previos + 1, datos);
    let texto = jsonAscii(cuerpo);
    if (texto.length > 45000) { cuerpo = cuerpoEventoPortal(tipo, previos + 1, datos, 40); texto = jsonAscii(cuerpo); } // cabe en una celda
    const montos = buscarMontos(cuerpo);
    if (montos.length) throw new Error('el aviso llevaba montos (' + montos.join(', ') + ')'); // nunca debe pasar
    escribe_(hoja).appendRow([cuerpo.evento_id, texto, 0, '', ahoraTexto_(), 'Pendiente', '']);
    (MEMO_.portal = MEMO_.portal || []).push({ eventoId: cuerpo.evento_id, oc: orden.folio });
    return cuerpo.evento_id;
  } catch (e) {
    console.warn('Aviso al centro de mando no formado (' + tipo + ' ' + folioOc + '): ' + e.message);
    return '';
  }
}

/** ¿Ya hay en PortalPendientes un aviso cuyo evento_id empieza con prefijo (p. ej. "OC-2026-0012:oc.autorizada:")? */
function avisoPortalExiste_(libro, prefijo) {
  if (!libro.getSheetByName('PortalPendientes')) return false;
  const p = String(prefijo).toUpperCase();
  return filasDeArea_(hojaCompras_(libro, 'PortalPendientes'), HOJAS_COMPRAS, 'PortalPendientes')
    .some(r => String(r[0] || '').toUpperCase().indexOf(p) === 0);
}

/**
 * Manda (fuera del candado) los avisos que formó esta petición. Si alguno no llegó, quedan Pendientes para el activador y el
 * resultado lleva avisoPortal (también su vista) para que la interfaz diga "Guardado. El centro de mando se actualizará en unos
 * minutos". Nunca lanza error: la acción de la persona ya quedó guardada.
 */
function conAvisoPortal_(resultado) {
  const cola = MEMO_.portal || [];
  if (!cola.length) return resultado;
  MEMO_.portal = [];
  let falto = true;
  try {
    const r = enviarPendientesPortal_(cola.map(x => x.oc));
    falto = cola.some(x => !r.enviados[x.eventoId]);
  } catch (e) {
    console.warn('Avisos al centro de mando sin mandar: ' + e.message);
  }
  if (falto && resultado && typeof resultado === 'object' && !Array.isArray(resultado)) {
    resultado.avisoPortal = MENSAJE_PORTAL_PENDIENTE;
    if (resultado.vista && typeof resultado.vista === 'object') resultado.vista.avisoPortal = MENSAJE_PORTAL_PENDIENTE;
  }
  return resultado;
}

/**
 * Manda los avisos Pendientes de PortalPendientes, en el orden en que se formaron (soloOcs = solo los de esas órdenes; null =
 * todos). Por orden se detiene en el primero que falle, para que el centro de mando nunca reciba un pago antes que su
 * autorización. Sin candado: solo cambia celdas de filas que ya existen. {enviados: {evento_id: true}, intentados, fallidos}.
 */
function enviarPendientesPortal_(soloOcs) {
  const res = { enviados: {}, intentados: 0, fallidos: 0 };
  const cfg = configPortal_();
  if (!cfg.activo) return res;
  const libro = libroComprasSiExiste_();
  if (!libro || !libro.getSheetByName('PortalPendientes')) return res;
  const hoja = hojaCompras_(libro, 'PortalPendientes');
  const filtro = soloOcs ? soloOcs.map(f => String(f).toUpperCase()) : null;
  const detenidas = {};
  filasDeArea_(hoja, HOJAS_COMPRAS, 'PortalPendientes').forEach((r, i) => {
    const id = String(r[0] || '').trim();
    if (!id || String(r[5] || '') !== 'Pendiente' || res.intentados >= MAX_ENVIOS_PORTAL) return;
    const oc = id.split(':')[0].toUpperCase();
    if ((filtro && filtro.indexOf(oc) === -1) || detenidas[oc]) return;
    res.intentados++;
    const envio = enviarEventoPortal_(cfg, String(r[1] || ''));
    const fila = i + 2, intentos = (Number(r[2]) || 0) + 1;
    if (envio.ok) {
      escribe_(hoja).getRange(fila, 3, 1, 2).setValues([[intentos, envio.repetido ? 'ya lo tenía (repetido)' : '']]);
      escribe_(hoja).getRange(fila, 6, 1, 2).setValues([['Enviado', ahoraTexto_()]]);
      res.enviados[id] = true;
    } else if (rechazoDefinitivo(envio.codigo, intentos)) {
      // El centro de mando lo rechaza por su contenido (4xx) varias veces: se aparta como Rechazado para que no detenga los
      // demás avisos de la orden (p. ej. oc.cancelada); compras lo ve en el estado del enlace
      escribe_(hoja).getRange(fila, 3, 1, 2).setValues([[intentos, textoCelda(String(envio.error).slice(0, 300))]]);
      escribe_(hoja).getRange(fila, 6, 1, 2).setValues([['Rechazado', ahoraTexto_()]]);
      res.fallidos++;
    } else {
      escribe_(hoja).getRange(fila, 3, 1, 2).setValues([[intentos, textoCelda(String(envio.error).slice(0, 300))]]);
      detenidas[oc] = true;
      res.fallidos++;
    }
  });
  return res;
}

/**
 * ¿Se deja de reintentar un aviso? Solo si el centro de mando lo rechazó por su contenido (400–499, salvo 401/403 de firma o
 * secreto, 408 y 429, que se arreglan solos o con la configuración) en MAX_INTENTOS_RECHAZO intentos o más (pura).
 */
function rechazoDefinitivo(codigo, intentos) {
  const c = Number(codigo) || 0;
  return c >= 400 && c < 500 && [401, 403, 408, 429].indexOf(c) === -1 && Number(intentos) >= MAX_INTENTOS_RECHAZO;
}
const MAX_INTENTOS_RECHAZO = 4;

/**
 * En camino (solicitante, compras o quien recibe; idempotente). d = {paqueteria, guia, fechaEstimada, traeProveedor, recogido,
 * idSolicitud}. Envío (compras o quien pidió): paquetería, guía (salvo "lo trae el proveedor") y fecha estimada no anterior a
 * hoy. "Lo recogí" (recogido: true; quien recibe o quien pidió): paquetería "Recogido por <nombre>", sin guía. Desde Autorizada,
 * Pagada o En camino (otra vez = corregir el envío). Guarda paquetería, guía, fecha estimada, cuándo y quién en la orden, avisa
 * oc.en_camino al centro de mando y forma el aviso req.encamino (quien pidió y quien recibe).
 */
function marcarEnCamino(folioReq, d) {
  if (!VENDEDOR_) throw errorSesion_('Inicia sesión con tu cuenta @' + DOMINIO_HELGEN + '.');
  const compras = esCompras_(), requisicion = esRequisicion_();
  if (!compras && !requisicion) throw errorPermiso_('No tienes permiso para registrar envíos.');
  const d0 = d || {};
  const fotos = d0.recogido === true ? fotosDeRenglones_(d0.renglones) : null; // H (incremento 5): "Lo recogí" lleva foto por renglón
  const libro = libroCompras_();
  const idSolicitud = String(d0.idSolicitud || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const claveCache = idSolicitud ? 'ENC_' + idSolicitud : '';
  return conAvisoPortal_(conCandado_(() => {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) return JSON.parse(previo);
    }
    const yo = yo_();
    const { hoja, req } = buscarReq_(libro, folioReq);
    const recibe = req.recibeEmail || req.solicitanteEmail;
    const recogido = d0.recogido === true;
    if (recogido) {
      if (yo !== recibe && yo !== req.solicitanteEmail) {
        throw errorPermiso_('Solo quien recibe la requisición ' + req.folio + ' (o quien la pidió) puede marcar "Lo recogí".');
      }
    } else if (yo !== req.solicitanteEmail && !compras) {
      throw errorPermiso_('Solo compras o quien pidió la requisición ' + req.folio + ' puede registrar el envío.');
    }
    const nuevo = transicionReq(req.estado, 'enCamino');
    const { hoja: hO, orden } = buscarOrden_(libro, req.ocFolio);
    if (orden.estado === OC_CANCELADA) throw new Error('La orden ' + orden.folio + ' está cancelada.');
    const e = normalizarEnCamino(d0, { hoy: hoyIso_(), nombre: nombreYo_() });
    if (recogido) fotosRecogido_(libro, req, orden, fotos); // H: una foto por renglón por recibir (se revisan antes de escribir)
    const t = textoCelda;
    escribe_(hO).getRange(orden.fila, colOc_('paqueteria'), 1, 5).setValues([[t(e.paqueteria), t(e.guia), textoFecha_(e.fechaEstimada),
      ahoraTexto_(), t(yo)]]);
    const nota = (req.estado === REQ_EN_CAMINO ? 'Envío corregido: ' : '') + textoEnCamino(e);
    cambiarReq_(hoja, req, nuevo, {});
    eventoReq_(libro, req.folio, nuevo, nota);
    bitacora_(libro, recogido ? 'Lo recogí' : 'Marcar en camino', req.proyectoFolio, req.folio + ' · ' + orden.folio + ' · ' + nota, '',
      HOJAS_COMPRAS);
    avisarPortal_('oc.en_camino', orden.folio);
    notificar_('req.encamino', { folio: req.folio, req: reqParaAviso_(req), nota: nota, sitio: req.sitio, paqueteria: e.paqueteria,
      guia: e.guia, fechaEstimada: e.fechaEstimada, recogido: recogido,
      para: [req.solicitanteEmail, recibe].filter((c, i, a) => c && a.indexOf(c) === i) });
    SpreadsheetApp.flush();
    const resultado = { folio: req.folio, estado: nuevo, requisiciones: requisicion ? misRequisiciones() : null,
      vista: compras ? vistaRequisicion_(libro, req.folio) : null };
    guardarIdempotencia_(cache, claveCache, resultado);
    return resultado;
  }));
}

/**
 * "Mis artículos" (decisión de Leo: sugerencias de lo que la persona ya pidió): descripciones de sus requisiciones, las más
 * pedidas primero, con la unidad y el último ítem del centro de mando que usó. En caché por usuario y versión.
 */
function misArticulos(soloSiHay) {
  exigirRequisicion_();
  const yo = yo_();
  const v = enCache_('misArt_' + yo, ['requisiciones'], TTL_CACHE, soloSiHay ? null : () => misArticulosDeHojas_(yo));
  return v === undefined ? null : v;
}

function misArticulosDeHojas_(yo) {
  const libro = libroComprasSiExiste_();
  if (!libro) return [];
  const mias = {};
  filasDeArea_(hojaReq_(libro), HOJAS_COMPRAS, 'Requisiciones').forEach(r => {
    if (String(r[0] || '').trim() && String(r[3] || '').toLowerCase() === yo) mias[String(r[0]).toUpperCase()] = true;
  });
  const filas = filasDeArea_(hojaCompras_(libro, 'RequisicionesRenglones'), HOJAS_COMPRAS, 'RequisicionesRenglones');
  const version = {};
  filas.forEach(r => { const f = String(r[0]).toUpperCase(); if (mias[f]) version[f] = Math.max(version[f] || 0, Number(r[1]) || 1); });
  const lista = [];
  filas.forEach((r, i) => {
    const f = String(r[0]).toUpperCase();
    if (mias[f] && (Number(r[1]) || 1) === version[f]) {
      lista.push({ descripcion: String(r[3] || ''), unidad: String(r[5] || ''), item: String(r[7] || '').trim(), orden: i });
    }
  });
  return articulosFrecuentes(lista, 100);
}

/** Ítems del inventario del centro de mando para elegir por renglón (requisiciones, compras o aprobaciones). */
function itemsInventario() {
  if (!VENDEDOR_) throw errorSesion_('Inicia sesión con tu cuenta @' + DOMINIO_HELGEN + '.');
  if (!esRequisicion_() && !esCompras_() && !esOperaciones_()) throw errorPermiso_('No tienes acceso a los ítems del inventario.');
  return itemsInventario_(false);
}

/**
 * {activo, items: [{codigo, descripcion, unidad, categoria}], actualizado} del centro de mando, en caché 6 h (CacheService).
 * soloCache = no consultar (carga inicial): null si no está. refrescarSiViejo (activador): vuelve a pedirla si tiene más de
 * 1 h. Si el centro de mando no contesta, la lista anterior (o vacía, con error).
 */
function itemsInventario_(soloCache, refrescarSiViejo) {
  const cfg = configPortal_();
  if (!cfg.activo) return { activo: false, items: [] };
  const previo = leerCache_('PORTAL_ITEMS');
  const viejo = !!previo && !!refrescarSiViejo && Date.now() - (Number(previo.ts) || 0) > 3600000;
  if (previo && !viejo) return previo;
  if (soloCache) return previo || null;
  const r = llamarPortal_(cfg, 'get', cfg.url + RUTA_PORTAL_ITEMS, '');
  if (!r.ok) return previo || { activo: true, items: [], error: 'No se pudo leer la lista de ítems del centro de mando (' + r.error + ').' };
  const valor = { activo: true, items: normalizarItemsPortal(r.datos.items), actualizado: ahoraTexto_(), ts: Date.now() };
  guardarCache_('PORTAL_ITEMS', valor, TTL_CACHE);
  return valor;
}

/** Corre fn como el centro de mando (historial y Bitacora dicen "centro de mando"). */
/**
 * Antes de cancelar o anular (fuera del candado): con el enlace encendido trae las recepciones del centro de mando, para que el
 * material que ya llegó al sitio quede en CAPRI (y frene la cancelación) antes de que la orden deje de contar; si no, se
 * volvería a comprar. folioOc: solo si esa orden es de un proyecto ligado; null: siempre (anular arrastra varias órdenes).
 * Nunca impide cancelar: si el centro de mando no contesta devuelve el error (cancelar lo pone en su confirmación) y, si
 * después llega material de esa orden, traerRecepcionesPortal lo marca como alerta para compras. '' = revisado o no aplica.
 */
function recepcionesAntesDeCancelar_(folioOc) {
  try {
    const cfg = configPortal_();
    if (!cfg.activo) return '';
    if (folioOc) {
      const libro = libroComprasSiExiste_();
      let orden = null;
      try { orden = libro ? buscarOrden_(libro, folioOc).orden : null; } catch (e) { orden = null; }
      if (!orden || !proyectoLigado_(orden.proyectoFolio)) return '';
    }
    const r = traerRecepcionesPortal();
    return r.ok ? '' : String(r.errores[0] || 'sin respuesta').slice(0, 160);
  } catch (e) {
    return String(e.message || e).slice(0, 160);
  }
}

function comoCentroMando_(fn) {
  const antes = VENDEDOR_;
  VENDEDOR_ = { email: CORREO_CENTRO_MANDO, nombre: 'Centro de mando', apellido: '' };
  try {
    return fn();
  } finally {
    VENDEDOR_ = antes;
  }
}

/**
 * Recepciones del centro de mando desde PORTAL_ULTIMA_CONSULTA (la primera vez, 30 días): completa → cierra la requisición
 * (Cerrada si la orden está pagada; si no, Recibida y espera el pago) con "Recibido en ZLO por jesush en el centro de mando,
 * 30-oct-2026"; parcial → nota en el historial y sigue igual (p. ej. En camino); ya cerrada → nada. Lo recibido se copia a
 * MovimientosInventario (bitácora de recepciones de CAPRI; CAPRI no lleva existencias) solo por la diferencia con lo ya
 * registrado, así una recepción repetida no duplica nada. PORTAL_ULTIMA_CONSULTA solo avanza si todo salió bien.
 */
function traerRecepcionesPortal() {
  const cfg = configPortal_();
  if (!cfg.activo) return { activo: false };
  const props = PropertiesService.getScriptProperties();
  const desde = props.getProperty('PORTAL_ULTIMA_CONSULTA') || isoConZona_(new Date(Date.now() - 30 * 86400000));
  const inicio = isoConZona_(new Date());
  const r = llamarPortal_(cfg, 'get', cfg.url + RUTA_PORTAL_RECEPCIONES + '?desde=' + encodeURIComponent(desde), '');
  const res = { activo: true, ok: r.ok, desde: desde, recepciones: 0, cerradas: [], parciales: [], ignoradas: [], errores: [] };
  if (!r.ok) {
    props.setProperty('PORTAL_ERROR_CONSULTA', ahoraTexto_() + ' · ' + r.error);
    MEMO_.props = null;
    res.errores.push(r.error);
    return res;
  }
  const lista = Array.isArray(r.datos.recepciones) ? r.datos.recepciones : [];
  res.recepciones = lista.length;
  const libro = lista.length ? libroComprasSiExiste_() : null;
  if (libro) {
    const det = sitiosDetalle_();
    comoCentroMando_(() => conCandado_(() => {
      lista.forEach(x => {
        try {
          aplicarRecepcionPortal_(libro, x || {}, det, res);
        } catch (e) {
          res.errores.push(String((x && x.oc_folio) || '?') + ': ' + e.message);
        }
      });
      SpreadsheetApp.flush();
    }));
    // H (incremento 5): fotos del centro de mando a Drive, ya fuera del candado; una que falla deja errores (no avanza la última
    // consulta: el centro de mando la vuelve a ofrecer), pero no detiene ni deshace lo ya aplicado
    if (res.fotos && res.fotos.length) archivarFotosPortal_(cfg, libro, res);
  }
  if (res.cerradas.length || res.parciales.length || (res.devoluciones || []).length || res.archivadas) subirVersiones_(['requisiciones', 'oc']);
  if (res.alertas && res.alertas.length) props.setProperty('PORTAL_ALERTA', ahoraTexto_() + ' · ' + res.alertas.join(' · ').slice(0, 450));
  if (!res.errores.length) {
    props.setProperty('PORTAL_ULTIMA_CONSULTA', String(r.datos.hasta || inicio));
    props.setProperty('PORTAL_ULTIMO_OK', ahoraTexto_());
    props.deleteProperty('PORTAL_ERROR_CONSULTA');
  } else {
    props.setProperty('PORTAL_ERROR_CONSULTA', ahoraTexto_() + ' · ' + res.errores.join(' · ').slice(0, 400));
  }
  MEMO_.props = null; MEMO_.cfgPortal = null;
  return res;
}

/** Aplica una recepción del centro de mando (dentro del candado, como el centro de mando). */
function aplicarRecepcionPortal_(libro, x, det, res) {
  const ocFolio = String(x.oc_folio || '').trim().toUpperCase();
  let encontrada;
  try {
    encontrada = buscarOrden_(libro, ocFolio, true); // también anulada: se avisa (huerfana), no se ignora en silencio
  } catch (e) {
    res.ignoradas.push(ocFolio + ' (no existe)');
    fotosSinOrdenPortal_(x, ocFolio, res); // revisión 5b: sus fotos se archivan igual (si no, el centro de mando las ofrece siempre)
    return;
  }
  const { hoja: hO, orden } = encontrada;
  if (!proyectoLigado_(orden.proyectoFolio)) {
    res.ignoradas.push(ocFolio + ' (proyecto no ligado)');
    // Revisión 5b: la recepción se ignora como siempre, pero sus fotos se archivan en las Recepciones del proyecto
    fotosYProblemasPortal_(libro, x, orden, { folio: orden.reqFolio || orden.folio, proyectoFolio: orden.proyectoFolio }, res, '', [], true);
    return;
  }
  const huerfana = motivo => {
    res.ignoradas.push(ocFolio + ' (' + motivo + ')');
    // H (incremento 5): sus fotos también se archivan (evidencia; si no, el centro de mando las vuelve a ofrecer siempre)
    fotosYProblemasPortal_(libro, x, orden, { folio: orden.reqFolio || orden.folio, proyectoFolio: orden.proyectoFolio }, res, '', [], true);
    // Llegó material al sitio de una orden que ya no cuenta: nunca en silencio (compras lo ve en el estado del enlace)
    const llego = (Array.isArray(x.renglones) ? x.renglones : []).some(y => Number(y && y.recibido) > 0);
    if (!llego) return;
    const texto = 'El centro de mando registró material de ' + ocFolio + ' (' + motivo + ') en ' + String(x.sitio || '?').slice(0, 10) +
      ': revisar con el sitio si hay que devolverlo o volver a registrar la compra.';
    (res.alertas = res.alertas || []).push(texto);
    bitacora_(libro, 'Recepción del centro de mando en una orden ' + motivo, orden.proyectoFolio, texto, '', HOJAS_COMPRAS);
  };
  if (orden.estado === OC_CANCELADA || !orden.reqFolio) { huerfana(orden.reqFolio ? 'cancelada' : 'sin requisición'); return; }
  if (anuladoCentro_(orden.folio) || anuladoCentro_(orden.reqFolio)) { huerfana('anulada'); return; }
  const { hoja, req } = buscarReq_(libro, orden.reqFolio);
  if ([REQ_AUTORIZADA, REQ_PAGADA, REQ_EN_CAMINO, REQ_RECIBIDA].indexOf(req.estado) === -1 ||
      req.ocFolio.toUpperCase() !== orden.folio.toUpperCase()) {
    // H (incremento 5): de una ya cerrada todavía llegan fotos por archivar y problemas reportados después en el sitio
    if (req.estado === REQ_CERRADA && req.ocFolio.toUpperCase() === orden.folio.toUpperCase()) fotosYProblemasPortal_(libro, x, orden, req, res, '');
    res.ignoradas.push(ocFolio + ' (' + req.folio + ' ' + req.estado.toLowerCase() + ')');
    return;
  }
  const codigo = String(x.sitio || '').trim().toUpperCase();
  const s = det.find(y => y.codigo === codigo);
  const sitio = s ? s.nombre : (req.sitio || codigo);
  const recibio = String(x.recibio == null ? '' : x.recibio).trim().replace(/\s+/g, ' ').slice(0, 60) || 'centro de mando';
  const cuando = new Date(String(x.cuando || ''));
  const fecha = isNaN(cuando.getTime()) ? hoyIso_() : Utilities.formatDate(cuando, 'America/Mexico_City', 'yyyy-MM-dd');
  const lugar = (codigo || sitio) + ' por ' + recibio + ' en el centro de mando, ' + fechaCortaEs(fecha);

  // Lo recibido (acumulado por renglón de la orden) contra lo ya registrado en CAPRI: solo se copia la diferencia
  const movsOc = movimientosPorOc_(libro)[ocFolio] || [];
  const avance = avanceRecepcion(orden.renglones, movsOc, renglonesSinRecepcion(propuestaVigente_(req)));
  // H (incremento 5): una recepción registrada antes de que compras resolviera "Reponer" en ese renglón ya está contada (si el
  // centro de mando la vuelve a mandar, p. ej. porque se archivó su foto, no es material nuevo); tampoco su "completa"
  const anterior = recepcionAntesDeReponer_(movsOc, x.cuando, avisoPendiente_(libro, ocFolio, 'oc.devolucion'), reposicionesDeOrden_(libro, ocFolio));
  const nuevos = [];
  (Array.isArray(x.renglones) ? x.renglones : []).forEach(l => {
    const linea = avance.lineas.find(a => a.renglon === Number(l && l.n));
    if (!linea || anterior(linea.renglon)) return;
    const total = Math.min(Math.max(0, Number(l.recibido) || 0), linea.pedido - (linea.faltante || 0));
    const dif = Math.round((total - linea.recibido) * 10000) / 10000;
    if (dif > 1e-9) nuevos.push({ renglon: linea.renglon, clave: linea.clave, descripcion: linea.descripcion, unidad: linea.unidad, cantidad: dif,
      foto: fotoPortal(l.foto) }); // H: foto por archivar ("centro:<id>" hasta que llegue a Drive)
  });
  const t = textoCelda;
  let folioRec = '';
  if (nuevos.length) {
    const hM = hojaCompras_(libro, 'MovimientosInventario');
    const folio = folioRec = siguienteFolio_(PREFIJO_REC, hM, 'CONSECUTIVO_REC_');
    const ahora = ahoraTexto_();
    nuevos.forEach(n => escribe_(hM).appendRow(conFotoMov_([folio, textoFecha_(fecha), ahora, TIPO_ENTRADA_COMPRA, t(sitio), req.proyectoFolio, req.folio,
      orden.folio, n.renglon, t(n.clave), t(n.descripcion), t(n.unidad), n.cantidad, t(CORREO_CENTRO_MANDO),
      t(recibio + ' (centro de mando)'), t('Recibido en ' + lugar), '', '', 'Vigente', '', '', ''],
      n.foto && !n.foto.archivada ? { id: MARCA_FOTO_CENTRO + n.foto.id, url: '' } : n.foto && n.foto.url ? { id: '', url: n.foto.url } : null)));
  }
  fotosYProblemasPortal_(libro, x, orden, req, res, folioRec, movsOc); // H: fotos por archivar y problemas reportados en el sitio
  const lista = nuevos.map(n => n.cantidad + ' ' + n.unidad + ' ' + String(n.descripcion).slice(0, 40)).join('; ');
  const completaVieja = (Array.isArray(x.renglones) ? x.renglones : []).some(l => anterior(Number(l && l.n)));
  if (x.completa === true && req.estado !== REQ_RECIBIDA && !completaVieja) {
    const pagada = orden.estado === OC_PAGADA;
    // H: con una devolución abierta (p. ej. el sitio reportó un problema en esta misma recepción) no se cierra: queda Recibida
    const retenida = pagada ? devolucionAbiertaDe_(libro, req) : '';
    const nuevo = transicionReq(req.estado, retenida ? 'recibirRetenida' : pagada ? 'recibirPagada' : 'recibir');
    const nota = 'Recibido en ' + lugar;
    if (pagada && !retenida) escribe_(hO).getRange(orden.fila, COL_ESTADO_OC, 1, 3).setValues([[OC_RECIBIDA, textoFecha_(fecha), t(recibio + ' (centro de mando)')]]);
    else escribe_(hO).getRange(orden.fila, COL_ESTADO_OC + 1, 1, 2).setValues([[textoFecha_(fecha), t(recibio + ' (centro de mando)')]]);
    cambiarReq_(hoja, req, nuevo, { notasRecepcion: nota });
    eventoReq_(libro, req.folio, nuevo, nota + (retenida ? ' · ' + textoRetenida(retenida) : pagada ? '' : ' · falta el pago al proveedor'));
    bitacora_(libro, 'Recepción del centro de mando', req.proyectoFolio, req.folio + ' · ' + orden.folio + ' · ' + nota +
      (lista ? ' · ' + lista : '') + ' · ' + nuevo, '', HOJAS_COMPRAS);
    notificar_('req.recibida', { folio: req.folio, req: reqParaAviso_(req), nota: nota, sitio: req.sitio, centroMando: true });
    res.cerradas.push(req.folio);
  } else if (nuevos.length) {
    const nota = 'Recepción parcial en ' + lugar + ': ' + lista;
    cambiarReq_(hoja, req, req.estado, {});
    eventoReq_(libro, req.folio, req.estado, nota);
    bitacora_(libro, 'Recepción parcial del centro de mando', req.proyectoFolio, req.folio + ' · ' + orden.folio + ' · ' + nota, '', HOJAS_COMPRAS);
    res.parciales.push(req.folio);
  } else {
    res.ignoradas.push(ocFolio + ' (sin cambios)');
  }
}

/**
 * Activador de cada 15 minutos (instalarActivadorPortal): reintenta los avisos pendientes, trae las recepciones del centro de
 * mando y deja en caché las listas pesadas que la carga inicial solo manda si ya están (así la primera carga de la mañana es
 * rápida). Corre sin sesión; nunca lanza error. Lo puede correr Efrain desde el editor para probar.
 */
function cadaQuinceMinutos() {
  VENDEDOR_ = null; VERSIONES_ = null; SIN_CACHE_ = false; MEMO_ = {};
  const r = {};
  try { r.avisos = enviarPendientesPortal_(null); } catch (e) { r.avisos = { error: e.message }; }
  try { r.recepciones = traerRecepcionesPortal(); } catch (e) { r.recepciones = { error: e.message }; }
  try { r.cache = calentarCache_(); } catch (e) { r.cache = { error: e.message }; }
  try { if (MEMO_.correos && MEMO_.correos.length) enviarCorreosPendientes_(); } catch (e) { console.warn('Correos sin mandar: ' + e.message); }
  VENDEDOR_ = null; MEMO_ = {};
  console.log('cadaQuinceMinutos: ' + JSON.stringify(r).slice(0, 2000));
  return r;
}

/**
 * Llena el caché de lo que la carga inicial solo manda si ya está: listas de compras, operaciones y cobranza (como la primera
 * persona con ese rol) y, por persona con requisiciones, "mis requisiciones" y "mis artículos". Solo lee. Lo que ya está en
 * caché no se vuelve a armar; se detiene a los 2 minutos.
 */
function calentarCache_() {
  const inicio = Date.now(), hechos = [];
  const como = (correo, que, fn) => {
    if (!correo || Date.now() - inicio > 120000) return;
    const antes = VENDEDOR_;
    VENDEDOR_ = { email: correo, nombre: '', apellido: '' };
    try { fn(); hechos.push(que); } catch (e) { console.warn('Caché de ' + que + ': ' + e.message); } finally { VENDEDOR_ = antes; }
  };
  try { configLigera_(); proyectosCache_(); catalogoCache_(); clientesCache_(); contratosCache_(); hechos.push('fuentes'); }
  catch (e) { console.warn('Caché de fuentes: ' + e.message); }
  try { if (configPortal_().activo) { itemsInventario_(false, true); hechos.push('ítems'); } } catch (e) { console.warn('Ítems: ' + e.message); }
  const primero = rol => correosConRol_(rol)[0] || '';
  como(primero('ventas'), 'proyectos', () => listarProyectos('', false));
  como(primero('compras'), 'compras', () => { listarRequisiciones('', ''); cuentasPorPagar(); });
  como(primero('aprobaciones'), 'aprobaciones', () => listarOperaciones());
  como(primero('cobranza'), 'cobranza', () => resumenCobranzaGeneral());
  // Quien pide suele tener "Solo requisiciones" (incluye pedir): también se le calienta su lista
  correosConRol_('requisicion').concat(correosConRol_('solo_requisicion')).filter((c, i, a) => a.indexOf(c) === i)
    .forEach(c => como(c, 'requisiciones de ' + c, () => { misRequisiciones(); misArticulos(); }));
  return { hechos: hechos.length, segundos: Math.round((Date.now() - inicio) / 1000) };
}

/** Instala (una sola vez) el activador de 15 minutos; si hay repetidos, deja uno. Lo corre preparar() desde prepararCapri. */
function instalarActivadorPortal() {
  const propios = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'cadaQuinceMinutos');
  propios.slice(1).forEach(t => ScriptApp.deleteTrigger(t));
  if (!propios.length) ScriptApp.newTrigger('cadaQuinceMinutos').timeBased().everyMinutes(15).create();
  return { instalado: !propios.length, quitados: Math.max(0, propios.length - 1) };
}

/** Estado del enlace (compras o super admin): avisos pendientes y última consulta de recepciones. Solo lee. */
function estadoCentroMando() {
  if (!VENDEDOR_) throw errorSesion_('Inicia sesión con tu cuenta @' + DOMINIO_HELGEN + '.');
  if (!esCompras_() && !esSuperAdmin_()) throw errorPermiso_('No tienes permiso de compras.');
  return estadoCentroMando_();
}

function estadoCentroMando_() {
  const cfg = configPortal_(), p = propiedades_();
  const r = { activo: cfg.activo, servidor: cfg.url.replace(/^https?:\/\//i, ''), prueba: cfg.prueba,
    ligados: Object.keys(cfg.proyectos).map(f => ({ folio: f, proyecto: cfg.proyectos[f] })),
    pendientes: 0, masAntiguo: '', ultimoError: '', enviados: 0, rechazados: 0, ultimoRechazo: '',
    alerta: String(p.PORTAL_ALERTA || ''),
    ultimaConsulta: String(p.PORTAL_ULTIMA_CONSULTA || ''), ultimoOk: String(p.PORTAL_ULTIMO_OK || ''),
    errorConsulta: String(p.PORTAL_ERROR_CONSULTA || '') };
  const libro = libroComprasSiExiste_();
  if (libro && libro.getSheetByName('PortalPendientes')) {
    filasDeArea_(hojaCompras_(libro, 'PortalPendientes'), HOJAS_COMPRAS, 'PortalPendientes').forEach(x => {
      if (String(x[5]) === 'Pendiente') {
        r.pendientes++;
        if (!r.masAntiguo) r.masAntiguo = fechaTexto_(x[4]);
        if (x[3]) r.ultimoError = String(x[3]);
      } else if (String(x[5]) === 'Enviado') {
        r.enviados++;
      } else if (String(x[5]) === 'Rechazado') {
        r.rechazados++;
        r.ultimoRechazo = String(x[0]) + ': ' + String(x[3] || '');
      }
    });
  }
  try { r.activador = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'cadaQuinceMinutos'); } catch (e) { r.activador = null; }
  return r;
}

/** "Consultar ahora" (compras o super admin): reintenta los avisos y trae las recepciones sin esperar al activador. */
function consultarCentroMando() {
  if (!VENDEDOR_) throw errorSesion_('Inicia sesión con tu cuenta @' + DOMINIO_HELGEN + '.');
  if (!esCompras_() && !esSuperAdmin_()) throw errorPermiso_('No tienes permiso de compras.');
  const r = { avisos: null, recepciones: null };
  if (configPortal_().activo) {
    const a = enviarPendientesPortal_(null);
    r.avisos = { intentados: a.intentados, fallidos: a.fallidos };
    r.recepciones = traerRecepcionesPortal();
  }
  MEMO_.props = null; MEMO_.cfgPortal = null;
  r.estado = estadoCentroMando_();
  return r;
}

/**
 * Config → SITIOS con el formato de solo nombres ("Veracruz (ICAVE)") pasa a "VER | Veracruz (ICAVE)" si todos los nombres
 * tienen código conocido (las requisiciones siguen guardando el nombre). Lo corre preparar(); si no se puede, no toca nada.
 */
function migrarSitiosConCodigo_() {
  const hoja = db_().getSheetByName('Config');
  if (!hoja) return false;
  const v = hoja.getDataRange().getValues();
  const i = v.findIndex(r => String(r[0]).trim() === 'SITIOS');
  if (i < 1) return false;
  const nuevo = sitiosConCodigoTexto(v[i][1]);
  if (!nuevo) {
    if (String(v[i][1] || '').indexOf('|') === -1) console.log('Config → SITIOS: hay sitios sin código conocido; escríbelos como "VER | Veracruz (ICAVE)".');
    return false;
  }
  escribe_(hoja).getRange(i + 1, 2).setValue(nuevo);
  console.log('Config → SITIOS con código: ' + nuevo.replace(/\n/g, ' · '));
  return true;
}

/**
 * Prueba del enlace desde el editor (no cambia nada en CAPRI): lee los ítems, las recepciones de las últimas 24 h y manda un
 * aviso con "prueba": true de una orden inventada. Muestra en el registro lo que contestó (nunca el secreto).
 */
function probarCentroMando() {
  MEMO_ = {};
  const cfg = configPortal_();
  if (!cfg.activo) { console.log('Centro de mando apagado: faltan PORTAL_URL (https://…) y PORTAL_SECRETO en Script Properties.'); return; }
  const it = llamarPortal_(cfg, 'get', cfg.url + RUTA_PORTAL_ITEMS, '');
  console.log('Ítems: ' + (it.ok ? (it.datos.items || []).length + ' en la lista' : it.error));
  const rc = llamarPortal_(cfg, 'get', cfg.url + RUTA_PORTAL_RECEPCIONES + '?desde=' +
    encodeURIComponent(isoConZona_(new Date(Date.now() - 86400000))), '');
  console.log('Recepciones (últimas 24 h): ' + (rc.ok ? (rc.datos.recepciones || []).length : rc.error));
  const folio = Object.keys(cfg.proyectos)[0] || 'PRY-0000-0000';
  const cuerpo = cuerpoEventoPortal('oc.autorizada', 1, { cuando: isoConZona_(new Date()), quien: Session.getActiveUser().getEmail() || 'editor',
    prueba: true, proyectoFolio: folio, proyectoClave: cfg.proyectos[folio] || 'prueba', sitioCodigo: 'QRO', req: { folio: 'REQ-PRUEBA' },
    orden: { folio: 'OC-PRUEBA-' + Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyyMMddHHmmss'), proveedor: 'Proveedor de prueba',
      fechaEntrega: hoyIso_(), renglones: [{ descripcion: 'Renglón de prueba', unidad: 'PZA', cantidad: 1 }] } });
  const ev = enviarEventoPortal_(cfg, jsonAscii(cuerpo));
  console.log('Aviso de prueba ' + cuerpo.evento_id + ': ' + (ev.ok ? 'aceptado ' + JSON.stringify(ev.datos) : ev.error));
}

// -- Lógica pura del centro de mando (sin servicios de Google; se prueba en Node) --

/** Hex de bytes (Apps Script da enteros con signo, -128…127). */
function hexDeBytes(bytes) {
  return Array.prototype.map.call(bytes || [], b => ((Number(b) + 256) % 256).toString(16).padStart(2, '0')).join('');
}

/** JSON con todo lo que no es ASCII escapado (á): la firma y el envío no dependen de la codificación. */
function jsonAscii(obj) {
  return JSON.stringify(obj).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/**
 * Cuerpo de un aviso al centro de mando (contrato del 28/10/2026). d = {cuando, quien, prueba, orden (ordenDesdeFila_), req
 * (reqDesdeFila_), proyectoFolio, proyectoClave, sitioCodigo, sinRecibir (renglones de la orden que no se reciben en sitio)}.
 * Renglones con n = número de renglón de la orden (así regresan las recepciones) e item (o null). Nunca montos: ni costo,
 * importe, subtotal, IVA, total, tipo de cambio, moneda ni margen. maxDesc acorta descripciones (200 por omisión).
 */
function cuerpoEventoPortal(tipo, n, d, maxDesc) {
  if (TIPOS_EVENTO_PORTAL.indexOf(tipo) === -1) throw new Error('Tipo de aviso no válido: ' + tipo);
  const o = d.orden || {}, q = d.req || {}, sin = d.sinRecibir || [], corta = maxDesc || 200;
  // Incremento 5 (H): oc.devolucion lleva la devolución resuelta (renglón n de la orden, cantidad, tipo, resolución y nota limpia)
  const dv = tipo === 'oc.devolucion' ? d.devolucion || {} : null;
  return Object.assign({
    evento_id: o.folio + ':' + tipo + ':' + n, tipo: tipo, cuando: d.cuando, quien: d.quien || '', prueba: !!d.prueba,
    oc: {
      folio: o.folio, req_folio: q.folio || o.reqFolio || '', proyecto_folio: d.proyectoFolio || o.proyectoFolio || '',
      proyecto_clave: d.proyectoClave || '', sitio: d.sitioCodigo || '', proveedor: o.proveedor || '',
      fecha_entrega: o.fechaEstimada || o.fechaEntrega || '', paqueteria: o.paqueteria || '', guia: o.guia || '',
      solicitante: q.solicitanteEmail || '', autorizo: q.voboEmail || q.reviso || '',
      renglones: (o.renglones || []).map((r, i) => ({ n: i + 1, descripcion: String(r.descripcion || '').slice(0, corta),
        unidad: r.unidad || 'PZA', cantidad: Number(r.cantidad) || 0, item: r.item ? String(r.item) : null }))
        .filter(r => sin.indexOf(r.n) === -1),
    },
  }, dv ? { devolucion: { folio: String(dv.folio || ''), renglon: Number(dv.renglon) || 0, cantidad: Number(dv.cantidad) || 0,
    tipo: String(dv.tipo || ''), resolucion: String(dv.resolucion || ''), nota: limpiarTextoAviso(dv.nota, []),
    origen: dv.origen === 'capri' ? 'capri' : 'centro' } } : {}); // revisión 5b: sin origen = 'centro' (lo de antes)
}

/** Rutas de las llaves con montos en un objeto (un aviso al centro de mando nunca debe tener ninguna). */
function buscarMontos(obj, ruta) {
  const malas = /costo|importe|subtotal|^iva|_iva|total|cambio|moneda|margen|monto|precio/i;
  let lista = [];
  if (obj && typeof obj === 'object') {
    Object.keys(obj).forEach(k => {
      const r = (ruta ? ruta + '.' : '') + k;
      if (!Array.isArray(obj) && malas.test(k)) lista.push(r);
      lista = lista.concat(buscarMontos(obj[k], r));
    });
  }
  return lista;
}

/**
 * En camino. d = {paqueteria, guia, fechaEstimada, traeProveedor, recogido}; ctx = {hoy, nombre (de quien lo marca)}. Recogido:
 * "Recogido por <nombre>", sin guía, fecha hoy. Envío: paquetería (o "Lo trae el proveedor"), guía obligatoria salvo que lo
 * traiga el proveedor, fecha estimada obligatoria y no anterior a hoy.
 */
function normalizarEnCamino(d, ctx) {
  const x = d || {}, limpio = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
  if (x.recogido === true) {
    return { recogido: true, traeProveedor: false, paqueteria: 'Recogido por ' + (limpio(ctx.nombre).slice(0, 80) || 'quien recibe'),
      guia: '', fechaEstimada: ctx.hoy };
  }
  const trae = x.traeProveedor === true;
  const paqueteria = trae ? PAQ_PROVEEDOR : limpio(x.paqueteria);
  if (!paqueteria) throw new Error('Escribe la paquetería (o marca "Lo trae el proveedor").');
  if (paqueteria.length > 60) throw new Error('La paquetería debe tener máximo 60 caracteres.');
  const guia = limpio(x.guia);
  if (!trae && !guia) throw new Error('Escribe el número de guía (si lo trae el proveedor, márcalo).');
  if (guia.length > 60) throw new Error('El número de guía debe tener máximo 60 caracteres.');
  const fechaEstimada = validarFechaIso(x.fechaEstimada, null, 'La fecha estimada de llegada');
  if (ctx.hoy && fechaEstimada < ctx.hoy) throw new Error('La fecha estimada de llegada no puede ser anterior a hoy.');
  return { recogido: false, traeProveedor: trae, paqueteria: paqueteria, guia: guia, fechaEstimada: fechaEstimada };
}

const esRecogido = paqueteria => /^Recogido por /i.test(String(paqueteria || ''));

/** Texto del envío para el historial ("Enviado por DHL · guía 123 · llega aprox. el 02/11/2026"). */
function textoEnCamino(o) {
  const x = o || {};
  const dmy = iso => { const m = String(iso || '').match(/^(\d{4})-(\d\d)-(\d\d)$/); return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso || ''); };
  if (esRecogido(x.paqueteria)) return x.paqueteria + (x.fechaEstimada ? ' el ' + dmy(x.fechaEstimada) : '') + '; va al sitio';
  return (x.paqueteria === PAQ_PROVEEDOR ? PAQ_PROVEEDOR : 'Enviado por ' + x.paqueteria) + (x.guia ? ' · guía ' + x.guia : '') +
    (x.fechaEstimada ? ' · llega aprox. el ' + dmy(x.fechaEstimada) : '');
}

/** Código de ítem del centro de mando (opcional): sin espacios ni comillas, máximo 40. '' si viene vacío. */
function itemInventario(v, descripcion) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (!/^[^\s"'<>]{1,40}$/.test(s)) {
    throw new Error('El ítem "' + s.slice(0, 40) + '"' + (descripcion ? ' de "' + String(descripcion).slice(0, 40) + '"' : '') +
      ' no es un código del inventario (sin espacios, máximo 40).');
  }
  return s;
}

/** Ítems del centro de mando, limpios y sin repetir: [{codigo, descripcion, unidad, categoria}] (máximo 5000). */
function normalizarItemsPortal(lista) {
  const vistos = {};
  return (Array.isArray(lista) ? lista : []).filter(x => x && typeof x === 'object').map(x => ({
    codigo: String(x.codigo == null ? '' : x.codigo).trim(), descripcion: String(x.descripcion || '').trim().slice(0, 200),
    unidad: String(x.unidad || '').trim().toUpperCase().slice(0, 20), categoria: String(x.categoria || '').trim().slice(0, 60),
  })).filter(x => /^[^\s"'<>]{1,40}$/.test(x.codigo) && !vistos[x.codigo] && (vistos[x.codigo] = true)).slice(0, 5000);
}

/**
 * Artículos que más pide una persona: renglones [{descripcion, unidad, item, orden (más grande = más reciente)}] agrupados por
 * descripción (sin acentos ni mayúsculas); los más pedidos primero (empates: el más reciente). La descripción y la unidad son
 * las de la vez más reciente; item, el último que tuvo ítem.
 */
function articulosFrecuentes(renglones, max) {
  const grupos = {};
  (renglones || []).forEach(r => {
    const k = textoNormal(r.descripcion);
    if (!k) return;
    const g = grupos[k] || (grupos[k] = { descripcion: r.descripcion, unidad: r.unidad || '', item: '', veces: 0, ultimo: -1, conItem: -1 });
    g.veces++;
    if (r.orden >= g.ultimo) { g.ultimo = r.orden; g.descripcion = String(r.descripcion).trim(); g.unidad = r.unidad || g.unidad; }
    if (r.item && r.orden >= g.conItem) { g.conItem = r.orden; g.item = r.item; }
  });
  return Object.keys(grupos).map(k => grupos[k]).sort((a, b) => b.veces - a.veces || b.ultimo - a.ultimo).slice(0, max || 100)
    .map(g => ({ descripcion: g.descripcion, unidad: g.unidad, item: g.item, veces: g.veces }));
}

/** SITIOS de solo nombres → "VER | Veracruz (ICAVE)" por renglón; '' si ya tiene códigos o si algún nombre no tiene código. */
function sitiosConCodigoTexto(texto) {
  const t = String(texto == null ? '' : texto);
  if (!t.trim() || t.indexOf('|') !== -1) return '';
  const det = sitiosDetalleDeTexto(t);
  if (!det.length || det.some(s => !s.codigo)) return '';
  return det.map(s => s.codigo + ' | ' + s.nombre).join('\n');
}

/** "2026-10-30" → "30-oct-2026". */
function fechaCortaEs(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d\d)-(\d\d)/);
  if (!m) return String(iso || '');
  return m[3] + '-' + ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][Number(m[2]) - 1] + '-' + m[1];
}

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
  // Incremento 5 (H): devoluciones abiertas, para compras (y para el super admin que ve los de todos)
  if (roles.compras || esSuperAdmin_()) {
    try { o.devoluciones = devolucionesParaPendientes_(); } catch (e) { avisos.push('Devoluciones: ' + e.message); }
  }
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
  // facturasProveedor (P, incremento 6): el saldo de una orden con pagos parciales y su vencimiento dependen de sus facturas
  return enCache_('pendientes', ['requisiciones', 'oc', 'pagosProveedores', 'proyectos', 'anulaciones', 'facturasProveedor'], TTL_CACHE, () => {
    const libro = libroComprasSiExiste_(); // solo lee: el libro lo crea la primera requisición
    if (!libro) return [];
    const proyectos = mapaProyectos_(), abiertas = [];
    filasDeArea_(hojaReq_(libro), HOJAS_COMPRAS, 'Requisiciones').forEach((r, i) => {
      if (!String(r[0] || '').trim()) return;
      const q = reqDesdeFila_(r, i + 2);
      // Lo anulado no espera a nadie (aunque alguien le cambie el estado a mano en la hoja)
      if (ESTADOS_PENDIENTES.indexOf(q.estado) !== -1 && !esAnulado_(q.folio)) abiertas.push({ q: q, desde: marcaPendiente_(r[12], q.fecha) });
    });
    const ordenes = abiertas.some(x => x.q.ocFolio) ? ordenesPorFolio_(libro) : {};
    // P (incremento 6): saldo de las órdenes Emitidas con pagos (pagos, movimientos y facturas se leen una vez y solo si hace falta)
    const pagosOc = pagosProvPorOc_(libro);
    let movs = null, facturas = null;
    const saldo = oc => {
      if (!movs) { movs = movimientosPorOc_(libro); facturas = facturasDelLibro_(libro); }
      return saldoDeOrden_(libro, oc, movs[oc.folio.toUpperCase()] || [], facturas, pagosOc[oc.folio.toUpperCase()] || []);
    };
    return abiertas.map(x => {
      const q = x.q, p = proyectos[q.proyectoFolio.toUpperCase()], prop = propuestaVigente_(q);
      const oc = q.ocFolio ? ordenes[q.ocFolio.toUpperCase()] || null : null;
      const s = oc && oc.estado === OC_EMITIDA && (pagosOc[oc.folio.toUpperCase()] || []).some(y => y.estado === 'Vigente') ? saldo(oc) : null;
      return { folio: q.folio, fecha: q.fecha, desde: x.desde, proyectoFolio: q.proyectoFolio,
        proyectoVisible: p ? p.folioVisible : q.proyectoFolio, proyectoNombre: p ? p.nombre : '',
        solicitanteEmail: q.solicitanteEmail, solicitante: q.solicitante, estado: q.estado, motivo: q.motivo, sitio: q.sitio,
        prioridad: q.prioridad, fechaRequerida: q.fechaRequerida, recibeEmail: q.recibeEmail,
        elaboroEmail: prop ? String(prop.elaboroEmail || '').toLowerCase() : '',
        propuesta: prop ? { proveedor: prop.proveedor ? prop.proveedor.razonSocial : '', total: prop.total, moneda: prop.moneda } : null,
        // formaPago y diasCredito (F): con crédito del proveedor se recibe antes de pagar (recibeAntesDePagar_)
        oc: oc ? { folio: oc.folio, estado: oc.estado, proveedor: oc.proveedor, total: oc.total, moneda: oc.moneda,
          formaPago: oc.formaPago, diasCredito: oc.diasCredito, recibida: !!oc.fechaRecepcion,
          // P (incremento 6): pagos parciales (con montos: itemsPendientes solo los muestra a compras)
          pagoParcial: !!s && !s.completo, pagado: s ? s.pagado : 0, saldo: s ? s.saldo : null, siguiente: s ? s.siguiente : null } : null };
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
  // P (incremento 6): una fila "Saldo" de cuentas por pagar es lo que falta de una orden con pagos parciales (sin factura)
  const queVence = f => f.tipo === TIPO_CXP_SALDO ? 'saldo' : 'factura';
  const textoVence = f => Number(f.dias) > 0 ? queVence(f) + ' vencid' + (f.tipo === TIPO_CXP_SALDO ? 'o' : 'a') + ' hace ' + f.dias + ' día' + (f.dias === 1 ? '' : 's')
    : Number(f.dias) === 0 ? queVence(f) + ' vence hoy' : queVence(f) + ' vence el ' + fecha(f.fechaVencimiento);
  const debe = f => f.pendiente != null ? f.pendiente : f.total;

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
        const recibida = q.estado === REQ_RECIBIDA, encamino = q.estado === REQ_EN_CAMINO, parcial = !!oc.pagoParcial;
        const sig = parcial && oc.siguiente ? oc.siguiente : null;
        agregar(q, 'compras', { tipo: recibida ? 'pagarRecibida' : 'pagar',
          titulo: parcial ? (recibida ? 'Recibida, falta el saldo' : encamino ? 'En camino, falta el saldo' : 'Pagada parcial, falta el saldo')
            : recibida ? 'Recibida, falta pagar' : encamino ? 'En camino, falta pagar' : 'Orden por pagar',
          accion: recibida || encamino || parcial ? 'Pagar' : 'Enviar y pagar', destino: 'com',
          urgente: q.prioridad === 'Urgente' || fs.some(f => Number(f.dias) > 0),
          // F (incremento 5): la forma de pago (con crédito, se paga al vencer la factura); P (incremento 6): con pagos parciales, el
          // saldo y lo que sigue del plan
          detalle: [proyecto(q), oc.folio, oc.proveedor, parcial ? 'saldo ' + dinero(oc.saldo, oc.moneda) + ' de ' + dinero(oc.total, oc.moneda)
            : dinero(oc.total, oc.moneda), oc.formaPago, sig && sig.concepto !== 'Saldo' ? 'sigue: ' + sig.concepto + ' ' + dinero(sig.monto, oc.moneda) +
            (sig.vence ? ' (vence el ' + fecha(sig.vence) + ')' : '') : ''].concat(fs.map(textoVence)) }, 'Compras');
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
      // F (incremento 5): con crédito del proveedor también se confirma con la orden sin pagar (recibeAntesDePagar_)
      const credito = !flujo && !!q.oc && q.oc.estado === OC_EMITIDA && !q.oc.recibida && recibeAntesDePagar_(q.oc);
      const porRecibir = flujo || credito ? [REQ_AUTORIZADA, REQ_PAGADA, REQ_EN_CAMINO] : [REQ_PAGADA, REQ_EN_CAMINO];
      const mia = suya || recibe === yo;
      // Flujo de siempre: En camino sin pagar todavía no se puede confirmar (el servidor pide la orden pagada), salvo con crédito
      const sinPagar = !flujo && !credito && q.estado === REQ_EN_CAMINO && !(q.oc && q.oc.estado === OC_PAGADA);
      if (porRecibir.indexOf(q.estado) !== -1 && !sinPagar && (todos || mia)) {
        const enCentro = ligado(q.proyectoFolio);
        agregar(q, 'mias', { tipo: 'recibir', titulo: q.estado === REQ_EN_CAMINO ? 'En camino' : 'Por recibir',
          accion: enCentro ? 'Recibir en el centro de mando' : flujo ? 'Registrar lo que llegó' : 'Confirmar que llegó',
          destino: mia ? 'req' : 'com', detalle: [proyecto(q), recibe === yo && !suya ? 'la pidió ' + q.solicitante
            : recibe !== q.solicitanteEmail ? 'recibe ' + nombre(recibe) : ''] }, nombre(recibe));
      }
    }
  });

  // Devoluciones abiertas (incremento 5, módulo H): las resuelve compras; se abren desde su requisición
  if (roles.compras || todos) {
    (x.devoluciones || []).forEach(dv => agregar({ folio: dv.folio, sitio: dv.sitio, desde: dv.desde || dv.fecha, prioridad: '' }, 'compras', {
      tipo: 'devolucion', req: dv.reqFolio, titulo: 'Devolución por resolver', accion: 'Resolver', destino: 'com', urgente: false,
      detalle: [[dv.proyectoVisible, dv.proyectoNombre].filter(Boolean).join(' · '), dv.reqFolio, dv.tipo,
        dv.cantidad + ' ' + dv.unidad + ' ' + String(dv.descripcion || '').slice(0, 60)] }, 'Compras'));
  }

  // Facturas que no se anotaron en una orden por pagar (órdenes de antes, sin requisición abierta)
  Object.keys(facturas).forEach(k => facturas[k].forEach(f => {
    if (anotadas[f.folio]) return;
    const vencida = Number(f.dias) > 0;
    const saldo = f.tipo === TIPO_CXP_SALDO; // P (incremento 6): lo que falta de una orden con pagos parciales, sin factura
    items.push(Object.assign({ tipo: 'factura', seccion: 'compras', folio: f.folio, req: f.reqFolio || '',
      titulo: saldo ? (vencida ? 'Saldo vencido' : 'Saldo por vencer') : vencida ? 'Factura vencida' : 'Factura por vencer', sitio: '', desde: f.fechaVencimiento, dias: 0,
      vence: f.fechaVencimiento, diasVencida: Number(f.dias) || 0, prioridad: '', urgente: vencida,
      accion: f.reqFolio ? 'Abrir y pagar' : 'Ver cuentas por pagar', destino: f.reqFolio ? 'com' : 'cxp',
      detalle: [f.proveedor, f.serieFolio || '', dinero(debe(f), f.moneda), saldo ? '' : f.ocFolio, f.proyectoVisible].filter(Boolean).join(' · '),
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
// Anular no es borrar: las filas se quedan (los folios nunca se vuelven a usar), el estado pasa a 'Anulada' (los proyectos a
// 'Cancelado', lo único que admite su lista desplegable) y el registro sale de todas las listas y totales. Las cotizaciones no
// tienen estado: las esconde el registro de Anulaciones (libro de Administración), igual que a los proyectos. Cada anulación
// deja una fila por registro en Anulaciones (con la copia de cómo estaba), renglones en la Bitacora de su área y en la de
// Administración, y los archivos se quedan en Drive con "ANULADA — " al inicio del nombre. Se ofrece desde una sola página
// (Administración → Anular), no con un botón en cada pantalla. Restaurar no es parte de este incremento.

function modAnular_() {
  // Aquí solo listas literales: este módulo se arma al cargar el archivo, antes de las const de más abajo
  return { nombre: 'Anular',
    api: { previsualizarAnulacion: previsualizarAnulacion, anular: anular, listarAnulados: listarAnulados },
    // Una anulación puede tocar cualquier colección (es rara: se suben todas y los navegadores vuelven a pedir sus listas)
    cambios: { anular: ['anulaciones', 'proyectos', 'contratos', 'cotizaciones', 'requisiciones', 'oc', 'pagosCobranza',
      'pagosProveedores', 'facturasProveedor'] },
    solo: [], publicas: [],
    // La lista de anulados de Administración (solo super admin) se vuelve a mandar cuando alguien anula algo
    sincronizar(permisos, ctx, algo, r, errores) {
      if (permisos.superadmin && ctx.anulados && algo('anulaciones')) {
        r.anulados = intentar_(errores, 'Anulados', () => listarAnulados(ctx.anuladosBuscar || ''));
      }
    },
  };
}

const ESTADO_ANULADA = 'Anulada';
const PREFIJO_ARCHIVO_ANULADO = 'ANULADA — ', PREFIJO_CARPETA_ANULADA = 'ANULADO — ';
const MOTIVO_ANULAR_MIN = 10, MOTIVO_ANULAR_MAX = 500;
const TIPOS_ANULAR = { cotizacion: 'Cotización', proyecto: 'Proyecto', contrato: 'Contrato', pago: 'Pago de cliente',
  req: 'Requisición', oc: 'Orden de compra', pgp: 'Pago a proveedor', fpr: 'Factura de proveedor', rec: 'Recepción',
  dev: 'Devolución' }; // incremento 5: solo en cascada (de su orden o su requisición)
const PREFIJOS_ANULAR = { PRY: 'proyecto', PAG: 'pago', REQ: 'req', OC: 'oc', PGP: 'pgp', FPR: 'fpr', REC: 'rec' };

/**
 * (Lógica pura) Qué se quiere anular, a partir de lo que escribió el super admin: {clave (de TIPOS_ANULAR), folio}. El tipo
 * sale del prefijo: PRY, PAG, REQ, OC, PGP, FPR, REC; cualquier otro (HLG o el PREFIJO_FOLIO de Config) es una cotización.
 * Los contratos no tienen folio: "CONTRATO PRY-AAAA-NNNN" (también con la clave del proyecto). El proyecto con clave
 * (PRY-AAAA-NNNN-XXX) se guarda con su llave interna.
 */
function folioParaAnular(texto) {
  const s = String(texto == null ? '' : texto).trim().toUpperCase().replace(/\s+/g, ' ');
  const pry = /^PRY-\d{4}-\d{4,}(-[A-Z]{3})?$/;
  const c = s.match(/^CONTRATO(?: DE)?:? (\S+)$/);
  if (c) {
    if (!pry.test(c[1])) throw new Error('Escribe el contrato como «CONTRATO PRY-AAAA-NNNN».');
    return { clave: 'contrato', folio: 'CONTRATO ' + folioInterno(c[1]), proyectoFolio: folioInterno(c[1]) };
  }
  if (pry.test(s)) return { clave: 'proyecto', folio: folioInterno(s) };
  const m = s.match(/^([A-Z]{2,6})-\d{4}-\d{4,}$/);
  if (!m) {
    throw new Error('Escribe un folio (HLG-, PRY-, PAG-, REQ-, OC-, PGP-, FPR- o REC-AAAA-NNNN) o «CONTRATO PRY-AAAA-NNNN».');
  }
  return { clave: PREFIJOS_ANULAR[m[1]] || 'cotizacion', folio: s };
}

/** (Lógica pura) Id de un archivo de Drive a partir de su liga (…/file/d/<id>/view, …?id=<id>); '' si no se reconoce. */
function idDeUrlDrive(url) {
  const s = String(url || '');
  const m = s.match(/\/d\/([-\w]{3,})/) || s.match(/[?&]id=([-\w]{3,})/) || s.match(/\/file\/([-\w]{3,})/);
  return m ? m[1] : '';
}

/**
 * (Lógica pura) JSON para una celda (máximo ~50 000 caracteres en Sheets). Si no cabe, los textos largos se recortan con una
 * marca; si aun así no cabe, se guarda solo el principio con {recortado: true}.
 */
function jsonCelda(valor, max) {
  const limite = max || 45000;
  let s = JSON.stringify(valor === undefined ? null : valor);
  if (s.length <= limite) return s;
  s = JSON.stringify(valor, (k, v) => typeof v === 'string' && v.length > 1500 ? v.slice(0, 1500) + '…(recortado: ' + v.length + ' caracteres)' : v);
  if (s.length <= limite) return s;
  return JSON.stringify({ recortado: true, inicio: s.slice(0, limite - 200) });
}

/** ¿Una orden de compra cuenta (margen, costos, pendientes)? Ni las canceladas ni las anuladas. (Lógica pura) */
function ocVigente(o) {
  return !!o && o.estado !== OC_CANCELADA && o.estado !== ESTADO_ANULADA;
}

/** Folios anulados (en mayúsculas) según la pestaña Anulaciones; sin libro de Administración, ninguno. Los contratos no van
 * (no tienen folio: los esconde su estado). */
function anuladosDeHoja_() {
  const set = {};
  const libro = libroAdminSiExiste_();
  const hoja = libro && libro.getSheetByName('Anulaciones');
  if (!hoja) return set;
  filasDeArea_(hoja, HOJAS_ADMIN, 'Anulaciones').forEach(r => {
    const folio = String(r[3] || '').trim().toUpperCase();
    if (folio && String(r[2] || '') !== TIPOS_ANULAR.contrato) set[folio] = true;
  });
  return set;
}

/**
 * PARA TODOS LOS MÓDULOS: {FOLIO: true} de todo lo anulado (cotizaciones, proyectos, pagos, requisiciones, órdenes, pagos a
 * proveedor, facturas y recepciones; los contratos no: los esconde su estado). En caché por la versión de 'anulaciones' (solo
 * anular la cambia, y anular lee la hoja directo), así que también sirve durante una escritura; una vez por petición. Sin
 * libro de Administración: {}. Para una lista: const a = foliosAnulados_(); filas.filter(r => !a[folio.toUpperCase()]).
 */
function foliosAnulados_() {
  if (MEMO_.anulados) return MEMO_.anulados;
  if (!propiedades_()[AREA_ADMIN.propLibro]) return (MEMO_.anulados = {});
  const clave = claveCache_('anulados', ['anulaciones']);
  let v = leerCache_(clave);
  if (v === undefined) {
    v = anuladosDeHoja_();
    guardarCache_(clave, v, TTL_CACHE);
  }
  return (MEMO_.anulados = v);
}

/**
 * PARA TODOS LOS MÓDULOS: ¿está anulado este folio? (mayúsculas o minúsculas; un proyecto también con su clave,
 * PRY-AAAA-NNNN-XXX). Barato: usa foliosAnulados_(). Lo anulado no cuenta como pendiente para nadie. Las filas con columna de
 * estado además quedan en 'Anulada' (ESTADO_ANULADA): una lectura de hoja puede saltarlas por cualquiera de los dos.
 */
function esAnulado_(folio) {
  const f = String(folio == null ? '' : folio).trim().toUpperCase();
  if (!f) return false;
  const a = foliosAnulados_();
  return !!(a[f] || (/^PRY-\d{4}-\d{4,}-[A-Z]{3}$/.test(f) && a[folioInterno(f)]));
}

/** Proyectos que no están anulados (las listas de todas las pestañas parten de aquí; el mapa de folios visibles no). */
function proyectosVisibles_() {
  return proyectosCache_().filter(p => !esAnulado_(p.folio));
}

/** Filas de una pestaña si existe (anular solo lee: no crea pestañas). */
function filasSiHay_(libro, hojas, nombre) {
  const hoja = libro && libro.getSheetByName(nombre);
  return hoja ? filasDeArea_(hoja, hojas, nombre) : [];
}

/** Todo lo que una anulación puede tocar, leído de las hojas en este momento (también lo ya anulado o cancelado). */
function datosAnular_() {
  const may = s => String(s || '').trim().toUpperCase();
  const lc = libroCobranzaSiExiste_(), lo = libroComprasSiExiste_();
  const d = { libroCob: lc, libroCom: lo, anulados: anuladosDeHoja_(), cot: [], pry: [], contratos: [], esquemas: [], pagos: [],
    ordenes: [], reqs: [], pgp: [], fpr: [], movs: [], devs: [] };
  db_().getSheetByName('Cotizaciones').getDataRange().getValues().slice(1).forEach((r, i) => {
    if (!String(r[0] || '').trim()) return;
    d.cot.push({ folio: String(r[0]).trim(), fila: i + 2, valores: r, proyectoFolio: may(r[19]), cliente: String(r[2] || ''),
      empresa: String(r[3] || ''), total: Number(r[9]) || 0, moneda: String(r[20] || '') || 'MXN', pdfUrl: String(r[11] || ''),
      vendedorEmail: String(r[16] || r[10] || '') });
  });
  const hP = hojaProyectos_();
  const filasP = filasDatos_(hP, ENCABEZADOS_PROYECTOS.length);
  filasP.forEach((r, i) => {
    const p = proyectosDesdeFilas([r])[0];
    if (p) d.pry.push(Object.assign(p, { fila: i + 2, valores: r, vendedorEmail: String(r[8] || '') }));
  });
  filasSiHay_(lc, HOJAS_COBRANZA, 'Contratos').forEach((r, i) => {
    if (String(r[0] || '').trim()) d.contratos.push(Object.assign(contratoDesdeFila_(r, i + 2), { valores: r }));
  });
  filasSiHay_(lc, HOJAS_COBRANZA, 'Esquemas').forEach((r, i) => d.esquemas.push({ proyectoFolio: may(r[0]), fila: i + 2, valores: r }));
  filasSiHay_(lc, HOJAS_COBRANZA, 'Pagos').forEach((r, i) => {
    if (String(r[0] || '').trim()) {
      d.pagos.push(Object.assign(pagoDesdeFila_(r, i + 2), { valores: r, comprobanteId: String(r[14] || ''), registroEmail: String(r[16] || '') }));
    }
  });
  filasSiHay_(lo, HOJAS_COMPRAS, 'OrdenesCompra').forEach((r, i) => {
    if (String(r[0] || '').trim()) {
      d.ordenes.push(Object.assign(ordenDesdeFila_(r, i + 2), { valores: r, pdfId: String(r[23] || ''), elaboroEmail: String(r[25] || '') }));
    }
  });
  filasSiHay_(lo, HOJAS_COMPRAS, 'Requisiciones').forEach((r, i) => {
    if (String(r[0] || '').trim()) d.reqs.push(Object.assign(reqDesdeFila_(r, i + 2), { valores: r }));
  });
  filasSiHay_(lo, HOJAS_COMPRAS, 'PagosProveedores').forEach((r, i) => {
    if (String(r[0] || '').trim()) d.pgp.push(Object.assign(pagoProvDesdeFila_(r, i + 2), { valores: r, registroEmail: String(r[15] || '') }));
  });
  filasSiHay_(lo, HOJAS_COMPRAS, 'FacturasProveedor').forEach((r, i) => {
    if (String(r[0] || '').trim()) {
      d.fpr.push(Object.assign(facturaProvDesdeFila_(r, i + 2), { valores: r, xmlId: String(r[23] || ''), pdfId: String(r[25] || ''),
        registroEmail: String(r[27] || '') }));
    }
  });
  filasSiHay_(lo, HOJAS_COMPRAS, 'MovimientosInventario').forEach((r, i) => {
    if (String(r[0] || '').trim()) d.movs.push(Object.assign(movDesdeFila_(r, i + 2), { valores: r }));
  });
  // Incremento 5 (revisión): devoluciones DEV-… (se anulan con su orden o su requisición)
  filasSiHay_(lo, HOJAS_COMPRAS, 'Devoluciones').forEach((r, i) => {
    if (String(r[0] || '').trim()) d.devs.push(Object.assign(devDesdeFila_(r, i + 2), { valores: r }));
  });
  return d;
}

/**
 * Lo que arrastra anular `objetivo` ({clave, folio} de folioParaAnular), sin cambiar nada: {raiz, registros (lo que queda
 * Anulado, en orden), efectos (lo que cambia en registros que siguen: requisición que vuelve a cotizarse, orden que se
 * puede pagar otra vez…), avisos, archivos (ids a renombrar), carpeta (del proyecto), para (correos), ocsPortal}.
 * Cascada: proyecto → cotizaciones, contrato, pagos, requisiciones y órdenes; cotización aceptada → contrato → pagos;
 * requisición → sus órdenes; orden → sus pagos, facturas y recepciones.
 */
function planAnulacion_(d, objetivo) {
  const may = s => String(s || '').trim().toUpperCase();
  const T = TIPOS_ANULAR;
  const plan = { raiz: null, registros: [], efectos: [], avisos: [], archivos: [], carpeta: null, para: [], ocsPortal: [] };
  const ya = {};
  const enPlan = (clave, folio) => !!ya[clave + '|' + may(folio)];
  const agregar = r => {
    const k = r.clave + '|' + may(r.folio);
    if (ya[k]) return false;
    ya[k] = true;
    r.tipo = T[r.clave];
    plan.registros.push(r);
    if (!plan.raiz) plan.raiz = r;
    return true;
  };
  const correo = (...cs) => cs.forEach(c => {
    const x = String(c || '').trim().toLowerCase();
    if (/^[^@\s]+@[^@\s]+$/.test(x) && plan.para.indexOf(x) === -1) plan.para.push(x);
  });
  const archivo = id => { const x = String(id || '').trim(); if (x && plan.archivos.indexOf(x) === -1) plan.archivos.push(x); };
  const dinero = (n, m) => formatoMoneda(n) + ' ' + (m || 'MXN');
  const proyectoDe = f => d.pry.find(p => may(p.folio) === may(f)) || null;
  const fv = f => { const p = proyectoDe(f); return p ? p.folioVisible : String(f || ''); };
  const reqDe = f => (f ? d.reqs.find(r => may(r.folio) === may(f)) : null) || null;
  const ordenDe = f => (f ? d.ordenes.find(o => may(o.folio) === may(f)) : null) || null;
  const contratoActivo = pf => {
    let c = null;
    d.contratos.forEach(x => { if (may(x.proyectoFolio) === may(pf) && x.estado !== ESTADO_ANULADA) c = x; });
    return c;
  };
  const recepciones = () => {
    const g = {}, orden = [];
    d.movs.forEach(m => {
      if (esMovimientoDeDevolucion(m.tipo)) return; // van con su devolución (devolucion()), no como una recepción
      const k = may(m.folio);
      if (!g[k]) { g[k] = { folio: m.folio, ocFolio: m.ocFolio, reqFolio: m.reqFolio, proyectoFolio: m.proyectoFolio, sitio: m.sitio, filas: [] }; orden.push(g[k]); }
      g[k].filas.push(m);
    });
    return orden;
  };
  const recs = recepciones();
  const vivo = x => x.estado !== ESTADO_ANULADA;

  function proyecto(p) {
    if (!agregar({ clave: 'proyecto', folio: p.folio, x: p, proyectoFolio: p.folio, estado: p.estado,
      descripcion: [p.folioVisible, p.nombre, p.cliente].filter(Boolean).join(' · ') })) return;
    correo(p.vendedorEmail);
    if (p.carpetaId) plan.carpeta = { id: p.carpetaId };
    const f = may(p.folio);
    d.cot.filter(q => q.proyectoFolio === f && !d.anulados[may(q.folio)]).forEach(cotizacion);
    const c = contratoActivo(p.folio);
    if (c) contrato(c);
    d.pagos.filter(x => may(x.proyectoFolio) === f && vivo(x)).forEach(pagoCliente);
    d.reqs.filter(r => may(r.proyectoFolio) === f && vivo(r)).forEach(requisicion);
    d.ordenes.filter(o => may(o.proyectoFolio) === f && vivo(o)).forEach(orden);
  }
  function cotizacion(q) {
    const c = q.proyectoFolio ? contratoActivo(q.proyectoFolio) : null;
    const aceptada = !!c && may(c.cotizacion) === may(q.folio);
    const estado = !aceptada ? '' : c.estado === ESTADO_FIRMADO ? 'Aceptada (contrato firmado)' : 'Aceptada';
    if (!agregar({ clave: 'cotizacion', folio: q.folio, x: q, proyectoFolio: q.proyectoFolio, estado: estado,
      descripcion: [q.folio, [q.cliente, q.empresa].filter(Boolean).join(' — '), dinero(q.total, q.moneda),
        q.proyectoFolio ? fv(q.proyectoFolio) : 'Sin proyecto'].join(' · ') })) return;
    correo(q.vendedorEmail);
    archivo(idDeUrlDrive(q.pdfUrl));
    if (aceptada) contrato(c);
  }
  function contrato(c) {
    if (!agregar({ clave: 'contrato', folio: 'CONTRATO ' + may(c.proyectoFolio), x: c, proyectoFolio: c.proyectoFolio, estado: c.estado,
      descripcion: 'Contrato de ' + fv(c.proyectoFolio) + ' · ' + c.cotizacion + ' · ' + dinero(c.total, c.moneda) +
        (c.fechaFirma ? ' · firmado el ' + c.fechaFirma : ' · sin firmar') })) return;
    correo(c.aceptadaPor, c.firmadoPor);
    d.pagos.filter(x => may(x.proyectoFolio) === may(c.proyectoFolio) && vivo(x)).forEach(pagoCliente);
  }
  function pagoCliente(x) {
    if (!agregar({ clave: 'pago', folio: x.folio, x: x, proyectoFolio: x.proyectoFolio, estado: x.estado,
      descripcion: [x.folio, dinero(x.monto, x.monedaPago), x.fecha, x.metodo, fv(x.proyectoFolio)].filter(Boolean).join(' · ') })) return;
    correo(x.registroEmail);
    archivo(x.comprobanteId);
  }
  function requisicion(r) {
    if (!agregar({ clave: 'req', folio: r.folio, x: r, proyectoFolio: r.proyectoFolio, estado: r.estado,
      descripcion: [r.folio, r.solicitante, fv(r.proyectoFolio)].filter(Boolean).join(' · ') })) return;
    correo(r.solicitanteEmail, r.recibeEmail);
    archivo(r.cotizacionId);
    ((r.propuesta && r.propuesta.archivos) || []).forEach(a => archivo(a && a.id));
    d.ordenes.filter(o => may(o.reqFolio) === may(r.folio) && vivo(o)).forEach(orden);
    d.devs.filter(x => may(x.reqFolio) === may(r.folio) && vivo(x)).forEach(devolucion); // también las de órdenes anteriores
  }
  function orden(o) {
    if (!agregar({ clave: 'oc', folio: o.folio, x: o, proyectoFolio: o.proyectoFolio, estado: o.estado,
      descripcion: [o.folio, o.proveedor, dinero(o.total, o.moneda), o.reqFolio, fv(o.proyectoFolio)].filter(Boolean).join(' · ') })) return;
    correo(o.elaboroEmail);
    const r = reqDe(o.reqFolio);
    if (r) correo(r.solicitanteEmail, r.recibeEmail);
    archivo(o.pdfId);
    if (o.estado !== OC_CANCELADA) plan.ocsPortal.push(o.folio);
    const f = may(o.folio);
    d.pgp.filter(x => may(x.ocFolio) === f && vivo(x)).forEach(pagoProveedor);
    d.fpr.filter(x => may(x.ocFolio) === f && vivo(x)).forEach(factura);
    recs.filter(g => may(g.ocFolio) === f && g.filas.some(vivo)).forEach(recepcion);
    d.devs.filter(x => may(x.ocFolio) === f && vivo(x)).forEach(devolucion); // incremento 5: sus devoluciones (abiertas o no)
  }
  function pagoProveedor(x) {
    if (!agregar({ clave: 'pgp', folio: x.folio, x: x, proyectoFolio: x.proyectoFolio, estado: x.estado,
      descripcion: [x.folio, dinero(x.monto, x.monedaPago), x.fecha, x.ocFolio].filter(Boolean).join(' · ') })) return;
    correo(x.registroEmail);
    const r = reqDe(x.reqFolio);
    if (r) correo(r.solicitanteEmail, r.recibeEmail);
    archivo(x.comprobanteId);
  }
  function factura(x) {
    if (!agregar({ clave: 'fpr', folio: x.folio, x: x, proyectoFolio: x.proyectoFolio, estado: x.estado,
      descripcion: [x.folio, x.tipo === FPR_CFDI ? 'CFDI ' + (x.serieFolio || x.uuid) : x.serieFolio, x.nombreEmisor,
        dinero(x.total, x.moneda), x.ocFolio].filter(Boolean).join(' · ') })) return;
    correo(x.registroEmail);
    archivo(x.xmlId);
    archivo(x.pdfId);
  }
  function recepcion(g) {
    if (!enPlan('oc', g.ocFolio)) {
      // Sola (sin su orden): como cancelarRecepcion, no si sus renglones tienen una devolución abierta o resuelta con movimiento
      const dv = devolucionQueImpideCancelar(d.devs.filter(vivo), g.ocFolio,
        g.filas.filter(m => vivo(m) && m.tipo === TIPO_ENTRADA_COMPRA).map(m => m.renglon));
      if (dv) {
        throw new Error('El material de la recepción ' + g.folio + ' tiene la devolución ' + dv.folio + ' (' + String(dv.estado).toLowerCase() +
          '): no se puede anular la recepción sola (lo recibido del renglón quedaría negativo). Si toda la compra fue un error, anula la orden ' +
          g.ocFolio + ' (se anulan juntas).');
      }
    }
    const vivas = g.filas.filter(vivo);
    if (!agregar({ clave: 'rec', folio: g.folio, x: g, proyectoFolio: g.proyectoFolio,
      estado: vivas.some(m => m.estado === 'Vigente') ? 'Vigente' : (vivas[0] || g.filas[0]).estado,
      descripcion: [g.folio, vivas.length + ' renglón(es)', g.sitio, g.ocFolio].filter(Boolean).join(' · ') })) return;
    g.filas.forEach(m => { correo(m.correo); archivo(m.evidenciaId); });
    const r = reqDe(g.reqFolio);
    if (r) correo(r.solicitanteEmail, r.recibeEmail);
  }

  function devolucion(x) {
    // Incremento 5 (revisión): la devolución y sus movimientos (folio DEV-…); no cambia nada más (su orden o su requisición se anulan)
    if (!agregar({ clave: 'dev', folio: x.folio, x: Object.assign({}, x, { movs: d.movs.filter(m => may(m.folio) === may(x.folio) && vivo(m)) }),
      proyectoFolio: x.proyectoFolio, estado: x.estado, descripcion: [x.folio, x.tipo, x.cantidad + ' de ' + String(x.descripcion || '').slice(0, 60),
        x.resolucion, x.reqFolio, x.ocFolio].filter(Boolean).join(' · ') })) return;
    correo(x.reportoEmail);
  }

  // ---- Raíz ----
  const f = objetivo.folio;
  if (objetivo.clave === 'proyecto') {
    const p = proyectoDe(f);
    if (!p) throw new Error('No existe el proyecto ' + f + '.');
    if (d.anulados[may(p.folio)]) throw new Error('El proyecto ' + p.folioVisible + ' ya está anulado.');
    proyecto(p);
  } else if (objetivo.clave === 'contrato') {
    const p = proyectoDe(objetivo.proyectoFolio);
    if (!p) throw new Error('No existe el proyecto ' + objetivo.proyectoFolio + '.');
    if (d.anulados[may(p.folio)]) throw new Error('El proyecto ' + p.folioVisible + ' está anulado.');
    const c = contratoActivo(p.folio);
    if (!c) throw new Error('El proyecto ' + p.folioVisible + ' no tiene contrato (cotización aceptada) que anular.');
    contrato(c);
  } else if (objetivo.clave === 'cotizacion') {
    const q = d.cot.find(x => may(x.folio) === f);
    if (!q) throw new Error('No existe la cotización ' + f + '.');
    if (d.anulados[f]) throw new Error('La cotización ' + f + ' ya está anulada.');
    cotizacion(q);
  } else {
    const fuentes = { pago: [d.pagos, 'el pago', pagoCliente], req: [d.reqs, 'la requisición', requisicion], oc: [d.ordenes, 'la orden de compra', orden],
      pgp: [d.pgp, 'el pago a proveedor', pagoProveedor], fpr: [d.fpr, 'la factura de proveedor', factura], rec: [recs, 'la recepción', recepcion] };
    const [lista, que, fn] = fuentes[objetivo.clave];
    const x = lista.find(y => may(y.folio) === f);
    if (!x) throw new Error('No existe ' + que + ' ' + f + '.');
    const anulada = objetivo.clave === 'rec' ? !x.filas.some(vivo) : !vivo(x);
    if (anulada) throw new Error(que.charAt(0).toUpperCase() + que.slice(1) + ' ' + f + ' ya está ' + (/^la /.test(que) ? 'anulada' : 'anulado') + '.');
    fn(x);
  }

  // ---- Efectos en lo que sigue en pie ----
  plan.registros.forEach(r => {
    if (r.clave === 'oc') {
      // Su requisición (si sigue) vuelve a cotizarse (con operaciones: Aprobada, sin la propuesta) o a autorizarse (Solicitada)
      const o = r.x, q = reqDe(o.reqFolio);
      if (!q || !vivo(q) || enPlan('req', q.folio) || may(q.ocFolio) !== may(o.folio)) return;
      const conAprobacion = !!q.aprobacion, a = conAprobacion ? REQ_APROBADA : REQ_SOLICITADA;
      plan.efectos.push({ clave: 'reqSinOrden', req: q, orden: o, a: a, conAprobacion: conAprobacion,
        texto: q.folio + ' (' + q.estado + ') vuelve a ' + a + ' sin orden de compra' + (conAprobacion
          ? ': se retira la propuesta (conserva su número de versión) y compras la cotiza de nuevo.'
          : ': queda pendiente de autorizar de nuevo.') });
    } else if (r.clave === 'pgp' && r.x.estado === 'Vigente' && !enPlan('oc', r.x.ocFolio)) {
      // La orden se puede pagar otra vez (vuelve al estado que tenía antes del pago que la completó). P (incremento 6): con varios
      // pagos se recalcula sin este (y sin los demás de la cascada); si los que quedan la siguen cubriendo, nada cambia
      const o = ordenDe(r.x.ocFolio), q = reqDe(r.x.reqFolio);
      const quedan = d.pgp.filter(x => may(x.ocFolio) === may(r.x.ocFolio) && vivo(x) && !enPlan('pgp', x.folio));
      const s = o ? saldoOrdenCompra(Object.assign({}, o, { estado: OC_EMITIDA, facturas: d.fpr.filter(x => may(x.ocFolio) === may(o.folio) && vivo(x)) }),
        quedan, d.movs.filter(m => may(m.ocFolio) === may(o.folio) && vivo(m))) : null;
      const cubierta = !!s && s.completo && s.pagado > 0;
      const oc = !cubierta && o && vivo(o) && (o.estado === OC_PAGADA || o.estado === OC_RECIBIDA) ? OC_EMITIDA : '';
      const rq = !cubierta && q && vivo(q) ? (q.estado === REQ_PAGADA ? REQ_AUTORIZADA : q.estado === REQ_CERRADA ? REQ_RECIBIDA : '') : '';
      plan.efectos.push({ clave: 'pagoProveedor', pago: r.x, orden: oc ? o : null, oc: oc, req: rq ? q : null, a: rq,
        texto: [o ? o.folio + (oc ? ' pasa de ' + o.estado + ' a ' + oc : ' sigue ' + o.estado) : '',
          q ? q.folio + (rq ? ' pasa de ' + q.estado + ' a ' + rq : ' sigue ' + q.estado) : ''].filter(Boolean).join('; ') +
          (cubierta ? ': los demás pagos la siguen cubriendo.' : s && s.pagado > 0 ? ': la orden queda pagada en parte (saldo ' +
            formatoMoneda(s.saldo) + ' ' + (o.moneda || 'MXN') + ').' : ': la orden queda por pagar otra vez.') });
    } else if (r.clave === 'rec' && r.x.filas.some(m => m.estado === 'Vigente' && m.tipo === TIPO_ENTRADA_COMPRA) && !enPlan('oc', r.x.ocFolio)) {
      // (Solo entradas por compra: "Lo recogí" no cuenta como recepción y anularlo no regresa la requisición)
      // La orden espera el material otra vez (como cancelarRecepcion: una Recibida vuelve a En camino, Pagada o Autorizada según
      // su orden; una Cerrada vuelve a Pagada)
      const o = ordenDe(r.x.ocFolio), q = reqDe(r.x.reqFolio);
      const rq = q && vivo(q) ? (q.estado === REQ_RECIBIDA ? TRANSICIONES_REQ[accionCancelarRecepcion(o)].a
        : q.estado === REQ_CERRADA ? REQ_PAGADA : '') : '';
      const oc = rq === REQ_PAGADA && o && o.estado === OC_RECIBIDA ? OC_PAGADA : '';
      plan.efectos.push({ clave: 'recepcion', rec: r.x, orden: o && vivo(o) ? o : null, oc: oc, req: rq ? q : null, a: rq,
        texto: (q ? q.folio + (rq ? ' pasa de ' + q.estado + ' a ' + rq : ' sigue ' + q.estado) + '; ' : '') +
          (o ? o.folio + (oc ? ' pasa de ' + o.estado + ' a ' + oc : '') + ' espera otra vez el material de ' + r.x.folio + '.' : '') });
    } else if (r.clave === 'contrato' && !enPlan('proyecto', r.proyectoFolio)) {
      const c = r.x;
      plan.efectos.push({ clave: 'info', texto: fv(c.proyectoFolio) + ' queda sin cotización aceptada' +
        (enPlan('cotizacion', c.cotizacion) ? '.' : '; ' + c.cotizacion + ' sigue en el proyecto, sin aceptar.') +
        ' Se borra su esquema de pagos (queda copia en Anulaciones).' });
    } else if (r.clave === 'pago' && !enPlan('contrato', 'CONTRATO ' + may(r.proyectoFolio)) && !enPlan('proyecto', r.proyectoFolio)) {
      plan.efectos.push({ clave: 'info', texto: 'El cobrado, el saldo y el avance por etapa de ' + fv(r.proyectoFolio) + ' se recalculan sin ' + r.folio + '.' });
    } else if (r.clave === 'fpr' && !enPlan('oc', r.x.ocFolio)) {
      plan.efectos.push({ clave: 'info', texto: 'Lo facturado y las cuentas por pagar de ' + r.x.ocFolio + ' se recalculan sin ' + r.folio + '.' });
    }
  });
  if (plan.carpeta) {
    plan.efectos.push({ clave: 'info', texto: 'La carpeta del proyecto en Drive se renombra con «' + PREFIJO_CARPETA_ANULADA +
      '» al inicio (las carpetas privadas de Cobranza y Compras se quedan como están).' });
  }

  // ---- Avisos ----
  if (plan.registros.some(r => r.clave === 'oc')) {
    plan.avisos.push('El material que el centro de mando ya recibió se queda ahí: la anulación no lo regresa. Se le avisa que la orden ya no va.');
  }
  if (plan.registros.some(r => r.clave === 'pago' || r.clave === 'pgp')) {
    plan.avisos.push('Anular un pago no mueve dinero: solo corrige el registro.');
  }
  if (plan.archivos.length) {
    plan.avisos.push(plan.archivos.length + ' archivo(s) se quedan en Drive con «' + PREFIJO_ARCHIVO_ANULADO + '» al inicio del nombre.');
  }
  plan.avisos.push('Nada se borra y los folios no se vuelven a usar. Lo anulado sale de todas las listas y totales.');
  return plan;
}

/** Lo que ve el super admin antes de confirmar (y lo que devuelve anular: debe ser lo mismo). */
function resumenPlan_(plan) {
  return {
    folio: plan.raiz.folio, tipo: plan.raiz.tipo, descripcion: plan.raiz.descripcion,
    registros: plan.registros.map(r => ({ tipo: r.tipo, folio: r.folio, descripcion: r.descripcion, estado: r.estado || '' })),
    efectos: plan.efectos.map(e => e.texto), avisos: plan.avisos.slice(), archivos: plan.archivos.length,
    carpeta: plan.carpeta ? plan.carpeta.nombre || '' : '', para: plan.para.slice(),
  };
}

/** Nombre actual de la carpeta del proyecto (para mostrarla antes de renombrar); '' si no se encuentra. */
function nombreCarpetaPlan_(plan) {
  if (!plan.carpeta) return;
  try { plan.carpeta.nombre = DriveApp.getFolderById(plan.carpeta.id).getName(); } catch (e) { plan.carpeta.nombre = ''; }
}

/** Motivo de una anulación: obligatorio, de 10 a 500 caracteres. */
function motivoAnular_(motivo) {
  const m = String(motivo == null ? '' : motivo).trim().replace(/\s+/g, ' ');
  if (m.length < MOTIVO_ANULAR_MIN) throw new Error('Escribe el motivo de la anulación (al menos ' + MOTIVO_ANULAR_MIN + ' caracteres).');
  if (m.length > MOTIVO_ANULAR_MAX) throw new Error('El motivo debe tener máximo ' + MOTIVO_ANULAR_MAX + ' caracteres.');
  return m;
}

/** El registro de anulaciones vive en el libro de Administración: sin él no se puede esconder nada (no se crea a escondidas). */
function libroAnulaciones_() {
  const libro = libroAdminSiExiste_();
  if (!libro) throw new Error('Falta el libro de Administración: corre prepararCapri() desde el editor antes de anular.');
  return libro;
}

/**
 * Vista previa (solo super admin; no cambia nada): qué es el folio, todo lo que se anularía con él, qué cambia en lo que
 * sigue en pie, avisos, cuántos archivos se renombran y a quién se avisa.
 */
function previsualizarAnulacion(folio) {
  exigirSuperAdmin_();
  libroAnulaciones_();
  const plan = planAnulacion_(datosAnular_(), folioParaAnular(folio));
  nombreCarpetaPlan_(plan);
  return resumenPlan_(plan);
}

/**
 * Anula un registro y lo que depende de él (ver planAnulacion_). Solo super admin, motivo de 10 a 500 caracteres; candado e
 * idempotencia (ANU_<idSolicitud>, 6 h). Escribe 'Anulada' (proyectos: 'Cancelado'), aplica los efectos, renombra archivos y
 * la carpeta del proyecto, deja una fila por registro en Anulaciones y renglones en las Bitacoras, avisa a los involucrados
 * (notificar_ 'anulado') y al centro de mando por cada orden (avisarPortal_ 'oc.cancelada'). Devuelve lo mismo que la vista
 * previa más la lista de anulados.
 */
function anular(folio, motivo, idSolicitud) {
  exigirSuperAdmin_();
  const m = motivoAnular_(motivo);
  const objetivo = folioParaAnular(folio);
  const libroAdmin = libroAnulaciones_();
  const id = String(idSolicitud || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const claveCache = id ? 'ANU_' + id : '';
  recepcionesAntesDeCancelar_(null); // con el enlace encendido: lo recibido en el sitio entra antes de anular
  // conAvisoPortal_: el oc.cancelada de las órdenes anuladas sale al terminar (si falla, el activador lo reintenta)
  return conAvisoPortal_(conCandado_(() => {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) return Object.assign(JSON.parse(previo), { anulados: listarAnuladosDeHoja_('') });
    }
    const d = datosAnular_();
    const plan = planAnulacion_(d, objetivo);
    nombreCarpetaPlan_(plan);
    const fallas = aplicarAnulacion_(d, plan, m);
    registrarAnulacion_(libroAdmin, plan, m);
    SpreadsheetApp.flush();
    MEMO_.anulados = null;
    // Avisos (se mandan al terminar, fuera del candado): involucrados y centro de mando
    notificar_('anulado', { folio: plan.raiz.folio, tipo: plan.raiz.tipo, motivo: m,
      cascada: plan.registros.map(r => ({ tipo: r.tipo, folio: r.folio })), para: plan.para.slice() });
    plan.ocsPortal.forEach(oc => { try { avisarPortal_('oc.cancelada', oc); } catch (e) { fallas.push('Centro de mando (' + oc + '): ' + e.message); } });
    // En el caché de idempotencia va sin la lista de anulados (puede ser grande): al repetir se vuelve a leer
    const resultado = Object.assign(resumenPlan_(plan), { fallas: fallas });
    guardarIdempotencia_(cache, claveCache, resultado);
    return Object.assign({}, resultado, { anulados: listarAnuladosDeHoja_('') });
  }));
}

/** Escribe la anulación en las hojas, aplica los efectos y renombra en Drive. Devuelve lo que no se pudo renombrar. */
function aplicarAnulacion_(d, plan, m) {
  const ahora = ahoraTexto_(), yo = yo_(), t = textoCelda;
  const raiz = plan.raiz.folio;
  const nota = (r) => (r === plan.raiz ? '' : ' · en cascada de ' + raiz);
  const hojaCob = n => d.libroCob.getSheetByName(n), hojaCom = n => d.libroCom.getSheetByName(n);
  // Estado Anulada; quién, cuándo y por qué en las columnas de cancelación si están vacías (una cancelación previa se conserva)
  const marcar = (hoja, fila, colEstado, colCancelacion, yaCancelado) => {
    escribe_(hoja).getRange(fila, colEstado).setValue(ESTADO_ANULADA);
    if (!yaCancelado) escribe_(hoja).getRange(fila, colCancelacion, 1, 3).setValues([[t(yo), ahora, t('Anulada: ' + m)]]);
  };
  const esquemasBorrar = [];
  plan.registros.forEach(r => {
    const x = r.x;
    if (r.clave === 'proyecto') {
      escribe_(hojaProyectos_()).getRange(x.fila, COL_ESTADO_PROYECTO).setValue('Cancelado');
    } else if (r.clave === 'contrato') {
      const h = hojaCob('Contratos');
      escribe_(h).getRange(x.fila, 8).setValue(ESTADO_ANULADA);
      escribe_(h).getRange(x.fila, 13).setValue(ahora);
      r.esquema = d.esquemas.filter(e => e.proyectoFolio === String(x.proyectoFolio).toUpperCase());
      r.esquema.forEach(e => esquemasBorrar.push(e.fila));
      bitacora_(d.libroCob, 'Anular contrato', x.proyectoFolio, r.descripcion + nota(r), m);
    } else if (r.clave === 'pago') {
      marcar(hojaCob('Pagos'), x.fila, 19, 20, !!x.canceladoPor);
      bitacora_(d.libroCob, 'Anular pago', x.proyectoFolio, r.descripcion + nota(r), m);
    } else if (r.clave === 'req') {
      const h = hojaCom('Requisiciones');
      escribe_(h).getRange(x.fila, 6, 1, 2).setValues([[ESTADO_ANULADA, t('Anulada: ' + m)]]);
      escribe_(h).getRange(x.fila, 13).setValue(ahora);
      eventoReq_(d.libroCom, x.folio, ESTADO_ANULADA, 'Requisición anulada por administración.');
    } else if (r.clave === 'oc') {
      marcar(hojaCom('OrdenesCompra'), x.fila, COL_ESTADO_OC, COL_ESTADO_OC + 3, !!x.canceladoPor);
    } else if (r.clave === 'pgp') {
      marcar(hojaCom('PagosProveedores'), x.fila, 18, 19, !!x.canceladoPor);
      olvidarPagosProv_(); // P (incremento 6): lo que se lea después sale de la hoja
    } else if (r.clave === 'fpr') {
      marcar(hojaCom('FacturasProveedor'), x.fila, COL_ESTADO_FPR, COL_ESTADO_FPR + 1, !!x.canceladoPor);
    } else if (r.clave === 'rec') {
      const h = hojaCom('MovimientosInventario');
      x.filas.filter(f => f.estado !== ESTADO_ANULADA).forEach(f => marcar(h, f.fila, 19, 20, !!f.canceladoPor));
    } else if (r.clave === 'dev') {
      // Incremento 5 (revisión): la devolución queda Anulada (sale de listas y Pendientes) y sus movimientos también
      escribe_(hojaCom('Devoluciones')).getRange(x.fila, 15).setValue(ESTADO_ANULADA);
      const h = hojaCom('MovimientosInventario');
      (x.movs || []).forEach(f => marcar(h, f.fila, 19, 20, !!f.canceladoPor));
      MEMO_.devs = null;
    }
    if (['req', 'oc', 'pgp', 'fpr', 'rec', 'dev'].indexOf(r.clave) !== -1) {
      bitacora_(d.libroCom, 'Anular ' + r.tipo.toLowerCase(), r.proyectoFolio, r.descripcion + nota(r), m, HOJAS_COMPRAS);
    }
  });
  // Esquemas de pagos de los contratos anulados (de abajo hacia arriba para no mover las filas que faltan)
  if (esquemasBorrar.length) {
    const h = hojaCob('Esquemas');
    esquemasBorrar.sort((a, b) => b - a).forEach(fila => escribe_(h).deleteRow(fila));
  }

  // Efectos en lo que sigue en pie
  plan.efectos.forEach(e => {
    if (e.clave === 'reqSinOrden') {
      const hR = hojaCom('Requisiciones'), q = e.req;
      cambiarReq_(hR, q, e.a, { ocFolio: '', motivo: 'Se anuló la orden ' + e.orden.folio + ': ' + m, notasRecepcion: '' });
      if (e.conAprobacion) camposReq_(hR, q, { propuesta: propuestaRetirada_(q.propuesta), voboEmail: '', fechaVobo: '' });
      eventoReq_(d.libroCom, q.folio, e.a, e.conAprobacion ? 'Se anuló la orden de compra; compras la cotizará de nuevo.'
        : 'Se anuló la orden de compra; queda pendiente de autorizar de nuevo.');
      bitacora_(d.libroCom, 'Requisición a ' + e.a, q.proyectoFolio, q.folio + ' · se anuló ' + e.orden.folio, m, HOJAS_COMPRAS);
    } else if (e.clave === 'pagoProveedor') {
      if (e.orden) escribe_(hojaCom('OrdenesCompra')).getRange(e.orden.fila, COL_ESTADO_OC).setValue(e.oc);
      if (e.req) {
        cambiarReq_(hojaCom('Requisiciones'), e.req, e.a, {});
        eventoReq_(d.libroCom, e.req.folio, e.a, 'Se anuló el pago.');
      }
      bitacora_(d.libroCom, 'Orden por pagar otra vez', e.pago.proyectoFolio, e.texto, m, HOJAS_COMPRAS);
    } else if (e.clave === 'recepcion') {
      if (e.orden) {
        const hO = hojaCom('OrdenesCompra');
        if (e.oc) escribe_(hO).getRange(e.orden.fila, COL_ESTADO_OC).setValue(e.oc);
        escribe_(hO).getRange(e.orden.fila, COL_ESTADO_OC + 1, 1, 2).setValues([['', '']]);
      }
      if (e.req) cambiarReq_(hojaCom('Requisiciones'), e.req, e.a, { notasRecepcion: '' });
      if (e.rec.reqFolio) {
        eventoReq_(d.libroCom, e.rec.reqFolio, e.req ? e.a : (reqDeDatos_(d, e.rec.reqFolio) || {}).estado || '',
          'Se anuló la recepción ' + e.rec.folio + '; hay que registrarla de nuevo.');
      }
      bitacora_(d.libroCom, 'Recepción anulada: material pendiente otra vez', e.rec.proyectoFolio, e.texto, m, HOJAS_COMPRAS);
    }
  });

  // Drive: los archivos se quedan con "ANULADA — " al inicio; la carpeta principal del proyecto con "ANULADO — " (por id)
  const fallas = [];
  const renombrar = (item, prefijo) => { const n = item.getName(); if (n.indexOf(prefijo) !== 0) item.setName(prefijo + n); };
  plan.archivos.forEach(id => {
    try { renombrar(DriveApp.getFileById(id), PREFIJO_ARCHIVO_ANULADO); } catch (e) { fallas.push('Archivo ' + id + ': ' + e.message); }
  });
  if (plan.carpeta) {
    try { renombrar(DriveApp.getFolderById(plan.carpeta.id), PREFIJO_CARPETA_ANULADA); } catch (e) { fallas.push('Carpeta del proyecto: ' + e.message); }
  }
  return fallas;
}

function reqDeDatos_(d, folio) {
  return d.reqs.find(r => r.folio.toUpperCase() === String(folio || '').toUpperCase()) || null;
}

/** Una fila en Anulaciones por registro (la raíz con toda la cascada) y un renglón en la Bitacora de Administración. */
function registrarAnulacion_(libroAdmin, plan, m) {
  const hoja = hojaAdmin_(libroAdmin, 'Anulaciones');
  const ahora = ahoraTexto_(), yo = yo_(), t = textoCelda;
  const raiz = plan.raiz;
  plan.registros.forEach(r => {
    const cascada = r === raiz ? {
      raiz: true, descripcion: r.descripcion,
      registros: plan.registros.map(x => ({ tipo: x.tipo, folio: x.folio, descripcion: x.descripcion, estado: x.estado || '' })),
      efectos: plan.efectos.map(e => e.texto), archivos: plan.archivos.length,
      carpeta: plan.carpeta ? plan.carpeta.nombre || '' : '',
    } : { de: raiz.folio, tipoRaiz: raiz.tipo };
    const x = r.x;
    const antes = r.clave === 'rec' ? { hoja: 'MovimientosInventario', filas: x.filas.map(f => ({ fila: f.fila, valores: f.valores })) }
      : r.clave === 'dev' ? { hoja: 'Devoluciones', fila: x.fila, valores: x.valores,
        movimientos: (x.movs || []).map(f => ({ fila: f.fila, valores: f.valores })) }
      : { hoja: { proyecto: 'Proyectos', cotizacion: 'Cotizaciones', contrato: 'Contratos', pago: 'Pagos', req: 'Requisiciones',
        oc: 'OrdenesCompra', pgp: 'PagosProveedores', fpr: 'FacturasProveedor' }[r.clave], fila: x.fila, valores: x.valores };
    if (r.clave === 'contrato') antes.esquema = (r.esquema || []).map(e => e.valores);
    escribe_(hoja).appendRow([ahora, t(yo), r.tipo, t(r.folio), t(m), jsonCelda(cascada), jsonCelda(antes)]);
  });
  bitacoraAdmin_('Anular ' + raiz.tipo.toLowerCase(), raiz.folio, plan.registros.length + ' registro(s): ' +
    plan.registros.map(r => r.folio).join(', ').slice(0, 2000), m);
}

/**
 * Registros anulados para Administración (solo super admin; solo lectura): uno por anulación, con quién, cuándo, por qué,
 * lo que arrastró y sus efectos; los más recientes primero (máx. 200). filtro = texto (folio, tipo, motivo o correo).
 */
function listarAnulados(filtro) {
  exigirSuperAdmin_();
  if (!libroAdminSiExiste_()) return [];
  const texto = filtro && typeof filtro === 'object' ? filtro.buscar : filtro;
  return enCache_('anulados_lista_' + textoNormal(texto).slice(0, 80), ['anulaciones'], TTL_CACHE, () => listarAnuladosDeHoja_(texto));
}

function listarAnuladosDeHoja_(texto) {
  const libro = libroAdminSiExiste_();
  const hoja = libro && libro.getSheetByName('Anulaciones');
  if (!hoja) return [];
  const q = textoNormal(texto);
  const lista = [];
  filasDeArea_(hoja, HOJAS_ADMIN, 'Anulaciones').forEach(r => {
    const folio = String(r[3] || '').trim();
    if (!folio) return;
    const c = jsonCelda_(r[5]) || {};
    if (c.de) return; // parte de la cascada de otra anulación: va dentro de esa
    const correo = String(r[1] || '');
    const x = { fecha: fechaTexto_(r[0]), correo: correo, nombre: nombreDeCorreo_(correo), tipo: String(r[2] || ''), folio: folio,
      motivo: String(r[4] || ''), descripcion: c.descripcion || '',
      registros: Array.isArray(c.registros) ? c.registros : [{ tipo: String(r[2] || ''), folio: folio }],
      efectos: Array.isArray(c.efectos) ? c.efectos : [], archivos: Number(c.archivos) || 0, carpeta: c.carpeta || '' };
    if (q && !textoNormal([x.folio, x.tipo, x.motivo, x.correo, x.nombre, x.descripcion].concat(x.registros.map(y => y.folio)).join(' ')).includes(q)) return;
    lista.push(x);
  });
  return lista.reverse().slice(0, 200);
}

// ---- 6.F Proveedores y forma de pago (incremento 5) ----
// Pedido de Leo (29/10/2026). Contrato: docs/incremento-5.md §1–2; notas: docs/incremento-5-proveedores.md.
// - Forma de pago por orden de compra (FORMAS_PAGO_OC, columna forma_pago al final de OrdenesCompra). "Crédito del proveedor" =
//   se recibe el material antes de pagar, también en el flujo de siempre (sin aprobaciones): quien pidió confirma que llegó con la
//   orden Emitida (Autorizada / En camino → Recibida) y el pago la cierra. Una sola regla: recibeAntesDePagar_(orden).
// - Métodos del pago real (METODOS_PAGO, en 5): nunca se guarda un número de tarjeta (pareceNumeroTarjeta).
// - Ficha del proveedor (Proveedores, columnas I:Z): dirección, banco, CLABE (con dígito verificador), cuenta, titular, forma de
//   pago y días de crédito habituales, documentos (CSF, carátula bancaria, comprobante de domicilio) en
//   Compras/Proveedores/<RFC o SIN-RFC> — <razón social>/ (privados). Solo compras (y super admin) la ve y la edita.
// - Cambiar banco, CLABE o cuenta exige subir la carátula nueva en el mismo guardado; queda en la Bitácora de compras y avisa a
//   compras por correo (proveedor.banco: solo el banco y los últimos 4 dígitos; nunca el nombre del proveedor, regla 17).
// - Avisos (no bloquean): falta algún documento, comprobante de domicilio con más de 3 meses, CSF con más de 12 meses; la orden y
//   la propuesta los traen en avisoProveedor. Sin CSF y carátula no se registra un pago (registrarPagoProveedor), salvo un super
//   admin con motivo (excepcionSuperAdmin_).

function modProveedores_() {
  // Solo declaraciones de función y literales: las const de esta sección todavía no existen cuando se llama (arriba)
  return { nombre: 'Proveedores',
    api: { listarProveedores: listarProveedores, getProveedor: getProveedor, guardarProveedor: guardarProveedor,
      subirDocumentoProveedor: subirDocumentoProveedor },
    // Los proveedores viven en el libro de compras: su versión es la de las órdenes ('oc'), así la vista de una requisición abierta
    // (documentos y CLABE del pago) y la lista de proveedores se actualizan solas en los demás navegadores
    cambios: { guardarProveedor: ['oc'], subirDocumentoProveedor: ['oc'] },
    solo: [], publicas: [],
    sincronizar: function (permisos, ctx, algo, r, errores) {
      if (permisos.compras && ctx.comProveedores && algo('oc')) {
        r.comProveedores = intentar_(errores, 'Proveedores', () => listarProveedores(ctx.provFiltro || {}));
      }
    } };
}

/** Formas de pago de una orden de compra (contrato §1). */
const FORMAS_PAGO_OC = ['Transferencia', 'Crédito del proveedor', 'Tarjeta de crédito', 'Tarjeta de débito (en sitio)', 'Efectivo', 'Cheque'];
const FORMA_PAGO_CREDITO = 'Crédito del proveedor';
/** Documentos del proveedor: tipo → nombre (para avisos), corto (chips) y nombre del archivo. */
const DOCS_PROVEEDOR = {
  csf: { nombre: 'la constancia de situación fiscal', corto: 'CSF', archivo: 'CSF' },
  caratula: { nombre: 'la carátula bancaria', corto: 'Carátula', archivo: 'Carátula bancaria' },
  domicilio: { nombre: 'el comprobante de domicilio', corto: 'Domicilio', archivo: 'Comprobante de domicilio' },
};
const DOCS_PARA_PAGAR = ['csf', 'caratula'];

/**
 * Documentos que exige registrar un pago (pura): solo con Transferencia (se le paga a la CLABE de la carátula): la carátula y,
 * si el proveedor es nacional (RFC propio, no genérico), la CSF. Otros métodos: ninguno (queda el aviso).
 */
function documentosParaPagar(rfc, metodo) {
  if (textoNormal(metodo) !== textoNormal('Transferencia')) return [];
  const r = String(rfc || '').trim().toUpperCase();
  const nacional = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(r) && RFC_GENERICOS.indexOf(r) === -1;
  return nacional ? ['csf', 'caratula'] : ['caratula'];
}
const MESES_AVISO_DOMICILIO = 3, MESES_AVISO_CSF = 12;
const SUBCARPETA_PROVEEDORES = 'Proveedores';
/** Columna (desde 1) donde empieza la ficha en Proveedores (I: direccion … Z: actualizo). */
const COL_FICHA_PROVEEDOR = 9;

// Aviso por correo del cambio de banco (módulo de correos, 6.B): a compras, sin la CLABE completa
EVENTOS_CORREO.push('proveedor.banco');

// -- Forma de pago --

/**
 * ¿Se puede recibir el material antes de pagarlo todo? Sí, si la forma de pago de la orden es Crédito del proveedor (órdenes de
 * antes: si tienen días de crédito; formaPagoDeOrden) o, desde el incremento 6 (P, decisión 1), si la orden tiene algún pago Vigente
 * y todavía no está completa (anticipo o pago parcial: pagoParcialDe_). Es la única regla: la usan "Recibí el material"
 * (reqParaSolicitante_, cerrarRequisicion / cerrarReq_), la vista de compras (vistaRequisicion_) y Pendientes (itemsPendientes).
 * orden = {estado, formaPago, diasCredito, pagoParcial?} (la de ordenDesdeFila_ o la de basePendientes_). Sin orden: no.
 */
function recibeAntesDePagar_(orden) {
  return !!orden && (formaPagoDeOrden(orden.formaPago, orden.diasCredito) === FORMA_PAGO_CREDITO || pagoParcialDe_(orden));
}

/** Requisición con orden Emitida (sin pagar ni recibir) que se puede recibir ya: Autorizada o En camino con crédito del proveedor. */
function recibirSinPagarPosible_(req, orden) {
  return !!orden && orden.estado === OC_EMITIDA && !orden.fechaRecepcion &&
    (req.estado === REQ_AUTORIZADA || req.estado === REQ_EN_CAMINO) && recibeAntesDePagar_(orden);
}

/**
 * Cierre con crédito del proveedor (lo llama cerrarReq_: quien pidió con "Recibí el material" o compras en su lugar): si la orden
 * todavía no se paga y es a crédito, la requisición queda Recibida (transición recibir) y la orden sigue Emitida con su fecha de
 * recepción y quién recibió; registrarPagoProveedor la cierra después (pagarRecibida). Devuelve true si la recibió; false si no
 * aplica (cerrarReq_ sigue como siempre). Módulo H también toca cerrarRequisicion/cerrarReq_ (fotos y devoluciones).
 */
function recibirSinPagar_(libro, hoja, req, nota, motivo) {
  if (!req.ocFolio || (req.estado !== REQ_AUTORIZADA && req.estado !== REQ_EN_CAMINO)) return false;
  // Con aprobaciones se recibe renglón por renglón (registrarRecepcion), antes o después del pago: aquí no aplica
  if (flujoOperaciones_()) return false;
  const { hoja: hO, orden } = buscarOrden_(libro, req.ocFolio);
  if (!recibirSinPagarPosible_(req, orden)) return false;
  const nuevo = transicionReq(req.estado, 'recibir');
  const t = textoCelda;
  cambiarReq_(hoja, req, nuevo, { notasRecepcion: nota, motivo: motivo || req.motivo });
  escribe_(hO).getRange(orden.fila, COL_ESTADO_OC + 1, 1, 2).setValues([[textoFecha_(hoyIso_()), t(VENDEDOR_.email)]]); // sigue Emitida
  const parcial = formaPagoDeOrden(orden.formaPago, orden.diasCredito) !== FORMA_PAGO_CREDITO; // P (incremento 6): con un pago parcial
  eventoReq_(libro, req.folio, nuevo, [motivo ? 'Recibida por compras: ' + motivo : 'Material recibido',
    parcial ? 'falta el resto del pago al proveedor' : 'falta el pago al proveedor', nota].filter(Boolean).join(' · '));
  notificar_('req.recibida', { req: req.folio, nota: nota }); // correo a compras: "Falta registrar el pago" (6.B)
  bitacora_(libro, parcial ? 'Recibir antes de pagar todo (pago parcial)' : 'Recibir antes de pagar (crédito del proveedor)', req.proyectoFolio, req.folio + ' · ' + orden.folio +
    ' recibida el ' + hoyIso_() + ' sin pagar' + (nota ? ' · ' + nota : ''), motivo || '', HOJAS_COMPRAS);
  return true;
}

// -- Proveedores: lectura --

/** Proveedor del libro por id (RFC o SIN-RFC:…); null si no existe. */
function proveedorPorId_(libro, id) {
  const x = String(id || '').trim();
  return x ? proveedoresDelLibro_(libro).find(p => p.id === x) || null : null;
}

/** Proveedor de una orden: por su id; si no, por RFC; si no, por razón social (órdenes de antes o RFC corregido). */
function proveedorDeOrden_(libro, orden) {
  const lista = proveedoresDelLibro_(libro);
  const rfc = String(orden.rfc || '').toUpperCase(), razon = textoNormal(orden.proveedor);
  return lista.find(p => p.id === orden.proveedorId) || (rfc ? lista.find(p => p.rfc.toUpperCase() === rfc) : null) ||
    lista.find(p => textoNormal(p.razonSocial) === razon) || null;
}

/** Para el formulario de la orden o la propuesta: sin datos bancarios (con forma de pago habitual y lo que le falta). */
function proveedorParaOrden_(p) {
  const a = avisosProveedor(p, hoyIso_());
  return { id: p.id, razonSocial: p.razonSocial, rfc: p.rfc, contacto: p.contacto, correo: p.correo, telefono: p.telefono,
    actualizado: p.actualizado, diasCredito: p.diasCredito, formaPagoHabitual: formaPagoHabitualDe(p), etiqueta: p.etiqueta,
    activo: p.activo, faltan: a.faltan, faltanPorMetodo: a.faltanPorMetodo, avisos: a.avisos };
}

/**
 * Lo que necesita el pago de una orden (vista de compras): banco, CLABE, cuenta y titular de la ficha, ligas a la carátula y a la
 * CSF, lo que falta para pagar (CSF y carátula) y los avisos. Sin ficha: le falta todo.
 */
function proveedorDePago_(libro, orden) {
  const p = proveedorDeOrden_(libro, orden);
  if (!p) {
    const faltanPorMetodo = {};
    METODOS_PAGO.forEach(m => { faltanPorMetodo[m] = documentosParaPagar(orden.rfc, m); }); // sin ficha: no tiene ninguno
    return { id: orden.proveedorId, razonSocial: orden.proveedor, rfc: orden.rfc, registrado: false, faltanPago: DOCS_PARA_PAGAR.slice(),
      faltanPorMetodo: faltanPorMetodo,
      avisos: ['El proveedor no está en la lista de proveedores.'], banco: '', clabe: '', cuenta: '', titular: '' };
  }
  const a = avisosProveedor(Object.assign({}, p, { rfc: p.rfc || orden.rfc }), hoyIso_()); // el RFC de la orden si la ficha no lo trae
  return { id: p.id, razonSocial: p.razonSocial, rfc: p.rfc, registrado: true, banco: p.banco, clabe: p.clabe, cuenta: p.cuenta,
    titular: p.titular, caratulaUrl: p.caratulaUrl, caratulaFecha: p.caratulaFecha, csfUrl: p.csfUrl, faltanPago: a.faltanPago,
    faltanPorMetodo: a.faltanPorMetodo,
    avisos: a.avisos };
}

/**
 * Texto para avisoProveedor (orden o propuesta): lo que le falta o está viejo; '' si todo está bien. Un proveedor que todavía no
 * está en la lista (propuesta con un proveedor nuevo: se agrega al emitir la orden) no tiene ningún documento.
 */
function avisoDeProveedor_(libro, id, razonSocial) {
  try {
    const p = proveedorPorId_(libro, id) || { razonSocial: razonSocial || String(id || ''),
      rfc: /^SIN-RFC:/.test(String(id || '')) ? '' : String(id || '') }; // nuevo: el id es su RFC (si lo trae)
    return textoAvisoProveedor(p, avisosProveedor(p, hoyIso_()));
  } catch (e) {
    return '';
  }
}

/**
 * Bloqueo del pago (registrarPagoProveedor, dentro del candado y antes de escribir): sin CSF y carátula, error PERMISO con lo que
 * falta + textoExcepcion_(); un super admin con motivo ≥ 10 pasa y queda en la Bitacora de Administración.
 */
function exigirDocumentosParaPagar_(libro, orden, motivoExcepcion, metodo) {
  const p = proveedorDePago_(libro, orden);
  // Integración (29/10/2026): el bloqueo es para lo que se transfiere a una CLABE; con tarjeta (compra en tienda), efectivo o
  // cheque solo queda el aviso. Proveedor extranjero (sin RFC o RFC genérico): sin CSF, pero la transferencia sí pide carátula.
  // Lo mismo que ve la interfaz (proveedorDePago_.faltanPorMetodo, con documentosParaPagar)
  const faltan = (p.faltanPorMetodo || {})[metodo] || [];
  if (!faltan.length) return;
  const falta = listaConY(faltan.map(k => DOCS_PROVEEDOR[k].nombre));
  if (!excepcionPosible_(motivoExcepcion)) {
    throw errorPermiso_('Falta ' + falta + ' de ' + (orden.proveedor || 'el proveedor') + ': no se registra un pago por transferencia hasta ' +
      (faltan.length > 1 ? 'subirlas' : 'subirla') + ' en Compras → Proveedores (se le paga a la CLABE de la carátula; con tarjeta, ' +
      'efectivo o cheque sí se registra).' + textoExcepcion_());
  }
  excepcionSuperAdmin_('pagar a un proveedor sin documentos (falta ' + falta + ')', orden.folio, motivoExcepcion);
}

/**
 * Lista de proveedores (solo compras o super admin). filtro = {texto, estado: 'activos' (por omisión) | 'inactivos' | 'todos' |
 * 'faltan' (le falta algún documento) | 'avisos' (con algún aviso)} o el texto. Sin la CLABE completa (solo los últimos 4).
 * Devuelve {proveedores: [resumenProveedor], total, hoy, formasPago, documentos}.
 */
function listarProveedores(filtro) {
  exigirCompras_();
  const f = filtro && typeof filtro === 'object' ? filtro : { texto: filtro };
  const libro = libroComprasSiExiste_(); // solo lee: el libro lo crea la primera requisición
  const hoy = hoyIso_();
  const todos = libro ? proveedoresDelLibro_(libro).map(p => resumenProveedor(p, hoy)) : [];
  const lista = filtrarProveedores(todos, f);
  return { proveedores: lista.slice(0, 300), total: lista.length, hoy: hoy, formasPago: FORMAS_PAGO_OC,
    documentos: Object.keys(DOCS_PROVEEDOR).map(k => ({ tipo: k, corto: DOCS_PROVEEDOR[k].corto, archivo: DOCS_PROVEEDOR[k].archivo })) };
}

/** Ficha completa de un proveedor (solo compras o super admin): datos, CLABE, cuenta, documentos con ligas y avisos. */
function getProveedor(id) {
  exigirCompras_();
  const libro = libroComprasSiExiste_();
  const p = libro ? proveedorPorId_(libro, id) : null;
  if (!p) throw new Error('No existe el proveedor ' + String(id || '') + '.');
  return fichaParaVista(p, hoyIso_());
}

// -- Proveedores: escritura --

/**
 * Alta o edición de un proveedor (solo compras o super admin). p = {id (vacío = nuevo), razonSocial, rfc, contacto, correo,
 * telefono, direccion, banco, clabe, cuenta, titular, formaPagoHabitual, diasCredito, notas, activo, documentos: {csf | caratula
 * | domicilio: {nombre, datos (base64), fecha (del documento, AAAA-MM-DD)}}, idSolicitud}. La edición reemplaza la ficha (un
 * campo vacío se borra), a diferencia de la alta automática al emitir una orden (guardarProveedor_). El id se conserva; si llega
 * con RFC y era SIN-RFC, toma el RFC. Cambiar banco, CLABE o cuenta exige la carátula nueva en el mismo guardado: Bitácora y
 * correo proveedor.banco a compras. Devuelve {proveedor (la ficha, como getProveedor), nuevo}.
 */
function guardarProveedor(p) {
  exigirCompras_();
  const d0 = p || {};
  const ficha = normalizarFichaProveedor(d0);
  const docs = documentosDelEnvio_(d0.documentos); // se validan antes del candado
  const libro = libroCompras_();
  const idSolicitud = String(d0.idSolicitud || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const claveCache = idSolicitud ? 'PRV_' + idSolicitud : '';

  return conCandado_(() => {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) return JSON.parse(previo);
    }
    const hoja = hojaCompras_(libro, 'Proveedores');
    const lista = proveedoresDelLibro_(libro);
    const idOriginal = String(d0.id || '').trim();
    const actual = idOriginal ? lista.find(x => x.id === idOriginal) : null;
    if (idOriginal && !actual) throw new Error('No existe el proveedor ' + idOriginal + '.');
    const conRfc = proveedorId(ficha);
    const id = actual ? (conRfc.indexOf('SIN-RFC:') === 0 ? actual.id : conRfc) : conRfc;
    const otro = lista.find(x => x.id === id && x !== actual) ||
      (!actual && id.indexOf('SIN-RFC:') !== 0 ? lista.find(x => x.id === proveedorId({ razonSocial: ficha.razonSocial })) : null);
    if (otro) {
      throw new Error('Ya existe el proveedor "' + otro.razonSocial + '"' + (otro.rfc ? ' (RFC ' + otro.rfc + ')' : ' sin RFC') +
        ': ábrelo en la lista y edítalo.');
    }
    const antes = actual || { banco: '', clabe: '', cuenta: '' };
    const cambioBanco = cambioDeBanco(antes, ficha);
    const conDatosNuevos = !!(ficha.banco || ficha.clabe || ficha.cuenta);
    if (cambioBanco && conDatosNuevos && !docs.caratula) {
      throw new Error((actual && (actual.clabe || actual.cuenta || actual.banco) ? 'Cambiaste' : 'Capturaste') + ' el banco, la CLABE o ' +
        'la cuenta: sube la carátula bancaria (con su fecha) en el mismo guardado. Se le paga a la CLABE de la carátula.');
    }
    const ahora = ahoraTexto_();
    const subidos = subirDocumentos_(ficha.razonSocial, ficha.rfc, docs, actual);
    const guardada = Object.assign({}, actual || {}, ficha, subidos, { id: id, actualizo: yo_() });
    const t = textoCelda;
    const filaBase = [t(id), t(ficha.razonSocial), t(ficha.rfc), t(ficha.contacto), t(ficha.correo), t(ficha.telefono), ahora,
      ficha.diasCredito === '' ? '' : diasCreditoGuardados(ficha.diasCredito)];
    const fila = filaBase.concat(filaFichaProveedor_(guardada));
    if (actual) escribe_(hoja).getRange(actual.fila, 1, 1, fila.length).setValues([fila]);
    else escribe_(hoja).appendRow(fila);

    const cambios = camposCambiados(actual, ficha);
    bitacora_(libro, actual ? 'Editar proveedor' : 'Alta de proveedor', id, ficha.razonSocial +
      (actual && id !== actual.id ? ' · id ' + actual.id + ' → ' + id : '') + (cambios.length ? ' · ' + cambios.join(', ') : '') +
      Object.keys(subidos.nombres).map(k => ' · ' + DOCS_PROVEEDOR[k].corto + ' ' + subidos.nombres[k]).join(''), '', HOJAS_COMPRAS);
    if (cambioBanco) {
      bitacora_(libro, 'Cambiar datos bancarios de proveedor', id, ficha.razonSocial + ' · ' + textoCambioBanco(antes, ficha) +
        (subidos.nombres.caratula ? ' · carátula ' + subidos.nombres.caratula : ''), '', HOJAS_COMPRAS);
      // Correo a compras solo cuando había una cuenta antes (un cambio, no la primera captura): banco y últimos 4 dígitos
      if (actual && (actual.clabe || actual.cuenta || actual.banco)) {
        notificar_('proveedor.banco', { folio: id, banco: ficha.banco, bancoAntes: antes.banco, clabe4: ultimos4(ficha.clabe),
          clabeAntes4: ultimos4(antes.clabe), cuenta4: ultimos4(ficha.cuenta), cuentaAntes4: ultimos4(antes.cuenta) });
      }
    }
    SpreadsheetApp.flush();
    const nuevo = proveedorPorId_(libro, id);
    const resultado = { proveedor: fichaParaVista(nuevo || guardada, hoyIso_()), nuevo: !actual };
    guardarIdempotencia_(cache, claveCache, resultado);
    return resultado;
  });
}

/**
 * Sube un documento de un proveedor (solo compras o super admin): tipo = csf | caratula | domicilio; archivo = {nombre, datos
 * (base64), fecha (del documento)}. El anterior se conserva en Drive (el nuevo lleva "(2)", "(3)"…). Una carátula sola no cambia
 * los datos bancarios (eso se hace en guardarProveedor, con la carátula). Devuelve {proveedor (la ficha)}.
 */
function subirDocumentoProveedor(id, tipo, archivo) {
  exigirCompras_();
  const k = String(tipo || '').trim();
  if (!DOCS_PROVEEDOR[k]) throw new Error('Tipo de documento no válido: usa csf, caratula o domicilio.');
  const envio = {};
  envio[k] = archivo || {};
  const docs = documentosDelEnvio_(envio);
  if (!docs[k]) throw new Error('Adjunta ' + DOCS_PROVEEDOR[k].nombre + ' (PDF o imagen).');
  const libro = libroCompras_();
  return conCandado_(() => {
    const actual = proveedorPorId_(libro, id);
    if (!actual) throw new Error('No existe el proveedor ' + String(id || '') + '.');
    const subidos = subirDocumentos_(actual.razonSocial, actual.rfc, docs, actual);
    const guardada = Object.assign({}, actual, subidos, { actualizo: yo_() });
    const hoja = hojaCompras_(libro, 'Proveedores');
    escribe_(hoja).getRange(actual.fila, 7).setValue(ahoraTexto_());
    escribe_(hoja).getRange(actual.fila, COL_FICHA_PROVEEDOR, 1, HOJAS_COMPRAS.Proveedores.enc.length - COL_FICHA_PROVEEDOR + 1)
      .setValues([filaFichaProveedor_(guardada)]);
    bitacora_(libro, 'Subir documento de proveedor', actual.id, actual.razonSocial + ' · ' + DOCS_PROVEEDOR[k].corto + ' ' +
      subidos.nombres[k] + ' · fecha ' + docs[k].fecha, '', HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    return { proveedor: fichaParaVista(proveedorPorId_(libro, actual.id) || guardada, hoyIso_()) };
  });
}

/**
 * Documentos de un guardado: {tipo: {bytes, mime, ext, fecha}} (solo los que traen archivo). Cada uno es PDF o imagen (≤ 10 MB,
 * tipo por contenido) y lleva la fecha del documento (no futura).
 */
function documentosDelEnvio_(documentos) {
  const r = {};
  const d = documentos && typeof documentos === 'object' ? documentos : {};
  Object.keys(DOCS_PROVEEDOR).forEach(k => {
    const x = d[k];
    if (!x || !x.datos) return;
    const doc = DOCS_PROVEEDOR[k];
    const sujeto = doc.nombre.replace(/^(la|el) /, '');
    const bytes = bytesDeAdjunto_(x, 'No se pudo leer ' + doc.nombre + '. Vuelve a adjuntarla.');
    const tipo = validarArchivo(bytes, doc.nombre, sujeto.charAt(0).toUpperCase() + sujeto.slice(1));
    const fecha = validarFechaIso(x.fecha, hoyIso_(), 'La fecha de ' + doc.nombre);
    r[k] = { bytes: bytes, mime: tipo.mime, ext: tipo.ext, fecha: fecha };
  });
  return r;
}

/**
 * Guarda los documentos en Compras/Proveedores/<RFC o SIN-RFC> — <razón social>/ (privados de arriba abajo). Devuelve los campos
 * de la ficha que cambian ({csfId, csfUrl, csfFecha, …}) y nombres ({tipo: nombre del archivo}).
 */
function subirDocumentos_(razonSocial, rfc, docs, actual) {
  const r = { nombres: {} };
  const tipos = Object.keys(docs);
  if (!tipos.length) return r;
  const carpeta = carpetaProveedor_(rfc, razonSocial);
  tipos.forEach(k => {
    const x = docs[k];
    const nombre = nombreLibreEnCarpeta_(carpeta, n => nombreDocProveedor(rfc, k, x.ext, n), actual && actual[k + 'Id'] ? 2 : 1);
    const archivo = privado_(carpeta.createFile(Utilities.newBlob(x.bytes, x.mime, nombre)));
    r[k + 'Id'] = archivo.getId(); r[k + 'Url'] = archivo.getUrl(); r[k + 'Fecha'] = x.fecha;
    r.nombres[k] = nombre;
  });
  return r;
}

/** Compras/Proveedores/<RFC o SIN-RFC> — <razón social>/ (se busca por nombre; restringidas de arriba abajo). */
function carpetaProveedor_(rfc, razonSocial) {
  return privado_(subcarpeta_(privado_(subcarpeta_(carpetaCompras_(), SUBCARPETA_PROVEEDORES)), nombreCarpetaProveedor(rfc, razonSocial)));
}

/** Primer nombre libre (desde n) en la carpeta: el documento anterior se conserva y el nuevo lleva "(2)", "(3)"… */
function nombreLibreEnCarpeta_(carpeta, nombreDe, desde) {
  let n = desde || 1;
  if (typeof carpeta.getFilesByName !== 'function') return nombreDe(n);
  for (; n < 100; n++) {
    const it = carpeta.getFilesByName(nombreDe(n));
    let ocupado = false;
    while (it.hasNext()) { if (!it.next().isTrashed()) { ocupado = true; break; } }
    if (!ocupado) return nombreDe(n);
  }
  return nombreDe(n);
}

/** Columnas I:Z de la ficha (CLABE y cuenta con apóstrofo: Sheets las convertiría en número y perdería dígitos). */
function filaFichaProveedor_(f) {
  const t = textoCelda, txt = v => v ? "'" + v : '';
  return [t(f.direccion || ''), t(f.banco || ''), txt(f.clabe), txt(f.cuenta), t(f.titular || ''), f.formaPagoHabitual || '',
    f.csfId || '', f.csfUrl || '', textoFecha_(f.csfFecha), f.caratulaId || '', f.caratulaUrl || '', textoFecha_(f.caratulaFecha),
    f.domicilioId || '', f.domicilioUrl || '', textoFecha_(f.domicilioFecha), t(f.notas || ''), f.activo === false ? 'No' : 'Sí',
    t(f.actualizo || '')];
}

// -- Lógica pura de 6.F (sin servicios de Google; se prueba en Node) --

/**
 * Forma de pago de una orden: la guardada (forma_pago) si es una de FORMAS_PAGO_OC; en órdenes de antes (vacía), Transferencia
 * si son de contado (dias_credito = 0) y Crédito del proveedor si tienen días de crédito (contrato §1).
 */
function formaPagoDeOrden(guardada, diasCredito) {
  const t = textoNormal(guardada);
  const f = t ? FORMAS_PAGO_OC.find(x => textoNormal(x) === t) : '';
  if (f) return f;
  return Number(diasCredito) > 0 ? FORMA_PAGO_CREDITO : 'Transferencia';
}

/** Forma de pago capturada en una orden o propuesta nueva: obligatoria y de FORMAS_PAGO_OC; Crédito del proveedor exige días ≥ 1. */
function normalizarFormaPago(v, diasCredito) {
  const t = textoNormal(v);
  if (!t) throw new Error('Elige la forma de pago de la orden (' + FORMAS_PAGO_OC.join(', ') + ').');
  const f = FORMAS_PAGO_OC.find(x => textoNormal(x) === t);
  if (!f) throw new Error('Forma de pago no válida: usa ' + FORMAS_PAGO_OC.join(', ') + '.');
  if (f === FORMA_PAGO_CREDITO && !(Number(diasCredito) >= 1)) {
    throw new Error('Con crédito del proveedor captura los días de crédito (1 o más): con 0 es de contado.');
  }
  return f;
}

/** Forma de pago habitual de un proveedor: la de su ficha o, si no tiene, la que dicen sus días de crédito habituales. */
function formaPagoHabitualDe(p) {
  const x = p || {};
  const f = FORMAS_PAGO_OC.find(y => textoNormal(y) === textoNormal(x.formaPagoHabitual));
  if (f) return f;
  return x.diasCredito === '' || x.diasCredito == null ? '' : formaPagoDeOrden('', x.diasCredito);
}

/** Prueba de Luhn (la cumplen todos los números de tarjeta). d = solo dígitos. */
function pasaLuhn(d) {
  let s = 0, doble = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (doble) { n *= 2; if (n > 9) n -= 9; }
    s += n;
    doble = !doble;
  }
  return d.length > 0 && s % 10 === 0;
}

/**
 * Agrupaciones con que se escribe una tarjeta (largo de cada grupo): 4-4-4-(1…4), 4-4-4-4-(1…3) (hasta 19 dígitos), American
 * Express 4-6-5 y Diners 4-6-4.
 */
const AGRUPACIONES_TARJETA = ['4,4,4,1', '4,4,4,2', '4,4,4,3', '4,4,4,4', '4,4,4,4,1', '4,4,4,4,2', '4,4,4,4,3', '4,6,5', '4,6,4'];

/**
 * ¿El texto trae lo que parece un número de tarjeta? Una sola regla para todo método (pago a proveedor, cobranza y la cuenta de la
 * ficha del proveedor; revisión del 29/10/2026). Candidatos: cada corrida de dígitos sin cortes y cada tramo de grupos separados
 * por espacios, puntos, guiones, diagonales o guiones bajos (uno o varios) cuyos largos tienen exactamente la forma de una tarjeta
 * (AGRUPACIONES_TARJETA); nunca se juntan grupos de otra forma ("29-10-2026 1234567" y "30/10/2026" quedan separados). Parece tarjeta si un candidato tiene de 13 a 19 dígitos, empieza con 3, 4, 5 o 6 (American Express,
 * Visa, Mastercard, Discover/Carnet) y pasa la prueba de Luhn; una CLABE válida de 18 dígitos (STP empieza con 646) nunca es
 * tarjeta, y una corrida de 20 dígitos o más (clave de rastreo, ticket) tampoco. Nunca se pide ni se guarda un número de tarjeta
 * (contrato §1). El segundo parámetro (método) ya no cuenta: se acepta por compatibilidad.
 */
function pareceNumeroTarjeta(texto) {
  const s = String(texto == null ? '' : texto);
  const candidatos = (s.match(/\d+/g) || []).slice();
  (s.match(/\d+(?:[ .\-\/_]+\d+)+/g) || []).forEach(cadena => {
    const g = cadena.split(/[ .\-\/_]+/);
    for (let i = 0; i < g.length; i++) {
      for (let n = 3; n <= 5 && i + n <= g.length; n++) {
        const tramo = g.slice(i, i + n);
        if (AGRUPACIONES_TARJETA.indexOf(tramo.map(x => x.length).join(',')) !== -1) candidatos.push(tramo.join(''));
      }
    }
  });
  return candidatos.some(d => d.length >= 13 && d.length <= 19 && /^[3-6]/.test(d) && pasaLuhn(d) && !(d.length === 18 && esClabe(d)));
}

/** ¿18 dígitos con el dígito verificador de una CLABE? (Lógica pura; validarClabe sin lanzar error.) */
function esClabe(d) {
  try { return /^\d{18}$/.test(String(d)) && validarClabe(d) === String(d); } catch (e) { return false; }
}

/**
 * CLABE interbancaria: 18 dígitos y dígito verificador (Banxico: pesos 3, 7, 1 sobre los primeros 17, cada producto módulo 10;
 * verificador = (10 − suma mod 10) mod 10). Vacía = sin CLABE (''). Lanza error si no es válida.
 */
function validarClabe(v) {
  const c = String(v == null ? '' : v).replace(/[\s-]/g, '');
  if (!c) return '';
  if (!/^\d{18}$/.test(c)) throw new Error('La CLABE debe tener 18 dígitos.');
  const pesos = [3, 7, 1];
  let suma = 0;
  for (let i = 0; i < 17; i++) suma += (Number(c[i]) * pesos[i % 3]) % 10;
  if ((10 - (suma % 10)) % 10 !== Number(c[17])) {
    throw new Error('La CLABE no es válida (no coincide su dígito verificador): revísala contra la carátula bancaria.');
  }
  return c;
}

/** Últimos 4 caracteres (para avisos y listas: nunca la CLABE completa); '' si no hay. */
function ultimos4(v) {
  const s = String(v == null ? '' : v).replace(/[\s-]/g, '');
  return s ? s.slice(-4) : '';
}

/** "a", "a y b", "a, b y c". */
function listaConY(l) {
  const x = (l || []).filter(Boolean);
  return x.length < 2 ? (x[0] || '') : x.slice(0, -1).join(', ') + ' y ' + x[x.length - 1];
}

/** "AAAA-MM-DD" + n meses (el día se ajusta al último del mes: 31/01 + 1 = 28 o 29/02). */
function sumarMeses(iso, n) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const total = (+m[2] - 1) + Number(n || 0), anio = +m[1] + Math.floor(total / 12), mes = ((total % 12) + 12) % 12;
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(anio, mes, Math.min(+m[3], ultimo))).toISOString().slice(0, 10);
}

/** Fecha de un documento leída de la hoja ("AAAA-MM-DD" con apóstrofo, o un Date si alguien la escribió a mano). */
function fechaDocDeCelda(v) {
  if (v instanceof Date) {
    return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  }
  return String(v == null ? '' : v).trim().replace(/^'/, '');
}

/** Ficha de una fila de Proveedores (columnas I:Z; vacías en proveedores de antes). activo: vacío = sí. */
function fichaDeFila(r) {
  const s = i => String(r[i] == null ? '' : r[i]).trim().replace(/^'/, '');
  return { direccion: s(8), banco: s(9), clabe: s(10), cuenta: s(11), titular: s(12), formaPagoHabitual: s(13),
    csfId: s(14), csfUrl: s(15), csfFecha: fechaDocDeCelda(r[16]), caratulaId: s(17), caratulaUrl: s(18), caratulaFecha: fechaDocDeCelda(r[19]),
    domicilioId: s(20), domicilioUrl: s(21), domicilioFecha: fechaDocDeCelda(r[22]), notas: s(23),
    activo: !/^(no|false|0|inactivo)$/i.test(s(24)), actualizo: s(25) };
}

/**
 * Valida y limpia la ficha de un proveedor (guardarProveedor): los datos de siempre (normalizarProveedor) + dirección, banco,
 * CLABE (validarClabe), cuenta (números y letras: también el IBAN de un proveedor extranjero; nunca un número de tarjeta),
 * titular, forma de pago y días de crédito habituales (crédito exige días ≥ 1), notas y activo.
 */
function normalizarFichaProveedor(p) {
  const d = p || {};
  const base = normalizarProveedor(d);
  const limpio = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
  const direccion = limpio(d.direccion);
  if (direccion.length > 300) throw new Error('La dirección debe tener máximo 300 caracteres.');
  const banco = limpio(d.banco);
  if (banco.length > 60) throw new Error('El nombre del banco debe tener máximo 60 caracteres.');
  const clabe = validarClabe(d.clabe);
  const cuenta = String(d.cuenta == null ? '' : d.cuenta).replace(/[\s-]/g, '').toUpperCase();
  if (cuenta && !/^[A-Z0-9]{4,34}$/.test(cuenta)) {
    throw new Error('La cuenta solo lleva números y letras (de 4 a 34; de un proveedor extranjero, su IBAN o número de cuenta).');
  }
  if (cuenta && pareceNumeroTarjeta(cuenta)) {
    throw new Error('La cuenta parece un número de tarjeta: no lo guardes. Usa la CLABE (18 dígitos) o el número de cuenta de la carátula.');
  }
  const titular = limpio(d.titular);
  if (titular.length > 150) throw new Error('El titular debe tener máximo 150 caracteres.');
  if ((clabe || cuenta) && !banco) throw new Error('Escribe el banco de la CLABE o la cuenta.');
  const diasTxt = String(d.diasCredito == null ? '' : d.diasCredito).trim();
  const diasCredito = diasTxt === '' ? '' : normalizarDiasCredito(diasTxt);
  let formaPagoHabitual = '';
  if (limpio(d.formaPagoHabitual)) {
    formaPagoHabitual = FORMAS_PAGO_OC.find(x => textoNormal(x) === textoNormal(d.formaPagoHabitual)) || '';
    if (!formaPagoHabitual) throw new Error('Forma de pago habitual no válida: usa ' + FORMAS_PAGO_OC.join(', ') + '.');
    if (formaPagoHabitual === FORMA_PAGO_CREDITO && !(Number(diasCredito) >= 1)) {
      throw new Error('Con crédito del proveedor captura sus días de crédito habituales (1 o más).');
    }
  }
  const notas = String(d.notas == null ? '' : d.notas).trim();
  if (notas.length > 1000) throw new Error('Las notas deben tener máximo 1000 caracteres.');
  const activo = !(d.activo === false || /^(no|false|0)$/i.test(String(d.activo == null ? '' : d.activo)));
  return Object.assign(base, { direccion: direccion, banco: banco, clabe: clabe, cuenta: cuenta, titular: titular,
    diasCredito: diasCredito, formaPagoHabitual: formaPagoHabitual, notas: notas, activo: activo });
}

/** ¿Cambió el banco, la CLABE o la cuenta? (el banco sin distinguir mayúsculas ni acentos) */
function cambioDeBanco(antes, nuevo) {
  const a = antes || {}, n = nuevo || {};
  return textoNormal(a.banco) !== textoNormal(n.banco) || String(a.clabe || '') !== String(n.clabe || '') ||
    String(a.cuenta || '') !== String(n.cuenta || '');
}

/** "banco BBVA → Banorte · CLABE ··1234 → ··5678 · cuenta ··…" (para la Bitácora: nunca la CLABE completa). */
function textoCambioBanco(antes, nuevo) {
  const a = antes || {}, n = nuevo || {};
  const term = v => v ? '··' + ultimos4(v) : '(sin)';
  const partes = [];
  if (textoNormal(a.banco) !== textoNormal(n.banco)) partes.push('banco ' + (a.banco || '(sin)') + ' → ' + (n.banco || '(sin)'));
  if (String(a.clabe || '') !== String(n.clabe || '')) partes.push('CLABE ' + term(a.clabe) + ' → ' + term(n.clabe));
  if (String(a.cuenta || '') !== String(n.cuenta || '')) partes.push('cuenta ' + term(a.cuenta) + ' → ' + term(n.cuenta));
  return partes.join(' · ');
}

/** Campos de la ficha que cambiaron (nombres en español, para la Bitácora; sin valores bancarios). */
function camposCambiados(antes, nuevo) {
  if (!antes) return [];
  const nombres = { razonSocial: 'razón social', rfc: 'RFC', contacto: 'contacto', correo: 'correo', telefono: 'teléfono',
    direccion: 'dirección', banco: 'banco', clabe: 'CLABE', cuenta: 'cuenta', titular: 'titular', formaPagoHabitual: 'forma de pago',
    diasCredito: 'días de crédito', notas: 'notas', activo: 'activo' };
  return Object.keys(nombres).filter(k => String(antes[k] == null ? '' : antes[k]) !== String(nuevo[k] == null ? '' : nuevo[k]))
    .map(k => k === 'activo' ? (nuevo.activo ? 'reactivado' : 'desactivado') : nombres[k]);
}

/**
 * Avisos de un proveedor (no bloquean nada salvo el pago): {faltan (tipos de documento que no tiene), faltanPago (CSF y carátula
 * que no tiene: lo de siempre, para listas y filtros), faltanPorMetodo ({método del pago: documentos que ese método exige y no
 * tiene}, con documentosParaPagar: solo Transferencia exige algo y a un proveedor extranjero no se le pide la CSF; revisión del
 * 29/10/2026: la interfaz decide el aviso con esto), vencidos (domicilio > 3 meses, CSF > 12 meses), avisos (textos)}.
 * hoy = "AAAA-MM-DD".
 */
function avisosProveedor(p, hoy) {
  const x = p || {};
  const faltan = Object.keys(DOCS_PROVEEDOR).filter(k => !x[k + 'Id']);
  const avisos = [], vencidos = [];
  if (faltan.length) avisos.push('Falta ' + listaConY(faltan.map(k => DOCS_PROVEEDOR[k].nombre)) + '.');
  const dmy = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
  const viejo = (k, meses, texto) => {
    const f = x[k + 'Fecha'];
    if (!x[k + 'Id'] || !/^\d{4}-\d{2}-\d{2}$/.test(String(f || '')) || !hoy) return;
    if (sumarMeses(f, meses) < hoy) { vencidos.push(k); avisos.push(texto + ' (' + dmy(f) + ').'); }
  };
  viejo('domicilio', MESES_AVISO_DOMICILIO, 'El comprobante de domicilio tiene más de ' + MESES_AVISO_DOMICILIO + ' meses');
  viejo('csf', MESES_AVISO_CSF, 'La constancia de situación fiscal tiene más de ' + MESES_AVISO_CSF + ' meses');
  const faltanPorMetodo = {};
  METODOS_PAGO.forEach(m => { faltanPorMetodo[m] = documentosParaPagar(x.rfc, m).filter(k => !x[k + 'Id']); });
  return { faltan: faltan, faltanPago: DOCS_PARA_PAGAR.filter(k => !x[k + 'Id']), faltanPorMetodo: faltanPorMetodo, vencidos: vencidos,
    avisos: avisos };
}

/** Texto de avisoProveedor (orden o propuesta); '' si no hay nada que avisar. */
function textoAvisoProveedor(p, a) {
  if (!a || !a.avisos.length) return '';
  // Revisión: lo que exige la transferencia (a un proveedor extranjero solo la carátula); los demás métodos no exigen nada
  const exigidos = a.faltanPorMetodo ? a.faltanPorMetodo.Transferencia || [] : a.faltanPago;
  return 'Proveedor ' + p.razonSocial + ': ' + a.avisos.join(' ') + (exigidos.length ? ' Sin ' +
    listaConY(exigidos.map(k => DOCS_PROVEEDOR[k].nombre.replace(/^(la|el) /, ''))) + ' no se le podrá registrar un pago por transferencia: ' +
    (exigidos.length > 1 ? 'súbelas' : 'súbela') + ' en Compras → Proveedores.' : '');
}

/** Lo que va en la lista de proveedores: sin la CLABE completa ni la cuenta (solo sus últimos 4), con documentos y avisos. */
function resumenProveedor(p, hoy) {
  const a = avisosProveedor(p, hoy);
  const docs = {};
  Object.keys(DOCS_PROVEEDOR).forEach(k => {
    docs[k] = { tiene: !!p[k + 'Id'], fecha: p[k + 'Fecha'] || '', url: p[k + 'Url'] || '', vencido: a.vencidos.indexOf(k) !== -1 };
  });
  return { id: p.id, razonSocial: p.razonSocial, rfc: p.rfc, contacto: p.contacto, correo: p.correo, telefono: p.telefono,
    banco: p.banco, clabe4: ultimos4(p.clabe), cuenta4: ultimos4(p.cuenta), formaPagoHabitual: formaPagoHabitualDe(p),
    diasCredito: p.diasCredito, activo: p.activo !== false, actualizado: p.actualizado, etiqueta: p.etiqueta || p.razonSocial,
    documentos: docs, faltan: a.faltan, faltanPago: a.faltanPago, faltanPorMetodo: a.faltanPorMetodo, avisos: a.avisos };
}

/** Ficha completa para la vista (getProveedor / guardarProveedor): todo lo de la hoja + documentos y avisos (sin la fila). */
function fichaParaVista(p, hoy) {
  const r = resumenProveedor(p, hoy);
  return Object.assign(r, { direccion: p.direccion || '', clabe: p.clabe || '', cuenta: p.cuenta || '', titular: p.titular || '',
    formaPagoGuardada: p.formaPagoHabitual || '', notas: p.notas || '', actualizo: p.actualizo || '' });
}

/** Filtro de la lista: texto (razón social, RFC, contacto, correo, banco o terminación de la CLABE) y estado. */
function filtrarProveedores(lista, f) {
  const x = f || {};
  const q = textoNormal(x.texto);
  const estado = String(x.estado || 'activos');
  return (lista || []).filter(p => {
    if (estado === 'activos' && !p.activo) return false;
    if (estado === 'inactivos' && p.activo) return false;
    if (estado === 'faltan' && !(p.activo && p.faltan.length)) return false;
    if (estado === 'avisos' && !(p.activo && p.avisos.length)) return false;
    return !q || textoNormal([p.razonSocial, p.rfc, p.contacto, p.correo, p.banco, p.clabe4, p.cuenta4].join(' ')).includes(q);
  });
}

/** "<RFC o SIN-RFC> — <razón social>" (sin / \ : * ? " < > |). */
function nombreCarpetaProveedor(rfc, razonSocial) {
  const limpio = s => String(s || '').replace(/[\/\\:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (limpio(rfc) || 'SIN-RFC') + ' — ' + limpio(razonSocial).slice(0, 100);
}

/** "<RFC> — CSF.pdf", "<RFC> — Carátula bancaria (2).jpg"… (n > 1 lleva "(n)": el anterior se conserva). */
function nombreDocProveedor(rfc, tipo, ext, n) {
  return (String(rfc || '').trim() || 'SIN-RFC') + ' — ' + DOCS_PROVEEDOR[tipo].archivo + (n > 1 ? ' (' + n + ')' : '') + '.' + ext;
}

/** Datos del aviso proveedor.banco (infoDeAviso_): solo el banco y los últimos 4 dígitos (nunca la CLABE ni el proveedor). */
function datosAvisoBanco(d) {
  const x = d || {};
  const s = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 60);
  return { banco: s(x.banco), bancoAntes: s(x.bancoAntes), clabe4: ultimos4(x.clabe4), clabeAntes4: ultimos4(x.clabeAntes4),
    cuenta4: ultimos4(x.cuenta4), cuentaAntes4: ultimos4(x.cuentaAntes4) };
}

/** Texto del correo proveedor.banco (contenidoAviso): a compras, sin el nombre del proveedor ni la CLABE completa. */
function contenidoAvisoBanco(x, i, quienHizo) {
  const term = (n, a) => n ? 'terminación ' + n + (a && a !== n ? ' (antes ' + a + ')' : '') : a ? 'se quitó (era la terminación ' + a + ')' : '';
  x.asunto = '[CAPRI] Cambió la cuenta bancaria de un proveedor';
  x.titulo = 'Cambió la cuenta bancaria de un proveedor';
  x.que = 'Se cambiaron los datos bancarios de un proveedor, con su carátula nueva. Si no esperabas el cambio, confírmalo por ' +
    'teléfono con el proveedor antes de pagarle. Lo ves en CAPRI: Compras → Proveedores (busca por la terminación).';
  x.filas = [['Banco', i.bancoAntes && textoNormal(i.bancoAntes) !== textoNormal(i.banco) ? (i.banco || '(sin banco)') + ' (antes ' + i.bancoAntes + ')' : i.banco],
    ['CLABE', term(i.clabe4, i.clabeAntes4)], ['Cuenta', term(i.cuenta4, i.cuentaAntes4)], ['Lo hizo', quienHizo],
    ['Cuándo', fechaCorreo(i.fecha)]].filter(f => f && f[1]);
  x.boton = { texto: 'Abrir proveedores en CAPRI', url: URL_AVISOS_CAPRI + '#proveedores' };
  x.nota = '';
  return x;
}

// ---- 6.H Recepción con fotos y devoluciones (incremento 5; contrato en docs/incremento-5.md §3–§5) ----
// Fotos: cada renglón que llega (cantidad > 0) lleva una foto, comprimida en el navegador (lado mayor 1600 px, JPEG 0.72), en
// "Registrar lo que llegó", "Recibí el material", "Lo recogí" y la recepción de respaldo de compras. El servidor las guarda en
// Compras/AAAA/<proyecto>/Recepciones/<REC-… o DEV-…> — r<n>.jpg con privado_ y anota foto_id / foto_url en su movimiento.
// Devoluciones DEV-AAAA-NNNN: quien pidió, quien recibe o compras reporta un problema (al recibir o después, hasta 30 días
// después de Recibida/Cerrada); compras (o super admin) resuelve: Reponer (movimiento negativo, el renglón vuelve a por recibir
// y la requisición se reabre), Devolver al proveedor / Cancelar renglón (movimiento negativo; faltante aceptado) o Conservar.
// Con una devolución Abierta la requisición no se cierra (la deja Recibida; cerrarRetenida la cierra al resolverse).
// Centro de mando: sus recepciones traen foto y problema por renglón; CAPRI baja las fotos (fuera del candado), las guarda en
// Drive, avisa que se archivaron y crea la DEV de cada problema una sola vez. Al resolver una devolución de un proyecto ligado
// avisa oc.devolucion (sin montos).

function modRecepcion_() {
  return { nombre: 'Recepción',
    api: { reportarProblema: reportarProblema, listarDevoluciones: listarDevoluciones, resolverDevolucion: resolverDevolucion },
    // Una devolución cambia la requisición (historial, estado) y sus movimientos (avance de la orden)
    cambios: { reportarProblema: ['requisiciones', 'oc'], resolverDevolucion: ['requisiciones', 'oc'] },
    // Quien pide o recibe suele tener "Solo requisiciones": reporta y ve las suyas
    solo: ['reportarProblema', 'listarDevoluciones'],
    publicas: [],
    sincronizar: function (permisos, ctx, algo, r, errores) {
      // La lista "Devoluciones" de Compras, si está abierta (ctx.devoluciones = su filtro)
      if (ctx && ctx.devoluciones && (permisos.compras || permisos.superadmin) && algo('requisiciones', 'oc')) {
        r.devoluciones = intentar_(errores, 'Devoluciones', () => listarDevoluciones(ctx.devoluciones));
      }
    },
    preparar: function () {
      const libro = libroComprasSiExiste_();
      if (libro) { hojaCompras_(libro, 'Devoluciones'); hojaCompras_(libro, 'MovimientosInventario'); }
      console.log('Recepción con fotos: pestaña Devoluciones y columnas foto_id / foto_url ' + (libro ? 'listas.' : 'se crean con el libro de compras.'));
    } };
}

const PREFIJO_DEV = 'DEV';
const DEV_ABIERTA = 'Abierta', DEV_RESUELTA = 'Resuelta';
const TIPOS_DEV = ['Incorrecto', 'Dañado', 'Faltante', 'Sobrante', 'Otro'];
const RES_REPONER = 'Reponer', RES_DEVOLVER = 'Devolver al proveedor', RES_CANCELAR = 'Cancelar renglón', RES_CONSERVAR = 'Conservar';
const RESOLUCIONES_DEV = [RES_REPONER, RES_DEVOLVER, RES_CANCELAR, RES_CONSERVAR];
const ORIGEN_DEV_CAPRI = 'CAPRI', ORIGEN_DEV_CENTRO = 'Centro de mando';
/** Movimientos de una devolución (cantidad negativa): Reponer → el renglón vuelve a "por recibir"; sin reponer → faltante aceptado. */
const TIPO_DEVOLUCION = 'Devolución', TIPO_DEVOLUCION_CIERRA = 'Devolución sin reponer';
/** Faltante que nunca se contó como recibido (problema "Faltante" del centro de mando) y compras ya no espera: cantidad positiva. */
const TIPO_FALTANTE_ACEPTADO = 'Faltante aceptado';
/** "Lo recogí": la foto de cada renglón que se recogió (no cuenta como recepción: se recibe al llegar al sitio). */
const TIPO_RECOGIDO = 'Recogido en tienda';
const DIAS_REPORTAR_DEV = 30;
const SUBCARPETA_RECEPCIONES = 'Recepciones';
const SUBCARPETA_SIN_ORDEN = '_sin-orden'; // revisión 5b: Compras/AAAA/_sin-orden/ (fotos de órdenes que CAPRI no tiene)
const MAX_FOTO = 10 * 1024 * 1024;
/** foto_id provisional de una foto del centro de mando que todavía no llega a Drive. */
const MARCA_FOTO_CENTRO = 'centro:';
const RUTA_PORTAL_FOTO = '/api/integracion/cotizador/foto';
const RUTA_PORTAL_FOTO_ARCHIVADA = '/api/integracion/cotizador/foto-archivada';
const MAX_FOTOS_PORTAL = 40; // por corrida (la siguiente sigue)

// -- Fotos que manda el navegador --

/**
 * Fotos y problemas por renglón de lo que manda la interfaz: renglones = [{renglon, foto: {nombre, datos (base64), mime},
 * problema: {tipo, cantidad, comentario, foto}}] → {renglon: {foto: {bytes, tipo} | null, problema: {…, foto} | null}}. Se lee y
 * se valida (imagen, ≤ 10 MB) antes del candado.
 */
function fotosDeRenglones_(renglones) {
  const mapa = {};
  (Array.isArray(renglones) ? renglones : []).forEach(r => {
    const n = Number(r && r.renglon);
    if (!(n > 0)) return;
    const x = { foto: fotoDeAdjunto_(r.foto), problema: null };
    if (r.problema && typeof r.problema === 'object') x.problema = Object.assign({}, r.problema, { foto: fotoDeAdjunto_(r.problema.foto) });
    mapa[n] = x;
  });
  return mapa;
}

/** {bytes, tipo: {mime, ext}} de una foto adjunta ({nombre, datos}); null si no viene. */
function fotoDeAdjunto_(adjunto) {
  if (!adjunto || !adjunto.datos) return null;
  const bytes = bytesDeAdjunto_(adjunto, 'No se pudo leer una foto. Vuelve a tomarla.');
  return { bytes: bytes, tipo: validarFoto(bytes) };
}

/** Compras/AAAA/<folio del proyecto>/Recepciones/ (restringida). */
function carpetaRecepciones_(proyectoFolio) {
  return privado_(subcarpeta_(carpetaProyectoCompras_(proyectoFolio), SUBCARPETA_RECEPCIONES));
}

/** Guarda (privadas) las fotos de los renglones recibidos: {renglon: {id, url}}. */
function guardarFotosRecepcion_(proyectoFolio, folio, fotos, recibidos) {
  const r = {};
  let carpeta = null;
  (recibidos || []).forEach(x => {
    const f = fotos && fotos[x.renglon] && fotos[x.renglon].foto;
    if (!f) return;
    carpeta = carpeta || carpetaRecepciones_(proyectoFolio);
    const a = privado_(carpeta.createFile(Utilities.newBlob(f.bytes, f.tipo.mime, nombreArchivoFoto(folio, x.renglon, f.tipo.ext))));
    r[x.renglon] = { id: a.getId(), url: a.getUrl() };
  });
  return r;
}

/** Fila de MovimientosInventario con su foto (columnas foto_id / foto_url por nombre). foto = {id, url} o null. */
function conFotoMov_(fila, foto) {
  const f = fila.slice();
  while (f.length < HOJAS_COMPRAS.MovimientosInventario.enc.length) f.push('');
  if (foto) { f[colMov_('foto_id') - 1] = foto.id || ''; f[colMov_('foto_url') - 1] = foto.url || ''; }
  return f;
}

/** Avance de la recepción de la orden de una requisición (con devoluciones). */
function avanceDeReq_(libro, req, orden) {
  return avanceRecepcion(orden.renglones, movimientosPorOc_(libro)[orden.folio.toUpperCase()] || [],
    renglonesSinRecepcion(propuestaVigente_(req)));
}

/**
 * Antes de escribir: una foto por renglón recibido (exigir ≠ false) y los problemas reportados al recibir, validados contra lo
 * recibido de su renglón (lo de antes + lo de ahora − lo que ya está en devoluciones abiertas). recibidos = [{renglon, cantidad,
 * descripcion, unidad}]; lineas = avance antes de registrar; sinFaltante: donde se escribe cuánto llegó (registrarRecepcion) no
 * se acepta "Faltante". Devuelve [{renglon, descripcion, unidad, cantidad, tipo, comentario, foto}].
 */
function validarFotosYProblemas_(recibidos, fotos, lineas, ocupado, exigir, sinFaltante) {
  const lista = recibidos || [], problemas = [];
  lista.forEach(x => {
    const f = (fotos || {})[x.renglon] || {};
    if (exigir !== false && Number(x.cantidad) > 0 && !f.foto) {
      throw new Error('Falta la foto de "' + String(x.descripcion).slice(0, 40) + '" (una por renglón recibido).');
    }
    if (!f.problema) return;
    const l = (lineas || []).find(y => y.renglon === x.renglon) || {};
    const disponible = Math.round(((Number(l.recibido) || 0) + (Number(x.cantidad) || 0) - (Number((ocupado || {})[x.renglon]) || 0)) * 10000) / 10000;
    const p = normalizarProblema(f.problema, { descripcion: x.descripcion, unidad: x.unidad, disponible: disponible }, !!f.problema.foto);
    // Donde se escribe cuánto llegó, lo que no llegó simplemente no se registra (queda por recibir): un "Faltante" ahí se contaría doble
    if (sinFaltante && p.tipo === 'Faltante') {
      throw new Error('Si faltó material de "' + String(x.descripcion).slice(0, 40) + '", escribe en "Llegó" solo lo que llegó: lo demás queda por recibir ' +
        '(o marca "Ya no llegará lo que falta").');
    }
    problemas.push(Object.assign(p, { renglon: x.renglon, descripcion: x.descripcion, unidad: x.unidad, foto: f.problema.foto }));
  });
  Object.keys(fotos || {}).forEach(n => {
    if (fotos[n].problema && !lista.some(x => x.renglon === Number(n))) {
      throw new Error('El problema del renglón ' + n + ' no corresponde a lo que estás recibiendo: repórtalo con "Reportar problema".');
    }
  });
  return problemas;
}

/** DEV de cada problema reportado al recibir (después de escribir los movimientos). */
function crearDevolucionesDeRecepcion_(libro, req, orden, problemas) {
  return (problemas || []).map(p => crearDevolucion_(libro, req, orden, p, {}));
}

/**
 * "Recibí el material" (flujo de siempre) y el cierre de compras: entrada por compra (folio REC) de cada renglón pendiente de la
 * orden con su foto (exigirFotos) y los problemas reportados. Revisa antes lo mismo que el cierre (cerrarReq_). Si queda una
 * devolución abierta y la orden está pagada, la requisición queda Recibida (no se cierra) y devuelve true; si no, false y quien
 * llama cierra como siempre.
 */
function recibirTodoConFotos_(libro, hoja, req, fotos, nota, exigirFotos) {
  if (!req.ocFolio) return false; // sin orden: el cierre dará su error de siempre
  const { hoja: hO, orden } = buscarOrden_(libro, req.ocFolio);
  validarCierreConFotos_(req, orden);
  const avance = avanceDeReq_(libro, req, orden);
  const recibidos = avance.lineas.filter(l => l.pendiente > 1e-9).map(l => ({ renglon: l.renglon, cantidad: l.pendiente, clave: l.clave,
    descripcion: l.descripcion, unidad: l.unidad }));
  const problemas = validarFotosYProblemas_(recibidos, fotos, avance.lineas, ocupadoEnDevoluciones_(libro, orden.folio), exigirFotos);
  const t = textoCelda;
  if (recibidos.length) {
    const hM = hojaCompras_(libro, 'MovimientosInventario');
    const folio = siguienteFolio_(PREFIJO_REC, hM, 'CONSECUTIVO_REC_');
    const guardadas = guardarFotosRecepcion_(req.proyectoFolio, folio, fotos, recibidos);
    const ahora = ahoraTexto_(), notas = nota || (exigirFotos ? 'Recibí el material' : 'Cierre de compras');
    recibidos.forEach(x => escribe_(hM).appendRow(conFotoMov_([folio, textoFecha_(hoyIso_()), ahora, TIPO_ENTRADA_COMPRA, t(req.sitio), req.proyectoFolio,
      req.folio, orden.folio, x.renglon, t(x.clave), t(x.descripcion), t(x.unidad), x.cantidad, t(yo_()), t(nombreYo_()), t(notas),
      '', '', 'Vigente', '', '', ''], guardadas[x.renglon])));
    crearDevolucionesDeRecepcion_(libro, req, orden, problemas);
  }
  const abierta = exigirFotos && orden.estado === OC_PAGADA ? devolucionAbiertaDe_(libro, req) : '';
  if (!abierta) return false;
  const nuevo = transicionReq(req.estado, 'recibirRetenida');
  escribe_(hO).getRange(orden.fila, COL_ESTADO_OC + 1, 1, 2).setValues([[textoFecha_(hoyIso_()), t(VENDEDOR_.email)]]);
  cambiarReq_(hoja, req, nuevo, { notasRecepcion: nota });
  eventoReq_(libro, req.folio, nuevo, ['Material recibido', nota, textoRetenida(abierta)].filter(Boolean).join(' · '));
  notificar_('req.recibida', { req: req.folio, nota: nota }); // correo a compras (6.B)
  bitacora_(libro, 'Recibir material (retenida por devolución)', req.proyectoFolio, req.folio + ' · ' + orden.folio + ' · ' + abierta, '', HOJAS_COMPRAS);
  return true;
}

/**
 * Lo mismo que revisa cerrarReq_ (estado y orden pagada), antes de escribir. Con crédito del proveedor (módulo F) se recibe sin
 * pagar exactamente cuando recibirSinPagar_ lo haría (flujo de siempre y recibirSinPagarPosible_); si no, el cierre de siempre.
 * Revisión: antes aceptaba el crédito también con aprobaciones y cerrarRequisicionCompras escribía las entradas y luego fallaba.
 */
function validarCierreConFotos_(req, orden) {
  if (!flujoOperaciones_() && recibirSinPagarPosible_(req, orden)) { transicionReq(req.estado, 'recibir'); return; }
  transicionReq(req.estado, req.estado === REQ_EN_CAMINO ? 'cerrarEnCamino' : 'cerrar');
  if (orden.estado !== OC_PAGADA) throw new Error('La orden ' + orden.folio + ' no está pagada.');
}

/**
 * "Lo recogí": una foto por renglón por recibir (se revisan todas antes de escribir); quedan como movimientos "Recogido en
 * tienda" (folio REC, no cuentan como recepción: se recibe al llegar al sitio).
 */
function fotosRecogido_(libro, req, orden, fotos) {
  const avance = avanceDeReq_(libro, req, orden);
  const recogidos = avance.lineas.filter(l => l.pendiente > 1e-9).map(l => ({ renglon: l.renglon, cantidad: l.pendiente, clave: l.clave,
    descripcion: l.descripcion, unidad: l.unidad }));
  const soloFotos = {};
  Object.keys(fotos || {}).forEach(n => { soloFotos[n] = { foto: fotos[n].foto, problema: null }; }); // al recoger no se reportan problemas
  validarFotosYProblemas_(recogidos, soloFotos, avance.lineas, {}, true);
  if (!recogidos.length) return '';
  const hM = hojaCompras_(libro, 'MovimientosInventario');
  const folio = siguienteFolio_(PREFIJO_REC, hM, 'CONSECUTIVO_REC_');
  const guardadas = guardarFotosRecepcion_(req.proyectoFolio, folio, soloFotos, recogidos);
  const ahora = ahoraTexto_(), t = textoCelda;
  recogidos.forEach(x => escribe_(hM).appendRow(conFotoMov_([folio, textoFecha_(hoyIso_()), ahora, TIPO_RECOGIDO, t(req.sitio), req.proyectoFolio,
    req.folio, orden.folio, x.renglon, t(x.clave), t(x.descripcion), t(x.unidad), x.cantidad, t(yo_()), t(nombreYo_()), t('Lo recogí'),
    '', '', 'Vigente', '', '', ''], guardadas[x.renglon])));
  return folio;
}

// -- Devoluciones: hoja, lectura y reglas --

/** Devolución desde su fila. */
function devDesdeFila_(r, fila) {
  return { folio: String(r[0] || ''), fecha: momentoTexto_(r[1]), reqFolio: String(r[2] || ''), ocFolio: String(r[3] || ''),
    proyectoFolio: String(r[4] || ''), renglon: Number(r[5]) || 0, descripcion: String(r[6] || ''), cantidad: Number(r[7]) || 0,
    tipo: String(r[8] || ''), comentario: String(r[9] || ''), fotoId: String(r[10] || ''), fotoUrl: String(r[11] || ''),
    origen: String(r[12] || ORIGEN_DEV_CAPRI), reportoEmail: String(r[13] || ''), estado: String(r[14] || DEV_ABIERTA),
    resolucion: String(r[15] || ''), notaResolucion: String(r[16] || ''), guia: String(r[17] || ''), resolvioEmail: String(r[18] || ''),
    fechaResolucion: momentoTexto_(r[19]), origenClave: String(r[20] || ''), fila: fila };
}

/** "AAAA-MM-DD HH:mm:ss" de una celda (Date de Sheets o texto, con o sin apóstrofo). */
function momentoTexto_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss');
  return String(v == null ? '' : v).replace(/^'/, '');
}

/** Todas las devoluciones del libro (en esta petición se leen una vez; quien escribe borra MEMO_.devs). */
function devolucionesDelLibro_(libro) {
  if (MEMO_.devs) return MEMO_.devs;
  const hoja = libro && libro.getSheetByName('Devoluciones');
  MEMO_.devs = hoja ? filasDeArea_(hojaCompras_(libro, 'Devoluciones'), HOJAS_COMPRAS, 'Devoluciones')
    .map((r, i) => devDesdeFila_(r, i + 2)).filter(d => d.folio && d.estado !== ESTADO_ANULADA) : [];
  return MEMO_.devs;
}

/**
 * Folio de la primera devolución Abierta de la requisición con su orden de ahora ('' si no hay). req = {folio, ocFolio}. Una
 * devolución de una orden anterior de la misma requisición (cancelada o anulada) no cuenta: ya no se puede resolver y no debe
 * retener a la orden nueva (revisión del 29/10/2026).
 */
function devolucionAbiertaDe_(libro, req) {
  const f = String((req && req.folio) || '').toUpperCase(), oc = String((req && req.ocFolio) || '').toUpperCase();
  if (!f || !oc) return '';
  const d = devolucionesDelLibro_(libro).find(x => x.reqFolio.toUpperCase() === f && x.ocFolio.toUpperCase() === oc &&
    x.estado === DEV_ABIERTA && !esAnulado_(x.folio));
  return d ? d.folio : '';
}

/** {renglon: cantidad en devoluciones Abiertas} de una orden (no se reporta dos veces lo mismo). */
function ocupadoEnDevoluciones_(libro, ocFolio) {
  const f = String(ocFolio || '').toUpperCase(), r = {};
  devolucionesDelLibro_(libro).forEach(d => {
    if (d.ocFolio.toUpperCase() === f && d.estado === DEV_ABIERTA) r[d.renglon] = Math.round(((r[d.renglon] || 0) + d.cantidad) * 10000) / 10000;
  });
  return r;
}

/** Ningún cierre con una devolución abierta (compras y su respaldo). */
function exigirSinDevolucionAbierta_(libro, req) {
  const abierta = devolucionAbiertaDe_(libro, req);
  if (abierta) throw new Error('La devolución ' + abierta + ' de ' + req.folio + ' está abierta: resuélvela antes de cerrar la requisición.');
}

/** Cancelar una recepción: no si sus renglones tienen una devolución abierta o una resuelta con movimiento (quedaría negativo). */
function exigirSinDevoluciones_(libro, req, filas) {
  const f = filas || [];
  const d = devolucionQueImpideCancelar(devolucionesDelLibro_(libro).filter(x => !esAnulado_(x.folio)), (f[0] || {}).ocFolio || req.ocFolio,
    f.map(x => x.renglon));
  if (d) throw new Error('El material de esa recepción tiene la devolución ' + d.folio + ' (' + d.estado.toLowerCase() + '): no se puede cancelar la recepción.');
}

/**
 * Fecha (AAAA-MM-DD) en que se recibió todo: la de la orden (fecha_recepcion) o, si falta, la última actualización de la
 * requisición. Sirve para la ventana de 30 días.
 */
function fechaRecepcionReq_(req, orden) {
  return (orden && /^\d{4}-\d{2}-\d{2}$/.test(String(orden.fechaRecepcion || '')) ? orden.fechaRecepcion : '') ||
    String(marcaOrdenable(req.actualizado) || '').slice(0, 10);
}

/** '' si se puede reportar un problema de la requisición hoy; si no, el motivo. */
function motivoSinReporte_(req, orden) {
  if (!orden || orden.estado === OC_CANCELADA) return 'La requisición ' + req.folio + ' no tiene material recibido.';
  if ([REQ_AUTORIZADA, REQ_PAGADA, REQ_EN_CAMINO].indexOf(req.estado) !== -1) return ''; // recepción en curso
  if ([REQ_RECIBIDA, REQ_CERRADA].indexOf(req.estado) === -1) {
    return 'La requisición ' + req.folio + ' está ' + String(req.estado).toLowerCase() + ': no tiene material recibido para reportar.';
  }
  const desde = fechaRecepcionReq_(req, orden);
  return dentroDeVentanaDev(desde, hoyIso_()) ? '' : 'Pasaron más de ' + DIAS_REPORTAR_DEV + ' días desde que se recibió el material de ' +
    req.folio + ' (' + desde + '): ya no se reportan problemas aquí. Habla con compras.';
}

/** Renglones de la orden en los que hoy se puede reportar un problema (con material recibido que no esté ya en una devolución abierta). */
function renglonesReportables_(libro, req, orden, avance) {
  if (!orden || !avance || motivoSinReporte_(req, orden)) return [];
  const ocupado = ocupadoEnDevoluciones_(libro, orden.folio);
  return avance.lineas.filter(l => l.recibido - (ocupado[l.renglon] || 0) > 1e-9).map(l => ({ renglon: l.renglon,
    descripcion: l.descripcion, unidad: l.unidad, disponible: Math.round((l.recibido - (ocupado[l.renglon] || 0)) * 10000) / 10000 }));
}

/**
 * Escribe una devolución Abierta (folio DEV con su consecutivo), su foto (si viene en bytes) y su historial; forma el aviso
 * dev.reportada. p = {renglon, descripcion, unidad, cantidad, tipo, comentario, foto: {bytes, tipo} | null}; o = {origen, reporto,
 * clave (origen_clave), foto: {id, url} ya conocida (centro de mando)}. Devuelve el folio.
 */
function crearDevolucion_(libro, req, orden, p, o) {
  const x = o || {};
  const hD = hojaCompras_(libro, 'Devoluciones');
  const folio = siguienteFolio_(PREFIJO_DEV, hD, 'CONSECUTIVO_DEV_');
  let foto = x.foto || null;
  if (p.foto && p.foto.bytes) {
    const a = privado_(carpetaRecepciones_(req.proyectoFolio).createFile(Utilities.newBlob(p.foto.bytes, p.foto.tipo.mime,
      nombreArchivoFoto(folio, p.renglon, p.foto.tipo.ext))));
    foto = { id: a.getId(), url: a.getUrl() };
  }
  const origen = x.origen || ORIGEN_DEV_CAPRI, reporto = x.reporto || yo_(), t = textoCelda;
  escribe_(hD).appendRow([folio, "'" + ahoraTexto_(), req.folio, orden.folio, req.proyectoFolio, p.renglon, t(p.descripcion), p.cantidad, p.tipo,
    t(p.comentario), foto ? t(foto.id || '') : '', foto ? t(foto.url || '') : '', origen, t(reporto), DEV_ABIERTA, '', '', '', '', '', t(x.clave || '')]);
  MEMO_.devs = null;
  const material = p.cantidad + ' ' + (p.unidad || '') + ' de ' + String(p.descripcion).slice(0, 60);
  eventoReq_(libro, req.folio, req.estado, 'Problema reportado (' + folio + '): ' + p.tipo + ' · ' + material +
    (origen === ORIGEN_DEV_CENTRO ? ' · en el centro de mando por ' + reporto : '') + '. Compras lo va a resolver.');
  bitacora_(libro, 'Reportar problema', req.proyectoFolio, folio + ' · ' + req.folio + ' · ' + orden.folio + ' · renglón ' + p.renglon + ' · ' +
    p.tipo + ' · ' + material + ' · ' + origen, p.comentario, HOJAS_COMPRAS);
  notificar_('dev.reportada', { req: req.folio, nota: p.comentario, quien: origen === ORIGEN_DEV_CENTRO ? reporto : '',
    dev: { folio: folio, renglon: p.renglon, descripcion: p.descripcion, cantidad: p.cantidad, unidad: p.unidad, tipo: p.tipo, origen: origen,
      reporto: reporto } });
  return folio;
}

// -- API --

/**
 * Reportar un problema con material ya recibido (quien pidió, quien recibe o compras): d = {renglon (de la orden), cantidad,
 * tipo (Incorrecto · Dañado · Faltante · Sobrante · Otro), comentario (≥ 5), foto: {nombre, datos} (obligatoria salvo Faltante),
 * idSolicitud}. Mientras la recepción sigue en curso o hasta 30 días después de Recibida/Cerrada. Crea DEV-AAAA-NNNN Abierta y
 * avisa a compras (dev.reportada). Devuelve {folio, requisiciones (quien pide), vista (compras)}.
 */
function reportarProblema(reqFolio, d) {
  if (!VENDEDOR_) throw errorSesion_('Inicia sesión con tu cuenta @' + DOMINIO_HELGEN + '.');
  const compras = esCompras_(), requisicion = esRequisicion_();
  if (!compras && !requisicion) throw errorPermiso_('No tienes permiso para reportar problemas con el material.');
  const d0 = d || {};
  const foto = fotoDeAdjunto_(d0.foto);
  const libro = libroCompras_();
  const idSolicitud = String(d0.idSolicitud || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const claveCache = idSolicitud ? 'DEV_' + idSolicitud : '';
  return conCandado_(() => {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) return JSON.parse(previo);
    }
    const { req } = buscarReq_(libro, reqFolio);
    const yo = yo_(), recibe = req.recibeEmail || req.solicitanteEmail;
    if (!compras && yo !== req.solicitanteEmail && yo !== recibe) {
      throw errorPermiso_('Solo quien pidió la requisición ' + req.folio + ', quien la recibe o compras puede reportar un problema.');
    }
    if (!req.ocFolio) throw new Error('La requisición ' + req.folio + ' no tiene material recibido.');
    const { orden } = buscarOrden_(libro, req.ocFolio);
    const motivo = motivoSinReporte_(req, orden);
    if (motivo) throw new Error(motivo);
    const avance = avanceDeReq_(libro, req, orden);
    const n = Number(d0.renglon);
    const linea = avance.lineas.find(l => l.renglon === n);
    if (!linea) throw new Error('La orden de ' + req.folio + ' no tiene el renglón ' + String(d0.renglon == null ? '' : d0.renglon).slice(0, 10) + ' por recibir en sitio.');
    const disponible = Math.round((linea.recibido - (ocupadoEnDevoluciones_(libro, orden.folio)[n] || 0)) * 10000) / 10000;
    if (!(disponible > 1e-9)) {
      throw new Error('De "' + String(linea.descripcion).slice(0, 40) + '" no hay material recibido para reportar (o ya está en una devolución abierta).');
    }
    const p = normalizarProblema(d0, { descripcion: linea.descripcion, unidad: linea.unidad, disponible: disponible }, !!foto);
    const folio = crearDevolucion_(libro, req, orden, Object.assign(p, { renglon: n, descripcion: linea.descripcion, unidad: linea.unidad,
      foto: foto }), {});
    SpreadsheetApp.flush();
    const resultado = { folio: folio, requisiciones: requisicion ? misRequisiciones() : null,
      vista: compras ? vistaRequisicion_(libro, req.folio) : null };
    guardarIdempotencia_(cache, claveCache, resultado);
    return resultado;
  });
}

/**
 * Devoluciones, más recientes primero (máx. 300). Compras (o super admin): todas, con la nota de la resolución y la orden; quien
 * pide o recibe: solo las de sus requisiciones, sin orden ni nota de compras. filtro = texto o {texto, estado, req}.
 */
function listarDevoluciones(filtro) {
  if (!VENDEDOR_) throw errorSesion_('Inicia sesión con tu cuenta @' + DOMINIO_HELGEN + '.');
  const compras = esCompras_() || esSuperAdmin_();
  if (!compras && !esRequisicion_()) throw errorPermiso_('No tienes permiso para ver devoluciones.');
  const f = filtro && typeof filtro === 'object' ? filtro : { texto: filtro };
  const libro = libroComprasSiExiste_();
  if (!libro) return [];
  const yo = yo_(), estado = String(f.estado || '').trim(), q = textoNormal(f.texto), reqF = String(f.req || '').trim().toUpperCase();
  const mias = {};
  if (!compras) {
    filasDeArea_(hojaReq_(libro), HOJAS_COMPRAS, 'Requisiciones').forEach(r => {
      const sol = String(r[3] || '').toLowerCase(), rec = String(r[23] || '').toLowerCase() || sol;
      if (sol === yo || rec === yo) mias[String(r[0]).toUpperCase()] = true;
    });
  }
  const proyectos = mapaProyectos_(), ordenes = ordenesPorFolio_(libro);
  // Revisión 5b: quien pide ve "Ver foto" solo si tiene acceso a la carpeta de compras (como en Mis requisiciones, accesoFotos_)
  const verFoto = compras || accesoFotos_(yo);
  return devolucionesDelLibro_(libro).filter(dv => !esAnulado_(dv.folio) && !esAnulado_(dv.reqFolio) && !esAnulado_(dv.ocFolio) &&
    (compras || mias[dv.reqFolio.toUpperCase()]) && (!estado || dv.estado === estado) && (!reqF || dv.reqFolio.toUpperCase() === reqF))
    .map(dv => devolucionParaVista_(dv, proyectos, ordenes, compras, verFoto))
    .filter(dv => !q || textoNormal([dv.folio, dv.reqFolio, dv.proyectoVisible, dv.proyectoNombre, dv.descripcion, dv.tipo, dv.reporto,
      dv.ocFolio || ''].join(' ')).includes(q))
    .reverse().slice(0, 300);
}

/**
 * Lo que la interfaz ve de una devolución (sin montos; la orden y la nota de compras solo para compras). verFoto: la liga a la foto
 * (compras siempre; quien pide solo con acceso a la carpeta de compras, accesoFotos_). Sin verFoto, como compras.
 */
function devolucionParaVista_(dv, proyectos, ordenes, compras, verFoto) {
  const conFoto = verFoto === undefined ? !!compras : !!verFoto;
  const p = proyectos[dv.proyectoFolio.toUpperCase()];
  const o = ordenes[dv.ocFolio.toUpperCase()];
  const ren = o && o.renglones ? o.renglones[dv.renglon - 1] : null;
  const x = { folio: dv.folio, fecha: dv.fecha, reqFolio: dv.reqFolio, proyectoFolio: dv.proyectoFolio,
    proyectoVisible: p ? p.folioVisible : dv.proyectoFolio, proyectoNombre: p ? p.nombre : '', renglon: dv.renglon,
    descripcion: dv.descripcion, cantidad: dv.cantidad, unidad: ren ? ren.unidad || '' : '', tipo: dv.tipo, comentario: dv.comentario,
    fotoUrl: conFoto && /^https?:/.test(dv.fotoUrl) ? dv.fotoUrl : '', fotoPendiente: dv.fotoId.indexOf(MARCA_FOTO_CENTRO) === 0,
    origen: dv.origen, reporto: dv.reportoEmail, estado: dv.estado, resolucion: dv.resolucion, guia: dv.guia,
    resolvio: dv.resolvioEmail, fechaResolucion: dv.fechaResolucion };
  if (compras) Object.assign(x, { ocFolio: dv.ocFolio, notaResolucion: dv.notaResolucion, puedeResolver: dv.estado === DEV_ABIERTA });
  return x;
}

/**
 * Compras (o super admin) resuelve una devolución Abierta: d = {resolucion (Reponer · Devolver al proveedor · Cancelar renglón ·
 * Conservar), nota (obligatoria al devolver o cancelar), guia (opcional), idSolicitud}. Reponer: movimiento negativo "Devolución
 * DEV-…" y el renglón vuelve a por recibir (la requisición regresa de Recibida/Cerrada a Autorizada, Pagada o En camino según su
 * orden). Devolver/Cancelar: movimiento negativo y el renglón queda cerrado con faltante aceptado. Conservar: nada cambia. Si ya
 * no queda otra abierta y la requisición estaba retenida (Recibida con la orden pagada), se cierra. Proyecto ligado: oc.devolucion.
 */
function resolverDevolucion(folioDev, d) {
  if (!VENDEDOR_) throw errorSesion_('Inicia sesión con tu cuenta @' + DOMINIO_HELGEN + '.');
  if (!esCompras_() && !esSuperAdmin_()) throw errorPermiso_('Solo compras resuelve devoluciones.');
  const d0 = d || {};
  const r = normalizarResolucion(d0);
  const libro = libroCompras_();
  const idSolicitud = String(d0.idSolicitud || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const claveCache = idSolicitud ? 'DVR_' + idSolicitud : '';
  return conAvisoPortal_(conCandado_(() => {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) return JSON.parse(previo);
    }
    const folio = String(folioDev || '').trim().toUpperCase();
    const dev = devolucionesDelLibro_(libro).find(x => x.folio.toUpperCase() === folio);
    if (!dev || esAnulado_(dev.folio)) throw new Error('No existe la devolución ' + folio + '.');
    if (dev.estado !== DEV_ABIERTA) throw new Error('La devolución ' + dev.folio + ' ya está resuelta (' + dev.resolucion + ').');
    const { hoja, req } = buscarReq_(libro, dev.reqFolio);
    const { hoja: hO, orden } = buscarOrden_(libro, dev.ocFolio);
    const efecto = efectoResolucion(r.resolucion, dev.tipo, dev.origen);
    const avance = avanceDeReq_(libro, req, orden);
    const linea = avance.lineas.find(l => l.renglon === dev.renglon);
    const t = textoCelda, ahora = ahoraTexto_();
    // Cuánto se mueve: lo devuelto (descuenta lo recibido) o, en un faltante del sitio, lo que ya no se espera (hasta lo pendiente)
    const cantidadMov = !efecto.movimiento || !linea ? 0 : efecto.signo < 0 ? dev.cantidad : Math.min(dev.cantidad, linea.pendiente);
    if (efecto.movimiento && efecto.signo < 0 && (!linea || linea.recibido + 1e-9 < dev.cantidad)) {
      throw new Error('Del renglón ' + dev.renglon + ' ya no hay ' + dev.cantidad + ' recibidos (¿se canceló la recepción?): resuélvela como "Conservar" o revisa las recepciones.');
    }
    if (cantidadMov > 1e-9) {
      escribe_(hojaCompras_(libro, 'MovimientosInventario')).appendRow(conFotoMov_([dev.folio, textoFecha_(hoyIso_()), ahora, efecto.movimiento,
        t(req.sitio), req.proyectoFolio, req.folio, orden.folio, dev.renglon, t(linea.clave), t(linea.descripcion), t(linea.unidad),
        efecto.signo * cantidadMov, t(yo_()), t(nombreYo_()), t('Devolución ' + dev.folio + ' · ' + r.resolucion), '', '', 'Vigente', '', '', ''], null));
    }
    escribe_(hojaCompras_(libro, 'Devoluciones')).getRange(dev.fila, 15, 1, 6).setValues([[DEV_RESUELTA, r.resolucion, t(r.nota), t(r.guia),
      t(yo_()), "'" + ahora]]);
    MEMO_.devs = null;
    let nuevo = req.estado;
    if (efecto.reabre && (req.estado === REQ_RECIBIDA || req.estado === REQ_CERRADA)) {
      const pagada = orden.estado === OC_PAGADA || orden.estado === OC_RECIBIDA;
      nuevo = transicionReq(req.estado, orden.enCaminoEn ? 'devolucionEnCamino' : pagada ? 'devolucionPagada' : 'devolucionAutorizada');
      if (orden.estado === OC_RECIBIDA) { escribe_(hO).getRange(orden.fila, COL_ESTADO_OC).setValue(OC_PAGADA); orden.estado = OC_PAGADA; }
      escribe_(hO).getRange(orden.fila, COL_ESTADO_OC + 1, 1, 2).setValues([['', '']]); // ya no está recibido todo
      cambiarReq_(hoja, req, nuevo, {});
    } else {
      cambiarReq_(hoja, req, req.estado, {});
    }
    const material = dev.cantidad + ' ' + (linea ? linea.unidad : '') + ' de ' + String(dev.descripcion).slice(0, 60);
    eventoReq_(libro, req.folio, nuevo, 'Devolución ' + dev.folio + ' resuelta: ' + r.resolucion + ' (' + material + '). ' +
      textoResolucionDev(r.resolucion) + (r.guia ? ' Guía de la devolución: ' + r.guia + '.' : ''));
    bitacora_(libro, 'Resolver devolución', req.proyectoFolio, dev.folio + ' · ' + req.folio + ' · ' + orden.folio + ' · renglón ' + dev.renglon +
      ' · ' + r.resolucion + ' · ' + material + (r.guia ? ' · guía ' + r.guia : ''), r.nota, HOJAS_COMPRAS);
    notificar_('dev.resuelta', { req: req.folio, nota: r.nota, dev: { folio: dev.folio, renglon: dev.renglon, descripcion: dev.descripcion,
      cantidad: dev.cantidad, unidad: linea ? linea.unidad : '', tipo: dev.tipo, resolucion: r.resolucion, origen: dev.origen, reporto: dev.reportoEmail } });
    if (proyectoLigado_(req.proyectoFolio)) {
      // origen (contrato §5d, revisión 5b): 'centro' = problema reportado en el sitio (tiene origen_clave); 'capri' = reportado aquí.
      // El centro de mando saca de su stock un Faltante de CAPRI (se contó como recibido) y no uno del sitio (allá nunca entró)
      avisarPortal_('oc.devolucion', orden.folio, { devolucion: { folio: dev.folio, renglon: dev.renglon, cantidad: dev.cantidad, tipo: dev.tipo,
        resolucion: r.resolucion, nota: r.nota, origen: dev.origenClave ? 'centro' : 'capri' } });
    }
    // P (incremento 6): si lo devuelto sin reponer deja la orden cubierta por sus pagos parciales, queda pagada (antes de cerrar)
    if (efecto.movimiento && cantidadMov > 1e-9) nuevo = completarPagoTrasDevolucion_(libro, hoja, req, hO, orden, dev.folio) || nuevo;
    nuevo = cerrarRetenida_(libro, hoja, req, hO, orden) || completarTrasDevolucion_(libro, hoja, req, hO, orden, dev.folio) || nuevo;
    SpreadsheetApp.flush();
    const resultado = { folio: dev.folio, estado: nuevo, vista: vistaRequisicion_(libro, req.folio),
      devoluciones: listarDevoluciones({ estado: DEV_ABIERTA }) };
    guardarIdempotencia_(cache, claveCache, resultado);
    return resultado;
  }));
}

/**
 * La resolución aceptó el faltante de lo último que se esperaba (p. ej. un faltante del sitio que ya no se repone): sin
 * devoluciones abiertas y con todo recibido, la requisición en curso se completa como al recibir (pagada → Cerrada y la orden
 * Recibida; sin pagar → Recibida, espera el pago). Devuelve el estado nuevo o ''.
 */
function completarTrasDevolucion_(libro, hoja, req, hO, orden, folioDev) {
  if ([REQ_AUTORIZADA, REQ_PAGADA, REQ_EN_CAMINO].indexOf(req.estado) === -1 || orden.estado === OC_CANCELADA) return '';
  if (devolucionAbiertaDe_(libro, req)) return '';
  const avance = avanceDeReq_(libro, req, orden);
  if (!avance.completo || !avance.algo) return '';
  const pagada = orden.estado === OC_PAGADA, t = textoCelda;
  const nuevo = transicionReq(req.estado, pagada ? 'recibirPagada' : 'recibir');
  if (pagada) { escribe_(hO).getRange(orden.fila, COL_ESTADO_OC, 1, 3).setValues([[OC_RECIBIDA, textoFecha_(hoyIso_()), t(yo_())]]); orden.estado = OC_RECIBIDA; }
  else escribe_(hO).getRange(orden.fila, COL_ESTADO_OC + 1, 1, 2).setValues([[textoFecha_(hoyIso_()), t(yo_())]]);
  cambiarReq_(hoja, req, nuevo, {});
  eventoReq_(libro, req.folio, nuevo, 'Recepción completa: ya no se espera lo que faltaba (' + folioDev + ')' + (pagada ? '.' : ' · falta el pago al proveedor.'));
  bitacora_(libro, 'Completar recepción (devolución resuelta)', req.proyectoFolio, req.folio + ' · ' + orden.folio + ' · ' + folioDev + ' · ' + nuevo, '', HOJAS_COMPRAS);
  return nuevo;
}

/**
 * Requisición retenida por una devolución (Recibida con la orden ya pagada y todo recibido): si ya no queda ninguna abierta, se
 * cierra (la orden queda Recibida). Devuelve el estado nuevo o ''.
 */
function cerrarRetenida_(libro, hoja, req, hO, orden) {
  if (req.estado !== REQ_RECIBIDA || orden.estado !== OC_PAGADA || devolucionAbiertaDe_(libro, req)) return '';
  if (!avanceDeReq_(libro, req, orden).completo) return '';
  const nuevo = transicionReq(req.estado, 'cerrarRetenida');
  escribe_(hO).getRange(orden.fila, COL_ESTADO_OC).setValue(OC_RECIBIDA);
  orden.estado = OC_RECIBIDA;
  cambiarReq_(hoja, req, nuevo, {});
  eventoReq_(libro, req.folio, nuevo, 'Cerrada: ya no hay devoluciones abiertas y el material está recibido y pagado.');
  bitacora_(libro, 'Cerrar requisición (devoluciones resueltas)', req.proyectoFolio, req.folio + ' · ' + orden.folio + ' recibida', '', HOJAS_COMPRAS);
  return nuevo;
}

// -- Lo que ven las pantallas --

/**
 * Para "Mis requisiciones" (quien pide o recibe): sus devoluciones (sin orden ni nota de compras), los renglones donde puede
 * reportar un problema y, solo si tiene acceso a la carpeta de compras en Drive, las ligas "Ver foto".
 */
function recepcionParaSolicitante_(libro, req, orden, movs, yo) {
  const o = orden && ocVigente(orden) ? orden : null;
  const devs = devolucionesDelLibro_(libro).filter(d => d.reqFolio.toUpperCase() === req.folio.toUpperCase() && !esAnulado_(d.folio));
  const x = { devoluciones: devs.map(d => ({ folio: d.folio, fecha: d.fecha, renglon: d.renglon, descripcion: d.descripcion,
    cantidad: d.cantidad, tipo: d.tipo, comentario: d.comentario, estado: d.estado, resolucion: d.resolucion, guia: d.guia,
    origen: d.origen })), reportables: [], fotos: [] };
  if (!o) return x;
  const avance = avanceRecepcion(o.renglones, movs, renglonesSinRecepcion(propuestaVigente_(req)));
  x.reportables = renglonesReportables_(libro, req, o, avance);
  if (accesoFotos_(yo)) x.fotos = fotosDeMovimientos_(movs).concat(devs.filter(d => /^https?:/.test(d.fotoUrl))
    .map(d => ({ folio: d.folio, renglon: d.renglon, descripcion: d.descripcion, url: d.fotoUrl, tipo: 'Problema' })));
  return x;
}

/** Para la requisición en Compras: devoluciones completas, renglones reportables, fotos de "Lo recogí" y catálogos del formulario. */
function recepcionParaCompras_(libro, req, orden, movs, avance) {
  const proyectos = mapaProyectos_(), ordenes = {};
  if (orden) ordenes[orden.folio.toUpperCase()] = orden;
  const devs = devolucionesDelLibro_(libro).filter(d => d.reqFolio.toUpperCase() === req.folio.toUpperCase() && !esAnulado_(d.folio))
    .map(d => devolucionParaVista_(d, proyectos, ordenes, true));
  let recogido = [];
  if (orden && esRecogido(orden.paqueteria)) {
    recogido = fotosDeMovimientos_(filasDeArea_(hojaCompras_(libro, 'MovimientosInventario'), HOJAS_COMPRAS, 'MovimientosInventario')
      .map((r, i) => movDesdeFila_(r, i + 2)).filter(m => m.tipo === TIPO_RECOGIDO && m.ocFolio.toUpperCase() === orden.folio.toUpperCase() &&
        m.estado === 'Vigente'));
  }
  return { devoluciones: devs, reportables: orden && orden.estado !== OC_CANCELADA ? renglonesReportables_(libro, req, orden, avance) : [],
    fotosRecogido: recogido, tiposDev: TIPOS_DEV, resolucionesDev: RESOLUCIONES_DEV };
}

/** "Ver foto" de los movimientos que ya tienen su foto en Drive: [{folio, renglon, descripcion, url, tipo, fecha, nombre}]. */
function fotosDeMovimientos_(movs) {
  return (movs || []).filter(m => m.estado === 'Vigente' && /^https?:/.test(m.fotoUrl || '')).map(m => ({ folio: m.folio, renglon: m.renglon,
    descripcion: m.descripcion, url: m.fotoUrl, tipo: m.tipo === TIPO_RECOGIDO ? 'Lo recogí' : 'Recepción', fecha: m.fecha, nombre: m.nombre }));
}

/**
 * ¿La persona puede abrir las fotos en Drive? (editor o lector de la carpeta de compras, que se comparte por persona; el dueño
 * siempre). Una hora en caché; si Drive no contesta, no (la vista de quien pidió no muestra la liga).
 */
function accesoFotos_(correo) {
  const c = String(correo || '').toLowerCase();
  if (!c) return false;
  if (!MEMO_.accesoFotos) {
    const cache = CacheService.getScriptCache();
    let lista = null;
    try { lista = JSON.parse(cache.get('ACCESO_FOTOS') || 'null'); } catch (e) { lista = null; }
    if (!Array.isArray(lista)) {
      try {
        const f = carpetaCompras_();
        lista = f.getEditors().concat(f.getViewers()).map(u => String(u.getEmail()).toLowerCase());
        try { lista.push(String(f.getOwner().getEmail()).toLowerCase()); } catch (e) { /* sin dueño visible */ }
        cache.put('ACCESO_FOTOS', JSON.stringify(lista), 3600);
      } catch (e) {
        lista = [];
      }
    }
    MEMO_.accesoFotos = lista;
  }
  return MEMO_.accesoFotos.indexOf(c) !== -1;
}

/** Devoluciones abiertas para Pendientes de compras (en caché por versión). */
function devolucionesParaPendientes_() {
  return enCache_('devPend', ['requisiciones', 'oc', 'proyectos', 'anulaciones'], TTL_CACHE, () => {
    const libro = libroComprasSiExiste_();
    if (!libro) return [];
    const abiertas = devolucionesDelLibro_(libro).filter(d => d.estado === DEV_ABIERTA && !esAnulado_(d.folio) && !esAnulado_(d.reqFolio) &&
      !esAnulado_(d.ocFolio)); // revisión: la de una orden anulada ya no se resuelve
    if (!abiertas.length) return [];
    const proyectos = mapaProyectos_(), ordenes = ordenesPorFolio_(libro);
    return abiertas.map(d => Object.assign(devolucionParaVista_(d, proyectos, ordenes, true), { desde: marcaOrdenable(d.fecha) }));
  });
}

// -- Centro de mando: fotos y problemas que llegan con sus recepciones (contrato §5) --

/**
 * Fotos por archivar y problemas de una recepción del centro de mando (dentro del candado; no llama al centro de mando):
 * cada foto no archivada se anota en res.fotos para bajarla después; cada problema crea su DEV una sola vez (origen_clave).
 */
function fotosYProblemasPortal_(libro, x, orden, req, res, folioRec, movs, soloFotos) {
  const recibio = String(x.recibio == null ? '' : x.recibio).trim().replace(/\s+/g, ' ').slice(0, 60) || CORREO_CENTRO_MANDO;
  res.fotos = res.fotos || [];
  // Folio REC del movimiento que ya espera esa foto ("centro:<id>"): el archivo se llama como su recepción
  const marcados = {};
  (movs || movimientosPorOc_(libro)[orden.folio.toUpperCase()] || []).forEach(m => {
    if (m.fotoId.indexOf(MARCA_FOTO_CENTRO) === 0) marcados[m.fotoId.slice(MARCA_FOTO_CENTRO.length)] = m.folio;
  });
  (Array.isArray(x.renglones) ? x.renglones : []).forEach(l => {
    const n = Number(l && l.n);
    if (!(n > 0)) return;
    const base = { oc: orden.folio, req: req.folio, proyecto: req.proyectoFolio, renglon: n };
    const f = fotoPortal(l.foto);
    if (f && !f.archivada) res.fotos.push(Object.assign({ id: f.id, destino: 'mov', folio: marcados[f.id] || folioRec || req.folio }, base));
    const p = l.problema && typeof l.problema === 'object' ? l.problema : null;
    if (!p) return;
    const pf = fotoPortal(p.foto);
    if (soloFotos) { // orden cancelada o anulada: no hay DEV que crear; la foto se guarda igual (queda en la Bitacora)
      if (pf && !pf.archivada) res.fotos.push(Object.assign({ id: pf.id, destino: 'dev', folio: req.folio }, base));
      return;
    }
    const clave = claveProblemaPortal(orden.folio, n, p);
    let dev = devolucionesDelLibro_(libro).find(d => d.origenClave === clave);
    if (!dev) {
      // Contrato §5 (revisión 5b): problema.por = quien lo reportó en el sitio; si no viene, quien recibió el renglón
      const por = String(p.por == null ? '' : p.por).trim().replace(/\s+/g, ' ').slice(0, 60);
      const folio = crearDevolucionPortal_(libro, req, orden, n, p, pf, por || recibio, clave);
      if (!folio) return;
      (res.devoluciones = res.devoluciones || []).push(folio);
      dev = { folio: folio };
    }
    if (pf && !pf.archivada) res.fotos.push(Object.assign({ id: pf.id, destino: 'dev', folio: dev.folio }, base));
  });
}

/**
 * Fotos de una recepción del centro de mando de una orden que CAPRI no tiene (revisión 5b): se archivan igual en
 * Compras/AAAA/_sin-orden/ (privada) para que el centro de mando las borre; no hay movimiento ni devolución donde anotarlas
 * (queda en la Bitacora). El nombre del archivo lleva el folio de la orden si tiene forma de folio.
 */
function fotosSinOrdenPortal_(x, ocFolio, res) {
  res.fotos = res.fotos || [];
  const folio = /^[A-Z]{2,6}-\d{4}-\d{1,8}$/.test(ocFolio) ? ocFolio : 'SIN-ORDEN';
  (Array.isArray(x.renglones) ? x.renglones : []).forEach(l => {
    const n = Number(l && l.n) || 0;
    [fotoPortal(l && l.foto), fotoPortal(l && l.problema && l.problema.foto)].forEach(f => {
      if (f && !f.archivada) res.fotos.push({ id: f.id, destino: 'ninguno', sinOrden: true, folio: folio, oc: ocFolio, req: '', proyecto: '', renglon: n });
    });
  });
}

/** Carpeta privada Compras/AAAA/_sin-orden/ (fotos del centro de mando de órdenes que CAPRI no tiene). */
function carpetaSinOrden_() {
  return privado_(subcarpeta_(privado_(subcarpeta_(carpetaCompras_(), hoyIso_().slice(0, 4))), SUBCARPETA_SIN_ORDEN));
}

/** DEV de un problema reportado en el sitio (origen Centro de mando, reportó = problema.por o quien recibió). '' si el renglón no existe. */
function crearDevolucionPortal_(libro, req, orden, n, p, pf, recibio, clave) {
  const linea = avanceDeReq_(libro, req, orden).lineas.find(l => l.renglon === n);
  if (!linea) return '';
  const pedida = Number(p.cantidad);
  const recibido = Math.max(0, linea.recibido);
  const tipo = TIPOS_DEV.find(t => textoNormal(t) === textoNormal(p.tipo)) || 'Otro';
  // Un faltante o un sobrante del sitio no se contó como recibido: su cantidad no se recorta a lo recibido
  const tope = tipo === 'Faltante' || tipo === 'Sobrante' ? Infinity : recibido > 0 ? recibido : Infinity;
  const cantidad = Math.round((isFinite(pedida) && pedida > 0 ? Math.min(pedida, tope) : recibido || 1) * 10000) / 10000;
  const comentario = String(p.comentario == null ? '' : p.comentario).trim().replace(/\s+/g, ' ').slice(0, 500) ||
    'Reportado en el centro de mando (sin comentario).';
  const foto = pf ? (pf.archivada && /^https?:/.test(pf.url) ? { id: '', url: pf.url } : { id: MARCA_FOTO_CENTRO + pf.id, url: '' }) : null;
  return crearDevolucion_(libro, req, orden, { renglon: n, descripcion: linea.descripcion, unidad: linea.unidad, cantidad: cantidad,
    tipo: tipo, comentario: comentario, foto: null }, { origen: ORIGEN_DEV_CENTRO, reporto: recibio, clave: clave, foto: foto });
}

/**
 * Fuera del candado: baja cada foto pendiente del centro de mando (GET firmado), la guarda en Drive (privada, en Recepciones),
 * anota foto_id / foto_url en su movimiento o devolución y avisa que se archivó (POST firmado). Lo que falle va a res.errores
 * (la última consulta no avanza y el centro de mando la vuelve a ofrecer); un 404 = ya no existe o ya se archivó (nada que hacer).
 */
function archivarFotosPortal_(cfg, libro, res) {
  const vistas = {}, cache = CacheService.getScriptCache();
  res.archivadas = 0; res.fotosPerdidas = res.fotosPerdidas || [];
  (res.fotos || []).filter(f => !vistas[f.id] && (vistas[f.id] = true)).slice(0, MAX_FOTOS_PORTAL).forEach(tarea => {
    try {
      let url = cache.get('FOTOCM_' + tarea.id) || ''; // ya está en Drive: solo falta avisar que se archivó
      if (!url) {
        const g = descargarFotoPortal_(cfg, tarea.id);
        if (g.codigo === 404) { res.fotosPerdidas.push(tarea.id); return; }
        if (!g.ok) { res.errores.push('Foto ' + tarea.id + ': ' + g.error); return; }
        const tipo = validarFoto(g.bytes);
        const carpeta = tarea.sinOrden ? carpetaSinOrden_() : carpetaRecepciones_(tarea.proyecto); // revisión 5b: sin orden en CAPRI
        const archivo = privado_(carpeta.createFile(Utilities.newBlob(g.bytes, tipo.mime, nombreArchivoFoto(tarea.folio, tarea.renglon, tipo.ext))));
        url = archivo.getUrl();
        comoCentroMando_(() => conCandado_(() => anotarFotoPortal_(libro, tarea, archivo.getId(), url)));
        cache.put('FOTOCM_' + tarea.id, url, 21600);
      }
      const a = llamarPortal_(cfg, 'post', cfg.url + RUTA_PORTAL_FOTO_ARCHIVADA, jsonAscii({ id: tarea.id, url: url }));
      if (!a.ok) { res.errores.push('Foto ' + tarea.id + ' (aviso de archivada): ' + a.error); return; }
      res.archivadas++;
    } catch (e) {
      res.errores.push('Foto ' + tarea.id + ': ' + String(e && e.message || e).slice(0, 200));
    }
  });
}

/** GET firmado de una foto del centro de mando: {ok, codigo, bytes, error}. Nunca lanza error. */
function descargarFotoPortal_(cfg, id) {
  const tiempo = isoConZona_(new Date());
  let r;
  try {
    r = UrlFetchApp.fetch(cfg.url + RUTA_PORTAL_FOTO + '?id=' + encodeURIComponent(id), { method: 'get', muteHttpExceptions: true,
      followRedirects: false, headers: { 'X-Hbox-Tiempo': tiempo, 'X-Hbox-Firma': 'sha256=' + firmaPortal_(cfg.secreto, tiempo, '') } });
  } catch (e) {
    return { ok: false, codigo: 0, error: 'Sin respuesta del centro de mando: ' + String(e && e.message || e).slice(0, 200) };
  }
  const codigo = r.getResponseCode();
  if (codigo !== 200) return { ok: false, codigo: codigo, error: 'El centro de mando respondió ' + codigo };
  return { ok: true, codigo: codigo, bytes: r.getContent() };
}

/**
 * Anota la foto ya guardada en Drive (dentro del candado): el movimiento o la devolución con foto_id "centro:<id>"; si no hay
 * (recepción de antes del incremento 5, o registrada por compras), la última entrada vigente de ese renglón sin foto. Si no hay
 * dónde, queda en la Bitacora (la foto ya está en Drive).
 */
function anotarFotoPortal_(libro, tarea, id, url) {
  if (tarea.sinOrden) {
    bitacora_(libro, 'Foto del centro de mando de una orden que CAPRI no tiene', '', tarea.oc + ' · renglón ' + tarea.renglon + ' · ' + url, '', HOJAS_COMPRAS);
    return '';
  }
  const marca = MARCA_FOTO_CENTRO + tarea.id, cI = colMov_('foto_id');
  const hM = hojaCompras_(libro, 'MovimientosInventario');
  const filas = filasDeArea_(hM, HOJAS_COMPRAS, 'MovimientosInventario');
  let i = filas.findIndex(r => String(r[cI - 1]) === marca);
  if (i === -1 && tarea.destino === 'mov') {
    for (let k = filas.length - 1; k >= 0; k--) {
      const m = movDesdeFila_(filas[k], k + 2);
      if (m.ocFolio.toUpperCase() === String(tarea.oc).toUpperCase() && m.renglon === tarea.renglon && m.tipo === TIPO_ENTRADA_COMPRA &&
        m.estado === 'Vigente' && !m.fotoId && !m.fotoUrl) { i = k; break; }
    }
  }
  if (i !== -1) { escribe_(hM).getRange(i + 2, cI, 1, 2).setValues([[id, url]]); return 'mov'; }
  const hD = hojaCompras_(libro, 'Devoluciones'), cD = HOJAS_COMPRAS.Devoluciones.enc.indexOf('foto_id') + 1;
  const j = filasDeArea_(hD, HOJAS_COMPRAS, 'Devoluciones').findIndex(r => String(r[cD - 1]) === marca);
  if (j !== -1) { escribe_(hD).getRange(j + 2, cD, 1, 2).setValues([[id, url]]); MEMO_.devs = null; return 'dev'; }
  bitacora_(libro, 'Foto del centro de mando sin renglón', tarea.proyecto, tarea.oc + ' · renglón ' + tarea.renglon + ' · ' + url, '', HOJAS_COMPRAS);
  return '';
}

/**
 * ¿La recepción del centro de mando (cuando) es de antes de que compras resolviera "Reponer" en ese renglón? Entonces su
 * cantidad ya está contada (y su "completa" es vieja). Devuelve una función renglon → bool. Revisión 5b: al segundo y estrictamente
 * antes (<): con la comparación por minuto y <=, la reposición recibida en el mismo minuto que "Reponer" nunca se contaba. La hora
 * de "Reponer" sale de la DEV (fecha_resolucion, al segundo; resueltas = {FOLIO DEV: 'AAAA-MM-DD HH:mm:ss'}); si no se encuentra,
 * del registro del movimiento (al minuto).
 */
function recepcionAntesDeReponer_(movs, cuando, sinAvisar, resueltas) {
  const fecha = new Date(String(cuando || ''));
  const recibida = isNaN(fecha.getTime()) ? '' : Utilities.formatDate(fecha, 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss');
  const reposicion = {};
  (movs || []).forEach(m => {
    if (m.tipo !== TIPO_DEVOLUCION || m.estado !== 'Vigente') return;
    const t = (resueltas || {})[String(m.folio).toUpperCase()] || (marcaOrdenable(m.fechaRegistro) + ':00');
    if (t > (reposicion[m.renglon] || '')) reposicion[m.renglon] = t;
  });
  // sinAvisar: el centro de mando todavía no recibe el oc.devolucion de esa orden (su "recibido" aún no baja): nada nuevo en
  // los renglones repuestos hasta que lo reciba
  return renglon => !!reposicion[renglon] && (!!sinAvisar || !recibida || recibida < reposicion[renglon]);
}

/** {FOLIO DEV: 'AAAA-MM-DD HH:mm:ss'} de las devoluciones resueltas con "Reponer" de una orden (para recepcionAntesDeReponer_). */
function reposicionesDeOrden_(libro, ocFolio) {
  const f = String(ocFolio || '').toUpperCase(), r = {};
  devolucionesDelLibro_(libro).forEach(d => {
    if (d.ocFolio.toUpperCase() === f && d.estado === DEV_RESUELTA && d.resolucion === RES_REPONER && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(d.fechaResolucion)) {
      r[d.folio.toUpperCase()] = d.fechaResolucion;
    }
  });
  return r;
}

/** ¿Hay en PortalPendientes un aviso de ese tipo de la orden que todavía no llega (Pendiente)? */
function avisoPendiente_(libro, folioOc, tipo) {
  if (!libro.getSheetByName('PortalPendientes')) return false;
  const p = (String(folioOc) + ':' + tipo + ':').toUpperCase();
  return filasDeArea_(hojaCompras_(libro, 'PortalPendientes'), HOJAS_COMPRAS, 'PortalPendientes')
    .some(r => String(r[0] || '').toUpperCase().indexOf(p) === 0 && String(r[5] || '') === 'Pendiente');
}

// -- Recepción y devoluciones: lógica pura (sin servicios de Google; se prueba en Node) --

/** ¿El movimiento cuenta en el avance de la recepción? (entradas por compra y devoluciones). */
function cuentaEnRecepcion(tipo) {
  return tipo === TIPO_ENTRADA_COMPRA || tipo === TIPO_DEVOLUCION || tipo === TIPO_DEVOLUCION_CIERRA || tipo === TIPO_FALTANTE_ACEPTADO;
}

/** Tipo real de una foto (imagen JPG, PNG o HEIC; máximo 10 MB). bytes con o sin signo. Devuelve {mime, ext}. */
function validarFoto(bytes) {
  if (!bytes || !bytes.length) throw new Error('Toma la foto del material.');
  if (bytes.length > MAX_FOTO) throw new Error('La foto pesa más de 10 MB: vuelve a tomarla (CAPRI la comprime sola).');
  const t = validarArchivo(bytes, 'la foto', 'La foto');
  if (t.ext === 'pdf') throw new Error('La foto debe ser una imagen (JPG, PNG o HEIC), no un PDF.');
  return t;
}

/** "REC-2026-0001 — r1.jpg" (con " (n)" desde el segundo archivo con el mismo nombre). */
function nombreArchivoFoto(folio, renglon, ext, n) {
  return String(folio) + ' — r' + Number(renglon) + (n > 1 ? ' (' + n + ')' : '') + '.' + String(ext || 'jpg');
}

/**
 * Problema reportado: p = {tipo, comentario, cantidad}; linea = {descripcion, unidad, disponible (recibido que no está en otra
 * devolución abierta)}; conFoto. Comentario de 5 a 500; cantidad > 0 y no mayor a lo disponible; foto obligatoria salvo
 * Faltante. Devuelve {tipo, comentario, cantidad}.
 */
function normalizarProblema(p, linea, conFoto) {
  const d = p || {}, l = linea || {};
  const desc = '"' + String(l.descripcion || 'el renglón').slice(0, 40) + '"';
  const tipo = TIPOS_DEV.find(t => textoNormal(t) === textoNormal(d.tipo));
  if (!tipo) throw new Error('Elige qué pasó con ' + desc + ': ' + TIPOS_DEV.join(', ') + '.');
  const comentario = String(d.comentario == null ? '' : d.comentario).trim().replace(/\s+/g, ' ');
  if (comentario.length < 5) throw new Error('Describe el problema de ' + desc + ' (mínimo 5 caracteres).');
  if (comentario.length > 500) throw new Error('El comentario del problema debe tener máximo 500 caracteres.');
  const txt = d.cantidad, cantidad = txt === '' || txt == null ? NaN : Number(txt);
  if (!isFinite(cantidad) || cantidad <= 0) throw new Error('Escribe cuántos ' + (l.unidad || '') + ' de ' + desc + ' tienen el problema.');
  const disponible = Number(l.disponible);
  if (isFinite(disponible) && cantidad > disponible + 1e-9) {
    throw new Error('De ' + desc + ' solo hay ' + Math.max(0, disponible) + ' ' + (l.unidad || '') + ' recibidos para reportar.');
  }
  if (!conFoto && tipo !== 'Faltante') throw new Error('Toma una foto del problema de ' + desc + ' (solo un faltante puede ir sin foto).');
  return { tipo: tipo, comentario: comentario, cantidad: Math.round(cantidad * 10000) / 10000 };
}

/** Resolución de compras: d = {resolucion, nota, guia}. Nota obligatoria (≥ 5) al devolver o cancelar; guía opcional (≤ 60). */
function normalizarResolucion(d) {
  const x = d || {};
  const resolucion = RESOLUCIONES_DEV.find(r => textoNormal(r) === textoNormal(x.resolucion));
  if (!resolucion) throw new Error('Elige la resolución: ' + RESOLUCIONES_DEV.join(', ') + '.');
  const nota = String(x.nota == null ? '' : x.nota).trim().replace(/\s+/g, ' ');
  if (nota.length > 500) throw new Error('La nota debe tener máximo 500 caracteres.');
  if ((resolucion === RES_DEVOLVER || resolucion === RES_CANCELAR) && nota.length < 5) {
    throw new Error(resolucion === RES_DEVOLVER ? 'Escribe la nota de la devolución (nota de crédito o reembolso).'
      : 'Escribe por qué se cancela el renglón.');
  }
  const guia = String(x.guia == null ? '' : x.guia).trim().replace(/\s+/g, ' ');
  if (guia.length > 60) throw new Error('La guía de la devolución debe tener máximo 60 caracteres.');
  return { resolucion: resolucion, nota: nota, guia: guia };
}

/**
 * Efecto de una resolución: {movimiento (tipo del movimiento o ''), signo (−1 descuenta lo recibido; +1 solo baja lo que se
 * espera), reabre (el renglón vuelve a por recibir)}. Lo que nunca se contó como recibido no se descuenta (igual que el centro
 * de mando): un Sobrante (no se recibe más de lo pedido) y un Faltante reportado en el centro de mando (allá se recibió lo que
 * llegó). En CAPRI un Faltante es "se registró como recibido pero no llegó": sí se descuenta.
 */
function efectoResolucion(resolucion, tipo, origen) {
  const nada = { movimiento: '', signo: 0, reabre: false };
  if (resolucion === RES_CONSERVAR || tipo === 'Sobrante') return nada;
  const reponer = resolucion === RES_REPONER;
  if (!reponer && resolucion !== RES_DEVOLVER && resolucion !== RES_CANCELAR) return nada;
  if (tipo === 'Faltante' && origen === ORIGEN_DEV_CENTRO) return reponer ? nada : { movimiento: TIPO_FALTANTE_ACEPTADO, signo: 1, reabre: false };
  return reponer ? { movimiento: TIPO_DEVOLUCION, signo: -1, reabre: true } : { movimiento: TIPO_DEVOLUCION_CIERRA, signo: -1, reabre: false };
}

/**
 * La devolución que impide cancelar o anular una recepción (null si ninguna): de la misma orden, en alguno de los renglones de la
 * recepción, Abierta o Resuelta con algo distinto de Conservar (sin esa recepción, lo recibido del renglón quedaría negativo o la
 * devolución se quedaría sin material). devs = [{folio, ocFolio, renglon, estado, resolucion}]. La usan cancelarRecepcion y Anular.
 */
function devolucionQueImpideCancelar(devs, ocFolio, renglones) {
  const f = String(ocFolio || '').toUpperCase(), rs = (renglones || []).map(Number);
  return (devs || []).find(x => String(x.ocFolio || '').toUpperCase() === f && rs.indexOf(Number(x.renglon)) !== -1 &&
    (x.estado === DEV_ABIERTA || (x.estado === DEV_RESUELTA && x.resolucion !== RES_CONSERVAR))) || null;
}

/** ¿El movimiento es de una devolución (folio DEV-…)? Anular lo trata con su devolución, no como una recepción. */
function esMovimientoDeDevolucion(tipo) {
  return tipo === TIPO_DEVOLUCION || tipo === TIPO_DEVOLUCION_CIERRA || tipo === TIPO_FALTANTE_ACEPTADO;
}

/** Texto de cada resolución (historial y correos). */
function textoResolucionDev(resolucion) {
  return ({ [RES_REPONER]: 'El proveedor manda el material otra vez: queda por recibir.',
    [RES_DEVOLVER]: 'Se devuelve al proveedor (nota de crédito o reembolso): ese material ya no se espera.',
    [RES_CANCELAR]: 'Se cancela lo reportado: ese material ya no se espera.',
    [RES_CONSERVAR]: 'Se conserva como llegó.' })[resolucion] || '';
}

/** Nota del historial de una requisición que no se cierra por una devolución abierta. */
function textoRetenida(folioDev) {
  return 'queda Recibida (sin cerrar) hasta que compras resuelva la devolución ' + folioDev;
}

/** ¿Hoy (AAAA-MM-DD) está dentro de los 30 días para reportar desde que se recibió (desde)? Sin fecha, sí. */
function dentroDeVentanaDev(desde, hoy) {
  const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  return !ok(desde) || !ok(hoy) || diasEntre(desde, hoy) <= DIAS_REPORTAR_DEV;
}

/** Foto de una recepción del centro de mando: {id, archivada, url} o null (id solo [A-Za-z0-9._-], ≤ 80). */
function fotoPortal(f) {
  if (!f || typeof f !== 'object') return null;
  const id = String(f.id == null ? '' : f.id).trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) return null;
  const url = String(f.url == null ? '' : f.url).trim();
  return { id: id, archivada: f.archivada === true, url: /^https:\/\//i.test(url) ? url.slice(0, 500) : '' };
}

/** Llave de un problema del centro de mando (una DEV por OC, renglón y foto del problema o, sin foto, comentario). */
function claveProblemaPortal(ocFolio, n, p) {
  const x = p || {}, f = fotoPortal(x.foto);
  if (f) return String(ocFolio).toUpperCase() + ':' + Number(n) + ':f:' + f.id;
  const texto = [x.tipo, x.cantidad, x.comentario].map(v => String(v == null ? '' : v).trim()).join('|');
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h * 33) ^ texto.charCodeAt(i)) >>> 0;
  return String(ocFolio).toUpperCase() + ':' + Number(n) + ':c:' + h.toString(16);
}

// ---- 6.P Pagos parciales a proveedores (incremento 6; contrato en docs/incremento-6.md §1–2) ----
// Spec aprobado por Leo (decisiones 1–3, con sus valores por omisión). Una orden acepta varios pagos (PGP-) hasta quedar
// completa; cada pago guarda su tipo (Anticipo antes de recibir, Parcial, Liquidación el que la completa). Sin estado nuevo: la
// orden sigue Emitida hasta completar (entonces Pagada, o Recibida si ya se recibió) y la interfaz muestra la etiqueta derivada
// "Pagada parcial" (también a quien pidió, sin montos). Con cualquier pago Vigente se puede recibir (decisión 1: recibeAntesDePagar_);
// el primer pago avisa oc.pagada al centro de mando (decisión 2); el plan de pagos es opcional y se captura al autorizar (decisión 3).
// Todo pago sigue las reglas de siempre (comprobante, método, guardia de tarjeta, documentos para transferencia, tipo de cambio,
// idempotencia, candado). R (reportes) usa saldoOrdenCompra (pura) para los pagos esperados del flujo de efectivo.

const TIPO_PAGO_ANTICIPO = 'Anticipo', TIPO_PAGO_PARCIAL = 'Parcial', TIPO_PAGO_LIQUIDACION = 'Liquidación';
const TIPOS_PAGO_PROV = [TIPO_PAGO_ANTICIPO, TIPO_PAGO_PARCIAL, TIPO_PAGO_LIQUIDACION];
/** Etiqueta derivada (no es un estado: la orden sigue Emitida) de una orden con pagos que todavía no la completan. */
const ETIQUETA_PAGADA_PARCIAL = 'Pagada parcial';
const MAX_ETAPAS_PLAN = 10;
const MAX_CONCEPTO_PLAN = 60;

// Aviso por correo a quien recibe (6.B): el primer pago parcial abre "Recibí el material" (sin montos, como req.pagada)
EVENTOS_CORREO.push('req.pagoparcial');

// -- Lógica pura (Node) --

/**
 * Plan de pagos de una orden (opcional; se captura al autorizar o en la propuesta): null (sin plan) o [{concepto, porcentaje}].
 * Acepta el arreglo o su JSON. Renglones vacíos (sin concepto ni porcentaje) se ignoran; si no queda ninguno, null. De 1 a
 * MAX_ETAPAS_PLAN etapas, concepto obligatorio (máx. 60, sin repetir), porcentaje > 0 con 2 decimales y suma exacta de 100%.
 */
function normalizarPlanPago(plan) {
  let lista = plan;
  if (typeof lista === 'string') {
    const s = lista.trim();
    if (!s) return null;
    try { lista = JSON.parse(s); } catch (e) { throw new Error('El plan de pagos no es válido.'); }
  }
  if (lista == null) return null;
  if (!Array.isArray(lista)) throw new Error('El plan de pagos no es válido.');
  const vacio = v => v === '' || v == null || String(v).trim() === '';
  const etapas = lista.filter(e => e && typeof e === 'object' && !(vacio(e.concepto) && vacio(e.porcentaje)));
  if (!etapas.length) return null;
  if (etapas.length > MAX_ETAPAS_PLAN) throw new Error('El plan de pagos admite máximo ' + MAX_ETAPAS_PLAN + ' etapas.');
  const vistos = {};
  const limpio = etapas.map((e, i) => {
    const concepto = String(e.concepto == null ? '' : e.concepto).trim().replace(/\s+/g, ' ');
    const txt = e.porcentaje, porcentaje = Number(txt);
    if (!concepto) throw new Error('La etapa ' + (i + 1) + ' del plan de pagos no tiene concepto (p. ej. Anticipo).');
    if (concepto.length > MAX_CONCEPTO_PLAN) {
      throw new Error('El concepto "' + concepto.slice(0, 20) + '…" del plan de pagos debe tener máximo ' + MAX_CONCEPTO_PLAN + ' caracteres.');
    }
    const k = textoNormal(concepto);
    if (vistos[k]) throw new Error('El concepto "' + concepto + '" está repetido en el plan de pagos.');
    vistos[k] = true;
    if (vacio(txt) || !isFinite(porcentaje) || porcentaje <= 0) throw new Error('El porcentaje de "' + concepto + '" debe ser mayor a 0.');
    if (Math.abs(redondear(porcentaje) - porcentaje) > 1e-9) throw new Error('El porcentaje de "' + concepto + '" admite máximo 2 decimales.');
    return { concepto: concepto, porcentaje: redondear(porcentaje) };
  });
  const suma = limpio.reduce((s, e) => s + Math.round(e.porcentaje * 100), 0);
  if (suma !== 10000) throw new Error('Los porcentajes del plan de pagos deben sumar 100% (suman ' + redondear(suma / 100) + '%).');
  return limpio;
}

/** Plan guardado en la celda plan_pago (JSON); null si está vacía o no es válida (una celda editada a mano no rompe la orden). */
function planDeCelda(v) {
  try { return normalizarPlanPago(v instanceof Date ? '' : v); } catch (e) { return null; }
}

/** "Anticipo 50% ($580.00) · Contra entrega 50% ($580.00)" (montos solo si viene el total). '' sin plan. */
function textoPlanPago(plan, total, moneda) {
  if (!Array.isArray(plan) || !plan.length) return '';
  const montos = total > 0 ? montosDeEsquema(plan.map(e => ({ etapa: e.concepto, porcentaje: e.porcentaje })), total) : null;
  return plan.map((e, i) => e.concepto + ' ' + e.porcentaje + '%' +
    (montos ? ' (' + formatoMoneda(montos[i].monto) + (moneda ? ' ' + moneda : '') + ')' : '')).join(' · ');
}

/** Tipo de un pago a proveedor: Liquidación si completa la orden; si no, Parcial si ya se recibió algo y Anticipo si no. */
function tipoDePagoProv(completo, recibido) {
  return completo ? TIPO_PAGO_LIQUIDACION : recibido ? TIPO_PAGO_PARCIAL : TIPO_PAGO_ANTICIPO;
}

/** Fecha "AAAA-MM-DD" + días, o '' si la fecha no es válida. */
function fechaMasDias_(fecha, dias) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) ? sumarDias(fecha, diasCreditoGuardados(dias)) : '';
}

/**
 * Vencimiento de lo que una orden debe sin factura: recepción (o entrega, o la fecha de la orden) + sus días de crédito; '' si no
 * hay fecha. UNA sola regla para el "siguiente" de saldoOrdenCompra (vista de la orden y fila "Saldo" de Cuentas por pagar) y para
 * los reportes (R: antigüedad de CxP y flujo), así el mismo saldo cae en el mismo rango y la misma semana en todas las pantallas.
 */
function venceSinFactura(o) {
  const x = o || {};
  return fechaMasDias_(x.fechaRecepcion || x.fechaEntrega || x.fecha, x.diasCredito);
}

/**
 * Saldo de una orden de compra (contrato docs/incremento-6.md §1; lo usa R para el flujo de efectivo). orden = {folio, moneda,
 * total, estado, renglones, ivaTasa, fecha, fechaEntrega, fechaRecepcion, diasCredito, planPago} (ordenDesdeFila_); pagos = filas
 * de PagosProveedores de ESA orden (pagoProvDesdeFila_, cualquier estado); movimientos = MovimientosInventario de la orden (lo
 * devuelto sin reponer, regla del incremento 5). Devuelve {esperado, pagado, saldo, completo, vigentes: [{folio, fecha,
 * montoAplicado, tipo}], siguiente: {concepto, monto, vence, etapa?, etapas?} | null} y además moneda, etapas (el plan con lo
 * cubierto de cada una), porFacturas y cancelada.
 * - esperado = totalPorPagarOrden(orden, devueltoSinReponer(movimientos)) o el total; pagado = Σ monto_aplicado de los Vigentes
 *   (en la moneda de la orden); saldo = max(0, esperado − pagado) en centavos; completo = saldo ≤ TOLERANCIA_PAGO.
 * - Opcional orden.facturas (FacturasProveedor de la orden): si sus Vigentes ya cubren la orden y su total es menor (retenciones;
 *   decisión 7 de facturas), el saldo se mide contra ese total (porFacturas) y el vencimiento sale de la factura que sigue por
 *   pagar (FIFO por vencimiento).
 * - Una orden Pagada o Recibida con algún pago Vigente cuenta como completa (el servidor ya lo decidió al registrar el pago que la
 *   completó, también por el total de sus facturas); una Cancelada o Anulada no espera nada.
 * - siguiente: la etapa del plan que sigue (montos del plan sobre lo esperado, la última absorbe los centavos), o el saldo si no hay
 *   plan. vence: la factura que sigue por pagar; si no hay, la primera etapa de un plan de varias = la fecha de la orden (anticipo)
 *   y lo demás = recepción (o entrega, o la orden) + días de crédito.
 */
function saldoOrdenCompra(orden, pagos, movimientos) {
  const o = orden || {};
  const may = s => String(s || '').trim().toUpperCase();
  const tol = aCentavos(TOLERANCIA_PAGO);
  const vigentes = (pagos || []).filter(p => p && p.estado === 'Vigente' && (!o.folio || !p.ocFolio || may(p.ocFolio) === may(o.folio)))
    .map(p => ({ folio: String(p.folio || ''), fecha: String(p.fecha || ''), montoAplicado: redondear(Number(p.montoAplicado) || 0),
      tipo: TIPOS_PAGO_PROV.indexOf(p.tipo) !== -1 ? p.tipo : TIPO_PAGO_LIQUIDACION })); // filas de antes (sin tipo): eran el pago completo
  const pagadoCts = vigentes.reduce((s, p) => s + aCentavos(p.montoAplicado), 0);
  const cancelada = o.estado === OC_CANCELADA || o.estado === ESTADO_ANULADA;
  const porPagar = cancelada ? null : totalPorPagarOrden(o, devueltoSinReponer(movimientos));
  const esperadoCts = cancelada ? 0 : aCentavos(porPagar ? porPagar.total : Number(o.total) || 0);
  // Facturas que ya cubren la orden con un total menor (retenciones): se liquida con su total
  let porFacturasCts = 0, venceFactura = '';
  const facturas = Array.isArray(o.facturas) ? o.facturas.filter(f => f && f.estado === FPR_VIGENTE &&
    (!o.folio || !f.ocFolio || may(f.ocFolio) === may(o.folio))) : null;
  if (facturas && facturas.length && !cancelada) {
    const fac = facturacionDeOrden(facturas, { folio: o.folio, subtotal: o.subtotal });
    const totalFac = aCentavos(fac.total);
    if (fac.completa && totalFac > 0 && totalFac < esperadoCts) porFacturasCts = totalFac;
    // La factura que sigue por pagar: los pagos cubren las facturas en orden de vencimiento
    let acum = 0;
    const siguienteFac = facturas.slice().sort((a, b) => String(a.fechaVencimiento) < String(b.fechaVencimiento) ? -1 :
      String(a.fechaVencimiento) > String(b.fechaVencimiento) ? 1 : (String(a.folio) < String(b.folio) ? -1 : 1))
      .find(f => { acum += aCentavos(f.total); return acum - pagadoCts > tol; });
    venceFactura = siguienteFac ? String(siguienteFac.fechaVencimiento || '') : '';
  }
  const objetivoCts = porFacturasCts || esperadoCts;
  const saldoCts = Math.max(0, objetivoCts - pagadoCts);
  const completo = cancelada || saldoCts <= tol || ((o.estado === OC_PAGADA || o.estado === OC_RECIBIDA) && vigentes.length > 0);
  const plan = Array.isArray(o.planPago) && o.planPago.length ? o.planPago : null;
  // Etapas del plan: monto de cada una (sobre lo que se debe) y lo que ya cubren los pagos, en orden
  let etapas = null;
  if (plan) {
    let previo = 0;
    etapas = montosDeEsquema(plan.map(e => ({ etapa: e.concepto, porcentaje: e.porcentaje })), objetivoCts / 100).map((e, i) => {
      const montoCts = aCentavos(e.monto), cubiertoCts = Math.min(montoCts, Math.max(0, pagadoCts - previo));
      previo += montoCts;
      return { etapa: i + 1, concepto: e.etapa, porcentaje: e.porcentaje, monto: montoCts / 100, cubierto: cubiertoCts / 100,
        acumulado: previo / 100, completa: montoCts - cubiertoCts <= tol };
    });
  }
  let siguiente = null;
  if (!completo) {
    if (etapas) {
      const k = Math.max(0, etapas.findIndex(e => aCentavos(e.acumulado) - pagadoCts > tol));
      const e = etapas[k] || etapas[etapas.length - 1];
      siguiente = { concepto: e.concepto, monto: Math.min(saldoCts, Math.max(0, aCentavos(e.acumulado) - pagadoCts)) / 100,
        vence: venceFactura || (k === 0 && etapas.length > 1 ? String(o.fecha || '') : venceSinFactura(o)),
        etapa: e.etapa, etapas: etapas.length };
    } else {
      siguiente = { concepto: 'Saldo', monto: saldoCts / 100, vence: venceFactura || venceSinFactura(o) };
    }
  }
  return { moneda: String(o.moneda || 'MXN'), esperado: esperadoCts / 100, pagado: pagadoCts / 100, saldo: completo ? 0 : saldoCts / 100,
    completo: completo, vigentes: vigentes, siguiente: siguiente, etapas: etapas, porFacturas: porFacturasCts / 100, cancelada: cancelada };
}

// -- Servidor --

/**
 * {FOLIO DE LA ORDEN: [pagos sin los anulados]} del libro de compras, leído una vez por petición (MEMO_.pagosProv). Quien registra
 * o cancela un pago llama olvidarPagosProv_() para que lo que se lea después en la misma petición salga de la hoja.
 */
function pagosProvPorOc_(libro) {
  const id = libro ? String(libro.getId()) : ''; // openById da otro objeto en cada llamada: se compara el id
  if (MEMO_.pagosProv && MEMO_.pagosProv.id === id) return MEMO_.pagosProv.mapa;
  const mapa = {};
  if (libro && libro.getSheetByName('PagosProveedores')) {
    filasDeArea_(hojaCompras_(libro, 'PagosProveedores'), HOJAS_COMPRAS, 'PagosProveedores').forEach((r, i) => {
      if (!String(r[0] || '').trim() || String(r[17] || '') === ESTADO_ANULADA) return;
      const p = pagoProvDesdeFila_(r, i + 2), f = p.ocFolio.toUpperCase();
      (mapa[f] = mapa[f] || []).push(p);
    });
  }
  MEMO_.pagosProv = { id: id, mapa: mapa };
  return mapa;
}
function olvidarPagosProv_() { MEMO_.pagosProv = null; }

/**
 * ¿Orden con pago parcial? Emitida (sin completar) con algún pago Vigente. Usa orden.pagoParcial si quien la armó ya lo calculó; si
 * no, lo busca en los pagos del libro (una lectura por petición).
 */
function pagoParcialDe_(orden) {
  if (!orden || orden.estado !== OC_EMITIDA) return false;
  if (typeof orden.pagoParcial === 'boolean') return orden.pagoParcial;
  try {
    // Ya leídos en esta petición (las listas los cargan antes de recorrer sus órdenes); si no, una lectura
    const mapa = MEMO_.pagosProv ? MEMO_.pagosProv.mapa : pagosProvPorOc_(libroComprasSiExiste_());
    return (mapa[String(orden.folio || '').toUpperCase()] || []).some(p => p.estado === 'Vigente');
  } catch (e) {
    return false;
  }
}

/** Saldo de una orden con lo que hay en el libro (o lo que ya se leyó: movs, facturas y pagos de esa orden). */
function saldoDeOrden_(libro, orden, movs, facturas, pagos) {
  const f = String(orden.folio || '').toUpperCase();
  const fs = (facturas || facturasDelLibro_(libro)).filter(x => String(x.ocFolio || '').toUpperCase() === f);
  return saldoOrdenCompra(Object.assign({}, orden, { facturas: fs }), pagos || pagosDeOrden_(libro, orden.folio),
    movs || movimientosPorOc_(libro)[f] || []);
}

/**
 * El pago que completa una orden (o una devolución que deja lo ya pagado como completo): la requisición pasa como con el pago de
 * siempre (Autorizada → Pagada, En camino sigue En camino, Recibida → Cerrada, o sigue Recibida si hay una devolución abierta) y la
 * orden a Pagada (Recibida si ya se recibió todo y no hay devolución abierta). Dentro del candado. Devuelve {nuevo, yaRecibida,
 * enCamino, retenida}.
 */
function aplicarPagoCompleto_(libro, hoja, req, hO, orden) {
  const yaRecibida = req.estado === REQ_RECIBIDA, enCamino = req.estado === REQ_EN_CAMINO;
  const retenida = yaRecibida ? devolucionAbiertaDe_(libro, req) : '';
  const nuevo = transicionReq(req.estado, retenida ? 'pagarRetenida' : yaRecibida ? 'pagarRecibida' : enCamino ? 'pagarEnCamino' : 'pagar');
  const estadoOc = yaRecibida && !retenida ? OC_RECIBIDA : OC_PAGADA;
  escribe_(hO).getRange(orden.fila, COL_ESTADO_OC).setValue(estadoOc);
  orden.estado = estadoOc;
  cambiarReq_(hoja, req, nuevo, {});
  return { nuevo: nuevo, yaRecibida: yaRecibida, enCamino: enCamino, retenida: retenida };
}

/**
 * Resolver una devolución ("Devolver al proveedor" o "Cancelar renglón") baja lo que se espera: si lo que ya se pagó en parcialidades
 * ahora cubre la orden, queda pagada como si llegara el pago que la completa (si no, la requisición se quedaría sin poder pagarse
 * ni cerrarse). Solo con algún pago Vigente. Devuelve el estado nuevo o ''.
 */
function completarPagoTrasDevolucion_(libro, hoja, req, hO, orden, folioDev) {
  if (orden.estado !== OC_EMITIDA || [REQ_AUTORIZADA, REQ_EN_CAMINO, REQ_RECIBIDA].indexOf(req.estado) === -1) return '';
  const pagos = pagosDeOrden_(libro, orden.folio);
  if (!pagos.some(p => p.estado === 'Vigente')) return '';
  const s = saldoDeOrden_(libro, orden, null, null, pagos);
  if (!s.completo) return '';
  const r = aplicarPagoCompleto_(libro, hoja, req, hO, orden);
  eventoReq_(libro, req.folio, r.nuevo, 'Pagada: con la devolución ' + folioDev + ', lo que ya se pagó cubre la orden.' +
    (r.retenida ? ' ' + textoRetenida(r.retenida) : ''));
  bitacora_(libro, 'Orden pagada por devolución', req.proyectoFolio, req.folio + ' · ' + orden.folio + ' · ' + folioDev + ' · pagado ' +
    formatoMoneda(s.pagado) + ' de ' + formatoMoneda(s.esperado) + ' ' + orden.moneda + ' · ' + r.nuevo, '', HOJAS_COMPRAS);
  return r.nuevo;
}

// ---- 6.R Reportes de CxC y CxP, flujo de 13 semanas y margen; fecha esperada por etapa (incremento 6) ----
// Contrato: docs/incremento-6.md §1 y §3; detalle: docs/incremento-6-reportes.md. Spec aprobado por Leo con sus valores por
// omisión (decisiones 4 y 5). Solo lectura: lo único que escribe es la fecha esperada de las etapas de cobranza
// (guardarFechasEsperadas). Permisos en el servidor en cada llamada (permisosReportes_): CxC y margen → cobranza; CxP → compras;
// flujo → super admin (que tiene todos los roles). Compras nunca recibe montos de contrato ni margen. MXN y USD nunca se suman
// ni se comparan: todo va por moneda. Fuera: lo cancelado y lo anulado (ocVigente, esAnulado_, estado Anulada), los proyectos
// Cancelados (CxC, flujo y margen; ver porPagarProveedores para CxP) y los registros de prueba (foliosPrueba_, CLAUDE.md §5).
// Las fechas de lo que se debe a proveedores siguen las reglas de Cuentas por pagar (venceSinFactura, compartida con P).
// En caché por versión de sus colecciones (enCache_) y, los que dependen del día, por día.
// Punto de integración con el módulo P (pagos parciales): saldoOrdenCompra_() usa saldoOrdenCompra (P, contrato §1) en cuanto
// exista; mientras tanto, saldoOrdenCompraProvisional (misma firma y forma, reglas de hoy).

function modReportes_() {
  // Aquí solo listas literales: este módulo se arma al cargar el archivo, antes de las const de más abajo
  return { nombre: 'Reportes',
    api: { guardarFechasEsperadas: guardarFechasEsperadas, reporteCxc: reporteCxc, reporteCxp: reporteCxp,
      reporteFlujo: reporteFlujo, reporteMargen: reporteMargen },
    // La fecha esperada vive en Esquemas, que es parte de 'contratos' (como guardarEsquema)
    cambios: { guardarFechasEsperadas: ['contratos'] },
    solo: [], publicas: [],
    // El reporte abierto (ctx.reporte) se vuelve a mandar si cambió algo de lo que usa y esta persona lo puede ver. El cambio de
    // día lo pide la interfaz (sincronizar no llega a los módulos cuando no cambió ninguna colección).
    sincronizar(permisos, ctx, algo, r, errores) {
      const tipo = String(ctx.reporte || ''), def = REPORTES_[tipo];
      if (!def || !permisosReportes_()[tipo] || !algo.apply(null, def.colecciones)) return;
      r.reporte = { tipo: tipo, datos: intentar_(errores, 'Reporte', def.fn) };
    },
  };
}

/** Qué reportes ve el usuario de la sesión (la pestaña Reportes sale si ve alguno; cada reporte lo vuelve a revisar). */
function permisosReportes_() {
  const cob = esCobranza_();
  return { cxc: cob, cxp: esCompras_(), flujo: esSuperAdmin_(), margen: cob };
}

function exigirReporte_(tipo) {
  if (!VENDEDOR_) throw errorSesion_('Inicia sesión con tu cuenta @' + DOMINIO_HELGEN + '.');
  if (!permisosReportes_()[tipo]) throw errorPermiso_('No tienes permiso para ver este reporte.');
}

/** Colecciones de cada reporte (su caché y su sincronización) y si dependen del día. */
const REPORTES_ = {
  cxc: { colecciones: ['proyectos', 'contratos', 'pagosCobranza', 'anulaciones'], porDia: true, fn: () => reporteCxc() },
  cxp: { colecciones: ['proyectos', 'oc', 'pagosProveedores', 'facturasProveedor', 'requisiciones', 'anulaciones'], porDia: true,
    fn: () => reporteCxp() },
  flujo: { colecciones: ['proyectos', 'contratos', 'pagosCobranza', 'oc', 'pagosProveedores', 'facturasProveedor', 'requisiciones',
    'anulaciones'], porDia: true, fn: () => reporteFlujo() },
  margen: { colecciones: ['proyectos', 'contratos', 'oc', 'anulaciones'], porDia: false, fn: () => reporteMargen() },
};

/** Valor del reporte en caché (por versión de sus colecciones, por día si depende de él y por la lista de pruebas) o calcularlo. */
function reporteEnCache_(tipo, calcular) {
  const def = REPORTES_[tipo];
  const prueba = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, foliosPrueba_().join(','))).slice(0, 10);
  return enCache_('REP_' + tipo + '_' + (def.porDia ? hoyIso_() : '') + '_' + prueba, def.colecciones, TTL_CACHE, calcular);
}

/**
 * Antigüedad de cuentas por cobrar (cobranza y super admin): saldo de cada etapa de los contratos firmados, por cliente y
 * proyecto, en No vencido · 1–30 · 31–60 · 61–90 · > 90 días · Sin fecha, según la fecha esperada de la etapa. El saldo de cada
 * etapa sale de resumenCobranza (el mismo reparto que la vista del proyecto). Ver antiguedadCxc.
 */
function reporteCxc() {
  exigirReporte_('cxc');
  return reporteEnCache_('cxc', () => antiguedadCxc(datosReportes_({ cobranza: true })));
}

/**
 * Antigüedad de cuentas por pagar (compras y super admin): saldo de cada orden vigente por proveedor y orden, en los mismos rangos.
 * Saldo con saldoOrdenCompra (módulo P); fechas: plan de P, facturas o entrega + crédito (porPagarProveedores). Sin montos de
 * contrato.
 */
function reporteCxp() {
  exigirReporte_('cxp');
  return reporteEnCache_('cxp', () => {
    const d = datosReportes_({ compras: true });
    return antiguedadPorPagar(d, saldoOrdenCompra_());
  });
}

/** Flujo de efectivo de 13 semanas (solo super admin): cobros esperados (etapas) contra pagos esperados (órdenes), por moneda. */
function reporteFlujo() {
  exigirReporte_('flujo');
  return reporteEnCache_('flujo', () => {
    const d = datosReportes_({ cobranza: true, compras: true });
    // ordenesAnteriores: cuántas órdenes anteriores sin pago registrado quedaron fuera (revisión 6b; la interfaz lo dice)
    return Object.assign(flujoSemanal({ hoy: d.hoy, semanas: SEMANAS_FLUJO, cobros: etapasPorCobrar(d), pagos: porPagarProveedores(d, saldoOrdenCompra_()) }),
      { ordenesAnteriores: ordenesAnterioresSinPago(d).n });
  });
}

/** Margen por proyecto (cobranza y super admin): contratado sin IVA − órdenes de compra no canceladas, por línea de negocio. */
function reporteMargen() {
  exigirReporte_('margen');
  return reporteEnCache_('margen', () => margenPorProyecto(datosReportes_({ cobranza: true, compras: true })));
}

/**
 * PUNTO DE INTEGRACIÓN CON EL MÓDULO P: la función saldoOrdenCompra(orden, pagos, movimientos) de P (docs/incremento-6.md §1).
 * Mientras P no esté en esta rama se usa saldoOrdenCompraProvisional (misma firma y misma forma, con las reglas de hoy). Al
 * integrar no hay que cambiar nada aquí: en cuanto exista saldoOrdenCompra se usa esa; después se puede borrar la provisional.
 */
function saldoOrdenCompra_() {
  return typeof saldoOrdenCompra === 'function' ? saldoOrdenCompra : saldoOrdenCompraProvisional;
}

/**
 * Folios de prueba que no van en ningún reporte (CLAUDE.md §5: se identifican por folio, no por texto): los fijos de
 * FOLIOS_PRUEBA_REPORTES más los de la Script Property opcional FOLIOS_PRUEBA (separados por coma), sin publicar de nuevo.
 */
function foliosPrueba_() {
  const extra = String(propiedades_().FOLIOS_PRUEBA || '').split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
  return FOLIOS_PRUEBA_REPORTES.concat(extra);
}

/**
 * Todo lo que leen los reportes, de las hojas y sin crear nada (filasSiHay_: un libro o una pestaña que no existe = vacío). que =
 * {cobranza: contratos, esquemas con fecha esperada y pagos de clientes; compras: órdenes, pagos a proveedores, movimientos y
 * facturas}. Lo anulado no se lee (estado Anulada o esAnulado_); proyectos = los que no están anulados.
 */
function datosReportes_(que) {
  const d = { hoy: hoyIso_(), proyectos: proyectosVisibles_(), prueba: foliosPrueba_() };
  if (que.cobranza) {
    const lc = libroCobranzaSiExiste_();
    const cF = colEsq_('fecha_esperada') - 1;
    d.contratos = filasSiHay_(lc, HOJAS_COBRANZA, 'Contratos').map((r, i) => contratoDesdeFila_(r, i + 2))
      .filter(c => c.proyectoFolio.trim() && c.estado !== ESTADO_ANULADA);
    d.esquemas = filasSiHay_(lc, HOJAS_COBRANZA, 'Esquemas').filter(r => String(r[0] || '').trim())
      .map(r => ({ proyectoFolio: String(r[0]), orden: Number(r[1]), etapa: String(r[2]), porcentaje: Number(r[3]), fechaEsperada: fechaIso_(r[cF]) }));
    d.pagos = filasSiHay_(lc, HOJAS_COBRANZA, 'Pagos').filter(r => String(r[0] || '').trim()).map((r, i) => pagoDesdeFila_(r, i + 2))
      .filter(p => p.estado !== ESTADO_ANULADA && !esAnulado_(p.folio));
  }
  if (que.compras) {
    const lo = libroComprasSiExiste_();
    d.ordenes = filasSiHay_(lo, HOJAS_COMPRAS, 'OrdenesCompra')
      .map((r, i) => String(r[0] || '').trim() && String(r[28] || '') !== ESTADO_ANULADA && !esAnulado_(r[0]) ? ordenDesdeFila_(r, i + 2) : null)
      .filter(Boolean);
    d.pagosProv = filasSiHay_(lo, HOJAS_COMPRAS, 'PagosProveedores').filter(r => String(r[0] || '').trim())
      .map((r, i) => pagoProvDesdeFila_(r, i + 2)).filter(p => p.estado !== ESTADO_ANULADA && !esAnulado_(p.folio));
    d.movimientos = lo && lo.getSheetByName('MovimientosInventario') ? movimientosPorOc_(lo) : {};
    d.facturas = lo && lo.getSheetByName('FacturasProveedor') ? facturasDelLibro_(lo).filter(f => !esAnulado_(f.folio)) : [];
  }
  return d;
}

/**
 * Fechas esperadas de cobro de las etapas de un proyecto (decisión 4). Solo cobranza; con la cotización aceptada o el contrato
 * firmado (no cambian montos: se pueden cambiar después de firmar); no en un proyecto cancelado. fechas = [{orden, etapa, fecha:
 * 'AAAA-MM-DD' o '' (sin fecha)}]: las etapas que no vienen no cambian. La etapa debe ser la que vio la persona (mismo número y
 * nombre): si el esquema cambió mientras tanto, error y no se escribe nada. Escribe solo la columna fecha_esperada de esas filas
 * y deja en la Bitacora de cobranza lo que cambió (antes → después). Devuelve la vista del proyecto (vistaCobranza_).
 */
function guardarFechasEsperadas(proyectoFolio, fechas) {
  exigirCobranza_();
  const lista = normalizarFechasEsperadas(fechas);
  const libro = libroCobranza_();
  return conCandado_(() => {
    const proyecto = proyectoParaCobranza_(proyectoFolio);
    if (proyecto.estado === 'Cancelado') throw new Error('El proyecto ' + proyecto.folioVisible + ' está cancelado.');
    const d = datosCobranza_(libro, proyecto.folio);
    if (!d.contrato) throw new Error('Primero marca la cotización aceptada del proyecto.');
    const hoja = d.hojas.esquemas, f = proyecto.folio.toUpperCase(), cF = colEsq_('fecha_esperada');
    const filas = {};
    filasCobranza_(hoja, 'Esquemas').forEach((r, i) => {
      if (String(r[0]).toUpperCase() === f) filas[Number(r[1])] = { fila: i + 2, etapa: String(r[2]), fecha: fechaIso_(r[cF - 1]) };
    });
    const cambios = [];
    lista.forEach(x => {
      const e = filas[x.orden];
      if (!e || textoNormal(e.etapa) !== textoNormal(x.etapa)) {
        throw new Error('El esquema de pagos de ' + proyecto.folioVisible + ' cambió mientras capturabas. Actualiza la vista y vuelve a ' +
          'capturar las fechas.');
      }
      if (e.fecha !== x.fecha) cambios.push({ e: e, x: x });
    });
    cambios.forEach(c => escribe_(hoja).getRange(c.e.fila, cF).setValue(textoFecha_(c.x.fecha)));
    if (cambios.length) {
      bitacora_(libro, 'Fechas esperadas de cobro', proyecto.folio, cambios.map(c => c.e.etapa + ': ' + (c.e.fecha || 'sin fecha') +
        ' → ' + (c.x.fecha || 'sin fecha')).join(' · '));
      SpreadsheetApp.flush();
    }
    return vistaCobranza_(libro, proyecto);
  });
}

// ---- Reportes: lógica pura (sin servicios de Google; se prueba en Node) ----

/** Registros de prueba en las hojas reales (CLAUDE.md §5). Un proyecto con su clave (PRY-AAAA-NNNN-XXX) también cuenta. */
const FOLIOS_PRUEBA_REPORTES = ['HLG-2026-0005', 'HLG-2026-0006', 'PRY-2026-0001'];
const SEMANAS_FLUJO = 13;
/** Rangos de antigüedad por días de atraso (las mismas claves que RANGOS_CXP de cuentas por pagar) + "Sin fecha". */
const RANGOS_REPORTE = [
  { clave: 'porVencer', etiqueta: 'No vencido', hasta: 0 },
  { clave: 'd1a30', etiqueta: '1–30 días', hasta: 30 },
  { clave: 'd31a60', etiqueta: '31–60 días', hasta: 60 },
  { clave: 'd61a90', etiqueta: '61–90 días', hasta: 90 },
  { clave: 'd90mas', etiqueta: 'Más de 90 días', hasta: Infinity },
];
const RANGO_SIN_FECHA = { clave: 'sinFecha', etiqueta: 'Sin fecha' };
/** De dónde sale la fecha de un pago esperado a proveedor (porPagarProveedores). */
const FUENTES_VENCE = { plan: 'Plan de pagos', factura: 'Factura', estimada: 'Sin factura (recepción o entrega + crédito)', '': 'Sin fecha' };

/** ¿"AAAA-MM-DD" es una fecha real? */
function fechaIsoValida(s) {
  const m = String(s == null ? '' : s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** ¿El folio está en la lista de prueba? lista = foliosPrueba_() (por omisión, los fijos). Acepta el proyecto con clave. */
function esFolioPrueba(folio, lista) {
  const f = folioInterno(folio);
  return !!f && (lista || FOLIOS_PRUEBA_REPORTES).map(x => folioInterno(x)).indexOf(f) !== -1;
}

/**
 * Valida lo que manda la interfaz para guardarFechasEsperadas: [{orden (1…10), etapa, fecha}] sin etapas repetidas; fecha =
 * 'AAAA-MM-DD' real de 2020 a 2100 (puede ser pasada o futura) o '' = sin fecha. Devuelve [{orden, etapa, fecha}].
 */
function normalizarFechasEsperadas(fechas) {
  if (!Array.isArray(fechas) || !fechas.length) throw new Error('No hay fechas para guardar.');
  if (fechas.length > MAX_ETAPAS) throw new Error('El esquema de pagos admite máximo ' + MAX_ETAPAS + ' etapas.');
  const vistas = {};
  return fechas.map(x => {
    const orden = Number(x && x.orden), etapa = String((x && x.etapa) || '').trim().replace(/\s+/g, ' ');
    if (!Number.isInteger(orden) || orden < 1 || orden > MAX_ETAPAS) throw new Error('Etapa no válida.');
    if (vistas[orden]) throw new Error('La etapa ' + orden + ' está repetida.');
    vistas[orden] = true;
    const s = String(x.fecha == null ? '' : x.fecha).trim();
    if (s && (!fechaIsoValida(s) || s < '2020-01-01' || s > '2100-12-31')) {
      throw new Error('La fecha esperada de "' + (etapa || 'etapa ' + orden) + '" no es válida (AAAA-MM-DD).');
    }
    return { orden: orden, etapa: etapa, fecha: s };
  });
}

/** Días de atraso y rango de una fecha contra hoy ("AAAA-MM-DD"). Sin fecha válida: {dias: null, rango: 'sinFecha'}. Hoy = no vencido. */
function rangoAntiguedad(fecha, hoy) {
  if (!fechaIsoValida(fecha)) return { dias: null, rango: RANGO_SIN_FECHA.clave };
  const dias = diasEntre(fecha, hoy);
  return { dias: dias, rango: RANGOS_REPORTE.find(r => dias <= r.hasta).clave };
}

/** Monedas en orden: MXN primero, luego las demás alfabéticamente. */
function ordenMonedas(a, b) {
  return a === b ? 0 : a === 'MXN' ? -1 : b === 'MXN' ? 1 : a < b ? -1 : 1;
}

/**
 * (Lógica pura, revisión 6b) ¿Contrato desbloqueado que ya se cobra? Aceptada con algún pago Vigente: registrarPago exige
 * contrato firmado, así que una aceptada con pagos solo existe si se firmó y luego se desbloqueó (desbloquearContrato la regresa
 * a Aceptada y conserva los pagos). c = contratoDesdeFila_; pagos = los del proyecto (cualquier estado, sin los anulados).
 */
function contratoDesbloqueado(c, pagos) {
  return !!c && c.estado === ESTADO_ACEPTADA && (pagos || []).some(p => p && p.estado === 'Vigente');
}

/**
 * Lo que falta cobrar de cada etapa de los contratos firmados, como partidas con fecha. d = {contratos (contratoDesdeFila_),
 * esquemas [{proyectoFolio, orden, etapa, porcentaje, fechaEsperada}], pagos (cobranza; cualquier estado), proyectos
 * [{folio, folioVisible, nombre, cliente, clienteId, estado}], prueba}. El saldo de cada etapa sale de resumenCobranza (mismo
 * reparto que la vista del proyecto: pagos Vigentes en orden de registro, el excedente pasa a la siguiente etapa; todo en la
 * moneda del contrato, aunque el pago haya sido en otra). Solo contratos Firmados (uno por firmar todavía no se cobra) y los
 * desbloqueados (revisión 6b: Aceptada con algún pago Vigente; los pagos exigen contrato firmado, así que solo existe si se
 * firmó y luego se desbloqueó: se le sigue cobrando y va marcado desbloqueado), de proyectos que existen, no Cancelados ni de
 * prueba; solo etapas con saldo. Una aceptada sin pagos sigue fuera. Partida = {proyectoFolio, folioVisible, nombre, cliente,
 * clienteId, estadoProyecto, marca, moneda, desbloqueado, orden, etapa, montoEtapa, pagadoEtapa, monto (saldo), fecha (esperada
 * o '')}.
 */

function etapasPorCobrar(d) {
  const may = s => String(s || '').trim().toUpperCase();
  const prueba = d.prueba || FOLIOS_PRUEBA_REPORTES;
  const proyectos = {}, esquemas = {}, pagos = {};
  (d.proyectos || []).forEach(p => { proyectos[may(p.folio)] = p; });
  (d.esquemas || []).forEach(e => { (esquemas[may(e.proyectoFolio)] = esquemas[may(e.proyectoFolio)] || []).push(e); });
  (d.pagos || []).forEach(p => { (pagos[may(p.proyectoFolio)] = pagos[may(p.proyectoFolio)] || []).push(p); });
  const partidas = [];
  (d.contratos || []).forEach(c => {
    const folio = may(c.proyectoFolio), p = proyectos[folio];
    const desbloqueado = contratoDesbloqueado(c, pagos[folio]);
    if ((c.estado !== ESTADO_FIRMADO && !desbloqueado) || !p || p.estado === 'Cancelado' || esFolioPrueba(folio, prueba) ||
      esFolioPrueba(c.cotizacion, prueba)) return;
    const filas = (esquemas[folio] || []).slice().sort((a, b) => a.orden - b.orden);
    const etapas = filas.length ? filas.map(e => ({ etapa: e.etapa, porcentaje: e.porcentaje })) : [{ etapa: 'Total', porcentaje: 100 }];
    resumenCobranza(c, etapas, pagos[folio] || []).etapas.forEach((e, i) => {
      const cts = aCentavos(e.saldo);
      if (cts <= 0) return;
      const fecha = filas[i] && fechaIsoValida(filas[i].fechaEsperada) ? filas[i].fechaEsperada : '';
      partidas.push({ proyectoFolio: p.folio, folioVisible: p.folioVisible || p.folio, nombre: p.nombre || '', cliente: p.cliente || '',
        clienteId: p.clienteId || '', estadoProyecto: p.estado, marca: c.marca, moneda: c.moneda, desbloqueado: desbloqueado, orden: i + 1, etapa: e.etapa,
        montoEtapa: e.monto, pagadoEtapa: e.pagado, monto: cts / 100, fecha: fecha });
    });
  });
  return partidas;
}

/**
 * (Lógica pura) Lo que falta pagar a proveedores, como partidas con fecha: una o más por orden vigente con saldo. d = {ordenes
 * (ordenDesdeFila_), pagosProv (PagosProveedores, cualquier estado), movimientos ({OC: [MovimientosInventario]}), facturas
 * (FacturasProveedor), proyectos, prueba}; saldoFn = saldoOrdenCompra (módulo P) o saldoOrdenCompraProvisional. Cuánto: el saldo
 * de saldoFn (en la moneda de la orden; nada si está completo). Cuándo: las mismas reglas que Cuentas por pagar (antiguedadCxp)
 * y que el "siguiente pago" de la orden, para que el mismo saldo caiga en el mismo rango y la misma semana (revisión 6b):
 *  1. 'factura': las facturas Vigentes de la orden en su moneda (vencimiento = emisión + días de crédito), de la que vence primero
 *     a la última; lo ya pagado cubre primero las que vencen antes.
 *  2. Lo que ninguna factura cubre (más de TOLERANCIA_PAGO), completo en una fecha: la del "siguiente" de P sin facturas (el pago
 *     del plan que sigue: el anticipo vence en la fecha de la orden; o recepción/entrega + días de crédito, venceSinFactura). Es
 *     'plan' si la orden tiene plan de pagos y 'estimada' si no.
 * Las órdenes de proyectos de prueba no cuentan, ni las anteriores sin pago registrado (esOrdenAnteriorSinPago: van aparte, en
 * ordenesAnterioresSinPago). Las de un proyecto Cancelado sí: se le sigue debiendo al proveedor mientras la
 * orden no se cancele (estadoProyecto lo dice). Partida = {ocFolio, reqFolio, proyectoFolio, proyectoVisible, proyectoNombre,
 * estadoProyecto, proveedorId, proveedor, moneda, esperado, pagado, saldoOrden, monto, fecha, fuente, referencia}.
 */
function porPagarProveedores(d, saldoFn) {
  const may = s => String(s || '').trim().toUpperCase();
  const prueba = d.prueba || FOLIOS_PRUEBA_REPORTES, fn = saldoFn || saldoOrdenCompraProvisional;
  const proyectos = {}, pagos = {}, facturas = {};
  (d.proyectos || []).forEach(p => { proyectos[may(p.folio)] = p; });
  (d.pagosProv || []).forEach(p => { (pagos[may(p.ocFolio)] = pagos[may(p.ocFolio)] || []).push(p); });
  (d.facturas || []).filter(f => f.estado === FPR_VIGENTE).forEach(f => { (facturas[may(f.ocFolio)] = facturas[may(f.ocFolio)] || []).push(f); });
  const movs = d.movimientos || {};
  const partidas = [];
  (d.ordenes || []).forEach(o => {
    if (!ocVigente(o) || esFolioPrueba(o.proyectoFolio, prueba)) return;
    const k = may(o.folio), fs = facturas[k] || [];
    if (esOrdenAnteriorSinPago(o, pagos[k], fs)) return; // revisión 6b: aparte (ordenesAnterioresSinPago), fuera de totales y flujo
    // Con las facturas de la orden (P): con retenciones el saldo se mide contra lo facturado, igual que Cuentas por pagar
    const s = fn(Object.assign({}, o, { facturas: fs }), pagos[k] || [], movs[k] || []);
    if (!s || s.completo || aCentavos(s.saldo) <= 0) return;
    // La fecha de lo que no cubre ninguna factura sale del "siguiente" de P SIN facturas (como la fila "Saldo" de Cuentas por pagar)
    const sigResto = (fs.length ? fn(Object.assign({}, o, { facturas: null }), pagos[k] || [], movs[k] || []) || {} : s).siguiente;
    const p = proyectos[may(o.proyectoFolio)] || {};
    const base = { ocFolio: o.folio, reqFolio: o.reqFolio || '', proyectoFolio: o.proyectoFolio, proyectoVisible: p.folioVisible || o.proyectoFolio,
      proyectoNombre: p.nombre || '', estadoProyecto: p.estado || '', proveedorId: o.proveedorId || '', proveedor: o.proveedor || '',
      moneda: o.moneda, esperado: redondear(s.esperado), pagado: redondear(s.pagado), saldoOrden: redondear(s.saldo) };
    tramosPorPagar(o, s, fs, sigResto).forEach(t => partidas.push(Object.assign({}, base,
      { monto: t.cts / 100, fecha: t.fecha, fuente: t.fuente, referencia: t.referencia })));
  });
  return partidas;
}

/**
 * (Lógica pura) ¿Orden anterior sin pago registrado? Vigente, SIN requisición (las órdenes de antes del 23/10/2026: desde entonces
 * toda orden sale de una), sin pagos Vigentes y sin facturas Vigentes. En CAPRI no se puede pagar (el pago exige requisición) ni,
 * si ya se recibió, cancelar: se pagó por fuera o nunca se registró. No es deuda que se pueda saldar desde CAPRI, así que los
 * reportes la listan aparte (revisión 6b), fuera de los totales de CxP y del flujo; su costo sigue en el margen.
 */
function esOrdenAnteriorSinPago(o, pagos, facturas) {
  return ocVigente(o) && !String(o.reqFolio || '').trim() && !(pagos || []).some(p => p && p.estado === 'Vigente') &&
    !(facturas || []).some(f => f && f.estado === FPR_VIGENTE);
}

/**
 * (Lógica pura) Órdenes anteriores sin pago registrado (esOrdenAnteriorSinPago) de proyectos que no son de prueba. d = como
 * porPagarProveedores. Devuelve {n, totales: [{moneda, ordenes, total}] (por moneda, MXN primero; nunca se suman), ordenes:
 * [{ocFolio, fecha, estado, fechaRecepcion, proveedorId, proveedor, proyectoFolio, proyectoVisible, proyectoNombre, estadoProyecto,
 * moneda, total}] (por moneda y fecha)}. total = el de la orden, con IVA.
 */
function ordenesAnterioresSinPago(d) {
  const may = s => String(s || '').trim().toUpperCase();
  const prueba = d.prueba || FOLIOS_PRUEBA_REPORTES;
  const proyectos = {}, pagos = {}, facturas = {};
  (d.proyectos || []).forEach(p => { proyectos[may(p.folio)] = p; });
  (d.pagosProv || []).forEach(p => { (pagos[may(p.ocFolio)] = pagos[may(p.ocFolio)] || []).push(p); });
  (d.facturas || []).forEach(f => { (facturas[may(f.ocFolio)] = facturas[may(f.ocFolio)] || []).push(f); });
  const ordenes = (d.ordenes || []).filter(o => !esFolioPrueba(o.proyectoFolio, prueba) &&
    esOrdenAnteriorSinPago(o, pagos[may(o.folio)], facturas[may(o.folio)])).map(o => {
    const p = proyectos[may(o.proyectoFolio)] || {};
    return { ocFolio: o.folio, fecha: o.fecha || '', estado: o.estado, fechaRecepcion: o.fechaRecepcion || '', proveedorId: o.proveedorId || '',
      proveedor: o.proveedor || '', proyectoFolio: o.proyectoFolio, proyectoVisible: p.folioVisible || o.proyectoFolio, proyectoNombre: p.nombre || '',
      estadoProyecto: p.estado || '', moneda: o.moneda, total: redondear(o.total) };
  }).sort((a, b) => ordenMonedas(a.moneda, b.moneda) || (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.ocFolio < b.ocFolio ? -1 : 1)));
  const tot = {};
  ordenes.forEach(o => { const t = tot[o.moneda] || (tot[o.moneda] = { moneda: o.moneda, ordenes: 0, cts: 0 }); t.ordenes++; t.cts += aCentavos(o.total); });
  return { n: ordenes.length, ordenes: ordenes,
    totales: Object.keys(tot).sort(ordenMonedas).map(m => ({ moneda: m, ordenes: tot[m].ordenes, total: tot[m].cts / 100 })) };
}

/**
 * (Lógica pura) Tramos {cts, fecha, fuente, referencia} del saldo s de una orden (reglas en porPagarProveedores). sigResto = el
 * "siguiente" de P sin facturas (fecha de lo que ninguna factura cubre); sin él (o sin fecha), venceSinFactura(o).
 */
function tramosPorPagar(o, s, facturas, sigResto) {
  let restante = aCentavos(s.saldo), pagado = aCentavos(s.pagado);
  const tramos = [];
  facturas.filter(f => f.moneda === o.moneda && fechaIsoValida(f.fechaVencimiento))
    .sort((a, b) => a.fechaVencimiento < b.fechaVencimiento ? -1 : a.fechaVencimiento > b.fechaVencimiento ? 1 : (a.folio < b.folio ? -1 : 1))
    .forEach(f => {
      const total = aCentavos(f.total), cubierto = Math.min(pagado, total);
      pagado -= cubierto;
      const abierto = Math.min(total - cubierto, restante);
      if (abierto <= 0) return;
      tramos.push({ cts: abierto, fecha: f.fechaVencimiento, fuente: 'factura', referencia: f.folio });
      restante -= abierto;
    });
  // Lo que no cubre ninguna factura, completo en una fecha (Cuentas por pagar tampoco lista un resto dentro de la tolerancia)
  if (restante > aCentavos(TOLERANCIA_PAGO) || (!tramos.length && restante > 0)) {
    const sig = sigResto || s.siguiente || {};
    const fecha = fechaIsoValida(sig.vence) ? sig.vence : venceSinFactura(o);
    const plan = Array.isArray(o.planPago) && o.planPago.length > 0;
    tramos.push({ cts: restante, fecha: fecha, fuente: !fecha ? '' : plan ? 'plan' : 'estimada',
      referencia: plan ? String(sig.concepto || 'Plan de pagos') : 'Sin factura' });
  }
  return tramos;
}

/**
 * (Lógica pura) Saldo de una orden con las reglas de HOY (un pago por orden), con la firma y la forma exactas de
 * saldoOrdenCompra del módulo P (docs/incremento-6.md §1). Solo mientras P no esté integrado (saldoOrdenCompra_ elige):
 * esperado = totalPorPagarOrden(orden, devueltoSinReponer(movimientos)) o el total de la orden; pagado = Σ monto_aplicado de los
 * pagos Vigentes; saldo = max(0, esperado − pagado); completo = saldo ≤ TOLERANCIA_PAGO; siguiente = el saldo, sin fecha.
 */
function saldoOrdenCompraProvisional(orden, pagos, movimientos) {
  const o = orden || {};
  const porPagar = totalPorPagarOrden(o, devueltoSinReponer(movimientos || []));
  const esperado = redondear(porPagar ? porPagar.total : Number(o.total) || 0);
  const vigentes = (pagos || []).filter(p => p.estado === 'Vigente')
    .map(p => ({ folio: p.folio, fecha: p.fecha, montoAplicado: redondear(p.montoAplicado), tipo: p.tipo || '' }));
  const pagadoCts = vigentes.reduce((s, p) => s + aCentavos(p.montoAplicado), 0);
  const saldo = Math.max(0, aCentavos(esperado) - pagadoCts) / 100;
  const completo = aCentavos(saldo) <= aCentavos(TOLERANCIA_PAGO);
  return { esperado: esperado, pagado: pagadoCts / 100, saldo: saldo, completo: completo, vigentes: vigentes,
    siguiente: completo ? null : { concepto: 'Saldo', monto: saldo, vence: '' } };
}

/**
 * (Lógica pura) Antigüedad en dos niveles (cliente → proyecto, proveedor → orden). partidas = [{moneda, monto, fecha, …}];
 * nivel1(x) y nivel2(x) → {clave, datos}. Cada partida toma sus días de atraso y su rango (rangoAntiguedad). Un grupo es de UNA
 * moneda (un cliente con proyectos en MXN y en USD sale dos veces): nunca se suman ni se comparan monedas. Devuelve {hoy, rangos
 * [{clave, etiqueta}] (con "Sin fecha"), totales (uno por moneda, MXN primero: rangos, vencido, total, grupos, partidas), grupos
 * [{…datos, moneda, rangos, vencido, total, detalle: [{…datos, moneda, rangos, vencido, total, partidas}]}]}. Grupos: por moneda,
 * del más vencido al menos y del mayor saldo al menor; detalle por su clave; partidas por fecha (sin fecha al final).
 */
function antiguedadEnGrupos(partidas, hoy, nivel1, nivel2) {
  const claves = RANGOS_REPORTE.map(r => r.clave).concat(RANGO_SIN_FECHA.clave);
  const vacio = () => { const o = { tot: 0 }; claves.forEach(k => { o[k] = 0; }); return o; };
  const sumar = (o, rango, cts) => { o[rango] += cts; o.tot += cts; };
  const cerrar = o => {
    const r = {};
    claves.forEach(k => { r[k] = o[k] / 100; });
    r.vencido = (o.tot - o.porVencer - o.sinFecha) / 100;
    r.total = o.tot / 100;
    return r;
  };
  const grupos = {}, totales = {};
  (partidas || []).forEach(x0 => {
    const cts = aCentavos(x0.monto);
    if (cts <= 0) return;
    const x = Object.assign({}, x0, { monto: cts / 100 }, rangoAntiguedad(x0.fecha, hoy));
    const g1 = nivel1(x), g2 = nivel2(x), k1 = x.moneda + '|' + g1.clave;
    const G = grupos[k1] || (grupos[k1] = { datos: g1.datos, moneda: x.moneda, suma: vacio(), detalle: {} });
    const D = G.detalle[g2.clave] || (G.detalle[g2.clave] = { clave: g2.clave, datos: g2.datos, suma: vacio(), partidas: [] });
    const T = totales[x.moneda] || (totales[x.moneda] = { suma: vacio(), grupos: {}, partidas: 0 });
    [G.suma, D.suma, T.suma].forEach(o => sumar(o, x.rango, cts));
    D.partidas.push(x);
    T.grupos[k1] = true;
    T.partidas++;
  });
  const porFecha = (a, b) => (a.fecha || '9') < (b.fecha || '9') ? -1 : (a.fecha || '9') > (b.fecha || '9') ? 1 : 0;
  const listaGrupos = Object.keys(grupos).map(k => {
    const G = grupos[k];
    const detalle = Object.keys(G.detalle).sort().map(c => {
      const D = G.detalle[c];
      return Object.assign({}, D.datos, { moneda: G.moneda }, cerrar(D.suma), { partidas: D.partidas.sort(porFecha) });
    });
    return Object.assign({}, G.datos, { moneda: G.moneda }, cerrar(G.suma), { detalle: detalle });
  }).sort((a, b) => ordenMonedas(a.moneda, b.moneda) || b.vencido - a.vencido || b.total - a.total ||
    (textoNormal(a.nombreGrupo) < textoNormal(b.nombreGrupo) ? -1 : 1));
  return {
    hoy: hoy, rangos: RANGOS_REPORTE.map(r => ({ clave: r.clave, etiqueta: r.etiqueta })).concat([RANGO_SIN_FECHA]),
    totales: Object.keys(totales).sort(ordenMonedas).map(m => Object.assign({ moneda: m }, cerrar(totales[m].suma),
      { grupos: Object.keys(totales[m].grupos).length, partidas: totales[m].partidas })),
    grupos: listaGrupos,
  };
}

/**
 * (Lógica pura) Antigüedad de cuentas por cobrar: etapasPorCobrar agrupadas por cliente (clienteId o, sin él, su nombre) y
 * proyecto. d = {hoy, contratos, esquemas, pagos, proyectos, prueba}. Ver antiguedadEnGrupos (grupos = clientes, detalle =
 * proyectos, partidas = etapas).
 */
function antiguedadCxc(d) {
  return antiguedadEnGrupos(etapasPorCobrar(d), d.hoy,
    x => ({ clave: x.clienteId || textoNormal(x.cliente), datos: { nombreGrupo: x.cliente || 'Sin cliente', cliente: x.cliente, clienteId: x.clienteId } }),
    x => ({ clave: x.proyectoFolio, datos: { folio: x.proyectoFolio, folioVisible: x.folioVisible, nombre: x.nombre, marca: x.marca,
      estadoProyecto: x.estadoProyecto, desbloqueado: !!x.desbloqueado } }));
}

/**
 * (Lógica pura) Antigüedad de cuentas por pagar: porPagarProveedores agrupadas por proveedor (su id o, sin él, su nombre) y orden.
 * d = {hoy, ordenes, pagosProv, movimientos, facturas, proyectos, prueba}; saldoFn = saldoOrdenCompra (P) o la provisional. Trae
 * además anteriores (ordenesAnterioresSinPago): las órdenes anteriores sin pago registrado, aparte y fuera de los totales.
 */
function antiguedadPorPagar(d, saldoFn) {
  const r = antiguedadEnGrupos(porPagarProveedores(d, saldoFn), d.hoy,
    x => ({ clave: x.proveedorId || textoNormal(x.proveedor), datos: { nombreGrupo: x.proveedor || 'Sin proveedor', proveedor: x.proveedor,
      proveedorId: x.proveedorId } }),
    x => ({ clave: x.ocFolio, datos: { ocFolio: x.ocFolio, reqFolio: x.reqFolio, proyectoFolio: x.proyectoFolio, proyectoVisible: x.proyectoVisible,
      proyectoNombre: x.proyectoNombre, estadoProyecto: x.estadoProyecto, esperado: x.esperado, pagado: x.pagado } }));
  r.anteriores = ordenesAnterioresSinPago(d); // revisión 6b: bloque aparte, fuera de los totales
  return r;
}

/** Lunes ("AAAA-MM-DD") de la semana de una fecha. */
function lunesDe(fechaIso) {
  const m = String(fechaIso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dia = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay(); // 0 = domingo
  return sumarDias(fechaIso, -(dia === 0 ? 6 : dia - 1));
}

/**
 * (Lógica pura) Flujo de efectivo semanal. d = {hoy, semanas (13), cobros (etapasPorCobrar), pagos (porPagarProveedores)}. Semana
 * 1 = de lunes a domingo de la semana de hoy; las demás, las siguientes. Lo vencido (fecha anterior a hoy) cae en la semana 1 y
 * se marca (cobrosVencidos / pagosVencidos y vencido en la partida); lo que vence hoy no está vencido. Sin fecha y después de la
 * semana 13: aparte (no entran al neto). Por moneda (MXN primero; nunca se suman): por semana cobros, pagos, neto = cobros −
 * pagos y acumulado = suma de los netos desde la semana 1 (sin saldo inicial de bancos). Devuelve {hoy, inicio, fin, semanas
 * [{n, desde, hasta}], monedas [{moneda, semanas [{n, desde, hasta, cobros, pagos, neto, acumulado, cobrosVencidos,
 * pagosVencidos}], sinFecha {cobros, pagos}, despues {cobros, pagos}, totales {cobros, pagos, neto}}], partidas}.
 */
function flujoSemanal(d) {
  const n = d.semanas || SEMANAS_FLUJO, inicio = lunesDe(d.hoy);
  const semanas = Array.from({ length: n }, (_, i) => ({ n: i + 1, desde: sumarDias(inicio, 7 * i), hasta: sumarDias(inicio, 7 * i + 6) }));
  const fin = semanas[n - 1].hasta;
  const monedas = {}, partidas = [];
  const de = m => monedas[m] || (monedas[m] = { moneda: m,
    s: semanas.map(() => ({ cobros: 0, pagos: 0, cobrosVencidos: 0, pagosVencidos: 0 })),
    sinFecha: { cobros: 0, pagos: 0 }, despues: { cobros: 0, pagos: 0 } });
  const meter = (x, tipo, folio, detalle) => {
    const cts = aCentavos(x.monto);
    if (cts <= 0) return;
    const M = de(x.moneda), campo = tipo === 'cobro' ? 'cobros' : 'pagos';
    let semana = null, vencido = false, donde = 'semana';
    if (!fechaIsoValida(x.fecha)) { M.sinFecha[campo] += cts; donde = 'sinFecha'; }
    else if (x.fecha < d.hoy) { semana = 1; vencido = true; M.s[0][campo] += cts; M.s[0][campo + 'Vencidos'] += cts; }
    else if (x.fecha > fin) { M.despues[campo] += cts; donde = 'despues'; }
    else { semana = Math.floor(diasEntre(inicio, x.fecha) / 7) + 1; M.s[semana - 1][campo] += cts; }
    partidas.push({ tipo: tipo, moneda: x.moneda, monto: cts / 100, fecha: fechaIsoValida(x.fecha) ? x.fecha : '', semana: semana,
      vencido: vencido, donde: donde, folio: folio, detalle: detalle, proyectoVisible: x.folioVisible || x.proyectoVisible || '',
      fuente: x.fuente || '', desbloqueado: !!x.desbloqueado });
  };
  (d.cobros || []).forEach(x => meter(x, 'cobro', x.folioVisible || x.proyectoFolio, (x.cliente ? x.cliente + ' · ' : '') + x.etapa));
  (d.pagos || []).forEach(x => meter(x, 'pago', x.ocFolio, (x.proveedor || '') + (x.referencia ? ' · ' + x.referencia : '')));
  const lista = Object.keys(monedas).sort(ordenMonedas).map(m => {
    const M = monedas[m];
    let acum = 0, tc = 0, tp = 0;
    const filas = M.s.map((x, i) => {
      const neto = x.cobros - x.pagos;
      acum += neto; tc += x.cobros; tp += x.pagos;
      return { n: i + 1, desde: semanas[i].desde, hasta: semanas[i].hasta, cobros: x.cobros / 100, pagos: x.pagos / 100,
        neto: neto / 100, acumulado: acum / 100, cobrosVencidos: x.cobrosVencidos / 100, pagosVencidos: x.pagosVencidos / 100 };
    });
    return { moneda: m, semanas: filas, sinFecha: { cobros: M.sinFecha.cobros / 100, pagos: M.sinFecha.pagos / 100 },
      despues: { cobros: M.despues.cobros / 100, pagos: M.despues.pagos / 100 },
      totales: { cobros: tc / 100, pagos: tp / 100, neto: (tc - tp) / 100 } };
  });
  const orden = { semana: 0, despues: 1, sinFecha: 2 };
  partidas.sort((a, b) => ordenMonedas(a.moneda, b.moneda) || orden[a.donde] - orden[b.donde] || (a.semana || 0) - (b.semana || 0) ||
    (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0) || (a.tipo === b.tipo ? 0 : a.tipo === 'cobro' ? -1 : 1));
  return { hoy: d.hoy, inicio: inicio, fin: fin, semanas: semanas, monedas: lista, partidas: partidas };
}

/**
 * (Lógica pura) Margen por proyecto y por línea de negocio. d = {contratos, proyectos, ordenes, prueba, costosExtra}. Por contrato
 * (aceptado o firmado) de un proyecto que existe, no Cancelado ni de prueba: contratado = subtotal sin IVA; costos = órdenes de
 * compra no canceladas ni anuladas (costosDeOrdenes) + costosExtra[folio] (incremento 7: gastos y nómina, [{concepto, moneda,
 * monto, cantidad}], siempre en la moneda del contrato); margen con margenProyecto (un costo en otra moneda = margenError: el
 * renglón se muestra pero no suma). Totales por línea (Helgen, Helgen Energy) y moneda, solo de los Firmados sin error (los "Por
 * firmar" se muestran y no suman, como en el resumen de cobranza), con el total de cada concepto. Devuelve {conceptos (en orden
 * de aparición, "Órdenes de compra" primero), totales [{marca, moneda, proyectos, contratado, costos [{concepto, monto}],
 * totalCostos, margen, porcentaje, porFirmar, conError}], proyectos [{folio, folioVisible, nombre, cliente, estadoProyecto,
 * marca, moneda, estadoContrato, cotizacion, contratado, costos, totalCostos, margen, porcentaje, margenError, ordenes}]}.
 */
function margenPorProyecto(d) {
  const may = s => String(s || '').trim().toUpperCase();
  const prueba = d.prueba || FOLIOS_PRUEBA_REPORTES, extra = d.costosExtra || {};
  const proyectos = {}, ordenes = {};
  (d.proyectos || []).forEach(p => { proyectos[may(p.folio)] = p; });
  (d.ordenes || []).filter(ocVigente).forEach(o => { (ordenes[may(o.proyectoFolio)] = ordenes[may(o.proyectoFolio)] || []).push(o); });
  const conceptos = ['Órdenes de compra'], filas = [];
  (d.contratos || []).forEach(c => {
    const folio = may(c.proyectoFolio), p = proyectos[folio];
    if (!p || p.estado === 'Cancelado' || esFolioPrueba(folio, prueba) || esFolioPrueba(c.cotizacion, prueba)) return;
    if (c.estado !== ESTADO_FIRMADO && c.estado !== ESTADO_ACEPTADA) return;
    const ocs = ordenes[folio] || [];
    const costos = costosDeOrdenes(ocs, c.moneda).concat(extra[folio] || extra[p.folio] || []);
    costos.forEach(x => { if (conceptos.indexOf(x.concepto) === -1) conceptos.push(x.concepto); });
    let m = null, error = '';
    try { m = margenProyecto(c.subtotal, c.moneda, costos); } catch (e) { error = e.message; }
    filas.push({ folio: p.folio, folioVisible: p.folioVisible || p.folio, nombre: p.nombre || '', cliente: p.cliente || '',
      estadoProyecto: p.estado, marca: c.marca, moneda: c.moneda, estadoContrato: c.estado === ESTADO_FIRMADO ? 'Firmado' : 'Por firmar',
      cotizacion: c.cotizacion, contratado: redondear(c.subtotal),
      costos: m ? m.costos : costos.map(x => ({ concepto: x.concepto, moneda: x.moneda, monto: redondear(x.monto), cantidad: x.cantidad || 0 })),
      totalCostos: m ? m.totalCostos : null, margen: m ? m.margen : null, porcentaje: m ? m.porcentaje : null, margenError: error,
      ordenes: ocs.length });
  });
  const marcas = ['helgen', 'energy'];
  const ordenMarca = (a, b) => (marcas.indexOf(a) === -1 ? 9 : marcas.indexOf(a)) - (marcas.indexOf(b) === -1 ? 9 : marcas.indexOf(b));
  filas.sort((a, b) => ordenMarca(a.marca, b.marca) || ordenMonedas(a.moneda, b.moneda) ||
    (a.estadoContrato === b.estadoContrato ? 0 : a.estadoContrato === 'Firmado' ? -1 : 1) || (a.folio < b.folio ? -1 : 1));
  const tot = {};
  filas.forEach(x => {
    const k = x.marca + '|' + x.moneda;
    const t = tot[k] || (tot[k] = { marca: x.marca, moneda: x.moneda, proyectos: 0, contratado: 0, costos: {}, totalCostos: 0, porFirmar: 0, conError: 0 });
    if (x.estadoContrato !== 'Firmado') { t.porFirmar++; return; }
    if (x.margenError) { t.conError++; return; }
    t.proyectos++;
    t.contratado += aCentavos(x.contratado);
    x.costos.forEach(cc => { t.costos[cc.concepto] = (t.costos[cc.concepto] || 0) + aCentavos(cc.monto); t.totalCostos += aCentavos(cc.monto); });
  });
  const totales = Object.keys(tot).map(k => tot[k]).sort((a, b) => ordenMarca(a.marca, b.marca) || ordenMonedas(a.moneda, b.moneda)).map(t => {
    const margen = t.contratado - t.totalCostos;
    return { marca: t.marca, moneda: t.moneda, proyectos: t.proyectos, contratado: t.contratado / 100,
      costos: conceptos.filter(c => t.costos[c] != null).map(c => ({ concepto: c, monto: t.costos[c] / 100 })),
      totalCostos: t.totalCostos / 100, margen: margen / 100,
      porcentaje: t.contratado > 0 ? Math.round(margen / t.contratado * 1000) / 10 : null, porFirmar: t.porFirmar, conError: t.conError };
  });
  return { conceptos: conceptos, totales: totales, proyectos: filas };
}
