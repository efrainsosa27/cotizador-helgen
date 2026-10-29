// Incremento 4 · módulo E (Anular): un super admin anula cualquier registro con folio y lo que depende de él. Cubre: solo
// super admin, motivo ≥ 10, idempotencia, vista previa = efecto, cada cascada (pago de cliente, pago a proveedor, factura,
// orden → pagos/facturas/recepciones con la requisición de vuelta, contrato → esquema y pagos, cotización aceptada →
// contrato → pagos, recepción → la orden espera material, requisición → órdenes, proyecto → todo y su carpeta), totales antes
// y después (resumen de cobranza, margen y cuentas por pagar, por moneda), listas que esconden lo anulado, avisos (notificar_)
// a los involucrados, avisarPortal_ por cada orden, archivos renombrados, filas en Anulaciones y Bitacoras, lista de anulados
// y sincronización. Datos sembrados por la API (doPost), como las demás pruebas.
// Uso: node tests/anular.test.js .
'use strict';
const assert = require('assert');
const dir = process.argv[2] || '.';
const A = require('./arnes')(dir, { props: {
  ROL_COBRANZA: 'efrain@helgen.tech, tania@helgen.tech', ADMIN_DESBLOQUEO: 'efrain@helgen.tech',
  ROL_COMPRAS: 'efrain@helgen.tech, pedro@helgen.tech', ROL_REQUISICION: 'obrero@helgen.tech, rosa@helgen.tech, pedro@helgen.tech',
  SOLO_REQUISICION: 'adri@helgen.tech', ROL_OPERACIONES: '' } });
const { P, ok, falla, plain, props, libros, archivos, carpetas, HOY_ISO, masDias, correr, ANIO, PDF } = A;
const MANANA = masDias(1);
const JPG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]).toString('base64');
let nId = 0;
const id = p => (p || 'x') + (++nId);

// ================= Lógica pura =================
assert.deepEqual(plain(P.folioParaAnular(' hlg-2026-0007 ')), { clave: 'cotizacion', folio: 'HLG-2026-0007' });
assert.deepEqual(plain(P.folioParaAnular('PRY-2026-0002-DRO')), { clave: 'proyecto', folio: 'PRY-2026-0002' }, 'el folio con clave se guarda corto');
assert.deepEqual(plain(P.folioParaAnular('contrato  pry-2026-0002-dro')), { clave: 'contrato', folio: 'CONTRATO PRY-2026-0002', proyectoFolio: 'PRY-2026-0002' });
for (const [f, c] of [['PAG-2026-0001', 'pago'], ['REQ-2026-0001', 'req'], ['OC-2026-0001', 'oc'], ['PGP-2026-0001', 'pgp'],
  ['FPR-2026-0001', 'fpr'], ['REC-2026-0001', 'rec'], ['COT-2026-0001', 'cotizacion']]) assert.equal(P.folioParaAnular(f).clave, c, f);
assert.throws(() => P.folioParaAnular('XYZ'), /Escribe un folio/);
assert.throws(() => P.folioParaAnular(''), /Escribe un folio/);
assert.throws(() => P.folioParaAnular('CONTRATO OC-2026-0001'), /CONTRATO PRY-AAAA-NNNN/);
assert.equal(P.idDeUrlDrive('https://drive.google.com/file/d/1AbC-dEf_123/view?usp=drivesdk'), '1AbC-dEf_123');
assert.equal(P.idDeUrlDrive('https://drive.google.com/open?id=1XyZ'), '1XyZ');
assert.equal(P.idDeUrlDrive('https://drive/file/A12'), 'A12');
assert.equal(P.idDeUrlDrive(''), '');
assert.equal(P.jsonCelda({ a: 1 }), '{"a":1}');
const largo = P.jsonCelda({ propuesta: 'x'.repeat(60000), b: 2 });
assert(largo.length < 50000 && JSON.parse(largo).b === 2 && /recortado/.test(JSON.parse(largo).propuesta), 'textos largos se recortan');
assert(JSON.parse(P.jsonCelda(Array.from({ length: 200 }, () => 'y'.repeat(1000)))).recortado, 'si aun así no cabe');
assert.equal(P.ocVigente({ estado: 'Emitida' }), true);
assert.equal(P.ocVigente({ estado: 'Cancelada' }), false);
assert.equal(P.ocVigente({ estado: 'Anulada' }), false);
assert.equal(P.ocVigente(null), false);
// Totales puros: una orden anulada no cuenta en el margen del resumen
const rg = P.resumenGeneralCobranza({ contratos: [{ proyectoFolio: 'PRY-1', cotizacion: 'HLG-1', marca: 'helgen', moneda: 'MXN', subtotal: 1000, total: 1160, estado: 'Firmado' }],
  esquemas: [], pagos: [], proyectos: [{ folio: 'PRY-1', estado: 'Activo' }],
  ordenes: [{ proyectoFolio: 'PRY-1', estado: 'Emitida', monedaProyecto: 'MXN', subtotalProyecto: 100 }, { proyectoFolio: 'PRY-1', estado: 'Anulada', monedaProyecto: 'MXN', subtotalProyecto: 500 }] });
assert.deepEqual([rg.totales[0].costoOc, rg.totales[0].margen], [100, 900]);
// Cuentas por pagar puras: la factura vigente de una orden anulada no se debe
const cx = P.antiguedadCxp({ hoy: HOY_ISO, facturas: [{ folio: 'FPR-1', ocFolio: 'OC-1', moneda: 'MXN', subtotal: 10, total: 11.6, fechaVencimiento: HOY_ISO, estado: 'Vigente' }],
  ordenes: [{ folio: 'OC-1', estado: 'Anulada', moneda: 'MXN', subtotal: 10 }], pagos: [] });
assert.deepEqual([cx.abiertas.length, cx.faltantes.length], [0, 0]);

// ================= Servidor =================
// Avisos y centro de mando: se capturan (los implementan los módulos B y C)
correr(`var CAPTURA = { avisos: [], portal: [] };
  enviarCorreosPendientes_ = function () { CAPTURA.avisos.push.apply(CAPTURA.avisos, MEMO_.correos || []); MEMO_.correos = []; };
  avisarPortal_ = function (tipo, folio) { CAPTURA.portal.push([tipo, folio]); };`);
const CAP = () => plain(correr('CAPTURA'));
const limpiarCaptura = () => correr('CAPTURA.avisos = []; CAPTURA.portal = [];');

// Sin libro de Administración no se anula (no se crea a escondidas: cambiaría de dónde salen los roles)
props.SUPER_ADMIN = 'leo@helgen.tech';
falla('leo', 'previsualizarAnulacion', ['HLG-' + ANIO + '-0001'], /prepararCapri/);
P.prepararCapri();
const LA = libros[props.ADMIN_DB_ID];
const H = (L, n) => L.pest[n].m;

