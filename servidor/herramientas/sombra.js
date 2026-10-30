#!/usr/bin/env node
// Corrida de sombra: las mismas llamadas de SOLO LECTURA a la API de Apps Script (la que usa el equipo) y al servidor nuevo
// (en modo soloLectura, con los datos reales), y compara las respuestas. También mide cuánto tarda cada una.
//
//   CAPRI_TOKEN=<ID token de Google de leo@ (localStorage "cotizadorHelgenSesion" en la pestaña de CAPRI)> \
//   node herramientas/sombra.js --apps https://script.google.com/macros/s/AKfy…/exec --servidor http://127.0.0.1:8090/api \
//        [--reintentar] [--salida /var/lib/capri/sombra-AAAA-MM-DD.json] [--detalles 5]
//
// Nunca manda una función que escriba (lista fija abajo): Apps Script es el escritor de verdad durante la sombra.
// Una diferencia puede ser solo tiempo (alguien guardó y el servidor aún no lo ve: sondeo de 1 min); con --reintentar,
// lo que salió distinto se repite a los 75 s y solo se reporta si sigue distinto.
'use strict';
const fs = require('fs');

// Solo lecturas sin efectos (ni bitácora, ni archivos, ni centro de mando, ni la API de Claude)
const PERMITIDAS = new Set(['bootstrap', 'sincronizar', 'getClientes', 'listarCotizaciones', 'getCatalogo', 'listarProyectos',
  'listarProyectosCobranza', 'getCobranzaProyecto', 'resumenCobranzaGeneral', 'listarProyectosCompras', 'getComprasProyecto',
  'listarRequisiciones', 'getRequisicion', 'cuentasPorPagar', 'listarProyectosRequisicion', 'misRequisiciones', 'listarOperaciones',
  'getRequisicionOperaciones', 'listarUsuarios', 'listarDelegaciones', 'listarAnulados', 'listarCorreos', 'pendientes',
  'listarProveedores', 'getProveedor', 'listarDevoluciones', 'estadoCentroMando', 'misArticulos']);
// Campos que cambian solos o son propios de cada servidor (contadores de versión, sesión renovada, tiempos)
const IGNORAR = new Set(['versiones', 'sesionCapri', 'segundos', 'ms', 'ultimaConsulta', 'ultimoOk']);

const arg = n => { const i = process.argv.indexOf('--' + n); return i === -1 ? null : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const APPS = arg('apps'), SERVIDOR = arg('servidor') || 'http://127.0.0.1:8090/api', TOKEN = process.env.CAPRI_TOKEN;
const DETALLES = Number(arg('detalles') || 5);
if (!APPS || !TOKEN) { console.error('Falta --apps <URL /exec de la API> o la variable CAPRI_TOKEN.'); process.exit(2); }

async function llamar(url, funcion, args) {
  if (!PERMITIDAS.has(funcion)) throw new Error('La sombra no manda ' + funcion + ' (no es de solo lectura).');
  const t = Date.now();
  // Como la interfaz: text/plain; fetch sigue la redirección de Apps Script con GET (como curl -d sin -X POST)
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
    body: JSON.stringify({ funcion, args, token: TOKEN }) });
  const texto = await r.text();
  let json;
  try { json = JSON.parse(texto); } catch (e) { json = { ok: false, error: 'respuesta no JSON (' + r.status + '): ' + texto.slice(0, 120) }; }
  return { json, ms: Date.now() - t };
}

function limpiar(x) {
  if (Array.isArray(x)) return x.map(limpiar);
  if (x && typeof x === 'object') {
    const o = {};
    Object.keys(x).sort().forEach(k => { if (!IGNORAR.has(k)) o[k] = limpiar(x[k]); });
    return o;
  }
  return x;
}
function diferencias(a, b, ruta, out) {
  const o = out || [];
  if (o.length >= 20) return o;
  if (JSON.stringify(a) === JSON.stringify(b)) return o;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a) && a.length !== b.length) o.push(ruta + ': ' + a.length + ' elementos ≠ ' + b.length);
    new Set(Object.keys(a).concat(Object.keys(b))).forEach(k => diferencias(a[k], b[k], ruta + (Array.isArray(a) ? '[' + k + ']' : '.' + k), o));
    return o;
  }
  o.push(ruta + ': ' + JSON.stringify(a).slice(0, 120) + ' ≠ ' + JSON.stringify(b).slice(0, 120));
  return o;
}

