// Incremento 6 · módulo R (reportes de CxC y CxP): fecha esperada por etapa de cobranza, antigüedad de cuentas por cobrar y por
// pagar, flujo de 13 semanas y margen por proyecto. Contrato: docs/incremento-6.md §1 y §3; detalle: docs/incremento-6-reportes.md.
//  1. Lógica pura: fechas, rangos, partidas por cobrar (cobros parciales, excedente que pasa a la siguiente etapa, proyecto USD
//     pagado en MXN, sin fecha, etapa que vence hoy, pago cancelado), partidas por pagar (sin factura = estimada, facturas de la
//     más vieja a la más nueva, plan de pagos de P, devuelto sin reponer, orden cancelada o anulada, pago cancelado), antigüedad
//     en grupos (MXN y USD aparte), flujo semanal (vencidos a la semana 1, hoy no vence, después de 13 semanas, sin fecha, neto y
//     acumulado) y margen por línea (por firmar no suma, costo en otra moneda, costos de incremento 7, prueba y cancelados).
//  2. Servidor por doPost: fecha esperada (permisos, antes y después de firmar, se conserva al reescribir el esquema por nombre,
//     esquema cambiado, fechas no válidas, borrar, proyecto cancelado, Bitácora, texto en la hoja, versión), los cuatro reportes
//     con datos sembrados (cifras iguales a la vista del proyecto), permisos por rol, caché por versión y sincronizar.
//  3. Interfaz (mod-reportes sobre la app, conectada al servidor simulado): pestaña según el rol, cada reporte, CSV, fechas en la
//     vista de Cobranza del proyecto.
// Uso: node tests/reportes.test.js .
'use strict';
const assert = require('assert');
const dir = process.argv[2] || '.';
const A = require('./arnes')(dir, { props: {
  ROL_COBRANZA: 'tania@helgen.tech', ADMIN_DESBLOQUEO: 'efrain@helgen.tech', ROL_COMPRAS: 'pedro@helgen.tech',
  ROL_REQUISICION: 'obrero@helgen.tech', SOLO_REQUISICION: 'rosa@helgen.tech', ROL_OPERACIONES: '' } });
const { P, ok, falla, plain, props, libros, HOY_ISO, masDias, correr, ANIO, PDF, FOTOS } = A;
const MANANA = masDias(1);
const lunes = P.lunesDe(HOY_ISO);
const semanaDe = f => f < HOY_ISO ? 1 : Math.floor(P.diasEntre(lunes, f) / 7) + 1;

// ================= 1. Lógica pura =================
// Fechas
assert.equal(P.fechaIsoValida('2026-02-28'), true);
assert.equal(P.fechaIsoValida('2026-02-30'), false, 'fecha que no existe');
assert.equal(P.fechaIsoValida('15/11/2026'), false);
assert.equal(P.fechaIsoValida(''), false);
assert.equal(P.lunesDe('2026-10-29'), '2026-10-26', 'jueves → lunes de esa semana');
assert.equal(P.lunesDe('2026-11-01'), '2026-10-26', 'domingo → el lunes anterior');
assert.equal(P.lunesDe('2026-10-26'), '2026-10-26', 'lunes → el mismo');
// Folios de prueba (CLAUDE.md §5) y la lista extra
assert.equal(P.esFolioPrueba('PRY-2026-0001'), true);
assert.equal(P.esFolioPrueba('pry-2026-0001-ppo'), true, 'con su clave también');
assert.equal(P.esFolioPrueba('HLG-2026-0005'), true);
assert.equal(P.esFolioPrueba('PRY-2026-0002'), false);
assert.equal(P.esFolioPrueba(''), false);
assert.equal(P.esFolioPrueba('PRY-2027-0009', ['PRY-2027-0009']), true);
// Rangos: hoy no está vencido; 1–30, 31–60, 61–90, > 90; sin fecha
const rango = d => plain(P.rangoAntiguedad(masDias(-d), HOY_ISO));
assert.deepEqual(rango(0), { dias: 0, rango: 'porVencer' }, 'vence hoy: no vencido');
assert.deepEqual(rango(-5), { dias: -5, rango: 'porVencer' });
assert.deepEqual([rango(1).rango, rango(30).rango, rango(31).rango, rango(60).rango, rango(61).rango, rango(90).rango, rango(91).rango],
  ['d1a30', 'd1a30', 'd31a60', 'd31a60', 'd61a90', 'd61a90', 'd90mas']);
assert.deepEqual(plain(P.rangoAntiguedad('', HOY_ISO)), { dias: null, rango: 'sinFecha' });
assert.deepEqual(plain(P.rangoAntiguedad('2026-02-30', HOY_ISO)), { dias: null, rango: 'sinFecha' }, 'una fecha escrita mal a mano = sin fecha');
// Lo que manda la interfaz para guardar fechas
assert.deepEqual(plain(P.normalizarFechasEsperadas([{ orden: 2, etapa: ' Instalación ', fecha: '2026-11-15' }, { orden: '3', etapa: 'X', fecha: '' }])),
  [{ orden: 2, etapa: 'Instalación', fecha: '2026-11-15' }, { orden: 3, etapa: 'X', fecha: '' }]);
assert.throws(() => P.normalizarFechasEsperadas([]), /No hay fechas/);
assert.throws(() => P.normalizarFechasEsperadas([{ orden: 1, etapa: 'A', fecha: '2026-02-30' }]), /"A" no es válida/);
assert.throws(() => P.normalizarFechasEsperadas([{ orden: 1, etapa: 'A', fecha: '15/11/2026' }]), /no es válida/);
assert.throws(() => P.normalizarFechasEsperadas([{ orden: 1, etapa: 'A', fecha: '2019-12-31' }]), /no es válida/);
assert.throws(() => P.normalizarFechasEsperadas([{ orden: 1, etapa: 'A', fecha: '' }, { orden: 1, etapa: 'A', fecha: '' }]), /repetida/);
assert.throws(() => P.normalizarFechasEsperadas([{ orden: 0, etapa: 'A' }]), /Etapa no válida/);
assert.throws(() => P.normalizarFechasEsperadas([{ orden: 1.5, etapa: 'A' }]), /Etapa no válida/);

// ---- Cuentas por cobrar (etapasPorCobrar → antiguedadCxc) ----
const PRY = (folio, cliente, extra) => Object.assign({ folio, folioVisible: folio + '-ABC', nombre: 'Proyecto ' + folio, cliente, clienteId: 'ID:' + cliente, estado: 'Activo' }, extra || {});
const CON = (folio, total, extra) => Object.assign({ proyectoFolio: folio, cotizacion: 'HLG-' + folio, marca: 'helgen', moneda: 'MXN',
  subtotal: Math.round(total / 1.16 * 100) / 100, total, estado: 'Firmado' }, extra || {});
const ESQ = (folio, fechas) => [['Anticipo', 60], ['Instalación', 30], ['Encendido', 10]].map(([etapa, porcentaje], i) =>
  ({ proyectoFolio: folio, orden: i + 1, etapa, porcentaje, fechaEsperada: fechas[i] || '' }));