// ---- Datos: dos proyectos (MXN y USD), contratos firmados y pagos; requisiciones con órdenes, pagos y facturas ----
const pry = (nombre, cliente) => ok('ana', 'crearProyecto', { nombre, ubicacion: 'Qro', cliente: { nombre: cliente, empresa: cliente + ' SA' }, idSolicitud: id('p') });
const p1o = pry('Planta Norte', 'Cliente Uno'), p2o = pry('Terminal Sur', 'Cliente Dos');
const p1 = p1o.folio, p2 = p2o.folio;
const cot = (proyectoFolio, cliente, precio, moneda) => ok('ana', 'guardarCotizacion', { cliente: { nombre: cliente, empresa: cliente + ' SA' },
  items: [{ descripcion: 'Servicio', cantidad: 1, precio }], proyectoFolio, moneda, idSolicitud: id('c') }).folio;
const c1 = cot(p1, 'Cliente Uno', 10000), c1b = cot(p1, 'Cliente Tres', 500), c2 = cot(p2, 'Cliente Dos', 1000, 'USD');
ok('tania', 'marcarAceptada', p1, c1, true); ok('tania', 'firmarContrato', p1, HOY_ISO);
ok('tania', 'marcarAceptada', p2, c2, true); ok('tania', 'firmarContrato', p2, HOY_ISO);
const pagar = (proyectoFolio, monto) => ok('tania', 'registrarPago', { proyectoFolio, fecha: HOY_ISO, monto, metodo: 'Transferencia',
  referencia: 'SPEI ' + monto, etapaOrden: 1, comprobante: { datos: PDF }, idSolicitud: id('g') }).folio;
const pag1 = pagar(p1, 1000), pag1b = pagar(p1, 600), pag2 = pagar(p2, 116);

const req = (proyectoFolio, descripcion) => ok('obrero', 'guardarRequisicion', { proyectoFolio, renglones: [{ descripcion, cantidad: 1, unidad: 'pza' }],
  cotizacion: { nombre: 'c.pdf', datos: PDF }, idSolicitud: id('r') }).folio;
const autorizar = (folio, costo) => ok('pedro', 'autorizarRequisicion', folio, { proveedor: { razonSocial: 'Eléctrica del Centro' },
  fechaEntrega: MANANA, condicionesPago: 'Contado', diasCredito: 0, ivaTasa: 0.16,
  renglones: [{ descripcion: 'Material', unidad: 'PZA', cantidad: 1, costo }], idSolicitud: id('o') }).ocFolio;
const pagarProv = (reqFolio, monto) => ok('pedro', 'registrarPagoProveedor', { reqFolio, fecha: HOY_ISO, monto, monedaPago: '', metodo: 'Transferencia',
  referencia: 'SPEI', comprobante: { nombre: 'p.pdf', datos: PDF }, idSolicitud: id('pg') }).folio;
const facturar = (ocFolio, numero, subtotal, moneda) => ok('pedro', 'registrarFacturaProveedor', { ocFolio, tipo: 'Extranjera', numero, fecha: HOY_ISO,
  moneda: moneda || 'MXN', subtotal, impuestos: Math.round(subtotal * 16) / 100, pdf: { nombre: 'f.pdf', datos: PDF }, idSolicitud: id('f') }).folio;
const r1 = req(p1, 'Cable'), oc1 = autorizar(r1, 1000), pgp1 = pagarProv(r1, 1160);
ok('obrero', 'cerrarRequisicion', r1, 'Todo bien');
const r2 = req(p1, 'Tubo'), oc2 = autorizar(r2, 2000), fpr1 = facturar(oc2, 'F-100', 2000);
const r3 = req(p2, 'Antena'), oc3 = autorizar(r3, 50);
const LC = libros[props.COBRANZA_DB_ID], LO = libros[props.COMPRAS_DB_ID];
const fila = (L, hoja, folio) => H(L, hoja).find(r => String(r[0]) === folio);

// ---- Totales antes ----
const resumen = () => ok('tania', 'resumenCobranzaGeneral');
const tot = (r, m) => r.totales.find(t => t.moneda === m) || null;
let rs = resumen();
assert.deepEqual([tot(rs, 'MXN').contratado, tot(rs, 'MXN').cobrado, tot(rs, 'MXN').porCobrar, tot(rs, 'MXN').costoOc, tot(rs, 'MXN').margen],
  [11600, 1600, 10000, 3000, 7000]);
assert.deepEqual([tot(rs, 'USD').contratado, tot(rs, 'USD').cobrado, tot(rs, 'USD').costoOc, tot(rs, 'USD').margen], [1160, 116, 50, 950]);
assert.equal(ok('tania', 'getCobranzaProyecto', p1).margen.margen, 7000);
let cxp = ok('pedro', 'cuentasPorPagar');
assert.deepEqual([tot(cxp, 'MXN').total, cxp.abiertas.map(a => a.folio).join(), cxp.faltantes.map(x => x.folio).sort().join()],
  [2320, fpr1, [oc1, oc3].sort().join()]);

// ---- Solo super admin; motivo; folio ----
for (const quien of ['efrain', 'obrero', 'tania']) {
  falla(quien, 'previsualizarAnulacion', [pag1b], /Solo un super admin/, 'PERMISO');
  falla(quien, 'anular', [pag1b, 'Motivo suficientemente largo'], /Solo un super admin/, 'PERMISO');
  falla(quien, 'listarAnulados', [''], /Solo un super admin/, 'PERMISO');
}
falla('adri', 'anular', [pag1b, 'Motivo suficientemente largo'], /solo tiene acceso a Requisiciones/, 'PERMISO');
falla('leo', 'anular', [pag1b, 'corto'], /al menos 10 caracteres/);
falla('leo', 'anular', [pag1b, '          '], /al menos 10 caracteres/);
falla('leo', 'anular', [pag1b, 'x'.repeat(501)], /máximo 500/);
falla('leo', 'previsualizarAnulacion', ['XYZ'], /Escribe un folio/);
falla('leo', 'previsualizarAnulacion', ['PAG-' + ANIO + '-9999'], /No existe el pago/);
falla('leo', 'previsualizarAnulacion', ['HLG-' + ANIO + '-9999'], /No existe la cotización/);
falla('leo', 'previsualizarAnulacion', ['CONTRATO PRY-' + ANIO + '-0099'], /No existe el proyecto/);
assert.deepEqual(ok('leo', 'listarAnulados', ''), []);

const MOTIVO = 'Registro duplicado por error de captura';
const igualAVistaPrevia = (prev, res) => {
  const quitar = x => { const y = plain(x); delete y.fallas; delete y.anulados; return y; };
  assert.deepEqual(quitar(res), quitar(prev), 'la vista previa es exactamente lo que se anula');
};
const filasAnul = () => H(LA, 'Anulaciones').slice(1);
const nombre = idArchivo => archivos[idArchivo].nombre;

