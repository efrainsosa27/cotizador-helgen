// Incremento 6 · Módulo P: pruebas de regresión de la revisión independiente (pagos parciales a proveedores). Cada sección es un
// hallazgo de la revisión, con el caso que lo reproducía (scripts de la revisión: r1…r12 y los fuzzers):
//  1. Una factura con retenciones registrada después de pagos parciales cubre la orden: queda pagada (antes se quedaba Emitida
//     "completa" y la requisición atorada); un pago a una orden ya cubierta la cierra en lugar de fallar; "Pagada parcial" es la
//     misma regla para compras y para quien pidió.
//  2. Idempotencia del pago: el mismo idSolicitud con otro contenido se rechaza; la hoja recuerda el idSolicitud (columna
//     id_solicitud + huella) aunque se pierda el caché; el caché guarda poco y nunca falla después de escribir (el caché simulado
//     del arnés, como el de Apps Script, no acepta valores de más de 100 KB); lo mismo al autorizar con muchos proveedores.
//  3. El tope de un pago es el saldo contra el total de las facturas cuando ya la cubren con retenciones (antes, el total de la orden).
//  4. (Interfaz) Pagos en otra moneda: al precargar un monto la moneda del pago vuelve a la de la orden; "= $X aplicados" en vivo;
//     un pago en otra moneda que no completa la orden pide confirmación.
//  5. Cuentas por pagar mide toda orden por su saldo (con o sin pagos; sin lo devuelto): la misma cifra que Reportes → CxP.
//  6. Saldo a favor (lo pagado de más, p. ej. tras devolver material ya pagado): en la vista, órdenes por proyecto, cuentas por
//     pagar (aparte, por orden: nunca se resta de lo que se debe) y como pendiente de compras; quien pidió no lo ve.
//  7. Cuentas por pagar: lo que no tiene factura, una fila por etapa del plan con su vencimiento (antes todo con la que sigue).
//  8. Al cancelar o anular un pago, un pago que decía "Liquidación" y ya no liquida pasa a Anticipo o Parcial (según si ya se había
//     recibido algo cuando se registró).
// Uso: node tests/pagos-revision.test.js .
'use strict';
const assert = require('assert');
const dir = process.argv[2] || '.';
const A = require('./arnes')(dir, { props: {
  ROL_COMPRAS: 'efrain@helgen.tech, pedro@helgen.tech', ROL_COBRANZA: 'efrain@helgen.tech',
  ROL_REQUISICION: 'obrero@helgen.tech, efrain@helgen.tech, pedro@helgen.tech', SOLO_REQUISICION: 'rosa@helgen.tech, adri@helgen.tech',
  ROL_OPERACIONES: '' } });
const { P, ok, post, falla, props, HOY_ISO, masDias, correr, FOTO, FOTOS, plain } = A;
const MANANA = masDias(1);
A.libros.DB.pest.Config.m.push(['SITIOS', 'QRO | Querétaro\nZLO | Manzanillo (TIMSA)\nVER | Veracruz (ICAVE)']);
P.exigirDocumentosParaPagar_ = function () {}; // los documentos del proveedor (F) los prueba pagos.test.js
correr(`var PORTAL = []; avisarPortal_ = function (tipo, folio) { PORTAL.push([tipo, folio]); return ''; };`);
props.SUPER_ADMIN = 'leo@helgen.tech';
P.prepararCapri();

let nId = 0;
const id = p => (p || 'x') + (++nId);
const F = { nombre: 'foto.jpg', datos: FOTO, mime: 'image/jpeg' };
const P2 = ok('ana', 'crearProyecto', { nombre: 'Casa del Lago', ubicacion: 'Querétaro', cliente: { nombre: 'Luis', empresa: 'Solar' }, idSolicitud: 'p2' }).folio;
const RENGLONES = [{ descripcion: 'Cable THW 10', cantidad: 80, unidad: 'm' }, { descripcion: 'Tubo conduit 3/4', cantidad: 12, unidad: 'pza' }];
// Orden: 80 m × $10 + 12 pza × $50 = $1,400 + IVA 16 % = $1,624 (proveedor sin RFC: factura extranjera)
const OCD = extra => Object.assign({ proveedor: { razonSocial: 'Ferretera del Puerto' }, fechaEntrega: MANANA, lugarEntrega: 'Querétaro',
  condicionesPago: 'Contado', diasCredito: 0, formaPago: 'Transferencia', idSolicitud: id('oc'),
  renglones: [{ descripcion: 'Cable THW 10', unidad: 'M', cantidad: 80, costo: 10 }, { descripcion: 'Tubo conduit 3/4', unidad: 'PZA', cantidad: 12, costo: 50 }] },
  extra || {});
const pago = (folio, extra) => Object.assign({ reqFolio: folio, fecha: HOY_ISO, monto: 1624, monedaPago: 'MXN', metodo: 'Transferencia',
  referencia: 'SPEI ' + id(), comprobante: { nombre: 'c.pdf', datos: A.PDF }, idSolicitud: id('pg') }, extra || {});
