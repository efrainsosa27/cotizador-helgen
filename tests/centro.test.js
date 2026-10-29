// Incremento 4 (CAPRI), módulo C: centro de mando (drogheda.helgen.online). Un centro de mando simulado verifica la firma
// HMAC con crypto de Node, rechaza horas de más de 5 minutos, guarda los avisos por evento_id y contesta como el contrato.
// Cubre: firma (vector), cuerpo sin montos, sitio con código solo en proyectos ligados, evento_id estable y creciente, proyectos
// sin ligar no mandan nada, caída (500 / sin respuesta) → PortalPendientes y la acción sigue, reintentos del activador en orden,
// recepciones (completa, parcial, repetida; con y sin pago), En camino (quién, desde qué estados, Lo recogí, pago en camino,
// cancelar en camino con motivo y confirmación), respaldo de compras, columna inventario_item que se migra sola, ítems en caché,
// misArticulos, activador instalado una vez, caché caliente y función apagada sin secreto.
// Uso: node tests/centro.test.js .
'use strict';
const assert = require('assert'), crypto = require('crypto');
const dir = process.argv[2] || '.';
const ANIO = String(new Date().getFullYear());
const P1 = 'PRY-' + ANIO + '-0001', P2 = 'PRY-' + ANIO + '-0002'; // P1 = DROGHEDA (ligado); P2 sin ligar
const SECRETO = 'f3a9c1d2e4b5a6978877665544332211aabbccddeeff00112233445566778899';
const SITIOS_CM = ['VER', 'ZLO', 'ESE', 'LZC', 'QRO'];

// ---- Centro de mando simulado (contrato del 28/10/2026) ----
const CM = { modo: 'ok', modoRec: 'ok', eventos: {}, orden: [], recibidos: [], rechazos: [], recepciones: [], desdes: [], hasta: '',
  llamadasItems: 0, items: [{ codigo: 'CAB-THW-10', descripcion: 'Cable THW calibre 10', unidad: 'm', categoria: 'Eléctrico' },
    { codigo: 'TUB-1', descripcion: 'Tubo conduit 1"', unidad: 'pza', categoria: 'Tubería' },
    { codigo: 'mal código', descripcion: 'con espacio' }, { codigo: 'CAB-THW-10', descripcion: 'repetido' }] };
function verificar(op, cuerpo) {
  const h = (op && op.headers) || {}, t = h['X-Hbox-Tiempo'], f = h['X-Hbox-Firma'];
  if (!t || !f) return 'sin firma';
  const ms = Date.parse(t);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/.test(t) || isNaN(ms) || Math.abs(Date.now() - ms) > 5 * 60000) return 'firma vencida';
  const esperada = 'sha256=' + crypto.createHmac('sha256', SECRETO).update(t + '\n' + cuerpo, 'utf8').digest('hex');
  return f === esperada ? '' : 'firma inválida';
}
const rutas = [
  { re: /^https:\/\/drogheda\.test\/api\/integracion\/cotizador\/evento$/, fn: (url, op) => {
    if (CM.modo === 'caido') throw new Error('Tiempo de espera agotado: https://drogheda.test');
    if (CM.modo === '500') return { codigo: 500, cuerpo: 'Internal Server Error' };
    if (CM.modo === 'rechaza') return { codigo: 400, cuerpo: { ok: false, error: 'dato inválido' } };
    assert.equal(op.method, 'post');
    const cuerpo = String(op.payload || '');
    assert(/^[\x20-\x7e]*$/.test(cuerpo), 'el cuerpo va en ASCII (lo demás escapado)');
    const e = verificar(op, cuerpo);
    if (e) { CM.rechazos.push(e); return { codigo: 401, cuerpo: { ok: false, error: e } }; }
    const ev = JSON.parse(cuerpo);
    CM.recibidos.push(ev);
    if (CM.eventos[ev.evento_id]) return { codigo: 200, cuerpo: { ok: true, repetido: true } };
    if (SITIOS_CM.indexOf(ev.oc.sitio) === -1) return { codigo: 400, cuerpo: { ok: false, error: 'sitio inválido: ' + ev.oc.sitio } };
    CM.eventos[ev.evento_id] = ev; CM.orden.push(ev.evento_id);
    if (CM.modo === 'perdido') return { codigo: 502, cuerpo: 'Bad Gateway' }; // lo guardó pero la respuesta se perdió
    return { codigo: 200, cuerpo: { ok: true, estado_portal: 'en_transito', tarea_id: CM.orden.length,
      por_ligar: ev.oc.renglones.filter(r => !r.item).map(r => r.n) } };
  } },
  { re: /^https:\/\/drogheda\.test\/api\/integracion\/cotizador\/recepciones\?desde=/, fn: (url, op) => {
    assert.equal(op.method, 'get');
    if (CM.modoRec === '500') return { codigo: 500, cuerpo: 'Internal Server Error' };
    const e = verificar(op, '');
    if (e) return { codigo: 401, cuerpo: { ok: false, error: e } };
    CM.desdes.push(decodeURIComponent(url.split('desde=')[1]));
    CM.hasta = new Date().toISOString();
    return { codigo: 200, cuerpo: { ok: true, hasta: CM.hasta, recepciones: CM.recepciones } };
  } },
  { re: /^https:\/\/drogheda\.test\/api\/integracion\/inventario\/items$/, fn: (url, op) => {
    CM.llamadasItems++;
    const e = verificar(op, '');
    if (e) return { codigo: 401, cuerpo: { ok: false, error: e } };
    return { codigo: 200, cuerpo: { ok: true, items: CM.items } };
  } },
];

const A = require('./arnes')(dir, { rutas, props: {
  ROL_COMPRAS: 'efrain@helgen.tech, pedro@helgen.tech', ROL_COBRANZA: 'efrain@helgen.tech',
  ROL_REQUISICION: 'obrero@helgen.tech, efrain@helgen.tech, pedro@helgen.tech', SOLO_REQUISICION: 'rosa@helgen.tech, adri@helgen.tech',
  ROL_OPERACIONES: 'adri@helgen.tech, leo@helgen.tech',
  PORTAL_URL: 'https://drogheda.test/', PORTAL_PROYECTOS: JSON.stringify({ [P1 + '-DRO']: 'drogheda' }) } });
const { P, ok, falla, plain, props, HOY_ISO, masDias, correr, como, PDF, conFotos, FOTOS } = A;
const MANANA = masDias(1), AYER = masDias(-1);
// F (incremento 5): sin CSF y carátula del proveedor no se registra un pago; estas pruebas no son de documentos (eso va en
// tests/proveedores.test.js), así que aquí se salta ese bloqueo
P.exigirDocumentosParaPagar_ = function () {};
correr('var AVISOS = []; enviarCorreosPendientes_ = function () { AVISOS.push.apply(AVISOS, MEMO_.correos || []); MEMO_.correos = []; };');
const avisos = tipo => plain(correr('AVISOS')).filter(a => a.tipo === tipo);
const MONTOS = /costo|importe|subtotal|iva|total|cambio|moneda|margen|monto|precio/i;
const llaves = (o, acc) => { acc = acc || []; if (o && typeof o === 'object') Object.keys(o).forEach(k => { if (!Array.isArray(o)) acc.push(k); llaves(o[k], acc); }); return acc; };
const llamadasCM = () => A.llamadas.filter(l => /drogheda\.test/.test(l.url)).length;

// ---- Libro de compras de antes (sin inventario_item ni columnas de En camino): se migra solo ----
const HC = correr('HOJAS_COMPRAS');
const LC = A.libro('OLDC', 'Compras (datos)', {
  Requisiciones: A.hoja([HC.Requisiciones.enc.slice(), ['REQ-2025-0099', "2025-12-01", 'PRY-2025-0009', 'obrero@helgen.tech', 'Juan Obrero',
    'Cerrada', '', '', '', '', '', '', '', '', 'Querétaro'].concat(Array(10).fill(''))]),
  RequisicionesRenglones: A.hoja([['req_folio', 'version', 'renglon', 'descripcion', 'cantidad', 'unidad', 'notas'],
    ['REQ-2025-0099', 1, 1, 'Guantes de carnaza', 5, 'PAR', ''], ['REQ-2025-0099', 1, 2, 'cable thw 10', 30, 'M', '']]),
  OrdenesCompra: A.hoja([HC.OrdenesCompra.enc.slice(0, 36)]),
});
props.COMPRAS_DB_ID = 'OLDC';
const H = n => LC.pest[n].m;
// Config → SITIOS con código (formato nuevo) más un sitio sin código conocido
A.libros.DB.pest.Config.m.push(['SITIOS', correr('SITIOS_INICIALES') + '\nMonterrey']);

// ================= Lógica pura =================
assert.equal(P.hexDeBytes([-1, 0, 127, -128, 16]), 'ff007f8010');
assert.equal(P.firmaPortal_('secreto-compartido', '2026-10-28T10:15:00-06:00', '{"evento_id":"OC-2026-0001:oc.autorizada:1"}'),
  '43c694fb339a86837a7df8f0785e3aa96673eceb05c50b371ec5f8a9154be25e', 'vector de la firma (HMAC-SHA256, hex)');
