// Incremento 6 · Módulo P: pruebas de regresión de la revisión independiente (pagos parciales a proveedores). Cada sección es un
// hallazgo de la revisión, con el caso que lo reproducía (scripts de la revisión: r1…r12 y los fuzzers):
//  1. Una factura con retenciones registrada después de pagos parciales cubre la orden: queda pagada (antes se quedaba Emitida
//     "completa" y la requisición atorada); un pago a una orden ya cubierta la cierra en lugar de fallar; "Pagada parcial" es la
//     misma regla para compras y para quien pidió.
//  2. Idempotencia del pago: el mismo idSolicitud con otro contenido se rechaza; la hoja recuerda el idSolicitud (columna
//     id_solicitud + huella) aunque se pierda el caché; el caché guarda poco y nunca falla después de escribir (el caché simulado
//     del arnés, como el de Apps Script, no acepta valores de más de 100 KB); lo mismo al autorizar con muchos proveedores.
//  3. El tope de un pago es el saldo contra el total de las facturas cuando ya la cubren con retenciones (antes, el total de la orden).
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
/** Flujo de siempre: obrero pide, efrain autoriza. */
function siempre(ocExtra) {
  const folio = ok('obrero', 'guardarRequisicion', { proyectoFolio: P2, sitio: 'Querétaro', renglones: RENGLONES,
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

console.log('OK pagos-revision');