const PAG = (folio, montoAplicado, extra) => Object.assign({ proyectoFolio: folio, montoAplicado, etapaOrden: 1, estado: 'Vigente', fecha: HOY_ISO }, extra || {});
const baseCxc = {
  hoy: HOY_ISO,
  proyectos: [PRY('PRY-9-0002', 'Cliente Uno'), PRY('PRY-9-0003', 'Cliente Uno'), PRY('PRY-9-0004', 'Cliente Dos'),
    PRY('PRY-9-0005', 'Cliente Tres', { estado: 'Cancelado' }), PRY('PRY-9-0006', 'Cliente Tres'), PRY('PRY-9-0007', 'Prueba'),
    PRY('PRY-9-0008', 'Cliente Uno', { estado: 'Cerrado' })],
  contratos: [
    CON('PRY-9-0002', 11600),                                  // 6960 / 3480 / 1160
    CON('PRY-9-0003', 5800, { marca: 'energy' }),               // 3480 / 1740 / 580
    CON('PRY-9-0004', 1160, { moneda: 'USD' }),                 // USD: 696 / 348 / 116
    CON('PRY-9-0005', 2320),                                   // proyecto cancelado: fuera
    CON('PRY-9-0006', 2320, { estado: 'Aceptada' }),           // por firmar: fuera
    CON('PRY-9-0007', 2320),                                   // de prueba: fuera
    CON('PRY-9-0008', 1160),                                   // cerrado con saldo: cuenta
  ],
  esquemas: [].concat(ESQ('PRY-9-0002', ['', masDias(-40), HOY_ISO]), ESQ('PRY-9-0003', [masDias(-10), masDias(20), '']),
    ESQ('PRY-9-0004', ['', masDias(-100), '']), ESQ('PRY-9-0005', [masDias(-5)]), ESQ('PRY-9-0006', [masDias(-5)]), ESQ('PRY-9-0007', [masDias(-5)])),
  pagos: [
    PAG('PRY-9-0002', 3000),                                   // cobro parcial de la etapa 1
    PAG('PRY-9-0002', 1000, { estado: 'Cancelado' }),          // cancelado: no cuenta
    PAG('PRY-9-0002', 5000),                                   // excedente: 3960 a la etapa 1, 1040 a la etapa 2
    PAG('PRY-9-0004', 696, { monedaPago: 'MXN', tipoCambio: 18.5, monto: 12876 }), // USD pagado en MXN: cuenta lo aplicado (USD)
  ],
  prueba: ['PRY-9-0007'],
};
const partidasCxc = plain(P.etapasPorCobrar(baseCxc));
const resumida = partidasCxc.map(x => [x.proyectoFolio, x.etapa, x.monto, x.fecha, x.moneda].join(' '));
assert.deepEqual(resumida, [
  'PRY-9-0002 Instalación 2440 ' + masDias(-40) + ' MXN', 'PRY-9-0002 Encendido 1160 ' + HOY_ISO + ' MXN',
  'PRY-9-0003 Anticipo 3480 ' + masDias(-10) + ' MXN', 'PRY-9-0003 Instalación 1740 ' + masDias(20) + ' MXN', 'PRY-9-0003 Encendido 580  MXN',
  'PRY-9-0004 Instalación 348 ' + masDias(-100) + ' USD', 'PRY-9-0004 Encendido 116  USD',
  'PRY-9-0008 Total 1160  MXN'], 'etapas con saldo: parcial, excedente a la siguiente, USD aparte, sin esquema = una etapa Total');
// Mismo reparto que la vista del proyecto (resumenCobranza)
const rs2 = P.resumenCobranza(baseCxc.contratos[0], ESQ('PRY-9-0002', []), baseCxc.pagos.filter(p => p.proyectoFolio === 'PRY-9-0002'));
assert.equal(partidasCxc.filter(x => x.proyectoFolio === 'PRY-9-0002').reduce((s, x) => s + x.monto, 0), rs2.saldo, 'suma de etapas = saldo del proyecto');
const cxc = plain(P.antiguedadCxc(baseCxc));
assert.deepEqual(cxc.rangos.map(r => r.etiqueta), ['No vencido', '1–30 días', '31–60 días', '61–90 días', 'Más de 90 días', 'Sin fecha']);
assert.deepEqual(cxc.totales.map(t => t.moneda), ['MXN', 'USD'], 'una fila de totales por moneda, MXN primero');
const tMxn = cxc.totales[0], tUsd = cxc.totales[1];
assert.deepEqual([tMxn.porVencer, tMxn.d1a30, tMxn.d31a60, tMxn.d61a90, tMxn.d90mas, tMxn.sinFecha, tMxn.vencido, tMxn.total],
  [1160 + 1740, 3480, 2440, 0, 0, 580 + 1160, 3480 + 2440, 10560]);
assert.deepEqual([tUsd.d90mas, tUsd.sinFecha, tUsd.vencido, tUsd.total, tUsd.grupos], [348, 116, 348, 464, 1], 'USD nunca se suma con MXN');
const uno = cxc.grupos.find(g => g.cliente === 'Cliente Uno' && g.moneda === 'MXN');
assert.deepEqual(uno.detalle.map(x => x.folio), ['PRY-9-0002', 'PRY-9-0003', 'PRY-9-0008'], 'un cliente, sus proyectos');
assert.equal(uno.total, 10560);
assert.equal(uno.detalle[0].partidas[1].dias, 0, 'la etapa que vence hoy: 0 días');
assert.equal(uno.detalle[0].partidas[1].rango, 'porVencer');
assert.equal(uno.detalle[1].partidas[2].rango, 'sinFecha', 'sin fecha esperada');
assert(!cxc.grupos.some(g => /Tres|Prueba/.test(g.cliente)), 'cancelado, por firmar y prueba fuera');
// Un cliente con proyectos en MXN y en USD sale dos veces (una por moneda)
const mixto = plain(P.antiguedadCxc(Object.assign({}, baseCxc, { proyectos: baseCxc.proyectos.map(p => p.folio === 'PRY-9-0004' ? Object.assign({}, p, { cliente: 'Cliente Uno', clienteId: 'ID:Cliente Uno' }) : p) })));
assert.deepEqual(mixto.grupos.filter(g => g.cliente === 'Cliente Uno').map(g => g.moneda), ['MXN', 'USD']);
// Un contrato cuya cotización aceptada es de prueba tampoco cuenta
assert.equal(P.etapasPorCobrar(Object.assign({}, baseCxc, { prueba: ['HLG-PRY-9-0002'] })).filter(x => x.proyectoFolio === 'PRY-9-0002').length, 0);

// ---- Cuentas por pagar (porPagarProveedores → antiguedadPorPagar) ----
const OC = (folio, total, extra) => Object.assign({ folio, fecha: masDias(-50), proyectoFolio: 'PRY-9-0002', proveedorId: 'RFC1', proveedor: 'Eléctrica',
  moneda: 'MXN', total, ivaTasa: 0.16, renglones: [{ cantidad: 1, costo: Math.round(total / 1.16 * 100) / 100 }], estado: 'Emitida',
  fechaEntrega: masDias(-45), diasCredito: 0, reqFolio: 'REQ-' + folio }, extra || {});
const PGP = (oc, montoAplicado, extra) => Object.assign({ folio: 'PGP-' + oc, ocFolio: oc, montoAplicado, estado: 'Vigente', fecha: HOY_ISO }, extra || {});
const FPR = (folio, oc, total, vence, extra) => Object.assign({ folio, ocFolio: oc, moneda: 'MXN', total, fechaVencimiento: vence, estado: 'Vigente' }, extra || {});
const baseCxp = {
  hoy: HOY_ISO, proyectos: baseCxc.proyectos, prueba: ['PRY-9-0007'],
  ordenes: [
    OC('OC-1', 1160),                                                      // sin factura: entrega + 0 días → 45 días
    OC('OC-2', 2320, { diasCredito: 30, fechaEntrega: masDias(-10) }),     // facturas: 1160 (vencida) y 580 (por vencer) + 580 sin factura
    OC('OC-3', 580, { estado: 'Cancelada' }),                              // cancelada: fuera
    OC('OC-4', 580, { estado: 'Anulada' }),                                // anulada: fuera
    OC('OC-5', 1160),                                                      // pagada: fuera
    OC('OC-6', 1160),                                                      // su pago se canceló: se debe completa
    OC('OC-7', 116, { moneda: 'USD', proveedorId: 'US1', proveedor: 'Ardusimple', fechaEntrega: masDias(3) }),
    OC('OC-8', 580, { proyectoFolio: 'PRY-9-0007' }),                      // proyecto de prueba: fuera
    OC('OC-9', 348, { proyectoFolio: 'PRY-9-0005', fechaEntrega: '', fecha: masDias(-2) }), // proyecto cancelado: se le sigue debiendo
  ],
  pagosProv: [PGP('OC-5', 1160), PGP('OC-6', 1160, { estado: 'Cancelado' }), PGP('OC-2', 600)],
  facturas: [FPR('FPR-2', 'OC-2', 580, masDias(5)), FPR('FPR-1', 'OC-2', 1160, masDias(-20)), FPR('FPR-X', 'OC-2', 99, masDias(-30), { estado: 'Cancelada' }),
    FPR('FPR-U', 'OC-2', 50, masDias(-30), { moneda: 'USD' })],
  movimientos: {},
};
const pp = plain(P.porPagarProveedores(baseCxp));
assert.deepEqual(pp.map(x => [x.ocFolio, x.monto, x.fecha, x.fuente, x.referencia].join(' ')), [
  'OC-1 1160 ' + masDias(-45) + ' estimada Sin factura',
  // OC-2: saldo 2320 − 600 = 1720; lo pagado cubre primero FPR-1 (la que vence antes) → 560 de FPR-1, 580 de FPR-2, 580 sin factura
  'OC-2 560 ' + masDias(-20) + ' factura FPR-1', 'OC-2 580 ' + masDias(5) + ' factura FPR-2', 'OC-2 580 ' + masDias(20) + ' estimada Sin factura',
  'OC-6 1160 ' + masDias(-45) + ' estimada Sin factura',
  'OC-7 116 ' + masDias(3) + ' estimada Sin factura',
  'OC-9 348 ' + masDias(-2) + ' estimada Sin factura'], 'partidas por pagar');