const pagar = (folio, monto, extra) => ok('pedro', 'registrarPagoProveedor', pago(folio, Object.assign({ monto: monto }, extra || {})));
/** Flujo de siempre: obrero pide, efrain autoriza (en P2, o en otro proyecto). */
function siempre(ocExtra, proyecto) {
  const folio = ok('obrero', 'guardarRequisicion', { proyectoFolio: proyecto || P2, sitio: 'Querétaro', renglones: RENGLONES,
    cotizacion: { nombre: 'cot.pdf', datos: A.PDF }, idSolicitud: id('q') }).folio;
  const oc = ok('efrain', 'autorizarRequisicion', folio, OCD(ocExtra)).ocFolio;
  return { req: folio, oc: oc };
}
/** Factura extranjera (el proveedor no tiene RFC): impuestos 224 = IVA completo; 84 = con retenciones (total 1,484). */
const facturar = (oc, subtotal, impuestos, extra) => ok('pedro', 'registrarFacturaProveedor', Object.assign({ ocFolio: oc, tipo: 'Extranjera',
  numero: id('INV-'), fecha: HOY_ISO, moneda: 'MXN', subtotal: subtotal, impuestos: impuestos, pdf: { nombre: 'inv.pdf', datos: A.PDF },
  idSolicitud: id('f') }, extra || {}));
const LC = () => A.libros[props.COMPRAS_DB_ID];
const H = n => LC().pest[n].m;
const col = (hoja, nombre) => H(hoja)[0].indexOf(nombre);
const filaOc = oc => H('OrdenesCompra').find(r => r[0] === oc);
const filaReq = req => H('Requisiciones').find(r => r[0] === req);
const pagosDe = oc => H('PagosProveedores').filter(r => r[3] === oc);
const vista = req => ok('pedro', 'getRequisicion', req);
const mia = req => ok('obrero', 'misRequisiciones').find(x => x.folio === req);
const ultimaDev = () => H('Devoluciones').slice(-1)[0][0];
let visto = 0;
const correosNuevos = () => { const c = A.correos.slice(visto); visto = A.correos.length; return c; };
/** Algo cambió a mano en la hoja: sube las versiones para que las listas en caché se vuelvan a armar. */
const aMano = () => ['requisiciones', 'oc', 'pagosProveedores'].forEach(c => { props['VER_' + c] = String((Number(props['VER_' + c]) || 0) + 1); });

// ================= 1. Factura con retenciones después de pagos parciales (r1, fuzzers) =================
{
  // a) Pago parcial de 1,484 y luego la factura con retenciones por 1,484: lo pagado ya la cubre → Pagada (antes: Emitida "completa")
  const s = siempre();
  pagar(s.req, 1484);
  correosNuevos();
  const r = facturar(s.oc, 1400, 84);
  assert.equal(r.vista.requisicion.estado, 'Pagada', 'la factura cubre la orden: requisición Pagada');
  assert.equal(r.vista.orden.estado, 'Pagada', 'y la orden Pagada');
  assert.deepEqual([r.vista.saldo.completo, r.vista.saldo.saldo, r.vista.pagadaParcial, r.vista.puedePagar], [true, 0, false, false]);
  assert.equal(filaOc(s.oc)[col('OrdenesCompra', 'estado')], 'Pagada');
  // Quien pidió: sin "Pagada parcial", puede confirmar que llegó; el historial no lleva montos ni el folio de la factura
  const m = mia(s.req);
  assert.deepEqual([m.estado, m.pagadaParcial, m.puedeCerrar], ['Pagada', false, true]);
  const ev = m.eventos[m.eventos.length - 1];
  assert(/factura/i.test(ev.nota) && !/\$|\d+\.\d{2}|FPR-/.test(ev.nota), 'evento sin montos: ' + ev.nota);
  // Correo "Pagada, por recibir" (como el pago que completa); bitácora con la factura
  assert(correosNuevos().some(c => /obrero/.test(c.to) && /· Pagada, por recibir/.test(c.subject)), 'aviso req.pagada');
  assert(H('Bitacora').some(b => b[2] === 'Orden pagada por factura' && b[4].indexOf(s.oc) !== -1 && b[4].indexOf(r.folio) !== -1));
  // Ni en cuentas por pagar ni pendiente de pagar
  assert(!ok('pedro', 'cuentasPorPagar').abiertas.some(a => a.ocFolio === s.oc), 'no se debe nada');
  assert(!ok('pedro', 'pendientes', false).items.some(x => x.req === s.req && /pagar/.test(x.tipo)), 'nada pendiente de pagar');
  // Quien pidió confirma que llegó → Cerrada, orden Recibida
  ok('obrero', 'cerrarRequisicion', s.req, 'llegó', FOTOS);
  assert.deepEqual([vista(s.req).requisicion.estado, vista(s.req).orden.estado], ['Cerrada', 'Recibida']);
  // registrarFacturaProveedor declara que cambia requisiciones y órdenes (los demás navegadores se enteran)
  assert.deepEqual(correr('CAMBIOS_API.registrarFacturaProveedor').slice().sort(), ['facturasProveedor', 'oc', 'requisiciones']);

  // b) Recibida antes de pagar todo (pago parcial) y luego la factura con retenciones: se cierra
  const t = siempre();
  pagar(t.req, 1484);
  ok('obrero', 'cerrarRequisicion', t.req, 'llegó', FOTOS);
  assert.equal(vista(t.req).requisicion.estado, 'Recibida');
  const rt = facturar(t.oc, 1400, 84);
  assert.deepEqual([rt.vista.requisicion.estado, rt.vista.orden.estado], ['Cerrada', 'Recibida'], 'recibida + factura que la cubre = cerrada');

  // c) Una factura que NO la cubre (pagado 1,000 de 1,484) no cambia nada; ni una sin pagos
  const u = siempre();
  pagar(u.req, 1000);
  const ru = facturar(u.oc, 1400, 84);
  assert.deepEqual([ru.vista.requisicion.estado, ru.vista.orden.estado, ru.vista.pagadaParcial, ru.vista.saldo.saldo], ['Autorizada', 'Emitida', true, 484]);
  const w = siempre();
  const rw = facturar(w.oc, 1400, 84);
  assert.deepEqual([rw.vista.requisicion.estado, rw.vista.orden.estado], ['Autorizada', 'Emitida'], 'sin pagos no se cierra');

  // d) Una orden ya cubierta que quedó Emitida (datos de antes del arreglo): un pago la cierra en lugar de fallar, sin registrar otro
  const v = siempre();
  pagar(v.req, 1484);
  facturar(v.oc, 1400, 84);
  filaOc(v.oc)[col('OrdenesCompra', 'estado')] = 'Emitida';
  filaReq(v.req)[col('Requisiciones', 'estado')] = 'Autorizada';
  aMano();
  // Mientras tanto, "Pagada parcial" es la misma regla para compras y para quien pidió (Emitida, sin completar y con pagos)
  assert.deepEqual([vista(v.req).pagadaParcial, mia(v.req).pagadaParcial,
    ok('pedro', 'listarRequisiciones', '', '').find(x => x.folio === v.req).pagadaParcial], [false, false, false], 'misma etiqueta');
  const n = pagosDe(v.oc).length;
  const rv = pagar(v.req, 1);
  assert.deepEqual([rv.folio, rv.completo, rv.sinPago], ['', true, true]);
  assert(/ya estaba cubierta/.test(rv.mensaje), rv.mensaje);
  assert.deepEqual([rv.vista.requisicion.estado, rv.vista.orden.estado], ['Pagada', 'Pagada'], 'se cerró sola');
  assert.equal(pagosDe(v.oc).length, n, 'no se registró otro pago');
  assert(H('Bitacora').some(b => b[2] === 'Orden pagada (ya estaba cubierta)' && b[4].indexOf(v.oc) !== -1));
  // Y luego ya no se puede pagar (está pagada)
  falla('pedro', 'registrarPagoProveedor', [pago(v.req, { monto: 1 })], /está pagada: no se puede pagar|ya está pagada|está pagada/);

  // e) La regla, sola: Emitida, sin completar y con algo pagado
  assert.deepEqual([P.esPagoParcial_({ estado: 'Emitida' }, { completo: false, pagado: 1 }), P.esPagoParcial_({ estado: 'Emitida' }, { completo: true, pagado: 1 }),
    P.esPagoParcial_({ estado: 'Emitida' }, { completo: false, pagado: 0 }), P.esPagoParcial_({ estado: 'Pagada' }, { completo: false, pagado: 1 })],
  [true, false, false, false]);
}

