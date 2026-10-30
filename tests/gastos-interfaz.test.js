// Incremento 7 · módulo G (gastos): la interfaz (<script id="mod-gastos">) con un DOM y un fetch simulados conectados al servidor simulado
// del arnés, como tests/interfaz.test.js. Cubre: la pestaña Gastos en el grupo Compras para quien pide (también Solo requisiciones), el
// formulario para teléfono (cámara y PDF, tipo de cambio solo cuando la moneda no es la del proyecto, XML que llena monto, moneda e
// IVA), ticket obligatorio, envío con idSolicitud nuevo después de cada gasto, "Mis gastos" sin los del equipo, botones de aprobar y
// rechazar (Aprobaciones) y el formulario de reembolso (Compras), la excepción de super admin al aprobar lo suyo, el número de la
// pestaña y Pendientes → Gastos.
// Uso: node tests/gastos-interfaz.test.js .
'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const dir = process.argv[2] || '.';
const A = require('./arnes')(dir, { props: {
  ROL_COMPRAS: 'pedro@helgen.tech', ROL_REQUISICION: 'obrero@helgen.tech, pedro@helgen.tech',
  ROL_OPERACIONES: 'adri@helgen.tech', SOLO_REQUISICION: 'rosa@helgen.tech, adri@helgen.tech',
  ROL_COBRANZA: 'efrain@helgen.tech', SUPER_ADMIN: 'leo@helgen.tech' } });