assert.equal(pp.find(x => x.ocFolio === 'OC-9').estadoProyecto, 'Cancelado', 'la orden de un proyecto cancelado se sigue debiendo');
assert.deepEqual([pp[1].esperado, pp[1].pagado, pp[1].saldoOrden], [2320, 600, 1720]);
const cxp = plain(P.antiguedadPorPagar(baseCxp));
assert.deepEqual(cxp.totales.map(t => [t.moneda, t.total, t.vencido, t.porVencer]), [['MXN', 1160 + 1720 + 1160 + 348, 1160 + 560 + 1160 + 348, 580 + 580], ['USD', 116, 0, 116]]);
assert.deepEqual(cxp.grupos.map(g => g.proveedor + ' ' + g.moneda), ['Eléctrica MXN', 'Ardusimple USD']);
assert.deepEqual(cxp.grupos[0].detalle.map(x => x.ocFolio), ['OC-1', 'OC-2', 'OC-6', 'OC-9']);
assert.deepEqual([cxp.grupos[0].detalle[1].d1a30, cxp.grupos[0].detalle[1].porVencer], [560, 1160], 'una orden en dos rangos');
// Plan de pagos del módulo P (simulado con la firma del contrato): lo que no cubre ninguna factura, completo en la fecha del
// "siguiente" de P (como Cuentas por pagar y la vista de la orden; revisión 6b)
const conPlan = (orden, pagos) => ({ esperado: orden.total, pagado: 0, saldo: orden.total, completo: false, vigentes: [],
  siguiente: orden.folio === 'OC-1' ? { concepto: 'Anticipo 50%', monto: 580, vence: masDias(-3) } : null });
const ocPlan = Object.assign({}, baseCxp.ordenes[0], { planPago: [{ concepto: 'Anticipo 50%', porcentaje: 50 }, { concepto: 'Resto', porcentaje: 50 }] });
const ppPlan = plain(P.porPagarProveedores(Object.assign({}, baseCxp, { ordenes: [ocPlan] }), conPlan));
assert.deepEqual(ppPlan.map(x => [x.monto, x.fecha, x.fuente, x.referencia].join(' ')), ['1160 ' + masDias(-3) + ' plan Anticipo 50%']);
// Sin plan: primero las facturas; lo que no cubren, en la fecha del "siguiente" de P sin facturas
const sinPlan = (orden, pagos) => ({ esperado: orden.total, pagado: 600, saldo: orden.total - 600, completo: false, vigentes: [],
  siguiente: { concepto: 'Saldo', monto: orden.total - 600, vence: orden.facturas && orden.facturas.length ? masDias(-20) : masDias(-1) } });
assert.deepEqual(plain(P.porPagarProveedores(Object.assign({}, baseCxp, { ordenes: [baseCxp.ordenes[1]] }), sinPlan)).map(x => x.fuente + ' ' + x.monto + ' ' + x.fecha),
  ['factura 560 ' + masDias(-20), 'factura 580 ' + masDias(5), 'estimada 580 ' + masDias(-1)]);
// Pagos parciales del módulo P (simulado): saldoFn manda; completo = fuera
const parcial = () => ({ esperado: 1160, pagado: 400, saldo: 760, completo: false, vigentes: [{ folio: 'PGP-1', fecha: HOY_ISO, montoAplicado: 400, tipo: 'Anticipo' }], siguiente: null });
assert.deepEqual(plain(P.porPagarProveedores(Object.assign({}, baseCxp, { ordenes: [baseCxp.ordenes[0]] }), parcial)).map(x => x.monto), [760]);
assert.equal(P.porPagarProveedores(Object.assign({}, baseCxp, { ordenes: [baseCxp.ordenes[0]] }), () => ({ saldo: 0.5, completo: true })).length, 0);
// Integración con P (29/10/2026): con retenciones, una orden pagada por el total de su factura ya no se debe (P mide el saldo contra
// lo facturado si las facturas cubren la orden); porPagarProveedores le pasa a P las facturas de la orden
if (typeof P.saldoOrdenCompra === 'function') {
  const ocRet = OC('OC-R', 1160, { subtotal: 1000 });
  const fRet = FPR('FPR-R', 'OC-R', 1060, masDias(10), { subtotal: 1000, descuento: 0 });
  const dRet = Object.assign({}, baseCxp, { ordenes: [ocRet], facturas: [fRet], pagosProv: [PGP('OC-R', 1060)] });
  assert.equal(P.porPagarProveedores(dRet, P.saldoOrdenCompra).length, 0, 'con retenciones: pagada por el total de su factura, fuera de CxP');
  const dRet2 = Object.assign({}, dRet, { pagosProv: [PGP('OC-R', 500)] });
  assert.deepEqual(plain(P.porPagarProveedores(dRet2, P.saldoOrdenCompra)).map(x => x.monto), [560], 'con retenciones: el saldo es contra lo facturado');
}
// Provisional (reglas de hoy) con la forma exacta del contrato de P
const sp = plain(P.saldoOrdenCompraProvisional(baseCxp.ordenes[1], [PGP('OC-2', 600), PGP('OC-2', 99, { estado: 'Cancelado' })], []));
assert.deepEqual(Object.keys(sp).sort(), ['completo', 'esperado', 'pagado', 'saldo', 'siguiente', 'vigentes']);
assert.deepEqual([sp.esperado, sp.pagado, sp.saldo, sp.completo, sp.vigentes.length, sp.siguiente.monto], [2320, 600, 1720, false, 1, 1720]);
assert.equal(P.saldoOrdenCompraProvisional(baseCxp.ordenes[0], [PGP('OC-1', 1159.5)], []).completo, true, 'dentro de la tolerancia');
// Devuelto sin reponer: lo esperado es la orden menos lo devuelto (regla del incremento 5)
const ocDev = OC('OC-D', 1624, { renglones: [{ cantidad: 80, costo: 10 }, { cantidad: 12, costo: 50 }] });
const dev = P.saldoOrdenCompraProvisional(ocDev, [], [{ estado: 'Vigente', tipo: correr('TIPO_DEVOLUCION_CIERRA'), renglon: 2, cantidad: -2 }]);
assert.deepEqual([dev.esperado, dev.saldo], [1508, 1508], '1624 − 2 × 50 × 1.16');
// El módulo P se usa en cuanto exista (punto de integración)
assert.equal(P.saldoOrdenCompra_(), typeof P.saldoOrdenCompra === 'function' ? P.saldoOrdenCompra : P.saldoOrdenCompraProvisional,
  'la de P en cuanto exista; mientras tanto, la provisional');

