// Incremento 5 · revisión independiente (29/10/2026): un caso por hallazgo, sembrado por doPost con el arnés. Cada sección
// reproduce el escenario de la revisión (fallaba antes del arreglo) y comprueba el comportamiento corregido:
//  1. Cancelar (o anular) una recepción de una requisición retenida por una devolución (Recibida con la orden Pagada) la regresa
//     a Pagada (o En camino), no a Autorizada con la orden pagada (se quedaba atorada para siempre).
//  2. Anular × devoluciones: anular una orden o una requisición anula sus devoluciones (vista previa, Anulaciones, estado Anulada,
//     fuera de Pendientes); una devolución de una orden anterior no retiene a la orden nueva; anular sola una recepción con
//     devoluciones se rechaza (como cancelarRecepcion); anular "Lo recogí" no reabre la requisición.
//  3. pareceNumeroTarjeta: una regla para todo método (corrida sin cortes o agrupada como tarjeta; 13–19 dígitos, empieza con 3–6,
//     Luhn; una CLABE válida no es tarjeta; 20 dígitos o más sí se permiten); fecha y folio no se juntan.
// Uso: node tests/revision5.test.js .
'use strict';
const assert = require('assert');
const dir = process.argv[2] || '.';
const A = require('./arnes')(dir, { props: {
  ROL_COMPRAS: 'efrain@helgen.tech, pedro@helgen.tech', ROL_COBRANZA: 'efrain@helgen.tech',
  ROL_REQUISICION: 'obrero@helgen.tech, efrain@helgen.tech, pedro@helgen.tech', SOLO_REQUISICION: 'rosa@helgen.tech, adri@helgen.tech',
  ROL_OPERACIONES: '' } });
const { P, ok, falla, post, props, HOY_ISO, masDias, correr, FOTO, ANIO } = A;
const MANANA = masDias(1);
A.libros.DB.pest.Config.m.push(['SITIOS', 'QRO | Querétaro\nZLO | Manzanillo (TIMSA)\nVER | Veracruz (ICAVE)']);
// Los documentos del proveedor (F) no son tema de estas pruebas, salvo donde se diga
const exigirDocsOriginal = P.exigirDocumentosParaPagar_;
P.exigirDocumentosParaPagar_ = function () {};
// Avisos al centro de mando y correos: no son tema aquí (los cubren centro, correos y recepcion)
correr(`enviarCorreosPendientes_ = function () { MEMO_.correos = []; }; avisarPortal_ = function () { return ''; };`);
props.SUPER_ADMIN = 'leo@helgen.tech';
P.prepararCapri();

let nId = 0;
const id = p => (p || 'x') + (++nId);
const F = { nombre: 'foto.jpg', datos: FOTO, mime: 'image/jpeg' };
const DEV = n => 'DEV-' + ANIO + '-' + n;
const P2 = ok('ana', 'crearProyecto', { nombre: 'Casa del Lago', ubicacion: 'Querétaro', cliente: { nombre: 'Luis', empresa: 'Solar' }, idSolicitud: 'p2' }).folio;
const RENGLONES = [{ descripcion: 'Cable THW 10', cantidad: 80, unidad: 'm' }, { descripcion: 'Tubo conduit 3/4', cantidad: 12, unidad: 'pza' }];
// Orden: 80 m × $10 + 12 pza × $50 = $1,400 + IVA 16 % = $1,624
const OCD = extra => Object.assign({ proveedor: { razonSocial: 'Ferretera del Puerto' }, fechaEntrega: MANANA, lugarEntrega: 'Querétaro',
  condicionesPago: 'Contado', diasCredito: 0, formaPago: 'Transferencia', idSolicitud: id('oc'),
  renglones: [{ descripcion: 'Cable THW 10', unidad: 'M', cantidad: 80, costo: 10 }, { descripcion: 'Tubo conduit 3/4', unidad: 'PZA', cantidad: 12, costo: 50 }] },
  extra || {});