// ===== 1. Pago de cliente (solo) =====
let prev = ok('leo', 'previsualizarAnulacion', pag1b.toLowerCase());
assert.deepEqual(prev.registros.map(r => r.tipo + ':' + r.folio), ['Pago de cliente:' + pag1b]);
assert(/se recalculan sin/.test(prev.efectos.join()) && /no mueve dinero/.test(prev.avisos.join()), JSON.stringify(prev));
assert.equal(prev.archivos, 1);
assert.equal(fila(LC, 'Pagos', pag1b)[18], 'Vigente', 'la vista previa no cambia nada');
let res = ok('leo', 'anular', pag1b, MOTIVO, 'anu-pag');
igualAVistaPrevia(prev, res);
assert.deepEqual(res.fallas, []);
let fp = fila(LC, 'Pagos', pag1b);
assert.deepEqual([fp[18], fp[19], fp[21]], ['Anulada', 'leo@helgen.tech', 'Anulada: ' + MOTIVO]);
assert(nombre(fp[14]).startsWith('ANULADA — ' + pag1b), nombre(fp[14]));
rs = resumen();
assert.deepEqual([tot(rs, 'MXN').cobrado, tot(rs, 'MXN').porCobrar], [1000, 10600], 'el pago anulado deja de contar');
let vc = ok('tania', 'getCobranzaProyecto', p1);
assert.deepEqual([vc.pagos.map(x => x.folio).join(), vc.resumen.pagado], [pag1, 1000]);
falla('tania', 'cancelarPago', [pag1b, 'Ya no aplica el pago'], /está anulado/);
// Anulaciones, Bitacoras y aviso
assert.equal(filasAnul().length, 1);
let fa = filasAnul()[0];
assert.deepEqual([fa[1], fa[2], fa[3], fa[4]], ['leo@helgen.tech', 'Pago de cliente', pag1b, MOTIVO]);
assert.equal(JSON.parse(fa[5]).raiz, true);
assert.equal(JSON.parse(fa[6]).valores[0], pag1b, 'copia de cómo estaba');
assert.equal(JSON.parse(fa[6]).valores[18], 'Vigente');
assert.deepEqual(H(LC, 'Bitacora').at(-1).slice(1, 4), ['leo@helgen.tech', 'Anular pago', p1]);
assert.deepEqual(H(LA, 'Bitacora').at(-1).slice(2, 4), ['Anular pago de cliente', pag1b]);
let av = CAP().avisos.filter(a => a.tipo === 'anulado');
assert.equal(av.length, 1);
assert.deepEqual([av[0].datos.folio, av[0].datos.tipo, av[0].datos.motivo, av[0].datos.cascada.length], [pag1b, 'Pago de cliente', MOTIVO, 1]);
assert(av[0].datos.para.includes('tania@helgen.tech'), 'quien lo registró');
assert(!/1,?000|600/.test(JSON.stringify(av[0].datos)), 'el aviso no lleva montos');
// Idempotencia y "ya está anulado"
limpiarCaptura();
assert.deepEqual(plain(ok('leo', 'anular', pag1b, MOTIVO, 'anu-pag')), plain(res), 'mismo idSolicitud → misma respuesta');
assert.equal(filasAnul().length, 1, 'no se duplica');
falla('leo', 'anular', [pag1b, MOTIVO], /ya está anulado/);
falla('leo', 'previsualizarAnulacion', [pag1b], /ya está anulado/);

// ===== 2. Pago a proveedor de una requisición cerrada (flujo de siempre) → la orden se puede pagar otra vez =====
prev = ok('leo', 'previsualizarAnulacion', pgp1);
assert.deepEqual(prev.registros.map(r => r.folio), [pgp1]);
assert(/pasa de Recibida a Emitida/.test(prev.efectos[0]) && /pasa de Cerrada a Recibida/.test(prev.efectos[0]), prev.efectos[0]);
res = ok('leo', 'anular', pgp1, MOTIVO, id('a'));
igualAVistaPrevia(prev, res);
assert.deepEqual([fila(LO, 'PagosProveedores', pgp1)[17], fila(LO, 'OrdenesCompra', oc1)[28], fila(LO, 'Requisiciones', r1)[5]],
  ['Anulada', 'Emitida', 'Recibida']);
let vr = ok('pedro', 'getRequisicion', r1);
assert.deepEqual([vr.requisicion.estado, vr.orden.estado, vr.puedePagar, vr.pagos.length], ['Recibida', 'Emitida', true, 0]);
assert.equal(CAP().portal.length, 0, 'anular un pago no avisa al centro de mando');
const pgp1b = pagarProv(r1, 1160);
vr = ok('pedro', 'getRequisicion', r1);
assert.deepEqual([vr.requisicion.estado, vr.orden.estado, vr.pagos.map(x => x.folio).join()], ['Cerrada', 'Recibida', pgp1b], 'se volvió a pagar');
assert(/\(2\)/.test(nombre(fila(LO, 'PagosProveedores', pgp1b)[13])), 'el nombre del comprobante cuenta el anulado');
assert(pgp1b > pgp1, 'el folio no se reusa');
assert(/Anulada: /.test(fila(LO, 'PagosProveedores', pgp1)[20]));
assert.deepEqual(H(LO, 'Bitacora').filter(b => b[2] === 'Anular pago a proveedor').length, 1);

// ===== 3. Factura de proveedor (sola) → cuentas por pagar =====
prev = ok('leo', 'previsualizarAnulacion', fpr1);
assert(/cuentas por pagar de/.test(prev.efectos.join()));
res = ok('leo', 'anular', fpr1, MOTIVO, id('a'));
igualAVistaPrevia(prev, res);
cxp = ok('pedro', 'cuentasPorPagar');
assert.deepEqual([tot(cxp, 'MXN'), cxp.abiertas.length, cxp.faltantes.map(x => x.folio).sort().join()], [null, 0, [oc1, oc2, oc3].sort().join()],
  'sin la factura, a la orden le falta factura otra vez');
let vcom = ok('pedro', 'getComprasProyecto', p1);
assert.deepEqual(vcom.ordenes.find(o => o.folio === oc2).facturas, [], 'la factura anulada no se ve');
assert(nombre(fila(LO, 'FacturasProveedor', fpr1)[25]).startsWith('ANULADA — '));
falla('pedro', 'cancelarFacturaProveedor', [fpr1, 'Factura equivocada'], /está anulada/);
const fpr2 = facturar(oc2, 'F-100', 2000); // el mismo número se puede registrar otra vez: la anulada no cuenta
assert.equal(tot(ok('pedro', 'cuentasPorPagar'), 'MXN').total, 2320);

// ===== 4. Orden de compra con factura (flujo de siempre) → su requisición vuelve a Solicitada =====
limpiarCaptura();
prev = ok('leo', 'previsualizarAnulacion', oc2);
assert.deepEqual(prev.registros.map(r => r.tipo + ':' + r.folio), ['Orden de compra:' + oc2, 'Factura de proveedor:' + fpr2]);
assert(new RegExp(r2 + ' \\(Autorizada\\) vuelve a Solicitada').test(prev.efectos[0]), prev.efectos[0]);
assert(/centro de mando ya recibió se queda ahí/.test(prev.avisos.join()), 'aviso del material en el centro de mando');
res = ok('leo', 'anular', oc2, MOTIVO, id('a'));
igualAVistaPrevia(prev, res);
assert.deepEqual([fila(LO, 'OrdenesCompra', oc2)[28], fila(LO, 'FacturasProveedor', fpr2)[29], fila(LO, 'Requisiciones', r2)[5], fila(LO, 'Requisiciones', r2)[9]],
  ['Anulada', 'Anulada', 'Solicitada', '']);
