// Arnés compartido para las pruebas del incremento 4 (CAPRI): carga Logo.js + Code.js en un contexto de Node con los
// servicios de Google simulados (Sheets, Drive con el acceso del dominio, Cache, Properties, Lock, UrlFetch, MailApp).
// Las pruebas de antes tienen su propia copia de este simulacro; las nuevas usan este.
//   const A = require('./arnes')(dir, {props: {...}, tokens: {nombre: claims}, rutas: [{re, fn}]});
//   A.ok('efrain','bootstrap'); A.falla('ana','listarUsuarios',[],/super admin/,'PERMISO'); A.correos (lo que mandó MailApp)
// Perfil (tests/perfil.js; docs/rapidez-apps-script.md): con {perfil: true} cada operación con un servicio de Google queda en
// A.perfil.ops ({tipo, hoja, celdas, candado, pila}) y A.ultimaRespuesta guarda los bytes del JSON de la última llamada.
// Sin la opción no se anota nada (las pruebas corren igual).
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path'), crypto = require('crypto');

module.exports = function crearArnes(dir, opciones) {
  const op = opciones || {};
  // ---- Perfil: tipos = lee, escribe, formato, ultimaFila, dataRange, abrir, drive, driveCrea, cache, props, candado,
  // urlfetch, correo, pdf. candado = ¿se hizo con el candado de script tomado? pila = funciones de Code.js (con perfil.pila) ----
  const perfil = { activo: !!op.perfil, pila: false, ops: [], enCandado: 0 };
  const pilaCode = () => { const lim = Error.stackTraceLimit; Error.stackTraceLimit = 60; const e = new Error(); Error.stackTraceLimit = lim; return String(e.stack).split('\n').filter(l => /capri\.js/.test(l))
    .map(l => (l.match(/at (?:Object\.)?([\w$.]+) \(/) || [])[1]).filter(Boolean).slice(0, 20); };
  const anota = (tipo, extra) => {
    if (!perfil.activo) return;
    const o = Object.assign({ tipo, candado: perfil.enCandado > 0 }, extra || {});
    if (perfil.pila) o.pila = pilaCode();
    perfil.ops.push(o);
  };
  let src = fs.readFileSync(path.join(dir, 'Logo.js'), 'utf8') + '\n' + fs.readFileSync(path.join(dir, 'Code.js'), 'utf8');
  const CID = '123-abc.apps.googleusercontent.com';
  src = src.replace(/const CLIENT_ID_GOOGLE = '[^']*';/, "const CLIENT_ID_GOOGLE = '" + CID + "';");
  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const HOY = new Date(), HOY_ISO = iso(HOY);
  const masDias = n => iso(new Date(HOY.getTime() + n * 86400000));

  // ---- Hojas y libros (como Sheets: un texto que parece fecha se guarda como Date; con apóstrofo, como texto) ----
  const comoSheets = v => {
    if (typeof v !== 'string') return v;
    if (v[0] === "'") return v.slice(1);
    const x = v.match(/^(\d{4})-(\d\d)-(\d\d)(?: (\d\d):(\d\d)(?::(\d\d))?)?$/);
    return x ? new Date(+x[1], +x[2] - 1, +x[3], +(x[4] || 0), +(x[5] || 0), +(x[6] || 0)) : v;
  };
  // Nombre "libro/pestaña" de una hoja (solo para el perfil)
  const quien = m => { for (const id in libros) for (const n in libros[id].pest) if (libros[id].pest[n].m === m) return (libros[id].nombre || id) + '/' + n; return '?'; };
  const an = (tipo, m, celdas) => perfil.activo && anota(tipo, { hoja: quien(m), celdas: celdas || 0 });
  // Rapidez (filas leídas en la petición, MEMO_.filas): en cada escritura, el código no puede tener guardadas filas de esa misma
  // pestaña (toda escritura pasa por escribe_, que las olvida). Si las tiene, la siguiente lectura devolvería algo viejo: falla.
  // Lo mismo con los memos derivados (MEMOS_DERIVADOS_: MEMO_.devs, pagosProv, anulados, ctxRoles, rolesYo, cfgLigera): una
  // escritura en una pestaña de donde sale uno que sigue guardado falla.
  let leerMemo = null;
  const revisarMemo = (m, idHoja) => {
    if (!leerMemo) return;
    const { filas, derivados } = leerMemo.runInContext(ctx);
    if (!filas.length && !derivados.length) return;
    const nombre = quien(m).split('/').slice(-1)[0];
    const mala = filas.find(k => k.endsWith('/' + nombre + '/' + idHoja));
    if (mala) throw new Error('Rapidez: escritura en ' + quien(m) + ' con sus filas guardadas en MEMO_.filas (' + mala + '): falta escribe_');
    const derivado = derivados.find(d => d.de.indexOf(nombre) !== -1);
    if (derivado) throw new Error('Rapidez: escritura en ' + quien(m) + ' con MEMO_.' + derivado.k + ' guardado (sale de esa pestaña): falta escribe_');
  };
  let nHoja = 0; // getSheetId: cada pestaña tiene su id (una pestaña borrada y vuelta a crear tiene otro)
  function hoja(m) {
    const fmt = function () { an('formato', m); return this; };
    const idHoja = ++nHoja;
    return { m, getSheetId: () => idHoja, getName: () => quien(m).split('/').slice(-1)[0], getLastRow: () => { an('ultimaFila', m); return m.length; }, getMaxRows: () => { an('ultimaFila', m); return 1000; },
      setFrozenRows() { an('formato', m); }, setColumnWidth() { an('formato', m); },
      getDataRange: () => { an('dataRange', m); return {
        getValues: () => { an('lee', m, m.reduce((s, r) => s + r.length, 0)); return m.map(r => r.slice()); },
        getDisplayValues: () => { an('lee', m, m.reduce((s, r) => s + r.length, 0)); return m.map(r => r.map(x => String(x ?? ''))); } }; },
      appendRow: a => { revisarMemo(m, idHoja); an('escribe', m, a.length); return m.push(a.map(comoSheets)); },
      deleteRow: n => { revisarMemo(m, idHoja); an('escribe', m, 1); return m.splice(n - 1, 1); },
      getRange: (r, c = 1, nr = 1, nc = 1) => typeof r === 'string' ? { setNumberFormat: fmt, setDataValidation: fmt } : ({
        getValues: () => { an('lee', m, nr * nc); return Array.from({ length: nr }, (_, i) => { const f = (m[r - 1 + i] || []).slice(c - 1, c - 1 + nc); while (f.length < nc) f.push(''); return f; }); },
        getValue: () => { an('lee', m, 1); return ((m[r - 1] || [])[c - 1] ?? ''); },
        setValue(v) { revisarMemo(m, idHoja); an('escribe', m, 1); m[r - 1] = m[r - 1] || []; m[r - 1][c - 1] = comoSheets(v); return this; },
        setValues(vs) { revisarMemo(m, idHoja); an('escribe', m, vs.length * ((vs[0] || []).length)); vs.forEach((x, i) => { m[r - 1 + i] = m[r - 1 + i] || []; x.forEach((y, j) => m[r - 1 + i][c - 1 + j] = comoSheets(y)); }); return this; },
        setNumberFormat: fmt, setFontWeight: fmt, setBackground: fmt, setFontColor: fmt, setDataValidation: fmt }) };
  }
  const libros = {};
  function libro(id, nombre, pestanas) {
    const L = { id, nombre, pest: pestanas || {}, getId: () => id, getUrl: () => 'https://sheets/' + id,
      getSheetByName: n => L.pest[n] || null, getSheets: () => Object.values(L.pest),
      insertSheet: n => { if (L.pest[n]) throw new Error('ya existe'); perfil.activo && anota('escribe', { hoja: (nombre || id) + '/' + n, celdas: 0 }); return L.pest[n] = hoja([]); },
      deleteSheet: h => { for (const k in L.pest) if (L.pest[k] === h) delete L.pest[k]; } };
    libros[id] = L;
    return L;
  }

  // ---- Drive (todo lo nuevo nace compartido con el dominio; privado_ lo quita con la API de Drive) ----
  // Ligas con el formato real de Drive (revisión 5b): el centro de mando solo acepta https://drive.google.com/… o docs.google.com
  const urlArchivo = id => 'https://drive.google.com/file/d/' + id + '/view', urlCarpeta = id => 'https://drive.google.com/drive/folders/' + id;
  let nId = 0;
  const carpetas = {}, archivos = {};
  const compartible = o => Object.assign(o, { acceso: 'DOMAIN', setSharing: () => { throw new Error('Access denied: DriveApp.'); } });
  function apiDrive(url, opf) {
    const m = url.match(/drive\/v3\/files\/([^/?]+)\/permissions(?:\/([^?]+))?/);
    const it = carpetas[decodeURIComponent(m[1])] || archivos[decodeURIComponent(m[1])];
    const resp = (c, b) => ({ getResponseCode: () => c, getContentText: () => JSON.stringify(b || {}) });
    if (!it) return resp(404);
    let heredado = false;
    for (let f = it.padre; f; f = f.padre) if (f.acceso === 'DOMAIN') heredado = true;
    if (opf.method === 'delete') { if (heredado) return resp(403, { error: { reason: 'cannotDeletePermission' } }); it.acceso = 'PRIVATE'; return resp(204); }
    return resp(200, { permissions: [{ id: 'own', type: 'user' }].concat(it.acceso === 'DOMAIN' || heredado ? [{ id: 'dom', type: 'domain' }] : []) });
  }
  function carpeta(nombre, padre) {
    const f = compartible({ id: 'F' + (++nId), nombre, padre, hijos: [], archivos: [], trashed: false });
    Object.assign(f, { getId: () => f.id, getName: () => f.nombre, getUrl: () => urlCarpeta(f.id), isTrashed: () => f.trashed,
      setName: n => { anota('drive', { que: 'setName' }); f.nombre = n; return f; },
      getFoldersByName: n => { anota('drive', { que: 'getFoldersByName ' + n }); const l = f.hijos.filter(h => h.nombre === n); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; },
      // Incremento 5 (F): archivos por nombre (documentos de proveedor: "(2)", "(3)"… sin borrar el anterior)
      getFilesByName: n => { anota('drive', { que: 'getFilesByName' }); const l = f.archivos.filter(a => a.nombre === n); let i = 0;
        return { hasNext: () => i < l.length, next: () => { const a = l[i++]; return { isTrashed: () => !!a.trashed, getId: () => a.id }; } }; },
      createFolder: n => { anota('driveCrea', { que: 'createFolder ' + n }); const h = carpeta(n, f); f.hijos.push(h); return h; },
      createFile: b => { anota('driveCrea', { que: 'createFile' }); const id = 'A' + (++nId); const a = compartible({ id, blob: b, padre: f, nombre: b && b.name });
        archivos[id] = a; f.archivos.push(a);
        return Object.assign(a, { getId: () => id, getUrl: () => urlArchivo(id), getName: () => a.nombre, setName: n => { anota('drive', { que: 'setName' }); a.nombre = n; return a; } }); } });
    carpetas[f.id] = f;
    return f;
  }
  const miUnidad = carpeta('Mi unidad', null), maestra = miUnidad.createFolder('Cotizador Helgen'),
    pdfRaiz = maestra.createFolder('Cotizaciones Helgen (PDF)');
  miUnidad.acceso = 'PRIVATE';
  archivos.DB = { id: 'DB', padre: maestra };
  libro('DB', 'Base de datos', { Config: hoja([['Clave', 'Valor'], ['PREFIJO_FOLIO', 'HLG'], ['IVA_TASA', 0.16]]), Cotizaciones: hoja([]) });
  libro('CAT', 'Catálogo', { Catalogo: hoja([['Clave', 'Descripción', 'Unidad', 'Precio unitario (sin IVA)', 'Actualizado', 'Actualizó', 'Clave SAT', 'Unidad SAT'],
    ['PAN-550', 'Panel solar 550 W', 'PZA', 4100, '', '', '', '']]) });

  const props = Object.assign({ SPREADSHEET_ID: 'DB', FOLDER_ID: pdfRaiz.id, CATALOGO_ID: 'CAT' }, op.props || {});
  const cache = {};

  // ---- Tokens de Google (claims): por omisión efrain, tania, leo, ana, obrero, rosa, adri; op.tokens agrega/cambia ----
  const ahora = Math.floor(Date.now() / 1000);
  const claims = (email, n, a) => ({ aud: CID, iss: 'https://accounts.google.com', exp: String(ahora + 3000), email,
    email_verified: 'true', hd: 'helgen.tech', given_name: n, family_name: a });
  const tokens = Object.assign({ efrain: claims('efrain@helgen.tech', 'Efrain', 'Sosa'), tania: claims('tania@helgen.tech', 'Tania', 'R'),
    leo: claims('leo@helgen.tech', 'Leo', 'Rodríguez'), ana: claims('ana@helgen.tech', 'Ana', 'López'),
    obrero: claims('obrero@helgen.tech', 'Juan', 'Obrero'), rosa: claims('rosa@helgen.tech', 'Rosa', 'Mena'),
    adri: claims('adri@helgen.tech', 'Adriana', 'Del Ángel'), pedro: claims('pedro@helgen.tech', 'Pedro', 'Ruiz') }, op.tokens || {});

  // ---- UrlFetch: Drive, tokeninfo de Google y las rutas que agregue la prueba ({re, fn(url, opciones) → {codigo, cuerpo}}) ----
  const rutas = op.rutas || [];
  const llamadas = [];
  // Un Buffer en cuerpo = respuesta binaria (getContent da bytes con signo, como Apps Script; incremento 5: fotos del centro de mando)
  const respuesta = (codigo, cuerpo) => ({ getResponseCode: () => codigo,
    getContent: () => Buffer.isBuffer(cuerpo) ? [...cuerpo].map(x => x > 127 ? x - 256 : x) : [...Buffer.from(String(cuerpo == null ? '' : cuerpo))],
    getContentText: () => Buffer.isBuffer(cuerpo) ? cuerpo.toString('binary') : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo == null ? {} : cuerpo) });
  function fetch(url, opf) {
    anota('urlfetch', { que: String(url).replace(/^https:\/\/([^/]+)(\/[^?]*)?.*$/, '$1$2').replace(/\/files\/[^/]+/, '/files/…').slice(0, 80) });
    llamadas.push({ url, opciones: opf });
    if (/googleapis\.com\/drive\//.test(url)) return apiDrive(url, opf);
    const ruta = rutas.find(r => r.re.test(url));
    if (ruta) { const r = ruta.fn(url, opf || {}); return respuesta(r.codigo == null ? 200 : r.codigo, r.cuerpo); }
    if (/oauth2\.googleapis\.com\/tokeninfo/.test(url)) {
      const t = decodeURIComponent(url.split('id_token=')[1]); const c = tokens[t];
      return respuesta(c ? 200 : 400, c || { error: 'invalid_token' });
    }
    return respuesta(404, { error: 'sin ruta simulada: ' + url });
  }

  // ---- MailApp: guarda lo que se manda (A.correos); A.fallarCorreo = true hace que falle ----
  const correos = [];
  const A = {};
  const MailApp = { sendEmail: m => { anota('correo'); if (A.fallarCorreo) throw new Error('Servicio de correo no disponible'); correos.push(m); },
    getRemainingDailyQuota: () => 1500 };

  const fmt = (d, tz, f) => f.replace('yyyy', d.getFullYear()).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate()))
    .replace('HH', pad(d.getHours())).replace('mm', pad(d.getMinutes())).replace('ss', pad(d.getSeconds()));
  const firmados = b => [...b].map(x => x > 127 ? x - 256 : x);
  const limiteCache = (k, v) => {
    if (String(k).length > 250) throw new Error('Argument too large: key');
    if (Buffer.byteLength(String(v), 'utf8') > 100 * 1024) throw new Error('Argument too large: value');
  };
  const activadores = [];
  const candado = { tomado: false };
  const ctx = { console: { ...console, warn() {}, log() {} }, Date, JSON, Math,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => { anota('props', { que: 'get ' + k }); return props[k] ?? null; },
      setProperty: (k, v) => { anota('props', { que: 'set ' + k }); return props[k] = String(v); },
      deleteProperty: k => { anota('props', { que: 'delete ' + k }); delete props[k]; },
      getProperties: () => { anota('props', { que: 'getProperties' }); return Object.assign({}, props); },
      setProperties: o => { anota('props', { que: 'setProperties' }); return Object.assign(props, o); } }) },
    // Como el de Apps Script: una clave de más de 250 caracteres o un valor de más de 100 KB lanza "Argument too large" (revisión
    // del incremento 6: un caché de idempotencia que lanzaba DESPUÉS de escribir dejaba duplicar un pago al reintentar)
    CacheService: { getScriptCache: () => ({ get: k => { anota('cache', { que: 'get', clave: k, acierto: k in cache }); return cache[k] ?? null; },
      put: (k, v) => { anota('cache', { que: 'put', clave: k }); limiteCache(k, v); return cache[k] = v; },
      remove: k => { anota('cache', { que: 'remove', clave: k }); delete cache[k]; },
      getAll: ks => { anota('cache', { que: 'getAll', clave: ks[0] }); return Object.fromEntries(ks.filter(k => k in cache).map(k => [k, cache[k]])); },
      putAll: o => { anota('cache', { que: 'putAll', clave: Object.keys(o)[0] }); Object.keys(o).forEach(k => limiteCache(k, o[k])); return Object.assign(cache, o); } }) },
    // El candado de script: uno por ejecución, como en Apps Script (cada getScriptLock() es el mismo candado: tomarlo otra vez
    // estando tomado regresa true y soltarlo una vez lo suelta completo, aunque se haya tomado dos veces). El perfil lleva la
    // cuenta de lo que se hace con él tomado; A.candadoTomado() dice si está tomado.
    LockService: { getScriptLock: () => ({
      tryLock() { anota('candado'); if (!candado.tomado) { candado.tomado = true; perfil.enCandado = 1; } return true; },
      releaseLock() { candado.tomado = false; perfil.enCandado = 0; },
      hasLock() { return candado.tomado; } }) },
    Session: { getActiveUser: () => ({ getEmail: () => '' }) },
    Logger: { log() {} },
    Utilities: { formatDate: fmt, newBlob: (a, b, c) => typeof a === 'string'
        ? { getAs: () => { anota('pdf'); return { setName: n => ({ name: n, html: a, getBytes: () => [...Buffer.from(a)] }) }; }, getDataAsString: () => a }
        : { bytes: a, mime: b, name: c, getBytes: () => a, getName: () => c, getContentType: () => b },
      base64Encode: b => Buffer.from(typeof b === 'string' ? b : b.map(x => (x + 256) % 256)).toString('base64'),
      base64Decode: s => firmados(Buffer.from(s, 'base64')),
      base64EncodeWebSafe: b => Buffer.from(typeof b === 'string' ? b : b.map(x => (x + 256) % 256)).toString('base64url'),
      base64DecodeWebSafe: s => firmados(Buffer.from(s, 'base64url')),
      DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (a, s) => firmados(crypto.createHash(a || 'sha256').update(typeof s === 'string' ? s : Buffer.from(s)).digest()),
      computeHmacSha256Signature: (v, k) => firmados(crypto.createHmac('sha256', typeof k === 'string' ? k : Buffer.from(k)).update(typeof v === 'string' ? v : Buffer.from(v)).digest()),
      getUuid: () => crypto.randomUUID(), sleep() {} },
    ScriptApp: { getOAuthToken: () => 'TOKEN-SCRIPT', getProjectTriggers: () => activadores.slice(),
      deleteTrigger: t => { const i = activadores.indexOf(t); if (i !== -1) activadores.splice(i, 1); },
      newTrigger: f => { const t = { f, getHandlerFunction: () => f }; const b = { timeBased: () => b, everyMinutes: n => { t.cada = n; return b; },
        everyHours: n => { t.horas = n; return b; }, create: () => { activadores.push(t); return t; } }; return b; } },
    UrlFetchApp: { fetch },
    MailApp,
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ t, setMimeType() { return this; } }) },
    SpreadsheetApp: { flush() {}, openById: id => { anota('abrir', { hoja: id }); if (!libros[id]) throw new Error('No encontrado'); return libros[id]; },
      create: n => { anota('driveCrea', { que: 'SpreadsheetApp.create' }); const L = libro('S' + (++nId), n, { 'Hoja 1': hoja([]) }); archivos[L.id] = compartible({ id: L.id, padre: miUnidad }); return L; },
      newDataValidation: () => { const b = { requireValueInList: () => b, setAllowInvalid: () => b, setHelpText: () => b, build: () => ({}) }; return b; } },
    DriveApp: { getFolderById: id => { anota('drive', { que: 'getFolderById' }); if (!carpetas[id]) throw new Error('No se encontró'); return carpetas[id]; },
      createFolder: n => miUnidad.createFolder(n), getRootFolder: () => { anota('drive', { que: 'getRootFolder' }); return miUnidad; },
      getFileById: id => { anota('drive', { que: 'getFileById' }); const a = archivos[id]; if (!a) throw new Error('No se encontró el archivo');
        return { getParents: () => { anota('drive', { que: 'getParents' }); let d = false; return { hasNext: () => !d, next: () => { d = true; return a.padre; } }; },
          moveTo: f => { anota('drive', { que: 'moveTo' }); a.padre = f; }, setSharing: () => a.setSharing(), getId: () => id, getUrl: () => urlArchivo(id),
          getName: () => a.nombre || (a.blob && a.blob.name) || '', setName: n => { anota('drive', { que: 'setName' }); a.nombre = n; },
          isTrashed: () => !!a.trashed,
          getBlob: () => ({ getName: () => a.blob.name, getContentType: () => a.blob.mime, getBytes: () => a.blob.bytes }) }; },
      Access: { PRIVATE: 'PRIVATE', DOMAIN: 'DOMAIN' }, Permission: { NONE: 'NONE', VIEW: 'VIEW' } },
  };
  if (op.ctxExtra) Object.assign(ctx, op.ctxExtra);
  vm.createContext(ctx);
  vm.runInContext(src, ctx, perfil.activo ? { filename: 'capri.js' } : undefined);
  leerMemo = new vm.Script("(() => { const m = typeof MEMO_ === 'object' && MEMO_ ? MEMO_ : {}; " +
    "const d = typeof MEMOS_DERIVADOS_ === 'object' ? MEMOS_DERIVADOS_ : {}; " +
    "return { filas: m.filas ? Object.keys(m.filas) : [], derivados: Object.keys(d).filter(k => m[k] != null).map(k => ({ k: k, de: d[k] })) }; })()");

  // ultimaRespuesta = bytes (UTF-8) del JSON que devolvió doPost en la última llamada (perfil)
  const post = (quien, funcion, ...args) => {
    const t = ctx.doPost({ postData: { contents: JSON.stringify({ funcion, args, token: quien }) } }).t;
    A.ultimaRespuesta = Buffer.byteLength(t, 'utf8');
    return JSON.parse(t);
  };
  const ok = (quien, funcion, ...args) => { const r = post(quien, funcion, ...args); assert(r.ok, funcion + ': ' + r.error); return r.datos; };
  const falla = (quien, funcion, args, re, codigo) => {
    const r = post(quien, funcion, ...(args || []));
    assert.equal(r.ok, false, funcion + ' debía fallar');
    assert(re.test(r.error), funcion + ': ' + r.error);
    if (codigo) assert.equal(r.codigo, codigo, funcion + ' codigo');
    return r;
  };
  const plain = x => JSON.parse(JSON.stringify(x));
  // Para leer o cambiar variables let/const del código (VENDEDOR_, MEMO_, SITIOS_INICIALES…), que no son propiedades de ctx
  const correr = codigo => vm.runInContext(codigo, ctx);
  const como = (correo, nombre) => correr('VENDEDOR_ = ' + JSON.stringify(correo ? { email: correo, nombre: nombre || correo, apellido: '' } : null) + '; MEMO_ = {};');
  // Incremento 5 (recepción con fotos): FOTO = un JPEG mínimo en base64; conFotos(renglones) le pone su foto a cada renglón y
  // FOTOS = {renglones: [{renglon: 1…20, foto}]} para "Recibí el material" y "Lo recogí"
  const FOTO = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1]).toString('base64');
  const conFotos = rs => rs.map(r => Object.assign({ foto: { nombre: 'foto.jpg', datos: FOTO, mime: 'image/jpeg' } }, r));
  const FOTOS = { renglones: conFotos(Array.from({ length: 20 }, (_, i) => ({ renglon: i + 1 }))) };
  return Object.assign(A, { perfil, candadoTomado: () => candado.tomado, urlArchivo, urlCarpeta, ctx, P: ctx, correr, como, post, ok, falla, plain, props, cache, libros, carpetas, archivos, correos, llamadas, rutas,
    tokens, claims, activadores, HOY, HOY_ISO, masDias, ANIO: String(HOY.getFullYear()), miUnidad, maestra, hoja, libro,
    PDF: Buffer.from('%PDF-1.4 cotizacion del proveedor').toString('base64'), FOTO, conFotos, FOTOS });
};
