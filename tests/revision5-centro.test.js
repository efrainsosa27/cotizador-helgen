// Incremento 5 · revisión 5b (29/10/2026): contrato con el centro de mando, del lado de CAPRI, con el centro de mando simulado
// (firmas HMAC como en recepcion.test.js). Cada sección fallaba antes de su arreglo:
//  B. oc.devolucion lleva devolucion.origen ('centro' si el problema se reportó en el sitio, 'capri' si aquí); la DEV de un
//     problema del sitio usa problema.por como quien reportó (y, si no viene, quien recibió).
//  C. La reposición recibida en el centro de mando en el mismo minuto que "Reponer" sí se cuenta (antes: minuto y <=).
//  D. Fotos que CAPRI no puede ligar (orden que no existe, anulada o de un proyecto no ligado) se archivan igual (privadas) y se
//     avisa foto-archivada: antes el centro de mando las ofrecía para siempre.
// Uso: node tests/revision5-centro.test.js .
'use strict';
const assert = require('assert'), crypto = require('crypto');
const dir = process.argv[2] || '.';
const ANIO = String(new Date().getFullYear());
const SECRETO = 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00';
const P1 = 'PRY-' + ANIO + '-0001'; // ligado al centro de mando
const JPEG_CM = Buffer.from([0xFF, 0xD8, 0xFF, 0xE1, 9, 9, 9, 9]);
const CM = { eventos: {}, recepciones: [], fotos: {}, archivadas: {}, gets: [], posts: [], rechazos: [] };
function verificar(op, cuerpo) {
  const h = (op && op.headers) || {}, t = h['X-Hbox-Tiempo'], f = h['X-Hbox-Firma'];
  if (!t || !f) return 'sin firma';
  if (Math.abs(Date.now() - Date.parse(t)) > 5 * 60000) return 'firma vencida';
  return f === 'sha256=' + crypto.createHmac('sha256', SECRETO).update(t + '\n' + cuerpo, 'utf8').digest('hex') ? '' : 'firma inválida';
}
const rutas = [
  { re: /^https:\/\/drogheda\.test\/api\/integracion\/cotizador\/evento$/, fn: (url, op) => {
    const cuerpo = String(op.payload || ''), e = verificar(op, cuerpo);
    if (e) { CM.rechazos.push(e); return { codigo: 401, cuerpo: { ok: false, error: e } }; }
    const ev = JSON.parse(cuerpo);
    CM.eventos[ev.evento_id] = ev;
    return { codigo: 200, cuerpo: { ok: true } };
  } },
  { re: /^https:\/\/drogheda\.test\/api\/integracion\/cotizador\/recepciones\?desde=/, fn: (url, op) => {
    const e = verificar(op, '');
    if (e) return { codigo: 401, cuerpo: { ok: false, error: e } };
    return { codigo: 200, cuerpo: { ok: true, hasta: new Date().toISOString(), recepciones: CM.recepciones } };
  } },
  { re: /^https:\/\/drogheda\.test\/api\/integracion\/cotizador\/foto\?id=/, fn: (url, op) => {
    const e = verificar(op, '');
    if (e) { CM.rechazos.push(e); return { codigo: 401, cuerpo: { ok: false, error: e } }; }
    const fid = decodeURIComponent(url.split('id=')[1]);
    CM.gets.push(fid);
    if (!CM.fotos[fid] || CM.archivadas[fid]) return { codigo: 404, cuerpo: { ok: false, error: 'no existe' } };
    return { codigo: 200, cuerpo: CM.fotos[fid] };
  } },
  { re: /^https:\/\/drogheda\.test\/api\/integracion\/cotizador\/foto-archivada$/, fn: (url, op) => {
    const cuerpo = String(op.payload || ''), e = verificar(op, cuerpo);
    if (e) { CM.rechazos.push(e); return { codigo: 401, cuerpo: { ok: false, error: e } }; }
    const b = JSON.parse(cuerpo);
    CM.posts.push(b);
    CM.archivadas[b.id] = b.url;
    return { codigo: 200, cuerpo: { ok: true } };
  } },
  { re: /^https:\/\/drogheda\.test\/api\/integracion\/inventario\/items$/, fn: () => ({ codigo: 200, cuerpo: { ok: true, items: [] } }) },
];
const A = require('./arnes')(dir, { rutas, props: {
  ROL_COMPRAS: 'efrain@helgen.tech, pedro@helgen.tech', ROL_REQUISICION: 'obrero@helgen.tech, efrain@helgen.tech, pedro@helgen.tech',
  ROL_OPERACIONES: '', PORTAL_URL: 'https://drogheda.test', PORTAL_SECRETO: SECRETO, PORTAL_PROYECTOS: JSON.stringify({ [P1]: 'drogheda' }) } });
