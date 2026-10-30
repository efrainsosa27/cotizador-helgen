// Copia de la revisión 7c (capri-7rev3/revision/) para la rama incremento-7-fix-importar: antes del arreglo esta prueba de concepto
// confirmaba el defecto; ahora comprueba lo corregido (la prueba permanente es tests/revision7-importar.test.js). Uso: bash tests/revision7/correr.sh
// P2 · ZIP: los límites se revisan DESPUÉS de inflar todo. entradasDeZip_ llama descomprimir_ (Utilities.unzip, que infla cada
// entrada completa en memoria) y solo después cuenta entradas (MAX_ENTRADAS_ZIP) y bytes (MAX_DESCOMPRIMIDO). Además el límite de
// 60 MB es por ZIP, no por envío, y lo inflado se guarda en `entradas` hasta el final de importarFacturasClientes.
//  A) Un ZIP de ~0.6 MB que se infla a 600 MB: se infla entero y recién entonces se rechaza "pesa más de 60 MB".
//  B) Un envío dentro de TODOS los límites (≤ 60 archivos, ≤ 20 MB comprimido, cada ZIP ≤ 60 MB inflado) que retiene N × 59 MB a la vez.
// Uso: node revision/p2-zip-bomba.js
'use strict';
const assert = require('assert');
const C = require('./comun');
const A = C.crearArnes();
const MB = 1024 * 1024;
const mem = () => Math.round((process.memoryUsage().arrayBuffers + process.memoryUsage().heapUsed) / MB);

// ---- A) bomba: 600 MB de ceros en un "factura.xml" ----
const bomba = C.crearZip([{ nombre: 'factura.xml', datos: Buffer.alloc(600 * MB, 0x20) }]);
console.log('A) ZIP de', (bomba.length / MB).toFixed(2), 'MB comprimido');
let pico = 0;
const unzip0 = A.ctx.Utilities.unzip;
A.ctx.Utilities.unzip = b => { const r = unzip0(b); pico = Math.max(pico, mem()); return r; };
const antes = C.inflado();
let r = A.ok('tania', 'importarFacturasClientes', { archivos: [{ nombre: 'contalink.zip', datos: bomba.toString('base64') }], idSolicitud: C.id('z') });
console.log('   inflado por descomprimir_:', Math.round((C.inflado() - antes) / MB), 'MB · memoria en el pico:', pico, 'MB · resultado:', r.resultados[0].mensaje);
assert(C.inflado() - antes === 0 && /más de 60 MB/.test(r.resultados[0].mensaje), 'ARREGLADO: se rechaza por su índice, sin inflar nada');

// ---- B) dentro de los límites: N ZIPs con un PDF de 59 MB cada uno (cada ZIP pasa los 60 MB); todo queda vivo en `entradas` ----
const N = Number(process.argv[2]) || 12;
const pdf59 = Buffer.alloc(59 * MB, 0); pdf59.write('%PDF-1.7');
const zip59 = C.crearZip([{ nombre: 'A-101.pdf', datos: pdf59 }]);
const archivos = Array.from({ length: N }, (_, i) => ({ nombre: 'parte' + i + '.zip', datos: zip59.toString('base64') }));
const comprimido = archivos.reduce((s, a) => s + Buffer.from(a.datos, 'base64').length, 0);
const vivos = [];
A.ctx.Utilities.unzip = b => { const r = unzip0(b); vivos.push(mem()); return r; };
global.gc && global.gc();
const base = mem();
r = A.ok('tania', 'importarFacturasClientes', { archivos, idSolicitud: C.id('z') });
console.log('B) envío de', N, 'ZIP =', (comprimido / MB).toFixed(2), 'MB comprimido (límite 20 MB, ' + N + ' de 60 archivos)');
console.log('   memoria tras cada ZIP (MB):', vivos.map(v => v - base).join(' → '), '· resultados:', [...new Set(r.resultados.map(x => x.estado + ': ' + x.mensaje))].join(' | '));
assert.equal(vivos.length, 1, 'ARREGLADO: el presupuesto es por envío: solo el primer ZIP se infla');
assert(r.resultados.filter(x => /junto con lo demás de este envío/.test(x.mensaje)).length === N - 1, 'los demás se rechazan sin inflarse');
console.log('   → antes del arreglo, con 60 ZIP (≈' + (zip59.length * 60 / MB).toFixed(1) + ' MB comprimido) eran ≈' + Math.round(60 * 59 / 1024 * 10) / 10 +
  ' GB inflados y retenidos; ahora, a lo más 60 MB por envío.');
console.log('ARREGLADO: el índice se revisa antes de inflar y el límite de lo inflado es por envío.');
