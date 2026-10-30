// Servicios de Apps Script que no son hojas ni Drive: Utilities, Blob, UrlFetchApp, MailApp, Session, ScriptApp,
// ContentService, HtmlService (sin uso) y Logger. Todo síncrono para Code.js; lo que necesita red va por el puente.
'use strict';
const crypto = require('crypto');

// ---- Bytes "con signo" (Apps Script da arreglos de números -128…127) ----
const conSigno = buf => { const a = new Array(buf.length); for (let i = 0; i < buf.length; i++) a[i] = buf[i] > 127 ? buf[i] - 256 : buf[i]; return a; };
function aBuffer(datos, charset) {
  if (datos == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(datos)) return datos;
  if (datos instanceof Uint8Array) return Buffer.from(datos);
  if (typeof datos === 'string') return Buffer.from(datos, /ascii/i.test(String(charset || '')) ? 'latin1' : 'utf8');
  if (Array.isArray(datos)) return Buffer.from(Uint8Array.from(datos, x => x & 255));
  if (datos && typeof datos.getBytes === 'function') return aBuffer(datos.getBytes());
  throw new Error('Datos no válidos para un blob.');
}

function crearBlob(amb) {
  class Blob {
    constructor(buf, tipo, nombre) { this.buf = buf; this.tipo = tipo || null; this.nombre = nombre == null ? null : String(nombre); }
    getBytes() { return conSigno(this.buf); }
    setBytes(b) { this.buf = aBuffer(b); return this; }
    getDataAsString(charset) { return this.buf.toString(/ascii|iso-8859/i.test(String(charset || '')) ? 'latin1' : 'utf8'); }
    setDataFromString(s, charset) { this.buf = aBuffer(String(s), charset); return this; }
    getContentType() { return this.tipo; }
    setContentType(t) { this.tipo = t; return this; }
    getName() { return this.nombre; }
    setName(n) { this.nombre = String(n); return this; }
    getBlob() { return this; }
    copyBlob() { return new Blob(Buffer.from(this.buf), this.tipo, this.nombre); }
    isGoogleType() { return false; }
    /** html → pdf con Chromium (en el principal). El nombre pasa a "<nombre sin extensión>.pdf", como en Apps Script. */
    getAs(tipo) {
      const destino = String(tipo).toLowerCase();
      if (destino === String(this.tipo || '').toLowerCase()) return this.copyBlob();
      if (destino === 'application/pdf' && /html/i.test(String(this.tipo || ''))) {
        const pdf = amb.rpc('pdf.html', { html: this.buf.toString('utf8'), nombre: this.nombre }, 90000);
        const base = this.nombre ? this.nombre.replace(/\.[^.]*$/, '') : null;
        return new Blob(Buffer.from(pdf), 'application/pdf', base == null ? null : base + '.pdf');
      }
      throw new Error('Conversión no disponible en el servidor: ' + this.tipo + ' → ' + tipo + '.');
    }
  }
  return Blob;
}

// ---- Utilities.unzip: ZIP (sin cifrar; "stored" o "deflate"), con límites para que un ZIP malicioso no llene la memoria ----
const zlib = require('zlib');
const MAX_ARCHIVO_ZIP = 50 * 1024 * 1024; // lo más que pesa un Blob en Apps Script
// Lo más que se infla en UNA llamada (todo el ZIP): un ZIP bomba no tumba el proceso. Cada archivo se infla con tope = el
// tamaño que dice el directorio central, así lo inflado nunca pasa de lo declarado (y lo declarado se revisa antes)
const MAX_TOTAL_ZIP = 60 * 1024 * 1024, MAX_ENTRADAS_ZIP = 10000;
const TIPOS_POR_EXTENSION = { xml: 'application/xml', pdf: 'application/pdf', json: 'application/json', txt: 'text/plain',
  csv: 'text/csv', html: 'text/html', htm: 'text/html', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  zip: 'application/zip' };
const tipoPorNombre = n => { const m = /\.([a-z0-9]+)$/i.exec(String(n)); return (m && TIPOS_POR_EXTENSION[m[1].toLowerCase()]) || null; };

