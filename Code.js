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
 * Funciones que la interfaz externa (Cloudflare) puede llamar por doPost.
 * Son las mismas que usa google.script.run; nada más (ni setup ni funciones internas con _).
 */
const API_FUNCIONES = {
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
  // Compras (solo ROL_COMPRAS; cada función lo revisa)
  listarProyectosCompras: listarProyectosCompras,
  getComprasProyecto: getComprasProyecto,
  guardarOrdenCompra: guardarOrdenCompra,
  marcarOcRecibida: marcarOcRecibida,
  cancelarOrdenCompra: cancelarOrdenCompra,
};

/**
 * API para la interfaz fuera de Apps Script. Cuerpo (text/plain para evitar la consulta CORS previa):
 * {"funcion": "listarCotizaciones", "args": ["HLG"], "token": "<ID token de Google>"}
 * Respuesta: {"ok": true, "datos": ...} o {"ok": false, "error": "mensaje en español", "codigo": "SESION"?}.
 * Sin un token válido de @helgen.tech no se ejecuta ninguna función.
 */
function doPost(e) {
  let respuesta;
  VENDEDOR_ = null;
  try {
    let cuerpo;
    try {
      cuerpo = JSON.parse((e && e.postData && e.postData.contents) || '');
    } catch (err) {
      throw new Error('Solicitud inválida: el cuerpo debe ser JSON.');
    }
    if (!cuerpo || typeof cuerpo !== 'object') throw new Error('Solicitud inválida: el cuerpo debe ser JSON.');
    VENDEDOR_ = verificarTokenGoogle_(cuerpo.token);
    const nombre = String(cuerpo.funcion || '');
    if (!Object.prototype.hasOwnProperty.call(API_FUNCIONES, nombre)) {
      throw new Error('Función no permitida: ' + (nombre || '(vacía)') + '.');
    }
    const args = Array.isArray(cuerpo.args) ? cuerpo.args : [];
    respuesta = { ok: true, datos: API_FUNCIONES[nombre].apply(null, args) };
  } catch (err) {
    respuesta = { ok: false, error: err && err.message ? err.message : String(err) };
    if (err && err.sesion) respuesta.codigo = 'SESION';
    else if (err && err.codigo) respuesta.codigo = err.codigo; // 'PROYECTO' (errorProyecto_), 'PERMISO' (errorPermiso_)
  } finally {
    VENDEDOR_ = null;
  }
  return ContentService.createTextOutput(JSON.stringify(respuesta)).setMimeType(ContentService.MimeType.JSON);
}

// ====== 2. INSTALACIÓN (ejecutar 1 sola vez) ======

const TERMINO_VIGENCIA =
  'Precios vigentes por 15 días o hasta agotar existencias, sujetos a variaciones en costos de suministro de componentes.';

const TERMINOS_OC_INICIALES =
  'Favor de indicar el folio de esta orden en su factura.\n' +
  'Facturar a nombre de la razón social y RFC indicados arriba.\n' +
  'Precios fijos según esta orden; cualquier cambio requiere una nueva orden.\n' +
  'Entregar en el lugar y fecha indicados.';

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

/** Llamada por la app al cargar. */
function getDatosIniciales() {
  const cfg = getConfig_();
  const hojaCat = hojaCatalogo_();
  return {
    ivaTasa: cfg.IVA_TASA,
    vigenciaDias: cfg.VIGENCIA_DIAS,
    marcas: MARCAS,
    catalogo: getCatalogo_(hojaCat),
    tipoCambio: tipoCambioCatalogo_(hojaCat),
    clientes: getClientes(),
    proyectos: proyectosParaInicio_(),
    usuario: usuarioActual_(),
    vendedor: VENDEDOR_,
    // Solo para mostrar u ocultar las pestañas Cobranza y Compras; cada función lo vuelve a revisar
    permisos: { cobranza: esCobranza_(), desbloqueo: esAdminDesbloqueo_(), compras: esCompras_() },
  };
}