const js = P.jsonAscii({ d: 'Tubería ½" — Eléctrica', n: 1 });
assert(/^[\x20-\x7e]*$/.test(js) && /\\u00ed/.test(js));
assert.deepEqual(JSON.parse(js), { d: 'Tubería ½" — Eléctrica', n: 1 });
const iso = P.isoConZona_(new Date(Date.UTC(2026, 9, 28, 16, 15, 0)));
assert(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/.test(iso), iso);
assert.equal(Date.parse(iso), Date.UTC(2026, 9, 28, 16, 15, 0), 'misma hora, con su zona');
assert.equal(P.fechaCortaEs('2026-10-30'), '30-oct-2026');
assert.equal(P.sitiosConCodigoTexto('Querétaro\nVeracruz (ICAVE)'), 'QRO | Querétaro\nVER | Veracruz (ICAVE)');
assert.equal(P.sitiosConCodigoTexto('QRO | Querétaro'), '', 'ya tiene códigos');
assert.equal(P.sitiosConCodigoTexto('Querétaro\nMonterrey'), '', 'un sitio sin código conocido: no se toca');
assert.equal(P.itemInventario(' CAB-THW-10 '), 'CAB-THW-10');
assert.equal(P.itemInventario(''), '');
assert.throws(() => P.itemInventario('CAB THW', 'Cable'), /no es un código del inventario/);
assert.throws(() => P.itemInventario('x'.repeat(41)), /máximo 40/);
assert.deepEqual(plain(P.normalizarItemsPortal(CM.items)).map(x => x.codigo + ':' + x.unidad), ['CAB-THW-10:M', 'TUB-1:PZA'], 'limpia y sin repetir');
assert.deepEqual(plain(P.articulosFrecuentes([
  { descripcion: 'Guantes', unidad: 'PAR', item: '', orden: 1 }, { descripcion: 'cable THW 10', unidad: 'M', item: 'CAB-OLD', orden: 2 },
  { descripcion: 'Cable THW 10', unidad: 'M', item: 'CAB-THW-10', orden: 5 }, { descripcion: 'Cable  thw 10 ', unidad: 'M', item: '', orden: 7 },
  { descripcion: 'Tubo', unidad: 'PZA', item: '', orden: 9 }, { descripcion: 'Tubo', unidad: 'PZA', item: '', orden: 3 }])),
  [{ descripcion: 'Cable  thw 10', unidad: 'M', item: 'CAB-THW-10', veces: 3 }, { descripcion: 'Tubo', unidad: 'PZA', item: '', veces: 2 },
    { descripcion: 'Guantes', unidad: 'PAR', item: '', veces: 1 }], 'más pedidos primero; la descripción más reciente; el último ítem');
// En camino
const ec = (d, hoy) => plain(P.normalizarEnCamino(d, { hoy: hoy || HOY_ISO, nombre: 'Rosa Mena' }));
assert.deepEqual(ec({ recogido: true }), { recogido: true, traeProveedor: false, paqueteria: 'Recogido por Rosa Mena', guia: '', fechaEstimada: HOY_ISO });
assert.deepEqual(ec({ paqueteria: ' DHL ', guia: '123 456', fechaEstimada: MANANA }),
  { recogido: false, traeProveedor: false, paqueteria: 'DHL', guia: '123 456', fechaEstimada: MANANA });
assert.equal(ec({ traeProveedor: true, fechaEstimada: HOY_ISO }).paqueteria, 'Lo trae el proveedor', 'sin guía si lo trae el proveedor');
for (const [d, re] of [[{ guia: '1', fechaEstimada: MANANA }, /paquetería/], [{ paqueteria: 'DHL', fechaEstimada: MANANA }, /guía/],
  [{ paqueteria: 'DHL', guia: '1' }, /fecha estimada/], [{ paqueteria: 'DHL', guia: '1', fechaEstimada: AYER }, /anterior a hoy/],
  [{ paqueteria: 'x'.repeat(61), guia: '1', fechaEstimada: MANANA }, /máximo 60/]]) assert.throws(() => P.normalizarEnCamino(d, { hoy: HOY_ISO }), re);
assert.equal(P.textoEnCamino({ paqueteria: 'DHL', guia: '9', fechaEstimada: '2026-11-02' }), 'Enviado por DHL · guía 9 · llega aprox. el 02/11/2026');
assert.equal(P.textoEnCamino({ paqueteria: 'Recogido por Rosa', fechaEstimada: '2026-10-28' }), 'Recogido por Rosa el 28/10/2026; va al sitio');
// Estados
for (const [acc, de, a] of [['enCamino', 'Autorizada', 'En camino'], ['enCamino', 'Pagada', 'En camino'], ['enCamino', 'En camino', 'En camino'],
  ['pagarEnCamino', 'En camino', 'En camino'], ['cancelarPagoEnCamino', 'En camino', 'En camino'], ['cerrarEnCamino', 'En camino', 'Cerrada'],
  ['recibir', 'En camino', 'Recibida'], ['recibirPagada', 'En camino', 'Cerrada'], ['cancelarOc', 'En camino', 'Solicitada'],
  ['cancelarOcAprobada', 'En camino', 'Aprobada'], ['cancelarRecepcionEnCamino', 'Recibida', 'En camino']]) {
  assert.equal(P.transicionReq(de, acc), a, acc + ' desde ' + de);
}
for (const [acc, de] of [['enCamino', 'Solicitada'], ['enCamino', 'Cerrada'], ['enCamino', 'Recibida'], ['enCamino', 'Cotizada'],
  ['pagar', 'En camino'], ['cerrar', 'En camino']]) assert.throws(() => P.transicionReq(de, acc), /no se puede/, acc + ' desde ' + de);
// Cuerpo del aviso: sin montos, n = renglón de la orden, item o null, sin los renglones que no se reciben
const cu = plain(P.cuerpoEventoPortal('oc.pagada', 3, { cuando: iso, quien: 'efrain@helgen.tech', prueba: false, proyectoFolio: P1, proyectoClave: 'drogheda',
  sitioCodigo: 'ZLO', sinRecibir: [3], req: { folio: 'REQ-1', solicitanteEmail: 'obrero@helgen.tech', voboEmail: 'adri@helgen.tech' },
  orden: { folio: 'OC-1', proveedor: 'Ferretera', fechaEntrega: MANANA, total: 1856, moneda: 'MXN', subtotal: 1600, renglones: [
    { descripcion: 'Cable', unidad: 'M', cantidad: 80, costo: 10, importe: 800, item: 'CAB-THW-10' }, { descripcion: 'Tubo', unidad: 'PZA', cantidad: 12, costo: 50, importe: 600 },
    { descripcion: 'Flete', unidad: 'SERV', cantidad: 1, costo: 200, importe: 200 }] } }));
assert.deepEqual(cu, { evento_id: 'OC-1:oc.pagada:3', tipo: 'oc.pagada', cuando: iso, quien: 'efrain@helgen.tech', prueba: false,
  oc: { folio: 'OC-1', req_folio: 'REQ-1', proyecto_folio: P1, proyecto_clave: 'drogheda', sitio: 'ZLO', proveedor: 'Ferretera', fecha_entrega: MANANA,
    paqueteria: '', guia: '', solicitante: 'obrero@helgen.tech', autorizo: 'adri@helgen.tech',
    renglones: [{ n: 1, descripcion: 'Cable', unidad: 'M', cantidad: 80, item: 'CAB-THW-10' }, { n: 2, descripcion: 'Tubo', unidad: 'PZA', cantidad: 12, item: null }] } });
assert.deepEqual(plain(P.buscarMontos({ a: { costo: 1, b: [{ total: 2 }] }, tipo: 'x' })), ['a.costo', 'a.b.0.total']);
assert.deepEqual(plain(P.buscarMontos(cu)), []);
assert.throws(() => P.cuerpoEventoPortal('oc.borrada', 1, {}), /no válido/);

// ================= Servidor =================
const p1 = ok('ana', 'crearProyecto', { nombre: 'DROGHEDA', ubicacion: 'Veracruz', cliente: { nombre: 'Hutchison', empresa: 'ICAVE' }, idSolicitud: 'p1' }).folio;
const p2 = ok('ana', 'crearProyecto', { nombre: 'Casa del Lago', ubicacion: 'Querétaro', cliente: { nombre: 'Luis', empresa: 'Solar' }, idSolicitud: 'p2' }).folio;
assert.deepEqual([p1, p2], [P1, P2]);

let nId = 0;
const id = p => p + (++nId);
const nuevaReq = (proyecto, extra) => Object.assign({ proyectoFolio: proyecto, sitio: 'manzanillo (timsa)', idSolicitud: id('q'),
  renglones: [{ descripcion: 'Cable THW 10', cantidad: 80, unidad: 'm', item: 'CAB-THW-10' }, { descripcion: 'Tubo conduit 3/4', cantidad: 12, unidad: 'pza' }] }, extra || {});
const PROP = extra => Object.assign({ proveedor: { razonSocial: 'Ferretera del Puerto', rfc: '' }, fechaEntrega: MANANA, formaPago: 'Transferencia', condicionesPago: 'Contado',
  diasCredito: 0, recibe: 'rosa@helgen.tech', idSolicitud: id('p'), renglones: [{ renglon: 1, disponibilidad: 'Exacto', costo: 10 },
    { renglon: 2, disponibilidad: 'Sustituto', descripcion: 'Tubo conduit 1"', costo: 50, item: 'TUB-1' },
    { renglon: 0, disponibilidad: 'Adicional', descripcion: 'Flete', unidad: 'SERV', cantidad: 1, costo: 200, recibir: false }] }, extra || {});
function aprobar(folio) {
  const v = ok('adri', 'getRequisicionOperaciones', folio);
  ok('adri', 'aprobarRequisicion', folio, { version: v.version, prioridad: 'Normal', renglones: v.renglones.map(r => ({ renglon: r.renglon, aprobado: true })) });
}
function visto(folio) {
  const v = ok('adri', 'getRequisicionOperaciones', folio);
  return ok('adri', 'autorizarPropuesta', folio, v.propuesta.version, id('vb'), v.propuesta.huella);
}
/** Requisición hasta su orden de compra (flujo con operaciones). */
function hastaOrden(proyecto, extra, prop) {
  const folio = ok('obrero', 'guardarRequisicion', nuevaReq(proyecto, extra)).folio;
  aprobar(folio);
  ok('pedro', 'cotizarRequisicion', folio, PROP(prop));
  const vb = visto(folio);
  return { req: folio, oc: vb.ocFolio, vb: vb };
}
const pagar = (folio, monto) => ok('efrain', 'registrarPagoProveedor', { reqFolio: folio, fecha: HOY_ISO, monto: monto || 1856, monedaPago: 'MXN',
  metodo: 'Transferencia', referencia: 'SPEI ' + (++nId), comprobante: { nombre: 'c.pdf', datos: PDF }, idSolicitud: id('pg') });
