// Incremento 6 · módulo R (reportes) · revisión independiente 6b (30/10/2026): un caso por hallazgo. Cada sección reproduce
// el escenario de la revisión (fallaba antes del arreglo) y comprueba el comportamiento corregido:
//  1. Órdenes anteriores sin pago registrado (sin requisición, sin pago Vigente y sin factura; Recibidas o Emitidas de antes de las
//     requisiciones): no se pueden pagar ni cancelar, así que van en su propio bloque de la antigüedad de CxP (con cuántas son),
//     fuera de los totales y del flujo; su costo sigue en el margen.
//  4. Contratos desbloqueados (se firmaron, se desbloquearon y tienen pagos Vigentes): siguen en la antigüedad de CxC y en el flujo,
//     marcados "Desbloqueado"; uno aceptado sin firmar y sin pagos sigue fuera.
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

// ================= Servidor e interfaz: datos sembrados por la API (doPost) =================
const B = require('./arnes')(dir, { props: {
  ROL_COBRANZA: 'tania@helgen.tech, efrain@helgen.tech', ADMIN_DESBLOQUEO: 'efrain@helgen.tech', ROL_COMPRAS: 'pedro@helgen.tech',
  ROL_REQUISICION: 'obrero@helgen.tech', ROL_OPERACIONES: '' } });
B.P.exigirDocumentosParaPagar_ = function () {};
B.correr(`enviarCorreosPendientes_ = function () { MEMO_.correos = []; }; avisarPortal_ = function () { return ''; };`);
B.props.SUPER_ADMIN = 'leo@helgen.tech';
B.P.prepararCapri();
let nId = 0;
const id = p => (p || 'x') + (++nId);
const ok = B.ok;
const UNO = { nombre: 'Cliente Uno', empresa: 'Uno SA' };
const cot = (p, cliente, precio, extra) => ok('ana', 'guardarCotizacion', Object.assign({ cliente, items: [{ descripcion: 'Servicio', cantidad: 1, precio }],
  proyectoFolio: p, idSolicitud: id('c') }, extra || {})).folio;
const pry = (nombre, cliente) => ok('ana', 'crearProyecto', { nombre, ubicacion: 'Qro', cliente, idSolicitud: id('p') }).folio;
const firmar = (p, c) => { ok('tania', 'marcarAceptada', p, c, true); return ok('tania', 'firmarContrato', p, HOY_ISO); };
for (let i = 0; i < 6; i++) cot('', { nombre: 'Relleno' }, 1); // HLG-2026-0005 y 0006 son de prueba (FOLIOS_PRUEBA_REPORTES)
pry('Relleno', UNO); // PRY-2026-0001 es de prueba
const p1 = pry('Planta Norte', UNO);
firmar(p1, cot(p1, UNO, 10000));
const req = (p, d) => ok('obrero', 'guardarRequisicion', { proyectoFolio: p, renglones: [{ descripcion: d, cantidad: 1, unidad: 'pza' }],
  cotizacion: { nombre: 'c.pdf', datos: B.PDF }, idSolicitud: id('r') }).folio;
const autorizar = (r, costo, extra) => ok('pedro', 'autorizarRequisicion', r, Object.assign({ proveedor: { razonSocial: 'Eléctrica del Centro' },
  fechaEntrega: masDias(1), formaPago: 'Transferencia', condicionesPago: 'Contado', diasCredito: 0, ivaTasa: 0.16,
  renglones: [{ descripcion: 'Material', unidad: 'PZA', cantidad: 1, costo }], idSolicitud: id('o') }, extra || {})).ocFolio;
const LO = () => B.libros[B.props.COMPRAS_DB_ID].pest.OrdenesCompra.m;
const detalleDe = r => r.grupos.reduce((a, g) => a.concat(g.detalle), []);
const L1 = 'OC-' + B.ANIO + '-0900', L2 = 'OC-' + B.ANIO + '-0901'; // órdenes anteriores sembradas (sección 1)

