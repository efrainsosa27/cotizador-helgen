// Incremento 6 · Módulo P: pagos parciales a proveedores (contrato docs/incremento-6.md §1–2; notas docs/incremento-6-pagos.md).
// Cubre, con el arnés (doPost y servicios de Google simulados):
//  0. Lógica pura: normalizarPlanPago, saldoOrdenCompra (esperado, pagado, saldo, tolerancia, devoluciones, facturas con
//     retenciones, plan y vencimientos, órdenes pagadas, canceladas), tipoDePagoProv, antiguedadCxp con saldos, Pendientes y correo.
//  1. Flujo de siempre con plan de pagos: plan al autorizar (y en el PDF), anticipo, "Pagada parcial" para compras y para quien pidió
//     (sin montos), recibir antes de pagar todo, oc.pagada solo con el primer pago, req.pagoparcial / req.pagada una vez, tope del
//     saldo, guardia de tarjeta, tipo de cambio, idempotencia, liquidación que cierra.
//  2. Combinaciones de cancelar: el único pago de una recibida, un pago de en medio, después de una devolución, devolución que deja
//     la orden pagada, retenida por una devolución, cancelarRecepcion, cancelarOrdenCompra, Anular (pago y orden con varios pagos),
//     crédito del proveedor con pagos parciales, documentos para transferencia en cada pago, permisos.
//  3. Cuentas por pagar con saldos (factura pagada en parte y saldo sin factura por el plan).
//  4. Flujo con aprobaciones: el plan va en la propuesta y en la orden; recepción por renglón antes de terminar de pagar.
// Uso: node tests/pagos.test.js .
'use strict';
const assert = require('assert');
const dir = process.argv[2] || '.';
const A = require('./arnes')(dir, { props: {
  ROL_COMPRAS: 'efrain@helgen.tech, pedro@helgen.tech', ROL_COBRANZA: 'efrain@helgen.tech',
  ROL_REQUISICION: 'obrero@helgen.tech, efrain@helgen.tech, pedro@helgen.tech', SOLO_REQUISICION: 'rosa@helgen.tech, adri@helgen.tech',
  ROL_OPERACIONES: '' } });
const { P, ok, falla, props, HOY_ISO, masDias, correr, FOTO, FOTOS, ANIO, plain } = A;
const MANANA = masDias(1);
A.libros.DB.pest.Config.m.push(['SITIOS', 'QRO | Querétaro\nZLO | Manzanillo (TIMSA)\nVER | Veracruz (ICAVE)']);
// Los documentos del proveedor (F) solo en la sección que los prueba
const exigirDocsOriginal = P.exigirDocumentosParaPagar_;
P.exigirDocumentosParaPagar_ = function () {};
// Centro de mando: se capturan los avisos (los manda y prueba el módulo C); los correos sí se mandan (MailApp simulado: A.correos)
correr(`var PORTAL = []; avisarPortal_ = function (tipo, folio) { PORTAL.push([tipo, folio]); return ''; };`);
const portal = oc => correr('PORTAL').filter(x => x[1] === oc && x[0] !== 'oc.autorizada').map(x => x[0]); // los de pagos
props.SUPER_ADMIN = 'leo@helgen.tech';
P.prepararCapri();

let nId = 0;
const id = p => (p || 'x') + (++nId);
const F = { nombre: 'foto.jpg', datos: FOTO, mime: 'image/jpeg' };
const PGP = n => 'PGP-' + ANIO + '-' + n;
const P2 = ok('ana', 'crearProyecto', { nombre: 'Casa del Lago', ubicacion: 'Querétaro', cliente: { nombre: 'Luis', empresa: 'Solar' }, idSolicitud: 'p2' }).folio;
const RENGLONES = [{ descripcion: 'Cable THW 10', cantidad: 80, unidad: 'm' }, { descripcion: 'Tubo conduit 3/4', cantidad: 12, unidad: 'pza' }];
// Orden: 80 m × $10 + 12 pza × $50 = $1,400 + IVA 16 % = $1,624
const PLAN = [{ concepto: 'Anticipo', porcentaje: 30 }, { concepto: 'Contra entrega', porcentaje: 70 }];
const OCD = extra => Object.assign({ proveedor: { razonSocial: 'Ferretera del Puerto' }, fechaEntrega: MANANA, lugarEntrega: 'Querétaro',
  condicionesPago: 'Contado', diasCredito: 0, formaPago: 'Transferencia', idSolicitud: id('oc'),
  renglones: [{ descripcion: 'Cable THW 10', unidad: 'M', cantidad: 80, costo: 10 }, { descripcion: 'Tubo conduit 3/4', unidad: 'PZA', cantidad: 12, costo: 50 }] },
  extra || {});
const pago = (folio, extra) => Object.assign({ reqFolio: folio, fecha: HOY_ISO, monto: 1624, monedaPago: 'MXN', metodo: 'Transferencia',
  referencia: 'SPEI ' + id(), comprobante: { nombre: 'c.pdf', datos: A.PDF }, idSolicitud: id('pg') }, extra || {});
const pagar = (folio, monto, extra) => ok('pedro', 'registrarPagoProveedor', pago(folio, Object.assign({ monto: monto }, extra || {})));
/** Flujo de siempre: obrero pide, efrain autoriza. */
function siempre(ocExtra) {
  const folio = ok('obrero', 'guardarRequisicion', { proyectoFolio: P2, sitio: 'Querétaro', renglones: RENGLONES,
    cotizacion: { nombre: 'cot.pdf', datos: A.PDF }, idSolicitud: id('q') }).folio;
  const oc = ok('efrain', 'autorizarRequisicion', folio, OCD(ocExtra)).ocFolio;
  return { req: folio, oc: oc };
}
const LC = () => A.libros[props.COMPRAS_DB_ID];
const H = n => LC().pest[n].m;
const col = (hoja, nombre) => H(hoja)[0].indexOf(nombre);
const filaOc = oc => H('OrdenesCompra').find(r => r[0] === oc);
const pagosDe = oc => H('PagosProveedores').filter(r => r[3] === oc);
const vista = req => ok('pedro', 'getRequisicion', req);
const mia = req => ok('obrero', 'misRequisiciones').find(x => x.folio === req);
const ultimaDev = () => H('Devoluciones').slice(-1)[0][0];
let visto = 0;
const correosNuevos = () => { const c = A.correos.slice(visto); visto = A.correos.length; return c; };
const guardado = {}; // requisiciones de una sección que usa otra (la interfaz)
const sinMontos = (texto, que) => assert(!/\$|\d,\d{3}\.\d{2}|\b\d+\.\d{2}\b|PGP-|OC-|Ferretera/.test(texto), (que || '') + ' sin montos: ' + texto.slice(0, 300));

