// Perfil de rapidez de CAPRI (docs/rapidez-apps-script.md). Siembra datos parecidos a los reales por doPost con el arnés y
// mide, por escenario, cuántas operaciones hace cada llamada con los servicios de Google (lecturas y escrituras de Sheets con
// su tamaño, getDataRange, getLastRow, abrir libros, Drive, Cache, Properties, candado, UrlFetch, correo y PDF), cuántas
// de ellas con el candado tomado y el tamaño del JSON de la respuesta; estima el tiempo en vivo con pesos por operación.
// No es una prueba (todas.sh no la corre): es la medición de antes y después.
// Uso: node tests/perfil.js . [--json salida.json] [--comparar antes.json] [--detalle "texto del escenario"]
'use strict';
const assert = require('assert'), fs = require('fs');
const argv = process.argv.slice(2);
const dir = argv[0] && !argv[0].startsWith('--') ? argv[0] : '.';
const opcion = n => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };

// ---- Pesos (segundos por operación). Los cinco primeros los dio Leo (medidos el 23–28/10); los demás son supuestos ----
const PESOS = { lee: 0.5, escribe: 0.3, driveCrea: 1.5, cache: 0.02, props: 0.05, candado: 0,
  ultimaFila: 0.1, dataRange: 0.1, abrir: 0.1, formato: 0.1, drive: 0.3, urlfetch: 0.3, correo: 0.5, pdf: 4 };
const FIJO = 1.7; // redirección de Google + arranque del script: no depende del código
const TIPOS = Object.keys(PESOS);

const ANIO = String(new Date().getFullYear());
const SECRETO = 'b1c2d3e4f5a6978877665544332211aabbccddeeff0011223344556677889900';
// Centro de mando simulado: acepta todo (los avisos son parte del costo real de autorizar y pagar en un proyecto ligado)
const rutas = [
  { re: /\/api\/integracion\/cotizador\/evento$/, fn: () => ({ codigo: 200, cuerpo: { ok: true } }) },
  { re: /\/api\/integracion\/cotizador\/recepciones\?desde=/, fn: () => ({ codigo: 200, cuerpo: { ok: true, hasta: new Date().toISOString(), recepciones: [] } }) },
  { re: /\/api\/integracion\/inventario\/items$/, fn: () => ({ codigo: 200, cuerpo: { ok: true, items: [{ codigo: 'CAB-10', descripcion: 'Cable THW 10', unidad: 'M' }] } }) },
];
const P1 = 'PRY-' + ANIO + '-0001'; // ligado al centro de mando
const A = require('./arnes')(dir, { perfil: true, rutas, props: {
  ROL_COMPRAS: 'pedro@helgen.tech', ROL_COBRANZA: 'efrain@helgen.tech', ROL_OPERACIONES: 'tania@helgen.tech',
  ROL_REQUISICION: 'obrero@helgen.tech, pedro@helgen.tech', SOLO_REQUISICION: 'rosa@helgen.tech, adri@helgen.tech',
  ADMIN_DESBLOQUEO: 'leo@helgen.tech', SUPER_ADMIN: 'leo@helgen.tech',
  PORTAL_URL: 'https://drogheda.test', PORTAL_SECRETO: SECRETO, PORTAL_PROYECTOS: JSON.stringify({ [P1]: 'drogheda' }) } });
const { P, post, HOY_ISO, masDias, perfil, FOTO } = A;
perfil.activo = false;
A.libros.DB.pest.Config.m.push(['SITIOS', 'QRO | Querétaro\nZLO | Manzanillo (TIMSA)\nVER | Veracruz (ICAVE)']);
const ok = (q, f, ...a) => { const r = post(q, f, ...a); assert(r.ok, f + ': ' + r.error); return r.datos; };
let nId = 0;
const id = p => (p || 'x') + (++nId);
const F = { nombre: 'foto.jpg', datos: FOTO, mime: 'image/jpeg' };
const PDF = A.PDF;