const { P, ok, falla, props, HOY_ISO, masDias, como, correr, FOTO } = A;
A.libros.DB.pest.Config.m.push(['SITIOS', 'QRO | Querétaro\nZLO | Manzanillo (TIMSA)\nVER | Veracruz (ICAVE)']);
P.exigirDocumentosParaPagar_ = function () {};
let nId = 0;
const id = p => (p || 'x') + (++nId);
const F = { nombre: 'foto.jpg', datos: FOTO, mime: 'image/jpeg' };
assert.equal(ok('ana', 'crearProyecto', { nombre: 'DROGHEDA', ubicacion: 'Veracruz', cliente: { nombre: 'H', empresa: 'ICAVE' }, idSolicitud: 'p1' }).folio, P1);
const RENGLONES = [{ descripcion: 'Cable THW 10', cantidad: 80, unidad: 'm' }, { descripcion: 'Tubo conduit 3/4', cantidad: 12, unidad: 'pza' }];
const OCD = () => ({ proveedor: { razonSocial: 'Ferretera del Puerto' }, fechaEntrega: masDias(1), lugarEntrega: 'Querétaro', condicionesPago: 'Contado',
  diasCredito: 0, formaPago: 'Transferencia', idSolicitud: id('oc'), renglones: [{ descripcion: 'Cable THW 10', unidad: 'M', cantidad: 80, costo: 10 },
    { descripcion: 'Tubo conduit 3/4', unidad: 'PZA', cantidad: 12, costo: 50 }] });
function ligada() {
  const folio = ok('obrero', 'guardarRequisicion', { proyectoFolio: P1, sitio: 'Querétaro', renglones: RENGLONES,
    cotizacion: { nombre: 'cot.pdf', datos: A.PDF }, idSolicitud: id('q') }).folio;
  const oc = ok('efrain', 'autorizarRequisicion', folio, OCD()).ocFolio;
  ok('efrain', 'registrarPagoProveedor', { reqFolio: folio, fecha: HOY_ISO, monto: 1624, monedaPago: 'MXN', metodo: 'Transferencia', referencia: 'SPEI ' + id(),
    comprobante: { nombre: 'c.pdf', datos: A.PDF }, idSolicitud: id('pg') });
  return { req: folio, oc: oc };
}
const LC = () => A.libros[props.COMPRAS_DB_ID];
const H = n => LC().pest[n].m;
const devs = () => H('Devoluciones').slice(1);
const traer = () => { como(null); const r = A.plain(P.traerRecepcionesPortal()); correr('MEMO_ = {};'); return r; };
const eventos = tipo => Object.values(CM.eventos).filter(e => e.tipo === tipo);

// ================= B. origen en oc.devolucion y problema.por =================
{
  const c = ligada();
  CM.fotos['B-P1'] = JPEG_CM;
  CM.recepciones = [{ oc_folio: c.oc, req_folio: c.req, sitio: 'QRO', completa: true, recibio: 'jesusr', cuando: new Date(Date.now() - 60000).toISOString(),
    renglones: [{ n: 1, pedido: 80, recibido: 80, foto: null,
      problema: { tipo: 'Dañado', comentario: 'Rollo aplastado', cantidad: 5, por: 'miguel', foto: { id: 'B-P1', archivada: false, url: '' } } },
    { n: 2, pedido: 12, recibido: 12, foto: null, problema: { tipo: 'Faltante', comentario: 'Faltó un tubo', cantidad: 1 } }] }];
  const tr = traer();
  assert.equal(tr.devoluciones.length, 2, JSON.stringify(tr));
  const [dSitioPor, dSitioSinPor] = tr.devoluciones.map(f => devs().find(r => r[0] === f));
  assert.equal(dSitioPor[13], 'miguel', 'reportó = problema.por');
  assert.equal(dSitioSinPor[13], 'jesusr', 'sin problema.por: quien recibió');
  // Al resolver: origen 'centro' (problema del sitio, con origen_clave)
  CM.eventos = {};
  ok('pedro', 'resolverDevolucion', dSitioPor[0], { resolucion: 'Conservar' });
  assert.deepEqual(eventos('oc.devolucion').map(e => e.devolucion.folio + ':' + e.devolucion.origen), [dSitioPor[0] + ':centro']);
  // Un Faltante reportado en CAPRI (se registró como recibido): origen 'capri' (el centro de mando lo saca de su stock)
  CM.recepciones = [];
  ok('obrero', 'reportarProblema', c.req, { renglon: 1, cantidad: 3, tipo: 'Faltante', comentario: 'Se contaron 77, no 80', idSolicitud: id('d') });
  const dCapri = devs().slice(-1)[0];
  assert.deepEqual([dCapri[12], dCapri[20]], ['CAPRI', ''], 'reportada en CAPRI, sin origen_clave');
  CM.eventos = {};
  ok('pedro', 'resolverDevolucion', dCapri[0], { resolucion: 'Devolver al proveedor', nota: 'Nota de crédito NC-1' });
  const ev = eventos('oc.devolucion');
  assert.deepEqual(ev.map(e => [e.devolucion.tipo, e.devolucion.resolucion, e.devolucion.origen].join(':')), ['Faltante:Devolver al proveedor:capri']);
  assert.deepEqual(Object.keys(ev[0].devolucion).sort(), ['cantidad', 'folio', 'nota', 'origen', 'renglon', 'resolucion', 'tipo']);
  assert.equal(P.cuerpoEventoPortal('oc.devolucion', 1, { orden: { folio: 'OC-1', renglones: [] }, devolucion: { folio: 'D' } }).devolucion.origen, 'centro',
    'sin origen: centro (lo de siempre)');
}