// ---- Flujo semanal ----
const fl = plain(P.flujoSemanal({ hoy: HOY_ISO, semanas: 13, cobros: partidasCxc, pagos: pp }));
assert.equal(fl.semanas.length, 13);
assert.deepEqual([fl.inicio, fl.semanas[0].desde, fl.semanas[0].hasta, fl.semanas[12].hasta], [lunes, lunes, P.sumarDias(lunes, 6), P.sumarDias(lunes, 90)]);
const fm = fl.monedas.find(m => m.moneda === 'MXN'), fu = fl.monedas.find(m => m.moneda === 'USD');
assert.deepEqual(fl.monedas.map(m => m.moneda), ['MXN', 'USD']);
// Vencidos a la semana 1 (marcados); la etapa que vence hoy también va en la semana 1 pero no está vencida
assert.deepEqual([fm.semanas[0].cobrosVencidos, fm.semanas[0].pagosVencidos], [2440 + 3480, 1160 + 560 + 1160 + 348]);
const hoyCobro = fl.partidas.find(p => p.tipo === 'cobro' && p.fecha === HOY_ISO);
assert.deepEqual([hoyCobro.semana, hoyCobro.vencido], [1, false]);
assert.equal(fl.partidas.find(p => p.folio === 'PRY-9-0002-ABC' && p.vencido).semana, 1);
// Sin fecha aparte; MXN y USD aparte; neto y acumulado
assert.deepEqual([fm.sinFecha.cobros, fm.sinFecha.pagos, fu.sinFecha.cobros], [580 + 1160, 0, 116]);
assert.deepEqual([fu.semanas[0].cobrosVencidos, fu.totales.pagos], [348, 116]);
const cobrosMxn = 2440 + 1160 + 3480 + 1740, pagosMxn = 1160 + 560 + 580 + 580 + 1160 + 348;
assert.deepEqual([fm.totales.cobros, fm.totales.pagos, fm.totales.neto], [cobrosMxn, pagosMxn, cobrosMxn - pagosMxn]);
assert.equal(fm.semanas[12].acumulado, cobrosMxn - pagosMxn, 'el acumulado de la última semana = el neto total');
fm.semanas.forEach((s, i) => assert.equal(s.neto, Math.round((s.cobros - s.pagos) * 100) / 100, 'neto semana ' + (i + 1)));
assert.equal(fm.semanas[semanaDe(masDias(20)) - 1].cobros >= 1740, true, 'la etapa del día 20 cae en su semana');
// Después de la semana 13: aparte
const lejos = plain(P.flujoSemanal({ hoy: HOY_ISO, cobros: [{ moneda: 'MXN', monto: 10, fecha: masDias(200), etapa: 'X' }], pagos: [] }));
assert.deepEqual([lejos.monedas[0].despues.cobros, lejos.monedas[0].totales.cobros, lejos.partidas[0].donde], [10, 0, 'despues']);

// ---- Margen por proyecto ----
const ORD = (proyectoFolio, subtotalProyecto, extra) => Object.assign({ proyectoFolio, subtotalProyecto, monedaProyecto: 'MXN', estado: 'Emitida' }, extra || {});
const mg = plain(P.margenPorProyecto({ proyectos: baseCxc.proyectos, contratos: baseCxc.contratos, prueba: ['PRY-9-0007'],
  ordenes: [ORD('PRY-9-0002', 3000), ORD('PRY-9-0002', 500, { estado: 'Cancelada' }), ORD('PRY-9-0002', 700, { estado: 'Anulada' }),
    ORD('PRY-9-0003', 1000), ORD('PRY-9-0004', 100, { monedaProyecto: 'USD' }), ORD('PRY-9-0008', 50, { monedaProyecto: 'USD' }),
    ORD('PRY-9-0005', 999)],
  costosExtra: { 'PRY-9-0002': [{ concepto: 'Gastos', moneda: 'MXN', monto: 400, cantidad: 2 }] } }));
assert.deepEqual(mg.conceptos, ['Órdenes de compra', 'Gastos'], 'incremento 7: más conceptos de costo');
assert.deepEqual(mg.proyectos.map(p => p.folio + ' ' + p.estadoContrato + ' ' + p.margen), ['PRY-9-0002 Firmado 6600', 'PRY-9-0008 Firmado null',
  'PRY-9-0006 Por firmar 2000', 'PRY-9-0004 Firmado 900', 'PRY-9-0003 Firmado 4000'], 'Helgen MXN, Helgen USD, Energy MXN; cancelado y prueba fuera');
assert(/no se suman monedas distintas/.test(mg.proyectos[1].margenError), 'una orden en otra moneda: Revisar');
const totM = k => mg.totales.find(t => t.marca + ' ' + t.moneda === k);
assert.deepEqual(plain(totM('helgen MXN')), { marca: 'helgen', moneda: 'MXN', proyectos: 1, contratado: 10000,
  costos: [{ concepto: 'Órdenes de compra', monto: 3000 }, { concepto: 'Gastos', monto: 400 }], totalCostos: 3400, margen: 6600, porcentaje: 66,
  porFirmar: 1, conError: 1 }, 'por firmar y con error no suman');
assert.deepEqual([totM('helgen USD').margen, totM('energy MXN').margen, totM('energy MXN').porcentaje], [900, 4000, 80]);

// ================= 2. Servidor (doPost) =================
P.exigirDocumentosParaPagar_ = function () {};
correr(`enviarCorreosPendientes_ = function () { MEMO_.correos = []; }; avisarPortal_ = function () { return ''; };`);
props.SUPER_ADMIN = 'leo@helgen.tech';
P.prepararCapri();
let nId = 0;
const id = p => (p || 'x') + (++nId);
const pry = (nombre, cliente) => ok('ana', 'crearProyecto', { nombre, ubicacion: 'Qro', cliente, idSolicitud: id('p') }).folio;
const cot = (proyectoFolio, cliente, precio, extra) => ok('ana', 'guardarCotizacion', Object.assign({ cliente, items: [{ descripcion: 'Servicio', cantidad: 1, precio }],
  proyectoFolio, idSolicitud: id('c') }, extra || {})).folio;
const firmar = (p, c) => { ok('tania', 'marcarAceptada', p, c, true); return ok('tania', 'firmarContrato', p, HOY_ISO); };
const cobrar = (proyectoFolio, monto, extra) => ok('tania', 'registrarPago', Object.assign({ proyectoFolio, fecha: HOY_ISO, monto, metodo: 'Transferencia',
  referencia: 'SPEI ' + monto, etapaOrden: 1, comprobante: { datos: PDF }, idSolicitud: id('g') }, extra || {})).folio;
const fechas = (p, lista) => ok('tania', 'guardarFechasEsperadas', p, lista);
const UNO = { nombre: 'Cliente Uno', empresa: 'Uno SA' }, DOS = { nombre: '=Cliente Dos', empresa: 'Antenas SA' };
// HLG-2026-0005 y 0006 son cotizaciones de prueba (FOLIOS_PRUEBA_REPORTES): estas de relleno ocupan esos folios
for (let i = 0; i < 6; i++) cot('', { nombre: 'Relleno' }, 1);

// p0 = el primer proyecto (en 2026 es PRY-2026-0001, de prueba en CLAUDE.md §5); además va en FOLIOS_PRUEBA
const p0 = pry('Proyecto de prueba', { nombre: 'PRUEBA - CANCELADA' });
firmar(p0, cot(p0, { nombre: 'PRUEBA - CANCELADA' }, 1000));
props.FOLIOS_PRUEBA = p0 + ', OTRA-0000';
const p1 = pry('Planta Norte', UNO), p2 = pry('Terminal Sur', UNO), p3 = pry('Antenas', DOS), p4 = pry('Por firmar', UNO), p5 = pry('Se cancela', UNO);
const vacio = pry('Sin contrato', UNO);
const LC = () => libros[props.COBRANZA_DB_ID];
const H = n => LC().pest[n].m;

