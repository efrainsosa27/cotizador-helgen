// Sonda 4: registrarPago (cobranza) sigue con idempotencia SOLO en el caché (PAG_<idSolicitud>); la hoja Pagos no guarda el id.
// (a) Si el caché ya no tiene la entrada (CacheService la puede tirar; o no cupo), el reintento del MISMO envío crea otro PAG.
// (b) Desde el incremento 7 lo que se guarda en ese caché es {folio, url, vista} y la vista creció (adicionales, bloque de facturas,
//     margen con costos): guardarIdempotencia_ se traga el "Argument too large" (> 100 KB) y el reintento duplica sin avisar.
// docs/incremento-7.md §3: "idempotencia de las escrituras con archivo en la hoja (no solo en el caché: lección del incremento 6)".
'use strict';
const assert = require('assert');
const S = require('./comun')(process.argv[2] || '.');
const { ok, pry, cotizar, firmar, id, PDF, HOY_ISO, cache, libros, props } = S;
const { cfdi, U, b64 } = require('./cfdi-cliente');

const pA = pry('Planta');
firmar(pA, cotizar(pA, 100000));
// (b) Tamaño de lo que se guarda: con N facturas ligadas y N pagos
const N = Number(process.argv[3] || 40);
const archivos = [];
for (let i = 0; i < N; i++) archivos.push({ nombre: 'A-' + (300 + i) + '.xml', datos: b64(cfdi({ uuid: U(5000 + i), folio: String(300 + i), subtotal: '100.00', iva: '16.00', total: '116.00' })) });
for (let k = 0; k < archivos.length; k += 50) ok('tania', 'importarFacturasClientes', { archivos: archivos.slice(k, k + 50), idSolicitud: id('imp') });
for (let i = 0; i < N; i++) ok('tania', 'ligarFacturaCliente', { uuid: U(5000 + i), proyectoFolio: pA, etapas: [{ clave: '1' }] });
const pago = idSol => ({ proyectoFolio: pA, fecha: HOY_ISO, monto: 116, metodo: 'Transferencia', referencia: 'SPEI ' + idSol, etapaOrden: 1,
  comprobante: { datos: PDF }, idSolicitud: idSol });
for (let i = 0; i < N; i++) ok('tania', 'registrarPago', pago(id('g')));
const idS = 'reintento-1';
const r1 = ok('tania', 'registrarPago', pago(idS));
const bytes = Buffer.byteLength(JSON.stringify(r1), 'utf8');
console.log('N =', N, '· {folio,url,vista} =', bytes, 'bytes · en caché:', 'PAG_' + idS in cache, '· ≈', Math.round(bytes / (N + 1)), 'bytes por factura+pago');
// (a) Reintento del mismo envío sin la entrada del caché (con N grande no cupo; con N chico se simula que expiró)
const cupo = ('PAG_' + idS) in cache;
delete cache['PAG_' + idS];
console.log(cupo ? '(entrada borrada a mano: simula que el caché la tiró)' : '(la entrada NO se guardó: pasaba de 100 KB)');
const r2 = ok('tania', 'registrarPago', pago(idS));
const pagos = libros[props.COBRANZA_DB_ID].pest.Pagos.m.filter(r => String(r[10]) === 'SPEI ' + idS);
console.log('primer folio', r1.folio, '· reintento', r2.folio, '· filas en Pagos con esa referencia:', pagos.length);
assert.equal(pagos.length, 1, 'DEFECTO: el mismo envío (idSolicitud ' + idS + ') quedó registrado dos veces');