// ================= C. Reposición recibida en el mismo minuto que "Reponer" =================
{
  const c = ligada();
  const mov = () => H('MovimientosInventario').filter(r => r[7] === c.oc);
  CM.recepciones = [{ oc_folio: c.oc, req_folio: c.req, sitio: 'QRO', completa: true, recibio: 'jesusr', cuando: new Date(Date.now() - 600000).toISOString(),
    renglones: [{ n: 1, pedido: 80, recibido: 80, foto: null }, { n: 2, pedido: 12, recibido: 12, foto: null }] }];
  assert.deepEqual(traer().cerradas, [c.req]);
  ok('obrero', 'reportarProblema', c.req, { renglon: 1, cantidad: 10, tipo: 'Dañado', comentario: 'Rollo aplastado', foto: F, idSolicitud: id('d') });
  const dev = devs().slice(-1)[0][0];
  CM.eventos = {};
  assert.equal(ok('pedro', 'resolverDevolucion', dev, { resolucion: 'Reponer' }).estado, 'Pagada');
  assert.equal(eventos('oc.devolucion').length, 1, 'el centro de mando ya recibió el aviso');
  // "Reponer" a las HH:MM:10 y la reposición llega a las HH:MM:40 del mismo minuto (como lo guarda Sheets: texto en la DEV y
  // Date en el movimiento)
  const base = new Date(); base.setSeconds(10, 0);
  const p2 = n => String(n).padStart(2, '0');
  const texto = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  devs().find(r => r[0] === dev)[19] = texto(base);
  mov().find(r => r[0] === dev)[2] = new Date(base);
  CM.recepciones = [{ oc_folio: c.oc, req_folio: c.req, sitio: 'QRO', completa: true, recibio: 'jesusr', cuando: new Date(base.getTime() + 30000).toISOString(),
    renglones: [{ n: 1, pedido: 80, recibido: 80, foto: null }, { n: 2, pedido: 12, recibido: 12, foto: null }] }];
  const tr = traer();
  assert.deepEqual(mov().filter(r => r[3] === 'Entrada por compra').map(r => r[8] + ':' + r[12]), ['1:80', '2:12', '1:10'], 'la reposición se cuenta');
  assert.deepEqual([tr.cerradas, ok('pedro', 'getRequisicion', c.req).requisicion.estado], [[c.req], 'Cerrada']);
  // La recepción de antes de "Reponer" (un segundo antes) sigue sin contarse otra vez
  assert.equal(P.recepcionAntesDeReponer_([{ tipo: 'Devolución', estado: 'Vigente', renglon: 1, folio: 'DEV-1', fechaRegistro: '' }],
    new Date(base.getTime() - 1000).toISOString(), false, { 'DEV-1': texto(base) })(1), true);
  assert.equal(P.recepcionAntesDeReponer_([{ tipo: 'Devolución', estado: 'Vigente', renglon: 1, folio: 'DEV-1', fechaRegistro: '' }],
    new Date(base.getTime() + 1000).toISOString(), false, { 'DEV-1': texto(base) })(1), false);
}

