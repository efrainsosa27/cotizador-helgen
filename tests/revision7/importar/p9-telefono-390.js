// Copia de la revisión 7c (capri-7rev3/revision/) para la rama incremento-7-fix-importar: antes del arreglo esta prueba de concepto
// confirmaba el defecto; ahora comprueba lo corregido (la prueba permanente es tests/revision7-importar.test.js). Uso: bash tests/revision7/correr.sh
// P9 · La interfaz real (web/home/index.html) en Chromium a 390 px, conectada al servidor simulado del arnés (las llamadas a la
// API se responden con doPost del arnés). Revisa que ninguna vista nueva (Gastos, Horas, Cobranza con Facturas de clientes y
// Adicionales) mueva la página de lado, junta los errores de JavaScript y deja capturas en revision/capturas/.
// También revisa cómo reaccionan los módulos nuevos a codigo 'PERMISO' y 'SESION'.
// Uso: node revision/p9-telefono-390.js
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), http = require('http');
const C = require('./comun');
const A = C.crearArnes();
A.ctx.prepararCapri();

// ---- Datos: proyecto con contrato, gastos (uno con textos largos y CFDI), facturas de clientes, horas ----
const pry = C.proyectoConContrato(A, 'Terminal Contenedores Veracruz Ampliación Norte', 116000);
const largo = 'Hospedaje y viáticos de la cuadrilla de instalación del sistema RTK en el patio de contenedores'.slice(0, 200);
const xmlG = C.cfdi({ uuid: C.U(61), emisor: C.PROV, nombreEmisor: 'HOTELES Y SERVICIOS TURISTICOS DEL GOLFO DE MEXICO SA DE CV', receptor: C.HELGEN,
  nombreReceptor: 'HELGEN', fecha: A.HOY_ISO + 'T08:00:00' });
A.ok('obrero', 'guardarGasto', { proyectoFolio: pry, fecha: A.HOY_ISO, categoria: 'Hospedaje', concepto: largo, monto: 1, moneda: 'MXN', ivaIncluido: 'Sí',
  ticket: { nombre: 't.jpg', datos: A.FOTO }, xml: { nombre: 'h.xml', datos: C.b64(xmlG) }, idSolicitud: C.id('g') });
A.ok('obrero', 'guardarGasto', { proyectoFolio: pry, fecha: A.HOY_ISO, categoria: 'Casetas', concepto: 'Caseta', monto: 250, moneda: 'MXN', ivaIncluido: 'No',
  ticket: { nombre: 't.jpg', datos: A.FOTO }, idSolicitud: C.id('g') });
A.ok('tania', 'importarFacturasClientes', { archivos: [{ nombre: 'A-1.xml', datos: C.b64(C.cfdi({ uuid: C.U(1), nombreReceptor: 'UNIVERSIDAD ROBOTICA ESPAÑOLA DE LA COSTA DEL GOLFO SA DE CV', metodo: 'PPD' })) },
  { nombre: 'A-2.xml', datos: C.b64(C.cfdi({ uuid: C.U(2), folio: '2', total: '116000.00', subtotal: '100000.00', iva: '16000.00' })) }], idSolicitud: C.id('f') });