const filaPend = idEv => H('PortalPendientes').find(r => r[0] === idEv);
const mia = (quien, folio) => ok(quien, 'misRequisiciones').find(x => x.folio === folio);

// ---- Función apagada (sin PORTAL_SECRETO): todo como antes, nada sale ----
const r0 = hastaOrden(P1);
assert.equal(llamadasCM(), 0, 'sin secreto no se llama al centro de mando');
assert(!LC.pest.PortalPendientes || LC.pest.PortalPendientes.m.length <= 1, 'ni se forman avisos');
let m0 = mia('obrero', r0.req);
assert.deepEqual([m0.centroMando, m0.puedeRecibir, m0.puedeEnCamino], [null, true, true], 'sin función: se recibe en CAPRI como siempre');
assert.deepEqual(plain(ok('rosa', 'itemsInventario')), { activo: false, items: [] });
assert.deepEqual(plain(ok('obrero', 'bootstrap').centro), { activo: false, ligados: [], items: null, misArticulos: null });
// Migración: la columna inventario_item (y las de En camino) se agregaron solas; los renglones viejos siguen igual
assert.deepEqual(H('RequisicionesRenglones')[0], HC.RequisicionesRenglones.enc);
assert.equal(H('RequisicionesRenglones')[0].slice(-1)[0], 'inventario_item');
assert.deepEqual(H('RequisicionesRenglones')[1], ['REQ-2025-0099', 1, 1, 'Guantes de carnaza', 5, 'PAR', ''], 'la fila vieja no cambia');
assert.deepEqual(H('RequisicionesRenglones').filter(r => r[0] === r0.req).map(r => r.slice(3).join('|')),
  ['Cable THW 10|80|M||CAB-THW-10', 'Tubo conduit 3/4|12|PZA|'], 'ítem por renglón (solo si tiene)');
assert.deepEqual(H('OrdenesCompra')[0].slice(-6), ['paqueteria', 'guia', 'fecha_estimada', 'en_camino_en', 'en_camino_por', 'forma_pago'],
  'centro de mando y, al final, forma_pago (F, incremento 5)');
let filaOc = H('OrdenesCompra').find(r => r[0] === r0.oc);
assert.deepEqual(JSON.parse(filaOc[21]).map(r => r.descripcion + ':' + (r.item || '')), ['Cable THW 10:CAB-THW-10', 'Tubo conduit 1":TUB-1', 'Flete:'],
  'la orden conserva el ítem (exacto: el de quien pidió; sustituto: el que eligió compras)');
assert.equal(ok('obrero', 'marcarEnCamino', r0.req, { paqueteria: 'Estafeta', guia: 'E-1', fechaEstimada: MANANA, idSolicitud: id('e') }).estado, 'En camino');
assert.equal(llamadasCM(), 0);
let rr = ok('rosa', 'registrarRecepcion', { reqFolio: r0.req, sitio: 'Manzanillo (TIMSA)', renglones: conFotos([{ renglon: 1, cantidad: 80 }, { renglon: 2, cantidad: 12 }]), idSolicitud: id('r') });
assert.deepEqual([rr.completo, rr.estado], [true, 'Recibida'], 'En camino sin pagar + todo recibido = Recibida (espera el pago)');
assert.equal(pagar(r0.req).vista.requisicion.estado, 'Cerrada');

// ---- Encendido: PORTAL_SECRETO ----
props.PORTAL_SECRETO = SECRETO;
assert.deepEqual(plain(ok('obrero', 'bootstrap').centro), { activo: true, ligados: [P1], items: null, misArticulos: null }, 'listas pesadas solo si están en caché');
let sinc = ok('obrero', 'sincronizar', {}, {});
assert.deepEqual(plain(sinc.centro), { activo: true, ligados: [P1] });
// Ítems: requisiciones, compras o aprobaciones; en caché 6 h
falla('ana', 'itemsInventario', [], /No tienes acceso a los ítems/, 'PERMISO');
let it = ok('rosa', 'itemsInventario');
assert.deepEqual(it.items.map(x => x.codigo), ['CAB-THW-10', 'TUB-1']);
ok('pedro', 'itemsInventario'); ok('adri', 'itemsInventario');
assert.equal(CM.llamadasItems, 1, 'una sola consulta: después sale del caché');
assert.deepEqual(ok('obrero', 'bootstrap').centro.items.map(x => x.codigo), ['CAB-THW-10', 'TUB-1'], 'ya en caché: va en la carga inicial');

// Sitio obligatorio y con código en proyectos ligados (con operaciones el sitio ya es obligatorio para todos)
falla('obrero', 'guardarRequisicion', [nuevaReq(P1, { sitio: 'Monterrey' })], /no es un sitio del centro de mando/);
assert(ok('obrero', 'guardarRequisicion', nuevaReq(P2, { sitio: 'Monterrey' })).folio, 'sin ligar: cualquier sitio de la lista');
falla('obrero', 'guardarRequisicion', [nuevaReq(P1, { renglones: [{ descripcion: 'Cable', cantidad: 1, item: 'CAB THW' }] })], /no es un código del inventario/);

// ---- Flujo ligado: orden autorizada → aviso firmado, sin montos ----
const r1 = hastaOrden(P1);
const ev1 = CM.eventos[r1.oc + ':oc.autorizada:1'];
assert(ev1, 'aviso oc.autorizada:1 ' + JSON.stringify(Object.keys(CM.eventos)));
assert.deepEqual([ev1.tipo, ev1.quien, ev1.prueba, ev1.oc.folio, ev1.oc.req_folio, ev1.oc.proyecto_folio, ev1.oc.proyecto_clave, ev1.oc.sitio,
  ev1.oc.proveedor, ev1.oc.fecha_entrega, ev1.oc.solicitante, ev1.oc.autorizo],
  ['oc.autorizada', 'adri@helgen.tech', false, r1.oc, r1.req, P1, 'drogheda', 'ZLO', 'Ferretera del Puerto', MANANA, 'obrero@helgen.tech', 'adri@helgen.tech']);
assert.deepEqual(ev1.oc.renglones, [{ n: 1, descripcion: 'Cable THW 10', unidad: 'M', cantidad: 80, item: 'CAB-THW-10' },
  { n: 2, descripcion: 'Tubo conduit 1"', unidad: 'PZA', cantidad: 12, item: 'TUB-1' }], 'sin el flete (no se recibe en sitio)');
assert(Date.parse(ev1.cuando) && /[+-]\d\d:\d\d$/.test(ev1.cuando));
assert.equal(filaPend(r1.oc + ':oc.autorizada:1')[5], 'Enviado');
assert(!r1.vb.avisoPortal, 'llegó: sin aviso de pendiente');
assert(!CM.recibidos.some(e => r0.oc === e.oc.folio), 'la orden de antes (sin función) no se manda');

// Requisición ligada vista por quien pidió y por quien recibe: se recibe en el centro de mando
let m1 = mia('obrero', r1.req);
assert.deepEqual([m1.centroMando.sitio, m1.puedeRecibir, m1.puedeCerrar, m1.puedeEnCamino, m1.puedeRecoger, m1.enCamino],
  ['ZLO · Manzanillo (TIMSA)', false, false, true, true, null]);