// ================= D. Fotos sin dónde ligarse =================
{
  props.SUPER_ADMIN = 'leo@helgen.tech';
  P.prepararCapri();
  correr(`enviarCorreosPendientes_ = function () { MEMO_.correos = []; };`);
  const archivo = idFoto => A.archivos[(A.archivos && Object.keys(A.archivos).find(k => A.archivos[k].blob && CM.archivadas[idFoto] &&
    CM.archivadas[idFoto].indexOf(k) !== -1)) || ''];
  const ruta = a => { const r = []; for (let f = a && a.padre; f; f = f.padre) r.unshift(f.nombre); return r.join('/'); };
  // D1. Orden que CAPRI no conoce
  CM.fotos['D-X1'] = JPEG_CM;
  CM.recepciones = [{ oc_folio: 'OC-' + ANIO + '-9999', req_folio: 'REQ-' + ANIO + '-9999', sitio: 'QRO', completa: true, recibio: 'jesusr',
    cuando: new Date().toISOString(), renglones: [{ n: 1, pedido: 5, recibido: 5, foto: { id: 'D-X1', archivada: false, url: '' } }] }];
  let tr = traer();
  assert(CM.archivadas['D-X1'], 'orden desconocida: se avisa archivada ' + JSON.stringify(tr));
  let a = archivo('D-X1');
  assert(a && /Cotizador Helgen — Compras\/\d{4}\/_sin-orden$/.test(ruta(a)) && a.acceso === 'PRIVATE', 'Compras/AAAA/_sin-orden, privada: ' + ruta(a));
  assert(a.padre.acceso === 'PRIVATE', 'la carpeta _sin-orden también');
  // D2. Orden anulada
  const c = ligada();
  ok('leo', 'anular', c.oc, 'Orden emitida al proveedor equivocado', id('an'));
  CM.fotos['D-A1'] = JPEG_CM;
  CM.recepciones = [{ oc_folio: c.oc, req_folio: c.req, sitio: 'QRO', completa: false, recibio: 'jesusr', cuando: new Date().toISOString(),
    renglones: [{ n: 1, pedido: 80, recibido: 3, foto: { id: 'D-A1', archivada: false, url: '' } }] }];
  tr = traer();
  assert(CM.archivadas['D-A1'], 'orden anulada: se avisa archivada ' + JSON.stringify(tr));
  a = archivo('D-A1');
  assert(a && new RegExp('/' + P1 + '/Recepciones$').test(ruta(a)) && a.acceso === 'PRIVATE', 'Recepciones del proyecto: ' + ruta(a));
  // D3. Orden de un proyecto que no está ligado al centro de mando
  const P2 = ok('ana', 'crearProyecto', { nombre: 'Casa del Lago', ubicacion: 'Qro', cliente: { nombre: 'Luis', empresa: 'S' }, idSolicitud: 'p2' }).folio;
  const r2 = ok('obrero', 'guardarRequisicion', { proyectoFolio: P2, sitio: 'Querétaro', renglones: RENGLONES, cotizacion: { nombre: 'c.pdf', datos: A.PDF }, idSolicitud: id('q') }).folio;
  const oc2 = ok('efrain', 'autorizarRequisicion', r2, OCD()).ocFolio;
  CM.fotos['D-N1'] = JPEG_CM;
  CM.recepciones = [{ oc_folio: oc2, req_folio: r2, sitio: 'QRO', completa: false, recibio: 'jesusr', cuando: new Date().toISOString(),
    renglones: [{ n: 1, pedido: 80, recibido: 3, foto: { id: 'D-N1', archivada: false, url: '' } }] }];
  tr = traer();
  assert(CM.archivadas['D-N1'], 'proyecto no ligado: se avisa archivada ' + JSON.stringify(tr));
  a = archivo('D-N1');
  assert(a && new RegExp('/' + P2 + '/Recepciones$').test(ruta(a)) && a.acceso === 'PRIVATE', ruta(a));
  assert.equal(H('MovimientosInventario').filter(r => r[7] === oc2).length, 0, 'la recepción se sigue ignorando (no entra a CAPRI)');
  // La siguiente consulta ya no las baja otra vez (el centro de mando las marcó archivadas)
  const gets = CM.gets.length;
  CM.recepciones.forEach(x => x.renglones.forEach(l => { l.foto.archivada = true; l.foto.url = CM.archivadas[l.foto.id]; }));
  traer();
  assert.equal(CM.gets.length, gets);
}

console.log('revision5-centro: ok');
