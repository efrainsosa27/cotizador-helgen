// Incremento 4 · Pantallas (módulo D): Pendientes (inicio) en el servidor y en la interfaz, navegación por grupos, conteos y ligas
// directas. Servidor: pendientes() por rol con el flujo con aprobaciones y el de siempre (aprobaciones sin lo propio, compras,
// quien pide y quien recibe sin montos ni proveedor, facturas que vencen, super admin con los de todos), carga inicial y
// sincronización. Interfaz: grupos visibles por rol (Ventas solo con ventas; Solo requisiciones; super admin), Pendientes con sus
// botones, conteos, interruptor de "todos", estado vacío, ligas #req=… y #pend, Administración con sus bloques.
// Uso: node tests/pantallas.test.js .
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const dir = process.argv[2] || '.';

// ======================= Servidor =======================
const A = require('./arnes')(dir, { props: {
  ROL_COBRANZA: 'efrain@helgen.tech', ROL_COMPRAS: 'pedro@helgen.tech', ROL_REQUISICION: 'obrero@helgen.tech, pedro@helgen.tech',
  SOLO_REQUISICION: 'rosa@helgen.tech, adri@helgen.tech', ROL_OPERACIONES: 'adri@helgen.tech, tania@helgen.tech', SUPER_ADMIN: 'leo@helgen.tech' } });
const { P, ok, falla, plain, props, HOY_ISO, masDias, correr } = A;
const PDF = A.PDF;
// F (incremento 5): sin CSF y carátula del proveedor no se registra un pago; estas pruebas no son de documentos (eso va en
// tests/proveedores.test.js), así que aquí se salta ese bloqueo
P.exigirDocumentosParaPagar_ = function () {};

// ---- Lógica pura ----
assert.equal(P.marcaOrdenable('2026-10-28 14:05:09'), '2026-10-28 14:05');
assert.equal(P.marcaOrdenable("'2026-10-28"), '2026-10-28 00:00');
assert.equal(P.marcaOrdenable('28/10/2026 9:05'), '2026-10-28 09:05');
assert.equal(P.marcaOrdenable('ayer'), '');
const q0 = { folio: 'REQ-1', desde: '2026-10-20 10:00', proyectoFolio: 'PRY-1', proyectoVisible: 'PRY-1-DRO', proyectoNombre: 'DROGHEDA',
  solicitanteEmail: 'juan@helgen.tech', solicitante: 'Juan', estado: 'Autorizada', motivo: '', sitio: 'Querétaro', prioridad: 'Urgente',
  fechaRequerida: '', recibeEmail: 'rosa@helgen.tech', elaboroEmail: 'pedro@helgen.tech', propuesta: { proveedor: 'Ferretera', total: 1160, moneda: 'MXN' },
  oc: { folio: 'OC-1', estado: 'Emitida', proveedor: 'Ferretera', total: 1160, moneda: 'MXN' } };
const facturaVencida = { folio: 'FPR-1', ocFolio: 'OC-1', reqFolio: 'REQ-1', proveedor: 'Ferretera', serieFolio: 'A-9', total: 1160, moneda: 'MXN',
  fechaVencimiento: '2026-10-25', dias: 3, proyectoVisible: 'PRY-1-DRO' };
const vieja = { folio: 'FPR-2', ocFolio: 'OC-0', reqFolio: '', proveedor: 'Antiguo SA', serieFolio: '', total: 50, moneda: 'USD',
  fechaVencimiento: '2026-11-02', dias: -5, proyectoVisible: 'PRY-1-DRO' };
const lejana = Object.assign({}, vieja, { folio: 'FPR-3', dias: -20 });
const O = extra => Object.assign({ yo: 'pedro@helgen.tech', roles: { compras: true }, flujo: true, hoy: '2026-10-28',
  cxp: [facturaVencida, vieja, lejana] }, extra || {});
let it = plain(P.itemsPendientes([q0], O()));
assert.deepEqual(it.map(x => x.tipo + ':' + x.folio + ':' + x.destino), ['pagar:REQ-1:com', 'factura:FPR-2:cxp'],
  'la factura de la orden se anota en "pagar"; la de una orden sin requisición sale aparte; la que vence en 20 días no');
assert(/OC-1 · Ferretera · \$1,160\.00 MXN · factura vencida hace 3 días/.test(it[0].detalle), it[0].detalle);
assert.deepEqual([it[0].urgente, it[0].dias, it[0].desde, it[0].accion], [true, 8, '2026-10-20', 'Enviar y pagar']);
assert.deepEqual([it[1].titulo, it[1].vence, it[1].diasVencida, it[1].accion, it[1].para], ['Factura por vencer', '2026-11-02', -5, 'Ver cuentas por pagar', undefined]);
// Proyecto ligado al centro de mando: una pagada se marca En camino; quien recibe lo recibe allá
it = plain(P.itemsPendientes([Object.assign({}, q0, { estado: 'Pagada', oc: Object.assign({}, q0.oc, { estado: 'Pagada' }) })],
  O({ cxp: [], ligado: f => f === 'PRY-1' })));