/**
 * Entradas de un ZIP como las da Utilities.unzip: [{nombre (con su carpeta dentro del ZIP), datos}], en el orden del
 * directorio central; las carpetas ("dir/") también, vacías.
 */
function descomprimirZip(buf) {
  const malo = q => new Error('No se pudo descomprimir: ' + q + '.');
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw malo('el archivo no es un ZIP');
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw malo('el archivo no es un ZIP');
  const n = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  if (n === 0xffff || p === 0xffffffff) throw malo('ZIP64 no está soportado');
  if (n > MAX_ENTRADAS_ZIP) throw malo('demasiados archivos (' + n + ')');
  const out = [];
  let total = 0;
  for (let k = 0; k < n; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw malo('el ZIP está dañado');
    const banderas = buf.readUInt16LE(p + 8), metodo = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16);
    const comprimido = buf.readUInt32LE(p + 20), tamano = buf.readUInt32LE(p + 24);
    const largoNombre = buf.readUInt16LE(p + 28), largoExtra = buf.readUInt16LE(p + 30), largoComentario = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.subarray(p + 46, p + 46 + largoNombre).toString(banderas & 0x800 ? 'utf8' : 'latin1');
    p += 46 + largoNombre + largoExtra + largoComentario;
    if (nombre.endsWith('/') && tamano === 0) { out.push({ nombre, datos: Buffer.alloc(0) }); continue; }
    if (banderas & 1) throw malo(nombre + ' está cifrado');
    if (tamano > MAX_ARCHIVO_ZIP || (total += tamano) > MAX_TOTAL_ZIP) throw malo('el contenido pasa de ' + (MAX_TOTAL_ZIP / 1048576) + ' MB');
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw malo('el ZIP está dañado');
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const crudo = buf.subarray(ini, ini + comprimido);
    if (crudo.length !== comprimido) throw malo('el ZIP está incompleto');
    let datos;
    if (metodo === 0) datos = Buffer.from(crudo);
    else if (metodo === 8) {
      try { datos = zlib.inflateRawSync(crudo, { maxOutputLength: Math.max(tamano, 1) }); } catch (e) { throw malo(nombre + ' está dañado o es más grande de lo que dice'); }
    } else throw malo(nombre + ' usa una compresión no soportada (' + metodo + ')');
    if (datos.length !== tamano || (zlib.crc32 && zlib.crc32(datos) !== crc)) throw malo(nombre + ' está dañado');
    out.push({ nombre, datos });
  }
  return out;
}