// ================= 0. Lógica pura =================
{
  // Plan de pagos
  assert.deepEqual(plain(P.normalizarPlanPago(PLAN)), PLAN);
  assert.deepEqual(plain(P.normalizarPlanPago(JSON.stringify([{ concepto: '  Anticipo ', porcentaje: '33.33' }, { concepto: 'Saldo', porcentaje: 66.67 }]))),
    [{ concepto: 'Anticipo', porcentaje: 33.33 }, { concepto: 'Saldo', porcentaje: 66.67 }], 'JSON, espacios y texto');
  for (const vacio of [null, undefined, '', '  ', [], [{ concepto: '', porcentaje: '' }], [null]]) assert.equal(P.normalizarPlanPago(vacio), null, JSON.stringify(vacio));
  for (const [mal, re] of [[[{ concepto: 'A', porcentaje: 50 }, { concepto: 'B', porcentaje: 40 }], /deben sumar 100% \(suman 90%\)/],
    [[{ concepto: 'Anticipo', porcentaje: 50 }, { concepto: 'anticipo', porcentaje: 50 }], /"anticipo" está repetido/],
    [[{ concepto: '', porcentaje: 100 }], /etapa 1 del plan de pagos no tiene concepto/], [[{ concepto: 'A', porcentaje: 0 }, { concepto: 'B', porcentaje: 100 }], /de "A" debe ser mayor a 0/],
    [[{ concepto: 'A', porcentaje: 33.333 }, { concepto: 'B', porcentaje: 66.667 }], /máximo 2 decimales/],
    [Array.from({ length: 11 }, (_, i) => ({ concepto: 'E' + i, porcentaje: 10 })), /máximo 10 etapas/],
    [[{ concepto: 'x'.repeat(61), porcentaje: 100 }], /máximo 60 caracteres/], [{ concepto: 'A' }, /no es válido/], ['{', /no es válido/]]) {
    assert.throws(() => P.normalizarPlanPago(mal), re, JSON.stringify(mal).slice(0, 60));
  }
  assert.equal(P.planDeCelda('basura'), null, 'una celda editada a mano no rompe la orden');
  assert.deepEqual(plain(P.planDeCelda(JSON.stringify(PLAN))), PLAN);
  assert.equal(P.textoPlanPago(PLAN, 1624, 'MXN'), 'Anticipo 30% ($487.20 MXN) · Contra entrega 70% ($1,136.80 MXN)');
  assert.equal(P.textoPlanPago(null), '');
  assert.deepEqual([P.tipoDePagoProv(true, false), P.tipoDePagoProv(false, true), P.tipoDePagoProv(false, false)], ['Liquidación', 'Parcial', 'Anticipo']);
  assert.equal(P.transicionReq('Recibida', 'cancelarPagoRecibida'), 'Recibida');

  // saldoOrdenCompra (firma del contrato: orden, pagos, movimientos)
  const ORD = { folio: 'OC-1', moneda: 'MXN', total: 1624, subtotal: 1400, estado: 'Emitida', ivaTasa: 0.16, fecha: '2026-10-01',
    fechaEntrega: '2026-10-10', fechaRecepcion: '', diasCredito: 30, planPago: null,
    renglones: [{ cantidad: 80, costo: 10 }, { cantidad: 12, costo: 50 }] };
  const pg = (monto, estado, extra) => Object.assign({ folio: 'PGP-' + monto, ocFolio: 'OC-1', fecha: '2026-10-02', montoAplicado: monto, estado: estado || 'Vigente', tipo: 'Anticipo' }, extra || {});
  const S = (o, pagos, movs) => plain(P.saldoOrdenCompra(Object.assign({}, ORD, o || {}), pagos || [], movs || []));
  let s = S();
  assert.deepEqual([s.esperado, s.pagado, s.saldo, s.completo, s.vigentes, s.siguiente], [1624, 0, 1624, false, [], { concepto: 'Saldo', monto: 1624, vence: '2026-11-09' }],
    'sin pagos: el saldo vence a la entrega + 30 días de crédito');
  s = S({}, [pg(800), pg(500, 'Cancelado'), pg(100, 'Anulada')]);
  assert.deepEqual([s.pagado, s.saldo, s.completo, s.vigentes], [800, 824, false, [{ folio: 'PGP-800', fecha: '2026-10-02', montoAplicado: 800, tipo: 'Anticipo' }]],
    'solo cuentan los Vigentes');
  assert.deepEqual([S({}, [pg(1623.01)]).completo, S({}, [pg(1623.01)]).saldo, S({}, [pg(1622.99)]).completo], [true, 0, false], 'tolerancia ±1.00');
  assert.equal(S({}, [pg(1624, 'Vigente', { tipo: '' })]).vigentes[0].tipo, 'Liquidación', 'pago de antes (sin tipo): era el pago completo');
  assert.equal(S({ fechaRecepcion: '2026-10-15' }).siguiente.vence, '2026-11-14', 'recibida: desde la recepción');
  assert.equal(S({ diasCredito: 0, fechaEntrega: '' }).siguiente.vence, '2026-10-01', 'sin entrega: la fecha de la orden');
  // Con plan: lo que sigue es la etapa que falta (la última absorbe los centavos); la primera de varias vence con la orden
  s = S({ planPago: PLAN });
  assert.deepEqual(s.siguiente, { concepto: 'Anticipo', monto: 487.2, vence: '2026-10-01', etapa: 1, etapas: 2 });
  assert.deepEqual(s.etapas.map(e => [e.concepto, e.monto, e.cubierto, e.completa]), [['Anticipo', 487.2, 0, false], ['Contra entrega', 1136.8, 0, false]]);
  s = S({ planPago: PLAN }, [pg(487.2)]);
  assert.deepEqual(s.siguiente, { concepto: 'Contra entrega', monto: 1136.8, vence: '2026-11-09', etapa: 2, etapas: 2 });
  s = S({ planPago: PLAN }, [pg(300)]);
  assert.deepEqual([s.siguiente.concepto, s.siguiente.monto, s.etapas[0].cubierto], ['Anticipo', 187.2, 300], 'anticipo pagado en parte: falta lo del anticipo');
  s = S({ planPago: [{ concepto: 'Contra entrega', porcentaje: 100 }] });
  assert.equal(s.siguiente.vence, '2026-11-09', 'una sola etapa: no es anticipo');
  // Material devuelto sin reponer (regla del incremento 5): 20 m menos → (60 × 10 + 12 × 50) × 1.16 = 1,392
  const DEV20 = [{ renglon: 1, cantidad: -20, tipo: 'Devolución sin reponer', estado: 'Vigente' }, { renglon: 2, cantidad: -5, tipo: 'Devolución', estado: 'Vigente' }];
  s = S({}, [pg(1000)], DEV20);
  assert.deepEqual([s.esperado, s.saldo], [1392, 392]);
  s = S({}, [pg(1624)], DEV20);
  assert.deepEqual([s.esperado, s.pagado, s.saldo, s.completo], [1392, 1624, 0, true], 'lo pagado sobra (nota de crédito): completa, saldo 0');
  // Facturas que ya cubren la orden con retenciones (decisión 7 de facturas): se liquida con su total
  const FAC = (folio, total, vence, extra) => Object.assign({ folio: folio, ocFolio: 'OC-1', estado: 'Vigente', subtotal: 1400, descuento: 0, total: total,
    fechaVencimiento: vence }, extra || {});
  s = S({ facturas: [FAC('F1', 1484, '2026-11-01')] }, [pg(1000)]);
  assert.deepEqual([s.esperado, s.porFacturas, s.saldo, s.siguiente.vence], [1624, 1484, 484, '2026-11-01'], 'vence con la factura');
  assert.equal(S({ facturas: [FAC('F1', 1484, '2026-11-01')] }, [pg(1484)]).completo, true, 'retenciones: el total de las facturas la completa');
  assert.equal(S({ facturas: [FAC('F1', 1160, '2026-11-01', { subtotal: 1000 })] }, [pg(1160)]).completo, false, 'facturada a medias: no la completa');
  // Dos facturas: los pagos cubren primero la que vence antes
  s = S({ facturas: [FAC('F2', 824, '2026-11-05', { subtotal: 710 }), FAC('F1', 800, '2026-10-20', { subtotal: 690 })] }, [pg(800)]);
  assert.equal(s.siguiente.vence, '2026-11-05');
  assert.equal(S({ facturas: [FAC('F1', 800, '2026-10-20', { estado: 'Cancelada' })] }, [pg(100)]).siguiente.vence, '2026-11-09', 'factura cancelada no cuenta');
  // Orden ya completa (Pagada/Recibida con su pago), cancelada, otra moneda
  s = S({ estado: 'Pagada' }, [pg(1484)]);
  assert.deepEqual([s.completo, s.saldo, s.siguiente], [true, 0, null], 'el servidor ya la dio por pagada (p. ej. retenciones)');
  assert.equal(S({ estado: 'Recibida' }).completo, false, 'Recibida sin ningún pago (orden de antes): se mide');
  s = S({ estado: 'Cancelada' });
  assert.deepEqual([s.esperado, s.saldo, s.completo, s.cancelada], [0, 0, true, true]);
  assert.equal(S({ estado: 'Anulada' }).cancelada, true);
  assert.equal(S({}, [pg(1623.5, 'Vigente', { monedaPago: 'USD', monto: 87.76 })]).completo, true, 'cuenta el monto aplicado (moneda de la orden)');
  assert.equal(S({}, [pg(1000, 'Vigente', { ocFolio: 'OC-9' })]).pagado, 0, 'un pago de otra orden no cuenta');

  // Cuentas por pagar con saldos
  const O = (folio, estado, total, extra) => Object.assign({ folio: folio, estado: estado, moneda: 'MXN', total: total, subtotal: redondear(total / 1.16),
    fecha: '2026-10-01', fechaEntrega: '2026-10-10', diasCredito: 0, proyectoFolio: 'PRY-2026-0002', proveedor: 'Prov ' + folio, renglones: [], planPago: null }, extra || {});
  function redondear(n) { return Math.round(n * 100) / 100; }
  const FC = (folio, oc, total, vence) => ({ folio: folio, tipo: 'CFDI', serieFolio: folio, ocFolio: oc, proyectoFolio: 'PRY-2026-0002', moneda: 'MXN',
    subtotal: redondear(total / 1.16), descuento: 0, total: total, fechaEmision: '2026-10-01', fechaVencimiento: vence, metodoPago: 'PUE', estado: 'Vigente', nombreEmisor: 'X' });
  const PG = (oc, monto, estado) => ({ ocFolio: oc, montoAplicado: monto, estado: estado || 'Vigente' });
  const cx = plain(P.antiguedadCxp({ hoy: '2026-10-30',
    ordenes: [O('OC-A', 'Emitida', 1624), O('OC-B', 'Emitida', 1160, { planPago: [{ concepto: 'Anticipo', porcentaje: 50 }, { concepto: 'Finiquito', porcentaje: 50 }] }),
      O('OC-C', 'Pagada', 1160), O('OC-D', 'Emitida', 580), O('OC-E', 'Emitida', 1160)],
    facturas: [FC('F-A', 'OC-A', 1624, '2026-10-20'), FC('F-C', 'OC-C', 1160, '2026-10-01'), FC('F-D', 'OC-D', 580, '2026-11-15'),
      FC('F-E2', 'OC-E', 400, '2026-11-20'), FC('F-E1', 'OC-E', 400, '2026-10-25')],
    pagos: [PG('OC-A', 800), PG('OC-B', 580), PG('OC-B', 300, 'Cancelado'), PG('OC-C', 1160), PG('OC-E', 600)] }));
  assert.deepEqual(cx.abiertas.map(a => [a.folio, a.tipo, a.fechaVencimiento, a.total, a.pendiente, a.pagado, a.pagoParcial, a.rango]), [
    ['F-A', 'CFDI', '2026-10-20', 1624, 824, 800, true, 'd1a30'],
    ['F-E2', 'CFDI', '2026-11-20', 400, 200, 200, true, 'porVencer'],
    ['OC-E', 'Saldo', '2026-10-10', 360, 360, 600, true, 'd1a30'],
    ['OC-B', 'Saldo', '2026-10-10', 580, 580, 580, true, 'd1a30'],
    ['F-D', 'CFDI', '2026-11-15', 580, 580, 0, false, 'porVencer']].sort((a, b) => a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : a[0] < b[0] ? -1 : 1),
    'facturas por lo que les falta (los pagos cubren primero la que vence antes); saldos sin factura; la pagada no; la factura cubierta (F-E1) no');
  assert.equal(cx.abiertas.find(a => a.folio === 'OC-B').serieFolio, 'Finiquito', 'el saldo dice qué etapa del plan sigue');
  assert.deepEqual([cx.totales[0].facturas, cx.totales[0].saldos, cx.totales[0].total, cx.totales[0].vencido], [3, 2, 2544, 1764]);
  assert.deepEqual(cx.faltantes.filter(x => x.pagoParcial).map(x => x.folio).sort(), ['OC-B', 'OC-E'], 'faltan facturas de órdenes pagadas en parte');
  assert.deepEqual(cx.repPendientes, { n: 0, folios: [] });

  // Pendientes: compras ve el saldo y lo que sigue; quien pide ya puede confirmar (sin montos)
  const base = [{ folio: 'REQ-1', fecha: '2026-10-01', desde: '2026-10-02 10:00', proyectoFolio: 'PRY-1', proyectoVisible: 'PRY-1-CAL', proyectoNombre: 'Casa',
    solicitanteEmail: 'obrero@helgen.tech', solicitante: 'Juan', estado: 'Autorizada', motivo: '', sitio: 'Querétaro', prioridad: 'Normal', recibeEmail: '',
    oc: { folio: 'OC-1', estado: 'Emitida', proveedor: 'Ferretera', total: 1624, moneda: 'MXN', formaPago: 'Transferencia', diasCredito: 0, recibida: false,
      pagoParcial: true, pagado: 487.2, saldo: 1136.8, siguiente: { concepto: 'Contra entrega', monto: 1136.8, vence: '2026-11-09' } } }];
  const itC = plain(P.itemsPendientes(base, { yo: 'pedro@helgen.tech', roles: { compras: true }, hoy: '2026-10-30' }));
  assert.deepEqual([itC[0].tipo, itC[0].titulo, itC[0].accion], ['pagar', 'Pagada parcial, falta el saldo', 'Pagar']);
  assert(/saldo \$1,136\.80 MXN de \$1,624\.00 MXN/.test(itC[0].detalle) && /sigue: Contra entrega \$1,136\.80 MXN \(vence el 09\/11\/2026\)/.test(itC[0].detalle), itC[0].detalle);
  const itR = plain(P.itemsPendientes(base, { yo: 'obrero@helgen.tech', roles: { requisicion: true }, hoy: '2026-10-30' }));
  assert.deepEqual(itR.map(x => [x.tipo, x.titulo, x.accion]), [['recibir', 'Por recibir', 'Confirmar que llegó']], 'con un pago parcial ya se confirma');
  sinMontos(JSON.stringify(itR), 'pendiente de quien pide');
  const sinPago = JSON.parse(JSON.stringify(base)); sinPago[0].oc.pagoParcial = false;
  assert.equal(P.itemsPendientes(sinPago, { yo: 'obrero@helgen.tech', roles: { requisicion: true }, hoy: '2026-10-30' }).length, 0, 'sin pago todavía no');
  // Filas "Saldo" de cuentas por pagar en Pendientes
  const itS = plain(P.itemsPendientes([], { yo: 'pedro@helgen.tech', roles: { compras: true }, hoy: '2026-10-30',
    cxp: [{ folio: 'OC-9', tipo: 'Saldo', serieFolio: 'Finiquito', ocFolio: 'OC-9', dias: 3, fechaVencimiento: '2026-10-27', total: 580, pendiente: 580, moneda: 'MXN', proveedor: 'Prov' }] }));
  assert.deepEqual([itS[0].titulo, itS[0].detalle], ['Saldo vencido', 'Prov · Finiquito · $580.00 MXN']);

  // Correo del primer pago parcial: a quien recibe y a quien pidió; nunca montos
  const info = { folio: 'REQ-2026-0001', solicitanteEmail: 'obrero@helgen.tech', recibeEmail: 'rosa@helgen.tech', recibeNombre: 'Rosa',
    proyectoNombre: 'Casa del Lago', proyectoVisible: 'PRY-2026-0002-CDL', solicitante: 'Juan', actorCorreo: 'pedro@helgen.tech', actorNombre: 'Pedro' };
  assert.deepEqual(plain(P.destinatariosAviso('req.pagoparcial', {}, info, { compras: ['pedro@helgen.tech'] })),
    [{ quien: 'recibe', para: ['rosa@helgen.tech'] }, { quien: 'solicitante', para: ['obrero@helgen.tech'] }]);
  for (const q of ['recibe', 'solicitante']) {
    const x = P.contenidoAviso('req.pagoparcial', q, info);
    assert(/Pagada parcial, por recibir/.test(x.asunto) && /pago parcial al proveedor: el material ya se puede recibir/.test(x.que), x.que);
    sinMontos(JSON.stringify(x), 'correo ' + q);
  }
  assert(correr('EVENTOS_CORREO').includes('req.pagoparcial'));
}