assert.deepEqual(CAP().portal, [['oc.cancelada', oc2]]);
av = CAP().avisos.find(a => a.tipo === 'anulado');
assert(av.datos.para.includes('obrero@helgen.tech') && av.datos.para.includes('pedro@helgen.tech'), 'quien pidió y quien registró: ' + av.datos.para);
assert.deepEqual(av.datos.cascada.map(x => x.folio), [oc2, fpr2]);
vr = ok('pedro', 'getRequisicion', r2);
assert.deepEqual([vr.requisicion.estado, vr.orden, vr.puedeAutorizar], ['Solicitada', null, true]);
assert.equal(vr.eventos.at(-1).nota, 'Se anuló la orden de compra; queda pendiente de autorizar de nuevo.');
assert.equal(ok('tania', 'getCobranzaProyecto', p1).margen.margen, 9000, 'margen sin la orden anulada');
rs = resumen();
assert.deepEqual([tot(rs, 'MXN').costoOc, tot(rs, 'MXN').margen], [1000, 9000]);
cxp = ok('pedro', 'cuentasPorPagar');
assert.deepEqual([tot(cxp, 'MXN'), cxp.faltantes.map(x => x.folio).sort().join()], [null, [oc1, oc3].sort().join()]);
assert.deepEqual(ok('pedro', 'getComprasProyecto', p1).ordenes.map(o => o.folio), [oc1]);
falla('pedro', 'cancelarOrdenCompra', [oc2, 'Ya no la queremos'], /está anulada/);
falla('pedro', 'registrarFacturaProveedor', [{ ocFolio: oc2, tipo: 'Extranjera', numero: 'F-9', fecha: HOY_ISO, moneda: 'MXN', subtotal: 1, pdf: { datos: PDF } }], /está anulada/);
assert(nombre(fila(LO, 'OrdenesCompra', oc2)[23]).startsWith('ANULADA — ' + oc2));
assert(H(LO, 'Bitacora').some(b => b[2] === 'Requisición a Solicitada' && /se anuló/.test(b[4])));
assert.equal(ok('obrero', 'misRequisiciones').find(x => x.folio === r2).estado, 'Solicitada');
const oc2b = autorizar(r2, 1500);
assert(oc2b > oc3, 'la orden nueva toma el siguiente folio (el anulado no se reusa)');

// ===== 5. Contrato (con la clave del proyecto) → esquema y pagos; la cotización sigue sin aceptar =====
const esquemaP2 = () => H(LC, 'Esquemas').filter(r => String(r[0]) === p2).length;
assert.equal(esquemaP2(), 3);
prev = ok('leo', 'previsualizarAnulacion', 'contrato ' + p2o.folioVisible);
assert.deepEqual(prev.registros.map(r => r.tipo + ':' + r.folio), ['Contrato:CONTRATO ' + p2, 'Pago de cliente:' + pag2]);
assert(new RegExp('queda sin cotización aceptada; ' + c2 + ' sigue en el proyecto').test(prev.efectos.join()), prev.efectos.join());
res = ok('leo', 'anular', 'CONTRATO ' + p2, MOTIVO, id('a'));
igualAVistaPrevia(prev, res);
assert.equal(esquemaP2(), 0, 'el esquema se borra');
const filaContrato = filasAnul().find(r => r[3] === 'CONTRATO ' + p2);
assert.equal(JSON.parse(filaContrato[6]).esquema.length, 3, 'con copia del esquema');
assert.equal(H(LC, 'Contratos').find(r => r[0] === p2)[7], 'Anulada');
rs = resumen();
assert.equal(tot(rs, 'USD'), null, 'sin el contrato no hay totales en USD');
assert.deepEqual(rs.proyectos.map(x => x.folio), [p1]);
vc = ok('tania', 'getCobranzaProyecto', p2);
assert.deepEqual([vc.contrato, vc.pagos.length, vc.esquema.length, vc.puedeAceptar, vc.cotizaciones.map(c => c.folio).join()], [null, 0, 0, true, c2]);
assert(ok('ana', 'listarCotizaciones', '').some(c => c.folio === c2), 'la cotización no se anula');
assert(ok('ana', 'listarProyectos', '', false).some(p => p.folio === p2), 'sin contrato firmado vuelve al buscador de cotizaciones');
assert.equal(ok('tania', 'listarProyectosCobranza', '').find(p => p.folio === p2).contrato, '');
assert.equal(ok('pedro', 'listarProyectosCompras', '').find(p => p.folio === p2).sinContrato, true);
assert(H(LC, 'Bitacora').filter(b => b[2] === 'Anular contrato' || b[2] === 'Anular pago').length >= 3);
vc = ok('tania', 'marcarAceptada', p2, c2, true);
assert.deepEqual([vc.contrato.estado, vc.esquema.length, H(LC, 'Contratos').filter(r => r[0] === p2).length], ['Aceptada', 3, 2], 'otra fila para el contrato nuevo');
assert.equal(ok('tania', 'getCobranzaProyecto', p2).margen.margen, 950);

// ===== 6. Cotización aceptada y firmada → contrato → pagos =====
assert(ok('ana', 'getClientes').some(c => c.nombre === 'Cliente Uno'));
prev = ok('leo', 'previsualizarAnulacion', c1);
assert.deepEqual(prev.registros.map(r => r.tipo + ':' + r.folio), ['Cotización:' + c1, 'Contrato:CONTRATO ' + p1, 'Pago de cliente:' + pag1]);
assert.equal(prev.registros[0].estado, 'Aceptada (contrato firmado)');
res = ok('leo', 'anular', c1, MOTIVO, id('a'));
igualAVistaPrevia(prev, res);
assert(!ok('ana', 'listarCotizaciones', '').some(c => c.folio === c1), 'fuera del historial');
assert.deepEqual(ok('ana', 'listarCotizaciones', 'Cliente Uno'), []);
assert(!ok('ana', 'getClientes').some(c => c.nombre === 'Cliente Uno'), 'el cliente ya no se sugiere');
assert(!ok('ana', 'bootstrap').clientes.some(c => c.nombre === 'Cliente Uno'), 'tampoco en la carga inicial');
vc = ok('tania', 'getCobranzaProyecto', p1);
assert.deepEqual([vc.contrato, vc.cotizaciones.map(c => c.folio).join(), vc.pagos.length], [null, c1b, 0]);
falla('tania', 'marcarAceptada', [p1, c1, true], /no pertenece al proyecto/);
rs = resumen();
assert.equal(tot(rs, 'MXN'), null);
assert.deepEqual([tot(rs, 'USD').porFirmar, tot(rs, 'USD').proyectos], [1, 0], 'p2 quedó por firmar');
assert(nombre(P.idDeUrlDrive(H(libros.DB, 'Cotizaciones').find(r => r[0] === c1)[11])).startsWith('ANULADA — ' + c1));
assert(ok('ana', 'listarProyectos', '', false).some(p => p.folio === p1), 'p1 admite cotizaciones otra vez');
const c1n = cot(p1, 'Cliente Cuatro', 300);
assert(c1n > c2, 'folio nuevo, nunca el anulado');
falla('leo', 'previsualizarAnulacion', ['CONTRATO ' + p1], /no tiene contrato/);
falla('leo', 'anular', [c1, MOTIVO], /ya está anulada/);