// ================= Datos (parecidos a los reales a fin de octubre de 2026) =================
P.prepararCapri();
// Catálogo de 120 productos
for (let i = 1; i <= 120; i++) A.libros.CAT.pest.Catalogo.m.push(['P-' + i, 'Producto de prueba ' + i, 'PZA', 100 + i, '', '', '', '']);
// 14 proyectos de 4 vendedores (P1 ligado al centro de mando)
const proyectos = [];
const VENDEDORES = ['ana', 'efrain', 'leo', 'obrero'];
for (let i = 0; i < 14; i++) {
  proyectos.push(ok(VENDEDORES[i % 4], 'crearProyecto', { nombre: i === 0 ? 'DROGHEDA' : 'Proyecto ' + i, ubicacion: 'Querétaro',
    cliente: { nombre: 'Cliente ' + (i % 6), empresa: 'Empresa ' + (i % 6) }, idSolicitud: id('p') }).folio);
}
assert.equal(proyectos[0], P1);
// 30 cotizaciones (2 por proyecto + sin proyecto); 4 contratos aceptados, 3 firmados con esquema y pagos de cobranza
const cots = [];
for (let i = 0; i < 30; i++) {
  cots.push(ok(VENDEDORES[i % 4], 'guardarCotizacion', { cliente: { nombre: 'Cliente ' + (i % 6), empresa: 'Empresa ' + (i % 6) },
    items: [{ descripcion: 'Servicio ' + i, cantidad: 2, precio: 1000 + i }, { descripcion: 'Material', cantidad: 5, precio: 300 }],
    proyectoFolio: i < 28 ? proyectos[i % 14] : '', idSolicitud: id('c') }).folio);
}
for (let i = 0; i < 4; i++) {
  ok('efrain', 'marcarAceptada', proyectos[i + 2], cots[i + 2]);
  if (i < 3) {
    ok('efrain', 'firmarContrato', proyectos[i + 2], HOY_ISO);
    for (let k = 0; k < 2; k++) ok('efrain', 'registrarPago', { proyectoFolio: proyectos[i + 2], fecha: HOY_ISO, monto: 500, metodo: 'Transferencia',
      referencia: 'SPEI ' + id(), etapaOrden: 1, comprobante: { datos: PDF }, idSolicitud: id('g') });
  }
}
// 6 proveedores con CSF y carátula (la transferencia los exige)
const CLABE = '032180000118359719';
const PROVS = [];
for (let i = 0; i < 6; i++) {
  const rfc = 'EDC20010' + i + 'AB' + i;
  ok('pedro', 'guardarProveedor', { razonSocial: 'Proveedor ' + i + ' SA de CV', rfc, correo: 'ventas' + i + '@prov.mx', contacto: 'Luis',
    telefono: '+52 442 111 2233', direccion: 'Av. 5 de Febrero ' + i, banco: 'BBVA México', clabe: CLABE, titular: 'Proveedor ' + i,
    formaPagoHabitual: 'Transferencia', diasCredito: '0', idSolicitud: id('pv'), documentos: {
      caratula: { nombre: 'caratula.pdf', datos: PDF, fecha: HOY_ISO }, csf: { nombre: 'csf.pdf', datos: PDF, fecha: masDias(-10) } } });
  PROVS.push({ razonSocial: 'Proveedor ' + i + ' SA de CV', rfc });
}
// Requisiciones con el flujo con aprobaciones (tania aprueba y da el visto bueno; pedro cotiza y paga; rosa recibe)
const RENGLONES = [{ descripcion: 'Cable THW 10', cantidad: 80, unidad: 'm' }, { descripcion: 'Tubo conduit 3/4', cantidad: 12, unidad: 'pza' },
  { descripcion: 'Caja registro', cantidad: 6, unidad: 'pza' }];
const SOLICITANTES = ['obrero', 'rosa', 'adri', 'pedro'];
const nuevaReq = (quien, proyecto) => ok(quien, 'guardarRequisicion', { proyectoFolio: proyecto, sitio: 'Querétaro', renglones: RENGLONES,
  cotizacion: { nombre: 'cot.pdf', datos: PDF }, idSolicitud: id('q') }).folio;
