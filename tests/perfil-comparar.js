// Compara dos corridas de tests/perfil.js (docs/rapidez-apps-script.md): las respuestas de cada llamada medida (--respuestas) o
// cómo quedaron todas las pestañas (--estado). Ignora solo lo que depende del reloj: fechas con hora (las dos corridas no son en
// el mismo segundo), huellas MD5 (la de una propuesta incluye su hora) y el valor de cada versión (desde la revisión 5 es la hora
// más unas cifras al azar; se compara qué colecciones trae, no su número).
// Uso: node tests/perfil-comparar.js antes.json despues.json
'use strict';
const fs = require('fs');
const [, , pa, pb] = process.argv;
if (!pa || !pb) { console.log('Uso: node tests/perfil-comparar.js antes.json despues.json'); process.exit(2); }
const norm = t => t
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})/g, 'ISO')
  .replace(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/g, 'DD/MM/AAAA HH:MM')
  .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?/g, 'AAAA-MM-DD HH:MM')
  .replace(/[0-9a-f]{32}/g, 'H32')
  .replace(/"versiones":\{[^{}]*\}/g, m => m.replace(/:"?\d+"?/g, ':V'));
const a = JSON.parse(fs.readFileSync(pa, 'utf8')), b = JSON.parse(fs.readFileSync(pb, 'utf8'));
// --estado: [{libro, pestanas: [{n, filas}]}] → un renglón por fila; --respuestas: [{escenario, funcion, datos}]
const renglones = x => x.length && x[0].pestanas
  ? [].concat(...x.map(l => [].concat(...l.pestanas.map(p => p.filas.map((f, i) => [l.libro + '/' + p.n + ' fila ' + (i + 1), f])))))
  : x.map(r => [r.escenario + ' · ' + r.funcion, r.datos]);
const ra = renglones(a), rb = renglones(b);
let dif = 0;
for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
  const x = ra[i], y = rb[i];
  if (!x || !y || x[0] !== y[0] || norm(JSON.stringify(x[1])) !== norm(JSON.stringify(y[1]))) {
    if (++dif <= 5) console.log('DIFERENTE: ' + (x ? x[0] : '(falta antes)') + ' ↔ ' + (y ? y[0] : '(falta después)'));
  }
}
console.log((ra.length === rb.length ? ra.length : ra.length + ' / ' + rb.length) + ' comparados · ' + dif + ' diferentes');
process.exit(dif ? 1 : 0);
