#!/usr/bin/env node
// Script Properties de Apps Script ↔ archivo del servidor. Nunca imprime valores de secretos.
//
//   node herramientas/propiedades.js importar-drive <ID o liga> /var/lib/capri/propiedades.json [--borrar]
//       baja de Drive (como facilities@, con la credencial del servidor) el JSON que dejó exportarPropiedadesTemporal(),
//       lo valida, quita API_MUDADA y lo escribe con permisos 600. Con --borrar lo elimina DEFINITIVAMENTE de Drive (sin
//       pasar por la Papelera). Así los secretos nunca pasan por una computadora ni por el chat.
//   node herramientas/propiedades.js importar exportadas.json /var/lib/capri/propiedades.json
//       lo mismo desde un archivo local
//   node herramientas/propiedades.js comparar a.json b.json
//       qué claves faltan o difieren (de los secretos solo dice "distinto"). Sirve para el regreso: qué copiar del
//       servidor a Apps Script (SESION_DESDE_*, PORTAL_*)
//
// En Docker, con el servicio DETENIDO (si corre, al siguiente cambio reescribe el archivo con lo que tiene en memoria):
//   docker compose stop capri
//   docker compose run --rm capri node herramientas/propiedades.js importar-drive <ID> /var/lib/capri/propiedades.json --borrar
// Cómo se exportan de Apps Script: docs/servidor-google-paso-a-paso.md (paso 8).
'use strict';
const fs = require('fs');
const { guardarSeguro } = require('../src/nucleo/almacen');

const SECRETOS = /SECRET|KEY|TOKEN|SESION_SECRETO|PASSWORD/i;
const NECESARIAS = ['SPREADSHEET_ID', 'FOLDER_ID', 'CATALOGO_ID', 'COMPRAS_DB_ID', 'COMPRAS_FOLDER_ID', 'COBRANZA_DB_ID',
  'COBRANZA_FOLDER_ID', 'ADMIN_DB_ID', 'ADMIN_FOLDER_ID', 'SUPER_ADMIN', 'SESION_SECRETO'];

function validar(x, origen) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error(origen + ' no es un objeto JSON {clave: valor}.');
  return x;
}
const leer = f => validar(JSON.parse(fs.readFileSync(f, 'utf8')), f);

/** Escribe las propiedades (sin API_MUDADA) y regresa un resumen sin valores. */
function importar(p, destino) {
  const out = {};
  Object.keys(p).sort().forEach(k => { if (k !== 'API_MUDADA') out[k] = String(p[k]); });
  guardarSeguro(destino, JSON.stringify(out, null, 1));
  return { n: Object.keys(out).length, sinMudada: !!p.API_MUDADA, faltan: NECESARIAS.filter(k => !out[k]) };
}

/** ID de un archivo de Drive a partir del ID o de su liga (…/file/d/<ID>/view, …?id=<ID>). */
function idDeDrive(x) {
  const s = String(x || '');
  const m = s.match(/\/d\/([-\w]{20,})/) || s.match(/[?&]id=([-\w]{20,})/) || s.match(/^([-\w]{20,})$/);
  if (!m) throw new Error('No reconozco el ID de Drive en: ' + s);
  return m[1];
}

/** Baja el JSON de Drive con un cliente de @googleapis/drive (v3); con borrar, lo elimina definitivamente después. */
async function bajarDeDrive(drive, id, borrar) {
  const meta = (await drive.files.get({ fileId: id, fields: 'id,name,trashed', supportsAllDrives: true })).data;
  const r = await drive.files.get({ fileId: id, alt: 'media', supportsAllDrives: true }, { responseType: 'text' });
  const texto = typeof r.data === 'string' ? r.data : Buffer.isBuffer(r.data) ? r.data.toString('utf8') : JSON.stringify(r.data);
  const p = validar(JSON.parse(texto), meta.name || id);
  if (borrar) await drive.files.delete({ fileId: id, supportsAllDrives: true });
  return { propiedades: p, nombre: meta.name };
}

function avisar(res, destino, extra) {
  console.log('✔ ' + res.n + ' propiedades en ' + destino + (res.sinMudada ? ' (sin API_MUDADA)' : '') + (extra || ''));
  if (res.faltan.length) console.log('⚠ faltan: ' + res.faltan.join(', ') + ' (sin ellas Code.js crea libros o carpetas nuevos al usarlas)');
  console.log('  Recuerda: el servicio debe estar detenido al importar (docker compose stop capri) y arrancarse después.');
}

async function principal(argv) {
  const [accion, a, b] = argv;
  if (accion === 'importar' && a && b) { avisar(importar(leer(a), b), b); return 0; }
  if (accion === 'importar-drive' && a && b) {
    const conf = JSON.parse(fs.readFileSync(process.env.CAPRI_CONFIG || '/etc/capri/capri.json', 'utf8'));
    const { credencialDesde } = require('../src/backends/google');
    const { drive } = require('@googleapis/drive');
    const auth = credencialDesde(conf.google.credenciales, conf.google.sujeto || conf.cuentaServicio, ['https://www.googleapis.com/auth/drive']);
    const borrar = argv.includes('--borrar');
    const x = await bajarDeDrive(drive({ version: 'v3', auth }), idDeDrive(a), borrar);
    avisar(importar(x.propiedades, b), b, borrar ? '; "' + x.nombre + '" eliminado de Drive (definitivo)' : '');
    if (!borrar) console.log('⚠ El archivo sigue en Drive con los secretos: elimínalo (o repite con --borrar).');
    return 0;
  }
  if (accion === 'comparar' && a && b) {
    const x = leer(a), y = leer(b);
    const claves = [...new Set(Object.keys(x).concat(Object.keys(y)))].sort();
    let n = 0;
    claves.forEach(k => {
      if (x[k] === y[k]) return;
      n++;
      if (!(k in x)) console.log('+ ' + k + (SECRETOS.test(k) ? '' : ' = ' + y[k]) + '   (solo en ' + b + ')');
      else if (!(k in y)) console.log('- ' + k + '   (solo en ' + a + ')');
      else console.log('≠ ' + k + (SECRETOS.test(k) ? ' (secreto: distinto)' : ': ' + x[k] + ' → ' + y[k]));
    });
    console.log(n ? n + ' diferencia(s)' : 'iguales');
    return 0;
  }
  console.error('Uso: propiedades.js importar-drive <ID o liga> destino.json [--borrar] | importar exportadas.json destino.json | comparar a.json b.json');
  return 2;
}

if (require.main === module) {
  principal(process.argv.slice(2)).then(c => process.exit(c), e => { console.error('✘ ' + e.message); process.exit(1); });
}

module.exports = { importar, idDeDrive, bajarDeDrive, principal };
