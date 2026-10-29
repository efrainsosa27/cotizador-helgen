// Trabajador: carga Logo.js + Code.js tal cual en un contexto de vm con los servicios de Apps Script de fachada/ y corre
// una petición (doPost) o un activador a la vez. Code.js es síncrono: cuando necesita Google, el trabajador se bloquea en
// el puente (Atomics.wait) y el principal hace la llamada asíncrona. Mientras, los otros trabajadores siguen atendiendo.
//
// Cada trabajador tiene su copia del espejo (libros). Al empezar un trabajo y al tomar el candado se aplican las copias
// nuevas que mandó el principal (lo que confirmaron otros); durante el trabajo los datos no cambian bajo sus pies.
'use strict';
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { PuenteTrabajador } = require('./puente');
const M = require('./espejo/modelo');
const { crearSpreadsheetApp } = require('./fachada/hojas');
const { crearDriveApp } = require('./fachada/drive');
const { Transaccion, crearLockService, crearCacheService, crearPropertiesService } = require('./fachada/transaccion');
const S = require('./fachada/servicios');

const conf = workerData.conf;
const amb = {
  espejo: new Map(), pendientes: [], tx: null,
  plantillas: conf.plantillas, zona: conf.zona, cuentaServicio: conf.cuentaServicio, marcaToken: conf.marcaToken,
  idScript: conf.idScript,
};
const puente = new PuenteTrabajador(workerData.puerto, workerData.memoria, aviso => {
  if (aviso && aviso.tipo === 'libros') aviso.libros.forEach(l => amb.pendientes.push(l));
  else if (aviso && aviso.tipo === 'olvidar') aviso.ids.forEach(id => amb.pendientes.push({ id, olvidar: true }));
});
amb.rpc = (tipo, datos, limite) => puente.llamar(tipo, datos, limite);
amb.dormir = ms => puente.dormir(ms);
amb.aplicarLibro = x => (x.olvidar ? amb.espejo.delete(x.id) : M.aplicarLibroOParche(amb.espejo, x));
amb.aplicarPendientes = () => {
  puente.vaciar();
  const lista = amb.pendientes.splice(0);
  lista.forEach(amb.aplicarLibro);
};
amb.escribirHoja = (libroId, op) => {
  const libro = amb.espejo.get(libroId);
  if (!libro) throw new Error('El libro ' + libroId + ' no está en el espejo.');
  M.aplicar(libro, op);
  amb.tx.anotar(libroId, op);
  // Solo para medir la estrategia (a) "escribir en cada llamada": cada operación va a Google en el momento
  if (conf.escrituraInmediata) amb.tx.confirmar(amb.tx.enCandado);
};
amb.nuevoIdHoja = libro => {
  for (;;) { const id = crypto.randomInt(1, 2147483647); if (!libro.hojas.some(h => h.id === id)) return id; }
};

// ---- Registro: lo que escribe Code.js con console/Logger sale como líneas JSON con el trabajo en curso ----
let trabajoActual = null;
function registrar(nivel, args) {
  const texto = args.map(a => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch (e) { return String(a); } })())).join(' ');
  if (conf.silencioso && nivel !== 'error') return;
  process.stdout.write(JSON.stringify({ t: new Date().toISOString(), nivel, origen: 'code.js', trabajador: conf.numero,
    trabajo: trabajoActual && trabajoActual.id, funcion: trabajoActual && trabajoActual.funcion, texto: texto.slice(0, 4000) }) + '\n');
}
const consola = { log: (...a) => registrar('info', a), info: (...a) => registrar('info', a), warn: (...a) => registrar('aviso', a),
  error: (...a) => registrar('error', a), debug: () => {}, time() {}, timeEnd() {} };

/** Pruebas de paridad: un reloj detenido (el mismo instante que usa el arnés), para comparar respuestas byte a byte. */
function fechaFija(ms) {
  const Real = Date;
  return class FechaFija extends Real {
    constructor(...a) { if (a.length === 0) super(ms); else super(...a); }
    static now() { return ms; }
    // Toda Date (las que crea el espejo, por ejemplo) cuenta como fecha para Code.js, igual que sin reloj fijo
    static [Symbol.hasInstance](x) { return x instanceof Real; }
  };
}