// ================= 1. Órdenes anteriores sin pago registrado =================
{
  // Lógica pura: sin requisición, sin pago Vigente y sin factura Vigente = anterior; con cualquiera de los tres, deuda normal
  const vieja = OC('OC-V', 1160, { reqFolio: '', estado: 'Recibida', fecha: masDias(-60), fechaRecepcion: masDias(-40) });
  const emitida = OC('OC-E', 580, { reqFolio: '', estado: 'Emitida' });
  const conFactura = OC('OC-F', 580, { reqFolio: '' });
  const conPago = OC('OC-G', 1160, { reqFolio: '' });
  const conReq = OC('OC-N', 116);
  const d1 = datos([vieja, emitida, conFactura, conPago, conReq], [PGP('OC-G', 100), PGP('OC-V', 1160, { estado: 'Cancelado' })],
    [FPR('FPR-F', 'OC-F', 580, masDias(-1)), FPR('FPR-X', 'OC-V', 1160, masDias(-1), { estado: 'Cancelada' })]);
  const pp = plain(P.porPagarProveedores(d1, P.saldoOrdenCompra));
  assert.deepEqual([...new Set(pp.map(x => x.ocFolio))], ['OC-F', 'OC-G', 'OC-N'], 'las anteriores sin pago no son deuda que se pueda pagar');
  assert.deepEqual([vieja, emitida, conFactura, conPago, conReq].map(o => P.esOrdenAnteriorSinPago(o,
    d1.pagosProv.filter(p => p.ocFolio === o.folio), d1.facturas.filter(f => f.ocFolio === o.folio))), [true, true, false, false, false]);
  const ag = plain(P.antiguedadPorPagar(d1, P.saldoOrdenCompra));
  assert.deepEqual([ag.anteriores.n, ag.anteriores.ordenes.map(o => o.ocFolio), ag.anteriores.totales], [2, ['OC-V', 'OC-E'],
    [{ moneda: 'MXN', ordenes: 2, total: 1740 }]], 'su propio bloque, con cuántas son');
  assert.equal(ag.totales[0].total, 580 + 1060 + 116, 'fuera de los totales');
  assert.equal(P.esOrdenAnteriorSinPago(OC('OC-C', 1, { reqFolio: '', estado: 'Cancelada' }), [], []), false, 'una cancelada no se lista');
  assert.equal(plain(P.ordenesAnterioresSinPago(Object.assign({}, d1, { prueba: ['PRY-9-0002'] }))).n, 0, 'las de prueba tampoco');

  // Por la API: una Recibida y una Emitida de antes de las requisiciones (escritas como lo hacía la fase 3)
  const oc1 = autorizar(req(p1, 'Cable'), 1000); // deuda normal
  const enc = LO()[0], base = LO().find(r => r[0] === oc1);
  const legado = (folio, estado, recepcion) => {
    const f = base.slice();
    f[enc.indexOf('folio')] = folio; f[enc.indexOf('estado')] = estado; f[enc.indexOf('req_folio')] = '';
    f[enc.indexOf('fecha_recepcion')] = recepcion || '';
    LO().push(f);
  };
  legado(L1, 'Recibida', masDias(-7)); legado(L2, 'Emitida');
  B.P.subirVersiones_(['oc']);
  B.falla('pedro', 'registrarPagoProveedor', [{ ocFolio: L1, fecha: HOY_ISO, monto: 1160, monedaPago: '', metodo: 'Transferencia', referencia: 'X',
    comprobante: { nombre: 'p.pdf', datos: B.PDF }, idSolicitud: id('pg') }], /requisición/);
  B.falla('pedro', 'cancelarOrdenCompra', [L1, 'Se pagó fuera de CAPRI'], /ya se recibió/);
  const rp = ok('pedro', 'reporteCxp');
  assert.deepEqual(detalleDe(rp).map(x => x.ocFolio), [oc1], 'en la antigüedad solo la deuda que se puede pagar');
  assert.deepEqual([rp.anteriores.n, rp.anteriores.ordenes.map(o => o.ocFolio + ' ' + o.estado)], [2, [L1 + ' Recibida', L2 + ' Emitida']]);
  assert.deepEqual(rp.totales.map(t => t.moneda + ' ' + t.total), ['MXN 1160']);
  const rf = ok('leo', 'reporteFlujo');
  assert(!rf.partidas.some(p => p.folio === L1 || p.folio === L2), 'fuera del flujo');
  assert.equal(rf.ordenesAnteriores, 2, 'el flujo dice cuántas quedaron fuera');
  const rm = ok('tania', 'reporteMargen').proyectos.find(x => x.folio === p1);
  assert.equal(rm.totalCostos, 3000, 'su costo sigue en el margen (1000 + 2 × 1000)');
  assert.equal(rm.totalCostos, ok('tania', 'getCobranzaProyecto', p1).margen.totalCostos, 'igual que la tarjeta de margen');
}

