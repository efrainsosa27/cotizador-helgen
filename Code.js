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
  } finally {
    VENDEDOR_ = null;
  }
  return ContentService.createTextOutput(JSON.stringify(respuesta)).setMimeType(ContentService.MimeType.JSON);
}

// ====== 2. INSTALACIÓN (ejecutar 1 sola vez) ======

const TERMINO_VIGENCIA =
  'Precios vigentes por 15 días o hasta agotar existencias, sujetos a variaciones en costos de suministro de componentes.';

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
  'vendedor_email', 'vendedor_nombre', 'vendedor_apellido'
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
  return hoja;
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
  const filas = (hoja || hojaCatalogo_()).getDataRange().getValues().slice(1);
  return filas
    .filter(r => r[0] && r[1])
    .map(r => ({ clave: String(r[0]), descripcion: String(r[1]), unidad: String(r[2] || 'PZA'), precio: Number(r[3]) || 0,
      claveSat: String(r[6] || ''), unidadSat: String(r[7] || '') }));
}

/** Datos para la pestaña Catálogo de la app (incluye las unidades del SAT para elegir). */
function getCatalogo() {
  const hoja = hojaCatalogo_();
  let unidadesSat = [];
  try { unidadesSat = getUnidadesSat_(); } catch (e) { /* sin catálogo SAT: la app sigue funcionando */ }
  return { productos: getCatalogo_(hoja), url: hoja.getParent().getUrl(), unidadesSat: unidadesSat };
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
    SpreadsheetApp.flush();
    return { productos: getCatalogo_(hoja), url: hoja.getParent().getUrl(), clave: prod.clave };
  } finally {
    lock.releaseLock();
  }
}

/** Llamada por la app al cargar. */
function getDatosIniciales() {
  const cfg = getConfig_();
  return {
    ivaTasa: cfg.IVA_TASA,
    vigenciaDias: cfg.VIGENCIA_DIAS,
    marcas: MARCAS,
    catalogo: getCatalogo_(),
    clientes: getClientes(),
    usuario: usuarioActual_(),
    vendedor: VENDEDOR_,
  };
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
  const datos = hoja.getDataRange().getDisplayValues().slice(1).reverse();
  const q = String(busqueda || '').toLowerCase().trim();
  return datos
    .filter(r => !q || (r[0] + ' ' + r[2] + ' ' + r[3]).toLowerCase().includes(q))
    .slice(0, 100)
    .map(r => ({
      folio: r[0], fecha: r[1], cliente: r[2], empresa: r[3], total: r[9], elaboro: r[10], pdf: r[11],
      // Filas anteriores a la sesión con Google no tienen vendedor: se muestra el correo de "Elaboró"
      vendedor: [r[17], r[18]].filter(Boolean).join(' ') || r[16] || r[10] || '',
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
    const archivo = carpetaDelAnio_(ahora.getFullYear()).createFile(pdf);

    // Registro (Marca, Dirección y vendedor_* se agregaron después: se ponen los encabezados que falten)
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
      t(vendedor.email), t(vendedor.nombre), t(vendedor.apellido),
    ]);
    SpreadsheetApp.flush();

    const resultado = { folio: folio, url: archivo.getUrl(), total: datos.total };
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
function siguienteFolio_(prefijo, hojaCot) {
  const props = PropertiesService.getScriptProperties();
  const anio = Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy');
  const clave = 'CONSECUTIVO_' + anio;
  const filas = hojaCot.getLastRow() > 1 ? hojaCot.getRange(2, 1, hojaCot.getLastRow() - 1, 1).getValues() : [];
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

  return {
    cliente: cliente, items: items, subtotal: subtotal, iva: iva, total: total, ivaTasa: ivaTasa,
    notas: String((p && p.notas) || '').trim(),
    marca: p && p.marca === 'energy' ? 'energy' : 'helgen',
  };
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
  const normal = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
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
    delete c.orden;
  });
  return lista;
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

/** 1234.5 -> "MIL DOSCIENTOS TREINTA Y CUATRO PESOS 50/100 M.N." */
function importeConLetra(n) {
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
  return base + de + (ent === 1 ? ' PESO ' : ' PESOS ') + String(cent).padStart(2, '0') + '/100 M.N.';
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
    '<th class="r" style="width:80px;">P. Unitario</th><th class="r" style="width:85px;">Importe</th></tr>' +
    filas + '</table>' +

    // Módulo 3: Totales
    '<div class="mod">3 · RESUMEN</div>' +
    '<table><tr>' +
    '<td style="width:58%;padding-left:0;">' +
    '<div style="color:' + GRIS + ';">Importe con letra</div>' +
    '<div style="font-weight:bold;color:' + AZUL + ';margin:2px 0 8px;">(' + importeConLetra(d.total) + ')</div>' +
    (d.notas ? '<div style="color:' + GRIS + ';">Notas</div><div>' + e(d.notas).replace(/\n/g, '<br>') + '</div>' : '') +
    '</td><td style="width:42%;padding-right:0;"><table>' +
    '<tr><td>Subtotal</td><td class="r">' + formatoMoneda(d.subtotal) + '</td></tr>' +
    '<tr><td>IVA (' + Math.round(d.ivaTasa * 100) + '%)</td><td class="r">' + formatoMoneda(d.iva) + '</td></tr>' +
    '<tr bgcolor="#E6FBF7" style="color:' + AZUL + ';font-weight:bold;font-size:14px;">' +
    '<td style="border-top:2px solid ' + AZUL + ';border-bottom:3px solid ' + AQUA + ';padding:7px 6px;">TOTAL ' + e(cfg.MONEDA || 'MXN') + '</td>' +
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
