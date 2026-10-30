// Arranque común de las sondas de revisión (CAPRI incremento 7). Uso: const S = require('./comun')(dir, extraProps)
'use strict';
module.exports = function (dir, extra) {
  const A = require('../arnes')(dir, { props: Object.assign({
    ROL_COBRANZA: 'tania@helgen.tech, leo@helgen.tech', ADMIN_DESBLOQUEO: 'leo@helgen.tech', ROL_COMPRAS: 'pedro@helgen.tech',
    ROL_REQUISICION: 'obrero@helgen.tech, ana@helgen.tech', ROL_OPERACIONES: 'adri@helgen.tech', SUPER_ADMIN: 'leo@helgen.tech' }, extra || {}) });
  const { ok, HOY_ISO, PDF } = A;
  A.P.prepararCapri();
  let n = 0;
  const id = p => (p || 'x') + (++n) + '-' + Math.random().toString(36).slice(2, 8);
  const pry = nombre => ok('ana', 'crearProyecto', { nombre, ubicacion: 'Qro', cliente: { nombre: 'Cliente ' + nombre, empresa: 'SA' }, idSolicitud: id('p') }).folio;
  const cotizar = (pf, precio, extraC) => ok('ana', 'guardarCotizacion', Object.assign({ cliente: { nombre: 'Cliente', empresa: 'SA' },
    items: [{ descripcion: 'Servicio', cantidad: 1, precio }], proyectoFolio: pf, moneda: 'MXN', idSolicitud: id('c') }, extraC || {})).folio;
  const firmar = (pf, cot) => { ok('tania', 'marcarAceptada', pf, cot, true); return ok('tania', 'firmarContrato', pf, HOY_ISO); };
  const pagar = (pf, monto, etapaOrden, etapaAdicional, extraP) => ok('tania', 'registrarPago', Object.assign({ proyectoFolio: pf, fecha: HOY_ISO, monto,
    metodo: 'Transferencia', referencia: 'SPEI ' + id('r'), etapaOrden: etapaOrden || 1, etapaAdicional: etapaAdicional || '',
    comprobante: { datos: PDF }, idSolicitud: id('g') }, extraP || {}));
  // Relleno: PRY-AAAA-0001 es folio de prueba en los reportes
  pry('Relleno');
  return Object.assign(A, { id, pry, cotizar, firmar, pagar });
};