// ---- Fechas como java.text.SimpleDateFormat (lo que usa Utilities.formatDate) ----
const MESES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DIAS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const fmtCache = new Map();
function partes(fecha, zona) {
  let f = fmtCache.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short', timeZoneName: 'short' });
    fmtCache.set(zona, f);
  }
  const p = {};
  f.formatToParts(fecha).forEach(x => { p[x.type] = x.value; });
  const t = fecha.getTime();
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const desfaseMin = Math.round((local - (t - (((t % 1000) + 1000) % 1000))) / 60000);
  const dias = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { y: +p.year, M: +p.month, d: +p.day, H: +p.hour, m: +p.minute, s: +p.second, S: ((t % 1000) + 1000) % 1000,
    E: dias[p.weekday], z: p.timeZoneName, desfaseMin };
}
function formatDate(fecha, zona, patron) {
  if (!(fecha instanceof Date) || isNaN(fecha.getTime())) throw new Error('Utilities.formatDate: la fecha no es válida.');
  const p = partes(fecha, String(zona || process.env.TZ || 'UTC'));
  const pad = (n, k) => String(n).padStart(k, '0');
  const zonaTexto = (k, conDosPuntos) => {
    const s = p.desfaseMin < 0 ? '-' : '+', a = Math.abs(p.desfaseMin);
    if (k === 1) return s + pad(Math.floor(a / 60), 2);
    return s + pad(Math.floor(a / 60), 2) + (conDosPuntos ? ':' : '') + pad(a % 60, 2);
  };
  let out = '', i = 0;
  const pat = String(patron);
  while (i < pat.length) {
    const ch = pat[i];
    if (ch === "'") {
      if (pat[i + 1] === "'") { out += "'"; i += 2; continue; }
      // Texto entre comillas: '' adentro es una comilla
      i++;
      while (i < pat.length) {
        if (pat[i] === "'" && pat[i + 1] === "'") { out += "'"; i += 2; continue; }
        if (pat[i] === "'") { i++; break; }
        out += pat[i++];
      }
      continue;
    }
    if (!/[A-Za-z]/.test(ch)) { out += ch; i++; continue; }
    let k = 1;
    while (pat[i + k] === ch) k++;
    i += k;
    switch (ch) {
      case 'y': case 'Y': out += k === 2 ? pad(p.y % 100, 2) : pad(p.y, k); break;
      case 'M': case 'L': out += k >= 4 ? MESES[p.M - 1] : k === 3 ? MESES[p.M - 1].slice(0, 3) : pad(p.M, k); break;
      case 'd': out += pad(p.d, k); break;
      case 'H': out += pad(p.H, k); break;
      case 'k': out += pad(p.H === 0 ? 24 : p.H, k); break;
      case 'K': out += pad(p.H % 12, k); break;
      case 'h': out += pad(p.H % 12 === 0 ? 12 : p.H % 12, k); break;
      case 'm': out += pad(p.m, k); break;
      case 's': out += pad(p.s, k); break;
      case 'S': out += pad(p.S, 3).slice(0, Math.max(k, 3)).padEnd(k, '0'); break;
      case 'E': out += k >= 4 ? DIAS[p.E] : DIAS[p.E].slice(0, 3); break;
      case 'u': out += String(p.E === 0 ? 7 : p.E); break;
      case 'a': out += p.H < 12 ? 'AM' : 'PM'; break;
      case 'z': out += p.z; break;
      case 'Z': out += zonaTexto(2, false); break;
      case 'X': out += k === 1 ? zonaTexto(1) : zonaTexto(2, k >= 3); break;
      case 'G': out += 'AD'; break;
      default: throw new Error('Patrón de fecha no reconocido: ' + ch);
    }
  }
  return out;
}