const pago = (folio, extra) => Object.assign({ reqFolio: folio, fecha: HOY_ISO, monto: 1624, monedaPago: 'MXN', metodo: 'Transferencia',
  referencia: 'SPEI ' + id(), comprobante: { nombre: 'c.pdf', datos: A.PDF }, idSolicitud: id('pg') }, extra || {});
const pagar = (folio, extra) => ok('efrain', 'registrarPagoProveedor', pago(folio, extra));
/** Flujo de siempre: obrero pide, efrain autoriza (y paga si se pide). */
function siempre(pagada, ocExtra) {
  const folio = ok('obrero', 'guardarRequisicion', { proyectoFolio: P2, sitio: 'Querétaro', renglones: RENGLONES,
    cotizacion: { nombre: 'cot.pdf', datos: A.PDF }, idSolicitud: id('q') }).folio;
  const oc = ok('efrain', 'autorizarRequisicion', folio, OCD(ocExtra)).ocFolio;
  if (pagada) pagar(folio);
  return { req: folio, oc: oc };
}
const PROP = () => ({ proveedor: { razonSocial: 'Ferretera del Puerto' }, fechaEntrega: MANANA, condicionesPago: 'Contado', diasCredito: 0,
  formaPago: 'Transferencia', recibe: 'rosa@helgen.tech', idSolicitud: id('p'),
  renglones: [{ renglon: 1, disponibilidad: 'Exacto', costo: 10 }, { renglon: 2, disponibilidad: 'Exacto', costo: 50 }] });
/** Con aprobaciones: tania aprueba, pedro propone, tania da el visto bueno (emite la orden; recibe rosa). */
function conOps() {
  const folio = ok('obrero', 'guardarRequisicion', { proyectoFolio: P2, sitio: 'Querétaro', renglones: RENGLONES, idSolicitud: id('q') }).folio;
  const v = ok('tania', 'getRequisicionOperaciones', folio);
  ok('tania', 'aprobarRequisicion', folio, { version: v.version, prioridad: 'Normal', renglones: v.renglones.map(r => ({ renglon: r.renglon, aprobado: true })) });
  ok('pedro', 'cotizarRequisicion', folio, PROP());
  const w = ok('tania', 'getRequisicionOperaciones', folio);
  return { req: folio, oc: ok('tania', 'autorizarPropuesta', folio, w.propuesta.version, id('vb'), w.propuesta.huella).ocFolio };
}
// El flujo con aprobaciones se enciende con alguien que tenga el rol en Permisos (después de prepararCapri)
let taniaNueva = true;
function aprobaciones(encendido) {
  ok('leo', 'guardarUsuario', Object.assign(taniaNueva ? { nuevo: true } : {}, { correo: 'tania@helgen.tech', nombre: 'Tania',
    roles: encendido ? ['aprobaciones'] : ['ventas'] }));
  taniaNueva = false;
}
const recibir = (req, renglones) => ok('rosa', 'registrarRecepcion', { reqFolio: req, sitio: 'Querétaro', renglones: renglones, idSolicitud: id('r') });
const LC = () => A.libros[props.COMPRAS_DB_ID];
const H = n => LC().pest[n].m;
const filaOc = oc => H('OrdenesCompra').find(r => r[0] === oc);
const movsDe = oc => H('MovimientosInventario').filter(r => r[7] === oc);
const devs = () => H('Devoluciones').slice(1);
const ultimaDev = () => devs().slice(-1)[0][0];