// ================= 4. Contratos desbloqueados con pagos =================
{
  // Lógica pura: Aceptada con un pago Vigente = desbloqueado (cuenta y va marcado); sin pagos o solo con pagos cancelados, fuera
  const PRY = folio => ({ folio, folioVisible: folio, nombre: 'Proyecto ' + folio, cliente: 'Cliente', clienteId: 'C1', estado: 'Activo' });
  const CON = (folio, estado) => ({ proyectoFolio: folio, cotizacion: 'HLG-' + folio, marca: 'helgen', moneda: 'MXN', subtotal: 1000, total: 1160, estado });
  const PAG = (folio, montoAplicado, estado) => ({ proyectoFolio: folio, montoAplicado, etapaOrden: 1, estado: estado || 'Vigente', fecha: HOY_ISO });
  const dc = { hoy: HOY_ISO, prueba: [], esquemas: [],
    proyectos: ['PRY-9-0011', 'PRY-9-0012', 'PRY-9-0013', 'PRY-9-0014'].map(PRY),
    contratos: [CON('PRY-9-0011', 'Firmado'), CON('PRY-9-0012', 'Aceptada'), CON('PRY-9-0013', 'Aceptada'), CON('PRY-9-0014', 'Aceptada')],
    pagos: [PAG('PRY-9-0011', 100), PAG('PRY-9-0012', 500), PAG('PRY-9-0014', 500, 'Cancelado')] };
  assert.deepEqual(plain(P.etapasPorCobrar(dc)).map(x => [x.proyectoFolio, x.monto, x.desbloqueado]),
    [['PRY-9-0011', 1060, false], ['PRY-9-0012', 660, true]], 'el desbloqueado con pagos se sigue cobrando; por firmar sin pagos, fuera');
  assert.deepEqual(plain(P.antiguedadCxc(dc)).grupos[0].detalle.map(x => x.folio + ' ' + x.desbloqueado), ['PRY-9-0011 false', 'PRY-9-0012 true']);
  assert.deepEqual(plain(P.flujoSemanal({ hoy: HOY_ISO, cobros: P.etapasPorCobrar(dc), pagos: [] })).partidas.map(p => p.folio + ' ' + p.desbloqueado).sort(),
    ['PRY-9-0011 false', 'PRY-9-0012 true']);

  // Por la API: firmado, con un pago, desbloqueado
  const p2 = pry('Terminal Sur', UNO);
  firmar(p2, cot(p2, UNO, 1000));
  const etapa1 = ok('tania', 'getCobranzaProyecto', p2).esquema[0].etapa;
  ok('tania', 'guardarFechasEsperadas', p2, [{ orden: 1, etapa: etapa1, fecha: masDias(3) }]);
  ok('tania', 'registrarPago', { proyectoFolio: p2, fecha: HOY_ISO, monto: 500, metodo: 'Transferencia', referencia: 'SPEI 500', etapaOrden: 1,
    comprobante: { datos: B.PDF }, idSolicitud: id('g') });
  const enCxc = () => detalleDe(ok('tania', 'reporteCxc')).filter(x => x.folio === p2).map(x => x.total + ' ' + x.desbloqueado);
  assert.deepEqual(enCxc(), ['660 false']);
  ok('efrain', 'desbloquearContrato', p2, 'Se firmó con la cotización equivocada');
  assert.equal(ok('tania', 'getCobranzaProyecto', p2).contrato.estado, 'Aceptada');
  assert.deepEqual(enCxc(), ['660 true'], 'desbloqueado con pagos: sigue en CxC, marcado (antes desaparecía)');
  const cobroP2 = ok('leo', 'reporteFlujo').partidas.filter(p => p.tipo === 'cobro' && p.folio === ok('tania', 'getCobranzaProyecto', p2).proyecto.folioVisible);
  assert.deepEqual(cobroP2.map(p => p.monto + ' ' + p.fecha + ' ' + p.desbloqueado), ['196 ' + masDias(3) + ' true', '348  true', '116  true'],
    'y en el flujo (esquema 60/30/10: 696 − 500, 348 y 116 sin fecha)');
  // Una aceptada sin firmar y sin pagos sigue fuera
  const p4 = pry('Por firmar', UNO);
  ok('tania', 'marcarAceptada', p4, cot(p4, UNO, 2000), true);
  assert(!detalleDe(ok('tania', 'reporteCxc')).some(x => x.folio === p4), 'por firmar sin pagos: fuera');
}