let mr = mia('rosa', r1.req);
assert.deepEqual([mr.puedeRecibir, mr.puedeEnCamino, mr.puedeRecoger], [false, false, true], 'quien recibe: solo "Lo recogí"');
falla('obrero', 'registrarRecepcion', [{ reqFolio: r1.req, sitio: 'Manzanillo (TIMSA)', renglones: conFotos([{ renglon: 1, cantidad: 1 }]) }], /se recibe en el centro de mando \(ZLO/);
falla('rosa', 'registrarRecepcion', [{ reqFolio: r1.req, sitio: 'Manzanillo (TIMSA)', renglones: conFotos([{ renglon: 1, cantidad: 1 }]) }], /se recibe en el centro de mando/);
let vc = ok('pedro', 'getRequisicion', r1.req);
assert.deepEqual([vc.centroMando.sitioCodigo, vc.centroMando.proyecto, vc.puedeEnCamino, vc.puedeRecibir], ['ZLO', 'drogheda', true, true], 'compras: respaldo');

// En camino: quién y validaciones
falla('ana', 'marcarEnCamino', [r1.req, {}], /No tienes permiso para registrar envíos/, 'PERMISO');
falla('rosa', 'marcarEnCamino', [r1.req, { paqueteria: 'DHL', guia: '1', fechaEstimada: MANANA }], /Solo compras o quien pidió/, 'PERMISO');
falla('obrero', 'marcarEnCamino', [r1.req, { paqueteria: 'DHL', fechaEstimada: MANANA }], /número de guía/);
falla('obrero', 'marcarEnCamino', [r1.req, { paqueteria: 'DHL', guia: '1', fechaEstimada: AYER }], /anterior a hoy/);
const idE = id('e');
let en = ok('obrero', 'marcarEnCamino', r1.req, { paqueteria: 'DHL', guia: '123 456', fechaEstimada: MANANA, idSolicitud: idE });
assert.equal(en.estado, 'En camino');
assert.equal(ok('obrero', 'marcarEnCamino', r1.req, { paqueteria: 'DHL', guia: '123 456', fechaEstimada: MANANA, idSolicitud: idE }).estado, 'En camino');
const ev2 = CM.eventos[r1.oc + ':oc.en_camino:1'];
assert.deepEqual([ev2.oc.paqueteria, ev2.oc.guia, ev2.oc.fecha_entrega, ev2.quien], ['DHL', '123 456', MANANA, 'obrero@helgen.tech']);
assert(!CM.eventos[r1.oc + ':oc.en_camino:2'], 'el reenvío con el mismo id no forma otro aviso');
filaOc = H('OrdenesCompra').find(r => r[0] === r1.oc);
assert.deepEqual([filaOc[36], filaOc[37], filaOc[38], filaOc[40]], ['DHL', '123 456', MANANA, 'obrero@helgen.tech']);
m1 = mia('obrero', r1.req);
assert.deepEqual(plain(m1.enCamino).paqueteria, 'DHL');
assert.equal(m1.enCamino.fechaEstimada, MANANA, 'quien pidió ve la fecha estimada');
assert(/Enviado por DHL · guía 123 456 · llega aprox\. el/.test(m1.eventos.slice(-1)[0].nota));
assert(!JSON.stringify(m1).match(/1856|1,856|Ferretera/), 'quien pidió nunca ve montos ni proveedor');
let enc = avisos('req.encamino').filter(a => a.datos.folio === r1.req);
assert.equal(enc.length, 1, 'aviso por correo req.encamino (una vez: el reenvío no lo repite)');
assert.equal(avisos('req.encamino').filter(a => a.datos.folio === r0.req).length, 1, 'también sin centro de mando');
assert.deepEqual(enc[0].datos.para, ['obrero@helgen.tech', 'rosa@helgen.tech']);
assert.deepEqual(llaves(enc[0].datos).filter(k => MONTOS.test(k) || /proveedor|propuesta/.test(k)), [], 'el aviso por correo no lleva montos ni proveedor');
// Lo recogí (quien recibe): corrige el envío y forma oc.en_camino:2
en = ok('rosa', 'marcarEnCamino', r1.req, { recogido: true, renglones: FOTOS.renglones, idSolicitud: id('e') });
assert.equal(CM.eventos[r1.oc + ':oc.en_camino:2'].oc.paqueteria, 'Recogido por Rosa Mena');
assert.equal(CM.eventos[r1.oc + ':oc.en_camino:2'].oc.guia, '');
assert(/Envío corregido: Recogido por Rosa Mena/.test(mia('rosa', r1.req).eventos.slice(-1)[0].nota));
// Pago mientras va en camino: sigue En camino y la orden queda Pagada
let pg = pagar(r1.req);
assert.deepEqual([pg.vista.requisicion.estado, pg.vista.orden.estado, pg.vista.puedeCancelarPago, pg.vista.puedeCerrar], ['En camino', 'Pagada', true, true]);
assert(CM.eventos[r1.oc + ':oc.pagada:1']);
assert(/Pagada; el material va en camino/.test(pg.vista.eventos.slice(-1)[0].nota));

// ---- Recepciones del centro de mando ----
const cuando = '2026-10-30T11:20:00-06:00';
CM.recepciones = [{ oc_folio: r1.oc, req_folio: r1.req, sitio: 'ZLO', completa: false, recibio: 'jesush', cuando: cuando,
  renglones: [{ n: 1, pedido: 80, recibido: 50 }, { n: 2, pedido: 12, recibido: 0 }] }];
let vReq = Number(props.VER_requisiciones);
como(null);
let tr = plain(P.traerRecepcionesPortal());
assert.deepEqual([tr.ok, tr.parciales, tr.cerradas], [true, [r1.req], []]);
assert(Date.now() - Date.parse(CM.desdes[0]) > 29 * 86400000, 'la primera vez, 30 días atrás');
assert.equal(props.PORTAL_ULTIMA_CONSULTA, CM.hasta, 'se guarda solo si todo salió bien');
const hasta1 = CM.hasta;
assert(Number(props.VER_requisiciones) > vReq, 'sube la versión: los navegadores se enteran');
m1 = mia('obrero', r1.req);
assert.equal(m1.estado, 'En camino', 'parcial: sigue En camino');
assert.equal(m1.eventos.slice(-1)[0].nota, 'Recepción parcial en ZLO por jesush en el centro de mando, 30-oct-2026: 50 M Cable THW 10');
assert.equal(m1.eventos.slice(-1)[0].correo, 'centro de mando');
let movs = H('MovimientosInventario').filter(r => r[7] === r1.oc && r[3] === 'Entrada por compra');
assert.deepEqual(movs.map(r => [r[4], r[8], r[12], r[13], r[14]]), [['Manzanillo (TIMSA)', 1, 50, 'centro de mando', 'jesush (centro de mando)']]);
// La misma recepción otra vez (la consulta se repitió): nada nuevo
como(null);
tr = plain(P.traerRecepcionesPortal());
assert.deepEqual([tr.parciales, tr.ignoradas], [[], [r1.oc + ' (sin cambios)']]);
assert.equal(CM.desdes[1], hasta1, 'la siguiente pide desde el "hasta" que contestó el centro de mando');
assert.equal(H('MovimientosInventario').filter(r => r[7] === r1.oc && r[3] === 'Entrada por compra').length, 1);
// Completa (acumulado): cierra sola; la orden pagada queda Recibida
CM.recepciones = [{ oc_folio: r1.oc, req_folio: r1.req, sitio: 'ZLO', completa: true, recibio: 'jesush', cuando: cuando,
  renglones: [{ n: 1, pedido: 80, recibido: 80 }, { n: 2, pedido: 12, recibido: 12 }] }];
correr('AVISOS.length = 0');
como(null);
tr = plain(P.traerRecepcionesPortal());
const colaRecibida = plain(correr('MEMO_.correos || []'));
assert.deepEqual(tr.cerradas, [r1.req]);
m1 = mia('obrero', r1.req);
assert.deepEqual([m1.estado, m1.notasRecepcion], ['Cerrada', 'Recibido en ZLO por jesush en el centro de mando, 30-oct-2026']);
filaOc = H('OrdenesCompra').find(r => r[0] === r1.oc);
assert.deepEqual([filaOc[28], filaOc[29], filaOc[30]], ['Recibida', '2026-10-30', 'jesush (centro de mando)']);
assert.deepEqual(H('MovimientosInventario').filter(r => r[7] === r1.oc && r[3] === 'Entrada por compra').map(r => r[8] + ':' + r[12]), ['1:50', '1:30', '2:12'], 'solo la diferencia');
const bit = H('Bitacora').filter(r => r[2] === 'Recepción del centro de mando');
assert.deepEqual([bit.length, bit[0][1]], [1, 'centro de mando'], 'Bitacora por "centro de mando"');
// (fuera de doPost los avisos quedan en la cola de la petición; el activador los manda al final)
assert.deepEqual(colaRecibida.filter(a => a.tipo === 'req.recibida').map(a => a.datos.folio + ':' + a.actor),
  [r1.req + ':centro de mando'], 'aviso req.recibida');
// Ya cerrada: nada
como(null);
tr = plain(P.traerRecepcionesPortal());
assert.deepEqual([tr.cerradas, tr.ignoradas], [[], [r1.oc + ' (' + r1.req + ' cerrada)']]);
// El centro de mando no contesta: no avanza la última consulta
const ultima = props.PORTAL_ULTIMA_CONSULTA;
CM.modoRec = '500';
como(null);
tr = plain(P.traerRecepcionesPortal());
assert.deepEqual([tr.ok, props.PORTAL_ULTIMA_CONSULTA], [false, ultima]);
assert(/respondió 500/.test(props.PORTAL_ERROR_CONSULTA));
CM.modoRec = 'ok';

// ---- El centro de mando no contesta: la acción sigue y el aviso queda pendiente ----
const r2req = ok('obrero', 'guardarRequisicion', nuevaReq(P1, { sitio: 'Veracruz (ICAVE)' })).folio;
aprobar(r2req);
ok('pedro', 'cotizarRequisicion', r2req, PROP());
CM.modo = '500';
const vb2 = visto(r2req);
const oc2 = vb2.ocFolio;
assert(oc2, 'la orden se emitió');
assert.deepEqual([vb2.avisoPortal, vb2.vista.avisoPortal], ['Guardado. El centro de mando se actualizará en unos minutos.',
  'Guardado. El centro de mando se actualizará en unos minutos.']);
let pend = filaPend(oc2 + ':oc.autorizada:1');
assert.deepEqual([pend[5], pend[2]], ['Pendiente', 1]);
assert(/respondió 500/.test(pend[3]));
CM.modo = 'caido';
en = ok('pedro', 'marcarEnCamino', r2req, { traeProveedor: true, fechaEstimada: MANANA, idSolicitud: id('e') });
assert.equal(en.estado, 'En camino', 'compras registra el envío aunque el centro de mando no conteste');
assert.equal(en.vista.avisoPortal, 'Guardado. El centro de mando se actualizará en unos minutos.');
assert(/Sin respuesta del centro de mando: Tiempo de espera agotado/.test(filaPend(oc2 + ':oc.autorizada:1')[3]));
assert.equal(filaPend(oc2 + ':oc.en_camino:1')[2], 0, 'el siguiente de la misma orden espera (no se manda antes que la autorización)');
assert.deepEqual(plain(ok('pedro', 'estadoCentroMando')).pendientes, 2);
falla('obrero', 'estadoCentroMando', [], /permiso de compras/, 'PERMISO');
falla('rosa', 'estadoCentroMando', [], /solo tiene acceso a Requisiciones/, 'PERMISO');
// El activador los reintenta en orden cuando vuelve
CM.modo = 'ok';
como(null);
const corrida = plain(P.cadaQuinceMinutos());
assert.deepEqual([corrida.avisos.intentados, corrida.avisos.fallidos], [2, 0]);
assert.deepEqual(CM.orden.slice(-2), [oc2 + ':oc.autorizada:1', oc2 + ':oc.en_camino:1'], 'en el orden en que se formaron');
assert.equal(CM.eventos[oc2 + ':oc.en_camino:1'].oc.paqueteria, 'Lo trae el proveedor');
assert.equal(CM.eventos[oc2 + ':oc.autorizada:1'].oc.sitio, 'VER');
pend = filaPend(oc2 + ':oc.autorizada:1');
assert.deepEqual([pend[5], pend[2]], ['Enviado', 3]);
assert.equal(ok('pedro', 'estadoCentroMando').pendientes, 0);
// Hora vieja (más de 5 min): el centro de mando la rechaza (401) y queda pendiente; luego pasa
correr('var _iso = isoConZona_; isoConZona_ = function (d) { return _iso(new Date(d.getTime() - 10 * 60000)); };');
falla('pedro', 'cancelarOrdenCompra', [oc2, 'corto'], /mínimo 10 caracteres/);
let cn = ok('pedro', 'cancelarOrdenCompra', oc2, 'El proveedor no surtió a tiempo');
assert.equal(cn.confirmar, true, 'en camino: pide confirmar');
assert(/ya va en camino \(Lo trae el proveedor · llega aprox\. el/.test(cn.mensaje));
assert.equal(H('OrdenesCompra').find(r => r[0] === oc2)[28], 'Emitida', 'sin confirmar no cambia nada');
cn = ok('pedro', 'cancelarOrdenCompra', oc2, 'El proveedor no surtió a tiempo', true);
assert.equal(H('OrdenesCompra').find(r => r[0] === oc2)[28], 'Cancelada');
assert.equal(ok('pedro', 'getRequisicion', r2req).requisicion.estado, 'Aprobada', 'con operaciones regresa a Aprobada');
assert.equal(cn.avisoPortal, 'Guardado. El centro de mando se actualizará en unos minutos.');
assert(/firma vencida/.test(filaPend(oc2 + ':oc.cancelada:1')[3]) && CM.rechazos.includes('firma vencida'));
correr('isoConZona_ = _iso;');
// La respuesta se pierde pero el centro de mando sí lo guardó: el reintento lleva el mismo evento_id (repetido, no duplica)
CM.modo = 'perdido';
como(null);
P.cadaQuinceMinutos();
assert.equal(filaPend(oc2 + ':oc.cancelada:1')[5], 'Pendiente');
CM.modo = 'ok';
como(null);
P.cadaQuinceMinutos();
pend = filaPend(oc2 + ':oc.cancelada:1');
assert.deepEqual([pend[5], pend[3]], ['Enviado', 'ya lo tenía (repetido)']);
assert.equal(CM.orden.filter(x => x === oc2 + ':oc.cancelada:1').length, 1, 'un solo aviso');
// Todos los avisos que llegaron: sin montos (llaves) y sin moneda
CM.recibidos.forEach(e => {
  assert.deepEqual(llaves(e).filter(k => MONTOS.test(k)), [], 'sin montos en ' + e.evento_id);
  assert(!/MXN|USD/.test(JSON.stringify(e)), 'sin moneda');
});

// ---- Sin pagar: recepción completa → Recibida; el pago la cierra ----
const r3 = hastaOrden(P1, { sitio: 'Querétaro' });
// Respaldo de compras (el centro de mando no funciona): motivo obligatorio, no llega al inventario del sitio
falla('pedro', 'registrarRecepcion', [{ reqFolio: r3.req, sitio: 'Querétaro', renglones: conFotos([{ renglon: 1, cantidad: 80 }]) }], /Recepción de respaldo/);
rr = ok('pedro', 'registrarRecepcion', { reqFolio: r3.req, sitio: 'Querétaro', notas: 'El centro de mando está caído', renglones: conFotos([{ renglon: 1, cantidad: 80 }]), idSolicitud: id('r') });
assert.deepEqual([rr.completo, rr.estado], [false, 'Autorizada']);
assert(/respaldo de compras \(no llega al inventario del sitio/.test(rr.vista.eventos.slice(-1)[0].nota));
CM.recepciones = [{ oc_folio: r3.oc, req_folio: r3.req, sitio: 'QRO', completa: true, recibio: 'jesusr', cuando: new Date().toISOString(),
  renglones: [{ n: 1, pedido: 80, recibido: 80 }, { n: 2, pedido: 12, recibido: 12 }] }];
como(null);
tr = plain(P.traerRecepcionesPortal());
assert.deepEqual(tr.cerradas, [r3.req]);
assert.deepEqual(H('MovimientosInventario').filter(r => r[7] === r3.oc && r[3] === 'Entrada por compra').map(r => r[8] + ':' + r[12] + ':' + r[13]),
  ['1:80:pedro@helgen.tech', '2:12:centro de mando'], 'lo del respaldo no se duplica');
let v3 = ok('pedro', 'getRequisicion', r3.req);
assert.deepEqual([v3.requisicion.estado, v3.orden.estado, v3.orden.recibio, v3.puedePagar], ['Recibida', 'Emitida', 'jesusr (centro de mando)', true]);
assert(/falta el pago al proveedor/.test(v3.eventos.slice(-1)[0].nota));
pg = pagar(r3.req);
assert.deepEqual([pg.vista.requisicion.estado, pg.vista.orden.estado], ['Cerrada', 'Recibida']);
assert(CM.eventos[r3.oc + ':oc.pagada:1']);

// Respaldo completo: req.cerrada (el centro de mando deja de esperar el material)
const r4 = hastaOrden(P1);
rr = ok('pedro', 'registrarRecepcion', { reqFolio: r4.req, sitio: 'Manzanillo (TIMSA)', notas: 'Sin señal en el sitio', final: true,
  renglones: conFotos([{ renglon: 1, cantidad: 80 }, { renglon: 2, cantidad: 12 }]), idSolicitud: id('r') });
assert.deepEqual([rr.completo, rr.estado], [true, 'Recibida']);
assert(CM.eventos[r4.oc + ':req.cerrada:1']);
// Cancelar la recepción de una que iba en camino la regresa a En camino
const r5 = hastaOrden(P1);
ok('obrero', 'marcarEnCamino', r5.req, { paqueteria: 'Paquetexpress', guia: 'PX-9', fechaEstimada: MANANA, idSolicitud: id('e') });
rr = ok('pedro', 'registrarRecepcion', { reqFolio: r5.req, sitio: 'Manzanillo (TIMSA)', notas: 'Respaldo por prueba',
  renglones: conFotos([{ renglon: 1, cantidad: 80 }, { renglon: 2, cantidad: 12 }]), idSolicitud: id('r') });
assert.equal(rr.estado, 'Recibida');
assert.equal(ok('pedro', 'cancelarRecepcion', rr.folio, 'Se registró por error').requisicion.estado, 'En camino');

// Separar renglones conserva el ítem; proyecto sin ligar no manda nada
const r6 = ok('obrero', 'guardarRequisicion', nuevaReq(P1)).folio;
aprobar(r6);
const sep = ok('pedro', 'separarRequisicion', r6, [1], 'Otro proveedor de cable', { version: ok('pedro', 'getRequisicion', r6).version, idSolicitud: id('s') });
assert.equal(ok('pedro', 'getRequisicion', sep.folio).renglones[0].item, 'CAB-THW-10', 'la separada conserva el ítem');
const antes = llamadasCM(), filasAntes = H('PortalPendientes').length;
const rNo = hastaOrden(P2, { sitio: 'Querétaro' });
ok('obrero', 'marcarEnCamino', rNo.req, { paqueteria: 'DHL', guia: '77', fechaEstimada: MANANA, idSolicitud: id('e') });
pagar(rNo.req);
assert.deepEqual([llamadasCM(), H('PortalPendientes').length], [antes, filasAntes], 'proyecto sin ligar: ni avisos ni llamadas');
let mNo = mia('obrero', rNo.req);
assert.deepEqual([mNo.centroMando, mNo.puedeRecibir, mNo.estado], [null, true, 'En camino'], 'sin ligar: se recibe en CAPRI');
rr = ok('rosa', 'registrarRecepcion', { reqFolio: rNo.req, sitio: 'Querétaro', renglones: conFotos([{ renglon: 1, cantidad: 80 }, { renglon: 2, cantidad: 12 }]), idSolicitud: id('r') });
assert.equal(rr.estado, 'Cerrada', 'en camino y pagada: recibir todo la cierra');

// ---- Mis artículos (sugerencias de lo que la persona ya pidió) ----
const art = ok('obrero', 'misArticulos');
assert.deepEqual(art[0], { descripcion: 'Cable THW 10', unidad: 'M', item: 'CAB-THW-10', veces: art[0].veces });
assert(art[0].veces >= 9, 'el más pedido primero (incluye la requisición de antes del incremento)');
assert(art.some(a => a.descripcion === 'Guantes de carnaza' && a.item === ''));
assert.deepEqual(ok('rosa', 'misArticulos'), [], 'nadie más ve lo que pidió obrero');
falla('ana', 'misArticulos', [], /permiso para hacer requisiciones/, 'PERMISO');
assert.equal(ok('obrero', 'bootstrap').centro.misArticulos.length, art.length, 'ya en caché: va en la carga inicial');

// ---- Flujo de siempre (sin operaciones): sitio obligatorio solo en el proyecto ligado; cierre de respaldo = req.cerrada ----
props.ROL_OPERACIONES = '';
const conCot = x => Object.assign(nuevaReq(x.proyectoFolio, x), { cotizacion: { nombre: 'cot.pdf', datos: PDF } });
assert(ok('obrero', 'guardarRequisicion', conCot({ proyectoFolio: P2, sitio: '' })).folio, 'sin ligar: el sitio sigue opcional');
falla('obrero', 'guardarRequisicion', [conCot({ proyectoFolio: P1, sitio: '' })], /elige el sitio donde se recibe el material/);
falla('obrero', 'guardarRequisicion', [conCot({ proyectoFolio: P1, sitio: 'Monterrey' })], /no es un sitio del centro de mando/);
const r7 = ok('obrero', 'guardarRequisicion', conCot({ proyectoFolio: P1 + '-DRO', sitio: 'Querétaro' })).folio;
const oc7 = ok('efrain', 'autorizarRequisicion', r7, { proveedor: { razonSocial: 'Eléctrica del Bajío' }, fechaEntrega: MANANA, lugarEntrega: 'Querétaro',
  formaPago: 'Transferencia', condicionesPago: 'Contado', diasCredito: 0, idSolicitud: id('oc'),
  renglones: [{ descripcion: 'Cable THW 10', unidad: 'M', cantidad: 80, costo: 10, item: 'CAB-THW-10' }, { descripcion: 'Tubo', unidad: 'PZA', cantidad: 12, costo: 50 }] }).ocFolio;
const ev7 = CM.eventos[oc7 + ':oc.autorizada:1'];
assert.deepEqual([ev7.oc.autorizo, ev7.oc.proveedor, ev7.oc.sitio, ev7.oc.renglones.map(r => r.item)],
  ['efrain@helgen.tech', 'Eléctrica del Bajío', 'QRO', ['CAB-THW-10', null]], 'acentos: el cuerpo va escapado y la firma cuadra');
pagar(r7, 1624);
let m7 = mia('obrero', r7);
assert.deepEqual([m7.estado, m7.puedeCerrar], ['Pagada', false], 'ligado: quien pidió no cierra aquí');
falla('obrero', 'cerrarRequisicion', [r7, ''], /se recibe en el centro de mando \(QRO · Querétaro\)/);
let vc7 = ok('efrain', 'cerrarRequisicionCompras', r7, 'El centro de mando no funciona', '');
assert.equal(vc7.requisicion.estado, 'Cerrada');
assert(/respaldo: no llega al inventario del sitio/.test(vc7.eventos.slice(-1)[0].nota));
assert(CM.eventos[oc7 + ':req.cerrada:1'], 'req.cerrada');
props.ROL_OPERACIONES = 'adri@helgen.tech, leo@helgen.tech';

// ---- Estado y "Consultar ahora" ----
const est = plain(ok('pedro', 'estadoCentroMando'));
assert.deepEqual([est.activo, est.servidor, est.pendientes, est.ligados, !!est.ultimoOk], [true, 'drogheda.test', 0, [{ folio: P1, proyecto: 'drogheda' }], true]);
assert(!JSON.stringify(est).includes(SECRETO), 'el secreto nunca sale');
const cons = plain(ok('efrain', 'consultarCentroMando'));
assert.equal(cons.recepciones.ok, true);

// ---- Activador: una sola vez (quita repetidos) y la caché caliente ----
assert.deepEqual(plain(P.instalarActivadorPortal()), { instalado: true, quitados: 0 });
assert.deepEqual(plain(P.instalarActivadorPortal()), { instalado: false, quitados: 0 });
correr("ScriptApp.newTrigger('cadaQuinceMinutos').timeBased().everyMinutes(15).create(); ScriptApp.newTrigger('otra').timeBased().everyHours(1).create();");
assert.deepEqual(plain(P.instalarActivadorPortal()), { instalado: false, quitados: 1 });
assert.deepEqual(A.activadores.map(t => t.f + ':' + (t.cada || t.horas)), ['cadaQuinceMinutos:15', 'otra:1']);
for (const k of Object.keys(A.cache)) delete A.cache[k];
let bp = ok('pedro', 'bootstrap');
assert.deepEqual([bp.com.requisiciones, bp.req.mias, bp.centro.items], [null, null, null], 'caché frío');
como(null);
const cq = plain(P.cadaQuinceMinutos());
assert(cq.cache.hechos >= 5, JSON.stringify(cq.cache));
bp = ok('pedro', 'bootstrap');
assert(Array.isArray(bp.com.requisiciones) && Array.isArray(bp.req.mias) && Array.isArray(bp.centro.items), 'después del activador sí van');
const bo = ok('obrero', 'bootstrap');
assert(Array.isArray(bo.req.mias) && Array.isArray(bo.centro.misArticulos));
assert(Array.isArray(ok('adri', 'bootstrap').ops.requisiciones));

// ---- preparar(): sitios de solo nombres → con código; pestaña y activador ----
const cfgFila = A.libros.DB.pest.Config.m.find(r => r[0] === 'SITIOS');
cfgFila[1] = 'Querétaro\nManzanillo (TIMSA)\nVeracruz (ICAVE)';
como(null);
correr('modCentroMando_().preparar()');
assert.equal(cfgFila[1], 'QRO | Querétaro\nZLO | Manzanillo (TIMSA)\nVER | Veracruz (ICAVE)');
assert.equal(A.activadores.filter(t => t.f === 'cadaQuinceMinutos').length, 1);

// ---- Prueba: PORTAL_PRUEBA = 1 marca los avisos; sin secreto, todo apagado otra vez ----
props.PORTAL_PRUEBA = '1';
const r8 = hastaOrden(P1);
assert.equal(CM.eventos[r8.oc + ':oc.autorizada:1'].prueba, true);
delete props.PORTAL_PRUEBA; delete props.PORTAL_SECRETO;
const n0 = llamadasCM();
const r9 = hastaOrden(P1);
ok('obrero', 'marcarEnCamino', r9.req, { paqueteria: 'DHL', guia: '1', fechaEstimada: MANANA, idSolicitud: id('e') });
como(null);
assert.deepEqual(plain(P.cadaQuinceMinutos()).recepciones, { activo: false });
assert.equal(llamadasCM(), n0, 'sin secreto: nada sale');
assert.equal(mia('obrero', r9.req).puedeRecibir, true, 'y se recibe en CAPRI como antes');

// ---- Anulado (módulo E: esAnulado_): ni recepciones ni avisos de lo anulado ----
props.PORTAL_SECRETO = SECRETO;
const r10 = hastaOrden(P1);
correr('var esAnuladoReal_ = esAnulado_; var ANULADOS = []; esAnulado_ = function (f) { return ANULADOS.indexOf(String(f || "").toUpperCase()) !== -1; };');
correr('ANULADOS.push(' + JSON.stringify(r10.oc) + ')');
ok('obrero', 'marcarEnCamino', r10.req, { paqueteria: 'DHL', guia: '2', fechaEstimada: MANANA, idSolicitud: id('e') });
assert(!CM.eventos[r10.oc + ':oc.en_camino:1'] && !filaPend(r10.oc + ':oc.en_camino:1'), 'lo anulado no se avisa');
CM.recepciones = [{ oc_folio: r10.oc, req_folio: r10.req, sitio: 'ZLO', completa: true, recibio: 'jesush', cuando: cuando,
  renglones: [{ n: 1, pedido: 80, recibido: 80 }, { n: 2, pedido: 12, recibido: 12 }] }];
como(null);
tr = plain(P.traerRecepcionesPortal());
assert.deepEqual([tr.cerradas, tr.ignoradas], [[], [r10.oc + ' (anulada)']]);
assert.equal(mia('obrero', r10.req).estado, 'En camino', 'no se cierra');

// ---- Integración con el módulo E: anular una orden ligada avisa oc.cancelada al centro de mando (al terminar) ----
correr('esAnulado_ = esAnuladoReal_;');
CM.recepciones = [];
props.SUPER_ADMIN = 'leo@helgen.tech';
como(null); P.prepararCapri();
const r11 = hastaOrden(P1);
assert(CM.eventos[r11.oc + ':oc.autorizada:1'], 'la orden llegó al centro de mando');
const an = ok('leo', 'anular', r11.oc, 'Orden duplicada por error de captura', id('an'));
assert(!an.avisoPortal, 'el aviso salió al terminar');
const evCan = Object.keys(CM.eventos).find(k => k.indexOf(r11.oc + ':oc.cancelada:') === 0);
assert(evCan, 'oc.cancelada de una orden anulada llega al centro de mando: ' + Object.keys(CM.eventos).filter(k => k.indexOf(r11.oc) === 0));
assert.equal(filaPend(evCan)[5], 'Enviado');
assert(!/\d+\.\d\d|1856|1600/.test(JSON.stringify(CM.eventos[evCan])), 'sin montos');

// ================= Revisión independiente (28/10/2026) =================
const recep = (r, n1, n2, completa) => ({ oc_folio: r.oc, req_folio: r.req, sitio: 'ZLO', completa: !!completa, recibio: 'jesush', cuando: cuando,
  renglones: [{ n: 1, pedido: 80, recibido: n1 }, { n: 2, pedido: 12, recibido: n2 }] });
como(null);
// Recepciones solo de proyectos ligados
const rS = hastaOrden(P2, { sitio: 'Querétaro' });
CM.recepciones = [recep(rS, 80, 12, true)];
tr = plain(P.traerRecepcionesPortal());
assert.deepEqual(tr.ignoradas, [rS.oc + ' (proyecto no ligado)']);
assert.notEqual(mia('obrero', rS.req).estado, 'Cerrada', 'no se cierra desde el centro de mando');
// Antes de cancelar se traen las recepciones: lo que ya llegó al sitio frena la cancelación (si no, se compraría dos veces)
const rC = hastaOrden(P1);
ok('obrero', 'marcarEnCamino', rC.req, { paqueteria: 'DHL', guia: '9', fechaEstimada: MANANA, idSolicitud: id('e') });
CM.recepciones = [recep(rC, 50, 0, false)];
falla('pedro', 'cancelarOrdenCompra', [rC.oc, 'El proveedor ya no surte el cable', true], /ya tiene material recibido/);
// Material que llega a una orden ya cancelada: alerta para compras, nunca en silencio
const rX = hastaOrden(P1);
CM.recepciones = [];
ok('pedro', 'cancelarOrdenCompra', rX.oc, 'Duplicada por error de captura');
CM.recepciones = [recep(rX, 80, 12, true)];
como(null);
tr = plain(P.traerRecepcionesPortal());
assert(tr.alertas && tr.alertas.length === 1 && /cancelada/.test(tr.alertas[0]), JSON.stringify(tr));
assert(/Atención|registró material de/.test(ok('pedro', 'estadoCentroMando').alerta));
CM.recepciones = [];
// Un aviso que el centro de mando rechaza por su contenido (4xx) se aparta tras 4 intentos y no detiene la cancelación
assert.equal(P.rechazoDefinitivo(400, 4), true);
assert.equal(P.rechazoDefinitivo(400, 3), false);
assert.equal(P.rechazoDefinitivo(401, 9), false, 'firma: se arregla con la configuración');
assert.equal(P.rechazoDefinitivo(500, 9), false);
const rR = hastaOrden(P1);
CM.modo = 'rechaza';
ok('obrero', 'marcarEnCamino', rR.req, { paqueteria: 'DHL', guia: '10', fechaEstimada: MANANA, idSolicitud: id('e') });
for (let i = 0; i < 3; i++) { como(null); P.cadaQuinceMinutos(); }
assert.equal(filaPend(rR.oc + ':oc.en_camino:1')[5], 'Rechazado');
assert.equal(ok('pedro', 'estadoCentroMando').rechazados >= 1, true);
CM.modo = 'ok';
const cR = ok('pedro', 'cancelarOrdenCompra', rR.oc, 'El proveedor canceló el pedido', true);
assert(!cR.confirmar && CM.eventos[rR.oc + ':oc.cancelada:1'], 'la cancelación ya no espera al rechazado');
// Una orden que ya iba en curso cuando se ligó el proyecto: primero su oc.autorizada
delete props.PORTAL_SECRETO;
const rB = hastaOrden(P1);
props.PORTAL_SECRETO = SECRETO;
ok('obrero', 'marcarEnCamino', rB.req, { paqueteria: 'DHL', guia: '11', fechaEstimada: MANANA, idSolicitud: id('e') });
assert.deepEqual(CM.orden.slice(-2), [rB.oc + ':oc.autorizada:1', rB.oc + ':oc.en_camino:1'], 'nunca un envío antes de la autorización');
// Recepción en el sitio: correo "Recibido en el sitio" (no "en tu lugar") a quien pidió y quien recibe
correr('AVISOS = [];');
CM.recepciones = [recep(rB, 80, 12, true)];
como(null); P.traerRecepcionesPortal();
const avR = plain(correr('MEMO_.correos || []')).filter(x => x.tipo === 'req.recibida');
assert.equal(avR.length, 1);
assert.deepEqual(plain(correr('destinatariosAviso("req.recibida", ' + JSON.stringify(avR[0].datos) + ', {solicitanteEmail: "obrero@helgen.tech", recibeEmail: "rosa@helgen.tech", centroMando: true}, {compras: ["pedro@helgen.tech"]})')).map(g => g.quien),
  ['compras', 'sitio']);
assert(/Recibido en el sitio/.test(P.contenidoAviso('req.recibida', 'sitio', { folio: rB.req, centroMando: true }).titulo));
CM.recepciones = [];

// ================= Interfaz (módulo mod-centro con la página, DOM y fetch simulados) =================
(async () => {
  const fs = require('fs'), vm = require('vm'), path = require('path');
  const html = fs.readFileSync(path.join(dir, 'web/cotizador/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script(?: id="([^"]*)")?>([\s\S]*?)<\/script>/g)].map(m => ({ id: m[1], src: m[2] }));
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = 'h.' + b64({ email: 'obrero@helgen.tech', given_name: 'Juan', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.f';
  const esperar = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
  function montar(datos) {
    function el(tag) {
      const e = { tag, value: '', textContent: '', className: '', src: '', placeholder: '', disabled: false, checked: false, type: '', min: '', hijos: [],
        oyentes: {}, _c: new Set(), porClase: {},
        classList: { add: c => e._c.add(c), remove: c => e._c.delete(c), contains: c => e._c.has(c), toggle: (c, f) => f ? e._c.add(c) : e._c.delete(c) },
        addEventListener: (t, f) => (e.oyentes[t] = e.oyentes[t] || []).push(f), disparar: t => (e.oyentes[t] || []).forEach(f => f({ target: e })),
        focus() {}, remove() {}, appendChild: h => e.hijos.push(h), prepend: h => e.hijos.unshift(h), contains: () => false, closest: () => null,
        insertAdjacentHTML: (w, h) => { e.innerHTML += h; },
        querySelector: s => e.porClase[s] || (e.porClase[s] = el('input')), querySelectorAll: s => s === 'tr' ? e.hijos : s === 'input' ? Object.values(e.porClase) : [] };
      let h = ''; Object.defineProperty(e, 'innerHTML', { get: () => h, set: v => { h = v; if (v === '') e.hijos.length = 0; } });
      return e;
    }
    const porId = {}, oyentes = {};
    const document = { getElementById: i => porId[i] || (porId[i] = el('div')), querySelector: () => ({ src: 'data:' }), createElement: t => el(t),
      visibilityState: 'visible', activeElement: null, addEventListener: (t, f) => (oyentes[t] = oyentes[t] || []).push(f),
      dispatchEvent: ev => (oyentes[ev.type] || []).forEach(f => f(ev)) };
    ['login', 'tabCob', 'tabCom', 'reqCentro', 'comCentro', 'rcCentro'].forEach(i => document.getElementById(i).classList.add('oculto'));
    ['reqTabla', 'ocTabla'].forEach(i => document.getElementById(i).classList.add('sin-item')); // como en el HTML
    const llamadas = [], respuestas = { bootstrap: { ok: true, datos: datos },
      sincronizar: () => ({ ok: true, datos: { versiones: {}, permisos: datos.permisos, soloRequisicion: !!datos.soloRequisicion, cambios: [] } }) };
    const dialogos = { confirmar: true, prompt: null, vistos: [] };
    const ctx = { document, console, JSON, Date, Math, Number, String, Array, Object, Promise, Proxy, Error, Uint8Array, TextDecoder,
      FileReader: class { readAsDataURL(f) { this.result = 'data:' + f.type + ';base64,' + f.b64; setImmediate(() => this.onload()); } },
      fetch: async (url, o) => { const c = JSON.parse(o.body); llamadas.push(c); const r = respuestas[c.funcion]; const d = typeof r === 'function' ? r(c) : r;
        return { ok: true, json: async () => d || { ok: false, error: 'sin respuesta simulada: ' + c.funcion } }; },
      atob: s => Buffer.from(s, 'base64').toString('binary'), crypto: { randomUUID: () => 'id-' + Math.random() },
      sessionStorage: { getItem: k => k === 'cotizadorHelgenSesion' ? token : null, setItem() {}, removeItem() {} },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      confirm: m => { dialogos.vistos.push(m); return dialogos.confirmar; }, prompt: m => { dialogos.vistos.push(m); return dialogos.prompt; },
      CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
      setTimeout, clearTimeout, setInterval: () => 0, scrollTo() {} };
    ctx.window = ctx;
    vm.createContext(ctx);
    ['api-web', undefined, 'mod-centro'].forEach(i => vm.runInContext(scripts.find(s => s.id === i).src, ctx));
    return { $: i => document.getElementById(i), llamadas, respuestas, dialogos, run: c => vm.runInContext(c, ctx) };
  }

  const PRYS = [{ folio: P1, clave: 'DRO', folioVisible: P1 + '-DRO', nombre: 'DROGHEDA', estado: 'Activo' },
    { folio: P2, clave: 'CAL', folioVisible: P2 + '-CAL', nombre: 'Casa del Lago', estado: 'Activo' }];
  const RQ = { folio: 'REQ-' + ANIO + '-0050', fecha: HOY_ISO, proyectoFolio: P1, proyectoNombre: 'DROGHEDA', proyectoVisible: P1 + '-DRO', estado: 'Autorizada',
    sitio: 'Manzanillo (TIMSA)', renglones: [{ renglon: 1, descripcion: 'Cable THW 10', cantidad: 80, unidad: 'M', notas: '', item: 'CAB-THW-10' }], eventos: [],
    recepciones: [], recibe: 'rosa@helgen.tech', centroMando: { sitio: 'ZLO · Manzanillo (TIMSA)', sitioCodigo: 'ZLO' }, enCamino: null,
    puedeEnCamino: true, puedeRecoger: true, puedeRecibir: false, puedeCerrar: false };
  const U = montar({ soloRequisicion: true, ivaTasa: 0.16, catalogo: [{ clave: 'CAB', descripcion: 'Cable THW 10', unidad: 'M' }], tipoCambio: null, clientes: [], proyectos: [],
    marcas: {}, permisos: { cobranza: false, desbloqueo: false, compras: false, requisicion: true, operaciones: false, flujoOperaciones: false, ventas: false },
    sitios: ['Querétaro', 'Manzanillo (TIMSA)'], sitiosDetalle: [{ codigo: 'QRO', nombre: 'Querétaro' }, { codigo: 'ZLO', nombre: 'Manzanillo (TIMSA)' }],
    req: { proyectos: PRYS, mias: [RQ] },
    centro: { activo: true, ligados: [P1], items: [{ codigo: 'CAB-THW-10', descripcion: 'Cable THW calibre 10', unidad: 'M' }],
      misArticulos: [{ descripcion: 'Cable THW 10', unidad: 'M', item: 'CAB-THW-10', veces: 3 }] } });
  await esperar(20);
  const $ = U.$;
  assert(/value="Manzanillo \(TIMSA\)">ZLO · Manzanillo \(TIMSA\)</.test($('reqSitio').innerHTML), 'el sitio se ve con su código y se guarda el nombre');
  assert(/^<option value="Cable THW 10" label="Ya lo pediste 3 veces · M">$/.test($('reqCatalogo').innerHTML), 'primero lo que ya pidió (sin repetir el catálogo)');
  assert(/value="CAB-THW-10" label="Cable THW calibre 10 · M"/.test($('centroItems').innerHTML));
  assert(!U.llamadas.some(c => c.funcion === 'misArticulos' || c.funcion === 'itemsInventario'), 'ya venían en la carga inicial');
  // Tarjeta de la requisición ligada: dónde se recibe y los botones
  const caja = $('cmCaja-' + RQ.folio).innerHTML;
  assert(/Se recibe en el <b>centro de mando<\/b> \(ZLO · Manzanillo \(TIMSA\)\)/.test(caja) && /centroRecogi\('REQ-/.test(caja) && /centroAbrirEnvio\('REQ-[^']+','req'\)/.test(caja));
  // Proyecto ligado: columna de ítem, sitio obligatorio y "lo que ya pediste" llena unidad e ítem
  U.run("verTab('req')"); // la carga abre Pendientes (módulo D); el formulario se arma al entrar a Requisiciones
  $('reqProyecto').value = P1 + '-DRO — DROGHEDA'; $('reqProyecto').disparar('change');
  assert(!$('reqTabla').classList.contains('sin-item') && !$('reqCentro').classList.contains('oculto'));
  assert.equal($('reqLblSitio').textContent, 'Sitio donde se necesita *');
  const fila = $('reqFilas').hijos[0];
  fila.querySelector('.desc').value = 'cable thw 10'; fila.querySelector('.desc').disparar('change');
  assert.deepEqual([fila.querySelector('.uni').value, fila.querySelector('.item').value], ['M', 'CAB-THW-10']);
  $('reqArchivo').files = [{ name: 'c.pdf', type: 'application/pdf', size: 100, b64: 'JVBE' }];
  U.run('enviarRequisicion()'); await esperar();
  assert(/Elige el sitio/.test($('aviso').innerHTML) && !U.llamadas.some(c => c.funcion === 'guardarRequisicion'), 'sitio obligatorio en el ligado');
  $('reqSitio').value = 'Manzanillo (TIMSA)';
  U.respuestas.guardarRequisicion = () => ({ ok: true, datos: { folio: 'REQ-' + ANIO + '-0051', requisiciones: [RQ] } });
  U.respuestas.misArticulos = { ok: true, datos: [] };
  U.run('enviarRequisicion()'); await esperar(20);
  const gr = U.llamadas.find(c => c.funcion === 'guardarRequisicion').args[0];
  assert.deepEqual(gr.renglones, [{ descripcion: 'cable thw 10', cantidad: '1', unidad: 'M', notas: '', item: 'CAB-THW-10' }]);
  assert(U.llamadas.some(c => c.funcion === 'misArticulos'), 'después de pedir, se actualiza "lo que ya pediste"');
  // Proyecto sin ligar: sin columna de ítem y sin ítem en lo que se manda
  $('reqProyecto').value = P2 + '-CAL — Casa del Lago'; $('reqProyecto').disparar('change');
  assert($('reqTabla').classList.contains('sin-item') && $('reqCentro').classList.contains('oculto'));
  $('reqFilas').hijos[0].querySelector('.desc').value = 'Cable'; $('reqFilas').hijos[0].querySelector('.item').value = 'CAB-THW-10';
  assert.deepEqual(Object.keys(U.run('leerRenglonesReq()')[0]), ['descripcion', 'cantidad', 'unidad', 'notas'], 'sin ligar no manda ítem');
  // Registrar el envío
  U.respuestas.marcarEnCamino = c => ({ ok: true, datos: { folio: c.args[0], estado: 'En camino', requisiciones: [Object.assign({}, RQ, { estado: 'En camino',
    enCamino: { paqueteria: c.args[1].recogido ? 'Recogido por Juan' : 'DHL', guia: '1', fechaEstimada: MANANA } })],
    avisoPortal: 'Guardado. El centro de mando se actualizará en unos minutos.' } });
  U.run("centroAbrirEnvio('" + RQ.folio + "','req')");
  const p = 'cmfreq' + RQ.folio.replace(/[^A-Za-z0-9]/g, '');
  assert(/Registrar el envío/.test($('cmForm-req-' + RQ.folio).innerHTML));
  $(p + 'Paq').value = 'DHL'; $(p + 'Fecha').value = MANANA;
  U.run("centroEnviar('" + p + "')"); await esperar();
  assert(/número de guía/.test($('aviso').innerHTML), 'guía obligatoria');
  $(p + 'Guia').value = '1';
  U.run("centroEnviar('" + p + "')"); await esperar(20);
  const mc = U.llamadas.filter(c => c.funcion === 'marcarEnCamino')[0].args;
  assert.deepEqual([mc[0], mc[1].paqueteria, mc[1].guia, mc[1].fechaEstimada, mc[1].traeProveedor], [RQ.folio, 'DHL', '1', MANANA, false]);
  assert(/va en camino/.test($('aviso').innerHTML) && /se actualizará en unos minutos/.test($('aviso').innerHTML));
  assert(/<b>En camino:<\/b> Enviado por DHL · guía 1/.test($('cmCaja-' + RQ.folio).innerHTML));
  U.run("centroRecogi('" + RQ.folio + "')"); await esperar(20);
  assert.equal(U.llamadas.filter(c => c.funcion === 'marcarEnCamino')[1].args[1].recogido, true, '"Lo recogí"');

  // Compras: proyecto ligado, envío, respaldo, columna de ítem y estado del enlace; cancelar una orden en camino pide confirmar
  const C = montar({ ivaTasa: 0.16, catalogo: [], tipoCambio: null, clientes: [], proyectos: [], marcas: {},
    permisos: { cobranza: false, desbloqueo: false, compras: true, requisicion: false, operaciones: false, flujoOperaciones: true, ventas: false },
    sitios: ['Manzanillo (TIMSA)'], sitiosDetalle: [{ codigo: 'ZLO', nombre: 'Manzanillo (TIMSA)' }], centro: { activo: true, ligados: [P1], items: null } });
  C.respuestas.estadoCentroMando = { ok: true, datos: { activo: true, servidor: 'drogheda.test', ligados: [{ folio: P1, proyecto: 'drogheda' }], pendientes: 2,
    masAntiguo: '28/10/2026 10:00', ultimoError: 'El centro de mando respondió 500', ultimoOk: '28/10/2026 10:15', errorConsulta: '', activador: true } };
  C.respuestas.listarRequisiciones = { ok: true, datos: [] }; C.respuestas.cuentasPorPagar = { ok: true, datos: null }; C.respuestas.listarProyectosCompras = { ok: true, datos: [] };
  await esperar(20);
  C.run("verTab('com')"); await esperar(20);
  assert(!C.$('comCentro').classList.contains('oculto') && /2 aviso\(s\) pendiente\(s\)/.test(C.$('comCentro').innerHTML) && /centroConsultar\(\)/.test(C.$('comCentro').innerHTML));
  const OC = { folio: 'OC-' + ANIO + '-0009', fecha: HOY_ISO, estado: 'Pagada', proveedor: 'Ferretera', total: 1856, moneda: 'MXN', fechaEntrega: MANANA, lugarEntrega: 'Puerto',
    formaPago: 'Transferencia', condicionesPago: 'Contado', diasCredito: 0, renglones: [], paqueteria: 'DHL', guia: '123', fechaEstimada: MANANA, enCaminoEn: '28/10/2026 11:00', enCaminoPor: 'obrero@helgen.tech' };
  const V = { requisicion: { folio: RQ.folio, fecha: HOY_ISO, proyectoFolio: P1, solicitante: 'Juan', solicitanteEmail: 'obrero@helgen.tech', estado: 'En camino', motivo: '',
      cotizacionId: '', cotizacionUrl: '', ocFolio: OC.folio, sitio: 'Manzanillo (TIMSA)', recibeEmail: 'rosa@helgen.tech' },
    renglones: [], eventos: [], proyecto: { folio: P1, folioVisible: P1 + '-DRO', nombre: 'DROGHEDA', cliente: 'ICAVE', estado: 'Activo', ubicacion: 'Puerto' }, moneda: 'MXN',
    marca: 'helgen', orden: OC, pagos: [], proveedores: [], facturas: [], totalFacturado: 0, facturaCompleta: false, puedeFacturar: true, hoy: HOY_ISO,
    avance: [{ renglon: 1, descripcion: 'Cable', unidad: 'M', pedido: 80, recibido: 0, pendiente: 80 }], recepciones: [], recepcionCompleta: false,
    puedeRecibir: true, puedeCerrar: true, puedeCancelarPago: true, puedePagar: false, puedeEnCamino: true,
    centroMando: { proyecto: 'drogheda', sitioCodigo: 'ZLO', sitio: 'ZLO · Manzanillo (TIMSA)' } };
  C.respuestas.getRequisicion = { ok: true, datos: V };
  C.respuestas.itemsInventario = { ok: true, datos: { activo: true, items: [{ codigo: 'TUB-1', descripcion: 'Tubo', unidad: 'PZA' }] } };
  C.run("abrirReqCom('" + RQ.folio + "')"); await esperar(20);
  const rc = C.$('rcCentro').innerHTML;
  assert(!C.$('rcCentro').classList.contains('oculto') && /Proyecto ligado al <b>centro de mando<\/b> \(drogheda\)/.test(rc) && /Enviado por DHL · guía 123/.test(rc) &&
    /solo el respaldo/.test(rc) && /Corregir el envío/.test(rc));
  assert.equal(C.$('rcCierreTitulo').textContent, 'Respaldo: cerrar aquí (el centro de mando no funciona)');
  assert(/Respaldo: registrar la recepción aquí/.test(C.$('rcAvance').innerHTML));
  assert(!C.$('ocTabla').classList.contains('sin-item') && C.run('ITEMS_OC') === true);
  assert(C.llamadas.some(c => c.funcion === 'itemsInventario') && /TUB-1/.test(C.$('centroItems').innerHTML), 'pide los ítems para la orden');
  C.respuestas.cancelarOrdenCompra = c => ({ ok: true, datos: c.args[2] === true ? {} : { confirmar: true, mensaje: 'El material ya va en camino. ¿Cancelar?' } });
  C.respuestas.getRequisicion = { ok: true, datos: Object.assign({}, V, { orden: null, centroMando: null, puedeEnCamino: false }) };
  C.dialogos.prompt = 'El proveedor no surtió a tiempo';
  C.run("cancelarOcDesdeReq('" + OC.folio + "')"); await esperar(20);
  const cc = C.llamadas.filter(c => c.funcion === 'cancelarOrdenCompra').map(c => c.args);
  assert.deepEqual(cc, [[OC.folio, 'El proveedor no surtió a tiempo'], [OC.folio, 'El proveedor no surtió a tiempo', true]], 'confirma y vuelve a llamar');
  assert(C.dialogos.vistos.includes('El material ya va en camino. ¿Cancelar?'));
  await esperar(20);
  assert(C.$('rcCentro').classList.contains('oculto') && C.$('ocTabla').classList.contains('sin-item'), 'sin ligar: nada del centro de mando');
  console.log('OK centro de mando');
})().catch(e => { console.error(e); process.exit(1); });