// ===== 7. Con operaciones: recepción (la orden espera material) y orden (la requisición vuelve a Aprobada) =====
const permisoAdri = H(LA, 'Permisos').find(r => r[0] === 'adri@helgen.tech');
permisoAdri[3] = 'solo_requisicion, aprobaciones';
P.subirVersiones_(['permisos']);
assert.equal(ok('adri', 'bootstrap').permisos.flujoOperaciones, true);
const r4 = ok('obrero', 'guardarRequisicion', { proyectoFolio: p1, sitio: 'Querétaro', renglones: [{ descripcion: 'Tubo conduit', cantidad: 10, unidad: 'pza' }],
  idSolicitud: id('r') }).folio;
ok('adri', 'aprobarRequisicion', r4, { version: 1, renglones: [{ renglon: 1, aprobado: true }] });
const propuesta = costo => ({ proveedor: { razonSocial: 'Tubos SA' }, fechaEntrega: MANANA, condicionesPago: 'Contado', diasCredito: 0,
  renglones: [{ renglon: 1, disponibilidad: 'Exacto', costo }], idSolicitud: id('pr') });
assert.equal(ok('pedro', 'cotizarRequisicion', r4, propuesta(10)).version, 1);
const vbo = ok('adri', 'getRequisicionOperaciones', r4).propuesta.huella;
const oc4 = ok('adri', 'autorizarPropuesta', r4, 1, id('vb'), vbo).ocFolio;
const recibir = (cantidad, extra) => ok('obrero', 'registrarRecepcion', Object.assign({ reqFolio: r4, sitio: 'Querétaro',
  renglones: [{ renglon: 1, cantidad }], idSolicitud: id('rc') }, extra || {})).folio;
const rec1 = recibir(4), rec2 = recibir(6, { evidencia: { nombre: 'r.jpg', datos: JPG } });
const pgp4 = pagarProv(r4, 116);
assert.deepEqual([fila(LO, 'Requisiciones', r4)[5], fila(LO, 'OrdenesCompra', oc4)[28]], ['Cerrada', 'Recibida']);
// Recepción: la requisición cerrada vuelve a Pagada y la orden a Pagada; se puede recibir otra vez
limpiarCaptura();
prev = ok('leo', 'previsualizarAnulacion', rec2);
assert.deepEqual(prev.registros.map(r => r.folio), [rec2]);
assert(/pasa de Cerrada a Pagada/.test(prev.efectos[0]) && /pasa de Recibida a Pagada espera otra vez el material/.test(prev.efectos[0]), prev.efectos[0]);
res = ok('leo', 'anular', rec2, MOTIVO, id('a'));
igualAVistaPrevia(prev, res);
const filaRec2 = H(LO, 'MovimientosInventario').find(m => m[0] === rec2);
assert.deepEqual([filaRec2[18], fila(LO, 'Requisiciones', r4)[5], fila(LO, 'OrdenesCompra', oc4)[28], fila(LO, 'OrdenesCompra', oc4)[29]],
  ['Anulada', 'Pagada', 'Pagada', '']);
assert(nombre(filaRec2[16]).startsWith('ANULADA — '), 'la foto de la remisión');
vr = ok('pedro', 'getRequisicion', r4);
assert.deepEqual([vr.avance.map(l => l.recibido + '/' + l.pedido).join(), vr.recepciones.map(x => x.folio).join(), vr.puedeRecibir], ['4/10', rec1, true]);
let mia = ok('obrero', 'misRequisiciones').find(x => x.folio === r4);
assert.deepEqual([mia.estado, mia.puedeRecibir, mia.recepciones.length], ['Pagada', true, 1]);
assert(/Se anuló la recepción/.test(mia.eventos.at(-1).nota));
assert.equal(CAP().portal.length, 0);
falla('pedro', 'cancelarRecepcion', [rec2, 'Recepción equivocada'], /está anulada/);
const rec3 = recibir(6);
assert.equal(fila(LO, 'Requisiciones', r4)[5], 'Cerrada', 'recibida de nuevo');
// Orden pagada y recibida: pagos y recepciones vigentes se anulan; la requisición vuelve a Aprobada sin la propuesta
limpiarCaptura();
prev = ok('leo', 'previsualizarAnulacion', oc4);
assert.deepEqual(prev.registros.map(r => r.tipo + ':' + r.folio),
  ['Orden de compra:' + oc4, 'Pago a proveedor:' + pgp4, 'Recepción:' + rec1, 'Recepción:' + rec3], 'la recepción ya anulada no se repite');
assert(new RegExp(r4 + ' \\(Cerrada\\) vuelve a Aprobada sin orden de compra: se retira la propuesta').test(prev.efectos[0]), prev.efectos[0]);
res = ok('leo', 'anular', oc4, MOTIVO, id('a'));
igualAVistaPrevia(prev, res);
assert.deepEqual(CAP().portal, [['oc.cancelada', oc4]]);
vr = ok('pedro', 'getRequisicion', r4);
assert.deepEqual([vr.requisicion.estado, vr.requisicion.ocFolio, vr.requisicion.voboEmail, vr.requisicion.propuesta, vr.puedeCotizar, vr.orden],
  ['Aprobada', '', '', null, true, null]);
assert.deepEqual(JSON.parse(fila(LO, 'Requisiciones', r4)[20]), { version: 1, retirada: true, archivos: [] }, 'conserva el número de versión');
assert.equal(ok('pedro', 'cotizarRequisicion', r4, propuesta(12)).version, 2, 'compras la cotiza de nuevo (versión siguiente)');
assert.equal(ok('adri', 'listarOperaciones').find(x => x.folio === r4).estado, 'Cotizada');
mia = ok('obrero', 'misRequisiciones').find(x => x.folio === r4);
assert.deepEqual([mia.compra, mia.recepciones.length], [null, 0]);
assert(H(LO, 'MovimientosInventario').filter(m => m[6] === r4).every(m => m[18] === 'Anulada'));
assert.equal(fila(LO, 'PagosProveedores', pgp4)[17], 'Anulada');
av = CAP().avisos.find(a => a.tipo === 'anulado');
assert(av.datos.para.includes('obrero@helgen.tech'), 'quien pidió y recibió');