// ---- Fecha esperada por etapa ----
const c1 = cot(p1, UNO, 10000), c1b = cot(p1, UNO, 9000);
ok('tania', 'marcarAceptada', p1, c1b, true);
assert.deepEqual(H('Esquemas')[0], ['proyecto_folio', 'orden', 'etapa', 'porcentaje', 'monto', 'fecha_esperada'], 'la columna se crea sola, por nombre');
let v = ok('tania', 'getCobranzaProyecto', p1);
assert.deepEqual([v.fechasEditables, v.esquema.map(e => e.fechaEsperada).join()], [true, ',,'], 'aceptada sin firmar: editable, sin fechas');
const ver0 = Number(props.VER_contratos);
v = fechas(p1, [{ orden: 2, etapa: 'Instalación', fecha: masDias(-40) }]);
assert.equal(v.esquema[1].fechaEsperada, masDias(-40));
assert(Number(props.VER_contratos) > ver0, 'sube la versión de contratos (los demás navegadores se enteran)');
const filaEsq = (p, etapa) => H('Esquemas').find(r => r[0] === p && r[2] === etapa);
assert.equal(typeof filaEsq(p1, 'Instalación')[5], 'string', 'se guarda como texto (con apóstrofo), no como fecha de Sheets');
const bit = H('Bitacora').slice(-1)[0];
assert.deepEqual([bit[2], bit[3], bit[4]], ['Fechas esperadas de cobro', p1, 'Instalación: sin fecha → ' + masDias(-40)]);
// Cambiar la aceptada (misma línea) reescribe el esquema: la fecha se conserva por nombre
v = ok('tania', 'marcarAceptada', p1, c1, true);
assert.equal(v.esquema[1].fechaEsperada, masDias(-40), 'marcarAceptada no borra la fecha');
// Editar el esquema: las etapas que siguen (por nombre) conservan su fecha; la renombrada queda sin fecha
v = ok('tania', 'guardarEsquema', p1, [{ etapa: 'Anticipo', porcentaje: 60 }, { etapa: 'instalacion', porcentaje: 30 }, { etapa: 'Arranque', porcentaje: 10 }], '');
assert.deepEqual(v.esquema.map(e => e.etapa + ':' + e.fechaEsperada), ['Anticipo:', 'instalacion:' + masDias(-40), 'Arranque:'], 'sin acentos ni mayúsculas');
v = ok('tania', 'guardarEsquema', p1, [{ etapa: 'Anticipo', porcentaje: 60 }, { etapa: 'Instalación', porcentaje: 30 }, { etapa: 'Arranque', porcentaje: 10 }], '');
// Esquema cambiado mientras se capturaba: error y no se escribe nada
const antes = JSON.stringify(H('Esquemas'));
falla('tania', 'guardarFechasEsperadas', [p1, [{ orden: 1, etapa: 'Anticipo', fecha: HOY_ISO }, { orden: 3, etapa: 'Encendido del sistema', fecha: HOY_ISO }]],
  /cambió mientras capturabas/);
falla('tania', 'guardarFechasEsperadas', [p1, [{ orden: 4, etapa: 'Otra', fecha: HOY_ISO }]], /cambió/);
assert.equal(JSON.stringify(H('Esquemas')), antes, 'nada se escribió');
falla('tania', 'guardarFechasEsperadas', [p1, [{ orden: 3, etapa: 'Arranque', fecha: '2026-13-01' }]], /no es válida/);
fechas(p1, [{ orden: 3, etapa: 'Arranque', fecha: HOY_ISO }]);
// Firmar conserva las fechas; después de firmar se siguen pudiendo cambiar (no cambian montos)
v = firmar(p1, c1);
assert.deepEqual(v.esquema.map(e => e.fechaEsperada), ['', masDias(-40), HOY_ISO], 'firmar no borra fechas');
assert.equal(v.fechasEditables, true);
v = fechas(p1, [{ orden: 1, etapa: 'Anticipo', fecha: masDias(-60) }]);
assert.equal(v.esquema[0].fechaEsperada, masDias(-60), 'con contrato firmado');
v = fechas(p1, [{ orden: 1, etapa: 'Anticipo', fecha: '' }]);
assert.equal(v.esquema[0].fechaEsperada, '', 'vacía = sin fecha');
assert.equal(H('Bitacora').slice(-1)[0][4], 'Anticipo: ' + masDias(-60) + ' → sin fecha');
const nBit = H('Bitacora').length;
fechas(p1, [{ orden: 2, etapa: 'Instalación', fecha: masDias(-40) }]);
assert.equal(H('Bitacora').length, nBit, 'sin cambios no deja renglón en la Bitácora');
// Permisos: solo cobranza (y super admin)
falla('pedro', 'guardarFechasEsperadas', [p1, [{ orden: 1, etapa: 'Anticipo', fecha: HOY_ISO }]], /permiso de cobranza/, 'PERMISO');
falla('ana', 'guardarFechasEsperadas', [p1, [{ orden: 1, etapa: 'Anticipo', fecha: HOY_ISO }]], /permiso de cobranza/, 'PERMISO');
falla('rosa', 'guardarFechasEsperadas', [p1, [{ orden: 1, etapa: 'Anticipo', fecha: HOY_ISO }]], /solo tiene acceso a Requisiciones/, 'PERMISO');
ok('leo', 'guardarFechasEsperadas', p1, [{ orden: 1, etapa: 'Anticipo', fecha: '' }]);
// Sin contrato: no hay fechas
falla('tania', 'guardarFechasEsperadas', [vacio, [{ orden: 1, etapa: 'Anticipo', fecha: HOY_ISO }]], /Primero marca la cotización aceptada/);
assert.equal(ok('tania', 'getCobranzaProyecto', vacio).fechasEditables, false);

// ---- Datos para los reportes ----
// p1 (MXN, Helgen): 11,600 = 6960 / 3480 / 1160; cobros 3000 + 5000 (excedente a la etapa 2) y uno cancelado
cobrar(p1, 3000);
const pagCancel = cobrar(p1, 1000);
ok('tania', 'cancelarPago', pagCancel, 'Se registró dos veces');
cobrar(p1, 5000);
// p2 (MXN, Helgen Energy): 5800 = 3480 / 1740 / 580
firmar(p2, cot(p2, UNO, 5000, { marca: 'energy' }));
fechas(p2, [{ orden: 1, etapa: 'Anticipo', fecha: masDias(-10) }, { orden: 2, etapa: 'Instalación', fecha: masDias(20) }]);
// p3 (USD): 1160 = 696 / 348 / 116; la etapa 1 pagada en MXN (12,876 / 18.5 = 696 USD)
firmar(p3, cot(p3, DOS, 1000, { moneda: 'USD' }));
cobrar(p3, 12876, { monedaPago: 'MXN', tipoCambio: 18.5 });
fechas(p3, [{ orden: 2, etapa: 'Instalación', fecha: masDias(-100) }]);
// p4: aceptada sin firmar (no se cobra; en el margen "Por firmar"); p5: firmado y luego cancelado
ok('tania', 'marcarAceptada', p4, cot(p4, UNO, 800), true);
firmar(p5, cot(p5, UNO, 2000));
fechas(p5, [{ orden: 1, etapa: 'Anticipo', fecha: masDias(-5) }]);

// Compras: requisiciones → órdenes (pedro autoriza lo que pidió obrero), pagos y facturas
const req = (p, d) => ok('obrero', 'guardarRequisicion', { proyectoFolio: p, renglones: [{ descripcion: d, cantidad: 1, unidad: 'pza' }],
  cotizacion: { nombre: 'c.pdf', datos: PDF }, idSolicitud: id('r') }).folio;
const autorizar = (folio, costo, extra) => ok('pedro', 'autorizarRequisicion', folio, Object.assign({ proveedor: { razonSocial: 'Eléctrica del Centro' },
  fechaEntrega: MANANA, formaPago: 'Transferencia', condicionesPago: 'Contado', diasCredito: 0, ivaTasa: 0.16,
  renglones: [{ descripcion: 'Material', unidad: 'PZA', cantidad: 1, costo }], idSolicitud: id('o') }, extra || {})).ocFolio;
