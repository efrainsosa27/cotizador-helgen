// Arnés compartido para las pruebas del incremento 4 (CAPRI): carga Logo.js + Code.js en un contexto de Node con los
// servicios de Google simulados (Sheets, Drive con el acceso del dominio, Cache, Properties, Lock, UrlFetch, MailApp).
// Las pruebas de antes tienen su propia copia de este simulacro; las nuevas usan este.
//   const A = require('./arnes')(dir, {props: {...}, tokens: {nombre: claims}, rutas: [{re, fn}]});
//   A.ok('efrain','bootstrap'); A.falla('ana','listarUsuarios',[],/super admin/,'PERMISO'); A.correos (lo que mandó MailApp)
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path'), crypto = require('crypto');

module.exports = function crearArnes(dir, opciones) {
  const op = opciones || {};
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
  function hoja(m) {
    return { m, getLastRow: () => m.length, getMaxRows: () => 1000, setFrozenRows() {}, setColumnWidth() {},
      getDataRange: () => ({ getValues: () => m.map(r => r.slice()), getDisplayValues: () => m.map(r => r.map(x => String(x ?? ''))) }),
      appendRow: a => m.push(a.map(comoSheets)), deleteRow: n => m.splice(n - 1, 1),
      getRange: (r, c = 1, nr = 1, nc = 1) => typeof r === 'string' ? { setNumberFormat() { return this; }, setDataValidation() { return this; } } : ({
        getValues: () => Array.from({ length: nr }, (_, i) => { const f = (m[r - 1 + i] || []).slice(c - 1, c - 1 + nc); while (f.length < nc) f.push(''); return f; }),
        getValue: () => ((m[r - 1] || [])[c - 1] ?? ''),
        setValue(v) { m[r - 1] = m[r - 1] || []; m[r - 1][c - 1] = comoSheets(v); return this; },
        setValues(vs) { vs.forEach((x, i) => { m[r - 1 + i] = m[r - 1 + i] || []; x.forEach((y, j) => m[r - 1 + i][c - 1 + j] = comoSheets(y)); }); return this; },
        setNumberFormat() { return this; }, setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; },
        setDataValidation() { return this; } }) };
  }
  const libros = {};
  function libro(id, nombre, pestanas) {
    const L = { id, nombre, pest: pestanas || {}, getId: () => id, getUrl: () => 'https://sheets/' + id,
      getSheetByName: n => L.pest[n] || null, getSheets: () => Object.values(L.pest),
      insertSheet: n => { if (L.pest[n]) throw new Error('ya existe'); return L.pest[n] = hoja([]); },
      deleteSheet: h => { for (const k in L.pest) if (L.pest[k] === h) delete L.pest[k]; } };
    libros[id] = L;
    return L;
  }

  // ---- Drive (todo lo nuevo nace compartido con el dominio; privado_ lo quita con la API de Drive) ----
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
    Object.assign(f, { getId: () => f.id, getName: () => f.nombre, getUrl: () => 'https://drive/' + f.id, isTrashed: () => f.trashed,
      setName: n => { f.nombre = n; return f; },
      getFoldersByName: n => { const l = f.hijos.filter(h => h.nombre === n); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; },
      // Incremento 5 (F): archivos por nombre (documentos de proveedor: "(2)", "(3)"… sin borrar el anterior)
      getFilesByName: n => { const l = f.archivos.filter(a => a.nombre === n); let i = 0;
        return { hasNext: () => i < l.length, next: () => { const a = l[i++]; return { isTrashed: () => !!a.trashed, getId: () => a.id }; } }; },
      createFolder: n => { const h = carpeta(n, f); f.hijos.push(h); return h; },
      createFile: b => { const id = 'A' + (++nId); const a = compartible({ id, blob: b, padre: f, nombre: b && b.name });
        archivos[id] = a; f.archivos.push(a);
        return Object.assign(a, { getId: () => id, getUrl: () => 'https://drive/file/' + id, getName: () => a.nombre, setName: n => { a.nombre = n; return a; } }); } });
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
  const MailApp = { sendEmail: m => { if (A.fallarCorreo) throw new Error('Servicio de correo no disponible'); correos.push(m); },
    getRemainingDailyQuota: () => 1500 };

  const fmt = (d, tz, f) => f.replace('yyyy', d.getFullYear()).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate()))
    .replace('HH', pad(d.getHours())).replace('mm', pad(d.getMinutes())).replace('ss', pad(d.getSeconds()));
  const firmados = b => [...b].map(x => x > 127 ? x - 256 : x);
  const activadores = [];
  const ctx = { console: { ...console, warn() {}, log() {} }, Date, JSON, Math,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => props[k] = String(v),
      deleteProperty: k => { delete props[k]; }, getProperties: () => Object.assign({}, props), setProperties: o => Object.assign(props, o) }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => cache[k] = v, remove: k => { delete cache[k]; },
      getAll: ks => Object.fromEntries(ks.filter(k => k in cache).map(k => [k, cache[k]])), putAll: o => Object.assign(cache, o) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Session: { getActiveUser: () => ({ getEmail: () => '' }) },
    Logger: { log() {} },
    Utilities: { formatDate: fmt, newBlob: (a, b, c) => typeof a === 'string'
        ? { getAs: () => ({ setName: n => ({ name: n, html: a, getBytes: () => [...Buffer.from(a)] }) }), getDataAsString: () => a }
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
    SpreadsheetApp: { flush() {}, openById: id => { if (!libros[id]) throw new Error('No encontrado'); return libros[id]; },
      create: n => { const L = libro('S' + (++nId), n, { 'Hoja 1': hoja([]) }); archivos[L.id] = compartible({ id: L.id, padre: miUnidad }); return L; },
      newDataValidation: () => { const b = { requireValueInList: () => b, setAllowInvalid: () => b, setHelpText: () => b, build: () => ({}) }; return b; } },
    DriveApp: { getFolderById: id => { if (!carpetas[id]) throw new Error('No se encontró'); return carpetas[id]; },
      createFolder: n => miUnidad.createFolder(n), getRootFolder: () => miUnidad,
      getFileById: id => { const a = archivos[id]; if (!a) throw new Error('No se encontró el archivo');
        return { getParents: () => { let d = false; return { hasNext: () => !d, next: () => { d = true; return a.padre; } }; },
          moveTo: f => { a.padre = f; }, setSharing: () => a.setSharing(), getId: () => id, getUrl: () => 'https://drive/file/' + id,
          getName: () => a.nombre || (a.blob && a.blob.name) || '', setName: n => { a.nombre = n; },
          isTrashed: () => !!a.trashed,
          getBlob: () => ({ getName: () => a.blob.name, getContentType: () => a.blob.mime, getBytes: () => a.blob.bytes }) }; },
      Access: { PRIVATE: 'PRIVATE', DOMAIN: 'DOMAIN' }, Permission: { NONE: 'NONE', VIEW: 'VIEW' } },
  };
  if (op.ctxExtra) Object.assign(ctx, op.ctxExtra);
  vm.createContext(ctx);
  vm.runInContext(src, ctx);

  const post = (quien, funcion, ...args) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ funcion, args, token: quien }) } }).t);
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
  return Object.assign(A, { ctx, P: ctx, correr, como, post, ok, falla, plain, props, cache, libros, carpetas, archivos, correos, llamadas, rutas,
    tokens, claims, activadores, HOY, HOY_ISO, masDias, ANIO: String(HOY.getFullYear()), miUnidad, maestra, hoja, libro,
    PDF: Buffer.from('%PDF-1.4 cotizacion del proveedor').toString('base64'), FOTO, conFotos, FOTOS });
};
