// Incremento 6 · módulo R (reportes) · revisión independiente 6b (30/10/2026): un caso por hallazgo. Cada sección reproduce
// el escenario de la revisión (fallaba antes del arreglo) y comprueba el comportamiento corregido:
//  2. Fecha base de lo que se debe sin factura: UNA regla para P (vista de la orden), Cuentas por pagar y R (venceSinFactura:
//     recepción, o entrega, o la orden + días de crédito); el mismo saldo cae en el mismo rango y la misma semana que en Cuentas
//     por pagar (facturas primero; el resto completo en la fecha del "siguiente" de P sin facturas, también con plan de pagos).
// Uso: node tests/revision6-reportes.test.js .
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const dir = process.argv[2] || '.';
const A = require('./arnes')(dir, { props: {} });
const { P, plain, HOY_ISO, masDias } = A;
const SRC = fs.readFileSync(path.join(dir, 'Code.js'), 'utf8');

const OC = (folio, total, extra) => Object.assign({ folio, fecha: masDias(-30), proyectoFolio: 'PRY-9-0002', proveedorId: 'RFC1', proveedor: 'Eléctrica',
  moneda: 'MXN', total, subtotal: Math.round(total / 1.16 * 100) / 100, ivaTasa: 0.16, renglones: [{ cantidad: 1, costo: Math.round(total / 1.16 * 100) / 100 }],
  estado: 'Emitida', fechaEntrega: masDias(-25), diasCredito: 0, reqFolio: 'REQ-' + folio, planPago: null }, extra || {});
const PGP = (oc, montoAplicado, extra) => Object.assign({ folio: 'PGP-' + oc + '-' + montoAplicado, ocFolio: oc, montoAplicado, estado: 'Vigente', fecha: HOY_ISO }, extra || {});
const FPR = (folio, oc, total, vence, extra) => Object.assign({ folio, ocFolio: oc, tipo: 'Extranjera', moneda: 'MXN', total, subtotal: Math.round(total / 1.16 * 100) / 100,
  descuento: 0, fechaVencimiento: vence, estado: 'Vigente' }, extra || {});
const datos = (ordenes, pagosProv, facturas) => ({ hoy: HOY_ISO, proyectos: [], prueba: [], ordenes, pagosProv: pagosProv || [], facturas: facturas || [], movimientos: {} });
/** Lo que dice Cuentas por pagar (antiguedadCxp de P) y lo que dice R, como [monto, fecha, rango] ordenados. */
const filasCxp = d => plain(P.antiguedadCxp({ hoy: d.hoy, facturas: d.facturas, ordenes: d.ordenes, pagos: d.pagosProv, movimientos: {} })).abiertas
  .map(a => [a.pendiente, a.fechaVencimiento, a.rango]).sort();
const filasR = d => plain(P.antiguedadPorPagar(d, P.saldoOrdenCompra)).grupos.reduce((a, g) => a.concat(g.detalle), [])
  .reduce((a, x) => a.concat(x.partidas), []).map(p => [p.monto, p.fecha, p.rango]).sort();

// ================= 2. Fecha base: una sola regla (P, Cuentas por pagar y R) =================
{
  // (a) Orden a crédito 30 días recibida ANTES de la entrega planeada, con un anticipo: vence recepción + 30 en las tres pantallas
  const o = OC('OC-H', 1160, { diasCredito: 30, fechaEntrega: masDias(10), fechaRecepcion: masDias(-5), formaPago: 'Crédito del proveedor' });
  const d = datos([o], [PGP('OC-H', 100)]);
  const vence = P.sumarDias(masDias(-5), 30);
  assert.equal(P.saldoOrdenCompra(o, d.pagosProv, []).siguiente.vence, vence, 'P: siguiente pago');
  assert.deepEqual(filasCxp(d).map(x => x[1]), [vence], 'Cuentas por pagar: fila Saldo');
  assert.deepEqual(filasR(d), filasCxp(d), 'R: mismo monto, fecha y rango (antes: entrega + 30)');
  assert.equal(P.venceSinFactura(o), vence, 'recepción + días de crédito');
  const fl = plain(P.flujoSemanal({ hoy: HOY_ISO, pagos: P.porPagarProveedores(d, P.saldoOrdenCompra), cobros: [] }));
  assert.equal(fl.partidas[0].fecha, vence, 'flujo: misma semana');
  // Sin recepción: entrega; sin entrega: la fecha de la orden
  assert.equal(P.venceSinFactura(OC('X', 1, { diasCredito: 15 })), P.sumarDias(masDias(-25), 15));
  assert.equal(P.venceSinFactura(OC('X', 1, { diasCredito: 15, fechaEntrega: '' })), P.sumarDias(masDias(-30), 15));
  assert.equal(P.venceSinFactura({}), '');

  // (b) Pagos parciales con facturas: cada peso en la misma fecha y rango que Cuentas por pagar (facturas primero, luego "Saldo")
  const o2 = OC('OC-C', 2320, { diasCredito: 15, fechaRecepcion: masDias(-20) });
  const d2 = datos([o2], [PGP('OC-C', 600)], [FPR('FPR-1', 'OC-C', 1160, masDias(-5)), FPR('FPR-2', 'OC-C', 580, masDias(40))]);
  assert.deepEqual(filasR(d2), filasCxp(d2), 'mismas filas que Cuentas por pagar');
  assert.deepEqual(filasR(d2).map(x => x[0]), [560, 580, 580].sort());

  // (c) Plan 30/70 sin pagar ni factura: todo el saldo en la fecha del siguiente pago (el anticipo = fecha de la orden), igual que
  //     la vista de la orden y que la fila "Saldo" de Cuentas por pagar en cuanto haya un pago (antes: 348 + 812 en dos fechas)
  const plan = [{ concepto: 'Anticipo', porcentaje: 30 }, { concepto: 'Contra entrega', porcentaje: 70 }];
  const o3 = OC('OC-P', 1160, { planPago: plan, diasCredito: 15 });
  const r3 = plain(P.porPagarProveedores(datos([o3]), P.saldoOrdenCompra));
  assert.deepEqual(r3.map(x => [x.monto, x.fecha, x.fuente, x.referencia]), [[1160, o3.fecha, 'plan', 'Anticipo']]);
  assert.equal(P.saldoOrdenCompra(o3, [], []).siguiente.vence, o3.fecha);
  // Con el anticipo pagado: el resto en recepción/entrega + crédito, como Cuentas por pagar
  const d3 = datos([o3], [PGP('OC-P', 348)]);
  assert.deepEqual(filasR(d3), filasCxp(d3));
  assert.deepEqual(filasR(d3).map(x => [x[0], x[1]]), [[812, P.sumarDias(masDias(-25), 15)]]);

  // (d) Una sola copia de la regla en Code.js
  const copias = SRC.match(/fechaRecepcion\s*\|\|\s*\w+\.fechaEntrega\s*\|\|\s*\w+\.fecha\b/g) || [];
  assert.equal(copias.length, 1, 'la regla vive en venceSinFactura: ' + copias.length + ' copias');
  assert(!/function fechaEstimadaOrden/.test(SRC), 'sin la copia de R');
}

console.log('OK revisión 6b de reportes');
