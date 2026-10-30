// P5 · UUID repetido solo en un sentido. guardarGasto rechaza un CFDI ya registrado como factura de proveedor (uuidsUsados_), pero
// registrarFacturaProveedor solo mira FacturasProveedor (validarFacturaProveedor ← facturasDelLibro_): el mismo CFDI registrado
// PRIMERO como gasto se acepta DESPUÉS como factura de la orden de compra → se reembolsa a la persona y se paga al proveedor, y el
// margen lo cuenta dos veces (gastos + órdenes).
// Uso: node revision/p5-uuid-gasto-luego-factura-proveedor.js
'use strict';
const assert = require('assert');
const C = require('./comun-rev3');
const A = C.crearArnes({ props: { ROL_COBRANZA: 'efrain@helgen.tech', ROL_COMPRAS: 'pedro@helgen.tech',
  ROL_REQUISICION: 'obrero@helgen.tech', ROL_OPERACIONES: '' } });

const pry = A.ok('ana', 'crearProyecto', { nombre: 'Planta Norte', ubicacion: 'Qro', cliente: { nombre: 'X', empresa: 'SA' }, idSolicitud: C.id('p') }).folio;
const oc = C.ordenDeCompra(A, pry, 1000);
const UUID = C.U(31337);
const xml = { nombre: 'f.xml', datos: C.b64(C.cfdi({ uuid: UUID, emisor: C.PROV, nombreEmisor: 'GASOLINERA DEL BAJIO', receptor: C.HELGEN,
  nombreReceptor: 'HELGEN', fecha: A.HOY_ISO + 'T09:00:00' })) };

const g = A.ok('obrero', 'guardarGasto', { proyectoFolio: pry, fecha: A.HOY_ISO, categoria: 'Combustible', concepto: 'Gasolina', monto: 1,
  moneda: 'MXN', ivaIncluido: 'No', ticket: { nombre: 't.jpg', datos: A.FOTO }, xml, idSolicitud: C.id('g') });
console.log('1) Gasto', g.folio, 'con el CFDI', UUID, '→ total', g.gasto.total, g.gasto.moneda);
const r = A.post('pedro', 'registrarFacturaProveedor', { ocFolio: oc, xml, idSolicitud: C.id('f') });
console.log('2) El mismo XML como factura de', oc + ':', r.ok ? 'ACEPTADA (' + r.datos.folio + ')' : 'rechazada → ' + r.error);
// INVERTIDA tras el arreglo (antes confirmaba el defecto): termina en error mientras el defecto exista
assert(!r.ok && new RegExp(g.folio).test(r.error), 'DEFECTO: se aceptó como factura de proveedor un CFDI que ya es el gasto ' + g.folio);
// Al revés sí se rechaza (lo que ya prueba tests/gastos.test.js)
const r2 = A.post('obrero', 'guardarGasto', { proyectoFolio: pry, fecha: A.HOY_ISO, categoria: 'Combustible', concepto: 'Gasolina', monto: 1,
  moneda: 'MXN', ivaIncluido: 'No', ticket: { nombre: 't.jpg', datos: A.FOTO }, xml: { nombre: 'f.xml', datos: C.b64(C.cfdi({ uuid: UUID, emisor: C.PROV,
    receptor: C.HELGEN, fecha: A.HOY_ISO + 'T09:00:00' })) }, idSolicitud: C.id('g') });
console.log('3) Otro gasto con ese UUID:', r2.ok ? 'aceptado' : 'rechazado → ' + r2.error);
console.log('Arreglado: la revisión de UUID entre Gastos y Facturas de proveedor va en los dos sentidos.');