// Recepción completa sin pagar (Recibida): como cancelarRecepcion, vuelve a Autorizada y la orden sin fecha de recepción
const r5 = ok('obrero', 'guardarRequisicion', { proyectoFolio: p2, sitio: 'Querétaro', renglones: [{ descripcion: 'Cinta', cantidad: 2, unidad: 'pza' }],
  idSolicitud: id('r') }).folio;
ok('adri', 'aprobarRequisicion', r5, { version: 1, renglones: [{ renglon: 1, aprobado: true }] });
ok('pedro', 'cotizarRequisicion', r5, propuesta(5));
const oc5 = ok('adri', 'autorizarPropuesta', r5, 1, id('vb'), ok('adri', 'getRequisicionOperaciones', r5).propuesta.huella).ocFolio;
const rec5 = ok('obrero', 'registrarRecepcion', { reqFolio: r5, sitio: 'Querétaro', renglones: [{ renglon: 1, cantidad: 2 }], idSolicitud: id('rc') }).folio;
assert.deepEqual([fila(LO, 'Requisiciones', r5)[5], fila(LO, 'OrdenesCompra', oc5)[28], fila(LO, 'OrdenesCompra', oc5)[29]], ['Recibida', 'Emitida', HOY_ISO]);
prev = ok('leo', 'previsualizarAnulacion', rec5);
assert(/pasa de Recibida a Autorizada/.test(prev.efectos[0]), prev.efectos[0]);
igualAVistaPrevia(prev, ok('leo', 'anular', rec5, MOTIVO, id('a')));
assert.deepEqual([fila(LO, 'Requisiciones', r5)[5], fila(LO, 'OrdenesCompra', oc5)[28], fila(LO, 'OrdenesCompra', oc5)[29], fila(LO, 'OrdenesCompra', oc5)[30]],
  ['Autorizada', 'Emitida', '', '']);
assert.equal(ok('pedro', 'getRequisicion', r5).avance[0].pendiente, 2);

// ===== 8. Requisición → sus órdenes (escondida de todas las listas) =====
limpiarCaptura();
prev = ok('leo', 'previsualizarAnulacion', r3);
assert.deepEqual(prev.registros.map(r => r.tipo + ':' + r.folio), ['Requisición:' + r3, 'Orden de compra:' + oc3]);
assert.deepEqual(prev.efectos, [], 'nada queda en pie que cambie');
res = ok('leo', 'anular', r3, MOTIVO, id('a'));
igualAVistaPrevia(prev, res);
assert.deepEqual(CAP().portal, [['oc.cancelada', oc3]]);
assert(!ok('pedro', 'listarRequisiciones', '', '').some(x => x.folio === r3), 'compras no la ve');
assert.deepEqual(ok('pedro', 'listarRequisiciones', r3, ''), []);
assert(!ok('obrero', 'misRequisiciones').some(x => x.folio === r3), 'quien pidió no la ve');
assert(!ok('adri', 'listarOperaciones').some(x => x.folio === r3), 'operaciones no la ve');
falla('pedro', 'getRequisicion', [r3], /está anulada/);
falla('adri', 'getRequisicionOperaciones', [r3], /está anulada/);
falla('obrero', 'cancelarRequisicion', [r3, 'Ya no la necesito'], /está anulada/);
assert.equal(fila(LO, 'Requisiciones', r3)[5], 'Anulada');
assert.equal(ok('tania', 'getCobranzaProyecto', p2).margen.margen, 990, 'margen USD: 1,000 − 10 (r5: 2 × 5); la orden anulada (50) ya no cuenta');
assert.deepEqual(ok('pedro', 'getComprasProyecto', p2).ordenes.map(o => o.folio), [oc5], 'la orden anulada no se ve; la de r5 sí');
cxp = ok('pedro', 'cuentasPorPagar');
assert(!cxp.faltantes.some(x => x.folio === oc3));

// ===== 9. Proyecto → todo lo de abajo; carpeta "ANULADO — …" (las privadas no cambian) =====
const filaP1 = H(libros.DB, 'Proyectos').find(r => r[0] === p1);
const carpetaP1 = carpetas[filaP1[7]], nombreCarpeta = carpetaP1.nombre;
assert(nombreCarpeta.startsWith(p1o.folioVisible));
const privadaCompras = carpetas[props.COMPRAS_FOLDER_ID].hijos.find(h => h.nombre === p1.split('-')[1]).hijos.find(h => h.nombre === p1);
assert(privadaCompras, 'carpeta privada de compras con el folio corto');
limpiarCaptura();
prev = ok('leo', 'previsualizarAnulacion', p1o.folioVisible);
const tipos = prev.registros.map(r => r.tipo + ':' + r.folio);
assert.equal(tipos[0], 'Proyecto:' + p1);
for (const x of ['Cotización:' + c1b, 'Cotización:' + c1n, 'Requisición:' + r1, 'Requisición:' + r2, 'Requisición:' + r4,
  'Orden de compra:' + oc1, 'Orden de compra:' + oc2b, 'Pago a proveedor:' + pgp1b]) assert(tipos.includes(x), 'falta ' + x + ' en ' + tipos);
for (const x of [c1, oc2, oc4, pgp1, pag1, pag1b, rec2]) assert(!tipos.some(t => t.endsWith(':' + x)), 'lo ya anulado no se repite: ' + x);
assert.equal(prev.carpeta, nombreCarpeta);
assert(/carpeta del proyecto en Drive/.test(prev.efectos.join()));
res = ok('leo', 'anular', p1o.folioVisible, MOTIVO, id('a'));
igualAVistaPrevia(prev, res);
assert.equal(carpetaP1.nombre, 'ANULADO — ' + nombreCarpeta);
assert.equal(privadaCompras.nombre, p1, 'la carpeta privada se busca por nombre: no se renombra');
assert.equal(H(libros.DB, 'Proyectos').find(r => r[0] === p1)[6], 'Cancelado');
assert.deepEqual(CAP().portal.map(x => x[1]).sort(), [oc1, oc2b].sort());
assert(!ok('ana', 'listarProyectos', '', false).some(p => p.folio === p1));
assert(!ok('ana', 'listarProyectos', '', true).some(p => p.folio === p1));
assert(!ok('tania', 'listarProyectosCobranza', '').some(p => p.folio === p1));
assert(!ok('pedro', 'listarProyectosCompras', '').some(p => p.folio === p1));
assert(!ok('obrero', 'listarProyectosRequisicion', '').some(p => p.folio === p1));
falla('tania', 'getCobranzaProyecto', [p1], /está anulado/);
falla('pedro', 'getComprasProyecto', [p1], /está anulado/);
falla('ana', 'guardarCotizacion', [{ cliente: { nombre: 'X' }, items: [{ descripcion: 'A', cantidad: 1, precio: 1 }], proyectoFolio: p1 }], /cancelado/, 'PROYECTO');
assert.deepEqual(ok('ana', 'listarCotizaciones', '').map(c => c.folio), [c2], 'solo queda la cotización del otro proyecto');
assert.deepEqual(ok('pedro', 'listarRequisiciones', '', '').map(x => x.folio), [r5], 'solo queda la de p2');
assert.deepEqual(ok('obrero', 'misRequisiciones').map(x => x.folio), [r5]);
cxp = ok('pedro', 'cuentasPorPagar');
assert.deepEqual([cxp.abiertas.length, cxp.faltantes.map(x => x.folio).join(), cxp.totales.length], [0, oc5, 0]);
rs = resumen();
assert.deepEqual(rs.proyectos.map(x => x.folio), [p2]);
const bootCob = ok('tania', 'bootstrap');
assert(!bootCob.cob.proyectos.some(p => p.folio === p1));
assert.equal(crearSiguiente(), 'PRY-' + ANIO + '-0003', 'folio de proyecto nuevo, nunca el anulado');
function crearSiguiente() { return pry('Otro', 'Cliente Cinco').folio; }