async function comparar(funcion, args) {
  const [a, s] = await Promise.all([llamar(APPS, funcion, args), llamar(SERVIDOR, funcion, args)]);
  return { funcion, args, msApps: a.ms, msServidor: s.ms, okApps: a.json.ok, okServidor: s.json.ok,
    dif: diferencias(limpiar(a.json), limpiar(s.json), '$'), apps: a.json, servidor: s.json };
}

(async () => {
  const casos = [['bootstrap', []], ['sincronizar', [{}, {}]], ['pendientes', [true]], ['listarCotizaciones', ['']], ['getCatalogo', []],
    ['getClientes', []], ['listarProyectos', ['', true]], ['listarProyectosRequisicion', ['']], ['misRequisiciones', []],
    ['listarRequisiciones', ['', '']], ['listarProyectosCompras', ['']], ['cuentasPorPagar', []], ['listarOperaciones', []],
    ['listarProyectosCobranza', ['']], ['resumenCobranzaGeneral', []], ['listarUsuarios', []], ['listarDelegaciones', []],
    ['listarAnulados', []], ['listarProveedores', ['']], ['listarDevoluciones', [{}]], ['estadoCentroMando', []]];
  const resultados = [];
  for (const [f, args] of casos) resultados.push(await comparar(f, args));
  // Detalles: algunas requisiciones y proyectos reales
  const reqs = ((resultados.find(r => r.funcion === 'listarRequisiciones') || {}).apps || {}).datos || [];
  const proys = ((resultados.find(r => r.funcion === 'listarProyectosCobranza') || {}).apps || {}).datos || [];
  for (const q of (Array.isArray(reqs) ? reqs : reqs.requisiciones || []).slice(0, DETALLES)) resultados.push(await comparar('getRequisicion', [q.folio]));
  for (const p of (Array.isArray(proys) ? proys : []).slice(0, DETALLES)) {
    resultados.push(await comparar('getCobranzaProyecto', [p.folio]));
    resultados.push(await comparar('getComprasProyecto', [p.folio]));
  }
  if (arg('reintentar') && resultados.some(r => r.dif.length)) {
    console.log('Diferencias en ' + resultados.filter(r => r.dif.length).length + ' llamadas; se repiten en 75 s (después del sondeo)…');
    await new Promise(r => setTimeout(r, 75000));
    for (let i = 0; i < resultados.length; i++) if (resultados[i].dif.length) resultados[i] = await comparar(resultados[i].funcion, resultados[i].args);
  }
  let iguales = 0;
  console.log('\n' + 'llamada'.padEnd(46) + 'Apps Script   servidor   resultado');
  resultados.forEach(r => {
    const igual = !r.dif.length;
    if (igual) iguales++;
    console.log((r.funcion + (r.args.length && typeof r.args[0] === 'string' && r.args[0] ? ' ' + r.args[0] : '')).slice(0, 45).padEnd(46) +
      (r.msApps + ' ms').padStart(10) + (r.msServidor + ' ms').padStart(11) + '   ' + (igual ? 'igual' : 'DISTINTO (' + r.dif.length + ')'));
    if (!igual) r.dif.slice(0, 4).forEach(d => console.log('      ' + d));
  });
  const med = k => { const v = resultados.map(r => r[k]).sort((x, y) => x - y); return v[Math.floor(v.length / 2)]; };
  console.log('\n' + iguales + ' de ' + resultados.length + ' iguales · mediana Apps Script ' + med('msApps') + ' ms · servidor ' + med('msServidor') + ' ms');
  const salida = arg('salida');
  if (salida && salida !== true) {
    fs.writeFileSync(salida, JSON.stringify(resultados.map(r => ({ funcion: r.funcion, args: r.args, msApps: r.msApps, msServidor: r.msServidor, dif: r.dif })), null, 1), { mode: 0o600 });
    console.log('Reporte: ' + salida + ' (solo las diferencias; pueden traer valores: queda con permisos 600)');
  }
  process.exit(iguales === resultados.length ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