// ================= Interfaz (mod-reportes sobre la app, conectada al servidor simulado) =================
const vm = require('vm');
const html = fs.readFileSync(path.join(dir, 'web/cotizador/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?: id="([^"]*)")?>([\s\S]*?)<\/script>/g)].map(m => ({ id: m[1], src: m[2] }));
function montar(quien) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = 'h.' + b64({ email: quien + '@helgen.tech', given_name: quien, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.f';
  function elemento(tag) {
    const e = { tag, value: '', textContent: '', className: '', title: '', src: '', placeholder: '', disabled: false, hijos: [], oyentes: {}, _clases: new Set(), porClase: {},
      classList: { add: c => e._clases.add(c), remove: c => e._clases.delete(c), contains: c => e._clases.has(c), toggle: (c, f) => f ? e._clases.add(c) : e._clases.delete(c) },
      addEventListener: (t, f) => (e.oyentes[t] = e.oyentes[t] || []).push(f), focus() {}, remove() {}, click() {}, appendChild: h => e.hijos.push(h),
      prepend: h => e.hijos.unshift(h), contains: () => false,
      querySelector: sel => e.porClase[sel] || (e.porClase[sel] = elemento('input')), querySelectorAll: sel => sel === 'tr' ? e.hijos : [] };
    let h = ''; Object.defineProperty(e, 'innerHTML', { get: () => h, set: v => { h = v; if (v === '') e.hijos.length = 0; } });
    return e;
  }
  const porId = {}, oyentesDoc = {};
  const document = { getElementById: i => porId[i] || (porId[i] = elemento('div')), querySelector: () => ({ src: 'data:logo' }), createElement: t => elemento(t),
    visibilityState: 'visible', activeElement: null, body: elemento('body'),
    addEventListener: (t, f) => (oyentesDoc[t] = oyentesDoc[t] || []).push(f), dispatchEvent: ev => (oyentesDoc[ev.type] || []).forEach(f => f(ev)) };
  document.getElementById('login').classList.add('oculto');
  ['tabCob', 'tabCom', 'tabRep', 'vistaRep', 'cobFechas'].forEach(i => document.getElementById(i).classList.add('oculto'));
  const almacen = { cotizadorHelgenSesion: token };
  async function fetch(url, o) { const c = JSON.parse(o.body); const r = B.post(quien, c.funcion, ...c.args); return { ok: true, json: async () => r }; }
  const ctx = { document, fetch, console, JSON, Date, Math, Number, String, Array, Object, Promise, Proxy, Error, Uint8Array, TextDecoder,
    atob: x => Buffer.from(x, 'base64').toString('binary'), crypto: { randomUUID: () => 'id-' + Math.random() },
    sessionStorage: { getItem: k => almacen[k] ?? null, setItem: (k, v) => almacen[k] = v, removeItem: k => delete almacen[k] },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, confirm: () => true, prompt: () => null,
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } }, setTimeout, clearTimeout, setInterval: () => 0, scrollTo() {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['api-web', undefined, 'mod-reportes'].forEach(n => vm.runInContext(scripts.find(x => x.id === n).src, ctx));
  return { $: i => document.getElementById(i), run: c => vm.runInContext(c, ctx) };
}
const esperar = async (k = 30) => { for (let i = 0; i < k; i++) await new Promise(r => setImmediate(r)); };
(async () => {
  // 1. El bloque de órdenes anteriores en la antigüedad de CxP (con cuántas son) y en su CSV; la nota en el flujo
  const C = montar('pedro'); await esperar();
  C.run("verTab('rep')"); await esperar();
  let h = C.$('vistaRep').innerHTML;
  assert(/Órdenes anteriores sin pago registrado \(2\)/.test(h) && /No entran a los totales/.test(h), 'bloque aparte con cuántas son');
  const csv = C.run("REPORTES.csv('cxp')").split('\r\n');
  assert(/"Nota"$/.test(csv[0]), 'columna Nota');
  assert.equal(csv.filter(l => /Orden anterior sin pago registrado \(fuera de los totales\)/.test(l)).length, 2);
  const L = montar('leo'); await esperar();
  L.run("verTab('rep')"); await esperar();
  L.run("REPORTES.ver('flujo')"); await esperar();
  assert(/No incluye 2 órdenes anteriores sin pago registrado/.test(L.$('vistaRep').innerHTML), 'el flujo lo dice');
  // 4. El chip "Desbloqueado" en CxC y en las partidas del flujo; columna "Contrato" en el CSV de CxC
  assert(/Desbloqueado<\/span>/.test(L.$('vistaRep').innerHTML), 'partida del flujo marcada');
  const T = montar('tania'); await esperar();
  T.run("verTab('rep')"); await esperar();
  T.run("REPORTES.ver('cxc')"); await esperar();
  assert(/title="Se firmó, se desbloqueó y ya tiene pagos: se sigue cobrando">Desbloqueado/.test(T.$('vistaRep').innerHTML), 'proyecto marcado en CxC');
  const csvC = T.run("REPORTES.csv('cxc')").split('\r\n');
  assert(/"Etapas por cobrar","Contrato"$/.test(csvC[0]), csvC[0]);
  assert.deepEqual(csvC.slice(1).map(l => (/Terminal Sur/.test(l) ? 'p2 ' : 'otro ') + l.match(/"(\w+)"$/)[1]).sort(), ['otro Firmado', 'p2 Desbloqueado'],
    'Firmado o Desbloqueado por renglón');
  // La Emitida anterior sí se puede cancelar (sale del bloque); la Recibida no (se queda, aparte)
  ok('pedro', 'cancelarOrdenCompra', L2, 'Orden anterior que nunca se surtió', true);
  assert.deepEqual(ok('pedro', 'reporteCxp').anteriores.ordenes.map(o => o.ocFolio), [L1]);
  console.log('OK revisión 6b de reportes');
})().catch(e => { console.error(e); process.exit(1); });