assert.deepEqual(it.map(x => x.tipo + ':' + x.accion), ['encamino:Marcar En camino']);
it = plain(P.itemsPendientes([Object.assign({}, q0, { estado: 'En camino' })], O({ yo: 'rosa@helgen.tech', roles: { requisicion: true }, ligado: () => true })));
assert.deepEqual(it.map(x => x.tipo + ':' + x.titulo + ':' + x.accion + ':' + x.destino), ['recibir:En camino:Recibir en el centro de mando:req']);
assert(/la pidió Juan/.test(it[0].detalle) && !/Ferretera|1,160|OC-1/.test(JSON.stringify(it)), 'quien recibe no ve proveedor, montos ni orden');
// Flujo de siempre: compras autoriza; quien pidió confirma cuando está pagada (no antes)
const qs = Object.assign({}, q0, { estado: 'Solicitada', oc: null, recibeEmail: '' });
assert.deepEqual(plain(P.itemsPendientes([qs], O({ flujo: false, cxp: [] }))).map(x => x.tipo), ['autorizar']);
assert.deepEqual(plain(P.itemsPendientes([qs], O({ flujo: true, cxp: [] }))).map(x => x.tipo), [], 'con aprobaciones, la solicitada no es de compras');
const juan = { yo: 'juan@helgen.tech', roles: { requisicion: true }, hoy: '2026-10-28' };
assert.deepEqual(plain(P.itemsPendientes([Object.assign({}, q0, { recibeEmail: '' })], Object.assign({ flujo: false }, juan))).map(x => x.tipo), []);
assert.deepEqual(plain(P.itemsPendientes([Object.assign({}, q0, { estado: 'Pagada', recibeEmail: '' })], Object.assign({ flujo: false }, juan)))
  .map(x => x.tipo + ':' + x.accion), ['recibir:Confirmar que llegó']);
// Todos (super admin): a quién espera cada uno; lo de otros se abre en Compras
it = plain(P.itemsPendientes([q0], O({ yo: 'leo@helgen.tech', roles: {}, todos: true, cxp: [], nombres: { 'rosa@helgen.tech': 'Rosa Mena' } })));
assert.deepEqual(it.map(x => x.tipo + ':' + x.para + ':' + x.destino), ['pagar:Compras:com', 'recibir:Rosa Mena:com']);
const cuenta = plain(P.conteosPendientes([{ seccion: 'compras', destino: 'cxp' }, { seccion: 'aprobaciones', destino: 'ops' }, { seccion: 'mias', destino: 'req' }]));
assert.deepEqual(cuenta, { total: 3, aprobaciones: 1, compras: 1, mias: 1, ops: 1, com: 1, req: 1 });

// ---- Por doPost, con el flujo con aprobaciones (ROL_OPERACIONES) ----
const pend = (quien, todos) => ok(quien, 'pendientes', todos);
const tipos = (quien, todos) => pend(quien, todos).items.map(x => x.tipo + ':' + x.folio);
const p1 = ok('ana', 'crearProyecto', { nombre: 'DROGHEDA', ubicacion: 'Querétaro', cliente: { nombre: 'Cliente Secreto', empresa: 'Empresa Oculta SA' }, idSolicitud: 'p1' }).folio;
for (const q of ['ana', 'efrain', 'obrero', 'pedro', 'rosa']) assert.deepEqual(pend(q).items, [], q + ': nada todavía');
const nueva = (quien, id, extra) => ok(quien, 'guardarRequisicion', Object.assign({ proyectoFolio: p1, sitio: 'Querétaro',
  renglones: [{ descripcion: 'Cable THW 10', cantidad: 100, unidad: 'm' }], idSolicitud: id }, extra || {})).folio;
const r1 = nueva('obrero', 'r1', { fechaRequerida: masDias(2) });
const rA = nueva('adri', 'rA');
assert.deepEqual(tipos('adri'), ['aprobar:' + r1], 'quien aprueba no ve su propia requisición');
assert.deepEqual(tipos('tania').sort(), ['aprobar:' + r1, 'aprobar:' + rA].sort());
for (const q of ['obrero', 'pedro', 'rosa', 'ana']) assert.deepEqual(pend(q).items, [], q + ': nada que hacer con una solicitada');
let x = pend('adri').items[0];
assert.deepEqual([x.seccion, x.titulo, x.accion, x.destino, x.sitio, x.desde, x.dias], ['aprobaciones', 'Por aprobar', 'Aprobar', 'ops', 'Querétaro', HOY_ISO, 0]);
assert(/DROGHEDA · pidió Juan Obrero · se necesita el /.test(x.detalle), x.detalle);
assert(!/Cliente Secreto|Empresa Oculta/.test(JSON.stringify(pend('tania'))), 'sin cliente');
assert.deepEqual(plain(pend('adri').conteos), { total: 1, aprobaciones: 1, compras: 0, mias: 0, ops: 1, com: 0, req: 0 });
// Lo más antiguo primero (la hoja dice cuándo cambió cada una por última vez)
const LC = () => A.libros[props.COMPRAS_DB_ID], filaReq = f => LC().pest.Requisiciones.m.find(r => r[0] === f);
filaReq(rA)[12] = new Date(Date.now() - 3 * 86400000);
P.subirVersiones_(['requisiciones']);
assert.deepEqual(tipos('tania'), ['aprobar:' + rA, 'aprobar:' + r1]);
assert.equal(pend('tania').items[0].dias, 3);
// Super admin: su lista (aprueba, pero no lo suyo) y la de todos; nadie más puede pedir la de todos
const rL = nueva('leo', 'rL');
assert.deepEqual(tipos('leo'), ['aprobar:' + rA, 'aprobar:' + r1]);
let todos = pend('leo', true);
assert.equal(todos.todos, true);
assert.deepEqual(todos.items.map(i => i.folio).sort(), [r1, rA, rL].sort(), 'con todos, también la suya');
assert.deepEqual(todos.items.map(i => i.para), ['Aprobaciones', 'Aprobaciones', 'Aprobaciones']);
assert.deepEqual(plain(todos.conteos), plain(pend('leo').conteos), 'los conteos siempre son los propios');
falla('tania', 'pendientes', [true], /Solo un super admin/, 'PERMISO');
assert.equal(pend('adri').todos, false, 'una cuenta de solo requisiciones sí consulta los suyos');
ok('tania', 'rechazarRequisicion', rL, 'Solo era para probar');
assert(!tipos('adri').includes('aprobar:' + rL), 'la rechazada ya no espera nada');