// ---- Contexto de Code.js ----
const Blob = S.crearBlob(amb);
const ctx = {
  console: consola, Logger: { log: (...a) => { registrar('info', a); }, clear() {}, getLog: () => '' },
  // Las mismas Date/JSON/Math del trabajador (como el arnés): una Date de Code.js es Date para la fachada
  Date: conf.relojFijo ? fechaFija(conf.relojFijo) : Date, JSON, Math,
  SpreadsheetApp: crearSpreadsheetApp(amb),
  DriveApp: crearDriveApp(amb, Blob),
  LockService: crearLockService(amb),
  CacheService: crearCacheService(amb),
  PropertiesService: crearPropertiesService(amb),
  Utilities: S.crearUtilities(amb, Blob),
  UrlFetchApp: S.crearUrlFetchApp(amb, Blob),
  MailApp: S.crearMailApp(amb),
  Session: S.crearSession(amb),
  ScriptApp: S.crearScriptApp(amb),
  ContentService: S.crearContentService(),
  HtmlService: S.crearHtmlService(),
};
vm.createContext(ctx, { name: 'Code.js', codeGeneration: { strings: true, wasm: false } });
const inicioCarga = Date.now();
const fuente = conf.archivos.map(f => fs.readFileSync(f, 'utf8')).join('\n');
new vm.Script(fuente, { filename: path.basename(conf.archivos[conf.archivos.length - 1]) }).runInContext(ctx);
const msCarga = Date.now() - inicioCarga;
const lista = codigo => { try { return vm.runInContext(codigo, ctx); } catch (e) { return []; } };
const cambiosApi = lista('Object.keys(typeof CAMBIOS_API === "object" ? CAMBIOS_API : {})');
const publicas = lista('typeof FUNCIONES_PUBLICAS !== "undefined" ? FUNCIONES_PUBLICAS.slice() : []');

/** Cierra lo que quedó abierto: suelta el candado si Code.js no lo soltó y confirma lo escrito fuera del candado. */
function cerrarTransaccion() {
  const tx = amb.tx;
  if (tx.enCandado) {
    tx.profundidad = 0;
    let error = null;
    try { tx.confirmar(true); } catch (e) { error = e; }
    amb.rpc('candado.soltar', {});
    if (error) throw error;
    return;
  }
  tx.confirmar();
}

function ejecutar(msg) {
  amb.aplicarPendientes();
  amb.tx = new Transaccion(amb);
  puente.metricas = {};
  trabajoActual = { id: msg.id, funcion: msg.funcion || '' };
  const inicio = process.hrtime.bigint();
  const cpu0 = process.cpuUsage();
  let texto;
  try {
    if (msg.cuerpo != null) {
      const e = { postData: { contents: msg.cuerpo, length: msg.cuerpo.length, type: 'text/plain', name: 'postData' },
        parameter: {}, parameters: {}, queryString: '', contentLength: msg.cuerpo.length, contextPath: '' };
      texto = ctx.doPost(e).getContent();
    } else {
      const f = vm.runInContext('typeof ' + msg.funcion + ' === "function" ? ' + msg.funcion + ' : null', ctx);
      if (!f) throw new Error('No existe la función ' + msg.funcion + '.');
      texto = JSON.stringify({ ok: true, datos: f.apply(null, msg.args || []) });
    }
  } catch (e) {
    texto = JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) });
  }
  try {
    cerrarTransaccion();
  } catch (e) {
    // Nunca "listo" si lo escrito no llegó a Google
    texto = JSON.stringify({ ok: false, error: e.message, codigo: e.codigo || 'GUARDAR' });
  }
  const cpu = process.cpuUsage(cpu0);
  const metricas = { ms: Number(process.hrtime.bigint() - inicio) / 1e6, cpuMs: (cpu.user + cpu.system) / 1000,
    rpc: puente.metricas, confirmaciones: amb.tx.confirmaciones, operaciones: amb.tx.operaciones };
  puente.metricas = null;
  trabajoActual = null;
  amb.tx = null;
  return { texto, metricas };
}

parentPort.on('message', msg => {
  if (msg && msg.tipo === 'memoria') { parentPort.postMessage({ tipo: 'memoria', memoria: process.memoryUsage(), libros: amb.espejo.size }); return; }
  if (!msg || msg.tipo !== 'trabajo') return;
  let r;
  try {
    r = ejecutar(msg);
  } catch (e) {
    r = { texto: JSON.stringify({ ok: false, error: 'Error interno del servidor: ' + e.message }), metricas: {} };
  }
  parentPort.postMessage({ tipo: 'hecho', id: msg.id, texto: r.texto, metricas: r.metricas });
});

// Libros que llegan mientras el trabajador está desocupado: se aplican en ratos libres (así no se acumulan copias)
setInterval(() => { if (!amb.tx) amb.aplicarPendientes(); }, 1000).unref();

parentPort.postMessage({ tipo: 'listo', msCarga, cambiosApi, publicas, memoria: process.memoryUsage() });