// ===== Anulaciones, lista de anulados y sincronización =====
const filas = filasAnul();
assert(filas.every(r => r.length === 7 && JSON.parse(r[5]) && JSON.parse(r[6])), 'cada fila con JSON válido');
const raices = filas.filter(r => JSON.parse(r[5]).raiz);
assert.deepEqual(raices.map(r => r[3]), [pag1b, pgp1, fpr1, oc2, 'CONTRATO ' + p2, c1, rec2, oc4, rec5, r3, p1]);
assert(filas.filter(r => JSON.parse(r[5]).de === p1).length >= 8, 'cada registro de la cascada tiene su fila');
const lista = ok('leo', 'listarAnulados', '');
assert.deepEqual(lista.map(x => x.folio), raices.map(r => r[3]).reverse(), 'una por anulación, las recientes primero');
assert.deepEqual([lista[0].tipo, lista[0].motivo, lista[0].correo, lista[0].registros[0].folio], ['Proyecto', MOTIVO, 'leo@helgen.tech', p1]);
assert(lista[0].efectos.length && lista[0].carpeta === nombreCarpeta);
assert.deepEqual(ok('leo', 'listarAnulados', oc1).map(x => x.folio), [p1, pgp1], 'busca en la cascada (p1) y en la descripción (el pago de oc1)');
assert.deepEqual(ok('leo', 'listarAnulados', c1b).map(x => x.folio), [p1], 'c1b solo va en la cascada del proyecto');
assert.deepEqual(ok('leo', 'listarAnulados', r4).map(x => x.folio), [p1, oc4], 'la orden de r4 lo menciona');
assert.deepEqual(ok('leo', 'listarAnulados', { buscar: 'CONTRATO' }).map(x => x.folio), [c1, 'CONTRATO ' + p2], 'el de p2 y el que arrastró c1');
const sync = ok('leo', 'sincronizar', {}, { anulados: true });
assert(Array.isArray(sync.anulados) && sync.anulados.length === lista.length, 'la lista viaja en la sincronización');
assert.equal(ok('leo', 'sincronizar', sync.versiones, { anulados: true }).anulados, undefined, 'solo si cambió');
assert.equal(ok('efrain', 'sincronizar', {}, { anulados: true }).anulados, undefined, 'solo super admin');
assert.equal(ok('leo', 'bootstrap').permisos.superadmin, true);
// La caché del conjunto anulado se invalida con la versión de 'anulaciones'
const vAnt = Number(props.VER_anulaciones);
assert(vAnt >= 10, 'anular sube la versión de anulaciones');

// ===== 10. Cotización sin proyecto y proyecto con aceptada sin firmar =====
const cs = cot(undefined, 'Cliente Seis', 100);
const pdfCs = P.idDeUrlDrive(H(libros.DB, 'Cotizaciones').find(r => r[0] === cs)[11]);
prev = ok('leo', 'previsualizarAnulacion', cs);
assert.deepEqual([prev.registros.length, prev.efectos.length, /Sin proyecto/.test(prev.descripcion)], [1, 0, true]);
igualAVistaPrevia(prev, ok('leo', 'anular', cs, MOTIVO, id('a')));
assert(nombre(pdfCs).startsWith('ANULADA — ' + cs), 'el PDF de la carpeta del año');
assert(!ok('ana', 'listarCotizaciones', '').some(c => c.folio === cs));
assert(!ok('ana', 'getClientes').some(c => c.nombre === 'Cliente Seis'));
prev = ok('leo', 'previsualizarAnulacion', p2);
assert.deepEqual(prev.registros.map(r => r.tipo + ':' + r.folio), ['Proyecto:' + p2, 'Cotización:' + c2, 'Contrato:CONTRATO ' + p2,
  'Requisición:' + r5, 'Orden de compra:' + oc5]);
assert.equal(prev.registros[1].estado, 'Aceptada');
igualAVistaPrevia(prev, ok('leo', 'anular', p2, MOTIVO, id('a')));
rs = resumen();
assert.deepEqual([rs.totales, rs.proyectos], [[], []], 'sin proyectos, sin totales');
assert.deepEqual(ok('ana', 'listarCotizaciones', ''), []);
assert.deepEqual(ok('pedro', 'listarRequisiciones', '', ''), []);
assert.deepEqual(ok('pedro', 'cuentasPorPagar').faltantes, []);
assert.equal(H(LC, 'Contratos').filter(r => r[0] === p2 && r[7] === 'Anulada').length, 2, 'los dos contratos de p2 anulados');