// ---- Servidor web local (la interfaz) y la API simulada ----
const web = path.join(C.DIR, 'web');
const srv = http.createServer((q, r) => {
  const f = path.join(web, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!f.startsWith(web) || !fs.existsSync(f)) { r.statusCode = 404; return r.end(); }
  r.setHeader('content-type', /\.html$/.test(f) ? 'text/html; charset=utf-8' : 'application/octet-stream'); r.end(fs.readFileSync(f));
}).listen(0, '127.0.0.1', principal);
const fake = quien => 'h.' + Buffer.from(JSON.stringify({ email: quien + '@helgen.tech', given_name: quien, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.f';
const fotos = process.env.CAPTURAS || path.join(require('os').tmpdir(), 'capri-revision7-capturas'); // fuera del repositorio
fs.mkdirSync(fotos, { recursive: true });

async function abrir(nav, quien, forzar) {
  const p = await nav.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errores = [];
  p.on('pageerror', e => errores.push(e.message + ' @ ' + String(e.stack).split('\n').slice(1, 3).join(' | ')));
  await p.addInitScript(t => { try { localStorage.setItem('cotizadorHelgenSesion', t); } catch (e) {} }, fake(quien));
  await p.route(/accounts\.google\.com/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
  await p.route(/script\.google\.com/, r => {
    const c = JSON.parse(r.request().postData());
    const f = forzar && forzar[c.funcion];
    const datos = f ? { ok: false, error: f[1], codigo: f[0] } : A.post(quien, c.funcion, ...(c.args || []));
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(datos) });
  });
  await p.goto('http://127.0.0.1:' + srv.address().port + '/cotizador/');
  await p.waitForFunction(() => typeof BOOT !== 'undefined' && BOOT, null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(500);
  return { p, errores };
}
async function medir(p, nombre) {
  await p.waitForTimeout(700);
  const ancho = await p.evaluate(() => {
    const w = document.documentElement.clientWidth, culpables = [];
    document.querySelectorAll('main *').forEach(e => { const r = e.getBoundingClientRect(); if (r.width && r.right > w + 1 && !e.closest('.tabla-desliza') && e.offsetParent)
      culpables.push(e.tagName + (e.id ? '#' + e.id : '') + (e.className ? '.' + String(e.className).split(' ')[0] : '') + ' →' + Math.round(r.right)); });
    return { scroll: document.documentElement.scrollWidth, w, culpables: culpables.slice(0, 6) };
  });
  await p.screenshot({ path: path.join(fotos, nombre + '.png'), fullPage: true });
  console.log((ancho.scroll > ancho.w ? '✘ ' : '✔ ') + nombre + ': ancho de la página ' + ancho.scroll + ' px en ' + ancho.w + ' px' +
    (ancho.culpables.length ? ' · se salen: ' + ancho.culpables.join(', ') : ''));
  return ancho;
}

async function principal() {
  const { chromium } = require('playwright');
  const nav = await chromium.launch();
  const resultados = {};
  try {
    let s = await abrir(nav, 'obrero');
    await s.p.evaluate(() => verTab('gas')); resultados.gastosCaptura = await medir(s.p, 'gastos-captura-obrero');
    s.errores.length && console.log('   errores JS:', s.errores);
    s = await abrir(nav, 'adri');
    await s.p.evaluate(() => verTab('gas')); resultados.gastosEquipo = await medir(s.p, 'gastos-equipo-aprobaciones');
    s = await abrir(nav, 'obrero');
    await s.p.evaluate(() => verTab('horas')); await s.p.waitForTimeout(800);
    await s.p.evaluate(() => { const sel = document.getElementById('hrsNuevo'); if (sel && sel.options.length > 1) { sel.value = sel.options[1].value; HORAS.agregar(); } });
    resultados.horas = await medir(s.p, 'horas-semana');
    s = await abrir(nav, 'tania');
    await s.p.evaluate(() => verTab('cob')); await s.p.waitForTimeout(800);
    resultados.facturas = await medir(s.p, 'cobranza-facturas-clientes');
    await s.p.evaluate(() => { const f = FACTURAS_CLI.estado().lista.facturas[0]; FACTURAS_CLI.vista('todas'); FACTURAS_CLI.abrirLiga(f.uuid); });
    resultados.liga = await medir(s.p, 'cobranza-ligar-factura');
    s.errores.length && console.log('   errores JS:', s.errores);

    // ---- PERMISO y SESION en los módulos nuevos ----
    s = await abrir(nav, 'adri', { listarGastos: ['PERMISO', 'No tienes acceso a Gastos.'] });
    await s.p.evaluate(() => { verTab('gas'); GASTOS.filtrar(); }); await s.p.waitForTimeout(600);
    const avisoG = await s.p.evaluate(() => ({ aviso: document.getElementById('aviso').textContent, cargando: document.getElementById('gasMios') && document.getElementById('gasMios').textContent }));
    console.log('PERMISO en listarGastos →', JSON.stringify(avisoG));
    s = await abrir(nav, 'tania', { listarFacturasClientes: ['PERMISO', 'No tienes permiso de cobranza.'] });
    await s.p.evaluate(() => { verTab('cob'); FACTURAS_CLI.cargar(); }); await s.p.waitForTimeout(600);
    const permF = await s.p.evaluate(() => ({ aviso: document.getElementById('aviso').textContent, error: FACTURAS_CLI.estado().error,
      lista: FACTURAS_CLI.estado().lista, pantalla: document.getElementById('facConteos').textContent.trim().slice(0, 60) }));
    console.log('PERMISO en listarFacturasClientes (con la lista ya cargada) →', JSON.stringify(permF));
    assert(/No tienes permiso de cobranza/.test(permF.aviso) && permF.error && permF.lista === null && /No se pudieron cargar las facturas/.test(permF.pantalla),
      'ARREGLADO: el error se ve y la lista vieja se quita');
    s = await abrir(nav, 'tania', { listarFacturasClientes: ['SESION', 'Tu sesión venció.'] });
    await s.p.evaluate(() => { verTab('cob'); FACTURAS_CLI.cargar(); }); await s.p.waitForTimeout(600);
    console.log('SESION en listarFacturasClientes → pantalla de entrada visible:', await s.p.evaluate(() => !document.getElementById('login').classList.contains('oculto')));
  } finally { await nav.close(); srv.close(); }
  const malas = Object.entries(resultados).filter(([, a]) => a.scroll > a.w).map(([k]) => k);
  console.log(malas.length ? 'Vistas que se mueven de lado a 390 px: ' + malas.join(', ') : 'Ninguna vista nueva se mueve de lado a 390 px.');
}