const pagarProv = (reqFolio, monto) => ok('pedro', 'registrarPagoProveedor', { reqFolio, fecha: HOY_ISO, monto, monedaPago: '', metodo: 'Transferencia',
  referencia: 'SPEI', comprobante: { nombre: 'p.pdf', datos: PDF }, idSolicitud: id('pg') }).folio;
const r1 = req(p1, 'Cable'), oc1 = autorizar(r1, 1000);
pagarProv(r1, 1160); // pagada: no se debe
const r2 = req(p1, 'Tubo'), oc2 = autorizar(r2, 2000, { formaPago: 'Crédito del proveedor', condicionesPago: 'Crédito 30 días', diasCredito: 30 });
const fpr = ok('pedro', 'registrarFacturaProveedor', { ocFolio: oc2, tipo: 'Extranjera', numero: 'F-1', fecha: HOY_ISO, moneda: 'MXN', subtotal: 1500,
  impuestos: 240, pdf: { nombre: 'f.pdf', datos: PDF }, idSolicitud: id('f') }).folio;
const r3 = req(p2, 'Panel'), oc3 = autorizar(r3, 500);
const r4 = req(p3, 'Antena'), oc4 = autorizar(r4, 100, { proveedor: { razonSocial: 'Ardusimple SL' } });
const r5 = req(p5, 'Gabinete'), oc5 = autorizar(r5, 300);
const r6 = req(p1, 'Cancelada'), oc6 = autorizar(r6, 50);
ok('pedro', 'cancelarOrdenCompra', oc6, 'El proveedor no tenía existencias');
const r7 = req(p1, 'Anulada'), oc7 = autorizar(r7, 70);
ok('leo', 'anular', oc7, 'Orden duplicada por error de captura', id('an'));
const r8 = req(p1, 'Pago cancelado'), oc8 = autorizar(r8, 100);
const pgp8 = pagarProv(r8, 116);
ok('pedro', 'cancelarPagoProveedor', pgp8, 'Se pagó al proveedor equivocado');
const r9 = req(p0, 'De prueba'), oc9 = autorizar(r9, 400);
// Una orden vieja (entregada hace 45 días, contado, sin pagar): vencida
const LO = () => libros[props.COMPRAS_DB_ID];
LO().pest.OrdenesCompra.m.find(r => r[0] === oc3)[10] = masDias(-45);
// p5 se cancela en la hoja (como se hace hoy)
libros.DB.pest.Proyectos.m.find(r => r[0] === p5)[6] = 'Cancelado';
P.subirVersiones_(['proyectos', 'oc']);

// ---- Permisos por rol (el servidor revisa en cada llamada) ----
for (const f of ['reporteCxc', 'reporteMargen']) {
  ok('tania', f); ok('leo', f);
  falla('pedro', f, [], /No tienes permiso para ver este reporte/, 'PERMISO');
  falla('ana', f, [], /No tienes permiso/, 'PERMISO');
}
ok('pedro', 'reporteCxp'); ok('leo', 'reporteCxp');
falla('tania', 'reporteCxp', [], /No tienes permiso/, 'PERMISO');
falla('ana', 'reporteCxp', [], /No tienes permiso/, 'PERMISO');
ok('leo', 'reporteFlujo');
for (const q of ['tania', 'pedro', 'ana', 'efrain']) falla(q, 'reporteFlujo', [], /No tienes permiso/, 'PERMISO');
for (const f of ['reporteCxc', 'reporteCxp', 'reporteFlujo', 'reporteMargen']) falla('rosa', f, [], /solo tiene acceso a Requisiciones/, 'PERMISO');
falla('obrero', 'reporteCxp', [], /No tienes permiso/, 'PERMISO');

// ---- Antigüedad de CxC: las mismas cifras que la vista de cada proyecto ----
const rc = ok('tania', 'reporteCxc');
const proyCxc = folio => rc.grupos.reduce((a, g) => a.concat(g.detalle), []).find(x => x.folio === folio);
assert.equal(proyCxc(p1).total, ok('tania', 'getCobranzaProyecto', p1).resumen.saldo, 'p1: saldo = el de la vista del proyecto');
assert.deepEqual(proyCxc(p1).partidas.map(x => x.etapa + ' ' + x.monto + ' ' + x.rango), ['Instalación 2440 d31a60', 'Arranque 1160 porVencer']);
assert.deepEqual(proyCxc(p2).partidas.map(x => x.etapa + ' ' + x.monto + ' ' + x.rango), ['Anticipo 3480 d1a30', 'Instalación 1740 porVencer', 'Encendido del sistema 580 sinFecha']);
assert.deepEqual(proyCxc(p3).partidas.map(x => x.etapa + ' ' + x.monto + ' ' + x.rango + ' ' + x.moneda), ['Instalación 348 d90mas USD', 'Encendido del sistema 116 sinFecha USD']);
assert(!proyCxc(p0) && !proyCxc(p4) && !proyCxc(p5) && !proyCxc(vacio), 'fuera: prueba, por firmar, cancelado y sin contrato');
assert.deepEqual(rc.totales.map(t => t.moneda + ' ' + t.total + ' ' + t.vencido), ['MXN 9400 5920', 'USD 464 348']);
assert.deepEqual(rc.grupos.map(g => g.cliente + ' ' + g.moneda), ['Cliente Uno — Uno SA MXN', '=Cliente Dos — Antenas SA USD']);
assert.equal(ok('leo', 'reporteCxc').totales[0].total, 9400, 'super admin ve lo mismo');
// Un pago anulado deja de contar
const pagAnular = cobrar(p2, 100);
assert.equal(ok('tania', 'reporteCxc').totales[0].total, 9300);
ok('leo', 'anular', pagAnular, 'Pago capturado en el proyecto equivocado', id('an'));
assert.equal(ok('tania', 'reporteCxc').totales[0].total, 9400, 'anulado: fuera');

// ---- Antigüedad de CxP (compras): sin montos de contrato ni margen ----
const rp = ok('pedro', 'reporteCxp');
const ordenesCxp = rp.grupos.reduce((a, g) => a.concat(g.detalle), []);
assert.deepEqual(ordenesCxp.map(x => x.ocFolio).sort(), [oc2, oc3, oc4, oc5, oc8].sort(), 'pagada, cancelada, anulada y de prueba fuera; la del pago cancelado sí');
const o2 = ordenesCxp.find(x => x.ocFolio === oc2);
assert.deepEqual(o2.partidas.map(x => x.monto + ' ' + x.fuente + ' ' + x.referencia + ' ' + x.fecha),
  ['1740 factura ' + fpr + ' ' + masDias(30), '580 estimada Sin factura ' + P.sumarDias(MANANA, 30)], 'factura + lo que falta facturar');
assert.deepEqual([ordenesCxp.find(x => x.ocFolio === oc3).d31a60, ordenesCxp.find(x => x.ocFolio === oc5).estadoProyecto], [580, 'Cancelado']);
assert.deepEqual(rp.totales.map(t => t.moneda + ' ' + t.total), ['MXN ' + (2320 + 580 + 348 + 116), 'USD 116']);
assert.deepEqual(rp.grupos.map(g => g.proveedor + ' ' + g.moneda), ['Eléctrica del Centro MXN', 'Ardusimple SL USD']);
const textoCxp = JSON.stringify(rp);
assert(!/contratado|margen|"cliente"|"subtotal"|cotizacion/i.test(textoCxp), 'compras nunca recibe montos de contrato ni margen');
assert(textoCxp.indexOf('11600') === -1 && textoCxp.indexOf('10000') === -1);