const aprobar = folio => { const v = ok('tania', 'getRequisicionOperaciones', folio);
  return ok('tania', 'aprobarRequisicion', folio, { version: v.version, prioridad: 'Normal', renglones: v.renglones.map(r => ({ renglon: r.renglon, aprobado: true })) }); };
const PROP = (n) => ({ proveedor: PROVS[n % PROVS.length], fechaEntrega: masDias(3), condicionesPago: 'Contado', diasCredito: 0,
  formaPago: 'Transferencia', recibe: 'rosa@helgen.tech', idSolicitud: id('pr'),
  renglones: [{ renglon: 1, disponibilidad: 'Exacto', costo: 10 }, { renglon: 2, disponibilidad: 'Exacto', costo: 50 }, { renglon: 3, disponibilidad: 'Exacto', costo: 35 }] });
const cotizar = (folio, n) => ok('pedro', 'cotizarRequisicion', folio, PROP(n));
const vistoBueno = folio => { const w = ok('tania', 'getRequisicionOperaciones', folio);
  return ok('tania', 'autorizarPropuesta', folio, w.propuesta.version, id('vb'), w.propuesta.huella).ocFolio; };
const TOTAL = 1867.6; // (800 + 600 + 210) × 1.16
const pagar = folio => ok('pedro', 'registrarPagoProveedor', { reqFolio: folio, fecha: HOY_ISO, monto: TOTAL, monedaPago: 'MXN', metodo: 'Transferencia',
  referencia: 'SPEI ' + id(), comprobante: { nombre: 'c.pdf', datos: PDF }, idSolicitud: id('pg') });
const recibir = folio => ok('rosa', 'registrarRecepcion', { reqFolio: folio, sitio: 'Querétaro', idSolicitud: id('r'),
  renglones: [{ renglon: 1, cantidad: 80, foto: F }, { renglon: 2, cantidad: 12, foto: F }, { renglon: 3, cantidad: 6, foto: F }] });
// Factura CFDI 4.0 del proveedor de la orden (RFC mexicano: se registra con el XML)
let nUuid = 0;
const cfdi = rfc => Buffer.from('\ufeff<?xml version="1.0" encoding="UTF-8"?>\n<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" ' +
  'Serie="A" Folio="' + (++nUuid) + '" Fecha="' + masDias(-2) + 'T10:00:00" SubTotal="1610.00" Moneda="MXN" Total="1867.60" TipoDeComprobante="I" ' +
  'MetodoPago="PUE" FormaPago="03"><cfdi:Emisor Rfc="' + rfc + '" Nombre="PROVEEDOR" RegimenFiscal="601"/><cfdi:Receptor Rfc="HSE240304PC1" ' +
  'Nombre="HELGEN" UsoCFDI="G03"/><cfdi:Impuestos TotalImpuestosTrasladados="257.60"/><cfdi:Complemento><tfd:TimbreFiscalDigital ' +
  'xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="6F1C5E2A-3B4D-4C5E-9F60-' + String(nUuid).padStart(12, '0') + '"/></cfdi:Complemento></cfdi:Comprobante>',
'utf8').toString('base64');
const rfcDeOc = oc => { const L = A.libros[A.props.COMPRAS_DB_ID].pest.OrdenesCompra.m, enc = L[0], f = L.find(r => r[0] === oc);
  return f[enc.indexOf('rfc')]; };
