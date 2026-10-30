// Incremento 7 · revisión independiente (permisos, privacidad y entrada de datos, 29/10/2026): las reproducciones de los revisores
// (R0–R4 y P1, P6, P7), convertidas en pruebas que pasan con el arreglo. Cada bloque arma su propio arnés.
//  R0  Matriz de acceso de las funciones nuevas × cada rol (también @helgen.services y una cuenta desactivada).
//  R1  Nómina en el margen: por omisión cobranza NO la ve (NOMINA_EN_MARGEN solo "cobranza" la muestra; cualquier otro valor la oculta),
//      nadie se nombra líder a sí mismo (salvo el super admin), la versión de costosPersonal se enmascara (sin señal de "cambió" ni
//      vueltas) y devolver horas aprobadas pide la huella y solo de las semanas que enseña «Por aprobar».
//  R2  Regla 17: guardarGasto y reembolsarGasto no hacen llamadas HTTP (privado_) con el candado tomado.
//  R3  Si privado_ falla o lo de adentro del candado falla (o es repetido), los archivos del gasto van a la Papelera: nada queda abierto.
//  R4  Compras no registra el reembolso de su propio gasto (otra persona de Compras; el super admin, con motivo).
//  P1  El XML de un gasto nunca se abre como página (XSS con la sesión de quien revisa): servidor text/plain, interfaz con lista blanca.
//  P6  El ISH (impuesto local) de un hotel no es IVA: es costo del gasto (leerCfdi.locales).
//  P7  Un CFDI de Helgen a Helgen no es un gasto.
//  +   UUID repetido: a quien captura, un mensaje general (sin el folio de otro registro).
// Uso: node tests/revision7-privacidad.test.js .
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || '.';
const crearArnes = require('./arnes');
const PROPS = { ROL_COBRANZA: 'tania@helgen.tech', ROL_COMPRAS: 'pedro@helgen.tech', ROL_REQUISICION: 'obrero@helgen.tech',
  ROL_OPERACIONES: 'adri@helgen.tech', SUPER_ADMIN: 'leo@helgen.tech' };