// ================= 1. Cancelar o anular una recepción de una requisición retenida =================
aprobaciones(true);
{
  // Pagada; llega el renglón 1 (REC-a) y luego el 2 con un problema (REC-b): completa, pero retenida por la devolución
  const o = conOps();
  pagar(o.req);
  const ra = recibir(o.req, [{ renglon: 1, cantidad: 80, foto: F }, { renglon: 2, cantidad: 0 }]);
  const rb = recibir(o.req, [{ renglon: 2, cantidad: 12, foto: F, problema: { tipo: 'Dañado', cantidad: 1, comentario: 'Tubo doblado', foto: F } }]);
  assert.deepEqual([rb.estado, filaOc(o.oc)[28]], ['Recibida', 'Pagada'], 'retenida: Recibida con la orden Pagada');
  const dev = ultimaDev();
  // Compras cancela la recepción del renglón 1 (sin devolución en ese renglón): regresa a Pagada, la orden sigue Pagada
  let v = ok('pedro', 'cancelarRecepcion', ra.folio, 'Se registró en el sitio equivocado');
  assert.deepEqual([v.requisicion.estado, v.orden.estado, v.puedePagar, v.puedeRecibir], ['Pagada', 'Pagada', false, true],
    'Recibida con la orden pagada → Pagada (antes: Autorizada con la orden Pagada, sin salida)');
  assert.equal(filaOc(o.oc)[29], '', 'la orden ya no está recibida');
  // Se vuelve a registrar el renglón 1: completa y todavía con la devolución abierta → retenida otra vez; al resolver, se cierra
  assert.equal(recibir(o.req, [{ renglon: 1, cantidad: 80, foto: F }]).estado, 'Recibida');
  const rs = ok('pedro', 'resolverDevolucion', dev, { resolucion: 'Conservar' });
  assert.deepEqual([rs.estado, rs.vista.orden.estado], ['Cerrada', 'Recibida'], 'se cierra sola al resolver');

  // Lo mismo por Anular (módulo E): la recepción anulada regresa la retenida a Pagada
  const o2 = conOps();
  pagar(o2.req);
  const ra2 = recibir(o2.req, [{ renglon: 1, cantidad: 80, foto: F }, { renglon: 2, cantidad: 0 }]);
  recibir(o2.req, [{ renglon: 2, cantidad: 12, foto: F, problema: { tipo: 'Dañado', cantidad: 1, comentario: 'Tubo doblado', foto: F } }]);
  const pv = ok('leo', 'previsualizarAnulacion', ra2.folio);
  assert(pv.efectos.some(e => e.indexOf(o2.req + ' pasa de Recibida a Pagada') !== -1), 'vista previa: ' + JSON.stringify(pv.efectos));
  ok('leo', 'anular', ra2.folio, 'Recepción registrada por error', id('an'));
  v = ok('pedro', 'getRequisicion', o2.req);
  assert.deepEqual([v.requisicion.estado, v.orden.estado, v.puedeRecibir], ['Pagada', 'Pagada', true], 'anular: Recibida (orden pagada) → Pagada');
  assert.equal(P.accionCancelarRecepcion({ estado: 'Pagada', enCaminoEn: '2026-10-29 10:00' }), 'cancelarRecepcionEnCamino', 'en camino manda');
  assert.equal(P.accionCancelarRecepcion({ estado: 'Emitida' }), 'cancelarRecepcion');
  assert.equal(P.transicionReq('Recibida', 'cancelarRecepcionPagada'), 'Pagada');
}
aprobaciones(false);