const { ok, plain, props, libros, HOY_ISO, PDF, FOTO } = A;
const html = fs.readFileSync(path.join(dir, 'web/cotizador/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?: id="([^"]*)")?>([\s\S]*?)<\/script>/g)].map(m => ({ id: m[1], src: m[2] }));

// ---- HTML: pestaña y vista ----
assert(/<button id="tabGas" class="oculto" onclick="verTab\('gas'\)">Gastos<span id="cntGas"/.test(html), 'botón de la pestaña en el grupo Compras');
assert(/<section id="vistaGas" class="oculto">[\s\S]*id="gasModForm"[\s\S]*id="gasModMios"[\s\S]*id="gasModEquipo"/.test(html));
assert(html.indexOf('id="tabGas"') > html.indexOf('id="subCompras"') && html.indexOf('id="tabGas"') < html.indexOf('id="subAdmin"'), 'dentro de la barra de Compras');
const modulo = scripts.find(x => x.id === 'mod-gastos');
assert(modulo, 'existe <script id="mod-gastos">');
assert(/accept="image\/\*,application\/pdf" capture="environment"/.test(modulo.src), 'cámara del teléfono (o PDF)');
assert(/inputmode="decimal"/.test(modulo.src));
assert(/GAS-AAAA-NNNN/.test(html), 'Anular menciona GAS-');

// ---- Montaje (como tests/montar-interfaz.js, con Pendientes y Gastos; sincronizar llega al servidor simulado) ----
function montar(quien) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = 'h.' + b64({ email: quien + '@helgen.tech', given_name: quien, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.f';
  function elemento(tag) {
    const e = { tag, value: '', textContent: '', className: '', title: '', src: '', placeholder: '', disabled: false, hijos: [], oyentes: {}, _clases: new Set(), porClase: {},
      classList: { add: c => e._clases.add(c), remove: c => e._clases.delete(c), contains: c => e._clases.has(c), toggle: (c, f) => (f === undefined ? !e._clases.has(c) : f) ? e._clases.add(c) : e._clases.delete(c) },
      addEventListener: (t, f) => (e.oyentes[t] = e.oyentes[t] || []).push(f), disparar: t => (e.oyentes[t] || []).forEach(f => f({ target: e })),
      focus() {}, remove() {}, click() {}, insertAdjacentHTML(pos, x) { e.innerHTML += x; }, appendChild: h => e.hijos.push(h), prepend: h => e.hijos.unshift(h), contains: () => false,
      querySelector: sel => e.porClase[sel] || (e.porClase[sel] = elemento('input')), querySelectorAll: sel => sel === 'tr' ? e.hijos : [] };
    let h = ''; Object.defineProperty(e, 'innerHTML', { get: () => h, set: v => { h = v; if (v === '') e.hijos.length = 0; } });
    return e;
  }
  const porId = {}, oyentesDoc = {};
  const document = { getElementById: id => porId[id] || (porId[id] = elemento('div')), querySelector: () => ({ src: 'data:logo' }), createElement: t => elemento(t),
    visibilityState: 'visible', activeElement: null, body: elemento('body'),
    addEventListener: (t, f) => (oyentesDoc[t] = oyentesDoc[t] || []).push(f), dispatchEvent: ev => (oyentesDoc[ev.type] || []).forEach(f => f(ev)) };
  ['login', 'tabGas', 'gasModForm', 'gasModMios', 'gasModEquipo', 'vistaGas', 'gasTcCaja'].forEach(i => document.getElementById(i).classList.add('oculto'));
  const almacen = { cotizadorHelgenSesion: token }, llamadas = [];
  async function fetch(url, o) {
    const c = JSON.parse(o.body); llamadas.push(c);
    return { ok: true, json: async () => A.post(quien, c.funcion, ...c.args) };
  }
  class FileReader { readAsDataURL(f) { this.result = 'data:' + f.type + ';base64,' + f.b64; setImmediate(() => this.onload()); } }
  const dialogos = { confirmar: true, prompt: null, mensajes: [] };
  const ctx = { document, fetch, console, JSON, Date, Math, Number, String, Array, Object, Promise, Proxy, Error, Uint8Array, TextDecoder, FileReader, RegExp,
    atob: s => Buffer.from(s, 'base64').toString('binary'), crypto: { randomUUID: () => 'id-' + Math.random() },
    sessionStorage: { getItem: k => almacen[k] ?? null, setItem: (k, v) => almacen[k] = v, removeItem: k => delete almacen[k] },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    confirm: m => { dialogos.mensajes.push(String(m)); return dialogos.confirmar; }, prompt: m => { dialogos.mensajes.push(String(m)); return dialogos.prompt; },
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout, clearTimeout, setInterval: () => 0, scrollTo() {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['api-web', undefined, 'mod-pantallas', 'mod-proveedores', 'mod-recepcion', 'mod-gastos'].forEach(n => vm.runInContext(scripts.find(x => x.id === n).src, ctx));
  return { ctx, $: id => document.getElementById(id), llamadas, dialogos, run: c => vm.runInContext(c, ctx) };
}
const esperar = async (k = 60) => { for (let i = 0; i < k; i++) await new Promise(r => setImmediate(r)); };
const archivo = (name, type, b64) => ({ name, type, size: 2048, b64 });
const aviso = U => U.$('aviso').innerHTML;
const fila = folio => { const h = libros[props.COMPRAS_DB_ID].pest.Gastos.m, c = h[0]; const r = h.find(x => x[0] === folio); const o = {}; c.forEach((k, i) => { o[k] = r[i]; }); return o; };
const cfdiXml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Fecha="2026-10-20T10:15:00" SubTotal="500.00" Moneda="MXN" Total="580.00" TipoDeComprobante="I">
  <cfdi:Emisor Rfc="EKU9003173C9" Nombre="GASOLINERA DEL BAJIO" RegimenFiscal="601"/><cfdi:Receptor Rfc="HSE240304PC1" UsoCFDI="G03"/>
  <cfdi:Impuestos TotalImpuestosTrasladados="80.00"/>
  <cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="6F1C3A0E-5B2D-4C8A-9E7F-1A2B3C4D5E61"/></cfdi:Complemento>
</cfdi:Comprobante>`;

(async () => {
  // Datos: un proyecto MXN y uno USD (aceptada en dólares)
  const p1o = ok('ana', 'crearProyecto', { nombre: 'Planta Norte', ubicacion: 'Qro', cliente: { nombre: 'Cliente Uno', empresa: 'SA' }, idSolicitud: 'p1' });
  const p2o = ok('ana', 'crearProyecto', { nombre: 'Terminal Sur', ubicacion: 'Ver', cliente: { nombre: 'Cliente Dos', empresa: 'SA' }, idSolicitud: 'p2' });
  const cot = ok('ana', 'guardarCotizacion', { cliente: { nombre: 'Cliente Dos', empresa: 'SA' }, items: [{ descripcion: 'Servicio', cantidad: 1, precio: 1000 }],
    proyectoFolio: p2o.folio, moneda: 'USD', idSolicitud: 'c1' }).folio;
  ok('efrain', 'marcarAceptada', p2o.folio, cot, true);
  A.P.prepararCapri();

  // ================= Quien pide (obrero): pestaña, formulario, envío, Mis gastos =================
  let U = montar('obrero');
  await esperar();
  assert.equal(U.$('tabGas').classList.contains('oculto'), false, 'quien pide ve Gastos');
  assert(plain(U.run('GRUPOS.compras')).includes('gas'));
  U.run("verTab('gas')");
  await esperar();
  assert.equal(U.$('vistaGas').classList.contains('oculto'), false);
  assert(/Nuevo gasto/.test(U.$('gasModForm').innerHTML) && !U.$('gasModForm').classList.contains('oculto'));
  assert(U.$('gasModEquipo').classList.contains('oculto'), 'quien solo captura no ve los del equipo');
  assert(U.llamadas.some(c => c.funcion === 'listarGastos'), 'pide la pantalla al abrirla');
  assert(U.$('gasProyectosList').innerHTML.includes(p1o.folioVisible + ' — Planta Norte') && /label="USD"/.test(U.$('gasProyectosList').innerHTML));
  assert(/<option>Combustible<\/option>/.test(U.$('gasCategoria').innerHTML));
  assert.equal(U.$('gasFecha').value, U.run('(() => { const d = new Date(), p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); })()'));
  // Tipo de cambio solo cuando la moneda no es la del proyecto
  U.$('gasProyecto').value = p2o.folioVisible + ' — Terminal Sur'; U.$('gasMoneda').value = 'MXN'; U.$('gasProyecto').disparar('change');
  assert.equal(U.$('gasTcCaja').classList.contains('oculto'), false);
  assert(/El proyecto es en USD y el gasto en MXN/.test(U.$('gasTcNota').textContent));
  U.$('gasMoneda').value = 'USD'; U.$('gasMoneda').disparar('change');
  assert.equal(U.$('gasTcCaja').classList.contains('oculto'), true);
  // Validaciones antes de llamar al servidor
  U.$('gasProyecto').value = p1o.folioVisible + ' — Planta Norte'; U.$('gasMoneda').value = 'MXN'; U.$('gasProyecto').disparar('change');
  U.$('gasCategoria').value = 'Combustible'; U.$('gasConcepto').value = 'Gasolina camioneta'; U.$('gasMonto').value = '1160'; U.$('gasIva').value = 'Sí';
  const antes = U.llamadas.length;
  U.run('GASTOS.enviar()');
  await esperar();
  assert(/Toma la foto del ticket o adjunta el PDF/.test(aviso(U)));
  assert.equal(U.llamadas.length, antes, 'sin ticket no se llama al servidor');
  // Envío con la foto
  U.$('gasTicket').files = [archivo('ticket.jpg', 'image/jpeg', FOTO)];
  U.run('GASTOS.enviar()');
  await esperar();
  const envio = U.llamadas.filter(c => c.funcion === 'guardarGasto').pop();
  assert(envio, 'manda el gasto');
  const a0 = envio.args[0];
  assert.deepEqual([a0.proyectoFolio, a0.categoria, a0.concepto, a0.monto, a0.moneda, a0.ivaIncluido, a0.tipoCambio, a0.ticket.datos, a0.xml],
    [p1o.folio, 'Combustible', 'Gasolina camioneta', '1160', 'MXN', 'Sí', '', FOTO, null]);
  const G1 = 'GAS-' + A.ANIO + '-0001';
  assert(/Gasto <b>GAS-.*-0001<\/b> enviado por \$1,160\.00 MXN/.test(aviso(U)), aviso(U));
  assert.equal(fila(G1).estado, 'Enviado');
  assert.equal(U.$('gasConcepto').value, '', 'el formulario se limpia');
  assert(U.$('gasMios').innerHTML.includes(G1) && /Enviado · por aprobar/.test(U.$('gasMios').innerHTML));
  assert(/GASTOS\.cancelar\(&quot;GAS-/.test(U.$('gasMios').innerHTML), 'puede cancelarlo mientras está Enviado');
  assert(/En revisión \(1\)/.test(U.$('gasMiosResumen').innerHTML));
  // Otro gasto: idSolicitud nuevo (no regresa el primero); XML que llena monto, moneda e IVA
  U.$('gasXml').files = [archivo('f.xml', 'text/xml', Buffer.from(cfdiXml).toString('base64'))];
  U.$('gasXml').disparar('change');
  await esperar();
  assert.deepEqual([U.$('gasMonto').value, U.$('gasMoneda').value, U.$('gasIva').value], ['580', 'MXN', 'Sí']);
  assert(/GASOLINERA DEL BAJIO/.test(U.$('gasXmlInfo').innerHTML) && /6F1C3A0E/.test(U.$('gasXmlInfo').innerHTML));
  assert.deepEqual(plain(U.run('GASTOS.leerCfdiTexto(' + JSON.stringify(cfdiXml.replace('TipoDeComprobante="I"', 'TipoDeComprobante="E"')) + ')')).tipo, 'E');
  U.$('gasProyecto').value = p1o.folioVisible + ' — Planta Norte'; U.$('gasCategoria').value = 'Combustible'; U.$('gasConcepto').value = 'Con factura';
  U.$('gasTicket').files = null; U.$('gasTicketArchivo').files = [archivo('t.pdf', 'application/pdf', PDF)];
  U.run('GASTOS.enviar()');
  await esperar();
  const envio2 = U.llamadas.filter(c => c.funcion === 'guardarGasto').pop();
  assert.notEqual(envio2.args[0].idSolicitud, a0.idSolicitud, 'cada gasto con su idSolicitud');
  assert.deepEqual([envio2.args[0].ticket.datos, envio2.args[0].xml.nombre], [PDF, 'f.xml']);
  const G2 = 'GAS-' + A.ANIO + '-0002';
  assert.deepEqual([fila(G2).total, fila(G2).subtotal, fila(G2).uuid], [580, 500, '6F1C3A0E-5B2D-4C8A-9E7F-1A2B3C4D5E61']);
  // Cancelar el suyo (motivo con window.prompt)
  U.dialogos.prompt = 'Lo capturé mal';
  U.run('GASTOS.cancelar(' + JSON.stringify(G2) + ')');
  await esperar();
  assert.equal(fila(G2).estado, 'Cancelado');
  assert(/Gasto <b>GAS-.*-0002<\/b> cancelado/.test(aviso(U)));

  // ================= Aprobaciones (adri, Solo requisiciones + Aprobaciones): aprobar y rechazar =================
  const G3 = ok('rosa', 'guardarGasto', { proyectoFolio: p1o.folio, fecha: HOY_ISO, categoria: 'Herramientas', concepto: 'Pinzas', monto: 300, moneda: 'MXN',
    ivaIncluido: 'Sí', ticket: { nombre: 't.jpg', datos: FOTO }, idSolicitud: 'r1' }).folio;
  U = montar('adri');
  await esperar();
  assert.equal(U.$('tabGas').classList.contains('oculto'), false, 'Aprobaciones con Solo requisiciones ve Gastos');
  // Pendientes → Gastos (abrirDestino envuelto) y el número de la pestaña
  const pend = U.run('PEND_VISTOS').map(x => x.tipo + ':' + x.folio);
  assert(pend.includes('gastoAprobar:' + G1) && pend.includes('gastoAprobar:' + G3), JSON.stringify(pend));
  U.run('pintarConteos()');
  assert.equal(U.$('cntGas').textContent, '2');
  U.run('irPendiente(' + U.run('PEND_VISTOS').findIndex(x => x.folio === G1) + ')');
  await esperar();
  assert.equal(U.run('TAB'), 'gas');
  assert.deepEqual(U.llamadas.filter(c => c.funcion === 'listarGastos').pop().args[0], { estado: 'porAprobar', buscar: '' });
  assert(!U.$('gasModEquipo').classList.contains('oculto'));
  const eq = U.$('gasEquipo').innerHTML;
  assert(eq.includes(G1) && eq.includes(G3) && /GASTOS\.aprobar\(&quot;GAS-/.test(eq) && /GASTOS\.rechazar/.test(eq), 'botones de aprobar y rechazar');
  assert(!/Registrar reembolso/.test(eq), 'Aprobaciones no reembolsa');
  assert(/Total MXN \(2\)/.test(U.$('gasEquipoTotales').innerHTML));
  U.run('GASTOS.aprobar(' + JSON.stringify(G1) + ')');
  await esperar();
  assert.equal(fila(G1).estado, 'Aprobado');
  assert(/aprobado: pasa a Compras/.test(aviso(U)));
  U.dialogos.prompt = 'Ticket ilegible';
  U.run('GASTOS.rechazar(' + JSON.stringify(G3) + ')');
  await esperar();
  assert.deepEqual([fila(G3).estado, fila(G3).motivo], ['Rechazado', 'Ticket ilegible']);
  // Contexto de la sincronización con el filtro de la página
  assert.deepEqual(plain(U.run("MODULOS.find(m => m.nombre === 'Gastos').contexto()")), { gastos: true, gastosFiltro: { estado: 'porAprobar', buscar: '' } });

  // ================= Compras (pedro): registrar el reembolso =================
  U = montar('pedro');
  await esperar();
  U.run("verTab('gas')");
  await esperar();
  assert(U.$('gasEquipo').innerHTML.includes(G1) && /Registrar reembolso/.test(U.$('gasEquipo').innerHTML), 'por reembolsar');
  U.run('GASTOS.abrirReembolso(' + JSON.stringify(G1) + ')');
  assert(/Registrar reembolso de GAS-.*-0001 · \$1,160\.00 MXN a Juan Obrero/.test(U.$('gasReembolsoCaja').innerHTML));
  assert(/<option>Transferencia<\/option><option>Efectivo<\/option><option>Cheque<\/option>/.test(U.$('gasReembolsoCaja').innerHTML));
  U.$('gasReemReferencia').value = 'SPEI 5544';
  U.run('GASTOS.reembolsar()');
  await esperar();
  assert(/Adjunta el comprobante del reembolso/.test(aviso(U)));
  U.$('gasReemComprobante').files = [archivo('spei.pdf', 'application/pdf', PDF)];
  U.run('GASTOS.reembolsar()');
  await esperar();
  const re = U.llamadas.filter(c => c.funcion === 'reembolsarGasto').pop().args[0];
  assert.deepEqual([re.folio, re.metodo, re.referencia, re.comprobante.datos], [G1, 'Transferencia', 'SPEI 5544', PDF]);
  assert.deepEqual([fila(G1).estado, fila(G1).reembolso_referencia], ['Reembolsado', 'SPEI 5544']);
  assert(/Reembolso de <b>GAS-.*-0001<\/b> registrado/.test(aviso(U)) && U.$('gasReembolsoCaja').innerHTML === '');

  // ================= Super admin: aprobar lo suyo pide el motivo (accionConExcepcion) =================
  const GL = ok('leo', 'guardarGasto', { proyectoFolio: p1o.folio, fecha: HOY_ISO, categoria: 'Viáticos', concepto: 'Vuelo', monto: 4000, moneda: 'MXN',
    ivaIncluido: 'Sí', ticket: { nombre: 't.jpg', datos: FOTO }, idSolicitud: 'l1' }).folio;
  U = montar('leo');
  await esperar();
  U.run("verTab('gas')");
  await esperar();
  U.dialogos.prompt = 'Viaje urgente autorizado por dirección';
  U.run('GASTOS.aprobar(' + JSON.stringify(GL) + ')');
  await esperar();
  assert(U.dialogos.mensajes.some(t => /No puedes aprobar tu propio gasto[\s\S]*Motivo de la excepción/.test(t)), 'pide el motivo');
  assert.equal(fila(GL).estado, 'Aprobado');
  const ap = U.llamadas.filter(c => c.funcion === 'aprobarGasto');
  assert.deepEqual(ap.map(c => c.args.length), [2, 3], 'repite con el motivo al final');
  // Registrar el reembolso de lo suyo (revisión del 29/10/2026): el servidor lo niega y la interfaz le pide el motivo y repite
  U.run('GASTOS.abrirReembolso(' + JSON.stringify(GL) + ')');
  assert(/Registrar reembolso de GAS-/.test(U.$('gasReembolsoCaja').innerHTML), 'el super admin sí tiene el formulario');
  U.$('gasReemReferencia').value = 'SPEI 7788';
  U.$('gasReemComprobante').files = [archivo('spei.pdf', 'application/pdf', PDF)];
  U.dialogos.mensajes.length = 0;
  U.dialogos.prompt = 'Viaje urgente: Compras de vacaciones';
  U.run('GASTOS.reembolsar()');
  await esperar();
  assert(U.dialogos.mensajes.some(t => /No puedes registrar el reembolso de tu propio gasto[\s\S]*Motivo de la excepción/.test(t)), U.dialogos.mensajes.join(' | '));
  const rs = U.llamadas.filter(c => c.funcion === 'reembolsarGasto').map(c => c.args[0]);
  assert.deepEqual(rs.map(x => [x.folio, x.motivoExcepcion, x.idSolicitud === rs[0].idSolicitud]),
    [[GL, undefined, true], [GL, 'Viaje urgente: Compras de vacaciones', true]], 'repite con el motivo (mismo idSolicitud)');
  assert.equal(fila(GL).estado, 'Reembolsado');
  assert(/Reembolso de <b>GAS-/.test(aviso(U)));
  // Quien es de Compras no ve el botón de reembolsar lo suyo (pedro también captura)
  const GP = ok('pedro', 'guardarGasto', { proyectoFolio: p1o.folio, fecha: HOY_ISO, categoria: 'Casetas', concepto: 'Caseta', monto: 90, moneda: 'MXN',
    ivaIncluido: 'No', ticket: { nombre: 't.jpg', datos: FOTO }, idSolicitud: 'pp1' }).folio;
  ok('adri', 'aprobarGasto', GP);
  U = montar('pedro');
  await esperar();
  U.run("verTab('gas')");
  await esperar();
  const eqP = U.$('gasEquipo').innerHTML;
  assert(eqP.includes(GP) && !new RegExp('abrirReembolso\\(&quot;' + GP).test(eqP), 'sin botón para lo propio');

  // ================= Ventas sin Requisiciones: sin pestaña =================
  U = montar('ana');
  await esperar();
  assert.equal(U.$('tabGas').classList.contains('oculto'), true);

  console.log('gastos-interfaz.test.js: todo bien');
})().catch(e => { console.error(e); process.exit(1); });