// Aprobada → compras la cotiza; regresada → "Propuesta regresada"; Cotizada → visto bueno (no quien la pidió ni quien la preparó)
ok('adri', 'aprobarRequisicion', r1, { version: 1, prioridad: 'Urgente', renglones: [{ renglon: 1, aprobado: true }] });
assert.deepEqual(tipos('pedro'), ['cotizar:' + r1]);
assert.deepEqual(tipos('adri'), [], 'ya la aprobó');
const PROP = id => ({ proveedor: { razonSocial: 'Ferretera del Puerto' }, fechaEntrega: masDias(2), formaPago: 'Transferencia', condicionesPago: 'Contado', diasCredito: 0,
  recibe: 'rosa@helgen.tech', renglones: [{ renglon: 1, disponibilidad: 'Exacto', costo: 10 }], idSolicitud: id });
ok('pedro', 'cotizarRequisicion', r1, PROP('pp1'));
assert.deepEqual(tipos('pedro'), [], 'espera el visto bueno');
x = pend('adri').items.find(i => i.folio === r1);
assert.deepEqual([x.tipo, x.titulo, x.accion, x.prioridad, x.urgente], ['visto', 'Propuesta por visto bueno', 'Dar visto bueno', 'Urgente', true]);
assert(/Ferretera del Puerto · \$1,160\.00 MXN/.test(x.detalle), 'quien da el visto bueno ve proveedor y total: ' + x.detalle);
assert(!pend('obrero').items.length && !/Ferretera|1,160/.test(JSON.stringify(pend('obrero'))), 'quien pidió no ve la propuesta');
ok('tania', 'regresarACompras', r1, 'Pide precio con otro proveedor');
x = pend('pedro').items[0];
assert.deepEqual([x.tipo, x.titulo, x.accion], ['cotizar', 'Propuesta regresada', 'Corregir propuesta']);
assert(/motivo: Pide precio con otro proveedor/.test(x.detalle));
ok('pedro', 'cotizarRequisicion', r1, PROP('pp2'));
const huella = ok('adri', 'getRequisicionOperaciones', r1).propuesta.huella;
const oc1 = ok('adri', 'autorizarPropuesta', r1, 2, 'vb1', huella).ocFolio;

// Autorizada: compras manda y paga la orden; quien pidió y quien recibe la reciben (sin montos, proveedor ni orden)
x = pend('pedro').items[0];
assert.deepEqual([x.tipo, x.titulo, x.accion, x.destino], ['pagar', 'Orden por pagar', 'Enviar y pagar', 'com']);
assert(new RegExp(oc1 + ' · Ferretera del Puerto · \\$1,160\\.00 MXN').test(x.detalle), x.detalle);
const ob = pend('obrero'), ro = pend('rosa');
assert.deepEqual(ob.items.map(i => i.tipo + ':' + i.accion + ':' + i.destino), ['recibir:Registrar lo que llegó:req']);
assert(/recibe rosa@helgen.tech/.test(ob.items[0].detalle), ob.items[0].detalle);
assert.deepEqual(ro.items.map(i => i.tipo + ':' + i.folio), ['recibir:' + r1]);
assert(/la pidió Juan Obrero/.test(ro.items[0].detalle));
for (const r of [ob, ro]) assert(!/Ferretera|1,160|\$|OC-/.test(JSON.stringify(r)), 'sin montos, proveedor ni folio de la orden: ' + JSON.stringify(r));
assert.deepEqual(plain(ro.conteos), { total: 1, aprobaciones: 0, compras: 0, mias: 1, ops: 0, com: 0, req: 1 });
// Una factura vencida de la orden se anota en "pagar" (no sale dos veces)
const vencio = masDias(-10);
ok('pedro', 'registrarFacturaProveedor', { ocFolio: oc1, tipo: 'Extranjera', numero: 'INV-77', fecha: vencio, moneda: 'MXN', subtotal: 1000,
  impuestos: 160, pdf: { nombre: 'f.pdf', datos: PDF }, idSolicitud: 'f1' });
let pp = pend('pedro');
assert.deepEqual(pp.items.map(i => i.tipo), ['pagar']);
assert(/factura vencida hace 10 días/.test(pp.items[0].detalle) && pp.items[0].urgente, pp.items[0].detalle);
// Devuelta: le toca corregir a quien la pidió (con el motivo)
ok('tania', 'devolverRequisicion', rA, '¿De qué calibre?');
x = pend('adri').items.find(i => i.folio === rA);
assert.deepEqual([x.tipo, x.seccion, x.titulo, x.accion, x.destino], ['corregir', 'mias', 'Te la devolvieron', 'Corregir y reenviar', 'req']);
assert(/motivo: ¿De qué calibre\?/.test(x.detalle));
assert(!pend('tania').items.some(i => i.folio === rA), 'ya no espera a aprobaciones');
// Todos: lo de quien pide y quien recibe, con a quién espera, se abre en Compras
todos = pend('leo', true).items;
assert.deepEqual(todos.filter(i => i.folio === r1).map(i => i.tipo + ':' + i.para + ':' + i.destino), ['pagar:Compras:com', 'recibir:rosa@helgen.tech:com']);
assert.deepEqual(todos.filter(i => i.folio === rA).map(i => i.tipo + ':' + i.para), ['corregir:adri@helgen.tech']);

