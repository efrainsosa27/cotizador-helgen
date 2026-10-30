// Sonda 5: marcarAceptada revisa que no haya pagos, órdenes ni adicionales en otra moneda antes de cambiar la moneda del proyecto,
// pero NO revisa los gastos. Un gasto MXN capturado antes de la aceptada (proyecto "MXN" por omisión, sin tipo de cambio) queda
// para siempre fuera del margen del contrato USD ("Revisar" / sinSumar) y los totales en USD del resumen y de Reportes lo omiten
// sin decir nada. Con órdenes de compra el mismo caso se rechaza ("el margen nunca mezcla monedas").
'use strict';
const assert = require('assert');
const S = require('./comun')(process.argv[2] || '.', { ROL_OPERACIONES: '' });
const { ok, falla, pry, cotizar, id, HOY_ISO, FOTO } = S;
const pA = pry('Planta');
const g = ok('obrero', 'guardarGasto', { proyectoFolio: pA, fecha: HOY_ISO, categoria: 'Viáticos', concepto: 'Visita de levantamiento', monto: 5800,
  moneda: 'MXN', ivaIncluido: 'Sí', ticket: { nombre: 't.jpg', datos: FOTO }, idSolicitud: id('gas') }).folio;
ok('leo', 'aprobarGasto', g, null);
const cUsd = cotizar(pA, 1000, { moneda: 'USD' });
let cambio, error = '';
try { ok('tania', 'marcarAceptada', pA, cUsd, true); cambio = true; } catch (e) { error = e.message; console.log('rechazado (correcto):', e.message); }
assert(!cambio, 'DEFECTO: la moneda del proyecto cambió a USD con un gasto aprobado en MXN sin tipo de cambio; el gasto ya no entra al margen');
assert(/ya tiene gastos en MXN: la cotización aceptada debe ser en MXN/.test(error), 'mensaje como el de órdenes y pagos: ' + error);
// Con la cotización en MXN sí se acepta y el gasto entra al margen
const cMxn = cotizar(pA, 1000);
ok('tania', 'marcarAceptada', pA, cMxn, true);
ok('tania', 'firmarContrato', pA, HOY_ISO);
const m = ok('tania', 'getCobranzaProyecto', pA).margen;
console.log('tarjeta: contratado', m.contratado, m.moneda, '· costos sumados', m.totalCostos, '· margen', m.margen, '· sinSumar', JSON.stringify(m.sinSumar));
assert.equal(m.totalCostos, 5000, 'el gasto (5,000 sin IVA) entra al margen');