// ---- Flujo (super admin) ----
const rf = ok('leo', 'reporteFlujo');
const mx = rf.monedas.find(m => m.moneda === 'MXN'), us = rf.monedas.find(m => m.moneda === 'USD');
assert.deepEqual([mx.semanas[0].cobrosVencidos, mx.semanas[0].pagosVencidos], [2440 + 3480, 580], 'vencidos a la semana 1');
assert.deepEqual([mx.totales.cobros, mx.sinFecha.cobros], [2440 + 1160 + 3480 + 1740, 580]);
assert.equal(mx.totales.pagos, 1740 + 580 + 580 + 348 + 116);
assert.equal(mx.semanas[12].acumulado, mx.totales.neto);
assert.deepEqual([us.semanas[0].cobrosVencidos, us.sinFecha.cobros, us.totales.pagos], [348, 116, 116]);
assert.equal(rf.partidas.filter(p => p.moneda === 'MXN' && p.tipo === 'pago' && p.folio === oc3)[0].vencido, true);

// ---- Margen (cobranza y super admin) ----
const rm = ok('tania', 'reporteMargen');
const mp = folio => rm.proyectos.find(p => p.folio === folio);
assert.deepEqual([mp(p1).contratado, mp(p1).totalCostos, mp(p1).margen, mp(p1).porcentaje], [10000, 3100, 6900, 69], 'oc1 + oc2 + oc8; cancelada y anulada fuera');
assert.equal(mp(p1).margen, ok('tania', 'getCobranzaProyecto', p1).margen.margen, 'igual que la tarjeta de margen del proyecto');
assert.deepEqual([mp(p2).margen, mp(p3).margen, mp(p3).moneda, mp(p4).estadoContrato], [4500, 900, 'USD', 'Por firmar']);
assert(!mp(p0) && !mp(p5) && !mp(vacio), 'prueba, cancelado y sin contrato fuera');
assert.deepEqual(rm.totales.map(t => t.marca + ' ' + t.moneda + ' ' + t.contratado + ' ' + t.margen + ' ' + t.porFirmar),
  ['helgen MXN 10000 6900 1', 'helgen USD 1000 900 0', 'energy MXN 5000 4500 0'], 'por línea de negocio y moneda');

// ---- Caché por versión: otra consulta no vuelve a leer las hojas; una escritura sí ----
correr('var LECTURAS_REP = 0; const datosReportesOriginal = datosReportes_; datosReportes_ = function (q) { LECTURAS_REP++; return datosReportesOriginal(q); };');
const lecturas = () => correr('LECTURAS_REP');
ok('tania', 'reporteCxc'); ok('tania', 'reporteCxc'); ok('leo', 'reporteCxc');
assert.equal(lecturas(), 0, 'en caché: nadie vuelve a leer');
fechas(p2, [{ orden: 3, etapa: 'Encendido del sistema', fecha: masDias(40) }]);
assert.equal(ok('tania', 'reporteCxc').totales[0].sinFecha, 0, 'la fecha nueva se ve');
assert.equal(lecturas(), 1, 'guardarFechasEsperadas sube contratos: se recalcula una vez');
ok('tania', 'reporteCxc'); ok('pedro', 'reporteCxp');
assert.equal(lecturas(), 1, 'CxP sigue en caché (no cambió nada de compras)');
pagarProv(r8, 116);
assert.equal(ok('pedro', 'reporteCxp').grupos[0].detalle.some(x => x.ocFolio === oc8), false, 'un pago nuevo se ve');
assert.equal(lecturas(), 2);
// Cambiar la lista de pruebas (Script Property) cambia la clave
props.FOLIOS_PRUEBA = p0 + ',' + p2;
assert(!ok('tania', 'reporteCxc').grupos[0].detalle.some(x => x.folio === p2), 'FOLIOS_PRUEBA se aplica sin publicar');
props.FOLIOS_PRUEBA = p0;
correr('datosReportes_ = datosReportesOriginal;');

// ---- Sincronizar: el reporte abierto se vuelve a mandar solo a quien lo puede ver ----
const sinc = (q, ctx) => ok(q, 'sincronizar', {}, ctx);
assert.equal(sinc('tania', { reporte: 'cxc' }).reporte.tipo, 'cxc');
assert.equal(sinc('tania', { reporte: 'cxc' }).reporte.datos.totales[0].moneda, 'MXN');
assert.equal(sinc('pedro', { reporte: 'cxc' }).reporte, undefined, 'compras no recibe CxC');
assert.equal(sinc('pedro', { reporte: 'margen' }).reporte, undefined, 'ni margen');
assert.equal(sinc('pedro', { reporte: 'cxp' }).reporte.tipo, 'cxp');
assert.equal(sinc('tania', { reporte: 'flujo' }).reporte, undefined, 'el flujo es solo del super admin');
assert.equal(sinc('leo', { reporte: 'flujo' }).reporte.tipo, 'flujo');
assert.equal(sinc('tania', { reporte: 'nada' }).reporte, undefined);
const vActual = ok('tania', 'bootstrap').versiones;
assert.equal(ok('tania', 'sincronizar', vActual, { reporte: 'cxc' }).reporte, undefined, 'sin cambios no se manda');
assert.deepEqual(plain(correr('CAMBIOS_API.guardarFechasEsperadas')), ['contratos']);