function parseCsv(texto, sep) {
  const d = sep || ',', filas = [];
  let fila = [], campo = '', comillas = false;
  const s = String(texto);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (comillas) {
      if (c === '"') { if (s[i + 1] === '"') { campo += '"'; i++; } else comillas = false; } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === d) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

const ALGORITMOS = { MD5: 'md5', SHA_1: 'sha1', SHA_256: 'sha256', SHA_384: 'sha384', SHA_512: 'sha512',
  HMAC_MD5: 'md5', HMAC_SHA_1: 'sha1', HMAC_SHA_256: 'sha256', HMAC_SHA_384: 'sha384', HMAC_SHA_512: 'sha512' };

function crearUtilities(amb, Blob) {
  const alg = a => { const x = ALGORITMOS[a] || a; if (!x) throw new Error('Algoritmo no disponible: ' + a); return x; };
  return {
    formatDate,
    formatString: (f, ...args) => { let i = 0; return String(f).replace(/%[sdif]/g, () => String(args[i++])); },
    newBlob: (datos, tipo, nombre) => new Blob(aBuffer(datos), tipo, nombre),
    base64Encode: (d, cs) => aBuffer(d, cs).toString('base64'),
    base64EncodeWebSafe: (d, cs) => { const b = aBuffer(d, cs).toString('base64'); return b.replace(/\+/g, '-').replace(/\//g, '_'); },
    base64Decode: s => conSigno(Buffer.from(String(s), 'base64')),
    base64DecodeWebSafe: s => conSigno(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    computeDigest: (a, v, cs) => conSigno(crypto.createHash(alg(a)).update(aBuffer(v, cs)).digest()),
    computeHmacSha256Signature: (v, k, cs) => conSigno(crypto.createHmac('sha256', aBuffer(k, cs)).update(aBuffer(v, cs)).digest()),
    computeHmacSignature: (a, v, k, cs) => conSigno(crypto.createHmac(alg(a), aBuffer(k, cs)).update(aBuffer(v, cs)).digest()),
    getUuid: () => crypto.randomUUID(),
    sleep: ms => amb.dormir(ms),
    parseCsv,
    // Las entradas del ZIP como Blobs con su nombre (incluye la carpeta dentro del ZIP; las carpetas también, vacías); el
    // tipo, por la extensión; getBytes() con signo, como todo Blob de Apps Script
    unzip: blob => descomprimirZip(blob && blob.buf ? blob.buf : aBuffer(blob)).map(x => new Blob(x.datos, tipoPorNombre(x.nombre), x.nombre)),
    jsonStringify: o => JSON.stringify(o),
    jsonParse: s => JSON.parse(s),
    DigestAlgorithm: { MD2: 'MD2', MD5: 'MD5', SHA_1: 'SHA_1', SHA_256: 'SHA_256', SHA_384: 'SHA_384', SHA_512: 'SHA_512' },
    MacAlgorithm: { HMAC_MD5: 'HMAC_MD5', HMAC_SHA_1: 'HMAC_SHA_1', HMAC_SHA_256: 'HMAC_SHA_256', HMAC_SHA_384: 'HMAC_SHA_384', HMAC_SHA_512: 'HMAC_SHA_512' },
    Charset: { US_ASCII: 'US_ASCII', UTF_8: 'UTF_8' },
  };
}

// ---- UrlFetchApp ----
function crearUrlFetchApp(amb, Blob) {
  class RespuestaHttp {
    constructor(r) { this.r = r; this.buf = Buffer.from(r.cuerpo || []); }
    getResponseCode() { return this.r.codigo; }
    getContentText(cs) { return this.buf.toString(/iso-8859|latin/i.test(String(cs || '')) ? 'latin1' : 'utf8'); }
    getContent() { return conSigno(this.buf); }
    getHeaders() { return Object.assign({}, this.r.cabeceras || {}); }
    getAllHeaders() { return Object.assign({}, this.r.cabeceras || {}); }
    getBlob() { return new Blob(Buffer.from(this.buf), (this.r.cabeceras || {})['content-type'] || null, null); }
    getAs(t) { return this.getBlob().getAs(t); }
  }
  /** Normaliza las opciones de Apps Script (payload texto, bytes u objeto de formulario). */
  function peticion(url, op) {
    const o = op || {};
    const headers = {};
    Object.keys(o.headers || {}).forEach(k => { headers[k] = String(o.headers[k]); });
    let cuerpo = null, tipo = o.contentType || null;
    if (o.payload != null) {
      if (typeof o.payload === 'string') cuerpo = Buffer.from(o.payload, 'utf8');
      else if (Array.isArray(o.payload) || o.payload instanceof Uint8Array) cuerpo = aBuffer(o.payload);
      else if (o.payload && typeof o.payload.getBytes === 'function') { cuerpo = aBuffer(o.payload.getBytes()); tipo = tipo || o.payload.getContentType(); }
      else if (typeof o.payload === 'object') {
        cuerpo = Buffer.from(Object.keys(o.payload).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(o.payload[k])).join('&'));
        tipo = tipo || 'application/x-www-form-urlencoded';
      }
      if (!tipo) tipo = 'application/x-www-form-urlencoded';
    }
    return { url: String(url), metodo: String(o.method || (cuerpo ? 'post' : 'get')).toUpperCase(), cabeceras: headers, cuerpo, tipo,
      seguirRedirecciones: o.followRedirects !== false, silenciar: !!o.muteHttpExceptions };
  }
  function fetch(url, op) {
    const p = peticion(url, op);
    const r = amb.rpc('url.fetch', p, 120000);
    const resp = new RespuestaHttp(r);
    if (!p.silenciar && r.codigo >= 400) {
      throw new Error('Request failed for ' + url + ' returned code ' + r.codigo + '. Truncated server response: ' +
        resp.getContentText().slice(0, 100) + ' (use muteHttpExceptions option to examine full response)');
    }
    return resp;
  }
  return {
    fetch,
    fetchAll: lista => lista.map(x => (typeof x === 'string' ? fetch(x) : fetch(x.url, x))),
    getRequest: (url, op) => peticion(url, op),
  };
}

// ---- MailApp (Gmail API como la cuenta del servicio) ----
function crearMailApp(amb) {
  function normalizar(a, b, c, d) {
    const m = typeof a === 'object' && a !== null ? Object.assign({}, a) : Object.assign({ to: a, subject: b, body: c }, d || {});
    const x = { para: String(m.to || ''), asunto: String(m.subject || ''), texto: m.body == null ? '' : String(m.body),
      html: m.htmlBody == null ? null : String(m.htmlBody), nombre: m.name == null ? null : String(m.name),
      responderA: m.replyTo == null ? null : String(m.replyTo), cc: m.cc ? String(m.cc) : null, cco: m.bcc ? String(m.bcc) : null,
      sinRespuesta: !!m.noReply, adjuntos: [] };
    (m.attachments || []).forEach(b => x.adjuntos.push({ nombre: b.getName(), tipo: b.getContentType(), datos: aBuffer(b.getBytes()) }));
    if (!x.para.trim()) throw new Error('Falta el destinatario del correo.');
    return x;
  }
  return {
    sendEmail: (a, b, c, d) => { amb.rpc('correo.enviar', normalizar(a, b, c, d), 60000); },
    getRemainingDailyQuota: () => amb.rpc('correo.cuota', {}),
  };
}

function crearSession(amb) {
  const usuario = correo => ({ getEmail: () => correo, toString: () => correo });
  return {
    getActiveUser: () => usuario(''), // como el despliegue ANYONE_ANONYMOUS: el usuario sale del token (VENDEDOR_)
    getEffectiveUser: () => usuario(amb.cuentaServicio),
    getScriptTimeZone: () => amb.zona,
    getActiveUserLocale: () => 'es',
    getTemporaryActiveUserKey: () => '',
  };
}

function crearScriptApp(amb) {
  const disparador = t => ({ getHandlerFunction: () => t.funcion, getUniqueId: () => t.id, getEventType: () => 'CLOCK',
    getTriggerSource: () => 'CLOCK', _id: t.id });
  return {
    // Marcador: el principal pone el token real al llamar a googleapis.com (nunca entra al contexto de Code.js)
    getOAuthToken: () => amb.marcaToken,
    getScriptId: () => amb.idScript || 'servidor',
    getProjectTriggers: () => amb.rpc('activadores.listar', {}).map(disparador),
    deleteTrigger: t => { amb.rpc('activadores.borrar', { id: t && (t._id || (t.getUniqueId && t.getUniqueId())) }); },
    newTrigger: funcion => {
      const d = { funcion: String(funcion), cadaMinutos: null };
      const b = {
        timeBased: () => b,
        everyMinutes: n => { d.cadaMinutos = Number(n); return b; },
        everyHours: n => { d.cadaMinutos = Number(n) * 60; return b; },
        everyDays: n => { d.cadaMinutos = Number(n) * 1440; return b; },
        atHour: () => b, nearMinute: () => b, inTimezone: () => b,
        create: () => disparador(amb.rpc('activadores.crear', d)),
      };
      return b;
    },
    AuthMode: { NONE: 'NONE', LIMITED: 'LIMITED', FULL: 'FULL' },
  };
}

function crearContentService() {
  class SalidaTexto {
    constructor(t) { this.t = t == null ? '' : String(t); this.tipo = 'text/plain'; }
    getContent() { return this.t; }
    setContent(t) { this.t = String(t); return this; }
    append(t) { this.t += String(t); return this; }
    setMimeType(m) { this.tipo = m; return this; }
    getMimeType() { return this.tipo; }
  }
  return { createTextOutput: t => new SalidaTexto(t),
    MimeType: { JSON: 'application/json', TEXT: 'text/plain', CSV: 'text/csv', JAVASCRIPT: 'application/javascript' } };
}

function crearHtmlService() {
  const no = () => { throw new Error('HtmlService no está disponible en el servidor (la interfaz vive en Cloudflare).'); };
  return { createHtmlOutput: no, createHtmlOutputFromFile: no, createTemplateFromFile: no, XFrameOptionsMode: {}, SandboxMode: {} };
}

module.exports = { conSigno, aBuffer, crearBlob, formatDate, parseCsv, descomprimirZip, MAX_TOTAL_ZIP, crearUtilities, crearUrlFetchApp, crearMailApp, crearSession,
  crearScriptApp, crearContentService, crearHtmlService };