const HELGEN = 'HSE240304PC1', PROV = 'EKU9003173C9';
const U = n => ('0000000' + n).slice(-8) + '-AAAA-4BBB-8CCC-' + ('00000000000' + n).slice(-12);
const b64 = s => Buffer.from(s).toString('base64');
const x = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
/** CFDI 4.0 de ingreso mínimo (como tests/revision7/comun.js de la revisión): o = {uuid, emisor, receptor, subtotal, iva, total, ish, extra}. */
function cfdi(o) {
  const a = Object.assign({ uuid: U(1), emisor: PROV, receptor: HELGEN, subtotal: '1000.00', iva: '160.00', total: '1160.00', ish: null, extra: '',
    fecha: '2026-10-10T10:00:00' }, o || {});
  const ish = a.ish ? `<implocal:ImpuestosLocales xmlns:implocal="http://www.sat.gob.mx/implocal" version="1.0" TotaldeRetenciones="0.00" TotaldeTraslados="${a.ish}">` +
    `<implocal:TrasladosLocales ImpLocTrasladado="ISH" TasadeTraslado="3.00" Importe="${a.ish}"/></implocal:ImpuestosLocales>` : '';
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="A" Folio="1" Fecha="${a.fecha}" SubTotal="${a.subtotal}" Moneda="MXN" ` +
    `Total="${a.total}" TipoDeComprobante="I" MetodoPago="PUE" FormaPago="03" Exportacion="01" LugarExpedicion="76000">` +
    `<cfdi:Emisor Rfc="${a.emisor}" Nombre="${x('COMERCIO')}" RegimenFiscal="601"/>` +
    `<cfdi:Receptor Rfc="${a.receptor}" Nombre="HELGEN" DomicilioFiscalReceptor="76000" RegimenFiscalReceptor="601" UsoCFDI="G03"/>` +
    `<cfdi:Conceptos><cfdi:Concepto ClaveProdServ="90111500" Cantidad="1" ClaveUnidad="E48" Descripcion="Servicio" ValorUnitario="${a.subtotal}" Importe="${a.subtotal}" ObjetoImp="02"/></cfdi:Conceptos>` +
    `<cfdi:Impuestos TotalImpuestosTrasladados="${a.iva}"/>` +
    `<cfdi:Complemento>${ish}<tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="${a.uuid.toLowerCase()}" FechaTimbrado="${a.fecha}"/></cfdi:Complemento>` +
    a.extra + '</cfdi:Comprobante>';
}
/** Archivos creados desde `antes` (Set de ids) que siguen fuera de la Papelera. */
const vivosDesde = (A, antes) => Object.keys(A.archivos).filter(k => !antes.has(k) && !A.archivos[k].trashed).map(k => A.archivos[k]);

// ================= R0 · Matriz de acceso (sin sorpresas) =================
{
  const A = crearArnes(dir, { props: Object.assign({}, PROPS, { SOLO_REQUISICION: 'rosa@helgen.tech' }) });
  const { P, ok, post, HOY_ISO, FOTO } = A;
  ['nora:Nora', 'luis:Luis', 'baja:Baja'].forEach(s => { const [u, n] = s.split(':'); A.tokens[u] = A.claims(u + '@helgen.tech', n, 'X'); });
  P.prepararCapri();
  ok('leo', 'guardarUsuario', { nuevo: true, correo: 'nora@helgen.tech', nombre: 'Nora', roles: ['ventas', 'nomina'] });
  ok('leo', 'guardarUsuario', { nuevo: true, correo: 'luis@helgen.tech', nombre: 'Luis', roles: ['ventas'] });
  ok('leo', 'guardarUsuario', { nuevo: true, correo: 'baja@helgen.tech', nombre: 'Baja', roles: ['ventas', 'cobranza', 'nomina'], activo: false });
  ok('leo', 'guardarUsuario', { nuevo: true, correo: 'jesus@helgen.services', nombre: 'Jesús', roles: ['solo_requisicion'] });
  const svc = A.correr("emitirSesionCapri_('jesus@helgen.services', 'Jesús')");
  const p1 = ok('ana', 'crearProyecto', { nombre: 'Planta', cliente: { nombre: 'C', empresa: 'SA' }, idSolicitud: 'p1' }).folio;
  const c = ok('ana', 'guardarCotizacion', { cliente: { nombre: 'C', empresa: 'SA' }, items: [{ descripcion: 'S', cantidad: 1, precio: 1000 }], proyectoFolio: p1, moneda: 'MXN', idSolicitud: 'c1' }).folio;
  ok('tania', 'marcarAceptada', p1, c, true); ok('tania', 'firmarContrato', p1, HOY_ISO);
  const ad = ok('ana', 'guardarCotizacion', { cliente: { nombre: 'C', empresa: 'SA' }, items: [{ descripcion: 'X', cantidad: 1, precio: 10 }], proyectoFolio: p1, moneda: 'MXN', idSolicitud: 'c2', adicional: true }).folio;
  ok('tania', 'asignarLider', p1, 'luis@helgen.tech');
  const g = ok('obrero', 'guardarGasto', { proyectoFolio: p1, fecha: HOY_ISO, categoria: 'Casetas', concepto: 'Caseta', monto: 100, moneda: 'MXN', ivaIncluido: 'No',
    ticket: { nombre: 't.jpg', datos: FOTO }, idSolicitud: 'g1' }).folio;
  const sem = P.sumarDias(P.lunesDe(HOY_ISO), -7);
  ok('obrero', 'guardarSemana', { semana: sem, enviar: true, bloques: [{ proyecto: p1, horas: [8], actividad: 'Antenas' }] });
  const quienes = { ventas: 'ana', requisicion: 'obrero', solo: 'rosa', servicios: svc, aprobaciones: 'adri', compras: 'pedro', cobranza: 'tania',
    nomina: 'nora', lider: 'luis', superadmin: 'leo', inactiva: 'baja' };
  const llamadas = {
    listarGastos: [null], archivoGasto: [g, 'ticket'], aprobarGasto: ['GAS-0000-0000'], rechazarGasto: ['GAS-0000-0000', 'motivo largo'],
    cancelarGasto: ['GAS-0000-0000', 'motivo'], reembolsarGasto: [{ folio: 'GAS-0000-0000' }],
    misHoras: [], horasPorAprobar: [], listarLideres: [], listarCostosPersonal: [], reporteNomina: [],
    aceptarAdicional: ['PRY-0000-0000', ad], guardarEsquemaAdicional: ['PRY-0000-0000', ad, []], cancelarAdicional: ['PRY-0000-0000', ad, 'x'],
    listarFacturasClientes: [], ligarFacturaCliente: [{}], cancelarFacturaCliente: ['', ''], importarFacturasClientes: [{ archivos: [] }],
    getCobranzaProyecto: [p1], resumenCobranzaGeneral: [], reporteMargen: [],
  };
  const celda = r => r.ok ? 'ok' : (r.codigo || 'err');
  const tabla = {};
  Object.keys(llamadas).forEach(f => { tabla[f] = {}; Object.keys(quienes).forEach(q => { tabla[f][q] = celda(post(quienes[q], f, ...llamadas[f])); }); });
  Object.keys(tabla).forEach(f => assert.equal(tabla[f].inactiva, 'ACCESO', f + ': cuenta desactivada'));
  ['listarCostosPersonal', 'reporteNomina'].forEach(f => Object.keys(quienes).forEach(q =>
    assert(['nomina', 'superadmin'].indexOf(q) !== -1 ? tabla[f][q] === 'ok' : tabla[f][q] !== 'ok', f + ' × ' + q)));
  ['listarFacturasClientes', 'getCobranzaProyecto', 'resumenCobranzaGeneral', 'reporteMargen'].forEach(f => Object.keys(quienes).forEach(q =>
    assert(['cobranza', 'superadmin'].indexOf(q) !== -1 ? tabla[f][q] === 'ok' : tabla[f][q] !== 'ok', f + ' × ' + q)));
  ['ventas', 'cobranza', 'nomina', 'lider', 'solo', 'servicios'].forEach(q => assert.notEqual(tabla.archivoGasto[q], 'ok', 'ticket ajeno × ' + q));
  [['requisicion', 'obrero'], ['solo', 'rosa'], ['servicios', svc]].forEach(([n, q]) => {
    const ctx = { gastos: true, gastosFiltro: { estado: '' }, horasSemana: sem, horasAprobar: true, horasLideres: true, nomCostos: true,
      nomReporte: {}, cobProyecto: p1, cobResumen: true, reporte: 'margen', facturasCli: true, pendTodos: true };
    const s = JSON.stringify([post(q, 'bootstrap'), post(q, 'sincronizar', {}, ctx)]);
    assert(!/"equipo":\{|horasAprobar"|nomCostos|nomReporte|cobranzaProyecto|"resumen":|facturasCli"|"reporte":/.test(s), n + ': ' + s.slice(0, 200));
  });
}

// ================= R1 · Nómina en el margen: sin oráculo para cobranza =================
function escenarioNomina(nominaEnMargen) {
  const A = crearArnes(dir, { props: Object.assign({}, PROPS, nominaEnMargen != null ? { NOMINA_EN_MARGEN: nominaEnMargen } : {}) });
  const { P, ok, HOY_ISO } = A;
  A.tokens.nora = A.claims('nora@helgen.tech', 'Nora', 'Nómina');
  A.tokens.luis = A.claims('luis@helgen.tech', 'Luis', 'Líder');
  P.prepararCapri();
  ok('leo', 'guardarUsuario', { nuevo: true, correo: 'nora@helgen.tech', nombre: 'Nora Nómina', roles: ['ventas', 'nomina'] });
  ok('leo', 'guardarUsuario', { nuevo: true, correo: 'luis@helgen.tech', nombre: 'Luis Líder', roles: ['ventas'] });
  let n = 0;
  const pry = nombre => ok('ana', 'crearProyecto', { nombre, cliente: { nombre: 'C ' + nombre, empresa: 'SA' }, idSolicitud: 'p' + (++n) }).folio;
  const firmar = f => {
    const c = ok('ana', 'guardarCotizacion', { cliente: { nombre: 'C', empresa: 'SA' }, items: [{ descripcion: 'Servicio', cantidad: 1, precio: 500000 }],
      proyectoFolio: f, moneda: 'MXN', idSolicitud: 'c' + (++n) }).folio;
    ok('tania', 'marcarAceptada', f, c, true);
    ok('tania', 'firmarContrato', f, HOY_ISO);
  };
  pry('Relleno'); // PRY-AAAA-0001 es de prueba en los reportes
  const Q1 = pry('Planta Norte'), Q2 = pry('Patio Sur');
  firmar(Q1); firmar(Q2);
  let sem = P.lunesDe(HOY_ISO);
  do { sem = P.sumarDias(sem, -7); } while (sem.slice(0, 7) !== P.sumarDias(sem, 4).slice(0, 7)); // 5 días hábiles en el mismo mes
  return { A, P, ok, falla: A.falla, Q1, Q2, sem, mes: sem.slice(0, 7) };
}
const nominaDe = (ok, quien, f) => {
  const m = ok(quien, 'getCobranzaProyecto', f).margen;
  const c = (m.costos || []).find(y => y.concepto === 'Nómina');
  return { monto: c ? c.monto : 0, oculta: !!m.nominaOculta, margen: m.margen };
};

// A) Activo: cobranza ya no se nombra líder; aunque otro (el super admin) la nombre, aprobar no mueve su margen (nómina oculta)
{
  const { ok, falla, Q1, Q2, sem, mes } = escenarioNomina();
  const COSTO = 73519.37;
  ok('nora', 'guardarCostoPersonal', { correo: 'obrero@helgen.tech', mes, costo: COSTO, notas: 'Sueldo + IMSS' });
  ok('obrero', 'guardarSemana', { semana: sem, enviar: true, bloques: [
    { proyecto: Q1, horas: [6, 6, 6, 6, 6], actividad: 'Antenas' }, { proyecto: Q2, horas: [2, 2, 2, 2, 2], actividad: 'Obra civil' }] });
  falla('tania', 'asignarLider', [Q1, 'tania@helgen.tech'], /No puedes nombrarte líder/, 'PERMISO');
  falla('tania', 'asignarLider', [Q1, ' Tania@Helgen.tech '], /No puedes nombrarte líder/, 'PERMISO');
  falla('luis', 'asignarLider', [Q1, 'luis@helgen.tech'], /super admin o cobranza/, 'PERMISO');
  ok('leo', 'asignarLider', Q2, 'leo@helgen.tech'); // el super admin sí puede nombrarse
  ok('leo', 'asignarLider', Q1, 'tania@helgen.tech');
  ok('leo', 'asignarLider', Q2, 'tania@helgen.tech');
  const antes = nominaDe(ok, 'tania', Q1).monto + nominaDe(ok, 'tania', Q2).monto;
  const pa = ok('tania', 'horasPorAprobar').porAprobar;
  assert.equal(pa.length, 2);
  ok('tania', 'aprobarHoras', pa.map(y => ({ correo: y.correo, semana: y.semana, proyecto: y.proyecto, huella: y.huella })));
  const d1 = nominaDe(ok, 'tania', Q1);
  assert.equal(d1.monto + nominaDe(ok, 'tania', Q2).monto - antes, 0, 'A: aprobar no mueve el margen de cobranza');
  assert.equal(d1.oculta, true, 'la tarjeta dice que no incluye nómina');
  assert.equal(nominaDe(ok, 'leo', Q1).monto + nominaDe(ok, 'leo', Q2).monto, COSTO, 'el super admin sí la ve (la suma es el costo)');
}

// B) Pasivo: con el resumen abierto, cada costo que captura Nómina no le llega a cobranza (versión enmascarada, sin vueltas)
{
  const { A, ok, Q1, Q2, sem, mes } = escenarioNomina();
  ok('tania', 'asignarLider', Q1, 'luis@helgen.tech');
  ok('tania', 'asignarLider', Q2, 'luis@helgen.tech');
  ok('obrero', 'guardarSemana', { semana: sem, enviar: true, bloques: [{ proyecto: Q1, horas: [6, 6, 6, 6, 6], actividad: 'Antenas' },
    { proyecto: Q2, horas: [2, 2, 2, 2, 2], actividad: 'Obra' }] });
  ok('ana', 'guardarSemana', { semana: sem, enviar: true, bloques: [{ proyecto: Q1, horas: [1, 1, 1, 1, 1], actividad: 'Ventas en sitio' },
    { proyecto: Q2, horas: [3, 3, 3, 3, 3], actividad: 'Visita' }] });
  ok('luis', 'aprobarHoras', ok('luis', 'horasPorAprobar').porAprobar.map(y => ({ correo: y.correo, semana: y.semana, proyecto: y.proyecto, huella: y.huella })));
  const COSTOS = { 'obrero@helgen.tech': 73519.37, 'ana@helgen.tech': 91827.46 };
  const bTania = ok('tania', 'bootstrap').versiones, bNora = ok('nora', 'bootstrap').versiones, bLeo = ok('leo', 'bootstrap').versiones;
  assert('costosPersonal' in bTania && bTania.costosPersonal === 0, 'bootstrap: la llave sigue, el valor enmascarado');
  assert.deepEqual([bNora.costosPersonal === bLeo.costosPersonal, typeof bNora.costosPersonal], [true, 'number'], 'Nómina y super admin: la real');
  let vc = ok('tania', 'sincronizar', {}, {}).versiones;
  const nom = filas => filas.reduce((s, r) => s + (r.costos || []).filter(y => y.concepto === 'Nómina').reduce((t, y) => t + y.monto, 0), 0);
  const r0 = ok('tania', 'resumenCobranzaGeneral');
  assert.deepEqual([nom(r0.proyectos), r0.nominaOculta], [0, true], 'resumen sin nómina y lo dice');
  let vLeo = ok('leo', 'sincronizar', {}, {}).versiones;
  Object.keys(COSTOS).forEach(correo => {
    ok('nora', 'guardarCostoPersonal', { correo, mes, costo: COSTOS[correo] });
    const s = ok('tania', 'sincronizar', vc, { cobResumen: true, cobProyecto: Q1 });
    assert(!s.resumen && !s.cobranzaProyecto && !s.cambios.includes('costosPersonal'), 'B: nada llega a cobranza cuando Nómina guarda un costo');
    assert.equal(s.versiones.costosPersonal, 0);
    assert.deepEqual(ok('tania', 'sincronizar', s.versiones, {}).cambios, [], 'sin vueltas: con sus versiones, nada cambió');
    vc = s.versiones;
    const sl = ok('leo', 'sincronizar', vLeo, {});
    assert(sl.cambios.includes('costosPersonal'), 'el super admin sí se entera');
    vLeo = sl.versiones;
  });
  assert.equal(nom(ok('tania', 'resumenCobranzaGeneral').proyectos), 0, 'B: el resumen de cobranza nunca trae nómina');
  // Con NOMINA_EN_MARGEN = cobranza (decisión explícita): ve el monto, sin horas, y la versión sigue enmascarada (sin empuje ni vueltas)
  A.props.NOMINA_EN_MARGEN = 'cobranza';
  const conN = ok('tania', 'resumenCobranzaGeneral');
  assert(nom(conN.proyectos) > 0 && !/"horas"|sinCostear/.test(JSON.stringify(conN)) && !conN.nominaOculta, 'cobranza con la propiedad: monto sin horas');
  vc = ok('tania', 'sincronizar', {}, {}).versiones;
  ok('nora', 'guardarCostoPersonal', { correo: 'adri@helgen.tech', mes, costo: 1234.56 });
  const s2 = ok('tania', 'sincronizar', vc, { cobResumen: true });
  assert(!s2.resumen && s2.versiones.costosPersonal === 0, 'la versión sigue oculta también con la propiedad');
  assert.equal(nominaDe(ok, 'tania', Q1).oculta, false);
  void Q2;
}

// C) Histórico: devolver una parte aprobada pide la huella y solo de las semanas de «Por aprobar»; las viejas, solo el super admin
{
  const { A, P, ok, falla, Q1, mes } = escenarioNomina();
  let semVieja = P.lunesDe(P.sumarDias(mes + '-01', -95));
  while (semVieja.slice(0, 7) !== P.sumarDias(semVieja, 4).slice(0, 7)) semVieja = P.sumarDias(semVieja, 7);
  const semReciente = P.sumarDias(P.lunesDe(A.HOY_ISO), -7);
  ok('tania', 'asignarLider', Q1, 'luis@helgen.tech');
  ok('obrero', 'guardarSemana', { semana: semVieja, enviar: true, bloques: [{ proyecto: Q1, horas: [8, 8, 8, 8, 8], actividad: 'Antenas' }] });
  ok('obrero', 'guardarSemana', { semana: semReciente, enviar: true, bloques: [{ proyecto: Q1, horas: [4], actividad: 'Antenas' }] });
  ok('luis', 'aprobarHoras', ok('luis', 'horasPorAprobar').porAprobar.map(y => ({ correo: y.correo, semana: y.semana, proyecto: y.proyecto, huella: y.huella })));
  ok('nora', 'guardarCostoPersonal', { correo: 'obrero@helgen.tech', mes: semVieja.slice(0, 7), costo: 61234.56 });
  const huellaDe = semana => A.correr(`huellaBloqueHoras(bloquesDeHoras(horasDelLibro_(libroNominaSiExiste_())).find(b => b.correo === 'obrero@helgen.tech' && b.semana === '${semana}'))`);
  const vieja = { correo: 'obrero@helgen.tech', semana: semVieja, proyecto: Q1 };
  falla('luis', 'devolverHoras', [[vieja], 'Revisión de horas del trimestre'], /ábrelas en «Por aprobar»/);
  falla('luis', 'devolverHoras', [[Object.assign({ huella: huellaDe(semVieja) }, vieja)], 'Revisión de horas del trimestre'],
    /hace más de 5 semanas: solo un super admin/, 'PERMISO');
  assert(!ok('luis', 'horasPorAprobar').revisadas.some(y => y.semana === semVieja), '«Por aprobar» no la enseña');
  // Dentro de la ventana, con la huella que enseña «Por aprobar», el líder sí la devuelve
  const reciente = ok('luis', 'horasPorAprobar').revisadas.find(y => y.semana === semReciente);
  ok('luis', 'devolverHoras', [{ correo: reciente.correo, semana: reciente.semana, proyecto: reciente.proyecto, huella: reciente.huella }], 'Faltó el detalle del viernes');
  // El super admin puede devolver la vieja (con o sin huella)
  ok('leo', 'devolverHoras', [vieja], 'Corrección de dirección del trimestre');
  assert.equal(A.correr(`bloquesDeHoras(horasDelLibro_(libroNominaSiExiste_())).find(b => b.semana === '${semVieja}').estado`), 'Devuelta');
}

// Interfaz: la tarjeta de margen y los totales del resumen dicen "No incluye nómina…" cuando el servidor la oculta (Reportes → margen:
// tests/reportes.test.js). La interfaz real, montada sobre el servidor simulado (tests/montar-interfaz.js).
const interfazNomina = (async () => {
  const { A, ok, Q1, sem, mes } = escenarioNomina();
  ok('nora', 'guardarCostoPersonal', { correo: 'obrero@helgen.tech', mes, costo: 40000 });
  ok('obrero', 'guardarSemana', { semana: sem, enviar: true, bloques: [{ proyecto: Q1, horas: [8, 8, 8, 8, 8], actividad: 'Antenas' }] });
  ok('leo', 'asignarLider', Q1, 'luis@helgen.tech');
  ok('luis', 'aprobarHoras', ok('luis', 'horasPorAprobar').porAprobar.map(y => ({ correo: y.correo, semana: y.semana, proyecto: y.proyecto, huella: y.huella })));
  const { montar, esperar } = require('./montar-interfaz')(A, dir);
  const NOTA = /No incluye nómina \(la ven Nómina y el super admin\)/;
  const ver = async (quien, permisos) => {
    const UI = montar(quien, permisos);
    UI.run('BOOT = true; abrirProyectoCob(' + JSON.stringify(Q1) + ')'); await esperar();
    const tarjeta = UI.$('cobMargen').innerHTML;
    UI.run('RESUMEN = null; verResumenCob()'); await esperar();
    return { tarjeta, totales: UI.$('resTotales').innerHTML };
  };
  const t = await ver('tania', { cobranza: true });
  assert(NOTA.test(t.tarjeta) && !/Nómina/.test(t.tarjeta.replace(NOTA, '')), 'tarjeta de cobranza: sin nómina y lo dice');
  assert(NOTA.test(t.totales), 'totales del resumen: lo dicen');
  const l = await ver('leo', { cobranza: true, superadmin: true });
  assert(!NOTA.test(l.tarjeta) && /Nómina \(40 h\)/.test(l.tarjeta) && !NOTA.test(l.totales), 'super admin: con la nómina y sus horas, sin la nota');
  A.props.NOMINA_EN_MARGEN = 'cobranza';
  const c = await ver('tania', { cobranza: true });
  assert(!NOTA.test(c.tarjeta) && /<span>Nómina<\/span>/.test(c.tarjeta) && !/ h\b|sin costear/.test(c.tarjeta), 'cobranza con la propiedad: "Nómina" sin horas');
})();

// Falla cerrada: solo "cobranza" muestra la nómina a cobranza; vacía o cualquier otro valor la oculta
[[undefined, true], ['', true], ['superadmin', true], ['nomina', true], ['super admin', true], ['true', true], ['1', true],
  ['cobranza', false], [' COBRANZA ', false]].forEach(([valor, oculta]) => {
  const { ok, Q1, sem, mes } = escenarioNomina(valor);
  ok('nora', 'guardarCostoPersonal', { correo: 'obrero@helgen.tech', mes, costo: 50000 });
  ok('obrero', 'guardarSemana', { semana: sem, enviar: true, bloques: [{ proyecto: Q1, horas: [8, 8, 8, 8, 8], actividad: 'Antenas' }] });
  ok('leo', 'asignarLider', Q1, 'luis@helgen.tech');
  ok('luis', 'aprobarHoras', ok('luis', 'horasPorAprobar').porAprobar.map(y => ({ correo: y.correo, semana: y.semana, proyecto: y.proyecto, huella: y.huella })));
  const d = nominaDe(ok, 'tania', Q1);
  assert.deepEqual([d.monto, d.oculta], oculta ? [0, true] : [50000, false], 'NOMINA_EN_MARGEN = ' + JSON.stringify(valor));
  assert.deepEqual([nominaDe(ok, 'leo', Q1).monto, nominaDe(ok, 'leo', Q1).oculta], [50000, false], 'super admin siempre: ' + JSON.stringify(valor));
});

// ================= R2 · Ninguna llamada HTTP con el candado tomado (regla 17) =================
{
  const A = crearArnes(dir, { perfil: true, props: Object.assign({}, PROPS, { ROL_COMPRAS: 'pedro@helgen.tech, paco@helgen.tech' }) });
  const { P, ok, HOY_ISO, FOTO, PDF } = A;
  A.tokens.nora = A.claims('nora@helgen.tech', 'Nora', 'Nómina');
  A.tokens.paco = A.claims('paco@helgen.tech', 'Paco', 'Compras');
  P.prepararCapri();
  ok('leo', 'guardarUsuario', { nuevo: true, correo: 'nora@helgen.tech', nombre: 'Nora', roles: ['ventas', 'nomina'] });
  // El libro de compras ya existe en producción. Crearlo la primera vez (libroArea_, de antes del incremento 7: carpeta y libro del
  // área con su propio candado) no es parte de los gastos y no se mide aquí.
  A.correr('libroCompras_()');
  let n = 0;
  const pry = nombre => ok('ana', 'crearProyecto', { nombre, cliente: { nombre: 'C', empresa: 'SA' }, idSolicitud: 'p' + (++n) }).folio;
  const p1 = pry('Planta'), p2 = pry('Otra');
  const medir = (nombre, f) => {
    A.perfil.ops.length = 0;
    const r = f();
    const http = A.perfil.ops.filter(o => o.tipo === 'urlfetch' && o.candado).length;
    const correo = A.perfil.ops.filter(o => o.tipo === 'correo' && o.candado).length;
    const fuera = A.perfil.ops.filter(o => o.tipo === 'urlfetch' && !o.candado).length;
    assert.deepEqual([http, correo], [0, 0], nombre + ': sin HTTP ni correo con el candado');
    return { r, fuera };
  };
  const gasto = (pf, id, xml) => Object.assign({ proyectoFolio: pf, fecha: HOY_ISO, categoria: 'Combustible', concepto: 'Gasolina', monto: 1160, moneda: 'MXN',
    ivaIncluido: 'Sí', ticket: { nombre: 'ticket.jpg', datos: FOTO }, idSolicitud: id }, xml ? { xml: { nombre: 'f.xml', datos: b64(xml) } } : {});
  const g1 = medir('guardarGasto (primer gasto del proyecto)', () => ok('obrero', 'guardarGasto', gasto(p1, 'g1')));
  assert(g1.fuera > 0, 'privado_ sí corre, pero fuera del candado');
  const g2 = medir('guardarGasto (carpeta ya existe, con XML)', () => ok('obrero', 'guardarGasto', gasto(p1, 'g2', cfdi({ uuid: U(7) }))));
  medir('guardarGasto (otro proyecto)', () => ok('obrero', 'guardarGasto', gasto(p2, 'g3')));
  medir('guardarGasto (repetido)', () => ok('obrero', 'guardarGasto', gasto(p1, 'g1')));
  medir('aprobarGasto', () => ok('adri', 'aprobarGasto', g1.r.folio));
  const re = medir('reembolsarGasto', () => ok('pedro', 'reembolsarGasto', { folio: g1.r.folio, fecha: HOY_ISO, metodo: 'Transferencia',
    referencia: 'SPEI 123', comprobante: { nombre: 'c.pdf', datos: PDF }, idSolicitud: 'r1' }));
  assert(re.fuera > 0);
  // Los archivos nacen con nombre provisional y dentro del candado toman el folio; quedan privados
  const LCo = A.libros[A.props.COMPRAS_DB_ID].pest.Gastos.m, enc = LCo[0];
  const fila = folio => LCo.find(r => r[0] === folio);
  const arch = (folio, col) => A.archivos[fila(folio)[enc.indexOf(col)]];
  assert.deepEqual([arch(g1.r.folio, 'ticket_id').nombre, arch(g1.r.folio, 'reembolso_id').nombre, arch(g2.r.folio, 'xml_id').nombre],
    [g1.r.folio + ' — Ticket.jpg', g1.r.folio + ' — Reembolso.pdf', g2.r.folio + ' — CFDI.xml']);
  assert([arch(g1.r.folio, 'ticket_id'), arch(g1.r.folio, 'reembolso_id'), arch(g2.r.folio, 'xml_id')].every(a => a.acceso === 'PRIVATE'));
  assert(!Object.values(A.archivos).some(a => /Gasto en captura/.test(a.nombre || '') && !a.trashed), 'ningún provisional suelto');
}

// ================= R3 · Nada queda abierto ni suelto si algo falla =================
{
  const A = crearArnes(dir, { props: Object.assign({}, PROPS, { ROL_COMPRAS: 'pedro@helgen.tech, paco@helgen.tech' }) });
  const { P, ok, HOY_ISO, FOTO, PDF } = A;
  A.tokens.paco = A.claims('paco@helgen.tech', 'Paco', 'Compras');
  P.prepararCapri();
  const p1 = ok('ana', 'crearProyecto', { nombre: 'Planta', cliente: { nombre: 'C', empresa: 'SA' }, idSolicitud: 'p1' }).folio;
  const gasto = (id, extra) => Object.assign({ proyectoFolio: p1, fecha: HOY_ISO, categoria: 'Hospedaje', concepto: 'Hotel en Veracruz', monto: 2320, moneda: 'MXN',
    ivaIncluido: 'Sí', ticket: { nombre: 'ticket.jpg', datos: FOTO }, idSolicitud: id }, extra || {});
  ok('obrero', 'guardarGasto', gasto('g-0')); // la carpeta ya existe (restringida)
  const filasGastos = () => A.libros[A.props.COMPRAS_DB_ID].pest.Gastos.m.slice(1);
  const fetchOriginal = A.ctx.UrlFetchApp.fetch;
  const fallarUnaVez = re => { let fallar = true; A.ctx.UrlFetchApp = { fetch: (url, o) => {
    if (fallar && o && o.method === 'delete' && re.test(url)) { fallar = false; return { getResponseCode: () => 503, getContentText: () => '{"error":{"code":503}}' }; }
    return fetchOriginal(url, o);
  } }; };
  const sinFallas = () => { A.ctx.UrlFetchApp = { fetch: fetchOriginal }; };
  // 1) privado_ falla con el ticket (503 al quitar el permiso del dominio): el ticket va a la Papelera, sin fila
  let antes = new Set(Object.keys(A.archivos)), nFilas = filasGastos().length;
  fallarUnaVez(/\/files\/A\d+\/permissions\//);
  const r1 = A.post('obrero', 'guardarGasto', gasto('g-1'));
  sinFallas();
  assert.equal(r1.ok, false);
  assert.deepEqual([vivosDesde(A, antes).length, filasGastos().length], [0, nFilas], '1: nada vivo ni fila');
  assert(Object.keys(A.archivos).filter(k => !antes.has(k)).every(k => A.archivos[k].trashed), 'el ticket abierto está en la Papelera');
  // 2) privado_ falla con el XML (el segundo archivo): también el ticket ya creado va a la Papelera
  antes = new Set(Object.keys(A.archivos));
  let borrados = 0;
  A.ctx.UrlFetchApp = { fetch: (url, o) => {
    if (o && o.method === 'delete' && /\/files\/A\d+\/permissions\//.test(url) && ++borrados === 2) return { getResponseCode: () => 500, getContentText: () => '{}' };
    return fetchOriginal(url, o);
  } };
  assert.equal(A.post('obrero', 'guardarGasto', gasto('g-2', { xml: { nombre: 'f.xml', datos: b64(cfdi({ uuid: U(21) })) } })).ok, false);
  sinFallas();
  assert.deepEqual([vivosDesde(A, antes).length, Object.keys(A.archivos).filter(k => !antes.has(k)).length], [0, 2], '2: ticket y XML a la Papelera');
  // 3) Falla dentro del candado (antes de escribir la fila): los archivos ya privados van a la Papelera
  antes = new Set(Object.keys(A.archivos)); nFilas = filasGastos().length;
  const folioOriginal = P.siguienteFolio_;
  P.siguienteFolio_ = () => { throw new Error('Sheets no respondió'); };
  assert.equal(A.post('obrero', 'guardarGasto', gasto('g-3')).ok, false);
  P.siguienteFolio_ = folioOriginal;
  assert.deepEqual([vivosDesde(A, antes).length, filasGastos().length], [0, nFilas], '3: dentro del candado');
  // 4) Repetido detectado dentro del candado (otro envío igual llegó primero): los archivos de este sobran → Papelera
  const g4 = ok('obrero', 'guardarGasto', gasto('g-4'));
  antes = new Set(Object.keys(A.archivos));
  const filasOriginal = P.filasSiHay_;
  P.filasSiHay_ = (libro, hojas, nombre) => { if (nombre === 'Gastos') { P.filasSiHay_ = filasOriginal; return []; } return filasOriginal(libro, hojas, nombre); };
  const g4b = ok('obrero', 'guardarGasto', gasto('g-4'));
  P.filasSiHay_ = filasOriginal;
  assert.deepEqual([g4b.folio, g4b.repetido, vivosDesde(A, antes).length], [g4.folio, true, 0], '4: repetido sin archivos sueltos');
  // 5) El reintento sí funciona y deja el ticket privado con el folio
  const g5 = ok('obrero', 'guardarGasto', gasto('g-1'));
  const enc = A.libros[A.props.COMPRAS_DB_ID].pest.Gastos.m[0];
  const t5 = A.archivos[filasGastos().find(r => r[0] === g5.folio)[enc.indexOf('ticket_id')]];
  assert.deepEqual([t5.acceso, t5.nombre, !!t5.trashed], ['PRIVATE', g5.folio + ' — Ticket.jpg', false]);
  // Reembolso: privado_ falla con el comprobante, o falla dentro del candado → el comprobante a la Papelera; el gasto sigue Aprobado
  ok('adri', 'aprobarGasto', g5.folio);
  const reem = id => ({ folio: g5.folio, fecha: HOY_ISO, metodo: 'Transferencia', referencia: 'SPEI 9', comprobante: { nombre: 'c.pdf', datos: PDF }, idSolicitud: id });
  const estado = () => filasGastos().find(r => r[0] === g5.folio)[enc.indexOf('estado')];
  antes = new Set(Object.keys(A.archivos));
  fallarUnaVez(/\/files\/A\d+\/permissions\//);
  assert.equal(A.post('pedro', 'reembolsarGasto', reem('r-1')).ok, false);
  sinFallas();
  assert.deepEqual([vivosDesde(A, antes).length, estado()], [0, 'Aprobado'], 'reembolso: privado_ falla');
  const actualizarOriginal = P.actualizarGasto_;
  P.actualizarGasto_ = () => { throw new Error('Sheets no respondió'); };
  assert.equal(A.post('pedro', 'reembolsarGasto', reem('r-2')).ok, false);
  P.actualizarGasto_ = actualizarOriginal;
  assert.deepEqual([vivosDesde(A, antes).length, estado()], [0, 'Aprobado'], 'reembolso: falla dentro del candado');
  ok('pedro', 'reembolsarGasto', reem('r-3'));
  assert.equal(estado(), 'Reembolsado');
  // Repetido del reembolso: se reconoce antes de crear nada
  antes = new Set(Object.keys(A.archivos));
  assert.equal(ok('pedro', 'reembolsarGasto', reem('r-3')).repetido, true);
  assert.equal(Object.keys(A.archivos).filter(k => !antes.has(k)).length, 0, 'el reintento no crea otro comprobante');
}

// ================= R4 · Compras no se reembolsa a sí misma =================
{
  const A = crearArnes(dir, { props: Object.assign({}, PROPS, { ROL_REQUISICION: 'pedro@helgen.tech, obrero@helgen.tech',
    ROL_COMPRAS: 'pedro@helgen.tech, paco@helgen.tech' }) });
  const { P, ok, falla, HOY_ISO, FOTO, PDF } = A;
  A.tokens.paco = A.claims('paco@helgen.tech', 'Paco', 'Compras');
  P.prepararCapri();
  const p1 = ok('ana', 'crearProyecto', { nombre: 'Planta', cliente: { nombre: 'C', empresa: 'SA' }, idSolicitud: 'p1' }).folio;
  const capturar = (quien, id) => ok(quien, 'guardarGasto', { proyectoFolio: p1, fecha: HOY_ISO, categoria: 'Viáticos', concepto: 'Comidas', monto: 4800,
    moneda: 'MXN', ivaIncluido: 'Sí', ticket: { nombre: 't.jpg', datos: FOTO }, idSolicitud: id }).folio;
  const reem = (folio, id, extra) => Object.assign({ folio, fecha: HOY_ISO, metodo: 'Transferencia', referencia: 'SPEI 99', comprobante: { nombre: 'c.pdf', datos: PDF },
    idSolicitud: id }, extra || {});
  const g = capturar('pedro', 'g1');
  ok('adri', 'aprobarGasto', g);
  // La interfaz no le ofrece el botón ni el pendiente; el servidor lo rechaza antes de crear el comprobante
  const vista = ok('pedro', 'listarGastos', { estado: '' }).equipo.gastos.find(y => y.folio === g);
  assert.deepEqual([vista.propio, vista.puedeReembolsar], [true, false]);
  assert(!ok('pedro', 'pendientes').items.some(y => y.tipo === 'gastoReembolsar' && y.folio === g), 'sin pendiente propio');
  assert(ok('paco', 'pendientes').items.some(y => y.tipo === 'gastoReembolsar' && y.folio === g), 'otra persona de Compras sí');
  let antes = new Set(Object.keys(A.archivos));
  falla('pedro', 'reembolsarGasto', [reem(g, 'r1')], /No puedes registrar el reembolso de tu propio gasto: lo registra otra persona de Compras\.$/, 'PERMISO');
  assert.equal(Object.keys(A.archivos).filter(k => !antes.has(k)).length, 0, 'ni un archivo');
  const r = ok('paco', 'reembolsarGasto', reem(g, 'r2'));
  assert.equal(r.datos.equipo === null || !!r.datos, true);
  const LCo = A.libros[A.props.COMPRAS_DB_ID].pest.Gastos.m, enc = LCo[0];
  const fila = LCo.find(y => y[0] === g);
  assert.deepEqual([fila[enc.indexOf('estado')], fila[enc.indexOf('reembolso_email')]], ['Reembolsado', 'paco@helgen.tech']);
  // El correo "reembólsalo" no le llega a quien lo capturó (aunque sea de Compras)
  const g2 = capturar('pedro', 'g2');
  A.correos.length = 0;
  ok('adri', 'aprobarGasto', g2);
  const aCompras = A.correos.filter(m => /Gasto por reembolsar/.test(m.subject));
  assert(aCompras.length && aCompras.every(m => !/pedro@/.test(m.to)) && aCompras.some(m => /paco@/.test(m.to)), JSON.stringify(aCompras.map(m => m.to)));
  // Super admin: lo suyo solo con motivo (≥ 10), que queda en la bitácora de Administración y en la de compras
  const gl = capturar('leo', 'g3');
  ok('adri', 'aprobarGasto', gl);
  falla('leo', 'reembolsarGasto', [reem(gl, 'r3')], /tu propio gasto[\s\S]*Como super admin puedes hacerlo si escribes el motivo/, 'PERMISO');
  falla('leo', 'reembolsarGasto', [reem(gl, 'r3', { motivoExcepcion: 'corto' })], /propio gasto/, 'PERMISO');
  ok('leo', 'reembolsarGasto', reem(gl, 'r3', { motivoExcepcion: 'Viaje de dirección, Compras fuera' }));
  const LA = A.libros[A.props.ADMIN_DB_ID].pest.Bitacora.m;
  assert(LA.some(y => y[2] === 'Excepción de super admin: registrar el reembolso de su propio gasto' && y[5] === 'Viaje de dirección, Compras fuera'));
  const BC = A.libros[A.props.COMPRAS_DB_ID].pest.Bitacora.m;
  assert(BC.some(y => y[2] === 'Reembolsar gasto' && /Excepción de super admin: Viaje de dirección/.test(y[5])));
  // El super admin reembolsa lo de otros sin motivo (no es separación de funciones)
  const g4 = capturar('obrero', 'g4');
  ok('adri', 'aprobarGasto', g4);
  ok('leo', 'reembolsarGasto', reem(g4, 'r4'));
  void antes;
}

// ================= UUID repetido: a quien captura, sin el folio de otro registro =================
{
  const A = crearArnes(dir, { props: Object.assign({}, PROPS, { ROL_REQUISICION: 'obrero@helgen.tech, pedro@helgen.tech, rosa@helgen.tech' }) });
  const { P, ok, falla, HOY_ISO, FOTO } = A;
  P.prepararCapri();
  const p1 = ok('ana', 'crearProyecto', { nombre: 'Planta', cliente: { nombre: 'C', empresa: 'SA' }, idSolicitud: 'p1' }).folio;
  const conXml = (id, uuid) => ({ proyectoFolio: p1, fecha: HOY_ISO, categoria: 'Combustible', concepto: 'Gasolina', monto: 1, moneda: 'MXN', ivaIncluido: 'No',
    ticket: { nombre: 't.jpg', datos: FOTO }, xml: { nombre: 'f.xml', datos: b64(cfdi({ uuid })) }, idSolicitud: id });
  const g = ok('obrero', 'guardarGasto', conXml('a', U(55))).folio;
  const r = falla('rosa', 'guardarGasto', [conXml('b', U(55))], /^Ese CFDI ya está registrado en CAPRI \(otro gasto o una factura de proveedor\)\.$/);
  assert(!r.error.includes(g), 'no dice cuál');
  falla('obrero', 'guardarGasto', [conXml('c', U(55))], /^Ese CFDI ya está registrado en CAPRI/);
  falla('pedro', 'guardarGasto', [conXml('d', U(55))], new RegExp('ya está registrada \\(' + g + '\\)'), null); // Compras sí ve cuál
}

// ================= P6 · ISH de un hotel: costo, no IVA =================
{
  const A = crearArnes(dir, { props: PROPS });
  const { P, ok, plain, HOY_ISO, FOTO } = A;
  const xml = cfdi({ uuid: U(8080), subtotal: '1000.00', iva: '160.00', ish: '30.00', total: '1190.00', fecha: HOY_ISO + 'T09:00:00' });
  const leido = plain(P.leerCfdi(xml));
  assert.deepEqual([leido.trasladados, leido.retenidos, leido.locales], [190, 0, { trasladados: 30, retenidos: 0 }], 'leerCfdi: los de siempre + locales aparte');
  const pry = ok('ana', 'crearProyecto', { nombre: 'Obra Veracruz', ubicacion: 'Ver', cliente: { nombre: 'X', empresa: 'SA' }, idSolicitud: 'p6' }).folio;
  const g = ok('obrero', 'guardarGasto', { proyectoFolio: pry, fecha: HOY_ISO, categoria: 'Hospedaje', concepto: 'Hotel 1 noche', monto: 1190, moneda: 'MXN',
    ivaIncluido: 'Sí', ticket: { nombre: 't.jpg', datos: FOTO }, xml: { nombre: 'h.xml', datos: b64(xml) }, idSolicitud: 'g6' }).gasto;
  assert.deepEqual([g.subtotal, g.iva, g.total, g.ivaIncluido], [1030, 160, 1190, true], 'el ISH va al subtotal (costo); IVA = solo el federal');
  const costo = plain(P.costoGastosPorProyecto([Object.assign({}, g, { estado: 'Aprobado' })], 'MXN'))[pry][0].monto;
  assert.equal(costo, 1030, 'el margen cuenta el ISH');
  // Sin impuestos locales nada cambia
  const n = plain(P.normalizarGasto({ fecha: HOY_ISO, categoria: 'Hospedaje', concepto: 'x' }, { hoy: HOY_ISO, cfdi: P.leerCfdi(cfdi({ uuid: U(81) })) }));
  assert.deepEqual([n.subtotal, n.iva, n.total], [1000, 160, 1160]);
}

// ================= P7 · Helgen → Helgen no es un gasto =================
{
  const A = crearArnes(dir, { props: PROPS });
  const { ok, falla, HOY_ISO, FOTO } = A;
  const pry = ok('ana', 'crearProyecto', { nombre: 'Obra', ubicacion: 'Qro', cliente: { nombre: 'X', empresa: 'SA' }, idSolicitud: 'p7' }).folio;
  falla('obrero', 'guardarGasto', [{ proyectoFolio: pry, fecha: HOY_ISO, categoria: 'Otros', concepto: 'x', monto: 1, moneda: 'MXN', ivaIncluido: 'No',
    ticket: { nombre: 't.jpg', datos: FOTO }, xml: { nombre: 'auto.xml', datos: b64(cfdi({ uuid: U(4444), emisor: HELGEN, receptor: HELGEN })) }, idSolicitud: 'g7' }],
  /lo emitió Helgen \(HSE240304PC1\) a sí misma: no es la factura de un gasto/);
}

// ================= P1 · El XML de un gasto nunca se abre como página =================
{
  // Servidor: el XML (con un script XHTML que pasa leerCfdi) sale como text/plain; ticket y comprobante solo con tipos conocidos
  const A = crearArnes(dir, { props: PROPS });
  const { P, ok, HOY_ISO, FOTO } = A;
  P.prepararCapri();
  const pry = ok('ana', 'crearProyecto', { nombre: 'Planta Norte', ubicacion: 'Qro', cliente: { nombre: 'X', empresa: 'SA' }, idSolicitud: 'p1' }).folio;
  const carga = "opener.document.body.setAttribute('data-pwned', '1')";
  const xml = cfdi({ uuid: U(4242), extra: '<h:script xmlns:h="http://www.w3.org/1999/xhtml">' + carga + '</h:script>' });
  const g = ok('obrero', 'guardarGasto', { proyectoFolio: pry, fecha: HOY_ISO, categoria: 'Combustible', concepto: 'Gasolina', monto: 1160, moneda: 'MXN',
    ivaIncluido: 'Sí', ticket: { nombre: 't.jpg', datos: FOTO }, xml: { nombre: 'f.xml', datos: b64(xml) }, idSolicitud: 'g1' });
  const archivo = ok('adri', 'archivoGasto', g.folio, 'xml');
  assert.equal(archivo.mime, 'text/plain', 'archivoGasto: XML como text/plain');
  assert.equal(ok('adri', 'archivoGasto', g.folio, 'ticket').mime, 'image/jpeg');
  assert.deepEqual(['xml', 'ticket', 'reembolso', 'ticket', 'ticket', 'ticket'].map((t, i) =>
    P.mimeArchivoGasto(t, ['application/xml', 'text/html', 'application/pdf; charset=x', 'image/svg+xml', 'IMAGE/PNG', '__proto__'][i])),
  ['text/plain', 'application/octet-stream', 'application/pdf', 'application/octet-stream', 'image/png', 'application/octet-stream']);

  // Interfaz (DOM simulado): abrirArchivoServidor + verArchivo (gastos) + verArchivoReq, tal como están en index.html
  const html = fs.readFileSync(path.join(dir, 'web/cotizador/index.html'), 'utf8');
  const ini = html.indexOf('  const TIPOS_EN_PAGINA'), fin = html.indexOf('  const ligaArchivo = (folio, id, texto)');
  assert(ini > 0 && fin > ini, 'encuentra el visor en index.html');
  const verGasto = html.match(/ {4}function verArchivo\(folio, que\) \{[\s\S]*?\n {4}\}\n/)[0];
  // Nadie más arma un blob con el tipo que manda el servidor ni lo abre como página
  assert(!/type:\s*a\.mime/.test(html), 'ningún blob con el mime del servidor');
  assert.equal((html.match(/\.location = url/g) || []).length, 2, 'solo abrirArchivoServidor abre un blob en una pestaña');
  function correrVisor(respuesta, conVentana) {
    const blobs = [], descargas = [], abiertas = [];
    const elemento = tag => ({ tag, style: {}, hijos: [], textContent: '', click() { if (tag === 'a') descargas.push({ href: this.href, nombre: this.download }); },
      remove() {}, appendChild(h) { this.hijos.push(h); } });
    const w = conVentana ? { cerrada: false, location: null, opener: {}, document: { title: '', body: elemento('body'), createElement: elemento },
      close() { this.cerrada = true; } } : null;
    class Blob { constructor(partes, o) { this.tipo = (o || {}).type; this.bytes = partes[0]; blobs.push(this); } }
    const ctx = { Blob, Uint8Array, TextDecoder, Array, String, Math, Object, setTimeout: () => 0, console,
      atob: s => Buffer.from(s, 'base64').toString('binary'),
      URL: { createObjectURL: b => 'blob:capri/' + blobs.indexOf(b), revokeObjectURL() {} },
      document: { createElement: elemento, body: elemento('body') },
      mostrarError: e => { throw new Error(String(e)); },
      google: { script: { run: { withSuccessHandler: okF => ({ withFailureHandler: () => ({
        archivoGasto: () => okF(respuesta), archivoRequisicion: () => okF(respuesta) }) }) } } } };
    ctx.window = { open: () => { abiertas.push(w); return w; }, set location(u) { ctx.paginaPropia = u; } };
    vm.createContext(ctx);
    vm.runInContext(html.slice(ini, fin) + '\n' + verGasto + '\nverArchivo("GAS-1", "xml"); verArchivoReq("REQ-1", "x");', ctx);
    return { blobs, descargas, w, paginaPropia: ctx.paginaPropia };
  }
  const PDFB = Buffer.from('%PDF-1.4 x').toString('base64'), JPG = FOTO, PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 13, 10, 26, 10]).toString('base64');
  const HTMLB = b64('<html><script>' + carga + '</script></html>');
  const enPagina = r => r.blobs.filter(b => b.tipo !== 'application/octet-stream');
  const SEGUROS = ['application/pdf', 'image/jpeg', 'image/png'];
  // XML (nuevo servidor: text/plain; servidor viejo: application/xml): texto escapado en un <pre>, ningún blob
  for (const mime of ['text/plain', 'application/xml', 'text/xml']) {
    const r = correrVisor({ nombre: 'GAS-1 — CFDI.xml', mime, datos: b64(xml) }, true);
    assert.deepEqual([r.blobs.length, r.w.location, r.w.opener], [0, null, null], mime + ': ningún blob ni navegación; sin opener');
    assert.equal(r.w.document.body.hijos[0].textContent, xml, 'el XML como texto (textContent: nunca se interpreta)');
    assert.equal(r.w.document.body.hijos[0].tag, 'pre');
  }
  // Sin pestaña (el navegador la bloqueó): el XML se descarga como octet-stream; nunca se abre en la página de CAPRI
  let r = correrVisor({ nombre: 'f.xml', mime: 'application/xml', datos: b64(xml) }, false);
  assert.deepEqual([enPagina(r).length, r.descargas.length, r.paginaPropia], [0, 2, undefined]);
  // HTML, SVG o un "PDF" que no empieza con %PDF: descarga (octet-stream), nunca en la página
  for (const [mime, datos] of [['text/html', HTMLB], ['image/svg+xml', HTMLB], ['application/pdf', HTMLB], ['image/png', HTMLB], ['__proto__', PDFB],
    ['application/xhtml+xml', HTMLB], ['', PDFB]]) {
    r = correrVisor({ nombre: 'x', mime, datos }, true);
    assert.deepEqual([enPagina(r).length, r.descargas.length, r.w.cerrada, r.w.location], [0, 2, true, null], 'no se abre: ' + mime);
  }
  // PDF, JPG y PNG de verdad: en la pestaña, con el tipo de la lista (no el texto del servidor)
  for (const [mime, datos, tipo] of [['application/pdf', PDFB, 'application/pdf'], ['image/jpeg; x=1', JPG, 'image/jpeg'], ['IMAGE/PNG', PNG, 'image/png']]) {
    r = correrVisor({ nombre: 'x', mime, datos }, true);
    assert.deepEqual([r.blobs.length, r.blobs.every(b => b.tipo === tipo), /^blob:/.test(r.w.location), r.w.opener], [2, true, true, null], tipo);
  }
  // Ningún blob para la página fuera de la lista blanca en todos los casos de arriba (lo comprueba enPagina/SEGUROS)
  assert(SEGUROS.length === 3);
}

interfazNomina.then(() => console.log('OK revision7-privacidad (R0 matriz, R1 nómina sin oráculo + interfaz, R2 sin HTTP en el candado, ' +
  'R3 Papelera, R4 reembolso propio, UUID, P1 XML, P6 ISH, P7 Helgen→Helgen)'), e => { console.error(e); process.exit(1); });
