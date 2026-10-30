// Sonda 1: anular (super admin) una adicional que ya tiene pagos deja el proyecto con saldo NEGATIVO; el resumen de cobranza
// suma ese negativo a "Por cobrar" y se come el saldo de otros proyectos; CxC (que ignora saldos ≤ 0) da otra cifra.
'use strict';
const assert = require('assert');
const S = require('./comun')(process.argv[2] || '.');
const { ok, pry, cotizar, firmar, pagar, id } = S;
const pA = pry('Planta'), pX = pry('Otro cliente');
firmar(pA, cotizar(pA, 10000));                 // 11,600 con IVA
firmar(pX, cotizar(pX, 1000));                  // 1,160 con IVA (nadie ha pagado)
const ad = cotizar(pA, 1000, { adicional: true }); // 1,160 con IVA
ok('tania', 'aceptarAdicional', pA, ad);
pagar(pA, 11600, 1, '');                        // el contrato completo
pagar(pA, 1160, 1, ad);                         // la adicional completa
let v = ok('tania', 'getCobranzaProyecto', pA);
console.log('antes de anular: total', v.resumen.total, 'pagado', v.resumen.pagado, 'saldo', v.resumen.saldo);
ok('leo', 'anular', ad, 'Se cotizó dos veces', id('a'));
v = ok('tania', 'getCobranzaProyecto', pA);
console.log('después de anular: total', v.resumen.total, 'pagado', v.resumen.pagado, 'saldo', v.resumen.saldo,
  'etapas', v.resumen.etapas.map(e => e.etapa + ':' + e.saldo).join(' '));
const rs = ok('tania', 'resumenCobranzaGeneral');
const tot = rs.totales.find(t => t.moneda === 'MXN');
console.log('resumen: renglón pA saldo', rs.proyectos.find(p => p.folio === pA).saldo, '· renglón pX saldo', rs.proyectos.find(p => p.folio === pX).saldo,
  '· TOTAL Por cobrar MXN =', tot.porCobrar, '· con saldo', tot.conSaldo);
const cxc = ok('tania', 'reporteCxc');
console.log('CxC total MXN =', cxc.totales.find(t => t.moneda === 'MXN').total);
assert.equal(tot.porCobrar, 1160, 'DEFECTO: el resumen nettea el saldo negativo de pA contra lo que debe pX (Por cobrar real = 1,160)');
