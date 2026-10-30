// Utilidades de las pruebas: levantar el servicio en el mismo proceso (backend memoria), llamar por HTTP, comparar.
'use strict';
process.env.TZ = 'America/Mexico_City';
const http = require('http');
const path = require('path');
const { crearServicio, clientIdDeCode } = require('../src/servicio');
const { crearServidorHttp } = require('../src/http');
const { ConductorMemoria } = require('../src/backends/memoria');
const { VerificadorTabla } = require('../src/nucleo/identidad');

const REPO = path.join(__dirname, '..', '..');

function fechaFija(ms) {
  const Real = Date;
  return class FechaFija extends Real {
    constructor(...a) { if (a.length === 0) super(ms); else super(...a); }
    static now() { return ms; }
    // Toda Date (las que crea el espejo, por ejemplo) cuenta como fecha para Code.js, igual que sin reloj fijo
    static [Symbol.hasInstance](x) { return x instanceof Real; }
  };
}

/** Claims de los usuarios del arnés (mismos correos y nombres) con el Client ID real de Code.js. */
function tokensDeArnes(A) {
  const cid = clientIdDeCode(path.join(REPO, 'Code.js'));
  const t = {};
  Object.keys(A.tokens).forEach(k => { t[k] = Object.assign({}, A.tokens[k], { aud: cid }); });
  return t;
}

/** Servicio + HTTP en un puerto libre. o: {props, tokens, trabajadores, relojFijo, latencia, conductor, conf} */
async function levantar(o) {
  const op = o || {};
  const conductor = op.conductor || new ConductorMemoria({ latencia: op.latencia });
  const base = conductor.raizId ? {} : conductor.sembrarComoArnes();
  const lineas = [];
  const registro = (nivel, texto, extra) => { lineas.push(Object.assign({ nivel, texto }, extra || {})); };
  const conf = Object.assign({ trabajadores: op.trabajadores || 3, codigo: { dir: REPO }, zonaHoraria: 'America/Mexico_City',
    cuentaServicio: 'facilities@helgen.tech', propiedadesIniciales: Object.assign(base, op.props || {}), relojFijo: op.relojFijo || null,
    silencioso: true, sondeoSeg: 0, reconciliarMin: 0, frescuraSeg: 0, precargar: false, limiteMs: 60000, activadores: false }, op.conf || {});
  const servicio = crearServicio(conf, { conductor, identidad: new VerificadorTabla(op.tokens || {}), registro });
  await servicio.iniciar();
  const servidor = crearServidorHttp(servicio, { origenes: ['http://127.0.0.1:8788'] });
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const puerto = servidor.address().port;
  const agente = new http.Agent({ keepAlive: true, maxSockets: 16 });
  function enviar(cuerpo, cabeceras) {
    return new Promise((resolve, reject) => {
      const datos = Buffer.from(cuerpo);
      const req = http.request({ host: '127.0.0.1', port: puerto, path: '/api', method: 'POST', agent: agente,
        headers: Object.assign({ 'Content-Type': 'text/plain;charset=utf-8', 'Content-Length': datos.length }, cabeceras || {}) }, res => {
        const trozos = [];
        res.on('data', d => trozos.push(d));
        res.on('end', () => resolve({ estado: res.statusCode, cabeceras: res.headers, texto: Buffer.concat(trozos).toString('utf8') }));
      });
      req.on('error', reject);
      req.end(datos);
    });
  }
  /** Como A.post del arnés: la respuesta de doPost ya leída como JSON. */
  async function post(quien, funcion, ...args) {
    const r = await enviar(JSON.stringify({ funcion, args, token: quien }));
    return JSON.parse(r.texto);
  }
  return { servicio, servidor, puerto, conductor, registro, lineas, enviar, post,
    async cerrar() { agente.destroy(); await new Promise(r => servidor.close(r)); await servicio.detener(); } };
}

/** Corre un generador de llamadas (pruebas/escenario.js) con una función llamar (síncrona o asíncrona). */
async function correrEscenario(gen, llamar, alPaso) {
  const pasos = [];
  let r, x = gen.next();
  while (!x.done) {
    const [paso, quien, funcion, ...args] = x.value;
    const t0 = process.hrtime.bigint();
    r = await llamar(quien, funcion, ...args);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    pasos.push({ paso, quien, funcion, r, ms });
    if (alPaso) alPaso(pasos[pasos.length - 1]);
    x = gen.next(r);
  }
  return { pasos, resultado: x.value };
}

/** Diferencias entre dos valores JSON (rutas). */
function diferencias(a, b, ruta, out) {
  const o = out || [];
  const r = ruta || '$';
  if (o.length > 30) return o;
  if (a === b) return o;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') { o.push(r + ': ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b)); return o; }
  if (Array.isArray(a) !== Array.isArray(b)) { o.push(r + ': arreglo ≠ objeto'); return o; }
  const claves = new Set(Object.keys(a).concat(Object.keys(b)));
  claves.forEach(k => diferencias(a[k], b[k], r + (Array.isArray(a) ? '[' + k + ']' : '.' + k), o));
  return o;
}

module.exports = { REPO, fechaFija, tokensDeArnes, levantar, correrEscenario, diferencias };
