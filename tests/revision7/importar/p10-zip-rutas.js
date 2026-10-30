// P10 · (Correcto) Rutas hostiles dentro del ZIP: "../", rutas absolutas y "\" no llegan a Drive ni a la hoja como ruta. Los nombres
// en Drive salen del CFDI (nombreArchivoFacturaCliente, sin / \ : * ? " < > |) y archivo_xml guarda solo el último tramo.
// Uso: node revision/p10-zip-rutas.js
'use strict';
const assert = require('assert');
const C = require('./comun');
const A = C.crearArnes();
const zip = C.crearZip([
  { nombre: '../../../../etc/A-101.xml', datos: Buffer.from(C.cfdi({ uuid: C.U(1), serie: '../..', folio: '/etc/passwd', nombreReceptor: '..\\..\\CLIENTE' })) },
  { nombre: '/abs/../A-101.pdf', datos: Buffer.from('%PDF-1.7 x') },
  { nombre: 'C:\\Windows\\..\\A-102.xml', datos: Buffer.from(C.cfdi({ uuid: C.U(2), folio: '102' })) },
]);
const r = A.ok('tania', 'importarFacturasClientes', { archivos: [{ nombre: '../x.zip', datos: zip.toString('base64') }], idSolicitud: C.id('z') });
console.log(r.resultados.map(x => x.estado + ' · ' + x.archivo).join('\n'));
const nombres = Object.values(A.archivos).filter(a => a.blob && /\.(xml|pdf)$/.test(a.blob.name)).map(a => a.blob.name);
console.log('Nombres en Drive:', nombres);
assert(nombres.every(n => !/[\\/]/.test(n)));
const enc = A.correr('HOJAS_COBRANZA.FacturasClientes.enc'), h = A.libros[A.props.COBRANZA_DB_ID].pest.FacturasClientes.m;
console.log('archivo_xml en la hoja:', h.slice(1).map(f => f[enc.indexOf('archivo_xml')]));
console.log('OK: ninguna ruta del ZIP se usa como ruta.');
