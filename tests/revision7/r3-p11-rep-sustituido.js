// P11 · REP que sustituye a otro REP (CfdiRelacionados TipoRelacion 04, el procedimiento del SAT para corregir un complemento de
// pago): calcularFacturasClientes solo marca "por revisar" la sustituida si es una factura I; con dos P vigentes los dos suman a lo
// cubierto. Aquí: PPD de 1,000 cobrada completa en Cobranza; REP1 dice 1,000 por error, REP2 lo sustituye con 400 (lo correcto).
// Lo cubierto queda en 1,400 → no sale "REP pendiente" (faltan 600) y nadie avisa que REP1 debe marcarse Cancelada.
// Uso: node revision/p11-rep-sustituido.js
'use strict';
const assert = require('assert');
const C = require('./comun-rev3');
const A = C.crearArnes();
const P = A.ctx;
const I = { uuid: C.U(1), tipo: 'I', estado: 'Vigente', metodo: 'PPD', moneda: 'MXN', total: 1000, fecha: '2026-10-01', serieFolio: 'A-1',
  proyectoFolio: 'PRY-2026-0001', etapas: [{ clave: '1', etapa: 'Anticipo', monto: 1000 }], relacionadas: [] };
const rep = (u, pagado, rel) => ({ uuid: u, tipo: 'P', estado: 'Vigente', moneda: 'MXN', total: pagado, fecha: '2026-10-20', serieFolio: 'P-' + u.slice(-1),
  relacionadas: rel ? [{ uuid: rel, tipoRelacion: '04' }] : [], pagos: [{ fecha: '2026-10-15', monto: pagado, moneda: 'MXN',
    documentos: [{ uuid: I.uuid, parcialidad: 1, saldoAnterior: 1000, pagado, saldoInsoluto: 1000 - pagado, moneda: 'MXN' }] }] });
const cob = { 'PRY-2026-0001': { moneda: 'MXN', etapas: [{ clave: '1', etapa: 'Anticipo', monto: 1000, cobrado: 1000 }] } };
const r = A.plain(P.calcularFacturasClientes([I, rep(C.U(901), 1000), rep(C.U(902), 400, C.U(901))], cob));
const x = r.facturas[I.uuid], rep1 = r.facturas[C.U(901)];
console.log('Cubierto por REP:', x.repCts / 100, '· REP pendiente:', x.repPendiente, '· REP1 por revisar:', JSON.stringify(rep1.revisar),
  '· REP1 sustituidaPor:', rep1.sustituidaPor);
// INVERTIDA tras el arreglo (antes confirmaba el defecto): termina en error mientras el defecto exista
assert.equal(x.repCts, 40000, 'DEFECTO: el REP sustituido (04) sigue sumando a lo cubierto');
assert.equal(x.repPendiente, true, 'DEFECTO: el REP sustituido tapa el REP pendiente de 600');
assert(/relación 04/.test(rep1.revisar), 'DEFECTO: no se pide marcar Cancelado el REP sustituido');
assert(/relación 04/.test(r.facturas[C.U(902)].revisar), 'el par queda por revisar mientras el de antes siga Vigente');
console.log('Arreglado: el REP sustituido no cuenta y el par queda por revisar.');
