#!/usr/bin/env node
// Script Properties de Apps Script ↔ archivo del servidor.
//
//   node herramientas/propiedades.js importar exportadas.json /var/lib/capri/propiedades.json
//       valida, quita API_MUDADA (la marca que apaga Apps Script) y escribe con permisos 600
//   node herramientas/propiedades.js comparar a.json b.json
//       qué claves faltan o difieren (de los secretos solo dice "distinto", nunca el valor). Sirve para el regreso:
//       qué copiar del servidor a Apps Script (VER_*, CONSECUTIVO_*, SESION_DESDE_*, PORTAL_*)
//
// Cómo se exportan de Apps Script (como facilities@, en el editor; NO se guarda en el repositorio): ver
// docs/servidor-etapa-1.md §9.
'use strict';
const fs = require('fs');
const { guardarSeguro } = require('../src/nucleo/almacen');

const SECRETOS = /SECRET|KEY|TOKEN|SESION_SECRETO|PASSWORD/i;
const NECESARIAS = ['SPREADSHEET_ID', 'FOLDER_ID', 'CATALOGO_ID', 'COMPRAS_DB_ID', 'COMPRAS_FOLDER_ID', 'COBRANZA_DB_ID',
  'COBRANZA_FOLDER_ID', 'ADMIN_DB_ID', 'ADMIN_FOLDER_ID', 'SUPER_ADMIN', 'SESION_SECRETO'];
const leer = f => {
  const x = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error(f + ' no es un objeto JSON {clave: valor}.');
  return x;
};
const [, , accion, a, b] = process.argv;
if (accion === 'importar' && a && b) {
  const p = leer(a), out = {};
  Object.keys(p).sort().forEach(k => { if (k !== 'API_MUDADA') out[k] = String(p[k]); });
  const faltan = NECESARIAS.filter(k => !out[k]);
  guardarSeguro(b, JSON.stringify(out, null, 1));
  console.log('✔ ' + Object.keys(out).length + ' propiedades en ' + b + (p.API_MUDADA ? ' (sin API_MUDADA)' : ''));
  if (faltan.length) console.log('⚠ faltan: ' + faltan.join(', ') + ' (sin ellas Code.js crea libros o carpetas nuevos al usarlas)');
} else if (accion === 'comparar' && a && b) {
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
} else {
  console.error('Uso: propiedades.js importar exportadas.json destino.json | comparar a.json b.json');
  process.exit(2);
}