// ================= 1. Flujo de siempre con plan de pagos =================
{
  // Plan no válido: no se emite la orden ni se gasta folio
  const folio = ok('obrero', 'guardarRequisicion', { proyectoFolio: P2, sitio: 'Querétaro', renglones: RENGLONES,
    cotizacion: { nombre: 'cot.pdf', datos: A.PDF }, idSolicitud: id('q') }).folio;
  falla('efrain', 'autorizarRequisicion', [folio, OCD({ planPago: [{ concepto: 'Anticipo', porcentaje: 30 }, { concepto: 'Resto', porcentaje: 60 }] })],
    /deben sumar 100% \(suman 90%\)/);
  assert.equal(props['CONSECUTIVO_OC_' + ANIO], undefined, 'no se gastó folio');
  const r = ok('efrain', 'autorizarRequisicion', folio, OCD({ planPago: PLAN }));
  const oc = r.ocFolio, s1 = { req: folio, oc: oc };
  assert.deepEqual(JSON.parse(filaOc(oc)[col('OrdenesCompra', 'plan_pago')]), PLAN, 'el plan se guarda en la orden (plan_pago)');
  const pdf = A.archivos[filaOc(oc)[23]].blob.html;
  assert(/Plan de pagos/.test(pdf) && /Anticipo 30% \(\$487\.20\) · Contra entrega 70% \(\$1,136\.80\)/.test(pdf), 'el plan va en el PDF de la orden');
  assert(/plan: Anticipo 30% · Contra entrega 70%/.test(H('Bitacora').filter(b => b[2] === 'Emitir orden de compra').slice(-1)[0][4]));
  let v = vista(s1.req);
  assert.deepEqual([v.orden.planPago, v.saldo.esperado, v.saldo.pagado, v.saldo.saldo, v.saldo.siguiente, v.pagadaParcial, v.puedePagar, v.puedeCancelarPago],
    [PLAN, 1624, 0, 1624, { concepto: 'Anticipo', monto: 487.2, vence: HOY_ISO, etapa: 1, etapas: 2 }, false, true, false]);
  let m = mia(s1.req);
  assert.deepEqual([m.estado, m.pagadaParcial, m.puedeCerrar], ['Autorizada', false, false]);
  correosNuevos();

  // Anticipo (30 %): la orden sigue Emitida y la requisición Autorizada ("Pagada parcial")
  const a1 = pagar(s1.req, 487.2);
  assert.deepEqual([a1.folio, a1.tipo, a1.completo], [PGP('0001'), 'Anticipo', false]);
  v = a1.vista;
  assert.deepEqual([v.requisicion.estado, v.orden.estado, v.pagadaParcial, v.saldo.pagado, v.saldo.saldo, v.saldo.siguiente.concepto, v.saldo.siguiente.monto,
    v.saldo.siguiente.vence, v.puedePagar, v.puedeCancelarPago, v.pagos.map(p => p.tipo)],
    ['Autorizada', 'Emitida', true, 487.2, 1136.8, 'Contra entrega', 1136.8, MANANA, true, true, ['Anticipo']]);
  assert.equal(pagosDe(s1.oc)[0][col('PagosProveedores', 'tipo')], 'Anticipo', 'columna tipo');
  assert.deepEqual(portal(s1.oc), ['oc.pagada'], 'el primer pago avisa al centro de mando');
  let cs = correosNuevos();
  assert.deepEqual(cs.map(c => [c.to, c.subject.split(' · ')[1]]), [['obrero@helgen.tech', 'Pagada parcial, por recibir']], 'req.pagoparcial a quien recibe');
  sinMontos(cs[0].subject + cs[0].body, 'correo del anticipo');
  assert(!/Pagada, por recibir/.test(cs.map(c => c.subject).join()), 'req.pagada todavía no');
  // Compras: etiqueta en la lista y como filtro
  const lista = ok('pedro', 'listarRequisiciones', '', '');
  assert.equal(lista.find(x => x.folio === s1.req).pagadaParcial, true);
  assert.deepEqual(ok('pedro', 'listarRequisiciones', '', 'Pagada parcial').map(x => x.folio), [s1.req], 'filtro "Pagada parcial"');
  // Quien pidió: "Pagada parcial", ya puede confirmar que llegó (decisión 1), nunca montos ni pagos
  m = mia(s1.req);
  assert.deepEqual([m.estado, m.pagadaParcial, m.puedeCerrar, m.eventos.slice(-1)[0].estado, m.eventos.slice(-1)[0].nota],
    ['Autorizada', true, true, 'Pagada parcial', 'Anticipo al proveedor; ya se puede recibir el material.']);
  sinMontos(JSON.stringify(m), 'mis requisiciones');
  assert(!/planPago|saldo|pagado"|PGP/.test(JSON.stringify(m)), 'ni plan ni saldo');
  const pend = ok('obrero', 'pendientes', false).items.filter(x => x.req === s1.req);
  assert.deepEqual(pend.map(x => [x.tipo, x.accion]), [['recibir', 'Confirmar que llegó']]);
  sinMontos(JSON.stringify(pend), 'pendientes de quien pide');
  const pendC = ok('pedro', 'pendientes', false).items.find(x => x.req === s1.req && x.tipo === 'pagar');
  assert(/Pagada parcial, falta el saldo/.test(pendC.titulo) && /saldo \$1,136\.80 MXN de \$1,624\.00 MXN/.test(pendC.detalle), JSON.stringify(pendC));
  // Aprobaciones/solo requisición no llaman funciones de compras
  falla('obrero', 'registrarPagoProveedor', [pago(s1.req, { monto: 100 })], /No tienes permiso de compras/, 'PERMISO');
  falla('obrero', 'cancelarPagoProveedor', [PGP('0001'), 'No me late'], /No tienes permiso de compras/, 'PERMISO');
  falla('obrero', 'getRequisicion', [s1.req], /No tienes permiso de compras/, 'PERMISO');
  falla('rosa', 'registrarPagoProveedor', [pago(s1.req, { monto: 100 })], /solo tiene acceso a Requisiciones/, 'PERMISO');

  // Segundo pago (todavía sin recibir): otro anticipo; no repite oc.pagada ni el correo
  const a2 = pagar(s1.req, 500);
  assert.deepEqual([a2.tipo, a2.completo, a2.vista.saldo.saldo, a2.vista.saldo.siguiente.monto], ['Anticipo', false, 636.8, 636.8]);
  assert.deepEqual(portal(s1.oc), ['oc.pagada'], 'los siguientes pagos no avisan');
  assert.equal(correosNuevos().length, 0, 'req.pagoparcial solo con el primero');
  // Idempotencia: el mismo envío regresa el mismo pago
  const rep = pago(s1.req, { monto: 10, idSolicitud: 'rep-1' });
  const p3 = ok('pedro', 'registrarPagoProveedor', rep);
  assert.equal(ok('pedro', 'registrarPagoProveedor', rep).folio, p3.folio, 'idempotencia');
  assert.equal(pagosDe(s1.oc).length, 3);
  ok('pedro', 'cancelarPagoProveedor', p3.folio, 'Era de prueba');
  // Tope: lo pagado no pasa del total + 1.00 (987.20 + 637.81 = 1,625.01)
  const antes = props['CONSECUTIVO_PGP_' + ANIO];
  falla('pedro', 'registrarPagoProveedor', [pago(s1.req, { monto: 637.81 })],
    /pasa el saldo de la orden: faltan \$636\.80 MXN por pagar \(total de la orden \$1,624\.00 MXN; ya se pagaron \$987\.20 MXN; tolerancia ±1\.00\)/);
  // Reglas de siempre en cada pago: comprobante, tarjeta, tipo de cambio, fecha
  falla('pedro', 'registrarPagoProveedor', [pago(s1.req, { monto: 100, comprobante: null })], /Adjunta el comprobante de pago/);
  falla('pedro', 'registrarPagoProveedor', [pago(s1.req, { monto: 100, metodo: 'Tarjeta de crédito', referencia: '4111 1111 1111 1111' })], /parece un número de tarjeta/);
  falla('pedro', 'registrarPagoProveedor', [pago(s1.req, { monto: 34.42, monedaPago: 'USD' })], /La orden es en MXN y el pago en USD: captura el tipo de cambio/);
  falla('pedro', 'registrarPagoProveedor', [pago(s1.req, { monto: 100, fecha: masDias(2) })], /no puede ser futura/);
  assert.equal(props['CONSECUTIVO_PGP_' + ANIO], antes, 'los rechazos no gastan folio');

  // Quien pidió confirma que llegó (con fotos) antes de pagar todo: Recibida, la orden sigue Emitida con su fecha de recepción
  m = ok('obrero', 'cerrarRequisicion', s1.req, 'Llegó completo', FOTOS).find(x => x.folio === s1.req);
  assert.deepEqual([m.estado, m.pagadaParcial, filaOc(s1.oc)[28], filaOc(s1.oc)[29]], ['Recibida', true, 'Emitida', HOY_ISO]);
  assert(/falta el resto del pago al proveedor/.test(m.eventos.slice(-1)[0].nota));
  v = vista(s1.req);
  assert.deepEqual([v.puedePagar, v.puedeCerrar, v.puedeCancelarPago, v.saldo.siguiente.vence], [true, false, true, HOY_ISO], 'recibido: vence desde la recepción');
  correosNuevos();
  // Liquidación en dólares con tipo de cambio: 34.42 × 18.5 = 636.77 (dentro de ±1.00): cierra la requisición
  const a4 = pagar(s1.req, 34.42, { monedaPago: 'USD', tipoCambio: 18.5 });
  assert.deepEqual([a4.tipo, a4.completo, a4.vista.requisicion.estado, a4.vista.orden.estado, a4.vista.saldo.completo, a4.vista.saldo.saldo, a4.vista.pagadaParcial,
    a4.vista.puedePagar, a4.vista.puedeCancelarPago], ['Liquidación', true, 'Cerrada', 'Recibida', true, 0, false, false, false]);
  assert.deepEqual(pagosDe(s1.oc).map(x => [x[col('PagosProveedores', 'tipo')], x[17]]),
    [['Anticipo', 'Vigente'], ['Anticipo', 'Vigente'], ['Anticipo', 'Cancelado'], ['Liquidación', 'Vigente']]);
  assert.equal(a4.vista.eventos.slice(-1)[0].nota, 'Liquidación al proveedor. Pagada; el material ya estaba recibido.');
  assert.equal(correosNuevos().filter(c => /Pagada/.test(c.subject)).length, 0, 'ya estaba recibida: no hay correo de "por recibir"');
  falla('pedro', 'registrarPagoProveedor', [pago(s1.req, { monto: 1 })], /está cerrada: no se puede pagar/);
  falla('pedro', 'cancelarPagoProveedor', [PGP('0001'), 'Me equivoqué'], /ya está cerrada \(material recibido\): el pago no se puede cancelar/);
  assert(/Liquidación · \$34\.42 USD · TC 18\.5 = \$636\.77 MXN · Transferencia · pagado \$1,623\.97 de \$1,624\.00 MXN/
    .test(H('Bitacora').filter(b => b[2] === 'Registrar pago a proveedor').slice(-1)[0][4]), 'bitácora con tipo y lo pagado');
}

// ================= 2. Combinaciones de cancelar, devoluciones, recepciones, anular y crédito =================
{
  // 2a. Cancelar el único pago de una orden ya recibida: sigue Recibida (falta todo el pago); el pago completo la cierra
  const a = siempre();
  const pa = pagar(a.req, 500);
  ok('obrero', 'cerrarRequisicion', a.req, '', FOTOS);
  let v = ok('pedro', 'cancelarPagoProveedor', pa.folio, 'Se registró en la orden equivocada');
  assert.deepEqual([v.requisicion.estado, v.orden.estado, v.orden.fechaRecepcion, v.pagadaParcial, v.saldo.saldo, v.puedePagar, v.puedeCancelarPago],
    ['Recibida', 'Emitida', HOY_ISO, false, 1624, true, false]);
  assert.equal(v.eventos.slice(-1)[0].nota, 'Se canceló el pago.');
  assert.equal(mia(a.req).pagadaParcial, false);
  assert.equal(pagar(a.req, 1624).vista.requisicion.estado, 'Cerrada');

  // 2b. Cancelar un pago de en medio de una orden ya pagada: vuelve a Emitida y la requisición a Autorizada; se vuelve a completar
  const b = siempre();
  correosNuevos();
  const b1 = pagar(b.req, 400), b2 = pagar(b.req, 400), b3 = pagar(b.req, 824);
  assert.deepEqual([b1.tipo, b2.tipo, b3.tipo, b3.vista.requisicion.estado, b3.vista.orden.estado], ['Anticipo', 'Anticipo', 'Liquidación', 'Pagada', 'Pagada']);
  assert.deepEqual(correosNuevos().map(c => c.subject.split(' · ')[1]), ['Pagada parcial, por recibir', 'Pagada, por recibir'], 'un aviso al primero y uno al completar');
  assert.deepEqual(mia(b.req).eventos.slice(-1)[0].estado, 'Pagada');
  v = ok('pedro', 'cancelarPagoProveedor', b2.folio, 'Transferencia rebotada por el banco');
  assert.deepEqual([v.requisicion.estado, v.orden.estado, v.saldo.pagado, v.saldo.saldo, v.pagadaParcial, v.puedePagar],
    ['Autorizada', 'Emitida', 1224, 400, true, true]);
  assert.deepEqual([v.eventos.slice(-1)[0].estado, v.eventos.slice(-1)[0].nota], ['Pagada parcial', 'Se canceló un pago; la orden queda pagada en parte.']);
  sinMontos(JSON.stringify(mia(b.req).eventos), 'historial');
  assert(/vuelve a Emitida/.test(H('Bitacora').filter(x => x[2] === 'Cancelar pago a proveedor').slice(-1)[0][4]));
  v = ok('pedro', 'cancelarPagoProveedor', b3.folio, 'También rebotó la liquidación');
  assert.deepEqual([v.requisicion.estado, v.orden.estado, v.saldo.saldo], ['Autorizada', 'Emitida', 1224]);
  assert.equal(pagar(b.req, 1224).vista.requisicion.estado, 'Pagada');
  assert.deepEqual(portal(b.oc), ['oc.pagada'], 'nunca se quedó sin pagos Vigentes: un solo oc.pagada');
  // 2c. El único pago (completo) de una orden no recibida: Pagada → Autorizada; pagar otra vez vuelve a avisar oc.pagada
  const c = siempre();
  const c1 = pagar(c.req, 1624);
  v = ok('pedro', 'cancelarPagoProveedor', c1.folio, 'Se pagó a otra cuenta');
  assert.deepEqual([v.requisicion.estado, v.orden.estado, v.pagadaParcial, mia(c.req).puedeCerrar], ['Autorizada', 'Emitida', false, false]);
  pagar(c.req, 1624);
  assert.deepEqual(portal(c.oc), ['oc.pagada', 'oc.pagada'], 'como hoy: al volver a pagar, otro oc.pagada');

  // 2d. Pago cancelado después de una devolución: lo esperado es la orden menos lo devuelto sin reponer
  const d = siempre();
  const d1 = pagar(d.req, 812);
  ok('obrero', 'cerrarRequisicion', d.req, '', { renglones: [{ renglon: 1, foto: F, problema: { tipo: 'Dañado', cantidad: 40, comentario: 'Rollo mojado', foto: F } },
    { renglon: 2, foto: F }] });
  assert.equal(mia(d.req).estado, 'Recibida');
  let rs = ok('pedro', 'resolverDevolucion', ultimaDev(), { resolucion: 'Devolver al proveedor', nota: 'Nota de crédito del proveedor' });
  // (40 × 10 + 12 × 50) × 1.16 = 1,160; pagado 812 → saldo 348
  v = vista(d.req);
  assert.deepEqual([rs.estado, v.saldo.esperado, v.saldo.saldo, v.porPagar.total, v.requisicion.estado, v.orden.estado], ['Recibida', 1160, 348, 1160, 'Recibida', 'Emitida']);
  falla('pedro', 'registrarPagoProveedor', [pago(d.req, { monto: 349.01 })],
    /faltan \$348\.00 MXN por pagar \(total por pagar \$1,160\.00 MXN: la orden de \$1,624\.00 menos \$464\.00 de material devuelto sin reponer; ya se pagaron \$812\.00 MXN/);
  v = ok('pedro', 'cancelarPagoProveedor', d1.folio, 'Se canceló el anticipo');
  assert.deepEqual([v.requisicion.estado, v.orden.estado, v.saldo.saldo], ['Recibida', 'Emitida', 1160]);
  const dl = pagar(d.req, 1160);
  assert.deepEqual([dl.tipo, dl.vista.requisicion.estado, dl.vista.orden.estado], ['Liquidación', 'Cerrada', 'Recibida']);

  // 2e. La devolución deja lo ya pagado como completo: la orden queda pagada y la requisición se cierra sola
  const e = siempre();
  pagar(e.req, 1160);
  ok('obrero', 'cerrarRequisicion', e.req, '', { renglones: [{ renglon: 1, foto: F, problema: { tipo: 'Incorrecto', cantidad: 40, comentario: 'Otro calibre', foto: F } },
    { renglon: 2, foto: F }] });
  rs = ok('pedro', 'resolverDevolucion', ultimaDev(), { resolucion: 'Cancelar renglón', nota: 'Ya no se ocupa' });
  assert.deepEqual([rs.estado, rs.vista.requisicion.estado, rs.vista.orden.estado, rs.vista.saldo.completo], ['Cerrada', 'Cerrada', 'Recibida', true]);
  assert(/con la devolución DEV-\d{4}-\d{4}, lo que ya se pagó cubre la orden/.test(rs.vista.eventos.slice(-1)[0].nota), rs.vista.eventos.slice(-1)[0].nota);
  assert(H('Bitacora').some(x => x[2] === 'Orden pagada por devolución' && x[4].indexOf(e.req) !== -1));

  // 2f. Retenida por una devolución abierta (Recibida con la orden Pagada): el pago se cancela; se vuelve a pagar en partes
  const f = siempre();
  const f1 = pagar(f.req, 1624);
  ok('obrero', 'cerrarRequisicion', f.req, '', { renglones: [{ renglon: 1, foto: F }, { renglon: 2, foto: F, problema: { tipo: 'Dañado', cantidad: 2, comentario: 'Golpeado', foto: F } }] });
  const devF = ultimaDev();
  assert.deepEqual([mia(f.req).estado, filaOc(f.oc)[28]], ['Recibida', 'Pagada'], 'retenida');
  v = ok('pedro', 'cancelarPagoProveedor', f1.folio, 'El banco devolvió la transferencia');
  assert.deepEqual([v.requisicion.estado, v.orden.estado, v.puedePagar], ['Recibida', 'Emitida', true]);
  let pf = pagar(f.req, 1000);
  assert.deepEqual([pf.tipo, pf.vista.requisicion.estado, pf.vista.orden.estado, pf.vista.pagadaParcial], ['Parcial', 'Recibida', 'Emitida', true], 'ya recibido: Parcial');
  pf = pagar(f.req, 624);
  assert.deepEqual([pf.tipo, pf.vista.requisicion.estado, pf.vista.orden.estado], ['Liquidación', 'Recibida', 'Pagada'], 'con la devolución abierta sigue retenida');
  rs = ok('pedro', 'resolverDevolucion', devF, { resolucion: 'Conservar', nota: 'Se usa así' });
  assert.deepEqual([rs.estado, rs.vista.orden.estado], ['Cerrada', 'Recibida']);

  // 2g. cancelarRecepcion con un pago parcial: la requisición vuelve a Autorizada (orden Emitida) y quien pidió puede confirmar otra vez
  ok('leo', 'guardarUsuario', { nuevo: true, correo: 'tania@helgen.tech', nombre: 'Tania', roles: ['aprobaciones'] }); // con aprobaciones…
  const g = (() => { // …se recibe por renglón (y compras cancela una recepción); luego se apaga
    const folio = ok('obrero', 'guardarRequisicion', { proyectoFolio: P2, sitio: 'Querétaro', renglones: RENGLONES, idSolicitud: id('q') }).folio;
    const w = ok('tania', 'getRequisicionOperaciones', folio);
    ok('tania', 'aprobarRequisicion', folio, { version: w.version, prioridad: 'Normal', renglones: w.renglones.map(x => ({ renglon: x.renglon, aprobado: true })) });
    ok('pedro', 'cotizarRequisicion', folio, { proveedor: { razonSocial: 'Ferretera del Puerto' }, fechaEntrega: MANANA, condicionesPago: 'Contado', diasCredito: 0,
      formaPago: 'Transferencia', recibe: 'rosa@helgen.tech', idSolicitud: id('p'), planPago: PLAN,
      renglones: [{ renglon: 1, disponibilidad: 'Exacto', costo: 10 }, { renglon: 2, disponibilidad: 'Exacto', costo: 50 }] });
    const w2 = ok('tania', 'getRequisicionOperaciones', folio);
    assert.deepEqual(w2.propuesta.planPago, PLAN, 'aprobaciones ve el plan de la propuesta');
    return { req: folio, oc: ok('tania', 'autorizarPropuesta', folio, w2.propuesta.version, id('vb'), w2.propuesta.huella).ocFolio };
  })();
  assert.deepEqual(JSON.parse(filaOc(g.oc)[col('OrdenesCompra', 'plan_pago')]), PLAN, 'el plan de la propuesta pasa a la orden');
  guardado.g = g;
  correosNuevos();
  pagar(g.req, 487.2);
  assert.equal(correosNuevos().filter(x => /Pagada parcial/.test(x.subject)).length, 0, 'con aprobaciones no hay req.pagoparcial (ya se le avisó al autorizar)');
  let wo = ok('tania', 'getRequisicionOperaciones', g.req);
  assert.deepEqual([wo.orden.planPago, wo.orden.pagadaParcial, 'pagos' in wo, 'saldo' in wo], [PLAN, true, false, false], 'aprobaciones: plan y etiqueta, sin pagos');
  let rr = ok('rosa', 'registrarRecepcion', { reqFolio: g.req, sitio: 'Querétaro', renglones: A.conFotos([{ renglon: 1, cantidad: 80 }, { renglon: 2, cantidad: 12 }]), idSolicitud: id('r') });
  assert.deepEqual([rr.estado, filaOc(g.oc)[28]], ['Recibida', 'Emitida'], 'completa sin terminar de pagar: Recibida');
  const rec = H('MovimientosInventario').filter(x => x[7] === g.oc)[0][0];
  v = ok('pedro', 'cancelarRecepcion', rec, 'Se registró en el sitio equivocado');
  assert.deepEqual([v.requisicion.estado, v.orden.estado, v.orden.fechaRecepcion, v.pagadaParcial, v.saldo.saldo], ['Autorizada', 'Emitida', '', true, 1136.8]);
  rr = ok('rosa', 'registrarRecepcion', { reqFolio: g.req, sitio: 'Querétaro', renglones: A.conFotos([{ renglon: 1, cantidad: 80 }, { renglon: 2, cantidad: 12 }]), idSolicitud: id('r') });
  const gl = pagar(g.req, 1136.8);
  assert.deepEqual([gl.tipo, gl.vista.requisicion.estado, gl.vista.orden.estado], ['Liquidación', 'Cerrada', 'Recibida']);
  ok('leo', 'guardarUsuario', { correo: 'tania@helgen.tech', nombre: 'Tania', roles: ['ventas'] }); // flujo de siempre otra vez

  // 2h. Una orden Emitida con pagos parciales no se cancela; sin ellos, sí
  const h = siempre();
  const h1 = pagar(h.req, 300);
  falla('pedro', 'cancelarOrdenCompra', [h.oc, 'Ya no se necesita'], /tiene pagos registrados \(PGP-\d{4}-\d{4}\): cancélalos primero/);
  ok('pedro', 'cancelarPagoProveedor', h1.folio, 'Se cancela la compra');
  ok('pedro', 'cancelarOrdenCompra', h.oc, 'Ya no se necesita');
  assert.equal(filaOc(h.oc)[28], 'Cancelada');

  // 2i. Anular (super admin) un pago de en medio, un pago parcial y una orden con varios pagos
  const i = siempre();
  const i1 = pagar(i.req, 600), i2 = pagar(i.req, 1024);
  let prev = ok('leo', 'previsualizarAnulacion', i1.folio);
  assert(/pasa de Pagada a Emitida/.test(prev.efectos[0]) && /pasa de Pagada a Autorizada/.test(prev.efectos[0]) && /queda pagada en parte \(saldo \$600\.00 MXN\)/.test(prev.efectos[0]),
    prev.efectos[0]);
  ok('leo', 'anular', i1.folio, 'Pago duplicado por error de captura', id('a'));
  v = vista(i.req);
  assert.deepEqual([v.requisicion.estado, v.orden.estado, v.saldo.pagado, v.saldo.saldo, v.pagos.map(x => x.folio)], ['Autorizada', 'Emitida', 1024, 600, [i2.folio]]);
  const i3 = pagar(i.req, 100);
  prev = ok('leo', 'previsualizarAnulacion', i3.folio);
  assert(/sigue Emitida/.test(prev.efectos[0]) && /queda pagada en parte \(saldo \$600\.00 MXN\)/.test(prev.efectos[0]), prev.efectos[0]);
  ok('leo', 'anular', i3.folio, 'Pago capturado dos veces por error', id('a'));
  assert.deepEqual([vista(i.req).requisicion.estado, vista(i.req).saldo.saldo], ['Autorizada', 600]);
  const j = siempre();
  const j1 = pagar(j.req, 1000), j2 = pagar(j.req, 624);
  prev = ok('leo', 'previsualizarAnulacion', j.oc);
  assert.deepEqual(prev.registros.map(x => x.folio), [j.oc, j1.folio, j2.folio], 'la orden arrastra todos sus pagos');
  ok('leo', 'anular', j.oc, 'Orden emitida al proveedor equivocado', id('a'));
  assert.deepEqual([filaOc(j.oc)[28], pagosDe(j.oc).map(x => x[17]), mia(j.req).estado], ['Anulada', ['Anulada', 'Anulada'], 'Solicitada']);
  // Anular un pago que deja la orden cubierta por los demás (lo pagado sobra tras una devolución): nada cambia
  const k = siempre();
  const k1 = pagar(k.req, 812), k2 = pagar(k.req, 812);
  ok('obrero', 'cerrarRequisicion', k.req, '', { renglones: [{ renglon: 1, foto: F, problema: { tipo: 'Dañado', cantidad: 80, comentario: 'Todo mojado', foto: F } },
    { renglon: 2, foto: F }] });
  ok('pedro', 'resolverDevolucion', ultimaDev(), { resolucion: 'Devolver al proveedor', nota: 'Nos devuelven el dinero' });
  // esperado (12 × 50) × 1.16 = 696; pagado 1,624
  v = vista(k.req);
  assert.deepEqual([v.requisicion.estado, v.orden.estado, v.saldo.esperado, v.saldo.completo], ['Cerrada', 'Recibida', 696, true]);
  prev = ok('leo', 'previsualizarAnulacion', k1.folio);
  assert(/sigue Recibida/.test(prev.efectos[0]) && /los demás pagos la siguen cubriendo/.test(prev.efectos[0]), prev.efectos[0]);
  ok('leo', 'anular', k1.folio, 'Se pagó de más: se anula uno', id('a'));
  assert.deepEqual([vista(k.req).requisicion.estado, filaOc(k.oc)[28], vista(k.req).saldo.pagado], ['Cerrada', 'Recibida', 812]);

  // 2j. Crédito del proveedor + pagos parciales: se recibe antes de pagar; el anticipo no manda req.pagoparcial; el último cierra
  const CRED = { formaPago: 'Crédito del proveedor', diasCredito: 30, condicionesPago: 'Crédito 30 días' };
  const l = siempre(CRED);
  correosNuevos();
  const l1 = pagar(l.req, 500);
  assert.deepEqual([l1.tipo, l1.vista.recibeAntesPor, mia(l.req).puedeCerrar], ['Anticipo', 'credito', true]);
  assert.equal(correosNuevos().filter(x => /Pagada parcial/.test(x.subject)).length, 0, 'con crédito ya podía recibir: sin aviso');
  ok('obrero', 'cerrarRequisicion', l.req, '', FOTOS);
  const l2 = pagar(l.req, 1124);
  assert.deepEqual([l2.tipo, l2.vista.requisicion.estado], ['Liquidación', 'Cerrada']);
  // Sin crédito, con un pago parcial: "Registrar que llegó" de compras dice que es por el pago parcial
  const n = siempre();
  pagar(n.req, 100);
  v = vista(n.req);
  assert.deepEqual([v.recibeAntesDePagar, v.recibeAntesPor, v.puedeCerrar], [true, 'parcial', true]);
  v = ok('pedro', 'cerrarRequisicionCompras', n.req, 'El trabajador ya no está en la obra', '');
  assert.deepEqual([v.requisicion.estado, v.orden.estado], ['Recibida', 'Emitida']);
  assert(H('Bitacora').some(x => x[2] === 'Recibir antes de pagar todo (pago parcial)' && x[4].indexOf(n.req) === 0));

  // 2k. Documentos para transferir: se revisan en cada pago (solo transferencia); el super admin con motivo
  P.exigirDocumentosParaPagar_ = exigirDocsOriginal;
  const t = siempre();
  falla('pedro', 'registrarPagoProveedor', [pago(t.req, { monto: 300 })], /no se registra un pago por transferencia/, 'PERMISO');
  const t1 = pagar(t.req, 300, { metodo: 'Efectivo', referencia: '' });
  assert.equal(t1.tipo, 'Anticipo');
  falla('pedro', 'registrarPagoProveedor', [pago(t.req, { monto: 1324 })], /no se registra un pago por transferencia/, 'PERMISO');
  const t2 = ok('leo', 'registrarPagoProveedor', pago(t.req, { monto: 1324 }), 'Proveedor urgente; documentos en trámite');
  assert.equal(t2.vista.requisicion.estado, 'Pagada');
  P.exigirDocumentosParaPagar_ = function () {};
}

// ================= 3. Cuentas por pagar con saldos (servidor) =================
{
  const x = siempre({ planPago: [{ concepto: 'Anticipo', porcentaje: 50 }, { concepto: 'Finiquito', porcentaje: 50 }], diasCredito: 15, condicionesPago: 'Crédito 15 días' });
  const y = siempre();
  // Factura extranjera (el proveedor no tiene RFC) por toda la orden y
  ok('pedro', 'registrarFacturaProveedor', { ocFolio: y.oc, tipo: 'Extranjera', numero: 'INV-77', fecha: HOY_ISO, moneda: 'MXN', subtotal: 1400, impuestos: 224,
    pdf: { nombre: 'inv.pdf', datos: A.PDF }, idSolicitud: id('f') });
  pagar(x.req, 812); pagar(y.req, 600);
  const cx = ok('pedro', 'cuentasPorPagar');
  const ax = cx.abiertas.find(a => a.ocFolio === x.oc), ay = cx.abiertas.find(a => a.ocFolio === y.oc);
  assert.deepEqual([ax.tipo, ax.folio, ax.serieFolio, ax.pendiente, ax.fechaVencimiento, ax.reqFolio, ax.proyectoVisible.indexOf(P2)],
    ['Saldo', x.oc, 'Finiquito', 812, masDias(16), x.req, 0], 'saldo sin factura: vence con lo que sigue del plan (entrega + 15 días)');
  assert.deepEqual([ay.tipo, ay.total, ay.pendiente, ay.pagado, ay.pagoParcial, ay.reqFolio], ['Extranjera', 1624, 1024, 600, true, y.req], 'factura por lo que le falta');
  const pend = ok('pedro', 'pendientes', false).items.filter(it => it.req === x.req || it.req === y.req);
  assert(pend.some(it => it.tipo === 'pagar' && /saldo \$812\.00 MXN/.test(it.detalle)), JSON.stringify(pend));
  pagar(y.req, 1024);
  assert(!ok('pedro', 'cuentasPorPagar').abiertas.some(a => a.ocFolio === y.oc), 'pagada: sale de cuentas por pagar');
  // Órdenes por proyecto: lo pagado y el saldo
  const oc = ok('pedro', 'getComprasProyecto', P2).ordenes.find(o => o.folio === x.oc);
  assert.deepEqual([oc.pagado, oc.saldo, oc.pagadaParcial, oc.siguiente.concepto, oc.planPago.length], [812, 812, true, 'Finiquito', 2]);
  guardado.x = x;
}

// ================= 5. Interfaz (DOM simulado conectado al servidor simulado) =================
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(dir, 'web/cotizador/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?: id="([^"]*)")?>([\s\S]*?)<\/script>/g)].map(m => ({ id: m[1], src: m[2] }));
function montar(quien, permisos) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = 'h.' + b64({ email: quien + '@helgen.tech', given_name: quien, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.f';
  function elemento(tag) {
    const e = { tag, value: '', textContent: '', className: '', title: '', src: '', placeholder: '', disabled: false, hijos: [], oyentes: {}, _clases: new Set(), porClase: {},
      classList: { add: c => e._clases.add(c), remove: c => e._clases.delete(c), contains: c => e._clases.has(c), toggle: (c, f) => f ? e._clases.add(c) : e._clases.delete(c) },
      addEventListener: (t, f) => (e.oyentes[t] = e.oyentes[t] || []).push(f), disparar: t => (e.oyentes[t] || []).forEach(f => f({ target: e })),
      focus() {}, remove() {}, click() {}, insertAdjacentHTML(pos, x) { e.innerHTML += x; }, appendChild: h => e.hijos.push(h), prepend: h => e.hijos.unshift(h), contains: () => false,
      querySelector: sel => e.porClase[sel] || (e.porClase[sel] = elemento('input')), querySelectorAll: sel => sel === 'tr' ? e.hijos : [] };
    let h = ''; Object.defineProperty(e, 'innerHTML', { get: () => h, set: v => { h = v; if (v === '') e.hijos.length = 0; } });
    return e;
  }
  const porId = {}, oyentesDoc = {};
  const document = { getElementById: id => porId[id] || (porId[id] = elemento('div')), querySelector: () => ({ src: 'data:logo' }), createElement: t => elemento(t),
    visibilityState: 'visible', activeElement: null, body: elemento('body'),
    addEventListener: (t, f) => (oyentesDoc[t] = oyentesDoc[t] || []).push(f), dispatchEvent: ev => (oyentesDoc[ev.type] || []).forEach(f => f(ev)) };
  document.getElementById('login').classList.add('oculto');
  const almacen = { cotizadorHelgenSesion: token }, llamadas = [];
  async function fetch(url, o) {
    const c = JSON.parse(o.body); llamadas.push(c);
    const datos = c.funcion === 'sincronizar' ? { ok: true, datos: { versiones: {}, permisos: permisos, soloRequisicion: false, cambios: [] } } : A.post(quien, c.funcion, ...c.args);
    return { ok: true, json: async () => datos };
  }
  class FileReader { readAsDataURL(f) { this.result = 'data:' + f.type + ';base64,' + f.b64; setImmediate(() => this.onload()); } }
  const dialogos = { confirmar: true, prompt: null };
  const ctx = { document, fetch, console, JSON, Date, Math, Number, String, Array, Object, Promise, Proxy, Error, Uint8Array, TextDecoder, FileReader,
    atob: s => Buffer.from(s, 'base64').toString('binary'), crypto: { randomUUID: () => 'id-' + Math.random() },
    sessionStorage: { getItem: k => almacen[k] ?? null, setItem: (k, v) => almacen[k] = v, removeItem: k => delete almacen[k] },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, confirm: () => dialogos.confirmar, prompt: () => dialogos.prompt,
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout, clearTimeout, setInterval: () => 0, scrollTo() {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['api-web', undefined, 'mod-proveedores', 'mod-recepcion'].forEach(n => vm.runInContext(scripts.find(x => x.id === n).src, ctx));
  return { ctx, $: id => document.getElementById(id), llamadas, dialogos, run: c => vm.runInContext(c, ctx) };
}
const esperar = async (k = 25) => { for (let i = 0; i < k; i++) await new Promise(r => setImmediate(r)); };
const comprobante = n => ({ name: n || 'spei.pdf', type: 'application/pdf', size: 2048, b64: A.PDF });
(async () => {
  const C = montar('pedro', { compras: true, requisicion: true, ventas: true, superadmin: false });
  await esperar();
  const { $ } = C;
  // ---- Autorizar con plan de pagos: atajo 30/70, suma revisada antes de mandar, el plan va al servidor ----
  const nueva = ok('obrero', 'guardarRequisicion', { proyectoFolio: P2, sitio: 'Querétaro', renglones: RENGLONES,
    cotizacion: { nombre: 'cot.pdf', datos: A.PDF }, idSolicitud: id('q') }).folio;
  C.run('abrirReqCom(' + JSON.stringify(nueva) + ')');
  await esperar();
  assert(!$('comModOc').classList.contains('oculto') && /Sin plan: se paga en uno o varios pagos/.test($('ocPlanSuma').innerHTML), 'el plan es opcional');
  assert($('btnPlanQuitar').classList.contains('oculto'));
  $('prvRazon').value = 'Ferretera del Puerto'; $('ocEntrega').value = MANANA; $('ocDias').value = '0'; $('ocFormaPago').value = 'Transferencia';
  $('ocCondiciones').value = 'Contado';
  const filasOc = $('ocFilas').hijos;
  filasOc[0].querySelector('.costo').value = '10'; filasOc[1].querySelector('.costo').value = '50';
  C.run('recalcularOc()');
  C.run('planRapido(30)');
  const etapas = $('ocPlanFilas').hijos;
  assert.deepEqual(etapas.map(t => [t.querySelector('.plan-concepto').value, t.querySelector('.plan-pct').value, t.querySelector('.plan-monto').textContent]),
    [['Anticipo', 30, '$487.20 MXN'], ['Contra entrega', 70, '$1,136.80 MXN']], 'montos de cada etapa sobre el total de la vista previa');
  assert(/✓ Suman 100%/.test($('ocPlanSuma').innerHTML) && !$('btnPlanQuitar').classList.contains('oculto'));
  etapas[1].querySelector('.plan-pct').value = '60'; C.run('pintarPlanOc()');
  assert(/Suman 90% \(deben sumar 100%\)/.test($('ocPlanSuma').innerHTML));
  C.run('guardarOc()'); await esperar();
  assert(/deben sumar 100% \(suman 90%\)/.test($('aviso').innerHTML) && !C.llamadas.some(c => c.funcion === 'autorizarRequisicion'), 'no se manda un plan que no suma 100');
  etapas[1].querySelector('.plan-pct').value = '70';
  C.run('guardarOc()'); await esperar();
  const au = C.llamadas.find(c => c.funcion === 'autorizarRequisicion');
  assert.deepEqual(au.args[1].planPago, PLAN, 'el plan va en la orden');
  const ocNueva = au && ok('pedro', 'getRequisicion', nueva).orden.folio;
  assert.deepEqual(JSON.parse(filaOc(ocNueva)[col('OrdenesCompra', 'plan_pago')]), PLAN);
  // ---- Pago: esperado, pagado, saldo y lo que sigue; el monto se precarga con el anticipo ----
  assert(!$('rcFormPago').classList.contains('oculto'));
  let ps = $('ppSaldo').innerHTML;
  assert(/Esperado/.test(ps) && /\$1,624\.00 MXN/.test(ps) && /Sigue: Anticipo/.test(ps) && /\$487\.20 MXN/.test(ps) && /vence el/.test(ps) &&
    /Plan: Anticipo 30% \(\$487\.20 MXN\) · Contra entrega 70%/.test(ps) && /montoPago\(1624\)/.test(ps), ps);
  assert.equal($('ppMonto').value, 487.2, 'lo que sigue del plan');
  assert(/Plan: Anticipo 30% · Contra entrega 70%/.test($('rcOrden').innerHTML), 'la orden muestra su plan');
  assert(/Se puede pagar en partes/.test($('ppNota').textContent) && /\$1,624\.00 MXN, ±1\.00/.test($('ppNota').textContent), $('ppNota').textContent);
  $('ppRef').value = 'SPEI 1'; $('ppArchivo').files = [comprobante()];
  const id1 = C.run('ID_PGP');
  C.run('registrarPagoProv()'); await esperar();
  const r1 = C.llamadas.filter(c => c.funcion === 'registrarPagoProveedor');
  assert.deepEqual([r1.length, r1[0].args[0].monto, r1[0].args[0].idSolicitud], [1, 487.2, id1]);
  assert(/\(anticipo\) registrado · queda un saldo de <b>\$1,136\.80 MXN<\/b>/.test($('aviso').innerHTML), $('aviso').innerHTML);
  assert(/Pagada parcial/.test($('rcOrden').innerHTML) && /saldo <b>\$1,136\.80 MXN<\/b>/.test($('rcOrden').innerHTML));
  assert(/chip aceptada">Anticipo/.test($('rcPagos').innerHTML) && /cancelarPagoProv/.test($('rcPagos').innerHTML));
  assert(/Pagado <b>\$487\.20 MXN<\/b> de \$1,624\.00 MXN · saldo <b>\$1,136\.80 MXN<\/b>/.test($('rcSaldoResumen').innerHTML));
  assert.deepEqual([$('ppMonto').value, $('ppRef').value, $('ppArchivo').value, C.run('ID_PGP') !== id1], [1136.8, '', '', true],
    'queda abierto para el siguiente pago, con otro idSolicitud');
  assert(!/cancelarOcDesdeReq/.test($('rcOrden').innerHTML), 'con pagos la orden no se cancela desde aquí');
  // Segundo pago desde el mismo formulario: es otro pago (no lo absorbe la idempotencia)
  $('ppMonto').value = '500'; $('ppRef').value = 'SPEI 2'; $('ppArchivo').files = [comprobante('spei2.pdf')];
  C.run('registrarPagoProv()'); await esperar();
  assert.equal(pagosDe(ocNueva).filter(r => r[17] === 'Vigente').length, 2, 'dos pagos en la hoja');
  ps = $('ppSaldo').innerHTML;
  assert(/Sigue: Contra entrega/.test(ps) && /\$636\.80 MXN/.test(ps) && /2 pagos/.test(ps), ps);
  C.run('montoPago(636.8)'); assert.equal($('ppMonto').value, 636.8);
  // Cancelar un pago (motivo obligatorio): se recalcula el saldo
  const pg2 = pagosDe(ocNueva)[1][0];
  C.dialogos.prompt = 'Transferencia rebotada';
  C.run('cancelarPagoProv(' + JSON.stringify(pg2) + ')'); await esperar();
  assert.deepEqual(C.llamadas.find(c => c.funcion === 'cancelarPagoProveedor').args, [pg2, 'Transferencia rebotada']);
  assert(/fila-cancelada/.test($('rcPagos').innerHTML) && $('ppMonto').value === 1136.8, 'saldo de nuevo: 1,136.80');
  // ---- Lista de compras (etiqueta), órdenes por proyecto (pagado y saldo; sin cancelar) y cuentas por pagar (saldo sin factura) ----
  C.run('pintarListaReqCom(' + JSON.stringify(ok('pedro', 'listarRequisiciones', '', '')) + ')');
  assert(new RegExp(nueva + '[\\s\\S]*?Pagada parcial').test($('rcLista').innerHTML), 'chip en la lista');
  C.run("abrirProyectoCom('" + P2 + "')"); await esperar();
  const li = $('ocLista').innerHTML, filaNueva = li.split('<tr').find(t => t.indexOf(ocNueva) !== -1);
  assert(/Pagado \$487\.20 MXN · saldo \$1,136\.80 MXN/.test(filaNueva) && /Pagada parcial/.test(filaNueva) && !/cancelarOc\(/.test(filaNueva), filaNueva);
  C.run('cargarCxp()'); await esperar(); C.run('verCxp()');
  const cl = $('cxpLista').innerHTML;
  assert(/<b>Saldo<\/b><div class="nota">Contra entrega · sin factura/.test(cl) && /<b>Saldo<\/b><div class="nota">Finiquito · sin factura/.test(cl), cl);
  assert(/saldos? sin factura/.test($('cxpTotales').innerHTML));
  const csv = C.run('csvCxp(filtrarCxp())');
  assert(/"Total","Pagado","Por pagar"/.test(csv) && /,1136\.80/.test(csv), csv);
  // ---- Aprobaciones: el plan en la propuesta y en la orden ----
  C.run('pintarOps(' + JSON.stringify(ok('leo', 'getRequisicionOperaciones', guardado.g.req)) + ')');
  assert(/Plan: Anticipo 30% \(\$487\.20 MXN\) · Contra entrega 70% \(\$1,136\.80 MXN\)/.test($('opsPropInfo').innerHTML), $('opsPropInfo').innerHTML);
  assert(/Plan: Anticipo 30% · Contra entrega 70%/.test($('opsOrden').innerHTML));
  // ---- Quien pidió: "Pagada parcial" sin montos y ya puede confirmar que llegó ----
  const U = montar('obrero', { compras: false, requisicion: true, ventas: true, superadmin: false });
  await esperar();
  U.run('pintarMisReq(' + JSON.stringify(ok('obrero', 'misRequisiciones')) + ')');
  const tarjeta = U.$('reqLista').innerHTML.split('class="sat"').find(t => t.indexOf(nueva) !== -1);
  assert(/Pagada parcial/.test(tarjeta) && /recibiMaterial/.test(tarjeta), tarjeta);
  assert(!/\$|487|1,136|PGP-|OC-|Ferretera/.test(tarjeta), 'sin montos, pagos, orden ni proveedor');
  console.log('OK pagos');
})().catch(e => { console.error(e); process.exit(1); });