// ================= 2. Idempotencia del pago (r2, r6) =================
{
  // El caché simulado es como el de Apps Script: un valor de más de 100 KB no se guarda (lanza)
  const c = A.ctx.CacheService.getScriptCache();
  assert.throws(() => c.put('GRANDE', 'x'.repeat(100 * 1024 + 1)), /Argument too large/);
  assert.throws(() => c.putAll({ GRANDE: 'á'.repeat(60 * 1024) }), /Argument too large/, 'se mide en bytes (UTF-8)');
  c.put('CHICO', 'x'.repeat(100 * 1024));
  assert.equal(A.cache.GRANDE, undefined);

  // a) El mismo idSolicitud con OTRO contenido (interfaz vieja, otra pestaña, reintento a mano) se rechaza: antes regresaba el
  //    primer pago como si se hubiera registrado el segundo
  const s = siempre();
  const r1 = pagar(s.req, 500, { referencia: 'SPEI A', idSolicitud: 'MISMO' });
  const r2 = post('pedro', 'registrarPagoProveedor', pago(s.req, { monto: 300, referencia: 'SPEI B', idSolicitud: 'MISMO' }));
  assert.equal(r2.ok, false, 'otro contenido con el mismo idSolicitud');
  assert(/ya se registró como PGP-\d{4}-\d{4} con otros datos/.test(r2.error), r2.error);
  assert.equal(pagosDe(s.oc).length, 1);
  // El mismo envío otra vez: el mismo pago (sin otra fila) y la vista de ahora
  const r1b = pagar(s.req, 500, { referencia: 'SPEI A', idSolicitud: 'MISMO' });
  assert.deepEqual([r1b.folio, r1b.tipo, r1b.vista.saldo.pagado], [r1.folio, r1.tipo, 500]);
  assert.equal(pagosDe(s.oc).length, 1);
  // El caché de idempotencia guarda poco (sin la vista ni la lista de proveedores)
  const guardado = JSON.parse(String(A.cache['PGP_MISMO']).replace(/^V:/, ''));
  assert.deepEqual(Object.keys(guardado).sort(), ['completo', 'folio', 'huella', 'reqFolio', 'tipo', 'url']);
  // Sin el caché (se perdió o pasaron 6 h) la hoja lo sabe: columna id_solicitud (y su huella)
  assert.equal(pagosDe(s.oc)[0][col('PagosProveedores', 'id_solicitud')], 'MISMO');
  assert(pagosDe(s.oc)[0][col('PagosProveedores', 'huella_solicitud')]);
  delete A.cache['PGP_MISMO'];
  assert.equal(pagar(s.req, 500, { referencia: 'SPEI A', idSolicitud: 'MISMO' }).folio, r1.folio);
  delete A.cache['PGP_MISMO'];
  assert(/ya se registró como PGP-\d{4}-\d{4} con otros datos/.test(post('pedro', 'registrarPagoProveedor',
    pago(s.req, { monto: 500, referencia: 'SPEI A', idSolicitud: 'MISMO', comprobante: { nombre: 'otro.png', datos: FOTO } })).error),
  'otro comprobante = otro contenido');
  assert.equal(pagosDe(s.oc).length, 1);
  // Otro idSolicitud con los mismos datos sí es otro pago (dos anticipos iguales son posibles)
  pagar(s.req, 500, { referencia: 'SPEI A', idSolicitud: 'OTRO' });
  assert.equal(pagosDe(s.oc).length, 2);

  // b) Con muchos proveedores la vista pasa de 100 KB: el pago se registra bien (antes: error DESPUÉS de escribir, y el reintento
  //    con el mismo idSolicitud registraba un segundo pago)
  const enc = H('Proveedores')[0];
  for (let i = 0; i < 260; i++) {
    const fila = enc.map(() => '');
    Object.assign(fila, { 0: 'SIN-RFC:PROVEEDOR ' + i, 1: 'Proveedor de materiales eléctricos número ' + i + ' S.A. de C.V.', 3: 'Contacto ' + i,
      4: 'ventas' + i + '@proveedor.mx', 5: '442 123 45' + String(i).padStart(2, '0'), 6: '2026-10-01', 7: 30, 8: 'Av. Industria ' + i + ', Querétaro',
      13: 'Transferencia', 23: 'Notas del proveedor ' + i, 24: 'Sí' });
    H('Proveedores').push(fila);
  }
  const t = siempre();
  const p = pago(t.req, { monto: 487.2, idSolicitud: 'ENVIO-1' });
  const e1 = post('pedro', 'registrarPagoProveedor', p);
  assert(e1.ok, e1.error);
  assert(JSON.stringify(e1.datos).length > 100 * 1024, 'la vista de verdad pasa de 100 KB');
  const e2 = post('pedro', 'registrarPagoProveedor', p);
  assert.deepEqual([e2.ok, e2.datos.folio], [true, e1.datos.folio], 'el reintento regresa el mismo pago');
  assert.equal(pagosDe(t.oc).length, 1);
  // Lo mismo al autorizar (la vista con todos los proveedores): la orden se emite una vez
  const folio = ok('obrero', 'guardarRequisicion', { proyectoFolio: P2, sitio: 'Querétaro', renglones: RENGLONES,
    cotizacion: { nombre: 'cot.pdf', datos: A.PDF }, idSolicitud: id('q') }).folio;
  const datos = OCD({ idSolicitud: 'AUT-1' });
  const a1 = post('efrain', 'autorizarRequisicion', folio, datos);
  assert(a1.ok, a1.error);
  const a2 = post('efrain', 'autorizarRequisicion', folio, datos);
  assert.deepEqual([a2.ok, a2.datos.ocFolio], [true, a1.datos.ocFolio]);
  assert.equal(H('OrdenesCompra').filter(r => r[col('OrdenesCompra', 'req_folio')] === folio).length, 1, 'una sola orden');
}