// ================= 3. Interfaz (mod-reportes sobre la app, conectada al servidor simulado) =================
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(dir, 'web/cotizador/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?: id="([^"]*)")?>([\s\S]*?)<\/script>/g)].map(m => ({ id: m[1], src: m[2] }));
assert(scripts.some(s => s.id === 'mod-reportes'), 'existe <script id="mod-reportes">');
assert(/<button id="tabRep" class="oculto" onclick="verTab\('rep'\)">Reportes<\/button>/.test(html), 'botón de la pestaña, oculto de inicio');
assert(/<section id="vistaRep" class="oculto">/.test(html) && /<div id="cobFechas" class="oculto"><\/div>/.test(html));
assert(/avisarModulos\('alCobranza', v\)/.test(html), 'pintarCobranza avisa a los módulos');
function montar(quien) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = 'h.' + b64({ email: quien + '@helgen.tech', given_name: quien, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.f';
  function elemento(tag) {
    const e = { tag, value: '', textContent: '', className: '', title: '', src: '', placeholder: '', disabled: false, hijos: [], oyentes: {}, _clases: new Set(), porClase: {},
      classList: { add: c => e._clases.add(c), remove: c => e._clases.delete(c), contains: c => e._clases.has(c), toggle: (c, f) => f ? e._clases.add(c) : e._clases.delete(c) },
      addEventListener: (t, f) => (e.oyentes[t] = e.oyentes[t] || []).push(f), disparar: t => (e.oyentes[t] || []).forEach(f => f({ target: e })),
      focus() {}, remove() {}, click() {}, appendChild: h => e.hijos.push(h), prepend: h => e.hijos.unshift(h), contains: () => false,
      querySelector: sel => e.porClase[sel] || (e.porClase[sel] = elemento('input')), querySelectorAll: sel => sel === 'tr' ? e.hijos : [] };
    let h = ''; Object.defineProperty(e, 'innerHTML', { get: () => h, set: v => { h = v; if (v === '') e.hijos.length = 0; } });
    return e;
  }
  const porId = {}, oyentesDoc = {};
  const document = { getElementById: id => porId[id] || (porId[id] = elemento('div')), querySelector: () => ({ src: 'data:logo' }), createElement: t => elemento(t),
    visibilityState: 'visible', activeElement: null, body: elemento('body'),
    addEventListener: (t, f) => (oyentesDoc[t] = oyentesDoc[t] || []).push(f), dispatchEvent: ev => (oyentesDoc[ev.type] || []).forEach(f => f(ev)) };
  document.getElementById('login').classList.add('oculto');
  ['tabCob', 'tabCom', 'tabRep', 'vistaRep', 'cobFechas'].forEach(i => document.getElementById(i).classList.add('oculto')); // como en el HTML
  const almacen = { cotizadorHelgenSesion: token }, llamadas = [];
  // Todo va al servidor simulado como esta persona (también la carga inicial y la sincronización)
  async function fetch(url, o) {
    const c = JSON.parse(o.body); llamadas.push(c);
    const datos = A.post(quien, c.funcion, ...c.args);
    return { ok: true, json: async () => datos };
  }
  const ctx = { document, fetch, console, JSON, Date, Math, Number, String, Array, Object, Promise, Proxy, Error, Uint8Array, TextDecoder,
    atob: s => Buffer.from(s, 'base64').toString('binary'), crypto: { randomUUID: () => 'id-' + Math.random() },
    sessionStorage: { getItem: k => almacen[k] ?? null, setItem: (k, v) => almacen[k] = v, removeItem: k => delete almacen[k] },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, confirm: () => true, prompt: () => null,
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout, clearTimeout, setInterval: () => 0, scrollTo() {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['api-web', undefined, 'mod-reportes'].forEach(n => vm.runInContext(scripts.find(s => s.id === n).src, ctx));
  return { ctx, $: id => document.getElementById(id), llamadas, run: c => vm.runInContext(c, ctx) };
}
const esperar = async (k = 30) => { for (let i = 0; i < k; i++) await new Promise(r => setImmediate(r)); };
(async () => {
  // ---- Cobranza: CxC y margen; nunca CxP ni flujo ----
  const T = montar('tania');
  await esperar();
  assert(!T.$('tabRep').classList.contains('oculto'), 'cobranza ve la pestaña Reportes');
  assert.deepEqual(plain(T.run('REPORTES.permitidos()')), ['cxc', 'margen']);
  T.run("verTab('rep')");
  await esperar();
  assert(!T.$('vistaRep').classList.contains('oculto'), 'se ve la pantalla');
  let h = T.$('vistaRep').innerHTML;
  assert(/Antigüedad de cuentas por cobrar/.test(h) && /Cliente Uno — Uno SA/.test(h) && /=Cliente Dos — Antenas SA/.test(h), 'CxC pintado');
  assert(/REPORTES\.ver\('margen'\)/.test(h) && !/REPORTES\.ver\('cxp'\)/.test(h) && !/REPORTES\.ver\('flujo'\)/.test(h), 'solo sus reportes');
  assert(/No vencido/.test(h) && /Más de 90 días/.test(h) && /Sin fecha/.test(h) && /class="tabla-desliza"/.test(h), 'rangos y tablas que se deslizan');
  assert(/Instalación: \$2,440\.00 MXN · /.test(h), 'la etapa con su fecha: ' + h.slice(0, 0));
  assert(T.llamadas.some(c => c.funcion === 'reporteCxc'));
  const csv = T.run("REPORTES.csv('cxc')");
  assert.equal(csv.charCodeAt(0), 0xFEFF, 'UTF-8 con BOM (Excel)');
  assert(csv.split('\r\n')[0].startsWith('﻿"Cliente","Folio","Proyecto","Línea de negocio","Moneda","No vencido","1–30 días"'), csv.split('\r\n')[0]);
  assert(/"'=Cliente Dos — Antenas SA"/.test(csv), 'texto que empieza con = va con apóstrofo');
  assert(/,"USD",0\.00,0\.00,0\.00,0\.00,348\.00,116\.00,464\.00,/.test(csv), 'USD en su renglón: ' + csv);
  T.run("REPORTES.ver('cxp')"); await esperar();
  assert(!T.llamadas.some(c => c.funcion === 'reporteCxp'), 'ni la pide');
  T.run("REPORTES.ver('margen')"); await esperar();
  h = T.$('vistaRep').innerHTML;
  assert(/Margen por proyecto/.test(h) && /Helgen Energy · MXN/.test(h) && /Por firmar/.test(h) && /Órdenes de compra/.test(h), 'margen pintado');
  assert(/"Folio","Proyecto","Cliente","Línea de negocio","Contrato","Moneda","Contratado sin IVA","Órdenes de compra","Total costos","Margen","Margen %","Nota"/.test(T.run("REPORTES.csv('margen')")));
  // Contexto de la sincronización: el reporte abierto
  assert.equal(plain(T.run('contextoSync()')).reporte, 'margen');
  // Fechas esperadas en la vista de Cobranza del proyecto
  T.run("verTab('cob')"); await esperar();
  assert(T.$('vistaRep').classList.contains('oculto'), 'al cambiar de pestaña se esconde');
  T.run('abrirProyectoCob(' + JSON.stringify(p2) + ')'); await esperar();
  const caja = T.$('cobFechas');
  assert(!caja.classList.contains('oculto') && /Fechas esperadas de cobro/.test(caja.innerHTML) && /id="cobFecha3" type="date"/.test(caja.innerHTML), 'bloque de fechas');
  assert(/Vencida hace 10 días/.test(caja.innerHTML) && /En 20 días/.test(caja.innerHTML), 'estado de cada etapa: ' + caja.innerHTML);
  assert.deepEqual([T.$('cobFecha1').value, T.$('cobFecha2').value, T.$('cobFecha3').value], [masDias(-10), masDias(20), masDias(40)]);
  T.$('cobFecha3').value = masDias(50);
  T.run('REPORTES.guardarFechas()'); await esperar();
  const g = T.llamadas.find(c => c.funcion === 'guardarFechasEsperadas');
  assert.deepEqual(g.args, [p2, [{ orden: 3, etapa: 'Encendido del sistema', fecha: masDias(50) }]], 'solo manda lo que cambió');
  assert(/Fechas esperadas de cobro guardadas/.test(T.$('aviso').innerHTML), T.$('aviso').innerHTML);
  assert.equal(ok('tania', 'getCobranzaProyecto', p2).esquema[2].fechaEsperada, masDias(50));
  T.run('REPORTES.guardarFechas()'); await esperar();
  assert(/no cambiaron/.test(T.$('aviso').innerHTML), 'sin cambios no llama al servidor');
  assert.equal(T.llamadas.filter(c => c.funcion === 'guardarFechasEsperadas').length, 1);
  // Proyecto sin contrato: sin bloque
  T.run('abrirProyectoCob(' + JSON.stringify(vacio) + ')'); await esperar();
  assert(T.$('cobFechas').classList.contains('oculto'));

  // ---- Compras: solo CxP ----
  const C = montar('pedro');
  await esperar();
  assert.deepEqual(plain(C.run('REPORTES.permitidos()')), ['cxp']);
  C.run("verTab('rep')"); await esperar();
  h = C.$('vistaRep').innerHTML;
  assert(/Antigüedad de cuentas por pagar/.test(h) && /Eléctrica del Centro/.test(h) && /Ardusimple SL/.test(h) && /Factura/.test(h) && /Sin factura: /.test(h), 'CxP pintado');
  assert(!/Cliente Uno|Contratado|Margen/.test(h), 'sin datos de contrato');
  assert(/"Proveedor","Orden de compra","Requisición","Proyecto","Moneda"/.test(C.run("REPORTES.csv('cxp')")));

  // ---- Super admin: los cuatro; el flujo ----
  const L = montar('leo');
  await esperar();
  assert.deepEqual(plain(L.run('REPORTES.permitidos()')), ['cxc', 'cxp', 'flujo', 'margen']);
  L.run("verTab('rep')"); await esperar();
  L.run("REPORTES.ver('flujo')"); await esperar();
  h = L.$('vistaRep').innerHTML;
  assert(/Flujo de efectivo · 13 semanas/.test(h) && /Incluye vencidos/.test(h) && /13 semanas/.test(h) && /Partidas \(/.test(h), 'flujo pintado');
  const csvF = L.run("REPORTES.csv('flujo')").split('\r\n');
  assert.equal(csvF.length, 1 + 2 * (13 + 2), 'por moneda: 13 semanas + sin fecha + después');

  // ---- Ventas: sin pestaña ----
  const V = montar('ana');
  await esperar();
  assert(V.$('tabRep').classList.contains('oculto'), 'sin reportes no ve la pestaña');
  assert.deepEqual(plain(V.run('REPORTES.permitidos()')), []);
  console.log('OK reportes (fecha esperada, CxC, CxP, flujo, margen, permisos, caché, interfaz)');
})().catch(e => { console.error(e); process.exit(1); });