// ================= 2. Anular × devoluciones =================
{
  const hojaDev = () => H('Devoluciones');
  const estadoDev = folio => (devs().find(r => r[0] === folio) || [])[14];
  const anuladas = () => A.libros[props.ADMIN_DB_ID].pest.Anulaciones.m.slice(1).map(r => r[2] + ' ' + r[3]);
  const pendDev = () => ok('pedro', 'pendientes', false).items.filter(x => x.tipo === 'devolucion').map(x => x.folio);
  // (a) Orden anulada con una devolución abierta: la devolución se anula con ella
  const s = siempre(true);
  ok('obrero', 'cerrarRequisicion', s.req, '', { renglones: [{ renglon: 1, foto: F, problema: { tipo: 'Dañado', cantidad: 5, comentario: 'Rollo mojado', foto: F } },
    { renglon: 2, foto: F }] });
  const dv = ultimaDev();
  assert.deepEqual([estadoDev(dv), pendDev().indexOf(dv) !== -1], ['Abierta', true]);
  const pv = ok('leo', 'previsualizarAnulacion', s.oc);
  assert(pv.registros.some(r => r.tipo === 'Devolución' && r.folio === dv), 'vista previa con la devolución: ' + JSON.stringify(pv.registros));
  assert(!pv.registros.some(r => r.tipo === 'Recepción' && /^DEV-/.test(r.folio)), 'los movimientos de una devolución no salen como "Recepción"');
  ok('leo', 'anular', s.oc, 'Orden emitida al proveedor equivocado', id('an'));
  assert.equal(estadoDev(dv), 'Anulada', 'la devolución queda Anulada en la hoja');
  assert(anuladas().indexOf('Devolución ' + dv) !== -1, 'fila en Anulaciones: ' + JSON.stringify(anuladas()));
  assert.equal(pendDev().indexOf(dv), -1, 'sale de Pendientes');
  assert.equal(ok('pedro', 'listarDevoluciones', { estado: 'Abierta' }).filter(x => x.folio === dv).length, 0);
  // La requisición regresa a Solicitada; con otra orden, pagada y recibida, se cierra (ya no la retiene la devolución vieja)
  assert.equal(ok('pedro', 'getRequisicion', s.req).requisicion.estado, 'Solicitada');
  ok('efrain', 'autorizarRequisicion', s.req, OCD());
  pagar(s.req);
  let mias = ok('obrero', 'cerrarRequisicion', s.req, '', { renglones: [{ renglon: 1, foto: F }, { renglon: 2, foto: F }] });
  assert.equal(mias.find(x => x.folio === s.req).estado, 'Cerrada', 'con la orden nueva se cierra');

  // Devolución "huérfana" de una orden anulada antes de este arreglo (Abierta en la hoja): no retiene a la orden nueva ni sale
  // en listas ni en Pendientes
  const s2 = siempre(true);
  ok('obrero', 'cerrarRequisicion', s2.req, '', { renglones: [{ renglon: 1, foto: F, problema: { tipo: 'Dañado', cantidad: 5, comentario: 'Rollo mojado', foto: F } },
    { renglon: 2, foto: F }] });
  const dv2 = ultimaDev();
  ok('leo', 'anular', s2.oc, 'Orden emitida al proveedor equivocado', id('an'));
  hojaDev().find(r => r[0] === dv2)[14] = 'Abierta'; // como la dejaba el código anterior
  for (const k of Object.keys(A.cache)) delete A.cache[k];
  assert.equal(pendDev().indexOf(dv2), -1, 'huérfana: fuera de Pendientes');
  assert.equal(ok('pedro', 'listarDevoluciones', '').filter(x => x.folio === dv2).length, 0, 'huérfana: fuera de la lista');
  ok('efrain', 'autorizarRequisicion', s2.req, OCD());
  pagar(s2.req);
  mias = ok('obrero', 'cerrarRequisicion', s2.req, '', { renglones: [{ renglon: 1, foto: F }, { renglon: 2, foto: F }] });
  assert.equal(mias.find(x => x.folio === s2.req).estado, 'Cerrada', 'la devolución de la orden anterior no la retiene');
  ok('pedro', 'cerrarRequisicionCompras', siempre(true).req, 'El trabajador ya no está en la obra', ''); // sin devoluciones: igual que antes

  // Requisición anulada con devoluciones (una resuelta con movimiento y una abierta): todas se anulan
  const s3 = siempre(true);
  ok('obrero', 'cerrarRequisicion', s3.req, '', { renglones: [{ renglon: 1, foto: F }, { renglon: 2, foto: F }] });
  ok('obrero', 'reportarProblema', s3.req, { renglon: 1, cantidad: 10, tipo: 'Dañado', comentario: 'Rollo aplastado', foto: F, idSolicitud: id('d') });
  const dvR = ultimaDev();
  ok('pedro', 'resolverDevolucion', dvR, { resolucion: 'Reponer' });
  ok('obrero', 'reportarProblema', s3.req, { renglon: 2, cantidad: 1, tipo: 'Dañado', comentario: 'Tubo doblado', foto: F, idSolicitud: id('d') });
  const dvA = ultimaDev();
  const pv3 = ok('leo', 'previsualizarAnulacion', s3.req);
  assert.deepEqual(pv3.registros.filter(r => r.tipo === 'Devolución').map(r => r.folio).sort(), [dvA, dvR].sort());
  ok('leo', 'anular', s3.req, 'Requisición duplicada por error', id('an'));
  assert.deepEqual([estadoDev(dvR), estadoDev(dvA)], ['Anulada', 'Anulada']);
  assert(movsDe(s3.oc).filter(r => r[0] === dvR).every(r => r[18] === 'Anulada'), 'el movimiento de la devolución también');

  // (b) Anular sola una recepción con una devolución resuelta (Reponer) se rechaza, como cancelarRecepcion
  const s4 = siempre(true);
  ok('obrero', 'cerrarRequisicion', s4.req, '', { renglones: [{ renglon: 1, foto: F }, { renglon: 2, foto: F }] });
  const rec4 = movsDe(s4.oc)[0][0];
  ok('obrero', 'reportarProblema', s4.req, { renglon: 1, cantidad: 10, tipo: 'Dañado', comentario: 'Rollo aplastado', foto: F, idSolicitud: id('d') });
  const dv4 = ultimaDev();
  ok('pedro', 'resolverDevolucion', dv4, { resolucion: 'Reponer' });
  falla('pedro', 'cancelarRecepcion', [rec4, 'Se registró mal'], new RegExp('tiene la devolución ' + dv4 + ' \\(resuelta\\)'));
  const re = new RegExp('recepción ' + rec4 + ' tiene la devolución ' + dv4 + ' \\(resuelta\\): no se puede anular la recepción sola.*anula la orden ' + s4.oc);
  falla('leo', 'previsualizarAnulacion', [rec4], re);
  falla('leo', 'anular', [rec4, 'Recepción registrada por error', id('an')], re);
  const v4 = ok('pedro', 'getRequisicion', s4.req);
  assert(v4.avance.every(l => l.recibido >= 0 && l.pendiente <= l.pedido), 'nada negativo: ' + JSON.stringify(v4.avance));

  // (c) Anular "Lo recogí" no reabre la requisición (no cuenta como recepción)
  const s5 = siempre(true);
  ok('obrero', 'marcarEnCamino', s5.req, { recogido: true, renglones: [{ renglon: 1, foto: F }, { renglon: 2, foto: F }], idSolicitud: id('e') });
  ok('obrero', 'cerrarRequisicion', s5.req, '', { renglones: [{ renglon: 1, foto: F }, { renglon: 2, foto: F }] });
  assert.equal(ok('pedro', 'getRequisicion', s5.req).requisicion.estado, 'Cerrada');
  const recogi = movsDe(s5.oc).find(r => r[3] === 'Recogido en tienda')[0];
  const pv5 = ok('leo', 'previsualizarAnulacion', recogi);
  assert.deepEqual(pv5.efectos, [], 'sin efectos: ' + JSON.stringify(pv5.efectos));
  ok('leo', 'anular', recogi, 'Foto de recogida equivocada', id('an'));
  const v5 = ok('pedro', 'getRequisicion', s5.req);
  assert.deepEqual([v5.requisicion.estado, v5.orden.estado], ['Cerrada', 'Recibida'], 'sigue Cerrada');
}