// ================= 3. El tope del pago respeta el total de las facturas con retenciones (r8) =================
{
  // Orden de 1,624 facturada completa con retenciones por 1,484: el tope es 1,484 (+1.00), no 1,624
  const s = siempre();
  facturar(s.oc, 1400, 84);
  const v = vista(s.req);
  assert.deepEqual([v.saldo.esperado, v.saldo.porFacturas, v.saldo.saldo], [1624, 1484, 1484]);
  const r = post('pedro', 'registrarPagoProveedor', pago(s.req, { monto: 1600 }));
  assert.equal(r.ok, false, '1,600 pasa el total de las facturas');
  assert(/pasa el saldo de la orden: faltan \$1,484\.00 MXN por pagar \(total de sus facturas \$1,484\.00 MXN/.test(r.error), r.error);
  assert.equal(pagar(s.req, 1485).tipo, 'Liquidación', 'dentro de la tolerancia (+1.00)');
  // En partes: 1,000 y luego 625 (el saldo es 484): se rechaza; 484 la liquida
  const t = siempre();
  facturar(t.oc, 1400, 84);
  pagar(t.req, 1000);
  falla('pedro', 'registrarPagoProveedor', [pago(t.req, { monto: 625 })], /faltan \$484\.00 MXN por pagar \(total de sus facturas \$1,484\.00 MXN: está facturada completa con retenciones; ya se pagaron \$1,000\.00 MXN/);
  const l = pagar(t.req, 484);
  assert.deepEqual([l.tipo, l.vista.requisicion.estado, l.vista.saldo.pagado], ['Liquidación', 'Pagada', 1484]);
  // Pura: el tope es el saldo contra porFacturas (o lo esperado)
  const base = { moneda: 'MXN', total: 1624, pagado: 1000, fechaOrden: HOY_ISO, hoy: HOY_ISO, totalOrden: 1624 };
  const datos = m => ({ fecha: HOY_ISO, monto: m, monedaPago: 'MXN', metodo: 'Transferencia', referencia: 'X' });
  assert.equal(P.normalizarPagoProveedor(datos(625), base).montoAplicado, 625, 'sin facturas: 1,000 + 625 = 1,625 (±1.00)');
  assert.throws(() => P.normalizarPagoProveedor(datos(625), Object.assign({}, base, { porFacturas: 1484 })), /total de sus facturas/);
  assert.equal(P.normalizarPagoProveedor(datos(485), Object.assign({}, base, { porFacturas: 1484 })).montoAplicado, 485);
}

/** Lo que Reportes → CxP (módulo R) dice que se debe de una orden: suma de sus partidas. */
const enReporteCxp = (rep, oc) => {
  let t = 0;
  (rep.grupos || []).forEach(g => (g.detalle || []).forEach(d => (d.partidas || []).forEach(p => { if (p.ocFolio === oc) t += Math.round(p.monto * 100); })));
  return t / 100;
};
/** Lo que Compras → Cuentas por pagar dice que se debe de una orden: suma de lo pendiente de sus renglones. */
const enCxp = (cxp, oc) => Math.round(cxp.abiertas.filter(a => a.ocFolio === oc).reduce((t, a) => t + a.pendiente * 100, 0)) / 100;
/** Recibe todo con 40 m del renglón 1 dañados y los devuelve al proveedor sin reponer (menos 40 × $10 + IVA = $464). */
const recibirYDevolver40 = req => {
  ok('obrero', 'cerrarRequisicion', req, '', { renglones: [{ renglon: 1, foto: F, problema: { tipo: 'Dañado', cantidad: 40, comentario: 'Mojado', foto: F } }, { renglon: 2, foto: F }] });
  ok('pedro', 'resolverDevolucion', ultimaDev(), { resolucion: 'Devolver al proveedor', nota: 'Nota de crédito' });
};
const CREDITO = { formaPago: 'Crédito del proveedor', diasCredito: 30, condicionesPago: 'Crédito 30' };

// Otro proyecto: P2 es PRY-…-0001, que los reportes (R) tratan como registro de prueba (CLAUDE.md §5) y no muestran
const P3 = ok('ana', 'crearProyecto', { nombre: 'Planta Norte', ubicacion: 'Querétaro', cliente: { nombre: 'Luis', empresa: 'Solar' }, idSolicitud: 'p3' }).folio;

// ================= 5. Cuentas por pagar y Reportes → CxP dan lo mismo por orden (r5, r4) =================
{
  // a) Sin pagos, facturada completa y con 40 m devueltos sin reponer: se debe 1,160 (antes Cuentas por pagar decía 1,624)
  const a = siempre(CREDITO, P3);
  facturar(a.oc, 1400, 224);
  recibirYDevolver40(a.req);
  // b) Sin pagos, facturada a medias: la factura y lo que falta facturar (antes solo la factura)
  const b = siempre(CREDITO, P3);
  facturar(b.oc, 700, 112);
  // c) Con pagos (ya se medía por saldo)
  const c = siempre(CREDITO, P3);
  facturar(c.oc, 1400, 224);
  recibirYDevolver40(c.req);
  pagar(c.req, 1);
  const cxp = ok('pedro', 'cuentasPorPagar'), rep = ok('pedro', 'reporteCxp');
  for (const [k, s, debe] of [['a', a, 1160], ['b', b, 1624], ['c', c, 1159]]) {
    assert.deepEqual([k, vista(s.req).saldo.saldo, enCxp(cxp, s.oc), enReporteCxp(rep, s.oc)], [k, debe, debe, debe], 'misma cifra en los tres lados (' + k + ')');
  }
  const fb = cxp.abiertas.filter(x => x.ocFolio === b.oc);
  assert.deepEqual(fb.map(x => [x.tipo, x.pendiente, x.pagoParcial]), [['Extranjera', 812, false], ['Saldo', 812, false]], 'factura + lo que falta facturar');
  assert.deepEqual(cxp.abiertas.filter(x => x.ocFolio === a.oc).map(x => [x.tipo, x.total, x.pendiente, x.pagado]), [['Extranjera', 1624, 1160, 0]]);
  // Pura: sin pagos también por saldo (lo devuelto sin reponer se descuenta)
  const o = { folio: 'OC-X', fecha: HOY_ISO, proyectoFolio: 'P', proveedor: 'Prov', moneda: 'MXN', subtotal: 1400, total: 1624, estado: 'Recibida', ivaTasa: 0.16,
    renglones: [{ renglon: 1, cantidad: 80, costo: 10, importe: 800 }, { renglon: 2, cantidad: 12, costo: 50, importe: 600 }] };
  const f = { folio: 'FPR-X', tipo: 'Extranjera', ocFolio: 'OC-X', moneda: 'MXN', total: 1624, subtotal: 1400, fechaEmision: HOY_ISO, fechaVencimiento: HOY_ISO, estado: 'Vigente' };
  const dev = [{ ocFolio: 'OC-X', renglon: 1, tipo: 'Devolución sin reponer', cantidad: -40, estado: 'Vigente' }];
  const r = P.antiguedadCxp({ hoy: HOY_ISO, ordenes: [o], facturas: [f], pagos: [], movimientos: { 'OC-X': dev } });
  assert.deepEqual(r.abiertas.map(x => x.pendiente), [1160]);
  assert.equal(r.totales[0].total, 1160);
}

// ================= 6. Saldo a favor: lo pagado de más tras una devolución (r12 a) =================
const guardado = {}; // lo que usa la sección de interfaz
{
  // Pagada (812 + 812), recibida con los 80 m del renglón 1 dañados y devueltos al proveedor: se debía 696 y se pagó 1,624
  const k = siempre({}, P3);
  pagar(k.req, 812); pagar(k.req, 812);
  ok('obrero', 'cerrarRequisicion', k.req, '', { renglones: [{ renglon: 1, foto: F, problema: { tipo: 'Dañado', cantidad: 80, comentario: 'Todo mojado', foto: F } }, { renglon: 2, foto: F }] });
  ok('pedro', 'resolverDevolucion', ultimaDev(), { resolucion: 'Devolver al proveedor', nota: 'Nos devuelven el dinero' });
  const v = vista(k.req);
  assert.deepEqual([v.requisicion.estado, v.orden.estado, v.saldo.esperado, v.saldo.pagado, v.saldo.saldo, v.saldo.completo, v.saldo.aFavor],
    ['Cerrada', 'Recibida', 696, 1624, 0, true, 928]);
  // Órdenes por proyecto
  assert.equal(ok('pedro', 'getComprasProyecto', P3).ordenes.find(o => o.folio === k.oc).aFavor, 928);
  // Cuentas por pagar: aparte, por orden; no se resta de lo que se debe a otra orden del mismo proveedor
  const deuda = siempre(CREDITO, P3);
  facturar(deuda.oc, 1400, 224);
  const cxp = ok('pedro', 'cuentasPorPagar');
  const af = cxp.aFavor.find(x => x.ocFolio === k.oc);
  assert.deepEqual([af.aFavor, af.pagado, af.esperado, af.moneda, af.reqFolio, af.proveedor], [928, 1624, 696, 'MXN', k.req, 'Ferretera del Puerto']);
  assert(!cxp.abiertas.some(a => a.ocFolio === k.oc), 'no debe nada');
  assert.equal(enCxp(cxp, deuda.oc), 1624, 'la otra orden del mismo proveedor se debe completa');
  const mxn = cxp.totales.find(t => t.moneda === 'MXN');
  assert.equal(mxn.total, Math.round(cxp.abiertas.filter(a => a.moneda === 'MXN').reduce((t, a) => t + a.pendiente * 100, 0)) / 100, 'los totales no restan lo que está a favor');
  assert(cxp.totalesAFavor.some(t => t.moneda === 'MXN' && t.total >= 928));
  // Pendiente de compras (con lo que se debe y qué pedir); quien pidió no ve nada de esto
  const it = ok('pedro', 'pendientes', false).items.find(x => x.tipo === 'aFavor' && x.folio === k.oc);
  assert(it && it.seccion === 'compras' && it.req === k.req && /\$928\.00 MXN a favor/.test(it.detalle) && /nota de crédito o reembolso/.test(it.detalle), JSON.stringify(it));
  assert(!ok('obrero', 'pendientes', false).items.some(x => x.tipo === 'aFavor'));
  assert(!/aFavor|928/.test(JSON.stringify(mia(k.req))), 'quien pidió no ve montos');
  // Pura: solo arriba de la tolerancia; una cancelada no; con facturas con retenciones, contra el total de las facturas
  const o = { folio: 'OC-Y', moneda: 'MXN', total: 1624, estado: 'Pagada', fecha: HOY_ISO };
  const pg = m => [{ folio: 'PGP-Y', ocFolio: 'OC-Y', estado: 'Vigente', montoAplicado: m }];
  assert.deepEqual([P.saldoOrdenCompra(o, pg(1624.8), []).aFavor, P.saldoOrdenCompra(o, pg(1626), []).aFavor,
    P.saldoOrdenCompra(Object.assign({}, o, { estado: 'Cancelada' }), pg(1700), []).aFavor], [0, 2, 0]);
  const fr = [{ folio: 'FPR-Y', ocFolio: 'OC-Y', estado: 'Vigente', moneda: 'MXN', subtotal: 1400, descuento: 0, total: 1484, fechaVencimiento: HOY_ISO }];
  assert.equal(P.saldoOrdenCompra(Object.assign({}, o, { subtotal: 1400, facturas: fr }), pg(1624), []).aFavor, 140, 'se pagó el total y la factura trae retenciones');
  guardado.aFavor = k;
}

// ================= 7. Lo que no tiene factura, por etapa del plan (cada una con su vencimiento) =================
{
  const PLAN2 = [{ concepto: 'Anticipo', porcentaje: 30 }, { concepto: 'Contra entrega', porcentaje: 70 }];
  const PLAN3 = [{ concepto: 'Anticipo', porcentaje: 30 }, { concepto: 'Avance', porcentaje: 30 }, { concepto: 'Final', porcentaje: 40 }];
  const C15 = { diasCredito: 15, condicionesPago: 'Crédito 15 días' };
  // a) 30/70 sin pagos y con la factura del anticipo: lo que falta facturar es el 70 % "Contra entrega" y vence con la entrega + 15
  //    días (antes salía como "Anticipo" con la fecha de la orden)
  const a = siempre(Object.assign({ planPago: PLAN2 }, C15), P3);
  facturar(a.oc, 420, 67.2);
  // b) 30/30/40 con 100 pagados y sin facturas: una fila por etapa (lo que falta del anticipo vence con la orden; lo demás, con la
  //    entrega + 15 días)
  const b = siempre(Object.assign({ planPago: PLAN3 }, C15), P3);
  pagar(b.req, 100);
  const cxp = ok('pedro', 'cuentasPorPagar'), rep = ok('pedro', 'reporteCxp');
  const filas = oc => cxp.abiertas.filter(x => x.ocFolio === oc).map(x => [x.tipo, x.serieFolio, x.pendiente, x.fechaVencimiento]);
  assert.deepEqual(filas(a.oc), [['Extranjera', filas(a.oc)[0][1], 487.2, masDias(15)], ['Saldo', 'Contra entrega', 1136.8, masDias(16)]]);
  assert.deepEqual(filas(b.oc), [['Saldo', 'Anticipo', 387.2, HOY_ISO], ['Saldo', 'Avance', 487.2, masDias(16)], ['Saldo', 'Final', 649.6, masDias(16)]]);
  // Las cifras por orden siguen iguales a la vista y a Reportes → CxP
  for (const s of [a, b]) assert.deepEqual([enCxp(cxp, s.oc), enReporteCxp(rep, s.oc)], [vista(s.req).saldo.saldo, vista(s.req).saldo.saldo]);
  assert.equal(cxp.totales.find(t => t.moneda === 'MXN').saldos >= 4, true, 'cada etapa cuenta como saldo sin factura');
  // Cada etapa de saldoOrdenCompra trae su vencimiento
  assert.deepEqual(vista(b.req).saldo.etapas.map(e => e.vence), [HOY_ISO, masDias(16), masDias(16)]);
}

// ================= 8. El tipo de los pagos que quedan se corrige al cancelar o anular otro (r12 b) =================
{
  const tipos = oc => pagosDe(oc).map(r => [r[0], r[col('PagosProveedores', 'tipo')], r[col('PagosProveedores', 'estado')]]);
  // a) 10.29 (anticipo) + 1,613.71 (liquidación); se cancela el primero: el segundo ya no liquida → Anticipo (nada se ha recibido)
  const s = siempre();
  const p1 = pagar(s.req, 10.29), p2 = pagar(s.req, 1613.71);
  assert.deepEqual([p1.tipo, p2.tipo], ['Anticipo', 'Liquidación']);
  const v = ok('pedro', 'cancelarPagoProveedor', p1.folio, 'Rebotó');
  assert.deepEqual([v.orden.estado, v.saldo.saldo], ['Emitida', 10.29]);
  assert.deepEqual(tipos(s.oc), [[p1.folio, 'Anticipo', 'Cancelado'], [p2.folio, 'Anticipo', 'Vigente']]);
  assert.equal(v.pagos.find(p => p.folio === p2.folio).tipo, 'Anticipo', 'la vista también');
  assert(H('Bitacora').some(b => b[2] === 'Cancelar pago a proveedor' && b[4].indexOf(p2.folio + ' pasa a Anticipo') !== -1));
  // Al liquidar otra vez, el nuevo pago es la liquidación
  assert.equal(pagar(s.req, 10.29).tipo, 'Liquidación');
  // b) Recibida (con una devolución abierta) antes de liquidar: el pago que deja de liquidar pasa a Parcial (ya se había recibido)
  const t = siempre();
  const q1 = pagar(t.req, 500);
  ok('obrero', 'cerrarRequisicion', t.req, '', { renglones: [{ renglon: 1, foto: F, problema: { tipo: 'Dañado', cantidad: 10, comentario: 'Golpeado', foto: F } }, { renglon: 2, foto: F }] });
  const q2 = pagar(t.req, 1124);
  assert.deepEqual([q2.tipo, q2.vista.requisicion.estado, q2.vista.orden.estado], ['Liquidación', 'Recibida', 'Pagada']);
  ok('pedro', 'cancelarPagoProveedor', q1.folio, 'Se registró dos veces');
  assert.deepEqual(tipos(t.oc), [[q1.folio, 'Anticipo', 'Cancelado'], [q2.folio, 'Parcial', 'Vigente']]);
  // c) Anular (super admin) el primero hace lo mismo
  const u = siempre();
  const r1 = pagar(u.req, 10.29), r2 = pagar(u.req, 1613.71);
  ok('leo', 'anular', r1.folio, 'Pago capturado en la orden equivocada', id('an'));
  assert.deepEqual(tipos(u.oc), [[r1.folio, 'Anticipo', 'Anulada'], [r2.folio, 'Anticipo', 'Vigente']]);
  // Pura: solo las "Liquidación" (o sin tipo, de antes) Vigentes y solo si la orden ya no está completa
  const pg = [{ folio: 'A', estado: 'Vigente', tipo: 'Liquidación', fechaRegistro: '2026-10-02 10:00:00', fila: 3 },
    { folio: 'B', estado: 'Cancelado', tipo: 'Liquidación', fila: 4 }, { folio: 'C', estado: 'Vigente', tipo: '', fechaRegistro: '2026-10-05', fila: 5 }];
  const mov = [{ tipo: 'Entrada por compra', estado: 'Vigente', fecha: '2026-10-03' }];
  assert.deepEqual(plain(P.retiparPagosProv(pg, false, {}, mov)), [{ folio: 'A', fila: 3, de: 'Liquidación', a: 'Anticipo' }, { folio: 'C', fila: 5, de: '', a: 'Parcial' }]);
  assert.deepEqual(plain(P.retiparPagosProv(pg, true, {}, mov)), []);
  assert.deepEqual(plain(P.retiparPagosProv(pg, false, { fechaRecepcion: '2026-10-01' }, [])).map(x => x.a), ['Parcial', 'Parcial']);
}

// ================= Interfaz (al final: es asíncrona; DOM simulado conectado al servidor simulado) =================
const UI = require('./montar-interfaz')(A, dir);
(async () => {
  const { esperar, comprobante } = UI;
  const C = UI.montar('pedro', { compras: true, requisicion: true, ventas: true, superadmin: false });
  await esperar();
  const { $ } = C;
  const pagosMandados = () => C.llamadas.filter(c => c.funcion === 'registrarPagoProveedor').length;

  // ---- 4. Pagos en otra moneda (r11, r3) ----
  {
    // Orden en USD (87.79) de un proyecto en pesos
    const u = siempre({ moneda: 'USD', tipoCambio: 18.5, renglones: [{ descripcion: 'Cable', unidad: 'M', cantidad: 1, costo: 75.68 }] });
    C.run('abrirReqCom(' + JSON.stringify(u.req) + ')'); await esperar();
    assert.deepEqual([$('ppMonto').value, $('ppMoneda').value], [87.79, 'USD']);
    // Los botones de monto (en la moneda de la orden) regresan la moneda del pago a la de la orden
    $('ppMoneda').value = 'MXN'; C.run('pintarTcPago()'); $('ppTc').value = '18.5';
    C.run('montoPago(87.79)');
    assert.deepEqual([$('ppMoneda').value, $('ppMonto').value, $('ppTc').value, $('ppTcCaja').classList.contains('oculto')], ['USD', 87.79, '', true]);
    // Pago en pesos: "= $X USD aplicados" en vivo (sin tipo de cambio todavía no se sabe)
    $('ppMoneda').value = 'MXN'; C.run('pintarTcPago()');
    $('ppMonto').value = '600'; C.run('pintarAplicadoPago()');
    assert(/tipo de cambio/.test($('ppAplicado').innerHTML), $('ppAplicado').innerHTML);
    $('ppTc').value = '18.5'; C.run('pintarAplicadoPago()');
    assert(/= <b>\$32\.43 USD<\/b> aplicados a la orden/.test($('ppAplicado').innerHTML) && /queda un saldo de \$55\.36 USD/.test($('ppAplicado').innerHTML),
      $('ppAplicado').innerHTML);
    // En otra moneda y sin completar la orden: pide confirmación; si dice que no, no se manda nada
    $('ppRef').value = 'SPEI 1'; $('ppArchivo').files = [comprobante()];
    C.dialogos.confirmar = false;
    C.run('registrarPagoProv()'); await esperar();
    assert(C.dialogos.mensajes.some(m => /El pago es en MXN y la orden en USD/.test(m) && /\$32\.43 USD/.test(m) && /\$55\.36 USD/.test(m)),
      JSON.stringify(C.dialogos.mensajes));
    assert.equal(pagosMandados(), 0, 'no se mandó');
    C.dialogos.confirmar = true;
    C.run('registrarPagoProv()'); await esperar();
    assert.equal(pagosMandados(), 1);
    // Después del pago parcial el formulario vuelve a la moneda de la orden con lo que falta (antes se quedaba en MXN con el
    // monto en USD y el siguiente clic registraba un "anticipo" de centavos)
    assert.deepEqual([$('ppMoneda').value, $('ppMonto').value, $('ppTc').value, $('ppTcCaja').classList.contains('oculto')], ['USD', 55.36, '', true]);
    // Un pago en otra moneda que sí completa la orden no pregunta
    C.dialogos.mensajes.length = 0;
    $('ppMoneda').value = 'MXN'; C.run('pintarTcPago()'); $('ppTc').value = '18.5'; $('ppMonto').value = '1024.16'; C.run('pintarAplicadoPago()');
    assert(/liquida la orden/.test($('ppAplicado').innerHTML), $('ppAplicado').innerHTML);
    $('ppRef').value = 'SPEI 2'; $('ppArchivo').files = [comprobante('2.pdf')];
    C.run('registrarPagoProv()'); await esperar();
    assert.deepEqual([C.dialogos.mensajes.length, pagosMandados()], [0, 2]);
    assert.deepEqual([vista(u.req).orden.estado, vista(u.req).saldo.pagado], ['Pagada', 87.79]);
    // En la misma moneda no se pregunta aunque sea parcial
    const m = siempre();
    C.run('abrirReqCom(' + JSON.stringify(m.req) + ')'); await esperar();
    $('ppMonto').value = '500'; C.run('pintarAplicadoPago()');
    assert(/queda un saldo de \$1,124\.00 MXN/.test($('ppAplicado').innerHTML), $('ppAplicado').innerHTML);
    $('ppRef').value = 'SPEI 3'; $('ppArchivo').files = [comprobante('3.pdf')];
    C.run('registrarPagoProv()'); await esperar();
    assert.deepEqual([C.dialogos.mensajes.length, pagosMandados()], [0, 3]);
  }

  // ---- 6. Saldo a favor en la requisición, en órdenes por proyecto y en cuentas por pagar ----
  {
    const k = guardado.aFavor;
    C.run('abrirReqCom(' + JSON.stringify(k.req) + ')'); await esperar();
    assert(/saldo a favor <b>\$928\.00 MXN<\/b>: pide al proveedor una nota de crédito o el reembolso/.test($('rcSaldoResumen').innerHTML), $('rcSaldoResumen').innerHTML);
    C.run('pintarCompras(' + JSON.stringify(ok('pedro', 'getComprasProyecto', P3)) + ')');
    assert(/Saldo a favor \$928\.00 MXN/.test($('ocLista').innerHTML), 'órdenes por proyecto');
    C.run('cargarCxp()'); await esperar();
    assert(!$('cxpAFavor').classList.contains('oculto'));
    const h = $('cxpAFavor').innerHTML;
    assert(/Saldo a favor \(nota de crédito o reembolso\)/.test(h) && /<b>\$928\.00 MXN<\/b>/.test(h) && new RegExp(k.oc).test(h) && /No se resta de lo que se debe/.test(h), h);
  }

  console.log('OK pagos-revision');
})().catch(e => { console.error(e); process.exit(1); });
