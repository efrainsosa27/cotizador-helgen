// Copia de la revisión 7c (capri-7rev3/revision/) para la rama incremento-7-fix-importar: antes del arreglo esta prueba de concepto
// confirmaba el defecto; ahora comprueba lo corregido (la prueba permanente es tests/revision7-importar.test.js). Uso: bash tests/revision7/correr.sh
// P7 · Un CFDI de Helgen a Helgen (emisor = receptor = EMPRESA_RFC) entra a la vez como factura de cliente (módulo C: solo se
// revisa el emisor) y como gasto (módulo G: solo se revisa el receptor). No hay revisión de UUID entre FacturasClientes y Gastos, así
// que el mismo documento suma a "facturado" y a costos. Además la sugerencia por RFC lo manda a un proyecto interno cuyo cliente es
// Helgen (p. ej. DROGHEDA: "Helgen — DROGHEDA").
// Uso: node revision/p7-helgen-a-helgen.js
'use strict';
const assert = require('assert');
const C = require('./comun');
const A = C.crearArnes();
A.ctx.prepararCapri();
const pry = A.ok('ana', 'crearProyecto', { nombre: 'Obra', ubicacion: 'Qro', cliente: { nombre: 'X', empresa: 'SA' }, idSolicitud: C.id('p') }).folio;
const UUID = C.U(4444);
const xml = C.b64(C.cfdi({ uuid: UUID, emisor: C.HELGEN, receptor: C.HELGEN, nombreReceptor: 'HELGEN SERVICIOS ESPECIALIZADOS', fecha: A.HOY_ISO + 'T09:00:00' }));
const r = A.ok('tania', 'importarFacturasClientes', { archivos: [{ nombre: 'auto.xml', datos: xml }], idSolicitud: C.id('f') }).resultados[0];
console.log('Como factura de cliente:', r.estado, '·', r.mensaje);
const g = A.post('obrero', 'guardarGasto', { proyectoFolio: pry, fecha: A.HOY_ISO, categoria: 'Otros', concepto: 'x', monto: 1, moneda: 'MXN',
  ivaIncluido: 'No', ticket: { nombre: 't.jpg', datos: A.FOTO }, xml: { nombre: 'auto.xml', datos: xml }, idSolicitud: C.id('g') });
console.log('Como gasto:', g.ok ? 'aceptado ' + g.datos.folio + ' por ' + g.datos.gasto.total : 'rechazado → ' + g.error);
assert(r.estado === 'rechazada' && /lo emitió Helgen a la misma Helgen/.test(r.mensaje), 'ARREGLADO (lado de facturas de clientes)');
console.log('ARREGLADO del lado de facturas de clientes: Helgen→Helgen no se importa. (El lado de gastos lo arregla su propia rama.)');