// ================= Interfaz: <script id="mod-anular"> con un DOM mínimo =================
{
  const fs = require('fs'), vm = require('vm'), path = require('path');
  const html = fs.readFileSync(path.join(dir, 'web/cotizador/index.html'), 'utf8');
  const src = html.match(/<script id="mod-anular">([\s\S]*?)<\/script>/)[1];
  assert(/<div id="adminAnulados"><\/div>/.test(html), 'el bloque de Administración existe');
  // Elementos por id; al cambiar innerHTML, los ids que trae se vuelven a crear (como un DOM nuevo)
  const porId = {};
  function el(idEl) {
    const e = { id: idEl, value: '', textContent: '', disabled: false, oyentes: {}, clases: new Set(),
      classList: { add: c => e.clases.add(c), remove: c => e.clases.delete(c), contains: c => e.clases.has(c) },
      addEventListener: (t, f) => (e.oyentes[t] = e.oyentes[t] || []).push(f), focus() {},
      disparar: (t, ev) => (e.oyentes[t] || []).forEach(f => f(Object.assign({ target: e }, ev || {}))),
      querySelector: sel => obtener(sel.replace(/^#/, '')) };
    let h = '';
    Object.defineProperty(e, 'innerHTML', { get: () => h, set: v => { h = v; (String(v).match(/id="([^"]+)"/g) || []).forEach(x => delete porId[x.slice(4, -1)]); } });
    if (idEl === 'anuVista') e.clases.add('oculto');
    return e;
  }
  const obtener = x => porId[x] || (porId[x] = el(x));
  const llamadas = [], avisos = [], modulos = [], dialogos = [];
  const run = () => {
    const c = {};
    const p = new Proxy({}, { get: (t, k) => k === 'withSuccessHandler' ? f => (c.ok = f, p) : k === 'withFailureHandler' ? f => (c.mal = f, p)
      : (...args) => { llamadas.push(Object.assign(c, { fn: k, args })); } });
    return p;
  };
  const ctxUi = { console, JSON, Math, Date, String, Array, Object, Proxy, setTimeout: f => f(), clearTimeout() {},
    $: obtener, esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    aviso: (tipo, h) => avisos.push([tipo, h]), nuevoId: () => 'id-' + (++nId), registrarModulo: m => modulos.push(m),
    PERMISOS: { superadmin: true }, TAB: 'admin', google: { script: { get run() { return run(); } } } };
  ctxUi.window = { confirm: m => { dialogos.push(m); return true; } };
  vm.createContext(ctxUi);
  vm.runInContext(src, ctxUi);
  const m = modulos[0];
  assert.equal(m.nombre, 'Anular');
  m.alVerTab('cat');
  assert.equal(obtener('adminAnulados').innerHTML, '', 'nada hasta abrir Administración');
  m.alVerTab('admin');
  assert(/Anular un registro/.test(obtener('adminAnulados').innerHTML) && /Registros anulados/.test(obtener('adminAnulados').innerHTML));
  assert.deepEqual(llamadas.map(c => c.fn), ['listarAnulados'], 'carga la lista al abrir');
  llamadas[0].ok([{ fecha: '28/10/2026 10:00', correo: 'leo@helgen.tech', nombre: 'leo@helgen.tech', tipo: 'Proyecto', folio: 'PRY-2026-0001',
    motivo: 'Proyecto <de prueba>', descripcion: '', registros: [{ tipo: 'Proyecto', folio: 'PRY-2026-0001' }, { tipo: 'Cotización', folio: 'HLG-2026-0001' }],
    efectos: ['Algo cambió'], archivos: 2, carpeta: 'PRY-2026-0001 — X' }]);
  let tabla = obtener('anuLista').innerHTML;
  assert(/PRY-2026-0001/.test(tabla) && /2 registro\(s\) · 2 archivo\(s\)/.test(tabla) && /Proyecto &lt;de prueba&gt;/.test(tabla), 'lista con texto escapado');
  assert.deepEqual(plain(m.contexto()), { anulados: true, anuladosBuscar: '' }, 'pide la lista en la sincronización');
  // Vista previa → motivo → confirmar (una sola vez) → resultado
  obtener('anuFolio').value = ' oc-2026-0002 ';
  obtener('anuVer').disparar('click');
  let c = llamadas.at(-1);
  assert.deepEqual([c.fn, c.args[0]], ['previsualizarAnulacion', 'oc-2026-0002']);
  c.ok({ folio: 'OC-2026-0002', tipo: 'Orden de compra', descripcion: 'OC-2026-0002 · Proveedor <x>', registros: [
    { tipo: 'Orden de compra', folio: 'OC-2026-0002', descripcion: 'Proveedor', estado: 'Emitida' }, { tipo: 'Factura de proveedor', folio: 'FPR-2026-0002', descripcion: '', estado: 'Vigente' }],
    efectos: ['REQ-2026-0002 (Autorizada) vuelve a Solicitada'], avisos: ['El material que el centro de mando ya recibió se queda ahí'], archivos: 2, carpeta: '', para: ['obrero@helgen.tech'] });
  const vista = obtener('anuVista');
  assert(!vista.classList.contains('oculto'));
  assert(/FPR-2026-0002/.test(vista.innerHTML) && /vuelve a Solicitada/.test(vista.innerHTML) && /centro de mando/.test(vista.innerHTML) &&
    /Se avisará a: obrero@helgen.tech/.test(vista.innerHTML) && /Proveedor &lt;x&gt;/.test(vista.innerHTML), 'muestra todo lo que arrastra');
  assert(/Anular 2 registros/.test(vista.innerHTML));
  const boton = obtener('anuConfirmar');
  assert.equal(boton.disabled, true, 'sin motivo no se puede');
  obtener('anuMotivo').value = 'corto';
  obtener('anuMotivo').disparar('input');
  assert.equal(boton.disabled, true);
  assert(/Faltan 5 caracteres/.test(obtener('anuCuenta').textContent));
  obtener('anuMotivo').value = 'Orden duplicada por error';
  obtener('anuMotivo').disparar('input');
  assert.equal(boton.disabled, false);
  boton.disparar('click');
  boton.disparar('click'); // doble clic
  const anulaciones = llamadas.filter(x => x.fn === 'anular');
  assert.equal(anulaciones.length, 1, 'un solo envío');
  assert.deepEqual(anulaciones[0].args.slice(0, 2), ['OC-2026-0002', 'Orden duplicada por error']);
  assert(/^id-/.test(anulaciones[0].args[2]), 'con idSolicitud');
  assert(/¿Anular OC-2026-0002 y 1 registro\(s\) más\?/.test(dialogos[0]));
  anulaciones[0].ok({ folio: 'OC-2026-0002', registros: [{ folio: 'OC-2026-0002' }, { folio: 'FPR-2026-0002' }], fallas: [],
    anulados: [{ fecha: 'hoy', correo: 'leo@helgen.tech', nombre: 'Leo', tipo: 'Orden de compra', folio: 'OC-2026-0002', motivo: 'Orden duplicada por error',
      registros: [{ tipo: 'Orden de compra', folio: 'OC-2026-0002' }], efectos: [], archivos: 0, carpeta: '' }] });
  assert.deepEqual(avisos.at(-1)[0], 'ok');
  assert(/Se anuló <b>OC-2026-0002<\/b> y 1 registro\(s\) más\./.test(avisos.at(-1)[1]) && !/Ojo/.test(avisos.at(-1)[1]));
  assert(obtener('anuVista').classList.contains('oculto'), 'la vista previa se cierra');
  assert(/Orden duplicada por error/.test(obtener('anuLista').innerHTML), 'la lista se pinta con lo que regresó');
  // Un error del servidor se muestra y deja volver a intentar
  obtener('anuFolio').value = 'PAG-2026-0099';
  obtener('anuVer').disparar('click');
  llamadas.at(-1).mal(new Error('No existe el pago PAG-2026-0099.'));
  assert.deepEqual(avisos.at(-1), ['error', 'No existe el pago PAG-2026-0099.']);
  // Sincronización y búsqueda
  m.alSincronizar({ anulados: [] });
  assert(/Todavía no se ha anulado nada/.test(obtener('anuLista').innerHTML));
  obtener('anuBuscar').value = 'REQ-2026';
  obtener('anuBuscar').disparar('input');
  assert.deepEqual([llamadas.at(-1).fn, llamadas.at(-1).args[0]], ['listarAnulados', 'REQ-2026']);
  assert.equal(m.contexto().anuladosBuscar, 'REQ-2026');
  // Sin super admin: se vacía
  m.alPermisos({ superadmin: false });
  assert.equal(obtener('adminAnulados').innerHTML, '');
  ctxUi.PERMISOS = { superadmin: false };
  assert.deepEqual(plain(m.contexto()), {});
}

console.log('OK anular');