// Pagada: ya no es de compras (ni la factura: la orden ya se pagó), salvo En camino en un proyecto ligado al centro de mando
ok('pedro', 'registrarPagoProveedor', { reqFolio: r1, fecha: HOY_ISO, monto: 1160, monedaPago: 'MXN', metodo: 'Transferencia', referencia: 'SPEI 1',
  comprobante: { nombre: 'c.pdf', datos: PDF }, idSolicitud: 'pg1' });
assert.deepEqual(tipos('pedro'), []);
assert.deepEqual(tipos('obrero'), ['recibir:' + r1], 'sigue por recibir');
correr('var proyectoLigadoReal_ = proyectoLigado_; proyectoLigado_ = function (f) { return f === ' + JSON.stringify(p1) + '; };');
assert.deepEqual(pend('pedro').items.map(i => i.tipo + ':' + i.accion), ['encamino:Marcar En camino']);
assert.equal(pend('rosa').items[0].accion, 'Recibir en el centro de mando');
correr('proyectoLigado_ = proyectoLigadoReal_;'); // el real (módulo C): sin PORTAL_URL/PORTAL_SECRETO, ninguno ligado
assert.deepEqual(tipos('pedro'), []);

// ---- Carga inicial y sincronización ----
const boot = ok('adri', 'bootstrap');
assert.deepEqual(boot.pendientes.items.map(i => i.tipo + ':' + i.folio), ['corregir:' + rA]);
const s1 = ok('pedro', 'sincronizar', {}, {});
assert(s1.pendientes && Array.isArray(s1.pendientes.items), 'con versiones viejas manda los pendientes');
const s2 = ok('pedro', 'sincronizar', s1.versiones, {});
assert.equal(s2.pendientes, undefined, 'sin cambios no los vuelve a mandar');
ok('adri', 'cancelarRequisicion', rA, 'Ya no se necesita');
const s3 = ok('adri', 'sincronizar', s1.versiones, {});
assert(s3.cambios.indexOf('requisiciones') !== -1 && s3.pendientes.items.length === 0, 'la cancelada ya no espera nada');
assert.equal(ok('leo', 'sincronizar', {}, { pendTodos: true }).pendientes.todos, true);
assert.equal(ok('tania', 'sincronizar', {}, { pendTodos: true }).pendientes.todos, false, 'sin super admin, los suyos');
assert.equal(ok('ana', 'bootstrap').pendientes.items.length, 0);

// ---- Flujo de siempre (sin ROL_OPERACIONES): compras autoriza; quien pidió confirma la pagada ----
props.ROL_OPERACIONES = '';
const r5 = nueva('obrero', 'r5', { sitio: '', cotizacion: { nombre: 'c.pdf', datos: PDF } });
assert.deepEqual(tipos('pedro'), ['autorizar:' + r5]);
assert.deepEqual(tipos('tania'), [], 'sin el flujo con aprobaciones no hay nada que aprobar');
assert.deepEqual(pend('obrero').items.map(i => i.tipo + ':' + i.folio + ':' + i.accion), ['recibir:' + r1 + ':Confirmar que llegó']);
// Revisión 28/10/2026: en el flujo de siempre, En camino sin pagar no se ofrece para confirmar (el servidor pide la orden pagada)
ok('pedro', 'autorizarRequisicion', r5, { proveedor: { razonSocial: 'Eléctrica del Centro' }, fechaEntrega: masDias(2), formaPago: 'Transferencia', condicionesPago: 'Contado',
  diasCredito: 0, ivaTasa: 0.16, renglones: [{ descripcion: 'Brida', unidad: 'PZA', cantidad: 1, costo: 100 }], idSolicitud: 'oc-r5' });
ok('pedro', 'marcarEnCamino', r5, { paqueteria: 'DHL', guia: '123', fechaEstimada: masDias(1), idSolicitud: 'enc-r5' });
assert(!pend('obrero').items.some(i => i.folio === r5), 'en camino sin pagar: todavía no es de quien recibe');
ok('pedro', 'registrarPagoProveedor', { reqFolio: r5, fecha: HOY_ISO, monto: 116, monedaPago: 'MXN', metodo: 'Transferencia', referencia: 'SPEI r5',
  comprobante: { nombre: 'c.pdf', datos: PDF }, idSolicitud: 'pg-r5' });
assert.deepEqual(pend('obrero').items.filter(i => i.folio === r5).map(i => i.tipo + ':' + i.accion), ['recibir:Confirmar que llegó'], 'pagada: ya');