/** Proyectos activos para el buscador. Si fallan, la app carga igual (se puede cotizar "Sin proyecto"). */
function proyectosParaInicio_() {
  try {
    return listarProyectos('', false);
  } catch (e) {
    console.warn('Sin lista de proyectos: ' + e.message);
    return [];
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
  return datos
    .filter(r => !q || (r[0] + ' ' + r[2] + ' ' + r[3] + ' ' + (r[19] || '')).toLowerCase().includes(q))
    .slice(0, 100)
    .map(r => ({
      folio: r[0], fecha: r[1], cliente: r[2], empresa: r[3], total: r[9], elaboro: r[10], pdf: r[11],
      vendedor: vendedorDeFila(r, nombres),
      // Filas anteriores a Proyectos (o cotizadas sin proyecto)
      proyecto: r[19] || 'Sin proyecto',
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
  const proyectoFolio = String((payload && payload.proyectoFolio) || '').trim().toUpperCase();

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
  'vendedor_email', 'vendedor_nombre', 'vendedor_apellido'
];
const COL_ESTADO_PROYECTO = 7;   // G
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
  }
  return hoja;
}

/** Proyectos con búsqueda por folio, cliente o nombre. Por omisión solo los Activos; los más recientes primero. */
function listarProyectos(busqueda, incluirInactivos) {
  const hoja = hojaProyectos_();
  const filas = hoja.getLastRow() > 1
    ? hoja.getRange(2, 1, hoja.getLastRow() - 1, ENCABEZADOS_PROYECTOS.length).getValues() : [];
  // El buscador de cotizaciones (solo activos) no muestra proyectos con contrato firmado
  const firmados = incluirInactivos ? {} : foliosConContratoFirmado_();
  return filtrarProyectos(proyectosDesdeFilas(filas).filter(p => !firmados[p.folio.toUpperCase()]),
    busqueda, incluirInactivos, 50)
    .map(p => ({ folio: p.folio, nombre: p.nombre, cliente: p.cliente, clienteId: p.clienteId,
      ubicacion: p.ubicacion, estado: p.estado, fecha: p.fecha }));
}

/** Error de proyecto inexistente o no Activo: doPost lo manda con codigo 'PROYECTO' y la interfaz limpia el campo. */
function errorProyecto_(mensaje) {
  const e = new Error(mensaje);
  e.codigo = 'PROYECTO';
  return e;
}

/** Proyecto por folio (con su número de fila), o null. */
function buscarProyecto_(hoja, folio) {
  const buscado = String(folio || '').trim().toUpperCase();
  if (!buscado || hoja.getLastRow() < 2) return null;
  const filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, ENCABEZADOS_PROYECTOS.length).getValues();
  const lista = proyectosDesdeFilas(filas);
  for (let i = 0; i < lista.length; i++) {
    if (lista[i].folio.toUpperCase() === buscado) return Object.assign(lista[i], { hoja: hoja, fila: i + 2 });
  }
  return null;
}

/**
 * Alta de proyecto (desde "Nuevo proyecto" en la interfaz). p = {nombre, ubicacion, cliente:{nombre, empresa, rfc},
 * idSolicitud}. Folio PRY-AAAA-NNNN bajo el mismo candado que las cotizaciones; primero crea la carpeta y luego la
 * fila, para que no quede un proyecto registrado sin carpeta.
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
    const carpeta = crearCarpetaProyecto_(folio, datos, ahora.getFullYear());

    const t = textoCelda;
    hoja.appendRow([
      folio, ahora, t(datos.nombre), t(datos.cliente), t(datos.clienteId), t(datos.ubicacion), 'Activo', carpeta.getId(),
      t(vendedor.email), t(vendedor.nombre), t(vendedor.apellido),
    ]);
    SpreadsheetApp.flush();

    const resultado = { folio: folio, nombre: datos.nombre, cliente: datos.cliente, clienteId: datos.clienteId,
      ubicacion: datos.ubicacion, estado: 'Activo', url: carpeta.getUrl() };
    if (claveCache) cache.put(claveCache, JSON.stringify(resultado), 21600); // 6 h
    return resultado;
  } finally {
    lock.releaseLock();
  }
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

/** Proyectos/AAAA/<folio> — <cliente> — <nombre>/ con sus subcarpetas. */
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
    carpeta = crearCarpetaProyecto_(proyecto.folio, proyecto, anio);
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

/** ¿El usuario del token está en la lista de correos de la propiedad (rol)? Sin token (editor) o sin la propiedad: no. */
function enRol_(propiedad) {
  if (!VENDEDOR_) return false;
  const lista = correosDeLista(PropertiesService.getScriptProperties().getProperty(propiedad), DOMINIO_HELGEN);
  return lista.indexOf(String(VENDEDOR_.email).toLowerCase()) !== -1;
}

/** ¿El usuario del token está en ROL_COBRANZA? */
function esCobranza_() {
  return enRol_('ROL_COBRANZA');
}

/** ¿Puede desbloquear contratos firmados? (ADMIN_DESBLOQUEO; sin la propiedad, nadie). */
function esAdminDesbloqueo_() {
  return enRol_('ADMIN_DESBLOQUEO');
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

/** {"PRY-2026-0001": <contrato>, …} de proyectos con contrato firmado. Sin libro de cobranza: ninguno. */
function contratosFirmados_() {
  const libro = libroCobranzaSiExiste_();
  const mapa = {};
  if (!libro) return mapa;
  const hoja = libro.getSheetByName('Contratos');
  if (!hoja) return mapa;
  filasCobranza_(hoja, 'Contratos').forEach((r, i) => {
    if (String(r[7]) === ESTADO_FIRMADO) mapa[String(r[0]).toUpperCase()] = contratoDesdeFila_(r, i + 2);
  });
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
    proyecto: { folio: proyecto.folio, nombre: proyecto.nombre, cliente: proyecto.cliente, estado: proyecto.estado,
      ubicacion: proyecto.ubicacion },
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
    margen: c ? margenDeContrato_(c) : null,
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
  const libro = libroCobranza_();
  const estados = {};
  filasCobranza_(hojaCobranza_(libro, 'Contratos'), 'Contratos').forEach(r => { estados[String(r[0]).toUpperCase()] = String(r[7]); });
  return listarProyectos(busqueda, true).map(p => Object.assign(p, { contrato: estados[p.folio.toUpperCase()] || '' }));
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
function resumenCobranzaGeneral() {
  exigirCobranza_();
  const libro = libroCobranza_();
  const contratos = filasCobranza_(hojaCobranza_(libro, 'Contratos'), 'Contratos')
    .map((r, i) => contratoDesdeFila_(r, i + 2)).filter(c => c.proyectoFolio);
  const esquemas = filasCobranza_(hojaCobranza_(libro, 'Esquemas'), 'Esquemas')
    .map(r => ({ proyectoFolio: String(r[0]), orden: Number(r[1]), etapa: String(r[2]), porcentaje: Number(r[3]) }));
  const pagos = filasCobranza_(hojaCobranza_(libro, 'Pagos'), 'Pagos').map((r, i) => pagoDesdeFila_(r, i + 2));
  const hoja = hojaProyectos_();
  const proyectos = proyectosDesdeFilas(hoja.getLastRow() > 1
    ? hoja.getRange(2, 1, hoja.getLastRow() - 1, ENCABEZADOS_PROYECTOS.length).getValues() : []);
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
// maestra y de la de cobranza). Solo el rol de compras (ROL_COMPRAS) crea, ve, recibe y cancela órdenes; el servidor lo
// revisa en cada llamada. PDF en Compras/AAAA/<folio del proyecto>/. El margen (contratado − órdenes) solo lo ve cobranza.

const NOMBRE_CARPETA_COMPRAS = 'Cotizador Helgen — Compras';
const NOMBRE_LIBRO_COMPRAS = 'Cotizador Helgen — Compras (datos)';
const PREFIJO_OC = 'OC';
const OC_EMITIDA = 'Emitida', OC_RECIBIDA = 'Recibida', OC_CANCELADA = 'Cancelada';

/** Estructura del libro de compras (mismo formato que HOJAS_COBRANZA). */
const HOJAS_COMPRAS = {
  OrdenesCompra: {
    enc: ['folio', 'fecha', 'proyecto_folio', 'marca', 'proveedor_id', 'proveedor', 'rfc', 'contacto', 'correo', 'telefono',
      'fecha_entrega', 'lugar_entrega', 'condiciones_pago', 'moneda', 'iva_tasa', 'subtotal', 'iva', 'total', 'moneda_proyecto',
      'tipo_cambio', 'subtotal_proyecto', 'renglones (JSON)', 'notas', 'pdf_id', 'pdf_url', 'elaboro_email', 'elaboro_nombre',
      'fecha_registro', 'estado', 'fecha_recepcion', 'recibio', 'cancelado_por', 'fecha_cancelacion', 'motivo_cancelacion'],
    numeros: [15, 16, 17, 18, 20, 21],
  },
  Proveedores: { enc: ['id', 'razon_social', 'rfc', 'contacto', 'correo', 'telefono', 'actualizado'], numeros: [] },
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

/** ¿El usuario del token está en ROL_COMPRAS? */
function esCompras_() {
  return enRol_('ROL_COMPRAS');
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
    canceladoPor: String(r[31] || ''), motivoCancelacion: String(r[33] || ''), fila: fila,
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
    Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm')];
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

/** Respuesta para la pestaña Compras: proyecto, moneda, órdenes y proveedores. Sin montos del contrato ni margen. */
function vistaCompras_(libro, proyecto) {
  const c = contratosFirmados_()[proyecto.folio.toUpperCase()] || null;
  return {
    proyecto: { folio: proyecto.folio, nombre: proyecto.nombre, cliente: proyecto.cliente, estado: proyecto.estado,
      ubicacion: proyecto.ubicacion },
    moneda: c ? c.moneda : '',
    marca: c ? c.marca : '',
    puedeEmitir: !!c && proyecto.estado === 'Activo',
    ordenes: ordenesDeProyecto_(libro, proyecto.folio).map(o => { const x = Object.assign({}, o); delete x.fila; return x; }).reverse(),
    proveedores: proveedoresDelLibro_(libro).map(p => { const x = Object.assign({}, p); delete x.fila; return x; }),
    ivaTasas: IVA_OC,
    hoy: hoyIso_(),
  };
}

/** Proyectos donde se pueden emitir órdenes: Activos y con contrato firmado (con su moneda; sin montos). */
function listarProyectosCompras(busqueda) {
  exigirCompras_();
  const firmados = contratosFirmados_();
  const hoja = hojaProyectos_();
  const filas = hoja.getLastRow() > 1 ? hoja.getRange(2, 1, hoja.getLastRow() - 1, ENCABEZADOS_PROYECTOS.length).getValues() : [];
  return filtrarProyectos(proyectosDesdeFilas(filas).filter(p => firmados[p.folio.toUpperCase()]), busqueda, false, 50)
    .map(p => {
      const c = firmados[p.folio.toUpperCase()];
      return { folio: p.folio, nombre: p.nombre, cliente: p.cliente, ubicacion: p.ubicacion, estado: p.estado, fecha: p.fecha,
        moneda: c.moneda, marca: c.marca };
    });
}

function getComprasProyecto(folio) {
  exigirCompras_();
  const libro = libroCompras_();
  return vistaCompras_(libro, proyectoParaCompras_(folio));
}

/**
 * Emite una orden de compra con su PDF. p = {proyectoFolio, proveedor: {razonSocial, rfc, contacto, correo, telefono},
 * fechaEntrega, lugarEntrega, condicionesPago, moneda, tipoCambio, ivaTasa, renglones: [{clave, descripcion, unidad,
 * cantidad, costo}], notas, idSolicitud}. Solo en proyectos Activos con contrato firmado. La línea de negocio sale del
 * contrato (nunca del navegador); el costo es el capturado (nunca el precio de venta del catálogo).
 */
function guardarOrdenCompra(p) {
  exigirCompras_();
  const d0 = p || {};
  const cfg = getConfig_();
  const libro = libroCompras_();

  const idSolicitud = String(d0.idSolicitud || '').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const claveCache = idSolicitud ? 'OC_' + idSolicitud : '';

  return conCandado_(() => {
    if (claveCache) {
      const previo = cache.get(claveCache);
      if (previo) return JSON.parse(previo);
    }
    const proyecto = proyectoParaCompras_(d0.proyectoFolio);
    if (proyecto.estado !== 'Activo') {
      throw new Error('El proyecto ' + proyecto.folio + ' está ' + proyecto.estado.toLowerCase() + ': no admite órdenes de compra.');
    }
    const c = contratosFirmados_()[proyecto.folio.toUpperCase()];
    if (!c) throw new Error('Solo se emiten órdenes de compra en proyectos con contrato firmado.');
    const oc = normalizarOrdenCompra(d0, { moneda: c.moneda, ubicacion: proyecto.ubicacion, hoy: hoyIso_(), ivaTasa: cfg.IVA_TASA });

    const hoja = hojaCompras_(libro, 'OrdenesCompra');
    const folio = siguienteFolio_(PREFIJO_OC, hoja, 'CONSECUTIVO_OC_');
    const proveedor = guardarProveedor_(libro, oc.proveedor);
    const ahora = new Date();
    const elaboro = [VENDEDOR_.nombre, VENDEDOR_.apellido].filter(Boolean).join(' ') || VENDEDOR_.email;

    // PDF (razón social y datos fiscales de Helgen, iguales en Helgen y Helgen Energy)
    const html = construirHtmlOrdenCompra(Object.assign({}, oc, {
      folio: folio, fecha: Utilities.formatDate(ahora, 'America/Mexico_City', 'dd/MM/yyyy'), proveedor: proveedor,
      proyectoFolio: proyecto.folio, elaboro: elaboro + (elaboro === VENDEDOR_.email ? '' : ' (' + VENDEDOR_.email + ')'),
    }), cfg, logoDataUrl_(cfg.LOGO_FILE_ID));
    const pdf = Utilities.newBlob(html, 'text/html', folio + '.html').getAs('application/pdf')
      .setName(nombreArchivoOc(folio, proveedor.razonSocial));
    const anio = String(proyecto.folio).split('-')[1] || hoyIso_().slice(0, 4);
    // De arriba abajo: un permiso heredado de la carpeta no se puede quitar en el hijo
    const carpeta = privado_(subcarpeta_(privado_(subcarpeta_(carpetaCompras_(), anio)), proyecto.folio));
    const archivo = privado_(carpeta.createFile(pdf));

    const t = textoCelda;
    hoja.appendRow([
      folio, textoFecha_(hoyIso_()), proyecto.folio, MARCAS[c.marca], t(proveedor.id), t(proveedor.razonSocial), t(proveedor.rfc),
      t(proveedor.contacto), t(proveedor.correo), t(proveedor.telefono), textoFecha_(oc.fechaEntrega), t(oc.lugarEntrega),
      t(oc.condicionesPago), oc.moneda, oc.ivaTasa, oc.subtotal, oc.iva, oc.total, oc.monedaProyecto, oc.tipoCambio,
      oc.subtotalProyecto, JSON.stringify(oc.renglones), t(oc.notas), archivo.getId(), archivo.getUrl(), t(VENDEDOR_.email),
      t(elaboro), Utilities.formatDate(ahora, 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss'), OC_EMITIDA, '', '', '', '', '',
    ]);
    bitacora_(libro, 'Emitir orden de compra', proyecto.folio, folio + ' · ' + proveedor.razonSocial + ' · ' +
      formatoMoneda(oc.total) + ' ' + oc.moneda + (oc.tipoCambio ? ' · TC ' + oc.tipoCambio + ' = ' +
      formatoMoneda(oc.subtotalProyecto) + ' ' + oc.monedaProyecto + ' sin IVA' : '') + ' · ' + MARCAS[c.marca], '', HOJAS_COMPRAS);
    SpreadsheetApp.flush();

    const resultado = { folio: folio, url: archivo.getUrl(), total: oc.total, moneda: oc.moneda, vista: vistaCompras_(libro, proyecto) };
    if (claveCache) cache.put(claveCache, JSON.stringify(resultado), 21600); // 6 h
    return resultado;
  });
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

/** Marca una orden Emitida como Recibida (completa), con la fecha de recepción (AAAA-MM-DD, no futura). */
function marcarOcRecibida(folioOc, fecha) {
  exigirCompras_();
  const libro = libroCompras_();
  return conCandado_(() => {
    const { hoja, orden } = buscarOrden_(libro, folioOc);
    if (orden.estado !== OC_EMITIDA) throw new Error('La orden ' + orden.folio + ' ya está ' + orden.estado.toLowerCase() + '.');
    const recepcion = validarFechaIso(fecha, hoyIso_(), 'La fecha de recepción');
    if (orden.fecha && recepcion < orden.fecha) throw new Error('La fecha de recepción no puede ser anterior a la orden (' + orden.fecha + ').');
    hoja.getRange(orden.fila, COL_ESTADO_OC, 1, 3).setValues([[OC_RECIBIDA, textoFecha_(recepcion), textoCelda(VENDEDOR_.email)]]);
    bitacora_(libro, 'Recibir orden de compra', orden.proyectoFolio, orden.folio + ' · recibida el ' + recepcion, '', HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    return vistaCompras_(libro, proyectoParaCompras_(orden.proyectoFolio));
  });
}

/** Cancela una orden Emitida (no se borra), con motivo; queda en la Bitacora y deja de contar en el margen. */
function cancelarOrdenCompra(folioOc, motivo) {
  exigirCompras_();
  const m = String(motivo || '').trim();
  if (m.length < 5) throw new Error('Escribe el motivo de la cancelación.');
  if (m.length > 500) throw new Error('El motivo debe tener máximo 500 caracteres.');
  const libro = libroCompras_();
  return conCandado_(() => {
    const { hoja, orden } = buscarOrden_(libro, folioOc);
    if (orden.estado === OC_CANCELADA) throw new Error('La orden ' + orden.folio + ' ya está cancelada.');
    if (orden.estado !== OC_EMITIDA) throw new Error('La orden ' + orden.folio + ' ya se recibió: no se puede cancelar.');
    hoja.getRange(orden.fila, COL_ESTADO_OC).setValue(OC_CANCELADA);
    hoja.getRange(orden.fila, COL_ESTADO_OC + 3, 1, 3).setValues([[textoCelda(VENDEDOR_.email),
      Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss'), textoCelda(m)]]);
    bitacora_(libro, 'Cancelar orden de compra', orden.proyectoFolio, orden.folio + ' · ' + orden.proveedor + ' · ' +
      formatoMoneda(orden.total) + ' ' + orden.moneda, m, HOJAS_COMPRAS);
    SpreadsheetApp.flush();
    return vistaCompras_(libro, proyectoParaCompras_(orden.proyectoFolio));
  });
}

/**
 * Correr desde el editor: crea la carpeta "Cotizador Helgen — Compras" (en Mi unidad) y su libro, y deja los dos en
 * "Restringido" (también si ya existían). No comparte nada: a quien deba abrir los PDF se le comparte la carpeta en Drive.
 */
function prepararCompras() {
  const libro = libroCompras_();
  const carpeta = carpetaCompras_(); // primero la carpeta: el libro hereda su acceso y Drive no deja quitarlo en el hijo
  const archivoLibro = privado_(DriveApp.getFileById(libro.getId()));
  getConfig_(); // agrega TERMINOS_OC a la pestaña Config si falta
  Logger.log('Carpeta de compras: ' + carpeta.getUrl() + ' (restringida)');
  Logger.log('Libro de compras:   ' + archivoLibro.getUrl() + ' (restringido)');
  Logger.log('ROL_COMPRAS: ' + (PropertiesService.getScriptProperties().getProperty('ROL_COMPRAS') || '(vacío: nadie tiene acceso)'));
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

/** Valida y limpia un proyecto nuevo. El cliente se guarda como "nombre — empresa" más su cliente_id. */
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
  return (filas || []).filter(r => String(r[0] || '').trim()).map(r => ({
    folio: String(r[0]).trim(),
    fecha: r[1] instanceof Date
      ? [r[1].getDate(), r[1].getMonth() + 1].map(x => String(x).padStart(2, '0')).join('/') + '/' + r[1].getFullYear()
      : String(r[1] || ''),
    nombre: String(r[2] || ''), cliente: String(r[3] || ''), clienteId: String(r[4] || ''),
    ubicacion: String(r[5] || ''),
    estado: String(r[6] || '').trim() || 'Activo',
    carpetaId: String(r[7] || ''),
  }));
}

/** Busca por folio, cliente o nombre (sin acentos ni mayúsculas); más recientes primero; máximo n. */
function filtrarProyectos(lista, busqueda, incluirInactivos, n) {
  const q = textoNormal(busqueda);
  return (lista || []).slice().reverse()
    .filter(p => incluirInactivos || p.estado === 'Activo')
    .filter(p => !q || textoNormal(p.folio + ' ' + p.cliente + ' ' + p.nombre).includes(q))
    .slice(0, n || 50);
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
  if (!bytes || !bytes.length) throw new Error('Adjunta el comprobante de pago (PDF o imagen).');
  if (bytes.length > MAX_COMPROBANTE) throw new Error('El comprobante pesa más de 10 MB. Reduce la imagen o el PDF.');
  const b = i => (bytes[i] || 0) & 0xFF;
  const txt = (desde, n) => String.fromCharCode.apply(null, Array.from({ length: n }, (_, i) => b(desde + i)));
  if (txt(0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b(0) === 0x89 && txt(1, 3) === 'PNG') return { mime: 'image/png', ext: 'png' };
  if (txt(4, 4) === 'ftyp' && ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].indexOf(txt(8, 4)) !== -1) {
    return { mime: 'image/heic', ext: 'heic' };
  }
  throw new Error('El comprobante debe ser PDF o imagen (JPG, PNG o HEIC).');
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

/** Datos de un proveedor ya registrado + los nuevos: lo nuevo manda, pero un dato vacío no borra uno anterior. */
function fusionarProveedor(anterior, nuevo) {
  const r = {};
  ['razonSocial', 'rfc', 'contacto', 'correo', 'telefono'].forEach(k => {
    r[k] = String((nuevo && nuevo[k]) || '').trim() || String((anterior && anterior[k]) || '').trim();
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
    actualizado: r[6] instanceof Date ? r[6].toISOString().slice(0, 10) : String(r[6] || ''), fila: i + 2,
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
    moneda: moneda, ivaTasa: ivaTasa, renglones: renglones, subtotal: subtotal, iva: iva, total: redondear(subtotal + iva),
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
 * MXN y USD. Renglones: firmados primero, del mayor saldo al menor; luego los por firmar.
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
      folio: p.folio, nombre: p.nombre, cliente: p.cliente, estadoProyecto: p.estado, marca: c.marca, moneda: c.moneda,
      estadoContrato: c.estado === ESTADO_FIRMADO ? 'Firmado' : 'Por firmar', cotizacion: c.cotizacion, fechaFirma: c.fechaFirma,
      contratado: r.contratado, subtotal: r.subtotal, pagado: r.pagado, saldo: r.saldo, avance: r.avance,
      siguienteEtapa: siguiente ? siguiente.etapa : '', siguienteSaldo: siguiente ? siguiente.saldo : 0, ultimoPago: ultimoPago,
      ordenes: ocs.length, costoOc: margen ? margen.totalCostos : null, margen: margen ? margen.margen : null,
      margenPorcentaje: margen ? margen.porcentaje : null, margenError: margenError,
    });
  });
  renglones.sort((a, b) => (a.estadoContrato === b.estadoContrato ? 0 : a.estadoContrato === 'Firmado' ? -1 : 1) ||
    b.saldo - a.saldo || (a.folio < b.folio ? -1 : 1));

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
    'Elaboró: ' + e(d.elaboro) + ' &nbsp;·&nbsp; ' + e(cfg.EMPRESA_EMAIL) + ' &nbsp;·&nbsp; ' + e(cfg.EMPRESA_TELEFONO) +
    '</div>' +
    '</body></html>';
}
