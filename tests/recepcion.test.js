// Incremento 5 (CAPRI) · módulo H: recepción con fotos y devoluciones DEV-AAAA-NNNN. Cubre: lógica pura (foto, problema,
// resolución, avance con devoluciones, ventana de 30 días, fotos y problemas del centro de mando, aviso oc.devolucion sin
// montos, correos y Pendientes); foto obligatoria y privada en "Recibí el material", "Registrar lo que llegó", "Lo recogí" y el
// respaldo de compras; ciclo de una devolución con cada resolución (movimiento negativo, renglón por recibir, faltante aceptado,
// estado de la requisición), cierre retenido mientras hay una abierta (también al pagar), permisos, idempotencia, correos sin
// notas ni montos, Pendientes de compras; y el centro de mando simulado con firma HMAC: fotos que se bajan (GET firmado), van a
// Drive y se avisan archivadas (POST firmado), fallas que no avanzan la última consulta, problemas del sitio (una DEV) y
// oc.devolucion al resolver.
// Uso: node tests/recepcion.test.js .
'use strict';
const assert = require('assert'), crypto = require('crypto');
const dir = process.argv[2] || '.';
const ANIO = String(new Date().getFullYear());
const SECRETO = 'b1c2d3e4f5a6978877665544332211aabbccddeeff0011223344556677889900';
const P1 = 'PRY-' + ANIO + '-0001', P2 = 'PRY-' + ANIO + '-0002'; // P1 = DROGHEDA (ligado); P2 sin ligar

// ---- Centro de mando simulado (contrato del 29/10/2026, docs/incremento-5.md §5) ----
const JPEG_CM = Buffer.from([0xFF, 0xD8, 0xFF, 0xE1, 9, 9, 9, 9]);
const CM = { eventos: {}, recepciones: [], fotos: {}, archivadas: {}, gets: [], posts: [], modoFoto: 'ok', modoArchivo: 'ok', rechazos: [] };
function verificar(op, cuerpo) {
  const h = (op && op.headers) || {}, t = h['X-Hbox-Tiempo'], f = h['X-Hbox-Firma'];
  if (!t || !f) return 'sin firma';
  if (Math.abs(Date.now() - Date.parse(t)) > 5 * 60000) return 'firma vencida';
  const esperada = 'sha256=' + crypto.createHmac('sha256', SECRETO).update(t + '\n' + cuerpo, 'utf8').digest('hex');
  return f === esperada ? '' : 'firma inválida';
}
const rutas = [
  { re: /^https:\/\/drogheda\.test\/api\/integracion\/cotizador\/evento$/, fn: (url, op) => {
    if (CM.modoEvento === '500') return { codigo: 500, cuerpo: 'Internal Server Error' };
    const cuerpo = String(op.payload || ''), e = verificar(op, cuerpo);
    if (e) { CM.rechazos.push(e); return { codigo: 401, cuerpo: { ok: false, error: e } }; }
    const ev = JSON.parse(cuerpo);
    if (CM.eventos[ev.evento_id]) return { codigo: 200, cuerpo: { ok: true, repetido: true } };
    CM.eventos[ev.evento_id] = ev;
    return { codigo: 200, cuerpo: { ok: true } };
  } },
  { re: /^https:\/\/drogheda\.test\/api\/integracion\/cotizador\/recepciones\?desde=/, fn: (url, op) => {
    const e = verificar(op, '');
    if (e) return { codigo: 401, cuerpo: { ok: false, error: e } };
    return { codigo: 200, cuerpo: { ok: true, hasta: CM.hasta = new Date().toISOString(), recepciones: CM.recepciones } };
  } },
  { re: /^https:\/\/drogheda\.test\/api\/integracion\/cotizador\/foto\?id=/, fn: (url, op) => {
    assert.equal(op.method, 'get');
    const e = verificar(op, '');
    if (e) { CM.rechazos.push(e); return { codigo: 401, cuerpo: { ok: false, error: e } }; }
    const fid = decodeURIComponent(url.split('id=')[1]);
    CM.gets.push(fid);
    if (CM.modoFoto === '500') return { codigo: 500, cuerpo: 'Internal Server Error' };
    if (!CM.fotos[fid] || CM.archivadas[fid]) return { codigo: 404, cuerpo: { ok: false, error: 'no existe' } };
    return { codigo: 200, cuerpo: CM.fotos[fid] };
  } },
  { re: /^https:\/\/drogheda\.test\/api\/integracion\/cotizador\/foto-archivada$/, fn: (url, op) => {
    assert.equal(op.method, 'post');
    const cuerpo = String(op.payload || ''), e = verificar(op, cuerpo);
    if (e) { CM.rechazos.push(e); return { codigo: 401, cuerpo: { ok: false, error: e } }; }
    if (CM.modoArchivo === '500') return { codigo: 500, cuerpo: 'Internal Server Error' };
    const b = JSON.parse(cuerpo);
    CM.posts.push(b);
    CM.archivadas[b.id] = b.url;
    return { codigo: 200, cuerpo: { ok: true } };
  } },
  { re: /^https:\/\/drogheda\.test\/api\/integracion\/inventario\/items$/, fn: () => ({ codigo: 200, cuerpo: { ok: true, items: [] } }) },
];

const A = require('./arnes')(dir, { rutas, props: {
  ROL_COMPRAS: 'efrain@helgen.tech, pedro@helgen.tech', ROL_COBRANZA: 'efrain@helgen.tech',
  ROL_REQUISICION: 'obrero@helgen.tech, efrain@helgen.tech, pedro@helgen.tech', SOLO_REQUISICION: 'rosa@helgen.tech, adri@helgen.tech',
  ROL_OPERACIONES: '', PORTAL_URL: 'https://drogheda.test', PORTAL_PROYECTOS: JSON.stringify({ [P1]: 'drogheda' }) } });
const { P, ok, falla, plain, props, HOY_ISO, masDias, correr, como, PDF, FOTO, conFotos, FOTOS, archivos, carpetas } = A;
const MANANA = masDias(1);
const REQ = n => 'REQ-' + ANIO + '-' + n, DEV = n => 'DEV-' + ANIO + '-' + n;
let nId = 0;
const id = p => (p || 'x') + (++nId);
const F = { nombre: 'foto.jpg', datos: FOTO, mime: 'image/jpeg' };
const MONTOS = /costo|importe|subtotal|iva|total|cambio|moneda|margen|monto|precio/i;
const llaves = (o, acc) => { acc = acc || []; if (o && typeof o === 'object') Object.keys(o).forEach(k => { if (!Array.isArray(o)) acc.push(k); llaves(o[k], acc); }); return acc; };
A.libros.DB.pest.Config.m.push(['SITIOS', 'QRO | Querétaro\nZLO | Manzanillo (TIMSA)\nVER | Veracruz (ICAVE)']);
// F (incremento 5, al integrar): sin CSF y carátula del proveedor no se paga; estas pruebas no son de documentos (con la base
// esto no cambia nada; formaPago tampoco: la base la ignora)
P.exigirDocumentosParaPagar_ = function () {};

