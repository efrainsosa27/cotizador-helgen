// Sonda 6 (lógica pura): proyecto USD cobrado en MXN. CAPRI guarda lo cobrado en USD con el tipo de cambio que capturó cobranza; el
// REP (Pagos 2.0) trae ImpPagado en USD con su TipoCambioP. Si los tipos de cambio difieren un poco, la diferencia pasa de la
// tolerancia (1.00 USD) y la factura queda "REP pendiente" para siempre aunque ya tiene su REP completo.
'use strict';
const assert = require('assert');
const A = require('../arnes')(process.argv[2] || '.', {});
const { P, plain } = A;
const UI = '00000001-AAAA-4BBB-8CCC-000000000001', UP = '00000002-AAAA-4BBB-8CCC-000000000002';
// Cobranza: MXN 200,000 con TC 18.00 → 11,111.11 USD aplicados (convertirMoneda)
const aplicado = P.convertirMoneda(200000, 'MXN', 'USD', 18.00);
const facturas = [
  { uuid: UI, tipo: 'I', estado: 'Vigente', metodo: 'PPD', moneda: 'USD', total: 11111.11, fecha: '2026-10-01', serieFolio: 'A-1', proyectoFolio: 'PRY-2026-0005',
    etapas: [{ clave: '1', etapa: 'Total', monto: 11111.11 }] },
  // El REP de CONTALINK con TipoCambioP 18.05: ImpPagado 11,080.33 USD, saldo insoluto 0 (para el SAT la factura quedó pagada)
  { uuid: UP, tipo: 'P', estado: 'Vigente', moneda: 'MXN', total: 200000, fecha: '2026-10-20', serieFolio: 'P-1',
    pagos: [{ fecha: '2026-10-20', monto: 200000, moneda: 'MXN', documentos: [{ uuid: UI, parcialidad: 1, saldoAnterior: 11080.33, pagado: 11080.33, saldoInsoluto: 0, moneda: 'USD' }] }] },
];
const cob = { 'PRY-2026-0005': { moneda: 'USD', etapas: [{ clave: '1', etapa: 'Total', monto: 11111.11, cobrado: aplicado }] } };
const x = plain(P.calcularFacturasClientes(facturas, cob)).facturas[UI];
console.log('cobrado', x.cobradoCts / 100, 'USD · con REP', x.repCts / 100, 'USD · REP pendiente', x.repPendiente, '· saldo según REP', x.saldoSegunRep);
assert(!x.repPendiente, 'DEFECTO: con el REP completo (saldo insoluto 0) sigue "REP pendiente" por ' + ((x.cobradoCts - x.repCts) / 100) + ' USD de tipo de cambio');