// ================= 3. Referencias que parecían número de tarjeta =================
{
  const tarjeta = (ref, metodo) => P.pareceNumeroTarjeta(ref, metodo);
  // Antes se rechazaban (falsos positivos de la revisión)
  for (const [ref, metodo] of [
    ['SPEI 29-10-2026 1234567', 'Transferencia'],                 // fecha y folio ya no se juntan
    ['Ticket TC# 7319 0482 3561 8820 4417', 'Tarjeta de débito'],   // ticket de 20 dígitos (como Walmart)
    ['Ticket 06001234567890123456', 'Tarjeta de débito'],          // 22 dígitos seguidos
    ['1234567890123', 'Tarjeta de crédito'],                        // 13 dígitos que no empiezan como tarjeta
    ['Folio 2026-1029-0001-2345', 'Cheque']]) {
    assert.equal(tarjeta(ref, metodo), false, ref + ' (' + metodo + ') no es tarjeta');
  }
  // Claves de rastreo numéricas de 13 a 19 dígitos con Luhn válido: solo las que empiezan con 3–6 parecen tarjeta
  const luhn = base => { for (let d = 0; d < 10; d++) if (P.pasaLuhn(base + d)) return base + d; };
  assert.equal(tarjeta(luhn('008590123456789012'), 'Transferencia'), false, 'empieza con 0');
  assert.equal(tarjeta(luhn('2025102940014'), 'Transferencia'), false, 'empieza con 2');
  assert.equal(tarjeta(luhn('7311029001234'), 'Transferencia'), false, 'empieza con 7');
  // Una CLABE de STP (646…) válida que además pasa Luhn no es tarjeta
  let clabeLuhn = '';
  for (let n = 0; n < 100000 && !clabeLuhn; n++) {
    const base = '64618000' + String(n).padStart(9, '0');
    for (let v = 0; v < 10; v++) { const c = base + v; let ok = false; try { ok = P.validarClabe(c) === c; } catch (e) { ok = false; }
      if (ok && P.pasaLuhn(c)) { clabeLuhn = c; break; } }
  }
  assert(clabeLuhn, 'hay una CLABE STP con Luhn válido');
  assert.equal(tarjeta(clabeLuhn, 'Transferencia'), false, 'CLABE válida ' + clabeLuhn);
  assert.equal(tarjeta('CLABE ' + clabeLuhn, 'Cheque'), false);
  // Se siguen rechazando las tarjetas, con cualquier método y escritas como se escriben
  for (const [ref, metodo] of [['4111111111111111', 'Transferencia'], ['4111 1111 1111 1111', 'Tarjeta de crédito'],
    ['tarjeta 5555-5555-5555-4444', 'Efectivo'], ['378282246310005', 'Tarjeta de crédito'], ['3782 822463 10005', 'Cheque'],
    ['6011 1111 1111 1117', 'Tarjeta de débito'], ['29-10-2026 4111 1111 1111 1111', 'Transferencia'], ['Pago con 4111111111111111 ok', 'Cheque']]) {
    assert.equal(tarjeta(ref, metodo), true, ref + ' (' + metodo + ') es tarjeta');
  }
  assert.equal(tarjeta('AUT 482913 · 4111', 'Tarjeta de crédito'), false, 'autorización y últimos 4');
  // Por el servidor: pago a proveedor con la referencia de antes y el mensaje nuevo
  const s = siempre(false);
  ok('efrain', 'registrarPagoProveedor', pago(s.req, { referencia: 'SPEI 29-10-2026 1234567' }));
  const s2 = siempre(false);
  falla('efrain', 'registrarPagoProveedor', [pago(s2.req, { metodo: 'Tarjeta de crédito', referencia: '4111 1111 1111 1111' })],
    /parece un número de tarjeta: nunca lo captures\. Escribe el número de autorización o solo los últimos 4 dígitos de la tarjeta\./);
  ok('efrain', 'registrarPagoProveedor', pago(s2.req, { metodo: 'Tarjeta de débito', referencia: 'Ticket TC# 7319 0482 3561 8820 4417' }));
}

console.log('revision5: ok');