// ======================= Interfaz =======================
const html = fs.readFileSync(path.join(dir, 'web/home/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?: id="([^"]*)")?>([\s\S]*?)<\/script>/g)].map(m => ({ id: m[1], src: m[2] }));
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = 'h.' + b64({ email: 'ana@helgen.tech', given_name: 'Ana', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.f';
const esperar = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const dormir = ms => new Promise(r => setTimeout(r, ms));

// Lo fijo de la página: nombre, grupos alrededor de los botones de siempre, liga al inventario y diseño para teléfono
assert(/<title>CAPRI — Helgen<\/title>/.test(html) && /<h1[^>]*>CAPRI<\/h1>/.test(html), 'se llama CAPRI');
for (const [id, t] of [['tabNueva', 'nueva'], ['tabHist', 'hist'], ['tabCat', 'cat'], ['tabReq', 'req'], ['tabOps', 'ops'], ['tabCob', 'cob'],
  ['tabCom', 'com'], ['tabPend', 'pend'], ['tabAdmin', 'admin']]) {
  assert(new RegExp('id="' + id + '"[^>]*onclick="verTab\\(\'' + t + '\'\\)"').test(html), id + ' sigue con verTab(\'' + t + '\')');
}
assert(/id="tabOps"[^>]*>Aprobaciones</.test(html), 'la pestaña Operaciones se llama Aprobaciones');
assert(/id="lnkInventario"[^>]*href="https:\/\/drogheda\.helgen\.online\/" target="_blank" rel="noopener noreferrer"/.test(html));
assert(/@media \(max-width:640px\)/.test(html) && /header\.menu-abierto #navGrupos \{ display:flex; \}/.test(html) && /\.tabla-desliza/.test(html));
assert(/<section id="vistaPend">/.test(html) && /<section id="vistaNueva" class="oculto">/.test(html), 'la página abre en Pendientes');

/** Página completa (con los bloques de los módulos) sobre un DOM y un servidor simulados. opts: {hash, local}. */
function montar(boot, opts) {
  const o = opts || {};
  function elemento(tag) {
    const e = { tag, value: '', textContent: '', className: '', title: '', checked: false, disabled: false, hijos: [], oyentes: {}, porClase: {}, _clases: new Set(),
      classList: { add: c => e._clases.add(c), remove: c => e._clases.delete(c), contains: c => e._clases.has(c), toggle: (c, f) => (f === undefined ? !e._clases.has(c) : f) ? e._clases.add(c) : e._clases.delete(c) },
      addEventListener: (t, f) => (e.oyentes[t] = e.oyentes[t] || []).push(f), disparar: t => (e.oyentes[t] || []).forEach(f => f({ target: e })),
      focus() {}, remove() {}, appendChild: h => e.hijos.push(h), prepend: h => e.hijos.unshift(h), contains: () => false,
      querySelector: sel => e.porClase[sel] || (e.porClase[sel] = elemento('input')),
      querySelectorAll: sel => sel === 'tr' ? e.hijos : sel === 'input' ? Object.values(e.porClase) : [] };
    let h = ''; Object.defineProperty(e, 'innerHTML', { get: () => h, set: v => { h = v; if (v === '') e.hijos.length = 0; } });
    return e;
  }
  const porId = {}, oyentesDoc = {};
  const document = { getElementById: id => porId[id] || (porId[id] = elemento('div')), querySelector: () => ({ src: 'data:logo' }),
    createElement: t => elemento(t), visibilityState: 'visible', activeElement: null,
    addEventListener: (t, f) => (oyentesDoc[t] = oyentesDoc[t] || []).push(f), dispatchEvent: ev => (oyentesDoc[ev.type] || []).forEach(f => f(ev)) };
  document.getElementById('login').classList.add('oculto');
  const llamadas = [], reemplazos = [];
  const respuestas = { bootstrap: { ok: true, datos: boot },
    sincronizar: () => ({ ok: true, datos: { versiones: {}, permisos: boot.permisos, soloRequisicion: !!boot.soloRequisicion, cambios: [] } }) };
  async function fetch(url, op) {
    const c = JSON.parse(op.body); llamadas.push(c);
    const r = respuestas[c.funcion], datos = typeof r === 'function' ? r(c) : r;
    return { ok: true, json: async () => datos || { ok: false, error: 'sin respuesta simulada: ' + c.funcion } };
  }
  const almacen = { cotizadorHelgenSesion: token }, local = Object.assign({}, o.local || {});
  const location = { hash: o.hash || '', pathname: '/cotizador/', search: '' };
  const ctx = { document, fetch, console, JSON, Date, Math, Number, String, Array, Object, Promise, Proxy, Error, Uint8Array, TextDecoder,
    atob: s => Buffer.from(s, 'base64').toString('binary'), crypto: { randomUUID: () => 'id-' + Math.random() }, location,
    history: { replaceState: (a, b, u) => { reemplazos.push(u); location.hash = ''; } },
    sessionStorage: { getItem: k => almacen[k] ?? null, setItem: (k, v) => almacen[k] = v, removeItem: k => delete almacen[k] },
    localStorage: { getItem: k => local[k] ?? null, setItem: (k, v) => local[k] = String(v), removeItem: k => delete local[k] },
    confirm: () => true, prompt: () => null, CustomEvent: class { constructor(t, x) { this.type = t; this.detail = x && x.detail; } },
    setTimeout, clearTimeout, setInterval: () => 0, scrollTo() {}, decodeURIComponent };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const s of scripts) vm.runInContext(s.src, ctx);
  return { ctx, $: id => document.getElementById(id), llamadas, respuestas, reemplazos, run: c => vm.runInContext(c, ctx),
    oculto: id => document.getElementById(id).classList.contains('oculto'), activo: id => document.getElementById(id).classList.contains('activo'),
    funciones: () => llamadas.map(c => c.funcion) };
}
const BASE = { ivaTasa: 0.16, catalogo: [], tipoCambio: null, clientes: [], proyectos: [], marcas: {}, sitios: ['Querétaro'] };
const SIN_PEND = { hoy: '2026-10-28', todos: false, flujo: true, items: [], conteos: { total: 0, aprobaciones: 0, compras: 0, mias: 0, ops: 0, com: 0, req: 0 }, avisos: [] };
const item = (tipo, folio, seccion, destino, extra) => Object.assign({ tipo, folio, req: folio, seccion, destino, titulo: 'T ' + tipo,
  detalle: 'PRY-2026-0002-DRO · DROGHEDA', sitio: 'Querétaro', desde: '2026-10-25', dias: 3, prioridad: '', urgente: false, accion: 'Hacer ' + tipo }, extra || {});
const conteos = items => { const c = { total: items.length, aprobaciones: 0, compras: 0, mias: 0, ops: 0, com: 0, req: 0 };
  items.forEach(i => { c[i.seccion]++; c[i.destino === 'cxp' ? 'com' : i.destino]++; }); return c; };
const conPend = items => Object.assign({}, SIN_PEND, { items, conteos: conteos(items) });

(async () => {
  // ---- Vendedora con permisos de antes (sin la clave ventas): Pendientes de inicio, solo Ventas además ----
  const V = montar(Object.assign({}, BASE, { permisos: { cobranza: false, desbloqueo: false }, pendientes: SIN_PEND }));
  await esperar();
  assert(!V.oculto('vistaPend') && V.oculto('vistaNueva') && V.activo('tabPend'), 'abre en Pendientes');
  assert(!V.oculto('tabPend') && !V.oculto('grpVentas') && !V.oculto('tabNueva'), 'sin permisos.ventas: puedeVender() como antes');
  for (const id of ['grpCompras', 'tabReq', 'tabOps', 'tabCom', 'tabCob', 'tabAdmin', 'lnkInventario', 'subnav', 'cntPend']) assert(V.oculto(id), 'oculta ' + id);
  assert(/Nada pendiente/.test(V.$('pendLista').innerHTML) && /verTab\('nueva'\)/.test(V.$('pendLista').innerHTML) && !/Nueva requisición/.test(V.$('pendLista').innerHTML));
  assert.deepEqual(V.funciones(), ['bootstrap'], 'los pendientes llegan en la carga inicial: una sola llamada');
  V.run("verGrupo('ventas')");
  assert(!V.oculto('vistaNueva') && V.activo('grpVentas') && !V.activo('tabPend') && !V.oculto('subnav') && !V.oculto('subVentas') && V.oculto('subCompras'),
    'Ventas abre Nueva cotización con su barra (3 pantallas)');
  V.run("verTab('hist')"); V.run("verTab('pend')"); V.run("verGrupo('ventas')");
  assert(!V.oculto('vistaHist'), 'el grupo recuerda la última pantalla');
  V.run("verTab('pend')");
  assert(V.oculto('subnav'), 'Pendientes no tiene barra');
  // Teléfono: el menú se abre y se cierra al elegir
  V.run('alternarMenu()'); assert(V.activo('cabecera') || V.$('cabecera').classList.contains('menu-abierto'));
  V.run("verTab('pend')"); assert(!V.$('cabecera').classList.contains('menu-abierto'), 'elegir una pantalla cierra el menú');

  // ---- Sin ventas: no ve Ventas ----
  const W = montar(Object.assign({}, BASE, { permisos: { ventas: false, requisicion: true, compras: false, cobranza: false, operaciones: false }, pendientes: SIN_PEND }));
  await esperar();
  for (const id of ['grpVentas', 'tabNueva', 'tabHist', 'tabCat', 'tabOps', 'tabAdmin']) assert(W.oculto(id), 'sin ventas oculta ' + id);
  assert(!W.oculto('grpCompras') && !W.oculto('tabReq') && !W.oculto('lnkInventario'), 'pide materiales: Compras → Requisiciones e inventario');
  assert(/Nueva requisición/.test(W.$('pendLista').innerHTML) && !/Nueva cotización/.test(W.$('pendLista').innerHTML));
  W.run("verGrupo('compras')");
  // G (incremento 7): quien pide también ve Gastos en el grupo Compras, así que el grupo ya tiene barra (Requisiciones · Gastos); la regla
  // "una sola pantalla: sin barra" sigue probada con Administración (un bloque, abajo)
  assert(!W.oculto('vistaReq') && !W.oculto('subnav') && !W.oculto('tabGas'), 'Requisiciones y Gastos en el grupo: con barra');

  // ---- Solo requisiciones que aprueba: Pendientes, Requisiciones, Aprobaciones y Administración → Delegaciones ----
  const IT = [item('aprobar', 'REQ-2026-0010', 'aprobaciones', 'ops', { prioridad: 'Urgente', urgente: true }),
    item('corregir', 'REQ-2026-0004', 'mias', 'req', { titulo: 'Te la devolvieron', accion: 'Corregir y reenviar', dias: 0, desde: '2026-10-28' })];
  const S = montar(Object.assign({}, BASE, { soloRequisicion: true, pendientes: conPend(IT),
    permisos: { requisicion: true, operaciones: true, flujoOperaciones: true, compras: false, cobranza: false, ventas: false, superadmin: false } }));
  await esperar();
  for (const id of ['tabPend', 'grpCompras', 'tabReq', 'tabOps', 'tabAdmin', 'lnkInventario']) assert(!S.oculto(id), 've ' + id);
  for (const id of ['grpVentas', 'tabNueva', 'tabCob', 'tabCom', 'pendTodosCaja']) assert(S.oculto(id), 'no ve ' + id);
  assert.deepEqual(['cntPend', 'cntCompras', 'cntOps', 'cntReq', 'cntMenu'].map(id => S.$(id).textContent), ['2', '2', '1', '1', '2']);
  assert(S.oculto('cntCom'));
  const pl = S.$('pendLista').innerHTML;
  assert(pl.indexOf('Aprobaciones<span class="cuenta">1') < pl.indexOf('Mis requisiciones<span class="cuenta">1'), 'por sección');
  assert(/pend-item urgente/.test(pl) && /chip cancelado">Urgente/.test(pl) && /Sitio: <b>Querétaro<\/b> · Desde el 25\/10\/2026 \(hace 3 días\)/.test(pl), pl);
  assert(/Desde el 28\/10\/2026 \(hoy\)/.test(pl) && /onclick="irPendiente\(0\)">Hacer aprobar</.test(pl) && /onclick="irPendiente\(1\)">Corregir y reenviar</.test(pl));
  S.run("verTab('admin')");
  assert(!S.oculto('adminDelegaciones') && S.oculto('adminPermisos') && S.oculto('adminCorreos') && S.oculto('adminAnulados') && S.oculto('subnav'),
    'Administración: solo sus delegaciones (sin barra: un bloque)');
  // Botones: aprobar abre la requisición en Aprobaciones; corregir abre el formulario en Requisiciones (pide su lista si no la tiene)
  S.respuestas.getRequisicionOperaciones = { ok: false, error: 'simulada' };
  S.run('irPendiente(0)'); await esperar();
  assert(!S.oculto('vistaOps') && S.activo('tabOps') && S.activo('grpCompras'));
  assert.deepEqual(S.llamadas.filter(c => c.funcion === 'getRequisicionOperaciones').map(c => c.args), [['REQ-2026-0010']]);
  const MIA = { folio: 'REQ-2026-0004', fecha: '2026-10-20', proyectoFolio: 'PRY-2026-0002', proyectoNombre: 'DROGHEDA', estado: 'Devuelta', motivo: '¿Calibre?',
    renglones: [{ renglon: 1, descripcion: 'Cable', cantidad: 3, unidad: 'M', notas: '' }], eventos: [], puedeEditar: true, puedeCancelar: true, puedeCerrar: false };
  S.respuestas.misRequisiciones = { ok: true, datos: [MIA] }; S.respuestas.listarProyectosRequisicion = { ok: true, datos: [] };
  S.run('irPendiente(1)'); await esperar(20);
  assert(!S.oculto('vistaReq') && S.$('reqTitulo').textContent === '1 · Corregir REQ-2026-0004', S.$('reqTitulo').textContent);
  assert.equal(S.llamadas.filter(c => c.funcion === 'misRequisiciones').length, 1, 'la lista se pide una vez');
  // Sincronización: pendientes nuevos y conteos sin recargar; el contexto lleva el interruptor
  S.respuestas.sincronizar = { ok: true, datos: { versiones: { requisiciones: 4 }, permisos: S.run('PERMISOS'), soloRequisicion: true, cambios: ['requisiciones'],
    pendientes: conPend([IT[0]]) } };
  S.run('sincronizarAhora()'); await esperar();
  assert.deepEqual(S.llamadas.filter(c => c.funcion === 'sincronizar').pop().args[1].pendTodos, false);
  assert.deepEqual(['cntPend', 'cntReq'].map(id => S.$(id).textContent), ['1', '']);
  assert(!/REQ-2026-0004/.test(S.$('pendLista').innerHTML));

  // ---- Solo requisiciones sin aprobaciones: no ve Aprobaciones ni Administración ----
  const R = montar(Object.assign({}, BASE, { soloRequisicion: true, pendientes: SIN_PEND, permisos: { requisicion: true, operaciones: false, compras: false } }));
  await esperar();
  assert(R.oculto('tabOps') && R.oculto('tabAdmin') && !R.oculto('tabReq'));

  // ---- Super admin: todos los grupos, Administración con sus 4 bloques, pendientes de todos ----
  const SUPER = { ventas: true, requisicion: true, operaciones: true, flujoOperaciones: true, compras: true, cobranza: true, desbloqueo: true, superadmin: true };
  const ITS = [item('pagar', 'REQ-2026-0002', 'compras', 'com'), item('factura', 'FPR-2026-0001', 'compras', 'cxp', { req: '', diasVencida: -2, vence: '2026-10-30' })];
  const A2 = montar(Object.assign({}, BASE, { permisos: SUPER, pendientes: conPend(ITS) }));
  await esperar();
  for (const id of ['grpVentas', 'grpCompras', 'tabCob', 'tabAdmin', 'tabCom', 'tabOps', 'tabReq', 'pendTodosCaja', 'lnkInventario']) assert(!A2.oculto(id), 'super admin ve ' + id);
  assert(/Vence el 30\/10\/2026 \(en 2 días\)/.test(A2.$('pendLista').innerHTML));
  A2.run("verTab('admin')");
  assert(!A2.oculto('subnav') && !A2.oculto('subAdmin') && !A2.oculto('adminPermisos') && A2.oculto('adminCorreos'), 'Administración abre en Permisos');
  for (const id of ['admTabPermisos', 'admTabDelegaciones', 'admTabCorreos', 'admTabAnulados']) assert(!A2.oculto(id));
  A2.run("verAdmin('correos')");
  assert(!A2.oculto('adminCorreos') && A2.oculto('adminPermisos') && A2.activo('admTabCorreos') && !A2.activo('admTabPermisos'));
  // Botones de compras: la requisición en Compras; una factura sin requisición, cuentas por pagar
  A2.respuestas.getRequisicion = { ok: false, error: 'simulada' };
  A2.respuestas.listarRequisiciones = { ok: true, datos: [] }; A2.respuestas.cuentasPorPagar = { ok: true, datos: null };
  A2.respuestas.listarProyectosCompras = { ok: true, datos: [] };
  A2.run("verTab('pend')"); A2.run('irPendiente(0)'); await esperar();
  assert(!A2.oculto('vistaCom') && A2.llamadas.some(c => c.funcion === 'getRequisicion' && c.args[0] === 'REQ-2026-0002'));
  A2.run('irPendiente(1)'); await esperar();
  assert(!A2.oculto('comVistaCxp') && A2.oculto('comVistaLista'), 'la factura abre cuentas por pagar');
  // Interruptor: los de todos (con a quién espera); los números siguen siendo los propios
  const TODOS = Object.assign(conPend([item('recibir', 'REQ-2026-0003', 'mias', 'com', { para: 'Rosa Mena', titulo: 'Por recibir' })]),
    { todos: true, conteos: conteos(ITS) });
  A2.respuestas.pendientes = c => ({ ok: true, datos: c.args[0] === true ? TODOS : conPend(ITS) });
  A2.run("verTab('pend')"); A2.$('pendTodos').checked = true; A2.run('cambiarPendTodos()'); await esperar();
  assert.deepEqual(A2.llamadas.filter(c => c.funcion === 'pendientes').pop().args, [true]);
  const tl = A2.$('pendLista').innerHTML;
  assert(/Quien pide o recibe/.test(tl) && /Espera a: <b>Rosa Mena<\/b>/.test(tl) && /a cada persona/.test(A2.$('pendResumen').textContent), tl);
  assert.equal(A2.$('cntPend').textContent, '2', 'los números de la navegación son los propios');
  A2.run('sincronizarAhora()'); await esperar();
  assert.equal(A2.llamadas.filter(c => c.funcion === 'sincronizar').pop().args[1].pendTodos, true, 'la sincronización pide los de todos');
  A2.$('pendTodos').checked = false; A2.run('cambiarPendTodos()'); await esperar();
  assert(!/Espera a:/.test(A2.$('pendLista').innerHTML));
  // Si pierde super admin, vuelve a los suyos y se esconde el interruptor
  A2.$('pendTodos').checked = true; A2.run('cambiarPendTodos()'); await esperar();
  A2.respuestas.sincronizar = { ok: true, datos: { versiones: {}, permisos: Object.assign({}, SUPER, { superadmin: false }), soloRequisicion: false, cambios: [] } };
  A2.run('sincronizarAhora()'); await esperar(20);
  assert(A2.oculto('pendTodosCaja') && A2.run('PEND_TODOS') === false && A2.llamadas.filter(c => c.funcion === 'pendientes').pop().args[0] === false);

  // ---- Ligas directas (#req=… de los correos y #pend) ----
  const L1 = montar(Object.assign({}, BASE, { permisos: SUPER, pendientes: conPend([item('visto', 'REQ-2026-0007', 'aprobaciones', 'ops')]) }), { hash: '#req=REQ-2026-0007' });
  L1.respuestas.getRequisicionOperaciones = { ok: false, error: 'simulada' };
  await esperar(); await dormir(5); await esperar();
  assert(!L1.oculto('vistaOps') && L1.llamadas.some(c => c.funcion === 'getRequisicionOperaciones' && c.args[0] === 'REQ-2026-0007'), 'lo que espera de esta persona');
  assert.deepEqual(L1.reemplazos, ['/cotizador/'], 'la liga se quita de la dirección');
  // Sin pendiente de ese folio: Compras si compra
  const L2 = montar(Object.assign({}, BASE, { permisos: { compras: true, requisicion: true, operaciones: false }, pendientes: SIN_PEND }), { hash: '#req=req-2026-0008' });
  Object.assign(L2.respuestas, { getRequisicion: { ok: false, error: 'simulada' }, listarRequisiciones: { ok: true, datos: [] }, cuentasPorPagar: { ok: true, datos: null },
    listarProyectosCompras: { ok: true, datos: [] } });
  await esperar(); await dormir(5); await esperar();
  assert(!L2.oculto('vistaCom') && L2.llamadas.some(c => c.funcion === 'getRequisicion' && c.args[0] === 'REQ-2026-0008'));
  // Quien solo pide: sus requisiciones (si no es suya, se le avisa)
  const L3 = montar(Object.assign({}, BASE, { soloRequisicion: true, permisos: { requisicion: true }, pendientes: SIN_PEND }), { hash: '#req=REQ-2026-0009' });
  Object.assign(L3.respuestas, { misRequisiciones: { ok: true, datos: [MIA] }, listarProyectosRequisicion: { ok: true, datos: [] } });
  await esperar(); await dormir(5); await esperar(20);
  assert(!L3.oculto('vistaReq') && /No encontramos la requisición <b>REQ-2026-0009<\/b>/.test(L3.$('aviso').innerHTML), L3.$('aviso').innerHTML);
  // #pend: Pendientes
  const L4 = montar(Object.assign({}, BASE, { permisos: { requisicion: true }, pendientes: SIN_PEND }), { hash: '#pend' });
  await esperar(); await dormir(5); await esperar();
  assert(!L4.oculto('vistaPend') && L4.reemplazos.length === 1);

  // ---- Sin pendientes en la carga inicial (falló esa pieza): se piden aparte; si fallan, se avisa ----
  const F = montar(Object.assign({}, BASE, { permisos: { requisicion: true } }));
  F.respuestas.pendientes = { ok: false, error: 'Servidor ocupado' };
  await esperar(20);
  assert.deepEqual(F.funciones().slice(0, 2), ['bootstrap', 'pendientes']);
  assert(/No se pudieron cargar los pendientes: Servidor ocupado/.test(F.$('pendLista').innerHTML));
  F.respuestas.pendientes = { ok: true, datos: conPend([IT[1]]) };
  F.run('actualizarPend()'); await esperar();
  assert(/REQ-2026-0004/.test(F.$('pendLista').innerHTML) && F.$('cntReq').textContent === '1');
  // La página se quedó abierta y cambió el día: la siguiente consulta vuelve a pedir los pendientes (una vez)
  const nP = () => F.llamadas.filter(c => c.funcion === 'pendientes').length, antes = nP();
  F.run("PEND_DIA = '2000-01-01'"); F.run('sincronizarAhora()'); await esperar();
  assert.equal(nP(), antes + 1, 'otro día: se vuelven a pedir');
  F.run('sincronizarAhora()'); await esperar();
  assert.equal(nP(), antes + 1, 'una sola vez');
  console.log('OK pantallas');
})().catch(e => { console.error(e); process.exit(1); });