const facturar = oc => ok('pedro', 'registrarFacturaProveedor', { ocFolio: oc, xml: { nombre: 'f.xml', datos: cfdi(rfcDeOc(oc)) }, idSolicitud: id('f') });
// 40 requisiciones: 12 recibidas (cerradas), 8 pagadas, 6 autorizadas, 5 cotizadas, 5 aprobadas, 4 solicitadas; 10 facturas
const reqs = { cerrada: [], pagada: [], autorizada: [], cotizada: [], aprobada: [], solicitada: [] };
let n = 0;
for (const [estado, cuantas] of [['cerrada', 12], ['pagada', 8], ['autorizada', 6], ['cotizada', 5], ['aprobada', 5], ['solicitada', 4]]) {
  for (let i = 0; i < cuantas; i++, n++) {
    const proyecto = proyectos[1 + (n % 13)]; // sin ligar (en P1 la recepción va por el centro de mando)
    const folio = nuevaReq(SOLICITANTES[n % 4], proyecto);
    const r = { folio };
    if (estado !== 'solicitada') aprobar(folio);
    if (['cotizada', 'autorizada', 'pagada', 'cerrada'].indexOf(estado) !== -1) cotizar(folio, n);
    if (['autorizada', 'pagada', 'cerrada'].indexOf(estado) !== -1) { r.oc = vistoBueno(folio); if (n % 3 === 0) facturar(r.oc); }
    if (['pagada', 'cerrada'].indexOf(estado) !== -1) pagar(folio);
    if (estado === 'cerrada') recibir(folio);
    reqs[estado].push(r);
  }
}
// Una requisición del proyecto ligado, autorizada (marca En camino y recibe el centro de mando)
{ const f = nuevaReq('obrero', P1); aprobar(f); cotizar(f, 1); reqs.ligada = { folio: f, oc: vistoBueno(f) }; }
// Correos y avisos que quedaron por mandar: se mandan aquí (el activador los manda cada 15 min)
P.cadaQuinceMinutos();

