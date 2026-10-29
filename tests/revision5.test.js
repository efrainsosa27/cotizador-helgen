// Incremento 5 · revisión independiente (29/10/2026): un caso por hallazgo, sembrado por doPost con el arnés. Cada sección
// reproduce el escenario de la revisión (fallaba antes del arreglo) y comprueba el comportamiento corregido:
//  1. Cancelar (o anular) una recepción de una requisición retenida por una devolución (Recibida con la orden Pagada) la regresa
//     a Pagada (o En camino), no a Autorizada con la orden pagada (se quedaba atorada para siempre).
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

console.log('revision5: ok');