// ================= Lógica pura =================
const JPEG = [0xFF, 0xD8, 0xFF, 0xE0, 0, 16], PNG = [0x89, 0x50, 0x4E, 0x47, 13, 10];
assert.deepEqual(plain(P.validarFoto(JPEG)), { mime: 'image/jpeg', ext: 'jpg' });
assert.deepEqual(plain(P.validarFoto(PNG.map(b => b > 127 ? b - 256 : b))), { mime: 'image/png', ext: 'png' }, 'bytes con signo (Apps Script)');
assert.throws(() => P.validarFoto([...Buffer.from('%PDF-1.4 x')]), /imagen \(JPG, PNG o HEIC\), no un PDF/);
assert.throws(() => P.validarFoto([]), /Toma la foto/);
assert.throws(() => P.validarFoto({ length: 11 * 1024 * 1024 }), /pesa más de 10 MB/);
assert.throws(() => P.validarFoto([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), /debe ser PDF o imagen/);
assert.equal(P.nombreArchivoFoto('REC-2026-0003', 2, 'jpg'), 'REC-2026-0003 — r2.jpg');
assert.equal(P.nombreArchivoFoto('DEV-2026-0001', 1, 'png', 2), 'DEV-2026-0001 — r1 (2).png');
const L = { descripcion: 'Cable THW 10', unidad: 'M', disponible: 80 };
assert.deepEqual(plain(P.normalizarProblema({ tipo: 'dañado', comentario: '  Rollo   aplastado ', cantidad: '10' }, L, true)),
  { tipo: 'Dañado', comentario: 'Rollo aplastado', cantidad: 10 });
assert.throws(() => P.normalizarProblema({ tipo: 'Roto', comentario: 'Rollo aplastado', cantidad: 1 }, L, true), /Incorrecto, Dañado, Faltante, Sobrante, Otro/);
assert.throws(() => P.normalizarProblema({ tipo: 'Dañado', comentario: 'mal', cantidad: 1 }, L, true), /mínimo 5 caracteres/);
assert.throws(() => P.normalizarProblema({ tipo: 'Dañado', comentario: 'Rollo aplastado', cantidad: 0 }, L, true), /cuántos M/);
assert.throws(() => P.normalizarProblema({ tipo: 'Dañado', comentario: 'Rollo aplastado', cantidad: 81 }, L, true), /solo hay 80 M recibidos/);
assert.throws(() => P.normalizarProblema({ tipo: 'Dañado', comentario: 'Rollo aplastado', cantidad: 5 }, L, false), /Toma una foto del problema/);
assert.equal(P.normalizarProblema({ tipo: 'Faltante', comentario: 'Vinieron 70, no 80', cantidad: 10 }, L, false).tipo, 'Faltante', 'faltante sin foto');
assert.deepEqual(plain(P.normalizarResolucion({ resolucion: 'reponer' })), { resolucion: 'Reponer', nota: '', guia: '' });
assert.throws(() => P.normalizarResolucion({ resolucion: 'Tirar' }), /Reponer, Devolver al proveedor, Cancelar renglón, Conservar/);
assert.throws(() => P.normalizarResolucion({ resolucion: 'Devolver al proveedor', nota: 'x' }), /nota de crédito o reembolso/);
assert.throws(() => P.normalizarResolucion({ resolucion: 'Cancelar renglón' }), /por qué se cancela/);
assert.throws(() => P.normalizarResolucion({ resolucion: 'Conservar', guia: 'x'.repeat(61) }), /guía/);
assert.deepEqual(plain(P.efectoResolucion('Reponer', 'Dañado', 'CAPRI')), { movimiento: 'Devolución', signo: -1, reabre: true });
assert.deepEqual(plain(P.efectoResolucion('Devolver al proveedor', 'Incorrecto', 'Centro de mando')), { movimiento: 'Devolución sin reponer', signo: -1, reabre: false });
assert.deepEqual(plain(P.efectoResolucion('Cancelar renglón', 'Faltante', 'CAPRI')), { movimiento: 'Devolución sin reponer', signo: -1, reabre: false },
  'en CAPRI un faltante se registró como recibido: se descuenta');
assert.deepEqual(plain(P.efectoResolucion('Conservar', 'Dañado', 'CAPRI')), { movimiento: '', signo: 0, reabre: false });
// Lo que nunca se contó no se descuenta (como el centro de mando): sobrante; faltante reportado en el sitio
assert.deepEqual(plain(P.efectoResolucion('Reponer', 'Sobrante', 'CAPRI')), { movimiento: '', signo: 0, reabre: false });
assert.deepEqual(plain(P.efectoResolucion('Reponer', 'Faltante', 'Centro de mando')), { movimiento: '', signo: 0, reabre: false });
assert.deepEqual(plain(P.efectoResolucion('Devolver al proveedor', 'Faltante', 'Centro de mando')), { movimiento: 'Faltante aceptado', signo: 1, reabre: false });
// Avance con devoluciones: Reponer regresa a por recibir; sin reponer = faltante aceptado (el renglón queda completo)
const ren = [{ descripcion: 'Cable', unidad: 'M', cantidad: 80 }, { descripcion: 'Tubo', unidad: 'PZA', cantidad: 12 }];
const mv = (renglon, cantidad, tipo) => ({ renglon, cantidad, tipo: tipo || 'Entrada por compra', estado: 'Vigente' });
let av = plain(P.avanceRecepcion(ren, [mv(1, 80), mv(2, 12), mv(1, -10, 'Devolución')], []));
assert.deepEqual([av.completo, av.lineas[0].recibido, av.lineas[0].pendiente, av.lineas[0].faltante], [false, 70, 10, undefined]);
av = plain(P.avanceRecepcion(ren, [mv(1, 80), mv(2, 12), mv(1, -10, 'Devolución sin reponer')], []));
assert.deepEqual([av.completo, av.lineas[0].recibido, av.lineas[0].pendiente, av.lineas[0].faltante], [true, 70, 0, 10]);
av = plain(P.avanceRecepcion(ren, [mv(1, 70), mv(2, 12), mv(1, 10, 'Faltante aceptado')], []));
assert.deepEqual([av.completo, av.lineas[0].recibido, av.lineas[0].faltante], [true, 70, 10], 'faltante aceptado: no toca lo recibido');
assert.equal(P.cuentaEnRecepcion('Recogido en tienda'), false, '"Lo recogí" no cuenta como recepción');
assert.equal(P.dentroDeVentanaDev('2026-10-01', '2026-10-31'), true);
assert.equal(P.dentroDeVentanaDev('2026-10-01', '2026-11-01'), false);
assert.equal(P.dentroDeVentanaDev('', '2026-11-01'), true);
// Transiciones nuevas
assert.equal(P.transicionReq('Pagada', 'recibirRetenida'), 'Recibida');
assert.equal(P.transicionReq('Recibida', 'pagarRetenida'), 'Recibida');
assert.equal(P.transicionReq('Recibida', 'cerrarRetenida'), 'Cerrada');
assert.equal(P.transicionReq('Cerrada', 'devolucionPagada'), 'Pagada');
assert.equal(P.transicionReq('Recibida', 'devolucionAutorizada'), 'Autorizada');
assert.equal(P.transicionReq('Cerrada', 'devolucionEnCamino'), 'En camino');
assert.throws(() => P.transicionReq('Autorizada', 'devolucionPagada'), /reabrir por una devolución/);
// Fotos y problemas del centro de mando
assert.deepEqual(plain(P.fotoPortal({ id: 'OC-2026-0012-r1-20261029T1131', archivada: false, url: '' })),
  { id: 'OC-2026-0012-r1-20261029T1131', archivada: false, url: '' });
assert.equal(P.fotoPortal({ id: '../etc/passwd' }), null, 'id solo [A-Za-z0-9._-]');
assert.equal(P.fotoPortal({ id: 'x'.repeat(81) }), null);
assert.equal(P.fotoPortal(null), null);
assert.equal(P.fotoPortal({ id: 'a', archivada: true, url: 'javascript:x' }).url, '', 'solo ligas https');
const pr = { tipo: 'Dañado', comentario: 'Rollo aplastado', cantidad: 10 };
assert.equal(P.claveProblemaPortal('oc-2026-0012', 1, Object.assign({ foto: { id: 'F1' } }, pr)), 'OC-2026-0012:1:f:F1');
assert.equal(P.claveProblemaPortal('OC-2026-0012', 1, pr), P.claveProblemaPortal('OC-2026-0012', 1, Object.assign({}, pr)));
assert.notEqual(P.claveProblemaPortal('OC-2026-0012', 1, pr), P.claveProblemaPortal('OC-2026-0012', 1, Object.assign({}, pr, { comentario: 'Otro' })));
// Aviso oc.devolucion: solo lo de siempre (sin montos) + la devolución; la nota se limpia de montos
const cu = plain(P.cuerpoEventoPortal('oc.devolucion', 1, { cuando: '2026-10-29T12:00:00-06:00', quien: 'pedro@helgen.tech', proyectoFolio: P1,
  proyectoClave: 'drogheda', sitioCodigo: 'ZLO', req: { folio: 'REQ-1', solicitanteEmail: 'obrero@helgen.tech' },
  orden: { folio: 'OC-1', proveedor: 'Ferretera', total: 1856, moneda: 'MXN', renglones: [{ descripcion: 'Cable', unidad: 'M', cantidad: 80, costo: 10 }] },
  devolucion: { folio: 'DEV-2026-0003', renglon: 1, cantidad: 10, tipo: 'Dañado', resolucion: 'Reponer', nota: 'Nota de crédito por $1,200.00 MXN', costo: 99 } }));
assert.deepEqual([cu.evento_id, cu.tipo, cu.devolucion], ['OC-1:oc.devolucion:1', 'oc.devolucion',
  { folio: 'DEV-2026-0003', renglon: 1, cantidad: 10, tipo: 'Dañado', resolucion: 'Reponer', nota: 'Nota de crédito por [monto]' }]);
assert.deepEqual(plain(P.buscarMontos(cu)), [], 'nunca montos');
assert(!/1856|1,200|MXN/.test(JSON.stringify(cu)));
assert.equal(P.cuerpoEventoPortal('oc.pagada', 1, { orden: { folio: 'OC-1', renglones: [] }, devolucion: { folio: 'x' } }).devolucion, undefined, 'solo en oc.devolucion');
// Correos: destinatarios y contenido (sin la nota)
const ROLES = { aprobaciones: [], compras: ['efrain@helgen.tech', 'pedro@helgen.tech'] };
const INFO = { solicitanteEmail: 'obrero@helgen.tech', recibeEmail: 'rosa@helgen.tech', actorCorreo: 'rosa@helgen.tech' };
assert.deepEqual(plain(P.destinatariosAviso('dev.reportada', {}, INFO, ROLES)), [{ quien: 'compras', para: ROLES.compras },
  { quien: 'solicitante', para: ['obrero@helgen.tech'] }], 'reportó otra persona: también quien pidió');
assert.deepEqual(plain(P.destinatariosAviso('dev.reportada', {}, Object.assign({}, INFO, { actorCorreo: 'obrero@helgen.tech' }), ROLES)),
  [{ quien: 'compras', para: ROLES.compras }]);
assert.deepEqual(plain(P.destinatariosAviso('dev.resuelta', { dev: { reporto: 'Rosa@helgen.tech' } }, INFO, ROLES)),
  [{ quien: 'reporto', para: ['rosa@helgen.tech'] }, { quien: 'solicitante', para: ['obrero@helgen.tech'] }, { quien: 'recibe', para: ['rosa@helgen.tech'] }]);
const ca = plain(P.contenidoAviso('dev.reportada', 'compras', { folio: 'REQ-2026-0001', proyectoNombre: 'DROGHEDA', sitio: 'Querétaro', nota: 'Rollo aplastado',
  dev: { folio: 'DEV-2026-0001', cantidad: 10, unidad: 'M', descripcion: 'Cable THW 10', tipo: 'Dañado' } }));
assert.equal(ca.asunto, '[CAPRI] REQ-2026-0001 · Problema con material · DROGHEDA · Querétaro');
assert(ca.filas.some(f => f[0] === 'Material' && f[1] === '10 M de "Cable THW 10"') && ca.filas.some(f => f[0] === 'Devolución' && f[1] === 'DEV-2026-0001'));
assert(!/Rollo aplastado/.test(JSON.stringify(ca)) && /Hay una nota/.test(ca.nota), 'el comentario nunca va en el correo');
assert(/devolver al proveedor, cancelar el renglón o conservar/.test(ca.que));
const cr = plain(P.contenidoAviso('dev.resuelta', 'reporto', { folio: 'REQ-2026-0001', dev: { folio: 'DEV-2026-0001', resolucion: 'Reponer' } }));
assert(/Devolución resuelta/.test(cr.asunto) && /otra vez/.test(cr.que) && cr.filas.some(f => f[0] === 'Resolución' && f[1] === 'Reponer'));
// Pendientes: devoluciones abiertas solo para compras
const DV = [{ folio: 'DEV-2026-0001', reqFolio: 'REQ-2026-0001', proyectoVisible: 'PRY-2026-0001-DRO', proyectoNombre: 'DROGHEDA', tipo: 'Dañado',
  cantidad: 10, unidad: 'M', descripcion: 'Cable THW 10', desde: '2026-10-28 10:00', sitio: '' }];
let it = plain(P.itemsPendientes([], { yo: 'pedro@helgen.tech', roles: { compras: true }, hoy: '2026-10-29', devoluciones: DV }));
assert.deepEqual([it.length, it[0].tipo, it[0].folio, it[0].req, it[0].destino, it[0].seccion, it[0].dias, it[0].accion],
  [1, 'devolucion', 'DEV-2026-0001', 'REQ-2026-0001', 'com', 'compras', 1, 'Resolver']);
assert(/Dañado · 10 M Cable THW 10/.test(it[0].detalle));
assert.equal(P.itemsPendientes([], { yo: 'obrero@helgen.tech', roles: { requisicion: true }, hoy: '2026-10-29', devoluciones: DV }).length, 0);

// ================= Servidor: flujo de siempre (sin aprobaciones) =================
const p1 = ok('ana', 'crearProyecto', { nombre: 'DROGHEDA', ubicacion: 'Veracruz', cliente: { nombre: 'Hutchison', empresa: 'ICAVE' }, idSolicitud: 'p1' }).folio;
const p2 = ok('ana', 'crearProyecto', { nombre: 'Casa del Lago', ubicacion: 'Querétaro', cliente: { nombre: 'Luis', empresa: 'Solar' }, idSolicitud: 'p2' }).folio;
assert.deepEqual([p1, p2], [P1, P2]);
const RENGLONES = [{ descripcion: 'Cable THW 10', cantidad: 80, unidad: 'm' }, { descripcion: 'Tubo conduit 3/4', cantidad: 12, unidad: 'pza' }];
const OCD = () => ({ proveedor: { razonSocial: 'Ferretera del Puerto' }, fechaEntrega: MANANA, lugarEntrega: 'Querétaro', condicionesPago: 'Contado',
  diasCredito: 0, formaPago: 'Transferencia', idSolicitud: id('oc'), renglones: [{ descripcion: 'Cable THW 10', unidad: 'M', cantidad: 80, costo: 10 },
    { descripcion: 'Tubo conduit 3/4', unidad: 'PZA', cantidad: 12, costo: 50 }] });
const pagar = folio => ok('efrain', 'registrarPagoProveedor', { reqFolio: folio, fecha: HOY_ISO, monto: 1624, monedaPago: 'MXN',
  metodo: 'Transferencia', referencia: 'SPEI ' + id(), comprobante: { nombre: 'c.pdf', datos: PDF }, idSolicitud: id('pg') });
/** Requisición del flujo de siempre (obrero pide, efrain autoriza) hasta su orden; pagada si se pide. */
function siempre(proyecto, pagada, sitio) {
  const folio = ok('obrero', 'guardarRequisicion', { proyectoFolio: proyecto, sitio: sitio || 'Querétaro', renglones: RENGLONES,
    cotizacion: { nombre: 'cot.pdf', datos: PDF }, idSolicitud: id('q') }).folio;
  const oc = ok('efrain', 'autorizarRequisicion', folio, OCD()).ocFolio;
  if (pagada) pagar(folio);
  return { req: folio, oc: oc };
}
const LC = () => A.libros[props.COMPRAS_DB_ID];
const H = n => LC().pest[n].m;
const enc = n => H(n)[0];
const col = (n, c) => enc(n).indexOf(c);
const movsDe = oc => H('MovimientosInventario').filter(r => r[7] === oc);
const devs = () => H('Devoluciones').slice(1);
const filaOc = oc => H('OrdenesCompra').find(r => r[0] === oc);
const mia = (quien, folio) => ok(quien, 'misRequisiciones').find(x => x.folio === folio);
let visto = 0;
const correosNuevos = () => { const l = A.correos.slice(visto); visto = A.correos.length; return l; };
const PROHIBIDO = [/Ferretera/i, /\$\s?\d/, /1,?624/, /OC-\d{4}-\d{4}/, /Rollo aplastado/, /Hutchison/];
const revisarCorreo = m => PROHIBIDO.forEach(re => assert(!re.test([m.subject, m.htmlBody, m.body].join('\n')), m.subject + ' no debe tener ' + re));

// ---- "Recibí el material": una foto por renglón de la orden ----
const s1 = siempre(P2, true);
falla('obrero', 'cerrarRequisicion', [s1.req, ''], /Falta la foto de "Cable THW 10"/);
falla('obrero', 'cerrarRequisicion', [s1.req, '', { renglones: [{ renglon: 1, foto: F }] }], /Falta la foto de "Tubo conduit 3\/4"/);
falla('obrero', 'cerrarRequisicion', [s1.req, '', { renglones: [{ renglon: 1, foto: { nombre: 'x.pdf', datos: PDF } }, { renglon: 2, foto: F }] }], /no un PDF/);
assert.equal(movsDe(s1.oc).length, 0, 'sin fotos no se escribe nada');
let mias = ok('obrero', 'cerrarRequisicion', s1.req, 'Todo bien', { renglones: conFotos([{ renglon: 1 }, { renglon: 2 }]) });
assert.equal(mias.find(x => x.folio === s1.req).estado, 'Cerrada');
assert.deepEqual(enc('MovimientosInventario').slice(-2), ['foto_id', 'foto_url'], 'columnas nuevas al final');
let mm = movsDe(s1.oc);
assert.deepEqual(mm.map(r => [r[3], r[8], r[12], r[13], r[15]].join('|')), ['Entrada por compra|1|80|obrero@helgen.tech|Todo bien',
  'Entrada por compra|2|12|obrero@helgen.tech|Todo bien'], 'cada renglón queda como entrada por compra (folio REC)');
assert(/^REC-\d{4}-\d{4}$/.test(mm[0][0]) && mm[0][0] === mm[1][0]);
const foto1 = archivos[mm[0][col('MovimientosInventario', 'foto_id')]];
assert.deepEqual([foto1.nombre, foto1.acceso, foto1.padre.nombre, foto1.padre.padre.nombre, foto1.padre.padre.padre.nombre],
  [mm[0][0] + ' — r1.jpg', 'PRIVATE', 'Recepciones', P2, ANIO], 'Compras/AAAA/<proyecto>/Recepciones/<REC> — r1.jpg, privada');
assert.equal(foto1.padre.acceso, 'PRIVATE');
assert.equal(mm[0][col('MovimientosInventario', 'foto_url')], 'https://drive/file/' + foto1.id);
let vc = ok('pedro', 'getRequisicion', s1.req);
assert.deepEqual([vc.recepcionCompleta, vc.recepciones[0].renglones[0].fotoUrl], [true, 'https://drive/file/' + foto1.id], 'compras: "Ver foto"');
let m1 = mia('obrero', s1.req);
assert.deepEqual([m1.fotos.length, m1.devoluciones.length, m1.reportables.map(x => x.renglon)], [0, 0, [1, 2]],
  'quien pidió sin acceso a la carpeta no recibe las ligas; puede reportar en los dos renglones');
assert.equal(m1.recepciones[0].renglones[0].fotoUrl, undefined);
// Con acceso a la carpeta de compras (compartida por persona), sí
const carpCom = carpetas[props.COMPRAS_FOLDER_ID];
carpCom.getEditors = () => []; carpCom.getViewers = () => [{ getEmail: () => 'Obrero@helgen.tech' }]; carpCom.getOwner = () => ({ getEmail: () => 'efrain@helgen.tech' });
for (const k of Object.keys(A.cache)) delete A.cache[k];
assert.deepEqual(mia('obrero', s1.req).fotos.map(f => f.renglon + ':' + f.tipo), ['1:Recepción', '2:Recepción']);

// ---- Reportar un problema después (Cerrada, ≤ 30 días) ----
falla('ana', 'reportarProblema', [s1.req, {}], /No tienes permiso para reportar/, 'PERMISO');
falla('rosa', 'reportarProblema', [s1.req, { renglon: 1, cantidad: 1, tipo: 'Dañado', comentario: 'Rollo aplastado', foto: F }], /Solo quien pidió/, 'PERMISO');
falla('obrero', 'reportarProblema', [s1.req, { renglon: 3, cantidad: 1, tipo: 'Dañado', comentario: 'Rollo aplastado', foto: F }], /no tiene el renglón 3/);
falla('obrero', 'reportarProblema', [s1.req, { renglon: 1, cantidad: 81, tipo: 'Dañado', comentario: 'Rollo aplastado', foto: F }], /solo hay 80 M recibidos/);
falla('obrero', 'reportarProblema', [s1.req, { renglon: 1, cantidad: 10, tipo: 'Dañado', comentario: 'Rollo aplastado' }], /Toma una foto del problema/);
correosNuevos();
const idDev = id('dev');
let rp = ok('obrero', 'reportarProblema', s1.req, { renglon: 1, cantidad: 10, tipo: 'Dañado', comentario: 'Rollo aplastado', foto: F, idSolicitud: idDev });
assert.equal(rp.folio, DEV('0001'));
assert.equal(ok('obrero', 'reportarProblema', s1.req, { renglon: 1, cantidad: 10, tipo: 'Dañado', comentario: 'Rollo aplastado', foto: F, idSolicitud: idDev }).folio,
  DEV('0001'), 'idempotencia');
assert.equal(devs().length, 1);
assert.deepEqual(enc('Devoluciones'), ['folio', 'fecha', 'req_folio', 'oc_folio', 'proyecto_folio', 'renglon', 'descripcion', 'cantidad', 'tipo', 'comentario',
  'foto_id', 'foto_url', 'origen', 'reporto_email', 'estado', 'resolucion', 'nota_resolucion', 'guia_devolucion', 'resolvio_email', 'fecha_resolucion', 'origen_clave']);
let d1 = devs()[0];
assert.deepEqual([d1[2], d1[3], d1[4], d1[5], d1[6], d1[7], d1[8], d1[9], d1[12], d1[13], d1[14]],
  [s1.req, s1.oc, P2, 1, 'Cable THW 10', 10, 'Dañado', 'Rollo aplastado', 'CAPRI', 'obrero@helgen.tech', 'Abierta']);
assert.deepEqual([archivos[d1[10]].nombre, archivos[d1[10]].acceso, archivos[d1[10]].padre.nombre], [DEV('0001') + ' — r1.jpg', 'PRIVATE', 'Recepciones']);
m1 = rp.requisiciones.find(x => x.folio === s1.req);
assert.deepEqual([m1.estado, m1.devoluciones.length, m1.devoluciones[0].estado, m1.reportables.find(x => x.renglon === 1).disponible], ['Cerrada', 1, 'Abierta', 70]);
assert(!JSON.stringify(m1.devoluciones).match(/OC-|notaResolucion|Ferretera/), 'quien pidió: sin orden ni nota de compras');
assert(/Problema reportado \(DEV-\d{4}-0001\): Dañado · 10 M de Cable THW 10/.test(m1.eventos.slice(-1)[0].nota));
falla('obrero', 'reportarProblema', [s1.req, { renglon: 1, cantidad: 71, tipo: 'Dañado', comentario: 'Otro rollo', foto: F }], /solo hay 70 M/); // lo que ya está en una abierta no se reporta otra vez
let cs = correosNuevos();
assert.equal(cs.length, 1);
assert.deepEqual(cs[0].to.split(',').sort(), ['efrain@helgen.tech', 'pedro@helgen.tech'], 'dev.reportada → compras (quien pidió lo reportó: no se avisa a sí mismo)');
assert(/Problema con material/.test(cs[0].subject) && /Hay una nota/.test(cs[0].htmlBody));
cs.forEach(revisarCorreo);
// Listas y Pendientes
let ld = ok('pedro', 'listarDevoluciones', { estado: 'Abierta' });
assert.deepEqual([ld.length, ld[0].folio, ld[0].ocFolio, ld[0].unidad, ld[0].puedeResolver, ld[0].proyectoNombre], [1, DEV('0001'), s1.oc, 'M', true, 'Casa del Lago']);
assert.deepEqual(ok('obrero', 'listarDevoluciones', '').map(x => [x.folio, x.ocFolio, x.puedeResolver]), [[DEV('0001'), undefined, undefined]]);
assert.deepEqual(ok('rosa', 'listarDevoluciones', ''), [], 'solo las de sus requisiciones');
falla('ana', 'listarDevoluciones', [''], /No tienes permiso para ver devoluciones/, 'PERMISO');
let pend = ok('pedro', 'pendientes', false);
assert.deepEqual(pend.items.filter(x => x.tipo === 'devolucion').map(x => x.folio + ':' + x.req), [DEV('0001') + ':' + s1.req]);
assert.equal(ok('obrero', 'pendientes', false).items.filter(x => x.tipo === 'devolucion').length, 0);
vc = ok('pedro', 'getRequisicion', s1.req);
assert.deepEqual([vc.devoluciones.length, vc.devoluciones[0].fotoUrl, vc.tiposDev.length, vc.resolucionesDev.length],
  [1, 'https://drive/file/' + d1[10], 5, 4]);
// No se cancela la recepción de un renglón con devolución
falla('pedro', 'cancelarRecepcion', [mm[0][0], 'Se registró mal'], /ya está cerrada/);

// ---- Resolver: Reponer → movimiento negativo, el renglón vuelve a por recibir y la requisición se reabre ----
falla('obrero', 'resolverDevolucion', [DEV('0001'), { resolucion: 'Reponer' }], /Solo compras resuelve/, 'PERMISO');
falla('rosa', 'resolverDevolucion', [DEV('0001'), { resolucion: 'Reponer' }], /solo tiene acceso a Requisiciones/, 'PERMISO');
falla('pedro', 'resolverDevolucion', [DEV('0001'), { resolucion: 'Tirarlo' }], /Elige la resolución/);
const idRes = id('res');
let rs = ok('pedro', 'resolverDevolucion', DEV('0001'), { resolucion: 'Reponer', nota: 'El proveedor manda otro rollo', idSolicitud: idRes });
assert.deepEqual([rs.estado, rs.vista.requisicion.estado, rs.vista.orden.estado, rs.vista.avance[0].pendiente, rs.devoluciones.length],
  ['Pagada', 'Pagada', 'Pagada', 10, 0], 'Cerrada → Pagada; la orden Recibida → Pagada; faltan 10 M');
assert.equal(ok('pedro', 'resolverDevolucion', DEV('0001'), { resolucion: 'Reponer', idSolicitud: idRes }).folio, DEV('0001'), 'idempotencia');
falla('pedro', 'resolverDevolucion', [DEV('0001'), { resolucion: 'Conservar' }], /ya está resuelta \(Reponer\)/);
mm = movsDe(s1.oc);
assert.deepEqual(mm.slice(-1).map(r => [r[0], r[3], r[8], r[12], r[15]].join('|')), [DEV('0001') + '|Devolución|1|-10|Devolución ' + DEV('0001') + ' · Reponer']);
d1 = devs()[0];
assert.deepEqual([d1[14], d1[15], d1[16], d1[18]], ['Resuelta', 'Reponer', 'El proveedor manda otro rollo', 'pedro@helgen.tech']);
assert.deepEqual([filaOc(s1.oc)[28], filaOc(s1.oc)[29]], ['Pagada', ''], 'ya no está recibido todo');
m1 = mia('obrero', s1.req);
assert.deepEqual([m1.estado, m1.puedeCerrar, m1.recepciones.length], ['Pagada', true, 1], 'la devolución no sale como recepción');
assert(/resuelta: Reponer/.test(m1.eventos.slice(-1)[0].nota));
cs = correosNuevos();
assert.deepEqual(cs.map(m => m.to), ['obrero@helgen.tech'], 'dev.resuelta → quien reportó / pidió / recibe (una vez)');
assert(/Devolución resuelta/.test(cs[0].subject));
cs.forEach(revisarCorreo);
assert.equal(ok('pedro', 'pendientes', false).items.filter(x => x.tipo === 'devolucion').length, 0, 'resuelta: sale de Pendientes');
// Llega la reposición: "Recibí el material" otra vez, solo del renglón que falta
falla('obrero', 'cerrarRequisicion', [s1.req, '', { renglones: [{ renglon: 2, foto: F }] }], /Falta la foto de "Cable THW 10"/);
mias = ok('obrero', 'cerrarRequisicion', s1.req, 'Llegó el rollo nuevo', { renglones: [{ renglon: 1, foto: F }] });
assert.equal(mias.find(x => x.folio === s1.req).estado, 'Cerrada');
assert.deepEqual(movsDe(s1.oc).slice(-1).map(r => r[8] + ':' + r[12]), ['1:10']);

// ---- Devolver al proveedor (faltante aceptado) y Conservar ----
ok('obrero', 'reportarProblema', s1.req, { renglon: 2, cantidad: 2, tipo: 'Faltante', comentario: 'Vinieron 10, no 12', idSolicitud: id('d') });
falla('pedro', 'resolverDevolucion', [DEV('0002'), { resolucion: 'Devolver al proveedor' }], /nota de la devolución/);
rs = ok('pedro', 'resolverDevolucion', DEV('0002'), { resolucion: 'Devolver al proveedor', nota: 'Nota de crédito por $100.00', guia: 'DHL 123' });
assert.deepEqual([rs.estado, rs.vista.requisicion.estado, rs.vista.recepcionCompleta, rs.vista.avance[1].faltante, rs.vista.avance[1].recibido],
  ['Cerrada', 'Cerrada', true, 2, 10], 'sigue cerrada; el renglón queda completo con faltante aceptado');
assert.deepEqual(movsDe(s1.oc).slice(-1).map(r => r[3] + ':' + r[12]), ['Devolución sin reponer:-2']);
ok('pedro', 'reportarProblema', s1.req, { renglon: 1, cantidad: 1, tipo: 'Otro', comentario: 'Etiqueta equivocada', foto: F, idSolicitud: id('d') });
const nMovs = movsDe(s1.oc).length;
rs = ok('pedro', 'resolverDevolucion', DEV('0003'), { resolucion: 'Conservar' });
assert.deepEqual([rs.estado, movsDe(s1.oc).length], ['Cerrada', nMovs], 'Conservar: nada cambia');
assert.deepEqual(devs().map(r => r[0] + ':' + r[14] + ':' + r[15]), [DEV('0001') + ':Resuelta:Reponer', DEV('0002') + ':Resuelta:Devolver al proveedor',
  DEV('0003') + ':Resuelta:Conservar']);
const bit = H('Bitacora').filter(r => /devolución|problema/i.test(r[2])).map(r => r[2]);
assert.deepEqual(bit.slice(0, 2), ['Reportar problema', 'Resolver devolución']);

// ---- Ventana de 30 días ----
const fo1 = H('OrdenesCompra').findIndex(r => r[0] === s1.oc);
H('OrdenesCompra')[fo1][29] = masDias(-31);
falla('obrero', 'reportarProblema', [s1.req, { renglon: 1, cantidad: 1, tipo: 'Dañado', comentario: 'Se oxidó', foto: F }], /Pasaron más de 30 días/);
assert.deepEqual(mia('obrero', s1.req).reportables, [], 'fuera de la ventana no hay "Reportar problema"');
H('OrdenesCompra')[fo1][29] = masDias(-30);
for (const k of Object.keys(A.cache)) delete A.cache[k]; // cambio a mano en la hoja: sin subir versiones
assert.equal(mia('obrero', s1.req).reportables.length, 2, 'el día 30 todavía se puede');

// ---- Problema al recibir: la requisición pagada no se cierra (queda Recibida) hasta resolver ----
const s2 = siempre(P2, true);
falla('obrero', 'cerrarRequisicion', [s2.req, '', { renglones: [{ renglon: 1, foto: F, problema: { tipo: 'Dañado', cantidad: 5, comentario: 'Rollo mojado' } }, { renglon: 2, foto: F }] }],
  /Toma una foto del problema/);
assert.equal(movsDe(s2.oc).length, 0, 'un problema inválido no deja nada a medias');
correosNuevos();
mias = ok('obrero', 'cerrarRequisicion', s2.req, '', { renglones: [{ renglon: 1, foto: F, problema: { tipo: 'Dañado', cantidad: 5, comentario: 'Rollo mojado', foto: F } },
  { renglon: 2, foto: F }] });
let m2 = mias.find(x => x.folio === s2.req);
assert.deepEqual([m2.estado, m2.devoluciones.map(d => d.folio + ':' + d.estado)], ['Recibida', [DEV('0004') + ':Abierta']]);
assert(/queda Recibida \(sin cerrar\) hasta que compras resuelva la devolución DEV-\d{4}-0004/.test(m2.eventos.slice(-1)[0].nota));
assert.deepEqual([filaOc(s2.oc)[28], filaOc(s2.oc)[29], filaOc(s2.oc)[30]], ['Pagada', HOY_ISO, 'obrero@helgen.tech'], 'la orden sigue Pagada, con su fecha de recepción');
cs = correosNuevos();
assert.deepEqual(cs.map(m => m.subject.split(' · ')[1]).sort(), ['Material recibido', 'Problema con material']);
cs.forEach(revisarCorreo);
vc = ok('pedro', 'getRequisicion', s2.req);
assert.deepEqual([vc.puedeCerrar, vc.puedePagar, vc.puedeCancelarPago], [false, false, false]);
falla('pedro', 'cerrarRequisicionCompras', [s2.req, 'Cierro yo'], /la devolución DEV-\d{4}-0004 de REQ-\d{4}-\d{4} está abierta/i);
rs = ok('pedro', 'resolverDevolucion', DEV('0004'), { resolucion: 'Conservar', nota: 'Se usa así' });
assert.deepEqual([rs.estado, rs.vista.requisicion.estado, rs.vista.orden.estado], ['Cerrada', 'Cerrada', 'Recibida'], 'sin devoluciones abiertas se cierra sola');
assert(/ya no hay devoluciones abiertas/.test(rs.vista.eventos.slice(-1)[0].nota));

// Compras no cierra con una devolución abierta (el respaldo tampoco)
const s3 = siempre(P2, true);
ok('obrero', 'marcarEnCamino', s3.req, { paqueteria: 'DHL', guia: '1', fechaEstimada: MANANA, idSolicitud: id('e') });
const s3b = ok('obrero', 'cerrarRequisicion', s3.req, '', { renglones: [{ renglon: 1, foto: F }, { renglon: 2, foto: F,
  problema: { tipo: 'Faltante', cantidad: 2, comentario: 'Faltaron 2 tubos' } }] }).find(x => x.folio === s3.req);
assert.equal(s3b.estado, 'Recibida', 'En camino pagada + problema = Recibida');
// Reponer desde la retenida: vuelve a En camino (la orden ya iba en camino) y la orden sigue Pagada
rs = ok('pedro', 'resolverDevolucion', DEV('0005'), { resolucion: 'Reponer' });
assert.deepEqual([rs.vista.requisicion.estado, rs.vista.orden.estado, rs.vista.avance[1].pendiente], ['En camino', 'Pagada', 2]);
ok('obrero', 'reportarProblema', s3.req, { renglon: 1, cantidad: 1, tipo: 'Dañado', comentario: 'Golpeado', foto: F, idSolicitud: id('d') });
falla('pedro', 'cerrarRequisicionCompras', [s3.req, 'El trabajador ya no está'], /devolución DEV-\d{4}-0006 de REQ-\d{4}-\d{4} está abierta: resuélvela/);
ok('pedro', 'resolverDevolucion', DEV('0006'), { resolucion: 'Conservar' });
vc = ok('pedro', 'cerrarRequisicionCompras', s3.req, 'El trabajador ya no está', 'Llegaron los 2 tubos');
assert.equal(vc.requisicion.estado, 'Cerrada');
assert.deepEqual(movsDe(s3.oc).filter(r => r[3] === 'Entrada por compra').map(r => r[8] + ':' + r[12] + ':' + r[13]),
  ['1:80:obrero@helgen.tech', '2:12:obrero@helgen.tech', '2:2:pedro@helgen.tech'], 'el cierre de compras deja lo pendiente como entrada (sin foto obligatoria)');

// ================= Con aprobaciones: "Registrar lo que llegó", "Lo recogí" y pagar una retenida =================
props.ROL_OPERACIONES = 'adri@helgen.tech';
const PROP = () => ({ proveedor: { razonSocial: 'Ferretera del Puerto' }, fechaEntrega: MANANA, condicionesPago: 'Contado', diasCredito: 0, formaPago: 'Transferencia',
  recibe: 'rosa@helgen.tech', idSolicitud: id('p'), renglones: [{ renglon: 1, disponibilidad: 'Exacto', costo: 10 }, { renglon: 2, disponibilidad: 'Exacto', costo: 50 }] });
function conOps(proyecto, sitio) {
  const folio = ok('obrero', 'guardarRequisicion', { proyectoFolio: proyecto, sitio: sitio || 'Querétaro', renglones: RENGLONES, idSolicitud: id('q') }).folio;
  const v = ok('adri', 'getRequisicionOperaciones', folio);
  ok('adri', 'aprobarRequisicion', folio, { version: v.version, prioridad: 'Normal', renglones: v.renglones.map(r => ({ renglon: r.renglon, aprobado: true })) });
  ok('pedro', 'cotizarRequisicion', folio, PROP());
  const w = ok('adri', 'getRequisicionOperaciones', folio);
  return { req: folio, oc: ok('adri', 'autorizarPropuesta', folio, w.propuesta.version, id('vb'), w.propuesta.huella).ocFolio };
}
const o1 = conOps(P2);
// "Lo recogí": una foto por renglón (no cuenta como recepción)
falla('rosa', 'marcarEnCamino', [o1.req, { recogido: true }], /Falta la foto de "Cable THW 10"/);
assert.equal(ok('rosa', 'marcarEnCamino', o1.req, { recogido: true, renglones: conFotos([{ renglon: 1 }, { renglon: 2 }]), idSolicitud: id('e') }).estado, 'En camino');
const rec = movsDe(o1.oc);
assert.deepEqual(rec.map(r => [r[3], r[8], r[12], r[13], r[15]].join('|')), ['Recogido en tienda|1|80|rosa@helgen.tech|Lo recogí',
  'Recogido en tienda|2|12|rosa@helgen.tech|Lo recogí']);
assert.equal(archivos[rec[0][col('MovimientosInventario', 'foto_id')]].nombre, rec[0][0] + ' — r1.jpg');
vc = ok('pedro', 'getRequisicion', o1.req);
assert.deepEqual([vc.avance.map(l => l.recibido).join(), vc.recepciones.length, vc.fotosRecogido.map(f => f.renglon + ':' + f.tipo)],
  ['0,0', 0, ['1:Lo recogí', '2:Lo recogí']], 'compras ve las fotos de "Lo recogí"; el avance no cambia');
// Recepción por renglón: foto obligatoria y problema al recibir
const recibir = (quien, renglones, extra) => ok(quien, 'registrarRecepcion', Object.assign({ reqFolio: o1.req, sitio: 'Querétaro', renglones: renglones,
  idSolicitud: id('r') }, extra || {}));
falla('rosa', 'registrarRecepcion', [{ reqFolio: o1.req, sitio: 'Querétaro', renglones: [{ renglon: 1, cantidad: 50 }] }], /Falta la foto de "Cable THW 10"/);
falla('rosa', 'registrarRecepcion', [{ reqFolio: o1.req, sitio: 'Querétaro', renglones: [{ renglon: 1, cantidad: 50, foto: F,
  problema: { tipo: 'Dañado', cantidad: 51, comentario: 'Rollo aplastado', foto: F } }] }], /solo hay 50 M recibidos/);
falla('rosa', 'registrarRecepcion', [{ reqFolio: o1.req, sitio: 'Querétaro', renglones: [{ renglon: 1, cantidad: 50, foto: F },
  { renglon: 2, cantidad: 0, problema: { tipo: 'Dañado', cantidad: 1, comentario: 'Tubo doblado', foto: F } }] }], /no corresponde a lo que estás recibiendo/);
falla('rosa', 'registrarRecepcion', [{ reqFolio: o1.req, sitio: 'Querétaro', renglones: [{ renglon: 1, cantidad: 70, foto: F,
  problema: { tipo: 'Faltante', cantidad: 10, comentario: 'Faltaron 10 m' } }] }], /escribe en "Llegó" solo lo que llegó/); // se contaría doble
let rr = recibir('rosa', [{ renglon: 1, cantidad: 50, foto: F }, { renglon: 2, cantidad: 0 }]);
assert.deepEqual([rr.completo, rr.estado], [false, 'En camino'], 'un renglón con 0 no pide foto');
const nRec = movsDe(o1.oc).filter(r => r[3] === 'Entrada por compra');
assert.deepEqual(nRec.map(r => r[8] + ':' + r[12] + ':' + (r[col('MovimientosInventario', 'foto_id')] ? 'foto' : '')), ['1:50:foto']);
assert.equal(archivos[nRec[0][col('MovimientosInventario', 'foto_id')]].nombre, rr.folio + ' — r1.jpg');
// Se paga mientras va en camino; la última recepción trae un problema: queda Recibida (no se cierra)
pagar(o1.req);
rr = recibir('rosa', [{ renglon: 1, cantidad: 30, foto: F, problema: { tipo: 'Incorrecto', cantidad: 20, comentario: 'Calibre 12, no 10', foto: F } },
  { renglon: 2, cantidad: 12, foto: F }]);
assert.deepEqual([rr.completo, rr.estado], [true, 'Recibida']);
assert.deepEqual(devs().slice(-1).map(r => [r[0], r[5], r[7], r[8], r[13]].join('|')), [DEV('0007') + '|1|20|Incorrecto|rosa@helgen.tech']);
let mo = mia('obrero', o1.req);
assert.deepEqual([mo.estado, mo.devoluciones[0].folio], ['Recibida', DEV('0007')]);
// Reponer: vuelve a En camino; llega la reposición y se cierra
rs = ok('pedro', 'resolverDevolucion', DEV('0007'), { resolucion: 'Reponer' });
assert.deepEqual([rs.vista.requisicion.estado, rs.vista.avance[0].pendiente, rs.vista.puedeRecibir], ['En camino', 20, true]);
rr = recibir('rosa', [{ renglon: 1, cantidad: 20, foto: F }]);
assert.deepEqual([rr.completo, rr.estado], [true, 'Cerrada']);
// Recibida sin pagar + problema después + pago: el pago no la cierra
const o2 = conOps(P2);
rr = ok('rosa', 'registrarRecepcion', { reqFolio: o2.req, sitio: 'Querétaro', renglones: conFotos([{ renglon: 1, cantidad: 80 }, { renglon: 2, cantidad: 12 }]), idSolicitud: id('r') });
assert.equal(rr.estado, 'Recibida');
ok('rosa', 'reportarProblema', o2.req, { renglon: 2, cantidad: 1, tipo: 'Sobrante', comentario: 'Llegó un tubo de más', foto: F, idSolicitud: id('d') });
let pg = pagar(o2.req);
assert.deepEqual([pg.vista.requisicion.estado, pg.vista.orden.estado], ['Recibida', 'Pagada'], 'pagada, pero sigue Recibida por la devolución');
assert(/Pagada; queda Recibida \(sin cerrar\) hasta que compras resuelva la devolución/.test(pg.vista.eventos.slice(-1)[0].nota));
falla('pedro', 'cancelarRecepcion', [rr.folio, 'Se registró mal'], /tiene la devolución DEV-\d{4}-0008 \(abierta\)/);
rs = ok('pedro', 'resolverDevolucion', DEV('0008'), { resolucion: 'Cancelar renglón', nota: 'El sobrante se queda en el sitio' });
assert.deepEqual([rs.estado, rs.vista.orden.estado], ['Cerrada', 'Recibida']);
assert(!movsDe(o2.oc).some(r => /Devolución|Faltante/.test(r[3])), 'un sobrante nunca se contó (no se recibe más de lo pedido): no se descuenta');
props.ROL_OPERACIONES = '';

// ================= Centro de mando: fotos y problemas del sitio =================
props.PORTAL_SECRETO = SECRETO;
// Proyecto ligado (flujo de siempre): se recibe en el centro de mando
const c1 = siempre(P1, true, 'Manzanillo (TIMSA)');
falla('obrero', 'cerrarRequisicion', [c1.req, '', FOTOS], /se recibe en el centro de mando/);
const cuando = new Date(Date.now() - 60000).toISOString();
CM.fotos['F-R1'] = JPEG_CM; CM.fotos['F-R2'] = JPEG_CM; CM.fotos['F-P1'] = JPEG_CM;
CM.recepciones = [{ oc_folio: c1.oc, req_folio: c1.req, sitio: 'ZLO', completa: true, recibio: 'jesush', cuando: cuando, renglones: [
  { n: 1, pedido: 80, recibido: 80, foto: { id: 'F-R1', archivada: false, url: '' },
    problema: { tipo: 'Dañado', comentario: 'Rollo aplastado en la entrega', cantidad: 10, foto: { id: 'F-P1', archivada: false, url: '' } } },
  { n: 2, pedido: 12, recibido: 12, foto: { id: 'F-R2', archivada: false, url: '' }, problema: null }] }];
como(null);
let tr = plain(P.traerRecepcionesPortal());
const colaCM = plain(correr('MEMO_.correos || []')); // fuera de doPost: el activador manda la cola al final
assert.deepEqual([tr.ok, tr.errores, tr.cerradas, tr.devoluciones, tr.archivadas], [true, [], [c1.req], [DEV('0009')], 3]);
assert.equal(props.PORTAL_ULTIMA_CONSULTA, CM.hasta, 'todo salió bien: avanza la última consulta');
assert.deepEqual(CM.gets.sort(), ['F-P1', 'F-R1', 'F-R2'], 'GET firmado de cada foto (cuerpo vacío)');
assert.deepEqual(CM.rechazos, [], 'todas las firmas cuadran');
mm = movsDe(c1.oc);
const fc = col('MovimientosInventario', 'foto_id');
assert.deepEqual(mm.map(r => r[8] + ':' + r[12] + ':' + r[13] + ':' + (archivos[r[fc]] ? archivos[r[fc]].nombre : r[fc])),
  ['1:80:centro de mando:' + mm[0][0] + ' — r1.jpg', '2:12:centro de mando:' + mm[0][0] + ' — r2.jpg']);
assert.deepEqual([archivos[mm[0][fc]].acceso, archivos[mm[0][fc]].padre.nombre, archivos[mm[0][fc]].padre.padre.nombre], ['PRIVATE', 'Recepciones', P1]);
assert.deepEqual(CM.posts.map(p => p.id + '=' + p.url).sort(), ['F-P1=https://drive/file/' + devs().slice(-1)[0][10],
  'F-R1=https://drive/file/' + mm[0][fc], 'F-R2=https://drive/file/' + mm[1][fc]].sort(), 'aviso de archivada con la liga de Drive');
let d9 = devs().slice(-1)[0];
assert.deepEqual([d9[0], d9[5], d9[7], d9[8], d9[9], d9[12], d9[13], d9[14], archivos[d9[10]].nombre],
  [DEV('0009'), 1, 10, 'Dañado', 'Rollo aplastado en la entrega', 'Centro de mando', 'jesush', 'Abierta', DEV('0009') + ' — r1.jpg']);
let vc1 = ok('pedro', 'getRequisicion', c1.req);
assert.deepEqual([vc1.requisicion.estado, vc1.orden.estado, vc1.devoluciones[0].origen, vc1.devoluciones[0].fotoPendiente],
  ['Recibida', 'Pagada', 'Centro de mando', false], 'completa y pagada, pero con un problema del sitio: no se cierra');
assert(colaCM.some(a => a.tipo === 'dev.reportada' && a.datos.dev.origen === 'Centro de mando' && a.datos.quien === 'jesush'));
// La misma recepción otra vez (el centro de mando ya archivó las fotos): ni otra DEV ni otra descarga
CM.recepciones[0].renglones.forEach(l => { l.foto.archivada = true; l.foto.url = CM.archivadas[l.foto.id]; if (l.problema) { l.problema.foto.archivada = true; l.problema.foto.url = CM.archivadas['F-P1']; } });
const gets = CM.gets.length;
como(null);
tr = plain(P.traerRecepcionesPortal());
assert.deepEqual([tr.ok, tr.devoluciones || [], tr.archivadas || 0, CM.gets.length, devs().length], [true, [], 0, gets, 9]);
// Compras resuelve "Reponer": aviso oc.devolucion (sin montos) y la requisición vuelve a por recibir
CM.eventos = {};
rs = ok('pedro', 'resolverDevolucion', DEV('0009'), { resolucion: 'Reponer', nota: 'Reembolso de $1,200 si no llega' });
const ev = Object.values(CM.eventos).find(e => e.tipo === 'oc.devolucion');
assert(ev, 'aviso oc.devolucion: ' + JSON.stringify(Object.keys(CM.eventos)));
assert.deepEqual([ev.evento_id, ev.oc.folio, ev.oc.sitio, ev.devolucion], [c1.oc + ':oc.devolucion:1', c1.oc, 'ZLO',
  { folio: DEV('0009'), renglon: 1, cantidad: 10, tipo: 'Dañado', resolucion: 'Reponer', nota: 'Reembolso de [monto] si no llega' }]);
assert.deepEqual(llaves(ev).filter(k => MONTOS.test(k)), [], 'sin montos');
assert(!/1,200|1624|MXN/.test(JSON.stringify(ev)));
assert.deepEqual([rs.vista.requisicion.estado, rs.vista.avance[0].pendiente], ['Pagada', 10]);
// La recepción vieja vuelve a llegar (cambió una foto): no se cuenta otra vez ni la cierra
CM.recepciones[0].renglones[1].foto = { id: 'F-R2b', archivada: false, url: '' };
CM.fotos['F-R2b'] = JPEG_CM;
como(null);
tr = plain(P.traerRecepcionesPortal());
assert.deepEqual([tr.ok, tr.cerradas, ok('pedro', 'getRequisicion', c1.req).requisicion.estado], [true, [], 'Pagada']);
assert.equal(movsDe(c1.oc).filter(r => r[3] === 'Entrada por compra').length, 2, 'lo de antes de Reponer ya estaba contado');
// La foto nueva no tiene movimiento nuevo: se anota en la última entrada sin foto de ese renglón… (aquí ya la tiene: Bitacora)
assert(H('Bitacora').some(r => r[2] === 'Foto del centro de mando sin renglón'));
// Llega la reposición (recepción nueva, después de resolver): se copia la diferencia y se cierra
const recNueva = { oc_folio: c1.oc, req_folio: c1.req, sitio: 'ZLO', completa: true, recibio: 'jesush', cuando: new Date(Date.now() + 120000).toISOString(),
  renglones: [{ n: 1, pedido: 80, recibido: 80, foto: { id: 'F-R1c', archivada: false, url: '' } }, { n: 2, pedido: 12, recibido: 12, foto: null }] };
CM.recepciones = [recNueva];
CM.fotos['F-R1c'] = JPEG_CM;
como(null);
tr = plain(P.traerRecepcionesPortal());
assert.deepEqual([tr.ok, tr.cerradas, tr.archivadas], [true, [c1.req], 1]);
assert.deepEqual(movsDe(c1.oc).filter(r => r[3] === 'Entrada por compra').map(r => r[8] + ':' + r[12]), ['1:80', '2:12', '1:10']);
assert.equal(ok('pedro', 'getRequisicion', c1.req).requisicion.estado, 'Cerrada');
// Falla al bajar una foto: lo demás se aplica, pero la última consulta no avanza (se vuelve a ofrecer)
const c2 = siempre(P1, true, 'Veracruz (ICAVE)');
CM.fotos['F-X1'] = JPEG_CM; CM.fotos['F-X2'] = JPEG_CM;
CM.recepciones = [{ oc_folio: c2.oc, req_folio: c2.req, sitio: 'VER', completa: true, recibio: 'alan', cuando: new Date().toISOString(), renglones: [
  { n: 1, pedido: 80, recibido: 80, foto: { id: 'F-X1', archivada: false, url: '' } }, { n: 2, pedido: 12, recibido: 12, foto: { id: 'F-X2', archivada: false, url: '' } }] }];
const ultimaAntes = props.PORTAL_ULTIMA_CONSULTA;
CM.modoFoto = '500';
como(null);
tr = plain(P.traerRecepcionesPortal());
assert.deepEqual([tr.cerradas, tr.archivadas, props.PORTAL_ULTIMA_CONSULTA], [[c2.req], 0, ultimaAntes], 'cierra, pero no avanza la última consulta');
assert(tr.errores.length === 2 && /Foto F-X1: El centro de mando respondió 500/.test(tr.errores[0]));
assert(/Foto F-X1/.test(props.PORTAL_ERROR_CONSULTA));
mm = movsDe(c2.oc);
assert.deepEqual(mm.map(r => r[fc]), ['centro:F-X1', 'centro:F-X2'], 'foto pendiente marcada en su movimiento');
assert.equal(ok('pedro', 'getRequisicion', c2.req).recepciones[0].renglones[0].fotoUrl, undefined, 'todavía sin "Ver foto"');
// Se arregla: la siguiente consulta las baja, las anota y avanza
CM.modoFoto = 'ok';
como(null);
tr = plain(P.traerRecepcionesPortal());
assert.deepEqual([tr.ok, tr.errores, tr.archivadas, props.PORTAL_ULTIMA_CONSULTA], [true, [], 2, CM.hasta]);
mm = movsDe(c2.oc);
assert.deepEqual(mm.map(r => archivos[r[fc]].nombre), [mm[0][0] + ' — r1.jpg', mm[0][0] + ' — r2.jpg']);
// Llegó a Drive pero el aviso de archivada falla: no se baja otra vez, solo se vuelve a avisar
const c3 = siempre(P1, true, 'Querétaro');
CM.fotos['F-Y1'] = JPEG_CM;
CM.recepciones = [{ oc_folio: c3.oc, req_folio: c3.req, sitio: 'QRO', completa: false, recibio: 'jesusr', cuando: new Date().toISOString(), renglones: [
  { n: 1, pedido: 80, recibido: 40, foto: { id: 'F-Y1', archivada: false, url: '' } }] }];
CM.modoArchivo = '500';
como(null);
tr = plain(P.traerRecepcionesPortal());
assert.deepEqual([tr.parciales, tr.archivadas, tr.errores.length], [[c3.req], 0, 1]);
const getsY = CM.gets.filter(x => x === 'F-Y1').length;
CM.modoArchivo = 'ok';
como(null);
tr = plain(P.traerRecepcionesPortal());
assert.deepEqual([tr.archivadas, CM.gets.filter(x => x === 'F-Y1').length, CM.archivadas['F-Y1'] === 'https://drive/file/' + movsDe(c3.oc)[0][fc]], [1, getsY, true]);
assert.equal(archivos[movsDe(c3.oc)[0][fc]] && archivos[movsDe(c3.oc)[0][fc]].nombre, movsDe(c3.oc)[0][0] + ' — r1.jpg');
// Foto que ya no existe (404): no es error
CM.recepciones = [{ oc_folio: c3.oc, req_folio: c3.req, sitio: 'QRO', completa: false, recibio: 'jesusr', cuando: new Date().toISOString(), renglones: [
  { n: 1, pedido: 80, recibido: 40, foto: { id: 'F-NO', archivada: false, url: '' } }] }];
como(null);
tr = plain(P.traerRecepcionesPortal());
assert.deepEqual([tr.ok, tr.errores, tr.fotosPerdidas], [true, [], ['F-NO']]);
// Problema del sitio sin foto (faltante): una sola DEV por comentario aunque llegue dos veces; requisición cerrada (≤ 30 días)
const nDevs = devs().length;
CM.recepciones = [{ oc_folio: c2.oc, req_folio: c2.req, sitio: 'VER', completa: true, recibio: 'alan', cuando: new Date().toISOString(), renglones: [
  { n: 2, pedido: 12, recibido: 12, foto: { id: 'F-X2', archivada: true, url: 'https://drive/file/x' }, problema: { tipo: 'Faltante', comentario: 'Faltó un tubo', cantidad: 1, foto: null } }] }];
como(null); P.traerRecepcionesPortal();
como(null); P.traerRecepcionesPortal();
assert.equal(devs().length, nDevs + 1, 'una sola DEV por problema');
assert.deepEqual(devs().slice(-1).map(r => [r[2], r[8], r[12], r[13], r[10]].join('|')), [c2.req + '|Faltante|Centro de mando|alan|']);
assert.equal(ok('pedro', 'getRequisicion', c2.req).requisicion.estado, 'Cerrada', 'una cerrada sigue cerrada; la DEV la resuelve compras');
// Faltante reportado en el sitio (allá no se contó): "Devolver al proveedor" solo acepta el faltante y la requisición se completa
const c4 = siempre(P1, true, 'Querétaro');
CM.fotos['F-Z1'] = JPEG_CM; CM.fotos['F-Z2'] = JPEG_CM;
CM.recepciones = [{ oc_folio: c4.oc, req_folio: c4.req, sitio: 'QRO', completa: false, recibio: 'jesusr', cuando: new Date().toISOString(), renglones: [
  { n: 1, pedido: 80, recibido: 70, foto: { id: 'F-Z1', archivada: false, url: '' }, problema: { tipo: 'Faltante', comentario: 'Faltaron 10 m', cantidad: 10, foto: null } },
  { n: 2, pedido: 12, recibido: 12, foto: { id: 'F-Z2', archivada: false, url: '' }, problema: null }] }];
como(null);
tr = plain(P.traerRecepcionesPortal());
assert.deepEqual([tr.ok, tr.parciales, tr.devoluciones.length, tr.archivadas], [true, [c4.req], 1, 2]);
const d4f = tr.devoluciones[0];
assert.deepEqual(devs().find(r => r[0] === d4f).slice(7, 9), [10, 'Faltante'], 'la cantidad del faltante no se recorta a lo recibido');
CM.eventos = {};
rs = ok('pedro', 'resolverDevolucion', d4f, { resolucion: 'Devolver al proveedor', nota: 'Nota de crédito NC-9' });
assert.deepEqual(movsDe(c4.oc).slice(-1).map(r => r[3] + ':' + r[12]), ['Faltante aceptado:10'], 'no descuenta lo recibido; ya no se espera');
assert.deepEqual([rs.estado, rs.vista.requisicion.estado, rs.vista.orden.estado, rs.vista.avance[0].faltante, rs.vista.avance[0].recibido],
  ['Cerrada', 'Cerrada', 'Recibida', 10, 70], 'lo último que faltaba ya no se espera: se cierra');
assert(/Recepción completa: ya no se espera lo que faltaba/.test(rs.vista.eventos.slice(-1)[0].nota));
assert.deepEqual(Object.values(CM.eventos).filter(e => e.tipo === 'oc.devolucion').map(e => e.devolucion.tipo + ':' + e.devolucion.resolucion),
  ['Faltante:Devolver al proveedor']);
// Orden cancelada con fotos sin archivar: se archivan igual (si no, el centro de mando las vuelve a ofrecer siempre)
const c5 = siempre(P1, false, 'Querétaro');
CM.recepciones = [];
ok('pedro', 'cancelarOrdenCompra', c5.oc, 'El proveedor no surtió');
CM.fotos['F-H1'] = JPEG_CM;
CM.recepciones = [{ oc_folio: c5.oc, req_folio: c5.req, sitio: 'QRO', completa: false, recibio: 'jesusr', cuando: new Date().toISOString(), renglones: [
  { n: 1, pedido: 80, recibido: 5, foto: { id: 'F-H1', archivada: false, url: '' }, problema: { tipo: 'Dañado', comentario: 'Golpeado', cantidad: 1, foto: null } }] }];
const nDevs2 = devs().length;
como(null);
tr = plain(P.traerRecepcionesPortal());
assert.deepEqual([tr.ok, tr.archivadas, !!CM.archivadas['F-H1'], devs().length], [true, 1, true, nDevs2], 'se archiva; sin DEV de una orden cancelada');
assert(tr.ignoradas.some(x => x === c5.oc + ' (cancelada)'));
// Un "Reponer" cuyo aviso no ha llegado al centro de mando: lo que mande antes de recibirlo no se copia en ese renglón
const c6 = siempre(P1, true, 'Querétaro');
CM.recepciones = [{ oc_folio: c6.oc, req_folio: c6.req, sitio: 'QRO', completa: true, recibio: 'jesusr', cuando: new Date(Date.now() - 60000).toISOString(), renglones: [
  { n: 1, pedido: 80, recibido: 80, foto: null }, { n: 2, pedido: 12, recibido: 12, foto: null }] }];
como(null); P.traerRecepcionesPortal();
assert.equal(ok('pedro', 'getRequisicion', c6.req).requisicion.estado, 'Cerrada');
const d6 = ok('pedro', 'reportarProblema', c6.req, { renglon: 1, cantidad: 10, tipo: 'Dañado', comentario: 'Rollo aplastado', foto: F, idSolicitud: id('d') }).folio;
CM.modoEvento = '500';
rs = ok('pedro', 'resolverDevolucion', d6, { resolucion: 'Reponer' });
assert.deepEqual([rs.vista.requisicion.estado, rs.avisoPortal], ['Pagada', 'Guardado. El centro de mando se actualizará en unos minutos.']);
CM.modoEvento = 'ok';
CM.recepciones = [{ oc_folio: c6.oc, req_folio: c6.req, sitio: 'QRO', completa: true, recibio: 'jesusr', cuando: new Date(Date.now() + 600000).toISOString(), renglones: [
  { n: 1, pedido: 80, recibido: 80, foto: null }, { n: 2, pedido: 12, recibido: 12, foto: null }] }];
como(null);
tr = plain(P.traerRecepcionesPortal());
assert.deepEqual([tr.cerradas, movsDe(c6.oc).filter(r => r[3] === 'Entrada por compra').length, ok('pedro', 'getRequisicion', c6.req).requisicion.estado],
  [[], 2, 'Pagada'], 'su "recibido" todavía no baja: no es la reposición');

// Proyecto sin ligar (con el enlace encendido): resolver no avisa al centro de mando
const s4 = siempre(P2, true);
ok('obrero', 'cerrarRequisicion', s4.req, '', FOTOS);
const d4 = ok('obrero', 'reportarProblema', s4.req, { renglon: 2, cantidad: 1, tipo: 'Dañado', comentario: 'Tubo doblado', foto: F, idSolicitud: id('d') }).folio;
const eventosAntes = Object.keys(CM.eventos).length;
ok('pedro', 'resolverDevolucion', d4, { resolucion: 'Reponer' });
assert.equal(Object.keys(CM.eventos).length, eventosAntes, 'sin ligar: ningún aviso');
// Sincronizar manda la lista de devoluciones abierta en Compras cuando cambió algo
const sinc = ok('pedro', 'sincronizar', { requisiciones: 0 }, { devoluciones: { estado: 'Abierta' } });
assert(Array.isArray(sinc.devoluciones));
assert.equal(ok('obrero', 'sincronizar', { requisiciones: 0 }, { devoluciones: { estado: 'Abierta' } }).devoluciones, undefined, 'solo compras');

// ================= Interfaz (mod-recepcion sobre la app, conectada al servidor simulado de arriba) =================
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(dir, 'web/cotizador/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?: id="([^"]*)")?>([\s\S]*?)<\/script>/g)].map(m => ({ id: m[1], src: m[2] }));
const fuente = n => scripts.find(s => s.id === n).src;
const modRec = fuente('mod-recepcion');
assert(/accept="image\/\*" capture="environment"/.test(modRec), 'la foto se toma con la cámara trasera');
assert(/LADO_MAX = 1600, CALIDAD = 0\.72/.test(modRec) && /toDataURL\('image\/jpeg', CALIDAD\)/.test(modRec), 'comprimir: 1600 px, JPEG 0.72');
function montar(quien, permisos) {
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
  const almacen = { cotizadorHelgenSesion: token }, llamadas = [];
  // Todo va al servidor simulado como esta persona; la carga inicial también
  async function fetch(url, o) {
    const c = JSON.parse(o.body); llamadas.push(c);
    const datos = c.funcion === 'sincronizar' ? { ok: true, datos: { versiones: {}, permisos: permisos, soloRequisicion: false, cambios: [] } } : A.post(quien, c.funcion, ...c.args);
    return { ok: true, json: async () => datos };
  }
  class FileReader { readAsDataURL(f) { this.result = 'data:' + f.type + ';base64,' + f.b64; setImmediate(() => this.onload()); } }
  const dialogos = { confirmar: true };
  const ctx = { document, fetch, console, JSON, Date, Math, Number, String, Array, Object, Promise, Proxy, Error, Uint8Array, TextDecoder, FileReader,
    atob: s => Buffer.from(s, 'base64').toString('binary'), crypto: { randomUUID: () => 'id-' + Math.random() },
    sessionStorage: { getItem: k => almacen[k] ?? null, setItem: (k, v) => almacen[k] = v, removeItem: k => delete almacen[k] },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, confirm: () => dialogos.confirmar, prompt: () => null,
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout, clearTimeout, setInterval: () => 0, scrollTo() {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['api-web', undefined, 'mod-centro', 'mod-recepcion'].forEach(n => vm.runInContext(scripts.find(s => s.id === n).src, ctx));
  return { ctx, $: id => document.getElementById(id), llamadas, dialogos, run: c => vm.runInContext(c, ctx) };
}
const esperar = async (k = 20) => { for (let i = 0; i < k; i++) await new Promise(r => setImmediate(r)); };
const archivo = n => ({ name: n || 'IMG_0001.HEIC', type: 'image/jpeg', size: 2048, b64: FOTO });
(async () => {
  // ---- Quien pidió: "Recibí el material" con una foto por renglón ----
  const s5 = siempre(P2, true), s6 = siempre(P2, true);
  const U = montar('obrero', { requisicion: true, compras: false, ventas: true, superadmin: false });
  await esperar();
  const { $ } = U;
  U.run('pintarMisReq(' + JSON.stringify(ok('obrero', 'misRequisiciones')) + ')');
  assert(/recibiMaterial\('REQ-/.test($('reqLista').innerHTML), 'botón "Recibí el material"');
  U.run("recibiMaterial('" + s5.req + "')");
  const p = 'rcp-' + s5.req.replace(/[^A-Za-z0-9]/g, '');
  let forma = $('rcpCaja-' + s5.req).innerHTML;
  assert(/Recibí el material/.test(forma) && new RegExp('id="' + p + 'F1" type="file" accept="image/\\*" capture="environment"').test(forma) &&
    new RegExp('id="' + p + 'F2"').test(forma) && /Problema/.test(forma), 'una foto por renglón y "Problema"');
  assert.equal(U.run('REC_ABIERTA'), s5.req, 'la sincronización no borra lo capturado');
  $(p + 'F1').files = [archivo()];
  U.run("enviarRecepcion('" + p + "')");
  await esperar();
  assert(/Falta la foto de &quot;Tubo conduit 3\/4&quot;|Falta la foto de "Tubo conduit 3\/4"/.test($('aviso').innerHTML), $('aviso').innerHTML);
  assert(!U.llamadas.some(c => c.funcion === 'cerrarRequisicion'), 'sin todas las fotos no se manda');
  $(p + 'F2').files = [archivo('tubo.png')];
  U.run("enviarRecepcion('" + p + "')");
  await esperar();
  const cierre = U.llamadas.find(c => c.funcion === 'cerrarRequisicion');
  assert.deepEqual([cierre.args[0], cierre.args[1], cierre.args[2].renglones.map(r => r.renglon + ':' + r.foto.mime + ':' + r.foto.nombre)],
    [s5.req, '', ['1:image/jpeg:IMG_0001.HEIC', '2:image/jpeg:tubo.png']]);
  assert.equal(cierre.args[2].renglones[0].foto.datos, FOTO, 'base64 sin prefijo');
  assert(/cerrada: material recibido/.test($('aviso').innerHTML), $('aviso').innerHTML);
  assert.equal(mia('obrero', s5.req).estado, 'Cerrada');
  // ---- Reportar problema después ----
  assert(/RECEPCION\.abrirReporte\('REQ-/.test($('devCaja-' + s5.req).innerHTML), '"Reportar problema" en lo recibido');
  U.run("RECEPCION.abrirReporte('" + s5.req + "','req')");
  const k = 'dvrreq' + s5.req.replace(/[^A-Za-z0-9]/g, '');
  assert(/Reportar problema/.test($('devForm-' + s5.req).innerHTML) && /recibido sin reportar: 80 M/.test($('devForm-' + s5.req).innerHTML));
  $(k + 'R').value = '1'; $(k + 'T').value = 'Dañado'; $(k + 'K').value = '5'; $(k + 'C').value = 'Rollo aplastado';
  U.run('RECEPCION.enviarReporte()');
  await esperar();
  assert(/Toma una foto del problema/.test($('aviso').innerHTML) && !U.llamadas.some(c => c.funcion === 'reportarProblema'));
  $(k + 'F').files = [archivo()];
  U.run('RECEPCION.enviarReporte()');
  await esperar();
  const rep = U.llamadas.find(c => c.funcion === 'reportarProblema');
  assert.deepEqual([rep.args[0], rep.args[1].renglon, rep.args[1].tipo, rep.args[1].cantidad, rep.args[1].comentario, rep.args[1].foto.mime],
    [s5.req, 1, 'Dañado', '5', 'Rollo aplastado', 'image/jpeg']);
  const devUi = /devolución <b>(DEV-\d{4}-\d{4})<\/b>/.exec($('aviso').innerHTML)[1];
  assert(new RegExp(devUi + '</b> · Dañado · 5 de Cable THW 10').test($('devCaja-' + s5.req).innerHTML), $('devCaja-' + s5.req).innerHTML);
  // ---- "Lo recogí": una foto por renglón ----
  U.run('pintarMisReq(' + JSON.stringify(ok('obrero', 'misRequisiciones')) + ')');
  U.run("centroRecogi('" + s6.req + "')");
  const q = 'rcp-' + s6.req.replace(/[^A-Za-z0-9]/g, '');
  assert(/Lo recogí/.test($('rcpCaja-' + s6.req).innerHTML) && !/Problema<\/button>/.test($('rcpCaja-' + s6.req).innerHTML));
  $(q + 'F1').files = [archivo()]; $(q + 'F2').files = [archivo()];
  U.run("enviarRecepcion('" + q + "')");
  await esperar();
  const enc = U.llamadas.find(c => c.funcion === 'marcarEnCamino');
  assert.deepEqual([enc.args[0], enc.args[1].recogido, enc.args[1].renglones.length], [s6.req, true, 2]);
  assert.equal(mia('obrero', s6.req).estado, 'En camino');

  // ---- Compras: fotos, devoluciones de la requisición y resolver; la lista de devoluciones ----
  const C = montar('pedro', { compras: true, requisicion: true, ventas: true, superadmin: false });
  await esperar();
  C.run('aplicarPermisos(' + JSON.stringify({ compras: true, requisicion: true, ventas: true, superadmin: false }) + ', false)');
  assert(!C.$('comModDevoluciones').classList.contains('oculto'), 'compras ve la lista de devoluciones');
  C.$('devEstado').value = 'Abierta'; // la primera opción del select
  C.run("RECEPCION.cargarDevoluciones()");
  await esperar();
  assert(new RegExp(devUi).test(C.$('devLista').innerHTML) && /RECEPCION\.abrirResolver/.test(C.$('devLista').innerHTML));
  C.run('abrirReqCom(' + JSON.stringify(s5.req) + ')');
  await esperar();
  const caja = C.$('rcDevoluciones');
  assert(!caja.classList.contains('oculto') && /Fotos de lo que llegó/.test(caja.innerHTML) && /Ver foto/.test(caja.innerHTML) && new RegExp(devUi).test(caja.innerHTML));
  C.run("RECEPCION.abrirResolver('" + devUi + "','com')");
  const kr = 'dvscom' + devUi.replace(/[^A-Za-z0-9]/g, '');
  assert(/Resolver DEV-/.test(C.$('rcDevResolver').innerHTML) && /Rollo aplastado/.test(C.$('rcDevResolver').innerHTML));
  C.$(kr + 'Res').value = 'Devolver al proveedor';
  C.run('RECEPCION.resolver()');
  assert(/nota de la devolución/.test(C.$('aviso').innerHTML), 'devolver pide nota');
  C.$(kr + 'Res').value = 'Conservar';
  C.run('RECEPCION.resolver()');
  await esperar();
  const res = C.llamadas.find(c => c.funcion === 'resolverDevolucion');
  assert.deepEqual([res.args[0], res.args[1].resolucion], [devUi, 'Conservar']);
  assert(/resuelta: Conservar/.test(C.$('aviso').innerHTML), C.$('aviso').innerHTML);
  assert(!new RegExp(devUi).test(C.$('devLista').innerHTML), 'sale de las abiertas');
  console.log('OK recepción con fotos y devoluciones');
})().catch(e => { console.error(e); process.exit(1); });