// ================= Medición =================
const VERS = () => ok('leo', 'bootstrap').versiones;
function resumen(ops) {
  const c = {}, celdas = { lee: 0, escribe: 0 };
  TIPOS.forEach(t => { c[t] = 0; });
  let candado = 0, segCandado = 0;
  ops.forEach(o => {
    c[o.tipo] = (c[o.tipo] || 0) + 1;
    if (o.tipo === 'lee') celdas.lee += o.celdas || 0;
    if (o.tipo === 'escribe') celdas.escribe += o.celdas || 0;
    if (o.candado) { candado++; segCandado += PESOS[o.tipo] || 0; }
  });
  const seg = TIPOS.reduce((s, t) => s + c[t] * PESOS[t], 0);
  return { c, celdas, seg: Math.round(seg * 100) / 100, candado, segCandado: Math.round(segCandado * 100) / 100 };
}
const resultados = [];
const detalle = opcion('--detalle');
/** Mide fn (una o varias llamadas por doPost): operaciones, segundos estimados y bytes de la respuesta. */
function medir(nombre, fn, nota) {
  perfil.ops = []; perfil.activo = true; perfil.pila = !!(detalle && nombre.indexOf(detalle) !== -1);
  let bytes = 0, llamadas = 0;
  const postOriginal = A.post;
  try {
    fn((q, f, ...a) => { const r = post(q, f, ...a); llamadas++; bytes += A.ultimaRespuesta; assert(r.ok, nombre + ' · ' + f + ': ' + r.error); return r.datos; });
  } finally { perfil.activo = false; }
  const r = Object.assign({ nombre, llamadas, kb: Math.round(bytes / 102.4) / 10, nota: nota || '' }, resumen(perfil.ops));
  if (perfil.pila) imprimirDetalle(nombre, perfil.ops);
  resultados.push(r);
  return r;
}
function imprimirDetalle(nombre, ops) {
  console.log('\n=== Detalle: ' + nombre + ' ===');
  const porHoja = {};
  ops.filter(o => ['lee', 'escribe', 'ultimaFila', 'dataRange'].indexOf(o.tipo) !== -1).forEach(o => {
    const k = o.tipo + ' ' + o.hoja;
    (porHoja[k] = porHoja[k] || []).push((o.pila || []).slice(0, 4).join(' < '));
  });
  Object.keys(porHoja).sort().forEach(k => {
    console.log(String(porHoja[k].length).padStart(3) + '  ' + k);
    const cuenta = {};
    porHoja[k].forEach(p => { cuenta[p] = (cuenta[p] || 0) + 1; });
    Object.keys(cuenta).forEach(p => console.log('       ' + cuenta[p] + '× ' + p));
  });
  const otros = {};
  ops.filter(o => ['drive', 'driveCrea', 'urlfetch', 'props', 'abrir', 'pdf', 'correo'].indexOf(o.tipo) !== -1).forEach(o => {
    const k = o.tipo + ' ' + (o.que || o.hoja || '') + '  ← ' + (o.pila || []).slice(0, 3).join(' < ');
    otros[k] = (otros[k] || 0) + 1;
  });
  Object.keys(otros).sort().forEach(k => console.log(String(otros[k]).padStart(3) + '  ' + k));
  const cache = {};
  ops.filter(o => o.tipo === 'cache').forEach(o => {
    const k = o.que + ' ' + String(o.clave || '').replace(/_[\d.]+(#\d+)?$/, '_v$1').replace(/TOK_.*/, 'TOK_…') + (o.que === 'get' ? (o.acierto ? ' (sí)' : ' (no)') : '');
    cache[k] = (cache[k] || 0) + 1;
  });
  Object.keys(cache).sort().forEach(k => console.log(String(cache[k]).padStart(3) + '  cache ' + k));
}
const vaciarCache = () => Object.keys(A.cache).forEach(k => { if (k.indexOf('TOK_') !== 0) delete A.cache[k]; });
const ROLES = [['compras', 'pedro'], ['aprobaciones', 'tania'], ['solo requisición', 'rosa'], ['cobranza', 'efrain'], ['super admin', 'leo']];

// -- Carga inicial por rol: en frío (caché vacío: nadie entró en 6 h o recién publicado) y caliente (tras el activador) --
for (const [rol, q] of ROLES) {
  vaciarCache();
  medir('bootstrap ' + rol + ' (frío)', c => c(q, 'bootstrap'));
}
P.cadaQuinceMinutos();
for (const [rol, q] of ROLES) medir('bootstrap ' + rol + ' (caliente)', c => c(q, 'bootstrap'));

// -- Pantallas de consulta (caché caliente) --
const abierta = reqs.pagada[0].folio;
medir('abrir requisición (compras)', c => c('pedro', 'getRequisicion', abierta));
medir('abrir requisición (aprobaciones)', c => c('tania', 'getRequisicionOperaciones', reqs.cotizada[0].folio));
medir('lista de Compras (caliente)', c => c('pedro', 'listarRequisiciones', '', ''));
medir('pendientes compras', c => c('pedro', 'pendientes', false));
medir('pendientes super admin (todos)', c => c('leo', 'pendientes', true));
medir('mis requisiciones (solo requisición)', c => c('rosa', 'misRequisiciones'));
medir('cuentas por pagar', c => c('pedro', 'cuentasPorPagar'));

// -- Sincronización (cada 20 s): sin cambios y tras un cambio de otra persona --
let vPedro = ok('pedro', 'bootstrap').versiones;
const ctxCompras = { rcBuscar: '', rcEstado: '', req: abierta, cxp: true, cxpHoy: HOY_ISO };
medir('sincronizar compras (sin cambios)', c => c('pedro', 'sincronizar', vPedro, ctxCompras));
const vRosa = ok('rosa', 'bootstrap').versiones;
medir('sincronizar solo requisición (sin cambios)', c => c('rosa', 'sincronizar', vRosa, {}));

// -- Flujo completo (con aprobaciones, como en el real): pedir → aprobar → cotizar → visto bueno (orden con PDF) → pagar → recibir --
let flujo;
medir('flujo 1 · guardarRequisicion (con cotización)', c => { flujo = c('obrero', 'guardarRequisicion', { proyectoFolio: proyectos[3], sitio: 'Querétaro',
  renglones: RENGLONES, cotizacion: { nombre: 'cot.pdf', datos: PDF }, idSolicitud: id('q') }).folio; });
medir('sincronizar compras (tras un cambio)', c => c('pedro', 'sincronizar', vPedro, ctxCompras));
medir('lista de Compras (tras un cambio)', c => c('pedro', 'listarRequisiciones', '', ''));
let vOps;
medir('flujo 2 · aprobar (abre + aprueba)', c => {
  vOps = c('tania', 'getRequisicionOperaciones', flujo);
  c('tania', 'aprobarRequisicion', flujo, { version: vOps.version, prioridad: 'Normal', renglones: vOps.renglones.map(r => ({ renglon: r.renglon, aprobado: true })) });
});
medir('flujo 3 · cotizarRequisicion', c => c('pedro', 'cotizarRequisicion', flujo, PROP(2)));
let ocFlujo;
medir('flujo 4 · visto bueno → orden con PDF', c => {
  const w = c('tania', 'getRequisicionOperaciones', flujo);
  ocFlujo = c('tania', 'autorizarPropuesta', flujo, w.propuesta.version, id('vb'), w.propuesta.huella).ocFolio;
});
medir('flujo 5 · registrarPagoProveedor', c => c('pedro', 'registrarPagoProveedor', { reqFolio: flujo, fecha: HOY_ISO, monto: TOTAL, monedaPago: 'MXN',
  metodo: 'Transferencia', referencia: 'SPEI ' + id(), comprobante: { nombre: 'c.pdf', datos: PDF }, idSolicitud: id('pg') }));
medir('flujo 6 · registrarRecepcion (3 fotos)', c => c('rosa', 'registrarRecepcion', { reqFolio: flujo, sitio: 'Querétaro', idSolicitud: id('r'),
  renglones: [{ renglon: 1, cantidad: 80, foto: F }, { renglon: 2, cantidad: 12, foto: F }, { renglon: 3, cantidad: 6, foto: F }] }));
// -- Otras escrituras --
medir('registrarFacturaProveedor (CFDI)', c => c('pedro', 'registrarFacturaProveedor', { ocFolio: ocFlujo,
  xml: { nombre: 'f.xml', datos: cfdi(rfcDeOc(ocFlujo)) }, idSolicitud: id('f') }));
medir('registrarPago (cobranza)', c => c('efrain', 'registrarPago', { proyectoFolio: proyectos[2], fecha: HOY_ISO, monto: 300, metodo: 'Transferencia',
  referencia: 'SPEI ' + id(), etapaOrden: 1, comprobante: { datos: PDF }, idSolicitud: id('g') }));
medir('guardarCotizacion (PDF)', c => c('ana', 'guardarCotizacion', { cliente: { nombre: 'Cliente 1', empresa: 'Empresa 1' },
  items: [{ descripcion: 'Servicio', cantidad: 1, precio: 1000 }], proyectoFolio: proyectos[5], idSolicitud: id('c') }));
medir('activador cadaQuinceMinutos (tras escrituras)', () => P.cadaQuinceMinutos());

// ================= Salida =================
const f2 = x => (Math.round(x * 10) / 10).toFixed(1);
const cols = [['lee', 'lee'], ['escribe', 'esc'], ['ultimaFila', 'últ'], ['dataRange', 'dR'], ['abrir', 'abr'], ['drive', 'drv'], ['driveCrea', 'crea'],
  ['cache', 'cch'], ['props', 'prp'], ['urlfetch', 'url'], ['correo', 'mail'], ['pdf', 'pdf'], ['candado', 'lck']];
const anterior = opcion('--comparar') ? JSON.parse(fs.readFileSync(opcion('--comparar'), 'utf8')) : null;
const antes = {};
(anterior || []).forEach(r => { antes[r.nombre] = r; });
console.log('\nEscenario'.padEnd(52) + cols.map(c => c[1].padStart(5)).join('') + '   KB  seg(srv)  +fijo  candado' + (anterior ? '   antes→después' : ''));
resultados.forEach(r => {
  const b = antes[r.nombre];
  console.log(r.nombre.padEnd(51) + cols.map(c => String(r.c[c[0]]).padStart(5)).join('') + String(r.kb).padStart(7) +
    f2(r.seg).padStart(9) + f2(r.seg + FIJO * r.llamadas).padStart(7) + (r.candado ? (r.candado + ' op ' + f2(r.segCandado) + ' s') : '').padStart(15) +
    (b ? ('   ' + f2(b.seg) + '→' + f2(r.seg) + ' s · ' + b.kb + '→' + r.kb + ' KB') : ''));
});
console.log('\nPesos (s): ' + TIPOS.map(t => t + ' ' + PESOS[t]).join(' · ') + ' · fijo por llamada ' + FIJO);
if (opcion('--json')) fs.writeFileSync(opcion('--json'), JSON.stringify(resultados, null, 1));
